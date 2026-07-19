/**
 * Chrome/Puppeteer Driver for Instagram DM automation.
 * Replaces SafariDriver — connects to a running Chrome instance via CDP.
 *
 * Start Chrome with:
 *   /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
 *     --remote-debugging-port=9222 \
 *     --user-data-dir=~/.chrome-automation-profiles/instagram \
 *     --profile-directory=Default
 *
 * Or set INSTAGRAM_CDP_URL env var (default: http://localhost:9222).
 */

import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { execSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { AutomationConfig } from './types.js';

// ─── Chrome setup ──────────────────────────────────────────────────────────
const DEFAULT_CDP_URL = process.env['INSTAGRAM_CDP_URL'] || 'http://localhost:9222';
const DEFAULT_PROFILE_DIR = join(homedir(), '.chrome-automation-profiles', 'instagram');
const INSTAGRAM_URL_PATTERN = 'instagram.com';

const CHROME_PATHS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
];

function findChrome(): string {
  const envPath = process.env['CHROME_PATH'];
  if (envPath && existsSync(envPath)) return envPath;
  for (const p of CHROME_PATHS) {
    if (existsSync(p)) return p;
  }
  throw new Error(
    `Chrome not found. Checked: ${CHROME_PATHS.join(', ')}. Set CHROME_PATH env var.`
  );
}

// Module-level browser + page singletons (reused across requests)
let _browser: Browser | null = null;
let _page: Page | null = null;

async function connectCDP(url: string): Promise<Browser> {
  console.log(`[ChromeDriver] Connecting to Chrome at ${url}`);
  try {
    const b = await puppeteer.connect({ browserURL: url, defaultViewport: null });
    b.on('disconnected', () => {
      console.warn('[ChromeDriver] CDP browser disconnected — resetting state');
      _browser = null;
      _page = null;
    });
    console.log('[ChromeDriver] CDP connection established');
    return b;
  } catch (err) {
    throw Object.assign(
      new Error(
        `Cannot connect to Chrome at ${url}: ${(err as Error).message}. ` +
          `Make sure Chrome is running with --remote-debugging-port=9222`
      ),
      { code: 'CDP_CONNECT_FAILED' }
    );
  }
}

async function getBrowser(): Promise<Browser> {
  if (_browser && _browser.connected) return _browser;

  // Always try CDP first (connects to already-running Chrome)
  try {
    _browser = await connectCDP(DEFAULT_CDP_URL);
    return _browser;
  } catch (_cdpErr) {
    // CDP not available — launch Chrome with Instagram profile
    if (!existsSync(DEFAULT_PROFILE_DIR)) {
      mkdirSync(DEFAULT_PROFILE_DIR, { recursive: true });
    }
    const executablePath = findChrome();
    console.log(`[ChromeDriver] Launching Chrome with profile at ${DEFAULT_PROFILE_DIR}`);
    try {
      _browser = await puppeteer.launch({
        executablePath,
        headless: false,
        userDataDir: DEFAULT_PROFILE_DIR,
        args: [
          '--profile-directory=Default',
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-blink-features=AutomationControlled',
          '--disable-infobars',
          '--window-size=1400,900',
          `--remote-debugging-port=9222`,
        ],
        defaultViewport: null,
      });
      _browser.on('disconnected', () => {
        console.warn('[ChromeDriver] Browser disconnected — resetting state');
        _browser = null;
        _page = null;
      });
      return _browser;
    } catch (launchErr) {
      const msg = (launchErr as Error).message;
      if (msg.includes('user data directory is already in use')) {
        throw Object.assign(
          new Error(
            'Chrome Instagram profile is already open. Connect via CDP or close Chrome first.'
          ),
          { code: 'PROFILE_LOCKED' }
        );
      }
      throw launchErr;
    }
  }
}

/**
 * Get (or create) the Instagram page/tab.
 * Prefers an existing instagram.com tab; falls back to the last tab or a new tab.
 */
export async function getPage(): Promise<Page> {
  const b = await getBrowser();
  const pages = await b.pages();

  const igPage = pages.find(p => p.url().includes(INSTAGRAM_URL_PATTERN));
  if (igPage) {
    _page = igPage;
    return _page;
  }

  if (pages.length > 0) {
    _page = pages[pages.length - 1];
    return _page;
  }

  _page = await b.newPage();
  await _page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
  _page.on('pageerror', err =>
    console.warn('[ChromeDriver] Page JS error:', err.message)
  );
  return _page;
}

/**
 * Ensure we have an Instagram tab.
 * If not on instagram.com, navigate there.
 */
export async function ensureInstagramTab(): Promise<Page> {
  const p = await getPage();
  if (!p.url().includes(INSTAGRAM_URL_PATTERN)) {
    console.log('[ChromeDriver] Not on Instagram — navigating to inbox');
    await p.goto('https://www.instagram.com/direct/inbox/', {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
  }
  return p;
}

// ─── ChromeDriver class ────────────────────────────────────────────────────
// Matches the SafariDriver interface consumed by dm-operations.ts and server.ts.

export interface SessionInfo {
  found: boolean;
  windowIndex: number;
  tabIndex: number;
  url: string;
}

export class ChromeDriver {
  private config: AutomationConfig;

  constructor(config: Partial<AutomationConfig> = {}) {
    this.config = {
      instanceType: 'local',
      timeout: config.timeout || 30_000,
      actionDelay: config.actionDelay || 1_000,
      verbose: config.verbose || false,
    };
  }

  // ─── Core JS execution ───────────────────────────────────────────────────

  /**
   * Execute JavaScript in the Chrome Instagram tab and return the string result.
   * Mirrors SafariDriver.executeJS() — callers pass raw JS strings.
   */
  async executeJS(js: string): Promise<string> {
    const p = await getPage();
    try {
      // page.evaluate() requires a function; wrap the raw string in an IIFE
      // and stringify the return value so we always get a string back.
      const result = await p.evaluate(
        (code: string) => {
          try {
            // eslint-disable-next-line no-eval
            const val = eval(code); // intentional: reproduces Safari's `do JavaScript`
            if (val === null || val === undefined) return '';
            return String(val);
          } catch (e) {
            throw new Error(`JS eval error: ${(e as Error).message}`);
          }
        },
        js
      );
      if (this.config.verbose) {
        console.log('[ChromeDriver] executeJS result:', String(result).substring(0, 100));
      }
      return String(result ?? '');
    } catch (err) {
      if (this.config.verbose) console.error('[ChromeDriver] executeJS error:', err);
      throw err;
    }
  }

  // ─── Navigation ─────────────────────────────────────────────────────────

  async navigateTo(url: string): Promise<boolean> {
    try {
      const p = await getPage();
      await p.goto(url, { waitUntil: 'domcontentloaded', timeout: this.config.timeout });
      await this.wait(2_000);
      return true;
    } catch (err) {
      if (this.config.verbose) console.error('[ChromeDriver] navigateTo error:', err);
      return false;
    }
  }

  async getCurrentUrl(): Promise<string> {
    try {
      const p = await getPage();
      return p.url();
    } catch {
      return '';
    }
  }

  // ─── Instagram-specific checks ───────────────────────────────────────────

  async isOnInstagram(): Promise<boolean> {
    const url = await this.getCurrentUrl();
    return url.includes('instagram.com');
  }

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

  // ─── Waiting ─────────────────────────────────────────────────────────────

  async wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async waitForElement(selector: string, maxWaitMs: number = 10_000): Promise<boolean> {
    try {
      const p = await getPage();
      await p.waitForSelector(selector, { timeout: maxWaitMs });
      return true;
    } catch {
      return false;
    }
  }

  // ─── Element interaction ─────────────────────────────────────────────────

  async clickElement(selector: string): Promise<boolean> {
    try {
      const p = await getPage();
      await p.waitForSelector(selector, { timeout: 8_000 });
      await p.click(selector);
      return true;
    } catch (err) {
      if (this.config.verbose) console.error('[ChromeDriver] clickElement error:', selector, err);
      return false;
    }
  }

  async focusElement(selector: string): Promise<boolean> {
    try {
      const p = await getPage();
      await p.waitForSelector(selector, { timeout: 5_000 });
      await p.focus(selector);
      // Also click to ensure React picks up the focus event
      await p.click(selector);
      return true;
    } catch (err) {
      if (this.config.verbose) console.error('[ChromeDriver] focusElement error:', selector, err);
      return false;
    }
  }

  // ─── Text input ──────────────────────────────────────────────────────────

  /**
   * Type text via clipboard paste — the most reliable approach for React
   * contenteditable elements (Instagram DM composer).
   *
   * Copies text to macOS clipboard via pbcopy, then triggers a ClipboardEvent
   * paste in the page. Falls back to keyboard.type() if the paste event is
   * ignored (e.g. non-contenteditable inputs).
   */
  async typeViaClipboard(selector: string, text: string): Promise<boolean> {
    try {
      const p = await getPage();

      // 1. Copy to macOS clipboard
      const escaped = text.replace(/'/g, "'\\''");
      execSync(`printf '%s' '${escaped}' | pbcopy`, { stdio: 'pipe' });

      // 2. Focus the target element
      if (selector) {
        await p.waitForSelector(selector, { timeout: 5_000 });
        await p.focus(selector);
        await p.click(selector);
        await this.wait(100);
      }

      // 3. Try ClipboardEvent paste injection (works for React contenteditable)
      const pasteResult = await p.evaluate((sel: string) => {
        const el = sel ? document.querySelector(sel) : document.activeElement;
        if (!el) return 'no_element';
        (el as HTMLElement).focus();
        try {
          const dt = new DataTransfer();
          // Read from clipboard is not available in page context — inject via eval trick below
          const pasteEvt = new ClipboardEvent('paste', {
            bubbles: true,
            cancelable: true,
          });
          // Attach clipboard data manually — not all browsers support DataTransfer constructor args
          Object.defineProperty(pasteEvt, 'clipboardData', {
            get: () => {
              const fakeClipboard = { getData: () => '', types: [] } as unknown as DataTransfer;
              return fakeClipboard;
            },
          });
          el.dispatchEvent(pasteEvt);
          return 'paste_dispatched';
        } catch {
          return 'paste_failed';
        }
      }, selector);

      if (this.config.verbose) {
        console.log('[ChromeDriver] typeViaClipboard paste result:', pasteResult);
      }

      // 4. Use Meta+V keyboard shortcut (most reliable with real clipboard)
      await p.keyboard.down('Meta');
      await p.keyboard.press('v');
      await p.keyboard.up('Meta');
      await this.wait(200);

      return true;
    } catch (err) {
      if (this.config.verbose) console.error('[ChromeDriver] typeViaClipboard error:', err);
      return false;
    }
  }

  /**
   * Type text via JavaScript event injection.
   * Works for React contenteditable — same logic as SafariDriver.typeViaJS().
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
    try {
      var dt = new DataTransfer();
      dt.setData('text/plain', ${escaped});
      var pasteEvt = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
      el.dispatchEvent(pasteEvt);
      if (el.textContent && el.textContent.length > 0) return true;
    } catch(ePaste) {}

    var ok = document.execCommand('insertText', false, ${escaped});
    if (ok && el.textContent && el.textContent.includes(${escaped}.substring(0, 10))) return true;

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
})()`.trim();
      const result = await this.executeJS(js.replace(/\n/g, ' '));
      return result !== 'false';
    } catch (err) {
      if (this.config.verbose) console.error('[ChromeDriver] typeViaJS error:', err);
      return false;
    }
  }

  /**
   * Alias for typeViaJS (kept for compatibility with dm-operations.ts callers).
   */
  async typeViaKeystrokes(text: string): Promise<boolean> {
    return this.typeViaJS('', text);
  }

  // ─── Enter / submit ──────────────────────────────────────────────────────

  /**
   * Press Enter via Puppeteer keyboard API.
   * More reliable than JS dispatchEvent for React inputs — sends a real key event.
   */
  async pressEnter(): Promise<boolean> {
    try {
      const p = await getPage();
      await p.keyboard.press('Enter');
      return true;
    } catch (err) {
      if (this.config.verbose) console.error('[ChromeDriver] pressEnter error:', err);
      return false;
    }
  }

  /**
   * Press Enter via JavaScript KeyboardEvent dispatch.
   * Background-safe — does not require Chrome focus.
   */
  async pressEnterViaJS(selector?: string): Promise<boolean> {
    try {
      const selectorJs = selector
        ? `document.querySelector(${JSON.stringify(selector)})`
        : 'document.activeElement';
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
})()`.trim();
      const result = await this.executeJS(js.replace(/\n/g, ' '));
      return result !== 'false';
    } catch (err) {
      if (this.config.verbose) console.error('[ChromeDriver] pressEnterViaJS error:', err);
      return false;
    }
  }

  /**
   * Press Enter using the Puppeteer keyboard API (equivalent to pressEnterViaSafari in the
   * old driver — the most reliable submit method for React inputs).
   * Named to match SafariDriver.pressEnterViaSafari() so dm-operations.ts callers work as-is.
   */
  async pressEnterViaSafari(): Promise<boolean> {
    return this.pressEnter();
  }

  // ─── Screenshot ──────────────────────────────────────────────────────────

  async takeScreenshot(outputPath?: string): Promise<boolean | string> {
    try {
      const p = await getPage();
      if (outputPath) {
        await p.screenshot({ path: outputPath as `${string}.png` });
        return true;
      }
      const buf = await p.screenshot({ encoding: 'base64', type: 'jpeg', quality: 80 });
      return buf as string;
    } catch (err) {
      if (this.config.verbose) console.error('[ChromeDriver] takeScreenshot error:', err);
      return false;
    }
  }

  // ─── Session management (compatibility shim) ─────────────────────────────
  // server.ts calls these; ChromeDriver tracks state via the Puppeteer page,
  // not Safari window+tab indices, so these are lightweight shims.

  /**
   * Ensure an Instagram tab is active and return pseudo-session info.
   * Throws if Chrome is not reachable, matching SafariDriver.ensureActiveSession() behavior.
   */
  async ensureActiveSession(_urlPattern: string): Promise<SessionInfo> {
    try {
      const p = await ensureInstagramTab();
      return { found: true, windowIndex: 1, tabIndex: 1, url: p.url() };
    } catch (err) {
      throw new Error(
        `[ChromeDriver] No Instagram tab found. ` +
          `Make sure Chrome is running with --remote-debugging-port=9222 and ` +
          `navigated to instagram.com. Error: ${err}`
      );
    }
  }

  getSessionInfo(): { windowIndex: number | null; tabIndex: number | null; urlPattern: string | null; lastVerified: number } {
    return {
      windowIndex: _page ? 1 : null,
      tabIndex: _page ? 1 : null,
      urlPattern: INSTAGRAM_URL_PATTERN,
      lastVerified: _page ? Date.now() : 0,
    };
  }

  clearTrackedSession(): void {
    // With Puppeteer, the "session" is the browser connection — we don't need to clear it
    // but we reset the cached page so the next call re-discovers it.
    _page = null;
  }

  /**
   * No-op shim — SafariDriver uses this to pin to a specific window+tab.
   * ChromeDriver always targets the Instagram page directly.
   */
  setTrackedTab(_windowIndex: number, _tabIndex: number, _urlPattern: string): void {
    // no-op: ChromeDriver finds the Instagram tab by URL, not by window/tab index
  }

  // ─── Config ──────────────────────────────────────────────────────────────

  getConfig(): AutomationConfig {
    return { ...this.config };
  }

  setConfig(config: Partial<AutomationConfig>): void {
    this.config = { ...this.config, ...config };
  }

  // ─── Compatibility aliases (unused by dm-operations but kept for server.ts) ─

  /**
   * executeJSInTab — Safari-specific concept; ChromeDriver just delegates to executeJS.
   */
  async executeJSInTab(js: string, _windowIndex: number, _tabIndex: number): Promise<string> {
    return this.executeJS(js);
  }

  async activateTab(_windowIndex: number, _tabIndex: number): Promise<boolean> {
    // ChromeDriver doesn't need to activate a tab — Puppeteer operates headlessly
    return true;
  }

  async activateSafari(): Promise<boolean> {
    return true;
  }
}

// ─── Singleton helpers ───────────────────────────────────────────────────────

let _defaultDriver: ChromeDriver | null = null;

export function getDefaultDriver(): ChromeDriver {
  if (!_defaultDriver) {
    _defaultDriver = new ChromeDriver({
      verbose: process.env['VERBOSE'] === 'true',
    });
  }
  return _defaultDriver;
}

export function setDefaultDriver(driver: ChromeDriver): void {
  _defaultDriver = driver;
}
