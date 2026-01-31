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
      await execAsync(`curl -L -o "${filePath}" "${videoUrl}"`, {
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

  getConfig(): SoraFullConfig {
    return { ...this.config };
  }
}
