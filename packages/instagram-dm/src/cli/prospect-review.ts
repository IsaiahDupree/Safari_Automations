/**
 * Prospect Review CLI
 *
 * Interactive terminal tool to review and action suggested prospects from the pipeline.
 *
 * Usage:
 *   npx ts-node src/cli/prospect-review.ts [--limit 10] [--min-score 40]
 *
 * Keys:
 *   d = schedule DM (promotes to queued)
 *   s = skip (marks skipped in DB)
 *   q = quit
 */

import 'dotenv/config';
import * as readline from 'readline';
import { initTemplateEngine, listSuggestedProspects, generatePersonalizedMessage, scheduleProspectDM, markProspectQueued, removeProspectSuggestion } from '../utils/template-engine.js';

// ─── Parse CLI args ───────────────────────────────────────────────────────────

function parseArgs(): { limit: number; minScore: number } {
  const args = process.argv.slice(2);
  let limit = 10;
  let minScore = 0;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit' && args[i + 1]) limit = parseInt(args[i + 1], 10);
    if (args[i] === '--min-score' && args[i + 1]) minScore = parseInt(args[i + 1], 10);
  }

  return { limit: Math.min(limit, 100), minScore };
}

// ─── Display helpers ──────────────────────────────────────────────────────────

function formatFollowers(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function divider(): void {
  console.log('━'.repeat(50));
}

function printProspect(
  index: number,
  total: number,
  prospect: { username: string; priority: number; bio: string; created_at: string },
): void {
  divider();
  console.log(`[${index}/${total}] @${prospect.username}  score=${prospect.priority}`);
  if (prospect.bio) {
    const bio = prospect.bio.length > 100 ? prospect.bio.slice(0, 97) + '...' : prospect.bio;
    console.log(`    "${bio}"`);
  }
  const age = Math.round((Date.now() - new Date(prospect.created_at).getTime()) / 3_600_000);
  console.log(`    Discovered: ${age}h ago`);
  console.log(`    → (d)m  (s)kip  (q)uit`);
  process.stdout.write('> ');
}

// ─── Key input ────────────────────────────────────────────────────────────────

function waitForKey(): Promise<string> {
  return new Promise(resolve => {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    function onData(key: string): void {
      process.stdin.removeListener('data', onData);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      process.stdin.pause();
      resolve(key);
    }

    process.stdin.on('data', onData);
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { limit, minScore } = parseArgs();

  initTemplateEngine();

  // Give supabase client a moment to initialize
  await new Promise(r => setTimeout(r, 500));

  const { prospects, total } = await listSuggestedProspects({ limit, minScore, sortBy: 'priority', order: 'desc' });

  if (prospects.length === 0) {
    console.log(`No suggested prospects found (minScore=${minScore}). Run the pipeline first.`);
    process.exit(0);
  }

  const today = new Date().toISOString().slice(0, 10);
  console.log(`\nPROSPECT REVIEW — ${today} (${total} suggested, showing top ${prospects.length})`);
  if (minScore > 0) console.log(`Filter: score >= ${minScore}`);

  let dmCount = 0;
  let skipCount = 0;

  for (let i = 0; i < prospects.length; i++) {
    const prospect = prospects[i];
    printProspect(i + 1, prospects.length, prospect);

    let action = '';
    while (!['d', 's', 'q', '\u0003'].includes(action)) {
      action = (await waitForKey()).toLowerCase();
    }

    console.log('');

    if (action === 'q' || action === '\u0003') {
      console.log(`\nQuitting. DMs scheduled: ${dmCount}, Skipped: ${skipCount}`);
      process.exit(0);
    }

    if (action === 'd') {
      try {
        const message = await generatePersonalizedMessage({ username: prospect.username, bio: prospect.bio, priority: prospect.priority });
        const delayMs = (Math.floor(Math.random() * 25) + 5) * 60 * 1000;
        const scheduledFor = new Date(Date.now() + delayMs).toISOString();
        await scheduleProspectDM(prospect.username, message, scheduledFor);
        await markProspectQueued(prospect.username);
        dmCount++;
        const minutesOut = Math.round(delayMs / 60_000);
        console.log(`  DM scheduled for @${prospect.username} in ~${minutesOut}m`);
        console.log(`  Preview: "${message.slice(0, 80)}..."`);
      } catch (err) {
        console.log(`  Error scheduling DM: ${err}`);
      }
    } else if (action === 's') {
      try {
        await removeProspectSuggestion(prospect.username);
        skipCount++;
        console.log(`  @${prospect.username} marked as skipped`);
      } catch (err) {
        console.log(`  Error skipping: ${err}`);
      }
    }
  }

  divider();
  console.log(`\nReview complete. DMs scheduled: ${dmCount}, Skipped: ${skipCount}`);
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
