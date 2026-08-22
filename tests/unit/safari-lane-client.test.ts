import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SafariLanePermitError,
  evaluateSafariLanePermit,
  getSafariLanePermit,
  requireSafariLanePermit,
  type HumanPresenceState,
} from '../../packages/shared/safari-lane-client.js';

const FIXED_NOW_MS = Date.UTC(2026, 7, 22, 16, 0, 0);

function presence(
  overrides: Partial<HumanPresenceState> = {},
  nowMs = FIXED_NOW_MS,
): HumanPresenceState {
  return {
    version: 1,
    updated_at: new Date(nowMs).toISOString(),
    observed_at: nowMs / 1000,
    source_available: true,
    frontmost_app: 'Finder',
    idle_seconds: 120,
    browser_foreground: { chrome: false, safari: false },
    human_recent: false,
    active: { chrome: false, safari: false },
    manual_hold_until: { chrome: 0, safari: 0 },
    restart_allowed: { chrome: true, safari: true },
    retry_after_seconds: { chrome: 0, safari: 0 },
    ...overrides,
  };
}

describe('Safari human-presence lane permits', () => {
  it('allows an interactive permit only from fresh, available, idle state', () => {
    const permit = evaluateSafariLanePermit(presence(), 'interactive', FIXED_NOW_MS);
    expect(permit.allowed).toBe(true);
    expect(permit.code).toBe('allowed');
  });

  it('allows background work while a human owns Safari', () => {
    const state = presence({
      frontmost_app: 'Safari',
      browser_foreground: { chrome: false, safari: true },
      human_recent: true,
      active: { chrome: false, safari: true },
      retry_after_seconds: { chrome: 0, safari: 12 },
    });
    expect(evaluateSafariLanePermit(state, 'background', FIXED_NOW_MS).allowed).toBe(true);
  });

  it('denies interactive work while a human owns Safari', () => {
    const state = presence({
      frontmost_app: 'Safari',
      browser_foreground: { chrome: false, safari: true },
      human_recent: true,
      active: { chrome: false, safari: true },
      retry_after_seconds: { chrome: 0, safari: 12 },
    });
    const permit = evaluateSafariLanePermit(state, 'interactive', FIXED_NOW_MS);
    expect(permit.allowed).toBe(false);
    expect(permit.code).toBe('human_active');
    expect(permit.retryAfterSeconds).toBe(12);
  });

  it('treats a manual Safari hold as human-active for both lane modes', () => {
    const holdUntil = FIXED_NOW_MS / 1000 + 20;
    for (const mode of ['background', 'interactive'] as const) {
      const permit = evaluateSafariLanePermit(
        presence({ manual_hold_until: { chrome: 0, safari: holdUntil } }),
        mode,
        FIXED_NOW_MS,
      );
      expect(permit.code).toBe('human_active');
      expect(permit.retryAfterSeconds).toBe(20);
    }
  });

  it('does not steal focus when recent input occurred in another app', () => {
    const permit = evaluateSafariLanePermit(
      presence({
        frontmost_app: 'Code',
        idle_seconds: 2,
        human_recent: true,
        active: { chrome: false, safari: false },
      }),
      'interactive',
      FIXED_NOW_MS,
    );
    expect(permit.code).toBe('human_active');
  });

  it('fails closed for stale, malformed, or unavailable state', () => {
    const stale = presence({
      updated_at: new Date(FIXED_NOW_MS - 15_001).toISOString(),
      observed_at: (FIXED_NOW_MS - 15_001) / 1000,
    });
    expect(evaluateSafariLanePermit(stale, 'background', FIXED_NOW_MS).code).toBe('presence_stale');
    expect(evaluateSafariLanePermit({ version: 1 }, 'interactive', FIXED_NOW_MS).code).toBe('presence_invalid');
    expect(evaluateSafariLanePermit(
      presence({ source_available: false }),
      'background',
      FIXED_NOW_MS,
    ).code).toBe('presence_unavailable');
  });
});

describe('Safari lane state-file integration', () => {
  let directory = '';
  let stateFile = '';
  let drainFile = '';
  let originalNodeEnv: string | undefined;
  let originalOverride: string | undefined;
  let originalDrainOverride: string | undefined;
  let originalControlUrl: string | undefined;
  let originalTokenFile: string | undefined;
  let tokenFile = '';
  let claimsFile = '';
  let ownershipFile = '';
  let observationFile = '';
  let originalClaimsFile: string | undefined;
  let originalOwnershipFile: string | undefined;
  let originalObservationFile: string | undefined;
  const liveIdlePresence = {
    ok: true,
    signals_available: true,
    interactive_automation_allowed: true,
    recent_input: false,
    frontmost_browser: null,
    input_idle_seconds: 120,
    thresholds: { human_recent_input_seconds: 60 },
  };
  const setLivePresence = (value: unknown): void => {
    process.env.SAFARI_CONTROL_PRESENCE_URL =
      `data:application/json,${encodeURIComponent(JSON.stringify(value))}`;
  };

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'safari-lane-client-test-'));
    stateFile = join(directory, 'human-presence.json');
    drainFile = join(directory, 'drain-state.json');
    tokenFile = join(directory, 'safari-presence.token');
    claimsFile = join(directory, 'claims.json');
    ownershipFile = join(directory, 'ownership.json');
    observationFile = join(directory, 'ownership-observation.txt');
    originalNodeEnv = process.env.NODE_ENV;
    originalOverride = process.env.SAFARI_HUMAN_PRESENCE_STATE_FILE;
    originalDrainOverride = process.env.SAFARI_BROWSER_DRAIN_STATE_FILE;
    originalControlUrl = process.env.SAFARI_CONTROL_PRESENCE_URL;
    originalTokenFile = process.env.SAFARI_PRESENCE_TOKEN_FILE;
    originalClaimsFile = process.env.SAFARI_TAB_CLAIMS_FILE;
    originalOwnershipFile = process.env.SAFARI_TAB_OWNERSHIP_FILE;
    originalObservationFile = process.env.SAFARI_OWNERSHIP_OBSERVATION_FILE;
    process.env.NODE_ENV = 'test';
    process.env.SAFARI_HUMAN_PRESENCE_STATE_FILE = stateFile;
    process.env.SAFARI_BROWSER_DRAIN_STATE_FILE = drainFile;
    process.env.SAFARI_PRESENCE_TOKEN_FILE = tokenFile;
    process.env.SAFARI_TAB_CLAIMS_FILE = claimsFile;
    process.env.SAFARI_TAB_OWNERSHIP_FILE = ownershipFile;
    process.env.SAFARI_OWNERSHIP_OBSERVATION_FILE = observationFile;
    await writeFile(tokenFile, 'test-safari-presence-token-at-least-32-characters', { mode: 0o600 });
    await writeFile(claimsFile, '[]', { mode: 0o600 });
    await writeFile(ownershipFile, JSON.stringify({ version: 1, entries: [] }), { mode: 0o600 });
    await writeFile(observationFile, '', { mode: 0o600 });
    setLivePresence(liveIdlePresence);
  });

  beforeEach(async () => {
    setLivePresence(liveIdlePresence);
    await writeFile(claimsFile, '[]', { mode: 0o600 });
    await writeFile(ownershipFile, JSON.stringify({ version: 1, entries: [] }), { mode: 0o600 });
    await writeFile(observationFile, '', { mode: 0o600 });
  });

  afterAll(async () => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalOverride === undefined) delete process.env.SAFARI_HUMAN_PRESENCE_STATE_FILE;
    else process.env.SAFARI_HUMAN_PRESENCE_STATE_FILE = originalOverride;
    if (originalDrainOverride === undefined) delete process.env.SAFARI_BROWSER_DRAIN_STATE_FILE;
    else process.env.SAFARI_BROWSER_DRAIN_STATE_FILE = originalDrainOverride;
    if (originalControlUrl === undefined) delete process.env.SAFARI_CONTROL_PRESENCE_URL;
    else process.env.SAFARI_CONTROL_PRESENCE_URL = originalControlUrl;
    if (originalTokenFile === undefined) delete process.env.SAFARI_PRESENCE_TOKEN_FILE;
    else process.env.SAFARI_PRESENCE_TOKEN_FILE = originalTokenFile;
    if (originalClaimsFile === undefined) delete process.env.SAFARI_TAB_CLAIMS_FILE;
    else process.env.SAFARI_TAB_CLAIMS_FILE = originalClaimsFile;
    if (originalOwnershipFile === undefined) delete process.env.SAFARI_TAB_OWNERSHIP_FILE;
    else process.env.SAFARI_TAB_OWNERSHIP_FILE = originalOwnershipFile;
    if (originalObservationFile === undefined) delete process.env.SAFARI_OWNERSHIP_OBSERVATION_FILE;
    else process.env.SAFARI_OWNERSHIP_OBSERVATION_FILE = originalObservationFile;
    await rm(directory, { recursive: true, force: true });
  });

  it('reads a fresh real state file', async () => {
    await writeFile(stateFile, JSON.stringify(presence({}, Date.now())));
    await writeFile(drainFile, JSON.stringify({
      version: 1,
      updated_at: new Date().toISOString(),
      draining: { chrome: false, safari: false },
      retry_after_seconds: { chrome: 0, safari: 0 },
    }));
    const permit = await getSafariLanePermit('interactive');
    expect(permit.allowed).toBe(true);
  });

  it('fails closed when the drain gate is missing', async () => {
    process.env.SAFARI_BROWSER_DRAIN_STATE_FILE = join(directory, 'missing-drain.json');
    await writeFile(stateFile, JSON.stringify(presence({}, Date.now())));
    const permit = await getSafariLanePermit('interactive');
    expect(permit.code).toBe('drain_missing');
    process.env.SAFARI_BROWSER_DRAIN_STATE_FILE = drainFile;
  });

  it('blocks interactive work while Safari is draining', async () => {
    await writeFile(stateFile, JSON.stringify(presence({}, Date.now())));
    await writeFile(drainFile, JSON.stringify({
      version: 1,
      updated_at: new Date().toISOString(),
      draining: { chrome: false, safari: true },
      retry_after_seconds: { chrome: 0, safari: 18 },
    }));
    const permit = await getSafariLanePermit('interactive');
    expect(permit.code).toBe('safari_draining');
    expect(permit.retryAfterSeconds).toBe(18);
  });

  it('blocks background work while Safari is draining', async () => {
    await writeFile(stateFile, JSON.stringify(presence({}, Date.now())));
    await writeFile(drainFile, JSON.stringify({
      version: 1,
      updated_at: new Date().toISOString(),
      draining: { chrome: false, safari: true },
      retry_after_seconds: { chrome: 0, safari: 9 },
    }));
    const permit = await getSafariLanePermit('background');
    expect(permit.allowed).toBe(false);
    expect(permit.code).toBe('safari_draining');
    expect(permit.retryAfterSeconds).toBe(9);
  });

  it('denies when the cached file is idle but the just-in-time HID probe sees new input', async () => {
    await writeFile(stateFile, JSON.stringify(presence({}, Date.now())));
    await writeFile(drainFile, JSON.stringify({
      version: 1,
      updated_at: new Date().toISOString(),
      draining: { chrome: false, safari: false },
      retry_after_seconds: { chrome: 0, safari: 0 },
    }));
    setLivePresence({
      ...liveIdlePresence,
      interactive_automation_allowed: false,
      recent_input: true,
      input_idle_seconds: 0.2,
    });
    const permit = await getSafariLanePermit('interactive');
    expect(permit.code).toBe('live_human_active');
    expect(permit.allowed).toBe(false);
  });

  it('denies a missing state file', async () => {
    process.env.SAFARI_HUMAN_PRESENCE_STATE_FILE = join(directory, 'missing.json');
    const permit = await getSafariLanePermit('background');
    expect(permit.allowed).toBe(false);
    expect(permit.code).toBe('presence_missing');
    process.env.SAFARI_HUMAN_PRESENCE_STATE_FILE = stateFile;
  });

  it('throws a typed error when interactive access is denied', async () => {
    await writeFile(stateFile, JSON.stringify(presence({
      updated_at: new Date().toISOString(),
      observed_at: Date.now() / 1000,
      active: { chrome: false, safari: true },
      retry_after_seconds: { chrome: 0, safari: 7 },
    })));
    await expect(requireSafariLanePermit('interactive')).rejects.toMatchObject({
      name: 'SafariLanePermitError',
      code: 'human_active',
      retryAfterSeconds: 7,
    } satisfies Partial<SafariLanePermitError>);
  });

  it('requires each live process claim to retain one exact ledger-bound Window 2 marker', async () => {
    const now = Date.now();
    const marker = '__ACTP_SAFARI_AGENT_TAB__:00000000-0000-4000-8000-000000000777';
    await writeFile(stateFile, JSON.stringify(presence({}, now)));
    await writeFile(drainFile, JSON.stringify({
      version: 1,
      updated_at: new Date(now).toISOString(),
      draining: { chrome: false, safari: false },
      retry_after_seconds: { chrome: 0, safari: 0 },
    }));
    await writeFile(claimsFile, JSON.stringify([{
      pid: process.pid,
      windowId: 777,
      windowIndex: 2,
      tabIndex: 3,
      ownershipMarker: marker,
      heartbeat: now,
    }]));
    await writeFile(ownershipFile, JSON.stringify({
      version: 1,
      entries: [{ marker, windowId: 777 }],
    }));
    await writeFile(observationFile, `2||777||3||${marker}`);

    await expect(requireSafariLanePermit('background')).resolves.toMatchObject({ version: 1 });

    await writeFile(observationFile, `2||777||2||${marker}`);
    await expect(requireSafariLanePermit('background')).rejects.toMatchObject({
      code: 'claim_binding_invalid',
      mode: 'background',
    });

    await writeFile(observationFile, `2||777||3||${marker}\n2||777||4||${marker}`);
    await expect(requireSafariLanePermit('background')).rejects.toMatchObject({
      code: 'claim_binding_invalid',
    });
  });
});
