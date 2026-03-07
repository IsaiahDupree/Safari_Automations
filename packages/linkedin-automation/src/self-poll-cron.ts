/**
 * SelfPollCron for linkedin-automation (SDPA-008)
 * ================================================
 * Runs inside the linkedin-automation server process.
 * Fetches DM conversations and pending invitations,
 * then writes them to safari_platform_cache for cloud-sync pollers to read.
 *
 * Triggered two ways:
 *   1. Internal interval (every 5 min) — fires only 24/7
 *   2. External: POST /api/linkedin/self-poll  (cron-manager fires this)
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

// TTLs (ms) matching cache-writer.ts constants
const CACHE_TTLS: Record<string, number> = {
  dms:         1_800_000,  // 30 min
  invitations: 7_200_000,  // 2 hours
  post_stats: 21_600_000,  // 6 hours
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

async function fetchJson<T = any>(url: string, authToken: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${authToken}` },
      signal: AbortSignal.timeout(20_000),
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

  constructor(port = 3105, authToken = 'test-token-12345') {
    this.port = port;
    this.authToken = authToken;
  }

  async tick(): Promise<{ fetched: Record<string, number> }> {
    const db = getDb();
    if (!db) {
      console.warn('[SelfPoll:linkedin] Supabase not configured — skipping cache write');
      return { fetched: { dms: 0, invitations: 0 } };
    }

    const base = `http://localhost:${this.port}`;
    const fetched: Record<string, number> = { dms: 0, invitations: 0 };

    try {
      // Fetch DM conversations
      const convoData = await fetchJson<{ conversations?: any[] }>(
        `${base}/api/linkedin/conversations`,
        this.authToken,
      );
      if (convoData?.conversations && convoData.conversations.length > 0) {
        await writeCache(db, 'linkedin', 'dms', convoData.conversations);
        fetched.dms = convoData.conversations.length;
        console.log(`[SelfPoll:linkedin] Cached ${fetched.dms} DM conversations`);
      }
    } catch (e) {
      console.error('[SelfPoll:linkedin] DM fetch error:', (e as Error).message);
    }

    try {
      // Fetch pending invitations
      const invData = await fetchJson<{ invitations?: any[]; requests?: any[] }>(
        `${base}/api/linkedin/connections/pending`,
        this.authToken,
      );
      const invitations = invData?.invitations || invData?.requests || [];
      if (invitations.length > 0) {
        await writeCache(db, 'linkedin', 'invitations', invitations);
        fetched.invitations = invitations.length;
        console.log(`[SelfPoll:linkedin] Cached ${fetched.invitations} invitations`);
      }
    } catch (e) {
      console.error('[SelfPoll:linkedin] Invitations fetch error:', (e as Error).message);
    }

    return { fetched };
  }

  start(intervalMs = 300_000): void {
    if (this.intervalHandle) return;
    this.intervalHandle = setInterval(() => {
      this.tick().catch(e => console.error('[SelfPoll:linkedin] tick error:', e.message));
    }, intervalMs);
    console.log(`[SelfPoll:linkedin] Started — polling every ${intervalMs / 60_000} min (24/7)`);
    this.tick().catch(e => console.error('[SelfPoll:linkedin] initial tick error:', e.message));
  }

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }
}
