/**
 * Quick test: TikTok post stats with view count fix
 * Usage: npx tsx packages/cloud-sync/src/test-tiktok-stats.ts
 */
import 'dotenv/config';
import { TikTokPoller } from './pollers/tiktok-poller';
import { getCloudSupabase } from './supabase';

async function test() {
  const poller = new TikTokPoller();
  const db = getCloudSupabase();

  console.log('\n🧪 Testing TikTok post stats extraction...\n');
  const stats = await poller.pollPostStats();
  console.log(`\n📊 Extracted ${stats.length} post stats:\n`);
  for (const s of stats) {
    console.log(`  ${s.post_id} | views=${s.views} likes=${s.likes} comments=${s.comments} shares=${s.shares}`);
    console.log(`    caption: "${(s.caption || '').substring(0, 80)}"`);
    console.log(`    raw card.viewsRaw: ${(s.raw_data as any)?.card?.viewsRaw}`);
  }

  const synced = await db.syncPostStats(stats);
  console.log(`\n✅ Synced ${synced} stats to Supabase\n`);
}

test().catch(e => { console.error('ERROR:', e); process.exit(1); });
