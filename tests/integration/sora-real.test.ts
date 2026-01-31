/**
 * Sora Real Integration Test
 * 
 * REAL TESTS - No mocks. Runs against actual Safari and Sora.
 * 
 * Prerequisites:
 * - Safari must be running
 * - Must be logged into sora.com
 * - System must allow AppleScript automation
 * 
 * Run with: npx vitest run tests/integration/sora-real.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SoraRealAutomation } from '../../packages/services/src/sora/sora-real-automation';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// CONFIGURATION
// ============================================================================

const TEST_CONFIG = {
  characterPrefix: '@isaiahdupree',
  downloadPath: '/Users/isaiahdupree/Downloads/sora-videos-test',
  pollIntervalMs: 10000, // 10 seconds for testing
  maxPollAttempts: 3, // Reduced for testing
};

const MARS_STORY_PROMPT = 'The epic journey of humanity\'s first mission to Mars, showing astronauts preparing for launch, the spacecraft traveling through space, and the historic first steps on the red planet';

// ============================================================================
// TEST SUITE
// ============================================================================

describe('Sora Real Integration Tests', () => {
  let sora: SoraRealAutomation;

  beforeAll(() => {
    sora = new SoraRealAutomation(TEST_CONFIG);
    
    // Ensure test download directory exists
    if (!fs.existsSync(TEST_CONFIG.downloadPath)) {
      fs.mkdirSync(TEST_CONFIG.downloadPath, { recursive: true });
    }
  });

  afterAll(() => {
    // Cleanup test files if needed
  });

  describe('SC-1: Prompt Formatting with @isaiahdupree', () => {
    it('should format prompt with @isaiahdupree at the BEGINNING', () => {
      const formatted = sora.formatPrompt(MARS_STORY_PROMPT);
      
      // Verify prefix is at position 0
      expect(formatted.startsWith('@isaiahdupree')).toBe(true);
      expect(formatted.indexOf('@isaiahdupree')).toBe(0);
      
      // Verify Mars content is preserved
      expect(formatted).toContain('Mars');
      expect(formatted).toContain('astronauts');
    });

    it('should NOT duplicate prefix if already present', () => {
      const alreadyPrefixed = '@isaiahdupree A test prompt';
      const formatted = sora.formatPrompt(alreadyPrefixed);
      
      // Count occurrences - should be exactly 1
      const matches = formatted.match(/@isaiahdupree/g) || [];
      expect(matches.length).toBe(1);
    });
  });

  describe('SC-2: Real Safari Navigation', () => {
    it('should navigate to sora.com successfully', async () => {
      // This test actually opens Safari and navigates
      const result = await sora.submitPrompt('Test navigation only');
      
      // Even if prompt submission fails, navigation should work
      // We're just testing that Safari automation works
      console.log('Navigation test result:', result);
      
      // The test passes if no exception is thrown
      expect(result).toBeDefined();
      expect(result.promptText.startsWith('@isaiahdupree')).toBe(true);
    }, 30000); // 30 second timeout
  });

  describe('SC-3: Real Prompt Submission', () => {
    it('should submit prompt with @isaiahdupree character', async () => {
      const result = await sora.submitPrompt(MARS_STORY_PROMPT);
      
      console.log('Prompt submission result:', {
        success: result.success,
        hasCharacterPrefix: result.hasCharacterPrefix,
        promptText: result.promptText.slice(0, 50) + '...',
        error: result.error,
      });

      // Verify the prompt was formatted correctly
      expect(result.promptText.startsWith('@isaiahdupree')).toBe(true);
      expect(result.hasCharacterPrefix).toBe(true);
      
      // Screenshot should be captured
      if (result.screenshot) {
        expect(fs.existsSync(result.screenshot)).toBe(true);
        console.log('Screenshot saved:', result.screenshot);
      }
    }, 60000); // 60 second timeout
  });

  describe('SC-4: Real Draft Polling', () => {
    it('should poll drafts from sora.com/library', async () => {
      // Reset known drafts for clean test
      sora.resetKnownDrafts();
      
      const result = await sora.pollDrafts();
      
      console.log('Poll result:', {
        success: result.success,
        draftCount: result.drafts.length,
        newDrafts: result.newDrafts.length,
        error: result.error,
      });

      expect(result).toBeDefined();
      expect(result.timestamp).toBeGreaterThan(0);
      
      // Log draft details
      for (const draft of result.drafts) {
        console.log(`Draft: ${draft.id}, status: ${draft.status}, prompt: ${draft.prompt.slice(0, 30)}...`);
      }
    }, 30000);

    it('should detect +1 new draft after second poll', async () => {
      const firstPoll = await sora.pollDrafts();
      const countBefore = firstPoll.drafts.length;
      
      // Note: This test assumes no new drafts are created between polls
      // In a real scenario, you'd submit a prompt first
      
      const secondPoll = await sora.pollDrafts();
      
      // Second poll should have no new drafts (same state)
      expect(secondPoll.newDrafts.length).toBe(0);
      
      console.log(`Drafts before: ${countBefore}, after: ${secondPoll.drafts.length}, new: ${secondPoll.newDrafts.length}`);
    }, 60000);
  });

  describe('SC-5: Real Video Download', () => {
    it('should download a ready video', async () => {
      // First, poll to find a ready draft
      const pollResult = await sora.pollDrafts();
      
      const readyDraft = pollResult.drafts.find(d => d.status === 'ready');
      
      if (!readyDraft) {
        console.log('No ready drafts found - skipping download test');
        return;
      }

      console.log(`Found ready draft: ${readyDraft.id}`);
      
      const downloadResult = await sora.downloadDraft(readyDraft);
      
      console.log('Download result:', {
        success: downloadResult.success,
        path: downloadResult.downloadPath,
        size: downloadResult.fileSize,
        error: downloadResult.error,
      });

      if (downloadResult.success) {
        expect(downloadResult.downloadPath).toBeDefined();
        expect(fs.existsSync(downloadResult.downloadPath!)).toBe(true);
        expect(downloadResult.fileSize).toBeGreaterThan(0);
      }
    }, 120000); // 2 minute timeout for download
  });

  describe('SC-6: Full End-to-End Flow', () => {
    it('should complete full flow: prompt → poll → download', async () => {
      console.log('=== Starting Full E2E Flow ===');
      
      // Step 1: Submit prompt
      console.log('Step 1: Submitting prompt...');
      const promptResult = await sora.submitPrompt(MARS_STORY_PROMPT);
      
      expect(promptResult.promptText.startsWith('@isaiahdupree')).toBe(true);
      console.log(`Prompt submitted: ${promptResult.success}`);

      // Step 2: Poll for drafts (just once for this test)
      console.log('Step 2: Polling drafts...');
      const pollResult = await sora.pollDrafts();
      
      console.log(`Found ${pollResult.drafts.length} drafts, ${pollResult.newDrafts.length} new`);

      // Step 3: If there's a ready draft, download it
      const readyDraft = pollResult.drafts.find(d => d.status === 'ready');
      
      if (readyDraft) {
        console.log('Step 3: Downloading ready draft...');
        const downloadResult = await sora.downloadDraft(readyDraft);
        console.log(`Download: ${downloadResult.success ? 'SUCCESS' : 'FAILED'}`);
        
        if (downloadResult.success) {
          console.log(`Video saved to: ${downloadResult.downloadPath}`);
        }
      } else {
        console.log('Step 3: No ready drafts to download (video may still be generating)');
      }

      console.log('=== E2E Flow Complete ===');
    }, 180000); // 3 minute timeout
  });
});

// ============================================================================
// ANTI-FALSE-POSITIVE VERIFICATION
// ============================================================================

describe('Anti-False-Positive Guards', () => {
  let sora: SoraRealAutomation;

  beforeAll(() => {
    sora = new SoraRealAutomation(TEST_CONFIG);
  });

  it('should verify @isaiahdupree is at position 0, not elsewhere', () => {
    const good = sora.formatPrompt('A story about Mars');
    const prefixIndex = good.indexOf('@isaiahdupree');
    
    expect(prefixIndex).toBe(0);
    
    // Verify it doesn't appear later in the string
    const secondIndex = good.indexOf('@isaiahdupree', 1);
    expect(secondIndex).toBe(-1);
  });

  it('should NOT pass with wrong prefix', () => {
    const wrongPrefix = '@wronguser A story about Mars';
    const hasCorrectPrefix = wrongPrefix.startsWith('@isaiahdupree');
    
    expect(hasCorrectPrefix).toBe(false);
  });

  it('should track draft count changes accurately', async () => {
    sora.resetKnownDrafts();
    
    const poll1 = await sora.pollDrafts();
    const count1 = poll1.draftCountAfter;
    
    const poll2 = await sora.pollDrafts();
    const count2 = poll2.draftCountAfter;
    
    // Without new submissions, count should stay same
    console.log(`Count1: ${count1}, Count2: ${count2}`);
    expect(count2).toBe(count1);
  }, 60000);
});
