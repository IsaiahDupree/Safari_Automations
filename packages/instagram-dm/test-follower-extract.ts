/**
 * Test follower extraction for Instagram
 * Usage: npx tsx test-follower-extract.ts <handle> [limit]
 */

import { extractFollowers } from './src/automation/follower-operations.js';

const handle = process.argv[2] || 'instagram'; // Default: official Instagram account
const limit = parseInt(process.argv[3] || '20', 10);

console.log(`\n🔍 Extracting followers from @${handle} (limit: ${limit})...\n`);

extractFollowers(handle, limit)
  .then(result => {
    if (result.success) {
      console.log(`✅ Success! Extracted ${result.count} followers:\n`);

      result.followers.forEach((follower, index) => {
        console.log(`${index + 1}. @${follower.handle}`);
        console.log(`   Name: ${follower.displayName}`);
        if (follower.isVerified) console.log(`   ✓ Verified`);
        if (follower.bio) console.log(`   Bio: ${follower.bio.substring(0, 60)}...`);
        if (follower.followerCount) console.log(`   Followers: ${follower.followerCount}`);
        console.log('');
      });
    } else {
      console.log(`❌ Failed: ${result.error}`);
    }
  })
  .catch(error => {
    console.error('Test error:', error);
    process.exit(1);
  });
