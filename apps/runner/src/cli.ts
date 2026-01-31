#!/usr/bin/env node
/**
 * Safari Automation CLI
 * 
 * Command-line interface for controlling Safari automation.
 */

import { Command } from 'commander';

const program = new Command();

program
  .name('safari-auto')
  .description('Safari Automation CLI - Control social media engagement')
  .version('0.1.0');

// Start command
program
  .command('start')
  .description('Start the automation orchestrator')
  .option('-p, --platforms <platforms>', 'Comma-separated platforms (instagram,twitter,tiktok,threads)', 'instagram,twitter,tiktok,threads')
  .option('-r, --rate <number>', 'Comments per hour', '30')
  .option('--dry-run', 'Run without actually posting')
  .option('--no-discovery', 'Disable automatic post discovery')
  .action(async (options) => {
    console.log('🚀 Starting Safari Automation...');
    console.log(`   Platforms: ${options.platforms}`);
    console.log(`   Rate: ${options.rate}/hour`);
    console.log(`   Dry run: ${options.dryRun || false}`);
    console.log(`   Discovery: ${options.discovery !== false}`);
    
    // Import dynamically to avoid loading everything for help
    const { startAutomation } = await import('./commands/start');
    await startAutomation({
      platforms: options.platforms.split(','),
      commentsPerHour: parseInt(options.rate, 10),
      dryRun: options.dryRun || false,
      enableDiscovery: options.discovery !== false,
    });
  });

// Stop command
program
  .command('stop')
  .description('Stop the running automation')
  .action(async () => {
    console.log('🛑 Stopping automation...');
    const { stopAutomation } = await import('./commands/stop');
    await stopAutomation();
  });

// Status command
program
  .command('status')
  .description('Show current automation status')
  .option('-w, --watch', 'Watch mode - refresh every 5 seconds')
  .action(async (options) => {
    const { showStatus } = await import('./commands/status');
    await showStatus({ watch: options.watch });
  });

// Session commands
program
  .command('session')
  .description('Manage browser sessions')
  .argument('<action>', 'Action: check, refresh, list')
  .option('-p, --platform <platform>', 'Specific platform')
  .action(async (action, options) => {
    const { manageSession } = await import('./commands/session');
    await manageSession(action, options.platform);
  });

// Comment command (manual)
program
  .command('comment')
  .description('Post a comment manually')
  .requiredOption('-u, --url <url>', 'Post URL to comment on')
  .option('-t, --text <text>', 'Comment text (or auto-generate)')
  .option('-s, --style <style>', 'Comment style: engaging, supportive, insightful', 'engaging')
  .action(async (options) => {
    const { postComment } = await import('./commands/comment');
    await postComment({
      url: options.url,
      text: options.text,
      style: options.style,
    });
  });

// Discover command
program
  .command('discover')
  .description('Discover posts to comment on')
  .option('-p, --platform <platform>', 'Platform to discover from')
  .option('-s, --source <source>', 'Source: feed, explore, hashtag', 'feed')
  .option('-n, --count <number>', 'Number of posts to find', '10')
  .action(async (options) => {
    const { discoverPosts } = await import('./commands/discover');
    await discoverPosts({
      platform: options.platform,
      source: options.source,
      count: parseInt(options.count, 10),
    });
  });

// Stats command
program
  .command('stats')
  .description('Show engagement statistics')
  .option('-d, --days <number>', 'Number of days to show', '7')
  .option('--export <format>', 'Export format: json, csv')
  .action(async (options) => {
    const { showStats } = await import('./commands/stats');
    await showStats({
      days: parseInt(options.days, 10),
      exportFormat: options.export,
    });
  });

// Config command
program
  .command('config')
  .description('View or update configuration')
  .argument('[key]', 'Config key to view/set')
  .argument('[value]', 'Value to set')
  .option('-l, --list', 'List all config')
  .action(async (key, value, options) => {
    const { manageConfig } = await import('./commands/config');
    await manageConfig(key, value, options.list);
  });

// Sora commands
const sora = program
  .command('sora')
  .description('Sora video generation commands');

sora
  .command('status')
  .description('Show Sora rate limiter status')
  .action(async () => {
    const { soraStatus } = await import('./commands/sora');
    await soraStatus();
  });

sora
  .command('request')
  .description('Request a new Sora generation')
  .requiredOption('-p, --prompt <prompt>', 'Video prompt')
  .option('-s, --style <style>', 'Video style')
  .action(async (options) => {
    const { soraRequest } = await import('./commands/sora');
    await soraRequest(options.prompt, options.style);
  });

sora
  .command('approve')
  .description('Approve a pending Sora generation')
  .argument('<id>', 'Request ID to approve')
  .action(async (id) => {
    const { soraApprove } = await import('./commands/sora');
    await soraApprove(id);
  });

sora
  .command('pause')
  .description('Pause Sora generation')
  .option('-r, --reason <reason>', 'Reason for pause')
  .action(async (options) => {
    const { soraPause } = await import('./commands/sora');
    await soraPause(options.reason);
  });

sora
  .command('resume')
  .description('Resume Sora generation')
  .action(async () => {
    const { soraResume } = await import('./commands/sora');
    await soraResume();
  });

// Parse and run
program.parse();
