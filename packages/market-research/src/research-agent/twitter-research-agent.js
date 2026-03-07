#!/usr/bin/env node
/**
 * twitter-research-agent.js
 *
 * Orchestrator daemon for the Twitter Tech Research pipeline:
 *   1. trending-topic-scraper → scrape Twitter Explore for trending tech topics
 *   2. multi-topic-search-runner → collect tweets per topic via TwitterResearcher
 *   3. research-synthesizer → Claude Haiku synthesis into structured JSON
 *   4. report-formatter → Telegram + Obsidian + Supabase output
 *
 * CLI flags:
 *   --topics "AI agents, LLM tools"  override scraped topics
 *   --dry-run                         skip Telegram + Supabase, write local + Obsidian
 *   --topics-only                     print trending topics and exit
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Environment loading ───────────────────────────────────────────────────────

const ACTP_ENV_PATH = '/Users/isaiahdupree/Documents/Software/actp-worker/.env';

function loadEnvFile(envPath) {
  try {
    const content = fs.readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx < 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {}
}

// Load env early
loadEnvFile(ACTP_ENV_PATH);

// ─── Output dirs ──────────────────────────────────────────────────────────────

const BATCH_DIR = path.join(os.homedir(), 'Documents/twitter-research/batches');
const SYNTHESIS_DIR = path.join(os.homedir(), 'Documents/twitter-research/synthesis');

function ensureDirs() {
  [BATCH_DIR, SYNTHESIS_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });
}

// ─── CLI arg parsing ──────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    dryRun: false,
    topicsOnly: false,
    topicsOverride: null,
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dry-run') opts.dryRun = true;
    else if (args[i] === '--topics-only') opts.topicsOnly = true;
    else if (args[i] === '--topics' && args[i + 1]) {
      opts.topicsOverride = args[i + 1].split(',').map(t => t.trim()).filter(Boolean);
      i++;
    }
  }

  return opts;
}

// ─── Timing helpers ───────────────────────────────────────────────────────────

function now() { return Date.now(); }

function elapsed(start) {
  return `${((Date.now() - start) / 1000).toFixed(1)}s`;
}

// ─── Telegram alert on failure ────────────────────────────────────────────────

async function sendTelegramAlert(message) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) return;

  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message }),
      signal: AbortSignal.timeout(15000),
    });
  } catch {}
}

// ─── Main pipeline ────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();
  ensureDirs();

  console.log('='.repeat(60));
  console.log('[ResearchAgent] Twitter Tech Research Agent starting');
  if (opts.dryRun) console.log('[ResearchAgent] DRY-RUN mode — skipping Telegram + Supabase');
  console.log('='.repeat(60));

  // Enable Safari research (required by TwitterResearcher guard)
  process.env.SAFARI_RESEARCH_ENABLED = 'true';

  // ── Stage 1: Get topics ──────────────────────────────────────────────────────
  let topics;

  if (opts.topicsOverride) {
    topics = opts.topicsOverride;
    console.log(`\n[ResearchAgent] Using provided topics: ${topics.join(', ')}`);
  } else {
    const t1 = now();
    console.log('\n[ResearchAgent] [Stage 1/4] trending-topic-scraper starting...');
    try {
      const { getTrendingTopics } = await import('./trending-topic-scraper.js');
      topics = await getTrendingTopics();
      console.log(`[ResearchAgent] [Stage 1/4] trending-topic-scraper done in ${elapsed(t1)} — ${topics.length} topics`);
    } catch (err) {
      const msg = `⚠️ Research agent failed at trending-topic-scraper: ${err.message}`;
      console.error(`[ResearchAgent] ${msg}`);
      await sendTelegramAlert(msg);
      process.exit(1);
    }
  }

  // topics-only mode: print and exit
  if (opts.topicsOnly) {
    console.log('\nTrending topics:');
    topics.forEach((t, i) => console.log(`  ${i + 1}. ${t}`));
    process.exit(0);
  }

  // ── Stage 2: Multi-topic search ──────────────────────────────────────────────
  const t2 = now();
  console.log('\n[ResearchAgent] [Stage 2/4] multi-topic-search-runner starting...');
  let batch, batchPath;
  try {
    const { runMultiTopicSearch } = await import('./multi-topic-search-runner.js');
    const searchResult = await runMultiTopicSearch(topics);
    batch = searchResult.batch;
    batchPath = searchResult.batchPath;
    console.log(`[ResearchAgent] [Stage 2/4] multi-topic-search-runner done in ${elapsed(t2)} — ${batch.totalTweets} tweets`);
  } catch (err) {
    const msg = `⚠️ Research agent failed at multi-topic-search-runner: ${err.message}`;
    console.error(`[ResearchAgent] ${msg}`);
    await sendTelegramAlert(msg);
    process.exit(1);
  }

  // ── Stage 3: Synthesize ──────────────────────────────────────────────────────
  const t3 = now();
  console.log('\n[ResearchAgent] [Stage 3/4] research-synthesizer starting...');
  let synthesis, synthesisPath;
  try {
    const { synthesizeBatch } = await import('./research-synthesizer.js');
    const synthResult = await synthesizeBatch(batch);
    synthesis = synthResult.synthesis;
    synthesisPath = synthResult.synthesisPath;
    console.log(`[ResearchAgent] [Stage 3/4] research-synthesizer done in ${elapsed(t3)}`);
  } catch (err) {
    const msg = `⚠️ Research agent failed at research-synthesizer: ${err.message}`;
    console.error(`[ResearchAgent] ${msg}`);
    await sendTelegramAlert(msg);
    process.exit(1);
  }

  // ── Stage 4: Format + push ───────────────────────────────────────────────────
  const t4 = now();
  console.log('\n[ResearchAgent] [Stage 4/4] report-formatter starting...');
  try {
    const { formatAndPushReport } = await import('./report-formatter.js');
    await formatAndPushReport(synthesis, {
      dryRun: opts.dryRun,
      batchPath,
      tweetCount: batch.totalTweets,
    });
    console.log(`[ResearchAgent] [Stage 4/4] report-formatter done in ${elapsed(t4)}`);
  } catch (err) {
    const msg = `⚠️ Research agent failed at report-formatter: ${err.message}`;
    console.error(`[ResearchAgent] ${msg}`);
    await sendTelegramAlert(msg);
    process.exit(1);
  }

  // ── Done ─────────────────────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(60));
  console.log(`[ResearchAgent] ✅ Research report complete — ${topics.length} topics, ${batch.totalTweets} tweets analyzed`);
  console.log('='.repeat(60));
}

main().catch(err => {
  console.error('[ResearchAgent] Fatal error:', err);
  process.exit(1);
});
