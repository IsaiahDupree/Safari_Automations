#!/usr/bin/env node
/**
 * test-research-agent.js
 *
 * End-to-end test suite for the Twitter Research Agent.
 * Runs 4 tests and prints PASS/FAIL per check.
 *
 * Tests:
 *   1. --topics-only returns >= 3 topics
 *   2. --dry-run with --topics "AI agents" writes batch + synthesis + Obsidian, skips Telegram
 *   3. Synthesis schema validation
 *   4. Report formatter produces Telegram message < 4096 chars
 */

import { execSync, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';

const AGENT_DIR = path.dirname(fileURLToPath(import.meta.url));
const AGENT_SCRIPT = path.join(AGENT_DIR, 'twitter-research-agent.js');
const BATCH_DIR = path.join(os.homedir(), 'Documents/twitter-research/batches');
const SYNTHESIS_DIR = path.join(os.homedir(), 'Documents/twitter-research/synthesis');
const OBSIDIAN_RESEARCH_DIR = path.join(os.homedir(), '.memory/vault/RESEARCH');
const TODAY = new Date().toISOString().slice(0, 10);

let passed = 0;
let failed = 0;

function check(label, result, detail = '') {
  if (result) {
    console.log(`  ✅ PASS: ${label}${detail ? ' — ' + detail : ''}`);
    passed++;
  } else {
    console.log(`  ❌ FAIL: ${label}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

function runCommand(args, timeoutMs = 120000) {
  return new Promise((resolve) => {
    const proc = spawn('node', [AGENT_SCRIPT, ...args], {
      env: { ...process.env, SAFARI_RESEARCH_ENABLED: 'true' },
      timeout: timeoutMs,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => { stderr += d.toString(); });

    proc.on('close', code => {
      resolve({ code, stdout, stderr, output: stdout + stderr });
    });

    proc.on('error', err => {
      resolve({ code: -1, stdout, stderr, output: stdout + stderr, error: err.message });
    });
  });
}

function getLatestFileInDir(dir, pattern) {
  try {
    const files = fs.readdirSync(dir)
      .filter(f => !pattern || f.includes(pattern))
      .map(f => ({ name: f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    return files.length > 0 ? path.join(dir, files[0].name) : null;
  } catch {
    return null;
  }
}

// ─── Test 1: topics-only ─────────────────────────────────────────────────────

async function test1() {
  console.log('\n[Test 1] --topics-only returns >= 3 topics');

  const result = await runCommand(['--topics-only'], 60000);
  const output = result.output;

  // Count topic lines (numbered list or topic names)
  const topicLines = output.split('\n').filter(l =>
    l.match(/^\s+\d+\./) || l.match(/\[seeded\]/) || l.match(/\[scraped\]/)
  );

  // Also check "Trending topics:" header
  const hasHeader = output.includes('Trending topics:') || output.includes('Topics:');
  const topicCount = topicLines.length;

  check('output contains topic list header', hasHeader, `output: ${output.slice(0, 200)}`);
  check(`at least 3 topics returned (got ${topicCount})`, topicCount >= 3);
}

// ─── Test 2: dry-run writes files, skips Telegram ────────────────────────────

async function test2() {
  console.log('\n[Test 2] --dry-run with --topics "AI agents" writes files, skips Telegram');

  const beforeBatch = Date.now();
  const result = await runCommand(['--dry-run', '--topics', 'AI agents'], 180000);
  const output = result.output;

  console.log(`  Exit code: ${result.code}`);

  // Check batch file written
  const batchFile = getLatestFileInDir(BATCH_DIR, TODAY);
  const batchWritten = batchFile && fs.statSync(batchFile).mtimeMs > beforeBatch;
  check('batch JSON written to ~/Documents/twitter-research/batches/', batchWritten, batchFile || 'not found');

  // Check synthesis file written
  const synthFile = getLatestFileInDir(SYNTHESIS_DIR, TODAY);
  const synthWritten = synthFile && fs.statSync(synthFile).mtimeMs > beforeBatch;
  check('synthesis JSON written to ~/Documents/twitter-research/synthesis/', synthWritten, synthFile || 'not found');

  // Check Obsidian note written
  const obsidianFile = path.join(OBSIDIAN_RESEARCH_DIR, `twitter-trends-${TODAY}.md`);
  const obsidianExists = fs.existsSync(obsidianFile) && fs.statSync(obsidianFile).mtimeMs > beforeBatch;
  check('Obsidian note written to ~/.memory/vault/RESEARCH/', obsidianExists, obsidianFile);

  // Check Telegram NOT sent (dry-run)
  const telegramSkipped = output.includes('Dry-run: skipping Telegram') || output.includes('dry-run');
  check('Telegram NOT sent (dry-run mode)', telegramSkipped, 'output contains dry-run skip message');
}

// ─── Test 3: synthesis schema validation ─────────────────────────────────────

async function test3() {
  console.log('\n[Test 3] Synthesis schema validation');

  const synthFile = getLatestFileInDir(SYNTHESIS_DIR, TODAY);
  if (!synthFile) {
    check('synthesis file exists', false, 'Run test 2 first');
    return;
  }

  let synthesis;
  try {
    synthesis = JSON.parse(fs.readFileSync(synthFile, 'utf-8'));
  } catch (err) {
    check('synthesis file is valid JSON', false, err.message);
    return;
  }

  check('synthesis file is valid JSON', true);
  check('topTopics field present and is array', Array.isArray(synthesis.topTopics), `type: ${typeof synthesis.topTopics}`);
  check('founderInsights field present and is array', Array.isArray(synthesis.founderInsights), `type: ${typeof synthesis.founderInsights}`);
  check('emergingOpportunities field present and is array', Array.isArray(synthesis.emergingOpportunities), `type: ${typeof synthesis.emergingOpportunities}`);
  check('toolsToWatch field present and is array', Array.isArray(synthesis.toolsToWatch), `type: ${typeof synthesis.toolsToWatch}`);
  check('overallNarrative field present', typeof synthesis.overallNarrative === 'string', `type: ${typeof synthesis.overallNarrative}`);
  check('date field present', typeof synthesis.date === 'string', `value: ${synthesis.date}`);
}

// ─── Test 4: Telegram message < 4096 chars ───────────────────────────────────

async function test4() {
  console.log('\n[Test 4] Report formatter produces Telegram message < 4096 chars');

  // Dynamic import of formatTelegramMessage
  let formatTelegramMessage;
  try {
    const mod = await import('./report-formatter.js');
    formatTelegramMessage = mod.formatTelegramMessage;
  } catch (err) {
    check('report-formatter.js imports successfully', false, err.message);
    return;
  }

  check('report-formatter.js imports successfully', true);

  // Mock synthesis with full data
  const mockSynthesis = {
    date: TODAY,
    topTopics: [
      {
        topic: 'AI agents',
        headline: 'AI agents are taking over developer workflows in 2026',
        keySignal: 'B2B SaaS founders need to automate their sales and marketing with AI agents',
        topTweet: { text: 'Just shipped an AI agent that handles all my LinkedIn outreach automatically', author: 'example_user', engagement: 1500 },
        emergingTools: ['LangChain', 'AutoGPT', 'Claude'],
        sentiment: 'bullish',
      },
      {
        topic: 'LLM tools',
        headline: 'New LLM tooling is making AI development faster than ever',
        keySignal: 'Founders building LLM-powered products have a clear competitive advantage',
        topTweet: { text: 'The new Claude API is absolutely incredible for building AI products', author: 'another_user', engagement: 800 },
        emergingTools: ['Anthropic SDK', 'LiteLLM'],
        sentiment: 'bullish',
      },
    ],
    founderInsights: [
      'AI automation is the #1 investment priority for $1M+ ARR SaaS companies',
      'Founders who build with LLMs now will dominate their niches in 12 months',
      'Outbound automation using AI is seeing 3-5x response rate improvements',
    ],
    emergingOpportunities: [
      'Build AI-powered outreach tools for SaaS founders',
      'Create LLM integration services for legacy software companies',
    ],
    toolsToWatch: ['Claude', 'GPT-5', 'Cursor', 'Devin'],
    overallNarrative: 'The AI automation wave is accelerating rapidly. Founders who move now on AI tooling will have a significant competitive moat within 6-12 months.',
  };

  const message = formatTelegramMessage(mockSynthesis);
  const msgLen = message.length;

  check(`Telegram message length < 4096 chars (got ${msgLen})`, msgLen < 4096);
  check('Telegram message contains date header', message.includes(TODAY));
  check('Telegram message contains topic section', message.includes('AI agents'));
}

// ─── Run all tests ────────────────────────────────────────────────────────────

async function main() {
  console.log('='.repeat(60));
  console.log('Twitter Research Agent — Test Suite');
  console.log('='.repeat(60));

  await test1();
  await test2();
  await test3();
  await test4();

  console.log('\n' + '='.repeat(60));
  console.log(`Results: ${passed} PASS, ${failed} FAIL`);
  console.log('='.repeat(60));

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
