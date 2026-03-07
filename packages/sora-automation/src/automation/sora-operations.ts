/**
 * Sora Operations — browser automation for sora.com
 *
 * Handles: session check, prompt submission, generation polling,
 * video download, and usage scraping.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import type { SafariDriver } from './safari-driver.js';
import type { SoraUsage } from './types.js';

const execAsync = promisify(exec);

export const SORA_URL = 'https://sora.com';
export const SORA_PATTERN = 'sora';

// ─── Session ──────────────────────────────────────────────────────────────────

export async function navigateToSora(driver: SafariDriver): Promise<boolean> {
  const current = await driver.getCurrentUrl();
  if (current.includes('sora.com')) return true;
  return driver.navigateTo(SORA_URL);
}

export async function isLoggedIn(driver: SafariDriver): Promise<boolean> {
  const result = await driver.executeJS(`
    (function() {
      var url = window.location.href;
      if (!url.includes('sora.com')) return 'false';
      // Not logged in → redirected to login or auth page
      if (url.includes('/auth') || url.includes('/login') || url.includes('accounts.google')) return 'false';
      // Look for the main creation interface
      var hasPrompt = !!document.querySelector('textarea, [data-testid="prompt"], [placeholder*="prompt" i], [placeholder*="describe" i]');
      var hasNav = !!document.querySelector('nav, [data-testid="sidebar"], [class*="sidebar"]');
      return (hasPrompt || hasNav) ? 'true' : 'false';
    })()
  `).catch(() => 'false');
  return result.trim() === 'true';
}

// ─── Usage ────────────────────────────────────────────────────────────────────

export async function getSoraUsage(driver: SafariDriver): Promise<SoraUsage> {
  await navigateToSora(driver);
  const raw = await driver.executeJS(`
    (function() {
      // Sora shows credits/usage in the UI — try to find it
      var creditsEl = document.querySelector('[data-testid="credits"], [class*="credits"], [class*="limit"], [class*="usage"]');
      var creditsText = creditsEl ? creditsEl.innerText : '';

      // Try extracting numbers from "X / Y" or "X remaining" patterns
      var remaining = -1, limit = -1;
      var match = creditsText.match(/(\\d+)\\s*\\/\\s*(\\d+)/);
      if (match) {
        remaining = parseInt(match[1]);
        limit = parseInt(match[2]);
      }
      var matchRemaining = creditsText.match(/(\\d+)\\s*(?:remaining|left)/i);
      if (matchRemaining && remaining === -1) {
        remaining = parseInt(matchRemaining[1]);
      }

      return JSON.stringify({ remaining, limit, text: creditsText.substring(0, 100) });
    })()
  `).catch(() => '{}');

  let parsed: { remaining?: number; limit?: number; text?: string } = {};
  try { parsed = JSON.parse(raw); } catch { /* ignore */ }

  const remaining = parsed.remaining ?? -1;
  const limit = parsed.limit ?? -1;
  const generated = limit > 0 && remaining >= 0 ? limit - remaining : -1;

  return {
    videos_generated_today: generated,
    daily_limit: limit,
    remaining,
    plan: 'chatgpt-plus',
  };
}

// ─── Video Generation ─────────────────────────────────────────────────────────

export interface GenerateOptions {
  prompt: string;
  duration?: string;       // '5s' | '10s' | '20s'
  aspect_ratio?: string;   // '9:16' | '16:9' | '1:1'
  character?: string;
}

/**
 * Submit a generation request on sora.com.
 * Returns a generation job identifier from the page (or a timestamp-based fallback).
 */
export async function submitGeneration(driver: SafariDriver, opts: GenerateOptions): Promise<string> {
  await navigateToSora(driver);
  await driver.wait(2000);

  const loggedIn = await isLoggedIn(driver);
  if (!loggedIn) {
    throw new Error('Not logged in to Sora. Open Safari → sora.com and sign in with your ChatGPT account.');
  }

  // Set duration if specified
  if (opts.duration) {
    await driver.executeJS(`
      (function() {
        var dur = ${JSON.stringify(opts.duration.replace('s', ''))};
        // Try clicking duration option
        var btns = document.querySelectorAll('button, [role="option"], [role="button"]');
        for (var b of btns) {
          if (b.innerText && b.innerText.trim() === dur + 's') {
            b.click();
            break;
          }
        }
      })()
    `).catch(() => {});
    await driver.wait(500);
  }

  // Set aspect ratio if specified
  if (opts.aspect_ratio) {
    await driver.executeJS(`
      (function() {
        var ar = ${JSON.stringify(opts.aspect_ratio)};
        var btns = document.querySelectorAll('button, [role="option"], [role="button"]');
        for (var b of btns) {
          if (b.innerText && b.innerText.trim() === ar) {
            b.click();
            break;
          }
        }
      })()
    `).catch(() => {});
    await driver.wait(500);
  }

  // Type prompt into the textarea
  const promptResult = await driver.executeJS(`
    (function() {
      var prompt = ${JSON.stringify(opts.prompt)};
      var input = document.querySelector('textarea')
        || document.querySelector('[data-testid="prompt-input"]')
        || document.querySelector('[placeholder*="prompt" i]')
        || document.querySelector('[placeholder*="describe" i]')
        || document.querySelector('[contenteditable="true"]');

      if (!input) return 'no-input';

      input.focus();
      // React-compatible value setter
      var nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')
        || Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
      if (nativeInputValueSetter && nativeInputValueSetter.set) {
        nativeInputValueSetter.set.call(input, prompt);
      } else {
        input.value = prompt;
      }
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return 'ok';
    })()
  `);

  if (promptResult.trim() === 'no-input') {
    throw new Error('Could not find prompt input on sora.com — page may have changed or not fully loaded.');
  }

  await driver.wait(500);

  // Click the generate/submit button
  const submitResult = await driver.executeJS(`
    (function() {
      // Try several strategies
      var btn = document.querySelector('[data-testid="generate-button"]')
        || document.querySelector('[aria-label*="generate" i]')
        || document.querySelector('button[type="submit"]');

      if (!btn) {
        // Look for a button with generate-related text near the prompt
        var allBtns = Array.from(document.querySelectorAll('button'));
        btn = allBtns.find(b => /^(generate|create|make|submit)$/i.test((b.innerText || '').trim()));
      }

      if (btn && !btn.disabled) {
        btn.click();
        return 'submitted';
      }
      if (btn && btn.disabled) return 'btn-disabled';
      return 'no-btn';
    })()
  `);

  if (submitResult.trim() === 'no-btn') {
    throw new Error('Could not find the Generate button on sora.com.');
  }
  if (submitResult.trim() === 'btn-disabled') {
    throw new Error('Generate button is disabled — may be rate-limited or credits exhausted.');
  }

  // Return a generation ID — use timestamp + prompt hash as fallback
  const genId = `sora-${Date.now()}-${opts.prompt.slice(0, 20).replace(/\s+/g, '-').replace(/[^a-z0-9-]/gi, '')}`;
  return genId;
}

/**
 * Poll the Sora page until a video generation completes.
 * Looks for a new video card appearing after submission.
 * Returns the download URL.
 */
export async function waitForGeneration(
  driver: SafariDriver,
  genId: string,
  opts: { timeoutMs?: number; pollIntervalMs?: number } = {}
): Promise<string> {
  const timeout = opts.timeoutMs ?? 10 * 60 * 1000; // 10 min default
  const interval = opts.pollIntervalMs ?? 5000;
  const deadline = Date.now() + timeout;

  // Capture existing video count at submission time
  const initialCountStr = await driver.executeJS(`
    (function() {
      var videos = document.querySelectorAll('video, [data-testid="video-card"], [class*="video-card"], [class*="VideoCard"]');
      return String(videos.length);
    })()
  `).catch(() => '0');
  const initialCount = parseInt(initialCountStr, 10) || 0;

  console.log(`[sora] Waiting for generation ${genId} (initial video count: ${initialCount})...`);

  while (Date.now() < deadline) {
    await driver.wait(interval);

    const status = await driver.executeJS(`
      (function() {
        // Check for error states
        var errorEl = document.querySelector('[data-testid="error"], [class*="error-message"]');
        if (errorEl && errorEl.innerText.trim()) return 'ERROR:' + errorEl.innerText.trim().substring(0, 100);

        // Check for generating/loading indicator
        var generating = document.querySelector('[data-testid="generating"], [class*="generating"], [class*="loading"]');
        if (generating) return 'GENERATING';

        // Check for new video cards beyond initial count
        var videos = document.querySelectorAll('video, [data-testid="video-card"], [class*="video-card"], [class*="VideoCard"]');
        if (videos.length > ${initialCount}) return 'NEW_VIDEO:' + videos.length;

        // Check if the first video has a src/download link
        var firstVideo = document.querySelector('video[src]:not([src=""])');
        if (firstVideo) return 'VIDEO_READY:' + (firstVideo.src || '');

        return 'WAITING';
      })()
    `).catch(() => 'WAITING');

    const s = status.trim();
    console.log(`[sora] Poll ${genId}: ${s.substring(0, 80)}`);

    if (s.startsWith('ERROR:')) {
      throw new Error(`Sora generation error: ${s.slice(6)}`);
    }
    if (s.startsWith('NEW_VIDEO:') || s.startsWith('VIDEO_READY:')) {
      return genId; // Signal that video is ready for download
    }
  }

  throw new Error(`Sora generation timed out after ${timeout / 1000}s`);
}

/**
 * Download the most recently generated Sora video by triggering the download
 * button on the page and waiting for the file to appear in ~/Downloads.
 * Returns the local file path.
 */
export async function downloadLatestVideo(driver: SafariDriver): Promise<string> {
  // Click the download button on the first video card
  await driver.executeJS(`
    (function() {
      // Hover the first video to reveal controls
      var firstCard = document.querySelector('[data-testid="video-card"], [class*="VideoCard"], [class*="video-card"]');
      if (firstCard) {
        firstCard.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        firstCard.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      }
    })()
  `).catch(() => {});

  await driver.wait(800);

  const clicked = await driver.executeJS(`
    (function() {
      // Find download button — try multiple strategies
      var btn = document.querySelector('[data-testid="download-button"]')
        || document.querySelector('[aria-label*="download" i]')
        || document.querySelector('[title*="download" i]');

      if (!btn) {
        var allBtns = Array.from(document.querySelectorAll('button, a'));
        btn = allBtns.find(b => /download/i.test(b.getAttribute('aria-label') || b.getAttribute('title') || b.innerText || ''));
      }

      if (btn) { btn.click(); return 'clicked'; }
      return 'no-btn';
    })()
  `);

  if (clicked.trim() !== 'clicked') {
    throw new Error('Could not find download button on sora.com video card.');
  }

  // Wait for file to appear in Downloads
  const downloadDir = path.join(os.homedir(), 'Downloads');
  const deadline = Date.now() + 60_000;

  while (Date.now() < deadline) {
    await driver.wait(2000);
    const files = await fs.readdir(downloadDir).catch(() => [] as string[]);
    const soraFiles = files
      .filter(f => (f.endsWith('.mp4') || f.endsWith('.mov') || f.endsWith('.webm')) && !f.startsWith('.'))
      .map(f => ({ name: f, fullPath: path.join(downloadDir, f) }));

    if (soraFiles.length > 0) {
      // Get the most recently modified mp4
      const stats = await Promise.all(
        soraFiles.map(async f => ({ ...f, mtime: (await fs.stat(f.fullPath)).mtimeMs }))
      );
      stats.sort((a, b) => b.mtime - a.mtime);
      const newest = stats[0];

      // Must be newer than when we started (within last 90s)
      if (Date.now() - newest.mtime < 90_000) {
        console.log(`[sora] Downloaded: ${newest.fullPath}`);
        return newest.fullPath;
      }
    }
  }

  throw new Error('Timed out waiting for Sora video download to appear in ~/Downloads');
}

// ─── Watermark Removal ────────────────────────────────────────────────────────

const CLEANER_CLI = path.join(
  os.homedir(),
  'Documents/Software/MediaPoster/Backend/SoraWatermarkCleaner/cli.py'
);
const CLEANER_VENV = path.join(
  os.homedir(),
  'Documents/Software/MediaPoster/Backend/venv/bin/python3'
);

export async function removeWatermark(videoPath: string): Promise<string> {
  const inputDir = path.dirname(videoPath);
  const inputFile = path.basename(videoPath);
  const outputDir = path.join(os.tmpdir(), `sora-cleaned-${Date.now()}`);
  await fs.mkdir(outputDir, { recursive: true });

  // Check which python to use
  let python = 'python3';
  try {
    await fs.access(CLEANER_VENV);
    python = CLEANER_VENV;
  } catch { /* use system python3 */ }

  const cmd = `cd ${JSON.stringify(path.dirname(CLEANER_CLI))} && ${python} ${JSON.stringify(CLEANER_CLI)} -i ${JSON.stringify(inputDir)} -o ${JSON.stringify(outputDir)} --quiet`;
  console.log(`[sora] Running watermark removal on ${inputFile}...`);

  try {
    await execAsync(cmd, { timeout: 10 * 60 * 1000 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Watermark removal failed: ${msg.substring(0, 300)}`);
  }

  // Find the cleaned output file
  const outputs = await fs.readdir(outputDir).catch(() => [] as string[]);
  const cleaned = outputs.find(f => f.endsWith('.mp4') || f.endsWith('.mov') || f.endsWith('.webm'));
  if (!cleaned) {
    throw new Error(`Watermark removal completed but no output file found in ${outputDir}`);
  }

  const cleanedPath = path.join(outputDir, cleaned);
  console.log(`[sora] Watermark removed: ${cleanedPath}`);
  return cleanedPath;
}
