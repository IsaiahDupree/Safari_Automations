/**
 * Runtime build of safari-lane-client.ts for standalone package output.
 * Keep behavior in sync with the typed source; package-local builds cannot
 * compile sources outside their configured rootDir.
 */
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

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

export class SafariLanePermitError extends Error {
  constructor(permit) {
    super(`Safari ${permit.mode} permit denied: ${permit.reason}`);
    this.name = 'SafariLanePermitError';
    this.code = permit.code;
    this.mode = permit.mode;
    this.retryAfterSeconds = permit.retryAfterSeconds;
  }
}

function browserBooleans(value) {
  if (!value || typeof value !== 'object') return false;
  return typeof value.chrome === 'boolean' && typeof value.safari === 'boolean';
}

function browserNumbers(value) {
  if (!value || typeof value !== 'object') return false;
  return typeof value.chrome === 'number' && Number.isFinite(value.chrome) &&
    typeof value.safari === 'number' && Number.isFinite(value.safari);
}

function parsePresence(value) {
  if (!value || typeof value !== 'object') return null;
  if (
    value.version !== 1 ||
    typeof value.updated_at !== 'string' ||
    typeof value.observed_at !== 'number' || !Number.isFinite(value.observed_at) ||
    typeof value.source_available !== 'boolean' ||
    !(typeof value.frontmost_app === 'string' || value.frontmost_app === null) ||
    !(typeof value.idle_seconds === 'number' || value.idle_seconds === null) ||
    (typeof value.idle_seconds === 'number' && !Number.isFinite(value.idle_seconds)) ||
    !browserBooleans(value.browser_foreground) ||
    typeof value.human_recent !== 'boolean' ||
    !browserBooleans(value.active) ||
    !browserNumbers(value.manual_hold_until) ||
    !browserBooleans(value.restart_allowed) ||
    !browserNumbers(value.retry_after_seconds)
  ) {
    return null;
  }
  return value;
}

function denied(mode, code, reason, retryAfterSeconds = 1, presence = null) {
  return {
    allowed: false,
    mode,
    code,
    reason,
    retryAfterSeconds: Math.max(1, Math.ceil(retryAfterSeconds)),
    presence,
  };
}

export function evaluateSafariLanePermit(value, mode, nowMs = Date.now()) {
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

function stateFileForProcess() {
  const override = process.env.SAFARI_HUMAN_PRESENCE_STATE_FILE;
  const testProcess = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
  if (testProcess && override) {
    return isAbsolute(override) ? override : resolve(override);
  }
  return HUMAN_PRESENCE_STATE_FILE;
}

function drainFileForProcess() {
  const override = process.env.SAFARI_BROWSER_DRAIN_STATE_FILE;
  const testProcess = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
  if (testProcess && override) {
    return isAbsolute(override) ? override : resolve(override);
  }
  return BROWSER_DRAIN_STATE_FILE;
}

function controlPresenceUrlForProcess() {
  const override = process.env.SAFARI_CONTROL_PRESENCE_URL;
  const testProcess = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
  return testProcess && override ? override : SAFARI_CONTROL_PRESENCE_URL;
}

function presenceTokenFileForProcess() {
  const override = process.env.SAFARI_PRESENCE_TOKEN_FILE;
  const testProcess = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
  if (testProcess && override) return isAbsolute(override) ? override : resolve(override);
  return SAFARI_PRESENCE_TOKEN_FILE;
}

function securityRegistryPath(environmentName, productionPath) {
  const override = process.env[environmentName];
  const testProcess = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
  if (testProcess && override) return isAbsolute(override) ? override : resolve(override);
  return productionPath;
}

function testOwnershipObservationFile() {
  const override = process.env.SAFARI_OWNERSHIP_OBSERVATION_FILE;
  const testProcess = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
  if (!testProcess || !override) return null;
  return isAbsolute(override) ? override : resolve(override);
}

export async function resolveClaimedSafariActionTarget(windowId, claimedTabIndex, expectedOwnershipMarker, mode = 'background') {
  await requireSafariLanePermit(mode);
  if (!Number.isInteger(windowId) || windowId <= 0 ||
      !Number.isInteger(claimedTabIndex) || claimedTabIndex <= 0 ||
      !(expectedOwnershipMarker === undefined || SAFARI_AGENT_TAB_MARKER_PATTERN.test(expectedOwnershipMarker))) {
    throw new Error('Safari action requires a stable window, claim ordinal, and valid ownership identity');
  }

  let claimsValue;
  let ownershipValue;
  try {
    [claimsValue, ownershipValue] = await Promise.all([
      readFile(securityRegistryPath('SAFARI_TAB_CLAIMS_FILE', SAFARI_TAB_CLAIMS_FILE), 'utf8').then(JSON.parse),
      readFile(securityRegistryPath('SAFARI_TAB_OWNERSHIP_FILE', SAFARI_TAB_OWNERSHIP_FILE), 'utf8').then(JSON.parse),
    ]);
  } catch {
    throw new Error('Safari ownership registries are unavailable or corrupt; action fails closed');
  }
  if (!Array.isArray(claimsValue) || !ownershipValue || typeof ownershipValue !== 'object' ||
      ownershipValue.version !== 1 || !Array.isArray(ownershipValue.entries)) {
    throw new Error('Safari ownership registries are malformed; action fails closed');
  }

  const now = Date.now();
  const matchingClaims = claimsValue.filter(claim =>
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
  const matchingOwnership = ownershipValue.entries
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

export async function resolveClaimedSafariTabIndex(windowId, claimedTabIndex, expectedOwnershipMarker, mode = 'background') {
  return (await resolveClaimedSafariActionTarget(windowId, claimedTabIndex, expectedOwnershipMarker, mode)).tabIndex;
}

export async function runClaimedSafariAppleScript(windowId, claimedTabIndex, mode, actionBody, options = {}) {
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

async function validateLiveProcessClaimBindings(allowForegroundWindow) {
  let claimsValue;
  try {
    claimsValue = JSON.parse(await readFile(
      securityRegistryPath('SAFARI_TAB_CLAIMS_FILE', SAFARI_TAB_CLAIMS_FILE),
      'utf8',
    ));
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw new Error('Safari claim registry is unavailable or corrupt');
  }
  if (!Array.isArray(claimsValue) || claimsValue.some(item => !item || typeof item !== 'object' || Array.isArray(item))) {
    throw new Error('Safari claim registry is malformed');
  }
  const now = Date.now();
  const ownClaims = claimsValue.filter(claim =>
    claim.pid === process.pid &&
    typeof claim.heartbeat === 'number' && Number.isFinite(claim.heartbeat) &&
    now - claim.heartbeat >= 0 && now - claim.heartbeat < SAFARI_CLAIM_TTL_MS
  );
  if (ownClaims.length === 0) return;

  let ownershipValue;
  try {
    ownershipValue = JSON.parse(await readFile(
      securityRegistryPath('SAFARI_TAB_OWNERSHIP_FILE', SAFARI_TAB_OWNERSHIP_FILE),
      'utf8',
    ));
  } catch {
    throw new Error('Safari ownership ledger is unavailable or corrupt');
  }
  if (!ownershipValue || typeof ownershipValue !== 'object' ||
      ownershipValue.version !== 1 || !Array.isArray(ownershipValue.entries)) {
    throw new Error('Safari ownership ledger is malformed');
  }
  const ownership = ownershipValue.entries;

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
        !Number.isInteger(windowId) || windowId <= 0 ||
        !Number.isInteger(tabIndex) || tabIndex <= 0) {
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

function parseDrainState(value) {
  if (!value || typeof value !== 'object') return null;
  if (
    value.version !== 1 ||
    typeof value.updated_at !== 'string' ||
    !browserBooleans(value.draining) ||
    !browserNumbers(value.retry_after_seconds)
  ) {
    return null;
  }
  return value;
}

async function evaluateDrainGate(presence, mode, nowMs = Date.now()) {
  let raw;
  try {
    raw = await readFile(drainFileForProcess(), 'utf8');
  } catch {
    return denied(mode, 'drain_missing', 'browser drain state is unavailable', 1, presence);
  }
  let parsed;
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

async function evaluateLivePresenceGate(presence, allowAgentForeground = false) {
  let token;
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

  let response;
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

  let value;
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
  const thresholds = value.thresholds;
  const idleSeconds = value.input_idle_seconds;
  const recentThreshold = thresholds?.human_recent_input_seconds;
  const validSignals =
    value.ok === true &&
    value.signals_available === true &&
    typeof value.interactive_automation_allowed === 'boolean' &&
    typeof value.recent_input === 'boolean' &&
    (value.frontmost_browser === null || value.frontmost_browser === 'chrome' || value.frontmost_browser === 'safari') &&
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
    value.recent_input === true ||
    value.frontmost_browser === 'chrome' ||
    (!allowAgentForeground && (
      value.interactive_automation_allowed !== true || value.frontmost_browser !== null
    )) ||
    idleSeconds < recentThreshold
  ) {
    return denied(
      'interactive',
      'live_human_active',
      'just-in-time native HID/frontmost probe detected human activity',
      Math.max(1, recentThreshold - idleSeconds),
      presence,
    );
  }
  return null;
}

export async function getSafariLanePermit(mode) {
  let raw;
  try {
    raw = await readFile(stateFileForProcess(), 'utf8');
  } catch {
    return denied(mode, 'presence_missing', 'human-presence state is unavailable');
  }

  let value;
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

export async function requireSafariLanePermit(mode) {
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

export async function requireSafariPostActivationPermit() {
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

async function captureSafariForegroundSnapshot() {
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

async function restoreSafariForegroundSnapshot(snapshot) {
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

export async function runSafariForegroundInput(activateOwnedTab, performInput) {
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
