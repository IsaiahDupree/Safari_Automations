/**
 * TabCoordinator — Cross-process Safari tab claim registry.
 *
 * Each agent claims a specific Safari window+tab before acting.
 * Claims are stored in /tmp/safari-tab-claims.json (readable by all agents).
 * Claims expire after CLAIM_TTL_MS without a heartbeat (handles crashed agents).
 *
 * Usage:
 *   const coord = new TabCoordinator('tw-sync-123', 'twitter-dm', 3003, 'x.com');
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

export interface TabClaim {
  agentId: string;        // unique, e.g. 'tw-sync-20240304-32396'
  service: string;        // 'instagram-dm', 'twitter-dm', 'tiktok-dm', etc.
  port: number;           // server port (3100, 3003, 3102, …)
  urlPattern: string;     // e.g. 'x.com'
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
  private _claim: TabClaim | null = null;

  constructor(agentId: string, service: string, port: number, urlPattern: string) {
    this.agentId = agentId;
    this.service = service;
    this.port = port;
    this.urlPattern = urlPattern;
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
    const script = `
tell application "Safari"
  set result to {}
  repeat with w from 1 to count of windows
    repeat with t from 1 to count of tabs of window w
      try
        set u to URL of tab t of window w
        if u contains "${this.urlPattern.replace(/"/g, '\\"')}" then
          set end of result to ((w as text) & "||" & (t as text) & "||" & u)
        end if
      end try
    end repeat
  end repeat
  return result
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
        throw new Error(
          `No available Safari tab found matching '${this.urlPattern}'. ` +
          `Open Safari and navigate to the site, or check /tmp/safari-tab-claims.json for existing claims.`
        );
      }
      windowIndex = found.windowIndex;
      tabIndex = found.tabIndex;
      url = found.url;
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
