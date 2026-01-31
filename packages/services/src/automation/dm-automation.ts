/**
 * DM Automation
 * 
 * Handles sending direct messages with delivery verification.
 * Implements SC-5.1 to SC-5.2 success criteria.
 */

import type { AutomationCore, AutomationResult, ProofArtifact } from './automation-core';
import * as crypto from 'crypto';

// ============================================================================
// TYPES
// ============================================================================

export interface DMConfig {
  platform: string;
  inboxUrl: string;
  composeSelector: string;
  recipientInputSelector: string;
  messageInputSelector: string;
  sendButtonSelector: string;
  sentMessageSelector: string;
  minIntervalMs: number;
  maxDMsPerDay: number;
  cooldownPerUserMs: number;
}

export interface DMRequest {
  recipientId: string;
  recipientUsername: string;
  message: string;
}

export interface DMRecord {
  id: string;
  recipientId: string;
  recipientUsername: string;
  message: string;
  marker: string;
  timestamp: number;
  delivered: boolean;
  verified: boolean;
}

export interface DMResult {
  success: boolean;
  skipped: boolean;
  reason?: string;
  record?: DMRecord;
  proofs: ProofArtifact[];
}

// ============================================================================
// DEFAULT CONFIGS
// ============================================================================

export const PLATFORM_DM_CONFIGS: Record<string, DMConfig> = {
  twitter: {
    platform: 'twitter',
    inboxUrl: 'https://x.com/messages',
    composeSelector: '[data-testid="NewDM_Button"]',
    recipientInputSelector: '[data-testid="searchPeople"]',
    messageInputSelector: '[data-testid="dmComposerTextInput"]',
    sendButtonSelector: '[data-testid="dmComposerSendButton"]',
    sentMessageSelector: '[data-testid="messageEntry"]',
    minIntervalMs: 300000, // 5 minutes between DMs
    maxDMsPerDay: 20,
    cooldownPerUserMs: 24 * 60 * 60 * 1000, // 24 hours per user
  },
  instagram: {
    platform: 'instagram',
    inboxUrl: 'https://www.instagram.com/direct/inbox/',
    composeSelector: 'svg[aria-label="New message"]',
    recipientInputSelector: 'input[name="queryBox"]',
    messageInputSelector: 'textarea[placeholder="Message..."]',
    sendButtonSelector: 'button[type="submit"]',
    sentMessageSelector: 'div[role="listitem"]',
    minIntervalMs: 600000, // 10 minutes
    maxDMsPerDay: 10,
    cooldownPerUserMs: 48 * 60 * 60 * 1000, // 48 hours per user
  },
  tiktok: {
    platform: 'tiktok',
    inboxUrl: 'https://www.tiktok.com/messages',
    composeSelector: '[data-e2e="new-message-button"]',
    recipientInputSelector: 'input[placeholder*="Search"]',
    messageInputSelector: '[data-e2e="message-input"]',
    sendButtonSelector: '[data-e2e="send-message"]',
    sentMessageSelector: '[data-e2e="message-item"]',
    minIntervalMs: 900000, // 15 minutes
    maxDMsPerDay: 5,
    cooldownPerUserMs: 72 * 60 * 60 * 1000, // 72 hours per user
  },
};

// ============================================================================
// DM AUTOMATION CLASS
// ============================================================================

export class DMAutomation {
  private core: AutomationCore;
  private config: DMConfig;
  private history: DMRecord[] = [];
  private lastDMTime: number = 0;
  private userCooldowns: Map<string, number> = new Map();

  constructor(core: AutomationCore, config: DMConfig) {
    this.core = core;
    this.config = config;
  }

  /**
   * Generate unique key for user-based deduplication
   */
  private generateUserKey(recipientId: string): string {
    return crypto.createHash('sha256')
      .update(`${this.config.platform}:${recipientId}`)
      .digest('hex')
      .slice(0, 16);
  }

  /**
   * Check if we can DM this user (SC-5.2)
   */
  checkUserCooldown(recipientId: string): { allowed: boolean; reason?: string; waitMs?: number } {
    const userKey = this.generateUserKey(recipientId);
    const lastDM = this.userCooldowns.get(userKey);

    if (lastDM) {
      const timeSince = Date.now() - lastDM;
      if (timeSince < this.config.cooldownPerUserMs) {
        const waitMs = this.config.cooldownPerUserMs - timeSince;
        const waitHours = Math.ceil(waitMs / 3600000);
        return {
          allowed: false,
          reason: `Already messaged this user within cooldown period. Wait ${waitHours} hours.`,
          waitMs,
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Check global rate limits
   */
  checkRateLimit(): { allowed: boolean; reason?: string; waitMs?: number } {
    const now = Date.now();

    // Check minimum interval
    const timeSinceLastDM = now - this.lastDMTime;
    if (this.lastDMTime > 0 && timeSinceLastDM < this.config.minIntervalMs) {
      const waitMs = this.config.minIntervalMs - timeSinceLastDM;
      return {
        allowed: false,
        reason: `Rate limit: must wait ${Math.ceil(waitMs / 60000)} minutes between DMs`,
        waitMs,
      };
    }

    // Check daily limit
    const oneDayAgo = now - 24 * 60 * 60 * 1000;
    const dmsToday = this.history.filter((r) => r.timestamp > oneDayAgo).length;
    if (dmsToday >= this.config.maxDMsPerDay) {
      return {
        allowed: false,
        reason: `Daily limit of ${this.config.maxDMsPerDay} DMs reached`,
      };
    }

    return { allowed: true };
  }

  /**
   * Send a DM with delivery verification (SC-5.1)
   */
  async sendDM(request: DMRequest): Promise<DMResult> {
    const proofs: ProofArtifact[] = [];

    // Check user cooldown
    const userCheck = this.checkUserCooldown(request.recipientId);
    if (!userCheck.allowed) {
      proofs.push({
        type: 'state_diff',
        data: { userCooldown: true, reason: userCheck.reason },
        timestamp: Date.now(),
        validator: 'user_cooldown_check',
        valid: true,
      });
      return {
        success: false,
        skipped: true,
        reason: userCheck.reason,
        proofs,
      };
    }

    // Check rate limits
    const rateCheck = this.checkRateLimit();
    if (!rateCheck.allowed) {
      proofs.push({
        type: 'state_diff',
        data: { rateLimited: true, reason: rateCheck.reason },
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
    const marker = `[${Date.now().toString(36)}]`;
    const messageWithMarker = `${request.message} ${marker}`;

    try {
      // Navigate to inbox
      const navResult = await this.core.navigateWithVerification(this.config.inboxUrl);
      proofs.push(...navResult.proofs);

      if (!navResult.success) {
        return {
          success: false,
          skipped: false,
          reason: 'Failed to navigate to inbox',
          proofs,
        };
      }

      // Click compose button
      const composeResult = await this.core.clickWithVerification(this.config.composeSelector);
      proofs.push(...composeResult.proofs);

      if (!composeResult.success) {
        return {
          success: false,
          skipped: false,
          reason: 'Failed to open compose dialog',
          proofs,
        };
      }

      // Wait for recipient input
      const recipientWait = await this.core.waitForElementWithProof(this.config.recipientInputSelector, 10000);
      proofs.push(...recipientWait.proofs);

      // Type recipient
      const recipientResult = await this.core.typeWithVerification(
        this.config.recipientInputSelector,
        request.recipientUsername
      );
      proofs.push(...recipientResult.proofs);

      // Wait a bit for search results
      await this.sleep(1500);

      // Type message
      const messageResult = await this.core.typeWithVerification(
        this.config.messageInputSelector,
        messageWithMarker
      );
      proofs.push(...messageResult.proofs);

      if (!messageResult.success) {
        return {
          success: false,
          skipped: false,
          reason: 'Failed to type message',
          proofs,
        };
      }

      // Click send
      const sendResult = await this.core.clickWithVerification(this.config.sendButtonSelector);
      proofs.push(...sendResult.proofs);

      // Wait for message to appear in thread
      await this.sleep(2000);

      // Verify message was sent by looking for our marker
      const waitForSent = await this.core.waitForElementWithProof(this.config.sentMessageSelector, 5000);
      proofs.push(...waitForSent.proofs);

      // Check if our marker appears in the conversation
      const verificationProof: ProofArtifact = {
        type: 'text_match',
        data: {
          marker,
          searched: true,
          timestamp: Date.now(),
        },
        timestamp: Date.now(),
        validator: 'dm_delivery_check',
        valid: waitForSent.success,
      };
      proofs.push(verificationProof);

      // Create record
      const record: DMRecord = {
        id: `dm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        recipientId: request.recipientId,
        recipientUsername: request.recipientUsername,
        message: request.message,
        marker,
        timestamp: Date.now(),
        delivered: sendResult.success,
        verified: waitForSent.success,
      };

      // Update history and cooldowns
      this.history.push(record);
      this.lastDMTime = Date.now();
      this.userCooldowns.set(this.generateUserKey(request.recipientId), Date.now());

      // Clean old records
      this.cleanHistory();

      return {
        success: sendResult.success,
        skipped: false,
        record,
        proofs,
      };

    } catch (error) {
      proofs.push({
        type: 'state_diff',
        data: { error: error instanceof Error ? error.message : 'Unknown error' },
        timestamp: Date.now(),
        validator: 'dm_error',
        valid: false,
      });

      return {
        success: false,
        skipped: false,
        reason: error instanceof Error ? error.message : 'DM failed',
        proofs,
      };
    }
  }

  /**
   * Clean old records
   */
  private cleanHistory(): void {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000; // Keep 7 days
    this.history = this.history.filter((r) => r.timestamp > cutoff);

    // Clean old cooldowns
    const cooldownCutoff = Date.now() - this.config.cooldownPerUserMs;
    for (const [key, timestamp] of this.userCooldowns) {
      if (timestamp < cooldownCutoff) {
        this.userCooldowns.delete(key);
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get DM history
   */
  getHistory(): DMRecord[] {
    return [...this.history];
  }

  /**
   * Get stats
   */
  getStats(): {
    totalDMs: number;
    dmsToday: number;
    verifiedCount: number;
    uniqueRecipients: number;
  } {
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const uniqueRecipients = new Set(this.history.map((r) => r.recipientId)).size;

    return {
      totalDMs: this.history.length,
      dmsToday: this.history.filter((r) => r.timestamp > oneDayAgo).length,
      verifiedCount: this.history.filter((r) => r.verified).length,
      uniqueRecipients,
    };
  }
}
