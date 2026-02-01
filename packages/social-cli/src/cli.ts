#!/usr/bin/env node
/**
 * Unified Social Automation CLI
 * 
 * Single command-line interface for all social platform DM operations.
 * 
 * Usage:
 *   social-auto status                    - Check all platform statuses
 *   social-auto dm <platform> <user> <msg> - Send DM
 *   social-auto conversations             - List all conversations
 *   social-auto rate-limits               - Show rate limits
 */

import { Command } from 'commander';
import { 
  SocialAutomationClient, 
  createUnifiedClient,
  type Platform 
} from '@safari-automation/unified-client';

const program = new Command();

// Default API URL
const API_URL = process.env.SAFARI_API_URL || 'http://localhost:3100';

// Create client
let client: SocialAutomationClient;

function getClient(): SocialAutomationClient {
  if (!client) {
    client = createUnifiedClient(API_URL);
  }
  return client;
}

// Formatting helpers
function formatPlatform(platform: string): string {
  const icons: Record<string, string> = {
    instagram: '📸',
    twitter: '🐦',
    tiktok: '🎵',
  };
  return `${icons[platform] || '•'} ${platform.charAt(0).toUpperCase() + platform.slice(1)}`;
}

function formatStatus(isLoggedIn: boolean | undefined): string {
  return isLoggedIn ? '✅ Online' : '❌ Offline';
}

function formatRateLimit(sent: number, max: number): string {
  const pct = Math.round((sent / max) * 100);
  const bar = '█'.repeat(Math.floor(pct / 10)) + '░'.repeat(10 - Math.floor(pct / 10));
  return `${bar} ${sent}/${max} (${pct}%)`;
}

// Commands
program
  .name('social-auto')
  .description('Unified social automation CLI for Instagram, Twitter, and TikTok DM management')
  .version('1.0.0');

// Status command
program
  .command('status')
  .description('Check status of all platforms')
  .option('-p, --platform <platform>', 'Specific platform (instagram, twitter, tiktok)')
  .action(async (options) => {
    try {
      const c = getClient();
      
      console.log('\n📊 Social Automation Status\n');
      console.log(`   API: ${API_URL}\n`);
      
      const health = await c.healthCheck();
      const status = await c.getAllStatus();
      
      // Instagram
      if (!options.platform || options.platform === 'instagram') {
        console.log(`${formatPlatform('instagram')}`);
        console.log(`   API: ${health.instagram ? '✅ Healthy' : '❌ Unreachable'}`);
        if (status.instagram) {
          console.log(`   Status: ${formatStatus(status.instagram.isLoggedIn)}`);
          console.log(`   URL: ${status.instagram.currentUrl || 'N/A'}`);
        }
        console.log();
      }
      
      // Twitter
      if (!options.platform || options.platform === 'twitter') {
        console.log(`${formatPlatform('twitter')}`);
        console.log(`   API: ${health.twitter ? '✅ Healthy' : '❌ Unreachable'}`);
        if (status.twitter) {
          console.log(`   Status: ${formatStatus(status.twitter.isLoggedIn)}`);
          console.log(`   URL: ${status.twitter.currentUrl || 'N/A'}`);
        }
        console.log();
      }
      
      // TikTok
      if (!options.platform || options.platform === 'tiktok') {
        console.log(`${formatPlatform('tiktok')}`);
        console.log(`   API: ${health.tiktok ? '✅ Healthy' : '❌ Unreachable'}`);
        if (status.tiktok) {
          console.log(`   Status: ${formatStatus(status.tiktok.isLoggedIn)}`);
          console.log(`   URL: ${status.tiktok.currentUrl || 'N/A'}`);
        }
        console.log();
      }
    } catch (error) {
      console.error('❌ Error:', error);
      process.exit(1);
    }
  });

// DM command
program
  .command('dm <platform> <username> <message>')
  .description('Send a DM to a user')
  .option('--dry-run', 'Show what would be sent without actually sending')
  .action(async (platform: string, username: string, message: string, options) => {
    try {
      const p = platform.toLowerCase() as Platform;
      if (p !== 'instagram' && p !== 'twitter' && p !== 'tiktok') {
        console.error('❌ Invalid platform. Use: instagram, twitter, tiktok');
        process.exit(1);
      }
      
      const c = getClient();
      
      console.log(`\n${formatPlatform(p)} Sending DM\n`);
      console.log(`   To: @${username}`);
      console.log(`   Message: "${message.substring(0, 50)}${message.length > 50 ? '...' : ''}"`);
      
      if (options.dryRun) {
        console.log('\n   🔸 Dry run - message not sent\n');
        return;
      }
      
      console.log('   Sending...');
      
      const result = await c.sendDM(p, username, message);
      
      if (result.success) {
        console.log('   ✅ Message sent!\n');
      } else {
        console.log(`   ❌ Failed: ${result.error}\n`);
        process.exit(1);
      }
    } catch (error) {
      console.error('❌ Error:', error);
      process.exit(1);
    }
  });

// Conversations command
program
  .command('conversations')
  .alias('convos')
  .description('List conversations from all platforms')
  .option('-p, --platform <platform>', 'Specific platform')
  .option('-l, --limit <number>', 'Limit results', '10')
  .action(async (options) => {
    try {
      const c = getClient();
      
      console.log('\n💬 Conversations\n');
      
      const conversations = await c.getAllConversations();
      
      if (conversations.length === 0) {
        console.log('   No conversations found\n');
        return;
      }
      
      const limit = parseInt(options.limit) || 10;
      const filtered = options.platform 
        ? conversations.filter((conv) => conv.platform === options.platform)
        : conversations;
      
      for (const convo of filtered.slice(0, limit)) {
        const icon = convo.platform === 'instagram' ? '📸' : convo.platform === 'twitter' ? '🐦' : '🎵';
        const unread = convo.unreadCount ? ` (${convo.unreadCount} unread)` : '';
        console.log(`   ${icon} @${convo.username}${unread}`);
        if (convo.lastMessage) {
          console.log(`      "${convo.lastMessage.substring(0, 60)}${convo.lastMessage.length > 60 ? '...' : ''}"`);
        }
      }
      
      if (filtered.length > limit) {
        console.log(`\n   ... and ${filtered.length - limit} more`);
      }
      
      console.log();
    } catch (error) {
      console.error('❌ Error:', error);
      process.exit(1);
    }
  });

// Rate limits command
program
  .command('rate-limits')
  .alias('limits')
  .description('Show rate limit status for all platforms')
  .action(async () => {
    try {
      const c = getClient();
      
      console.log('\n📊 Rate Limits\n');
      
      const limits = await c.getAllRateLimits();
      
      // Instagram
      if (limits.instagram) {
        console.log(`${formatPlatform('instagram')}`);
        console.log(`   Active: ${limits.instagram.isActive ? '✅ Yes' : '⏸️  No (outside hours)'}`);
        console.log(`   Hourly: ${formatRateLimit(limits.instagram.messagesSentThisHour, limits.instagram.maxPerHour)}`);
        console.log(`   Daily:  ${formatRateLimit(limits.instagram.messagesSentToday, limits.instagram.maxPerDay)}`);
        console.log();
      } else {
        console.log(`${formatPlatform('instagram')}: ❌ Unavailable\n`);
      }
      
      // Twitter
      if (limits.twitter) {
        console.log(`${formatPlatform('twitter')}`);
        console.log(`   Active: ${limits.twitter.isActive ? '✅ Yes' : '⏸️  No (outside hours)'}`);
        console.log(`   Hourly: ${formatRateLimit(limits.twitter.messagesSentThisHour, limits.twitter.maxPerHour)}`);
        console.log(`   Daily:  ${formatRateLimit(limits.twitter.messagesSentToday, limits.twitter.maxPerDay)}`);
        console.log();
      } else {
        console.log(`${formatPlatform('twitter')}: ❌ Unavailable\n`);
      }
      
      // TikTok
      if (limits.tiktok) {
        console.log(`${formatPlatform('tiktok')}`);
        console.log(`   Active: ${limits.tiktok.isActive ? '✅ Yes' : '⏸️  No (outside hours)'}`);
        console.log(`   Hourly: ${formatRateLimit(limits.tiktok.messagesSentThisHour, limits.tiktok.maxPerHour)}`);
        console.log(`   Daily:  ${formatRateLimit(limits.tiktok.messagesSentToday, limits.tiktok.maxPerDay)}`);
        console.log();
      } else {
        console.log(`${formatPlatform('tiktok')}: ❌ Unavailable\n`);
      }
      
      // Combined
      console.log('📈 Combined');
      console.log(`   Total today: ${limits.combined.totalToday}`);
      console.log(`   Total this hour: ${limits.combined.totalThisHour}`);
      console.log();
    } catch (error) {
      console.error('❌ Error:', error);
      process.exit(1);
    }
  });

// Navigate command
program
  .command('navigate <platform>')
  .alias('nav')
  .description('Navigate to inbox on a platform')
  .action(async (platform: string) => {
    try {
      const p = platform.toLowerCase() as Platform;
      if (p !== 'instagram' && p !== 'twitter' && p !== 'tiktok') {
        console.error('❌ Invalid platform. Use: instagram, twitter, tiktok');
        process.exit(1);
      }
      
      const c = getClient();
      
      console.log(`\n${formatPlatform(p)} Navigating to inbox...`);
      
      const success = await c.navigateToInbox(p);
      
      if (success) {
        console.log('   ✅ Navigated to inbox\n');
      } else {
        console.log('   ❌ Failed to navigate\n');
        process.exit(1);
      }
    } catch (error) {
      console.error('❌ Error:', error);
      process.exit(1);
    }
  });

// Health check command
program
  .command('health')
  .description('Quick health check for all APIs')
  .action(async () => {
    try {
      const c = getClient();
      const health = await c.healthCheck();
      
      console.log('\n🏥 Health Check\n');
      console.log(`   ${formatPlatform('instagram')}: ${health.instagram ? '✅ Healthy' : '❌ Unreachable'}`);
      console.log(`   ${formatPlatform('twitter')}: ${health.twitter ? '✅ Healthy' : '❌ Unreachable'}`);
      console.log(`   ${formatPlatform('tiktok')}: ${health.tiktok ? '✅ Healthy' : '❌ Unreachable'}\n`);
      
      const allHealthy = health.instagram && health.twitter && health.tiktok;
      process.exit(allHealthy ? 0 : 1);
    } catch (error) {
      console.error('❌ Error:', error);
      process.exit(1);
    }
  });

// Parse arguments
program.parse();
