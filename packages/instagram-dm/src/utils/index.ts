/**
 * Utility functions for Instagram DM automation
 */

import type { RateLimitConfig, DEFAULT_RATE_LIMITS } from '../automation/types.js';

/**
 * Check if current time is within active hours.
 */
export function isWithinActiveHours(
  config: Pick<RateLimitConfig, 'activeHoursStart' | 'activeHoursEnd'> = { activeHoursStart: 9, activeHoursEnd: 21 }
): boolean {
  const hour = new Date().getHours();
  return hour >= config.activeHoursStart && hour < config.activeHoursEnd;
}

/**
 * Generate a random delay between min and max.
 */
export function randomDelay(minMs: number = 60000, maxMs: number = 300000): number {
  return Math.floor(Math.random() * (maxMs - minMs) + minMs);
}

/**
 * Sleep for specified milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Escape string for AppleScript.
 */
export function escapeForAppleScript(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/'/g, "'\"'\"'");
}

/**
 * Escape string for JavaScript in browser.
 */
export function escapeForJS(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

/**
 * Parse Instagram username from URL or text.
 */
export function parseUsername(input: string): string {
  // Handle URL format
  const urlMatch = input.match(/instagram\.com\/([^\/\?]+)/);
  if (urlMatch) return urlMatch[1];
  
  // Handle @username format
  if (input.startsWith('@')) return input.slice(1);
  
  // Return as-is
  return input.trim();
}

/**
 * Format timestamp for display.
 */
export function formatTimestamp(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Truncate text with ellipsis.
 */
export function truncate(text: string, maxLength: number = 50): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}
