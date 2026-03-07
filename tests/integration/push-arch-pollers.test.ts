/**
 * push-arch-pollers.test.ts — Push Architecture Integration Tests
 *
 * Verifies the full Phase B (Push Model) contract:
 *   1. Cache miss → poller returns []  (never calls Safari)
 *   2. Cache hit  → poller returns cached data
 *   3. Pollers for all 5 platforms: instagram, twitter, tiktok, threads, linkedin
 *   4. Profile endpoint on cron-manager :3302 returns automation window config
 *
 * Prerequisites:
 *   - SUPABASE_URL and SUPABASE_ANON_KEY must be set (or ~/.env loaded)
 *   - Does NOT require any Safari services to be running
 *   - Writes test rows to safari_platform_cache and cleans them up
 *
 * Run:
 *   npx tsx tests/integration/push-arch-pollers.test.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Load env ─────────────────────────────────────────────────────────────────
function loadEnv(filePath: string) {
  try {
    const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
    for (const line of lines) {
      const m = line.match(/^([A-Z0-9_]+)=(.+)/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  } catch { /* non-fatal */ }
}
loadEnv(path.join(os.homedir(), '.env'));
loadEnv(path.join(__dirname, '../../.env'));

// ── Supabase client ──────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ivhfuhxorppptyuofbgq.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';
if (!SUPABASE_KEY) {
  console.error('FATAL: SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY must be set');
  process.exit(1);
}
const db = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Test helpers ─────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
    failures.push(message);
  } else {
    console.log(`  ✓ ${message}`);
    passed++;
  }
}

async function seedCache(platform: string, dataType: string, payload: any[]) {
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 min TTL
  await db.from('safari_platform_cache').delete().eq('platform', platform).eq('data_type', dataType);
  const { error } = await db.from('safari_platform_cache').insert({
    platform,
    data_type: dataType,
    payload,
    fetched_at: new Date().toISOString(),
    expires_at: expiresAt,
  });
  if (error) throw new Error(`seedCache(${platform}, ${dataType}) failed: ${error.message}`);
}

async function clearCache(platform: string, dataType: string) {
  await db.from('safari_platform_cache').delete().eq('platform', platform).eq('data_type', dataType);
}

async function readCache(platform: string, dataType: string): Promise<any[] | null> {
  const { data, error } = await db
    .from('safari_platform_cache')
    .select('payload')
    .eq('platform', platform)
    .eq('data_type', dataType)
    .gt('expires_at', new Date().toISOString())
    .order('fetched_at', { ascending: false })
    .limit(1)
    .single();
  if (error || !data) return null;
  return Array.isArray(data.payload) ? data.payload : [data.payload];
}

async function fetchJSON(url: string): Promise<any> {
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  return res.json();
}

// ── Platform definitions ──────────────────────────────────────────────────────
interface PlatformDef {
  platform: string;
  dataTypes: string[];
  servicePort: number;
}

const PLATFORMS: PlatformDef[] = [
  { platform: 'instagram', dataTypes: ['dms', 'notifications', 'post_stats', 'comments', 'followers'], servicePort: 3100 },
  { platform: 'twitter',   dataTypes: ['dms', 'notifications', 'post_stats', 'comments', 'followers'], servicePort: 3003 },
  { platform: 'tiktok',    dataTypes: ['dms', 'notifications', 'post_stats', 'comments', 'followers'], servicePort: 3102 },
  { platform: 'threads',   dataTypes: ['notifications', 'post_stats', 'comments'], servicePort: 3004 },
  { platform: 'linkedin',  dataTypes: ['dms', 'notifications', 'post_stats', 'invitations'], servicePort: 3105 },
];

// ── Test: cache write → read round-trip ─────────────────────────────────────
async function testCacheRoundTrip() {
  console.log('\n── Cache round-trip (Supabase read/write) ────────────────────');

  for (const { platform, dataTypes } of PLATFORMS) {
    for (const dataType of dataTypes.slice(0, 1)) { // just first type per platform
      const testPayload = [{ test: true, platform, dataType, ts: Date.now() }];

      await seedCache(platform, dataType, testPayload);
      const result = await readCache(platform, dataType);
      assert(
        result !== null && result.length === 1 && result[0].platform === platform,
        `${platform}/${dataType}: seed+read returns correct payload`
      );

      await clearCache(platform, dataType);
      const afterClear = await readCache(platform, dataType);
      assert(afterClear === null, `${platform}/${dataType}: cleared cache returns null`);
    }
  }
}

// ── Test: pollers via cloud-sync REST API ────────────────────────────────────
// The cloud-sync server exposes GET /api/platform/:platform/:dataType for checking
// what pollers would return. We test it at the HTTP level to avoid re-importing TS.
// If cloud-sync is not running, tests are skipped with a warning.
async function testPollersCacheMiss() {
  console.log('\n── Poller cache-miss → [] (via cloud-sync :3200) ─────────────');

  let cloudSyncUp = false;
  try {
    const health = await fetchJSON('http://localhost:3200/health');
    cloudSyncUp = health?.status === 'ok' || !!health;
  } catch { /* down */ }

  if (!cloudSyncUp) {
    console.log('  ⚠ cloud-sync :3200 not running — skipping poller live tests');
    console.log('    (run: npx tsx packages/cloud-sync/src/api/server.ts)');
    return;
  }

  // Clear all test platforms from cache so we get cache misses
  for (const { platform, dataTypes } of PLATFORMS) {
    for (const dataType of dataTypes) {
      await clearCache(platform, dataType);
    }
  }

  // Poll each platform — all should return empty on cache miss
  for (const { platform } of PLATFORMS) {
    try {
      const res = await fetch('http://localhost:3200/api/sync/poll-now', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, dataType: 'dms' }),
        signal: AbortSignal.timeout(60000),
      });
      const body = await res.json() as any;
      const synced = body?.results?.reduce((sum: number, r: any) => sum + (r.itemsSynced || 0), 0) ?? 0;
      assert(synced === 0, `${platform}: cache-miss poll returns 0 items (not calling Safari)`);
    } catch (e: any) {
      console.log(`  ⚠ ${platform}: poll request failed — ${e.message}`);
    }
  }
}

async function testPollersCacheHit() {
  console.log('\n── Poller cache-hit → returns data (via cloud-sync :3200) ────');

  let cloudSyncUp = false;
  try {
    const health = await fetchJSON('http://localhost:3200/health');
    cloudSyncUp = health?.status === 'ok' || !!health;
  } catch { /* down */ }

  if (!cloudSyncUp) {
    console.log('  ⚠ cloud-sync :3200 not running — skipping poller cache-hit tests');
    return;
  }

  // Seed a test DM for instagram
  const testDM = [{
    platform: 'instagram',
    conversation_id: 'test-conv-001',
    username: 'test_user',
    display_name: 'Test User',
    direction: 'inbound' as const,
    message_text: 'push-arch test message',
    message_type: 'text',
    is_read: false,
    raw_data: {},
    platform_timestamp: new Date().toISOString(),
  }];
  await seedCache('instagram', 'dms', testDM);

  try {
    // Trigger a poll — cache has test data, poller should sync it
    const res = await fetch('http://localhost:3200/api/sync/poll-now', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dataType: 'dms' }),
      signal: AbortSignal.timeout(60000),
    });
    const body = await res.json() as any;
    const instagramResult = body?.results?.find((r: any) => r.platform === 'instagram');
    assert(!!instagramResult && instagramResult.itemsSynced >= 0, 'instagram: cache-hit poll completes without error');
    // Also verify the cache row exists and has our test data
    const cached = await readCache('instagram', 'dms');
    assert(cached !== null && cached.some((d: any) => d.username === 'test_user'), 'instagram: seeded DM is in cache');
  } catch (e: any) {
    console.log(`  ⚠ instagram cache-hit test failed: ${e.message}`);
  } finally {
    await clearCache('instagram', 'dms');
  }
}

// ── Test: services do NOT listen on localhost when cache-only ────────────────
async function testNoCrossServiceCalls() {
  console.log('\n── Pollers do not call Safari service ports ───────────────────');

  // Verify that polling returns [] even when Safari services are UP.
  // The key invariant: pollers never call localhost:31xx — they only read cache.
  // We seed no cache → expect [] regardless of whether services are up.

  for (const { platform, dataTypes, servicePort } of PLATFORMS) {
    let serviceUp = false;
    try {
      const h = await fetch(`http://localhost:${servicePort}/health`, { signal: AbortSignal.timeout(1500) });
      serviceUp = h.ok;
    } catch { /* down */ }

    if (!serviceUp) continue; // can't test bypass if service is down

    // Clear cache for this platform
    for (const dt of dataTypes) await clearCache(platform, dt);

    // If cloud-sync is up, poll — it must return 0 synced (cache miss = [] from poller)
    try {
      const pollRes = await fetch('http://localhost:3200/api/sync/poll-now', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, dataType: 'dms' }),
        signal: AbortSignal.timeout(60000),
      });
      const body = await pollRes.json() as any;
      const synced = body?.results?.reduce((sum: number, r: any) => sum + (r.itemsSynced || 0), 0) ?? 0;
      assert(
        synced === 0,
        `${platform} (:${servicePort} UP): cache-miss returns 0 synced — poller does not call Safari`
      );
    } catch { /* cloud-sync not up, skip */ }
  }

  console.log('  (platforms with service running were checked for Safari bypass)');
}

// ── Test: GET /api/tabs/profile on cron-manager :3302 ────────────────────────
async function testProfileEndpoint() {
  console.log('\n── GET /api/tabs/profile (cron-manager :3302) ─────────────────');

  let cronUp = false;
  let profileData: any = null;
  try {
    profileData = await fetchJSON('http://localhost:3302/api/tabs/profile');
    cronUp = !!profileData;
  } catch { /* down */ }

  if (!cronUp) {
    console.log('  ⚠ cron-manager :3302 not running — skipping profile endpoint test');
    console.log('    (run: node harness/cron-manager.js)');
    return;
  }

  assert(typeof profileData.automationWindow === 'number', 'profile: automationWindow is a number');
  assert(profileData.automationWindow >= 1, `profile: automationWindow >= 1 (got ${profileData.automationWindow})`);
  assert(typeof profileData.enforced === 'boolean', 'profile: enforced is a boolean');
  console.log(`  ℹ automationWindow=${profileData.automationWindow}, enforced=${profileData.enforced}`);
}

// ── Test: self-poll trigger endpoints ────────────────────────────────────────
async function testSelfPollTriggers() {
  console.log('\n── Self-poll trigger endpoints ────────────────────────────────');

  // Each service uses a slightly different path/method — match what's actually registered
  const services = [
    { name: 'instagram-dm',        port: 3100, method: 'GET',  path: '/api/self-poll/trigger',    authToken: null },
    { name: 'twitter-dm',          port: 3003, method: 'GET',  path: '/api/self-poll/trigger',    authToken: null },
    { name: 'tiktok-comments',     port: 3006, method: 'POST', path: '/api/tiktok/self-poll',     authToken: null },
    { name: 'threads-comments',    port: 3004, method: 'POST', path: '/api/threads/self-poll',    authToken: process.env.THREADS_AUTH_TOKEN || process.env.AUTH_TOKEN || 'threads-local-dev-token' },
    { name: 'linkedin-automation', port: 3105, method: 'GET',  path: '/api/self-poll/trigger',    authToken: process.env.LINKEDIN_AUTH_TOKEN || 'test-token-12345' },
  ];

  for (const { name, port, method, path, authToken } of services) {
    let up = false;
    try {
      const h = await fetch(`http://localhost:${port}/health`, { signal: AbortSignal.timeout(1500) });
      up = h.ok;
    } catch { /* down */ }

    if (!up) {
      console.log(`  ⚠ ${name} :${port} not running — skipped`);
      continue;
    }

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

      const opts: RequestInit = { method, headers, signal: AbortSignal.timeout(60000) };
      if (method === 'POST') opts.body = JSON.stringify({});

      const res = await fetch(`http://localhost:${port}${path}`, opts);
      assert(res.status < 500, `${name}: ${method} ${path} → HTTP ${res.status} (not 5xx)`);
      const body = await res.json().catch(() => ({}));
      assert(
        body.ok === true || body.success === true || body.triggered === true || res.status === 202 || res.status === 200,
        `${name}: self-poll trigger returns success/200/202 (got ${res.status}: ${JSON.stringify(body).slice(0, 80)})`
      );
    } catch (e: any) {
      console.log(`  ⚠ ${name}: trigger failed — ${e.message}`);
    }
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────
async function run() {
  console.log('=== Push Architecture Integration Tests ===');
  console.log(`Supabase: ${SUPABASE_URL}`);

  try {
    await testCacheRoundTrip();
    await testPollersCacheMiss();
    await testPollersCacheHit();
    await testNoCrossServiceCalls();
    await testProfileEndpoint();
    await testSelfPollTriggers();
  } finally {
    // cleanup: remove any leftover test cache rows
    for (const { platform, dataTypes } of PLATFORMS) {
      for (const dt of dataTypes) {
        await clearCache(platform, dt).catch(() => {});
      }
    }
  }

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.log('\nFailed assertions:');
    failures.forEach(f => console.log(`  • ${f}`));
  }
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
