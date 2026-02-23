/**
 * Twitter Reply Integration Test (REAL — no mocks)
 *
 * This test drives Safari in real-time to:
 *   1. Verify Safari is open & logged into Twitter/X
 *   2. Navigate to @isaiahdupree's profile
 *   3. Extract the latest tweet URL
 *   4. Navigate to that tweet
 *   5. Post a timestamped test reply
 *   6. Verify the reply appeared on the page
 *
 * Requirements:
 *   - Safari must be running with a window open
 *   - You must be logged into x.com in Safari
 *   - macOS Accessibility permissions for osascript
 *
 * Run:  npx vitest run src/__tests__/twitter-post-reply.integration.test.ts
 *   or: npx tsx src/__tests__/twitter-post-reply.integration.test.ts  (standalone)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const execAsync = promisify(exec);

const TWITTER_HANDLE = 'IsaiahDupree7';
const PROFILE_URL = `https://x.com/${TWITTER_HANDLE}`;

// ─── Helpers ─────────────────────────────────────────────────

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

async function navigate(url: string): Promise<void> {
  const safeUrl = url.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  await execAsync(`osascript -e 'tell application "Safari" to set URL of current tab of front window to "${safeUrl}"'`);
}

async function wait(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

async function waitForSelector(selector: string, timeoutMs = 10000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const found = await executeJS(`(function(){ return document.querySelector('${selector}') ? 'found' : 'missing'; })()`);
    if (found === 'found') return true;
    await wait(500);
  }
  return false;
}

async function typeViaExecCommand(text: string): Promise<string> {
  // execCommand('insertText') is the one method React/Draft.js recognises
  // because Draft.js hooks the browser's native 'beforeinput' handling.
  const escaped = text.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
  return executeJS(`
    (function() {
      var el = document.querySelector('[data-testid="tweetTextarea_0"]');
      if (!el) return 'no_input';
      el.focus();
      var ok = document.execCommand('insertText', false, '${escaped}');
      if (!ok) {
        // Fallback: dispatch InputEvent directly
        el.textContent = '${escaped}';
        el.dispatchEvent(new InputEvent('beforeinput', {bubbles:true, inputType:'insertText', data:'${escaped}'}));
        el.dispatchEvent(new InputEvent('input', {bubbles:true, inputType:'insertText', data:'${escaped}'}));
        return 'fallback';
      }
      return 'typed';
    })()
  `);
}

// ─── Tests ───────────────────────────────────────────────────

describe('Twitter Reply (real Safari)', () => {
  let latestTweetUrl = '';
  const testReplyText = `Automated test reply — ${new Date().toISOString().slice(0, 19)}`;

  // ─── Pre-flight ──────────────────────────────────────────

  beforeAll(async () => {
    // Make sure Safari is frontmost
    await execAsync(`osascript -e 'tell application "Safari" to activate'`).catch(() => null);
    await wait(500);
  }, 10000);

  it('Safari is running and has a window', async () => {
    const { stdout } = await execAsync(
      `osascript -e 'tell application "Safari" to count of windows'`
    );
    const count = parseInt(stdout.trim());
    console.log(`   Safari windows: ${count}`);
    expect(count).toBeGreaterThan(0);
  }, 10000);

  it('is logged in to Twitter/X', async () => {
    await navigate('https://x.com/home');
    await wait(4000);

    const loggedIn = await waitForSelector('[data-testid="AppTabBar_Profile_Link"]', 10000);
    if (!loggedIn) {
      // Fallback check
      const altCheck = await executeJS(`(function(){
        return document.querySelector('[data-testid="SideNav_NewTweet_Button"]') ? 'yes' : 'no';
      })()`);
      expect(altCheck).toBe('yes');
      return;
    }
    expect(loggedIn).toBe(true);
    console.log('   ✅ Logged in to Twitter/X');
  }, 20000);

  // ─── Find latest tweet ──────────────────────────────────

  it('navigates to profile and extracts latest tweet URL', async () => {
    await navigate(PROFILE_URL);
    await wait(4000);

    // Wait for tweets to render
    const tweetsLoaded = await waitForSelector('[data-testid="tweet"]', 10000);
    expect(tweetsLoaded).toBe(true);

    // Extract the first tweet's permalink
    const tweetUrl = await executeJS(`
      (function() {
        var tweets = document.querySelectorAll('article[data-testid="tweet"]');
        if (!tweets.length) return 'no_tweets';

        // Find the first status link inside the first tweet
        var links = tweets[0].querySelectorAll('a[href*="/status/"]');
        for (var i = 0; i < links.length; i++) {
          var href = links[i].getAttribute('href');
          if (href && href.match(/\\/status\\/\\d+$/)) {
            return 'https://x.com' + href;
          }
        }
        return 'no_link';
      })()
    `);

    console.log(`   Latest tweet URL: ${tweetUrl}`);
    expect(tweetUrl).toMatch(/x\.com.*\/status\/\d+/);
    latestTweetUrl = tweetUrl;
  }, 20000);

  // ─── Navigate to tweet ──────────────────────────────────

  it('navigates to the tweet page', async () => {
    expect(latestTweetUrl).toBeTruthy();
    await navigate(latestTweetUrl);
    await wait(4000);

    // Verify we're on a tweet detail page
    const onTweet = await waitForSelector('[data-testid="tweet"]', 10000);
    expect(onTweet).toBe(true);

    // Get the tweet text for logging
    const tweetText = await executeJS(`
      (function() {
        var tweet = document.querySelector('article[data-testid="tweet"]');
        if (!tweet) return '';
        var textEl = tweet.querySelector('[data-testid="tweetText"]');
        return textEl ? textEl.innerText.substring(0, 120) : '(no text)';
      })()
    `);
    console.log(`   Tweet content: "${tweetText}"`);
  }, 20000);

  // ─── Post reply ─────────────────────────────────────────

  it('opens the reply composer and posts a reply', async () => {
    // Step 1: Click reply button on the main tweet
    const clickResult = await executeJS(`
      (function() {
        var tweets = document.querySelectorAll('[data-testid="tweet"]');
        if (tweets.length === 0) return 'no_tweets';
        var mainTweet = tweets[0];
        var replyBtn = mainTweet.querySelector('[data-testid="reply"]');
        if (replyBtn) { replyBtn.click(); return 'clicked'; }
        return 'no_reply_btn';
      })()
    `);
    console.log(`   Reply button click: ${clickResult}`);
    expect(clickResult).toBe('clicked');
    await wait(2000);

    // Step 2: Wait for reply input
    const inputReady = await waitForSelector('[data-testid="tweetTextarea_0"]', 8000);
    expect(inputReady).toBe(true);

    // Step 3: Focus the input
    const focusResult = await executeJS(`
      (function() {
        var input = document.querySelector('[data-testid="tweetTextarea_0"]');
        if (input) { input.focus(); input.click(); return 'focused'; }
        return 'not_found';
      })()
    `);
    expect(focusResult).toBe('focused');
    await wait(300);

    // Step 4: Type reply via execCommand (the only method React/Draft.js recognises)
    console.log(`   Typing: "${testReplyText}"`);
    const typed = await typeViaExecCommand(testReplyText);
    console.log(`   Type result: ${typed}`);
    expect(['typed', 'fallback']).toContain(typed);
    await wait(1500);

    // Step 5: Click submit (retry, checking multiple button selectors)
    let submitResult = 'pending';
    for (let attempt = 0; attempt < 6; attempt++) {
      submitResult = await executeJS(`
        (function() {
          // Try inline reply button first
          var btn = document.querySelector('[data-testid="tweetButtonInline"]');
          if (btn && !btn.disabled) { btn.click(); return 'submitted_inline'; }
          // Try dialog reply/post button
          btn = document.querySelector('[data-testid="tweetButton"]');
          if (btn && !btn.disabled) { btn.click(); return 'submitted_dialog'; }
          // Try any enabled Reply/Post button in a dialog
          var dialog = document.querySelector('[role="dialog"]');
          if (dialog) {
            var btns = dialog.querySelectorAll('button');
            for (var i = 0; i < btns.length; i++) {
              var t = (btns[i].innerText || '').trim();
              if ((t === 'Reply' || t === 'Post') && !btns[i].disabled) {
                btns[i].click();
                return 'submitted_' + t.toLowerCase();
              }
            }
          }
          if (btn && btn.disabled) return 'disabled';
          return 'no_button';
        })()
      `);
      if (submitResult.startsWith('submitted')) break;
      console.log(`   Submit attempt ${attempt + 1}: ${submitResult}`);
      await wait(1000);
    }
    console.log(`   Submit result: ${submitResult}`);
    expect(submitResult).toMatch(/^submitted/);
  }, 30000);

  // ─── Verify reply ──────────────────────────────────────

  it('verifies the reply appeared on the page', async () => {
    // Wait for the reply to appear (Twitter needs time to process)
    await wait(4000);

    const snippet = testReplyText.substring(0, 30).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    let verified = false;

    // Retry verification a few times (reply might take a moment)
    for (let attempt = 0; attempt < 5; attempt++) {
      const result = await executeJS(`
        (function() {
          var tweets = document.querySelectorAll('[data-testid="tweetText"]');
          for (var i = 0; i < tweets.length; i++) {
            if (tweets[i].innerText.includes('${snippet}')) return 'verified';
          }
          return 'not_found';
        })()
      `);

      if (result === 'verified') {
        verified = true;
        break;
      }
      console.log(`   Verification attempt ${attempt + 1}: ${result}`);
      await wait(2000);
    }

    console.log(`   ✅ Reply verified: ${verified}`);
    console.log(`   Reply text: "${testReplyText}"`);
    console.log(`   Tweet URL: ${latestTweetUrl}`);
    expect(verified).toBe(true);
  }, 30000);
});
