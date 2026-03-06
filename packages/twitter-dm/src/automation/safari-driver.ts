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
import type { AutomationConfig } from './types.js';

const execAsync = promisify(exec);

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
      : (this.trackedWindow && this.trackedTab)
      ? `tab ${this.trackedTab} of window ${this.trackedWindow}`
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
        } else if (this.trackedWindow && this.trackedTab) {
          await execAsync(
            `osascript -e 'tell application "Safari" to set URL of tab ${this.trackedTab} of window ${this.trackedWindow} to "${safeUrl}"'`,
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
   * Type text into the active/focused element using document.execCommand.
   * Background-safe — no window activation required.
   */
  async typeViaJS(selector: string, text: string): Promise<boolean> {
    try {
      const escaped = JSON.stringify(text);
      const js = `(function() { var el = document.querySelector(${JSON.stringify(selector)}) || document.activeElement; if (!el) return false; el.focus(); var inserted = document.execCommand('selectAll', false, null) && document.execCommand('insertText', false, ${escaped}); if (inserted) return true; try { var ns = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value') || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value'); if (ns && ns.set) { ns.set.call(el, ${escaped}); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return true; } } catch(e) {} el.value = ${escaped}; el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`;
      const result = await this.executeJS(js);
      return result !== 'false';
    } catch (error) {
      if (this.config.verbose) console.error('[SafariDriver] typeViaJS error:', error);
      return false;
    }
  }

  /**
   * Press Enter in the active element via JavaScript events.
   * Background-safe — no window activation required.
   */
  async pressEnterViaJS(selector?: string): Promise<boolean> {
    try {
      const selectorJs = selector ? `document.querySelector(${JSON.stringify(selector)})` : 'document.activeElement';
      const js = `(function() { var el = ${selectorJs} || document.activeElement; if (!el) return false; ['keydown','keypress','keyup'].forEach(function(t) { el.dispatchEvent(new KeyboardEvent(t, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true })); }); return true; })()`;
      const result = await this.executeJS(js);
      return result !== 'false';
    } catch (error) {
      if (this.config.verbose) console.error('[SafariDriver] pressEnterViaJS error:', error);
      return false;
    }
  }

  /**
   * Type text — redirected to background-safe JS injection (no focus steal).
   */
  async typeViaKeystrokes(text: string): Promise<boolean> {
    return this.typeViaJS('', text);
  }

  /**
   * Press Enter key via OS-level event.
   */
  async pressEnter(): Promise<boolean> {
    // Redirect to background-safe JS event dispatch — no focus steal
    return this.pressEnterViaJS();
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
  /**
   * Switch to a Safari tab by window ID WITHOUT bringing Safari to the foreground.
   * Safe for background automation — does not steal focus.
   */
  async _switchToTab(windowId: number, tabIndex: number): Promise<boolean> {
    try {
      const script = `
tell application "Safari"
  set w to first window whose id is ${windowId}
  set current tab of w to tab ${tabIndex} of w
end tell`;
      await execAsync(`osascript << 'APPLESCRIPT'\n${script}\nAPPLESCRIPT`);
      return true;
    } catch (error) {
      if (this.config.verbose) console.error('[SafariDriver] _switchToTab error:', error);
      return false;
    }
  }

  /**
   * Activate Safari and bring to foreground. Only use when focus is required (e.g. keystrokes).
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
        this.sessionLastVerified = now;
        return { found: true, windowId: this.trackedWindowId, windowIndex: this.trackedWindow ?? 1, tabIndex: this.trackedTab, url: '' };
      }
      // Session drifted — clearTrackedSession() already called in verifySession
    }

    // Full scan — update tracked indices without switching tabs (no focus steal)
    const info = await this.findTabByUrl(urlPattern);

    if (info.found) {
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

    // Not found — never navigate front document (focus steal). requireTabClaim middleware handles tab opening.
    throw new Error(`[SafariDriver] No '${urlPattern}' tab found. Claim a tab via TabCoordinator before running automation.`);
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
   * Pin the driver to a specific Safari window+tab (called by tab coordinator after claiming).
   * Resolves the persistent Safari window ID from the z-order index for stable targeting.
   * Falls back to z-order targeting if AppleScript resolution fails.
   */
  async setTrackedTab(windowIndex: number, tabIndex: number, urlPattern: string): Promise<void> {
    this.trackedWindow = windowIndex;
    this.trackedTab = tabIndex;
    this.sessionUrlPattern = urlPattern;
    this.sessionLastVerified = Date.now();
    // Resolve the persistent window ID (stable across z-order changes)
    try {
      const { stdout } = await execAsync(
        `osascript -e 'tell application "Safari" to return (id of window ${windowIndex}) as text'`,
        { timeout: 5000 }
      );
      const wid = parseInt(stdout.trim(), 10);
      if (!isNaN(wid) && wid > 0) {
        this.trackedWindowId = wid;
      }
    } catch {
      // z-order fallback will be used in executeLocalJS / navigateTo
    }
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
