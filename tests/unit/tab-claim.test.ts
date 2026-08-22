import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── Mock fs/promises before importing the module under test ──────────────────
vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  rename: vi.fn(),
}));

// Mock child_process so no real AppleScript runs
vi.mock('child_process', () => ({
  exec: vi.fn(),
}));

import * as fs from 'fs/promises';
import {
  TabCoordinator,
  CLAIMS_FILE,
  CLAIM_TTL_MS,
  getAutomationWindow,
  type TabClaim,
} from '../../packages/linkedin-automation/src/automation/tab-coordinator.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeClaim(overrides: Partial<TabClaim> = {}): TabClaim {
  const now = Date.now();
  return {
    agentId: 'test-agent-001',
    service: 'instagram-dm',
    port: 3100,
    urlPattern: 'instagram.com/direct',
    windowIndex: 1,
    tabIndex: 1,
    tabUrl: 'https://www.instagram.com/direct/',
    pid: process.pid,
    claimedAt: now,
    heartbeat: now,
    agentOwned: true,
    ...overrides,
  };
}

function mockReadFile(content: string | Error): void {
  if (content instanceof Error) {
    vi.mocked(fs.readFile).mockRejectedValueOnce(content);
  } else {
    vi.mocked(fs.readFile).mockResolvedValueOnce(content as any);
  }
}

function mockWriteOk(): void {
  vi.mocked(fs.writeFile).mockResolvedValue(undefined as any);
  vi.mocked(fs.rename).mockResolvedValue(undefined as any);
}

// ── Constants ─────────────────────────────────────────────────────────────────

describe('Constants', () => {
  it('CLAIMS_FILE is /tmp/safari-tab-claims.json', () => {
    expect(CLAIMS_FILE).toBe('/tmp/safari-tab-claims.json');
  });

  it('CLAIM_TTL_MS is 60000 (60 seconds)', () => {
    expect(CLAIM_TTL_MS).toBe(60_000);
  });
});

// ── getAutomationWindow() ─────────────────────────────────────────────────────

describe('getAutomationWindow()', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('defaults to 1 when SAFARI_AUTOMATION_WINDOW is not set', () => {
    vi.stubEnv('SAFARI_AUTOMATION_WINDOW', '');
    // parseInt('', 10) is NaN — the function falls back via the || '1' branch
    // Actual default: when env var is unset the || '1' branch yields 1
    delete process.env.SAFARI_AUTOMATION_WINDOW;
    expect(getAutomationWindow()).toBe(1);
  });

  it('returns 2 when SAFARI_AUTOMATION_WINDOW is "2"', () => {
    vi.stubEnv('SAFARI_AUTOMATION_WINDOW', '2');
    expect(getAutomationWindow()).toBe(2);
  });

  it('returns parseInt of the env var', () => {
    vi.stubEnv('SAFARI_AUTOMATION_WINDOW', '3');
    expect(getAutomationWindow()).toBe(3);
  });
});

// ── TabCoordinator.listClaims() ───────────────────────────────────────────────

describe('TabCoordinator.listClaims()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty array when file does not exist', async () => {
    mockReadFile(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    const claims = await TabCoordinator.listClaims();
    expect(claims).toEqual([]);
  });

  it('returns empty array when file contains corrupted JSON', async () => {
    mockReadFile('{ this is not valid json !!!');
    const claims = await TabCoordinator.listClaims();
    expect(claims).toEqual([]);
  });

  it('returns empty array when file is empty string', async () => {
    mockReadFile('');
    const claims = await TabCoordinator.listClaims();
    expect(claims).toEqual([]);
  });

  it('filters out claims whose heartbeat is older than CLAIM_TTL_MS', async () => {
    const expiredClaim = makeClaim({
      agentId: 'expired-agent',
      heartbeat: Date.now() - CLAIM_TTL_MS - 1000, // 61 s ago
    });
    mockReadFile(JSON.stringify([expiredClaim]));
    const claims = await TabCoordinator.listClaims();
    expect(claims).toHaveLength(0);
  });

  it('returns claims whose heartbeat is within CLAIM_TTL_MS', async () => {
    const validClaim = makeClaim({
      agentId: 'fresh-agent',
      heartbeat: Date.now() - 30_000, // 30 s ago — still alive
    });
    mockReadFile(JSON.stringify([validClaim]));
    const claims = await TabCoordinator.listClaims();
    expect(claims).toHaveLength(1);
    expect(claims[0].agentId).toBe('fresh-agent');
  });

  it('returns only valid claims when mix of expired and fresh exist', async () => {
    const fresh = makeClaim({ agentId: 'fresh', heartbeat: Date.now() - 10_000 });
    const expired = makeClaim({ agentId: 'dead', heartbeat: Date.now() - 120_000 });
    mockReadFile(JSON.stringify([fresh, expired]));
    const claims = await TabCoordinator.listClaims();
    expect(claims).toHaveLength(1);
    expect(claims[0].agentId).toBe('fresh');
  });

  it('returns claim whose heartbeat is exactly 0 ms ago (fresh)', async () => {
    const now = Date.now();
    const freshClaim = makeClaim({ heartbeat: now });
    // Stub Date.now to return exactly `now` so delta = 0 < 60000
    const spy = vi.spyOn(Date, 'now').mockReturnValue(now);
    mockReadFile(JSON.stringify([freshClaim]));
    const claims = await TabCoordinator.listClaims();
    expect(claims).toHaveLength(1);
    spy.mockRestore();
  });
});

// ── Window enforcement (claim() with explicit window/tab) ─────────────────────

describe('TabCoordinator.claim() — window enforcement', () => {
  beforeEach(() => {
    // resetAllMocks (not clearAllMocks) to flush unconsumed mockResolvedValueOnce queues
    // between tests — prevents queue bleed when earlier tests throw before consuming mocks.
    vi.resetAllMocks();
    mockWriteOk();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('throws when claiming window 1 tab while SAFARI_AUTOMATION_WINDOW=2', async () => {
    vi.stubEnv('SAFARI_AUTOMATION_WINDOW', '2');
    // Empty registry so no conflict from other agents
    mockReadFile(JSON.stringify([]));

    const coord = new TabCoordinator('agent-x', 'instagram-dm', 3100, 'instagram.com');
    await expect(coord.claim(1, 1)).rejects.toThrow(
      /Refusing to claim tab 1:1.*not in automation window/
    );
  });

  it('succeeds when claiming window 2 tab while SAFARI_AUTOMATION_WINDOW=2', async () => {
    vi.stubEnv('SAFARI_AUTOMATION_WINDOW', '2');
    // Empty registry — no conflict
    mockReadFile(JSON.stringify([])); // getConflict → listClaims read
    mockReadFile(JSON.stringify([])); // _writeClaim → listClaims read (second call)

    const coord = new TabCoordinator('agent-y', 'instagram-dm', 3100, 'instagram.com');
    const claim = await coord.claim(2, 1);
    expect(claim.windowIndex).toBe(2);
    expect(claim.tabIndex).toBe(1);
    expect(claim.agentId).toBe('agent-y');
  });

  it('throws when window 1 tab 1 is already claimed by another agent', async () => {
    vi.stubEnv('SAFARI_AUTOMATION_WINDOW', '1');
    const existingClaim = makeClaim({
      agentId: 'blocker-agent',
      windowIndex: 1,
      tabIndex: 1,
      heartbeat: Date.now(),
    });
    // Both getConflict→listClaims and potentially _writeClaim read the file
    mockReadFile(JSON.stringify([existingClaim]));

    const coord = new TabCoordinator('newcomer', 'twitter-dm', 3003, 'twitter.com');
    await expect(coord.claim(1, 1)).rejects.toThrow(/already claimed by 'blocker-agent'/);
  });
});

// ── Stable coordinator pattern ────────────────────────────────────────────────
// Tests the claim dedup logic: same service should reuse an existing valid claim
// rather than creating a duplicate. We exercise this by calling _writeClaim
// indirectly via heartbeat() and checking that the claim list stays at 1 entry.

describe('Stable coordinator pattern', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv('SAFARI_AUTOMATION_WINDOW', '1');
    mockWriteOk();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('heartbeat() updates the existing claim rather than adding a duplicate', async () => {
    const agentId = 'stable-agent-001';
    const coord = new TabCoordinator(agentId, 'instagram-dm', 3100, 'instagram.com');

    // Seed a fresh existing claim for this agent (as if a prior claim() ran)
    const existingClaim = makeClaim({ agentId, heartbeat: Date.now() - 20_000 });

    // heartbeat() calls listClaims then _atomicWrite
    mockReadFile(JSON.stringify([existingClaim])); // listClaims in _writeClaim
    // Inject the claim directly into the coordinator's private state
    (coord as any)._claim = existingClaim;

    const capturedWrites: string[] = [];
    vi.mocked(fs.writeFile).mockImplementation(async (_path, data) => {
      capturedWrites.push(data as string);
    });
    vi.mocked(fs.rename).mockResolvedValue(undefined as any);

    await coord.heartbeat();

    expect(capturedWrites).toHaveLength(1);
    const written: TabClaim[] = JSON.parse(capturedWrites[0]);
    // Should still be exactly one claim, not two
    expect(written).toHaveLength(1);
    expect(written[0].agentId).toBe(agentId);
  });

  it('two different services each get their own separate claim (no collision)', async () => {
    // instagram-dm claims window 1 tab 1
    const igClaim = makeClaim({
      agentId: 'ig-agent-001',
      service: 'instagram-dm',
      port: 3100,
      windowIndex: 1,
      tabIndex: 1,
      heartbeat: Date.now() - 10_000,
    });

    // twitter-dm claims window 1 tab 2 — reads registry containing ig claim
    const twCoord = new TabCoordinator('tw-agent-001', 'twitter-dm', 3003, 'twitter.com');

    // getConflict read for window 1 tab 2 → ig claim is on tab 1, no conflict
    mockReadFile(JSON.stringify([igClaim]));
    // _writeClaim read → same registry
    mockReadFile(JSON.stringify([igClaim]));

    const capturedWrites: string[] = [];
    vi.mocked(fs.writeFile).mockImplementation(async (_path, data) => {
      capturedWrites.push(data as string);
    });
    vi.mocked(fs.rename).mockResolvedValue(undefined as any);

    const twClaim = await twCoord.claim(1, 2);

    expect(twClaim.windowIndex).toBe(1);
    expect(twClaim.tabIndex).toBe(2);
    expect(twClaim.service).toBe('twitter-dm');

    // Final registry should have two claims, one per service
    const written: TabClaim[] = JSON.parse(capturedWrites[0]);
    expect(written).toHaveLength(2);
    const services = written.map(c => c.service).sort();
    expect(services).toEqual(['instagram-dm', 'twitter-dm']);
  });

  it('release() removes the released claim from the registry', async () => {
    const agentId = 'to-release-agent';
    const coord = new TabCoordinator(agentId, 'instagram-dm', 3100, 'instagram.com');
    const claim = makeClaim({ agentId, heartbeat: Date.now() });
    (coord as any)._claim = claim;

    const otherClaim = makeClaim({ agentId: 'other-agent', tabIndex: 2, heartbeat: Date.now() });

    // release() → listClaims read (filters expired) → _atomicWrite
    mockReadFile(JSON.stringify([claim, otherClaim]));

    const capturedWrites: string[] = [];
    vi.mocked(fs.writeFile).mockImplementation(async (_path, data) => {
      capturedWrites.push(data as string);
    });
    vi.mocked(fs.rename).mockResolvedValue(undefined as any);

    await coord.release();

    expect(coord.activeClaim).toBeNull();
    const written: TabClaim[] = JSON.parse(capturedWrites[0]);
    expect(written).toHaveLength(1);
    expect(written[0].agentId).toBe('other-agent');
  });

  it('re-claiming after TTL produces a fresh claim (different claimedAt)', async () => {
    const agentId = 'respawn-agent';
    const coord = new TabCoordinator(agentId, 'instagram-dm', 3100, 'instagram.com');

    // Simulate a first claim that has now expired (> 60s old heartbeat)
    const expiredClaim = makeClaim({
      agentId,
      heartbeat: Date.now() - 90_000, // 90 s ago — definitely expired
      claimedAt: Date.now() - 120_000,
    });

    // When we call claim(1, 1) again:
    // getConflict → listClaims → expired claim is filtered out → no conflict
    mockReadFile(JSON.stringify([expiredClaim])); // getConflict read
    // _writeClaim → listClaims → empty (expired claim gone)
    mockReadFile(JSON.stringify([expiredClaim])); // _writeClaim read

    const capturedWrites: string[] = [];
    vi.mocked(fs.writeFile).mockImplementation(async (_path, data) => {
      capturedWrites.push(data as string);
    });
    vi.mocked(fs.rename).mockResolvedValue(undefined as any);

    const newClaim = await coord.claim(1, 1);

    // The new claim should have a recent claimedAt (within last 5s)
    expect(newClaim.claimedAt).toBeGreaterThan(Date.now() - 5000);
    expect(newClaim.agentId).toBe(agentId);
  });
});

// ── Heartbeat keeps claim alive ───────────────────────────────────────────────

describe('Heartbeat keeps claim alive', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWriteOk();
  });

  it('heartbeat() updates the heartbeat timestamp', async () => {
    const agentId = 'heartbeat-test-agent';
    const coord = new TabCoordinator(agentId, 'instagram-dm', 3100, 'instagram.com');
    const oldHeartbeat = Date.now() - 30_000;
    const claim = makeClaim({ agentId, heartbeat: oldHeartbeat });
    (coord as any)._claim = claim;

    // _writeClaim → listClaims read
    mockReadFile(JSON.stringify([claim]));

    const capturedWrites: string[] = [];
    vi.mocked(fs.writeFile).mockImplementation(async (_path, data) => {
      capturedWrites.push(data as string);
    });
    vi.mocked(fs.rename).mockResolvedValue(undefined as any);

    const before = Date.now();
    await coord.heartbeat();
    const after = Date.now();

    const written: TabClaim[] = JSON.parse(capturedWrites[0]);
    expect(written[0].heartbeat).toBeGreaterThanOrEqual(before);
    expect(written[0].heartbeat).toBeLessThanOrEqual(after);
    expect(written[0].heartbeat).toBeGreaterThan(oldHeartbeat);
  });

  it('heartbeat() is a no-op when no claim is active', async () => {
    const coord = new TabCoordinator('no-claim-agent', 'instagram-dm', 3100, 'instagram.com');
    // No _claim set — activeClaim is null
    await coord.heartbeat(); // should not throw
    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it('a claim with a fresh heartbeat passes through listClaims() TTL filter', async () => {
    const freshClaim = makeClaim({ heartbeat: Date.now() - 5_000 }); // 5 s ago
    mockReadFile(JSON.stringify([freshClaim]));
    const claims = await TabCoordinator.listClaims();
    expect(claims).toHaveLength(1);
  });

  it('a claim whose heartbeat is exactly at TTL boundary is excluded', async () => {
    const now = Date.now();
    // heartbeat exactly CLAIM_TTL_MS ms ago → (now - heartbeat) === CLAIM_TTL_MS
    // The filter condition is (now - heartbeat) < CLAIM_TTL_MS → false → excluded
    const boundaryHeartbeat = now - CLAIM_TTL_MS;
    const spy = vi.spyOn(Date, 'now').mockReturnValue(now);

    const boundaryClaim = makeClaim({ heartbeat: boundaryHeartbeat });
    mockReadFile(JSON.stringify([boundaryClaim]));

    const claims = await TabCoordinator.listClaims();
    expect(claims).toHaveLength(0);
    spy.mockRestore();
  });
});

// ── getConflict() ─────────────────────────────────────────────────────────────

describe('TabCoordinator.getConflict()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when no claims exist', async () => {
    mockReadFile(JSON.stringify([]));
    const conflict = await TabCoordinator.getConflict(1, 1, 'my-agent');
    expect(conflict).toBeNull();
  });

  it('returns null when the only claim belongs to the excluded agent itself', async () => {
    const ownClaim = makeClaim({ agentId: 'my-agent', windowIndex: 1, tabIndex: 1 });
    mockReadFile(JSON.stringify([ownClaim]));
    const conflict = await TabCoordinator.getConflict(1, 1, 'my-agent');
    expect(conflict).toBeNull();
  });

  it('returns the conflicting claim when another agent has the same window+tab', async () => {
    const blocker = makeClaim({ agentId: 'blocker', windowIndex: 1, tabIndex: 1 });
    mockReadFile(JSON.stringify([blocker]));
    const conflict = await TabCoordinator.getConflict(1, 1, 'my-agent');
    expect(conflict).not.toBeNull();
    expect(conflict!.agentId).toBe('blocker');
  });

  it('returns null when another agent claims a different tab in the same window', async () => {
    const otherTab = makeClaim({ agentId: 'other-agent', windowIndex: 1, tabIndex: 2 });
    mockReadFile(JSON.stringify([otherTab]));
    const conflict = await TabCoordinator.getConflict(1, 1, 'my-agent');
    expect(conflict).toBeNull();
  });
});
