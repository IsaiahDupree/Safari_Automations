/**
 * New Prospect APIs — Tests
 *
 * Covers the 5 new APIs built to fill pipeline gaps:
 *
 *  API 1: GET  /api/prospect/list          — paginated browse of suggested_actions
 *  API 2: DELETE /api/prospect/:username   — soft-remove (mark 'skipped')
 *  API 3: POST /api/prospect/score-batch   — enrich + ICP-score N usernames (requires session)
 *  API 4: GET  /api/prospect/stats         — pipeline health stats
 *  API 5: sources: ['search']              — own post commenters via discoverProspects
 *
 * Layer 1 — pure logic (always run)
 * Layer 2 — server up (:3100), no session required (dryRun/read-only calls)
 * Layer 3 — active Safari session on instagram.com (real navigation)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { discoverProspects, SOURCE_PRIORITY_BONUS } from '../src/api/prospect-discovery.js';

const API = 'http://localhost:3100';

async function isServerUp(): Promise<boolean> {
  try { return (await fetch(`${API}/health`)).ok; } catch { return false; }
}

async function hasSession(): Promise<boolean> {
  try {
    const d = await (await fetch(`${API}/api/status`)).json() as { isOnInstagram?: boolean; isLoggedIn?: boolean };
    return !!d.isOnInstagram && !!d.isLoggedIn;
  } catch { return false; }
}

async function get<T>(path: string): Promise<{ ok: boolean; status: number; data: T }> {
  const r = await fetch(`${API}${path}`);
  const data = await r.json() as T;
  return { ok: r.ok, status: r.status, data };
}

async function post<T>(path: string, body: Record<string, unknown>): Promise<{ ok: boolean; status: number; data: T }> {
  const r = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await r.json() as T;
  return { ok: r.ok, status: r.status, data };
}

async function del<T>(path: string): Promise<{ ok: boolean; status: number; data: T }> {
  const r = await fetch(`${API}${path}`, { method: 'DELETE' });
  const data = await r.json() as T;
  return { ok: r.ok, status: r.status, data };
}

// ─── Layer 1: pure logic for 'search' source ────────────────────────────────

describe('[API 5] sources: ["search"] — pure logic', () => {
  it('search source has a defined priority bonus', () => {
    expect(SOURCE_PRIORITY_BONUS).toHaveProperty('search');
    expect(SOURCE_PRIORITY_BONUS['search']).toBeGreaterThan(0);
  });

  it('search bonus is higher than hashtag (commenters > random hashtag explorers)', () => {
    expect(SOURCE_PRIORITY_BONUS['search']).toBeGreaterThan(SOURCE_PRIORITY_BONUS['hashtag']);
  });

  it('discoverProspects dryRun with selfUsername adds search to sourcesQueried', async () => {
    const r = await discoverProspects({ dryRun: true, selfUsername: 'the_isaiah_dupree' });
    expect(r.sourcesQueried).toContain('search');
  });

  it('discoverProspects dryRun with sources=["search"] includes search', async () => {
    const r = await discoverProspects({ dryRun: true, sources: ['search'], selfUsername: 'the_isaiah_dupree' });
    expect(r.sourcesQueried).toContain('search');
    expect(r.candidates).toHaveLength(0); // dryRun
  });

  it('discoverProspects dryRun without selfUsername does NOT auto-add search', async () => {
    const r = await discoverProspects({ dryRun: true });
    expect(r.sourcesQueried).not.toContain('search');
  });
});

// ─── Layer 2: server up (no session) ────────────────────────────────────────

describe('New Prospect APIs (Layer 2: server up)', () => {
  let serverUp = false;

  beforeAll(async () => {
    serverUp = await isServerUp();
    if (!serverUp) console.warn('  ⚠ :3100 not running — Layer 2/3 tests skipped');
  });

  // ── API 1: GET /api/prospect/list ─────────────────────────────────────────

  describe('[API 1] GET /api/prospect/list — paginated prospect browse', () => {
    it('returns 200 with correct shape', async () => {
      if (!serverUp) return;
      const { ok, data } = await get<{
        prospects: unknown[]; total: number; limit: number; offset: number; page: number; pages: number;
      }>('/api/prospect/list');
      expect(ok).toBe(true);
      expect(Array.isArray(data.prospects)).toBe(true);
      expect(typeof data.total).toBe('number');
      expect(typeof data.limit).toBe('number');
      expect(typeof data.offset).toBe('number');
      expect(typeof data.page).toBe('number');
      expect(typeof data.pages).toBe('number');
    });

    it('total >= prospects.length', async () => {
      if (!serverUp) return;
      const { data } = await get<{ prospects: unknown[]; total: number }>('/api/prospect/list');
      expect(data.total).toBeGreaterThanOrEqual(data.prospects.length);
    });

    it('limit param is respected', async () => {
      if (!serverUp) return;
      const { data } = await get<{ prospects: unknown[]; limit: number }>('/api/prospect/list?limit=5');
      expect(data.limit).toBe(5);
      expect(data.prospects.length).toBeLessThanOrEqual(5);
    });

    it('offset param shifts the page', async () => {
      if (!serverUp) return;
      const page1 = await get<{ prospects: Array<{ username: string }> }>('/api/prospect/list?limit=5&offset=0');
      const page2 = await get<{ prospects: Array<{ username: string }> }>('/api/prospect/list?limit=5&offset=5');
      if (page1.data.prospects.length < 5 || page2.data.prospects.length === 0) return; // not enough data
      const p1Names = page1.data.prospects.map(p => p.username);
      const p2Names = page2.data.prospects.map(p => p.username);
      // Pages should not overlap
      const overlap = p1Names.filter(u => p2Names.includes(u));
      expect(overlap).toHaveLength(0);
    });

    it('each prospect has required fields', async () => {
      if (!serverUp) return;
      const { data } = await get<{ prospects: Array<{ id: string; username: string; priority: number; bio: string; status: string; created_at: string }> }>(
        '/api/prospect/list?limit=10',
      );
      for (const p of data.prospects) {
        expect(typeof p.id).toBe('string');
        expect(typeof p.username).toBe('string');
        expect(p.username.length).toBeGreaterThan(0);
        expect(typeof p.priority).toBe('number');
        expect(p.priority).toBeGreaterThanOrEqual(0);
        expect(p.priority).toBeLessThanOrEqual(140);
        expect(typeof p.bio).toBe('string');
        expect(p.status).toBe('suggested');
        expect(typeof p.created_at).toBe('string');
      }
    });

    it('prospects list has no duplicate usernames', async () => {
      if (!serverUp) return;
      const { data } = await get<{ prospects: Array<{ username: string }> }>('/api/prospect/list?limit=100');
      const usernames = data.prospects.map(p => p.username.toLowerCase());
      const unique = new Set(usernames);
      expect(unique.size).toBe(usernames.length);
    });

    it('minScore filter only returns prospects at or above threshold', async () => {
      if (!serverUp) return;
      const { data } = await get<{ prospects: Array<{ priority: number }> }>('/api/prospect/list?minScore=50');
      for (const p of data.prospects) {
        expect(p.priority).toBeGreaterThanOrEqual(50);
      }
    });

    it('maxScore filter only returns prospects at or below threshold', async () => {
      if (!serverUp) return;
      const { data } = await get<{ prospects: Array<{ priority: number }> }>('/api/prospect/list?maxScore=49');
      for (const p of data.prospects) {
        expect(p.priority).toBeLessThanOrEqual(49);
      }
    });

    it('page number is 1-based', async () => {
      if (!serverUp) return;
      const { data } = await get<{ page: number; offset: number }>('/api/prospect/list?limit=10&offset=0');
      expect(data.page).toBe(1);
    });

    it('limit is capped at 200', async () => {
      if (!serverUp) return;
      const { data } = await get<{ limit: number; prospects: unknown[] }>('/api/prospect/list?limit=9999');
      expect(data.limit).toBeLessThanOrEqual(200);
    });
  });

  // ── API 2: DELETE /api/prospect/:username ─────────────────────────────────

  describe('[API 2] DELETE /api/prospect/:username — soft-remove prospect', () => {
    it('returns 404 for a username that is not in suggested_actions', async () => {
      if (!serverUp) return;
      const { ok, status } = await del('/api/prospect/__nonexistent_test_user_xyz__');
      // Either 404 (not found) or success=false
      expect(ok === false || status === 404).toBe(true);
    });

    it('returns JSON with success field', async () => {
      if (!serverUp) return;
      const { data } = await del<{ success: boolean; username?: string; error?: string }>(
        '/api/prospect/__nonexistent_test_user_xyz__',
      );
      expect(typeof data.success).toBe('boolean');
    });
  });

  // ── API 3: POST /api/prospect/score-batch — requires session, skipped here ─

  describe('[API 3] POST /api/prospect/score-batch — validation (no session)', () => {
    it('returns 400 when usernames is missing', async () => {
      if (!serverUp) return;
      const { status } = await post('/api/prospect/score-batch', {});
      // Either 400 (validation) or 503 (no session) — both are correct rejections
      expect([400, 503]).toContain(status);
    });

    it('returns 400 when usernames is empty array', async () => {
      if (!serverUp) return;
      const { status } = await post('/api/prospect/score-batch', { usernames: [] });
      expect([400, 503]).toContain(status);
    });
  });

  // ── API 4: GET /api/prospect/stats ───────────────────────────────────────

  describe('[API 4] GET /api/prospect/stats — pipeline health', () => {
    it('returns 200 with correct shape', async () => {
      if (!serverUp) return;
      const { ok, data } = await get<{
        suggested: number; pending: number; sent: number; failed: number; skipped: number;
        total: number; scoreDistribution: Record<string, number>; platform: string;
      }>('/api/prospect/stats');
      expect(ok).toBe(true);
      expect(typeof data.suggested).toBe('number');
      expect(typeof data.pending).toBe('number');
      expect(typeof data.sent).toBe('number');
      expect(typeof data.failed).toBe('number');
      expect(typeof data.skipped).toBe('number');
      expect(typeof data.total).toBe('number');
      expect(typeof data.scoreDistribution).toBe('object');
      expect(data.platform).toBe('instagram');
    });

    it('total equals sum of all status counts', async () => {
      if (!serverUp) return;
      const { data } = await get<{
        suggested: number; pending: number; sent: number; failed: number; skipped: number; total: number;
      }>('/api/prospect/stats');
      const sum = data.suggested + data.pending + data.sent + data.failed + data.skipped;
      expect(data.total).toBe(sum);
    });

    it('scoreDistribution has all 4 buckets', async () => {
      if (!serverUp) return;
      const { data } = await get<{ scoreDistribution: Record<string, number> }>('/api/prospect/stats');
      expect(data.scoreDistribution).toHaveProperty('0-29');
      expect(data.scoreDistribution).toHaveProperty('30-49');
      expect(data.scoreDistribution).toHaveProperty('50-69');
      expect(data.scoreDistribution).toHaveProperty('70-100');
    });

    it('scoreDistribution bucket values are non-negative', async () => {
      if (!serverUp) return;
      const { data } = await get<{ scoreDistribution: Record<string, number> }>('/api/prospect/stats');
      for (const [bucket, count] of Object.entries(data.scoreDistribution)) {
        expect(count, `bucket ${bucket}`).toBeGreaterThanOrEqual(0);
      }
    });

    it('suggested count matches scoreDistribution sum (both from suggested status)', async () => {
      if (!serverUp) return;
      const { data } = await get<{
        suggested: number;
        scoreDistribution: Record<string, number>;
      }>('/api/prospect/stats');
      const distSum = Object.values(data.scoreDistribution).reduce((a, b) => a + b, 0);
      // distSum should equal suggested count (distribution is from suggested rows only)
      expect(distSum).toBe(data.suggested);
    });

    it('all counts are non-negative integers', async () => {
      if (!serverUp) return;
      const { data } = await get<{
        suggested: number; pending: number; sent: number; failed: number; skipped: number; total: number;
      }>('/api/prospect/stats');
      for (const key of ['suggested', 'pending', 'sent', 'failed', 'skipped', 'total'] as const) {
        expect(Number.isInteger(data[key]), `${key} is integer`).toBe(true);
        expect(data[key], `${key} >= 0`).toBeGreaterThanOrEqual(0);
      }
    });
  });
});

// ─── Layer 3: score-batch + search source (active session) ──────────────────

describe('New Prospect APIs (Layer 3: session active)', () => {
  let serverUp = false;
  let sessionActive = false;
  /** Two real ICP prospects discovered from niche hashtags — used instead of hardcoded test users. */
  let discoveredUsernames: string[] = [];

  beforeAll(async () => {
    serverUp = await isServerUp();
    if (serverUp) sessionActive = await hasSession();
    if (!sessionActive) { console.warn('  ⚠ No active Instagram Safari session — Layer 3 tests skipped'); return; }

    // Discover real prospects from our niche keywords so score-batch tests use real data
    try {
      const r = await post<{ candidates: Array<{ username: string }> }>('/api/prospect/discover', {
        sources: ['hashtag'],
        keywords: ['buildinpublic', 'saasfounder', 'aiautomation'],
        maxCandidates: 3,
        minScore: 0,
        checkCRM: false,
        maxRounds: 1,
      });
      discoveredUsernames = (r.data.candidates ?? []).map(c => c.username).slice(0, 2);
      if (discoveredUsernames.length > 0) {
        console.log(`  ✔ discovered ${discoveredUsernames.length} real prospects for score-batch: ${discoveredUsernames.map(u => '@' + u).join(', ')}`);
      } else {
        console.warn('  ⚠ No prospects discovered in beforeAll — score-batch tests will be skipped');
      }
    } catch (e) {
      console.warn(`  ⚠ beforeAll discovery failed: ${e} — score-batch tests will be skipped`);
    }
  }, 120000);

  // ── API 3: POST /api/prospect/score-batch ────────────────────────────────

  describe('[API 3] POST /api/prospect/score-batch — real enrichment', () => {
    it('returns results array with correct shape', async () => {
      if (!sessionActive || discoveredUsernames.length === 0) return;
      const { ok, data } = await post<{
        results: Array<{
          username: string;
          icpScore: number;
          icpSignals: string[];
          priority: number;
          alreadyInCRM: boolean;
          profile: unknown | null;
          error?: string;
        }>;
        scored: number;
        total: number;
        truncated: boolean;
      }>('/api/prospect/score-batch', { usernames: [discoveredUsernames[0]], checkCRM: false });

      expect(ok).toBe(true);
      expect(Array.isArray(data.results)).toBe(true);
      expect(data.results).toHaveLength(1);
      expect(data.scored).toBe(1);
      expect(data.total).toBe(1);
      expect(data.truncated).toBe(false);
    }, 30000);

    it('each result has valid icpScore in [0,100]', async () => {
      if (!sessionActive || discoveredUsernames.length === 0) return;
      const { data } = await post<{ results: Array<{ icpScore: number }> }>(
        '/api/prospect/score-batch',
        { usernames: [discoveredUsernames[0]] },
      );
      for (const r of data.results) {
        expect(r.icpScore).toBeGreaterThanOrEqual(0);
        expect(r.icpScore).toBeLessThanOrEqual(100);
      }
    }, 30000);

    it('priority = icpScore + source bonus, capped at 140', async () => {
      if (!sessionActive || discoveredUsernames.length === 0) return;
      const { data } = await post<{
        results: Array<{ icpScore: number; priority: number }>;
      }>('/api/prospect/score-batch', { usernames: [discoveredUsernames[0]] });
      for (const r of data.results) {
        const expectedBonus = SOURCE_PRIORITY_BONUS['search'] ?? 10;
        const expected = Math.min(r.icpScore + expectedBonus, 140);
        expect(r.priority).toBe(expected);
      }
    }, 30000);

    it('icpSignals are distinct per result', async () => {
      if (!sessionActive || discoveredUsernames.length === 0) return;
      const { data } = await post<{ results: Array<{ icpSignals: string[] }> }>(
        '/api/prospect/score-batch',
        { usernames: [discoveredUsernames[0]] },
      );
      for (const r of data.results) {
        const unique = new Set(r.icpSignals);
        expect(unique.size).toBe(r.icpSignals.length);
      }
    }, 30000);

    it('batch of 2 discovered prospects returns correct count', async () => {
      if (!sessionActive || discoveredUsernames.length < 2) return;
      const { data } = await post<{ results: Array<{ username: string }>; total: number }>(
        '/api/prospect/score-batch',
        { usernames: discoveredUsernames },
      );
      expect(data.total).toBe(discoveredUsernames.length);
    }, 60000);

    it('truncates at 20 usernames max', async () => {
      if (!sessionActive) return;
      const many = Array.from({ length: 25 }, (_, i) => `test_user_${i}`);
      const { data } = await post<{ total: number; truncated: boolean }>(
        '/api/prospect/score-batch',
        { usernames: many },
      );
      expect(data.total).toBeLessThanOrEqual(20);
      expect(data.truncated).toBe(true);
    }, 120000);
  });

  // ── API 5: sources: ['search'] — own post commenters ─────────────────────

  describe('[API 5] sources: ["search"] via POST /api/prospect/discover', () => {
    it('returns candidates with source = "search"', async () => {
      if (!sessionActive) return;
      const { ok, data } = await post<{
        candidates: Array<{ username: string; source: string; icpScore: number; icpSignals: string[] }>;
        sourcesQueried: string[];
        rawFound: number;
      }>('/api/prospect/discover', {
        sources: ['search'],
        selfUsername: 'the_isaiah_dupree',
        maxPostsToSearch: 2,
        maxCommentsPerPost: 20,
        maxCandidates: 5,
        minScore: 0,
        checkCRM: false,
        maxRounds: 1,
      });

      expect(ok).toBe(true);
      expect(data.sourcesQueried).toContain('search');
      for (const c of data.candidates) {
        expect(c.source).toBe('search');
        expect(c.icpScore).toBeGreaterThanOrEqual(0);
        expect(c.icpScore).toBeLessThanOrEqual(100);
        // No duplicate signals per candidate
        const unique = new Set(c.icpSignals);
        expect(unique.size).toBe(c.icpSignals.length);
      }

      // No duplicate usernames
      const usernames = data.candidates.map(c => c.username.toLowerCase());
      expect(new Set(usernames).size).toBe(usernames.length);
    }, 120000);

    it('selfUsername is not included in its own commenter list', async () => {
      if (!sessionActive) return;
      const selfUsername = 'the_isaiah_dupree';
      const { data } = await post<{ candidates: Array<{ username: string }> }>(
        '/api/prospect/discover',
        {
          sources: ['search'],
          selfUsername,
          maxPostsToSearch: 2,
          maxCommentsPerPost: 20,
          maxCandidates: 10,
          minScore: 0,
          checkCRM: false,
          maxRounds: 1,
        },
      );
      const usernames = data.candidates.map(c => c.username.toLowerCase());
      expect(usernames).not.toContain(selfUsername.toLowerCase());
    }, 120000);
  });
});
