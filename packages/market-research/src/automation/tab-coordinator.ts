/**
 * Open Safari target coordinator.
 *
 * The former cross-process claim registry and designated-window policy are
 * retired. Instances keep only local target metadata so existing callers retain
 * their API while separate agents can use independent tabs concurrently.
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/** @deprecated compatibility identifier; no registry file is read or written. */
export const CLAIMS_FILE = '';
/** @deprecated claims are process-local and do not expire. */
export const CLAIM_TTL_MS = 60_000;

/** @deprecated no Safari window is reserved for automation. */
export function getAutomationWindow(): number {
  return 1;
}

/** @deprecated no Safari window is reserved for automation. */
export const AUTOMATION_WINDOW = 0;

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

export class TabCoordinator {
  private _claim: TabClaim | null = null;

  constructor(
    private readonly agentId: string,
    private readonly service: string,
    private readonly port: number,
    private readonly urlPattern: string,
    private readonly openUrl: string | null = null,
  ) {}

  /** Compatibility method: cross-process claims no longer exist. */
  static async listClaims(): Promise<TabClaim[]> {
    return [];
  }

  /** Compatibility method: another agent never blocks this target. */
  static async getConflict(
    _windowIndex: number,
    _tabIndex: number,
    _excludeAgentId: string,
  ): Promise<TabClaim | null> {
    return null;
  }

  async findAvailableTab(): Promise<{ windowIndex: number; tabIndex: number; url: string } | null> {
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
          windowIndex?: number;
          tabIndex?: number;
          url?: string;
        };
        if (
          data.found && data.windowIndex != null && data.tabIndex != null
          && !!data.url && urlMatchesPattern(data.url, this.urlPattern)
        ) {
          return { windowIndex: data.windowIndex, tabIndex: data.tabIndex, url: data.url };
        }
      }
    } catch {
      // Fall through to direct Safari discovery.
    }

    const pattern = this.urlPattern.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const script = `
tell application "Safari"
  set tabList to {}
  repeat with w from 1 to count of windows
    repeat with t from 1 to count of tabs of window w
      try
        set u to URL of tab t of window w
        if u contains "${pattern}" then set end of tabList to ((w as text) & "||" & (t as text) & "||" & u)
      end try
    end repeat
  end repeat
  return tabList
end tell`;
    try {
      const { stdout } = await execAsync(`osascript << 'ASEOF'\n${script}\nASEOF`, { timeout: 10_000 });
      const item = stdout.trim().split(', ').find(Boolean);
      if (!item) return null;
      const parts = item.split('||');
      if (parts.length < 3) return null;
      const windowIndex = parseInt(parts[0], 10);
      const tabIndex = parseInt(parts[1], 10);
      const url = parts.slice(2).join('||');
      if (!Number.isInteger(windowIndex) || !Number.isInteger(tabIndex)) return null;
      return { windowIndex, tabIndex, url };
    } catch {
      return null;
    }
  }

  async claim(windowIndex?: number, tabIndex?: number): Promise<TabClaim> {
    let url = '';

    if (windowIndex != null && tabIndex != null) {
      url = await this.readTabUrl(windowIndex, tabIndex);
      if (!urlMatchesPattern(url, this.urlPattern)) {
        throw new Error(
          `Safari tab ${windowIndex}:${tabIndex} does not match authorized target '${this.urlPattern}'`,
        );
      }
    } else if (this.openUrl) {
      const target = await this.openNewTab(this.openUrl);
      windowIndex = target.windowIndex;
      tabIndex = target.tabIndex;
      url = this.openUrl;
    } else {
      const target = await this.findAvailableTab();
      if (!target) {
        throw new Error(`No Safari tab found matching '${this.urlPattern}' and no open URL was supplied`);
      }
      windowIndex = target.windowIndex;
      tabIndex = target.tabIndex;
      url = target.url;
    }

    const now = Date.now();
    this._claim = {
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
    return this._claim;
  }

  async heartbeat(): Promise<void> {
    if (this._claim) this._claim.heartbeat = Date.now();
  }

  async release(): Promise<void> {
    this._claim = null;
  }

  get activeClaim(): TabClaim | null {
    return this._claim;
  }

  async openNewTab(url: string): Promise<{ windowIndex: number; tabIndex: number }> {
    const safeUrl = url.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const script = `
tell application "Safari"
  if (count of windows) is 0 then
    make new document with properties {URL:"${safeUrl}"}
    set w to front window
    return ((index of w as text) & "||1")
  end if
  set w to front window
  tell w to make new tab with properties {URL:"${safeUrl}"}
  return ((index of w as text) & "||" & (count of tabs of w as text))
end tell`;
    const { stdout } = await execAsync(`osascript << 'ASEOF'\n${script}\nASEOF`, { timeout: 15_000 });
    const [windowText, tabText] = stdout.trim().split('||');
    const createdWindow = parseInt(windowText, 10);
    const createdTab = parseInt(tabText ?? '1', 10);
    if (!Number.isInteger(createdWindow) || !Number.isInteger(createdTab)) {
      throw new Error(`Unexpected Safari response while opening '${url}'`);
    }
    return { windowIndex: createdWindow, tabIndex: createdTab };
  }

  private async readTabUrl(windowIndex: number, tabIndex: number): Promise<string> {
    const script = `
tell application "Safari"
  if (count of windows) < ${windowIndex} then error "Safari window unavailable"
  if (count of tabs of window ${windowIndex}) < ${tabIndex} then error "Safari tab unavailable"
  return URL of tab ${tabIndex} of window ${windowIndex}
end tell`;
    const { stdout } = await execAsync(`osascript << 'ASEOF'\n${script}\nASEOF`, { timeout: 10_000 });
    return stdout.trim();
  }
}
