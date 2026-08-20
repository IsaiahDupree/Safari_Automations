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

import * as fs from 'fs/promises';

export const CHROME_CLAIMS_FILE = '/tmp/chrome-tab-claims.json';
export const CLAIM_TTL_MS = 60_000;
const CHROME_CDP_BASE = 'http://127.0.0.1:9222';
const MAX_CHROME_TABS = 8;

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
    let matches: Array<{ windowIndex: number; tabIndex: number; url: string }> = [];
    try {
      const response = await fetch(`${CHROME_CDP_BASE}/json/list`);
      if (!response.ok) throw new Error(`CDP returned ${response.status}`);
      const targets = await response.json() as Array<{ type?: string; url?: string }>;
      matches = targets
        .filter(target => target.type === 'page' && String(target.url || '').includes(this.urlPattern))
        .map((target, index) => ({ windowIndex: 1, tabIndex: index + 1, url: String(target.url || '') }));
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
    try {
      const listResponse = await fetch(`${CHROME_CDP_BASE}/json/list`);
      if (!listResponse.ok) throw new Error(`CDP returned ${listResponse.status}`);
      const before = await listResponse.json() as Array<{ type?: string }>;
      const pageCount = before.filter(target => target.type === 'page').length;
      if (pageCount >= MAX_CHROME_TABS) {
        throw new Error(`Chrome tab cap reached (${pageCount}/${MAX_CHROME_TABS})`);
      }
      const createResponse = await fetch(
        `${CHROME_CDP_BASE}/json/new?${encodeURIComponent(url)}`,
        { method: 'PUT' },
      );
      if (!createResponse.ok) throw new Error(`CDP tab create returned ${createResponse.status}`);
      return { windowIndex: 1, tabIndex: pageCount + 1 };
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
