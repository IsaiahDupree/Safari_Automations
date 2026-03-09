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
    const cleanJS = js.trim(); // preserve newlines — file-based execution handles them fine; stripping breaks // comments
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
    const cleanJS = js.trim(); // preserve newlines for same reason as executeLocalJS
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
        // Use tracked tab when available — avoids "front document" returning wrong tab
        const tabSpec = (this.trackedWindow && this.trackedTab)
          ? `tab ${this.trackedTab} of window ${this.trackedWindow}`
          : 'front document';
        const { stdout } = await execAsync(
          `osascript -e 'tell application "Safari" to get URL of ${tabSpec}'`
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

  /**
   * Type text into the focused/active element via JavaScript insertText.
   * Works in background tabs — NO focus steal, NO window activation.
   * Handles React contenteditable (Instagram, Twitter, TikTok, LinkedIn DMs).
   *
   * Falls back to execCommand insertText if nativeInputValueSetter fails.
   */
  async typeViaJS(selector: string, text: string): Promise<boolean> {
    try {
      const escaped = JSON.stringify(text);
      const escapedSel = JSON.stringify(selector);
      const js = `
(function() {
  var el = (${escapedSel} ? document.querySelector(${escapedSel}) : null) || document.activeElement;
  if (!el) return false;
  el.focus();

  var isContentEditable = el.isContentEditable || el.getAttribute('contenteditable') === 'true';

  if (isContentEditable) {
    // Strategy A: ClipboardEvent paste injection — most reliable for React contenteditable.
    // React apps (Instagram, Twitter, TikTok) handle 'paste' natively and update their
    // internal state, then re-render the DOM correctly.
    try {
      var dt = new DataTransfer();
      dt.setData('text/plain', ${escaped});
      var pasteEvt = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
      el.dispatchEvent(pasteEvt);
      if (el.textContent && el.textContent.length > 0) return true;
    } catch(ePaste) {}

    // Strategy B: execCommand('insertText') — works in some Safari versions
    var ok = document.execCommand('insertText', false, ${escaped});
    if (ok && el.textContent && el.textContent.includes(${escaped}.substring(0, 10))) return true;

    // Strategy C: textContent + full event sequence (last resort)
    el.textContent = ${escaped};
    try {
      var range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    } catch(e) {}
    try {
      el.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: ${escaped}, bubbles: true, cancelable: true }));
    } catch(e) {}
    el.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: ${escaped}, bubbles: true }));
    return el.textContent.length > 0;
  }

  // For <input>/<textarea>: use nativeInputValueSetter so React sees the change
  try {
    var nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value') ||
                       Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
    if (nativeSetter && nativeSetter.set) {
      nativeSetter.set.call(el, ${escaped});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }
  } catch(e) {}
  el.value = ${escaped};
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()
`.trim();
      const result = await this.executeJS(js.replace(/\n/g, ' '));
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
      const js = `
(function() {
  var el = ${selectorJs} || document.activeElement;
  if (!el) return false;
  ['keydown','keypress','keyup'].forEach(function(t) {
    el.dispatchEvent(new KeyboardEvent(t, {
      key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
      bubbles: true, cancelable: true
    }));
  });
  return true;
})()
`.trim();
      const result = await this.executeJS(js.replace(/\n/g, ' '));
      return result !== 'false';
    } catch (error) {
      if (this.config.verbose) console.error('[SafariDriver] pressEnterViaJS error:', error);
      return false;
    }
  }

  async typeViaKeystrokes(text: string): Promise<boolean> {
    // Redirect to background-safe JS injection — no focus steal
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
   * Press Enter via OS-level AppleScript key code 36.
   * More reliable than JS dispatchEvent for React-based inputs (Instagram, TikTok).
   */
  async pressEnterViaSafari(): Promise<boolean> {
    try {
      const w = this.trackedWindow || 1;
      const t = this.trackedTab || 1;
      // Re-activate the tracked window+tab before pressing Enter.
      // typeViaClipboard restores the previous app after pasting, so we must
      // bring Safari back to the foreground to ensure key code 36 lands in the
      // message input rather than the address bar or another element.
      const script = `
tell application "Safari"
  activate
  set index of window ${w} to 1
  set current tab of window ${w} to tab ${t} of window ${w}
  delay 0.2
end tell
tell application "System Events"
  tell process "Safari"
    key code 36
  end tell
end tell`;
      await execAsync(`osascript << 'APPLESCRIPT'\n${script}\nAPPLESCRIPT`);
      return true;
    } catch (error) {
      if (this.config?.verbose) console.error('[SafariDriver] pressEnterViaSafari error:', error);
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
      const automationWindow = parseInt(process.env.SAFARI_AUTOMATION_WINDOW || '1', 10);
    const script = `
tell application "Safari"
  if (count of windows) < ${automationWindow} then return "not_found:0:0:"
  repeat with t from 1 to count of tabs of window ${automationWindow}
    set tabURL to URL of tab t of window ${automationWindow}
    if tabURL contains "${urlPattern}" then
      return (${automationWindow} as text) & ":" & (t as text) & ":" & tabURL
    end if
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
  /**
   * Switch to a Safari tab WITHOUT bringing Safari to the foreground.
   * Safe to call during background automation — does not steal focus.
   */
  async _switchToTab(windowIndex: number, tabIndex: number): Promise<boolean> {
    try {
      const script = `
tell application "Safari"
  set current tab of window ${windowIndex} to tab ${tabIndex} of window ${windowIndex}
end tell`;
      await execAsync(`osascript << 'APPLESCRIPT'\n${script}\nAPPLESCRIPT`);
      return true;
    } catch (error) {
      if (this.config.verbose) console.error('[SafariDriver] _switchToTab error:', error);
      return false;
    }
  }

  /**
   * Activate Safari and bring it to the foreground.
   * Only call this when the user/task explicitly needs Safari focused (e.g. keystrokes).
   * For background JS automation, use _switchToTab() instead.
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
        this.sessionLastVerified = now;
        return { found: true, windowIndex: this.trackedWindow, tabIndex: this.trackedTab, url: '' };
      }
      // Session drifted — clearTrackedSession() already called in verifySession
    }

    // Full scan — update tracked indices without switching tabs (no focus steal)
    const info = await this.findTabByUrl(urlPattern);

    if (info.found) {
      this.trackedWindow = info.windowIndex;
      this.trackedTab = info.tabIndex;
      this.sessionUrlPattern = urlPattern;
      this.sessionLastVerified = now;
      if (this.config.verbose) {
        console.log(`[SafariDriver] Session locked: w=${info.windowIndex} t=${info.tabIndex} url=${info.url}`);
      }
      return info;
    }

    // Not found — never navigate front document (focus steal). requireTabClaim middleware handles tab opening.
    throw new Error(`[SafariDriver] No '${urlPattern}' tab found. Claim a tab via TabCoordinator before running automation.`);
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
   * Pin the driver to a specific Safari window+tab (called by tab coordinator after claiming).
   * All subsequent executeJS and navigateTo calls will target this exact tab.
   */
  setTrackedTab(windowIndex: number, tabIndex: number, urlPattern: string): void {
    this.trackedWindow = windowIndex;
    this.trackedTab = tabIndex;
    this.sessionUrlPattern = urlPattern;
    this.sessionLastVerified = Date.now();
  }

  /**
   * Type text using system clipboard + AppleScript paste targeting Safari directly.
   * Activates the specific Safari window+tab, pastes via Cmd+V, then returns focus to previous app.
   * Most reliable approach for React contenteditable (Instagram, Twitter, TikTok DM composers).
   */
  async typeViaClipboard(selector: string, text: string): Promise<boolean> {
    try {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execP = promisify(exec);

      // 1. Set clipboard content
      const safeText = text.replace(/'/g, "'\\''");
      await execP(`printf '%s' '${safeText}' | pbcopy`);

      // 2. Activate the tracked Safari window+tab, focus element, paste, restore focus
      const w = this.trackedWindow || 1;
      const t = this.trackedTab || 1;
      const escapedSel = selector.replace(/"/g, '\\"');
      const script = `
set prevApp to name of (info for (path to frontmost application))
tell application "Safari"
  activate
  set index of window ${w} to 1
  set current tab of window ${w} to tab ${t} of window ${w}
  delay 0.3
  do JavaScript "(function(){ var el = document.querySelector(\\"${escapedSel}\\"); if(el){ el.focus(); el.click(); } })()" in tab ${t} of window ${w}
  delay 0.2
end tell
tell application "System Events"
  tell process "Safari"
    keystroke "v" using {command down}
  end tell
end tell
delay 0.3
if prevApp is not "Safari" then
  tell application prevApp to activate
end if`;
      await execP(`osascript << 'APPLESCRIPT'\n${script}\nAPPLESCRIPT`);
      await this.wait(300);
      return true;
    } catch (error) {
      if (this.config.verbose) console.error('[SafariDriver] typeViaClipboard error:', error);
      return false;
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
