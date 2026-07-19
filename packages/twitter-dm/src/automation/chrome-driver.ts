/**
 * Chrome/Puppeteer Driver for Twitter/X DM Automation
 *
 * Replaces SafariDriver with a Puppeteer CDP connection.
 * CDP port: 9223
 * Profile: ~/.chrome-automation-profiles/twitter/
 * Env var: TWITTER_CDP_URL (default: http://localhost:9223)
 */

import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { execSync, execFileSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const MOD = 'twitter-chrome-driver';

// ─── Profile resolution ──────────────────────────────────────────────────────
const DEFAULT_CDP_URL = 'http://localhost:9223';
const DEFAULT_USER_DATA_DIR = join(homedir(), '.chrome-automation-profiles', 'twitter');
const DEFAULT_PROFILE_DIR = 'Default';

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

function log(level: 'info' | 'warn' | 'error' | 'debug', msg: string, extra?: object): void {
  const prefix = `[${MOD}][${level.toUpperCase()}]`;
  if (level === 'debug' && process.env['VERBOSE'] !== 'true') return;
  const line = extra ? `${prefix} ${msg} ${JSON.stringify(extra)}` : `${prefix} ${msg}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

// ─── Singleton browser + page ────────────────────────────────────────────────

let browser: Browser | null = null;
let page: Page | null = null;

async function connectToCDP(url: string): Promise<Browser> {
  log('info', `Connecting to existing Chrome via CDP`, { url });
  try {
    const b = await puppeteer.connect({ browserURL: url, defaultViewport: null });
    log('info', 'CDP connection established', { url });
    b.on('disconnected', () => {
      log('warn', 'CDP browser disconnected — resetting state');
      browser = null;
      page = null;
    });
    return b;
  } catch (err) {
    log('error', 'CDP connection failed', { url, error: (err as Error).message });
    throw Object.assign(
      new Error(`Cannot connect to Chrome at ${url}: ${(err as Error).message}`),
      { code: 'CDP_CONNECT_FAILED', hint: `Make sure Chrome is running with --remote-debugging-port=9223` }
    );
  }
}

export async function getBrowser(): Promise<Browser> {
  if (browser && browser.connected) {
    log('debug', 'Reusing existing browser');
    return browser;
  }

  // Mode 1: Connect to existing Chrome via CDP
  const cdpUrl = process.env['TWITTER_CDP_URL'] || DEFAULT_CDP_URL;

  // Try CDP first — if Chrome is already running on that port, use it
  try {
    browser = await connectToCDP(cdpUrl);
    return browser;
  } catch (cdpErr) {
    log('warn', 'CDP connect failed — launching Chrome', { cdpUrl, err: (cdpErr as Error).message });
  }

  // Mode 2: Launch Chrome with the Twitter automation profile
  const userDataDir = process.env['CHROME_USER_DATA_DIR'] || DEFAULT_USER_DATA_DIR;
  const profileDir = process.env['CHROME_PROFILE'] || DEFAULT_PROFILE_DIR;

  if (!existsSync(userDataDir)) {
    mkdirSync(userDataDir, { recursive: true });
    log('info', `Created user data dir: ${userDataDir}`);
  }

  const executablePath = findChrome();
  log('info', 'Launching Chrome', { executablePath, userDataDir, profileDir });

  try {
    browser = await puppeteer.launch({
      executablePath,
      headless: false,
      userDataDir,
      args: [
        `--profile-directory=${profileDir}`,
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
        '--window-size=1400,900',
      ],
      defaultViewport: null,
    });
    log('info', 'Chrome launched', { pid: browser.process()?.pid, profileDir });
    browser.on('disconnected', () => {
      log('warn', 'Browser disconnected — resetting state');
      browser = null;
      page = null;
    });
    return browser;
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('user data directory is already in use')) {
      log('error', 'Profile is locked by another Chrome instance', { userDataDir });
      throw Object.assign(
        new Error('Chrome profile is already open. Either close Chrome or point TWITTER_CDP_URL to it.'),
        { code: 'PROFILE_LOCKED' }
      );
    }
    log('error', 'Failed to launch Chrome', { error: msg });
    throw err;
  }
}

export async function getPage(): Promise<Page> {
  const b = await getBrowser();
  const pages = await b.pages();
  log('debug', `Open tabs: ${pages.length}`, { urls: pages.map(p => p.url().slice(0, 60)) });

  // Prefer an existing Twitter/X tab
  const twitterPage = pages.find(p => {
    const u = p.url();
    return u.includes('twitter.com') || u.includes('x.com');
  });
  if (twitterPage) {
    log('debug', 'Reusing Twitter tab', { url: twitterPage.url().slice(0, 80) });
    page = twitterPage;
    return page;
  }

  // Reuse last tab if it exists
  if (pages.length > 0) {
    page = pages[pages.length - 1];
    log('debug', 'Reusing last tab', { url: page.url().slice(0, 80) });
    return page;
  }

  // Open a fresh tab
  log('info', 'Opening new tab');
  page = await b.newPage();
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
  page.on('pageerror', (err: unknown) => log('warn', 'Page JS error', { error: (err as Error).message }));
  page.on('requestfailed', req =>
    log('warn', 'Request failed', { url: req.url().slice(0, 100), reason: req.failure()?.errorText })
  );
  return page;
}

// ─── Public driver API (mirrors SafariDriver interface) ───────────────────────

/**
 * Navigate to a URL.
 */
export async function navigateTo(url: string): Promise<boolean> {
  try {
    const p = await getPage();
    const t = Date.now();
    log('info', `Navigating to ${url.slice(0, 80)}`);
    await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    const finalUrl = p.url();
    log('info', 'Navigation complete', { ms: Date.now() - t, finalUrl: finalUrl.slice(0, 80) });
    if (finalUrl.includes('/login') || finalUrl.includes('auth')) {
      log('warn', 'Twitter session expired — redirected to login', { finalUrl });
    }
    await wait(500);
    return true;
  } catch (err) {
    log('error', `Navigation failed for ${url.slice(0, 80)}`, { error: (err as Error).message });
    return false;
  }
}

/**
 * Execute JavaScript in the page and return the result as a string.
 */
export async function executeJS(js: string): Promise<string> {
  const p = await getPage();
  const preview = js.slice(0, 60).replace(/\s+/g, ' ');
  log('debug', `executeJS: ${preview}...`);
  try {
    const result = await p.evaluate(js);
    // Coerce to string (mirrors Safari `do JavaScript` which always returns string)
    const str = result == null ? '' : String(result);
    log('debug', 'executeJS complete', { resultPreview: str.slice(0, 80) });
    return str;
  } catch (err) {
    log('error', 'executeJS failed', { script: preview, error: (err as Error).message });
    throw err;
  }
}

/**
 * Get the current page URL.
 */
export async function getCurrentUrl(): Promise<string> {
  try {
    const p = await getPage();
    return p.url();
  } catch {
    return '';
  }
}

/**
 * Wait for an element to appear, returns true/false.
 */
export async function waitForElement(selector: string, maxWaitMs: number = 10_000): Promise<boolean> {
  try {
    const p = await getPage();
    await p.waitForSelector(selector, { timeout: maxWaitMs });
    return true;
  } catch {
    return false;
  }
}

/**
 * Click an element by CSS selector.
 */
export async function clickElement(selector: string): Promise<boolean> {
  try {
    const p = await getPage();
    await p.waitForSelector(selector, { timeout: 8_000 });
    await p.click(selector);
    log('debug', `Clicked`, { selector });
    return true;
  } catch (err) {
    log('warn', `Click failed`, { selector, error: (err as Error).message });
    return false;
  }
}

/**
 * Focus an element by CSS selector.
 * Puppeteer doesn't have a focus() method directly — click to focus.
 */
export async function focusElement(selector: string): Promise<boolean> {
  try {
    const p = await getPage();
    await p.waitForSelector(selector, { timeout: 8_000 });
    await p.focus(selector);
    log('debug', `Focused`, { selector });
    return true;
  } catch (err) {
    log('warn', `Focus failed`, { selector, error: (err as Error).message });
    return false;
  }
}

/**
 * Type text into Twitter's React/Draft.js contenteditable DM input.
 *
 * Twitter's DM textarea is a contenteditable div driven by Draft.js.
 * document.execCommand('insertText') is the most reliable approach.
 * Falls back to clipboard paste (pbcopy + Meta+V) when execCommand is blocked.
 */
export async function typeViaJS(selector: string, text: string): Promise<boolean> {
  try {
    const p = await getPage();
    const escaped = JSON.stringify(text);

    // Strategy 1: execCommand insertText (Draft.js compatible)
    const result = await p.evaluate(
      (sel: string, txt: string) => {
        const el = sel
          ? (document.querySelector(sel) as HTMLElement | null)
          : (document.activeElement as HTMLElement | null);
        if (!el) return false;
        el.focus();
        // Clear existing content first
        (document as Document).execCommand('selectAll', false, undefined);
        const inserted = (document as Document).execCommand('insertText', false, txt);
        if (inserted) return true;

        // Strategy 2: native value setter for plain inputs
        try {
          const proto =
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value') ||
            Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
          if (proto && proto.set) {
            proto.set.call(el, txt);
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
          }
        } catch { /* ignore */ }

        // Strategy 3: textContent + React synthetic event (contenteditable fallback)
        (el as HTMLElement).textContent = txt;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      },
      selector,
      text
    );

    if (result) {
      log('debug', 'typeViaJS succeeded via execCommand/DOM');
      return true;
    }
  } catch (err) {
    log('warn', 'typeViaJS execCommand path failed', { error: (err as Error).message });
  }
  return false;
}

/**
 * Type text via OS clipboard paste (pbcopy + Meta+V).
 * Reliable for React contenteditable inputs when execCommand is blocked.
 */
export async function typeViaClipboard(selector: string, text: string): Promise<boolean> {
  // First try the JS approach
  const jsOk = await typeViaJS(selector, text);
  if (jsOk) return true;

  // Fallback: pbcopy + Meta+V
  log('warn', 'typeViaClipboard: falling back to clipboard paste');
  try {
    const p = await getPage();
    // Copy text to clipboard using pbcopy
    const escaped = text.replace(/'/g, "'\\''");
    execSync(`printf '%s' '${escaped}' | pbcopy`);

    // Focus the element
    await p.waitForSelector(selector, { timeout: 8_000 });
    await p.click(selector);
    await wait(200);

    // Paste
    await p.keyboard.down('Meta');
    await p.keyboard.press('v');
    await p.keyboard.up('Meta');
    await wait(500);

    log('debug', 'typeViaClipboard: clipboard paste complete');
    return true;
  } catch (err) {
    log('error', 'typeViaClipboard: clipboard paste failed', { error: (err as Error).message });
    return false;
  }
}

/**
 * Press Enter key.
 */
export async function pressEnter(): Promise<boolean> {
  try {
    const p = await getPage();
    await p.keyboard.press('Enter');
    return true;
  } catch (err) {
    log('warn', 'pressEnter failed', { error: (err as Error).message });
    return false;
  }
}

/**
 * Dispatch keyboard Enter events via JavaScript (background-safe).
 */
export async function pressEnterViaJS(selector?: string): Promise<boolean> {
  try {
    const p = await getPage();
    await p.evaluate((sel?: string) => {
      const el = (sel
        ? document.querySelector(sel)
        : document.activeElement) as HTMLElement | null;
      if (!el) return false;
      ['keydown', 'keypress', 'keyup'].forEach(type => {
        el.dispatchEvent(
          new KeyboardEvent(type, {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13,
            bubbles: true,
            cancelable: true,
          })
        );
      });
      return true;
    }, selector);
    return true;
  } catch (err) {
    log('warn', 'pressEnterViaJS failed', { error: (err as Error).message });
    return false;
  }
}

/**
 * Take a screenshot and return as base64 string.
 */
export async function takeScreenshot(): Promise<string> {
  const p = await getPage();
  const buf = await p.screenshot({ encoding: 'base64', type: 'jpeg', quality: 80 });
  return buf as string;
}

/**
 * Wait milliseconds.
 */
export async function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Check if on Twitter/X.
 */
export async function isOnTwitter(): Promise<boolean> {
  const url = await getCurrentUrl();
  return url.includes('twitter.com') || url.includes('x.com');
}

/**
 * Detect login state from page DOM.
 * Returns true if logged in (no login form visible).
 */
export async function isLoggedIn(): Promise<boolean> {
  try {
    const result = await executeJS(
      `(function() {
        var loginInput = document.querySelector('input[name="session[username_or_email]"]') ||
                         document.querySelector('input[autocomplete="username"]') ||
                         document.querySelector('[data-testid="loginButton"]');
        var loggedInIndicator = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]') ||
                                document.querySelector('[data-testid="UserAvatar-Container"]');
        if (loggedInIndicator) return 'true';
        if (loginInput) return 'false';
        return 'unknown';
      })()`
    );
    return result !== 'false';
  } catch {
    return false;
  }
}

/**
 * Close the browser (used for cleanup).
 */
export async function closeBrowser(): Promise<void> {
  if (browser) {
    log('info', 'Closing browser');
    await browser.close();
    browser = null;
    page = null;
    log('info', 'Browser closed');
  }
}

/**
 * Get CDP connection status for health reporting.
 */
export async function getCDPStatus(): Promise<{ connected: boolean; url: string; tabCount: number; currentUrl: string }> {
  const cdpUrl = process.env['TWITTER_CDP_URL'] || DEFAULT_CDP_URL;
  try {
    if (!browser || !browser.connected) {
      return { connected: false, url: cdpUrl, tabCount: 0, currentUrl: '' };
    }
    const pages = await browser.pages();
    const currentUrl = await getCurrentUrl();
    return { connected: true, url: cdpUrl, tabCount: pages.length, currentUrl };
  } catch {
    return { connected: false, url: cdpUrl, tabCount: 0, currentUrl: '' };
  }
}

// ─── ChromeDriver class — drop-in replacement for SafariDriver ────────────────
//
// server.ts calls getDriver() which creates a ChromeDriver. All methods
// on this class map 1-to-1 to SafariDriver's public interface.

export class ChromeDriver {
  private _verbose: boolean;

  constructor(opts: { verbose?: boolean } = {}) {
    this._verbose = opts.verbose ?? false;
    if (this._verbose) process.env['VERBOSE'] = 'true';
  }

  // ── Core JS execution ──

  async executeJS(js: string): Promise<string> {
    return executeJS(js);
  }

  // ── Navigation ──

  async navigateTo(url: string): Promise<boolean> {
    return navigateTo(url);
  }

  async getCurrentUrl(): Promise<string> {
    return getCurrentUrl();
  }

  // ── Predicates ──

  async isOnTwitter(): Promise<boolean> {
    return isOnTwitter();
  }

  /** Kept for interface compatibility (was isOnInstagram in SafariDriver). */
  async isOnInstagram(): Promise<boolean> {
    return false;
  }

  async isLoggedIn(): Promise<boolean> {
    return isLoggedIn();
  }

  // ── Waits ──

  async wait(ms: number): Promise<void> {
    return wait(ms);
  }

  async waitForElement(selector: string, maxWaitMs: number = 10_000): Promise<boolean> {
    return waitForElement(selector, maxWaitMs);
  }

  // ── Interaction ──

  async clickElement(selector: string): Promise<boolean> {
    return clickElement(selector);
  }

  async focusElement(selector: string): Promise<boolean> {
    return focusElement(selector);
  }

  async typeViaJS(selector: string, text: string): Promise<boolean> {
    return typeViaJS(selector, text);
  }

  async typeViaClipboard(selector: string, text: string): Promise<boolean> {
    return typeViaClipboard(selector, text);
  }

  async typeViaKeystrokes(text: string): Promise<boolean> {
    return typeViaClipboard('', text);
  }

  async pressEnter(): Promise<boolean> {
    return pressEnter();
  }

  async pressEnterViaJS(selector?: string): Promise<boolean> {
    return pressEnterViaJS(selector);
  }

  // ── Screenshot ──

  async takeScreenshot(_outputPath?: string): Promise<boolean | string> {
    if (_outputPath) {
      // Write to file (compatibility with SafariDriver.takeScreenshot(path))
      try {
        const base64 = await takeScreenshot();
        const buf = Buffer.from(base64, 'base64');
        const { writeFileSync } = await import('fs');
        writeFileSync(_outputPath, buf);
        return true;
      } catch {
        return false;
      }
    }
    return takeScreenshot();
  }

  // ── Config (compatibility shim) ──

  getConfig(): { verbose: boolean } {
    return { verbose: this._verbose };
  }

  setConfig(updates: Record<string, unknown>): void {
    if (typeof updates['verbose'] === 'boolean') {
      this._verbose = updates['verbose'] as boolean;
      if (this._verbose) process.env['VERBOSE'] = 'true';
    }
  }

  // ── Session info (no-op — Chrome doesn't need tab tracking) ──

  getSessionInfo(): {
    windowId: number | null;
    windowIndex: number | null;
    tabIndex: number | null;
    urlPattern: string | null;
    lastVerified: number;
  } {
    return {
      windowId: null,
      windowIndex: null,
      tabIndex: null,
      urlPattern: null,
      lastVerified: Date.now(),
    };
  }

  /**
   * No-op: Chrome doesn't need Safari tab pinning.
   * Kept for server.ts compatibility where setTrackedTab is called after tab claim.
   */
  async setTrackedTab(_windowIndex: number, _tabIndex: number, _urlPattern: string): Promise<void> {
    // No-op for Chrome — navigation is handled directly via Puppeteer
  }

  clearTrackedSession(): void {
    // No-op for Chrome
  }

  /**
   * Ensure active session — for Chrome we just verify we can reach the page.
   * Returns a compatible SessionInfo object.
   */
  async ensureActiveSession(_urlPattern: string): Promise<{
    found: boolean;
    windowId: number;
    windowIndex: number;
    tabIndex: number;
    url: string;
  }> {
    try {
      const url = await getCurrentUrl();
      return { found: true, windowId: 0, windowIndex: 1, tabIndex: 1, url };
    } catch {
      return { found: false, windowId: 0, windowIndex: 1, tabIndex: 1, url: '' };
    }
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let defaultDriver: ChromeDriver | null = null;

export function getDefaultDriver(): ChromeDriver {
  if (!defaultDriver) {
    defaultDriver = new ChromeDriver({ verbose: process.env['VERBOSE'] === 'true' });
  }
  return defaultDriver;
}

export function setDefaultDriver(driver: ChromeDriver): void {
  defaultDriver = driver;
}
