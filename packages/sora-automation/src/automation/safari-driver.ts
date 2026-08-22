/**
 * Safari Automation Driver — Sora
 * Minimal Safari/AppleScript driver scoped to sora-automation needs.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

const execAsync = promisify(exec);

async function requireSafariPermit(mode: 'background' | 'interactive'): Promise<void> {
  const clientPath = '../../../shared/safari-lane-client.js';
  const client = await import(clientPath) as { requireSafariLanePermit(mode: 'background' | 'interactive'): Promise<unknown> };
  await client.requireSafariLanePermit(mode);
}

async function resolveClaimedSafariTabIndex(
  windowId: number,
  tabIndex: number,
  mode: 'background' | 'interactive' = 'background',
): Promise<number> {
  const clientPath: string = '../../../shared/safari-lane-client.js';
  const client = await import(clientPath) as {
    resolveClaimedSafariTabIndex(
      windowId: number,
      tabIndex: number,
      expectedOwnershipMarker?: string,
      mode?: 'background' | 'interactive',
    ): Promise<number>;
  };
  return client.resolveClaimedSafariTabIndex(windowId, tabIndex, undefined, mode);
}

async function runClaimedSafariAppleScript(
  windowId: number,
  tabIndex: number,
  mode: 'background' | 'interactive',
  actionBody: string,
  options: { preamble?: string; timeoutMs?: number } = {},
): Promise<string> {
  const clientPath: string = '../../../shared/safari-lane-client.js';
  const client = await import(clientPath) as {
    runClaimedSafariAppleScript(
      windowId: number,
      tabIndex: number,
      mode: 'background' | 'interactive',
      actionBody: string,
      options?: { preamble?: string; timeoutMs?: number },
    ): Promise<string>;
  };
  return client.runClaimedSafariAppleScript(windowId, tabIndex, mode, actionBody, options);
}

export class SafariDriver {
  private trackedWindow: number | null = null;
  private trackedWindowId: number | null = null;
  private trackedTab: number | null = null;
  private readonly timeout: number;

  constructor(opts: { timeout?: number } = {}) {
    this.timeout = opts.timeout ?? 60_000;
  }

  setTrackedTab(windowIndex: number, tabIndex: number, windowId?: number): void {
    if (windowIndex !== 2 || !Number.isInteger(tabIndex) || tabIndex < 1 || !Number.isInteger(windowId) || Number(windowId) <= 0) throw new Error('Sora SafariDriver requires a stable agent Window 2 claim');
    this.trackedWindow = windowIndex;
    this.trackedWindowId = Number(windowId);
    this.trackedTab = tabIndex;
  }

  async executeJS(js: string): Promise<string> {
    if (this.trackedWindow !== 2 || !this.trackedWindowId || !this.trackedTab) throw new Error('Sora automation requires a claimed Safari agent tab in Window 2');
    const tmp = path.join(os.tmpdir(), `sora-js-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.js`);
    await fs.writeFile(tmp, js.trim());
    try {
      return await runClaimedSafariAppleScript(
        this.trackedWindowId,
        this.trackedTab,
        'background',
        'return do JavaScript jsCode in agentTab',
        { preamble: `set jsCode to read POSIX file "${tmp}" as «class utf8»`, timeoutMs: this.timeout },
      );
    } finally {
      await fs.unlink(tmp).catch(() => {});
    }
  }

  async navigateTo(url: string): Promise<boolean> {
    try {
      if (this.trackedWindow !== 2 || !this.trackedWindowId || !this.trackedTab) throw new Error('Navigation requires a stable claimed Safari agent tab');
      const safe = url.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      await runClaimedSafariAppleScript(this.trackedWindowId, this.trackedTab, 'background', `set URL of agentTab to "${safe}"`, { timeoutMs: this.timeout });
      await this.wait(2500);
      return true;
    } catch {
      return false;
    }
  }

  async getCurrentUrl(): Promise<string> {
    try {
      if (this.trackedWindow !== 2 || !this.trackedWindowId || !this.trackedTab) return '';
      return await runClaimedSafariAppleScript(this.trackedWindowId, this.trackedTab, 'background', 'return URL of agentTab');
    } catch {
      return '';
    }
  }

  async wait(ms: number): Promise<void> {
    await new Promise(r => setTimeout(r, ms));
  }

  /**
   * Open a new Safari tab and return its window+tab index.
   */
  async openNewTab(url: string): Promise<{ windowIndex: number; tabIndex: number }> {
    throw new Error(`Direct Sora tab allocation is disabled for '${url}'; use TabCoordinator`);
  }

  /**
   * Find a tab whose URL matches pattern across all Safari windows.
   */
  async findTab(urlPattern: string): Promise<{ windowIndex: number; tabIndex: number; url: string } | null> {
    if (this.trackedWindow !== 2 || !this.trackedWindowId || !this.trackedTab) return null;
    const url = await this.getCurrentUrl();
    if (url.includes(urlPattern)) return { windowIndex: 2, tabIndex: this.trackedTab, url };
    return null;
  }
}

let _defaultDriver: SafariDriver | null = null;
export function getDefaultDriver(): SafariDriver {
  if (!_defaultDriver) _defaultDriver = new SafariDriver();
  return _defaultDriver;
}
