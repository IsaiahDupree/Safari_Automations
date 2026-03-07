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

import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';

const execAsync = promisify(exec);

export const CLAIMS_FILE = '/tmp/safari-tab-claims.json';
export const CLAIM_TTL_MS = 60_000; // 60s — claim expires if no heartbeat

// ── Phase A: automation window enforcement ─────────────────────────────────
// Read at call time (not module load time) so dotenv override takes effect.
// Set SAFARI_AUTOMATION_WINDOW=2 in .env (matches the automation profile window).
export function getAutomationWindow(): number {
  return parseInt(process.env.SAFARI_AUTOMATION_WINDOW || '1', 10);
}
/** @deprecated use getAutomationWindow() — kept for backward compat */
export const AUTOMATION_WINDOW = 0; // placeholder, not used internally

export interface TabClaim {
  agentId: string;        // unique, e.g. 'ig-sync-20240304-32396'
  service: string;        // 'instagram-dm', 'twitter-dm', 'tiktok-dm', etc.
  port: number;           // server port (3100, 3003, 3102, …)
  urlPattern: string;     // e.g. 'instagram.com/direct'
  windowIndex: number;    // Safari window index (1-based)
  tabIndex: number;       // Safari tab index within that window (1-based)
  tabUrl: string;         // actual URL at claim time
  pid: number;            // OS PID — watchdog can verify with kill -0
  claimedAt: number;      // epoch ms
  heartbeat: number;      // epoch ms — refresh every ~30s to keep claim alive
}

export class TabCoordinator {
  private agentId: string;
  private service: string;
  private port: number;
  private urlPattern: string;
  private _openUrl: string | null;
  private _claim: TabClaim | null = null;

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

  /** Read all non-expired claims from the shared registry. */
  static async listClaims(): Promise<TabClaim[]> {
    try {
      const raw = await fs.readFile(CLAIMS_FILE, 'utf-8');
      const all: TabClaim[] = JSON.parse(raw);
      const now = Date.now();
      return all.filter(c => (now - c.heartbeat) < CLAIM_TTL_MS);
    } catch {
      return [];
    }
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
   */
  async findAvailableTab(): Promise<{ windowIndex: number; tabIndex: number; url: string } | null> {
    // Phase A: only scan the designated automation window
    const script = `
tell application "Safari"
  set tabList to {}
  if (count of windows) >= ${getAutomationWindow()} then
    repeat with t from 1 to count of tabs of window ${getAutomationWindow()}
      try
        set u to URL of tab t of window ${getAutomationWindow()}
        if u contains "${this.urlPattern.replace(/"/g, '\\"')}" then
          set end of tabList to ((${getAutomationWindow()} as text) & "||" & (t as text) & "||" & u)
        end if
      end try
    end repeat
  end if
  return tabList
end tell`;

    let matches: Array<{ windowIndex: number; tabIndex: number; url: string }> = [];
    try {
      const { stdout } = await execAsync(
        `osascript << 'ASEOF'\n${script}\nASEOF`,
        { timeout: 10000 }
      );
      // AppleScript list items come back comma-separated
      const items = stdout.trim().split(', ').filter(Boolean);
      for (const item of items) {
        const parts = item.split('||');
        if (parts.length < 3) continue;
        const windowIndex = parseInt(parts[0], 10);
        const tabIndex = parseInt(parts[1], 10);
        const url = parts.slice(2).join('||');
        if (!isNaN(windowIndex) && !isNaN(tabIndex)) {
          matches.push({ windowIndex, tabIndex, url });
        }
      }
    } catch {
      // Safari not running or AppleScript permissions not granted
      return null;
    }

    if (matches.length === 0) return null;

    // Filter out tabs already claimed by other agents
    const claims = await TabCoordinator.listClaims();
    const takenKeys = new Set(
      claims
        .filter(c => c.agentId !== this.agentId)
        .map(c => `${c.windowIndex}:${c.tabIndex}`)
    );

    return matches.find(m => !takenKeys.has(`${m.windowIndex}:${m.tabIndex}`)) ?? null;
  }

  // ─── Claim lifecycle ───────────────────────────────────────────────────────

  /**
   * Claim a Safari tab.
   * If windowIndex/tabIndex are provided, claim that specific tab (throws if taken).
   * Otherwise, auto-discover the first available tab matching urlPattern.
   */
  async claim(windowIndex?: number, tabIndex?: number): Promise<TabClaim> {
    let url = '';

    if (windowIndex != null && tabIndex != null) {
      // Phase A: enforce automation window
      if (windowIndex !== getAutomationWindow()) {
        throw new Error(
          `Refusing to claim tab ${windowIndex}:${tabIndex} — not in automation window ` +
          `(SAFARI_AUTOMATION_WINDOW=${getAutomationWindow()}). ` +
          `Only Window ${getAutomationWindow()} is the designated automation profile.`
        );
      }
      // Specific tab requested — check for conflict
      const conflict = await TabCoordinator.getConflict(windowIndex, tabIndex, this.agentId);
      if (conflict) {
        throw new Error(
          `Tab ${windowIndex}:${tabIndex} already claimed by '${conflict.agentId}' (${conflict.service} :${conflict.port})`
        );
      }
    } else {
      // Auto-discover
      const found = await this.findAvailableTab();
      if (!found) {
        // Auto-open a new Safari tab if openUrl is provided, otherwise fail with clear message
        if (this._openUrl) {
          console.log(`[TabCoordinator] No existing tab found for '${this.urlPattern}' — opening new tab: ${this._openUrl}`);
          const newTab = await this.openNewTab(this._openUrl);
          // Wait for page to load before claiming
          await new Promise(r => setTimeout(r, 2000));
          windowIndex = newTab.windowIndex;
          tabIndex = newTab.tabIndex;
          url = this._openUrl;
        } else {
          throw new Error(
            `No available Safari tab found matching '${this.urlPattern}'. ` +
            `Open Safari and navigate to the site, or check /tmp/safari-tab-claims.json for existing claims.`
          );
        }
      } else {
        windowIndex = found.windowIndex;
        tabIndex = found.tabIndex;
        url = found.url;
      }
    }

    const now = Date.now();
    const newClaim: TabClaim = {
      agentId: this.agentId,
      service: this.service,
      port: this.port,
      urlPattern: this.urlPattern,
      windowIndex,
      tabIndex,
      tabUrl: url,
      pid: process.pid,
      claimedAt: now,
      heartbeat: now,
    };

    await this._writeClaim(newClaim);
    this._claim = newClaim;
    return newClaim;
  }

  /** Refresh the heartbeat timestamp to keep the claim alive. Call every ~30s. */
  async heartbeat(): Promise<void> {
    if (!this._claim) return;
    this._claim.heartbeat = Date.now();
    await this._writeClaim(this._claim);
  }

  /** Release this agent's claim. Call on clean exit. */
  async release(): Promise<void> {
    if (!this._claim) return;
    const claims = await TabCoordinator.listClaims();
    const updated = claims.filter(c => c.agentId !== this.agentId);
    await this._atomicWrite(updated);
    this._claim = null;
  }

  /** The active claim for this agent (null if not claimed). */
  get activeClaim(): TabClaim | null {
    return this._claim;
  }


  // ─── Open new tab ─────────────────────────────────────────────────────────

  /**
   * Open a new tab inside the automation window (AUTOMATION_WINDOW) navigated to `url`.
   * Phase A: never opens a new Safari window — always uses the designated automation window.
   * Returns { windowIndex, tabIndex } of the new tab.
   * Called automatically by claim() when no existing tab matches urlPattern.
   */
  async openNewTab(url: string): Promise<{ windowIndex: number; tabIndex: number }> {
    const safeUrl = url.replace(/"/g, '\\"');
    const script = `
tell application "Safari"
  if (count of windows) < ${getAutomationWindow()} then
    error "Automation window ${getAutomationWindow()} is not open — open Safari and navigate to the automation profile"
  end if
  set w to window ${getAutomationWindow()}
  tell w
    set newTab to make new tab with properties {URL:"${safeUrl}"}
    activate
  end tell
  set t to count of tabs of w
  return ("${getAutomationWindow()}||" & t)
end tell`;
    try {
      const { stdout } = await execAsync(
        `osascript << 'ASEOF'\n${script}\nASEOF`,
        { timeout: 15000 }
      );
      const parts = stdout.trim().split('||');
      const windowIndex = parseInt(parts[0], 10);
      const tabIndex = parseInt(parts[1] ?? '1', 10);
      if (isNaN(windowIndex) || isNaN(tabIndex)) throw new Error(`Unexpected osascript output: ${stdout.trim()}`);
      return { windowIndex, tabIndex };
    } catch (err) {
      throw new Error(`Failed to open new tab in automation window ${getAutomationWindow()} to '${url}': ${err}`);
    }
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  private async _writeClaim(claim: TabClaim): Promise<void> {
    const claims = await TabCoordinator.listClaims();
    const idx = claims.findIndex(c => c.agentId === claim.agentId);
    if (idx >= 0) {
      claims[idx] = claim;
    } else {
      claims.push(claim);
    }
    await this._atomicWrite(claims);
  }

  private async _atomicWrite(claims: TabClaim[]): Promise<void> {
    // Write to temp file then rename — atomic on same filesystem
    const tmp = `${CLAIMS_FILE}.tmp.${process.pid}`;
    await fs.writeFile(tmp, JSON.stringify(claims, null, 2));
    await fs.rename(tmp, CLAIMS_FILE);
  }
}
