/**
 * Instagram Poller — polls Instagram DM service (3001) + Comments service (3005)
 */
import { BasePoller } from './base-poller';
import { PlatformDM, PlatformNotification, PostStats, PlatformComment, FollowerEvent } from '../types';

export class InstagramPoller extends BasePoller {
  private commentsPort = 3005;

  constructor() {
    super('instagram', 3100);
  }

  async pollDMs(): Promise<PlatformDM[]> {
    const result: PlatformDM[] = [];

    // Navigate to inbox first — required to populate conversation list
    await this.post('/api/inbox/navigate', {});
    await new Promise(r => setTimeout(r, 3000));

    // Verify we're on Instagram before extracting
    if (!await this.verifyPageDomain(this.port, 'instagram.com')) return result;

    const convos = await this.get<{ conversations: any[] }>('/api/conversations');
    if (!convos?.conversations) return result;

    for (const c of convos.conversations.slice(0, 20)) {
      // Open conversation and read messages
      await this.post('/api/conversations/open', { username: c.username || c.name });
      const msgs = await this.get<{ messages: any[] }>('/api/messages?limit=5');

      if (msgs?.messages) {
        for (const m of msgs.messages) {
          result.push({
            platform: 'instagram',
            conversation_id: c.threadId || c.username,
            username: m.sender || c.username || c.name,
            display_name: c.name,
            direction: m.isMe ? 'outbound' : 'inbound',
            message_text: m.text || m.content,
            message_type: m.type || 'text',
            is_read: !c.unread,
            raw_data: m,
            platform_timestamp: m.timestamp || new Date().toISOString(),
          });
        }
      }
    }

    return result;
  }

  async pollNotifications(): Promise<PlatformNotification[]> {
    // Instagram notifications are extracted from the activity feed
    // The DM service can navigate to the activity page
    const result: PlatformNotification[] = [];

    // Check for new unread conversations as notification proxies
    const convos = await this.get<{ conversations: any[] }>('/api/conversations');
    if (convos?.conversations) {
      for (const c of convos.conversations) {
        if (c.unread) {
          result.push({
            platform: 'instagram',
            notification_type: 'dm',
            actor_username: c.username || c.name,
            actor_display_name: c.name,
            content: c.snippet || c.lastMessage,
            raw_data: c,
            platform_timestamp: c.timestamp || new Date().toISOString(),
          });
        }
      }
    }

    return result;
  }

  async pollPostStats(): Promise<PostStats[]> {
    const result: PostStats[] = [];
    const commentsBase = `http://localhost:${this.commentsPort}`;

    try {
      // Navigate to profile
      await fetch(`${commentsBase}/api/instagram/navigate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'https://www.instagram.com/the_isaiah_dupree/' }),
        signal: AbortSignal.timeout(15000),
      });
      await new Promise(r => setTimeout(r, 4000));

      if (!(await this.verifyPageDomain(this.commentsPort, 'instagram.com'))) {
        console.warn('[Poller:instagram] ⚠️ Page verification failed for post stats');
        return result;
      }

      // Get post URLs from profile grid
      const postsRes = await fetch(`${commentsBase}/api/instagram/profile/posts?limit=5`, {
        signal: AbortSignal.timeout(10000),
      });
      if (!postsRes.ok) return result;
      const data = await postsRes.json() as { posts?: Array<{ shortcode: string; url: string; type: string }> };
      if (!data.posts?.length) return result;

      // Navigate to each post and extract metrics
      for (const post of data.posts.slice(0, 5)) {
        await fetch(`${commentsBase}/api/instagram/navigate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: post.url }),
          signal: AbortSignal.timeout(15000),
        });
        await new Promise(r => setTimeout(r, 3000));

        const metricsRes = await fetch(`${commentsBase}/api/instagram/post/metrics`, {
          signal: AbortSignal.timeout(10000),
        });
        if (!metricsRes.ok) continue;
        const metrics = await metricsRes.json() as any;

        result.push({
          platform: 'instagram',
          post_id: post.shortcode,
          post_url: post.url,
          post_type: post.type || 'post',
          caption: metrics.caption || '',
          views: metrics.views || 0,
          likes: metrics.likes || 0,
          comments: metrics.comments || 0,
          shares: 0,
          saves: metrics.saves || 0,
          engagement_rate: 0,
          raw_data: { post, metrics },
        });
      }
    } catch (e) {
      console.error(`[Poller:instagram] pollPostStats error:`, (e as Error).message);
    }

    return result;
  }

  async pollComments(): Promise<PlatformComment[]> {
    const result: PlatformComment[] = [];
    const commentsBase = `http://localhost:${this.commentsPort}`;

    try {
      // Step 1: Navigate to our profile page (READ-ONLY — no side effects)
      const nav = await fetch(`${commentsBase}/api/instagram/navigate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'https://www.instagram.com/the_isaiah_dupree/' }),
        signal: AbortSignal.timeout(15000),
      });
      if (!nav.ok) return result;
      await new Promise(r => setTimeout(r, 5000));

      // Verify Safari is actually on Instagram (prevents cross-platform bleed)
      if (!(await this.verifyPageDomain(this.commentsPort, 'instagram.com'))) {
        console.warn('[Poller:instagram] ⚠️ Page verification failed — not on instagram.com, aborting');
        return result;
      }

      // Step 2: Extract post links from profile grid (READ-ONLY endpoint)
      const postsRes = await fetch(`${commentsBase}/api/instagram/profile/posts?limit=5`, {
        signal: AbortSignal.timeout(10000),
      });
      let postUrls: Array<{ url: string; id: string }> = [];
      if (postsRes.ok) {
        const data = await postsRes.json() as { posts?: Array<{ shortcode: string; url: string }> };
        if (data.posts) {
          postUrls = data.posts.slice(0, 3).map(p => ({ url: p.url, id: p.shortcode }));
        }
      }
      if (!postUrls.length) return result;

      // Step 3: For each post, navigate and extract comments (READ-ONLY)
      for (const post of postUrls) {
        const postNav = await fetch(`${commentsBase}/api/instagram/navigate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: post.url }),
          signal: AbortSignal.timeout(15000),
        });
        if (!postNav.ok) continue;
        // Wait for post + comments to load
        await new Promise(r => setTimeout(r, 3000));

        // Extract comments from this specific post page
        const commentsRes = await fetch(`${commentsBase}/api/instagram/comments?limit=20`, {
          signal: AbortSignal.timeout(10000),
        });
        if (!commentsRes.ok) continue;
        const commentsData = await commentsRes.json() as { comments?: any[] };

        if (commentsData.comments) {
          for (const c of commentsData.comments) {
            // Validate: must have both username and text
            if (!c.username || !c.text || c.text.length < 3) continue;
            const text = c.text.trim();
            // Quality filters: skip handles, metadata, non-text
            if (text.replace(/[^a-zA-Z]/g, '').length < 2) continue;
            if (text.match(/^[a-z0-9_.]{2,30}$/i)) continue; // skip username-as-text
            if (text.match(/^\d+\s*(likes?|views?|replies|comments)/i)) continue; // skip metrics
            result.push({
              platform: 'instagram',
              post_id: post.id,
              post_url: post.url,
              username: c.username,
              comment_text: text.substring(0, 2000),
              platform_timestamp: c.timestamp || undefined,
              raw_data: c,
            });
          }
        }
      }
    } catch (e) {
      console.error(`[Poller:instagram] pollComments error:`, (e as Error).message);
    }

    return result;
  }

  async pollFollowers(): Promise<FollowerEvent[]> {
    const result: FollowerEvent[] = [];
    const commentsBase = `http://localhost:${this.commentsPort}`;

    try {
      const res = await fetch(`${commentsBase}/api/instagram/activity/followers`, {
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) return result;
      const data = await res.json() as { events?: Array<{ username: string; text: string }> };
      if (!data.events) return result;

      for (const e of data.events) {
        const u = (e.username || '').trim();
        // Validate: 2-30 chars, alphanumeric/dots/underscores only
        if (!u || u.length < 2 || u.length > 30 || !/^[a-zA-Z0-9_.]+$/.test(u)) continue;
        result.push({
          platform: 'instagram',
          username: u,
          event_type: 'follow',
          profile_url: `https://www.instagram.com/${u}/`,
          raw_data: e as any,
        });
      }
    } catch (e) {
      console.error(`[Poller:instagram] pollFollowers error:`, (e as Error).message);
    }

    return result;
  }
}
