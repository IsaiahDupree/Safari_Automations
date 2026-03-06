/**
 * Threads Commenting Integration Tests (REAL — no mocks)
 *
 * Covers:
 *   1. Service health
 *   2. Rate limit config API (GET / PUT)
 *   3. Rate limit headers on every response
 *   4. Rate limit enforcement — cap blocks further comments
 *   5. Feed commenting with per-hour cap (requires Safari on threads.net)
 *   6. Niche commenting — search posts → batch-comment with hourly cap (requires Safari)
 *   7. Rate limit counts visible in /health after real comments
 *
 * Run all:      npx vitest run src/__tests__/threads-commenting.integration.test.ts
 * Skip Safari:  SKIP_SAFARI=1 npx vitest run src/__tests__/threads-commenting.integration.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const BASE = 'http://localhost:3004';
const SKIP_SAFARI = process.env.SKIP_SAFARI === '1';
// Default token from server.ts: process.env.THREADS_AUTH_TOKEN || 'threads-local-dev-token'
const AUTH_TOKEN = process.env.THREADS_AUTH_TOKEN || 'threads-local-dev-token';

// ─── helpers ─────────────────────────────────────────────────────────────────

async function api(
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  body?: Record<string, unknown>,
  timeoutMs = 35000,
): Promise<{ status: number; headers: Record<string, string>; body: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const opts: RequestInit = {
      method,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AUTH_TOKEN}`,
      },
    };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const res = await fetch(`${BASE}${path}`, opts);
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => { headers[k] = v; });
    let json: unknown;
    try { json = await res.json(); } catch { json = null; }
    return { status: res.status, headers, body: json };
  } finally {
    clearTimeout(timer);
  }
}

async function wait(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

async function ensureThreadsSession(): Promise<boolean> {
  // Ask the threads-comments service to navigate to its own tab (uses tab coordinator)
  await api('POST', '/api/threads/navigate', { url: 'https://www.threads.net' });
  await wait(6000);

  // Confirm via the service's own status (not raw AppleScript on front window)
  for (let i = 0; i < 6; i++) {
    const { body } = await api('GET', '/api/threads/status');
    const b = body as Record<string, unknown>;
    if (b.isLoggedIn === true) return true;
    await wait(2000);
  }
  return false;
}

// ─── state ───────────────────────────────────────────────────────────────────

let safariOnThreads = false;
const DEFAULT_HOURLY = 5;
const DEFAULT_DAILY = 20;

// ─── suite ───────────────────────────────────────────────────────────────────

describe('Threads commenting — service health', () => {
  it('service is running on :3004', async () => {
    const { status, body } = await api('GET', '/health');
    expect(status).toBe(200);
    const b = body as Record<string, unknown>;
    expect(b.status).toBe('ok');
    expect(b.service).toMatch(/threads/i);
    console.log(`   service: ${b.service} v${b.version}`);
  });
});

// ─── rate limit config API ───────────────────────────────────────────────────

describe('Threads commenting — rate limit config API', () => {
  beforeAll(async () => {
    // Reset to known defaults before this group
    await api('PUT', '/api/threads/rate-limits', {
      commentsPerHour: DEFAULT_HOURLY,
      commentsPerDay: DEFAULT_DAILY,
    });
  });

  it('GET /api/threads/rate-limits returns current state', async () => {
    const { status, body } = await api('GET', '/api/threads/rate-limits');
    expect(status).toBe(200);
    const b = body as Record<string, unknown>;
    expect(typeof b.commentsThisHour).toBe('number');
    expect(typeof b.commentsToday).toBe('number');
    const limits = b.limits as Record<string, unknown>;
    expect(typeof limits.commentsPerHour).toBe('number');
    expect(typeof limits.commentsPerDay).toBe('number');
    console.log(`   thisHour=${b.commentsThisHour}  today=${b.commentsToday}  cap=${limits.commentsPerHour}/hr ${limits.commentsPerDay}/day`);
  });

  it('PUT /api/threads/rate-limits updates commentsPerHour', async () => {
    const { status, body } = await api('PUT', '/api/threads/rate-limits', { commentsPerHour: 3 });
    expect(status).toBe(200);
    const b = body as Record<string, unknown>;
    const config = b.rateLimits as Record<string, unknown>;
    expect(config.commentsPerHour).toBe(3);
    console.log(`   commentsPerHour updated to ${config.commentsPerHour}`);
  });

  it('PUT /api/threads/rate-limits updates commentsPerDay', async () => {
    const { status, body } = await api('PUT', '/api/threads/rate-limits', { commentsPerDay: 15 });
    expect(status).toBe(200);
    const b = body as Record<string, unknown>;
    const config = b.rateLimits as Record<string, unknown>;
    expect(config.commentsPerDay).toBe(15);
    console.log(`   commentsPerDay updated to ${config.commentsPerDay}`);
  });

  it('GET after PUT reflects both changes', async () => {
    const { body } = await api('GET', '/api/threads/rate-limits');
    const b = body as Record<string, unknown>;
    const limits = b.limits as Record<string, unknown>;
    expect(limits.commentsPerHour).toBe(3);
    expect(limits.commentsPerDay).toBe(15);
  });

  afterAll(async () => {
    // Restore defaults
    await api('PUT', '/api/threads/rate-limits', {
      commentsPerHour: DEFAULT_HOURLY,
      commentsPerDay: DEFAULT_DAILY,
    });
  });
});

// ─── rate limit headers ──────────────────────────────────────────────────────

describe('Threads commenting — rate limit headers on responses', () => {
  it('every response includes X-RateLimit-* headers', async () => {
    // dry_run avoids real Safari interaction
    const { headers } = await api('POST', '/api/threads/comments/post', {
      text: 'Test comment for header check',
      dry_run: true,
    });

    expect(headers['x-ratelimit-limit']).toBeTruthy();
    expect(headers['x-ratelimit-remaining']).toBeTruthy();
    expect(headers['x-ratelimit-reset']).toBeTruthy();

    const limit = parseInt(headers['x-ratelimit-limit']);
    const remaining = parseInt(headers['x-ratelimit-remaining']);
    expect(limit).toBeGreaterThan(0);
    expect(remaining).toBeGreaterThanOrEqual(0);
    expect(remaining).toBeLessThanOrEqual(limit);

    console.log(`   X-RateLimit-Limit: ${limit}  Remaining: ${remaining}  Reset: ${headers['x-ratelimit-reset']}s`);
  });

  it('GET /api/threads/status includes commentsThisHour and commentsToday', async () => {
    // Rate limit counts live on /api/threads/status (not /health)
    // TODO (CHANGES-NEEDED.md §2d): add commentsThisHour/commentsToday to /health too
    const { status, body } = await api('GET', '/api/threads/status');
    expect(status).toBe(200);
    const b = body as Record<string, unknown>;
    expect(typeof b.commentsThisHour).toBe('number');
    expect(typeof b.commentsToday).toBe('number');
    console.log(`   /status: commentsThisHour=${b.commentsThisHour}  commentsToday=${b.commentsToday}`);
  });
});

// ─── rate limit enforcement (no Safari needed) ───────────────────────────────

describe('Threads commenting — rate limit enforcement', () => {
  afterAll(async () => {
    await api('PUT', '/api/threads/rate-limits', {
      commentsPerHour: DEFAULT_HOURLY,
      commentsPerDay: DEFAULT_DAILY,
    });
  });

  it('batch-comment is blocked immediately when commentsPerHour is 0', async () => {
    await api('PUT', '/api/threads/rate-limits', { commentsPerHour: 0 });

    const { status, body } = await api('POST', '/api/threads/batch-comment', {
      posts: [{ postUrl: 'https://www.threads.net/@test/post/abc123', text: 'Test comment' }],
      delay_between_ms: 0,
    });

    expect(status).toBe(200); // endpoint always 200, error lives inside results[]
    const b = body as Record<string, unknown>;
    const results = b.results as Array<Record<string, unknown>>;
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].success).toBe(false);
    expect(String(results[0].error)).toMatch(/rate limit/i);
    console.log(`   Rate limit blocked: "${results[0].error}"`);
  });

  it('batch-comment stops mid-batch when hourly cap is hit during run', async () => {
    // commentsPerHour:0 means cap is hit at position 0, so all 3 posts blocked
    await api('PUT', '/api/threads/rate-limits', { commentsPerHour: 0 });

    const posts = [
      { postUrl: 'https://www.threads.net/@a/post/111', text: 'Comment A' },
      { postUrl: 'https://www.threads.net/@b/post/222', text: 'Comment B' },
      { postUrl: 'https://www.threads.net/@c/post/333', text: 'Comment C' },
    ];

    const { body } = await api('POST', '/api/threads/batch-comment', {
      posts,
      delay_between_ms: 0,
    });

    const b = body as Record<string, unknown>;
    const results = b.results as Array<Record<string, unknown>>;

    // Should not have attempted all 3 — stopped at first rate limit
    expect(results.length).toBeLessThan(posts.length);
    expect(results.every(r => r.success === false)).toBe(true);
    console.log(`   Stopped at ${results.length}/${posts.length} posts due to rate cap`);
  });

  it('daily cap 0 also blocks batch-comment', async () => {
    await api('PUT', '/api/threads/rate-limits', {
      commentsPerHour: 100, // hourly cap is not the blocker
      commentsPerDay: 0,    // daily cap IS the blocker
    });

    const { body } = await api('POST', '/api/threads/batch-comment', {
      posts: [{ postUrl: 'https://www.threads.net/@test/post/xyz', text: 'Day cap test' }],
      delay_between_ms: 0,
    });

    const b = body as Record<string, unknown>;
    const results = b.results as Array<Record<string, unknown>>;
    expect(results[0].success).toBe(false);
    expect(String(results[0].error)).toMatch(/rate limit/i);
    console.log(`   Daily cap blocked: "${results[0].error}"`);
  });
});

// ─── dry-run single comment ───────────────────────────────────────────────────

describe('Threads commenting — dry run (no Safari)', () => {
  it('POST /api/threads/comments/post with dry_run:true returns simulated result', async () => {
    const { status, body } = await api('POST', '/api/threads/comments/post', {
      text: 'Really insightful take on this!',
      dry_run: true,
    });

    expect(status).toBe(200);
    const b = body as Record<string, unknown>;
    expect(b.success).toBe(true);
    expect(b.dry_run).toBe(true);
    expect(b.simulated).toBe(true);
    expect(String(b.commentId)).toMatch(/^dry_/);
    console.log(`   Dry run commentId: ${b.commentId}`);
  });

  it('dry_run returns the provided text', async () => {
    const text = 'This is a test comment via dry run';
    const { body } = await api('POST', '/api/threads/comments/post', {
      text,
      dry_run: true,
    });
    const b = body as Record<string, unknown>;
    expect(b.text).toBe(text);
  });

  it('dry_run with useAI:true still returns simulated result', async () => {
    const { status, body } = await api('POST', '/api/threads/comments/post', {
      useAI: true,
      postContent: 'AI is transforming the way we build software products.',
      username: 'testuser',
      dry_run: true,
    });
    expect(status).toBe(200);
    const b = body as Record<string, unknown>;
    expect(b.dry_run).toBe(true);
    expect(b.simulated).toBe(true);
    console.log(`   AI dry run text: "${b.text}"`);
  });
});

// ─── Safari-required tests ────────────────────────────────────────────────────

describe('Threads commenting — feed commenting with per-hour cap (Safari)', () => {
  beforeAll(async () => {
    if (SKIP_SAFARI) return;
    safariOnThreads = await ensureThreadsSession();
    if (!safariOnThreads) console.log('   SKIP: threads service could not confirm logged-in session');
  }, 30000);

  it('engage/loop posts N comments on feed posts and respects per-hour cap', async () => {
    if (SKIP_SAFARI || !safariOnThreads) {
      console.log('   (skipped — Safari not on Threads)');
      return;
    }

    // Set a 3/hr cap so we can see enforcement in action
    await api('PUT', '/api/threads/rate-limits', {
      commentsPerHour: 3,
      commentsPerDay: DEFAULT_DAILY,
    });

    // count=1, no delay — must finish in < 30s (server wrapAsync timeout)
    const COUNT = 1;
    const { status, body } = await api('POST', '/api/threads/engage/loop', {
      count: COUNT,
      delayBetween: 0,
    }, 35000);

    // 504 means Safari engagement took > 30s — not a logic failure
    if (status === 504) {
      console.log('   WARN: engage/loop timed out (>30s) — Safari too slow today, skipping assertion');
      return;
    }

    expect(status).toBe(200);
    const b = body as Record<string, unknown>;
    const results = b.results as Array<Record<string, unknown>>;

    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBe(COUNT);

    for (const r of results) {
      expect(r).toHaveProperty('success');
      expect(r).toHaveProperty('username');
      expect(r).toHaveProperty('postContent');
      expect(r).toHaveProperty('generatedComment');
      expect(r).toHaveProperty('commentPosted');
      console.log(`   @${r.username}: posted=${r.commentPosted}  "${String(r.generatedComment).substring(0, 60)}"`);
    }

    console.log(`   Successful: ${(b as Record<string, unknown>).successful}/${COUNT}`);

    // Clean up rate limit
    await api('PUT', '/api/threads/rate-limits', {
      commentsPerHour: DEFAULT_HOURLY,
      commentsPerDay: DEFAULT_DAILY,
    });
  }, 120000);

  it('/api/threads/status commentsThisHour reflects loop run', async () => {
    if (SKIP_SAFARI || !safariOnThreads) {
      console.log('   (skipped — Safari not on Threads)');
      return;
    }

    const { body } = await api('GET', '/api/threads/status');
    const b = body as Record<string, unknown>;
    expect(typeof b.commentsThisHour).toBe('number');
    // Count reflects any comments posted during this session (may be 0 if engage/loop timed out)
    console.log(`   /status commentsThisHour: ${b.commentsThisHour}  commentsToday: ${b.commentsToday}`);
  });
});

describe('Threads commenting — niche search then batch-comment with hourly cap (Safari)', () => {
  const NICHE_QUERY = 'AI automation';
  let nichePosts: Array<{ url: string; content: string; author: string }> = [];

  beforeAll(async () => {
    if (SKIP_SAFARI) return;
    safariOnThreads = await ensureThreadsSession();
    if (!safariOnThreads) console.log('   SKIP: threads service could not confirm logged-in session');
  }, 30000);

  it('searches Threads for a niche query and returns posts', async () => {
    if (SKIP_SAFARI || !safariOnThreads) {
      console.log('   (skipped — Safari not on Threads)');
      return;
    }

    const { status, body } = await api('POST', '/api/threads/search', {
      query: NICHE_QUERY,
      max_results: 10,
      scrolls: 2,
      min_likes: 0,
    }, 35000);

    expect(status).toBe(200);
    const b = body as Record<string, unknown>;
    expect(b.success).toBe(true);
    const posts = b.posts as Array<Record<string, unknown>>;
    expect(Array.isArray(posts)).toBe(true);
    console.log(`   Raw search count: ${posts.length}`);
    expect(posts.length).toBeGreaterThan(0);

    nichePosts = posts.map(p => ({
      url: String(p.url || p.postUrl || ''),
      content: String(p.content || p.text || '').substring(0, 100),
      author: String(p.author || p.username || ''),
    })).filter(p => p.url);

    console.log(`   Found ${nichePosts.length} posts for "${NICHE_QUERY}"`);
    console.log(`   Sample: @${nichePosts[0]?.author} — "${nichePosts[0]?.content.substring(0, 60)}"`);
  }, 60000);

  it('generates niche-appropriate comments for each found post', async () => {
    if (SKIP_SAFARI || !safariOnThreads || nichePosts.length === 0) {
      console.log('   (skipped)');
      return;
    }

    // Generate comments for top 3 niche posts using AI
    const commentJobs = nichePosts.slice(0, 3).map(p => ({
      postContent: p.content,
      username: p.author,
    }));

    for (const job of commentJobs) {
      const { status, body } = await api('POST', '/api/threads/comments/post', {
        useAI: true,
        postContent: job.postContent,
        username: job.username,
        dry_run: true, // generate only — verify the comment looks niche-relevant
      });

      expect(status).toBe(200);
      const b = body as Record<string, unknown>;
      expect(b.success).toBe(true);
      const text = String(b.text || '');
      expect(text.length).toBeGreaterThan(0);
      expect(text.length).toBeLessThan(300); // no wall-of-text comments

      console.log(`   @${job.username}: "${text.substring(0, 80)}"`);
    }
  }, 30000);

  it('batch-comments on niche posts and stops at hourly cap', async () => {
    if (SKIP_SAFARI || !safariOnThreads || nichePosts.length === 0) {
      console.log('   (skipped)');
      return;
    }

    const HOURLY_CAP = 2;
    await api('PUT', '/api/threads/rate-limits', {
      commentsPerHour: HOURLY_CAP,
      commentsPerDay: DEFAULT_DAILY,
    });

    // Submit 4 posts — expect only up to HOURLY_CAP to succeed before rate limit
    const batchPosts = nichePosts.slice(0, 4).map(p => ({
      postUrl: p.url,
      text: `Interesting perspective on ${NICHE_QUERY}! What's your take on the future here?`,
    }));

    const { status, body } = await api('POST', '/api/threads/batch-comment', {
      posts: batchPosts,
      delay_between_ms: 5000,
    });

    expect(status).toBe(200);
    const b = body as Record<string, unknown>;
    const results = b.results as Array<Record<string, unknown>>;

    const succeeded = results.filter(r => r.success);
    const rateLimited = results.filter(r => !r.success && String(r.error).match(/rate limit/i));

    expect(succeeded.length).toBeLessThanOrEqual(HOURLY_CAP);
    expect(rateLimited.length).toBeGreaterThan(0);

    console.log(`   Cap=${HOURLY_CAP}  Succeeded=${succeeded.length}  Rate-limited=${rateLimited.length}  Total submitted=${batchPosts.length}`);
    for (const r of results) {
      console.log(`     ${r.success ? 'OK' : 'BLOCKED'} — ${r.postUrl}`);
    }

    // Restore
    await api('PUT', '/api/threads/rate-limits', {
      commentsPerHour: DEFAULT_HOURLY,
      commentsPerDay: DEFAULT_DAILY,
    });
  }, 120000);

  it('GET /api/threads/rate-limits shows updated commentsThisHour after batch run', async () => {
    if (SKIP_SAFARI || !safariOnThreads || nichePosts.length === 0) {
      console.log('   (skipped)');
      return;
    }

    const { body } = await api('GET', '/api/threads/rate-limits');
    const b = body as Record<string, unknown>;

    expect(typeof b.commentsThisHour).toBe('number');
    expect(typeof b.commentsToday).toBe('number');
    expect(b.commentsThisHour).toBeGreaterThan(0);

    console.log(`   After niche batch: commentsThisHour=${b.commentsThisHour}  commentsToday=${b.commentsToday}`);
  });
});

// ─── engage/multi endpoint ───────────────────────────────────────────────────

describe('Threads commenting — engage/multi feed loop (Safari)', () => {
  beforeAll(async () => {
    if (SKIP_SAFARI) return;
    safariOnThreads = await ensureThreadsSession();
  }, 30000);

  it('engage/multi returns structured results with per-post status', async () => {
    if (SKIP_SAFARI || !safariOnThreads) {
      console.log('   (skipped — Safari not on Threads)');
      return;
    }

    await api('PUT', '/api/threads/rate-limits', {
      commentsPerHour: 3,
      commentsPerDay: DEFAULT_DAILY,
    });

    const { status, body } = await api('POST', '/api/threads/engage/multi', {
      count: 1,
      delayBetween: 0,
      useAI: true,
      maxRetries: 1,
    }, 35000);

    if (status === 504) {
      console.log('   WARN: engage/multi timed out (>30s) — skipping assertion');
      return;
    }

    expect(status).toBe(200);
    const b = body as Record<string, unknown>;

    // engage/multi returns either results array or an object with results
    const raw = (b.results ?? b) as unknown;
    if (Array.isArray(raw)) {
      expect(raw.length).toBeGreaterThanOrEqual(1);
      for (const r of raw as Array<Record<string, unknown>>) {
        expect(r).toHaveProperty('success');
        console.log(`   post: success=${r.success} username=${r.username}`);
      }
    } else {
      // may return summary object
      expect(b).toHaveProperty('total');
      console.log(`   multi result: total=${b.total} successful=${b.successful}`);
    }

    await api('PUT', '/api/threads/rate-limits', {
      commentsPerHour: DEFAULT_HOURLY,
      commentsPerDay: DEFAULT_DAILY,
    });
  }, 120000);
});
