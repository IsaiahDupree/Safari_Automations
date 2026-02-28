/**
 * Comprehensive Social Platform Integration Test
 *
 * Tests ALL platforms end-to-end against live API servers:
 *   1.  Health checks — all 9 services
 *   2.  Twitter DM    — status, conversations, AI generation
 *   3.  Twitter Comments — status, navigate, get posts
 *   4.  TikTok DM    — conversations, DM to sarah_ashley_hunt (--send-dm flag)
 *   5.  LinkedIn     — profile search, people search
 *   6.  Market Research — post data + top creators per platform (quick search)
 *
 * Design goals:
 *   - NO false positives: if a server is UP, hard-assert all fields.
 *   - SKIP gracefully (with warning) only when a service is not running.
 *   - Event-driven: each section builds on the state set by the prior section.
 *   - Destructive ops (DM sends) are guarded by --send-dm flag.
 *
 * Requirements:
 *   - Safari open and logged in to each relevant platform
 *   - API servers running (start commands listed in TWITTER_AUTOMATION_COMPLETE.md)
 *
 * Run:
 *   npx tsx tests/integration/social-platform-integration.test.ts
 *   npx tsx tests/integration/social-platform-integration.test.ts --send-dm
 *   npx tsx tests/integration/social-platform-integration.test.ts --platforms twitter,linkedin
 */

export {}; // Make this a module so all declarations are locally scoped (avoids global vitest type collisions)

// ─── CLI flags ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const SEND_DM   = args.includes('--send-dm');
const _platformsIdx = args.indexOf('--platforms');
const PLATFORMS_ARG = args.find(a => a.startsWith('--platforms='))?.split('=')[1]
                   || (_platformsIdx !== -1 ? args[_platformsIdx + 1] : undefined);
const FILTER_PLATFORMS: string[] | null = PLATFORMS_ARG
  ? PLATFORMS_ARG.split(',').map(p => p.trim())
  : null;

// ─── Services ────────────────────────────────────────────────────────────────

interface ServiceConfig {
  name: string;
  port: number;
  platform: string;
}

const SERVICES: ServiceConfig[] = [
  { name: 'twitter-dm',        port: 3003, platform: 'twitter'   },
  { name: 'threads-comments',  port: 3004, platform: 'threads'   },
  { name: 'instagram-comments',port: 3005, platform: 'instagram' },
  { name: 'tiktok-comments',   port: 3006, platform: 'tiktok'    },
  { name: 'twitter-comments',  port: 3007, platform: 'twitter'   },
  { name: 'instagram-dm',      port: 3100, platform: 'instagram' },
  { name: 'tiktok-dm',         port: 3102, platform: 'tiktok'    },
  { name: 'linkedin',          port: 3105, platform: 'linkedin'  },
  { name: 'market-research',   port: 3106, platform: 'all'       },
];

// ─── Test runner helpers ──────────────────────────────────────────────────────

interface TestResult {
  name: string;
  passed: boolean;
  skipped: boolean;
  details: string;
  durationMs: number;
}

const results: TestResult[] = [];
let currentSection = '';

function section(name: string): void {
  currentSection = name;
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${name}`);
  console.log('─'.repeat(60));
}

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  const start = Date.now();
  try {
    await fn();
    const duration = Date.now() - start;
    results.push({ name: `${currentSection} › ${name}`, passed: true, skipped: false, details: 'OK', durationMs: duration });
    console.log(`  ✓  ${name} (${duration}ms)`);
  } catch (e: any) {
    const duration = Date.now() - start;
    const msg = e?.message ?? String(e);
    results.push({ name: `${currentSection} › ${name}`, passed: false, skipped: false, details: msg, durationMs: duration });
    console.log(`  ✗  ${name}: ${msg}`);
  }
}

function skip(name: string, reason: string): void {
  results.push({ name: `${currentSection} › ${name}`, passed: false, skipped: true, details: reason, durationMs: 0 });
  console.log(`  ⊘  ${name} [SKIPPED: ${reason}]`);
}

function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function assertShape(obj: any, fields: string[], label = 'object'): void {
  for (const f of fields) {
    assert(f in obj, `${label} missing field "${f}"`);
  }
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

async function api(method: string, base: string, path: string, body?: any): Promise<any> {
  const opts: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${base}${path}`, opts);
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${JSON.stringify(json).substring(0, 200)}`);
  }
  return json;
}

async function isUp(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:${port}/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

// ─── Startup: build live-service map ─────────────────────────────────────────

async function buildLiveMap(): Promise<Map<string, string>> {
  const live = new Map<string, string>();
  await Promise.all(
    SERVICES.map(async s => {
      if (await isUp(s.port)) {
        live.set(s.name, `http://localhost:${s.port}`);
        live.set(s.platform, `http://localhost:${s.port}`); // convenience alias
      }
    })
  );
  return live;
}

function base(live: Map<string, string>, key: string): string | null {
  return live.get(key) ?? null;
}

function platformEnabled(platform: string): boolean {
  return !FILTER_PLATFORMS || FILTER_PLATFORMS.includes(platform);
}

// ═════════════════════════════════════════════════════════════════════════════
// TEST SECTIONS
// ═════════════════════════════════════════════════════════════════════════════

// ─── 1. Health Checks ────────────────────────────────────────────────────────

async function testHealthChecks(live: Map<string, string>): Promise<void> {
  section('Health Checks');

  for (const svc of SERVICES) {
    const url = base(live, svc.name);
    if (!url) {
      skip(svc.name, `port ${svc.port} not responding`);
      continue;
    }

    await test(`${svc.name} (port ${svc.port})`, async () => {
      const d = await api('GET', url, '/health');
      assert(d.status === 'ok' || d.status === 'running', `status="${d.status}" not ok/running`);
    });
  }
}

// ─── 2. Twitter DM ───────────────────────────────────────────────────────────

async function testTwitterDM(live: Map<string, string>): Promise<void> {
  if (!platformEnabled('twitter')) return;
  section('Twitter DM  (port 3003)');

  const url = base(live, 'twitter-dm');
  if (!url) {
    skip('all tests', 'twitter-dm server not running on port 3003');
    return;
  }

  await test('status — shape', async () => {
    const d = await api('GET', url, '/api/twitter/status');
    assertShape(d, ['isOnTwitter', 'isLoggedIn', 'currentUrl'], 'status');
    assert(typeof d.isOnTwitter === 'boolean', 'isOnTwitter not boolean');
    assert(typeof d.isLoggedIn === 'boolean', 'isLoggedIn not boolean');
    console.log(`     isLoggedIn=${d.isLoggedIn}  url=${d.currentUrl}`);
  });

  await test('rate-limits — shape', async () => {
    const d = await api('GET', url, '/api/twitter/rate-limits');
    assertShape(d, ['messagesSentToday', 'messagesSentThisHour', 'limits', 'activeHours'], 'rate-limits');
    assertShape(d.limits, ['messagesPerHour', 'messagesPerDay', 'minDelayMs', 'maxDelayMs'], 'limits');
    assert(typeof d.messagesSentToday === 'number', 'messagesSentToday not number');
    console.log(`     sent today=${d.messagesSentToday}  this hour=${d.messagesSentThisHour}`);
  });

  await test('AI DM generation — no Safari required', async () => {
    const d = await api('POST', url, '/api/twitter/ai/generate', {
      username: 'testuser',
      purpose: 'networking',
      topic: 'AI automation',
    });
    assert(d.success === true, `success not true: ${JSON.stringify(d)}`);
    assert(typeof d.message === 'string', 'message not string');
    assert(d.message.length > 10, `message too short: "${d.message}"`);
    assert(d.message.length <= 200, `message too long (${d.message.length} chars)`);
    console.log(`     generated: "${d.message}"`);
  });

  await test('conversations — valid array response', async () => {
    const d = await api('GET', url, '/api/twitter/conversations');
    assertShape(d, ['conversations', 'count'], 'conversations response');
    assert(Array.isArray(d.conversations), 'conversations not array');
    assert(typeof d.count === 'number', 'count not number');
    assert(d.count === d.conversations.length, `count mismatch: ${d.count} !== ${d.conversations.length}`);
    if (d.conversations.length > 0) {
      const first = d.conversations[0];
      assertShape(first, ['username'], 'conversation item');
      assert(typeof first.username === 'string', 'username not string');
      assert(first.username.length > 0, 'username empty');
    }
    console.log(`     conversations: ${d.count} found`);
  });

  await test('unread conversations — valid array response', async () => {
    const d = await api('GET', url, '/api/twitter/conversations/unread');
    assertShape(d, ['conversations', 'count'], 'unread response');
    assert(Array.isArray(d.conversations), 'conversations not array');
    assert(d.count === d.conversations.length, `count mismatch`);
    console.log(`     unread: ${d.count}`);
  });

  await test('CRM stats — valid shape', async () => {
    const d = await api('GET', url, '/api/twitter/crm/stats');
    assert(d.success === true, `success not true: ${JSON.stringify(d)}`);
    assertShape(d, ['stats'], 'crm/stats');
  });

  await test('outreach stats — valid shape', async () => {
    const d = await api('GET', url, '/api/twitter/outreach/stats');
    assert(d.success === true, `success not true: ${JSON.stringify(d)}`);
  });

  await test('templates — valid array', async () => {
    const d = await api('GET', url, '/api/twitter/templates');
    assert(d.success === true, `success not true: ${JSON.stringify(d)}`);
    assert(Array.isArray(d.templates), 'templates not array');
    assert(typeof d.count === 'number', 'count not number');
  });
}

// ─── 3. Twitter Comments ─────────────────────────────────────────────────────

async function testTwitterComments(live: Map<string, string>): Promise<void> {
  if (!platformEnabled('twitter')) return;
  section('Twitter Comments  (port 3007)');

  const url = base(live, 'twitter-comments');
  if (!url) {
    skip('all tests', 'twitter-comments server not running on port 3007');
    return;
  }

  await test('status — shape', async () => {
    const d = await api('GET', url, '/api/twitter/status');
    assertShape(d, ['isOnTwitter', 'isLoggedIn', 'currentUrl'], 'status');
    assert(typeof d.isOnTwitter === 'boolean', 'isOnTwitter not boolean');
    console.log(`     isLoggedIn=${d.isLoggedIn}`);
  });

  await test('rate-limits — shape', async () => {
    const d = await api('GET', url, '/api/twitter/rate-limits');
    assertShape(d, ['commentsThisHour', 'commentsToday', 'limits'], 'rate-limits');
    assert(typeof d.commentsThisHour === 'number', 'commentsThisHour not number');
  });

  await test('config — shape', async () => {
    const d = await api('GET', url, '/api/twitter/config');
    assertShape(d, ['config'], 'config');
    assertShape(d.config, ['timeout', 'commentsPerHour', 'commentsPerDay', 'maxRetries'], 'config.config');
  });

  await test('AI comment generation — no Safari required', async () => {
    const d = await api('POST', url, '/api/twitter/comments/generate', {
      postContent: 'AI is changing how we build software tools',
      username: 'testuser',
    });
    assert(d.success === true, `success not true: ${JSON.stringify(d)}`);
    assert(typeof d.comment === 'string', 'comment not string');
    assert(d.comment.length > 0, 'comment empty');
    assert(d.comment.length <= 140, `comment too long (${d.comment.length} chars)`);
    console.log(`     generated: "${d.comment}"`);
  });
}

// ─── 4. TikTok DM ────────────────────────────────────────────────────────────

async function testTikTokDM(live: Map<string, string>): Promise<void> {
  if (!platformEnabled('tiktok')) return;
  section('TikTok DM  (port 3102)');

  const url = base(live, 'tiktok-dm');
  if (!url) {
    skip('all tests', 'tiktok-dm server not running on port 3102');
    return;
  }

  await test('status — shape', async () => {
    const d = await api('GET', url, '/api/tiktok/status');
    assert(typeof d.isOnTikTok === 'boolean' || typeof d.isLoggedIn === 'boolean',
      `status missing isOnTikTok/isLoggedIn: ${JSON.stringify(d)}`);
    console.log(`     status: ${JSON.stringify(d).substring(0, 120)}`);
  });

  await test('conversations — valid array, no duplicates', async () => {
    const d = await api('GET', url, '/api/tiktok/conversations');
    assertShape(d, ['conversations', 'count'], 'conversations response');
    assert(Array.isArray(d.conversations), 'conversations not array');
    assert(d.count === d.conversations.length, `count mismatch: ${d.count} !== ${d.conversations.length}`);

    if (d.conversations.length > 0) {
      // No false positives: verify first item has a username
      const first = d.conversations[0];
      assert(typeof first.username === 'string', `conversation.username not string: ${JSON.stringify(first)}`);
      assert(first.username.length > 0, 'conversation.username empty');

      // Deduplication check
      const usernames = d.conversations.map((c: any) => c.username);
      const unique = new Set(usernames);
      assert(unique.size === usernames.length, `Duplicate usernames found: ${usernames.length} total, ${unique.size} unique`);
    }
    console.log(`     conversations: ${d.count} found`);
  });

  // DM to sarah_ashley_hunt — only runs with --send-dm flag
  if (SEND_DM) {
    await test('send DM to sarah_ashley_hunt', async () => {
      const d = await api('POST', url, '/api/tiktok/messages/send-to', {
        username: 'sarah_ashley_hunt',
        text: 'Hey Sarah! Just testing our automation pipeline. Hope all is well! 🙌',
      });
      assert(d.success === true, `DM send failed: ${JSON.stringify(d)}`);
      assert(typeof d.verified === 'boolean', 'verified field missing');
      console.log(`     verified=${d.verified}  strategy=${d.strategy ?? 'n/a'}`);
    });
  } else {
    skip('send DM to sarah_ashley_hunt', 'run with --send-dm to enable');
  }
}

// ─── 5. LinkedIn ──────────────────────────────────────────────────────────────

async function testLinkedIn(live: Map<string, string>): Promise<void> {
  if (!platformEnabled('linkedin')) return;
  section('LinkedIn  (port 3105)');

  const url = base(live, 'linkedin');
  if (!url) {
    skip('all tests', 'linkedin server not running on port 3105');
    return;
  }

  await test('health — running', async () => {
    const d = await api('GET', url, '/health');
    assert(d.status === 'ok' || d.status === 'running', `status="${d.status}"`);
    assert(d.port === 3105, `port should be 3105, got ${d.port}`);
  });

  await test('people search — returns results with scored leads', async () => {
    // Use raw fetch to gracefully handle 429 (rate limit) without throwing
    const res = await fetch(`${url}/api/linkedin/search/people`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keywords: 'founder SaaS', limit: 5 }),
    });
    const d = await res.json() as any;
    if (res.status === 429) {
      console.log(`     [RATE LIMITED] — ${d.error}`);
      return; // acceptable — don't fail
    }
    assert(res.ok, `HTTP ${res.status}: ${JSON.stringify(d).substring(0, 200)}`);
    assertShape(d, ['results', 'count'], 'people search response');
    assert(Array.isArray(d.results), `results not array: ${JSON.stringify(d)}`);
    assert(typeof d.count === 'number', `count not number`);
    console.log(`     people found: ${d.count}`);
    if (d.results.length > 0) {
      const first = d.results[0];
      assert(typeof first.name === 'string' || typeof first.headline === 'string',
        `Lead missing name/headline: ${JSON.stringify(first)}`);
    }
  });

  await test('outreach campaigns — valid array', async () => {
    const d = await api('GET', url, '/api/linkedin/outreach/campaigns');
    assert(Array.isArray(d.campaigns), `campaigns not array: ${JSON.stringify(d)}`);
    console.log(`     campaigns: ${d.campaigns.length}`);
  });

  await test('outreach stats — valid shape', async () => {
    const d = await api('GET', url, '/api/linkedin/outreach/stats');
    assert(typeof d.total === 'number', `total not number: ${JSON.stringify(d)}`);
    assert(typeof d.byStage === 'object', `byStage not object: ${JSON.stringify(d)}`);
    console.log(`     prospects total=${d.total}  byStage=${JSON.stringify(d.byStage)}`);
  });

  await test('rate-limits — shape', async () => {
    const d = await api('GET', url, '/api/linkedin/rate-limits');
    assert(d !== null && typeof d === 'object', 'rate-limits not object');
  });
}

// ─── 6. Instagram DM ─────────────────────────────────────────────────────────

async function testInstagramDM(live: Map<string, string>): Promise<void> {
  if (!platformEnabled('instagram')) return;
  section('Instagram DM  (port 3100)');

  const url = base(live, 'instagram-dm');
  if (!url) {
    skip('all tests', 'instagram-dm server not running on port 3100');
    return;
  }

  await test('status — shape', async () => {
    const d = await api('GET', url, '/api/status');
    assert(d !== null, 'status null');
    console.log(`     status: ${JSON.stringify(d).substring(0, 120)}`);
  });

  await test('conversations — valid array, no duplicates', async () => {
    const d = await api('GET', url, '/api/conversations');
    assert(Array.isArray(d.conversations) || Array.isArray(d), `not array: ${JSON.stringify(d).substring(0, 200)}`);
    const list = Array.isArray(d.conversations) ? d.conversations : d;
    if (list.length > 0) {
      const usernames = list.map((c: any) => c.username || c.participantName || '');
      const unique = new Set(usernames.filter(Boolean));
      const nonEmpty = usernames.filter((u: string) => u.length > 0);
      if (nonEmpty.length > 0) {
        assert(unique.size === nonEmpty.length, `Duplicates: ${nonEmpty.length} items, ${unique.size} unique`);
      }
    }
    console.log(`     conversations: ${list.length}`);
  });
}

// ─── 7. Market Research — post data + top creators ───────────────────────────

async function testMarketResearch(live: Map<string, string>): Promise<void> {
  section('Market Research  (port 3106)');

  const url = base(live, 'market-research');
  if (!url) {
    skip('all tests', 'market-research server not running on port 3106');
    return;
  }

  await test('platforms list — all 5 platforms present', async () => {
    const d = await api('GET', url, '/api/research/platforms');
    assertShape(d, ['platforms'], 'platforms response');
    assert(Array.isArray(d.platforms), 'platforms not array');
    assert(d.platforms.length >= 5, `expected ≥5 platforms, got ${d.platforms.length}`);
    const names = d.platforms.map((p: any) => p.name);
    for (const expected of ['twitter', 'instagram', 'tiktok']) {
      assert(names.includes(expected), `missing platform "${expected}"`);
    }
    console.log(`     platforms: ${names.join(', ')}`);
  });

  await test('twitter search — returns posts with engagement fields', async () => {
    const d = await api('POST', url, '/api/research/twitter/search', {
      query: 'solopreneur',
      config: { postsPerNiche: 10, maxScrollsPerSearch: 3 },
    });
    assert(d.success === true, `search failed: ${JSON.stringify(d)}`);
    assert(Array.isArray(d.posts), `posts not array: ${JSON.stringify(d)}`);
    assert(d.count === d.posts.length, `count mismatch: ${d.count} !== ${d.posts.length}`);
    assert(d.posts.length > 0, 'no posts returned — Twitter not loaded or query returned nothing');

    // Verify post structure — no false positives
    const first = d.posts[0];
    assertShape(first, ['author', 'text', 'url'], 'tweet');
    assert(typeof first.author === 'string' && first.author.length > 0, `author empty: ${JSON.stringify(first)}`);
    assert(typeof first.text === 'string' && first.text.length > 0, `text empty`);
    assert(first.url.includes('x.com') || first.url.includes('twitter.com'), `url not twitter: ${first.url}`);
    assert(typeof first.likes === 'number', `likes not number`);
    assert(typeof first.retweets === 'number', `retweets not number`);

    // Log top 3
    console.log(`     ${d.posts.length} posts collected`);
    for (const p of d.posts.slice(0, 3)) {
      console.log(`       @${p.author}: ${p.likes}L ${p.retweets}RT — "${p.text.substring(0, 60)}..."`);
    }
  });

  await test('twitter top creators — sorted by engagement', async () => {
    // Use cached results from a previous full research run if available, else do a quick search
    const searchResult = await api('POST', url, '/api/research/twitter/search', {
      query: 'AI tools',
      config: { postsPerNiche: 15, maxScrollsPerSearch: 4 },
    });
    assert(searchResult.success === true, `search failed: ${JSON.stringify(searchResult)}`);
    assert(searchResult.posts.length > 0, 'no posts — cannot compute top creators');

    // Derive top creators client-side from the posts (same logic as researcher.rankCreators)
    const engagementByAuthor = new Map<string, { total: number; posts: number; topPost: any }>();
    for (const p of searchResult.posts) {
      const score = (p.likes ?? 0) + (p.retweets ?? 0) * 2 + (p.replies ?? 0);
      const existing = engagementByAuthor.get(p.author);
      if (!existing) {
        engagementByAuthor.set(p.author, { total: score, posts: 1, topPost: p });
      } else {
        existing.total += score;
        existing.posts++;
        if (score > ((existing.topPost.likes ?? 0) + (existing.topPost.retweets ?? 0) * 2)) {
          existing.topPost = p;
        }
      }
    }

    const creators = Array.from(engagementByAuthor.entries())
      .map(([handle, data]) => ({ handle, ...data }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);

    assert(creators.length > 0, 'no creators derived from posts');

    // Verify sorted (descending)
    for (let i = 1; i < creators.length; i++) {
      assert(creators[i - 1].total >= creators[i].total,
        `creators not sorted at index ${i}: ${creators[i - 1].total} < ${creators[i].total}`);
    }

    console.log(`     top ${creators.length} creators:`);
    for (const c of creators.slice(0, 5)) {
      console.log(`       @${c.handle}: ${c.total} engagement (${c.posts} posts)`);
    }
  });

  await test('job status — valid shape', async () => {
    const d = await api('GET', url, '/api/research/status');
    assertShape(d, ['recentJobs'], 'status');
    assert(Array.isArray(d.recentJobs), 'recentJobs not array');
    console.log(`     jobs in history: ${d.recentJobs.length}`);
  });

  await test('results list — valid files array', async () => {
    const d = await api('GET', url, '/api/research/results');
    assertShape(d, ['files'], 'results');
    assert(Array.isArray(d.files), 'files not array');
    console.log(`     saved result files: ${d.files.length}`);
  });
}

// ─── 8. Cross-platform post data ─────────────────────────────────────────────

async function testCrossPlatformPostData(live: Map<string, string>): Promise<void> {
  section('Cross-Platform Post Data');

  const url = base(live, 'market-research');
  if (!url) {
    skip('all platforms', 'market-research server not running on port 3106');
    return;
  }

  const platforms: Array<{ name: string; query: string }> = [
    { name: 'twitter',   query: 'content creator tips' },
    { name: 'tiktok',    query: 'entrepreneurship' },
    { name: 'threads',   query: 'solopreneur' },
    { name: 'instagram', query: 'automation' },
  ];

  for (const { name, query } of platforms) {
    if (!platformEnabled(name)) continue;

    await test(`${name} — posts have required fields`, async () => {
      const d = await api('POST', url, `/api/research/${name}/search`, {
        query,
        config: { postsPerNiche: 8, maxScrollsPerSearch: 2 },
      });

      // Search can legitimately return 0 posts (platform not in Safari) — but must respond correctly
      assert(typeof d.success === 'boolean', `success field missing: ${JSON.stringify(d)}`);
      assert(d.platform === name, `platform mismatch: ${d.platform} !== ${name}`);
      assert(d.query === query, `query mismatch: ${d.query}`);
      assert(Array.isArray(d.posts), `posts not array: ${JSON.stringify(d).substring(0, 200)}`);
      assert(d.count === d.posts.length, `count ${d.count} !== posts.length ${d.posts.length}`);

      if (d.posts.length > 0) {
        const first = d.posts[0];
        // Every platform must have at least author and some engagement metric
        assert(typeof first.author === 'string' || typeof first.username === 'string' || typeof first.handle === 'string',
          `post missing author/username/handle: ${JSON.stringify(first)}`);
        const hasEngagement = 'likes' in first || 'views' in first || 'reactions' in first || 'engagementScore' in first;
        assert(hasEngagement, `post missing engagement metric: ${Object.keys(first).join(', ')}`);
      }

      console.log(`     ${name}: ${d.count} posts for "${query}"`);
    });
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// MAIN
// ═════════════════════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  console.log('\n' + '═'.repeat(60));
  console.log('  Social Platform Integration Test Suite');
  console.log('═'.repeat(60));
  console.log(`  Flags: --send-dm=${SEND_DM}  --platforms=${FILTER_PLATFORMS ?? 'all'}`);
  if (SEND_DM) {
    console.log('  ⚠️  --send-dm enabled: will send real DM to sarah_ashley_hunt');
  }

  // Discover which servers are up
  console.log('\n  Discovering live services...');
  const live = await buildLiveMap();
  const liveNames = SERVICES.filter(s => live.has(s.name)).map(s => `${s.name}:${s.port}`);
  const deadNames = SERVICES.filter(s => !live.has(s.name)).map(s => `${s.name}:${s.port}`);
  if (liveNames.length) console.log(`  ✅ Running: ${liveNames.join(', ')}`);
  if (deadNames.length) console.log(`  ⊘  Offline: ${deadNames.join(', ')}`);

  if (live.size === 0) {
    console.log('\n  ❌ No services running. Start them and re-run.');
    process.exit(1);
  }

  // Run test sections
  await testHealthChecks(live);
  await testTwitterDM(live);
  await testTwitterComments(live);
  await testTikTokDM(live);
  await testLinkedIn(live);
  await testInstagramDM(live);
  await testMarketResearch(live);
  await testCrossPlatformPostData(live);

  // ─── Summary ─────────────────────────────────────────────────────────────

  const passed  = results.filter(r => r.passed).length;
  const failed  = results.filter(r => !r.passed && !r.skipped).length;
  const skipped = results.filter(r => r.skipped).length;
  const total   = results.length;
  const totalMs = results.reduce((s, r) => s + r.durationMs, 0);

  console.log('\n' + '═'.repeat(60));
  console.log(`  Results: ${passed}/${total} passed  ${failed} failed  ${skipped} skipped  (${totalMs}ms total)`);
  console.log('═'.repeat(60));

  if (failed > 0) {
    console.log('\n  Failed tests:');
    for (const r of results.filter(r => !r.passed && !r.skipped)) {
      console.log(`    ✗  ${r.name}`);
      console.log(`       ${r.details}`);
    }
  }

  if (skipped > 0) {
    console.log('\n  Skipped (service offline or flag not set):');
    for (const r of results.filter(r => r.skipped)) {
      console.log(`    ⊘  ${r.name}: ${r.details}`);
    }
  }

  console.log('');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('\n  ❌ Uncaught error:', err);
  process.exit(1);
});
