/**
 * SelfPollCron for twitter-dm (SDPA-012)
 * ========================================
 * Runs inside the twitter-dm server process.
 * Fetches Twitter DM conversations and unread notifications,
 * then writes them to safari_platform_cache for cloud-sync pollers to consume.
 *
 * The server exposes POST /api/twitter/self-poll which the cron-manager fires.
 * This class handles the interval-based internal polling.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

const CACHE_TTLS: Record<string, number> = {
  dms:           1_800_000,  // 30 min
  notifications: 1_800_000,  // 30 min
};


async function writeCache(db: SupabaseClient, platform: string, dataType: string, payload: any[]): Promise<void> {
  const ttlMs = CACHE_TTLS[dataType] ?? 1_800_000;
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
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    return await res.json() as T;
  } catch {
    return null;
  }
}

export class SelfPollCron {
  private intervalHandle: NodeJS.Timeout | null = null;
  private port: number;

  constructor(port = 3003) {
    this.port = port;
  }

  async tick(force = false): Promise<{ fetched: Record<string, number> }> {
    const db = getDb();
    if (!db) {
      console.warn('[SelfPoll:twitter] Supabase not configured — skipping cache write');
      return { fetched: { dms: 0, notifications: 0 } };
    }

    const base = `http://localhost:${this.port}`;
    const fetched: Record<string, number> = { dms: 0, notifications: 0 };

    try {
      // Fetch DM conversations
      const convoData = await fetchJson<{ conversations?: any[] }>(`${base}/api/twitter/conversations`);
      const conversations = convoData?.conversations || [];
      if (conversations.length > 0) {
        await writeCache(db, 'twitter', 'dms', conversations);
        fetched.dms = conversations.length;
        console.log(`[SelfPoll:twitter] Cached ${fetched.dms} DM conversations`);
      }

      // Derive notifications from unread conversations
      const notifications = conversations
        .filter((c: any) => c.unread || c.isUnread || c.hasUnread)
        .map((c: any) => ({
          platform: 'twitter',
          notification_type: 'dm',
          actor_username: c.username || c.handle,
          actor_display_name: c.name || c.displayName,
          content: c.snippet || c.lastMessage || c.preview,
          raw_data: c,
        }));

      if (notifications.length > 0) {
        await writeCache(db, 'twitter', 'notifications', notifications);
        fetched.notifications = notifications.length;
        console.log(`[SelfPoll:twitter] Cached ${fetched.notifications} notifications`);
      }
    } catch (e) {
      console.error('[SelfPoll:twitter] tick error:', (e as Error).message);
    }

    return { fetched };
  }

  start(intervalMs = 300_000): void {
    if (this.intervalHandle) return;
    this.intervalHandle = setInterval(() => {
      this.tick().catch(e => console.error('[SelfPoll:twitter] tick error:', e.message));
    }, intervalMs);
    console.log(`[SelfPoll:twitter] Started — polling every ${intervalMs / 60_000} min (24/7)`);
    this.tick().catch(e => console.error('[SelfPoll:twitter] initial tick error:', e.message));
  }

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }
}
