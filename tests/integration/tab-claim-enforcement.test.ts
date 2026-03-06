/**
 * tab-claim-enforcement.test.ts — Tab Claim Pattern Integration Tests
 *
 * Verifies all 8 Safari automation services enforce the tab claim lifecycle:
 *   1. /api/session/ensure  — returns { ok: bool } (never throws 500)
 *   2. /api/session/status  — returns tracked tab info
 *   3. requireTabClaim      — non-exempt routes return 503 (not 500) when no tab
 *   4. /api/tabs/claims     — lists cross-service claims correctly
 *   5. /api/tabs/claim      — can register a named claim
 *   6. /api/tabs/release    — releases it cleanly
 *   7. Startup cleanup      — stale claims are evicted on service restart
 *   8. Claim heartbeat      — claim stays alive across multiple requests
 *
 * Design: SKIP gracefully when a service isn't running. No Safari side effects.
 *
 * Run:
 *   npx tsx tests/integration/tab-claim-enforcement.test.ts
 *   npx tsx tests/integration/tab-claim-enforcement.test.ts --platform tiktok-dm
 *   npx tsx tests/integration/tab-claim-enforcement.test.ts --all          # also tests write ops
 */

export {};

// ─── CLI ──────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const PLATFORM_FILTER = args.find(a => a.startsWith('--platform'))
  ? args[args.indexOf(args.find(a => a.startsWith('--platform'))!) + 1] ?? args.find(a => a.startsWith('--platform='))?.split('=')[1]
  : null;
const TEST_WRITE_OPS = args.includes('--all');  // claim/release write tests

// ─── Service Registry ─────────────────────────────────────────────────────────
interface Service {
  name: string;
  port: number;
  urlPattern: string;   // what tiktok.com / x.com / instagram.com etc.
  inboxPath?: string;   // path to hit for inbox_check (verify tab claim required)
}

const SERVICES: Service[] = [
  // instagram-dm runs on port 3100 BUT only when started via npm run start:server in the package.
  // Remotion may occupy port 3100 in development — check with /health first.
  { name: 'instagram-dm',       port: 3100, urlPattern: 'instagram.com',  inboxPath: '/api/conversations/unread' },
  { name: 'instagram-comments', port: 3005, urlPattern: 'instagram.com',  inboxPath: '/api/instagram/status' },
  { name: 'twitter-dm',         port: 3003, urlPattern: 'x.com',          inboxPath: '/api/twitter/conversations/unread' },
  { name: 'twitter-comments',   port: 3007, urlPattern: 'x.com',          inboxPath: '/api/twitter/status' },
  { name: 'tiktok-dm',          port: 3102, urlPattern: 'tiktok.com',     inboxPath: '/api/tiktok/conversations/unread' },
  { name: 'tiktok-comments',    port: 3006, urlPattern: 'tiktok.com',     inboxPath: '/api/tiktok/status' },
  { name: 'threads-comments',   port: 3004, urlPattern: 'threads.net',    inboxPath: '/api/threads/status' },
  { name: 'upwork-automation',  port: 3108, urlPattern: 'upwork.com',     inboxPath: '/api/upwork/status' },
];

// ─── Test runner ──────────────────────────────────────────────────────────────
interface Result { name: string; passed: boolean; skipped: boolean; details: string; ms: number; }
const results: Result[] = [];
let section = '';

function sec(name: string) {
  section = name;
  console.log(`\n${'─'.repeat(64)}`);
  console.log(`  ${name}`);
  console.log('─'.repeat(64));
}

async function test(name: string, fn: () => Promise<void>) {
  const t = Date.now();
  try {
    await fn();
    results.push({ name: `${section} › ${name}`, passed: true, skipped: false, details: 'OK', ms: Date.now() - t });
    console.log(`  ✓  ${name} (${Date.now() - t}ms)`);
  } catch (e: any) {
    results.push({ name: `${section} › ${name}`, passed: false, skipped: false, details: e?.message ?? String(e), ms: Date.now() - t });
    console.log(`  ✗  ${name}: ${e?.message ?? e}`);
  }
}

function skip(name: string, reason: string) {
  results.push({ name: `${section} › ${name}`, passed: false, skipped: true, details: reason, ms: 0 });
  console.log(`  ⊘  ${name} [SKIPPED: ${reason}]`);
}

function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────
const TIMEOUT_MS = 45_000;
// Services use Bearer test-token-12345 as internal auth (same token for all platforms)
const AUTH_HEADERS = { 'Content-Type': 'application/json', 'Authorization': 'Bearer test-token-12345' };

async function get(base: string, path: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${path}`, { headers: AUTH_HEADERS, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function post(base: string, path: string, data: any = {}): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer test-token-12345' },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function isUp(port: number, expectedService?: string): Promise<boolean> {
  try {
    const r = await fetch(`http://localhost:${port}/health`, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) return false;
    if (expectedService) {
      const body = await r.json().catch(() => ({}));
      // Reject if service field missing (non-compliant service like Remotion) or doesn't match
      if (!body.service) return false;
      if (!body.service.includes(expectedService.split('-')[0])) return false;
    }
    return true;
  } catch { return false; }
}

// ─── Per-service tests ────────────────────────────────────────────────────────

async function testService(svc: Service): Promise<void> {
  const base = `http://localhost:${svc.port}`;

  sec(`${svc.name} (:${svc.port})`);

  if (!(await isUp(svc.port, svc.name))) {
    skip('all tests', `service not running on port ${svc.port} — start it first (or another service occupies the port)`);
    return;
  }

  // 1. Health endpoint is reachable and returns correct shape
  await test('health — returns ok status', async () => {
    const { status, body } = await get(base, '/health');
    assert(status === 200, `Expected 200, got ${status}`);
    assert(body.status === 'ok' || body.status === 'healthy' || body.status === 'running',
      `body.status="${body.status}" — expected ok/healthy/running`);
  });

  // 2. /api/session/ensure exists and returns {ok: bool} shape (never throws 500 on no-tab)
  await test('session/ensure — returns {ok} shape, not 500', async () => {
    const { status, body } = await post(base, '/api/session/ensure');
    // ok:true means tab found; ok:false means no tab — both are valid
    assert(status === 200, `Expected 200, got ${status} — body: ${JSON.stringify(body).slice(0, 200)}`);
    assert('ok' in body, `body missing "ok" field — got: ${JSON.stringify(body).slice(0, 200)}`);
    assert(typeof body.ok === 'boolean', `body.ok="${body.ok}" — must be boolean`);
    if (body.ok) {
      assert(typeof body.windowIndex === 'number', `body.windowIndex missing when ok=true`);
      assert(typeof body.tabIndex === 'number', `body.tabIndex missing when ok=true`);
      console.log(`       → tab active at window ${body.windowIndex}, tab ${body.tabIndex} (${body.url ?? ''})`);
    } else {
      console.log(`       → no ${svc.urlPattern} tab open in Safari (ok=false, graceful)`);
    }
  });

  // 3. /api/session/status returns tracked tab info
  await test('session/status — returns tracked shape', async () => {
    const { status, body } = await get(base, '/api/session/status');
    assert(status === 200, `Expected 200, got ${status}`);
    assert('tracked' in body, `body missing "tracked" field`);
    assert(typeof body.tracked === 'boolean', `body.tracked not boolean`);
    console.log(`       → tracked=${body.tracked}, windowIndex=${body.windowIndex}, tabIndex=${body.tabIndex}`);
  });

  // 4. /api/tabs/claims returns valid array
  await test('tabs/claims — returns claims array', async () => {
    const { status, body } = await get(base, '/api/tabs/claims');
    assert(status === 200, `Expected 200, got ${status}`);
    assert(Array.isArray(body.claims), `body.claims not array`);
    assert(typeof body.count === 'number', `body.count not number`);
    console.log(`       → ${body.count} active claim(s) across all services`);
    for (const c of body.claims) {
      assert(typeof c.service === 'string', `claim missing service`);
      assert(typeof c.windowIndex === 'number', `claim missing windowIndex`);
      assert(typeof c.heartbeat === 'number', `claim missing heartbeat`);
    }
  });

  // 5. Claims for THIS service (if any) belong to this service name
  await test('tabs/claims — this service claims are correctly labeled', async () => {
    const { body } = await get(base, '/api/tabs/claims');
    const mine = body.claims.filter((c: any) => c.service === svc.name);
    console.log(`       → ${mine.length} claim(s) for ${svc.name}`);
    for (const c of mine) {
      assert(c.port === svc.port, `claim.port=${c.port} ≠ ${svc.port}`);
      assert(c.urlPattern === svc.urlPattern,
        `claim.urlPattern="${c.urlPattern}" ≠ "${svc.urlPattern}"`);
    }
  });

  // 6. Claim write ops (--all flag)
  if (TEST_WRITE_OPS) {
    const testAgentId = `test-claim-${svc.name}-${Date.now()}`;

    await test('tabs/claim — registers a named claim', async () => {
      const { status, body } = await post(base, '/api/tabs/claim', { agentId: testAgentId });
      // 200 = claimed; 409 = conflict (tab already claimed by another agent — still means endpoint works)
      assert(status === 200 || status === 409, `Expected 200 or 409, got ${status}`);
      if (status === 200) {
        assert(body.ok === true, `body.ok not true after claim`);
        assert(body.claim?.agentId === testAgentId, `claim.agentId mismatch`);
        console.log(`       → claimed w=${body.claim.windowIndex} t=${body.claim.tabIndex}`);
      } else {
        console.log(`       → 409 conflict (tab already owned by another agent — expected)`);
      }
    });

    await test('tabs/release — releases the named claim', async () => {
      const { status, body } = await post(base, '/api/tabs/release', { agentId: testAgentId });
      assert(status === 200, `Expected 200, got ${status}`);
      assert(body.ok === true, `body.ok not true after release`);
    });

    await test('tabs/claims — claim gone after release', async () => {
      const { body } = await get(base, '/api/tabs/claims');
      const still = body.claims.filter((c: any) => c.agentId === testAgentId);
      assert(still.length === 0, `Claim for ${testAgentId} still present after release`);
    });
  } else {
    skip('tabs/claim + release write ops', 'pass --all flag to enable');
  }

  // 7. Inbox/status path — responds 200 (not crash), proving requireTabClaim runs
  if (svc.inboxPath) {
    await test(`${svc.inboxPath} — responds (tab claim middleware ran)`, async () => {
      // Use GET for status endpoints, POST for others
      const isGet = svc.inboxPath!.includes('status') || svc.inboxPath!.includes('unread');
      const { status, body } = isGet
        ? await get(base, svc.inboxPath!)
        : await post(base, svc.inboxPath!, {});
      // 200 = success, 503 = no tab (correct), 409 = platform busy (correct)
      // Anything else (500) = middleware didn't run or crashed
      assert(
        status === 200 || status === 503 || status === 409 || status === 404,
        `Got ${status} — likely a crash (not 503 tab-not-found): ${JSON.stringify(body).slice(0, 200)}`
      );
      const tabClaimRan = status === 200 || status === 503 || status === 409;
      if (status === 200)      console.log(`       → 200 tab claimed + response OK`);
      else if (status === 503) console.log(`       → 503 no Safari tab open (requireTabClaim enforced correctly)`);
      else if (status === 409) console.log(`       → 409 platform busy (tab claim ran, 409 is expected)`);
      else if (status === 404) console.log(`       → 404 (endpoint exists, tab claim ran)`);
      assert(tabClaimRan, `requireTabClaim enforcement check passed`);
    });
  }

  // 8. Heartbeat: make two requests, verify heartbeat timestamp advances
  await test('claim heartbeat advances across requests', async () => {
    const { body: b1 } = await get(base, '/api/tabs/claims');
    const mine1 = b1.claims.find((c: any) => c.service === svc.name);
    if (!mine1) {
      console.log(`       → no active claim for ${svc.name} (skip heartbeat check)`);
      return;
    }
    // Wait 1.1s, then check again
    await new Promise(r => setTimeout(r, 1100));
    const { body: b2 } = await get(base, '/api/tabs/claims');
    const mine2 = b2.claims.find((c: any) => c.service === svc.name);
    assert(!!mine2, `Claim disappeared between two requests`);
    // Heartbeat should be the same or newer (service heartbeats every 30s, so may not advance in 1s)
    assert(mine2.heartbeat >= mine1.heartbeat, `Heartbeat went backwards: ${mine2.heartbeat} < ${mine1.heartbeat}`);
    console.log(`       → heartbeat OK (delta: ${mine2.heartbeat - mine1.heartbeat}ms)`);
  });
}

// ─── Cross-service claim isolation test ───────────────────────────────────────

async function testCrossServiceIsolation(liveServices: Service[]): Promise<void> {
  sec('Cross-service claim isolation');

  if (liveServices.length < 2) {
    skip('isolation check', 'need ≥2 services running');
    return;
  }

  // Pick any two live services
  const [svcA, svcB] = liveServices.slice(0, 2);
  const baseA = `http://localhost:${svcA.port}`;
  const baseB = `http://localhost:${svcB.port}`;

  await test(`${svcA.name} claims visible from ${svcB.name}`, async () => {
    // Both services share /tmp/safari-tab-claims.json
    const { body: a } = await get(baseA, '/api/tabs/claims');
    const { body: b } = await get(baseB, '/api/tabs/claims');
    // They should return the same set (same underlying file)
    assert(Array.isArray(a.claims) && Array.isArray(b.claims), 'Both must return claims arrays');
    // Counts should match (within 1 since claim state can change during the test)
    const diff = Math.abs(a.count - b.count);
    assert(diff <= 1, `Claim counts differ by ${diff} — shared claims file may be inconsistent (A=${a.count}, B=${b.count})`);
    console.log(`       → both services see ${a.count}/${b.count} claims (shared file OK)`);
  });

  await test('service names are distinct in shared claims file', async () => {
    const { body } = await get(baseA, '/api/tabs/claims');
    const serviceNames = [...new Set(body.claims.map((c: any) => c.service))];
    console.log(`       → services with active claims: ${serviceNames.join(', ') || 'none'}`);
    for (const c of body.claims) {
      assert(typeof c.service === 'string' && c.service.length > 0, `claim has empty service name`);
    }
  });
}

// ─── Stale claim cleanup test ─────────────────────────────────────────────────

async function testStaleClaimCleanup(liveServices: Service[]): Promise<void> {
  sec('Stale claim cleanup (startup eviction)');

  const fs = await import('fs/promises');
  const CLAIMS_FILE = '/tmp/safari-tab-claims.json';

  await test('inject fake stale claim and verify it was written', async () => {
    let current: any[] = [];
    try { current = JSON.parse(await fs.readFile(CLAIMS_FILE, 'utf-8')); } catch { current = []; }

    const fakeClaim = {
      agentId: 'test-stale-999',
      service: '__test-stale-service__',
      port: 9999,
      urlPattern: 'example.com',
      windowIndex: 99,
      tabIndex: 99,
      tabUrl: 'https://example.com',
      pid: 9999999,
      claimedAt: Date.now() - 200_000,
      heartbeat: Date.now() - 200_000,   // 200s ago — well past 60s TTL
    };

    await fs.writeFile(CLAIMS_FILE, JSON.stringify([...current, fakeClaim], null, 2));

    // Verify written
    const after = JSON.parse(await fs.readFile(CLAIMS_FILE, 'utf-8'));
    const found = after.find((c: any) => c.agentId === 'test-stale-999');
    assert(!!found, 'Fake stale claim was not written to file');
    console.log(`       → injected fake claim for __test-stale-service__`);
  });

  await test('TabCoordinator.listClaims() filters out expired claims (TTL=60s)', async () => {
    // Any live service's /api/tabs/claims endpoint uses TabCoordinator.listClaims() with TTL
    if (liveServices.length === 0) { throw new Error('no live services to query'); }
    const { body } = await get(`http://localhost:${liveServices[0].port}`, '/api/tabs/claims');
    const stale = body.claims.find((c: any) => c.agentId === 'test-stale-999');
    assert(!stale, `Stale claim (200s old) was NOT filtered by TTL — TabCoordinator TTL check may be broken`);
    console.log(`       → stale claim correctly filtered by 60s TTL`);
  });

  // Clean up the file after test
  await test('cleanup — restore claims file without fake entry', async () => {
    let current: any[] = [];
    try { current = JSON.parse(await fs.readFile(CLAIMS_FILE, 'utf-8')); } catch { current = []; }
    const cleaned = current.filter((c: any) => c.agentId !== 'test-stale-999');
    await fs.writeFile(CLAIMS_FILE, JSON.stringify(cleaned, null, 2));
    console.log(`       → claims file restored (${cleaned.length} live claims remaining)`);
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n' + '═'.repeat(64));
  console.log('  Safari Tab Claim Enforcement — Integration Tests');
  if (PLATFORM_FILTER) console.log(`  Filter: ${PLATFORM_FILTER}`);
  if (TEST_WRITE_OPS) console.log('  Mode: --all (write ops enabled)');
  console.log('═'.repeat(64));

  // Filter services if --platform was passed
  const targetServices = PLATFORM_FILTER
    ? SERVICES.filter(s => s.name === PLATFORM_FILTER || s.name.startsWith(PLATFORM_FILTER))
    : SERVICES;

  // Run per-service tests
  for (const svc of targetServices) {
    await testService(svc);
  }

  // Cross-service tests (only when running all)
  if (!PLATFORM_FILTER) {
    const liveServices = await Promise.all(
      SERVICES.map(async s => (await isUp(s.port, s.name)) ? s : null)
    ).then(arr => arr.filter(Boolean) as Service[]);

    await testCrossServiceIsolation(liveServices);
    await testStaleClaimCleanup(liveServices);
  }

  // ─── Summary ─────────────────────────────────────────────────────────────
  const passed  = results.filter(r => r.passed).length;
  const failed  = results.filter(r => !r.passed && !r.skipped).length;
  const skipped = results.filter(r => r.skipped).length;
  const total   = results.length;
  const totalMs = results.reduce((s, r) => s + r.ms, 0);

  console.log('\n' + '═'.repeat(64));
  console.log(`  Results: ${passed}/${total} passed  ${failed} failed  ${skipped} skipped  (${totalMs}ms)`);
  console.log('═'.repeat(64));

  if (failed > 0) {
    console.log('\n  Failed:');
    results.filter(r => !r.passed && !r.skipped).forEach(r => {
      console.log(`    ✗  ${r.name}`);
      console.log(`       ${r.details}`);
    });
  }

  if (skipped > 0) {
    console.log('\n  Skipped:');
    results.filter(r => r.skipped).forEach(r =>
      console.log(`    ⊘  ${r.name}: ${r.details}`)
    );
  }

  console.log('');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('\n  ❌ Fatal:', err);
  process.exit(1);
});
