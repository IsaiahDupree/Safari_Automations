#!/usr/bin/env npx tsx
/**
 * Unified DM CLI
 * 
 * Single interface for managing DMs across all platforms
 * 
 * Commands:
 *   status              Check status of all DM platforms
 *   list [platform]     List conversations (all or specific platform)
 *   send <platform> <username> <message>  Send a DM
 *   health              Check health of all DM APIs
 */

import { UnifiedDMClient } from './client.js';
import type { Platform } from './types.js';

const client = new UnifiedDMClient();
const args = process.argv.slice(2);
const command = args[0];

function printHelp(): void {
  console.log(`
💬 Unified DM CLI

USAGE:
  npx tsx src/cli.ts <command> [options]

COMMANDS:
  status              Check status of all DM platforms
  health              Check health of all DM APIs  
  list [platform]     List conversations (all or tiktok/instagram/twitter)
  send <platform> <username> <message>  Send a DM

EXAMPLES:
  npx tsx src/cli.ts status
  npx tsx src/cli.ts health
  npx tsx src/cli.ts list
  npx tsx src/cli.ts list tiktok
  npx tsx src/cli.ts send tiktok @username "Hello!"
  `);
}

async function showHealth(): Promise<void> {
  console.log('\n🏥 DM API HEALTH CHECK\n');
  
  const health = await client.checkHealth();
  
  for (const [platform, isHealthy] of Object.entries(health)) {
    const icon = isHealthy ? '✅' : '❌';
    const port = platform === 'tiktok' ? 3002 : platform === 'instagram' ? 3001 : 3003;
    console.log(`   ${icon} ${platform.padEnd(12)} (port ${port})`);
  }
  console.log('');
}

async function showStatus(): Promise<void> {
  console.log('\n📊 DM PLATFORM STATUS\n');
  
  const statuses = await client.getAllPlatformStatus();
  
  for (const status of statuses) {
    const icon = status.isOnline ? (status.isLoggedIn ? '✅' : '⚠️') : '❌';
    console.log(`${icon} ${status.platform.toUpperCase()}`);
    console.log(`   Online: ${status.isOnline ? 'Yes' : 'No'}`);
    console.log(`   Logged In: ${status.isLoggedIn ? 'Yes' : 'No'}`);
    console.log(`   Messages Today: ${status.messagesToday}`);
    console.log(`   Messages This Hour: ${status.messagesThisHour}`);
    if (status.error) {
      console.log(`   Error: ${status.error}`);
    }
    console.log('');
  }
}

async function listConversations(): Promise<void> {
  const platform = args[1] as Platform | undefined;
  
  console.log('\n💬 CONVERSATIONS\n');
  
  let conversations;
  if (platform && ['tiktok', 'instagram', 'twitter'].includes(platform)) {
    conversations = await client.listConversations(platform);
  } else {
    conversations = await client.listAllConversations();
  }
  
  if (conversations.length === 0) {
    console.log('   No conversations found\n');
    return;
  }
  
  // Group by platform
  const grouped = conversations.reduce((acc, conv) => {
    if (!acc[conv.platform]) acc[conv.platform] = [];
    acc[conv.platform].push(conv);
    return acc;
  }, {} as Record<string, typeof conversations>);
  
  for (const [plat, convs] of Object.entries(grouped)) {
    console.log(`📱 ${plat.toUpperCase()} (${convs.length})`);
    for (const conv of convs.slice(0, 10)) {
      const unread = conv.unread ? '🔴' : '  ';
      console.log(`   ${unread} @${conv.username} - ${conv.lastMessage?.slice(0, 40) || '(no messages)'}...`);
    }
    if (convs.length > 10) {
      console.log(`   ... and ${convs.length - 10} more`);
    }
    console.log('');
  }
}

async function sendMessage(): Promise<void> {
  const platform = args[1] as Platform;
  const username = args[2]?.replace('@', '');
  const message = args.slice(3).join(' ');
  
  if (!platform || !['tiktok', 'instagram', 'twitter'].includes(platform)) {
    console.error('❌ Please specify a valid platform: tiktok, instagram, twitter');
    return;
  }
  
  if (!username) {
    console.error('❌ Please specify a username');
    return;
  }
  
  if (!message) {
    console.error('❌ Please specify a message');
    return;
  }
  
  console.log(`\n📤 Sending DM to @${username} on ${platform}...\n`);
  
  const result = await client.sendDM(platform, username, message);
  
  if (result.success) {
    console.log(`✅ Message sent successfully!`);
    if (result.messageId) {
      console.log(`   Message ID: ${result.messageId}`);
    }
  } else {
    console.log(`❌ Failed to send message`);
    if (result.error) {
      console.log(`   Error: ${result.error}`);
    }
  }
  console.log('');
}

async function main(): Promise<void> {
  switch (command) {
    case 'health':
      await showHealth();
      break;
    case 'status':
      await showStatus();
      break;
    case 'list':
      await listConversations();
      break;
    case 'send':
      await sendMessage();
      break;
    case 'help':
    case '--help':
    case '-h':
    default:
      printHelp();
  }
}

main().catch(console.error);
