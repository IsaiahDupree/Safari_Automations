#!/usr/bin/env npx tsx
/**
 * Unified Comments CLI
 */

import { UnifiedCommentsClient } from './client.js';
import { type CommentPlatform } from './types.js';

const client = new UnifiedCommentsClient();

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'health':
      await checkHealth();
      break;
    case 'status':
      await showStatus(args[1] as CommentPlatform | undefined);
      break;
    case 'comments':
      await listComments(args[1] as CommentPlatform, parseInt(args[2]) || 20);
      break;
    case 'post':
      await postComment(args[1] as CommentPlatform, args[2], args[3]);
      break;
    case 'navigate':
      await navigate(args[1] as CommentPlatform, args[2]);
      break;
    default:
      showHelp();
  }
}

async function checkHealth(): Promise<void> {
  console.log('\n🔍 Checking Comment API Health...\n');
  const health = await client.checkHealth();
  
  for (const [platform, isHealthy] of Object.entries(health)) {
    const icon = isHealthy ? '✅' : '❌';
    console.log(`  ${icon} ${platform.padEnd(12)} ${isHealthy ? 'Online' : 'Offline'}`);
  }
  console.log();
}

async function showStatus(platform?: CommentPlatform): Promise<void> {
  console.log('\n📊 Comment Platform Status\n');
  
  if (platform) {
    const status = await client.getStatus(platform);
    if (status) {
      console.log(`  Platform: ${platform}`);
      console.log(`  Logged In: ${status.isLoggedIn ? 'Yes' : 'No'}`);
      console.log(`  Comments This Hour: ${status.commentsThisHour}`);
      console.log(`  Comments Today: ${status.commentsToday}`);
    } else {
      console.log(`  ${platform}: Offline or unavailable`);
    }
  } else {
    const allStatus = await client.getAllStatus();
    for (const [p, status] of Object.entries(allStatus)) {
      if (status) {
        console.log(`  ${p}: ${status.isLoggedIn ? '✅ Logged in' : '❌ Not logged in'} | ${status.commentsThisHour}/hr | ${status.commentsToday}/day`);
      } else {
        console.log(`  ${p}: ❌ Offline`);
      }
    }
  }
  console.log();
}

async function listComments(platform: CommentPlatform, limit: number): Promise<void> {
  if (!platform) {
    console.log('Usage: comments <platform> [limit]');
    return;
  }
  
  console.log(`\n💬 Comments on ${platform}\n`);
  const comments = await client.getComments(platform, limit);
  
  if (comments.length === 0) {
    console.log('  No comments found (or not on a post page)');
  } else {
    for (const comment of comments.slice(0, limit)) {
      console.log(`  @${comment.username}: ${comment.text.substring(0, 80)}${comment.text.length > 80 ? '...' : ''}`);
    }
  }
  console.log();
}

async function postComment(platform: CommentPlatform, text: string, postUrl?: string): Promise<void> {
  if (!platform || !text) {
    console.log('Usage: post <platform> "<text>" [postUrl]');
    return;
  }
  
  console.log(`\n📝 Posting to ${platform}...`);
  const result = await client.postComment(platform, text, postUrl);
  
  if (result.success) {
    console.log(`  ✅ Posted! ID: ${result.commentId}`);
  } else {
    console.log(`  ❌ Failed: ${result.error}`);
  }
  console.log();
}

async function navigate(platform: CommentPlatform, url: string): Promise<void> {
  if (!platform || !url) {
    console.log('Usage: navigate <platform> <url>');
    return;
  }
  
  console.log(`\n🔗 Navigating ${platform} to ${url}...`);
  const success = await client.navigateToPost(platform, url);
  console.log(success ? '  ✅ Navigated successfully' : '  ❌ Navigation failed');
  console.log();
}

function showHelp(): void {
  console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║  UNIFIED COMMENTS CLI                                                 ║
╚══════════════════════════════════════════════════════════════════════╝

Usage:
  npx tsx src/cli.ts health                     Check all APIs
  npx tsx src/cli.ts status [platform]          Show status
  npx tsx src/cli.ts comments <platform> [n]    List comments
  npx tsx src/cli.ts post <platform> "text"     Post a comment
  npx tsx src/cli.ts navigate <platform> <url>  Navigate to post

Platforms: threads, instagram, tiktok, twitter

Examples:
  npx tsx src/cli.ts health
  npx tsx src/cli.ts status threads
  npx tsx src/cli.ts post threads "Great post!"
  npx tsx src/cli.ts post instagram "Love this!" https://instagram.com/p/xyz
`);
}

main().catch(console.error);
