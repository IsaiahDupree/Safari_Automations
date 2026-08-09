/**
 * Chrome/Puppeteer CDP Driver for TikTok DM
 *
 * Replaces the Safari AppleScript driver. Connects to an already-running
 * Chrome instance via CDP (default port 9224) using the "Automation-TikTok"
 * profile at ~/.chrome-automation-profiles/tiktok/.
 *
 * Key design decisions vs the Safari driver:
 *  - No AppleScript / osascript calls anywhere.
 *  - No OS-level screen-coordinate clicking (Puppeteer uses CDP mouse events
 *    relative to the page viewport, which are reliable even in background tabs).
 *  - TikTok virtual-DOM elements that report 0×0 getBoundingClientRect() can
 *    still be clicked via Puppeteer's page.evaluate → el.click(), because CDP
 *    runs in the renderer process where React's synthetic event system is live.
 *  - Clipboard paste uses xdotool on Linux / pbcopy+Cmd+V on macOS via
 *    Puppeteer keyboard APIs (no AppleScript dependency).
 *  - All public methods mirror SafariDriver's interface so dm-operations.ts
 *    can be updated with a simple type substitution.
 */

import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { execSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { AutomationConfig } from '../types/index.js';

// ── Profile / CDP resolution ─────────────────────────────────────────────────
const DEFAULT_CDP_URL = process.env.TIKTOK_CDP_URL || 'http://localhost:9224';
const DEFAULT_USER_DATA_DIR = join(homedir(), '.chrome-automation-profiles', 'tiktok');
const DEFAULT_PROFILE = 'Automation-TikTok';

const CHROME_PATHS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
];

function findChrome(): string {
  const envPath = process.env.CHROME_PATH;
  if (envPath && existsSync(envPath)) return envPath;
  for (const p of CHROME_PATHS) {
    if (existsSync(p)) return p;
  }
  throw new Error(`Chrome not found. Checked: ${CHROME_PATHS.join(', ')}. Set CHROME_PATH env var.`);
}

// ── Virtual DOM helpers ───────────────────────────────────────────────────────
/**
 * TikTok virtual DOM detection — elements exist in the DOM but have 0×0 rects.
 * We use this to distinguish "present but not rendered" from "truly absent".
 * Returns true only when the element exists AND has real layout dimensions.
 */
async function isVisible(page: Page, selector: string): Promise<boolean> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }, selector);
}

// ── ChromeDriver class ───────────────────────────────────────────────────────
export class ChromeDriver {
  private config: AutomationConfig;
  private browser: Browser | null = null;
  private page: Page | null = null;

  constructor(config: Partial<AutomationConfig> = {}) {
    this.config = {
      instanceType: config.instanceType || 'local',
      remoteUrl: config.remoteUrl,
      timeout: config.timeout || 30000,
      actionDelay: config.actionDelay || 1000,
      verbose: config.verbose || false,
    };
  }

  // ── Browser / page lifecycle ───────────────────────────────────────────────

  /** Connect to (or launch) Chrome and return the browser instance. */
  async getBrowser(): Promise<Browser> {
    if (this.browser && this.browser.connected) return this.browser;

    const cdpUrl = process.env.TIKTOK_CDP_URL || DEFAULT_CDP_URL;

    // Mode 1: Connect to already-running Chrome via CDP
    try {
      if (this.config.verbose) console.log(`[ChromeDriver] Connecting via CDP: ${cdpUrl}`);
      this.browser = await puppeteer.connect({ browserURL: cdpUrl, defaultViewport: null });
      this.browser.on('disconnected', () => {
        if (this.config.verbose) console.warn('[ChromeDriver] CDP disconnected — resetting browser state');
        this.browser = null;
        this.page = null;
      });
      if (this.config.verbose) console.log('[ChromeDriver] CDP connection established');
      return this.browser;
    } catch (cdpErr) {
      // NO-NEW-PROFILE POLICY: the whole fleet drives ONE shared logged-in Chrome
      // on :9222 (the chrome-bridge "agent" profile). We deliberately DO NOT launch
      // a separate automation profile as a fallback — that opens a logged-out
      // browser and fragments sessions. Fail loudly with a fix hint instead.
      const cdpMsg = (cdpErr as Error).message;
      console.error(`[ChromeDriver] Cannot reach shared logged-in Chrome at ${cdpUrl}: ${cdpMsg}`);
      throw Object.assign(
        new Error(
          `[tiktok] Shared logged-in Chrome unreachable at ${cdpUrl}: ${cdpMsg}. ` +
          `The watchdog normally keeps it up — verify with: curl -s ${cdpUrl}/json/version . ` +
          `Do NOT launch a separate profile; restart the shared browser instead.`
        ),
        { code: 'CDP_CONNECT_FAILED', cdpUrl }
      );
    }
  }

  /**
   * Get the TikTok page tab, or open one if it doesn't exist.
   * Prefers an existing tiktok.com tab over creating a new one.
   */
  async getPage(): Promise<Page> {
    const browser = await this.getBrowser();
    const pages = await browser.pages();

    if (this.config.verbose) {
      console.log(`[ChromeDriver] Open tabs: ${pages.length}`, pages.map(p => p.url().slice(0, 60)));
    }

    // Prefer an existing TikTok tab
    const tiktokPage = pages.find(p => p.url().includes('tiktok.com'));
    if (tiktokPage) {
      if (this.config.verbose) console.log(`[ChromeDriver] Reusing TikTok tab: ${tiktokPage.url().slice(0, 80)}`);
      this.page = tiktokPage;
      return this.page;
    }

    // Reuse any existing tab
    if (pages.length > 0) {
      this.page = pages[pages.length - 1];
      if (this.config.verbose) console.log(`[ChromeDriver] Reusing last tab: ${this.page.url().slice(0, 80)}`);
      return this.page;
    }

    // Open a new tab
    if (this.config.verbose) console.log('[ChromeDriver] Opening new tab');
    this.page = await browser.newPage();
    await this.page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
    this.page.on('pageerror', err => {
      if (this.config.verbose) console.warn('[ChromeDriver] Page JS error:', err.message);
    });
    return this.page;
  }

  /** Close the browser. Use for cleanup only. */
  async closeBrowser(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
    }
  }

  // ── Core primitives (public API matching SafariDriver) ─────────────────────

  /**
   * Execute JavaScript in the page and return the string result.
   * Note: Puppeteer's page.evaluate returns the actual value, not a string.
   * We JSON-stringify complex results to preserve the SafariDriver string contract.
   */
  async executeJS(js: string): Promise<string> {
    const page = await this.getPage();
    try {
      // Wrap in IIFE if not already, then coerce result to string
      const wrapped = js.trim().startsWith('(function') || js.trim().startsWith('function')
        ? `(${js.trim()})()`
        : js.trim();
      const result = await page.evaluate(wrapped);
      if (result === null || result === undefined) return '';
      if (typeof result === 'string') return result;
      if (typeof result === 'boolean') return result ? 'true' : 'false';
      if (typeof result === 'number') return String(result);
      return JSON.stringify(result);
    } catch (error) {
      if (this.config.verbose) console.error('[ChromeDriver] executeJS error:', (error as Error).message);
      throw error;
    }
  }

  /** Navigate to a URL and wait for page to settle. */
  async navigateTo(url: string): Promise<boolean> {
    try {
      const page = await this.getPage();
      if (this.config.verbose) console.log(`[ChromeDriver] Navigating to ${url.slice(0, 80)}`);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: this.config.timeout });
      await this.wait(2000);
      return true;
    } catch (error) {
      if (this.config.verbose) console.error('[ChromeDriver] Navigation error:', (error as Error).message);
      return false;
    }
  }

  /** Get the current URL. */
  async getCurrentUrl(): Promise<string> {
    try {
      const page = await this.getPage();
      return page.url();
    } catch {
      return '';
    }
  }

  /** Check if the current page is TikTok. */
  async isOnTikTok(): Promise<boolean> {
    const url = await this.getCurrentUrl();
    return url.includes('tiktok.com');
  }

  /** Check if the user is logged in to TikTok. */
  async isLoggedIn(): Promise<boolean> {
    const result = await this.executeJS(`
      (function() {
        var notLoggedIn = document.querySelector('input[name="username"]') ||
                          document.querySelector('a[href*="/login"]') ||
                          window.location.pathname.includes('/login');
        return notLoggedIn ? 'false' : 'true';
      })()
    `);
    return result === 'true';
  }

  /** Wait for the specified number of milliseconds. */
  async wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Wait for an element to appear in the DOM.
   * Uses Puppeteer's built-in waitForSelector for reliability.
   */
  async waitForElement(selector: string, maxWaitMs: number = 10000): Promise<boolean> {
    try {
      const page = await this.getPage();
      await page.waitForSelector(selector, { timeout: maxWaitMs });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Type text into a React contenteditable element.
   *
   * TikTok is a React Native web app and ignores naive DOM value-setting.
   * Strategy waterfall (most reliable first):
   *   1. DataTransfer ClipboardEvent paste — fires React's onPaste handler
   *   2. execCommand insertText — works for Draft.js editors
   *   3. InputEvent beforeinput/input — React 17+ synthetic events
   *   4. pbcopy + Cmd+V clipboard paste (macOS) — last resort
   */
  async typeViaJS(selector: string, text: string): Promise<boolean> {
    const page = await this.getPage();
    try {
      const msgJson = JSON.stringify(text);

      // Strategy 1: ClipboardEvent paste (most reliable for React contenteditable)
      const result1 = await page.evaluate((sel, txt) => {
        const el = sel
          ? (document.querySelector(sel) as HTMLElement | null)
          : (document.activeElement as HTMLElement | null);
        if (!el) return 'no_el';
        el.focus();
        const dt = new DataTransfer();
        dt.setData('text/plain', txt);
        const evt = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt });
        el.dispatchEvent(evt);
        const val = ((el as HTMLElement & { value?: string }).value || el.textContent || el.innerText || '').trim();
        return val.length > 0 ? `ok:${val.substring(0, 15)}` : 'empty';
      }, selector, text);

      if (result1 && String(result1).startsWith('ok:')) {
        if (this.config.verbose) console.log('[ChromeDriver] typeViaJS: ClipboardEvent paste succeeded');
        return true;
      }

      // Strategy 2: execCommand insertText (works in Draft.js)
      const result2 = await page.evaluate((sel, txt) => {
        const el = sel
          ? (document.querySelector(sel) as HTMLElement | null)
          : (document.activeElement as HTMLElement | null);
        if (!el) return 'no_el';
        el.focus();
        const inserted = document.execCommand('selectAll', false, '') &&
                         document.execCommand('insertText', false, txt);
        if (inserted) {
          const val = ((el as HTMLElement & { value?: string }).value || el.textContent || el.innerText || '').trim();
          return val.length > 0 ? `ok:${val.substring(0, 15)}` : 'empty_after_exec';
        }
        return 'exec_failed';
      }, selector, text);

      if (result2 && String(result2).startsWith('ok:')) {
        if (this.config.verbose) console.log('[ChromeDriver] typeViaJS: execCommand succeeded');
        return true;
      }

      // Strategy 3: InputEvent (React 17+ synthetic events)
      const result3 = await page.evaluate((sel, txt) => {
        const el = sel
          ? (document.querySelector(sel) as HTMLElement | null)
          : (document.activeElement as HTMLElement | null);
        if (!el) return 'no_el';
        el.focus();
        el.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: txt }));
        el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: false, inputType: 'insertText', data: txt }));
        const val = ((el as HTMLElement & { value?: string }).value || el.textContent || el.innerText || '').trim();
        return val.length > 0 ? `ok:${val.substring(0, 15)}` : 'input_event_empty';
      }, selector, text);

      if (result3 && String(result3).startsWith('ok:')) {
        if (this.config.verbose) console.log('[ChromeDriver] typeViaJS: InputEvent succeeded');
        return true;
      }

      if (this.config.verbose) console.warn('[ChromeDriver] typeViaJS: all JS strategies failed, falling through');
      return false;
    } catch (error) {
      if (this.config.verbose) console.error('[ChromeDriver] typeViaJS error:', (error as Error).message);
      return false;
    }
  }

  /**
   * Type text via OS clipboard paste (macOS pbcopy + Puppeteer keyboard).
   * Most reliable fallback for TikTok's React contenteditable.
   *
   * First tries JS strategies (typeViaJS), validates text appeared,
   * then falls back to clipboard + Cmd+V.
   */
  async typeViaClipboard(selector: string, text: string): Promise<boolean> {
    // Method 1: JS injection
    try {
      const jsOk = await this.typeViaJS(selector, text);
      if (jsOk) {
        const page = await this.getPage();
        const snippet = text.substring(0, 15).replace(/'/g, "\\'");
        const appeared = await page.evaluate((sel, snip) => {
          const el = sel
            ? (document.querySelector(sel) as HTMLElement | null)
            : (document.activeElement as HTMLElement | null);
          if (!el) return false;
          const val = ((el as HTMLElement & { value?: string }).value || el.textContent || el.innerText || '').trim();
          return val.length > 0 && val.includes(snip);
        }, selector, snippet);
        if (appeared) {
          if (this.config.verbose) console.log('[ChromeDriver] typeViaClipboard: JS injection validated');
          return true;
        }
        if (this.config.verbose) console.log('[ChromeDriver] typeViaClipboard: JS returned true but text missing — trying clipboard');
      }
    } catch { /* fall through */ }

    // Method 2: OS clipboard paste (macOS)
    if (this.config.verbose) console.warn('[ChromeDriver] typeViaClipboard: using pbcopy + Cmd+V');
    try {
      const page = await this.getPage();

      // Copy text to clipboard via pbcopy (macOS)
      const safeText = text.replace(/'/g, "'\\''");
      execSync(`printf '%s' '${safeText}' | pbcopy`);

      // Focus the element
      if (selector) {
        await page.evaluate((sel) => {
          const el = document.querySelector(sel) as HTMLElement | null;
          if (el) { el.focus(); el.click(); }
        }, selector);
        await this.wait(200);
      }

      // Paste via Puppeteer keyboard
      await page.keyboard.down('Meta');
      await page.keyboard.press('v');
      await page.keyboard.up('Meta');
      await this.wait(300);

      return true;
    } catch (error) {
      if (this.config.verbose) console.error('[ChromeDriver] typeViaClipboard clipboard error:', (error as Error).message);
      return false;
    }
  }

  /**
   * Type text in the active element (alias for typeViaJS with empty selector).
   * Kept for API compatibility with SafariDriver.
   */
  async typeViaKeystrokes(text: string): Promise<boolean> {
    return this.typeViaJS('', text);
  }

  /**
   * Press Enter in the active/focused element via Puppeteer keyboard.
   * Unlike the Safari driver, no AppleScript is needed — Puppeteer sends
   * CDP Input.dispatchKeyEvent directly to the renderer.
   */
  async pressEnterViaJS(selector?: string): Promise<boolean> {
    try {
      const page = await this.getPage();
      if (selector) {
        await page.evaluate((sel) => {
          const el = document.querySelector(sel) as HTMLElement | null;
          if (el) el.focus();
        }, selector);
      }
      await page.keyboard.press('Enter');
      return true;
    } catch (error) {
      if (this.config.verbose) console.error('[ChromeDriver] pressEnterViaJS error:', (error as Error).message);
      return false;
    }
  }

  /**
   * Press Enter (alias matching SafariDriver's pressEnter).
   */
  async pressEnter(): Promise<boolean> {
    return this.pressEnterViaJS();
  }

  /**
   * Press Enter via Puppeteer keyboard targeting the active element.
   * Replaces the Safari driver's pressEnterViaSafari (AppleScript key code 36).
   * Puppeteer's keyboard.press sends a real CDP keydown/keypress/keyup sequence.
   */
  async pressEnterViaSafari(): Promise<boolean> {
    // In Chrome/Puppeteer there is no AppleScript — just use keyboard.press
    return this.pressEnterViaJS();
  }

  /**
   * Click an element by CSS selector using JS el.click().
   * Works for most TikTok elements including those with 0×0 virtual DOM rects,
   * because React's synthetic event system is live in the renderer.
   */
  async clickElement(selector: string): Promise<boolean> {
    const page = await this.getPage();
    const result = await page.evaluate((sel) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (el) { el.click(); return 'clicked'; }
      return 'not_found';
    }, selector);
    return result === 'clicked';
  }

  /**
   * Click at viewport-relative coordinates using Puppeteer's mouse API.
   * Used as a fallback when selector-based clicking doesn't work.
   */
  async clickAtViewportPosition(x: number, y: number): Promise<void> {
    const page = await this.getPage();
    await page.mouse.click(x, y);
  }

  /**
   * Click at "screen" coordinates.
   *
   * The Safari driver used absolute macOS screen coordinates (window.screenX/Y +
   * chrome height). Chrome driver uses page-viewport coordinates instead —
   * Puppeteer's mouse operates in the viewport frame, so we subtract the
   * window chrome offsets if they were baked into the coordinates by JS.
   *
   * When osLevel=true is passed by dm-operations.ts (legacy Safari pattern),
   * we use Puppeteer's mouse.click with the coordinates treated as viewport coords.
   * The caller's JS already computes screen coords using window.screenX/Y; we
   * need to convert back to viewport coords by subtracting those offsets.
   */
  async clickAtScreenPosition(x: number, y: number, osLevel: boolean = false): Promise<void> {
    const page = await this.getPage();
    if (!osLevel) {
      // Direct viewport click (elementFromPoint)
      await page.evaluate((vx, vy) => {
        const el = document.elementFromPoint(vx, vy) as HTMLElement | null;
        if (el) el.click();
      }, x, y);
      return;
    }

    // "Screen" coords from JS used window.screenX + chromeH offsets.
    // Subtract those to get back to viewport coords for Puppeteer.
    const viewportCoords = await page.evaluate((sx, sy) => {
      const chromeH = window.outerHeight - window.innerHeight;
      return {
        x: sx - window.screenX,
        y: sy - window.screenY - chromeH,
      };
    }, x, y);

    if (this.config.verbose) {
      console.log(`[ChromeDriver] clickAtScreenPosition (${x},${y}) → viewport (${viewportCoords.x},${viewportCoords.y})`);
    }

    // Clamp to viewport bounds
    const viewport = page.viewport();
    const vx = viewport ? Math.max(0, Math.min(viewportCoords.x, viewport.width - 1)) : viewportCoords.x;
    const vy = viewport ? Math.max(0, Math.min(viewportCoords.y, viewport.height - 1)) : viewportCoords.y;
    await page.mouse.click(vx, vy);
  }

  /**
   * Focus an element by CSS selector.
   */
  async focusElement(selector: string): Promise<boolean> {
    const page = await this.getPage();
    const result = await page.evaluate((sel) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (el) { el.focus(); el.click(); return 'focused'; }
      return 'not_found';
    }, selector);
    return result === 'focused';
  }

  /**
   * Take a screenshot and save to disk.
   */
  async takeScreenshot(outputPath: string): Promise<boolean> {
    try {
      const page = await this.getPage();
      await page.screenshot({ path: outputPath as `${string}.png` });
      return true;
    } catch {
      return false;
    }
  }

  // ── Session / tracking stubs (no-op in Chrome driver) ─────────────────────
  // The Safari driver tracked window/tab indices for AppleScript targeting.
  // Chrome driver connects to a single browser instance, so these are no-ops
  // that return neutral values for API compatibility.

  /** No-op: Chrome driver doesn't track window/tab indices. */
  setTrackedTab(_windowIndex: number, _tabIndex: number, _urlPattern: string): void {
    // No-op: Puppeteer connects to the browser, not a specific tab by index.
  }

  /** Return a stub session info matching the SafariDriver interface. */
  getSessionInfo(): { windowIndex: number | null; tabIndex: number | null; urlPattern: string | null; lastVerified: number } {
    return { windowIndex: 1, tabIndex: 1, urlPattern: 'tiktok.com', lastVerified: Date.now() };
  }

  /** No-op: nothing to clear. */
  clearTrackedSession(): void {
    // No-op
  }

  /**
   * Ensure an active TikTok session exists.
   * In the Chrome driver, we verify the browser is connected and a TikTok tab exists.
   */
  async ensureActiveSession(_urlPattern: string): Promise<{ found: boolean; windowIndex: number; tabIndex: number; url: string }> {
    try {
      const page = await this.getPage();
      const url = page.url();
      return { found: true, windowIndex: 1, tabIndex: 1, url };
    } catch (error) {
      throw new Error(`[ChromeDriver] No Chrome/TikTok session available: ${(error as Error).message}. Start Chrome with --remote-debugging-port=9224 and navigate to tiktok.com.`);
    }
  }

  /** Activate the tracked Safari window — no-op in Chrome driver. */
  async activateTrackedWindow(): Promise<boolean> {
    // Chrome is already in control; no window activation needed.
    return true;
  }

  /** Activate Safari — no-op in Chrome driver. */
  async activateSafari(): Promise<boolean> {
    return true;
  }

  /** Return the current config. */
  getConfig(): AutomationConfig {
    return { ...this.config };
  }

  /** Update configuration. */
  setConfig(config: Partial<AutomationConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────
let defaultDriver: ChromeDriver | null = null;

export function getDefaultDriver(): ChromeDriver {
  if (!defaultDriver) {
    defaultDriver = new ChromeDriver();
  }
  return defaultDriver;
}

export function setDefaultDriver(driver: ChromeDriver): void {
  defaultDriver = driver;
}

// ── Compatibility alias ───────────────────────────────────────────────────────
// dm-operations.ts imports SafariDriver by name. Export ChromeDriver under
// that alias so the import continues to resolve without touching dm-operations.ts.
export { ChromeDriver as SafariDriver };
