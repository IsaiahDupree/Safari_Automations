/**
 * Sora Rate Limiter
 * 
 * Enforces conservative rate limits on Sora video generation.
 * Prevents excessive API usage with configurable limits.
 */

import type { 
  SoraRateLimitConfig, 
  SoraGenerationRequest, 
  SoraUsageStats,
  SoraGenerationStatus 
} from './types';
import { DEFAULT_SORA_CONFIG } from './types';

export class SoraRateLimiter {
  private config: SoraRateLimitConfig;
  private queue: SoraGenerationRequest[] = [];
  private history: SoraGenerationRequest[] = [];
  private activeGenerations: Map<string, SoraGenerationRequest> = new Map();
  private consecutiveErrors = 0;
  private isPaused = false;
  private pauseReason?: string;

  constructor(config: Partial<SoraRateLimitConfig> = {}) {
    this.config = { ...DEFAULT_SORA_CONFIG, ...config };
  }

  /**
   * Check if Sora is enabled at all
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Enable Sora (must be called explicitly to allow any generation)
   */
  enable(): void {
    this.config.enabled = true;
    console.log('🟢 Sora rate limiter ENABLED');
  }

  /**
   * Disable Sora (stops all automatic triggering)
   */
  disable(): void {
    this.config.enabled = false;
    this.isPaused = true;
    this.pauseReason = 'Disabled by user';
    console.log('🔴 Sora rate limiter DISABLED');
  }

  /**
   * Check if a new generation can be started right now
   */
  canGenerateNow(): { allowed: boolean; reason?: string; nextAllowedAt?: Date } {
    // FIRST CHECK: Is Sora enabled at all?
    if (!this.config.enabled) {
      return { 
        allowed: false, 
        reason: 'Sora is DISABLED. Call enable() or set enabled=true to allow generation.' 
      };
    }

    // Check if paused
    if (this.isPaused) {
      return { allowed: false, reason: this.pauseReason || 'System is paused' };
    }

    // Check day of week
    const now = new Date();
    const dayOfWeek = now.getDay();
    if (!this.config.allowedDays.includes(dayOfWeek)) {
      const nextAllowedDay = this.getNextAllowedDay(now);
      return { 
        allowed: false, 
        reason: `Sora only runs on allowed days. Today is ${this.getDayName(dayOfWeek)}.`,
        nextAllowedAt: nextAllowedDay
      };
    }

    // Check time of day
    const hour = now.getHours();
    if (hour < this.config.allowedStartHour || hour >= this.config.allowedEndHour) {
      const nextAllowedTime = this.getNextAllowedTime(now);
      return { 
        allowed: false, 
        reason: `Sora only runs between ${this.config.allowedStartHour}:00 and ${this.config.allowedEndHour}:00. Current hour: ${hour}:00`,
        nextAllowedAt: nextAllowedTime
      };
    }

    // Check daily limit
    const todayCount = this.getTodayGenerationCount();
    if (todayCount >= this.config.maxVideosPerDay) {
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(this.config.allowedStartHour, 0, 0, 0);
      return { 
        allowed: false, 
        reason: `Daily limit reached (${todayCount}/${this.config.maxVideosPerDay})`,
        nextAllowedAt: tomorrow
      };
    }

    // Check concurrent limit
    if (this.activeGenerations.size >= this.config.maxConcurrentGenerations) {
      return { 
        allowed: false, 
        reason: `Max concurrent generations reached (${this.activeGenerations.size}/${this.config.maxConcurrentGenerations})`
      };
    }

    // Check minimum interval
    const lastGen = this.getLastGenerationTime();
    if (lastGen) {
      const timeSince = now.getTime() - lastGen.getTime();
      if (timeSince < this.config.minIntervalBetweenGenerationsMs) {
        const nextAllowed = new Date(lastGen.getTime() + this.config.minIntervalBetweenGenerationsMs);
        const hoursRemaining = Math.ceil((nextAllowed.getTime() - now.getTime()) / (60 * 60 * 1000));
        return { 
          allowed: false, 
          reason: `Minimum interval not met. ~${hoursRemaining} hours until next allowed.`,
          nextAllowedAt: nextAllowed
        };
      }
    }

    // Check consecutive errors
    if (this.consecutiveErrors >= this.config.pauseOnConsecutiveErrors) {
      return { 
        allowed: false, 
        reason: `Paused due to ${this.consecutiveErrors} consecutive errors. Manual reset required.`
      };
    }

    return { allowed: true };
  }

  /**
   * Request a new generation (adds to queue, may require approval)
   */
  requestGeneration(prompt: string, style?: string): SoraGenerationRequest {
    const request: SoraGenerationRequest = {
      id: `sora_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      prompt,
      style,
      createdAt: new Date(),
      scheduledFor: this.calculateNextSlot(),
      status: this.config.requireManualApproval ? 'pending' : 'approved',
    };

    this.queue.push(request);
    console.log(`Sora generation requested: ${request.id} (status: ${request.status})`);
    
    return request;
  }

  /**
   * Approve a pending request (when manual approval is required)
   */
  approveRequest(requestId: string): boolean {
    const request = this.queue.find(r => r.id === requestId);
    if (!request) {
      console.error(`Request ${requestId} not found`);
      return false;
    }

    if (request.status !== 'pending') {
      console.error(`Request ${requestId} is not pending (status: ${request.status})`);
      return false;
    }

    request.status = 'approved';
    console.log(`Request ${requestId} approved`);
    return true;
  }

  /**
   * Start a generation (call after canGenerateNow returns true)
   */
  startGeneration(requestId: string): boolean {
    const request = this.queue.find(r => r.id === requestId);
    if (!request || request.status !== 'approved') {
      return false;
    }

    const canGen = this.canGenerateNow();
    if (!canGen.allowed) {
      console.log(`Cannot start generation: ${canGen.reason}`);
      return false;
    }

    request.status = 'generating';
    this.activeGenerations.set(requestId, request);
    
    // Remove from queue
    const idx = this.queue.findIndex(r => r.id === requestId);
    if (idx !== -1) {
      this.queue.splice(idx, 1);
    }

    console.log(`Generation started: ${requestId}`);
    return true;
  }

  /**
   * Mark generation as completed
   */
  completeGeneration(requestId: string): void {
    const request = this.activeGenerations.get(requestId);
    if (!request) {
      console.error(`Active generation ${requestId} not found`);
      return;
    }

    request.status = 'completed';
    this.activeGenerations.delete(requestId);
    this.history.push(request);
    this.consecutiveErrors = 0;

    console.log(`Generation completed: ${requestId}`);

    // SINGLE-SHOT MODE: Auto-disable after one successful generation
    if (this.config.singleShotMode) {
      this.disable();
      console.log('🔴 Single-shot mode: Sora auto-disabled after 1 generation');
    }
  }

  /**
   * Mark generation as failed
   */
  failGeneration(requestId: string, error?: string): void {
    const request = this.activeGenerations.get(requestId);
    if (!request) {
      console.error(`Active generation ${requestId} not found`);
      return;
    }

    request.status = 'failed';
    this.activeGenerations.delete(requestId);
    this.history.push(request);
    this.consecutiveErrors++;

    console.error(`Generation failed: ${requestId}`, error);

    // Auto-pause on too many errors
    if (this.consecutiveErrors >= this.config.pauseOnConsecutiveErrors) {
      this.pause(`Auto-paused after ${this.consecutiveErrors} consecutive errors`);
    }
  }

  /**
   * Pause the rate limiter
   */
  pause(reason?: string): void {
    this.isPaused = true;
    this.pauseReason = reason;
    console.log(`Sora rate limiter paused: ${reason}`);
  }

  /**
   * Resume the rate limiter
   */
  resume(): void {
    this.isPaused = false;
    this.pauseReason = undefined;
    this.consecutiveErrors = 0;
    console.log('Sora rate limiter resumed');
  }

  /**
   * Get usage statistics
   */
  getStats(): SoraUsageStats {
    const todayGen = this.getTodayGenerationCount();
    const todayFailed = this.getTodayFailedCount();
    const weekGen = this.getWeekGenerationCount();
    const weekFailed = this.getWeekFailedCount();

    return {
      today: {
        generated: todayGen,
        failed: todayFailed,
        remaining: Math.max(0, this.config.maxVideosPerDay - todayGen),
      },
      thisWeek: {
        generated: weekGen,
        failed: weekFailed,
      },
      lastGeneration: this.getLastGenerationTime(),
      nextAllowedGeneration: this.canGenerateNow().nextAllowedAt || null,
      consecutiveErrors: this.consecutiveErrors,
      isPaused: this.isPaused,
      pauseReason: this.pauseReason,
    };
  }

  /**
   * Get the current config
   */
  getConfig(): SoraRateLimitConfig {
    return { ...this.config };
  }

  /**
   * Update config
   */
  updateConfig(updates: Partial<SoraRateLimitConfig>): void {
    this.config = { ...this.config, ...updates };
    console.log('Sora rate limit config updated');
  }

  /**
   * Get pending requests
   */
  getPendingRequests(): SoraGenerationRequest[] {
    return this.queue.filter(r => r.status === 'pending');
  }

  /**
   * Get approved requests waiting to run
   */
  getApprovedRequests(): SoraGenerationRequest[] {
    return this.queue.filter(r => r.status === 'approved');
  }

  // Private helpers

  private getTodayGenerationCount(): number {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    return this.history.filter(r => 
      r.status === 'completed' && 
      r.createdAt >= today
    ).length;
  }

  private getTodayFailedCount(): number {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    return this.history.filter(r => 
      r.status === 'failed' && 
      r.createdAt >= today
    ).length;
  }

  private getWeekGenerationCount(): number {
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    
    return this.history.filter(r => 
      r.status === 'completed' && 
      r.createdAt >= weekAgo
    ).length;
  }

  private getWeekFailedCount(): number {
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    
    return this.history.filter(r => 
      r.status === 'failed' && 
      r.createdAt >= weekAgo
    ).length;
  }

  private getLastGenerationTime(): Date | null {
    const completed = this.history
      .filter(r => r.status === 'completed')
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    
    return completed.length > 0 ? completed[0].createdAt : null;
  }

  private calculateNextSlot(): Date {
    const canGen = this.canGenerateNow();
    if (canGen.allowed) {
      return new Date();
    }
    return canGen.nextAllowedAt || new Date();
  }

  private getNextAllowedDay(from: Date): Date {
    const result = new Date(from);
    result.setHours(this.config.allowedStartHour, 0, 0, 0);
    
    // Find next allowed day
    for (let i = 1; i <= 7; i++) {
      result.setDate(result.getDate() + 1);
      if (this.config.allowedDays.includes(result.getDay())) {
        return result;
      }
    }
    
    return result;
  }

  private getNextAllowedTime(from: Date): Date {
    const result = new Date(from);
    
    if (from.getHours() >= this.config.allowedEndHour) {
      // After end hour - next day
      result.setDate(result.getDate() + 1);
    }
    
    result.setHours(this.config.allowedStartHour, 0, 0, 0);
    return result;
  }

  private getDayName(day: number): string {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return days[day];
  }
}
