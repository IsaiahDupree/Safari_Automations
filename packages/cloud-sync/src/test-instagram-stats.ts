/**
 * Quick test: Instagram post stats extraction
 * Usage: npx tsx packages/cloud-sync/src/test-instagram-stats.ts
 */
import 'dotenv/config';
import { InstagramPoller } from './pollers/instagram-poller';
import { getCloudSupabase } from './supabase';

async function test() {
  const poller = new InstagramPoller();
  const db = getCloudSupabase();

  console.log('\n🧪 Testing Instagram post stats extraction...\n');
  const stats = await poller.pollPostStats();
  console.log(`\n📊 Extracted ${stats.length} post stats:\n`);
  for (const s of stats) {
    console.log(`  ${s.post_id} (${s.post_type}) | views=${s.views} likes=${s.likes} comments=${s.comments}`);
    console.log(`    caption: "${(s.caption || '').substring(0, 80)}"`);
    console.log(`    url: ${s.post_url}`);
  }

  if (stats.length) {
    const synced = await db.syncPostStats(stats);
    console.log(`\n✅ Synced ${synced} stats to Supabase\n`);
  } else {
    console.log('\n⚠️ No stats extracted\n');
  }
}

test().catch(e => { console.error('ERROR:', e); process.exit(1); });
