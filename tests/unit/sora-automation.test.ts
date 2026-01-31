/**
 * Sora Automation Tests
 * 
 * Tests for:
 * - Prompt insertion with @isaiahdupree prefix
 * - Draft polling to detect new videos
 * - Download verification
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ============================================================================
// MOCK TYPES
// ============================================================================

interface SoraConfig {
  baseUrl: string;
  promptInputSelector: string;
  generateButtonSelector: string;
  draftsUrl: string;
  draftItemSelector: string;
  downloadButtonSelector: string;
  characterPrefix: string;
  pollIntervalMs: number;
  maxPollAttempts: number;
  downloadPath: string;
}

interface SoraPrompt {
  text: string;
  aspectRatio?: '16:9' | '9:16' | '1:1';
  duration?: '5s' | '10s' | '15s' | '20s';
}

interface SoraDraft {
  id: string;
  prompt: string;
  timestamp: number;
  status: 'generating' | 'ready' | 'failed';
  videoUrl?: string;
}

// ============================================================================
// MOCK SORA AUTOMATION
// ============================================================================

class MockSoraAutomation {
  private config: SoraConfig;
  private knownDraftIds: Set<string> = new Set();
  private mockDrafts: SoraDraft[] = [];
  private promptHistory: string[] = [];

  constructor(config?: Partial<SoraConfig>) {
    this.config = {
      baseUrl: 'https://sora.com',
      promptInputSelector: 'textarea[placeholder*="Describe"]',
      generateButtonSelector: 'button[data-testid="generate-button"]',
      draftsUrl: 'https://sora.com/library',
      draftItemSelector: '[data-testid="draft-item"]',
      downloadButtonSelector: '[data-testid="download-button"]',
      characterPrefix: '@isaiahdupree',
      pollIntervalMs: 1000, // Short for tests
      maxPollAttempts: 5,
      downloadPath: '/tmp/sora-videos',
      ...config,
    };
  }

  /**
   * Format prompt with character prefix at the beginning
   */
  formatPrompt(prompt: SoraPrompt): string {
    const prefix = this.config.characterPrefix;
    const text = prompt.text.trim();
    
    // If already has prefix, return as-is
    if (text.startsWith(prefix)) {
      return text;
    }
    
    // Add prefix at the beginning
    return `${prefix} ${text}`;
  }

  /**
   * Validate that prompt has the required prefix
   */
  validatePromptPrefix(promptText: string): { valid: boolean; prefix: string; hasPrefix: boolean } {
    const prefix = this.config.characterPrefix;
    const hasPrefix = promptText.startsWith(prefix);
    
    return {
      valid: hasPrefix,
      prefix,
      hasPrefix,
    };
  }

  /**
   * Submit prompt (mock)
   */
  async submitPrompt(prompt: SoraPrompt): Promise<{ success: boolean; promptText: string; hasPrefix: boolean }> {
    const formattedPrompt = this.formatPrompt(prompt);
    const validation = this.validatePromptPrefix(formattedPrompt);
    
    if (!validation.valid) {
      return {
        success: false,
        promptText: formattedPrompt,
        hasPrefix: false,
      };
    }

    this.promptHistory.push(formattedPrompt);

    // Simulate creating a draft
    const draft: SoraDraft = {
      id: `draft_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      prompt: formattedPrompt,
      timestamp: Date.now(),
      status: 'generating',
    };
    this.mockDrafts.push(draft);

    return {
      success: true,
      promptText: formattedPrompt,
      hasPrefix: true,
    };
  }

  /**
   * Poll drafts (mock)
   */
  async pollDrafts(): Promise<{ drafts: SoraDraft[]; newDrafts: SoraDraft[] }> {
    const newDrafts = this.mockDrafts.filter(d => !this.knownDraftIds.has(d.id));
    
    for (const draft of this.mockDrafts) {
      this.knownDraftIds.add(draft.id);
    }

    return {
      drafts: [...this.mockDrafts],
      newDrafts,
    };
  }

  /**
   * Simulate draft becoming ready
   */
  simulateDraftReady(draftId: string, videoUrl: string): void {
    const draft = this.mockDrafts.find(d => d.id === draftId);
    if (draft) {
      draft.status = 'ready';
      draft.videoUrl = videoUrl;
    }
  }

  /**
   * Add a mock draft (for testing polling)
   */
  addMockDraft(draft: SoraDraft): void {
    this.mockDrafts.push(draft);
  }

  /**
   * Get latest draft
   */
  getLatestDraft(): SoraDraft | null {
    if (this.mockDrafts.length === 0) return null;
    return [...this.mockDrafts].sort((a, b) => b.timestamp - a.timestamp)[0];
  }

  /**
   * Download draft (mock)
   */
  async downloadDraft(draft: SoraDraft): Promise<{ success: boolean; path?: string; error?: string }> {
    if (draft.status !== 'ready') {
      return {
        success: false,
        error: `Draft not ready: ${draft.status}`,
      };
    }

    if (!draft.videoUrl) {
      return {
        success: false,
        error: 'No video URL available',
      };
    }

    return {
      success: true,
      path: `${this.config.downloadPath}/${draft.id}.mp4`,
    };
  }

  getConfig(): SoraConfig {
    return { ...this.config };
  }

  getPromptHistory(): string[] {
    return [...this.promptHistory];
  }

  getKnownDraftIds(): string[] {
    return Array.from(this.knownDraftIds);
  }

  clearKnownDrafts(): void {
    this.knownDraftIds.clear();
  }

  clearMockDrafts(): void {
    this.mockDrafts = [];
  }
}

// ============================================================================
// TESTS
// ============================================================================

describe('Sora Automation', () => {
  let sora: MockSoraAutomation;

  beforeEach(() => {
    sora = new MockSoraAutomation();
  });

  describe('Prompt Formatting with @isaiahdupree Prefix', () => {
    it('should add @isaiahdupree prefix to prompts without it', () => {
      const prompt: SoraPrompt = { text: 'A cat playing piano' };
      const formatted = sora.formatPrompt(prompt);
      
      expect(formatted).toBe('@isaiahdupree A cat playing piano');
      expect(formatted.startsWith('@isaiahdupree')).toBe(true);
    });

    it('should NOT duplicate prefix if already present', () => {
      const prompt: SoraPrompt = { text: '@isaiahdupree A dog running in a field' };
      const formatted = sora.formatPrompt(prompt);
      
      expect(formatted).toBe('@isaiahdupree A dog running in a field');
      // Should NOT have double prefix
      expect(formatted.startsWith('@isaiahdupree @isaiahdupree')).toBe(false);
    });

    it('should handle prompts with leading whitespace', () => {
      const prompt: SoraPrompt = { text: '  A bird flying  ' };
      const formatted = sora.formatPrompt(prompt);
      
      expect(formatted).toBe('@isaiahdupree A bird flying');
      expect(formatted.startsWith('@isaiahdupree')).toBe(true);
    });

    it('should validate prefix is at the BEGINNING of prompt', () => {
      const validPrompt = '@isaiahdupree Create a sunset scene';
      const invalidPrompt = 'Create a sunset scene @isaiahdupree';
      
      const validResult = sora.validatePromptPrefix(validPrompt);
      const invalidResult = sora.validatePromptPrefix(invalidPrompt);
      
      expect(validResult.hasPrefix).toBe(true);
      expect(invalidResult.hasPrefix).toBe(false);
    });

    it('should use custom character prefix from config', () => {
      const customSora = new MockSoraAutomation({ characterPrefix: '@customuser' });
      const prompt: SoraPrompt = { text: 'A mountain landscape' };
      const formatted = customSora.formatPrompt(prompt);
      
      expect(formatted).toBe('@customuser A mountain landscape');
      expect(formatted.startsWith('@customuser')).toBe(true);
    });
  });

  describe('Prompt Submission', () => {
    it('should successfully submit prompt with prefix', async () => {
      const prompt: SoraPrompt = { text: 'A futuristic city' };
      const result = await sora.submitPrompt(prompt);
      
      expect(result.success).toBe(true);
      expect(result.hasPrefix).toBe(true);
      expect(result.promptText.startsWith('@isaiahdupree')).toBe(true);
    });

    it('should record submitted prompts in history', async () => {
      await sora.submitPrompt({ text: 'Prompt 1' });
      await sora.submitPrompt({ text: 'Prompt 2' });
      
      const history = sora.getPromptHistory();
      
      expect(history.length).toBe(2);
      expect(history[0]).toBe('@isaiahdupree Prompt 1');
      expect(history[1]).toBe('@isaiahdupree Prompt 2');
    });

    it('should create a draft when prompt is submitted', async () => {
      await sora.submitPrompt({ text: 'Create a draft' });
      
      const latest = sora.getLatestDraft();
      
      expect(latest).not.toBeNull();
      expect(latest?.prompt).toBe('@isaiahdupree Create a draft');
      expect(latest?.status).toBe('generating');
    });
  });

  describe('Draft Polling', () => {
    it('should detect new drafts when polling', async () => {
      // Add a draft before first poll
      sora.addMockDraft({
        id: 'draft_1',
        prompt: '@isaiahdupree Test prompt',
        timestamp: Date.now(),
        status: 'generating',
      });

      const result1 = await sora.pollDrafts();
      
      expect(result1.newDrafts.length).toBe(1);
      expect(result1.newDrafts[0].id).toBe('draft_1');

      // Second poll should not find new drafts
      const result2 = await sora.pollDrafts();
      
      expect(result2.newDrafts.length).toBe(0);
      expect(result2.drafts.length).toBe(1);
    });

    it('should track known draft IDs to avoid duplicates', async () => {
      sora.addMockDraft({
        id: 'draft_known',
        prompt: '@isaiahdupree Known draft',
        timestamp: Date.now(),
        status: 'ready',
      });

      await sora.pollDrafts();
      
      const knownIds = sora.getKnownDraftIds();
      
      expect(knownIds).toContain('draft_known');
    });

    it('should return latest draft sorted by timestamp', async () => {
      sora.addMockDraft({
        id: 'old_draft',
        prompt: '@isaiahdupree Old',
        timestamp: Date.now() - 10000,
        status: 'ready',
      });

      sora.addMockDraft({
        id: 'new_draft',
        prompt: '@isaiahdupree New',
        timestamp: Date.now(),
        status: 'ready',
      });

      const latest = sora.getLatestDraft();
      
      expect(latest?.id).toBe('new_draft');
    });

    it('should detect when draft status changes to ready', async () => {
      sora.addMockDraft({
        id: 'draft_pending',
        prompt: '@isaiahdupree Pending',
        timestamp: Date.now(),
        status: 'generating',
      });

      let draft = sora.getLatestDraft();
      expect(draft?.status).toBe('generating');

      // Simulate draft becoming ready
      sora.simulateDraftReady('draft_pending', 'https://sora.com/video/123.mp4');

      draft = sora.getLatestDraft();
      expect(draft?.status).toBe('ready');
      expect(draft?.videoUrl).toBe('https://sora.com/video/123.mp4');
    });
  });

  describe('Draft Download', () => {
    it('should download ready drafts', async () => {
      const draft: SoraDraft = {
        id: 'ready_draft',
        prompt: '@isaiahdupree Ready to download',
        timestamp: Date.now(),
        status: 'ready',
        videoUrl: 'https://sora.com/video/ready.mp4',
      };

      const result = await sora.downloadDraft(draft);
      
      expect(result.success).toBe(true);
      expect(result.path).toContain('ready_draft.mp4');
    });

    it('should fail to download drafts that are still generating', async () => {
      const draft: SoraDraft = {
        id: 'generating_draft',
        prompt: '@isaiahdupree Still generating',
        timestamp: Date.now(),
        status: 'generating',
      };

      const result = await sora.downloadDraft(draft);
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('not ready');
    });

    it('should fail to download drafts without video URL', async () => {
      const draft: SoraDraft = {
        id: 'no_url_draft',
        prompt: '@isaiahdupree No URL',
        timestamp: Date.now(),
        status: 'ready',
        // No videoUrl
      };

      const result = await sora.downloadDraft(draft);
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('No video URL');
    });

    it('should use configured download path', async () => {
      const customSora = new MockSoraAutomation({ 
        downloadPath: '/custom/path/videos' 
      });

      const draft: SoraDraft = {
        id: 'custom_path_draft',
        prompt: '@isaiahdupree Custom path',
        timestamp: Date.now(),
        status: 'ready',
        videoUrl: 'https://sora.com/video/custom.mp4',
      };

      const result = await customSora.downloadDraft(draft);
      
      expect(result.path).toContain('/custom/path/videos/');
    });
  });

  describe('Full Generation Flow', () => {
    it('should format prompt, submit, and track draft', async () => {
      const prompt: SoraPrompt = { 
        text: 'A magical forest with glowing mushrooms',
        aspectRatio: '16:9',
        duration: '10s',
      };

      // Submit prompt
      const submitResult = await sora.submitPrompt(prompt);
      expect(submitResult.success).toBe(true);
      expect(submitResult.promptText.startsWith('@isaiahdupree')).toBe(true);

      // Poll for draft
      const pollResult = await sora.pollDrafts();
      expect(pollResult.newDrafts.length).toBe(1);

      // Verify draft has correct prompt
      const draft = pollResult.newDrafts[0];
      expect(draft.prompt).toBe('@isaiahdupree A magical forest with glowing mushrooms');
    });
  });

  describe('Configuration', () => {
    it('should have @isaiahdupree as default character prefix', () => {
      const config = sora.getConfig();
      
      expect(config.characterPrefix).toBe('@isaiahdupree');
    });

    it('should have correct default URLs', () => {
      const config = sora.getConfig();
      
      expect(config.baseUrl).toBe('https://sora.com');
      expect(config.draftsUrl).toBe('https://sora.com/library');
    });

    it('should allow custom configuration override', () => {
      const customSora = new MockSoraAutomation({
        characterPrefix: '@testuser',
        pollIntervalMs: 5000,
        maxPollAttempts: 10,
      });

      const config = customSora.getConfig();
      
      expect(config.characterPrefix).toBe('@testuser');
      expect(config.pollIntervalMs).toBe(5000);
      expect(config.maxPollAttempts).toBe(10);
    });
  });
});
