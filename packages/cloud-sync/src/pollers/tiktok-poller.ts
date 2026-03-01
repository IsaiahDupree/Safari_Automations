/**
 * TikTok Poller — polls TikTok DM service (3102) + Comments service (3006)
 */
import { BasePoller } from './base-poller';
import { PlatformDM, PlatformNotification, PostStats, PlatformComment, FollowerEvent } from '../types';

// Ownership filter — only process videos from these handles
const OWN_TIKTOK_HANDLES = new Set(['isaiah_dupree', 'isaiahdupree', 'the_isaiah_dupree']);

function isOwnVideo(url: string): boolean {
  const match = url.match(/tiktok\.com\/@([^\/]+)/);
  if (!match) return false;
  return OWN_TIKTOK_HANDLES.has(match[1].toLowerCase());
}

export class TikTokPoller extends BasePoller {
  private commentsPort = 3006;

  constructor() {
    super('tiktok', 3102);
  }

  async pollDMs(): Promise<PlatformDM[]> {
    const result: PlatformDM[] = [];

    // Navigate to inbox first — required to populate conversation list
    await this.post('/api/tiktok/inbox/navigate', {});
    await new Promise(r => setTimeout(r, 3000));

    // Verify we're on TikTok before extracting
    if (!await this.verifyPageDomain(this.port, 'tiktok.com')) return result;

    const convos = await this.get<{ conversations: any[] }>('/api/tiktok/conversations');
    if (!convos?.conversations) return result;

    for (const c of convos.conversations.slice(0, 20)) {
      await this.post('/api/tiktok/conversations/open', { username: c.username || c.name });
      const msgs = await this.get<{ messages: any[] }>('/api/tiktok/messages?limit=5');

      if (msgs?.messages) {
        for (const m of msgs.messages) {
          result.push({
            platform: 'tiktok',
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
    const result: PlatformNotification[] = [];

    const convos = await this.get<{ conversations: any[] }>('/api/tiktok/conversations');
    if (convos?.conversations) {
      for (const c of convos.conversations) {
        if (c.unread) {
          result.push({
            platform: 'tiktok',
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
    // TikTok post stats via comments service: search-cards → navigate → video-metrics
    const result: PostStats[] = [];
    const commentsBase = `http://localhost:${this.commentsPort}`;

    try {
      const search = await fetch(`${commentsBase}/api/tiktok/search-cards`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'isaiahdupree', maxCards: 10 }),
        signal: AbortSignal.timeout(20000),
      });
      if (!search.ok) return result;
      const data = await search.json() as { videos?: any[] };
      const cards = data.videos || [];

      for (const card of cards.slice(0, 5)) {
        const videoUrl = card.url || card.videoUrl;
        if (!videoUrl) continue;
        // Ownership guard: skip videos from other creators
        if (!isOwnVideo(videoUrl)) {
          console.log(`[Poller:tiktok] Skipping non-own video: ${videoUrl}`);
          continue;
        }
        const idMatch = videoUrl.match(/video\/(\d+)/);
        const postId = idMatch ? idMatch[1] : card.id;
        if (!postId) continue;

        // Parse viewsRaw from search card (e.g. "1.2K", "5.3M", "423")
        let cardViews = 0;
        if (card.viewsRaw) {
          const vt = card.viewsRaw.replace(/,/g, '').trim();
          const vn = parseFloat(vt);
          if (!isNaN(vn)) {
            if (/[Kk]$/.test(vt)) cardViews = Math.round(vn * 1000);
            else if (/[Mm]$/.test(vt)) cardViews = Math.round(vn * 1000000);
            else if (/[Bb]$/.test(vt)) cardViews = Math.round(vn * 1000000000);
            else cardViews = Math.round(vn);
          }
        }

        // Navigate to video and get metrics
        await fetch(`${commentsBase}/api/tiktok/navigate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: videoUrl }),
          signal: AbortSignal.timeout(15000),
        });
        await new Promise(r => setTimeout(r, 3000));

        const metricsRes = await fetch(`${commentsBase}/api/tiktok/video-metrics`, {
          signal: AbortSignal.timeout(10000),
        });
        const metrics = metricsRes.ok ? await metricsRes.json() as any : {};

        const rawViews = metrics.views || metrics.playCount || cardViews || 0;
        const rawLikes = metrics.likes || metrics.diggCount || 0;
        // Guard: if views == likes, TikTok DOM is returning likes as views (known issue)
        const safeViews = (rawViews > 0 && rawViews === rawLikes) ? 0 : rawViews;

        result.push({
          platform: 'tiktok',
          post_id: postId,
          post_url: videoUrl,
          post_type: 'video',
          caption: card.description || card.text || metrics.description || '',
          views: safeViews,
          likes: rawLikes,
          comments: metrics.comments || metrics.commentCount || 0,
          shares: metrics.shares || metrics.shareCount || 0,
          saves: metrics.saves || metrics.collectCount || 0,
          engagement_rate: 0,
          raw_data: { card, metrics },
        });
      }
    } catch {}

    // Merge analytics data (watch time, completion rate, reach) if available
    if (result.length > 0) {
      try {
        const analyticsRes = await fetch(`${commentsBase}/api/tiktok/analytics/content?max=10`, {
          signal: AbortSignal.timeout(30000),
        });
        if (analyticsRes.ok) {
          const analytics = await analyticsRes.json() as { success?: boolean; videos?: any[] };
          if (analytics.success && analytics.videos?.length) {
            const analyticsMap = new Map<string, any>();
            for (const v of analytics.videos) {
              if (v.videoId) analyticsMap.set(v.videoId, v);
            }
            for (const stat of result) {
              const a = analyticsMap.get(stat.post_id);
              if (a) {
                if (a.avgWatchTimeSeconds > 0) stat.avg_watch_time_seconds = a.avgWatchTimeSeconds;
                if (a.completionRate > 0 && a.completionRate <= 100) stat.completion_rate = a.completionRate;
                if (a.reach > 0) stat.reach = a.reach;
                if (a.trafficSource && Object.keys(a.trafficSource).length > 0) stat.traffic_source = a.trafficSource;
                console.log(`[Poller:tiktok] Analytics merged for ${stat.post_id}: watchTime=${a.avgWatchTimeSeconds}s, completion=${a.completionRate}%`);
              }
            }
          }
        }
      } catch (e) {
        console.log(`[Poller:tiktok] Analytics fetch skipped: ${(e as Error).message}`);
      }
    }

    return result;
  }

  async pollComments(): Promise<PlatformComment[]> {
    const result: PlatformComment[] = [];
    const commentsBase = `http://localhost:${this.commentsPort}`;

    try {
      // Step 1: Search for our own posts to get video URLs + IDs
      const search = await fetch(`${commentsBase}/api/tiktok/search-cards`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'isaiahdupree', maxCards: 5, waitMs: 5000 }),
        signal: AbortSignal.timeout(30000),
      });
      if (!search.ok) return result;
      const data = await search.json() as { videos?: any[] };
      if (!data.videos?.length) return result;

      // Verify Safari is on TikTok after search navigation (prevents cross-platform bleed)
      if (!(await this.verifyPageDomain(this.commentsPort, 'tiktok.com'))) {
        console.warn('[Poller:tiktok] ⚠️ Page verification failed — not on tiktok.com, aborting');
        return result;
      }

      // Step 2: For each video, navigate to it and extract comments
      for (const video of data.videos.slice(0, 3)) {
        const postId = video.id;
        const postUrl = video.url;
        if (!postId || !postUrl) continue;
        // Ownership guard: skip videos from other creators
        if (!isOwnVideo(postUrl)) {
          console.log(`[Poller:tiktok] Skipping non-own video: ${postUrl}`);
          continue;
        }

        // Navigate to the video
        const nav = await fetch(`${commentsBase}/api/tiktok/navigate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: postUrl }),
          signal: AbortSignal.timeout(15000),
        });
        if (!nav.ok) continue;
        // Wait for page + comments to load
        await new Promise(r => setTimeout(r, 4000));

        // Extract comments
        const commentsRes = await fetch(`${commentsBase}/api/tiktok/comments?limit=20`, {
          signal: AbortSignal.timeout(10000),
        });
        if (!commentsRes.ok) continue;
        const commentsData = await commentsRes.json() as { comments?: any[] };

        if (commentsData.comments) {
          for (const c of commentsData.comments) {
            // Validate: must have both username and text to avoid false positives
            if (!c.username || !c.text || c.text.length < 2) continue;
            const text = c.text.trim();
            // Reject username+numbers artifacts (e.g. "gavwallace1 67 2")
            if (text.match(/^[a-z0-9_.]+\s+\d+/i) && text.length < 30) continue;
            // Reject pure metrics text
            if (text.match(/^\d+\s*(likes?|views?|replies|shares|comments)/i)) continue;
            result.push({
              platform: 'tiktok',
              post_id: postId,
              post_url: postUrl,
              username: c.username,
              comment_text: c.text.substring(0, 2000),
              platform_timestamp: c.timestamp || undefined,
              raw_data: c,
            });
          }
        }
      }
    } catch (e) {
      console.error(`[Poller:tiktok] pollComments error:`, (e as Error).message);
    }

    return result;
  }

  async pollFollowers(): Promise<FollowerEvent[]> {
    const result: FollowerEvent[] = [];
    const commentsBase = `http://localhost:${this.commentsPort}`;

    try {
      const res = await fetch(`${commentsBase}/api/tiktok/activity/followers`, {
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
          platform: 'tiktok',
          username: u,
          event_type: 'follow',
          profile_url: `https://www.tiktok.com/@${u}`,
          raw_data: e as any,
        });
      }
    } catch (e) {
      console.error(`[Poller:tiktok] pollFollowers error:`, (e as Error).message);
    }

    return result;
  }
}
