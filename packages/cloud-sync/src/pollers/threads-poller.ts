/**
 * Threads Poller — polls Threads Comments service (3004)
 * Threads doesn't have a DM service, only comments/posting
 *
 * Available READ-ONLY endpoints:
 *   POST /api/threads/navigate   — navigate Safari tab to URL
 *   GET  /api/threads/posts      — find posts on currently loaded page
 *   POST /api/threads/click-post — click into post by index
 *   GET  /api/threads/context    — get full context (mainPost, username, replies, likeCount, replyCount)
 *   GET  /api/threads/comments   — extract comments from current page
 *   POST /api/threads/back       — go back to previous page
 */
import { BasePoller } from './base-poller';
import { PlatformDM, PlatformNotification, PostStats, PlatformComment } from '../types';

const PROFILE_URL = 'https://www.threads.net/@the_isaiah_dupree';

interface ThreadsPost {
  username: string;
  url: string;
  content: string;
  index: number;
}

interface ThreadsContext {
  mainPost: string;
  username: string;
  replies: string[];
  likeCount: string;
  replyCount: string;
}

export class ThreadsPoller extends BasePoller {
  constructor() {
    super('threads', 3004);
  }

  async pollDMs(): Promise<PlatformDM[]> {
    // Threads doesn't support DMs via Safari automation
    return [];
  }

  /** Navigate to our profile and discover posts on the page */
  private async discoverOwnPosts(limit = 5): Promise<ThreadsPost[]> {
    const nav = await this.post<{ success?: boolean }>('/api/threads/navigate', { url: PROFILE_URL });
    if (!nav?.success) return [];
    await new Promise(r => setTimeout(r, 4000));

    // Verify Safari is actually on Threads (prevents cross-platform bleed)
    if (!(await this.verifyPageDomain(this.port, 'threads.'))) {
      console.warn('[Poller:threads] ⚠️ Page verification failed — not on threads.net, aborting');
      return [];
    }

    const data = await this.get<{ posts?: ThreadsPost[] }>(`/api/threads/posts?limit=${limit}`);
    return data?.posts || [];
  }

  async pollNotifications(): Promise<PlatformNotification[]> {
    const result: PlatformNotification[] = [];

    try {
      const posts = await this.discoverOwnPosts(10);
      for (const p of posts) {
        // Click into post to get engagement data
        const clicked = await this.post<{ success?: boolean }>('/api/threads/click-post', { index: p.index });
        if (!clicked?.success) continue;
        await new Promise(r => setTimeout(r, 2000));

        const context = await this.get<ThreadsContext>('/api/threads/context');
        if (context) {
          const likes = parseInt(context.likeCount) || 0;
          const replies = parseInt(context.replyCount) || 0;
          if (likes > 0 || replies > 0) {
            result.push({
              platform: 'threads',
              notification_type: 'engagement',
              content: `${likes} likes, ${replies} replies: ${(context.mainPost || '').slice(0, 80)}`,
              post_url: p.url,
              post_id: p.url?.split('/').pop() || `threads_${p.index}`,
              raw_data: { ...p, context },
            });
          }
        }

        // Go back to profile for next post
        await this.post('/api/threads/back');
        await new Promise(r => setTimeout(r, 1500));
      }
    } catch {}

    return result;
  }

  async pollPostStats(): Promise<PostStats[]> {
    const result: PostStats[] = [];

    try {
      const posts = await this.discoverOwnPosts(10);
      for (const p of posts) {
        const clicked = await this.post<{ success?: boolean }>('/api/threads/click-post', { index: p.index });
        if (!clicked?.success) continue;
        await new Promise(r => setTimeout(r, 2000));

        const context = await this.get<ThreadsContext>('/api/threads/context');
        if (context) {
          const postId = p.url?.split('/').pop() || `threads_${p.index}`;
          result.push({
            platform: 'threads',
            post_id: postId,
            post_url: p.url,
            post_type: 'text',
            caption: context.mainPost || p.content,
            likes: parseInt(context.likeCount) || 0,
            comments: parseInt(context.replyCount) || 0,
            shares: 0,
            engagement_rate: 0,
            raw_data: { ...p, context },
          });
        }

        await this.post('/api/threads/back');
        await new Promise(r => setTimeout(r, 1500));
      }
    } catch {}

    return result;
  }

  async pollComments(): Promise<PlatformComment[]> {
    const result: PlatformComment[] = [];

    try {
      // Step 1: Navigate to profile and discover our posts
      const posts = await this.discoverOwnPosts(5);
      if (!posts.length) return result;

      // Step 2: For each post, click in and extract replies
      for (const post of posts.slice(0, 3)) {
        const postId = post.url?.split('/').pop() || `threads_${post.index}`;

        const clicked = await this.post<{ success?: boolean }>('/api/threads/click-post', { index: post.index });
        if (!clicked?.success) continue;
        await new Promise(r => setTimeout(r, 3000));

        // Get context which includes reply strings
        const context = await this.get<ThreadsContext>('/api/threads/context');
        const replyCount = parseInt(context?.replyCount || '0');
        if (replyCount === 0 && (!context?.replies || context.replies.length === 0)) {
          // No replies — skip, go back
          await this.post('/api/threads/back');
          await new Promise(r => setTimeout(r, 1500));
          continue;
        }

        // Parse replies from context
        if (context?.replies) {
          for (const reply of context.replies) {
            if (!reply || reply.length < 2) continue;
            // Threads context replies may include username as first word
            const firstSpace = reply.indexOf(' ');
            let username = 'unknown';
            let text = reply;
            if (firstSpace > 0 && firstSpace < 30) {
              const firstWord = reply.substring(0, firstSpace);
              if (firstWord.length >= 2 && firstWord.length <= 30 && !firstWord.includes(' ')) {
                username = firstWord.replace(/^@/, '').replace(/[:\-]+$/, ''); // strip trailing : or -
                text = reply.substring(firstSpace + 1).trim();
              }
            }
            // Strip leading date patterns (MM/DD/YY) and "Replying to @user"
            text = text.replace(/^\d{1,2}\/\d{1,2}\/\d{2,4}\s*/, '').trim();
            text = text.replace(/^Replying to @\S+\s*/i, '').trim();
            // Strip trailing page indicators like "2/2" or "1/3"
            text = text.replace(/\s*\d+\s*\/\s*\d+\s*$/, '').trim();
            // Filter: skip if text is just a username, too short, or mostly whitespace
            if (!text || text.length < 3) continue;
            if (text.replace(/[^a-zA-Z]/g, '').length < 3) continue; // must have some letters
            if (text.match(/^[a-z0-9_.]{2,30}$/i)) continue; // skip if text is just a handle
            result.push({
              platform: 'threads',
              post_id: postId,
              post_url: post.url,
              username,
              comment_text: text.substring(0, 2000),
              raw_data: { reply, context_username: context.username },
            });
          }
        }

        // Also try structured comments endpoint
        const commentsData = await this.get<{ comments?: any[] }>('/api/threads/comments?limit=20');
        if (commentsData?.comments) {
          for (const c of commentsData.comments) {
            if (!c.username || !c.text || c.text.length < 3) continue;
            // Same quality filters as context replies
            const cText = c.text.replace(/^\d{1,2}\/\d{1,2}\/\d{2,4}\s*/, '').replace(/^Replying to @\S+\s*/i, '').replace(/\s*\d+\s*\/\s*\d+\s*$/, '').trim();
            if (!cText || cText.length < 3) continue;
            if (cText.replace(/[^a-zA-Z]/g, '').length < 3) continue;
            if (cText.match(/^[a-z0-9_.]{2,30}$/i)) continue; // skip username-as-text
            // Deduplicate against context replies already added
            const alreadyHave = result.some(r =>
              r.post_id === postId &&
              r.username === c.username &&
              r.comment_text.substring(0, 40) === c.text.substring(0, 40)
            );
            if (alreadyHave) continue;
            result.push({
              platform: 'threads',
              post_id: postId,
              post_url: post.url,
              username: c.username,
              comment_text: c.text.substring(0, 2000),
              platform_timestamp: c.timestamp || undefined,
              raw_data: c,
            });
          }
        }

        // Go back to profile for next post
        await this.post('/api/threads/back');
        await new Promise(r => setTimeout(r, 1500));
      }
    } catch (e) {
      console.error(`[Poller:threads] pollComments error:`, (e as Error).message);
    }

    return result;
  }
}
