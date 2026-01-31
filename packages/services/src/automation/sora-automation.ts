/**
 * Sora Automation
 * 
 * Handles Sora video generation with:
 * - Prompt insertion with @isaiahdupree prefix
 * - Draft polling to detect and download new videos
 * - Rate limiting integration
 */

import type { AutomationCore, AutomationResult, ProofArtifact } from './automation-core';

// ============================================================================
// TYPES
// ============================================================================

export interface SoraConfig {
  baseUrl: string;
  promptInputSelector: string;
  generateButtonSelector: string;
  draftsUrl: string;
  draftItemSelector: string;
  draftVideoSelector: string;
  draftTimestampSelector: string;
  downloadButtonSelector: string;
  characterPrefix: string;
  pollIntervalMs: number;
  maxPollAttempts: number;
  downloadPath: string;
}

export interface SoraPrompt {
  text: string;
  aspectRatio?: '16:9' | '9:16' | '1:1';
  duration?: '5s' | '10s' | '15s' | '20s';
  style?: string;
}

export interface SoraDraft {
  id: string;
  prompt: string;
  timestamp: number;
  status: 'generating' | 'ready' | 'failed';
  videoUrl?: string;
  thumbnailUrl?: string;
}

export interface SoraGenerationResult {
  success: boolean;
  promptSubmitted: string;
  draftId?: string;
  videoDownloaded?: boolean;
  downloadPath?: string;
  proofs: ProofArtifact[];
  timing: {
    promptSubmittedAt: number;
    videoReadyAt?: number;
    downloadedAt?: number;
    totalDurationMs: number;
  };
}

export interface SoraPollResult {
  success: boolean;
  drafts: SoraDraft[];
  newDrafts: SoraDraft[];
  proofs: ProofArtifact[];
}

// ============================================================================
// DEFAULT CONFIG
// ============================================================================

export const DEFAULT_SORA_CONFIG: SoraConfig = {
  baseUrl: 'https://sora.com',
  promptInputSelector: 'textarea[placeholder*="Describe"]',
  generateButtonSelector: 'button[data-testid="generate-button"]',
  draftsUrl: 'https://sora.com/library',
  draftItemSelector: '[data-testid="draft-item"]',
  draftVideoSelector: 'video',
  draftTimestampSelector: 'time',
  downloadButtonSelector: '[data-testid="download-button"]',
  characterPrefix: '@isaiahdupree',
  pollIntervalMs: 30000, // 30 seconds
  maxPollAttempts: 40, // 40 * 30s = 20 minutes max
  downloadPath: '/Users/isaiahdupree/Downloads/sora-videos',
};

// ============================================================================
// SORA AUTOMATION CLASS
// ============================================================================

export class SoraAutomation {
  private core: AutomationCore;
  private config: SoraConfig;
  private knownDraftIds: Set<string> = new Set();
  private lastPollTime: number = 0;

  constructor(core: AutomationCore, config?: Partial<SoraConfig>) {
    this.core = core;
    this.config = { ...DEFAULT_SORA_CONFIG, ...config };
  }

  /**
   * Format prompt with character prefix
   */
  formatPrompt(prompt: SoraPrompt): string {
    const prefix = this.config.characterPrefix;
    const text = prompt.text.trim();
    
    // Ensure prefix is at the beginning
    if (text.startsWith(prefix)) {
      return text;
    }
    
    return `${prefix} ${text}`;
  }

  /**
   * Submit a prompt to Sora
   */
  async submitPrompt(prompt: SoraPrompt): Promise<AutomationResult<{ promptText: string; submitted: boolean }>> {
    const startTime = Date.now();
    const proofs: ProofArtifact[] = [];

    try {
      // Format prompt with prefix
      const formattedPrompt = this.formatPrompt(prompt);

      // Navigate to Sora
      const navResult = await this.core.navigateWithVerification(this.config.baseUrl);
      proofs.push(...navResult.proofs);

      if (!navResult.success) {
        return {
          success: false,
          data: null,
          error: 'Failed to navigate to Sora',
          proofs,
          timing: { startedAt: startTime, completedAt: Date.now(), durationMs: Date.now() - startTime },
        };
      }

      // Wait for prompt input
      const waitResult = await this.core.waitForElementWithProof(this.config.promptInputSelector, 10000);
      proofs.push(...waitResult.proofs);

      if (!waitResult.success) {
        return {
          success: false,
          data: null,
          error: 'Prompt input not found',
          proofs,
          timing: { startedAt: startTime, completedAt: Date.now(), durationMs: Date.now() - startTime },
        };
      }

      // Type the prompt
      const typeResult = await this.core.typeWithVerification(this.config.promptInputSelector, formattedPrompt);
      proofs.push(...typeResult.proofs);

      // Verify the prefix is present
      const hasPrefix = typeResult.data?.inputValue?.startsWith(this.config.characterPrefix);
      proofs.push({
        type: 'text_match',
        data: {
          expectedPrefix: this.config.characterPrefix,
          actualStart: typeResult.data?.inputValue?.slice(0, 20),
          hasPrefix,
        },
        timestamp: Date.now(),
        validator: 'prefix_verification',
        valid: hasPrefix === true,
      });

      if (!hasPrefix) {
        return {
          success: false,
          data: { promptText: formattedPrompt, submitted: false },
          error: 'Character prefix not found in prompt input',
          proofs,
          timing: { startedAt: startTime, completedAt: Date.now(), durationMs: Date.now() - startTime },
        };
      }

      // Click generate button
      const clickResult = await this.core.clickWithVerification(this.config.generateButtonSelector);
      proofs.push(...clickResult.proofs);

      return {
        success: clickResult.success,
        data: { promptText: formattedPrompt, submitted: clickResult.success },
        error: clickResult.success ? null : 'Failed to click generate button',
        proofs,
        timing: { startedAt: startTime, completedAt: Date.now(), durationMs: Date.now() - startTime },
      };

    } catch (error) {
      return {
        success: false,
        data: null,
        error: error instanceof Error ? error.message : 'Prompt submission failed',
        proofs,
        timing: { startedAt: startTime, completedAt: Date.now(), durationMs: Date.now() - startTime },
      };
    }
  }

  /**
   * Poll drafts page for new videos
   */
  async pollDrafts(): Promise<SoraPollResult> {
    const proofs: ProofArtifact[] = [];

    try {
      // Navigate to drafts/library
      const navResult = await this.core.navigateWithVerification(this.config.draftsUrl);
      proofs.push(...navResult.proofs);

      if (!navResult.success) {
        return {
          success: false,
          drafts: [],
          newDrafts: [],
          proofs,
        };
      }

      // Wait for draft items to load
      await this.core.waitForElementWithProof(this.config.draftItemSelector, 10000);

      // In a real implementation, we'd scrape the page for drafts
      // For now, simulate finding drafts
      const drafts = await this.scrapeDrafts();

      // Find new drafts
      const newDrafts = drafts.filter(d => !this.knownDraftIds.has(d.id));

      // Update known drafts
      for (const draft of drafts) {
        this.knownDraftIds.add(draft.id);
      }

      proofs.push({
        type: 'state_diff',
        data: {
          totalDrafts: drafts.length,
          newDrafts: newDrafts.length,
          knownDraftIds: this.knownDraftIds.size,
          pollTime: Date.now(),
        },
        timestamp: Date.now(),
        validator: 'draft_poll',
        valid: true,
      });

      this.lastPollTime = Date.now();

      return {
        success: true,
        drafts,
        newDrafts,
        proofs,
      };

    } catch (error) {
      proofs.push({
        type: 'state_diff',
        data: { error: error instanceof Error ? error.message : 'Unknown error' },
        timestamp: Date.now(),
        validator: 'draft_poll_error',
        valid: false,
      });

      return {
        success: false,
        drafts: [],
        newDrafts: [],
        proofs,
      };
    }
  }

  /**
   * Scrape drafts from the page (mock implementation)
   * In production, this would actually scrape the DOM
   */
  private async scrapeDrafts(): Promise<SoraDraft[]> {
    // This is a placeholder - real implementation would use browser.findElements
    // and extract data from each draft item
    return [];
  }

  /**
   * Download a specific draft video
   */
  async downloadDraft(draft: SoraDraft): Promise<AutomationResult<{ downloaded: boolean; path?: string }>> {
    const startTime = Date.now();
    const proofs: ProofArtifact[] = [];

    try {
      if (draft.status !== 'ready') {
        return {
          success: false,
          data: { downloaded: false },
          error: `Draft not ready: ${draft.status}`,
          proofs,
          timing: { startedAt: startTime, completedAt: Date.now(), durationMs: Date.now() - startTime },
        };
      }

      // Click the draft to open it
      // In real impl, we'd navigate to the draft's URL or click its element
      
      // Click download button
      const clickResult = await this.core.clickWithVerification(this.config.downloadButtonSelector);
      proofs.push(...clickResult.proofs);

      if (!clickResult.success) {
        return {
          success: false,
          data: { downloaded: false },
          error: 'Failed to click download button',
          proofs,
          timing: { startedAt: startTime, completedAt: Date.now(), durationMs: Date.now() - startTime },
        };
      }

      // Wait for download to start
      await this.sleep(2000);

      const downloadPath = `${this.config.downloadPath}/${draft.id}.mp4`;

      proofs.push({
        type: 'state_diff',
        data: {
          draftId: draft.id,
          downloadPath,
          timestamp: Date.now(),
        },
        timestamp: Date.now(),
        validator: 'download_initiated',
        valid: true,
      });

      return {
        success: true,
        data: { downloaded: true, path: downloadPath },
        error: null,
        proofs,
        timing: { startedAt: startTime, completedAt: Date.now(), durationMs: Date.now() - startTime },
      };

    } catch (error) {
      return {
        success: false,
        data: { downloaded: false },
        error: error instanceof Error ? error.message : 'Download failed',
        proofs,
        timing: { startedAt: startTime, completedAt: Date.now(), durationMs: Date.now() - startTime },
      };
    }
  }

  /**
   * Full generation flow: submit prompt, poll for completion, download
   */
  async generateAndDownload(prompt: SoraPrompt): Promise<SoraGenerationResult> {
    const startTime = Date.now();
    const proofs: ProofArtifact[] = [];

    // Step 1: Submit prompt
    const submitResult = await this.submitPrompt(prompt);
    proofs.push(...submitResult.proofs);

    if (!submitResult.success) {
      return {
        success: false,
        promptSubmitted: this.formatPrompt(prompt),
        proofs,
        timing: {
          promptSubmittedAt: startTime,
          totalDurationMs: Date.now() - startTime,
        },
      };
    }

    const promptSubmittedAt = Date.now();

    // Step 2: Poll for new draft
    let newDraft: SoraDraft | null = null;
    let attempts = 0;

    while (attempts < this.config.maxPollAttempts) {
      await this.sleep(this.config.pollIntervalMs);
      attempts++;

      const pollResult = await this.pollDrafts();
      proofs.push(...pollResult.proofs);

      if (pollResult.newDrafts.length > 0) {
        // Find draft matching our prompt (by checking if prompt contains our prefix)
        newDraft = pollResult.newDrafts.find(d => 
          d.prompt.startsWith(this.config.characterPrefix) && d.status === 'ready'
        ) || null;

        if (newDraft) {
          break;
        }
      }

      proofs.push({
        type: 'state_diff',
        data: { pollAttempt: attempts, maxAttempts: this.config.maxPollAttempts },
        timestamp: Date.now(),
        validator: 'poll_progress',
        valid: true,
      });
    }

    if (!newDraft) {
      return {
        success: false,
        promptSubmitted: submitResult.data?.promptText || this.formatPrompt(prompt),
        proofs,
        timing: {
          promptSubmittedAt,
          totalDurationMs: Date.now() - startTime,
        },
      };
    }

    const videoReadyAt = Date.now();

    // Step 3: Download the video
    const downloadResult = await this.downloadDraft(newDraft);
    proofs.push(...downloadResult.proofs);

    return {
      success: downloadResult.success,
      promptSubmitted: submitResult.data?.promptText || this.formatPrompt(prompt),
      draftId: newDraft.id,
      videoDownloaded: downloadResult.data?.downloaded,
      downloadPath: downloadResult.data?.path,
      proofs,
      timing: {
        promptSubmittedAt,
        videoReadyAt,
        downloadedAt: downloadResult.success ? Date.now() : undefined,
        totalDurationMs: Date.now() - startTime,
      },
    };
  }

  /**
   * Get latest draft from library
   */
  async getLatestDraft(): Promise<SoraDraft | null> {
    const pollResult = await this.pollDrafts();
    if (pollResult.drafts.length === 0) return null;

    // Sort by timestamp descending
    const sorted = [...pollResult.drafts].sort((a, b) => b.timestamp - a.timestamp);
    return sorted[0];
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get configuration
   */
  getConfig(): SoraConfig {
    return { ...this.config };
  }

  /**
   * Get known draft IDs
   */
  getKnownDraftIds(): string[] {
    return Array.from(this.knownDraftIds);
  }

  /**
   * Clear known drafts (for testing)
   */
  clearKnownDrafts(): void {
    this.knownDraftIds.clear();
  }
}
