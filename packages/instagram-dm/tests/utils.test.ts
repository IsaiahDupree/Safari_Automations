/**
 * Utils Tests
 */

import { describe, it, expect, vi } from 'vitest';
import {
  isWithinActiveHours,
  randomDelay,
  escapeForAppleScript,
  escapeForJS,
  parseUsername,
  truncate,
} from '../src/utils/index.js';

describe('isWithinActiveHours', () => {
  it('returns true during active hours', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-15T14:00:00')); // 2 PM
    
    expect(isWithinActiveHours({ activeHoursStart: 9, activeHoursEnd: 21 })).toBe(true);
    
    vi.useRealTimers();
  });

  it('returns false before active hours', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-15T07:00:00')); // 7 AM
    
    expect(isWithinActiveHours({ activeHoursStart: 9, activeHoursEnd: 21 })).toBe(false);
    
    vi.useRealTimers();
  });

  it('returns false after active hours', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-15T22:00:00')); // 10 PM
    
    expect(isWithinActiveHours({ activeHoursStart: 9, activeHoursEnd: 21 })).toBe(false);
    
    vi.useRealTimers();
  });
});

describe('randomDelay', () => {
  it('returns value within range', () => {
    for (let i = 0; i < 100; i++) {
      const delay = randomDelay(1000, 5000);
      expect(delay).toBeGreaterThanOrEqual(1000);
      expect(delay).toBeLessThan(5000);
    }
  });

  it('uses default values', () => {
    const delay = randomDelay();
    expect(delay).toBeGreaterThanOrEqual(60000);
    expect(delay).toBeLessThan(300000);
  });
});

describe('escapeForAppleScript', () => {
  it('escapes backslashes', () => {
    expect(escapeForAppleScript('path\\to\\file')).toBe('path\\\\to\\\\file');
  });

  it('escapes double quotes', () => {
    expect(escapeForAppleScript('say "hello"')).toBe('say \\"hello\\"');
  });

  it('escapes single quotes', () => {
    const result = escapeForAppleScript("it's");
    expect(result).toContain("'");
  });
});

describe('escapeForJS', () => {
  it('escapes single quotes', () => {
    expect(escapeForJS("it's")).toBe("it\\'s");
  });

  it('escapes double quotes', () => {
    expect(escapeForJS('say "hi"')).toBe('say \\"hi\\"');
  });

  it('escapes newlines', () => {
    expect(escapeForJS('line1\nline2')).toBe('line1\\nline2');
  });

  it('escapes carriage returns', () => {
    expect(escapeForJS('line1\rline2')).toBe('line1\\rline2');
  });
});

describe('parseUsername', () => {
  it('extracts username from Instagram URL', () => {
    expect(parseUsername('https://instagram.com/johndoe')).toBe('johndoe');
    expect(parseUsername('https://www.instagram.com/johndoe/')).toBe('johndoe');
    expect(parseUsername('instagram.com/johndoe?igshid=123')).toBe('johndoe');
  });

  it('removes @ prefix', () => {
    expect(parseUsername('@johndoe')).toBe('johndoe');
  });

  it('trims whitespace', () => {
    expect(parseUsername('  johndoe  ')).toBe('johndoe');
  });

  it('returns plain username as-is', () => {
    expect(parseUsername('johndoe')).toBe('johndoe');
  });
});

describe('truncate', () => {
  it('returns short text unchanged', () => {
    expect(truncate('hello', 10)).toBe('hello');
  });

  it('truncates long text with ellipsis', () => {
    expect(truncate('hello world', 8)).toBe('hello...');
  });

  it('handles exact length', () => {
    expect(truncate('hello', 5)).toBe('hello');
  });

  it('uses default max length', () => {
    const longText = 'a'.repeat(100);
    const result = truncate(longText);
    expect(result.length).toBe(50);
    expect(result.endsWith('...')).toBe(true);
  });
});
