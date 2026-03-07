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

    // Use two separate -e flags to avoid shell escaping issues with «class utf8»
    const readCmd = `set jsCode to read POSIX file "${tempFile}" as «class utf8»`;
    const execCmd = `tell application "Safari" to do JavaScript jsCode in ${tabSpec}`;

    try {
      const { stdout } = await execAsync(
        `osascript -e '${readCmd.replace(/'/g, "'\"'\"'")}' -e '${execCmd.replace(/'/g, "'\"'\"'")}'`,
        { timeout: this.config.timeout, maxBuffer: 1024 * 1024 }
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
   * Detect login state with multiple signal layers.
   * Returns 'logged_in' | 'login_page' | 'captcha' | 'unknown'
   */
  async detectLoginState(): Promise<'logged_in' | 'login_page' | 'captcha' | 'unknown'> {
    try {
      const result = await this.executeJS(`
        (function() {
          var url = window.location.href;
          // Logged-in signals
          var findWork = document.querySelector('a[href*="find-work"]');
          var avatar = document.querySelector('[data-test="avatar"], img.nav-avatar, .nav-d-profile, [data-cy="nav-user-avatar"], [data-test="user-avatar"]');
          var myJobs = document.querySelector('a[href*="my-jobs"]');
          var clientNav = document.querySelector('a[href*="hiring"]');
          if (findWork || avatar || myJobs || clientNav) return 'logged_in';
          // Login page signals
          var emailInput = document.querySelector('input#login_username, input[name="login[username]"], input[type="email"][autocomplete="username"]');
          var loginHeading = document.querySelector('h1.air3-heading');
          if (emailInput || (url.includes('/ab/account-security/login') || url.includes('/login'))) return 'login_page';
          // Captcha / 2FA
          var captcha = document.querySelector('iframe[src*="captcha"], #cf-challenge-running, .h-captcha, #challenge-form');
          var twoFa = document.querySelector('input[name="login[otp]"], input[placeholder*="verification"]');
          if (captcha) return 'captcha';
          if (twoFa) return 'two_fa';
          return 'unknown';
        })()
      `);
      return (result as 'logged_in' | 'login_page' | 'captcha' | 'unknown') || 'unknown';
    } catch {
      return 'unknown';
    }
  }

  /**
   * Check if logged in to Upwork.
   * Looks for Upwork-specific nav elements that only appear when authenticated.
   */
  async isLoggedIn(): Promise<boolean> {
    const state = await this.detectLoginState();
    return state === 'logged_in';
  }

  /**
   * Sign in to Upwork using stored credentials.
   * Handles: email step → password step → post-login verification.
   * Returns: 'success' | 'already_logged_in' | 'captcha' | 'two_fa' | 'failed'
   */
  async signIn(email: string, password: string): Promise<'success' | 'already_logged_in' | 'captcha' | 'two_fa' | 'failed'> {
    try {
      // Check current state first
      const currentUrl = await this.getCurrentUrl();
      if (!currentUrl.includes('upwork.com')) {
        await this.navigateTo('https://www.upwork.com');
        await this.wait(2000);
      }

      let state = await this.detectLoginState();
      if (state === 'logged_in') {
        console.log('[safari-driver] Already logged in');
        return 'already_logged_in';
      }
      if (state === 'captcha') return 'captcha';

      // Navigate to login page if not already there
      if (state !== 'login_page') {
        await this.navigateTo('https://www.upwork.com/ab/account-security/login');
        await this.wait(2500);
        state = await this.detectLoginState();
      }

      // Step 1: Enter email
      const emailFilled = await this.typeViaJS(
        'input#login_username, input[name="login[username]"], input[type="email"][autocomplete="username"]',
        email,
      );
      if (!emailFilled) {
        console.warn('[safari-driver] Could not find email input');
        return 'failed';
      }
      await this.wait(500);

      // Click Continue / Submit email form
      const continueClicked = await this.clickElement(
        'button[type="submit"], button#login_password_continue, button[data-test="continue-with-email"]',
      );
      if (!continueClicked) {
        await this.keyboardActivate(
          'input#login_username, input[name="login[username]"]',
          'Enter',
        );
      }
      await this.wait(2000);

      // Step 2: Enter password (may be on same page or new page)
      const passwordVisible = await this.waitForElement(
        'input#login_password, input[name="login[password]"], input[type="password"]',
        6000,
      );
      if (!passwordVisible) {
        const midState = await this.detectLoginState();
        if (midState === 'logged_in') return 'success';
        if (midState === 'captcha') return 'captcha';
        console.warn('[safari-driver] Password field not found after email submit');
        return 'failed';
      }

      const pwFilled = await this.typeViaJS(
        'input#login_password, input[name="login[password]"], input[type="password"]',
        password,
      );
      if (!pwFilled) return 'failed';
      await this.wait(500);

      // Uncheck "keep me logged out" if present
      await this.executeJS(`
        var logoutCb = document.querySelector('input[name="login[keepMeLoggedOut]"]');
        if (logoutCb && logoutCb.checked) logoutCb.click();
      `);

      // Submit password
      const submitClicked = await this.clickElement(
        'button#login_control_continue, button[type="submit"][data-test="submit"], button[data-ev-label="submit"]',
      );
      if (!submitClicked) {
        await this.keyboardActivate(
          'input#login_password, input[type="password"]',
          'Enter',
        );
      }

      // Wait for navigation / post-login
      await this.wait(4000);

      const finalState = await this.detectLoginState();
      if (finalState === 'logged_in') {
        console.log('[safari-driver] Sign in successful');
        return 'success';
      }
      if (finalState === 'captcha') {
        console.warn('[safari-driver] Captcha encountered after login');
        return 'captcha';
      }
      // Check for 2FA
      const twoFaField = await this.executeJS(
        `document.querySelector('input[name="login[otp]"]') ? 'yes' : 'no'`,
      );
      if (twoFaField === 'yes') {
        console.warn('[safari-driver] 2FA required — manual action needed');
        return 'two_fa';
      }

      console.warn('[safari-driver] Login state after submit:', finalState);
      return 'failed';
    } catch (err) {
      console.error('[safari-driver] signIn error:', (err as Error).message);
      return 'failed';
    }
  }

  /**
   * Ensure logged in — check state, auto-sign-in if not.
   * Uses UPWORK_EMAIL / UPWORK_PASSWORD from env.
   */
  async ensureLoggedIn(): Promise<boolean> {
    const state = await this.detectLoginState();
    if (state === 'logged_in') return true;

    const email = process.env.UPWORK_EMAIL || '';
    const password = process.env.UPWORK_PASSWORD || '';
    if (!email || !password) {
      console.warn('[safari-driver] No UPWORK_EMAIL/UPWORK_PASSWORD in env — cannot auto-login');
      return false;
    }

    const result = await this.signIn(email, password);
    return result === 'success' || result === 'already_logged_in';
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
   * Click at a specific viewport position using OS-level click.
   * Needed for Upwork's masked inputs that ignore JS clicks.
   * Safari toolbar offset (URL bar + tab bar) is ~92px.
   */
  async clickAtViewportPosition(x: number, y: number): Promise<boolean> {
    if (this.config.instanceType !== 'local') return false;
    try {
      await this.activateSafari();
      await this.wait(200);
      // Get Safari window position to convert viewport coords to screen coords
      const { stdout: posInfo } = await execAsync(
        `osascript -e 'tell application "Safari" to get bounds of front window'`
      );
      const bounds = posInfo.trim().split(',').map((s: string) => parseInt(s.trim()));
      const winX = bounds[0] || 0;
      const winY = bounds[1] || 0;
      const TOOLBAR_OFFSET = 92; // Safari URL bar + tab bar height
      const screenX = winX + x;
      const screenY = winY + TOOLBAR_OFFSET + y;

      // Use cliclick for precise OS-level clicking
      try {
        await execAsync(`cliclick c:${screenX},${screenY}`);
      } catch {
        // Fallback to AppleScript click
        await execAsync(
          `osascript -e 'tell application "System Events" to click at {${screenX}, ${screenY}}'`
        );
      }
      return true;
    } catch (error) {
      if (this.config.verbose) console.error('[SafariDriver] clickAtViewportPosition error:', error);
      return false;
    }
  }

  /**
   * Type text via clipboard paste (Cmd+V).
   * Used for Upwork's masked/formatted inputs that ignore JS value changes.
   */
  async typeViaClipboard(text: string): Promise<boolean> {
    if (this.config.instanceType !== 'local') return false;
    try {
      // Set clipboard content
      await execAsync(`echo -n "${text.replace(/"/g, '\\"')}" | pbcopy`);
      await this.wait(100);
      // Cmd+A to select all, then Cmd+V to paste
      await execAsync(
        `osascript -e 'tell application "System Events" to tell process "Safari" to keystroke "a" using command down'`
      );
      await this.wait(100);
      await execAsync(
        `osascript -e 'tell application "System Events" to tell process "Safari" to keystroke "v" using command down'`
      );
      return true;
    } catch (error) {
      if (this.config.verbose) console.error('[SafariDriver] typeViaClipboard error:', error);
      return false;
    }
  }

  /**
   * Press Tab key via AppleScript to move focus between form fields.
   * @param times - number of times to press Tab (default 1)
   */
  async pressTab(times = 1): Promise<boolean> {
    if (this.config.instanceType !== 'local') return false;
    try {
      for (let i = 0; i < times; i++) {
        await execAsync(
          `osascript -e 'tell application "System Events" to tell process "Safari" to keystroke (ASCII character 9)'`
        );
        await this.wait(150);
      }
      return true;
    } catch { return false; }
  }

  /**
   * Activate a focusable element using keyboard events (no screen coordinates).
   * Focuses element, dispatches keydown+keyup, falls back to .click().
   * More reliable than coordinate-based clicks for React modal buttons.
   */
  async keyboardActivate(selector: string, key: 'Enter' | 'Space' = 'Enter'): Promise<boolean> {
    const keyChar = key === 'Space' ? ' ' : 'Enter';
    const keyCode = key === 'Space' ? 32 : 13;
    const keyCode2 = key === 'Space' ? "'Space'" : "'Enter'";
    const result = await this.executeJS(`
      (function() {
        var sel = '${selector.replace(/'/g, "\\'")}';
        var el = document.querySelector(sel);
        if (!el) return 'not_found';
        el.scrollIntoView({ block: 'center' });
        el.focus();
        var opts = { bubbles: true, cancelable: true, key: '${keyChar}', keyCode: ${keyCode}, code: ${keyCode2} };
        el.dispatchEvent(new KeyboardEvent('keydown', opts));
        el.dispatchEvent(new KeyboardEvent('keyup', opts));
        el.click();
        return 'activated';
      })()
    `);
    return result === 'activated';
  }

  /** Press a named key in the active Safari window (return, space, escape). */
  async pressKey(key: 'space' | 'return' | 'tab' | 'escape'): Promise<boolean> {
    if (this.config.instanceType !== 'local') return false;
    const keyCodes: Record<string, number> = { space: 49, return: 36, tab: 48, escape: 53 };
    try {
      await execAsync(
        `osascript -e 'tell application "System Events" to tell process "Safari" to key code ${keyCodes[key] ?? 49}'`
      );
      return true;
    } catch { return false; }
  }

  /**
   * Upload a file to a file input element by triggering the macOS file dialog
   * and typing the path via Cmd+Shift+G "Go to folder".
   * @param selector CSS selector for the file input or its parent area
   * @param filePath Absolute POSIX path to the file
   */
  async uploadFile(selector: string, filePath: string): Promise<boolean> {
    if (this.config.instanceType !== 'local') return false;
    try {
      // Step 1: Click the file input to open the file dialog
      await this.executeJS(`
        (function() {
          var input = document.querySelector('${selector.replace(/'/g, "\\'")}');
          if (!input) return 'not_found';
          input.click();
          return 'clicked';
        })()
      `);
      await this.wait(2000); // Wait for file dialog to open

      // Step 2: Open "Go to folder" sheet with Cmd+Shift+G
      await execAsync(
        `osascript -e 'tell application "System Events" to keystroke "g" using {command down, shift down}'`
      );
      await this.wait(1500);

      // Step 3: Clear existing path and type the file path
      await execAsync(
        `osascript -e 'tell application "System Events" to keystroke "a" using command down'`
      );
      await this.wait(100);
      await execAsync(
        `osascript -e 'tell application "System Events" to keystroke "${filePath.replace(/"/g, '\\"')}"'`
      );
      await this.wait(500);

      // Step 4: Press Enter to go to the path
      await execAsync(
        `osascript -e 'tell application "System Events" to keystroke return'`
      );
      await this.wait(1000);

      // Step 5: Press Enter again to select/open the file
      await execAsync(
        `osascript -e 'tell application "System Events" to keystroke return'`
      );
      await this.wait(2000);

      console.log(`[SafariDriver] File uploaded: ${filePath}`);
      return true;
    } catch (error) {
      if (this.config.verbose) console.error('[SafariDriver] uploadFile error:', error);
      return false;
    }
  }

  /**
   * Detect and attempt to bypass Cloudflare Turnstile CAPTCHA.
   * Uses Python Quartz CGEvents for human-like mouse movement + OS-level click.
   * Integrated from scripts/bypass-captcha.ts.
   * Returns true if page is clear (no CAPTCHA or successfully bypassed).
   */
  async handleCaptchaIfPresent(maxRetries: number = 4, maxWaitSec: number = 30): Promise<boolean> {
    if (this.config.instanceType !== 'local') return true;

    // Check if page is a CAPTCHA challenge
    const title = await this.executeJS('document.title').catch(() => '');
    const isCaptcha = title.toLowerCase().includes('just a moment') || title.toLowerCase().includes('attention');
    if (!isCaptcha) return true;

    console.log('[SafariDriver] 🛡️ Cloudflare CAPTCHA detected, attempting bypass...');
    await this.activateSafari();
    await this.wait(500);

    // Get Safari window origin
    let winX = 0, winY = 0;
    try {
      const { stdout } = await execAsync(
        `osascript -e 'tell application "Safari" to set b to bounds of front window' -e 'return ((item 1 of b) as text) & "," & ((item 2 of b) as text)'`
      );
      const parts = stdout.trim().split(',').map((s: string) => parseInt(s.trim()));
      winX = parts[0] || 0;
      winY = parts[1] || 0;
    } catch {}

    const TOOLBAR = 92;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      // Locate Turnstile widget
      const widgetJson = await this.executeJS(`
        (function() {
          var el = document.querySelector('iframe[src*="turnstile"]') ||
                   document.querySelector('iframe[src*="challenge"]') ||
                   document.querySelector('.cf-turnstile iframe') ||
                   document.querySelector('iframe[title*="challenge"]');
          if (el) {
            var r = el.getBoundingClientRect();
            return JSON.stringify({ x: r.left + 17, y: r.top + r.height/2, w: r.width, h: r.height });
          }
          el = document.querySelector('div.main-wrapper');
          if (el) {
            var r = el.getBoundingClientRect();
            if (r.width > 200 && r.width < 400 && r.height > 40) {
              return JSON.stringify({ x: r.left + 17, y: r.top + r.height/2, w: r.width, h: r.height });
            }
          }
          return 'none';
        })()
      `).catch(() => 'none');

      if (!widgetJson || widgetJson === 'none') {
        console.log(`[SafariDriver]   Attempt ${attempt}: widget not found, waiting...`);
        await this.wait(2000);
        continue;
      }

      let widget: { x: number; y: number; w: number; h: number };
      try { widget = JSON.parse(widgetJson); } catch { continue; }

      // Jitter per attempt
      const jX = (attempt - 1) * 3;
      const jY = (attempt - 1) * 4;
      const screenX = Math.round(winX + widget.x + jX);
      const screenY = Math.round(winY + TOOLBAR + widget.y + jY);

      console.log(`[SafariDriver]   Attempt ${attempt}: clicking (${screenX}, ${screenY})`);

      // Human-like mouse movement + click via Python Quartz
      const pyScript = `
import Quartz, time
target = (${screenX}, ${screenY})
for step in range(8):
    mx = target[0] - 200 + step * 28
    my = target[1] - 70 + step * 10
    ev = Quartz.CGEventCreateMouseEvent(None, Quartz.kCGEventMouseMoved, (mx, my), Quartz.kCGMouseButtonLeft)
    Quartz.CGEventPost(Quartz.kCGHIDEventTap, ev)
    time.sleep(0.04)
time.sleep(0.15)
down = Quartz.CGEventCreateMouseEvent(None, Quartz.kCGEventLeftMouseDown, target, Quartz.kCGMouseButtonLeft)
Quartz.CGEventPost(Quartz.kCGHIDEventTap, down)
time.sleep(0.07)
up = Quartz.CGEventCreateMouseEvent(None, Quartz.kCGEventLeftMouseUp, target, Quartz.kCGMouseButtonLeft)
Quartz.CGEventPost(Quartz.kCGHIDEventTap, up)
`;
      const tmpFile = `/tmp/captcha_click_${Date.now()}.py`;
      try {
        await fs.writeFile(tmpFile, pyScript);
        await execAsync(`python3 ${tmpFile}`, { timeout: 10000 });
      } catch {} finally {
        await fs.unlink(tmpFile).catch(() => {});
      }

      await this.wait(3000);

      // Check if resolved
      const newTitle = await this.executeJS('document.title').catch(() => '');
      if (!newTitle.toLowerCase().includes('just a moment') && !newTitle.toLowerCase().includes('attention')) {
        console.log(`[SafariDriver] ✅ CAPTCHA bypassed! Page: ${newTitle}`);
        return true;
      }
    }

    // Fall back to waiting for manual resolution
    console.log(`[SafariDriver] ⏳ Auto-click failed, waiting up to ${maxWaitSec}s for manual resolution...`);
    const start = Date.now();
    while (Date.now() - start < maxWaitSec * 1000) {
      await this.wait(3000);
      const t = await this.executeJS('document.title').catch(() => '');
      if (!t.toLowerCase().includes('just a moment') && !t.toLowerCase().includes('attention')) {
        console.log('[SafariDriver] ✅ CAPTCHA resolved.');
        return true;
      }
    }

    console.log('[SafariDriver] ❌ CAPTCHA not resolved within timeout.');
    return false;
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
   * Pin this driver to a specific Safari window+tab (called by TabCoordinator after claiming).
   */
  setTrackedTab(windowIndex: number, tabIndex: number, urlPattern: string): void {
    this.trackedWindow = windowIndex;
    this.trackedTab = tabIndex;
    console.log(`[SafariDriver] Pinned to w=${windowIndex} t=${tabIndex} (${urlPattern})`);
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
