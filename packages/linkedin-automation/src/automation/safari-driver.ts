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
  windowIndex: number;
  tabIndex: number;
  url: string;
}

export class SafariDriver {
  private config: AutomationConfig;
  private trackedWindow: number | null = null;
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
    const cleanJS = js.trim();
    const tempFile = path.join(os.tmpdir(), `safari-js-${Date.now()}-${Math.random().toString(36).substr(2, 6)}.js`);

    await fs.writeFile(tempFile, cleanJS);

    // Use tracked tab if we have one; otherwise fall back to front document
    const tabSpec = (this.trackedWindow && this.trackedTab)
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
    const cleanJS = js.trim();
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
        if (this.trackedWindow && this.trackedTab) {
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
   * Check if Safari is on LinkedIn.
   */
  async isOnLinkedIn(): Promise<boolean> {
    const url = await this.getCurrentUrl();
    return url.includes('linkedin.com');
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
   * Human-like random delay between minMs and maxMs.
   */
  async humanDelay(minMs: number, maxMs: number): Promise<void> {
    const ms = minMs + Math.floor(Math.random() * (maxMs - minMs));
    return this.wait(ms);
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
   * Poll a JS expression until it returns a truthy, non-empty string.
   * Returns the result string on success, or '' on timeout.
   */
  async waitForCondition(jsCondition: string, maxWaitMs: number = 10000, pollMs: number = 400): Promise<string> {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      try {
        const result = await this.executeJS(jsCondition);
        if (result && result !== 'false' && result !== 'null' && result !== 'undefined') {
          return result;
        }
      } catch { /* keep polling */ }
      await this.wait(pollMs);
    }
    return '';
  }

  /**
   * Type text using OS-level keystrokes (works with React contenteditable).
   * This bypasses JavaScript event injection issues.
   */
  async typeViaKeystrokes(text: string): Promise<boolean> {
    if (this.config.instanceType !== 'local') return false;
    try {
      await this.activateSafari();
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
   * Type text by copying to clipboard and pasting (works for contenteditable).
   */
  async typeViaClipboard(text: string): Promise<boolean> {
    if (this.config.instanceType !== 'local') return false;
    try {
      const escaped = text.replace(/"/g, '\\"').replace(/`/g, '\\`').replace(/\$/g, '\\$').replace(/%/g, '%%');
      await execAsync(`printf "%s" "${escaped}" | pbcopy`);
      await this.wait(200);
      await this.activateSafari();
      await this.wait(200);
      await execAsync(`osascript -e 'tell application "System Events" to keystroke "v" using command down'`);
      return true;
    } catch (error) {
      if (this.config.verbose) console.error('[SafariDriver] typeViaClipboard error:', error);
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
      return { found: false, windowIndex: 1, tabIndex: 1, url: '' };
    }
    try {
      const script = `
tell application "Safari"
  set found to false
  repeat with w from 1 to count of windows
    repeat with t from 1 to count of tabs of window w
      set tabURL to URL of tab t of window w
      if tabURL contains "${urlPattern}" then
        return (w as text) & ":" & (t as text) & ":" & tabURL
      end if
    end repeat
  end repeat
  return "not_found:0:0:"
end tell`;
      const { stdout } = await execAsync(`osascript << 'APPLESCRIPT'\n${script}\nAPPLESCRIPT`);
      const result = stdout.trim();
      if (result.startsWith('not_found')) {
        return { found: false, windowIndex: 1, tabIndex: 1, url: '' };
      }
      const parts = result.split(':');
      const w = parseInt(parts[0], 10);
      const t = parseInt(parts[1], 10);
      const url = parts.slice(2).join(':');
      if (isNaN(w) || isNaN(t)) {
        return { found: false, windowIndex: 1, tabIndex: 1, url: '' };
      }
      return { found: true, windowIndex: w, tabIndex: t, url };
    } catch (error) {
      if (this.config.verbose) console.error('[SafariDriver] findTabByUrl error:', error);
      return { found: false, windowIndex: 1, tabIndex: 1, url: '' };
    }
  }

  /**
   * Bring a specific Safari window+tab to the foreground and make it active.
   */
  async activateTab(windowIndex: number, tabIndex: number): Promise<boolean> {
    try {
      const script = `
tell application "Safari"
  activate
  set index of window ${windowIndex} to 1
  set current tab of window ${windowIndex} to tab ${tabIndex} of window ${windowIndex}
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
   * Get the current URL of a specific Safari tab.
   * Used for self-healing session verification.
   */
  async getTabUrl(windowIndex: number, tabIndex: number): Promise<string> {
    if (this.config.instanceType !== 'local') return '';
    try {
      const { stdout } = await execAsync(
        `osascript -e 'tell application "Safari" to get URL of tab ${tabIndex} of window ${windowIndex}'`
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
    if (!this.trackedWindow || !this.trackedTab) return false;
    const url = await this.getTabUrl(this.trackedWindow, this.trackedTab);
    if (!url) {
      // Tab may have been closed — invalidate
      console.warn(`[SafariDriver] Tracked tab w=${this.trackedWindow} t=${this.trackedTab} is gone — resetting`);
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
    const withinTTL = this.trackedWindow &&
      this.trackedTab &&
      this.sessionUrlPattern === urlPattern &&
      (now - this.sessionLastVerified) <= SafariDriver.SESSION_VERIFY_TTL_MS;

    if (withinTTL && this.trackedWindow && this.trackedTab) {
      // Self-healing fast path: verify URL before trusting cached tab
      const stillValid = await this.verifySession(urlPattern);
      if (stillValid) {
        await this.activateTab(this.trackedWindow, this.trackedTab);
        this.sessionLastVerified = now;
        return { found: true, windowIndex: this.trackedWindow, tabIndex: this.trackedTab, url: '' };
      }
      // Session drifted — clearTrackedSession() already called in verifySession
    }

    // Full scan
    const info = await this.findTabByUrl(urlPattern);

    if (info.found) {
      await this.activateTab(info.windowIndex, info.tabIndex);
      this.trackedWindow = info.windowIndex;
      this.trackedTab = info.tabIndex;
      this.sessionUrlPattern = urlPattern;
      this.sessionLastVerified = now;
      if (this.config.verbose) {
        console.log(`[SafariDriver] Session locked: w=${info.windowIndex} t=${info.tabIndex} url=${info.url}`);
      }
      return info;
    }

    // Not found — create session by navigating in front document
    console.warn(`[SafariDriver] No tab found for '${urlPattern}' — navigating front document`);
    await this.navigateTo(`https://www.${urlPattern}`);
    await this.wait(2500);

    const retry = await this.findTabByUrl(urlPattern);
    if (retry.found) {
      await this.activateTab(retry.windowIndex, retry.tabIndex);
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
  getSessionInfo(): { windowIndex: number | null; tabIndex: number | null; urlPattern: string | null; lastVerified: number } {
    return {
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
   * Perform a real OS-level mouse click on an element matched by CSS selector.
   * Unlike JS .click(), this triggers Ember.js/SPA event handlers (needed for modals).
   * Gets element position via JS, then uses AppleScript System Events to click.
   */
  async nativeClickSelector(selector: string): Promise<boolean> {
    if (this.config.instanceType !== 'local') return false;
    try {
      const safeSelector = selector.replace(/'/g, "\\'").replace(/"/g, '\\"');
      const posJson = await this.executeJS(
        `(function(){var el=document.querySelector("${safeSelector}");if(!el)return '';var r=el.getBoundingClientRect();if(r.width===0||r.height===0)return '';return JSON.stringify({x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2),vw:window.innerWidth,vh:window.innerHeight});})()`
      );
      if (!posJson) return false;
      const pos = JSON.parse(posJson);

      const winInfo = await execAsync(
        `osascript -e 'tell application "Safari" to get bounds of front window'`,
        { timeout: 5000 }
      );
      const bounds = winInfo.stdout.trim().split(', ').map(Number);
      const winX = bounds[0];
      const winY = bounds[1];
      const winW = bounds[2] - bounds[0];
      const winH = bounds[3] - bounds[1];

      const toolbarOffset = winH - pos.vh;
      const screenX = winX + pos.x;
      const screenY = winY + toolbarOffset + pos.y;

      await this.activateSafari();
      await this.wait(200);

      const clickScript = `
tell application "System Events"
  click at {${screenX}, ${screenY}}
end tell`;
      await execAsync(`osascript -e '${clickScript.replace(/'/g, "'\"'\"'")}'`, { timeout: 5000 });
      return true;
    } catch (error) {
      if (this.config.verbose) console.error('[SafariDriver] nativeClick error:', error);
      return false;
    }
  }

  /**
   * Click at a viewport (CSS pixel) coordinate using a native OS-level Quartz event.
   * Used when the caller already has the element's bounding rect.
   */
  async clickAtViewportPosition(x: number, y: number): Promise<boolean> {
    if (this.config.instanceType !== 'local') return false;
    try {
      const vpJson = await this.executeJS('JSON.stringify({w:window.innerWidth,h:window.innerHeight})');
      const vp = JSON.parse(vpJson || '{"w":1200,"h":800}');
      const winInfo = await execAsync(
        `osascript -e 'tell application "Safari" to get bounds of front window'`,
        { timeout: 5000 }
      );
      const bounds = winInfo.stdout.trim().split(', ').map(Number);
      const winX = bounds[0];
      const winY = bounds[1];
      const winH = bounds[3] - bounds[1];
      const toolbarOffset = winH - vp.h;
      const screenX = winX + x;
      const screenY = winY + toolbarOffset + y;
      await this.activateSafari();
      await this.wait(200);
      const clickScript = `tell application "System Events"\n  click at {${screenX}, ${screenY}}\nend tell`;
      await execAsync(`osascript -e '${clickScript.replace(/'/g, "'\"'\"'")}'`, { timeout: 5000 });
      return true;
    } catch (error) {
      if (this.config.verbose) console.error('[SafariDriver] clickAtViewportPosition error:', error);
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
