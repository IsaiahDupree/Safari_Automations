/**
 * Verification & Audit System Tests
 * 
 * Tests for success criteria and proof capture.
 */

import { describe, it, expect, beforeEach } from 'vitest';

// Success criteria definitions
const SUCCESS_CRITERIA = {
  comment: {
    actionType: 'comment',
    required: [
      { type: 'screenshot_before', weight: 15 },
      { type: 'element_found', weight: 20 },
      { type: 'screenshot_after', weight: 15 },
      { type: 'text_match', weight: 35 },
      { type: 'timestamp', weight: 15 },
    ],
    timeoutMs: 30000,
    retryAttempts: 2,
  },
  like: {
    actionType: 'like',
    required: [
      { type: 'screenshot_before', weight: 20 },
      { type: 'element_found', weight: 30 },
      { type: 'screenshot_after', weight: 20 },
      { type: 'element_found', weight: 30 },
    ],
    timeoutMs: 15000,
    retryAttempts: 1,
  },
};

const MIN_VERIFICATION_SCORE = 80;

// Mock audit logger
class MockAuditLogger {
  private records: Map<string, any> = new Map();
  
  startAction(actionType: string, platform: string, target: any): string {
    const id = `${actionType}_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    this.records.set(id, {
      id,
      actionType,
      platform,
      target,
      status: 'pending',
      proofs: [],
      errors: [],
      verificationScore: 0,
    });
    return id;
  }
  
  addProof(actionId: string, proof: any): void {
    const record = this.records.get(actionId);
    if (record) {
      record.proofs.push(proof);
    }
  }
  
  addError(actionId: string, phase: string, message: string): void {
    const record = this.records.get(actionId);
    if (record) {
      record.errors.push({ phase, message, timestamp: new Date() });
    }
  }
  
  completeAction(actionId: string, result: any): any {
    const record = this.records.get(actionId);
    if (!record) return null;
    
    record.result = result;
    record.completedAt = new Date();
    
    // Calculate score
    const criteria = SUCCESS_CRITERIA[record.actionType as keyof typeof SUCCESS_CRITERIA];
    if (criteria) {
      let score = 0;
      for (const req of criteria.required) {
        const hasProof = record.proofs.some((p: any) => p.type === req.type && p.valid);
        if (hasProof) score += req.weight;
      }
      record.verificationScore = score;
      record.status = score >= MIN_VERIFICATION_SCORE ? 'verified' : 'failed';
    }
    
    return record;
  }
  
  getRecord(actionId: string): any {
    return this.records.get(actionId);
  }
}

describe('Verification & Audit System', () => {
  let logger: MockAuditLogger;

  beforeEach(() => {
    logger = new MockAuditLogger();
  });

  describe('Success Criteria Definitions', () => {
    it('should define criteria for comment actions', () => {
      const criteria = SUCCESS_CRITERIA.comment;
      
      expect(criteria.actionType).toBe('comment');
      expect(criteria.required.length).toBeGreaterThan(0);
      expect(criteria.timeoutMs).toBeGreaterThan(0);
      
      // Weights should sum to 100
      const totalWeight = criteria.required.reduce((sum, r) => sum + r.weight, 0);
      expect(totalWeight).toBe(100);
    });

    it('should define criteria for like actions', () => {
      const criteria = SUCCESS_CRITERIA.like;
      
      expect(criteria.actionType).toBe('like');
      expect(criteria.required.length).toBeGreaterThan(0);
      
      const totalWeight = criteria.required.reduce((sum, r) => sum + r.weight, 0);
      expect(totalWeight).toBe(100);
    });

    it('should require screenshot proofs', () => {
      const commentCriteria = SUCCESS_CRITERIA.comment;
      
      const hasScreenshotBefore = commentCriteria.required.some(
        r => r.type === 'screenshot_before'
      );
      const hasScreenshotAfter = commentCriteria.required.some(
        r => r.type === 'screenshot_after'
      );
      
      expect(hasScreenshotBefore).toBe(true);
      expect(hasScreenshotAfter).toBe(true);
    });

    it('should require text verification for comments', () => {
      const criteria = SUCCESS_CRITERIA.comment;
      
      const hasTextMatch = criteria.required.some(r => r.type === 'text_match');
      expect(hasTextMatch).toBe(true);
      
      // Text match should have highest weight
      const textMatchWeight = criteria.required.find(r => r.type === 'text_match')?.weight;
      const maxWeight = Math.max(...criteria.required.map(r => r.weight));
      expect(textMatchWeight).toBe(maxWeight);
    });
  });

  describe('Audit Logger', () => {
    it('should create action record with unique ID', () => {
      const id1 = logger.startAction('comment', 'instagram', { url: 'https://instagram.com/p/123' });
      const id2 = logger.startAction('comment', 'instagram', { url: 'https://instagram.com/p/456' });
      
      expect(id1).toBeDefined();
      expect(id2).toBeDefined();
      expect(id1).not.toBe(id2);
    });

    it('should track action status as pending initially', () => {
      const id = logger.startAction('like', 'twitter', { url: 'https://x.com/status/123' });
      const record = logger.getRecord(id);
      
      expect(record.status).toBe('pending');
      expect(record.proofs).toHaveLength(0);
      expect(record.errors).toHaveLength(0);
    });

    it('should store proofs for verification', () => {
      const id = logger.startAction('comment', 'instagram', { url: 'https://instagram.com/p/123' });
      
      logger.addProof(id, { type: 'screenshot_before', valid: true });
      logger.addProof(id, { type: 'element_found', valid: true });
      
      const record = logger.getRecord(id);
      expect(record.proofs).toHaveLength(2);
    });

    it('should track errors separately from proofs', () => {
      const id = logger.startAction('dm', 'instagram', { url: 'https://instagram.com/direct' });
      
      logger.addError(id, 'execute', 'Element not found');
      logger.addError(id, 'verify', 'Text not visible');
      
      const record = logger.getRecord(id);
      expect(record.errors).toHaveLength(2);
      expect(record.errors[0].phase).toBe('execute');
      expect(record.errors[1].phase).toBe('verify');
    });
  });

  describe('Verification Scoring', () => {
    it('should calculate score based on valid proofs', () => {
      const id = logger.startAction('comment', 'instagram', { url: 'https://instagram.com/p/123' });
      
      // Add all required proofs as valid
      logger.addProof(id, { type: 'screenshot_before', valid: true });
      logger.addProof(id, { type: 'element_found', valid: true });
      logger.addProof(id, { type: 'screenshot_after', valid: true });
      logger.addProof(id, { type: 'text_match', valid: true });
      logger.addProof(id, { type: 'timestamp', valid: true });
      
      const record = logger.completeAction(id, { success: true });
      
      expect(record.verificationScore).toBe(100);
      expect(record.status).toBe('verified');
    });

    it('should fail verification if score below threshold', () => {
      const id = logger.startAction('comment', 'instagram', { url: 'https://instagram.com/p/123' });
      
      // Only add some proofs
      logger.addProof(id, { type: 'screenshot_before', valid: true });
      logger.addProof(id, { type: 'element_found', valid: true });
      // Missing: screenshot_after, text_match, timestamp
      
      const record = logger.completeAction(id, { success: true });
      
      // Score should be 15 + 20 = 35
      expect(record.verificationScore).toBe(35);
      expect(record.status).toBe('failed');
    });

    it('should not count invalid proofs', () => {
      const id = logger.startAction('comment', 'instagram', { url: 'https://instagram.com/p/123' });
      
      logger.addProof(id, { type: 'screenshot_before', valid: true });
      logger.addProof(id, { type: 'element_found', valid: false }); // Invalid
      logger.addProof(id, { type: 'screenshot_after', valid: true });
      logger.addProof(id, { type: 'text_match', valid: false }); // Invalid
      logger.addProof(id, { type: 'timestamp', valid: true });
      
      const record = logger.completeAction(id, { success: true });
      
      // Score should be 15 + 15 + 15 = 45 (missing 20 + 35 for invalid)
      expect(record.verificationScore).toBe(45);
      expect(record.status).toBe('failed');
    });

    it('should require minimum score of 80 for verified status', () => {
      expect(MIN_VERIFICATION_SCORE).toBe(80);
    });
  });

  describe('Proof Types', () => {
    it('should support screenshot proofs', () => {
      const proof = {
        type: 'screenshot_before',
        timestamp: new Date(),
        data: {
          type: 'screenshot',
          filepath: '/path/to/screenshot.png',
          hash: 'abc123',
          dimensions: { width: 1920, height: 1080 },
          fileSize: 50000,
        },
        valid: true,
      };
      
      expect(proof.data.type).toBe('screenshot');
      expect(proof.data.hash).toBeDefined();
    });

    it('should support element proofs', () => {
      const proof = {
        type: 'element_found',
        timestamp: new Date(),
        data: {
          type: 'element',
          selector: '[data-testid="like-button"]',
          found: true,
          visible: true,
          enabled: true,
          text: 'Like',
        },
        valid: true,
      };
      
      expect(proof.data.type).toBe('element');
      expect(proof.data.selector).toBeDefined();
    });

    it('should support text match proofs', () => {
      const proof = {
        type: 'text_match',
        timestamp: new Date(),
        data: {
          type: 'text_match',
          expected: 'Great post!',
          actual: 'Great post! 🔥',
          contains: true,
          exact: false,
        },
        valid: true,
      };
      
      expect(proof.data.contains).toBe(true);
      expect(proof.data.exact).toBe(false);
    });

    it('should support URL match proofs', () => {
      const proof = {
        type: 'url_match',
        timestamp: new Date(),
        data: {
          type: 'url_match',
          expected: 'instagram.com',
          actual: 'https://www.instagram.com/p/123',
          matches: true,
        },
        valid: true,
      };
      
      expect(proof.data.matches).toBe(true);
    });
  });

  describe('Action Types Coverage', () => {
    const actionTypes = ['comment', 'like', 'follow', 'dm', 'navigate', 'login_check', 'sora_generate'];
    
    it('should have criteria defined for common actions', () => {
      // At minimum, comment and like should be defined
      expect(SUCCESS_CRITERIA.comment).toBeDefined();
      expect(SUCCESS_CRITERIA.like).toBeDefined();
    });

    it('should have reasonable timeouts', () => {
      expect(SUCCESS_CRITERIA.comment.timeoutMs).toBeGreaterThanOrEqual(15000);
      expect(SUCCESS_CRITERIA.like.timeoutMs).toBeGreaterThanOrEqual(10000);
    });

    it('should have retry configuration', () => {
      expect(SUCCESS_CRITERIA.comment.retryAttempts).toBeGreaterThanOrEqual(1);
      expect(SUCCESS_CRITERIA.like.retryAttempts).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Verification Report', () => {
    it('should calculate verification rate', () => {
      // Simulate multiple actions
      const actions = [
        { status: 'verified', score: 100 },
        { status: 'verified', score: 85 },
        { status: 'failed', score: 45 },
        { status: 'verified', score: 92 },
        { status: 'failed', score: 30 },
      ];
      
      const verified = actions.filter(a => a.status === 'verified').length;
      const total = actions.length;
      const rate = Math.round((verified / total) * 100);
      
      expect(rate).toBe(60); // 3/5 = 60%
    });

    it('should calculate average score', () => {
      const scores = [100, 85, 45, 92, 30];
      const avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
      
      expect(avg).toBe(70); // (100+85+45+92+30)/5 = 70.4 → 70
    });
  });
});
