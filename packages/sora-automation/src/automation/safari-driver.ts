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

export class SafariDriver {
  private trackedWindow: number | null = null;
  private trackedTab: number | null = null;
  private readonly timeout: number;

  constructor(opts: { timeout?: number } = {}) {
    this.timeout = opts.timeout ?? 60_000;
  }

  setTrackedTab(windowIndex: number, tabIndex: number): void {
    this.trackedWindow = windowIndex;
    this.trackedTab = tabIndex;
  }

  private get tabSpec(): string {
    return (this.trackedWindow && this.trackedTab)
      ? `tab ${this.trackedTab} of window ${this.trackedWindow}`
      : 'front document';
  }

  async executeJS(js: string): Promise<string> {
    const tmp = path.join(os.tmpdir(), `sora-js-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.js`);
    await fs.writeFile(tmp, js.trim());
    const script = `
      set jsCode to read POSIX file "${tmp}" as «class utf8»
      tell application "Safari" to do JavaScript jsCode in ${this.tabSpec}
    `;
    try {
      const { stdout } = await execAsync(
        `osascript -e '${script.replace(/'/g, "'\"'\"'")}'`,
        { timeout: this.timeout }
      );
      await fs.unlink(tmp).catch(() => {});
      return stdout.trim();
    } catch (err) {
      await fs.unlink(tmp).catch(() => {});
      throw err;
    }
  }

  async navigateTo(url: string): Promise<boolean> {
    try {
      const safe = url.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      if (this.trackedWindow && this.trackedTab) {
        await execAsync(
          `osascript -e 'tell application "Safari" to set URL of tab ${this.trackedTab} of window ${this.trackedWindow} to "${safe}"'`,
          { timeout: this.timeout }
        );
      } else {
        await execAsync(
          `osascript -e 'tell application "Safari" to set URL of front document to "${safe}"'`,
          { timeout: this.timeout }
        );
      }
      await this.wait(2500);
      return true;
    } catch {
      return false;
    }
  }

  async getCurrentUrl(): Promise<string> {
    try {
      const { stdout } = await execAsync(
        `osascript -e 'tell application "Safari" to get URL of ${this.tabSpec}'`
      );
      return stdout.trim();
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
    const safe = url.replace(/"/g, '\\"');
    const script = `
tell application "Safari"
  activate
  make new document with properties {URL:"${safe}"}
  delay 1
  set w to index of window 1
  return w as text
end tell`;
    const { stdout } = await execAsync(`osascript << 'ASEOF'\n${script}\nASEOF`, { timeout: 15_000 });
    const windowIndex = parseInt(stdout.trim(), 10);
    if (isNaN(windowIndex)) throw new Error(`Unexpected osascript output: ${stdout.trim()}`);
    return { windowIndex, tabIndex: 1 };
  }

  /**
   * Find a tab whose URL matches pattern across all Safari windows.
   */
  async findTab(urlPattern: string): Promise<{ windowIndex: number; tabIndex: number; url: string } | null> {
    const safe = urlPattern.replace(/"/g, '\\"');
    const script = `
tell application "Safari"
  set tabList to {}
  repeat with w in windows
    repeat with t from 1 to count of tabs of w
      set u to URL of tab t of w
      if u contains "${safe}" then
        set end of tabList to ((index of w as text) & "||" & (t as text) & "||" & u)
      end if
    end repeat
  end repeat
  return tabList
end tell`;
    try {
      const { stdout } = await execAsync(`osascript << 'ASEOF'\n${script}\nASEOF`, { timeout: 10_000 });
      const items = stdout.trim().split(', ').filter(Boolean);
      for (const item of items) {
        const parts = item.split('||');
        if (parts.length >= 3) {
          return { windowIndex: parseInt(parts[0], 10), tabIndex: parseInt(parts[1], 10), url: parts.slice(2).join('||') };
        }
      }
    } catch { /* Safari not running */ }
    return null;
  }
}

let _defaultDriver: SafariDriver | null = null;
export function getDefaultDriver(): SafariDriver {
  if (!_defaultDriver) _defaultDriver = new SafariDriver();
  return _defaultDriver;
}
