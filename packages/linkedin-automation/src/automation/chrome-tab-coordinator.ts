/**
 * ChromeTabCoordinator — Cross-process Chrome tab claim registry.
 *
 * Parallel to TabCoordinator (safari-tab-claims.json) but targets Google Chrome.
 * Claims are stored in /tmp/chrome-tab-claims.json.
 * Claims expire after CLAIM_TTL_MS without a heartbeat.
 *
 * Usage:
 *   const coord = new ChromeTabCoordinator('li-dm-123', 'linkedin-chrome', 3105, 'linkedin.com');
 *   const claim = await coord.claim();
 *   await coord.heartbeat();   // every ~30s
 *   await coord.release();     // on clean exit
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';

const execAsync = promisify(exec);

export const CHROME_CLAIMS_FILE = '/tmp/chrome-tab-claims.json';
export const CLAIM_TTL_MS = 60_000;

export interface ChromeTabClaim {
  agentId: string;
  service: string;
  port: number;
  urlPattern: string;
  windowIndex: number;
  tabIndex: number;
  tabUrl: string;
  pid: number;
  claimedAt: number;
  heartbeat: number;
}

export class ChromeTabCoordinator {
  private agentId: string;
  private service: string;
  private port: number;
  private urlPattern: string;
  private _openUrl: string | null;
  private _claim: ChromeTabClaim | null = null;

  constructor(agentId: string, service: string, port: number, urlPattern: string, openUrl?: string) {
    this.agentId = agentId;
    this.service = service;
    this.port = port;
    this.urlPattern = urlPattern;
    this._openUrl = openUrl ?? null;
  }

  // ─── Read ─────────────────────────────────────────────────────────────────

  static async listClaims(): Promise<ChromeTabClaim[]> {
    try {
      const raw = await fs.readFile(CHROME_CLAIMS_FILE, 'utf-8');
      const all: ChromeTabClaim[] = JSON.parse(raw);
      const now = Date.now();
      return all.filter(c => (now - c.heartbeat) < CLAIM_TTL_MS);
    } catch {
      return [];
    }
  }

  static async getConflict(
    windowIndex: number,
    tabIndex: number,
    excludeAgentId: string
  ): Promise<ChromeTabClaim | null> {
    const claims = await ChromeTabCoordinator.listClaims();
    return claims.find(
      c => c.agentId !== excludeAgentId && c.windowIndex === windowIndex && c.tabIndex === tabIndex
    ) ?? null;
  }

  // ─── Discover ─────────────────────────────────────────────────────────────

  async findAvailableTab(): Promise<{ windowIndex: number; tabIndex: number; url: string } | null> {
    const script = `
tell application "Google Chrome"
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
      return null;
    }

    if (matches.length === 0) return null;

    const claims = await ChromeTabCoordinator.listClaims();
    const takenKeys = new Set(
      claims
        .filter(c => c.agentId !== this.agentId)
        .map(c => `${c.windowIndex}:${c.tabIndex}`)
    );

    return matches.find(m => !takenKeys.has(`${m.windowIndex}:${m.tabIndex}`)) ?? null;
  }

  // ─── Claim lifecycle ───────────────────────────────────────────────────────

  async claim(windowIndex?: number, tabIndex?: number): Promise<ChromeTabClaim> {
    let url = '';

    if (windowIndex != null && tabIndex != null) {
      const conflict = await ChromeTabCoordinator.getConflict(windowIndex, tabIndex, this.agentId);
      if (conflict) {
        throw new Error(
          `Chrome tab ${windowIndex}:${tabIndex} already claimed by '${conflict.agentId}' (${conflict.service} :${conflict.port})`
        );
      }
    } else {
      const found = await this.findAvailableTab();
      if (!found) {
        if (this._openUrl) {
          console.log(`[ChromeTabCoordinator] No tab for '${this.urlPattern}' — opening: ${this._openUrl}`);
          const newTab = await this.openNewTab(this._openUrl);
          await new Promise(r => setTimeout(r, 2000));
          windowIndex = newTab.windowIndex;
          tabIndex = newTab.tabIndex;
          url = this._openUrl;
        } else {
          throw new Error(
            `No available Chrome tab matching '${this.urlPattern}'. ` +
            `Open Chrome and navigate to the site, or check ${CHROME_CLAIMS_FILE} for existing claims.`
          );
        }
      } else {
        windowIndex = found.windowIndex;
        tabIndex = found.tabIndex;
        url = found.url;
      }
    }

    const now = Date.now();
    const newClaim: ChromeTabClaim = {
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

  async heartbeat(): Promise<void> {
    if (!this._claim) return;
    this._claim.heartbeat = Date.now();
    await this._writeClaim(this._claim);
  }

  async release(): Promise<void> {
    if (!this._claim) return;
    const claims = await ChromeTabCoordinator.listClaims();
    const updated = claims.filter(c => c.agentId !== this.agentId);
    await this._atomicWrite(updated);
    this._claim = null;
  }

  get activeClaim(): ChromeTabClaim | null {
    return this._claim;
  }

  // ─── Open new tab ─────────────────────────────────────────────────────────

  async openNewTab(url: string): Promise<{ windowIndex: number; tabIndex: number }> {
    const safeUrl = url.replace(/"/g, '\\"');
    const script = `
tell application "Google Chrome"
  activate
  tell window 1
    make new tab with properties {URL:"${safeUrl}"}
    set w to count of windows
    set t to count of tabs of window 1
    return ((w as text) & "||" & (t as text))
  end tell
end tell`;
    try {
      const { stdout } = await execAsync(
        `osascript << 'ASEOF'\n${script}\nASEOF`,
        { timeout: 15000 }
      );
      const parts = stdout.trim().split('||');
      const windowIndex = parseInt(parts[0], 10);
      const tabIndex = parseInt(parts[1], 10);
      if (isNaN(windowIndex) || isNaN(tabIndex)) throw new Error(`Unexpected output: ${stdout.trim()}`);
      return { windowIndex, tabIndex };
    } catch (err) {
      throw new Error(`Failed to open Chrome tab to '${url}': ${err}`);
    }
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  private async _writeClaim(claim: ChromeTabClaim): Promise<void> {
    const claims = await ChromeTabCoordinator.listClaims();
    const idx = claims.findIndex(c => c.agentId === claim.agentId);
    if (idx >= 0) {
      claims[idx] = claim;
    } else {
      claims.push(claim);
    }
    await this._atomicWrite(claims);
  }

  private async _atomicWrite(claims: ChromeTabClaim[]): Promise<void> {
    const tmp = `${CHROME_CLAIMS_FILE}.tmp.${process.pid}`;
    await fs.writeFile(tmp, JSON.stringify(claims, null, 2));
    await fs.rename(tmp, CHROME_CLAIMS_FILE);
  }
}
