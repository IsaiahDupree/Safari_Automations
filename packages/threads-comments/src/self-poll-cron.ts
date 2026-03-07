/**
 * SelfPollCron for threads-comments (SDPA-009)
 * =============================================
 * Runs inside the threads-comments server process.
 * Fetches post stats and comments from the Threads profile,
 * then writes them to safari_platform_cache for cloud-sync pollers to consume.
 *
 * The server exposes POST /api/threads/self-poll which the cron-manager fires.
 * This class handles the interval-based internal polling.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

const CACHE_TTLS: Record<string, number> = {
  post_stats: 21_600_000,  // 6 hours
  comments:   21_600_000,  // 6 hours
};


async function writeCache(db: SupabaseClient, platform: string, dataType: string, payload: any[]): Promise<void> {
  const ttlMs = CACHE_TTLS[dataType] ?? 21_600_000;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
  await db.from('safari_platform_cache')
    .delete()
    .eq('platform', platform)
    .eq('data_type', dataType);
  await db.from('safari_platform_cache')
    .insert({
      platform,
      data_type: dataType,
      payload: payload as any,
      fetched_at: now.toISOString(),
      expires_at: expiresAt,
    });
}

function getDb(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

async function fetchJson<T = any>(url: string, authToken: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${authToken}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return null;
    return await res.json() as T;
  } catch {
    return null;
  }
}

async function postJson<T = any>(url: string, body: any, authToken: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return null;
    return await res.json() as T;
  } catch {
    return null;
  }
}

export class SelfPollCron {
  private intervalHandle: NodeJS.Timeout | null = null;
  private port: number;
  private authToken: string;

  constructor(port = 3004, authToken = 'threads-local-dev-token') {
    this.port = port;
    this.authToken = authToken;
  }

  async tick(): Promise<{ fetched: Record<string, number> }> {
    const db = getDb();
    if (!db) {
      console.warn('[SelfPoll:threads] Supabase not configured — skipping cache write');
      return { fetched: { post_stats: 0, comments: 0 } };
    }

    const base = `http://localhost:${this.port}`;
    const fetched: Record<string, number> = { post_stats: 0, comments: 0 };

    const PROFILE_URL = 'https://www.threads.net/@the_isaiah_dupree';

    try {
      // Navigate to profile
      await postJson(`${base}/api/threads/navigate`, { url: PROFILE_URL }, this.authToken);
      await new Promise(r => setTimeout(r, 4000));

      // Get post list
      const postsData = await fetchJson<{ posts?: any[] }>(`${base}/api/threads/posts?limit=5`, this.authToken);
      const posts = postsData?.posts || [];

      const postStats: any[] = [];
      const allComments: any[] = [];

      for (const post of posts.slice(0, 3)) {
        // Click into post
        const clicked = await postJson<{ success?: boolean }>(`${base}/api/threads/click-post`, { index: post.index }, this.authToken);
        if (!clicked?.success) continue;
        await new Promise(r => setTimeout(r, 2500));

        const context = await fetchJson<{ mainPost?: string; likeCount?: string; replyCount?: string; replies?: string[] }>(
          `${base}/api/threads/context`, this.authToken,
        );

        if (context) {
          const postId = post.url?.split('/').pop() || `threads_${post.index}`;
          postStats.push({
            platform: 'threads',
            post_id: postId,
            post_url: post.url,
            post_type: 'text',
            caption: context.mainPost || post.content || '',
            likes: parseInt(context.likeCount || '0') || 0,
            comments: parseInt(context.replyCount || '0') || 0,
            shares: 0,
          });

          // Extract comments from context replies
          for (const reply of (context.replies || [])) {
            if (!reply || reply.length < 3) continue;
            const firstSpace = reply.indexOf(' ');
            let username = 'unknown';
            let text = reply;
            if (firstSpace > 0 && firstSpace < 30) {
              const word = reply.substring(0, firstSpace);
              if (word.length >= 2) {
                username = word.replace(/^@/, '').replace(/[:\-]+$/, '');
                text = reply.substring(firstSpace + 1).trim();
              }
            }
            text = text.replace(/^\d{1,2}\/\d{1,2}\/\d{2,4}\s*/, '').replace(/^Replying to @\S+\s*/i, '').trim();
            if (!text || text.length < 3 || text.replace(/[^a-zA-Z]/g, '').length < 3) continue;
            allComments.push({ platform: 'threads', post_id: post.url?.split('/').pop(), username, comment_text: text.substring(0, 500) });
          }
        }

        // Go back
        await postJson(`${base}/api/threads/back`, {}, this.authToken);
        await new Promise(r => setTimeout(r, 1500));
      }

      if (postStats.length > 0) {
        await writeCache(db, 'threads', 'post_stats', postStats);
        fetched.post_stats = postStats.length;
        console.log(`[SelfPoll:threads] Cached ${fetched.post_stats} post stats`);
      }
      if (allComments.length > 0) {
        await writeCache(db, 'threads', 'comments', allComments);
        fetched.comments = allComments.length;
        console.log(`[SelfPoll:threads] Cached ${fetched.comments} comments`);
      }
    } catch (e) {
      console.error('[SelfPoll:threads] tick error:', (e as Error).message);
    }

    return { fetched };
  }

  start(intervalMs = 300_000): void {
    if (this.intervalHandle) return;
    this.intervalHandle = setInterval(() => {
      this.tick().catch(e => console.error('[SelfPoll:threads] tick error:', e.message));
    }, intervalMs);
    console.log(`[SelfPoll:threads] Started — polling every ${intervalMs / 60_000} min (24/7)`);
    this.tick().catch(e => console.error('[SelfPoll:threads] initial tick error:', e.message));
  }

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }
}
