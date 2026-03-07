/**
 * SelfPollCron for tiktok-comments (SDPA-010)
 * ============================================
 * Runs inside the tiktok-comments server process.
 * (default 1am-7am), fetches TikTok video stats and comments,
 * then writes them to safari_platform_cache for cloud-sync pollers to consume.
 *
 * The server exposes POST /api/tiktok/self-poll which the cron-manager fires.
 * This class handles the interval-based internal polling.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

const CACHE_TTLS: Record<string, number> = {
  post_stats: 21_600_000,  // 6 hours
  comments:   21_600_000,  // 6 hours
};

const OWN_HANDLE = 'isaiah_dupree';


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

async function fetchJson<T = any>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return null;
    return await res.json() as T;
  } catch {
    return null;
  }
}

async function postJson<T = any>(url: string, body: any): Promise<T | null> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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

  constructor(port = 3006) {
    this.port = port;
  }

  async tick(): Promise<{ fetched: Record<string, number> }> {
    const db = getDb();
    if (!db) {
      console.warn('[SelfPoll:tiktok] Supabase not configured — skipping cache write');
      return { fetched: { post_stats: 0, comments: 0 } };
    }

    const base = `http://localhost:${this.port}`;
    const fetched: Record<string, number> = { post_stats: 0, comments: 0 };

    try {
      // Fetch own profile videos
      const profileData = await fetchJson<{ videos?: any[] }>(
        `${base}/api/tiktok/profile/${OWN_HANDLE}/videos?max=10`,
      );
      const videos = profileData?.videos || [];
      if (!videos.length) return { fetched };

      const postStats: any[] = [];
      const allComments: any[] = [];

      for (const video of videos.slice(0, 5)) {
        const videoId = video.id;
        const videoUrl = video.url;
        if (!videoId || !videoUrl) continue;

        // Navigate to video
        await postJson(`${base}/api/tiktok/navigate`, { url: videoUrl });
        await new Promise(r => setTimeout(r, 3000));

        // Get metrics
        const metrics = await fetchJson<any>(`${base}/api/tiktok/video-metrics`);

        const views = metrics?.views || metrics?.playCount || 0;
        const likes = metrics?.likes || metrics?.diggCount || 0;
        postStats.push({
          platform: 'tiktok',
          post_id: videoId,
          post_url: videoUrl,
          post_type: 'video',
          caption: video.description || video.text || '',
          views: (views > 0 && views === likes) ? 0 : views,
          likes,
          comments: metrics?.comments || metrics?.commentCount || 0,
          shares: metrics?.shares || metrics?.shareCount || 0,
          raw_data: { video, metrics },
        });

        // Get comments
        const commentsData = await fetchJson<{ comments?: any[] }>(`${base}/api/tiktok/comments?limit=20`);
        for (const c of (commentsData?.comments || [])) {
          if (!c.username || !c.text || c.text.length < 2) continue;
          allComments.push({
            platform: 'tiktok',
            post_id: videoId,
            post_url: videoUrl,
            username: c.username,
            comment_text: c.text.substring(0, 500),
          });
        }
        fetched.comments += (commentsData?.comments?.length || 0);
      }

      if (postStats.length > 0) {
        await writeCache(db, 'tiktok', 'post_stats', postStats);
        fetched.post_stats = postStats.length;
        console.log(`[SelfPoll:tiktok] Cached ${fetched.post_stats} post stats`);
      }
      if (allComments.length > 0) {
        await writeCache(db, 'tiktok', 'comments', allComments);
        fetched.comments = allComments.length;
        console.log(`[SelfPoll:tiktok] Cached ${fetched.comments} comments`);
      }
    } catch (e) {
      console.error('[SelfPoll:tiktok] tick error:', (e as Error).message);
    }

    return { fetched };
  }

  start(intervalMs = 300_000): void {
    if (this.intervalHandle) return;
    this.intervalHandle = setInterval(() => {
      this.tick().catch(e => console.error('[SelfPoll:tiktok] tick error:', e.message));
    }, intervalMs);
    console.log(`[SelfPoll:tiktok] Started — polling every ${intervalMs / 60_000} min (24/7)`);
    this.tick().catch(e => console.error('[SelfPoll:tiktok] initial tick error:', e.message));
  }

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }
}
