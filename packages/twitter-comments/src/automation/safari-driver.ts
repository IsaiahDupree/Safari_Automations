/**
 * Safari Automation Driver
 * Handles low-level Safari/AppleScript interactions.
 * Works with both local and remote Safari instances.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

const execAsync = promisify(exec);

export interface AutomationConfig {
  instanceType: 'local' | 'remote';
  remoteUrl?: string;
  timeout?: number;
  actionDelay?: number;
  verbose?: boolean;
}

export interface SessionInfo {
  found: boolean;
  windowId: number;    // persistent Safari window id — stable across z-order changes
  windowIndex: number; // current z-order index — may change when windows are reordered
  tabIndex: number;
  url: string;
}

export class SafariDriver {
  private config: AutomationConfig;
  private trackedWindowId: number | null = null; // persistent Safari window id
  private trackedWindow: number | null = null;   // z-order index (informational only)
  private trackedTab: number | null = null;
  private sessionUrlPattern: string | null = null;
  private sessionLastVerified: number = 0;
  private static SESSION_VERIFY_TTL_MS = 5000; // re-verify every 5s

  constructor(config: Partial<AutomationConfig> = {}) {
    this.config = {
      instanceType: config.instanceType || 'local',
      remoteUrl: config.remoteUrl,
      timeout: config.timeout || 30000,
      actionDelay: config.actionDelay || 1000,
      verbose: config.verbose || false,
    };
  }

  /**
   * Execute JavaScript in Safari and return the result.
   */
  async executeJS(js: string): Promise<string> {
    if (this.config.instanceType === 'remote' && this.config.remoteUrl) {
      return this.executeRemoteJS(js);
    }
    return this.executeLocalJS(js);
  }

  /**
   * Execute JavaScript in local Safari via AppleScript.
   * Uses the tracked window/tab when available — avoids "front document" ambiguity.
   */
  private async executeLocalJS(js: string): Promise<string> {
    const cleanJS = js.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
    const tempFile = path.join(os.tmpdir(), `safari-js-${Date.now()}-${Math.random().toString(36).substr(2, 6)}.js`);

    await fs.writeFile(tempFile, cleanJS);

    // Use tracked tab if we have one (by persistent window id) — stable across z-order changes
    const tabSpec = (this.trackedWindowId && this.trackedTab)
      ? `tab ${this.trackedTab} of (first window whose id is ${this.trackedWindowId})`
      : 'front document';

    const script = `
      set jsCode to read POSIX file "${tempFile}" as «class utf8»
      tell application "Safari" to do JavaScript jsCode in ${tabSpec}
    `;

    try {
      const { stdout } = await execAsync(
        `osascript -e '${script.replace(/'/g, "'\"'\"'")}'`,
        { timeout: this.config.timeout }
      );
      await fs.unlink(tempFile).catch(() => {});

      if (this.config.verbose) {
        console.log(`[SafariDriver] JS in ${tabSpec}:`, stdout.trim().substring(0, 100));
      }

      return stdout.trim();
    } catch (error) {
      await fs.unlink(tempFile).catch(() => {});
      if (this.config.verbose) {
        console.error('[SafariDriver] JS error:', error);
      }
      throw error;
    }
  }

  /**
   * Execute JavaScript in a specific window+tab regardless of tracking state.
   */
  async executeJSInTab(js: string, windowIndex: number, tabIndex: number): Promise<string> {
    const cleanJS = js.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
    const tempFile = path.join(os.tmpdir(), `safari-js-${Date.now()}-${Math.random().toString(36).substr(2, 6)}.js`);
    await fs.writeFile(tempFile, cleanJS);
    const script = `
      set jsCode to read POSIX file "${tempFile}" as «class utf8»
      tell application "Safari" to do JavaScript jsCode in tab ${tabIndex} of window ${windowIndex}
    `;
    try {
      const { stdout } = await execAsync(
        `osascript -e '${script.replace(/'/g, "'\"'\"'")}'`,
        { timeout: this.config.timeout }
      );
      await fs.unlink(tempFile).catch(() => {});
      return stdout.trim();
    } catch (error) {
      await fs.unlink(tempFile).catch(() => {});
      throw error;
    }
  }

  /**
   * Execute JavaScript on remote Safari via HTTP endpoint.
   */
  private async executeRemoteJS(js: string): Promise<string> {
    if (!this.config.remoteUrl) {
      throw new Error('Remote URL not configured');
    }
    
    const response = await fetch(`${this.config.remoteUrl}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ script: js }),
    });
    
    if (!response.ok) {
      throw new Error(`Remote execution failed: ${response.statusText}`);
    }
    
    const result = await response.json() as { output?: string };
    return result.output || '';
  }

  /**
   * Navigate Safari to a URL.
   * Uses the tracked tab if available, otherwise front document.
   */
  async navigateTo(url: string): Promise<boolean> {
    try {
      const safeUrl = url.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      if (this.config.instanceType === 'local') {
        if (this.trackedWindowId && this.trackedTab) {
          await execAsync(
            `osascript -e 'tell application "Safari" to set URL of tab ${this.trackedTab} of (first window whose id is ${this.trackedWindowId}) to "${safeUrl}"'`,
            { timeout: this.config.timeout }
          );
        } else {
          await execAsync(
            `osascript -e 'tell application "Safari" to set URL of front document to "${safeUrl}"'`,
            { timeout: this.config.timeout }
          );
        }
      } else {
        await this.executeRemoteJS(`window.location.href = "${safeUrl}"`);
      }
      await this.wait(2000);
      return true;
    } catch (error) {
      if (this.config.verbose) {
        console.error('[SafariDriver] Navigation error:', error);
      }
      return false;
    }
  }

  /**
   * Get current URL from Safari.
   */
  async getCurrentUrl(): Promise<string> {
    try {
      if (this.config.instanceType === 'local') {
        const { stdout } = await execAsync(
          `osascript -e 'tell application "Safari" to get URL of front document'`
        );
        return stdout.trim();
      } else {
        return await this.executeJS('window.location.href');
      }
    } catch {
      return '';
    }
  }

  /**
   * Check if Safari is on Instagram.
   */
  async isOnInstagram(): Promise<boolean> {
    const url = await this.getCurrentUrl();
    return url.includes('instagram.com');
  }

  /**
   * Check if logged in to Instagram.
   */
  async isLoggedIn(): Promise<boolean> {
    const result = await this.executeJS(`
      (function() {
        var notLoggedIn = document.querySelector('input[name="username"]') ||
                          document.querySelector('button[type="submit"]')?.innerText?.includes('Log in');
        return notLoggedIn ? 'false' : 'true';
      })()
    `);
    return result === 'true';
  }

  /**
   * Wait for specified milliseconds.
   */
  async wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Wait for an element to appear.
   */
  async waitForElement(selector: string, maxWaitMs: number = 10000): Promise<boolean> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWaitMs) {
      const found = await this.executeJS(`
        document.querySelector('${selector}') ? 'found' : 'not_found'
      `);
      
      if (found === 'found') return true;
      await this.wait(500);
    }
    
    return false;
  }

  /**
   * Type text using OS-level keystrokes (works with React contenteditable).
   * This bypasses JavaScript event injection issues.
   */
  async typeViaKeystrokes(text: string): Promise<boolean> {
    if (this.config.instanceType !== 'local') return false;
    try {
      // Raise the tracked window specifically (not just front window) for multi-profile isolation
      if (this.trackedWindowId && this.trackedTab) {
        await this.activateTab(this.trackedWindowId, this.trackedTab);
      } else {
        await this.activateSafari();
      }
      await this.wait(300);
      const escaped = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      await execAsync(
        `osascript -e 'tell application "System Events" to tell process "Safari" to keystroke "${escaped}"'`,
        { timeout: this.config.timeout }
      );
      return true;
    } catch (error) {
      if (this.config.verbose) console.error('[SafariDriver] Keystroke error:', error);
      return false;
    }
  }

  /**
   * Press Enter key via OS-level event.
   */
  async pressEnter(): Promise<boolean> {
    if (this.config.instanceType !== 'local') return false;
    try {
      await execAsync(
        `osascript -e 'tell application "System Events" to tell process "Safari" to keystroke return'`,
        { timeout: this.config.timeout }
      );
      return true;
    } catch (error) {
      if (this.config.verbose) console.error('[SafariDriver] Enter key error:', error);
      return false;
    }
  }

  /**
   * Find a Safari tab by URL pattern across all windows.
   * Returns the first matching window+tab indices.
   */
  async findTabByUrl(urlPattern: string): Promise<SessionInfo> {
    if (this.config.instanceType !== 'local') {
      return { found: false, windowId: 0, windowIndex: 1, tabIndex: 1, url: '' };
    }
    try {
      const script = `
tell application "Safari"
  repeat with w from 1 to count of windows
    repeat with t from 1 to count of tabs of window w
      set tabURL to URL of tab t of window w
      if tabURL contains "${urlPattern}" then
        return (id of window w as text) & ":" & (w as text) & ":" & (t as text) & ":" & tabURL
      end if
    end repeat
  end repeat
  return "not_found:0:0:0:"
end tell`;
      const { stdout } = await execAsync(`osascript << 'APPLESCRIPT'\n${script}\nAPPLESCRIPT`);
      const result = stdout.trim();
      if (result.startsWith('not_found')) {
        return { found: false, windowId: 0, windowIndex: 1, tabIndex: 1, url: '' };
      }
      const parts = result.split(':');
      const wid = parseInt(parts[0], 10);
      const w = parseInt(parts[1], 10);
      const t = parseInt(parts[2], 10);
      const url = parts.slice(3).join(':');
      if (isNaN(wid) || isNaN(w) || isNaN(t)) {
        return { found: false, windowId: 0, windowIndex: 1, tabIndex: 1, url: '' };
      }
      return { found: true, windowId: wid, windowIndex: w, tabIndex: t, url };
    } catch (error) {
      if (this.config.verbose) console.error('[SafariDriver] findTabByUrl error:', error);
      return { found: false, windowId: 0, windowIndex: 1, tabIndex: 1, url: '' };
    }
  }

  /**
   * Bring a specific Safari window+tab to the foreground using its persistent window id.
   * Using window id (not index) is safe for multi-profile/multi-window scenarios —
   * other drivers' tracked sessions remain valid even as z-order changes.
   */
  async activateTab(windowId: number, tabIndex: number): Promise<boolean> {
    try {
      const script = `
tell application "Safari"
  activate
  set w to first window whose id is ${windowId}
  set current tab of w to tab ${tabIndex} of w
  set index of w to 1
end tell
tell application "System Events"
  set frontmost of process "Safari" to true
  try
    perform action "AXRaise" of front window of process "Safari"
  end try
end tell`;
      await execAsync(`osascript << 'APPLESCRIPT'\n${script}\nAPPLESCRIPT`);
      await this.wait(300);
      return true;
    } catch (error) {
      if (this.config.verbose) console.error('[SafariDriver] activateTab error:', error);
      return false;
    }
  }

  /**
   * Get the current URL of a specific Safari tab by persistent window id.
   * Used for self-healing session verification — immune to z-order changes.
   */
  async getTabUrl(windowId: number, tabIndex: number): Promise<string> {
    if (this.config.instanceType !== 'local') return '';
    try {
      const { stdout } = await execAsync(
        `osascript -e 'tell application "Safari" to get URL of tab ${tabIndex} of (first window whose id is ${windowId})'`
      );
      return stdout.trim();
    } catch {
      return '';
    }
  }

  /**
   * Verify the tracked session is still valid (tab exists and URL still matches).
   * Returns true if the session is healthy, false if it needs re-scanning.
   */
  async verifySession(urlPattern: string): Promise<boolean> {
    if (!this.trackedWindowId || !this.trackedTab) return false;
    const url = await this.getTabUrl(this.trackedWindowId, this.trackedTab);
    if (!url) {
      // Tab may have been closed — invalidate
      console.warn(`[SafariDriver] Tracked tab wid=${this.trackedWindowId} t=${this.trackedTab} is gone — resetting`);
      this.clearTrackedSession();
      return false;
    }
    if (!url.includes(urlPattern)) {
      // Tab navigated away — invalidate
      console.warn(`[SafariDriver] Tracked tab drifted: expected '${urlPattern}', got '${url}' — re-scanning`);
      this.clearTrackedSession();
      return false;
    }
    return true;
  }

  /**
   * Ensure the correct Safari tab is active before any operation.
   *
   * Self-healing flow:
   * 1. Fast path: if we have a tracked tab within TTL, verify its URL still matches.
   *    - URL OK  → re-activate and return immediately.
   *    - URL drifted / tab gone → invalidate and fall through to full scan.
   * 2. Full scan: search all Safari windows for a tab matching urlPattern.
   *    - Found  → activate, track, return.
   *    - Not found → navigate front document to the URL, wait, re-scan.
   *
   * Call this at the start of any operation that must run in a specific Safari session.
   */
  async ensureActiveSession(urlPattern: string): Promise<SessionInfo> {
    const now = Date.now();
    const withinTTL = this.trackedWindowId &&
      this.trackedTab &&
      this.sessionUrlPattern === urlPattern &&
      (now - this.sessionLastVerified) <= SafariDriver.SESSION_VERIFY_TTL_MS;

    if (withinTTL && this.trackedWindowId && this.trackedTab) {
      // Self-healing fast path: verify URL before trusting cached tab
      const stillValid = await this.verifySession(urlPattern);
      if (stillValid) {
        await this.activateTab(this.trackedWindowId, this.trackedTab);
        this.sessionLastVerified = now;
        return { found: true, windowId: this.trackedWindowId, windowIndex: this.trackedWindow ?? 1, tabIndex: this.trackedTab, url: '' };
      }
      // Session drifted — clearTrackedSession() already called in verifySession
    }

    // Full scan
    const info = await this.findTabByUrl(urlPattern);

    if (info.found) {
      await this.activateTab(info.windowId, info.tabIndex);
      this.trackedWindowId = info.windowId;
      this.trackedWindow = info.windowIndex;
      this.trackedTab = info.tabIndex;
      this.sessionUrlPattern = urlPattern;
      this.sessionLastVerified = now;
      if (this.config.verbose) {
        console.log(`[SafariDriver] Session locked: wid=${info.windowId} w=${info.windowIndex} t=${info.tabIndex} url=${info.url}`);
      }
      return info;
    }

    // Not found — create session by navigating in front document
    console.warn(`[SafariDriver] No tab found for '${urlPattern}' — navigating front document`);
    await this.navigateTo(`https://www.${urlPattern}`);
    await this.wait(2500);

    const retry = await this.findTabByUrl(urlPattern);
    if (retry.found) {
      await this.activateTab(retry.windowId, retry.tabIndex);
      this.trackedWindowId = retry.windowId;
      this.trackedWindow = retry.windowIndex;
      this.trackedTab = retry.tabIndex;
      this.sessionUrlPattern = urlPattern;
      this.sessionLastVerified = now;
    }
    return retry;
  }

  /**
   * Return current tracked session info for diagnostics.
   */
  getSessionInfo(): { windowId: number | null; windowIndex: number | null; tabIndex: number | null; urlPattern: string | null; lastVerified: number } {
    return {
      windowId: this.trackedWindowId,
      windowIndex: this.trackedWindow,
      tabIndex: this.trackedTab,
      urlPattern: this.sessionUrlPattern,
      lastVerified: this.sessionLastVerified,
    };
  }

  /**
   * Clear the tracked session (e.g. after a Safari restart).
   */
  clearTrackedSession(): void {
    this.trackedWindowId = null;
    this.trackedWindow = null;
    this.trackedTab = null;
    this.sessionUrlPattern = null;
    this.sessionLastVerified = 0;
  }

  /**
   * Bring Safari to the foreground (generic — no tab targeting).
   */
  async activateSafari(): Promise<boolean> {
    try {
      const script = `
tell application "Safari" to activate
delay 0.2
tell application "System Events"
  set frontmost of process "Safari" to true
  try
    perform action "AXRaise" of front window of process "Safari"
  end try
end tell`;
      await execAsync(`osascript << 'APPLESCRIPT'\n${script}\nAPPLESCRIPT`);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Click an element matched by CSS selector.
   */
  async clickElement(selector: string): Promise<boolean> {
    const result = await this.executeJS(`
      (function() {
        var el = document.querySelector('${selector.replace(/'/g, "\\'")}');
        if (el) { el.click(); return 'clicked'; }
        return 'not_found';
      })()
    `);
    return result === 'clicked';
  }

  /**
   * Focus an element matched by CSS selector.
   */
  async focusElement(selector: string): Promise<boolean> {
    const result = await this.executeJS(`
      (function() {
        var el = document.querySelector('${selector.replace(/'/g, "\\'")}');
        if (el) { el.focus(); el.click(); return 'focused'; }
        return 'not_found';
      })()
    `);
    return result === 'focused';
  }

  /**
   * Take a screenshot (local only).
   */
  async takeScreenshot(outputPath: string): Promise<boolean> {
    if (this.config.instanceType !== 'local') {
      return false;
    }
    
    try {
      await execAsync(`screencapture -x "${outputPath}"`);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the current configuration.
   */
  getConfig(): AutomationConfig {
    return { ...this.config };
  }

  /**
   * Update configuration.
   */
  setConfig(config: Partial<AutomationConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

// Singleton instance for convenience
let defaultDriver: SafariDriver | null = null;

export function getDefaultDriver(): SafariDriver {
  if (!defaultDriver) {
    defaultDriver = new SafariDriver();
  }
  return defaultDriver;
}

export function setDefaultDriver(driver: SafariDriver): void {
  defaultDriver = driver;
}
