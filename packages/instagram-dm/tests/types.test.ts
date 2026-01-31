/**
 * Types Tests
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CONFIG,
  DEFAULT_RATE_LIMITS,
} from '../src/automation/types.js';

describe('DEFAULT_CONFIG', () => {
  it('has correct default values', () => {
    expect(DEFAULT_CONFIG.instanceType).toBe('local');
    expect(DEFAULT_CONFIG.timeout).toBe(30000);
    expect(DEFAULT_CONFIG.actionDelay).toBe(1000);
    expect(DEFAULT_CONFIG.verbose).toBe(false);
  });
});

describe('DEFAULT_RATE_LIMITS', () => {
  it('has sensible rate limits', () => {
    expect(DEFAULT_RATE_LIMITS.messagesPerHour).toBe(10);
    expect(DEFAULT_RATE_LIMITS.messagesPerDay).toBe(30);
    expect(DEFAULT_RATE_LIMITS.minDelayMs).toBe(60000);
    expect(DEFAULT_RATE_LIMITS.maxDelayMs).toBe(300000);
    expect(DEFAULT_RATE_LIMITS.activeHoursStart).toBe(9);
    expect(DEFAULT_RATE_LIMITS.activeHoursEnd).toBe(21);
  });

  it('min delay is less than max delay', () => {
    expect(DEFAULT_RATE_LIMITS.minDelayMs).toBeLessThan(DEFAULT_RATE_LIMITS.maxDelayMs);
  });

  it('active hours are valid', () => {
    expect(DEFAULT_RATE_LIMITS.activeHoursStart).toBeGreaterThanOrEqual(0);
    expect(DEFAULT_RATE_LIMITS.activeHoursStart).toBeLessThan(24);
    expect(DEFAULT_RATE_LIMITS.activeHoursEnd).toBeGreaterThan(DEFAULT_RATE_LIMITS.activeHoursStart);
    expect(DEFAULT_RATE_LIMITS.activeHoursEnd).toBeLessThanOrEqual(24);
  });
});
