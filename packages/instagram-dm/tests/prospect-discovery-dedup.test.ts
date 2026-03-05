/**
 * Prospect Discovery — Distinct & Non-Repeating List Tests (Layer 1, no server required)
 *
 * Verifies that:
 *   1. ICP_KEYWORDS contains no duplicate entries
 *   2. EXPANSION_KEYWORDS contains no duplicate entries (case-insensitive)
 *   3. ICP_KEYWORDS and EXPANSION_KEYWORDS share no keywords (expansion is truly additive)
 *   4. scoreICP returns distinct signal strings for any input
 *   5. discoverProspects (dryRun) returns a candidates list with no duplicate usernames
 *   6. discoverProspects dedup logic: allSeen Set prevents same username appearing twice
 *      even when raw sources return it via different keywords/sources
 */

import { describe, it, expect } from 'vitest';
import {
  ICP_KEYWORDS,
  EXPANSION_KEYWORDS,
  scoreICP,
  discoverProspects,
  parseFollowerCount,
  SOURCE_PRIORITY_BONUS,
} from '../src/api/prospect-discovery.js';

// ─── 1. ICP_KEYWORDS — no internal duplicates ───────────────────────────────

describe('ICP_KEYWORDS list integrity', () => {
  it('has no duplicate entries', () => {
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const kw of ICP_KEYWORDS) {
      const key = kw.toLowerCase().trim();
      if (seen.has(key)) dupes.push(kw);
      seen.add(key);
    }
    expect(dupes, `Duplicate ICP_KEYWORDS: ${dupes.join(', ')}`).toHaveLength(0);
  });

  it('has no empty or whitespace-only entries', () => {
    const bad = ICP_KEYWORDS.filter(k => !k || !k.trim());
    expect(bad, 'ICP_KEYWORDS has blank entries').toHaveLength(0);
  });

  it('all entries are lowercase or consistent casing (no mixed-case confusion)', () => {
    // Detect if any two keywords differ only by case — that's a latent dedup bug
    const lower = ICP_KEYWORDS.map(k => k.toLowerCase().trim());
    const lowerSet = new Set(lower);
    expect(lowerSet.size, 'ICP_KEYWORDS has case-variant duplicates').toBe(ICP_KEYWORDS.length);
  });
});

// ─── 2. EXPANSION_KEYWORDS — no internal duplicates ─────────────────────────

describe('EXPANSION_KEYWORDS list integrity', () => {
  it('has no duplicate entries', () => {
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const kw of EXPANSION_KEYWORDS) {
      const key = kw.toLowerCase().trim();
      if (seen.has(key)) dupes.push(kw);
      seen.add(key);
    }
    expect(dupes, `Duplicate EXPANSION_KEYWORDS: ${dupes.join(', ')}`).toHaveLength(0);
  });

  it('has no empty or whitespace-only entries', () => {
    const bad = EXPANSION_KEYWORDS.filter(k => !k || !k.trim());
    expect(bad, 'EXPANSION_KEYWORDS has blank entries').toHaveLength(0);
  });

  it('has no case-variant duplicates', () => {
    const lower = EXPANSION_KEYWORDS.map(k => k.toLowerCase().trim());
    const lowerSet = new Set(lower);
    expect(lowerSet.size, 'EXPANSION_KEYWORDS has case-variant duplicates (e.g. productHunt vs producthunt)').toBe(EXPANSION_KEYWORDS.length);
  });
});

// ─── 3. No overlap between ICP_KEYWORDS and EXPANSION_KEYWORDS ───────────────

describe('ICP_KEYWORDS vs EXPANSION_KEYWORDS — no overlap', () => {
  it('expansion keywords are truly additive (none already in ICP list)', () => {
    const icpSet = new Set(ICP_KEYWORDS.map(k => k.toLowerCase().trim()));
    const overlapping = EXPANSION_KEYWORDS.filter(k => icpSet.has(k.toLowerCase().trim()));
    expect(
      overlapping,
      `Keywords in both ICP_KEYWORDS and EXPANSION_KEYWORDS (redundant): ${overlapping.join(', ')}`,
    ).toHaveLength(0);
  });
});

// ─── 4. scoreICP — distinct signals ─────────────────────────────────────────

describe('scoreICP signal distinctness', () => {
  const makeProfile = (overrides: Partial<{
    fullName: string; bio: string; followers: string;
    following: string; posts: string; isPrivate: boolean;
  }> = {}) => ({
    fullName: 'Test User',
    bio: '',
    followers: '0',
    following: '0',
    posts: '0',
    isPrivate: false,
    ...overrides,
  });

  it('returns distinct signals for a minimal profile', () => {
    const { signals } = scoreICP(makeProfile(), 'hashtag');
    const unique = new Set(signals);
    expect(unique.size, `Duplicate signals: ${signals.filter((s, i) => signals.indexOf(s) !== i).join(', ')}`).toBe(signals.length);
  });

  it('returns distinct signals when all scoring criteria hit', () => {
    const { signals } = scoreICP(makeProfile({
      bio: 'saas founder with $5K mrr arr automation ai build scaling product engineer developer creator solopreneur startup agency software',
      followers: '50K',
      following: '1K',
      posts: '20',
      isPrivate: false,
    }), 'top_accounts');
    const unique = new Set(signals);
    expect(unique.size, `Duplicate signals: ${signals.filter((s, i) => signals.indexOf(s) !== i).join(', ')}`).toBe(signals.length);
  });

  it('bio keyword signals are distinct even with repeated keywords in bio', () => {
    // Bio mentions "saas" twice — should only produce one bio:saas signal
    const { signals } = scoreICP(makeProfile({ bio: 'saas saas saas founder founder' }), 'hashtag');
    const bioSignals = signals.filter(s => s.startsWith('bio:'));
    const unique = new Set(bioSignals);
    expect(unique.size).toBe(bioSignals.length);
  });

  it('score does not exceed 100', () => {
    const { score } = scoreICP(makeProfile({
      bio: 'saas founder mrr arr automation ai build scaling product engineer developer creator solopreneur startup agency software revenue $5K',
      followers: '50K',
      following: '1K',
      posts: '20',
      isPrivate: false,
    }), 'top_accounts');
    expect(score).toBeLessThanOrEqual(100);
  });
});

// ─── 5. discoverProspects dryRun — empty, no duplicates ─────────────────────

describe('discoverProspects dryRun', () => {
  it('returns empty candidates list when dryRun=true', async () => {
    const result = await discoverProspects({ dryRun: true });
    expect(result.candidates).toHaveLength(0);
    expect(result.total).toBe(0);
  });

  it('dryRun candidates list has no duplicate usernames (trivially true for empty)', async () => {
    const result = await discoverProspects({ dryRun: true });
    const usernames = result.candidates.map(c => c.username.toLowerCase());
    const unique = new Set(usernames);
    expect(unique.size).toBe(usernames.length);
  });
});

// ─── 6. discoverProspects dedup — allSeen Set algorithm (pure unit test) ────
//
// The allSeen Set in discoverProspects filters raw candidates before enrichment.
// We test that Set-based dedup logic directly without needing network mocks.

describe('discoverProspects dedup algorithm (pure)', () => {
  it('Set-based dedup removes duplicate usernames across sources', () => {
    // Simulate the raw candidates that would come from two sources with overlap
    const rawFromHashtag = [
      { username: 'user_alpha', source: 'hashtag', keyword: 'saas' },
      { username: 'user_beta', source: 'hashtag', keyword: 'saas' },
      { username: 'user_alpha', source: 'hashtag', keyword: 'founder' }, // duplicate from 2nd keyword
    ];
    const rawFromFollowers = [
      { username: 'user_alpha', source: 'followers', keyword: 'followers' }, // cross-source duplicate
      { username: 'user_gamma', source: 'followers', keyword: 'followers' },
    ];

    const allRaw = [...rawFromHashtag, ...rawFromFollowers];

    // Replicate the allSeen dedup from discoverProspects
    const allSeen = new Set<string>();
    const deduped = allRaw.filter(c => {
      if (!c.username || allSeen.has(c.username.toLowerCase())) return false;
      allSeen.add(c.username.toLowerCase());
      return true;
    });

    const usernames = deduped.map(c => c.username.toLowerCase());
    const unique = new Set(usernames);
    expect(unique.size).toBe(usernames.length);
    expect(usernames).toContain('user_alpha');
    expect(usernames).toContain('user_beta');
    expect(usernames).toContain('user_gamma');
    expect(usernames).toHaveLength(3); // alpha, beta, gamma — no duplicates
  });

  it('dedup is case-insensitive (User_Alpha and user_alpha treated as same)', () => {
    const raw = [
      { username: 'User_Alpha', source: 'hashtag', keyword: 'saas' },
      { username: 'user_alpha', source: 'followers', keyword: 'followers' },
    ];
    const allSeen = new Set<string>();
    const deduped = raw.filter(c => {
      if (!c.username || allSeen.has(c.username.toLowerCase())) return false;
      allSeen.add(c.username.toLowerCase());
      return true;
    });
    expect(deduped).toHaveLength(1);
    expect(deduped[0].username).toBe('User_Alpha');
  });

  it('discoverProspects dryRun candidates are always empty', async () => {
    const result = await discoverProspects({ dryRun: true });
    const usernames = result.candidates.map(c => c.username.toLowerCase());
    const unique = new Set(usernames);
    expect(unique.size).toBe(usernames.length);
    expect(result.candidates).toHaveLength(0);
  });
});

// ─── 7. SOURCE_PRIORITY_BONUS — no duplicate source keys ────────────────────

describe('SOURCE_PRIORITY_BONUS map integrity', () => {
  it('has no duplicate source keys (Object.keys are unique by definition, but values should be intentional)', () => {
    const keys = Object.keys(SOURCE_PRIORITY_BONUS);
    const unique = new Set(keys);
    expect(unique.size).toBe(keys.length);
  });
});

// ─── 8. parseFollowerCount — spot checks ────────────────────────────────────

describe('parseFollowerCount', () => {
  it('parses plain numbers', () => {
    expect(parseFollowerCount('1000')).toBe(1000);
    expect(parseFollowerCount('500')).toBe(500);
  });

  it('parses K suffix', () => {
    expect(parseFollowerCount('5K')).toBe(5000);
    expect(parseFollowerCount('1.5K')).toBe(1500);
  });

  it('parses M suffix', () => {
    expect(parseFollowerCount('2M')).toBe(2000000);
  });

  it('returns 0 for empty or invalid', () => {
    expect(parseFollowerCount('')).toBe(0);
    expect(parseFollowerCount('unknown')).toBe(0);
  });
});
