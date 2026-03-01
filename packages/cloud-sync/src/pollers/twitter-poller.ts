/**
 * Twitter Poller — polls Twitter DM service (3003) + Comments service (3007)
 */
import { BasePoller } from './base-poller';
import { PlatformDM, PlatformNotification, PostStats, PlatformComment, FollowerEvent } from '../types';

export class TwitterPoller extends BasePoller {
  private commentsPort = 3007;

  constructor() {
    super('twitter', 3003);
  }

  async pollDMs(): Promise<PlatformDM[]> {
    const result: PlatformDM[] = [];

    // Navigate to inbox first — required to populate conversation list
    await this.post('/api/twitter/inbox/navigate', {});
    await new Promise(r => setTimeout(r, 3000));

    // Verify we're on Twitter before extracting
    if (!await this.verifyPageDomain(this.port, 'x.com')) return result;

    const convos = await this.get<{ conversations: any[] }>('/api/twitter/conversations');
    if (!convos?.conversations) return result;

    for (const c of convos.conversations.slice(0, 20)) {
      await this.post('/api/twitter/conversations/open', { username: c.username || c.name });
      const msgs = await this.get<{ messages: any[] }>('/api/twitter/messages?limit=5');

      if (msgs?.messages) {
        for (const m of msgs.messages) {
          result.push({
            platform: 'twitter',
            conversation_id: c.threadId || c.username,
            username: m.sender || c.username || c.name,
            display_name: c.name,
            direction: m.isMe ? 'outbound' : 'inbound',
            message_text: m.text || m.content,
            message_type: 'text',
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

    // Unread DM conversations as notifications
    const convos = await this.get<{ conversations: any[] }>('/api/twitter/conversations/unread');
    if (convos?.conversations) {
      for (const c of convos.conversations) {
        if (c.unread) {
          result.push({
            platform: 'twitter',
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

    // Get engagement data from own tweets via timeline
    const commentsBase = `http://localhost:${this.commentsPort}`;
    try {
      const timeline = await fetch(`${commentsBase}/api/twitter/timeline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle: 'IsaiahDupree7', maxResults: 5 }),
        signal: AbortSignal.timeout(25000),
      });
      if (timeline.ok) {
        const data = await timeline.json() as { tweets?: any[] };
        if (data.tweets) {
          for (const p of data.tweets) {
            if ((p.replies || 0) > 0 || (p.likes || 0) > 0) {
              result.push({
                platform: 'twitter',
                notification_type: 'engagement',
                content: `${p.likes || 0} likes, ${p.replies || 0} replies on: ${(p.text || '').slice(0, 80)}`,
                post_url: p.tweetUrl,
                post_id: p.tweetUrl?.split('/').pop(),
                raw_data: p,
              });
            }
          }
        }
      }
    } catch {}

    return result;
  }

  async pollPostStats(): Promise<PostStats[]> {
    const result: PostStats[] = [];

    // Get own tweet stats via timeline
    const commentsBase = `http://localhost:${this.commentsPort}`;
    try {
      const timeline = await fetch(`${commentsBase}/api/twitter/timeline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle: 'IsaiahDupree7', maxResults: 20 }),
        signal: AbortSignal.timeout(25000),
      });
      if (timeline.ok) {
        const data = await timeline.json() as { tweets?: any[] };
        if (data.tweets) {
          for (const p of data.tweets) {
            const postId = p.tweetUrl?.split('/').pop() || p.id;
            if (!postId) continue;
            result.push({
              platform: 'twitter',
              post_id: postId,
              post_url: p.tweetUrl,
              post_type: p.hasMedia ? 'video' : 'text',
              caption: p.text,
              views: p.views || 0,
              likes: p.likes || 0,
              comments: p.replies || 0,
              shares: p.retweets || 0,
              engagement_rate: p.views > 0
                ? parseFloat((((p.likes || 0) + (p.replies || 0) + (p.retweets || 0)) / p.views * 100).toFixed(2))
                : 0,
              raw_data: p,
            });
          }
        }
      }
    } catch {}

    return result;
  }

  async pollComments(): Promise<PlatformComment[]> {
    const result: PlatformComment[] = [];
    const commentsBase = `http://localhost:${this.commentsPort}`;

    try {
      // Step 1: Get our own recent tweets via timeline (more reliable than search)
      const timeline = await fetch(`${commentsBase}/api/twitter/timeline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle: 'IsaiahDupree7', maxResults: 5 }),
        signal: AbortSignal.timeout(25000),
      });
      if (!timeline.ok) return result;

      // Verify Safari is on Twitter after timeline navigation (prevents cross-platform bleed)
      if (!(await this.verifyPageDomain(this.commentsPort, 'x.com'))) {
        console.warn('[Poller:twitter] ⚠️ Page verification failed — not on x.com, aborting');
        return result;
      }

      const data = await timeline.json() as { tweets?: any[]; results?: any[] };
      const posts = data.tweets || data.results || [];
      if (!posts.length) return result;

      // Step 2: For each tweet, navigate to detail page and extract replies
      for (const post of posts.slice(0, 3)) {
        const postUrl = post.tweetUrl || post.url;
        const postId = postUrl?.split('/').pop();
        if (!postUrl || !postId) continue;
        // Skip posts with 0 replies — no comments to extract
        if ((post.replies || post.comments || 0) === 0) continue;

        // Navigate to tweet detail (this also extracts the main tweet)
        const detail = await fetch(`${commentsBase}/api/twitter/tweet/detail`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: postUrl }),
          signal: AbortSignal.timeout(15000),
        });
        if (!detail.ok) continue;
        // Wait for replies to load
        await new Promise(r => setTimeout(r, 3000));

        // Extract replies (comments)
        const commentsRes = await fetch(`${commentsBase}/api/twitter/comments?limit=20`, {
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
            if (text.match(/^@?[a-z0-9_.]{2,30}$/i)) continue; // skip username-as-text
            if (text.match(/^\d+\s*(likes?|views?|replies|retweets)/i)) continue; // skip metrics
            result.push({
              platform: 'twitter',
              post_id: postId,
              post_url: postUrl,
              username: c.username,
              comment_text: text.substring(0, 2000),
              platform_timestamp: c.timestamp || undefined,
              raw_data: c,
            });
          }
        }
      }
    } catch (e) {
      console.error(`[Poller:twitter] pollComments error:`, (e as Error).message);
    }

    return result;
  }

  async pollFollowers(): Promise<FollowerEvent[]> {
    const result: FollowerEvent[] = [];
    const commentsBase = `http://localhost:${this.commentsPort}`;

    try {
      const res = await fetch(`${commentsBase}/api/twitter/notifications`, {
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) return result;
      const data = await res.json() as { notifications?: Array<{ type: string; actor: string; text: string }> };
      if (!data.notifications) return result;

      for (const n of data.notifications) {
        if (n.type === 'follow' && n.actor && n.actor.length >= 2) {
          result.push({
            platform: 'twitter',
            username: n.actor,
            event_type: 'follow',
            profile_url: `https://x.com/${n.actor}`,
            raw_data: n as any,
          });
        }
      }
    } catch (e) {
      console.error(`[Poller:twitter] pollFollowers error:`, (e as Error).message);
    }

    return result;
  }
}
