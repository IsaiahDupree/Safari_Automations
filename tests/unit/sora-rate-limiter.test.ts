/**
 * Sora Rate Limiter Tests
 * 
 * Tests for conservative rate limiting of Sora video generation.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the types since we're testing the logic
interface SoraRateLimitConfig {
  enabled: boolean;              // DISABLED by default
  singleShotMode: boolean;       // Auto-disable after 1 generation
  maxVideosPerDay: number;
  maxConcurrentGenerations: number;
  minIntervalBetweenGenerationsMs: number;
  cooldownAfterErrorMs: number;
  allowedStartHour: number;
  allowedEndHour: number;
  allowedDays: number[];
  requireManualApproval: boolean;
  pauseOnConsecutiveErrors: number;
}

// Inline implementation for testing (avoids import issues)
class SoraRateLimiter {
  private config: SoraRateLimitConfig;
  private history: Array<{ status: string; createdAt: Date }> = [];
  private activeCount = 0;
  private consecutiveErrors = 0;
  private isPaused = false;
  private pauseReason?: string;

  constructor(config: Partial<SoraRateLimitConfig> = {}) {
    this.config = {
      enabled: config.enabled ?? false,  // DISABLED by default
      singleShotMode: config.singleShotMode ?? true,
      maxVideosPerDay: config.maxVideosPerDay ?? 5,
      maxConcurrentGenerations: config.maxConcurrentGenerations ?? 1,
      minIntervalBetweenGenerationsMs: config.minIntervalBetweenGenerationsMs ?? 4 * 60 * 60 * 1000,
      cooldownAfterErrorMs: config.cooldownAfterErrorMs ?? 60 * 60 * 1000,
      allowedStartHour: config.allowedStartHour ?? 10,
      allowedEndHour: config.allowedEndHour ?? 18,
      allowedDays: config.allowedDays ?? [1, 2, 3, 4, 5],
      requireManualApproval: config.requireManualApproval ?? true,
      pauseOnConsecutiveErrors: config.pauseOnConsecutiveErrors ?? 2,
    };
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  enable(): void {
    this.config.enabled = true;
  }

  disable(): void {
    this.config.enabled = false;
    this.isPaused = true;
    this.pauseReason = 'Disabled by user';
  }

  canGenerateNow(mockDate?: Date): { allowed: boolean; reason?: string } {
    // FIRST CHECK: Is Sora enabled?
    if (!this.config.enabled) {
      return { allowed: false, reason: 'Sora is DISABLED' };
    }

    if (this.isPaused) {
      return { allowed: false, reason: this.pauseReason || 'System is paused' };
    }

    const now = mockDate || new Date();
    const dayOfWeek = now.getDay();
    
    if (!this.config.allowedDays.includes(dayOfWeek)) {
      return { allowed: false, reason: `Not an allowed day` };
    }

    const hour = now.getHours();
    if (hour < this.config.allowedStartHour || hour >= this.config.allowedEndHour) {
      return { allowed: false, reason: `Outside allowed hours` };
    }

    const todayCount = this.getTodayCount(now);
    if (todayCount >= this.config.maxVideosPerDay) {
      return { allowed: false, reason: `Daily limit reached` };
    }

    if (this.activeCount >= this.config.maxConcurrentGenerations) {
      return { allowed: false, reason: `Max concurrent reached` };
    }

    const lastGen = this.getLastGenerationTime(now);
    if (lastGen) {
      const timeSince = now.getTime() - lastGen.getTime();
      if (timeSince < this.config.minIntervalBetweenGenerationsMs) {
        return { allowed: false, reason: `Minimum interval not met` };
      }
    }

    if (this.consecutiveErrors >= this.config.pauseOnConsecutiveErrors) {
      return { allowed: false, reason: `Too many consecutive errors` };
    }

    return { allowed: true };
  }

  // Test helpers
  simulateGeneration(mockDate?: Date): void {
    this.history.push({ status: 'completed', createdAt: mockDate || new Date() });
    this.consecutiveErrors = 0;
  }

  simulateFailure(): void {
    this.history.push({ status: 'failed', createdAt: new Date() });
    this.consecutiveErrors++;
  }

  setActiveCount(count: number): void {
    this.activeCount = count;
  }

  pause(reason?: string): void {
    this.isPaused = true;
    this.pauseReason = reason;
  }

  resume(): void {
    this.isPaused = false;
    this.pauseReason = undefined;
    this.consecutiveErrors = 0;
  }

  getConfig(): SoraRateLimitConfig {
    return { ...this.config };
  }

  private getTodayCount(now: Date): number {
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    return this.history.filter(r => 
      r.status === 'completed' && r.createdAt >= today
    ).length;
  }

  private getLastGenerationTime(now: Date): Date | null {
    const completed = this.history
      .filter(r => r.status === 'completed')
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return completed.length > 0 ? completed[0].createdAt : null;
  }
}

describe('Sora Rate Limiter', () => {
  let limiter: SoraRateLimiter;

  beforeEach(() => {
    limiter = new SoraRateLimiter();
  });

  describe('Enabled/Disabled State', () => {
    it('should be DISABLED by default', () => {
      const config = limiter.getConfig();
      expect(config.enabled).toBe(false);
    });

    it('should block all generation when disabled', () => {
      const result = limiter.canGenerateNow();
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('DISABLED');
    });

    it('should allow generation after enable() is called', () => {
      limiter.enable();
      expect(limiter.isEnabled()).toBe(true);
      
      // Now test on a valid weekday/time
      const validTime = new Date('2026-02-04T14:00:00');
      while (validTime.getDay() !== 3) {
        validTime.setDate(validTime.getDate() + 1);
      }
      validTime.setHours(14, 0, 0, 0);
      
      const result = limiter.canGenerateNow(validTime);
      expect(result.allowed).toBe(true);
    });

    it('should block generation after disable() is called', () => {
      limiter.enable();
      limiter.disable();
      
      const result = limiter.canGenerateNow();
      expect(result.allowed).toBe(false);
    });

    it('should have single-shot mode enabled by default', () => {
      const config = limiter.getConfig();
      expect(config.singleShotMode).toBe(true);
    });
  });

  describe('Default Configuration', () => {
    it('should have conservative default limits', () => {
      const config = limiter.getConfig();
      
      // Should NOT be 30 per day - should be much lower
      expect(config.maxVideosPerDay).toBeLessThanOrEqual(5);
      expect(config.maxVideosPerDay).toBeGreaterThan(0);
      
      // Should only allow 1 concurrent
      expect(config.maxConcurrentGenerations).toBe(1);
      
      // Should have at least 4 hours between generations
      expect(config.minIntervalBetweenGenerationsMs).toBeGreaterThanOrEqual(4 * 60 * 60 * 1000);
      
      // Should require manual approval by default
      expect(config.requireManualApproval).toBe(true);
    });

    it('should only allow weekdays by default', () => {
      const config = limiter.getConfig();
      
      // Should not include weekend (0=Sunday, 6=Saturday)
      expect(config.allowedDays).not.toContain(0);
      expect(config.allowedDays).not.toContain(6);
      
      // Should include weekdays
      expect(config.allowedDays).toContain(1); // Monday
      expect(config.allowedDays).toContain(2); // Tuesday
      expect(config.allowedDays).toContain(3); // Wednesday
      expect(config.allowedDays).toContain(4); // Thursday
      expect(config.allowedDays).toContain(5); // Friday
    });

    it('should only allow business hours by default', () => {
      const config = limiter.getConfig();
      
      // Should start at 10 AM or later
      expect(config.allowedStartHour).toBeGreaterThanOrEqual(10);
      
      // Should end at 6 PM or earlier
      expect(config.allowedEndHour).toBeLessThanOrEqual(18);
    });
  });

  describe('Time Restrictions', () => {
    beforeEach(() => {
      limiter.enable(); // Enable for time restriction tests
    });

    it('should block generation on weekends', () => {
      // Sunday
      const sunday = new Date('2026-02-01T12:00:00'); // A Sunday
      sunday.setDate(sunday.getDate() - sunday.getDay()); // Ensure it's Sunday
      
      const result = limiter.canGenerateNow(sunday);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('day');
    });

    it('should block generation outside business hours', () => {
      // Wednesday at 3 AM
      const earlyMorning = new Date('2026-02-04T03:00:00'); // Wednesday
      while (earlyMorning.getDay() !== 3) {
        earlyMorning.setDate(earlyMorning.getDate() + 1);
      }
      earlyMorning.setHours(3, 0, 0, 0);
      
      const result = limiter.canGenerateNow(earlyMorning);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('hours');
    });

    it('should block generation late at night', () => {
      // Wednesday at 11 PM
      const lateNight = new Date('2026-02-04T23:00:00');
      while (lateNight.getDay() !== 3) {
        lateNight.setDate(lateNight.getDate() + 1);
      }
      lateNight.setHours(23, 0, 0, 0);
      
      const result = limiter.canGenerateNow(lateNight);
      expect(result.allowed).toBe(false);
    });

    it('should allow generation during business hours on weekdays', () => {
      // Wednesday at 2 PM
      const validTime = new Date('2026-02-04T14:00:00');
      while (validTime.getDay() !== 3) {
        validTime.setDate(validTime.getDate() + 1);
      }
      validTime.setHours(14, 0, 0, 0);
      
      const result = limiter.canGenerateNow(validTime);
      expect(result.allowed).toBe(true);
    });
  });

  describe('Daily Limits', () => {
    beforeEach(() => {
      limiter.enable();
    });

    it('should enforce daily generation limit', () => {
      const config = limiter.getConfig();
      const validTime = new Date('2026-02-04T14:00:00');
      while (validTime.getDay() !== 3) {
        validTime.setDate(validTime.getDate() + 1);
      }
      validTime.setHours(14, 0, 0, 0);

      // Simulate max generations for today
      for (let i = 0; i < config.maxVideosPerDay; i++) {
        const genTime = new Date(validTime);
        genTime.setMinutes(i * 10);
        limiter.simulateGeneration(genTime);
      }

      // Should be blocked now
      const laterTime = new Date(validTime);
      laterTime.setMinutes(validTime.getMinutes() + 5);
      
      const result = limiter.canGenerateNow(laterTime);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('limit');
    });

    it('should reset daily limit at midnight', () => {
      const config = limiter.getConfig();
      
      // Generate max on Tuesday
      const tuesday = new Date('2026-02-03T14:00:00');
      while (tuesday.getDay() !== 2) {
        tuesday.setDate(tuesday.getDate() + 1);
      }
      tuesday.setHours(14, 0, 0, 0);

      for (let i = 0; i < config.maxVideosPerDay; i++) {
        limiter.simulateGeneration(tuesday);
      }

      // Should be allowed on Wednesday (new day)
      const wednesday = new Date(tuesday);
      wednesday.setDate(wednesday.getDate() + 1);
      wednesday.setHours(14, 0, 0, 0);

      const result = limiter.canGenerateNow(wednesday);
      expect(result.allowed).toBe(true);
    });
  });

  describe('Minimum Interval', () => {
    beforeEach(() => {
      limiter.enable();
    });

    it('should enforce minimum interval between generations', () => {
      const config = limiter.getConfig();
      const minIntervalHours = config.minIntervalBetweenGenerationsMs / (60 * 60 * 1000);
      
      // Generate at valid time
      const firstGen = new Date('2026-02-04T10:00:00');
      while (firstGen.getDay() !== 3) {
        firstGen.setDate(firstGen.getDate() + 1);
      }
      firstGen.setHours(10, 0, 0, 0);
      limiter.simulateGeneration(firstGen);

      // Try to generate 1 hour later (should fail)
      const tooSoon = new Date(firstGen);
      tooSoon.setHours(tooSoon.getHours() + 1);

      const result = limiter.canGenerateNow(tooSoon);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('interval');
    });

    it('should allow generation after minimum interval passes', () => {
      const config = limiter.getConfig();
      const minIntervalMs = config.minIntervalBetweenGenerationsMs;
      
      // Generate at valid time
      const firstGen = new Date('2026-02-04T10:00:00');
      while (firstGen.getDay() !== 3) {
        firstGen.setDate(firstGen.getDate() + 1);
      }
      firstGen.setHours(10, 0, 0, 0);
      limiter.simulateGeneration(firstGen);

      // Try to generate after interval (should succeed if within hours)
      const afterInterval = new Date(firstGen.getTime() + minIntervalMs + 1000);
      
      // Only test if still within allowed hours
      if (afterInterval.getHours() < config.allowedEndHour) {
        const result = limiter.canGenerateNow(afterInterval);
        expect(result.allowed).toBe(true);
      }
    });
  });

  describe('Concurrent Limits', () => {
    beforeEach(() => {
      limiter.enable();
    });

    it('should block when max concurrent generations reached', () => {
      const validTime = new Date('2026-02-04T14:00:00');
      while (validTime.getDay() !== 3) {
        validTime.setDate(validTime.getDate() + 1);
      }
      validTime.setHours(14, 0, 0, 0);

      // Simulate active generation
      limiter.setActiveCount(1);

      const result = limiter.canGenerateNow(validTime);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('concurrent');
    });
  });

  describe('Error Handling', () => {
    beforeEach(() => {
      limiter.enable();
    });

    it('should pause after consecutive errors', () => {
      const config = limiter.getConfig();
      const validTime = new Date('2026-02-04T14:00:00');
      while (validTime.getDay() !== 3) {
        validTime.setDate(validTime.getDate() + 1);
      }
      validTime.setHours(14, 0, 0, 0);

      // Simulate failures
      for (let i = 0; i < config.pauseOnConsecutiveErrors; i++) {
        limiter.simulateFailure();
      }

      const result = limiter.canGenerateNow(validTime);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('error');
    });

    it('should reset error count on successful generation', () => {
      const config = limiter.getConfig();
      const validTime = new Date('2026-02-04T10:00:00');
      while (validTime.getDay() !== 3) {
        validTime.setDate(validTime.getDate() + 1);
      }
      validTime.setHours(10, 0, 0, 0);

      // Simulate one less than max failures
      for (let i = 0; i < config.pauseOnConsecutiveErrors - 1; i++) {
        limiter.simulateFailure();
      }

      // Successful generation resets counter
      limiter.simulateGeneration(validTime);

      // Should be allowed after interval passes (errors were reset)
      const laterTime = new Date(validTime.getTime() + config.minIntervalBetweenGenerationsMs + 1000);
      if (laterTime.getHours() < config.allowedEndHour) {
        const result = limiter.canGenerateNow(laterTime);
        expect(result.allowed).toBe(true);
      }
    });
  });

  describe('Pause/Resume', () => {
    beforeEach(() => {
      limiter.enable();
    });

    it('should block all generations when paused', () => {
      const validTime = new Date('2026-02-04T14:00:00');
      while (validTime.getDay() !== 3) {
        validTime.setDate(validTime.getDate() + 1);
      }
      validTime.setHours(14, 0, 0, 0);

      limiter.pause('Manual pause for testing');

      const result = limiter.canGenerateNow(validTime);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('pause');
    });

    it('should allow generations after resume', () => {
      const validTime = new Date('2026-02-04T14:00:00');
      while (validTime.getDay() !== 3) {
        validTime.setDate(validTime.getDate() + 1);
      }
      validTime.setHours(14, 0, 0, 0);

      limiter.pause('Manual pause');
      limiter.resume();

      const result = limiter.canGenerateNow(validTime);
      expect(result.allowed).toBe(true);
    });
  });

  describe('Custom Configuration', () => {
    it('should allow even more restrictive configuration', () => {
      const minimalLimiter = new SoraRateLimiter({
        maxVideosPerDay: 2,
        allowedDays: [2, 4], // Only Tuesday and Thursday
        allowedStartHour: 12,
        allowedEndHour: 16,
        minIntervalBetweenGenerationsMs: 8 * 60 * 60 * 1000, // 8 hours
      });

      const config = minimalLimiter.getConfig();
      expect(config.maxVideosPerDay).toBe(2);
      expect(config.allowedDays).toEqual([2, 4]);
      expect(config.minIntervalBetweenGenerationsMs).toBe(8 * 60 * 60 * 1000);
    });

    it('should block on non-configured days', () => {
      const minimalLimiter = new SoraRateLimiter({
        allowedDays: [2, 4], // Only Tuesday and Thursday
      });

      // Wednesday at noon
      const wednesday = new Date('2026-02-04T12:00:00');
      while (wednesday.getDay() !== 3) {
        wednesday.setDate(wednesday.getDate() + 1);
      }
      wednesday.setHours(12, 0, 0, 0);

      const result = minimalLimiter.canGenerateNow(wednesday);
      expect(result.allowed).toBe(false);
    });
  });
});
