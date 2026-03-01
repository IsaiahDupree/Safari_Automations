/**
 * Quick E2E test for comment polling + Supabase sync
 * Usage: npx tsx packages/cloud-sync/src/test-comments.ts [platform]
 * 
 * Tests the full pipeline: poller.pollComments() → supabase.syncComments()
 */
import 'dotenv/config';
import { TikTokPoller } from './pollers/tiktok-poller';
import { TwitterPoller } from './pollers/twitter-poller';
import { InstagramPoller } from './pollers/instagram-poller';
import { ThreadsPoller } from './pollers/threads-poller';
import { getCloudSupabase } from './supabase';

const platform = process.argv[2] || 'twitter';

async function testCommentPolling() {
  console.log(`\n🧪 Testing comment polling for: ${platform}\n`);

  // Pick poller
  const pollers: Record<string, any> = {
    tiktok: new TikTokPoller(),
    twitter: new TwitterPoller(),
    instagram: new InstagramPoller(),
    threads: new ThreadsPoller(),
  };

  const poller = pollers[platform];
  if (!poller) {
    console.error(`Unknown platform: ${platform}. Use: tiktok, twitter, instagram, threads`);
    process.exit(1);
  }

  // Check service health
  const healthy = await poller.isServiceHealthy();
  console.log(`Service health: ${healthy ? '✅ healthy' : '❌ offline'}`);
  if (!healthy) {
    console.error('Service is offline — cannot test comment polling');
    process.exit(1);
  }

  // Poll comments
  console.log(`\nPolling comments...`);
  const start = Date.now();
  const comments = await poller.pollComments();
  const duration = Date.now() - start;
  
  console.log(`\n📊 Results (${duration}ms):`);
  console.log(`   Total comments: ${comments.length}`);
  
  if (comments.length === 0) {
    console.log(`   ⚠️  No comments extracted — this could be normal (no posts found, or no comments on posts)`);
    console.log(`   This is NOT a false positive — empty arrays are safely filtered out before Supabase sync`);
    return;
  }

  // Show first 3 comments
  for (const c of comments.slice(0, 3)) {
    console.log(`\n   📝 @${c.username} on post ${c.post_id}:`);
    console.log(`      "${c.comment_text.substring(0, 100)}${c.comment_text.length > 100 ? '...' : ''}"`);
    console.log(`      post_url: ${c.post_url}`);
  }

  // Test dedup key generation
  console.log(`\n🔑 Dedup key samples:`);
  for (const c of comments.slice(0, 2)) {
    const key = [c.platform, c.post_id, c.username, c.comment_text.substring(0, 80)].join(':');
    console.log(`   ${key.substring(0, 120)}...`);
  }

  // Sync to Supabase
  console.log(`\n💾 Syncing ${comments.length} comments to Supabase...`);
  const db = getCloudSupabase();
  const synced = await db.syncComments(comments);
  console.log(`   Synced: ${synced} new rows (duplicates ignored via dedup_key)`);

  // Verify no duplicates: sync again
  console.log(`\n🔄 Re-syncing same comments (should be 0 new)...`);
  const synced2 = await db.syncComments(comments);
  console.log(`   Synced: ${synced2} new rows ${synced2 === 0 ? '✅ dedup working!' : '⚠️ unexpected duplicates'}`);

  // Query back
  const stored = await db.getComments(platform as any, undefined, 5);
  console.log(`\n📖 Stored in Supabase (last 5):`);
  for (const row of stored) {
    console.log(`   [${row.id?.substring(0, 8)}] @${row.username}: "${(row.comment_text || '').substring(0, 60)}..."`);
  }

  console.log(`\n✅ Test complete for ${platform}`);
}

testCommentPolling().catch(e => {
  console.error('Test failed:', e);
  process.exit(1);
});
