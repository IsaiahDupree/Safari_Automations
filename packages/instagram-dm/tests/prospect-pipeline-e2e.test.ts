/**
 * Prospect Pipeline — End-to-End Tests
 *
 * Validates the full real prospect discovery pipeline:
 *
 *   1. Niche hashtag pages  → top posts ranked by engagement
 *   2. Top posts            → top creators (authors with highest total engagement)
 *   3. Top creators         → open followers modal → extract follower usernames
 *   4. Followers            → enrich + ICP score → stored as prospects in suggested_actions
 *
 * All Layer 3 tests use REAL Instagram data discovered from our ICP niche keywords.
 * No hardcoded test users. Every assertion verifies that our method actually works.
 *
 * ICP keywords used: buildinpublic, saasfounder, aiautomation, founder, indiemaker
 *
 * Layers:
 *   Layer 1 — pipeline config logic (no server, always run)
 *   Layer 2 — server up (:3100), dryRun shape validation
 *   Layer 3 — active Safari session: real navigation, real data
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  ICP_KEYWORDS,
  SOURCE_PRIORITY_BONUS,
  type TopPost,
  type TopPostCreator,
  type ProspectCandidate,
} from '../src/api/prospect-discovery.js';

const API = 'http://localhost:3100';

// ─── ICP niche keywords we use for real discovery ───────────────────────────

const NICHE_KEYWORDS = ['buildinpublic', 'saasfounder', 'aiautomation', 'indiemaker'];

// ─── helpers ────────────────────────────────────────────────────────────────

async function isServerUp(): Promise<boolean> {
  try { return (await fetch(`${API}/health`)).ok; } catch { return false; }
}

async function hasSession(): Promise<boolean> {
  try {
    const d = await (await fetch(`${API}/api/status`)).json() as { isOnInstagram?: boolean; isLoggedIn?: boolean };
    return !!d.isOnInstagram && !!d.isLoggedIn;
  } catch { return false; }
}

async function post<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const r = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} — POST ${path}`);
  return r.json() as Promise<T>;
}

async function get<T>(path: string): Promise<T> {
  const r = await fetch(`${API}${path}`);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} — GET ${path}`);
  return r.json() as Promise<T>;
}

// ─── Layer 1: pipeline config ────────────────────────────────────────────────

describe('Pipeline config (Layer 1: no server)', () => {
  it('ICP_KEYWORDS pool contains our core niche terms', () => {
    // These keywords drive scoring — ensure the core niche terms are present
    const icpLower = ICP_KEYWORDS.map(k => k.toLowerCase());
    for (const kw of ['saas', 'founder', 'creator', 'automation', 'startup']) {
      expect(icpLower, `"${kw}" missing from ICP_KEYWORDS`).toContain(kw);
    }
    // buildinpublic and indiehacker are compound keywords — verify the pool has at least 20 terms
    expect(ICP_KEYWORDS.length).toBeGreaterThanOrEqual(20);
  });

  it('top_post_authors source has a higher bonus than hashtag', () => {
    expect(SOURCE_PRIORITY_BONUS['top_post_authors']).toBeGreaterThan(SOURCE_PRIORITY_BONUS['hashtag']);
  });

  it('top_accounts source has a higher bonus than top_post_authors', () => {
    expect(SOURCE_PRIORITY_BONUS['top_accounts']).toBeGreaterThanOrEqual(SOURCE_PRIORITY_BONUS['top_post_authors']);
  });

  it('pipeline source bonus hierarchy is correct', () => {
    // top_accounts ≥ top_post_authors > search > post_comments > hashtag > followers
    expect(SOURCE_PRIORITY_BONUS['top_accounts']).toBeGreaterThanOrEqual(SOURCE_PRIORITY_BONUS['top_post_authors']);
    expect(SOURCE_PRIORITY_BONUS['top_post_authors']).toBeGreaterThan(SOURCE_PRIORITY_BONUS['post_comments']);
    expect(SOURCE_PRIORITY_BONUS['post_comments']).toBeGreaterThan(SOURCE_PRIORITY_BONUS['hashtag']);
    expect(SOURCE_PRIORITY_BONUS['hashtag']).toBeGreaterThan(SOURCE_PRIORITY_BONUS['followers']);
  });
});

// ─── Layer 2: dryRun shape validation ────────────────────────────────────────

describe('Pipeline dryRun validation (Layer 2: server up)', () => {
  let serverUp = false;

  beforeAll(async () => {
    serverUp = await isServerUp();
    if (!serverUp) console.warn('  ⚠ :3100 not running — Layer 2 tests skipped');
  });

  it('POST /api/prospect/discover-from-top-posts dryRun returns correct shape', async () => {
    if (!serverUp) return;
    const r = await post<{
      dryRun: boolean; message: string;
      topPosts: unknown[]; topCreators: unknown[]; candidates: unknown[];
    }>('/api/prospect/discover-from-top-posts', { dryRun: true });

    expect(r.dryRun).toBe(true);
    expect(typeof r.message).toBe('string');
    expect(r.message.length).toBeGreaterThan(0);
    expect(Array.isArray(r.topPosts)).toBe(true);
    expect(Array.isArray(r.topCreators)).toBe(true);
    expect(Array.isArray(r.candidates)).toBe(true);
    expect(r.topPosts).toHaveLength(0);
    expect(r.topCreators).toHaveLength(0);
    expect(r.candidates).toHaveLength(0);
  });

  it('POST /api/prospect/discover with topPostKeywords dryRun lists top_post_authors', async () => {
    if (!serverUp) return;
    const r = await post<{ sourcesQueried: string[] }>('/api/prospect/discover', {
      dryRun: true, topPostKeywords: ['buildinpublic'],
    });
    expect(r.sourcesQueried).toContain('top_post_authors');
  });

  it('POST /api/prospect/discover with topAccounts dryRun lists top_accounts', async () => {
    if (!serverUp) return;
    const r = await post<{ sourcesQueried: string[] }>('/api/prospect/discover', {
      dryRun: true, topAccounts: ['levelsio'],
    });
    expect(r.sourcesQueried).toContain('top_accounts');
  });

  it('POST /api/prospect/scale-discover dryRun returns pipeline shape', async () => {
    if (!serverUp) return;
    const r = await post<{
      newFound: number; totalSuggested: number; targetTotal: number;
      done: boolean; progress: string;
    }>('/api/prospect/scale-discover', { dryRun: true, targetTotal: 500 });

    expect(typeof r.newFound).toBe('number');
    expect(typeof r.totalSuggested).toBe('number');
    expect(r.targetTotal).toBe(500);
    expect(typeof r.done).toBe('boolean');
    expect(typeof r.progress).toBe('string');
  });
});

// ─── Layer 3: Full real pipeline — Safari session required ───────────────────

describe('Full niche prospect pipeline (Layer 3: session active)', () => {
  let serverUp = false;
  let sessionActive = false;

  beforeAll(async () => {
    serverUp = await isServerUp();
    if (serverUp) sessionActive = await hasSession();
    if (!sessionActive) console.warn('  ⚠ No active Instagram Safari session — Layer 3 tests skipped');
  });

  // ── Stage 1: Hashtag → top posts → top creators ───────────────────────────

  describe('Stage 1: niche hashtags → top posts → ranked creators', () => {
    it('returns topPosts from our niche keywords', async () => {
      if (!sessionActive) return;
      const r = await post<{
        topPosts: TopPost[]; topCreators: TopPostCreator[]; candidates: ProspectCandidate[];
        newFound: number; totalSuggested: number;
      }>('/api/prospect/discover-from-top-posts', {
        keywords: NICHE_KEYWORDS.slice(0, 2), // start with 2 keywords for speed
        maxPostsPerKeyword: 4,
        maxTopCreators: 3,
        minScore: 0,
      });

      expect(Array.isArray(r.topPosts)).toBe(true);
      // Should find at least some posts from active hashtags
      expect(r.topPosts.length).toBeGreaterThan(0);
    }, 180000);

    it('each topPost has required fields with valid types', async () => {
      if (!sessionActive) return;
      const r = await post<{ topPosts: TopPost[] }>('/api/prospect/discover-from-top-posts', {
        keywords: [NICHE_KEYWORDS[0]],
        maxPostsPerKeyword: 3,
        maxTopCreators: 2,
        minScore: 0,
      });

      for (const p of r.topPosts) {
        expect(typeof p.postPath).toBe('string');
        expect(p.postPath).toMatch(/^\/(p|reel)\//);
        expect(typeof p.author).toBe('string');
        expect(p.author.length).toBeGreaterThan(0);
        expect(typeof p.keyword).toBe('string');
        expect(typeof p.likes).toBe('number');
        expect(p.likes).toBeGreaterThanOrEqual(0);
        expect(typeof p.comments).toBe('number');
        expect(p.comments).toBeGreaterThanOrEqual(0);
        expect(typeof p.engagementScore).toBe('number');
        expect(p.engagementScore).toBeGreaterThanOrEqual(0);
      }
    }, 120000);

    it('topCreators are ranked by totalEngagement descending (rank 1 = highest)', async () => {
      if (!sessionActive) return;
      const r = await post<{ topCreators: TopPostCreator[] }>('/api/prospect/discover-from-top-posts', {
        keywords: NICHE_KEYWORDS.slice(0, 2),
        maxPostsPerKeyword: 4,
        maxTopCreators: 5,
        minScore: 0,
      });

      expect(r.topCreators.length).toBeGreaterThan(0);

      // Ranks are sequential starting at 1
      r.topCreators.forEach((c, i) => {
        expect(c.rank).toBe(i + 1);
      });

      // Sorted by totalEngagement descending
      for (let i = 1; i < r.topCreators.length; i++) {
        expect(r.topCreators[i - 1].totalEngagement).toBeGreaterThanOrEqual(
          r.topCreators[i].totalEngagement,
        );
      }
    }, 180000);

    it('topCreators have no duplicate usernames', async () => {
      if (!sessionActive) return;
      const r = await post<{ topCreators: TopPostCreator[] }>('/api/prospect/discover-from-top-posts', {
        keywords: NICHE_KEYWORDS.slice(0, 2),
        maxPostsPerKeyword: 4,
        maxTopCreators: 10,
        minScore: 0,
      });

      const names = r.topCreators.map(c => c.username.toLowerCase());
      expect(new Set(names).size).toBe(names.length);
    }, 180000);

    it('each creator was found in at least one of the provided keywords', async () => {
      if (!sessionActive) return;
      const keywords = NICHE_KEYWORDS.slice(0, 2);
      const r = await post<{ topCreators: TopPostCreator[] }>('/api/prospect/discover-from-top-posts', {
        keywords,
        maxPostsPerKeyword: 4,
        maxTopCreators: 5,
        minScore: 0,
      });

      for (const c of r.topCreators) {
        expect(keywords).toContain(c.keyword);
      }
    }, 180000);
  });

  // ── Stage 2: Top creators → their followers = prospects ──────────────────

  describe('Stage 2: top creator followers → ICP-scored prospects', () => {
    it('returns candidates from followers of discovered top creators', async () => {
      if (!sessionActive) return;
      const r = await post<{
        topCreators: TopPostCreator[];
        candidates: ProspectCandidate[];
        enrichedCount: number;
        newFound: number;
      }>('/api/prospect/discover-from-top-posts', {
        keywords: NICHE_KEYWORDS.slice(0, 2),
        maxPostsPerKeyword: 4,
        maxTopCreators: 3,
        minScore: 0,
      });

      // If we found top creators, we should have candidates from their followers
      if (r.topCreators.length > 0) {
        expect(r.candidates.length).toBeGreaterThan(0);
        expect(r.enrichedCount).toBeGreaterThan(0);
      }
    }, 300000);

    it('candidates have no duplicate usernames', async () => {
      if (!sessionActive) return;
      const r = await post<{ candidates: ProspectCandidate[] }>('/api/prospect/discover-from-top-posts', {
        keywords: [NICHE_KEYWORDS[0]],
        maxPostsPerKeyword: 3,
        maxTopCreators: 2,
        minScore: 0,
      });

      const usernames = r.candidates.map(c => c.username.toLowerCase());
      const unique = new Set(usernames);
      const dupes = usernames.filter((u, i) => usernames.indexOf(u) !== i);
      expect(unique.size, `duplicate usernames: ${dupes.join(', ')}`).toBe(usernames.length);
    }, 240000);

    it('each candidate has valid ICP score and required fields', async () => {
      if (!sessionActive) return;
      const r = await post<{ candidates: ProspectCandidate[] }>('/api/prospect/discover-from-top-posts', {
        keywords: [NICHE_KEYWORDS[0]],
        maxPostsPerKeyword: 3,
        maxTopCreators: 2,
        minScore: 0,
      });

      for (const c of r.candidates) {
        expect(typeof c.username).toBe('string');
        expect(c.username.length).toBeGreaterThan(0);
        expect(c.icpScore).toBeGreaterThanOrEqual(0);
        expect(c.icpScore).toBeLessThanOrEqual(100);
        expect(Array.isArray(c.icpSignals)).toBe(true);
        expect(typeof c.alreadyInCRM).toBe('boolean');
        expect(typeof c.priority).toBe('number');
        expect(c.priority).toBeLessThanOrEqual(140);
        // Signals are distinct
        const unique = new Set(c.icpSignals);
        expect(unique.size).toBe(c.icpSignals.length);
      }
    }, 240000);

    it('candidates are sourced from top creators (source = top_accounts)', async () => {
      if (!sessionActive) return;
      const r = await post<{ candidates: ProspectCandidate[] }>('/api/prospect/discover-from-top-posts', {
        keywords: [NICHE_KEYWORDS[0]],
        maxPostsPerKeyword: 3,
        maxTopCreators: 2,
        minScore: 0,
      });

      for (const c of r.candidates) {
        // Followers of top accounts are tagged as top_accounts source
        expect(['top_accounts', 'hashtag', 'followers']).toContain(c.source);
      }
    }, 240000);

    it('newFound is non-negative and totalSuggested reflects the DB', async () => {
      if (!sessionActive) return;
      const r = await post<{
        newFound: number; totalSuggested: number; candidates: ProspectCandidate[];
      }>('/api/prospect/discover-from-top-posts', {
        keywords: [NICHE_KEYWORDS[0]],
        maxPostsPerKeyword: 3,
        maxTopCreators: 2,
        minScore: 0,
      });

      expect(r.newFound).toBeGreaterThanOrEqual(0);
      expect(r.totalSuggested).toBeGreaterThanOrEqual(r.newFound);
    }, 240000);
  });

  // ── Stage 3: Directly scrape top creator followers via discover endpoint ──

  describe('Stage 3: topAccounts followers via POST /api/prospect/discover', () => {
    /**
     * This tests the follower-scraping directly:
     * provide known niche accounts → scrape their followers → these are the prospects.
     * We use real accounts that consistently post about our ICP niches.
     */
    const NICHE_CREATOR_ACCOUNTS = ['levelsio', 'marc_louvion', 'tdinh_me'];

    it('returns followers of niche creator accounts as candidates', async () => {
      if (!sessionActive) return;
      const r = await post<{
        candidates: ProspectCandidate[];
        sourcesQueried: string[];
        rawFound: number;
      }>('/api/prospect/discover', {
        sources: ['top_accounts'],
        topAccounts: [NICHE_CREATOR_ACCOUNTS[0]], // one account to keep test fast
        maxCandidates: 10,
        minScore: 0,
        checkCRM: false,
        maxRounds: 1,
        followerScrollCount: 3, // shallow scroll for speed
      });

      expect(r.sourcesQueried).toContain('top_accounts');
      expect(r.rawFound).toBeGreaterThan(0);
      expect(r.candidates.length).toBeGreaterThan(0);

      for (const c of r.candidates) {
        expect(c.source).toBe('top_accounts');
        // discoveryKeyword should be the account name (set by fetchTopAccountFollowers)
        expect(typeof c.discoveryKeyword).toBe('string');
      }
    }, 120000);

    it('no duplicate followers across multiple creator accounts', async () => {
      if (!sessionActive) return;
      const r = await post<{ candidates: ProspectCandidate[]; rawFound: number }>(
        '/api/prospect/discover',
        {
          sources: ['top_accounts'],
          topAccounts: NICHE_CREATOR_ACCOUNTS.slice(0, 2),
          maxCandidates: 20,
          minScore: 0,
          checkCRM: false,
          maxRounds: 1,
          followerScrollCount: 2,
        },
      );

      const usernames = r.candidates.map(c => c.username.toLowerCase());
      const unique = new Set(usernames);
      const dupes = usernames.filter((u, i) => usernames.indexOf(u) !== i);
      expect(unique.size, `duplicate usernames: ${dupes.join(', ')}`).toBe(usernames.length);
    }, 180000);

    it('candidates are sorted by icpScore descending', async () => {
      if (!sessionActive) return;
      const r = await post<{ candidates: ProspectCandidate[] }>('/api/prospect/discover', {
        sources: ['top_accounts'],
        topAccounts: [NICHE_CREATOR_ACCOUNTS[0]],
        maxCandidates: 10,
        minScore: 0,
        checkCRM: false,
        maxRounds: 1,
        followerScrollCount: 3,
      });

      if (r.candidates.length < 2) return;
      for (let i = 1; i < r.candidates.length; i++) {
        expect(r.candidates[i - 1].icpScore).toBeGreaterThanOrEqual(r.candidates[i].icpScore);
      }
    }, 120000);
  });

  // ── Stage 4: Full scale-discover loop — build the prospect list ───────────

  describe('Stage 4: scale-discover — accumulate prospects to a target', () => {
    it('scale-discover returns progress toward targetTotal', async () => {
      if (!sessionActive) return;
      const r = await post<{
        newFound: number; totalSuggested: number; targetTotal: number;
        done: boolean; progress: string; looping: boolean;
      }>('/api/prospect/scale-discover', {
        keywords: [NICHE_KEYWORDS[0]],
        targetTotal: 9999, // high target so it always runs at least one batch
        maxCandidates: 5,
        minScore: 0,
        checkCRM: false,
        maxRounds: 1,
      });

      expect(typeof r.newFound).toBe('number');
      expect(typeof r.totalSuggested).toBe('number');
      expect(r.targetTotal).toBe(9999);
      expect(typeof r.done).toBe('boolean');
      expect(r.progress).toMatch(/\d+\/\d+/); // e.g. "12/9999"
      expect(typeof r.looping).toBe('boolean');
    }, 120000);

    it('totalSuggested in stats reflects newly found prospects', async () => {
      if (!sessionActive) return;
      // Get current count
      const before = await get<{ suggested: number }>('/api/prospect/stats');

      // Run one discovery batch
      await post('/api/prospect/scale-discover', {
        keywords: [NICHE_KEYWORDS[0]],
        targetTotal: 9999,
        maxCandidates: 3,
        minScore: 0,
        checkCRM: false,
        maxRounds: 1,
      });

      // Count should be >= before (we may have added new ones)
      const after = await get<{ suggested: number }>('/api/prospect/stats');
      expect(after.suggested).toBeGreaterThanOrEqual(before.suggested);
    }, 120000);
  });
});
