/**
 * trending-topic-scraper.js
 *
 * Scrapes Twitter/X Explore page for trending tech topics.
 * Uses an existing Safari tab claimed via safari-tab-coordinator (port 3003 or 3007).
 * Falls back to a seeded list if scrape yields < 3 results.
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const TECH_KEYWORDS = [
  'ai', 'llm', 'gpt', 'claude', 'openai', 'anthropic', 'tech', 'software',
  'dev', 'api', 'saas', 'startup', 'crypto', 'bitcoin', 'coding', 'github',
  'programming', 'framework', 'model', 'agent', 'automation',
];

const SEEDED_TOPICS = [
  'AI agents',
  'LLM tools',
  'SaaS growth',
  'developer tools',
  'startup funding',
  'open source AI',
  'AI automation',
  'Claude AI',
  'GPT-5',
];

const EXPLORE_URL = 'https://x.com/explore/tabs/trending';
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000;

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function executeJS(script) {
  const tmpFile = `/tmp/safari_trending_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.scpt`;
  const jsCode = script.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
  const appleScript = `tell application "Safari" to do JavaScript "${jsCode}" in current tab of front window`;
  const fs = await import('fs');
  fs.writeFileSync(tmpFile, appleScript);
  try {
    const { stdout } = await execAsync(`osascript "${tmpFile}"`, { timeout: 30000 });
    return stdout.trim();
  } finally {
    try { (await import('fs')).unlinkSync(tmpFile); } catch {}
  }
}

async function navigateSafari(url) {
  const safeUrl = url.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  await execAsync(`osascript -e 'tell application "Safari" to set URL of current tab of front window to "${safeUrl}"'`);
}

async function waitForPage(ms = 4000) {
  await sleep(ms);
}

async function scrapeOnce() {
  console.log('[TrendingScraper] Navigating to Twitter Explore trending tab...');
  await navigateSafari(EXPLORE_URL);
  await waitForPage(5000);

  const raw = await executeJS(`(function() {
    var items = [];
    // Try trending cells — multiple selectors for resilience
    var cells = document.querySelectorAll('[data-testid="trend"], [data-testid="trendingItem"], [data-testid="typeaheadResult"]');
    if (cells.length === 0) {
      // Fallback: grab all span text from the explore section
      cells = document.querySelectorAll('section[aria-labelledby] div[role="link"]');
    }
    if (cells.length === 0) {
      // Deeper fallback: scan main content spans
      cells = document.querySelectorAll('[data-testid="cellInnerDiv"]');
    }
    for (var i = 0; i < cells.length && items.length < 30; i++) {
      var cell = cells[i];
      var text = (cell.innerText || '').trim();
      if (text.length > 1 && text.length < 200) {
        // Extract first meaningful line as topic name
        var lines = text.split('\\n').map(function(l) { return l.trim(); }).filter(Boolean);
        if (lines.length > 0) {
          items.push({ raw: lines[0], full: text });
        }
      }
    }
    return JSON.stringify(items);
  })()`);

  let parsed = [];
  try {
    parsed = JSON.parse(raw || '[]');
  } catch {
    return [];
  }

  // Filter to tech-relevant topics
  const techTopics = parsed
    .map(item => item.raw)
    .filter(topic => {
      const lower = topic.toLowerCase();
      return TECH_KEYWORDS.some(kw => lower.includes(kw));
    })
    .slice(0, 10);

  console.log(`[TrendingScraper] Scraped ${parsed.length} items, ${techTopics.length} tech-relevant`);
  return techTopics;
}

/**
 * Scrape Twitter Explore for trending tech topics.
 * Returns array of up to 10 topic strings.
 */
export async function getTrendingTopics() {
  let lastError;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`[TrendingScraper] Attempt ${attempt}/${MAX_RETRIES}`);
      const topics = await scrapeOnce();

      if (topics.length >= 3) {
        console.log(`[TrendingScraper] Found ${topics.length} topics (scraped):`);
        topics.forEach(t => console.log(`  - ${t} [scraped]`));
        return topics;
      }

      console.log(`[TrendingScraper] Only found ${topics.length} topics — below threshold of 3`);
      if (attempt < MAX_RETRIES) {
        console.log(`[TrendingScraper] Retrying in ${RETRY_DELAY_MS / 1000}s...`);
        await sleep(RETRY_DELAY_MS);
      }
    } catch (err) {
      lastError = err;
      console.warn(`[TrendingScraper] Attempt ${attempt} failed: ${err.message}`);
      if (attempt < MAX_RETRIES) {
        console.log(`[TrendingScraper] Retrying in ${RETRY_DELAY_MS / 1000}s...`);
        await sleep(RETRY_DELAY_MS);
      }
    }
  }

  // Fall back to seeded list
  console.warn(`[TrendingScraper] Scrape failed after ${MAX_RETRIES} attempts${lastError ? ': ' + lastError.message : ''}. Using seeded topics.`);
  SEEDED_TOPICS.forEach(t => console.log(`  - ${t} [seeded]`));
  return SEEDED_TOPICS;
}

// CLI usage
if (process.argv[1] && process.argv[1].endsWith('trending-topic-scraper.js')) {
  getTrendingTopics().then(topics => {
    console.log('\nTopics:', topics);
    process.exit(0);
  }).catch(err => {
    console.error(err);
    process.exit(1);
  });
}
