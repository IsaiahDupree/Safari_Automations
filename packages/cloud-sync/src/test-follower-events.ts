/**
 * Test follower event extraction from Twitter notifications
 * Usage: npx tsx packages/cloud-sync/src/test-follower-events.ts
 */
import 'dotenv/config';
import { TwitterPoller } from './pollers/twitter-poller';
import { CloudSupabase } from './supabase';

async function test() {
  console.log('\n🧪 Testing follower event extraction...\n');

  const poller = new TwitterPoller();
  const healthy = await poller.isServiceHealthy();
  if (!healthy) {
    console.log('❌ Twitter comments service (3007) not healthy');
    return;
  }

  const followers = await poller.pollFollowers!();
  console.log(`📊 Extracted ${followers.length} follow events from Twitter notifications\n`);

  for (const f of followers) {
    console.log(`  👤 @${f.username} → ${f.profile_url}`);
  }

  if (followers.length > 0) {
    const db = new CloudSupabase();
    const synced = await db.syncFollowerEvents(followers);
    console.log(`\n✅ Synced ${synced} follower events to Supabase`);
  } else {
    console.log('\n📝 No follow events in current notification feed (this is normal — they appear when someone follows you)');
  }

  // Also show all notification types found
  console.log('\n--- Full notification scrape ---');
  const res = await fetch('http://localhost:3007/api/twitter/notifications', { signal: AbortSignal.timeout(30000) });
  const data = await res.json() as { notifications?: Array<{ type: string; actor: string; text: string }> };
  if (data.notifications) {
    const typeCounts: Record<string, number> = {};
    for (const n of data.notifications) {
      typeCounts[n.type] = (typeCounts[n.type] || 0) + 1;
    }
    console.log('Notification types:', typeCounts);
  }
}

test().catch(e => { console.error('FATAL:', e); process.exit(1); });
