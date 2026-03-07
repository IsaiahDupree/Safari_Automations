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

export interface TabInfo {
  windowIndex: number;
  tabIndex: number;
  purpose: string;
  createdAt: number;
}

export class SafariDriver {
  private config: AutomationConfig;
  private trackedWindow: number | null = null;
  private trackedTab: number | null = null;
  private sessionUrlPattern: string | null = null;
  private sessionLastVerified: number = 0;
  private static SESSION_VERIFY_TTL_MS = 5000; // re-verify every 5s
  private static MIN_COMMAND_INTERVAL_MS = 250; // minimum gap between AppleScript commands
  private lastCommandAt: number = 0;
  private tabPool: Map<string, TabInfo> = new Map(); // purpose -> tab info

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
   * Enforce minimum inter-command delay to prevent rapid-fire AppleScript flooding.
   */
  private async throttleCommand(): Promise<void> {
    const now = Date.now();
    const gap = now - this.lastCommandAt;
    if (gap < SafariDriver.MIN_COMMAND_INTERVAL_MS) {
      await this.wait(SafariDriver.MIN_COMMAND_INTERVAL_MS - gap);
    }
    this.lastCommandAt = Date.now();
  }

  /**
   * Execute JavaScript in local Safari via AppleScript.
   * Uses the tracked window/tab when available — avoids "front document" ambiguity.
   */
  private async executeLocalJS(js: string): Promise<string> {
    await this.throttleCommand();
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
   * Navigate to a LinkedIn profile via Google search result.
   * Bypasses bot detection that sometimes triggers on direct profile navigation.
   */
  async navigateViaGoogle(linkedinProfileUrl: string): Promise<boolean> {
    try {
      // Extract profile slug from LinkedIn URL
      const slug = linkedinProfileUrl.split('/in/')[1]?.replace(/\/$/, '') ?? '';
      if (!slug) {
        if (this.config.verbose) console.error('[SafariDriver] Invalid LinkedIn profile URL');
        return false;
      }

      // Navigate to Google search for this profile
      const query = encodeURIComponent(`site:linkedin.com/in ${slug}`);
      const googleUrl = `https://www.google.com/search?q=${query}`;

      if (this.config.verbose) console.log(`[SafariDriver] Searching Google for: ${slug}`);
      await this.navigateTo(googleUrl);

      // Wait for Google search results to load
      const searchReady = await this.waitForCondition(
        `(function(){return document.querySelector('#search')?'ready':'';})()`,
        8000
      );

      if (!searchReady) {
        if (this.config.verbose) console.error('[SafariDriver] Google search did not load');
        return false;
      }

      // Find the LinkedIn result link and get its position
      const coords = await this.executeJS(`
        (function() {
          var links = document.querySelectorAll("a[href*='linkedin.com/in']");
          for (var i = 0; i < links.length; i++) {
            var href = links[i].href || '';
            if (href.includes('linkedin.com/in/') && !href.includes('google.com')) {
              var r = links[i].getBoundingClientRect();
              if (r.width > 0 && r.height > 0) {
                return JSON.stringify({x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2)});
              }
            }
          }
          return '';
        })()
      `);

      if (!coords) {
        if (this.config.verbose) console.error('[SafariDriver] No LinkedIn result found on Google');
        return false;
      }

      const pos = JSON.parse(coords);
      if (this.config.verbose) console.log(`[SafariDriver] Clicking LinkedIn result at (${pos.x}, ${pos.y})`);

      // Click the LinkedIn result using native click
      const clicked = await this.clickAtViewportPosition(pos.x, pos.y);
      if (!clicked) {
        if (this.config.verbose) console.error('[SafariDriver] Failed to click LinkedIn result');
        return false;
      }

      // Wait for LinkedIn to load
      const linkedInReady = await this.waitForCondition(
        `(function(){return location.hostname.includes('linkedin.com')?'ready':'';})()`,
        10000
      );

      if (!linkedInReady) {
        if (this.config.verbose) console.error('[SafariDriver] Did not navigate to LinkedIn');
        return false;
      }

      if (this.config.verbose) console.log(`[SafariDriver] Successfully navigated to LinkedIn via Google`);
      return true;
    } catch (error) {
      if (this.config.verbose) console.error('[SafariDriver] navigateViaGoogle error:', error);
      return false;
    }
  }

  /**
   * Get current URL from Safari.
   */
  async getCurrentUrl(): Promise<string> {
    try {
      if (this.config.instanceType === 'local') {
        // Use tracked tab if available — reading "front document" returns the wrong URL
        // when LinkedIn is running in a background tab (not the active tab).
        if (this.trackedWindow && this.trackedTab) {
          return await this.getTabUrl(this.trackedWindow, this.trackedTab);
        }
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
   * Check if logged in to LinkedIn.
   * Returns true if the user is logged in, false if on authwall/login page.
   */
  async isLoggedInToLinkedIn(): Promise<boolean> {
    const url = await this.getCurrentUrl();

    // If on authwall or login page, not logged in
    if (url.includes('linkedin.com/authwall') || url.includes('linkedin.com/login')) {
      return false;
    }

    // Check for logged-in indicators
    const result = await this.executeJS(`
      (function() {
        var navMe = document.querySelector('[data-test-id="nav-settings-profileName"], .global-nav__me-photo');
        var feedContainer = document.querySelector('[data-test-id="feed-container"]');
        var globalNav = document.querySelector('.global-nav__me');
        return (navMe || feedContainer || globalNav) ? 'true' : 'false';
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
   * Wait for an element to appear using polling (legacy method).
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
   * Inject a MutationObserver into the page that watches for a selector to appear.
   * This is more efficient than polling with waitForElement.
   * Returns true if the element appears within timeoutMs, false otherwise.
   */
  async injectMutationWatcher(selector: string, timeoutMs: number = 10000): Promise<boolean> {
    const watcherId = `watcher_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const safeSelector = selector.replace(/'/g, "\\'").replace(/"/g, '\\"');

    const watcherScript = `
(function() {
  var selector = "${safeSelector}";
  var timeout = ${timeoutMs};
  var startTime = Date.now();

  // Check if element already exists
  if (document.querySelector(selector)) {
    return 'found';
  }

  return new Promise(function(resolve) {
    var observer = new MutationObserver(function(mutations) {
      if (document.querySelector(selector)) {
        observer.disconnect();
        delete window.__mcpWatcher_${watcherId};
        resolve('found');
      } else if (Date.now() - startTime > timeout) {
        observer.disconnect();
        delete window.__mcpWatcher_${watcherId};
        resolve('timeout');
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: false,
      characterData: false
    });

    window.__mcpWatcher_${watcherId} = observer;

    // Timeout fallback
    setTimeout(function() {
      if (window.__mcpWatcher_${watcherId}) {
        observer.disconnect();
        delete window.__mcpWatcher_${watcherId};
        resolve('timeout');
      }
    }, timeout);
  });
})()`;

    try {
      const result = await this.executeJS(watcherScript);
      return result === 'found';
    } catch (error) {
      if (this.config.verbose) {
        console.error('[SafariDriver] injectMutationWatcher error:', error);
      }
      return false;
    }
  }

  /**
   * Wait for a selector to appear using MutationObserver (preferred) or polling fallback.
   * This is more efficient than waitForElement for dynamic SPAs like LinkedIn.
   */
  async waitForSelector(selector: string, timeoutMs: number = 10000): Promise<boolean> {
    try {
      return await this.injectMutationWatcher(selector, timeoutMs);
    } catch (error) {
      if (this.config.verbose) {
        console.warn('[SafariDriver] MutationObserver failed, falling back to polling:', error);
      }
      return await this.waitForElement(selector, timeoutMs);
    }
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
      const js = `
(function() {
  var el = document.querySelector(${escaped.replace(/"/g, "'").replace(/^'|'$/g, '"')});
  if (!el) {
    // Try to find focused/active element
    el = document.activeElement;
  }
  if (!el) return false;
  el.focus();
  // Try execCommand first (works for contenteditable, no focus steal)
  var inserted = document.execCommand('selectAll', false, null) &&
                 document.execCommand('insertText', false, ${escaped});
  if (inserted) return true;
  // Fallback: nativeInputValueSetter for <input>/<textarea>
  try {
    var nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value') ||
                       Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
    if (nativeSetter && nativeSetter.set) {
      nativeSetter.set.call(el, ${escaped});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
  } catch(e) {}
  // Last resort: direct value set
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
   * Type text character by character — redirected to background-safe JS injection.
   */
  async typeCharByChar(text: string, _delayMs: number = 30): Promise<boolean> {
    return this.typeViaJS('', text);
  }

  /**
   * Type text by copying to clipboard and pasting (works for contenteditable).
   * Returns an object indicating success and which method was used.
   * Redirected to background-safe JS injection — no focus steal.
   */
  async typeViaClipboard(text: string): Promise<{ success: boolean; method: 'clipboard' | 'keystroke' }> {
    const ok = await this.typeViaJS('', text);
    return { success: ok, method: 'clipboard' };
  }

  // ---- UNUSED DEAD CODE BELOW (kept for reference, never called) ----
  async _typeViaClipboardLegacy(text: string): Promise<{ success: boolean; method: 'clipboard' | 'keystroke' }> {
    if (this.config.instanceType !== 'local') return { success: false, method: 'clipboard' };
    try {
      const escaped = text.replace(/"/g, '\\"').replace(/`/g, '\\`').replace(/\$/g, '\\$').replace(/%/g, '%%');
      await execAsync(`printf "%s" "${escaped}" | pbcopy`);
      await this.wait(200);
      await this.activateSafari();
      await this.wait(200);
      await execAsync(`osascript -e 'tell application "System Events" to keystroke "v" using command down'`);

      // Wait and check if the paste succeeded
      await this.wait(500);
      const contentLength = await this.executeJS(`
        (function() {
          var el = document.querySelector('[contenteditable="true"]');
          if (!el) el = document.querySelector('.msg-form__contenteditable');
          return el ? el.textContent.trim().length : 0;
        })()
      `);

      const pasteSucceeded = parseInt(contentLength || '0', 10) > 0;

      if (pasteSucceeded) {
        return { success: true, method: 'clipboard' };
      } else {
        // Paste was rejected, fall back to char-by-char typing
        if (this.config.verbose) console.log('[SafariDriver] Clipboard paste rejected, falling back to char-by-char');
        const charByCharSuccess = await this.typeCharByChar(text, 30);
        return { success: charByCharSuccess, method: 'keystroke' };
      }
    } catch (error) {
      if (this.config.verbose) console.error('[SafariDriver] typeViaClipboard error:', error);
      // Try char-by-char as fallback
      const charByCharSuccess = await this.typeCharByChar(text, 30);
      return { success: charByCharSuccess, method: 'keystroke' };
    }
  }

  /**
   * Press Enter key via OS-level event.
   */
  async pressEnter(): Promise<boolean> {
    // Redirect to background-safe JS event dispatch — no focus steal
    return this.pressEnterViaJS();
  }

  /**
   * Find a Safari tab by URL pattern — restricted to SAFARI_AUTOMATION_WINDOW only.
   * Never scans the personal profile window. Returns the first matching tab.
   */
  async findTabByUrl(urlPattern: string): Promise<SessionInfo> {
    if (this.config.instanceType !== 'local') {
      return { found: false, windowIndex: 1, tabIndex: 1, url: '' };
    }
    // Phase A: only search within the designated automation window
    const automationWindow = parseInt(process.env.SAFARI_AUTOMATION_WINDOW || '1', 10);
    try {
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
   * Pin this driver to a specific Safari window+tab (called by TabCoordinator after claiming).
   */
  setTrackedTab(windowIndex: number, tabIndex: number, urlPattern: string): void {
    this.trackedWindow = windowIndex;
    this.trackedTab = tabIndex;
    this.sessionUrlPattern = urlPattern;
    this.sessionLastVerified = 0;
    console.log(`[SafariDriver] Pinned to w=${windowIndex} t=${tabIndex} (${urlPattern})`);
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

  /**
   * Open a new Safari tab and register it in the tab pool.
   * Returns the window and tab indices of the newly opened tab.
   */
  async openTab(purpose: string, url?: string): Promise<{ windowIndex: number; tabIndex: number } | null> {
    if (this.config.instanceType !== 'local') return null;
    try {
      // Create new tab in frontmost window
      const script = `
tell application "Safari"
  tell front window
    set newTab to make new tab with properties {URL:"${url || 'about:blank'}"}
    set tabIdx to (index of newTab)
    set winIdx to (index of front window)
    return (winIdx as text) & ":" & (tabIdx as text)
  end tell
end tell`;
      const { stdout } = await execAsync(`osascript << 'APPLESCRIPT'\n${script}\nAPPLESCRIPT`);
      const parts = stdout.trim().split(':');
      const windowIndex = parseInt(parts[0], 10);
      const tabIndex = parseInt(parts[1], 10);

      if (isNaN(windowIndex) || isNaN(tabIndex)) return null;

      // Register in tab pool
      this.tabPool.set(purpose, {
        windowIndex,
        tabIndex,
        purpose,
        createdAt: Date.now(),
      });

      if (this.config.verbose) {
        console.log(`[SafariDriver] Opened tab: purpose=${purpose} w=${windowIndex} t=${tabIndex}`);
      }

      return { windowIndex, tabIndex };
    } catch (error) {
      if (this.config.verbose) console.error('[SafariDriver] openTab error:', error);
      return null;
    }
  }

  /**
   * Acquire a tab from the pool for a specific purpose.
   * If the tab doesn't exist, this will open a new one.
   */
  async acquireTab(purpose: string): Promise<TabInfo | null> {
    const existing = this.tabPool.get(purpose);
    if (existing) {
      // Verify the tab still exists
      const url = await this.getTabUrl(existing.windowIndex, existing.tabIndex);
      if (url) {
        await this.activateTab(existing.windowIndex, existing.tabIndex);
        return existing;
      } else {
        // Tab was closed, remove from pool
        this.tabPool.delete(purpose);
      }
    }

    // Open new tab
    const tab = await this.openTab(purpose);
    if (!tab) return null;

    return this.tabPool.get(purpose) || null;
  }

  /**
   * Release a tab back to the pool (currently a no-op, but could implement tab closing).
   */
  releaseTab(purpose: string): void {
    const tab = this.tabPool.get(purpose);
    if (this.config.verbose && tab) {
      console.log(`[SafariDriver] Released tab: purpose=${purpose} w=${tab.windowIndex} t=${tab.tabIndex}`);
    }
    // Keep tab in pool for reuse
  }

  /**
   * Get all tabs in the pool.
   */
  getTabPool(): TabInfo[] {
    return Array.from(this.tabPool.values());
  }

  /**
   * Close a tab from the pool.
   */
  async closeTab(purpose: string): Promise<boolean> {
    const tab = this.tabPool.get(purpose);
    if (!tab) return false;

    if (this.config.instanceType !== 'local') return false;

    try {
      const script = `tell application "Safari" to close tab ${tab.tabIndex} of window ${tab.windowIndex}`;
      await execAsync(`osascript -e '${script.replace(/'/g, "'\"'\"'")}'`);
      this.tabPool.delete(purpose);
      if (this.config.verbose) {
        console.log(`[SafariDriver] Closed tab: purpose=${purpose}`);
      }
      return true;
    } catch (error) {
      if (this.config.verbose) console.error('[SafariDriver] closeTab error:', error);
      return false;
    }
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
