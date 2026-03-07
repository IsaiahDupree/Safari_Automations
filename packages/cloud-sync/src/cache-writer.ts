/**
 * Cache Writer (SDPA-007)
 * =======================
 * Writes data to safari_platform_cache. Used by both self-poll crons and
 * cloud-sync pollers (write-through on cache miss during quiet hours).
 */
import { getCloudSupabase } from './supabase';

// TTLs per data type (milliseconds)
export const CACHE_TTLS: Record<string, number> = {
  dms:           1_800_000,   // 30 minutes
  notifications: 1_800_000,   // 30 minutes
  post_stats:   21_600_000,   // 6 hours
  invitations:   7_200_000,   // 2 hours
  comments:     21_600_000,   // 6 hours
  followers:    21_600_000,   // 6 hours
};

/**
 * Upserts payload to safari_platform_cache for a given platform+dataType.
 * Deletes old rows for the same platform+dataType, then inserts a fresh row.
 */
export async function writePlatformCache(
  platform: string,
  dataType: string,
  payload: any[],
  ttlMs?: number
): Promise<void> {
  const db = getCloudSupabase();
  const effectiveTtl = ttlMs ?? CACHE_TTLS[dataType] ?? 1_800_000;
  await db.writePlatformCache(platform, dataType, payload, effectiveTtl);
}
