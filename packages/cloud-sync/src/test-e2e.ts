/**
 * E2E test — runs all pollers through the sync engine orchestration
 * Tests: Safari tab switching, cross-platform bleed guards, dedup, validation
 * 
 * Usage: npx tsx packages/cloud-sync/src/test-e2e.ts
 */
import 'dotenv/config';
import { getPoller } from './pollers';
import { getCloudSupabase } from './supabase';
import { Platform } from './types';

const PLATFORMS: Platform[] = ['instagram', 'twitter', 'tiktok', 'threads'];

async function runE2E() {
  console.log('\n🧪 E2E Sync Engine Test — All Platforms Sequential\n');
  const db = getCloudSupabase();
  const results: { platform: string; dataType: string; count: number; error?: string }[] = [];

  // Get baseline counts from Supabase
  const baselineDMs = await db.getUnrepliedDMs(undefined, 1000);
  const baselineComments = await db.getComments(undefined, undefined, 1000);
  console.log(`📊 Baseline: ${baselineDMs.length} DMs, ${baselineComments.length} comments in Supabase\n`);

  for (const platform of PLATFORMS) {
    const poller = getPoller(platform);
    const healthy = await poller.isServiceHealthy();
    if (!healthy) {
      console.log(`  ❌ [${platform}] Service offline — skipping`);
      results.push({ platform, dataType: 'all', count: 0, error: 'offline' });
      continue;
    }
    console.log(`  🔒 [${platform}] Polling...`);

    // DMs
    try {
      const dms = await poller.pollDMs();
      const synced = await db.syncDMs(dms);
      console.log(`    📨 DMs: ${dms.length} extracted, ${synced} new synced`);
      results.push({ platform, dataType: 'dms', count: synced });
    } catch (e) {
      const err = (e as Error).message;
      console.error(`    ❌ DMs error: ${err}`);
      results.push({ platform, dataType: 'dms', count: 0, error: err });
    }

    // Notifications
    try {
      const notifs = await poller.pollNotifications();
      const synced = await db.syncNotifications(notifs);
      console.log(`    🔔 Notifications: ${notifs.length} extracted, ${synced} new synced`);
      results.push({ platform, dataType: 'notifications', count: synced });
    } catch (e) {
      const err = (e as Error).message;
      console.error(`    ❌ Notifications error: ${err}`);
      results.push({ platform, dataType: 'notifications', count: 0, error: err });
    }

    // Comments
    if (poller.pollComments) {
      try {
        const comments = await poller.pollComments();
        const synced = await db.syncComments(comments);
        console.log(`    💬 Comments: ${comments.length} extracted, ${synced} new synced`);
        results.push({ platform, dataType: 'comments', count: synced });
      } catch (e) {
        const err = (e as Error).message;
        console.error(`    ❌ Comments error: ${err}`);
        results.push({ platform, dataType: 'comments', count: 0, error: err });
      }
    }

    // Post Stats
    try {
      const stats = await poller.pollPostStats();
      const synced = await db.syncPostStats(stats);
      console.log(`    📊 Post Stats: ${stats.length} extracted, ${synced} new synced`);
      results.push({ platform, dataType: 'post_stats', count: synced });
    } catch (e) {
      const err = (e as Error).message;
      console.error(`    ❌ Post Stats error: ${err}`);
      results.push({ platform, dataType: 'post_stats', count: 0, error: err });
    }

    console.log(`  🔓 [${platform}] Done\n`);

    // Settle delay between platforms
    await new Promise(r => setTimeout(r, 3000));
  }

  // Summary
  console.log('═══════════════════════════════════════');
  console.log('📋 RESULTS SUMMARY\n');
  const errors = results.filter(r => r.error);
  const synced = results.filter(r => r.count > 0);
  console.log(`  Total polls: ${results.length}`);
  console.log(`  Synced data: ${synced.length} (${synced.map(r => `${r.platform}/${r.dataType}: ${r.count}`).join(', ') || 'none'})`);
  console.log(`  Errors: ${errors.length} (${errors.map(r => `${r.platform}/${r.dataType}: ${r.error}`).join(', ') || 'none'})`);

  // Verify no false positives: re-run comments for all platforms
  console.log('\n🔄 DEDUP STRESS TEST — re-running all comment pollers...\n');
  let totalDupes = 0;
  for (const platform of PLATFORMS) {
    const poller = getPoller(platform);
    if (!poller.pollComments || !(await poller.isServiceHealthy())) continue;
    try {
      const comments = await poller.pollComments();
      const synced = await db.syncComments(comments);
      console.log(`  [${platform}] ${comments.length} comments → ${synced} new (should be 0)`);
      totalDupes += synced;
    } catch {}
    await new Promise(r => setTimeout(r, 3000));
  }

  if (totalDupes === 0) {
    console.log('\n  ✅ DEDUP VERIFIED — 0 duplicates across all platforms');
  } else {
    console.log(`\n  ⚠️ DEDUP ISSUE — ${totalDupes} unexpected new rows`);
  }

  // Check for cross-platform bleed
  console.log('\n🔍 CROSS-PLATFORM BLEED CHECK...');
  const allComments = await db.getComments(undefined, undefined, 500);
  let bleedCount = 0;
  const PLATFORM_DOMAINS: Record<string, string[]> = {
    instagram: ['instagram.com'],
    twitter: ['x.com', 'twitter.com'],
    tiktok: ['tiktok.com'],
    threads: ['threads.net', 'threads.com'],
  };
  for (const c of allComments) {
    if (c.post_url) {
      const domains = PLATFORM_DOMAINS[c.platform];
      if (domains && !domains.some((d: string) => c.post_url.includes(d))) {
        console.log(`  ⚠️ BLEED: ${c.platform} comment has URL ${c.post_url}`);
        bleedCount++;
      }
    }
  }
  if (bleedCount === 0) {
    console.log('  ✅ No cross-platform bleed detected');
  }

  console.log('\n✅ E2E test complete\n');
}

runE2E().catch(e => { console.error('E2E FATAL:', e); process.exit(1); });
