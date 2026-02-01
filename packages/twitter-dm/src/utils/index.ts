/**
 * Twitter/X DM Utilities
 */

/**
 * Check if current time is within active hours.
 */
export function isWithinActiveHours(start: number = 9, end: number = 21): boolean {
  const hour = new Date().getHours();
  return hour >= start && hour < end;
}

/**
 * Get a random delay within range.
 */
export function randomDelay(minMs: number, maxMs: number): number {
  return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
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
 * Escape string for JavaScript.
 */
export function escapeForJS(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

/**
 * Parse username from various formats.
 */
export function parseUsername(input: string): string {
  // Remove @ prefix
  let username = input.replace(/^@/, '');
  
  // Extract from URL
  const urlMatch = username.match(/(?:x\.com|twitter\.com)\/([a-zA-Z0-9_]+)/);
  if (urlMatch) {
    username = urlMatch[1];
  }
  
  return username.toLowerCase();
}

/**
 * Format timestamp for display.
 */
export function formatTimestamp(date: Date = new Date()): string {
  return date.toISOString().replace('T', ' ').substring(0, 19);
}

/**
 * Truncate string with ellipsis.
 */
export function truncate(str: string, maxLength: number = 100): string {
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength - 3) + '...';
}

/**
 * Validate Twitter username format.
 */
export function isValidUsername(username: string): boolean {
  // Twitter usernames: 1-15 chars, alphanumeric + underscore
  return /^[a-zA-Z0-9_]{1,15}$/.test(username);
}

/**
 * Format rate limit status for display.
 */
export function formatRateLimitStatus(
  hourly: number,
  maxHourly: number,
  daily: number,
  maxDaily: number
): string {
  const hourlyPct = Math.round((hourly / maxHourly) * 100);
  const dailyPct = Math.round((daily / maxDaily) * 100);
  
  return `Hourly: ${hourly}/${maxHourly} (${hourlyPct}%) | Daily: ${daily}/${maxDaily} (${dailyPct}%)`;
}
