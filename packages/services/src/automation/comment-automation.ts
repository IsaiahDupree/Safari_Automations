/**
 * Comment Automation
 * 
 * Handles posting comments with deduplication and rate limiting.
 * Implements SC-4.1 to SC-4.3 success criteria.
 */

import type { AutomationCore, AutomationResult, ProofArtifact } from './automation-core';
import * as crypto from 'crypto';

// ============================================================================
// TYPES
// ============================================================================

export interface CommentConfig {
  platform: string;
  inputSelector: string;
  submitSelector: string;
  commentListSelector?: string;
  minIntervalMs: number;
  maxCommentsPerHour: number;
  dedupeWindowMs: number;
}

export interface CommentRequest {
  postUrl: string;
  postId: string;
  text: string;
  replyToId?: string;
}

export interface CommentRecord {
  id: string;
  postId: string;
  text: string;
  marker: string;
  timestamp: number;
  verified: boolean;
  dedupeKey: string;
}

export interface CommentResult {
  success: boolean;
  skipped: boolean;
  reason?: string;
  record?: CommentRecord;
  proofs: ProofArtifact[];
}

// ============================================================================
// DEFAULT CONFIGS
// ============================================================================

export const PLATFORM_COMMENT_CONFIGS: Record<string, CommentConfig> = {
  twitter: {
    platform: 'twitter',
    inputSelector: '[data-testid="tweetTextarea_0"]',
    submitSelector: '[data-testid="tweetButtonInline"]',
    commentListSelector: '[data-testid="tweet"]',
    minIntervalMs: 60000, // 1 minute minimum between comments
    maxCommentsPerHour: 10,
    dedupeWindowMs: 24 * 60 * 60 * 1000, // 24 hours
  },
  instagram: {
    platform: 'instagram',
    inputSelector: 'textarea[aria-label="Add a comment…"]',
    submitSelector: 'button[type="submit"]',
    commentListSelector: 'ul li',
    minIntervalMs: 120000, // 2 minutes
    maxCommentsPerHour: 5,
    dedupeWindowMs: 24 * 60 * 60 * 1000,
  },
  tiktok: {
    platform: 'tiktok',
    inputSelector: '[data-e2e="comment-input"]',
    submitSelector: '[data-e2e="comment-post"]',
    commentListSelector: '[data-e2e="comment-item"]',
    minIntervalMs: 180000, // 3 minutes
    maxCommentsPerHour: 5,
    dedupeWindowMs: 24 * 60 * 60 * 1000,
  },
  youtube: {
    platform: 'youtube',
    inputSelector: '#contenteditable-root',
    submitSelector: '#submit-button',
    commentListSelector: 'ytd-comment-renderer',
    minIntervalMs: 300000, // 5 minutes
    maxCommentsPerHour: 3,
    dedupeWindowMs: 24 * 60 * 60 * 1000,
  },
  reddit: {
    platform: 'reddit',
    inputSelector: '[data-testid="comment-submission-form-richtext"] [contenteditable="true"]',
    submitSelector: 'button[type="submit"]',
    commentListSelector: '[data-testid="comment"]',
    minIntervalMs: 600000, // 10 minutes
    maxCommentsPerHour: 3,
    dedupeWindowMs: 24 * 60 * 60 * 1000,
  },
};

// ============================================================================
// COMMENT AUTOMATION CLASS
// ============================================================================

export class CommentAutomation {
  private core: AutomationCore;
  private config: CommentConfig;
  private history: CommentRecord[] = [];
  private lastCommentTime: number = 0;

  constructor(core: AutomationCore, config: CommentConfig) {
    this.core = core;
    this.config = config;
  }

  /**
   * Generate deduplication key for a comment
   */
  generateDedupeKey(postId: string, text: string): string {
    const normalized = text.toLowerCase().trim().replace(/\s+/g, ' ');
    return crypto.createHash('sha256')
      .update(`${postId}:${normalized}`)
      .digest('hex')
      .slice(0, 16);
  }

  /**
   * Check if this is a duplicate comment (SC-4.2)
   */
  isDuplicate(postId: string, text: string): { isDupe: boolean; reason?: string } {
    const dedupeKey = this.generateDedupeKey(postId, text);
    const cutoff = Date.now() - this.config.dedupeWindowMs;

    const existing = this.history.find(
      (record) => record.dedupeKey === dedupeKey && record.timestamp > cutoff
    );

    if (existing) {
      return {
        isDupe: true,
        reason: `Duplicate comment to post ${postId} within ${this.config.dedupeWindowMs / 3600000} hours`,
      };
    }

    return { isDupe: false };
  }

  /**
   * Check rate limits (SC-4.3)
   */
  checkRateLimit(): { allowed: boolean; reason?: string; waitMs?: number } {
    const now = Date.now();

    // Check minimum interval
    const timeSinceLastComment = now - this.lastCommentTime;
    if (timeSinceLastComment < this.config.minIntervalMs) {
      const waitMs = this.config.minIntervalMs - timeSinceLastComment;
      return {
        allowed: false,
        reason: `Rate limit: must wait ${Math.ceil(waitMs / 1000)}s between comments`,
        waitMs,
      };
    }

    // Check hourly limit
    const oneHourAgo = now - 3600000;
    const commentsLastHour = this.history.filter((r) => r.timestamp > oneHourAgo).length;
    if (commentsLastHour >= this.config.maxCommentsPerHour) {
      return {
        allowed: false,
        reason: `Rate limit: ${this.config.maxCommentsPerHour} comments per hour reached`,
      };
    }

    return { allowed: true };
  }

  /**
   * Post a comment with full verification (SC-4.1)
   */
  async postComment(request: CommentRequest): Promise<CommentResult> {
    const proofs: ProofArtifact[] = [];

    // Check for duplicates first
    const dupeCheck = this.isDuplicate(request.postId, request.text);
    if (dupeCheck.isDupe) {
      proofs.push({
        type: 'state_diff',
        data: { isDuplicate: true, reason: dupeCheck.reason },
        timestamp: Date.now(),
        validator: 'dedupe_check',
        valid: true,
      });
      return {
        success: false,
        skipped: true,
        reason: dupeCheck.reason,
        proofs,
      };
    }

    // Check rate limits
    const rateCheck = this.checkRateLimit();
    if (!rateCheck.allowed) {
      proofs.push({
        type: 'state_diff',
        data: { rateLimited: true, reason: rateCheck.reason, waitMs: rateCheck.waitMs },
        timestamp: Date.now(),
        validator: 'rate_limit_check',
        valid: true,
      });
      return {
        success: false,
        skipped: true,
        reason: rateCheck.reason,
        proofs,
      };
    }

    // Generate unique marker for verification
    const marker = `_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const commentText = `${request.text} ${marker}`;

    // Post the comment using core automation
    const result = await this.core.postComment(
      this.config.inputSelector,
      this.config.submitSelector,
      request.text
    );

    // Merge proofs
    proofs.push(...result.proofs);

    if (result.success && result.data) {
      // Create record
      const record: CommentRecord = {
        id: `comment_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        postId: request.postId,
        text: request.text,
        marker: result.data.marker,
        timestamp: Date.now(),
        verified: result.data.foundAfterPost,
        dedupeKey: this.generateDedupeKey(request.postId, request.text),
      };

      // Update history
      this.history.push(record);
      this.lastCommentTime = Date.now();

      // Clean old history
      this.cleanHistory();

      return {
        success: true,
        skipped: false,
        record,
        proofs,
      };
    }

    return {
      success: false,
      skipped: false,
      reason: result.error || 'Comment failed',
      proofs,
    };
  }

  /**
   * Clean old records from history
   */
  private cleanHistory(): void {
    const cutoff = Date.now() - this.config.dedupeWindowMs;
    this.history = this.history.filter((r) => r.timestamp > cutoff);
  }

  /**
   * Get comment history
   */
  getHistory(): CommentRecord[] {
    return [...this.history];
  }

  /**
   * Get stats
   */
  getStats(): {
    totalComments: number;
    commentsLastHour: number;
    verifiedCount: number;
    lastCommentTime: number | null;
  } {
    const oneHourAgo = Date.now() - 3600000;
    return {
      totalComments: this.history.length,
      commentsLastHour: this.history.filter((r) => r.timestamp > oneHourAgo).length,
      verifiedCount: this.history.filter((r) => r.verified).length,
      lastCommentTime: this.lastCommentTime || null,
    };
  }
}
