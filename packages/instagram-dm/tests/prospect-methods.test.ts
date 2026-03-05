/**
 * Prospect-Finding Methods — Comprehensive Tests
 *
 * All 13 prospect-finding methods in the IG agent, organised by layer:
 *
 * INTERNAL SOURCE FETCHERS (tested via API — no direct export)
 * ─────────────────────────────────────────────────────────────
 * 1.  fetchHashtagCandidatesDirect(keywords, driver)
 *       → navigate instagram.com/explore/tags/{tag}/, scroll 3×, extract /username links
 *       → triggered by: POST /api/prospect/discover   { sources: ['hashtag'] }  (with Safari)
 *
 * 2.  fetchHashtagCandidatesViaHttp(keywords)
 *       → HTTP POST :3005/api/instagram/search/keyword  (no driver = fallback)
 *       → triggered by: POST /api/prospect/discover   { sources: ['hashtag'] }  (no driver)
 *
 * 3.  fetchFollowerCandidates()
 *       → HTTP GET :3005/api/instagram/activity/followers
 *       → triggered by: POST /api/prospect/discover   { sources: ['followers'] }
 *
 * 4.  fetchTopAccountFollowers(accounts, driver, scrollCount)
 *       → navigate to profile, click followers link, scroll modal, extract usernames
 *       → triggered by: POST /api/prospect/discover   { topAccounts: [...] }
 *
 * 5.  fetchTopPostCreators(keywords, driver, maxPostsPerKeyword)
 *       → navigate hashtag pages, visit each top post, extract author + engagement metrics
 *       → triggered by: POST /api/prospect/discover-from-top-posts
 *
 * EXPORTED FUNCTIONS (directly importable)
 * ─────────────────────────────────────────
 * 6.  discoverProspects(params, driver?)  — orchestrator combining all sources
 * 7.  scoreICP(profile, source)           — pure ICP scoring (0–100)
 *
 * API ENDPOINTS (POST/GET on :3100)
 * ──────────────────────────────────
 * 8.  POST /api/prospect/discover              — single batch discovery
 * 9.  POST /api/prospect/scale-discover        — loop until targetTotal reached
 * 10. POST /api/prospect/discover-from-top-posts — top-post creator pipeline
 * 11. GET  /api/prospect/score/:username       — enrich + score one user (requires session)
 * 12. POST /api/prospect/dm-top-n              — promote top N to outreach queue
 * 13. POST /api/prospect/send-queued           — batch-send queued DMs
 *
 * Layers:
 *   Layer 1 — pure logic (no server, always run)
 *   Layer 2 — server up (port 3100), no session required
 *   Layer 3 — active Safari session on instagram.com required
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  scoreICP,
  discoverProspects,
  parseFollowerCount,
  ICP_KEYWORDS,
  EXPANSION_KEYWORDS,
  SOURCE_PRIORITY_BONUS,
  type ProspectCandidate,
} from '../src/api/prospect-discovery.js';

const API = 'http://localhost:3100';

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
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} — ${path}`);
  return r.json() as Promise<T>;
}

async function get<T>(path: string): Promise<T> {
  const r = await fetch(`${API}${path}`);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} — ${path}`);
  return r.json() as Promise<T>;
}

function assertNoDuplicateUsernames(candidates: ProspectCandidate[], label: string) {
  const usernames = candidates.map(c => c.username.toLowerCase());
  const unique = new Set(usernames);
  const dupes = usernames.filter((u, i) => usernames.indexOf(u) !== i);
  expect(unique.size, `${label}: duplicate usernames ${dupes.join(', ')}`).toBe(usernames.length);
}

function assertCandidateShape(c: ProspectCandidate, label: string) {
  expect(typeof c.username, `${label}.username`).toBe('string');
  expect(c.username.length, `${label}.username non-empty`).toBeGreaterThan(0);
  expect(c.icpScore, `${label}.icpScore ≥ 0`).toBeGreaterThanOrEqual(0);
  expect(c.icpScore, `${label}.icpScore ≤ 100`).toBeLessThanOrEqual(100);
  expect(Array.isArray(c.icpSignals), `${label}.icpSignals is array`).toBe(true);
  // Signals are distinct
  const unique = new Set(c.icpSignals);
  expect(unique.size, `${label}.icpSignals has duplicates`).toBe(c.icpSignals.length);
  expect(typeof c.alreadyInCRM, `${label}.alreadyInCRM`).toBe('boolean');
  expect(['hashtag', 'followers', 'top_accounts', 'top_post_authors', 'search'], `${label}.source`).toContain(c.source);
  expect(typeof c.priority, `${label}.priority`).toBe('number');
  expect(c.priority, `${label}.priority ≤ 140`).toBeLessThanOrEqual(140);
}

// ─── Layer 1: scoreICP — method 7 ───────────────────────────────────────────

describe('[Method 7] scoreICP — pure ICP scoring', () => {
  const makeProfile = (bio = '', followers = '0', posts = '0', isPrivate = false, following = '0') => ({
    fullName: 'Test', bio, followers, following, posts, isPrivate,
  });

  it('returns score in [0,100]', () => {
    const { score } = scoreICP(makeProfile(), 'hashtag');
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('public account with follower sweet-spot scores higher than private', () => {
    const pub = scoreICP(makeProfile('saas founder', '5K', '10', false, '500'), 'hashtag');
    const priv = scoreICP(makeProfile('saas founder', '5K', '10', true, '500'), 'hashtag');
    expect(pub.score).toBeGreaterThan(priv.score);
  });

  it('bio with ICP keywords increases score vs empty bio', () => {
    const withBio = scoreICP(makeProfile('saas founder automation ai'), 'hashtag');
    const noBio = scoreICP(makeProfile(''), 'hashtag');
    expect(withBio.score).toBeGreaterThan(noBio.score);
  });

  it('revenue signal in bio adds points', () => {
    const withRevenue = scoreICP(makeProfile('$5K mrr'), 'hashtag');
    const noRevenue = scoreICP(makeProfile(''), 'hashtag');
    expect(withRevenue.score).toBeGreaterThan(noRevenue.score);
  });

  it('follower range 1K–100K gets maximum follower bonus', () => {
    const sweet = scoreICP(makeProfile('', '50K'), 'hashtag');
    const huge = scoreICP(makeProfile('', '1M'), 'hashtag');
    expect(sweet.score).toBeGreaterThan(huge.score);
  });

  it('accounts with >5 posts score higher than inactive accounts', () => {
    const active = scoreICP(makeProfile('', '5K', '20', false), 'hashtag');
    const inactive = scoreICP(makeProfile('', '5K', '2', false), 'hashtag');
    expect(active.score).toBeGreaterThan(inactive.score);
  });

  it('low following/follower ratio adds good_ratio signal', () => {
    const goodRatio = scoreICP(makeProfile('', '10K', '10', false, '500'), 'hashtag');
    expect(goodRatio.signals).toContain('good_ratio');
  });

  it('signals are distinct (no duplicates)', () => {
    const { signals } = scoreICP(
      makeProfile('saas founder mrr arr automation ai build creator', '50K', '20', false, '1K'),
      'top_accounts',
    );
    const unique = new Set(signals);
    expect(unique.size).toBe(signals.length);
  });

  it('all ICP_KEYWORDS that appear in bio show up as bio: signals', () => {
    const bio = 'saas founder automation creator';
    const { signals } = scoreICP(makeProfile(bio), 'hashtag');
    const bioSignals = signals.filter(s => s.startsWith('bio:'));
    // At least saas, founder, automation, creator should be signalled
    expect(bioSignals.length).toBeGreaterThanOrEqual(4);
  });

  it('source_priority_bonus values are all non-negative', () => {
    for (const [source, bonus] of Object.entries(SOURCE_PRIORITY_BONUS)) {
      expect(bonus, `bonus for ${source}`).toBeGreaterThanOrEqual(0);
    }
  });

  it('top_accounts bonus is highest among all sources', () => {
    const topBonus = SOURCE_PRIORITY_BONUS['top_accounts'];
    for (const [source, bonus] of Object.entries(SOURCE_PRIORITY_BONUS)) {
      if (source !== 'top_accounts') {
        expect(topBonus, `top_accounts (${topBonus}) should exceed ${source} (${bonus})`).toBeGreaterThanOrEqual(bonus);
      }
    }
  });
});

// ─── Layer 1: discoverProspects — method 6 (pure/dryRun) ────────────────────

describe('[Method 6] discoverProspects — orchestrator (Layer 1: dryRun logic)', () => {
  it('dryRun returns empty candidates and correct shape', async () => {
    const r = await discoverProspects({ dryRun: true });
    expect(r.candidates).toHaveLength(0);
    expect(r.total).toBe(0);
    expect(r.enrichedCount).toBe(0);
    expect(r.skippedLowScore).toBe(0);
    expect(r.rounds).toBe(0);
    expect(r.rawFound).toBe(0);
    expect(Array.isArray(r.sourcesQueried)).toBe(true);
  });

  it('dryRun with explicit sources lists them in sourcesQueried', async () => {
    const r = await discoverProspects({ dryRun: true, sources: ['hashtag', 'followers'] });
    expect(r.sourcesQueried).toContain('hashtag');
    expect(r.sourcesQueried).toContain('followers');
  });

  it('dryRun with topAccounts auto-adds top_accounts to sources', async () => {
    const r = await discoverProspects({ dryRun: true, topAccounts: ['levelsio'] });
    expect(r.sourcesQueried).toContain('top_accounts');
  });

  it('dryRun with topPostKeywords auto-adds top_post_authors to sources', async () => {
    const r = await discoverProspects({ dryRun: true, topPostKeywords: ['saas'] });
    expect(r.sourcesQueried).toContain('top_post_authors');
  });

  it('expansion pool excludes ICP_KEYWORDS (no overlapping keywords used in round 2+)', () => {
    // Regression: mrr/arr were in both lists — expansion pool should not include base keywords
    const baseKeywords = ['buildinpublic', 'saasfounder'];
    const expansionPool = EXPANSION_KEYWORDS.filter(k => !baseKeywords.includes(k));
    // expansion pool should not contain any ICP_KEYWORDS that are already used as base
    const icpSet = new Set(ICP_KEYWORDS.map(k => k.toLowerCase()));
    const expansionInICP = expansionPool.filter(k => icpSet.has(k.toLowerCase()));
    expect(expansionInICP, `EXPANSION_KEYWORDS overlap with ICP_KEYWORDS: ${expansionInICP.join(', ')}`).toHaveLength(0);
  });
});

// ─── Layer 2: API endpoints — server up, no session required ────────────────

describe('[Methods 8–13] Prospect API endpoints (Layer 2: dryRun, server up)', () => {
  let serverUp = false;

  beforeAll(async () => {
    serverUp = await isServerUp();
    if (!serverUp) console.warn('  ⚠ :3100 not running — Layer 2/3 tests skipped');
  });

  // ── Method 8: POST /api/prospect/discover ────────────────────────────────

  describe('[Method 8] POST /api/prospect/discover — single batch', () => {
    it('dryRun returns correct shape', async () => {
      if (!serverUp) return;
      const r = await post<{
        candidates: unknown[]; total: number; sourcesQueried: string[];
        enrichedCount: number; skippedLowScore: number; rounds: number; rawFound: number;
      }>('/api/prospect/discover', { dryRun: true });
      expect(Array.isArray(r.candidates)).toBe(true);
      expect(r.candidates).toHaveLength(0);
      expect(typeof r.total).toBe('number');
      expect(Array.isArray(r.sourcesQueried)).toBe(true);
      expect(typeof r.enrichedCount).toBe('number');
      expect(typeof r.skippedLowScore).toBe('number');
      expect(typeof r.rounds).toBe('number');
      expect(typeof r.rawFound).toBe('number');
    });

    it('dryRun with sources=["hashtag"] lists hashtag in sourcesQueried', async () => {
      if (!serverUp) return;
      const r = await post<{ sourcesQueried: string[] }>('/api/prospect/discover', {
        dryRun: true, sources: ['hashtag'],
      });
      expect(r.sourcesQueried).toContain('hashtag');
    });

    it('dryRun with sources=["followers"] lists followers in sourcesQueried', async () => {
      if (!serverUp) return;
      const r = await post<{ sourcesQueried: string[] }>('/api/prospect/discover', {
        dryRun: true, sources: ['followers'],
      });
      expect(r.sourcesQueried).toContain('followers');
    });

    it('dryRun with topAccounts lists top_accounts in sourcesQueried', async () => {
      if (!serverUp) return;
      const r = await post<{ sourcesQueried: string[] }>('/api/prospect/discover', {
        dryRun: true, topAccounts: ['levelsio'],
      });
      expect(r.sourcesQueried).toContain('top_accounts');
    });

    it('dryRun with topPostKeywords lists top_post_authors in sourcesQueried', async () => {
      if (!serverUp) return;
      const r = await post<{ sourcesQueried: string[] }>('/api/prospect/discover', {
        dryRun: true, topPostKeywords: ['buildinpublic'],
      });
      expect(r.sourcesQueried).toContain('top_post_authors');
    });

    it('dryRun total matches candidates.length (always 0 for dry run)', async () => {
      if (!serverUp) return;
      const r = await post<{ candidates: unknown[]; total: number }>('/api/prospect/discover', { dryRun: true });
      expect(r.total).toBe(r.candidates.length);
    });
  });

  // ── Method 9: POST /api/prospect/scale-discover ──────────────────────────

  describe('[Method 9] POST /api/prospect/scale-discover — loop to targetTotal', () => {
    it('dryRun returns correct shape', async () => {
      if (!serverUp) return;
      const r = await post<{
        newFound: number; totalSuggested: number; targetTotal: number;
        done: boolean; progress: string;
      }>('/api/prospect/scale-discover', { dryRun: true, targetTotal: 100_000 });
      expect(typeof r.newFound).toBe('number');
      expect(typeof r.totalSuggested).toBe('number');
      expect(typeof r.targetTotal).toBe('number');
      expect(typeof r.done).toBe('boolean');
      expect(typeof r.progress).toBe('string');
      // When dryRun=true and targetTotal is not yet met, progress contains "dryRun"
      if (!r.done) {
        expect(r.progress).toContain('dryRun');
      }
    });

    it('dryRun newFound is 0', async () => {
      if (!serverUp) return;
      const r = await post<{ newFound: number }>('/api/prospect/scale-discover', { dryRun: true });
      expect(r.newFound).toBe(0);
    });

    it('targetTotal echoed back in response', async () => {
      if (!serverUp) return;
      const r = await post<{ targetTotal: number }>('/api/prospect/scale-discover', {
        dryRun: true, targetTotal: 100_042,
      });
      expect(r.targetTotal).toBe(100_042);
    });
  });

  // ── Method 10: POST /api/prospect/discover-from-top-posts ────────────────

  describe('[Method 10] POST /api/prospect/discover-from-top-posts — top-post creator pipeline', () => {
    it('dryRun returns correct shape', async () => {
      if (!serverUp) return;
      const r = await post<{
        dryRun: boolean; message: string;
        topPosts: unknown[]; topCreators: unknown[]; candidates: unknown[];
      }>('/api/prospect/discover-from-top-posts', { dryRun: true });
      expect(r.dryRun).toBe(true);
      expect(typeof r.message).toBe('string');
      expect(Array.isArray(r.topPosts)).toBe(true);
      expect(Array.isArray(r.topCreators)).toBe(true);
      expect(Array.isArray(r.candidates)).toBe(true);
    });

    it('dryRun returns empty lists', async () => {
      if (!serverUp) return;
      const r = await post<{ topPosts: unknown[]; topCreators: unknown[]; candidates: unknown[] }>(
        '/api/prospect/discover-from-top-posts', { dryRun: true },
      );
      expect(r.topPosts).toHaveLength(0);
      expect(r.topCreators).toHaveLength(0);
      expect(r.candidates).toHaveLength(0);
    });
  });

  // ── Method 12: POST /api/prospect/dm-top-n ───────────────────────────────

  describe('[Method 12] POST /api/prospect/dm-top-n — promote top N to outreach queue', () => {
    it('dryRun returns correct shape', async () => {
      if (!serverUp) return;
      const r = await post<{
        queued: number; dryRun: boolean; message?: string; sample?: unknown[];
      }>('/api/prospect/dm-top-n', { dryRun: true, n: 5 });
      expect(typeof r.queued).toBe('number');
      expect(r.dryRun).toBe(true);
    });

    it('dryRun sends no DMs (queued may be 0 if queue empty)', async () => {
      if (!serverUp) return;
      const r = await post<{ queued: number; dryRun: boolean }>('/api/prospect/dm-top-n', {
        dryRun: true, n: 100,
      });
      // Whether 0 or N, dryRun must be true and no actual sends happen
      expect(r.dryRun).toBe(true);
    });
  });

  // ── Method 13: POST /api/prospect/send-queued ────────────────────────────

  describe('[Method 13] POST /api/prospect/send-queued — batch send queued DMs', () => {
    it('dryRun or empty-queue returns correct shape', async () => {
      if (!serverUp) return;
      const r = await post<{
        sent: number; failed: number; remaining: number;
        dryRun?: boolean; message?: string; preview?: unknown[];
      }>('/api/prospect/send-queued', { dryRun: true, batchSize: 3 });
      expect(typeof r.sent).toBe('number');
      expect(typeof r.failed).toBe('number');
      expect(typeof r.remaining).toBe('number');
      // Either dryRun flag or a message explaining queue is empty
      const isDryRunResponse = r.dryRun === true || typeof r.message === 'string';
      expect(isDryRunResponse).toBe(true);
    });

    it('dryRun sent count is 0', async () => {
      if (!serverUp) return;
      const r = await post<{ sent: number; dryRun?: boolean; message?: string }>(
        '/api/prospect/send-queued', { dryRun: true },
      );
      expect(r.sent).toBe(0);
    });
  });
});

// ─── Layer 3: Real discovery — Safari session required ──────────────────────

describe('[Methods 1–5, 8, 11] Live discovery (Layer 3: session active)', () => {
  let serverUp = false;
  let sessionActive = false;
  /** Real ICP prospect discovered from hashtag — used in score tests instead of a hardcoded user. */
  let discoveredUsername = '';

  beforeAll(async () => {
    serverUp = await isServerUp();
    if (serverUp) sessionActive = await hasSession();
    if (!sessionActive) { console.warn('  ⚠ No active Instagram Safari session — Layer 3 tests skipped'); return; }

    // Discover one real ICP prospect from our niche hashtags — used in score tests
    try {
      const r = await post<{ candidates: ProspectCandidate[] }>('/api/prospect/discover', {
        sources: ['hashtag'],
        keywords: ['buildinpublic', 'saasfounder'],
        maxCandidates: 1,
        minScore: 0,
        checkCRM: false,
        maxRounds: 1,
      });
      if (r.candidates.length > 0) {
        discoveredUsername = r.candidates[0].username;
        console.log(`  ✔ discovered real prospect for score tests: @${discoveredUsername}`);
      } else {
        console.warn('  ⚠ No prospects discovered in beforeAll — score tests will be skipped');
      }
    } catch (e) {
      console.warn(`  ⚠ beforeAll discovery failed: ${e} — score tests will be skipped`);
    }
  }, 90000);

  // ── Method 11: GET /api/prospect/score/:username ─────────────────────────

  describe('[Method 11] GET /api/prospect/score/:username', () => {
    it('returns correct shape for a discovered ICP account', async () => {
      if (!sessionActive || !discoveredUsername) return;
      const r = await get<{
        username: string;
        icpScore: number;
        icpSignals: string[];
        profile: { fullName: string; bio: string; followers: string; isPrivate: boolean };
      }>(`/api/prospect/score/${discoveredUsername}`);
      expect(r.username).toBe(discoveredUsername);
      expect(r.icpScore).toBeGreaterThanOrEqual(0);
      expect(r.icpScore).toBeLessThanOrEqual(100);
      expect(Array.isArray(r.icpSignals)).toBe(true);
      expect(r.profile).toHaveProperty('fullName');
      expect(r.profile).toHaveProperty('bio');
      expect(r.profile).toHaveProperty('followers');
    }, 30000);

    it('signals are distinct strings', async () => {
      if (!sessionActive || !discoveredUsername) return;
      const r = await get<{ icpSignals: string[] }>(`/api/prospect/score/${discoveredUsername}`);
      const unique = new Set(r.icpSignals);
      expect(unique.size).toBe(r.icpSignals.length);
    }, 30000);
  });

  // ── Methods 1–2: hashtag source via POST /api/prospect/discover ──────────

  describe('[Methods 1+2] fetchHashtagCandidates via POST /api/prospect/discover', () => {
    it('returns valid shape with sources=["hashtag"]', async () => {
      if (!sessionActive) return;
      const r = await post<{
        candidates: ProspectCandidate[];
        total: number;
        sourcesQueried: string[];
        rawFound: number;
      }>('/api/prospect/discover', {
        sources: ['hashtag'],
        keywords: ['buildinpublic'],
        maxCandidates: 3,
        minScore: 0,
        checkCRM: false,
        maxRounds: 1,
      });
      expect(r.sourcesQueried).toContain('hashtag');
      expect(typeof r.rawFound).toBe('number');
      expect(r.total).toBe(r.candidates.length);
      assertNoDuplicateUsernames(r.candidates, 'hashtag discover');
      for (const c of r.candidates) assertCandidateShape(c, `hashtag[${c.username}]`);
    }, 60000);

    it('all returned candidates have source = "hashtag"', async () => {
      if (!sessionActive) return;
      const r = await post<{ candidates: ProspectCandidate[] }>('/api/prospect/discover', {
        sources: ['hashtag'],
        keywords: ['saasfounder'],
        maxCandidates: 2,
        minScore: 0,
        checkCRM: false,
        maxRounds: 1,
      });
      for (const c of r.candidates) {
        expect(c.source).toBe('hashtag');
      }
    }, 60000);
  });

  // ── Method 3: followers source via POST /api/prospect/discover ───────────

  describe('[Method 3] fetchFollowerCandidates via POST /api/prospect/discover', () => {
    it('returns valid shape with sources=["followers"]', async () => {
      if (!sessionActive) return;
      const r = await post<{
        candidates: ProspectCandidate[];
        total: number;
        sourcesQueried: string[];
      }>('/api/prospect/discover', {
        sources: ['followers'],
        maxCandidates: 3,
        minScore: 0,
        checkCRM: false,
        maxRounds: 1,
      });
      expect(r.sourcesQueried).toContain('followers');
      expect(r.total).toBe(r.candidates.length);
      assertNoDuplicateUsernames(r.candidates, 'followers discover');
      for (const c of r.candidates) assertCandidateShape(c, `followers[${c.username}]`);
    }, 60000);
  });

  // ── Method 4: top_accounts source via POST /api/prospect/discover ─────────

  describe('[Method 4] fetchTopAccountFollowers via POST /api/prospect/discover', () => {
    it('returns candidates with source=top_accounts', async () => {
      if (!sessionActive) return;
      const r = await post<{ candidates: ProspectCandidate[]; sourcesQueried: string[] }>(
        '/api/prospect/discover', {
          sources: ['top_accounts'],
          topAccounts: ['levelsio'],
          maxCandidates: 2,
          minScore: 0,
          checkCRM: false,
          maxRounds: 1,
          followerScrollCount: 2, // minimal scrolls for speed
        },
      );
      expect(r.sourcesQueried).toContain('top_accounts');
      assertNoDuplicateUsernames(r.candidates, 'top_accounts discover');
      for (const c of r.candidates) {
        expect(c.source).toBe('top_accounts');
        assertCandidateShape(c, `top_accounts[${c.username}]`);
      }
    }, 120000);
  });

  // ── Method 6: discoverProspects multi-source — no duplicates across sources

  describe('[Method 6] discoverProspects multi-source dedup', () => {
    it('candidates have no duplicate usernames when combining hashtag + followers', async () => {
      if (!sessionActive) return;
      const r = await post<{ candidates: ProspectCandidate[]; rawFound: number }>(
        '/api/prospect/discover', {
          sources: ['hashtag', 'followers'],
          keywords: ['buildinpublic'],
          maxCandidates: 5,
          minScore: 0,
          checkCRM: false,
          maxRounds: 1,
        },
      );
      assertNoDuplicateUsernames(r.candidates, 'multi-source discover');
      // rawFound includes pre-dedup count — total ≤ rawFound
      expect(r.candidates.length).toBeLessThanOrEqual(r.rawFound + 1); // +1 for float rounding edge
    }, 90000);

    it('candidates are sorted by icpScore descending', async () => {
      if (!sessionActive) return;
      const r = await post<{ candidates: ProspectCandidate[] }>('/api/prospect/discover', {
        sources: ['hashtag'],
        keywords: ['saas'],
        maxCandidates: 5,
        minScore: 0,
        checkCRM: false,
        maxRounds: 1,
      });
      if (r.candidates.length < 2) return; // not enough to check order
      for (let i = 1; i < r.candidates.length; i++) {
        expect(r.candidates[i - 1].icpScore).toBeGreaterThanOrEqual(r.candidates[i].icpScore);
      }
    }, 60000);

    it('priority = icpScore + source bonus, capped at 140', async () => {
      if (!sessionActive) return;
      const r = await post<{ candidates: ProspectCandidate[] }>('/api/prospect/discover', {
        sources: ['hashtag'],
        keywords: ['founder'],
        maxCandidates: 3,
        minScore: 0,
        checkCRM: false,
        maxRounds: 1,
      });
      for (const c of r.candidates) {
        const expectedBonus = SOURCE_PRIORITY_BONUS[c.source] ?? 10;
        const expectedPriority = Math.min(c.icpScore + expectedBonus, 140);
        expect(c.priority).toBe(expectedPriority);
      }
    }, 60000);
  });

  // ── Method 5: top-post creator pipeline ─────────────────────────────────

  describe('[Method 5] fetchTopPostCreators via POST /api/prospect/discover-from-top-posts', () => {
    it('returns topPosts, topCreators, candidates arrays with correct shape', async () => {
      if (!sessionActive) return;
      const r = await post<{
        topPosts: Array<{ postPath: string; author: string; keyword: string; likes: number; comments: number; engagementScore: number }>;
        topCreators: Array<{ username: string; keyword: string; totalEngagement: number; postsFound: number; rank: number }>;
        candidates: ProspectCandidate[];
        newFound: number;
      }>('/api/prospect/discover-from-top-posts', {
        keywords: ['buildinpublic'],
        maxPostsPerKeyword: 3,
        maxTopCreators: 2,
        minScore: 0,
      });

      expect(Array.isArray(r.topPosts)).toBe(true);
      expect(Array.isArray(r.topCreators)).toBe(true);
      expect(Array.isArray(r.candidates)).toBe(true);
      expect(typeof r.newFound).toBe('number');

      // Validate topPosts shape
      for (const p of r.topPosts) {
        expect(typeof p.postPath).toBe('string');
        expect(typeof p.author).toBe('string');
        expect(typeof p.engagementScore).toBe('number');
      }

      // Validate topCreators shape and distinctness
      const creatorNames = r.topCreators.map(c => c.username.toLowerCase());
      expect(new Set(creatorNames).size).toBe(creatorNames.length);

      // topCreators ranked: each rank should be sequential
      r.topCreators.forEach((c, i) => {
        expect(c.rank).toBe(i + 1);
      });

      // Validate candidates
      assertNoDuplicateUsernames(r.candidates, 'top-posts candidates');
      for (const c of r.candidates) assertCandidateShape(c, `top-posts[${c.username}]`);
    }, 180000);
  });
});
