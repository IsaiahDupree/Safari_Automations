/**
 * Twitter Reply Integration Test (REAL — no mocks)
 *
 * Exercises the full reliable TwitterDriver pipeline:
 *   1. Verify Safari is open & logged into Twitter/X
 *   2. Navigate to @IsaiahDupree7's profile
 *   3. Extract the latest tweet URL
 *   4. Navigate to that tweet using TwitterDriver.navigateToPost (smart wait)
 *   5. Post a reply using TwitterDriver.postComment (3-strategy typing, retry, verify)
 *   6. Assert the result reports success + verified + strategy used
 *
 * Requirements:
 *   - Safari must be running with a window open
 *   - You must be logged into x.com in Safari
 *   - macOS Accessibility permissions for osascript
 *
 * Run:  npx vitest run src/__tests__/twitter-post-reply.integration.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TwitterDriver, type PostResult } from '../automation/twitter-driver.js';

const execAsync = promisify(exec);

const TWITTER_HANDLE = 'IsaiahDupree7';
const PROFILE_URL = `https://x.com/${TWITTER_HANDLE}`;

// ─── Helpers (minimal — the driver handles the hard parts) ──

async function executeJS(script: string): Promise<string> {
  const tmpFile = path.join(os.tmpdir(), `safari_js_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.scpt`);
  const jsCode = script.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
  const appleScript = `tell application "Safari" to do JavaScript "${jsCode}" in current tab of front window`;
  fs.writeFileSync(tmpFile, appleScript);
  try {
    const { stdout } = await execAsync(`osascript "${tmpFile}"`, { timeout: 15000 });
    return stdout.trim();
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}

async function wait(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// ─── Tests ───────────────────────────────────────────────────

describe('Twitter Reply (real Safari)', () => {
  let driver: TwitterDriver;
  let latestTweetUrl = '';
  const testReplyText = `Automated test reply — ${new Date().toISOString().slice(0, 19)}`;

  beforeAll(async () => {
    driver = new TwitterDriver({
      maxRetries: 3,
      screenshotOnFailure: true,
      screenshotDir: '/tmp/twitter-automation-screenshots',
    });
    await execAsync(`osascript -e 'tell application "Safari" to activate'`).catch(() => null);
    await wait(500);
  }, 10000);

  // ─── Pre-flight ──────────────────────────────────────────

  it('Safari is running and has a window', async () => {
    const { stdout } = await execAsync(
      `osascript -e 'tell application "Safari" to count of windows'`
    );
    const count = parseInt(stdout.trim());
    console.log(`   Safari windows: ${count}`);
    expect(count).toBeGreaterThan(0);
  }, 10000);

  it('is logged in to Twitter/X (via TwitterDriver.getStatus)', async () => {
    // Navigate to x.com first so getStatus can check login selectors
    await execAsync(`osascript -e 'tell application "Safari" to set URL of current tab of front window to "https://x.com/home"'`);
    await wait(4000);

    const status = await driver.getStatus();
    console.log(`   Twitter status: ${JSON.stringify(status)}`);
    expect(status.isLoggedIn).toBe(true);
  }, 20000);

  // ─── Find latest tweet ──────────────────────────────────

  it('navigates to profile and extracts latest tweet URL', async () => {
    // Navigate and use smart wait for tweet rendering
    const ok = await driver.navigateToPost(PROFILE_URL);
    expect(ok).toBe(true);

    // Extract the first tweet's permalink
    const tweetUrl = await executeJS(`
      (function() {
        var tweets = document.querySelectorAll('article[data-testid="tweet"], article[role="article"]');
        if (!tweets.length) return 'no_tweets';
        var links = tweets[0].querySelectorAll('a[href*="/status/"]');
        for (var i = 0; i < links.length; i++) {
          var href = links[i].getAttribute('href');
          if (href && href.match(/\\/status\\/\\d+$/)) return 'https://x.com' + href;
        }
        return 'no_link';
      })()
    `);

    console.log(`   Latest tweet URL: ${tweetUrl}`);
    expect(tweetUrl).toMatch(/x\.com.*\/status\/\d+/);
    latestTweetUrl = tweetUrl;
  }, 20000);

  // ─── Navigate + post reply via driver ───────────────────

  it('navigates to tweet and posts reply via TwitterDriver.postComment', async () => {
    expect(latestTweetUrl).toBeTruthy();

    // Navigate using driver (smart wait for tweet to render)
    const navOk = await driver.navigateToPost(latestTweetUrl);
    expect(navOk).toBe(true);

    // Post reply — exercises full pipeline:
    //   retry loop → error detection → multi-selector click →
    //   3-strategy typing → typing verification → submit → verify
    console.log(`   Posting: "${testReplyText}"`);
    const result: PostResult = await driver.postComment(testReplyText);

    console.log(`   Result: ${JSON.stringify(result)}`);
    expect(result.success).toBe(true);
    expect(result.strategy).toBeTruthy();
    expect(result.attempts).toBeGreaterThan(0);
    expect(result.durationMs).toBeGreaterThan(0);
    console.log(`   Strategy: ${result.strategy}`);
    console.log(`   Attempts: ${result.attempts}`);
    console.log(`   Duration: ${result.durationMs}ms`);
  }, 45000);

  // ─── Verify reply ──────────────────────────────────────

  it('verifies the reply appeared on the page', async () => {
    await wait(3000);

    const snippet = testReplyText.substring(0, 30).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    let verified = false;

    for (let attempt = 0; attempt < 6; attempt++) {
      const result = await executeJS(`
        (function() {
          var els = document.querySelectorAll('[data-testid="tweetText"], div[lang] > span');
          for (var i = 0; i < els.length; i++) {
            if (els[i].innerText.includes('${snippet}')) return 'verified';
          }
          return 'not_found';
        })()
      `);
      if (result === 'verified') { verified = true; break; }
      console.log(`   Verification attempt ${attempt + 1}: ${result}`);
      await wait(2000);
    }

    console.log(`   ✅ Reply verified: ${verified}`);
    console.log(`   Reply text: "${testReplyText}"`);
    console.log(`   Tweet URL: ${latestTweetUrl}`);
    expect(verified).toBe(true);
  }, 30000);

  // ─── Rate limiter works ────────────────────────────────

  it('rate limiter reports the posted comment', () => {
    const limits = driver.getRateLimits();
    console.log(`   Rate limits: ${JSON.stringify(limits)}`);
    expect(limits.commentsThisHour).toBeGreaterThanOrEqual(1);
    expect(limits.commentsToday).toBeGreaterThanOrEqual(1);
  });
});
