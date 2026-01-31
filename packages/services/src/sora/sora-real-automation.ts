/**
 * Sora Real Automation
 * 
 * REAL Safari automation for Sora using AppleScript.
 * NO MOCK DATA - All interactions happen with the actual browser.
 * 
 * Features:
 * - Enter prompts with @isaiahdupree character prefix
 * - Poll drafts/library page to detect new videos
 * - Download completed videos
 */

import { SafariExecutor } from '../safari/safari-executor';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// TYPES
// ============================================================================

export interface SoraRealConfig {
  characterPrefix: string;
  baseUrl: string;
  libraryUrl: string;
  downloadPath: string;
  pollIntervalMs: number;
  maxPollAttempts: number;
  timeout: number;
}

export interface PromptResult {
  success: boolean;
  promptText: string;
  hasCharacterPrefix: boolean;
  timestamp: number;
  error?: string;
  screenshot?: string;
}

export interface Draft {
  id: string;
  prompt: string;
  timestamp: number;
  status: 'generating' | 'ready' | 'failed' | 'unknown';
  thumbnailUrl?: string;
  videoUrl?: string;
}

export interface PollResult {
  success: boolean;
  drafts: Draft[];
  newDrafts: Draft[];
  draftCountBefore: number;
  draftCountAfter: number;
  timestamp: number;
  error?: string;
}

export interface DownloadResult {
  success: boolean;
  draftId: string;
  downloadPath?: string;
  fileSize?: number;
  timestamp: number;
  error?: string;
}

// ============================================================================
// DEFAULT CONFIG
// ============================================================================

export const DEFAULT_SORA_REAL_CONFIG: SoraRealConfig = {
  characterPrefix: '@isaiahdupree',
  baseUrl: 'https://sora.chatgpt.com',
  libraryUrl: 'https://sora.chatgpt.com/library',
  downloadPath: '/Users/isaiahdupree/Downloads/sora-videos',
  pollIntervalMs: 30000,
  maxPollAttempts: 40,
  timeout: 30000,
};

// ============================================================================
// SORA REAL AUTOMATION CLASS
// ============================================================================

export class SoraRealAutomation {
  private safari: SafariExecutor;
  private config: SoraRealConfig;
  private knownDraftIds: Set<string> = new Set();
  private lastDraftCount: number = 0;

  constructor(config?: Partial<SoraRealConfig>) {
    this.config = { ...DEFAULT_SORA_REAL_CONFIG, ...config };
    this.safari = new SafariExecutor({ timeout: this.config.timeout });
    
    // Ensure download directory exists
    if (!fs.existsSync(this.config.downloadPath)) {
      fs.mkdirSync(this.config.downloadPath, { recursive: true });
    }
  }

  /**
   * Format prompt with character prefix at the BEGINNING
   */
  formatPrompt(text: string): string {
    const trimmed = text.trim();
    if (trimmed.startsWith(this.config.characterPrefix)) {
      return trimmed;
    }
    return `${this.config.characterPrefix} ${trimmed}`;
  }

  /**
   * Navigate to Sora and enter a prompt
   * REAL IMPLEMENTATION - Uses actual Safari automation
   */
  async submitPrompt(promptText: string): Promise<PromptResult> {
    const timestamp = Date.now();
    const formattedPrompt = this.formatPrompt(promptText);
    
    console.log(`[SORA] Submitting prompt: "${formattedPrompt.slice(0, 50)}..."`);

    try {
      // Step 1: Navigate to Sora
      const navResult = await this.safari.navigateWithVerification(
        this.config.baseUrl,
        'sora.com',
        3
      );

      if (!navResult.success) {
        return {
          success: false,
          promptText: formattedPrompt,
          hasCharacterPrefix: formattedPrompt.startsWith(this.config.characterPrefix),
          timestamp,
          error: `Failed to navigate to Sora: ${navResult.error}`,
        };
      }

      // Step 2: Wait for page to fully load
      await this.wait(3000);

      // Step 3: Find and click the prompt input area
      const clickInputResult = await this.safari.executeJS(`
        (function() {
          // Try multiple selectors for the prompt input
          const selectors = [
            'textarea[placeholder*="Describe"]',
            'textarea[placeholder*="describe"]',
            '[data-testid="prompt-input"]',
            '[contenteditable="true"]',
            'textarea'
          ];
          
          for (const selector of selectors) {
            const el = document.querySelector(selector);
            if (el) {
              el.focus();
              el.click();
              return JSON.stringify({ found: true, selector });
            }
          }
          return JSON.stringify({ found: false });
        })();
      `);

      if (!clickInputResult.success) {
        return {
          success: false,
          promptText: formattedPrompt,
          hasCharacterPrefix: formattedPrompt.startsWith(this.config.characterPrefix),
          timestamp,
          error: 'Failed to find prompt input',
        };
      }

      await this.wait(500);

      // Step 4: Clear any existing text and type the prompt
      await this.safari.executeJS(`
        (function() {
          const el = document.activeElement;
          if (el && (el.tagName === 'TEXTAREA' || el.contentEditable === 'true')) {
            if (el.tagName === 'TEXTAREA') {
              el.value = '';
            } else {
              el.textContent = '';
            }
          }
        })();
      `);

      // Step 5: Type the prompt using clipboard paste (supports special characters)
      await this.safari.typeViaClipboard(formattedPrompt);

      await this.wait(500);

      // Step 6: Verify the prompt was entered correctly
      const verifyResult = await this.safari.executeJS(`
        (function() {
          const el = document.activeElement;
          let value = '';
          if (el) {
            if (el.tagName === 'TEXTAREA') {
              value = el.value;
            } else if (el.contentEditable === 'true') {
              value = el.textContent || el.innerText;
            }
          }
          return JSON.stringify({ 
            value: value,
            startsWithPrefix: value.startsWith('${this.config.characterPrefix}')
          });
        })();
      `);

      let hasCharacterPrefix = false;
      if (verifyResult.success && verifyResult.result) {
        try {
          const parsed = JSON.parse(verifyResult.result);
          hasCharacterPrefix = parsed.startsWithPrefix;
          console.log(`[SORA] Prompt verified: starts with prefix = ${hasCharacterPrefix}`);
        } catch {
          console.log('[SORA] Could not parse verification result');
        }
      }

      // Step 7: Click the generate button
      const clickGenerateResult = await this.safari.executeJS(`
        (function() {
          const selectors = [
            'button[data-testid="generate-button"]',
            'button[type="submit"]',
            'button:contains("Create")',
            'button:contains("Generate")',
            '[role="button"]:contains("Create")'
          ];
          
          // Also try by text content
          const buttons = document.querySelectorAll('button');
          for (const btn of buttons) {
            const text = btn.textContent?.toLowerCase() || '';
            if (text.includes('create') || text.includes('generate')) {
              btn.click();
              return JSON.stringify({ clicked: true, text: btn.textContent });
            }
          }
          
          for (const selector of selectors) {
            try {
              const el = document.querySelector(selector);
              if (el) {
                el.click();
                return JSON.stringify({ clicked: true, selector });
              }
            } catch {}
          }
          return JSON.stringify({ clicked: false });
        })();
      `);

      // Take screenshot as proof
      const screenshotPath = path.join(this.config.downloadPath, `prompt_${timestamp}.png`);
      await this.safari.takeScreenshot(screenshotPath);

      return {
        success: true,
        promptText: formattedPrompt,
        hasCharacterPrefix,
        timestamp,
        screenshot: screenshotPath,
      };

    } catch (error) {
      return {
        success: false,
        promptText: formattedPrompt,
        hasCharacterPrefix: formattedPrompt.startsWith(this.config.characterPrefix),
        timestamp,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Poll the drafts/library page for videos
   * REAL IMPLEMENTATION - Scrapes actual Sora library page
   */
  async pollDrafts(): Promise<PollResult> {
    const timestamp = Date.now();
    const draftCountBefore = this.lastDraftCount;

    console.log(`[SORA] Polling drafts... (previously known: ${this.knownDraftIds.size})`);

    try {
      // Navigate to library
      const navResult = await this.safari.navigateWithVerification(
        this.config.libraryUrl,
        'sora.com',
        3
      );

      if (!navResult.success) {
        return {
          success: false,
          drafts: [],
          newDrafts: [],
          draftCountBefore,
          draftCountAfter: draftCountBefore,
          timestamp,
          error: `Failed to navigate to library: ${navResult.error}`,
        };
      }

      // Wait for page to load
      await this.wait(3000);

      // Scrape drafts from the page
      const scrapeResult = await this.safari.executeJS(`
        (function() {
          const drafts = [];
          
          // Try multiple selectors for draft items
          const itemSelectors = [
            '[data-testid="video-card"]',
            '[data-testid="draft-item"]',
            '.video-card',
            '.draft-item',
            'article',
            '[role="listitem"]'
          ];
          
          let items = [];
          for (const selector of itemSelectors) {
            items = document.querySelectorAll(selector);
            if (items.length > 0) break;
          }
          
          items.forEach((item, index) => {
            // Extract draft info
            const id = item.getAttribute('data-id') || 
                       item.getAttribute('id') || 
                       'draft_' + Date.now() + '_' + index;
            
            // Find prompt text
            const promptEl = item.querySelector('[data-testid="prompt"], .prompt, p, span');
            const prompt = promptEl?.textContent?.trim() || '';
            
            // Find status
            const statusEl = item.querySelector('[data-testid="status"], .status');
            const statusText = statusEl?.textContent?.toLowerCase() || '';
            let status = 'unknown';
            if (statusText.includes('generating') || statusText.includes('processing')) {
              status = 'generating';
            } else if (statusText.includes('ready') || statusText.includes('complete')) {
              status = 'ready';
            } else if (statusText.includes('fail') || statusText.includes('error')) {
              status = 'failed';
            }
            
            // Check for video element (indicates ready)
            const video = item.querySelector('video');
            if (video) {
              status = 'ready';
            }
            
            // Find thumbnail
            const img = item.querySelector('img');
            const thumbnailUrl = img?.src || '';
            
            // Find download link
            const downloadLink = item.querySelector('a[download], [data-testid="download"]');
            const videoUrl = downloadLink?.getAttribute('href') || '';
            
            drafts.push({
              id,
              prompt,
              status,
              thumbnailUrl,
              videoUrl,
              timestamp: Date.now()
            });
          });
          
          return JSON.stringify({ 
            drafts, 
            count: drafts.length,
            url: window.location.href 
          });
        })();
      `);

      let drafts: Draft[] = [];
      
      if (scrapeResult.success && scrapeResult.result) {
        try {
          const parsed = JSON.parse(scrapeResult.result);
          drafts = parsed.drafts || [];
          console.log(`[SORA] Found ${drafts.length} drafts on page`);
        } catch (e) {
          console.log('[SORA] Could not parse draft results');
        }
      }

      // Find new drafts
      const newDrafts = drafts.filter(d => !this.knownDraftIds.has(d.id));
      
      // Update known drafts
      for (const draft of drafts) {
        this.knownDraftIds.add(draft.id);
      }
      
      this.lastDraftCount = drafts.length;

      console.log(`[SORA] New drafts found: ${newDrafts.length}`);

      return {
        success: true,
        drafts,
        newDrafts,
        draftCountBefore,
        draftCountAfter: drafts.length,
        timestamp,
      };

    } catch (error) {
      return {
        success: false,
        drafts: [],
        newDrafts: [],
        draftCountBefore,
        draftCountAfter: draftCountBefore,
        timestamp,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Download a video from a draft
   * REAL IMPLEMENTATION - Triggers actual browser download
   */
  async downloadDraft(draft: Draft): Promise<DownloadResult> {
    const timestamp = Date.now();

    console.log(`[SORA] Downloading draft: ${draft.id}`);

    if (draft.status !== 'ready') {
      return {
        success: false,
        draftId: draft.id,
        timestamp,
        error: `Draft not ready: status is "${draft.status}"`,
      };
    }

    try {
      // If we have a direct video URL, download it
      if (draft.videoUrl) {
        const downloadPath = path.join(this.config.downloadPath, `${draft.id}.mp4`);
        
        // Use curl to download
        const { exec } = require('child_process');
        const { promisify } = require('util');
        const execAsync = promisify(exec);
        
        await execAsync(`curl -L -o "${downloadPath}" "${draft.videoUrl}"`, {
          timeout: 120000, // 2 minute timeout for video download
        });

        // Verify file exists and get size
        if (fs.existsSync(downloadPath)) {
          const stats = fs.statSync(downloadPath);
          console.log(`[SORA] Downloaded: ${downloadPath} (${stats.size} bytes)`);
          
          return {
            success: true,
            draftId: draft.id,
            downloadPath,
            fileSize: stats.size,
            timestamp,
          };
        }
      }

      // Otherwise, try to click download button in browser
      const clickDownloadResult = await this.safari.executeJS(`
        (function() {
          // Find the draft card
          const card = document.querySelector('[data-id="${draft.id}"]') || 
                       document.getElementById('${draft.id}');
          
          if (!card) {
            // Try clicking on the page to find download button
            const downloadBtns = document.querySelectorAll(
              'button[data-testid="download"], a[download], .download-btn'
            );
            if (downloadBtns.length > 0) {
              downloadBtns[0].click();
              return JSON.stringify({ clicked: true, method: 'global' });
            }
            return JSON.stringify({ clicked: false, error: 'Card not found' });
          }
          
          // Find download button within card
          const downloadBtn = card.querySelector(
            'button[data-testid="download"], a[download], .download'
          );
          
          if (downloadBtn) {
            downloadBtn.click();
            return JSON.stringify({ clicked: true, method: 'card' });
          }
          
          return JSON.stringify({ clicked: false, error: 'Download button not found' });
        })();
      `);

      // Wait for download to start
      await this.wait(3000);

      // Check Downloads folder for new file
      const downloadsDir = '/Users/isaiahdupree/Downloads';
      const files = fs.readdirSync(downloadsDir)
        .filter(f => f.endsWith('.mp4'))
        .map(f => ({
          name: f,
          path: path.join(downloadsDir, f),
          mtime: fs.statSync(path.join(downloadsDir, f)).mtime.getTime(),
        }))
        .sort((a, b) => b.mtime - a.mtime);

      // Get most recent mp4 file downloaded in last 30 seconds
      const recentFile = files.find(f => Date.now() - f.mtime < 30000);
      
      if (recentFile) {
        // Move to our download path
        const destPath = path.join(this.config.downloadPath, `${draft.id}.mp4`);
        fs.renameSync(recentFile.path, destPath);
        const stats = fs.statSync(destPath);
        
        console.log(`[SORA] Downloaded: ${destPath} (${stats.size} bytes)`);
        
        return {
          success: true,
          draftId: draft.id,
          downloadPath: destPath,
          fileSize: stats.size,
          timestamp,
        };
      }

      return {
        success: false,
        draftId: draft.id,
        timestamp,
        error: 'Download did not complete',
      };

    } catch (error) {
      return {
        success: false,
        draftId: draft.id,
        timestamp,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Full flow: Submit prompt, poll for completion, download
   */
  async generateAndDownload(promptText: string): Promise<{
    success: boolean;
    promptResult: PromptResult;
    pollResult?: PollResult;
    downloadResult?: DownloadResult;
    error?: string;
  }> {
    // Step 1: Submit prompt
    const promptResult = await this.submitPrompt(promptText);
    
    if (!promptResult.success) {
      return {
        success: false,
        promptResult,
        error: promptResult.error,
      };
    }

    // Step 2: Poll for new draft
    let newDraft: Draft | null = null;
    let pollResult: PollResult | undefined;
    
    for (let attempt = 0; attempt < this.config.maxPollAttempts; attempt++) {
      console.log(`[SORA] Poll attempt ${attempt + 1}/${this.config.maxPollAttempts}`);
      
      await this.wait(this.config.pollIntervalMs);
      
      pollResult = await this.pollDrafts();
      
      if (pollResult.newDrafts.length > 0) {
        // Find draft that matches our prompt
        newDraft = pollResult.newDrafts.find(d => 
          d.prompt.includes(this.config.characterPrefix) && d.status === 'ready'
        ) || null;
        
        if (newDraft) {
          console.log(`[SORA] Found ready draft: ${newDraft.id}`);
          break;
        }
      }
    }

    if (!newDraft) {
      return {
        success: false,
        promptResult,
        pollResult,
        error: 'No ready draft found after polling',
      };
    }

    // Step 3: Download
    const downloadResult = await this.downloadDraft(newDraft);

    return {
      success: downloadResult.success,
      promptResult,
      pollResult,
      downloadResult,
      error: downloadResult.error,
    };
  }

  /**
   * Get configuration
   */
  getConfig(): SoraRealConfig {
    return { ...this.config };
  }

  /**
   * Reset known drafts
   */
  resetKnownDrafts(): void {
    this.knownDraftIds.clear();
    this.lastDraftCount = 0;
  }

  private wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
