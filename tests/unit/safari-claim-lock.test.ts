import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  TabCoordinator,
  type TabClaim,
} from '../../packages/instagram-dm/src/automation/tab-coordinator.js';

describe('Safari claim registry fcntl interoperability', () => {
  let directory = '';
  let claimsFile = '';
  let lockFile = '';
  let ownershipFile = '';
  let presenceFile = '';
  let drainFile = '';
  let observationFile = '';
  let originalNodeEnv: string | undefined;
  let originalClaimsFile: string | undefined;
  let originalLockFile: string | undefined;
  let originalOwnershipFile: string | undefined;
  let originalPresenceFile: string | undefined;
  let originalDrainFile: string | undefined;
  let originalObservationFile: string | undefined;

  const marker = (index: number): string =>
    `__ACTP_SAFARI_AGENT_TAB__:00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;

  async function writePermitState(): Promise<void> {
    const now = Date.now();
    await writeFile(presenceFile, JSON.stringify({
      version: 1,
      updated_at: new Date(now).toISOString(),
      observed_at: now / 1000,
      source_available: true,
      frontmost_app: null,
      idle_seconds: 600,
      browser_foreground: { chrome: false, safari: false },
      human_recent: false,
      active: { chrome: false, safari: false },
      manual_hold_until: { chrome: 0, safari: 0 },
      restart_allowed: { chrome: true, safari: true },
      retry_after_seconds: { chrome: 0, safari: 0 },
    }), { mode: 0o600 });
    await writeFile(drainFile, JSON.stringify({
      version: 1,
      updated_at: new Date(now).toISOString(),
      draining: { chrome: false, safari: false },
      retry_after_seconds: { chrome: 0, safari: 0 },
    }), { mode: 0o600 });
  }

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'safari-claim-lock-test-'));
    claimsFile = join(directory, 'claims.json');
    lockFile = join(directory, 'claims.lock');
    ownershipFile = join(directory, 'ownership.json');
    presenceFile = join(directory, 'presence.json');
    drainFile = join(directory, 'drain.json');
    observationFile = join(directory, 'ownership-observation.txt');
    await writeFile(claimsFile, '[]', { mode: 0o600 });
    originalNodeEnv = process.env.NODE_ENV;
    originalClaimsFile = process.env.SAFARI_TAB_CLAIMS_FILE;
    originalLockFile = process.env.SAFARI_TAB_CLAIMS_LOCK_FILE;
    originalOwnershipFile = process.env.SAFARI_TAB_OWNERSHIP_FILE;
    originalPresenceFile = process.env.SAFARI_HUMAN_PRESENCE_STATE_FILE;
    originalDrainFile = process.env.SAFARI_BROWSER_DRAIN_STATE_FILE;
    originalObservationFile = process.env.SAFARI_OWNERSHIP_OBSERVATION_FILE;
    process.env.NODE_ENV = 'test';
    process.env.SAFARI_TAB_CLAIMS_FILE = claimsFile;
    process.env.SAFARI_TAB_CLAIMS_LOCK_FILE = lockFile;
    process.env.SAFARI_TAB_OWNERSHIP_FILE = ownershipFile;
    process.env.SAFARI_HUMAN_PRESENCE_STATE_FILE = presenceFile;
    process.env.SAFARI_BROWSER_DRAIN_STATE_FILE = drainFile;
    process.env.SAFARI_OWNERSHIP_OBSERVATION_FILE = observationFile;
    await writePermitState();
  });

  afterAll(async () => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalClaimsFile === undefined) delete process.env.SAFARI_TAB_CLAIMS_FILE;
    else process.env.SAFARI_TAB_CLAIMS_FILE = originalClaimsFile;
    if (originalLockFile === undefined) delete process.env.SAFARI_TAB_CLAIMS_LOCK_FILE;
    else process.env.SAFARI_TAB_CLAIMS_LOCK_FILE = originalLockFile;
    if (originalOwnershipFile === undefined) delete process.env.SAFARI_TAB_OWNERSHIP_FILE;
    else process.env.SAFARI_TAB_OWNERSHIP_FILE = originalOwnershipFile;
    if (originalPresenceFile === undefined) delete process.env.SAFARI_HUMAN_PRESENCE_STATE_FILE;
    else process.env.SAFARI_HUMAN_PRESENCE_STATE_FILE = originalPresenceFile;
    if (originalDrainFile === undefined) delete process.env.SAFARI_BROWSER_DRAIN_STATE_FILE;
    else process.env.SAFARI_BROWSER_DRAIN_STATE_FILE = originalDrainFile;
    if (originalObservationFile === undefined) delete process.env.SAFARI_OWNERSHIP_OBSERVATION_FILE;
    else process.env.SAFARI_OWNERSHIP_OBSERVATION_FILE = originalObservationFile;
    await rm(directory, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await writeFile(claimsFile, '[]', { mode: 0o600 });
    await writeFile(ownershipFile, JSON.stringify({ version: 1, entries: [] }), { mode: 0o600 });
    await writeFile(observationFile, '', { mode: 0o600 });
    await writePermitState();
  });

  it('preserves every concurrent read-modify-write and mode 0600', async () => {
    const coordinators = Array.from({ length: 8 }, (_, index) => {
      const coordinator = new TabCoordinator(
        `lock-agent-${index}`,
        `lock-service-${index}`,
        3200 + index,
        'example.com',
      );
      const now = Date.now();
      const claim: TabClaim = {
        agentId: `lock-agent-${index}`,
        service: `lock-service-${index}`,
        port: 3200 + index,
        urlPattern: 'example.com',
        windowIndex: 2,
        windowId: 9001,
        tabIndex: index + 1,
        tabUrl: `https://example.com/${index}`,
        pid: process.pid,
        claimedAt: now,
        heartbeat: now,
        agentOwned: true,
        ownershipMarker: marker(index + 1),
      };
      (coordinator as unknown as { _claim: TabClaim; _operationRefs: number })._claim = claim;
      (coordinator as unknown as { _operationRefs: number })._operationRefs = 1;
      return coordinator;
    });

    const seeded = coordinators.map(coordinator => coordinator.activeClaim as TabClaim);
    await writeFile(ownershipFile, JSON.stringify({
      version: 1,
      entries: seeded.map((item, index) => ({
        marker: item.ownershipMarker,
        windowId: item.windowId,
        createdAt: Date.now() + index,
        agentId: item.agentId,
        service: item.service,
        pid: process.pid,
      })),
    }), { mode: 0o600 });
    await writeFile(claimsFile, JSON.stringify(seeded), { mode: 0o600 });
    await writeFile(
      observationFile,
      seeded.map(item => `2||${item.windowId}||${item.tabIndex}||${item.ownershipMarker}`).join('\n'),
      { mode: 0o600 },
    );
    await Promise.all(coordinators.map(coordinator => coordinator.heartbeat()));

    const persisted = JSON.parse(await readFile(claimsFile, 'utf8')) as TabClaim[];
    expect(persisted).toHaveLength(8);
    expect(new Set(persisted.map(claim => claim.agentId)).size).toBe(8);
    expect((await stat(claimsFile)).mode & 0o777).toBe(0o600);
    expect((await stat(lockFile)).mode & 0o777).toBe(0o600);
  });

  it('never resurrects a lease removed while its heartbeat waits behind the drain lock', async () => {
    const coordinator = new TabCoordinator('race-agent', 'race-service', 3299, 'example.com');
    const now = Date.now();
    const claim: TabClaim = {
      agentId: 'race-agent',
      service: 'race-service',
      port: 3299,
      urlPattern: 'example.com',
      windowIndex: 2,
      windowId: 9100,
      tabIndex: 1,
      tabUrl: 'https://example.com/race',
      pid: process.pid,
      claimedAt: now,
      heartbeat: now,
      agentOwned: true,
      ownershipMarker: marker(100),
    };
    (coordinator as unknown as { _claim: TabClaim; _operationRefs: number })._claim = claim;
    (coordinator as unknown as { _operationRefs: number })._operationRefs = 1;
    await writeFile(ownershipFile, JSON.stringify({
      version: 1,
      entries: [{
        marker: claim.ownershipMarker,
        windowId: claim.windowId,
        createdAt: now,
        agentId: claim.agentId,
        service: claim.service,
        pid: process.pid,
      }],
    }), { mode: 0o600 });
    await writeFile(claimsFile, JSON.stringify([claim]), { mode: 0o600 });
    await writeFile(
      observationFile,
      `2||${claim.windowId}||${claim.tabIndex}||${claim.ownershipMarker}`,
      { mode: 0o600 },
    );

    const drainGuard = spawn('/usr/bin/python3', ['-c', `
import fcntl, json, os, sys
lock_fd = os.open(sys.argv[1], os.O_RDWR | os.O_CREAT, 0o600)
fcntl.flock(lock_fd, fcntl.LOCK_EX)
with open(sys.argv[2], "w", encoding="utf-8") as claims:
    json.dump([], claims)
print("DRAINED", flush=True)
sys.stdin.buffer.read()
`, lockFile, claimsFile], { stdio: ['pipe', 'pipe', 'pipe'] });
    drainGuard.stdout.setEncoding('utf8');
    await new Promise<void>((resolve, reject) => {
      drainGuard.once('error', reject);
      drainGuard.stdout.on('data', chunk => {
        if (String(chunk).includes('DRAINED')) resolve();
      });
    });

    const heartbeatAssertion = expect(coordinator.heartbeat()).rejects.toThrow('heartbeat cannot recreate it');
    drainGuard.stdin.end();
    await once(drainGuard, 'exit');
    await heartbeatAssertion;
    expect(coordinator.activeClaim).toBeNull();
    expect(JSON.parse(await readFile(claimsFile, 'utf8'))).toEqual([]);
  });

  it('removes only stale service claims after a fresh locked read and preserves a racing live claim', async () => {
    const now = Date.now();
    const stale: TabClaim = {
      agentId: 'cleanup-stale',
      service: 'cleanup-service',
      port: 3301,
      urlPattern: 'example.com',
      windowIndex: 2,
      windowId: 9200,
      tabIndex: 1,
      tabUrl: 'https://example.com/stale',
      pid: 2_147_483_647,
      claimedAt: now - 180_000,
      heartbeat: now - 120_000,
      agentOwned: true,
      ownershipMarker: marker(201),
    };
    const liveSameService: TabClaim = {
      ...stale,
      agentId: 'cleanup-live',
      windowId: 9201,
      tabUrl: 'https://example.com/live',
      pid: process.pid,
      claimedAt: now - 1_000,
      heartbeat: now,
      ownershipMarker: marker(202),
    };
    const otherService: TabClaim = {
      ...liveSameService,
      agentId: 'other-live',
      service: 'other-service',
      windowId: 9202,
      tabUrl: 'https://example.com/other',
      ownershipMarker: marker(203),
    };
    const racingClaim: TabClaim = {
      ...otherService,
      agentId: 'racing-live',
      windowId: 9203,
      tabUrl: 'https://example.com/racing',
      heartbeat: Date.now(),
      ownershipMarker: marker(204),
    };
    await writeFile(
      claimsFile,
      JSON.stringify([stale, liveSameService, otherService]),
      { mode: 0o600 },
    );

    const raceGuard = spawn('/usr/bin/python3', ['-c', `
import fcntl, json, os, sys
lock_fd = os.open(sys.argv[1], os.O_RDWR | os.O_CREAT, 0o600)
fcntl.flock(lock_fd, fcntl.LOCK_EX)
print("LOCKED", flush=True)
sys.stdin.buffer.read()
with open(sys.argv[2], "r", encoding="utf-8") as source:
    claims = json.load(source)
claims.append(json.loads(sys.argv[3]))
temporary = sys.argv[2] + ".race.tmp"
with open(temporary, "x", encoding="utf-8") as destination:
    json.dump(claims, destination)
    destination.flush()
    os.fsync(destination.fileno())
os.chmod(temporary, 0o600)
os.replace(temporary, sys.argv[2])
`, lockFile, claimsFile, JSON.stringify(racingClaim)], { stdio: ['pipe', 'pipe', 'pipe'] });
    raceGuard.stdout.setEncoding('utf8');
    await new Promise<void>((resolve, reject) => {
      raceGuard.once('error', reject);
      raceGuard.stdout.on('data', chunk => {
        if (String(chunk).includes('LOCKED')) resolve();
      });
    });

    const cleanup = TabCoordinator.removeStaleClaimsForService('cleanup-service');
    await new Promise(resolve => setTimeout(resolve, 50));
    raceGuard.stdin.end();
    await once(raceGuard, 'exit');
    expect(await cleanup).toBe(1);

    const persisted = JSON.parse(await readFile(claimsFile, 'utf8')) as TabClaim[];
    expect(persisted.map(claim => claim.agentId).sort()).toEqual([
      'cleanup-live',
      'other-live',
      'racing-live',
    ]);
    expect((await stat(claimsFile)).mode & 0o777).toBe(0o600);
  });

  it('fails closed on ambiguous cleanup state instead of rewriting it', async () => {
    const corrupt = JSON.stringify([{ service: 'cleanup-service', heartbeat: 'not-a-number' }]);
    await writeFile(claimsFile, corrupt, { mode: 0o600 });
    await expect(
      TabCoordinator.removeStaleClaimsForService('cleanup-service'),
    ).rejects.toThrow('fails closed');
    expect(await readFile(claimsFile, 'utf8')).toBe(corrupt);
  });

  it('quiesces heartbeat admission during drain but releases the real in-flight lease', async () => {
    const coordinator = new TabCoordinator('drain-agent', 'drain-service', 3399, 'example.com');
    const now = Date.now();
    const claim: TabClaim = {
      agentId: 'drain-agent',
      service: 'drain-service',
      port: 3399,
      urlPattern: 'example.com',
      windowIndex: 2,
      windowId: 9300,
      tabIndex: 1,
      tabUrl: 'https://example.com/drain',
      pid: process.pid,
      claimedAt: now,
      heartbeat: now,
      agentOwned: true,
      ownershipMarker: marker(300),
    };
    (coordinator as unknown as { _claim: TabClaim; _operationRefs: number })._claim = claim;
    (coordinator as unknown as { _operationRefs: number })._operationRefs = 1;
    await writeFile(claimsFile, JSON.stringify([claim]), { mode: 0o600 });
    await writeFile(ownershipFile, JSON.stringify({
      version: 1,
      entries: [{
        marker: claim.ownershipMarker,
        windowId: claim.windowId,
        createdAt: now,
        agentId: claim.agentId,
        service: claim.service,
        pid: process.pid,
      }],
    }), { mode: 0o600 });
    await writeFile(drainFile, JSON.stringify({
      version: 1,
      updated_at: new Date().toISOString(),
      draining: { chrome: false, safari: true },
      retry_after_seconds: { chrome: 0, safari: 5 },
    }), { mode: 0o600 });

    await expect(coordinator.heartbeat()).rejects.toMatchObject({
      code: 'safari_draining',
      mode: 'background',
    });
    expect(coordinator.activeClaim).toEqual(claim);
    expect(JSON.parse(await readFile(claimsFile, 'utf8'))).toHaveLength(1);

    await coordinator.endOperation();
    expect(coordinator.activeClaim).toBeNull();
    expect(JSON.parse(await readFile(claimsFile, 'utf8'))).toEqual([]);
  });

  it('keeps service startup cleanup on the shared atomic primitive', async () => {
    const serverFiles = [
      'packages/tiktok-comments/src/api/server.ts',
      'packages/upwork-automation/src/api/server.ts',
      'packages/threads-comments/src/api/server.ts',
      'packages/twitter-comments/src/api/server.ts',
      'packages/instagram-comments/src/api/server.ts',
    ];
    for (const relative of serverFiles) {
      const source = await readFile(join(process.cwd(), relative), 'utf8');
      expect(source).toContain('TabCoordinator.removeStaleClaimsForService(SERVICE_NAME)');
      expect(source).not.toMatch(/writeFile\s*\(\s*['"]\/tmp\/safari-tab-claims\.json/);
      expect(source).not.toContain('TabCoordinator.listClaims().then');
    }
  });

  it('has no reachable literal claim-registry writer or legacy Instagram sweep spawn', async () => {
    const scan = spawnSync('rg', [
      '-n',
      '-U',
      String.raw`(?:writeFile|writeFileSync)[^\n]{0,240}\/tmp\/safari-tab-claims\.json`,
      'packages',
      'apps',
      'scripts',
      'ops',
      '--glob',
      '!browser-enforcer.py',
      '--glob',
      '!safari-control-broker.py',
    ], { cwd: process.cwd(), encoding: 'utf8' });
    expect([0, 1]).toContain(scan.status);
    expect(scan.stdout.trim()).toBe('');

    const instagramMcp = await readFile(
      join(process.cwd(), 'packages/instagram-dm/src/api/mcp-server.ts'),
      'utf8',
    );
    const queueTool = instagramMcp.slice(
      instagramMcp.indexOf("case 'instagram_send_from_queue'"),
      instagramMcp.indexOf("case 'instagram_daily_report'"),
    );
    expect(queueTool).toContain("api(DM_BASE, 'POST', '/api/prospect/send-queued'");
    expect(queueTool).not.toContain('instagram-dm-sweep.js');
    expect(queueTool).not.toContain("import('child_process')");
    expect(queueTool).not.toContain('/usr/local/bin/node');

    const tiktokMcp = await readFile(
      join(process.cwd(), 'packages/tiktok-dm/src/api/mcp-server.ts'),
      'utf8',
    );
    const tiktokQueueTool = tiktokMcp.slice(
      tiktokMcp.indexOf("case 'tiktok_send_from_queue'"),
      tiktokMcp.indexOf("case 'tiktok_daily_report'"),
    );
    expect(tiktokQueueTool).toContain('LEGACY_SWEEP_RETIRED');
    expect(tiktokQueueTool).not.toContain('tiktok-dm-sweep.js');
    expect(tiktokQueueTool).not.toContain("import('child_process')");
    expect(tiktokQueueTool).not.toContain('/usr/local/bin/node');
  });
});
