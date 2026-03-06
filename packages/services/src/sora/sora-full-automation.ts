/**
 * Sora Full Automation
 * 
 * Two fundamental steps:
 * 1. Submit prompt with @isaiahdupree character
 * 2. Poll drafts until video ready, then download
 * 
 * Uses correct spinner detection: circle.-rotate-90
 */

import { SafariExecutor } from '../safari/safari-executor';
import { SORA_SELECTORS, JS_SET_TEXTAREA_VALUE } from './sora-selectors';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// ============================================================================
// TYPES
// ============================================================================

export interface SoraFullConfig {
  characterPrefix: string;
  baseUrl: string;
  draftsUrl: string;
  downloadPath: string;
  pollIntervalMs: number;
  maxPollAttempts: number;
}

export interface SubmitResult {
  success: boolean;
  prompt: string;
  hasPrefix: boolean;
  createClicked: boolean;
  error?: string;
  timestamp: number;
}

export interface PollResult {
  success: boolean;
  isProcessing: boolean;
  isReady: boolean;
  videoUrl?: string;
  draftHref?: string;
  pollCount: number;
  error?: string;
}

export interface DownloadResult {
  success: boolean;
  filePath?: string;
  fileSize?: number;
  error?: string;
}

export interface FullRunResult {
  submit: SubmitResult;
  poll?: PollResult;
  download?: DownloadResult;
  totalTimeMs: number;
}

export interface UsageInfo {
  success: boolean;
  videoGensLeft: number | null;
  freeCount: number | null;
  paidCount: number | null;
  nextAvailableDate: string | null;
  error?: string;
}

// ============================================================================
// DEFAULT CONFIG
// ============================================================================

export const DEFAULT_FULL_CONFIG: SoraFullConfig = {
  characterPrefix: '@isaiahdupree',
  baseUrl: 'https://sora.chatgpt.com',
  draftsUrl: 'https://sora.chatgpt.com/drafts',
  downloadPath: '/Users/isaiahdupree/Downloads/sora-videos',
  pollIntervalMs: 15000, // 15 seconds
  maxPollAttempts: 40,   // 10 minutes max
};

// ============================================================================
// SORA FULL AUTOMATION CLASS
// ============================================================================

export class SoraFullAutomation {
  private safari: SafariExecutor;
  private config: SoraFullConfig;

  constructor(config?: Partial<SoraFullConfig>) {
    this.config = { ...DEFAULT_FULL_CONFIG, ...config };
    this.safari = new SafariExecutor({ timeout: 30000 });

    // Ensure download directory exists
    if (!fs.existsSync(this.config.downloadPath)) {
      fs.mkdirSync(this.config.downloadPath, { recursive: true });
    }
  }

  // ==========================================================================
  // STEP 1: SUBMIT PROMPT
  // ==========================================================================

  async submitPrompt(promptText: string): Promise<SubmitResult> {
    const timestamp = Date.now();
    const fullPrompt = this.formatPrompt(promptText);

    console.log('[SORA] Step 1: Submit Prompt');
    console.log(`[SORA] Prompt: "${fullPrompt.slice(0, 60)}..."`);

    try {
      // Navigate to Sora
      console.log('[SORA] Navigating to Sora...');
      const navResult = await this.safari.navigateWithVerification(
        this.config.baseUrl,
        'sora.chatgpt.com',
        3
      );

      if (!navResult.success) {
        return {
          success: false,
          prompt: fullPrompt,
          hasPrefix: fullPrompt.startsWith(this.config.characterPrefix),
          createClicked: false,
          error: `Navigation failed: ${navResult.error}`,
          timestamp,
        };
      }

      await this.wait(3000);

      // Enter prompt using React-compatible method
      console.log('[SORA] Entering prompt...');
      const setResult = await this.safari.executeJS(JS_SET_TEXTAREA_VALUE(fullPrompt));
      const setParsed = JSON.parse(setResult.result || '{}');

      if (!setParsed.success) {
        return {
          success: false,
          prompt: fullPrompt,
          hasPrefix: false,
          createClicked: false,
          error: 'Failed to enter prompt',
          timestamp,
        };
      }

      console.log(`[SORA] Prompt entered, has prefix: ${setParsed.startsWithPrefix}`);
      await this.wait(1000);

      // Click Create video button
      console.log('[SORA] Clicking Create video...');
      const clickResult = await this.safari.executeJS(`
        (function() {
          const buttons = document.querySelectorAll('button');
          const btn = Array.from(buttons).find(b => b.textContent.includes('Create video'));
          if (!btn) return JSON.stringify({ clicked: false, error: 'Button not found' });
          if (btn.disabled) return JSON.stringify({ clicked: false, error: 'Button disabled' });
          btn.click();
          return JSON.stringify({ clicked: true });
        })();
      `);

      const clickParsed = JSON.parse(clickResult.result || '{}');
      console.log(`[SORA] Create clicked: ${clickParsed.clicked}`);

      return {
        success: clickParsed.clicked,
        prompt: fullPrompt,
        hasPrefix: setParsed.startsWithPrefix,
        createClicked: clickParsed.clicked,
        error: clickParsed.error,
        timestamp,
      };

    } catch (error) {
      return {
        success: false,
        prompt: fullPrompt,
        hasPrefix: fullPrompt.startsWith(this.config.characterPrefix),
        createClicked: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp,
      };
    }
  }

  // ==========================================================================
  // STEP 2: POLL UNTIL READY & DOWNLOAD
  // ==========================================================================

  async pollUntilReady(): Promise<PollResult> {
    console.log('\n[SORA] Step 2: Poll Until Ready');
    console.log(`[SORA] Polling every ${this.config.pollIntervalMs / 1000}s, max ${this.config.maxPollAttempts} attempts`);

    // Wait for generation to start
    await this.wait(5000);

    // Navigate to drafts
    console.log('[SORA] Navigating to drafts...');
    await this.safari.navigateWithVerification(this.config.draftsUrl, 'sora.chatgpt.com', 3);
    await this.wait(3000);

    for (let attempt = 1; attempt <= this.config.maxPollAttempts; attempt++) {
      console.log(`\n[SORA] Poll ${attempt}/${this.config.maxPollAttempts}`);

      // Check for processing spinner using correct selector
      const stateResult = await this.safari.executeJS(`
        (function() {
          // Correct spinner selector: circle with -rotate-90 class
          const spinner = document.querySelector('circle.-rotate-90');
          
          // Get first video card
          const firstCard = document.querySelector('main a[href*="/g/"], main a[href*="/d/gen"]');
          const video = firstCard?.querySelector('video');
          const hasVideoSrc = video && video.src && video.src.includes('http');
          const videoReady = video && video.readyState === 4;
          
          // Processing = spinner exists
          // Ready = no spinner AND video has src AND readyState is 4
          const isProcessing = !!spinner;
          const isReady = !spinner && hasVideoSrc && videoReady;
          
          return JSON.stringify({
            isProcessing,
            isReady,
            hasSpinner: !!spinner,
            hasVideoSrc,
            videoReadyState: video?.readyState,
            videoUrl: isReady ? video.src : null,
            draftHref: firstCard?.href || null
          });
        })();
      `);

      const state = JSON.parse(stateResult.result || '{}');
      console.log(`[SORA] Processing: ${state.isProcessing}, Ready: ${state.isReady}`);

      if (state.isReady && state.videoUrl) {
        console.log('[SORA] ✅ Video ready!');
        return {
          success: true,
          isProcessing: false,
          isReady: true,
          videoUrl: state.videoUrl,
          draftHref: state.draftHref,
          pollCount: attempt,
        };
      }

      if (!state.isProcessing && !state.isReady) {
        // No spinner but also no video - might need to refresh
        console.log('[SORA] No spinner, no video - refreshing...');
      }

      // After 15 polls with no video, do subtle mouse movement to trigger video loading
      if (attempt >= 15 && !state.isReady) {
        console.log('[SORA] 🖱️ Poll 15+ - performing mouse wiggle to trigger video load...');
        await this.mouseWiggle();
      }

      // At poll 30, do a full Safari restart to recover from stuck state
      if (attempt === 30) {
        console.log('[SORA] ⚠️ Poll 30 reached - performing Safari recovery...');
        await this.recoverSafari();
        await this.wait(5000);
        continue; // Skip the normal refresh, go straight to next poll
      }

      // Wait before next poll
      if (attempt < this.config.maxPollAttempts) {
        console.log(`[SORA] Waiting ${this.config.pollIntervalMs / 1000}s...`);
        await this.wait(this.config.pollIntervalMs);

        // Refresh page
        await this.safari.refresh();
        await this.wait(3000);
      }
    }

    return {
      success: false,
      isProcessing: true,
      isReady: false,
      pollCount: this.config.maxPollAttempts,
      error: 'Max poll attempts reached',
    };
  }

  async downloadVideo(videoUrl: string): Promise<DownloadResult> {
    console.log('\n[SORA] Downloading video...');

    const filename = `sora-${this.config.characterPrefix.replace('@', '')}-${Date.now()}.mp4`;
    const filePath = path.join(this.config.downloadPath, filename);

    try {
      const safeUrl = videoUrl.replace(/[`$\\!"]/g, '\\$&');
      await execAsync(`curl -L -o "${filePath}" "${safeUrl}"`, {
        timeout: 120000, // 2 minute timeout
      });

      if (fs.existsSync(filePath)) {
        const stats = fs.statSync(filePath);
        console.log(`[SORA] ✅ Downloaded: ${filePath} (${Math.round(stats.size / 1024)}KB)`);
        return {
          success: true,
          filePath,
          fileSize: stats.size,
        };
      }

      return {
        success: false,
        error: 'File not found after download',
      };

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Download failed',
      };
    }
  }

  // ==========================================================================
  // FULL RUN: SUBMIT + POLL + DOWNLOAD
  // ==========================================================================

  async fullRun(promptText: string): Promise<FullRunResult> {
    const startTime = Date.now();
    console.log('\n========================================');
    console.log('[SORA] FULL AUTOMATION RUN');
    console.log('========================================\n');

    // Step 1: Submit prompt
    const submitResult = await this.submitPrompt(promptText);

    if (!submitResult.success) {
      return {
        submit: submitResult,
        totalTimeMs: Date.now() - startTime,
      };
    }

    // Step 2: Poll until ready
    const pollResult = await this.pollUntilReady();

    if (!pollResult.success || !pollResult.videoUrl) {
      return {
        submit: submitResult,
        poll: pollResult,
        totalTimeMs: Date.now() - startTime,
      };
    }

    // Step 3: Download
    const downloadResult = await this.downloadVideo(pollResult.videoUrl);

    const totalTimeMs = Date.now() - startTime;
    console.log('\n========================================');
    console.log(`[SORA] COMPLETE - Total time: ${Math.round(totalTimeMs / 1000)}s`);
    console.log('========================================\n');

    return {
      submit: submitResult,
      poll: pollResult,
      download: downloadResult,
      totalTimeMs,
    };
  }

  // ==========================================================================
  // SAFARI RECOVERY - Close/reopen Safari and navigate to drafts
  // ==========================================================================

  async recoverSafari(): Promise<void> {
    console.log('[SORA] 🔄 Closing Safari...');
    
    try {
      // Close Safari
      await execAsync(`osascript -e 'tell application "Safari" to quit'`);
      await this.wait(3000);
      
      // Reopen Safari
      console.log('[SORA] 🔄 Reopening Safari...');
      await execAsync(`osascript -e 'tell application "Safari" to activate'`);
      await this.wait(2000);
      
      // Bring Safari to front and make sure it's selected
      console.log('[SORA] 🔄 Bringing Safari to front...');
      await execAsync(`osascript -e '
        tell application "Safari"
          activate
          set frontmost to true
        end tell
        tell application "System Events"
          tell process "Safari"
            set frontmost to true
          end tell
        end tell
      '`);
      await this.wait(2000);
      
      // Navigate to drafts URL
      console.log('[SORA] 🔄 Navigating to drafts...');
      await this.safari.navigateWithVerification(this.config.draftsUrl, 'sora.chatgpt.com', 3);
      await this.wait(3000);
      
      console.log('[SORA] ✅ Safari recovery complete');
    } catch (error) {
      console.error('[SORA] ❌ Safari recovery failed:', error);
      // Try to at least navigate to drafts
      await this.safari.navigateWithVerification(this.config.draftsUrl, 'sora.chatgpt.com', 3);
    }
  }

  // ==========================================================================
  // GET USAGE INFO
  // ==========================================================================

  async getUsage(): Promise<UsageInfo> {
    console.log('\n[SORA] Getting Usage Info...');

    try {
      // Navigate to Sora
      await this.safari.navigateWithVerification(this.config.baseUrl, 'sora.chatgpt.com', 3);
      await this.wait(3000);

      // Click Settings button with Radix UI event sequence
      console.log('[SORA] Opening Settings menu...');
      await this.safari.executeJS(`
        (function() {
          var btn = document.querySelector('button[aria-label="Settings"]');
          if (btn) {
            ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(function(t) {
              btn.dispatchEvent(new MouseEvent(t, {bubbles:true,cancelable:true,view:window}));
            });
          }
        })();
      `);
      await this.wait(1000);

      // Click Settings menu item
      console.log('[SORA] Clicking Settings menu item...');
      await this.safari.executeJS(`
        (function() {
          var items = document.querySelectorAll('[role=menuitem]');
          for (var i = 0; i < items.length; i++) {
            if (items[i].textContent.trim() === 'Settings') {
              items[i].click();
              break;
            }
          }
        })();
      `);
      await this.wait(1500);

      // Click Usage tab with Radix UI event sequence
      console.log('[SORA] Clicking Usage tab...');
      await this.safari.executeJS(`
        (function() {
          var dialog = document.querySelector('[role=dialog]');
          if (!dialog) return;
          var btns = dialog.querySelectorAll('button');
          for (var i = 0; i < btns.length; i++) {
            if (btns[i].textContent.trim() === 'Usage') {
              ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(function(t) {
                btns[i].dispatchEvent(new MouseEvent(t, {bubbles:true,cancelable:true,view:window}));
              });
              break;
            }
          }
        })();
      `);
      await this.wait(1500);

      // Extract usage info
      console.log('[SORA] Extracting usage info...');
      const result = await this.safari.executeJS(`
        (function() {
          var dialog = document.querySelector('[role=dialog]');
          var text = dialog ? dialog.innerText : '';
          
          // "26 video gens left"
          var gensMatch = text.match(/(\\d+)\\s*video\\s*gens?\\s*left/i);
          
          // "26 free"
          var freeMatch = text.match(/(\\d+)\\s*free/i);
          
          // "0 paid"
          var paidMatch = text.match(/(\\d+)\\s*paid/i);
          
          // "More available on Jan 31"
          var dateMatch = text.match(/available\\s+on\\s+([A-Za-z]+\\s*\\d+)/i);
          
          return JSON.stringify({
            videoGensLeft: gensMatch ? parseInt(gensMatch[1]) : null,
            freeCount: freeMatch ? parseInt(freeMatch[1]) : null,
            paidCount: paidMatch ? parseInt(paidMatch[1]) : null,
            nextAvailableDate: dateMatch ? dateMatch[1] : null
          });
        })();
      `);

      const usage = JSON.parse(result.result || '{}');

      // Close dialog
      await this.safari.executeJS(`
        (function() {
          var btns = document.querySelectorAll('button');
          for (var i = 0; i < btns.length; i++) {
            if (btns[i].textContent.trim().toLowerCase() === 'done') {
              btns[i].click();
              break;
            }
          }
        })();
      `);

      console.log(`[SORA] Usage: ${usage.videoGensLeft} gens left (${usage.freeCount} free, ${usage.paidCount} paid)`);
      if (usage.nextAvailableDate) {
        console.log(`[SORA] More available on: ${usage.nextAvailableDate}`);
      }

      return {
        success: true,
        videoGensLeft: usage.videoGensLeft,
        freeCount: usage.freeCount,
        paidCount: usage.paidCount,
        nextAvailableDate: usage.nextAvailableDate,
      };

    } catch (error) {
      return {
        success: false,
        videoGensLeft: null,
        freeCount: null,
        paidCount: null,
        nextAvailableDate: null,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  // ==========================================================================
  // HELPERS
  // ==========================================================================

  private formatPrompt(text: string): string {
    const trimmed = text.trim();
    if (trimmed.startsWith(this.config.characterPrefix)) {
      return trimmed;
    }
    return `${this.config.characterPrefix} ${trimmed}`;
  }

  private wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Subtle mouse movement to trigger video loading on page
   * Sometimes Sora videos won't load until there's mouse activity
   */
  private async mouseWiggle(): Promise<void> {
    try {
      // Use cliclick for reliable mouse movement on macOS
      await execAsync(`cliclick m:+10,+0 w:50 m:+0,+10 w:50 m:-10,+0 w:50 m:+0,-10`);
      
      // Also trigger scroll event in browser to help load videos
      await this.safari.executeJS(`
        (function() {
          // Scroll down slightly then back up to trigger lazy loading
          window.scrollBy(0, 50);
          setTimeout(() => window.scrollBy(0, -50), 200);
          
          // Also hover over video elements to trigger loading
          const videos = document.querySelectorAll('video');
          videos.forEach(v => {
            v.dispatchEvent(new MouseEvent('mouseenter', {bubbles: true}));
            v.dispatchEvent(new MouseEvent('mouseover', {bubbles: true}));
          });
          
          return JSON.stringify({triggered: true, videoCount: videos.length});
        })();
      `);
      
      console.log('[SORA] ✅ Mouse wiggle complete');
    } catch (error) {
      console.log('[SORA] ⚠️ Mouse wiggle failed (non-fatal):', error instanceof Error ? error.message : 'Unknown');
    }
  }

  // ==========================================================================
  // LIBRARY SCRAPE: get all user videos directly from Sora /drafts
  // ==========================================================================

  async getLibrary(limit = 50): Promise<{
    success: boolean;
    videos: Array<{ id: string; prompt: string; videoUrl?: string; thumbnailUrl?: string; createdAt?: string; status: string }>;
    total: number;
    error?: string;
  }> {
    console.log('[SORA] Scraping library from /drafts...');
    try {
      await this.safari.navigateWithVerification(this.config.draftsUrl, 'sora.chatgpt.com', 3);
      await this.wait(3000);

      const result = await this.safari.executeJS(`
        (function() {
          var videos = [];
          // Video cards on drafts/library page — try multiple selectors
          var cards = Array.from(document.querySelectorAll('[data-testid="video-card"], [class*="VideoCard"], [class*="video-card"], article, [class*="DraftItem"], [class*="draft-item"]'));
          if (!cards.length) {
            // Fallback: any card with a video or thumbnail
            cards = Array.from(document.querySelectorAll('[class*="card"], [class*="item"], [class*="grid"] > *')).filter(function(el) {
              return el.querySelector('video, img[src*="sora"], [class*="thumb"]');
            });
          }
          // Also try to get from the page's __NEXT_DATA__ or window state
          var nextData = null;
          try {
            var nd = document.getElementById('__NEXT_DATA__');
            if (nd) nextData = JSON.parse(nd.textContent);
          } catch(e) {}

          // Extract card data
          for (var i = 0; i < Math.min(cards.length, ${limit}); i++) {
            var card = cards[i];
            var vid = card.querySelector('video');
            var img = card.querySelector('img');
            var link = card.querySelector('a[href*="/g/"]') || card.closest('a[href*="/g/"]');
            var href = link ? link.getAttribute('href') : '';
            var soraId = (href.match(/\\/g\\/([^/?#]+)/) || [])[1] || '';
            var promptEl = card.querySelector('[class*="prompt"], [class*="caption"], p, span');
            var prompt = promptEl ? promptEl.textContent.trim().slice(0, 200) : '';
            videos.push({
              id: soraId || ('draft-' + i),
              prompt: prompt,
              videoUrl: vid ? (vid.src || vid.getAttribute('src')) : undefined,
              thumbnailUrl: img ? (img.src || img.getAttribute('src')) : undefined,
              href: href,
              status: 'library'
            });
          }
          return JSON.stringify({ videos: videos, cardCount: cards.length, hasNextData: !!nextData, url: window.location.href });
        })();
      `);

      const parsed = typeof result === 'string' ? JSON.parse(result) : result;
      console.log('[SORA] Library: found', parsed.cardCount, 'cards, extracted', parsed.videos?.length, 'videos');
      return { success: true, videos: parsed.videos || [], total: parsed.cardCount || 0 };
    } catch (e) {
      return { success: false, videos: [], total: 0, error: e instanceof Error ? e.message : String(e) };
    }
  }

  // ==========================================================================
  // EXPLORE SCRAPE: get trending/featured community videos from Sora
  // ==========================================================================

  async getExplore(limit = 30): Promise<{
    success: boolean;
    videos: Array<{ id: string; prompt: string; author?: string; videoUrl?: string; thumbnailUrl?: string; views?: number; likes?: number }>;
    total: number;
    pageUrl: string;
    error?: string;
  }> {
    console.log('[SORA] Scraping explore/featured page...');
    // Try /explore first, fall back to base URL featured section
    const explorePaths = ['/explore', '/featured', '/trending', '/?tab=explore', '/'];
    let lastError = '';

    for (const explorePath of explorePaths) {
      const url = this.config.baseUrl + explorePath;
      try {
        await this.safari.navigateWithVerification(url, 'sora.chatgpt.com', 3);
        await this.wait(3000);

        const result = await this.safari.executeJS(`
          (function() {
            var pageUrl = window.location.href;
            var videos = [];
            // Look for community/explore video cards
            var cards = Array.from(document.querySelectorAll('[class*="feed"] [class*="card"], [class*="explore"] [class*="card"], [class*="featured"] [class*="card"], [class*="community"] [class*="card"]'));
            if (!cards.length) {
              // Broader fallback
              cards = Array.from(document.querySelectorAll('[class*="card"], [class*="item"], [class*="grid"] > *')).filter(function(el) {
                return el.querySelector('video, img') && (el.querySelector('a[href*="/g/"], [class*="prompt"], p'));
              });
            }
            for (var i = 0; i < Math.min(cards.length, ${limit}); i++) {
              var card = cards[i];
              var vid = card.querySelector('video');
              var img = card.querySelector('img');
              var link = card.querySelector('a[href*="/g/"]') || card.closest('a[href*="/g/"]');
              var href = link ? link.getAttribute('href') : '';
              var soraId = (href.match(/\\/g\\/([^/?#]+)/) || [])[1] || '';
              var promptEl = card.querySelector('[class*="prompt"], p, span, figcaption');
              var authorEl = card.querySelector('[class*="author"], [class*="user"], [class*="creator"]');
              var statEls = Array.from(card.querySelectorAll('[class*="stat"], [class*="count"], [class*="metric"]'));
              videos.push({
                id: soraId || ('explore-' + i),
                prompt: promptEl ? promptEl.textContent.trim().slice(0, 200) : '',
                author: authorEl ? authorEl.textContent.trim().slice(0, 50) : undefined,
                videoUrl: vid ? (vid.src || vid.getAttribute('src')) : undefined,
                thumbnailUrl: img ? (img.src || img.getAttribute('src')) : undefined,
                href: href,
                rawStats: statEls.map(function(s) { return s.textContent.trim(); }),
              });
            }
            return JSON.stringify({ videos: videos, cardCount: cards.length, pageUrl: pageUrl });
          })();
        `);

        const parsed = typeof result === 'string' ? JSON.parse(result) : result;
        console.log('[SORA] Explore @', parsed.pageUrl, ': found', parsed.cardCount, 'cards');
        if (parsed.videos && parsed.videos.length > 0) {
          return { success: true, videos: parsed.videos, total: parsed.cardCount || 0, pageUrl: parsed.pageUrl };
        }
        lastError = `No videos found on ${url} (${parsed.cardCount} cards)`;
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
      }
    }

    return { success: false, videos: [], total: 0, pageUrl: '', error: 'No explore data found. Tried: ' + explorePaths.join(', ') + '. Last error: ' + lastError };
  }

  // ==========================================================================
  // GET SORA PLATFORM LEADERBOARD (live scrape from sora.chatgpt.com)
  // ==========================================================================

  async getPlatformLeaderboard(): Promise<{
    success: boolean;
    sections: Array<{ section: string; entries: Array<{ rank: number; username: string; views: number | null; likes: number | null; comments: number | null; post_href: string }> }>;
    raw_text: string;
    error?: string;
  }> {
    console.log('\n[SORA] Scraping platform leaderboard from /explore...');
    try {
      await this.safari.navigateWithVerification(this.config.baseUrl + '/explore', 'sora.chatgpt.com', 3);
      await this.wait(3000);

      const result = await this.safari.executeJS(`
        (function() {
          var allText = document.body.innerText;
          var postHrefs = Array.from(document.querySelectorAll('a[href*="/p/s_"]'))
            .map(function(a) { return a.getAttribute('href'); })
            .filter(function(h, i, arr) { return arr.indexOf(h) === i; }); // deduplicate

          // Parse the visible text: pattern is username followed by 3 numbers (views likes comments)
          // Text looks like: "\\nmemexpert\\n\\n916\\n\\n291\\n\\n125\\n\\n"
          var lines = allText.split('\\n').map(function(l) { return l.trim(); }).filter(Boolean);
          var NAV = ['Activity','Home','Explore','Search','Drafts','Profile','Settings','Attach media','Storyboard','Create video','For you'];
          var entries = [];
          var i = 0;
          while (i < lines.length && entries.length < 30) {
            var line = lines[i];
            // Skip nav items and empty-ish lines
            if (NAV.indexOf(line) !== -1 || line.length > 60) { i++; continue; }
            // A username line: non-numeric, reasonable length
            if (!line.match(/^[\\d,.K]+$/) && line.length >= 2 && line.length <= 40) {
              // Collect next up to 3 numeric values
              var nums = [];
              var j = i + 1;
              while (j < lines.length && nums.length < 3) {
                var n = lines[j].replace(/,/g, '').replace(/K$/i, '000');
                if (/^[\\d.]+$/.test(n)) { nums.push(parseFloat(n)); j++; }
                else if (lines[j].match(/^[\\d,.K]+$/)) { nums.push(parseFloat(lines[j].replace(/,/g,'').replace(/K$/i,'000'))); j++; }
                else break;
              }
              if (nums.length >= 1) {
                entries.push({
                  rank: entries.length + 1,
                  username: line,
                  views: nums[0] ?? null,
                  likes: nums[1] ?? null,
                  comments: nums[2] ?? null,
                  post_href: postHrefs[entries.length] || ''
                });
                i = j;
                continue;
              }
            }
            i++;
          }

          return JSON.stringify({
            entries: entries,
            post_hrefs_count: postHrefs.length,
            raw_text: allText.slice(0, 4000),
            page_url: location.href
          });
        })();
      `);

      const raw = typeof result === 'string' ? result : (result as any).result || '{}';
      const parsed = JSON.parse(raw);
      console.log(`[SORA] Platform leaderboard: ${parsed.entries?.length ?? 0} creators from explore feed`);

      // Wrap as single "Trending" section to match existing schema
      const sections = parsed.entries?.length ? [{ section: 'Trending', entries: parsed.entries }] : [];
      return { success: true, sections, raw_text: parsed.raw_text || '' };
    } catch (error) {
      return { success: false, sections: [], raw_text: '', error: error instanceof Error ? error.message : String(error) };
    }
  }

  // ==========================================================================
  // GET MY VIDEO STATS (live scrape from sora.chatgpt.com/drafts)
  // ==========================================================================

  async getMyVideoStats(limit = 20): Promise<{
    success: boolean;
    videos: Array<{ id: string; title: string; views: number | null; likes: number | null; status: string; href: string; createdAt?: string }>;
    total_found: number;
    page_url: string;
    error?: string;
  }> {
    console.log('\n[SORA] Scraping my video stats from drafts...');
    try {
      await this.safari.navigateWithVerification(this.config.draftsUrl, 'sora.chatgpt.com', 3);
      await this.wait(3000);

      const result = await this.safari.executeJS(`
        (function() {
          var videos = [];
          // Drafts page uses /d/gen_XXXX hrefs; public posts use /p/s_XXXX or /g/XXXX
          var allLinks = Array.from(document.querySelectorAll('a[href]')).filter(function(a) {
            var h = a.getAttribute('href') || '';
            return h.match(/\\/(d\\/gen_|g\\/|gen\\/|p\\/s_)/);
          });
          var seen = new Set();
          var cards = allLinks.filter(function(a) {
            var h = a.getAttribute('href');
            if (seen.has(h)) return false;
            seen.add(h);
            return true;
          });

          // Also parse page text to get prompts — they appear as sibling text to each card
          var allText = document.body.innerText;

          for (var i = 0; i < Math.min(cards.length, ${limit}); i++) {
            var card = cards[i];
            var href = card.getAttribute('href') || '';

            // Extract ID: handle /d/gen_XXXX, /g/XXXX, /gen/XXXX, /p/s_XXXX
            var id = href.replace(/^.*\\/(?:d\\/|p\\/)?/, '').split('?')[0] || ('v' + i);

            // Walk up to find a container with meaningful text (the prompt)
            var scope = card;
            var title = '';
            for (var depth = 0; depth < 6 && !title; depth++) {
              scope = scope.parentElement;
              if (!scope) break;
              var txt = scope.innerText || '';
              // Look for @-prefixed prompt text
              var promptMatch = txt.match(/@[a-zA-Z0-9_]+\\s+([^\\n]{10,})/);
              if (promptMatch) { title = promptMatch[0].trim().slice(0, 200); break; }
              // Or any substantial text paragraph
              var lines = txt.split('\\n').map(function(l){return l.trim();}).filter(function(l){ return l.length > 15 && !l.match(/^(NEW|Edit|Select|Attach|Storyboard|Settings|Create)$/); });
              if (lines.length) { title = lines[0].slice(0, 200); break; }
            }

            // Sora drafts don't show public view/like stats — note as null
            videos.push({ id: id, title: title, views: null, likes: null, status: 'draft', href: href, createdAt: undefined });
          }

          return JSON.stringify({ videos: videos, total_found: allLinks.length, page_url: location.href });
        })();
      `);

      const raw = typeof result === 'string' ? result : (result as any).result || '{}';
      const parsed = JSON.parse(raw);
      console.log(`[SORA] My stats: ${parsed.total_found} links, scraped ${parsed.videos?.length ?? 0}`);

      return { success: true, videos: parsed.videos || [], total_found: parsed.total_found || 0, page_url: parsed.page_url || '' };
    } catch (error) {
      return { success: false, videos: [], total_found: 0, page_url: '', error: error instanceof Error ? error.message : String(error) };
    }
  }

  getConfig(): SoraFullConfig {
    return { ...this.config };
  }
}
