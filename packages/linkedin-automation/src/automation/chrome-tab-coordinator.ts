/**
 * Chrome target coordinator compatibility adapter.
 *
 * Cross-process claims are retired. Local Chrome access remains routed through
 * the separately resource-capped browser broker; this adapter never serializes
 * agents or writes a registry file.
 *
 * Usage:
 *   const coord = new ChromeTabCoordinator('li-dm-123', 'linkedin-chrome', 3105, 'linkedin.com');
 *   const claim = await coord.claim();
 *   await coord.heartbeat();   // every ~30s
 *   await coord.release();     // on clean exit
 */

/** @deprecated no Chrome claim registry exists. */
export const CHROME_CLAIMS_FILE = '';
export const CLAIM_TTL_MS = 60_000;
const CHROME_CDP_BASE = 'http://127.0.0.1:9222';
const MAX_CHROME_TABS = 8;
function rawBrowserDisabled(): boolean { return true; }

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
    return [];
  }

  static async getConflict(
    windowIndex: number,
    tabIndex: number,
    excludeAgentId: string
  ): Promise<ChromeTabClaim | null> {
    void windowIndex;
    void tabIndex;
    void excludeAgentId;
    return null;
  }

  // ─── Discover ─────────────────────────────────────────────────────────────

  async findAvailableTab(): Promise<{ windowIndex: number; tabIndex: number; url: string } | null> {
    if (rawBrowserDisabled()) throw Object.assign(
      new Error('Legacy direct-CDP claims are disabled; use the browser broker'),
      { code: 'RAW_BROWSER_AUTOMATION_DISABLED' },
    );
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

    return matches[0] ?? null;
  }

  // ─── Claim lifecycle ───────────────────────────────────────────────────────

  async claim(windowIndex?: number, tabIndex?: number): Promise<ChromeTabClaim> {
    if (rawBrowserDisabled()) throw Object.assign(
      new Error('Legacy direct-CDP claims are disabled; use the browser broker'),
      { code: 'RAW_BROWSER_AUTOMATION_DISABLED' },
    );
    let url = '';

    if (windowIndex != null && tabIndex != null) {
      url = this.urlPattern;
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
            `Open Chrome and navigate to the site, or use the resource-capped browser broker.`
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

    this._claim = newClaim;
    return newClaim;
  }

  async heartbeat(): Promise<void> {
    if (!this._claim) return;
    this._claim.heartbeat = Date.now();
  }

  async release(): Promise<void> {
    if (!this._claim) return;
    this._claim = null;
  }

  get activeClaim(): ChromeTabClaim | null {
    return this._claim;
  }

  // ─── Open new tab ─────────────────────────────────────────────────────────

  async openNewTab(url: string): Promise<{ windowIndex: number; tabIndex: number }> {
    if (rawBrowserDisabled()) throw Object.assign(
      new Error('Legacy direct-CDP tab allocation is disabled; use the browser broker'),
      { code: 'RAW_BROWSER_AUTOMATION_DISABLED' },
    );
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

}
