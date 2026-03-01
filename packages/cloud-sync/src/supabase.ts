/**
 * Supabase client for cloud sync operations
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  PlatformNotification,
  PlatformDM,
  PostStats,
  PlatformComment,
  FollowerEvent,
  CloudAction,
  PollState,
  Platform,
  DataType,
  LinkedInInvitation,
} from './types';
import { classifyComment } from './comment-classifier';
import { classifyDM } from './dm-classifier';

export class CloudSupabase {
  private client: SupabaseClient;

  constructor(url?: string, key?: string) {
    const supabaseUrl = url || process.env.SUPABASE_URL;
    const supabaseKey = key || process.env.SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY required');
    }
    this.client = createClient(supabaseUrl, supabaseKey);
  }

  getClient(): SupabaseClient { return this.client; }

  // ─── Poll State ──────────────────────────────────────
  async getPollState(platform: Platform, dataType: DataType): Promise<PollState | null> {
    const { data } = await this.client
      .from('platform_poll_state')
      .select('*')
      .eq('platform', platform)
      .eq('data_type', dataType)
      .single();
    return data;
  }

  async upsertPollState(platform: Platform, dataType: DataType, updates: Partial<PollState>): Promise<void> {
    await this.client.from('platform_poll_state').upsert({
      platform,
      data_type: dataType,
      ...updates,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'platform,data_type' });
  }

  // ─── Notifications ───────────────────────────────────
  async syncNotifications(notifications: PlatformNotification[]): Promise<number> {
    if (!notifications.length) return 0;
    const now = new Date().toISOString();

    // Filter out invalid entries
    const valid = notifications.filter(n => {
      if (!n.platform || !n.notification_type) return false;
      // Must have at least an actor or content
      if (!n.actor_username && !n.content) return false;
      // post_id sanity (if present)
      if (n.post_id && (n.post_id.includes('<') || n.post_id.length > 100)) return false;
      return true;
    });
    if (!valid.length) return 0;

    const rows = valid.map(n => ({
      ...n,
      synced_at: now,
      dedup_key: [
        n.platform,
        n.notification_type,
        (n.actor_username || '').toLowerCase().replace(/[:\s]+$/, ''),
        n.post_id || '',
        n.platform_timestamp || '',
      ].join(':'),
    }));
    const { data, error } = await this.client
      .from('platform_notifications')
      .upsert(rows, { onConflict: 'dedup_key', ignoreDuplicates: true })
      .select('id');
    if (error) console.error('[CloudSync] Notification sync error:', error.message);
    return data?.length || 0;
  }

  async getUnactionedNotifications(platform?: Platform, limit = 50): Promise<any[]> {
    let q = this.client
      .from('platform_notifications')
      .select('*')
      .eq('is_actioned', false)
      .order('synced_at', { ascending: false })
      .limit(limit);
    if (platform) q = q.eq('platform', platform);
    const { data } = await q;
    return data || [];
  }

  async markNotificationActioned(id: string, action: string): Promise<void> {
    await this.client.from('platform_notifications').update({
      is_actioned: true,
      action_taken: action,
      actioned_at: new Date().toISOString(),
    }).eq('id', id);
  }

  // ─── DMs ─────────────────────────────────────────────
  async syncDMs(dms: PlatformDM[]): Promise<number> {
    if (!dms.length) return 0;
    const now = new Date().toISOString();

    // Filter out invalid entries — must have username + message_text
    const valid = dms.filter(dm => {
      if (!dm.platform || !dm.username) return false;
      if (!dm.message_text || dm.message_text.trim().length < 1) return false;
      // Reject deleted/system placeholder messages
      const trimMsg = dm.message_text.trim().toLowerCase();
      if (trimMsg === 'this message has been deleted.' || trimMsg === 'this message has been deleted') return false;
      if (trimMsg === 'message unavailable' || trimMsg === 'message deleted') return false;
      return true;
    });
    if (!valid.length) return 0;

    // Fix direction: messages starting with "You:" are outbound
    for (const dm of valid) {
      if (dm.message_text.trim().startsWith('You:') && dm.direction === 'inbound') {
        dm.direction = 'outbound';
      }
    }

    const rows = valid.map(dm => {
      const cls = classifyDM(dm.message_text, dm.direction, dm.platform);
      return {
      ...dm,
      intent: cls.intent,
      intent_score: cls.intent_score,
      sentiment: cls.sentiment,
      reply_needed: cls.reply_needed,
      suggested_reply: cls.suggested_reply,
      lead_score: cls.lead_score,
      synced_at: now,
      // Normalized dedup key: lowercase text, collapse whitespace
      dedup_key: [
        dm.platform,
        dm.conversation_id || dm.username,
        (dm.message_text || '').replace(/\s+/g, ' ').trim().substring(0, 80).toLowerCase(),
        dm.platform_timestamp || '',
      ].join(':'),
    };
    });
    const { data, error } = await this.client
      .from('platform_dms')
      .upsert(rows, { onConflict: 'dedup_key', ignoreDuplicates: true })
      .select('id');
    if (error) console.error('[CloudSync] DM sync error:', error.message);
    return data?.length || 0;
  }

  async getUnrepliedDMs(platform?: Platform, limit = 50): Promise<any[]> {
    let q = this.client
      .from('platform_dms')
      .select('*')
      .eq('reply_needed', true)
      .eq('is_replied', false)
      .order('synced_at', { ascending: false })
      .limit(limit);
    if (platform) q = q.eq('platform', platform);
    const { data } = await q;
    return data || [];
  }

  async markDMReplied(id: string): Promise<void> {
    await this.client.from('platform_dms').update({
      is_replied: true,
    }).eq('id', id);
  }

  // ─── Comments ────────────────────────────────────
  async syncComments(comments: PlatformComment[]): Promise<number> {
    if (!comments.length) return 0;
    const now = new Date().toISOString();

    // ── False-positive prevention (multi-layer) ──────────

    // Known own handles — tag these as self-comments, don't skip
    const OWN_HANDLES = new Set([
      'the_isaiah_dupree', 'isaiahdupree', 'isaiah_dupree',
      'isaiahDupree7', 'isaiahDupree', 'IsaiahDupree7',
    ].map(h => h.toLowerCase()));

    // Platform → expected URL domain patterns (cross-platform bleed check)
    const PLATFORM_DOMAINS: Record<string, string[]> = {
      instagram: ['instagram.com'],
      twitter: ['x.com', 'twitter.com'],
      tiktok: ['tiktok.com'],
      threads: ['threads.net', 'threads.com'],
    };

    const valid = comments.filter(c => {
      // Layer 1: Required fields — username, text, post_id must be non-empty
      if (!c.username || c.username.length < 1) return false;
      if (!c.comment_text || c.comment_text.trim().length < 2) return false;
      if (!c.post_id || c.post_id.length < 1) return false;

      // Layer 2: post_id sanity — reject if it looks like a URL, HTML, or garbage
      if (c.post_id.includes('<') || c.post_id.includes('http') || c.post_id.length > 100) return false;

      // Layer 3: Cross-platform bleed — if post_url exists, it MUST match the platform domain
      if (c.post_url) {
        const domains = PLATFORM_DOMAINS[c.platform];
        if (domains && !domains.some(d => c.post_url!.includes(d))) {
          console.warn(`[CloudSync] ⚠️ Cross-platform bleed blocked: ${c.platform} comment has URL ${c.post_url}`);
          return false;
        }
      }

      // Layer 4: Text quality — must contain at least 2 letter characters
      if (c.comment_text.replace(/[^a-zA-Z]/g, '').length < 2) return false;

      // Layer 5: DOM scraping artifacts — username followed by numbers (e.g. "gavwallace1 67 2")
      const trimText = c.comment_text.trim();
      if (trimText.match(/^[a-z0-9_.]+\s+\d+/i) && trimText.length < 30) {
        console.warn(`[CloudSync] ⚠️ Scraping artifact blocked: "${trimText}"`);
        return false;
      }
      // Reject pure metrics text (e.g. "5 likes", "23 views")
      if (trimText.match(/^\d+\s*(likes?|views?|replies|shares?|comments?|retweets?|reposts?)/i)) return false;

      return true;
    });
    if (!valid.length) return 0;

    // Tag self-comments (don't filter out, just mark in raw_data)
    for (const c of valid) {
      if (OWN_HANDLES.has(c.username.toLowerCase())) {
        c.raw_data = { ...c.raw_data, _is_own_comment: true };
      }
    }

    const rows = valid.map(c => {
      const cls = classifyComment(c.comment_text);
      return {
      platform: c.platform,
      post_id: c.post_id,
      post_url: c.post_url || null,
      username: c.username,
      display_name: c.display_name || null,
      comment_text: c.comment_text.substring(0, 2000),
      like_count: c.like_count || 0,
      sentiment_class: cls.sentiment_class,
      sentiment_score: cls.sentiment_score,
      is_question: cls.is_question,
      is_testimonial: cls.is_testimonial,
      platform_timestamp: c.platform_timestamp || null,
      raw_data: c.raw_data || {},
      synced_at: now,
      // Dedup: platform + post_id + username + normalized first 80 chars of text
      // This prevents the same comment from being inserted twice across poll cycles
      // Using text prefix (not hash) for transparency and debuggability
      // Normalize: trim, collapse whitespace/newlines, lowercase for consistency
      dedup_key: [
        c.platform,
        c.post_id,
        c.username.replace(/[:\s]+$/, ''), // strip trailing colons/whitespace from username
        c.comment_text.replace(/\s+/g, ' ').trim().substring(0, 80).toLowerCase(),
      ].join(':'),
    };
    });

    const { data, error } = await this.client
      .from('platform_comments')
      .upsert(rows, { onConflict: 'dedup_key', ignoreDuplicates: true })
      .select('id');
    if (error) console.error('[CloudSync] Comment sync error:', error.message);
    return data?.length || 0;
  }

  async getComments(platform?: Platform, postId?: string, limit = 100): Promise<any[]> {
    let q = this.client
      .from('platform_comments')
      .select('*')
      .order('synced_at', { ascending: false })
      .limit(limit);
    if (platform) q = q.eq('platform', platform);
    if (postId) q = q.eq('post_id', postId);
    const { data } = await q;
    return data || [];
  }

  // ─── Post Stats ──────────────────────────────────────
  // Known own handles per platform for ownership validation
  private static readonly OWN_POST_PATTERNS: Record<string, RegExp[]> = {
    tiktok: [/tiktok\.com\/@(isaiah_dupree|isaiahdupree)\//i],
    instagram: [/instagram\.com\/(the_isaiah_dupree|p\/|reel\/)/i],
    twitter: [/x\.com\/IsaiahDupree7\//i, /twitter\.com\/IsaiahDupree7\//i],
    threads: [/threads\.(net|com)\/@the_isaiah_dupree\//i],
  };

  async syncPostStats(stats: PostStats[]): Promise<number> {
    if (!stats.length) return 0;

    // Filter out invalid entries
    const valid = stats.filter(s => {
      if (!s.platform || !s.post_id) return false;
      if (s.post_id.includes('<') || s.post_id.includes('http') || s.post_id.length > 100) return false;
      // Must have at least one non-zero metric
      if (!s.views && !s.likes && !s.comments && !s.shares) return false;
      // Ownership check: post_url must match a known own handle pattern
      if (s.post_url) {
        const patterns = CloudSupabase.OWN_POST_PATTERNS[s.platform];
        if (patterns && !patterns.some(p => p.test(s.post_url!))) {
          console.warn(`[CloudSync] ⚠️ Non-own post blocked: ${s.platform} ${s.post_url}`);
          return false;
        }
      }
      return true;
    });
    if (!valid.length) return 0;

    let synced = 0;
    for (const s of valid) {
      // Get existing to compute deltas
      const { data: existing } = await this.client
        .from('post_stats')
        .select('id, views, likes, comments')
        .eq('platform', s.platform)
        .eq('post_id', s.post_id)
        .single();

      const record: any = {
        ...s,
        last_synced_at: new Date().toISOString(),
      };

      if (existing) {
        record.views_delta = (s.views || 0) - (existing.views || 0);
        record.likes_delta = (s.likes || 0) - (existing.likes || 0);
        record.comments_delta = (s.comments || 0) - (existing.comments || 0);
      } else {
        record.first_synced_at = new Date().toISOString();
      }

      // Compute engagement rate: prefer views-based, fall back to likes-based
      const totalEngagement = (s.likes || 0) + (s.comments || 0) + (s.shares || 0);
      if (s.views && s.views > 0) {
        record.engagement_rate = parseFloat(((totalEngagement / s.views) * 100).toFixed(2));
      } else if (totalEngagement > 0) {
        // No views available — store raw engagement sum as rate (will be >100 for low-volume)
        record.engagement_rate = totalEngagement;
      } else {
        record.engagement_rate = 0;
      }

      // Classify performance
      record.performance_tier = this.classifyPerformance(s);

      const { error } = await this.client
        .from('post_stats')
        .upsert(record, { onConflict: 'platform,post_id' });

      if (!error) {
        synced++;
        // Record history snapshot
        if (existing?.id) {
          await this.client.from('post_stats_history').insert({
            post_stat_id: existing.id,
            views: s.views || 0,
            likes: s.likes || 0,
            comments: s.comments || 0,
            shares: s.shares || 0,
            engagement_rate: s.engagement_rate || 0,
          });
        }
      }
    }
    return synced;
  }

  async getPostStats(platform?: Platform, limit = 50): Promise<any[]> {
    let q = this.client
      .from('post_stats')
      .select('*')
      .order('last_synced_at', { ascending: false })
      .limit(limit);
    if (platform) q = q.eq('platform', platform);
    const { data } = await q;
    return data || [];
  }

  async getTopPosts(platform?: Platform, limit = 10): Promise<any[]> {
    let q = this.client
      .from('post_stats')
      .select('*')
      .order('engagement_rate', { ascending: false })
      .limit(limit);
    if (platform) q = q.eq('platform', platform);
    const { data } = await q;
    return data || [];
  }

  // ─── Follower Events ────────────────────────────────
  async syncFollowerEvents(events: FollowerEvent[]): Promise<number> {
    if (!events.length) return 0;
    const now = new Date().toISOString();

    // Username blocklist — common navigation/UI elements that could leak from DOM scraping
    const BLOCKED_USERNAMES = new Set([
      'accounts', 'explore', 'reels', 'direct', 'stories', 'about', 'privacy',
      'terms', 'help', 'nametag', 'notifications', 'foryou', 'following',
      'live', 'upload', 'inbox', 'profile', 'settings', 'search', 'home',
    ]);
    const DOMAIN_MAP: Record<string, string[]> = {
      instagram: ['instagram.com'], tiktok: ['tiktok.com'],
      twitter: ['x.com', 'twitter.com'], threads: ['threads.net', 'threads.com'],
    };
    const valid = events.filter(e => {
      if (!e.platform || !e.username) return false;
      if (e.username.length < 2 || e.username.length > 50) return false;
      // Must look like a real username (alphanumeric, dots, underscores)
      if (!/^[a-zA-Z0-9_.]+$/.test(e.username)) return false;
      // Blocklist check
      if (BLOCKED_USERNAMES.has(e.username.toLowerCase())) return false;
      // If profile_url provided, verify it matches at least one platform domain
      if (e.profile_url) {
        const domains = DOMAIN_MAP[e.platform];
        if (domains && !domains.some(d => e.profile_url!.includes(d))) return false;
      }
      return true;
    });
    if (!valid.length) return 0;

    const rows = valid.map(e => ({
      ...e,
      synced_at: now,
      dedup_key: [e.platform, e.event_type, e.username.toLowerCase()].join(':'),
    }));

    const { data, error } = await this.client
      .from('follower_events')
      .upsert(rows, { onConflict: 'dedup_key', ignoreDuplicates: true })
      .select('id');
    if (error) console.error('[CloudSync] Follower event sync error:', error.message);
    return data?.length || 0;
  }

  async getRecentFollowers(platform?: Platform, limit = 50): Promise<any[]> {
    let q = this.client
      .from('follower_events')
      .select('*')
      .eq('event_type', 'follow')
      .order('synced_at', { ascending: false })
      .limit(limit);
    if (platform) q = q.eq('platform', platform);
    const { data } = await q;
    return data || [];
  }

  // ─── LinkedIn Invitations ───────────────────────────
  async syncInvitations(invitations: LinkedInInvitation[]): Promise<number> {
    if (!invitations.length) return 0;
    const now = new Date().toISOString();
    const rows = invitations.map(inv => ({
      direction: inv.direction,
      username: inv.username || null,
      name: inv.name,
      headline: inv.headline || null,
      profile_url: inv.profile_url || null,
      sent_time: inv.sent_time || null,
      note: inv.note || null,
      mutual_connections: inv.mutual_connections || 0,
      status: inv.status || 'pending',
      raw_data: inv.raw_data || {},
      synced_at: now,
      updated_at: now,
      dedup_key: `linkedin:${inv.direction}:${inv.username || inv.name}`,
    }));
    const { data, error } = await this.client
      .from('linkedin_invitations')
      .upsert(rows, { onConflict: 'dedup_key' })
      .select('id');
    if (error) console.error('[CloudSync] Invitation sync error:', error.message);
    return data?.length || 0;
  }

  async getInvitations(direction?: 'sent' | 'received', limit = 50): Promise<any[]> {
    let q = this.client
      .from('linkedin_invitations')
      .select('*')
      .order('synced_at', { ascending: false })
      .limit(limit);
    if (direction) q = q.eq('direction', direction);
    const { data } = await q;
    return data || [];
  }

  // ─── Cloud Action Queue ──────────────────────────────
  async getPendingActions(limit = 10): Promise<CloudAction[]> {
    const { data } = await this.client
      .from('cloud_action_queue')
      .select('*')
      .eq('status', 'pending')
      .order('priority', { ascending: false })
      .order('created_at', { ascending: true })
      .limit(limit);
    return (data || []) as CloudAction[];
  }

  async queueAction(action: Omit<CloudAction, 'id' | 'status'>): Promise<string | null> {
    const { data, error } = await this.client
      .from('cloud_action_queue')
      .insert({ ...action, status: 'pending' })
      .select('id')
      .single();
    if (error) { console.error('[CloudSync] Queue action error:', error.message); return null; }
    return data?.id || null;
  }

  async updateAction(id: string, status: string, result?: any, error?: string): Promise<void> {
    const updates: any = { status, updated_at: new Date().toISOString() };
    if (status === 'running') updates.started_at = new Date().toISOString();
    if (['completed', 'failed'].includes(status)) updates.completed_at = new Date().toISOString();
    if (result) updates.result = result;
    if (error) updates.error = error;
    await this.client.from('cloud_action_queue').update(updates).eq('id', id);
  }

  // ─── Content Learnings ───────────────────────────────
  async addLearning(learning: {
    platform?: string;
    learning_type: string;
    insight: string;
    confidence?: number;
    data_points?: number;
    raw_analysis?: Record<string, unknown>;
  }): Promise<void> {
    await this.client.from('content_learnings').insert({
      ...learning,
      is_active: true,
    });
  }

  async getActiveLearnings(platform?: string): Promise<any[]> {
    let q = this.client
      .from('content_learnings')
      .select('*')
      .eq('is_active', true)
      .order('confidence', { ascending: false });
    if (platform) q = q.eq('platform', platform);
    const { data } = await q;
    return data || [];
  }

  // ─── Dashboard Stats ─────────────────────────────────
  async getDashboardStats(): Promise<Record<string, unknown>> {
    const [notifs, dms, posts, actions, learnings] = await Promise.all([
      this.client.from('platform_notifications').select('platform, notification_type', { count: 'exact', head: true }),
      this.client.from('platform_dms').select('platform', { count: 'exact', head: true }),
      this.client.from('post_stats').select('platform', { count: 'exact', head: true }),
      this.client.from('cloud_action_queue').select('status', { count: 'exact', head: true }).eq('status', 'pending'),
      this.client.from('content_learnings').select('*', { count: 'exact', head: true }).eq('is_active', true),
    ]);

    return {
      notifications: notifs.count || 0,
      dms: dms.count || 0,
      posts: posts.count || 0,
      pendingActions: actions.count || 0,
      activeLearnings: learnings.count || 0,
    };
  }

  private classifyPerformance(s: PostStats): string {
    const eng = s.engagement_rate || 0;
    const views = s.views || 0;
    if (views > 100000 || eng > 10) return 'viral';
    if (views > 10000 || eng > 5) return 'high';
    if (views > 1000 || eng > 2) return 'average';
    if (views > 100) return 'low';
    return 'flop';
  }
}

let instance: CloudSupabase | null = null;
export function getCloudSupabase(): CloudSupabase {
  if (!instance) instance = new CloudSupabase();
  return instance;
}
