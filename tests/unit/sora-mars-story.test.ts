/**
 * Sora Mars Story Automation Test
 * 
 * Success Criteria:
 * 1. Enter prompt using @isaiahdupree character about going to Mars
 * 2. Poll drafts to detect +1 new video
 * 3. Download the video successfully
 * 
 * Anti-False-Positive Guards:
 * - Verify prompt contains @isaiahdupree at the BEGINNING
 * - Verify draft count increases by exactly 1
 * - Verify the new draft matches our prompt
 * - Verify download produces a file path
 * - Verify state changes at each step
 */

import { describe, it, expect, beforeEach } from 'vitest';

// ============================================================================
// ANTI-FALSE-POSITIVE GUARD
// ============================================================================

class AntiFalsePositiveGuard {
  private checkpoints: Map<string, { before: unknown; after: unknown; changed: boolean }> = new Map();

  /**
   * Record state before action
   */
  recordBefore(checkpoint: string, state: unknown): void {
    this.checkpoints.set(checkpoint, { before: state, after: null, changed: false });
  }

  /**
   * Record state after action and verify change
   */
  recordAfter(checkpoint: string, state: unknown): boolean {
    const cp = this.checkpoints.get(checkpoint);
    if (!cp) throw new Error(`Checkpoint ${checkpoint} not found`);
    
    cp.after = state;
    cp.changed = JSON.stringify(cp.before) !== JSON.stringify(cp.after);
    return cp.changed;
  }

  /**
   * Verify state actually changed
   */
  verifyStateChange(checkpoint: string): { changed: boolean; before: unknown; after: unknown } {
    const cp = this.checkpoints.get(checkpoint);
    if (!cp) throw new Error(`Checkpoint ${checkpoint} not found`);
    return { changed: cp.changed, before: cp.before, after: cp.after };
  }

  /**
   * Verify a value matches expected exactly
   */
  verifyExact<T>(actual: T, expected: T, message: string): boolean {
    const matches = JSON.stringify(actual) === JSON.stringify(expected);
    if (!matches) {
      console.error(`[GUARD FAIL] ${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
    return matches;
  }

  /**
   * Verify a string starts with expected prefix
   */
  verifyPrefix(actual: string, prefix: string): boolean {
    return actual.startsWith(prefix);
  }

  /**
   * Verify count increased by expected amount
   */
  verifyCountIncrease(before: number, after: number, expectedIncrease: number): boolean {
    const actualIncrease = after - before;
    return actualIncrease === expectedIncrease;
  }
}

// ============================================================================
// MOCK SORA AUTOMATION (Simulates real behavior)
// ============================================================================

interface SoraDraft {
  id: string;
  prompt: string;
  timestamp: number;
  status: 'generating' | 'ready' | 'failed';
  videoUrl?: string;
  characterUsed?: string;
}

interface DownloadResult {
  success: boolean;
  path?: string;
  fileSize?: number;
  error?: string;
}

class MockSoraAutomation {
  private drafts: SoraDraft[] = [];
  private knownDraftIds: Set<string> = new Set();
  private characterPrefix = '@isaiahdupree';
  private downloadPath = '/Users/isaiahdupree/Downloads/sora-videos';

  /**
   * Format prompt with character at the BEGINNING
   */
  formatPrompt(text: string): string {
    const trimmed = text.trim();
    if (trimmed.startsWith(this.characterPrefix)) {
      return trimmed;
    }
    return `${this.characterPrefix} ${trimmed}`;
  }

  /**
   * Validate prompt has character at the beginning
   */
  validatePrompt(prompt: string): { valid: boolean; hasCharacterAtStart: boolean; character: string } {
    const hasCharacterAtStart = prompt.startsWith(this.characterPrefix);
    return {
      valid: hasCharacterAtStart,
      hasCharacterAtStart,
      character: this.characterPrefix,
    };
  }

  /**
   * Submit a prompt and create a draft
   */
  async submitPrompt(text: string): Promise<{ 
    success: boolean; 
    promptSubmitted: string; 
    draftId: string;
    validation: { hasCharacterAtStart: boolean };
  }> {
    const formattedPrompt = this.formatPrompt(text);
    const validation = this.validatePrompt(formattedPrompt);

    if (!validation.valid) {
      throw new Error('Prompt must start with @isaiahdupree');
    }

    const draft: SoraDraft = {
      id: `draft_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      prompt: formattedPrompt,
      timestamp: Date.now(),
      status: 'generating',
      characterUsed: this.characterPrefix,
    };

    this.drafts.push(draft);

    return {
      success: true,
      promptSubmitted: formattedPrompt,
      draftId: draft.id,
      validation: { hasCharacterAtStart: validation.hasCharacterAtStart },
    };
  }

  /**
   * Get current draft count
   */
  getDraftCount(): number {
    return this.drafts.length;
  }

  /**
   * Poll for drafts - returns new drafts not seen before
   */
  async pollDrafts(): Promise<{
    totalDrafts: number;
    newDrafts: SoraDraft[];
    newCount: number;
  }> {
    const newDrafts = this.drafts.filter(d => !this.knownDraftIds.has(d.id));
    
    // Mark as known
    for (const draft of this.drafts) {
      this.knownDraftIds.add(draft.id);
    }

    return {
      totalDrafts: this.drafts.length,
      newDrafts,
      newCount: newDrafts.length,
    };
  }

  /**
   * Simulate draft becoming ready (video generation complete)
   */
  simulateDraftReady(draftId: string): void {
    const draft = this.drafts.find(d => d.id === draftId);
    if (draft) {
      draft.status = 'ready';
      draft.videoUrl = `https://sora.com/api/videos/${draftId}/download.mp4`;
    }
  }

  /**
   * Get latest draft
   */
  getLatestDraft(): SoraDraft | null {
    if (this.drafts.length === 0) return null;
    return [...this.drafts].sort((a, b) => b.timestamp - a.timestamp)[0];
  }

  /**
   * Download a draft video
   */
  async downloadDraft(draft: SoraDraft): Promise<DownloadResult> {
    if (draft.status !== 'ready') {
      return { success: false, error: `Draft not ready: status is ${draft.status}` };
    }

    if (!draft.videoUrl) {
      return { success: false, error: 'No video URL available' };
    }

    // Simulate successful download
    const filePath = `${this.downloadPath}/${draft.id}.mp4`;
    
    return {
      success: true,
      path: filePath,
      fileSize: 15_000_000, // 15MB simulated
    };
  }

  /**
   * Find draft by prompt content
   */
  findDraftByPromptContent(content: string): SoraDraft | null {
    return this.drafts.find(d => d.prompt.includes(content)) || null;
  }

  /**
   * Reset state (for testing)
   */
  reset(): void {
    this.drafts = [];
    this.knownDraftIds.clear();
  }
}

// ============================================================================
// TESTS
// ============================================================================

describe('Sora Mars Story Automation', () => {
  let sora: MockSoraAutomation;
  let guard: AntiFalsePositiveGuard;

  const MARS_STORY_PROMPT = 'The epic journey of humanity\'s first mission to Mars, showing astronauts preparing for launch, the spacecraft traveling through space, and the historic first steps on the red planet';

  beforeEach(() => {
    sora = new MockSoraAutomation();
    guard = new AntiFalsePositiveGuard();
  });

  describe('SC-1: Prompt Entry with @isaiahdupree Character', () => {
    it('should format prompt with @isaiahdupree at the BEGINNING', async () => {
      const formatted = sora.formatPrompt(MARS_STORY_PROMPT);

      // ANTI-FALSE-POSITIVE: Verify prefix is at position 0
      expect(formatted.startsWith('@isaiahdupree')).toBe(true);
      expect(formatted.indexOf('@isaiahdupree')).toBe(0);
      
      // Verify the Mars content is preserved
      expect(formatted).toContain('Mars');
      expect(formatted).toContain('astronauts');
    });

    it('should NOT have @isaiahdupree anywhere except the beginning', async () => {
      const formatted = sora.formatPrompt(MARS_STORY_PROMPT);
      
      // Count occurrences of @isaiahdupree
      const matches = formatted.match(/@isaiahdupree/g) || [];
      
      // ANTI-FALSE-POSITIVE: Should appear exactly once, at the start
      expect(matches.length).toBe(1);
      expect(formatted.indexOf('@isaiahdupree')).toBe(0);
    });

    it('should validate prompt has character at start before submission', async () => {
      const formatted = sora.formatPrompt(MARS_STORY_PROMPT);
      const validation = sora.validatePrompt(formatted);

      // ANTI-FALSE-POSITIVE: Explicit validation check
      expect(validation.valid).toBe(true);
      expect(validation.hasCharacterAtStart).toBe(true);
      expect(validation.character).toBe('@isaiahdupree');
    });

    it('should reject prompt without @isaiahdupree at start', () => {
      const badPrompt = 'A story about Mars with @isaiahdupree at the end';
      const validation = sora.validatePrompt(badPrompt);

      // ANTI-FALSE-POSITIVE: Must fail validation
      expect(validation.valid).toBe(false);
      expect(validation.hasCharacterAtStart).toBe(false);
    });
  });

  describe('SC-2: Draft Polling - Detect +1 New Video', () => {
    it('should detect exactly +1 new draft after submission', async () => {
      // Record BEFORE state
      guard.recordBefore('draft_count', sora.getDraftCount());
      const beforeCount = sora.getDraftCount();

      // Submit Mars story prompt
      const result = await sora.submitPrompt(MARS_STORY_PROMPT);
      expect(result.success).toBe(true);

      // Record AFTER state
      guard.recordAfter('draft_count', sora.getDraftCount());
      const afterCount = sora.getDraftCount();

      // ANTI-FALSE-POSITIVE: Verify exactly +1 increase
      const stateChange = guard.verifyStateChange('draft_count');
      expect(stateChange.changed).toBe(true);
      expect(guard.verifyCountIncrease(beforeCount, afterCount, 1)).toBe(true);
      expect(afterCount - beforeCount).toBe(1);
    });

    it('should find the new draft when polling', async () => {
      // First poll to establish baseline
      await sora.pollDrafts();

      // Submit prompt
      await sora.submitPrompt(MARS_STORY_PROMPT);

      // Poll again
      const pollResult = await sora.pollDrafts();

      // ANTI-FALSE-POSITIVE: Verify exactly 1 new draft
      expect(pollResult.newCount).toBe(1);
      expect(pollResult.newDrafts.length).toBe(1);
      
      // Verify the new draft matches our prompt
      const newDraft = pollResult.newDrafts[0];
      expect(newDraft.prompt.startsWith('@isaiahdupree')).toBe(true);
      expect(newDraft.prompt).toContain('Mars');
    });

    it('should NOT report same draft as new on subsequent polls', async () => {
      // Submit and poll
      await sora.submitPrompt(MARS_STORY_PROMPT);
      const firstPoll = await sora.pollDrafts();
      expect(firstPoll.newCount).toBe(1);

      // Poll again without new submissions
      const secondPoll = await sora.pollDrafts();

      // ANTI-FALSE-POSITIVE: No new drafts on second poll
      expect(secondPoll.newCount).toBe(0);
      expect(secondPoll.totalDrafts).toBe(1); // Still 1 total
    });

    it('should match draft to our specific Mars prompt', async () => {
      // Submit Mars prompt
      const submitResult = await sora.submitPrompt(MARS_STORY_PROMPT);

      // Find by content
      const foundDraft = sora.findDraftByPromptContent('Mars');

      // ANTI-FALSE-POSITIVE: Must find the exact draft
      expect(foundDraft).not.toBeNull();
      expect(foundDraft?.id).toBe(submitResult.draftId);
      expect(foundDraft?.prompt).toContain('journey');
      expect(foundDraft?.prompt).toContain('astronauts');
      expect(foundDraft?.characterUsed).toBe('@isaiahdupree');
    });
  });

  describe('SC-3: Download Video - Success Verification', () => {
    it('should successfully download ready video', async () => {
      // Submit prompt
      const submitResult = await sora.submitPrompt(MARS_STORY_PROMPT);
      
      // Simulate video generation completing
      sora.simulateDraftReady(submitResult.draftId);

      // Get the draft
      const draft = sora.getLatestDraft();
      expect(draft).not.toBeNull();
      expect(draft?.status).toBe('ready');

      // Download
      const downloadResult = await sora.downloadDraft(draft!);

      // ANTI-FALSE-POSITIVE: Verify download success with path
      expect(downloadResult.success).toBe(true);
      expect(downloadResult.path).toBeDefined();
      expect(downloadResult.path).toContain('.mp4');
      expect(downloadResult.path).toContain(submitResult.draftId);
      expect(downloadResult.fileSize).toBeGreaterThan(0);
    });

    it('should FAIL to download if video not ready', async () => {
      // Submit prompt (status will be 'generating')
      await sora.submitPrompt(MARS_STORY_PROMPT);
      const draft = sora.getLatestDraft();

      // Try to download before ready
      const downloadResult = await sora.downloadDraft(draft!);

      // ANTI-FALSE-POSITIVE: Must fail with clear reason
      expect(downloadResult.success).toBe(false);
      expect(downloadResult.error).toContain('not ready');
      expect(downloadResult.path).toBeUndefined();
    });

    it('should download path include draft ID for traceability', async () => {
      const submitResult = await sora.submitPrompt(MARS_STORY_PROMPT);
      sora.simulateDraftReady(submitResult.draftId);
      const draft = sora.getLatestDraft();

      const downloadResult = await sora.downloadDraft(draft!);

      // ANTI-FALSE-POSITIVE: Path must be traceable to specific draft
      expect(downloadResult.path).toContain(submitResult.draftId);
    });
  });

  describe('SC-4: Full Flow - End-to-End Success Criteria', () => {
    it('should complete full flow: prompt → poll → download', async () => {
      // Track all state changes
      guard.recordBefore('drafts', sora.getDraftCount());

      // STEP 1: Submit prompt with @isaiahdupree
      const submitResult = await sora.submitPrompt(MARS_STORY_PROMPT);
      
      expect(submitResult.success).toBe(true);
      expect(submitResult.validation.hasCharacterAtStart).toBe(true);
      expect(submitResult.promptSubmitted.startsWith('@isaiahdupree')).toBe(true);
      expect(submitResult.promptSubmitted).toContain('Mars');

      // STEP 2: Poll and detect +1 draft
      const pollResult = await sora.pollDrafts();
      
      expect(pollResult.newCount).toBe(1);
      expect(pollResult.newDrafts[0].prompt).toBe(submitResult.promptSubmitted);

      // STEP 3: Simulate video ready
      sora.simulateDraftReady(submitResult.draftId);
      const readyDraft = sora.getLatestDraft();
      
      expect(readyDraft?.status).toBe('ready');

      // STEP 4: Download
      const downloadResult = await sora.downloadDraft(readyDraft!);

      expect(downloadResult.success).toBe(true);
      expect(downloadResult.path).toBeDefined();
      expect(downloadResult.path).toContain('.mp4');

      // ANTI-FALSE-POSITIVE: Verify state changed
      guard.recordAfter('drafts', sora.getDraftCount());
      const stateChange = guard.verifyStateChange('drafts');
      expect(stateChange.changed).toBe(true);
      expect(stateChange.before).toBe(0);
      expect(stateChange.after).toBe(1);

      // Final verification log
      console.log('✅ Full flow completed:');
      console.log(`   Prompt: "${submitResult.promptSubmitted.slice(0, 50)}..."`);
      console.log(`   Draft ID: ${submitResult.draftId}`);
      console.log(`   Download path: ${downloadResult.path}`);
    });

    it('should NOT pass if any step fails', async () => {
      // This test verifies our guards catch failures
      
      // Try to download without submitting first
      const emptyDraft = sora.getLatestDraft();
      expect(emptyDraft).toBeNull();

      // Try with a fake draft that's not ready
      const fakeDraft: SoraDraft = {
        id: 'fake_id',
        prompt: '@isaiahdupree fake',
        timestamp: Date.now(),
        status: 'generating',
      };

      const downloadResult = await sora.downloadDraft(fakeDraft);
      
      // ANTI-FALSE-POSITIVE: Must fail
      expect(downloadResult.success).toBe(false);
    });
  });

  describe('Anti-False-Positive Guards', () => {
    it('should detect if state did NOT actually change', () => {
      guard.recordBefore('test', { count: 5 });
      guard.recordAfter('test', { count: 5 }); // Same value

      const result = guard.verifyStateChange('test');
      
      // Guard must detect NO change
      expect(result.changed).toBe(false);
    });

    it('should verify exact count increase', () => {
      // Correct increase
      expect(guard.verifyCountIncrease(0, 1, 1)).toBe(true);
      expect(guard.verifyCountIncrease(5, 6, 1)).toBe(true);

      // Wrong increase amounts
      expect(guard.verifyCountIncrease(0, 2, 1)).toBe(false); // +2 not +1
      expect(guard.verifyCountIncrease(0, 0, 1)).toBe(false); // +0 not +1
    });

    it('should verify prefix is at position 0', () => {
      const good = '@isaiahdupree Mars story';
      const bad = 'Mars story @isaiahdupree';

      expect(guard.verifyPrefix(good, '@isaiahdupree')).toBe(true);
      expect(guard.verifyPrefix(bad, '@isaiahdupree')).toBe(false);
    });
  });
});
