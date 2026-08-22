/**
 * Shared Safari lane permit client.
 *
 * The browser enforcer publishes a short-lived, read-only human-presence
 * snapshot. Safari agents must consult it before allocating/claiming a tab or
 * performing an interaction that could change Safari's foreground state.
 * Missing, stale, unavailable, or malformed state is denied fail-closed.
 *
 * Background work against an already-owned tab may continue while a human is
 * active. Interactive work (including tab allocation and claims) may not.
 */

import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type SafariLanePermitMode = 'background' | 'interactive';

export const HUMAN_PRESENCE_STATE_FILE = join(
  homedir(),
  'Library',
  'Application Support',
  'ACTP',
  'browser-enforcer',
  'human-presence.json',
);
export const HUMAN_PRESENCE_MAX_AGE_MS = 15_000;
export const BROWSER_DRAIN_STATE_FILE = join(
  homedir(),
  'Library',
  'Application Support',
  'ACTP',
  'browser-enforcer',
  'drain-state.json',
);
export const BROWSER_DRAIN_MAX_AGE_MS = 15_000;
export const SAFARI_CONTROL_PRESENCE_URL = 'http://127.0.0.1:5591/presence';
export const SAFARI_PRESENCE_TOKEN_FILE = join(
  homedir(),
  'Library',
  'Application Support',
  'ACTP',
  'browser-enforcer',
  'safari-presence.token',
);
export const LIVE_PRESENCE_TIMEOUT_MS = 1_500;
export const SAFARI_TAB_CLAIMS_FILE = '/tmp/safari-tab-claims.json';
export const SAFARI_TAB_OWNERSHIP_FILE = '/tmp/safari-tab-ownership.json';
export const SAFARI_CLAIM_TTL_MS = 60_000;
export const SAFARI_AGENT_TAB_MARKER_PATTERN = /^__ACTP_SAFARI_AGENT_TAB__:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface BrowserBooleanState {
  chrome: boolean;
  safari: boolean;
}

export interface BrowserNumberState {
  chrome: number;
  safari: number;
}

export interface HumanPresenceState {
  version: 1;
  updated_at: string;
  observed_at: number;
  source_available: boolean;
  frontmost_app: string | null;
  idle_seconds: number | null;
  browser_foreground: BrowserBooleanState;
  human_recent: boolean;
  active: BrowserBooleanState;
  manual_hold_until: BrowserNumberState;
  restart_allowed: BrowserBooleanState;
  retry_after_seconds: BrowserNumberState;
}

export interface BrowserDrainState {
  version: 1;
  updated_at: string;
  draining: BrowserBooleanState;
  retry_after_seconds: BrowserNumberState;
}

export interface SafariLanePermit {
  allowed: boolean;
  mode: SafariLanePermitMode;
  code: 'allowed' | 'presence_missing' | 'presence_invalid' | 'presence_stale' |
    'presence_unavailable' | 'human_active' | 'drain_missing' | 'drain_invalid' |
    'drain_stale' | 'safari_draining' | 'live_presence_unavailable' |
    'live_human_active' | 'claim_binding_invalid';
  reason: string;
  retryAfterSeconds: number;
  presence: HumanPresenceState | null;
}

export class SafariLanePermitError extends Error {
  readonly code: SafariLanePermit['code'];
  readonly mode: SafariLanePermitMode;
  readonly retryAfterSeconds: number;

  constructor(permit: SafariLanePermit) {
    super(`Safari ${permit.mode} permit denied: ${permit.reason}`);
    this.name = 'SafariLanePermitError';
    this.code = permit.code;
    this.mode = permit.mode;
    this.retryAfterSeconds = permit.retryAfterSeconds;
  }
}

function browserBooleans(value: unknown): value is BrowserBooleanState {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return typeof item.chrome === 'boolean' && typeof item.safari === 'boolean';
}

function browserNumbers(value: unknown): value is BrowserNumberState {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return typeof item.chrome === 'number' && Number.isFinite(item.chrome) &&
    typeof item.safari === 'number' && Number.isFinite(item.safari);
}

function parsePresence(value: unknown): HumanPresenceState | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  if (
    item.version !== 1 ||
    typeof item.updated_at !== 'string' ||
    typeof item.observed_at !== 'number' || !Number.isFinite(item.observed_at) ||
    typeof item.source_available !== 'boolean' ||
    !(typeof item.frontmost_app === 'string' || item.frontmost_app === null) ||
    !(typeof item.idle_seconds === 'number' || item.idle_seconds === null) ||
    (typeof item.idle_seconds === 'number' && !Number.isFinite(item.idle_seconds)) ||
    !browserBooleans(item.browser_foreground) ||
    typeof item.human_recent !== 'boolean' ||
    !browserBooleans(item.active) ||
    !browserNumbers(item.manual_hold_until) ||
    !browserBooleans(item.restart_allowed) ||
    !browserNumbers(item.retry_after_seconds)
  ) {
    return null;
  }
  return item as unknown as HumanPresenceState;
}

function denied(
  mode: SafariLanePermitMode,
  code: SafariLanePermit['code'],
  reason: string,
  retryAfterSeconds = 1,
  presence: HumanPresenceState | null = null,
): SafariLanePermit {
  return {
    allowed: false,
    mode,
    code,
    reason,
    retryAfterSeconds: Math.max(1, Math.ceil(retryAfterSeconds)),
    presence,
  };
}

export function evaluateSafariLanePermit(
  value: unknown,
  mode: SafariLanePermitMode,
  nowMs: number = Date.now(),
): SafariLanePermit {
  const presence = parsePresence(value);
  if (!presence) {
    return denied(mode, 'presence_invalid', 'human-presence state is malformed');
  }

  const updatedAtMs = Date.parse(presence.updated_at);
  const observedAtMs = presence.observed_at * 1000;
  const ages = [nowMs - updatedAtMs, nowMs - observedAtMs];
  if (!Number.isFinite(updatedAtMs) || ages.some(age => age < -5_000 || age > HUMAN_PRESENCE_MAX_AGE_MS)) {
    return denied(mode, 'presence_stale', 'human-presence state is stale', 1, presence);
  }
  if (!presence.source_available) {
    return denied(
      mode,
      'presence_unavailable',
      'human-presence source is unavailable',
      presence.retry_after_seconds.safari,
      presence,
    );
  }

  const nowSeconds = nowMs / 1000;
  const manualHoldRemaining = Math.max(0, presence.manual_hold_until.safari - nowSeconds);
  if (manualHoldRemaining > 0) {
    return denied(
      mode,
      'human_active',
      'manual Safari hold blocks all agent work',
      Math.max(presence.retry_after_seconds.safari, manualHoldRemaining),
      presence,
    );
  }
  // Any recent human input owns the interactive lane, even when Safari is not
  // currently foreground. Otherwise opening a Safari tab could pull focus
  // away from a person working in another app.
  const humanActive = presence.active.safari || presence.human_recent;
  if (mode === 'interactive' && humanActive) {
    return denied(
      mode,
      'human_active',
      'human activity owns the Safari foreground lane',
      Math.max(presence.retry_after_seconds.safari, manualHoldRemaining),
      presence,
    );
  }

  return {
    allowed: true,
    mode,
    code: 'allowed',
    reason: mode === 'background'
      ? 'fresh state permits background work on an existing agent-owned tab'
      : 'Safari interactive lane is idle',
    retryAfterSeconds: 0,
    presence,
  };
}

function stateFileForProcess(): string {
  // Tests may use a real temporary state file. Production callers cannot
  // redirect this security decision with an environment variable.
  const override = process.env.SAFARI_HUMAN_PRESENCE_STATE_FILE;
  const testProcess = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
  if (testProcess && override) {
    return isAbsolute(override) ? override : resolve(override);
  }
  return HUMAN_PRESENCE_STATE_FILE;
}

function drainFileForProcess(): string {
  const override = process.env.SAFARI_BROWSER_DRAIN_STATE_FILE;
  const testProcess = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
  if (testProcess && override) {
    return isAbsolute(override) ? override : resolve(override);
  }
  return BROWSER_DRAIN_STATE_FILE;
}

function controlPresenceUrlForProcess(): string {
  const override = process.env.SAFARI_CONTROL_PRESENCE_URL;
  const testProcess = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
  return testProcess && override ? override : SAFARI_CONTROL_PRESENCE_URL;
}

function presenceTokenFileForProcess(): string {
  const override = process.env.SAFARI_PRESENCE_TOKEN_FILE;
  const testProcess = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
  if (testProcess && override) return isAbsolute(override) ? override : resolve(override);
  return SAFARI_PRESENCE_TOKEN_FILE;
}

function securityRegistryPath(environmentName: string, productionPath: string): string {
  const override = process.env[environmentName];
  const testProcess = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
  if (testProcess && override) return isAbsolute(override) ? override : resolve(override);
  return productionPath;
}

function testOwnershipObservationFile(): string | null {
  const override = process.env.SAFARI_OWNERSHIP_OBSERVATION_FILE;
  const testProcess = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
  if (!testProcess || !override) return null;
  return isAbsolute(override) ? override : resolve(override);
}

/**
 * Resolve a live operation's exact durable marker to its current tab ordinal.
 * The public tab index is only a claim lookup hint: Safari actions must use
 * the returned just-in-time ordinal and fail if the marker moved to Window 1,
 * disappeared, duplicated, or lost its ledger/lease binding.
 */
export interface SafariClaimedTabTarget {
  windowId: number;
  tabIndex: number;
  ownershipMarker: string;
}

export async function resolveClaimedSafariActionTarget(
  windowId: number,
  claimedTabIndex: number,
  expectedOwnershipMarker?: string,
  mode: SafariLanePermitMode = 'background',
): Promise<SafariClaimedTabTarget> {
  await requireSafariLanePermit(mode);
  if (!Number.isInteger(windowId) || windowId <= 0 ||
      !Number.isInteger(claimedTabIndex) || claimedTabIndex <= 0 ||
      !(expectedOwnershipMarker === undefined || SAFARI_AGENT_TAB_MARKER_PATTERN.test(expectedOwnershipMarker))) {
    throw new Error('Safari action requires a stable window, claim ordinal, and valid ownership identity');
  }

  let claimsValue: unknown;
  let ownershipValue: unknown;
  try {
    [claimsValue, ownershipValue] = await Promise.all([
      readFile(securityRegistryPath('SAFARI_TAB_CLAIMS_FILE', SAFARI_TAB_CLAIMS_FILE), 'utf8').then(JSON.parse),
      readFile(securityRegistryPath('SAFARI_TAB_OWNERSHIP_FILE', SAFARI_TAB_OWNERSHIP_FILE), 'utf8').then(JSON.parse),
    ]);
  } catch {
    throw new Error('Safari ownership registries are unavailable or corrupt; action fails closed');
  }
  if (!Array.isArray(claimsValue) || !ownershipValue || typeof ownershipValue !== 'object' ||
      (ownershipValue as Record<string, unknown>).version !== 1 ||
      !Array.isArray((ownershipValue as Record<string, unknown>).entries)) {
    throw new Error('Safari ownership registries are malformed; action fails closed');
  }

  const now = Date.now();
  const matchingClaims = (claimsValue as Array<Record<string, unknown>>).filter(claim =>
    claim.pid === process.pid &&
    claim.windowId === windowId &&
    claim.tabIndex === claimedTabIndex &&
    (expectedOwnershipMarker === undefined || claim.ownershipMarker === expectedOwnershipMarker) &&
    typeof claim.heartbeat === 'number' && Number.isFinite(claim.heartbeat) &&
    now - claim.heartbeat >= 0 && now - claim.heartbeat < SAFARI_CLAIM_TTL_MS
  );
  const ownershipMarker = matchingClaims[0]?.ownershipMarker;
  if (matchingClaims.length !== 1 || typeof ownershipMarker !== 'string' ||
      !SAFARI_AGENT_TAB_MARKER_PATTERN.test(ownershipMarker)) {
    throw new Error('Safari action is not bound to one live exact operation claim');
  }
  const matchingOwnership = ((ownershipValue as Record<string, unknown>).entries as Array<Record<string, unknown>>)
    .filter(entry => entry.marker === ownershipMarker && entry.windowId === windowId);
  if (matchingOwnership.length !== 1) {
    throw new Error('Safari action is not bound to one live exact operation claim and durable owner');
  }

  const script = `
tell application "Safari"
  set matchCount to 0
  set matchedWindowIndex to 0
  set matchedWindowId to 0
  set matchedTabIndex to 0
  repeat with wi from 1 to count of windows
    set candidateWindow to window wi
    repeat with ti from 1 to count of tabs of candidateWindow
      try
        set candidateMarker to do JavaScript "window.name" in tab ti of candidateWindow
        if candidateMarker is "${ownershipMarker}" then
          set matchCount to matchCount + 1
          set matchedWindowIndex to wi
          set matchedWindowId to id of candidateWindow
          set matchedTabIndex to ti
        end if
      end try
    end repeat
  end repeat
  if matchCount is not 1 then error "Safari ownership marker is missing or duplicated"
  return (matchedWindowIndex as text) & "||" & (matchedWindowId as text) & "||" & (matchedTabIndex as text)
end tell`;
  const observationFile = testOwnershipObservationFile();
  const stdout = observationFile
    ? await readFile(observationFile, 'utf8')
    : (await execFileAsync('/usr/bin/osascript', ['-e', script], { timeout: 3_000 })).stdout;
  const [rawWindowIndex, rawWindowId, rawTabIndex] = stdout.trim().split('||');
  const windowIndex = parseInt(rawWindowIndex, 10);
  const observedWindowId = parseInt(rawWindowId, 10);
  const tabIndex = parseInt(rawTabIndex, 10);
  if (windowIndex !== 2 || observedWindowId !== windowId || tabIndex !== claimedTabIndex) {
    throw new Error('Safari ownership marker moved outside its exact stable Window 2 claim; action fails closed');
  }
  return { windowId, tabIndex, ownershipMarker };
}

export async function resolveClaimedSafariTabIndex(
  windowId: number,
  claimedTabIndex: number,
  expectedOwnershipMarker?: string,
  mode: SafariLanePermitMode = 'background',
): Promise<number> {
  return (await resolveClaimedSafariActionTarget(
    windowId,
    claimedTabIndex,
    expectedOwnershipMarker,
    mode,
  )).tabIndex;
}

export interface ClaimedSafariAppleScriptOptions {
  preamble?: string;
  timeoutMs?: number;
}

/**
 * Run one Safari action in the same AppleScript transaction that rechecks the
 * exact durable ownership marker. The `agentWindow` and `agentTab` variables
 * are stable object references available to actionBody. Callers must not open
 * another Safari tell block: doing so would reintroduce an ordinal TOCTOU gap.
 */
export async function runClaimedSafariAppleScript(
  windowId: number,
  claimedTabIndex: number,
  mode: SafariLanePermitMode,
  actionBody: string,
  options: ClaimedSafariAppleScriptOptions = {},
): Promise<string> {
  if (typeof actionBody !== 'string' || actionBody.trim().length === 0 ||
      /tell\s+application\s+["']Safari["']|tell\s+application\s+["']System Events["']|\bend tell\b/i.test(actionBody)) {
    throw new Error('Claimed Safari action body must use agentWindow/agentTab without nested application tell blocks');
  }
  const preamble = options.preamble ?? '';
  if (/tell\s+application\s+["'](?:Safari|System Events)["']/i.test(preamble)) {
    throw new Error('Claimed Safari action preamble cannot target applications');
  }
  const target = await resolveClaimedSafariActionTarget(windowId, claimedTabIndex, undefined, mode);
  const script = `${preamble}
tell application "Safari"
  set agentWindow to first window whose id is ${target.windowId}
  set agentTab to tab ${target.tabIndex} of agentWindow
  set liveOwnershipMarker to do JavaScript "window.name" in agentTab
  if liveOwnershipMarker is not "${target.ownershipMarker}" then error "Safari ownership changed before action"
  ${actionBody}
end tell`;
  const { stdout } = await execFileAsync('/usr/bin/osascript', ['-e', script], {
    timeout: Math.max(1_000, Math.min(options.timeoutMs ?? 30_000, 120_000)),
  });
  return stdout.trim();
}

async function validateLiveProcessClaimBindings(allowForegroundWindow: boolean): Promise<void> {
  let claimsValue: unknown;
  try {
    claimsValue = JSON.parse(await readFile(
      securityRegistryPath('SAFARI_TAB_CLAIMS_FILE', SAFARI_TAB_CLAIMS_FILE),
      'utf8',
    ));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw new Error('Safari claim registry is unavailable or corrupt');
  }
  if (!Array.isArray(claimsValue) || claimsValue.some(item => !item || typeof item !== 'object' || Array.isArray(item))) {
    throw new Error('Safari claim registry is malformed');
  }
  const now = Date.now();
  const ownClaims = (claimsValue as Array<Record<string, unknown>>).filter(claim =>
    claim.pid === process.pid &&
    typeof claim.heartbeat === 'number' && Number.isFinite(claim.heartbeat) &&
    now - claim.heartbeat >= 0 && now - claim.heartbeat < SAFARI_CLAIM_TTL_MS
  );
  if (ownClaims.length === 0) return;

  let ownershipValue: unknown;
  try {
    ownershipValue = JSON.parse(await readFile(
      securityRegistryPath('SAFARI_TAB_OWNERSHIP_FILE', SAFARI_TAB_OWNERSHIP_FILE),
      'utf8',
    ));
  } catch {
    throw new Error('Safari ownership ledger is unavailable or corrupt');
  }
  if (!ownershipValue || typeof ownershipValue !== 'object' ||
      (ownershipValue as Record<string, unknown>).version !== 1 ||
      !Array.isArray((ownershipValue as Record<string, unknown>).entries)) {
    throw new Error('Safari ownership ledger is malformed');
  }
  const ownership = (ownershipValue as Record<string, unknown>).entries as Array<Record<string, unknown>>;

  const script = `
tell application "Safari"
  set markerRows to {}
  repeat with wi from 1 to count of windows
    set candidateWindow to window wi
    repeat with ti from 1 to count of tabs of candidateWindow
      try
        set candidateMarker to do JavaScript "window.name" in tab ti of candidateWindow
        if candidateMarker starts with "__ACTP_SAFARI_AGENT_TAB__:" then
          set end of markerRows to ((wi as text) & "||" & ((id of candidateWindow) as text) & "||" & (ti as text) & "||" & candidateMarker)
        end if
      on error
        error "Unable to inspect every Safari ownership marker"
      end try
    end repeat
  end repeat
  set AppleScript's text item delimiters to linefeed
  return markerRows as text
end tell`;
  const observationFile = testOwnershipObservationFile();
  const stdout = observationFile
    ? await readFile(observationFile, 'utf8')
    : (await execFileAsync('/usr/bin/osascript', ['-e', script], { timeout: 3_000 })).stdout;
  const observed = stdout.trim().split(/\r?\n/).filter(Boolean).map(row => {
    const [rawWindowIndex, rawWindowId, rawTabIndex, marker] = row.split('||');
    return {
      windowIndex: parseInt(rawWindowIndex, 10),
      windowId: parseInt(rawWindowId, 10),
      tabIndex: parseInt(rawTabIndex, 10),
      marker,
    };
  });

  for (const claim of ownClaims) {
    const marker = claim.ownershipMarker;
    const windowId = claim.windowId;
    const tabIndex = claim.tabIndex;
    if (typeof marker !== 'string' || !SAFARI_AGENT_TAB_MARKER_PATTERN.test(marker) ||
        !Number.isInteger(windowId) || Number(windowId) <= 0 ||
        !Number.isInteger(tabIndex) || Number(tabIndex) <= 0) {
      throw new Error('Live Safari claim lacks an exact stable ownership identity');
    }
    const ledgerMatches = ownership.filter(entry => entry.marker === marker && entry.windowId === windowId);
    const tabMatches = observed.filter(entry => entry.marker === marker);
    if (ledgerMatches.length !== 1 || tabMatches.length !== 1) {
      throw new Error('Live Safari claim ownership is missing or duplicated');
    }
    const actual = tabMatches[0];
    if (actual.windowId !== windowId || actual.tabIndex !== tabIndex ||
        (!allowForegroundWindow && actual.windowIndex !== 2)) {
      throw new Error('Live Safari claim moved from its exact stable tab binding');
    }
  }
}

function parseDrainState(value: unknown): BrowserDrainState | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  if (
    item.version !== 1 ||
    typeof item.updated_at !== 'string' ||
    !browserBooleans(item.draining) ||
    !browserNumbers(item.retry_after_seconds)
  ) {
    return null;
  }
  return item as unknown as BrowserDrainState;
}

async function evaluateDrainGate(
  presence: HumanPresenceState,
  mode: SafariLanePermitMode,
  nowMs = Date.now(),
): Promise<SafariLanePermit | null> {
  let raw: string;
  try {
    raw = await readFile(drainFileForProcess(), 'utf8');
  } catch {
    return denied(mode, 'drain_missing', 'browser drain state is unavailable', 1, presence);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return denied(mode, 'drain_invalid', 'browser drain state is not valid JSON', 1, presence);
  }
  const drain = parseDrainState(parsed);
  if (!drain) {
    return denied(mode, 'drain_invalid', 'browser drain state is malformed', 1, presence);
  }
  const updatedAtMs = Date.parse(drain.updated_at);
  const ageMs = nowMs - updatedAtMs;
  if (!Number.isFinite(updatedAtMs) || ageMs < -5_000 || ageMs > BROWSER_DRAIN_MAX_AGE_MS) {
    return denied(mode, 'drain_stale', 'browser drain state is stale', 1, presence);
  }
  if (drain.draining.safari) {
    return denied(
      mode,
      'safari_draining',
      'Safari is draining claims for controlled maintenance',
      drain.retry_after_seconds.safari,
      presence,
    );
  }
  return null;
}

/**
 * Re-sample the broker's native lsappinfo + IOHIDSystem signals immediately
 * before every interactive action. This closes the enforcer snapshot's poll
 * interval: the first human mouse/key event wins even if the cached JSON still
 * describes Safari as idle. Missing or malformed live signals fail closed.
 */
async function evaluateLivePresenceGate(
  presence: HumanPresenceState,
  allowAgentForeground = false,
): Promise<SafariLanePermit | null> {
  let token: string;
  try {
    token = (await readFile(presenceTokenFileForProcess(), 'utf8')).trim();
    if (token.length < 32) throw new Error('token is too short');
  } catch {
    return denied(
      'interactive',
      'live_presence_unavailable',
      'live Safari presence token is unavailable',
      1,
      presence,
    );
  }

  let response: Response;
  try {
    response = await fetch(controlPresenceUrlForProcess(), {
      headers: {
        'Cache-Control': 'no-cache',
        'X-ACTP-Browser-Token': token,
      },
      signal: AbortSignal.timeout(LIVE_PRESENCE_TIMEOUT_MS),
    });
  } catch {
    return denied(
      'interactive',
      'live_presence_unavailable',
      'live Safari presence probe is unavailable',
      1,
      presence,
    );
  }

  let value: unknown;
  try {
    value = await response.json();
  } catch {
    value = null;
  }
  if (!response.ok || !value || typeof value !== 'object') {
    return denied(
      'interactive',
      'live_presence_unavailable',
      'live Safari presence probe returned an invalid response',
      1,
      presence,
    );
  }
  const item = value as Record<string, unknown>;
  const thresholds = item.thresholds as Record<string, unknown> | null;
  const idleSeconds = item.input_idle_seconds;
  const recentThreshold = thresholds?.human_recent_input_seconds;
  const validSignals =
    item.ok === true &&
    item.signals_available === true &&
    typeof item.interactive_automation_allowed === 'boolean' &&
    typeof item.recent_input === 'boolean' &&
    (item.frontmost_browser === null || item.frontmost_browser === 'chrome' || item.frontmost_browser === 'safari') &&
    typeof idleSeconds === 'number' && Number.isFinite(idleSeconds) && idleSeconds >= 0 &&
    typeof recentThreshold === 'number' && Number.isFinite(recentThreshold) && recentThreshold > 0;
  if (!validSignals) {
    return denied(
      'interactive',
      'live_presence_unavailable',
      'live Safari presence signals are incomplete',
      1,
      presence,
    );
  }

  if (
    item.recent_input === true ||
    item.frontmost_browser === 'chrome' ||
    (!allowAgentForeground && (
      item.interactive_automation_allowed !== true || item.frontmost_browser !== null
    )) ||
    (idleSeconds as number) < (recentThreshold as number)
  ) {
    return denied(
      'interactive',
      'live_human_active',
      'just-in-time native HID/frontmost probe detected human activity',
      Math.max(1, (recentThreshold as number) - (idleSeconds as number)),
      presence,
    );
  }
  return null;
}

export async function getSafariLanePermit(mode: SafariLanePermitMode): Promise<SafariLanePermit> {
  let raw: string;
  try {
    raw = await readFile(stateFileForProcess(), 'utf8');
  } catch {
    return denied(mode, 'presence_missing', 'human-presence state is unavailable');
  }

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return denied(mode, 'presence_invalid', 'human-presence state is not valid JSON');
  }
  const permit = evaluateSafariLanePermit(value, mode);
  if (!permit.allowed || !permit.presence) return permit;
  const drainDenial = await evaluateDrainGate(permit.presence, mode);
  if (drainDenial) return drainDenial;
  if (mode === 'background') return permit;
  return (await evaluateLivePresenceGate(permit.presence)) ?? permit;
}

export async function requireSafariLanePermit(mode: SafariLanePermitMode): Promise<HumanPresenceState> {
  const permit = await getSafariLanePermit(mode);
  if (!permit.allowed || !permit.presence) throw new SafariLanePermitError(permit);
  try {
    await validateLiveProcessClaimBindings(false);
  } catch (error) {
    throw new SafariLanePermitError(denied(
      mode,
      'claim_binding_invalid',
      `live Safari claim identity check failed: ${String(error)}`,
      1,
      permit.presence,
    ));
  }
  return permit.presence;
}

/**
 * Recheck native HID immediately after this agent foregrounded Safari. Safari
 * being frontmost is expected here, but new physical input, Chrome becoming
 * frontmost, an unavailable signal, or a maintenance drain still aborts.
 */
export async function requireSafariPostActivationPermit(): Promise<HumanPresenceState> {
  const cached = await getSafariLanePermit('background');
  if (!cached.allowed || !cached.presence) throw new SafariLanePermitError(cached);
  const presence = cached.presence;
  const nowSeconds = Date.now() / 1000;
  const manualHoldRemaining = Math.max(0, presence.manual_hold_until.safari - nowSeconds);
  if (presence.human_recent || manualHoldRemaining > 0) {
    throw new SafariLanePermitError(denied(
      'interactive',
      'human_active',
      'human activity appeared while Safari was being activated',
      Math.max(presence.retry_after_seconds.safari, manualHoldRemaining),
      presence,
    ));
  }
  const drainDenial = await evaluateDrainGate(presence, 'interactive');
  if (drainDenial) throw new SafariLanePermitError(drainDenial);
  try {
    await validateLiveProcessClaimBindings(true);
  } catch (error) {
    throw new SafariLanePermitError(denied(
      'interactive',
      'claim_binding_invalid',
      `post-activation Safari claim identity check failed: ${String(error)}`,
      1,
      presence,
    ));
  }
  const liveDenial = await evaluateLivePresenceGate(presence, true);
  if (liveDenial) throw new SafariLanePermitError(liveDenial);
  return presence;
}

interface SafariForegroundSnapshot {
  priorFrontApp: string;
  humanWindowId: number;
}

async function captureSafariForegroundSnapshot(): Promise<SafariForegroundSnapshot> {
  const script = `
tell application "System Events"
  if not (exists application process "Safari") then error "singleton Safari is not running"
  set priorFrontApp to name of first application process whose frontmost is true
end tell
set humanWindowId to 0
tell application "Safari"
  if (count of windows) > 0 then set humanWindowId to id of window 1
end tell
return priorFrontApp & "||" & (humanWindowId as text)`;
  const { stdout } = await execFileAsync('/usr/bin/osascript', ['-e', script], { timeout: 3000 });
  const [priorFrontApp, rawWindowId] = stdout.trim().split('||');
  const humanWindowId = parseInt(rawWindowId, 10);
  if (!priorFrontApp || !Number.isInteger(humanWindowId) || humanWindowId <= 0) {
    throw new Error('Unable to capture the human Safari lane before foreground automation');
  }
  return { priorFrontApp, humanWindowId };
}

async function restoreSafariForegroundSnapshot(snapshot: SafariForegroundSnapshot): Promise<void> {
  const safeApp = snapshot.priorFrontApp.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const script = `
tell application "Safari"
  try
    set humanWindow to first window whose id is ${snapshot.humanWindowId}
    set index of humanWindow to 1
  end try
end tell
if "${safeApp}" is not "Safari" then
  tell application "System Events"
    try
      set frontmost of first application process whose name is "${safeApp}" to true
    end try
  end tell
end if`;
  await execFileAsync('/usr/bin/osascript', ['-e', script], { timeout: 3000 });
}

/**
 * Execute the only permitted foreground-input sequence: admit, remember the
 * human lane, activate the owned agent tab, re-sample physical HID, perform
 * the input, then restore Window 1 and the person's prior app even on failure.
 */
export async function runSafariForegroundInput<T>(
  activateOwnedTab: () => Promise<void>,
  performInput: () => Promise<T>,
): Promise<T> {
  await requireSafariLanePermit('interactive');
  const snapshot = await captureSafariForegroundSnapshot();
  try {
    await activateOwnedTab();
    await requireSafariPostActivationPermit();
    return await performInput();
  } finally {
    await restoreSafariForegroundSnapshot(snapshot).catch(() => {});
  }
}
