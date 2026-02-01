/**
 * TikTok DM Utility Functions
 */

import { RateLimitConfig, DEFAULT_RATE_LIMITS } from '../automation/types.js';

/**
 * Check if current time is within active hours
 */
export function isWithinActiveHours(
  config: RateLimitConfig = DEFAULT_RATE_LIMITS
): boolean {
  const now = new Date();
  const hour = now.getHours();
  return hour >= config.activeHoursStart && hour < config.activeHoursEnd;
}

/**
 * Get a random delay within the configured range
 */
export function getRandomDelay(
  config: RateLimitConfig = DEFAULT_RATE_LIMITS
): number {
  return Math.floor(
    Math.random() * (config.maxDelayMs - config.minDelayMs) + config.minDelayMs
  );
}

/**
 * Sleep for specified milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Escape string for JavaScript injection
 */
export function escapeForJs(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

/**
 * Parse TikTok username from various formats
 */
export function parseUsername(input: string): string {
  // Remove @ prefix if present
  let username = input.trim().replace(/^@/, '');
  
  // Extract from URL if it's a URL
  const urlMatch = username.match(/tiktok\.com\/@([a-zA-Z0-9_.]+)/);
  if (urlMatch) {
    username = urlMatch[1];
  }
  
  return username;
}

/**
 * Validate TikTok username format
 */
export function isValidUsername(username: string): boolean {
  // TikTok usernames: 1-24 characters, letters, numbers, underscores, periods
  const parsed = parseUsername(username);
  return /^[a-zA-Z0-9_.]{1,24}$/.test(parsed);
}

/**
 * Format rate limit status for display
 */
export function formatRateLimitStatus(
  sentThisHour: number,
  sentToday: number,
  config: RateLimitConfig = DEFAULT_RATE_LIMITS
): string {
  const hourlyPct = Math.round((sentThisHour / config.messagesPerHour) * 100);
  const dailyPct = Math.round((sentToday / config.messagesPerDay) * 100);
  
  return [
    `Hourly: ${sentThisHour}/${config.messagesPerHour} (${hourlyPct}%)`,
    `Daily: ${sentToday}/${config.messagesPerDay} (${dailyPct}%)`,
    `Active: ${isWithinActiveHours(config) ? 'Yes' : 'No'}`,
  ].join(' | ');
}

/**
 * Calculate time until next active hour
 */
export function getTimeUntilActiveHours(
  config: RateLimitConfig = DEFAULT_RATE_LIMITS
): number {
  const now = new Date();
  const hour = now.getHours();
  
  if (hour >= config.activeHoursStart && hour < config.activeHoursEnd) {
    return 0; // Already in active hours
  }
  
  let hoursUntil: number;
  if (hour < config.activeHoursStart) {
    hoursUntil = config.activeHoursStart - hour;
  } else {
    hoursUntil = 24 - hour + config.activeHoursStart;
  }
  
  return hoursUntil * 60 * 60 * 1000; // Convert to milliseconds
}

/**
 * Retry a function with exponential backoff
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelayMs: number = 1000
): Promise<T> {
  let lastError: Error | undefined;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      if (attempt < maxRetries - 1) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        await sleep(delay);
      }
    }
  }
  
  throw lastError;
}
