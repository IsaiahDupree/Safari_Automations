import { describe, expect, it } from 'vitest';

import { urlMatchesPattern } from '../src/automation/tab-coordinator.js';


describe('urlMatchesPattern', () => {
  it('matches the requested hostname and optional path only', () => {
    expect(urlMatchesPattern('https://www.google.com/search?q=ai', 'google.com')).toBe(true);
    expect(urlMatchesPattern('https://business.instagram.com/direct/inbox', 'instagram.com/direct')).toBe(true);
    expect(urlMatchesPattern('https://instagram.com/explore', 'instagram.com/direct')).toBe(false);
  });

  it('does not match a hostname mentioned only in a query string', () => {
    expect(urlMatchesPattern(
      'http://localhost:8747/?iss=https://accounts.google.com&code=sensitive',
      'google.com',
    )).toBe(false);
    expect(urlMatchesPattern('https://notgoogle.com/', 'google.com')).toBe(false);
  });
});
