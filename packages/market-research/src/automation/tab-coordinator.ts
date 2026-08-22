/**
 * TabCoordinator — Cross-process Safari tab claim registry.
 *
 * Each agent claims a specific Safari window+tab before acting.
 * Claims are stored in /tmp/safari-tab-claims.json (readable by all agents).
 * Claims expire after CLAIM_TTL_MS without a heartbeat (handles crashed agents).
 *
 * Usage:
 *   const coord = new TabCoordinator('ig-sync-123', 'instagram-dm', 3100, 'instagram.com');
 *   const claim = await coord.claim();          // auto-discover + claim
 *   await coord.heartbeat();                    // call every ~30s
 *   await coord.release();                      // on clean exit
 *
 * Other agents call TabCoordinator.listClaims() to see what's claimed,
 * or TabCoordinator.isConflict(windowIndex, tabIndex) before touching a tab.
 */

import { exec, spawn } from 'child_process';
import { once } from 'node:events';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import { randomUUID } from 'node:crypto';

const execAsync = promisify(exec);

export const CLAIMS_FILE = '/tmp/safari-tab-claims.json';
export const CLAIMS_LOCK_FILE = '/tmp/safari-tab-claims.lock';
export const OWNERSHIP_FILE = '/tmp/safari-tab-ownership.json';
export const CLAIM_TTL_MS = 60_000; // 60s — claim expires if no heartbeat
export const MAX_AGENT_OWNED_TABS = 4;
export const AGENT_TAB_MARKER_PREFIX = '__ACTP_SAFARI_AGENT_TAB__:';
export const AGENT_TAB_MARKER_PATTERN = /^__ACTP_SAFARI_AGENT_TAB__:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOCATION_LOCK = '/tmp/actp-safari-agent-tab-allocation.lock';
const ALLOCATION_LOCK_STALE_MS = 30_000;
const CLAIM_LOCK_TIMEOUT_SECONDS = 5;
const CLAIM_LOCK_GUARD = String.raw`
import fcntl, os, sys, time
path = sys.argv[1]
timeout = float(sys.argv[2])
flags = os.O_RDWR | os.O_CREAT
if hasattr(os, "O_NOFOLLOW"):
    flags |= os.O_NOFOLLOW
try:
    descriptor = os.open(path, flags, 0o600)
    os.fchmod(descriptor, 0o600)
    deadline = time.monotonic() + timeout
    while True:
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
            break
        except BlockingIOError:
            if time.monotonic() >= deadline:
                raise TimeoutError("Safari claim registry lock remained busy")
            time.sleep(0.025)
    print("LOCKED", flush=True)
    sys.stdin.buffer.read()
except Exception as error:
    print("ERROR:" + type(error).__name__ + ":" + str(error), flush=True)
    sys.exit(2)
`;

type SafariLaneClientModule = {
  getSafariLanePermit(mode: 'background' | 'interactive'): Promise<{
    allowed: boolean;
    code: string;
    reason: string;
    retryAfterSeconds: number;
  }>;
  requireSafariLanePermit(mode: 'background' | 'interactive'): Promise<unknown>;
};

async function requireInteractiveLanePermit(): Promise<void> {
  // Keeping the specifier in a variable prevents standalone package builds
  // from pulling the shared source outside rootDir. Native dynamic import
  // still resolves it relative to this module in both ESM and CommonJS builds.
  const clientPath = '../../../shared/safari-lane-client.js';
  const client = await import(clientPath) as SafariLaneClientModule;
  await client.requireSafariLanePermit('interactive');
}

async function requireBackgroundLanePermit(): Promise<void> {
  const clientPath = '../../../shared/safari-lane-client.js';
  const client = await import(clientPath) as SafariLaneClientModule;
  await client.requireSafariLanePermit('background');
}

// ── Phase A: automation window enforcement ─────────────────────────────────
// Window 1 is reserved for the human. All agents share Window 2 inside the
// singleton Safari application.
export function getAutomationWindow(): number {
  return 2;
}
/** @deprecated use getAutomationWindow() — kept for backward compat */
export const AUTOMATION_WINDOW = 0; // placeholder, not used internally

export function urlMatchesPattern(value: string, pattern: string): boolean {
  try {
    const url = new URL(value);
    const normalized = pattern.trim().toLowerCase().replace(/^https?:\/\//, '');
    const slash = normalized.indexOf('/');
    const hostPattern = (slash >= 0 ? normalized.slice(0, slash) : normalized).replace(/^www\./, '');
    const pathPattern = slash >= 0 ? `/${normalized.slice(slash + 1)}` : '';
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    const hostMatches = host === hostPattern || host.endsWith(`.${hostPattern}`);
    return hostMatches && (!pathPattern || url.pathname.startsWith(pathPattern));
  } catch {
    return false;
  }
}

export interface TabClaim {
  agentId: string;        // unique, e.g. 'ig-sync-20240304-32396'
  service: string;        // 'instagram-dm', 'twitter-dm', 'tiktok-dm', etc.
  port: number;           // server port (3100, 3003, 3102, …)
  urlPattern: string;     // e.g. 'instagram.com/direct'
  windowIndex: number;    // Safari window index (1-based)
  windowId?: number;      // stable Safari window id (preferred when available)
  tabIndex: number;       // Safari tab index within that window (1-based)
  tabUrl: string;         // actual URL at claim time
  pid: number;            // OS PID — watchdog can verify with kill -0
  claimedAt: number;      // epoch ms
  heartbeat: number;      // epoch ms — refresh every ~30s to keep claim alive
  agentOwned: boolean;    // true only for tabs allocated and marked by ACTP
  ownershipMarker: string; // exact durable marker bound under the shared lock
}

export interface TabOwnership {
  marker: string;
  windowId: number;
  createdAt: number;
  agentId: string;
  service: string;
  pid: number;
}

interface OwnedTabPosition {
  windowId: number;
  windowIndex: number;
  tabIndex: number;
  ownershipMarker: string;
}

export class TabCoordinator {
  private agentId: string;
  private service: string;
  private port: number;
  private urlPattern: string;
  private _openUrl: string | null;
  private _claim: TabClaim | null = null;
  private _operationRefs = 0;

  /**
   * @param openUrl  Optional URL to navigate a new Safari tab to if no existing tab matches urlPattern.
   *                 When set, claim() will auto-open a new tab instead of throwing.
   */
  constructor(agentId: string, service: string, port: number, urlPattern: string, openUrl?: string) {
    this.agentId = agentId;
    this.service = service;
    this.port = port;
    this.urlPattern = urlPattern;
    this._openUrl = openUrl ?? null;
  }

  // ─── Read ─────────────────────────────────────────────────────────────────

  private static testOnlyPath(envName: string, fallback: string): string {
    const override = process.env[envName];
    const testProcess = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
    return testProcess && override ? override : fallback;
  }

  private static claimsFileForProcess(): string {
    return TabCoordinator.testOnlyPath('SAFARI_TAB_CLAIMS_FILE', CLAIMS_FILE);
  }

  private static claimsLockForProcess(): string {
    return TabCoordinator.testOnlyPath('SAFARI_TAB_CLAIMS_LOCK_FILE', CLAIMS_LOCK_FILE);
  }

  private static ownershipFileForProcess(): string {
    return TabCoordinator.testOnlyPath('SAFARI_TAB_OWNERSHIP_FILE', OWNERSHIP_FILE);
  }

  private static async readOwnershipStrict(): Promise<TabOwnership[]> {
    const ownershipFile = TabCoordinator.ownershipFileForProcess();
    let raw: string;
    try {
      raw = await fs.readFile(ownershipFile, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    let value: unknown;
    try { value = JSON.parse(raw); }
    catch { throw new Error('Safari ownership ledger is corrupt; ownership fails closed'); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Safari ownership ledger root is malformed; ownership fails closed');
    }
    const ledger = value as { version?: unknown; entries?: unknown };
    if (ledger.version !== 1 || !Array.isArray(ledger.entries)) {
      throw new Error('Safari ownership ledger schema is unsupported; ownership fails closed');
    }
    const entries = ledger.entries as TabOwnership[];
    const markers = new Set<string>();
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object' ||
          typeof entry.marker !== 'string' || !AGENT_TAB_MARKER_PATTERN.test(entry.marker) ||
          !Number.isInteger(entry.windowId) || entry.windowId <= 0 ||
          typeof entry.createdAt !== 'number' || !Number.isFinite(entry.createdAt) || entry.createdAt <= 0 ||
          typeof entry.agentId !== 'string' || !entry.agentId ||
          typeof entry.service !== 'string' || !entry.service ||
          !Number.isInteger(entry.pid) || entry.pid <= 1 || markers.has(entry.marker)) {
        throw new Error('Safari ownership ledger contains invalid or duplicate identity metadata');
      }
      markers.add(entry.marker);
    }
    return entries.map(entry => ({ ...entry }));
  }

  static async listOwnership(): Promise<TabOwnership[]> {
    return TabCoordinator.readOwnershipStrict();
  }

  /** Read all non-expired claims from the shared registry. */
  static async listClaims(): Promise<TabClaim[]> {
    try {
      const raw = await fs.readFile(TabCoordinator.claimsFileForProcess(), 'utf-8');
      const all: TabClaim[] = JSON.parse(raw);
      const now = Date.now();
      return all.filter(c => (now - c.heartbeat) < CLAIM_TTL_MS);
    } catch {
      return [];
    }
  }

  /** Strict registry read for every locked mutation; corrupt state is never overwritten. */
  private static async readClaimsStrict(): Promise<TabClaim[]> {
    const claimsFile = TabCoordinator.claimsFileForProcess();
    let raw: string;
    try {
      raw = await fs.readFile(claimsFile, 'utf-8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error('Safari claim registry is corrupt; mutation fails closed');
    }
    if (!Array.isArray(parsed)) {
      throw new Error('Safari claim registry is malformed; mutation fails closed');
    }
    const now = Date.now();
    const claims = parsed as Array<Record<string, unknown>>;
    for (const claim of claims) {
      if (!claim || typeof claim !== 'object' || Array.isArray(claim) ||
          typeof claim.agentId !== 'string' || !claim.agentId ||
          typeof claim.service !== 'string' || !claim.service ||
          !Number.isInteger(claim.port) || Number(claim.port) <= 0 ||
          typeof claim.urlPattern !== 'string' ||
          !Number.isInteger(claim.windowIndex) || Number(claim.windowIndex) <= 0 ||
          !(claim.windowId === undefined || (Number.isInteger(claim.windowId) && Number(claim.windowId) > 0)) ||
          !Number.isInteger(claim.tabIndex) || Number(claim.tabIndex) <= 0 ||
          typeof claim.tabUrl !== 'string' ||
          !Number.isInteger(claim.pid) || Number(claim.pid) <= 1 ||
          typeof claim.claimedAt !== 'number' || !Number.isFinite(claim.claimedAt) || claim.claimedAt <= 0 ||
          typeof claim.heartbeat !== 'number' || !Number.isFinite(claim.heartbeat) || claim.heartbeat <= 0 ||
          claim.heartbeat > now + 5_000 ||
          typeof claim.agentOwned !== 'boolean' ||
          !(claim.ownershipMarker === undefined ||
            (typeof claim.ownershipMarker === 'string' && AGENT_TAB_MARKER_PATTERN.test(claim.ownershipMarker)))) {
        throw new Error('Safari claim registry contains invalid lease metadata; mutation fails closed');
      }
    }
    return (parsed as TabClaim[]).filter(claim => (now - claim.heartbeat) < CLAIM_TTL_MS);
  }

  /**
   * Remove only one service's expired/dead claims in a locked, fresh read-modify-rename.
   * Startup cleanup must never overwrite claims admitted by another process.
   */
  static async removeStaleClaimsForService(service: string): Promise<number> {
    const normalized = service.trim();
    if (!normalized || normalized.length > 120) {
      throw new Error('Safari claim cleanup requires a bounded service name');
    }
    return TabCoordinator.withClaimsLockShared(async () => {
      const claimsFile = TabCoordinator.claimsFileForProcess();
      let raw: string;
      try {
        raw = await fs.readFile(claimsFile, 'utf-8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
        throw error;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error('Safari claim registry is corrupt; startup cleanup fails closed');
      }
      if (!Array.isArray(parsed) || parsed.some(item => !item || typeof item !== 'object' || Array.isArray(item))) {
        throw new Error('Safari claim registry is malformed; startup cleanup fails closed');
      }
      const claims = parsed as TabClaim[];
      const now = Date.now();
      const stale = (claim: TabClaim): boolean => {
        if (typeof claim.service !== 'string' ||
            typeof claim.heartbeat !== 'number' || !Number.isFinite(claim.heartbeat) ||
            !Number.isInteger(claim.pid) || claim.pid <= 1) {
          throw new Error('Safari claim registry contains invalid lease metadata; startup cleanup fails closed');
        }
        if (claim.heartbeat > now + 5_000) {
          throw new Error('Safari claim registry contains a future heartbeat; startup cleanup fails closed');
        }
        let processAlive = true;
        try { process.kill(claim.pid, 0); }
        catch (error) { processAlive = (error as NodeJS.ErrnoException).code === 'EPERM'; }
        return claim.service === normalized &&
          (now - claim.heartbeat >= CLAIM_TTL_MS || !processAlive);
      };
      const updated = claims.filter(claim => !stale(claim));
      const removed = claims.length - updated.length;
      if (removed > 0) await TabCoordinator.atomicWriteClaims(updated);
      return removed;
    });
  }

  /** Check if a specific window+tab is claimed by a DIFFERENT agent. Returns the conflicting claim or null. */
  static async getConflict(
    windowIndex: number,
    tabIndex: number,
    excludeAgentId: string
  ): Promise<TabClaim | null> {
    const claims = await TabCoordinator.listClaims();
    return claims.find(
      c => c.agentId !== excludeAgentId && c.windowIndex === windowIndex && c.tabIndex === tabIndex
    ) ?? null;
  }

  // ─── Discover ─────────────────────────────────────────────────────────────

  /**
   * Scan all open Safari tabs via AppleScript, return those matching urlPattern.
   * Filters out tabs already claimed by other agents.
   *
   * PATCHED: Queries Safari Controller (:3110) first for stable window-ID-based
   * resolution. Falls back to the original SAFARI_AUTOMATION_WINDOW scan if the
   * controller is unavailable, preserving backward compatibility.
   */
  async findAvailableTab(): Promise<(OwnedTabPosition & { url: string }) | null> {
    // ── Controller bridge (preferred) ────────────────────────────────────────
    const controllerUrl = process.env.SAFARI_CONTROLLER_URL || 'http://localhost:3110';
    try {
      const res = await fetch(`${controllerUrl}/bridge/find-tab`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urlPattern: this.urlPattern, port: this.port }),
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        const data = await res.json() as {
          found: boolean;
          windowId?: number;
          windowIndex?: number;
          tabIndex?: number;
          url?: string;
        };
        if (
          data.found && data.windowIndex != null && data.tabIndex != null &&
          !!data.url && urlMatchesPattern(data.url, this.urlPattern)
        ) {
          // Controller resolved via stable window ID — check claim conflicts as usual
          const claims = await TabCoordinator.listClaims();
          const taken = new Set(
            claims.filter(c => c.agentId !== this.agentId).map(c => `${c.windowIndex}:${c.tabIndex}`)
          );
          if (
            data.windowIndex === getAutomationWindow() &&
            data.windowId != null &&
            !taken.has(`${data.windowIndex}:${data.tabIndex}`)
          ) {
            const ownershipMarker = await this.readBoundOwnershipMarker(
              data.windowIndex, data.tabIndex, data.windowId,
            );
            if (ownershipMarker) {
              return {
                windowId: data.windowId,
                windowIndex: data.windowIndex,
                tabIndex: data.tabIndex,
                ownershipMarker,
                url: data.url ?? '',
              };
            }
          }
        }
      }
    } catch {
      // Controller unavailable — fall through to legacy scan below
    }

    // ── Legacy fallback: SAFARI_AUTOMATION_WINDOW scan ───────────────────────
    const script = `
tell application "Safari"
  set tabList to {}
  if (count of windows) >= ${getAutomationWindow()} then
    repeat with t from 1 to count of tabs of window ${getAutomationWindow()}
      try
        set u to URL of tab t of window ${getAutomationWindow()}
        set ownerMarker to do JavaScript "window.name" in tab t of window ${getAutomationWindow()}
        if u contains "${this.urlPattern.replace(/"/g, '\\"')}" and ownerMarker starts with "${AGENT_TAB_MARKER_PREFIX}" then
          set end of tabList to (((id of window ${getAutomationWindow()}) as text) & "||" & (${getAutomationWindow()} as text) & "||" & (t as text) & "||" & ownerMarker & "||" & u)
        end if
      end try
    end repeat
  end if
  return tabList
end tell`;

    let matches: Array<OwnedTabPosition & { url: string }> = [];
    try {
      const { stdout } = await execAsync(
        `osascript << 'ASEOF'\n${script}\nASEOF`,
        { timeout: 10000 }
      );
      const items = stdout.trim().split(', ').filter(Boolean);
      for (const item of items) {
        const parts = item.split('||');
        if (parts.length < 5) continue;
        const windowId = parseInt(parts[0], 10);
        const windowIndex = parseInt(parts[1], 10);
        const tabIndex = parseInt(parts[2], 10);
        const ownershipMarker = parts[3];
        const url = parts.slice(4).join('||');
        if (!isNaN(windowId) && !isNaN(windowIndex) && !isNaN(tabIndex) &&
            AGENT_TAB_MARKER_PATTERN.test(ownershipMarker)) {
          matches.push({ windowId, windowIndex, tabIndex, ownershipMarker, url });
        }
      }
    } catch {
      return null;
    }

    if (matches.length === 0) return null;

    const markerCounts = new Map<string, number>();
    for (const match of matches) {
      markerCounts.set(match.ownershipMarker, (markerCounts.get(match.ownershipMarker) ?? 0) + 1);
    }
    if ([...markerCounts.values()].some(count => count !== 1)) {
      throw new Error('Safari ownership marker is duplicated; tab discovery fails closed');
    }

    const claims = await TabCoordinator.listClaims();
    const ownership = await TabCoordinator.readOwnershipStrict();
    const ownedByMarker = new Map(ownership.map(entry => [entry.marker, entry]));
    const takenKeys = new Set(
      claims
        .filter(c => c.agentId !== this.agentId)
        .map(c => `${c.windowIndex}:${c.tabIndex}`)
    );

    return matches.find(match => {
      const entry = ownedByMarker.get(match.ownershipMarker);
      return entry?.windowId === match.windowId &&
        match.windowIndex === getAutomationWindow() &&
        !takenKeys.has(`${match.windowIndex}:${match.tabIndex}`);
    }) ?? null;
  }

  // ─── Claim lifecycle ───────────────────────────────────────────────────────

  /**
   * Claim a Safari tab.
   * If windowIndex/tabIndex are provided, claim that specific tab (throws if taken).
   * Otherwise, auto-discover the first available tab matching urlPattern.
   */
  async claim(windowIndex?: number, tabIndex?: number): Promise<TabClaim> {
    // Reserving an existing ledger-owned background tab is safe while Safari's
    // human lane is active. Allocation remains separately interactive.
    await requireBackgroundLanePermit();
    let url = '';
    let windowId: number | undefined;
    let ownershipMarker: string | undefined;

    if (windowIndex != null && tabIndex != null) {
      if (windowIndex !== getAutomationWindow()) {
        throw new Error(
          `Refusing to claim tab ${windowIndex}:${tabIndex} — not in automation window ` +
          `Only Window ${getAutomationWindow()} is the agent lane; Window 1 belongs to the human.`
        );
      }
      // Specific tab requested — check for conflict
      const conflict = await TabCoordinator.getConflict(windowIndex, tabIndex, this.agentId);
      if (conflict) {
        throw new Error(
          `Tab ${windowIndex}:${tabIndex} already claimed by '${conflict.agentId}' (${conflict.service} :${conflict.port})`
        );
      }
      windowId = await this.readWindowId(windowIndex);
      ownershipMarker = await this.readBoundOwnershipMarker(windowIndex, tabIndex, windowId) ?? undefined;
      if (!ownershipMarker) {
        throw new Error(
          `Refusing to claim Safari tab ${windowIndex}:${tabIndex} because it is not ACTP agent-owned. ` +
          'Human tabs are never adopted implicitly.'
        );
      }
      url = await this.readTabUrl(windowIndex, tabIndex, windowId);
      if (!urlMatchesPattern(url, this.urlPattern)) {
        throw new Error(
          `Refusing to claim tab ${windowIndex}:${tabIndex} because its hostname/path does not match '${this.urlPattern}'`
        );
      }
    } else {
      // Auto-discover
      const found = await this.findAvailableTab();
      if (!found) {
        // Auto-open a new Safari tab if openUrl is provided, otherwise fail with clear message
        if (this._openUrl) {
          console.log(`[TabCoordinator] No existing tab found for '${this.urlPattern}' — allocating an owned agent tab: ${this._openUrl}`);
          const newTab = await this.openNewTab(this._openUrl);
          // openNewTab reserves the recycled/new tab under the claim lock before
          // returning, so a restart drain can never observe it as unclaimed.
          await new Promise(r => setTimeout(r, 2000));
          const reserved = this._claim;
          if (
            !reserved ||
            reserved.windowId !== newTab.windowId ||
            reserved.tabIndex !== newTab.tabIndex
          ) {
            throw new Error('Safari agent tab allocation returned without an atomic claim reservation');
          }
          return reserved;
        } else {
          throw new Error(
            `No available Safari tab found matching '${this.urlPattern}'. ` +
            `Open Safari and navigate to the site, or check /tmp/safari-tab-claims.json for existing claims.`
          );
        }
      } else {
        windowIndex = found.windowIndex;
        windowId = found.windowId;
        tabIndex = found.tabIndex;
        ownershipMarker = found.ownershipMarker;
        url = found.url;
      }
    }

    if (!windowId || !ownershipMarker) {
      throw new Error('Safari claim admission lacks a durable ownership binding');
    }
    const now = Date.now();
    const newClaim: TabClaim = {
      agentId: this.agentId,
      service: this.service,
      port: this.port,
      urlPattern: this.urlPattern,
      windowIndex,
      windowId,
      tabIndex,
      tabUrl: url,
      pid: process.pid,
      claimedAt: now,
      heartbeat: now,
      agentOwned: true,
      ownershipMarker,
    };

    await this._writeClaim(newClaim, true);
    this._claim = newClaim;
    return newClaim;
  }

  /** Ensure a durable owned tab exists without leaving idle work claimed. */
  async ensureOwnedTab(windowIndex?: number, tabIndex?: number): Promise<TabClaim> {
    const claim = await this.claim(windowIndex, tabIndex);
    await this.release();
    return claim;
  }

  /** Refresh the heartbeat timestamp to keep the claim alive. Call every ~30s. */
  async heartbeat(): Promise<void> {
    if (!this._claim) return;
    if (this._operationRefs <= 0) {
      // Durable ownership belongs in the ownership ledger. An idle tab is not
      // in-flight work and must never keep a restart drain alive.
      await this.release();
      return;
    }
    await requireBackgroundLanePermit();
    const refreshedClaim = { ...this._claim, heartbeat: Date.now() };
    try {
      await this._writeClaim(refreshedClaim, false);
      this._claim = refreshedClaim;
    } catch (error) {
      // A stale/missing registry entry is not a renewable lease. In
      // particular, never resurrect it after the enforcer observed zero live
      // claims and began a restart drain. The caller must reacquire through
      // claim(), which performs fresh interactive/drain admission.
      if (String(error).includes('is no longer a live exact lease')) {
        this._claim = null;
      }
      throw error;
    }
  }

  /** Release this agent's claim. Call on clean exit. */
  async release(): Promise<void> {
    if (!this._claim) return;
    await this.withClaimsLock(async () => {
      const claims = await TabCoordinator.readClaimsStrict();
      const marker = this._claim?.ownershipMarker;
      const updated = claims.filter(c => !(
        c.agentId === this.agentId && c.pid === process.pid && c.ownershipMarker === marker
      ));
      await this._atomicWrite(updated);
    });
    this._claim = null;
    this._operationRefs = 0;
  }

  /** Acquire a real in-flight operation lease; pair with endOperation(). */
  async beginOperation(): Promise<TabClaim> {
    await requireBackgroundLanePermit();
    if (!this._claim) {
      await this.claim();
      if (!this._claim) throw new Error('Safari operation claim admission failed');
      this._operationRefs = 1;
      return this._claim;
    }
    this._operationRefs += 1;
    const refreshed = { ...this._claim, heartbeat: Date.now() };
    try {
      await this._writeClaim(refreshed, false);
      this._claim = refreshed;
      return refreshed;
    } catch (error) {
      this._operationRefs -= 1;
      throw error;
    }
  }

  /** Release the live claim as soon as the last request completes. */
  async endOperation(): Promise<void> {
    if (this._operationRefs > 0) this._operationRefs -= 1;
    if (this._operationRefs === 0) await this.release();
  }

  /** Bind one operation lease to an Express-style response lifecycle. */
  async beginRequestOperation(response: {
    once(event: 'finish' | 'close', listener: () => void): unknown;
  }): Promise<TabClaim> {
    const claim = await this.beginOperation();
    const heartbeat = setInterval(() => { void this.heartbeat().catch(() => {}); }, 15_000);
    heartbeat.unref?.();
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearInterval(heartbeat);
      void this.endOperation().catch(error => {
        console.error('[TabCoordinator] Failed to release Safari operation claim:', error);
      });
    };
    response.once('finish', finish);
    response.once('close', finish);
    return claim;
  }

  /** The active claim for this agent (null if not claimed). */
  get activeClaim(): TabClaim | null {
    return this._claim;
  }


  // ─── Open new tab ─────────────────────────────────────────────────────────

  /**
   * Open a new tab inside Safari's agent lane (Window 2). If only the human
   * window exists, create Window 2 under an interactive permit, move it behind
   * Window 1, and restore the previously-frontmost app.
   * Called automatically by claim() when no existing tab matches urlPattern.
   */
  async openNewTab(url: string): Promise<{ windowId: number; windowIndex: number; tabIndex: number }> {
    if (!urlMatchesPattern(url, this.urlPattern)) {
      throw new Error(`Refusing to allocate a market-research tab outside '${this.urlPattern}'`);
    }
    await requireInteractiveLanePermit();
    const allocation = await this.withClaimsLock(async () => {
      // The enforcer toggles its drain gate under this same fcntl lock. This
      // second read makes allocation admission atomic with restart draining.
      await requireInteractiveLanePermit();
      return this.withAllocationLock(async () => {
        await requireInteractiveLanePermit();
        const claims = await TabCoordinator.readClaimsStrict();
        let ownership = await TabCoordinator.readOwnershipStrict();
        ownership = await this.reconcileOwnership(ownership, claims);
        const reusable = await this.findReusableOwnedTab(claims, ownership);
        if (reusable) {
          await this.navigateOwnedTab(
            reusable.windowId, reusable.tabIndex, reusable.ownershipMarker, url,
          );
          const claim = this.buildClaim(reusable, url);
          const updated = claims.filter(existing => existing.agentId !== this.agentId);
          updated.push(claim);
          await this._atomicWrite(updated);
          return { ...reusable, claim };
        }

        const ownedCount = ownership.length;
        if (ownedCount >= MAX_AGENT_OWNED_TABS) {
          throw new Error(
            `Safari agent-owned tab cap reached (${MAX_AGENT_OWNED_TABS}); all owned tabs have live claims`
          );
        }

        const safeUrl = url.replace(/"/g, '\\"');
        const marker = `${AGENT_TAB_MARKER_PREFIX}${randomUUID()}`;
        const script = `
tell application "System Events"
  set priorFrontApp to name of first application process whose frontmost is true
end tell
set operationError to missing value
tell application "Safari"
  set existingWindowCount to count of windows
  if existingWindowCount is 0 then error "Safari has no human Window 1; open the singleton Safari app first"
  if existingWindowCount is greater than 2 then error "Safari window cap exceeded (2)"
  set totalTabs to 0
  repeat with browserWindow in windows
    set totalTabs to totalTabs + (count of tabs of browserWindow)
  end repeat
  if totalTabs is greater than or equal to 8 then error "Safari tab cap reached (8); reuse or close a tab"
  set createdAgentWindow to false
  if existingWindowCount is 1 then
    make new document with properties {URL:"about:blank"}
    set w to front window
    set index of w to ${getAutomationWindow()}
    set newTab to current tab of w
    set t to 1
    set createdAgentWindow to true
  else
    set w to window ${getAutomationWindow()}
    set priorTab to current tab of w
    tell w
      set newTab to make new tab at end of tabs with properties {URL:"about:blank"}
    end tell
    set t to count of tabs of w
  end if
  set wid to id of w
  try
    set markerResult to do JavaScript "window.name = '${marker}'; window.name" in newTab
    if markerResult does not start with "${AGENT_TAB_MARKER_PREFIX}" then error "Unable to mark ACTP-owned Safari tab"
    set URL of newTab to "${safeUrl}"
    if createdAgentWindow is false then set current tab of w to priorTab
  on error errorMessage
    try
      if createdAgentWindow then
        close w
      else
        close newTab
      end if
    end try
    set operationError to errorMessage
  end try
end tell
try
  if priorFrontApp is not "Safari" then
    tell application "System Events" to set frontmost of first application process whose name is priorFrontApp to true
  end if
end try
if operationError is not missing value then error operationError
return (wid as text) & "||${getAutomationWindow()}||" & (t as text)`;
        // A Window 2 allocation may transiently foreground Safari. Re-sample
        // live HID immediately before that operation so first human input wins.
        await requireInteractiveLanePermit();
        try {
          const { stdout } = await execAsync(
            `osascript << 'ASEOF'\n${script}\nASEOF`,
            { timeout: 15000 }
          );
          const parts = stdout.trim().split('||');
          const windowId = parseInt(parts[0], 10);
          const windowIndex = parseInt(parts[1], 10);
          const tabIndex = parseInt(parts[2] ?? '1', 10);
          if (isNaN(windowId) || isNaN(windowIndex) || isNaN(tabIndex)) {
            throw new Error(`Unexpected osascript output: ${stdout.trim()}`);
          }
          const position: OwnedTabPosition = {
            windowId,
            windowIndex,
            tabIndex,
            ownershipMarker: marker,
          };
          const ownershipEntry: TabOwnership = {
            marker,
            windowId,
            createdAt: Date.now(),
            agentId: this.agentId,
            service: this.service,
            pid: process.pid,
          };
          ownership = [...ownership, ownershipEntry];
          await TabCoordinator.atomicWriteOwnership(ownership);
          const claim = this.buildClaim(position, url);
          const updated = claims.filter(existing => existing.agentId !== this.agentId);
          updated.push(claim);
          try {
            await this._atomicWrite(updated);
          } catch (error) {
            const closed = await this.closeOwnedTab(
              windowIndex, tabIndex, marker, windowId,
            );
            if (closed) {
              ownership = ownership.filter(entry => entry.marker !== marker);
              await TabCoordinator.atomicWriteOwnership(ownership);
            }
            throw error;
          }
          return { ...position, claim };
        } catch (err) {
          throw new Error(`Failed to open new tab in Safari agent Window ${getAutomationWindow()} to '${url}': ${err}`);
        }
      });
    });
    this._claim = allocation.claim;
    return {
      windowId: allocation.windowId,
      windowIndex: allocation.windowIndex,
      tabIndex: allocation.tabIndex,
    };
  }

  /**
   * Pick an unclaimed ACTP-marked tab in Window 2 for recycling. Human tabs
   * are invisible to this scan. We walk newest-to-oldest so released tabs are
   * reused before growing the shared agent lane.
   */
  private async findReusableOwnedTab(
    claims: TabClaim[],
    ownership: TabOwnership[],
  ): Promise<OwnedTabPosition | null> {
    const script = `
tell application "Safari"
  if (count of windows) < ${getAutomationWindow()} then return ""
  set w to window ${getAutomationWindow()}
  set wid to id of w
  set ownedRows to {}
  repeat with t from 1 to count of tabs of w
    try
      set ownerMarker to do JavaScript "window.name" in tab t of w
      if ownerMarker starts with "${AGENT_TAB_MARKER_PREFIX}" then
        set end of ownedRows to ((wid as text) & "||${getAutomationWindow()}||" & (t as text) & "||" & ownerMarker)
      end if
    end try
  end repeat
  set AppleScript's text item delimiters to linefeed
  return ownedRows as text
end tell`;
    let stdout = '';
    try {
      ({ stdout } = await execAsync(
        `osascript << 'ASEOF'\n${script}\nASEOF`,
        { timeout: 10000 },
      ));
    } catch (error) {
      throw new Error(`Unable to inspect Safari agent-owned tabs for reuse: ${error}`);
    }

    const candidates = stdout.trim().split(/\r?\n/).filter(Boolean).map(row => {
      const [rawWindowId, rawWindowIndex, rawTabIndex, ownershipMarker] = row.split('||');
      return {
        windowId: parseInt(rawWindowId, 10),
        windowIndex: parseInt(rawWindowIndex, 10),
        tabIndex: parseInt(rawTabIndex, 10),
        ownershipMarker,
      };
    }).filter(candidate =>
      Number.isInteger(candidate.windowId) &&
      candidate.windowId > 0 &&
      candidate.windowIndex === getAutomationWindow() &&
      Number.isInteger(candidate.tabIndex) &&
      candidate.tabIndex > 0 &&
      AGENT_TAB_MARKER_PATTERN.test(candidate.ownershipMarker)
    );

    const markerCounts = new Map<string, number>();
    for (const candidate of candidates) {
      markerCounts.set(candidate.ownershipMarker, (markerCounts.get(candidate.ownershipMarker) ?? 0) + 1);
    }
    if ([...markerCounts.values()].some(count => count !== 1)) {
      throw new Error('Safari ownership marker is duplicated; tab recycling fails closed');
    }
    const ownedByMarker = new Map(ownership.map(entry => [entry.marker, entry]));

    const claimed = (candidate: OwnedTabPosition): boolean =>
      claims.some(existing => {
        if (existing.ownershipMarker) {
          return existing.ownershipMarker === candidate.ownershipMarker;
        }
        if (existing.windowId) {
          return existing.windowId === candidate.windowId && existing.tabIndex === candidate.tabIndex;
        }
        return existing.windowIndex === candidate.windowIndex && existing.tabIndex === candidate.tabIndex;
      });
    return candidates.reverse().find(candidate => {
      const entry = ownedByMarker.get(candidate.ownershipMarker);
      return entry?.windowId === candidate.windowId && !claimed(candidate);
    }) ?? null;
  }

  /**
   * Reconcile the durable ledger against a complete, successful Safari marker
   * scan. Missing/moved idle identities are demoted to human-owned instead of
   * consuming the four-tab budget forever. Live operation identities are kept
   * until release, and any duplicate marker fails closed.
   */
  private async reconcileOwnership(
    ownership: TabOwnership[],
    claims: TabClaim[],
  ): Promise<TabOwnership[]> {
    const script = `
tell application "Safari"
  set markerRows to {}
  repeat with wIndex from 1 to count of windows
    set w to window wIndex
    set wid to id of w
    repeat with t from 1 to count of tabs of w
      try
        set ownerMarker to do JavaScript "window.name" in tab t of w
      on error
        error "Unable to inspect every Safari tab ownership marker"
      end try
      if ownerMarker starts with "${AGENT_TAB_MARKER_PREFIX}" then
        set end of markerRows to ((wIndex as text) & "||" & (wid as text) & "||" & ownerMarker)
      end if
    end repeat
  end repeat
  set AppleScript's text item delimiters to linefeed
  return markerRows as text
end tell`;
    let stdout = '';
    try {
      ({ stdout } = await execAsync(`osascript << 'ASEOF'\n${script}\nASEOF`, { timeout: 10000 }));
    } catch (error) {
      throw new Error(`Unable to reconcile Safari ownership ledger safely: ${error}`);
    }
    const observed = stdout.trim().split(/\r?\n/).filter(Boolean).map(row => {
      const [rawWindowIndex, rawWindowId, marker] = row.split('||');
      return {
        windowIndex: parseInt(rawWindowIndex, 10),
        windowId: parseInt(rawWindowId, 10),
        marker,
      };
    }).filter(item =>
      Number.isInteger(item.windowIndex) && item.windowIndex > 0 &&
      Number.isInteger(item.windowId) && item.windowId > 0 &&
      AGENT_TAB_MARKER_PATTERN.test(item.marker)
    );
    const counts = new Map<string, number>();
    for (const item of observed) counts.set(item.marker, (counts.get(item.marker) ?? 0) + 1);
    if ([...counts.values()].some(count => count !== 1)) {
      throw new Error('Safari ownership marker is duplicated; reconciliation fails closed');
    }
    const observedByMarker = new Map(observed.map(item => [item.marker, item]));
    const liveMarkers = new Set(claims.map(claim => claim.ownershipMarker).filter(Boolean));
    const reconciled: TabOwnership[] = [];
    let changed = false;
    for (const entry of ownership) {
      const item = observedByMarker.get(entry.marker);
      if (item?.windowIndex === getAutomationWindow()) {
        if (item.windowId === entry.windowId) {
          reconciled.push(entry);
          continue;
        }
        if (liveMarkers.has(entry.marker)) {
          throw new Error('Live Safari operation marker changed stable window identity');
        }
        // Safari assigns new stable window IDs after a controlled relaunch.
        // The exact secret marker in agent Window 2 is the durable identity;
        // refresh only its window binding while no operation claim is live.
        reconciled.push({ ...entry, windowId: item.windowId });
        changed = true;
        continue;
      }
      if (liveMarkers.has(entry.marker)) {
        throw new Error('Live Safari operation marker disappeared or moved during reconciliation');
      }
      changed = true;
    }
    if (changed) {
      await TabCoordinator.atomicWriteOwnership(reconciled);
    }
    return reconciled;
  }

  private async navigateOwnedTab(
    windowId: number,
    tabIndex: number,
    ownershipMarker: string,
    url: string,
  ): Promise<void> {
    const safeUrl = url.replace(/"/g, '\\"');
    const safeMarker = JSON.stringify(ownershipMarker);
    const script = `
tell application "Safari"
  set w to first window whose id is ${windowId}
  if (count of tabs of w) < ${tabIndex} then error "Reusable Safari tab disappeared"
  set candidateTab to tab ${tabIndex} of w
  set ownerMarker to do JavaScript "window.name" in candidateTab
  if ownerMarker is not ${safeMarker} then error "Refusing to recycle an unowned Safari tab"
  set URL of candidateTab to "${safeUrl}"
end tell`;
    await execAsync(`osascript << 'ASEOF'\n${script}\nASEOF`, { timeout: 10000 });
  }

  private buildClaim(
    position: OwnedTabPosition,
    url: string,
  ): TabClaim {
    const now = Date.now();
    return {
      agentId: this.agentId,
      service: this.service,
      port: this.port,
      urlPattern: this.urlPattern,
      windowIndex: position.windowIndex,
      windowId: position.windowId,
      tabIndex: position.tabIndex,
      tabUrl: url,
      pid: process.pid,
      claimedAt: now,
      heartbeat: now,
      agentOwned: true,
      ownershipMarker: position.ownershipMarker,
    };
  }

  private async readTabMarker(windowIndex: number, tabIndex: number, windowId?: number): Promise<string | null> {
    const observationFile = process.env.SAFARI_OWNERSHIP_OBSERVATION_FILE;
    const testProcess = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
    if (testProcess && observationFile) {
      try {
        const rows = (await fs.readFile(observationFile, 'utf8')).split(/\r?\n/).filter(Boolean);
        const matches = rows.map(row => row.split('||')).filter(parts =>
          parts.length === 4 &&
          parseInt(parts[0], 10) === windowIndex &&
          (windowId === undefined || parseInt(parts[1], 10) === windowId) &&
          parseInt(parts[2], 10) === tabIndex &&
          AGENT_TAB_MARKER_PATTERN.test(parts[3])
        );
        return matches.length === 1 ? matches[0][3] : null;
      } catch {
        return null;
      }
    }
    const windowLookup = windowId
      ? `try\n    set w to first window whose id is ${windowId}\n  on error\n    return ""\n  end try`
      : `if (count of windows) < ${windowIndex} then return ""\n  set w to window ${windowIndex}`;
    const script = `
tell application "Safari"
  ${windowLookup}
  if (count of tabs of w) < ${tabIndex} then return ""
  try
    set ownerMarker to do JavaScript "window.name" in tab ${tabIndex} of w
    return ownerMarker
  end try
  return ""
end tell`;
    try {
      const { stdout } = await execAsync(
        `osascript << 'ASEOF'\n${script}\nASEOF`,
        { timeout: 10000 }
      );
      const marker = stdout.trim();
      return AGENT_TAB_MARKER_PATTERN.test(marker) ? marker : null;
    } catch {
      return null;
    }
  }

  private async readBoundOwnershipMarker(
    windowIndex: number,
    tabIndex: number,
    windowId?: number,
  ): Promise<string | null> {
    if (windowIndex !== getAutomationWindow()) return null;
    const stableWindowId = windowId ?? await this.readWindowId(windowIndex);
    const marker = await this.readTabMarker(windowIndex, tabIndex, stableWindowId);
    if (!marker) return null;
    const ownership = await TabCoordinator.readOwnershipStrict();
    return ownership.some(entry => entry.marker === marker && entry.windowId === stableWindowId)
      ? marker
      : null;
  }

  private async closeOwnedTab(
    windowIndex: number,
    tabIndex: number,
    ownershipMarker: string,
    windowId?: number,
  ): Promise<boolean> {
    if (!AGENT_TAB_MARKER_PATTERN.test(ownershipMarker)) return false;
    const windowLookup = windowId
      ? `set w to first window whose id is ${windowId}`
      : `set w to window ${windowIndex}`;
    const safeMarker = JSON.stringify(ownershipMarker);
    const script = `
tell application "Safari"
  try
    ${windowLookup}
    set currentWindowIndex to 0
    repeat with wIndex from 1 to count of windows
      if id of window wIndex is id of w then set currentWindowIndex to wIndex
    end repeat
    if currentWindowIndex is 1 then return "protected"
    set candidateTab to tab ${tabIndex} of w
    set ownerMarker to do JavaScript "window.name" in candidateTab
    if ownerMarker is not ${safeMarker} then return "protected"
    close candidateTab
    return "closed"
  end try
  return "protected"
end tell`;
    try {
      const { stdout } = await execAsync(
        `osascript << 'ASEOF'\n${script}\nASEOF`,
        { timeout: 10000 }
      );
      return stdout.trim() === 'closed';
    } catch {
      return false;
    }
  }

  private async readWindowId(windowIndex: number): Promise<number> {
    const script = `tell application "Safari" to return id of window ${windowIndex} as text`;
    try {
      const { stdout } = await execAsync(`osascript << 'ASEOF'\n${script}\nASEOF`, { timeout: 5000 });
      const windowId = parseInt(stdout.trim(), 10);
      if (!Number.isInteger(windowId) || windowId <= 0) throw new Error('invalid Safari window id');
      return windowId;
    } catch (error) {
      throw new Error(`Unable to resolve stable Safari Window ${windowIndex} id: ${error}`);
    }
  }

  private async readTabUrl(windowIndex: number, tabIndex: number, windowId?: number): Promise<string> {
    const windowLookup = windowId
      ? `set w to first window whose id is ${windowId}`
      : `set w to window ${windowIndex}`;
    const script = `tell application "Safari"
  ${windowLookup}
  return URL of tab ${tabIndex} of w
end tell`;
    try {
      const { stdout } = await execAsync(`osascript << 'ASEOF'\n${script}\nASEOF`, { timeout: 5000 });
      return stdout.trim();
    } catch (error) {
      throw new Error(`Unable to read Safari tab URL safely: ${error}`);
    }
  }

  private async withAllocationLock<T>(operation: () => Promise<T>): Promise<T> {
    const deadline = Date.now() + 5000;
    while (true) {
      try {
        await fs.mkdir(ALLOCATION_LOCK);
        break;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== 'EEXIST') throw err;
        try {
          const lockStat = await fs.stat(ALLOCATION_LOCK);
          if (Date.now() - lockStat.mtimeMs > ALLOCATION_LOCK_STALE_MS) {
            await fs.rmdir(ALLOCATION_LOCK).catch(() => {});
            continue;
          }
        } catch { /* lock changed between checks */ }
        if (Date.now() >= deadline) throw new Error('Timed out waiting for Safari agent-tab allocation lock');
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    try {
      return await operation();
    } finally {
      await fs.rmdir(ALLOCATION_LOCK).catch(() => {});
    }
  }

  /**
   * Take the same advisory fcntl lock used by safari-control-broker.py.
   * A tiny Python guardian owns the descriptor while Node performs the
   * read-modify-rename; pipe EOF releases it even if this process crashes.
   */
  private async withClaimsLock<T>(operation: () => Promise<T>): Promise<T> {
    return TabCoordinator.withClaimsLockShared(operation);
  }

  private static async withClaimsLockShared<T>(operation: () => Promise<T>): Promise<T> {
    const guard = spawn(
      '/usr/bin/python3',
      ['-c', CLAIM_LOCK_GUARD, TabCoordinator.claimsLockForProcess(), String(CLAIM_LOCK_TIMEOUT_SECONDS)],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
    guard.stdout.setEncoding('utf8');
    guard.stderr.setEncoding('utf8');
    let stdout = '';
    let stderr = '';
    guard.stderr.on('data', chunk => { stderr += String(chunk); });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        guard.kill('SIGTERM');
        reject(new Error('Timed out acquiring Safari claim registry lock'));
      }, (CLAIM_LOCK_TIMEOUT_SECONDS + 1) * 1000);
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve();
      };
      guard.once('error', error => finish(error));
      guard.once('exit', code => {
        if (!settled) finish(new Error(`Safari claim lock guard exited (${code}): ${stdout}${stderr}`));
      });
      guard.stdout.on('data', chunk => {
        stdout += String(chunk);
        const line = stdout.split(/\r?\n/, 1)[0];
        if (line === 'LOCKED') finish();
        else if (line.startsWith('ERROR:')) finish(new Error(line.slice('ERROR:'.length)));
      });
    });

    try {
      return await operation();
    } finally {
      guard.stdin.end();
      const exited = once(guard, 'exit').then(() => undefined);
      await Promise.race([
        exited,
        new Promise<void>(resolve => setTimeout(() => {
          guard.kill('SIGTERM');
          resolve();
        }, 1000)),
      ]);
    }
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  private async _writeClaim(claim: TabClaim, admission: boolean): Promise<void> {
    await this.withClaimsLock(async () => {
      // Atomic with the enforcer's drain-state transition under this lock.
      // Existing-tab background admission is allowed during human presence,
      // but no admission or heartbeat is allowed once drain is published.
      await requireBackgroundLanePermit();
      if (!claim.windowId || !AGENT_TAB_MARKER_PATTERN.test(claim.ownershipMarker)) {
        throw new Error('Safari claim lacks a durable ownership marker and stable window id');
      }
      const ownership = await TabCoordinator.readOwnershipStrict();
      const entry = ownership.find(item => item.marker === claim.ownershipMarker);
      if (!entry || entry.windowId !== claim.windowId) {
        throw new Error('Safari claim marker is not bound in the durable ownership ledger');
      }
      // Tab ordinals are mutable. Verify the exact marker on every admission
      // and heartbeat so a closed/reordered tab can never renew a lease that
      // now points at a human or another agent's page.
      const actualMarker = await this.readTabMarker(
        claim.windowIndex, claim.tabIndex, claim.windowId,
      );
      if (actualMarker !== claim.ownershipMarker) {
        throw new Error(
          admission
            ? 'Safari tab marker changed before atomic claim admission'
            : 'Safari claim is no longer bound to its exact tab marker; heartbeat fails closed',
        );
      }
      const claims = await TabCoordinator.readClaimsStrict();
      const conflict = claims.find(existing => {
        if (existing.agentId === claim.agentId) return false;
        if (existing.ownershipMarker && claim.ownershipMarker) {
          return existing.ownershipMarker === claim.ownershipMarker;
        }
        if (existing.windowId && claim.windowId) {
          return existing.windowId === claim.windowId && existing.tabIndex === claim.tabIndex;
        }
        return existing.windowIndex === claim.windowIndex && existing.tabIndex === claim.tabIndex;
      });
      if (conflict) {
        throw new Error(
          `Tab ${claim.windowIndex}:${claim.tabIndex} already claimed by ` +
          `'${conflict.agentId}' (${conflict.service} :${conflict.port})`
        );
      }
      const sameTarget = (existing: TabClaim): boolean => {
        if (existing.agentId !== claim.agentId || existing.pid !== claim.pid) return false;
        if (existing.ownershipMarker || claim.ownershipMarker) {
          return existing.ownershipMarker === claim.ownershipMarker;
        }
        if (existing.tabIndex !== claim.tabIndex) return false;
        if (existing.windowId && claim.windowId) return existing.windowId === claim.windowId;
        return existing.windowIndex === claim.windowIndex;
      };
      const exactIdx = claims.findIndex(sameTarget);
      if (!admission && exactIdx < 0) {
        throw new Error(
          `Safari claim '${claim.agentId}' is no longer a live exact lease; ` +
          'heartbeat cannot recreate it. Call claim() for fresh interactive admission.'
        );
      }
      if (exactIdx >= 0) {
        claims[exactIdx] = claim;
      } else {
        // Only a newly admitted claim may append to the registry. Remove a
        // prior lease for the same agent before recording its new target.
        const withoutPriorAgent = claims.filter(c => c.agentId !== claim.agentId);
        withoutPriorAgent.push(claim);
        await this._atomicWrite(withoutPriorAgent);
        return;
      }
      await this._atomicWrite(claims);
    });
  }

  private async _atomicWrite(claims: TabClaim[]): Promise<void> {
    return TabCoordinator.atomicWriteClaims(claims);
  }

  private static async atomicWriteClaims(claims: TabClaim[]): Promise<void> {
    // Write to temp file then rename — atomic on same filesystem
    const claimsFile = TabCoordinator.claimsFileForProcess();
    const tmp = `${claimsFile}.tmp.${process.pid}.${randomUUID()}`;
    await fs.writeFile(tmp, JSON.stringify(claims, null, 2), { mode: 0o600 });
    await fs.chmod(tmp, 0o600);
    await fs.rename(tmp, claimsFile);
  }

  private static async atomicWriteOwnership(ownership: TabOwnership[]): Promise<void> {
    // The caller holds CLAIMS_LOCK_FILE, so the claims and durable ownership
    // ledgers form one serialized admission transaction across all processes.
    const ownershipFile = TabCoordinator.ownershipFileForProcess();
    const tmp = `${ownershipFile}.tmp.${process.pid}.${randomUUID()}`;
    await fs.writeFile(
      tmp,
      JSON.stringify({ version: 1, entries: ownership }, null, 2),
      { mode: 0o600 },
    );
    await fs.chmod(tmp, 0o600);
    await fs.rename(tmp, ownershipFile);
  }
}
