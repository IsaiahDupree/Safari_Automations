/**
 * Shared Chrome Driver — CDP/Puppeteer automation for all platforms
 *
 * Import from any platform service:
 *   import { ChromeDriver, getChromeDriver } from '../../shared/chrome-driver.js';
 *
 * Every platform attaches to the one canonical Chrome on CDP 9222.
 *
 * Chrome must already be running on CDP 9222. This driver never launches it.
 */

import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ChromePlatform = 'instagram' | 'twitter' | 'tiktok' | 'threads' | 'linkedin';

export interface ChromeDriverOptions {
  /** Platform name — used for logging and claim management */
  platform: ChromePlatform;
  /** CDP port the Chrome instance is listening on */
  cdpPort: number;
  /** Optional URL pattern to prefer when selecting a tab (e.g. 'instagram.com') */
  urlPattern?: string;
}

export interface TabClaim {
  platform: string;
  claimedAt: number;
  claimedBy: string;
  cdpPort: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

// SHARED LOGGED-IN BROWSER: every platform now attaches to ONE Chrome instance
// (the chrome-bridge "agent" profile, logged in) on :9222 and works in its own
// tab, rather than each platform spawning a separate profile/port. Overrides
// are deliberately ignored so no service can route itself to another Chrome.
const SHARED_CDP_PORT = 9222;
const DEFAULT_CDP_PORTS: Record<ChromePlatform, number> = {
  instagram: SHARED_CDP_PORT,
  twitter:   SHARED_CDP_PORT,
  tiktok:    SHARED_CDP_PORT,
  threads:   SHARED_CDP_PORT,
  linkedin:  SHARED_CDP_PORT,
};

const CLAIMS_FILE = '/tmp/chrome-tab-claims.json';
const CLAIM_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ─── ChromeDriver class ───────────────────────────────────────────────────────

export class ChromeDriver {
  private browser: Browser | null = null;
  private _page: Page | null = null;
  private readonly opts: ChromeDriverOptions;
  private readonly cdpUrl: string;

  constructor(opts: ChromeDriverOptions) {
    this.opts = opts;
    this.cdpUrl = `http://localhost:${opts.cdpPort}`;
  }

  // ── Internal: Browser connection ──────────────────────────────────────────

  private async getBrowser(): Promise<Browser> {
    if (this.browser && this.browser.connected) {
      return this.browser;
    }

    console.log(`[chrome-driver:${this.opts.platform}] Connecting via CDP to ${this.cdpUrl}`);
    try {
      this.browser = await puppeteer.connect({
        browserURL: this.cdpUrl,
        defaultViewport: null,
      });
      console.log(`[chrome-driver:${this.opts.platform}] CDP connected`);
      this.browser.on('disconnected', () => {
        console.warn(`[chrome-driver:${this.opts.platform}] Browser disconnected — resetting state`);
        this.browser = null;
        this._page = null;
      });
      return this.browser;
    } catch (err) {
      const msg = (err as Error).message;
      console.error(`[chrome-driver:${this.opts.platform}] CDP connection failed: ${msg}`);
      throw Object.assign(
        new Error(`Cannot connect to Chrome at ${this.cdpUrl}: ${msg}`),
        { code: 'CDP_CONNECT_FAILED', hint: `Run: chrome-launcher.sh --start` }
      );
    }
  }

  // ── Public: Page access ───────────────────────────────────────────────────

  /**
   * Returns the active page, preferring one matching `urlPattern` if set.
   * Creates a new tab if none exist.
   */
  async getPage(): Promise<Page> {
    const b = await this.getBrowser();
    const pages = await b.pages();

    // Prefer a tab matching the platform URL pattern
    if (this.opts.urlPattern) {
      const matched = pages.find(p => p.url().includes(this.opts.urlPattern!));
      if (matched) {
        console.log(`[chrome-driver:${this.opts.platform}] Reusing matched tab: ${matched.url().slice(0, 80)}`);
        this._page = matched;
        return this._page;
      }
    }

    // SHARED-BROWSER SAFETY: all platforms drive ONE logged-in Chrome, so grabbing
    // the "last tab" would hijack another platform's tab. If this driver already
    // owns a live tab, reuse it; otherwise open a fresh, DEDICATED tab for this
    // platform instead of stealing an existing one.
    if (this._page && !this._page.isClosed()) {
      console.log(`[chrome-driver:${this.opts.platform}] Reusing owned tab: ${this._page.url().slice(0, 80)}`);
      return this._page;
    }

    console.log(
      `[chrome-driver:${this.opts.platform}] No tab matching "${this.opts.urlPattern ?? 'n/a'}" among ${pages.length} open tab(s); opening a dedicated new tab`
    );
    if (pages.length >= 8) {
      throw Object.assign(
        new Error(`Chrome tab cap reached (${pages.length}/8); reuse or close a tab.`),
        { code: 'TAB_CAP_REACHED' },
      );
    }
    this._page = await b.newPage();
    await this._page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
    this._page.on('pageerror', e => console.warn(`[chrome-driver:${this.opts.platform}] Page JS error: ${e.message}`));
    this._page.on('close', () => {
      if (this._page && this._page.isClosed()) {
        console.warn(`[chrome-driver:${this.opts.platform}] Owned tab was closed — will open a new one on next use`);
        this._page = null;
      }
    });
    return this._page;
  }

  // ── Public: Navigation ────────────────────────────────────────────────────

  async navigateTo(
    url: string,
    waitUntil: 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2' = 'domcontentloaded'
  ): Promise<Page> {
    const p = await this.getPage();
    const t = Date.now();
    console.log(`[chrome-driver:${this.opts.platform}] Navigating to ${url.slice(0, 80)}`);
    try {
      await p.goto(url, { waitUntil, timeout: 30_000 });
      console.log(`[chrome-driver:${this.opts.platform}] Navigation complete (${Date.now() - t}ms): ${p.url().slice(0, 80)}`);
      return p;
    } catch (err) {
      console.error(`[chrome-driver:${this.opts.platform}] Navigation failed: ${(err as Error).message}`);
      throw err;
    }
  }

  async getCurrentUrl(): Promise<string> {
    const p = await this.getPage();
    return p.url();
  }

  // ── Public: DOM interaction ───────────────────────────────────────────────

  async waitForSelector(selector: string, timeoutMs = 10_000): Promise<void> {
    const p = await this.getPage();
    console.log(`[chrome-driver:${this.opts.platform}] Waiting for selector: ${selector}`);
    try {
      await p.waitForSelector(selector, { timeout: timeoutMs });
    } catch (err) {
      console.warn(`[chrome-driver:${this.opts.platform}] Selector not found within ${timeoutMs}ms: ${selector}`);
      throw err;
    }
  }

  async click(selector: string): Promise<void> {
    const p = await this.getPage();
    console.log(`[chrome-driver:${this.opts.platform}] Clicking: ${selector}`);
    try {
      await p.waitForSelector(selector, { timeout: 8_000 });
      await p.click(selector);
    } catch (err) {
      console.error(`[chrome-driver:${this.opts.platform}] Click failed on "${selector}": ${(err as Error).message}`);
      throw err;
    }
  }

  async typeInto(selector: string, text: string, clearFirst = true): Promise<void> {
    const p = await this.getPage();
    console.log(`[chrome-driver:${this.opts.platform}] Typing into: ${selector} (${text.length} chars)`);
    try {
      await p.waitForSelector(selector, { timeout: 8_000 });
      if (clearFirst) {
        await p.evaluate(
          `(function(){ const el = document.querySelector(${JSON.stringify(selector)}); if (el) el.value = ''; })()`
        );
      }
      await p.type(selector, text, { delay: 40 });
    } catch (err) {
      console.error(`[chrome-driver:${this.opts.platform}] typeInto failed: ${(err as Error).message}`);
      throw err;
    }
  }

  /**
   * Types text via clipboard paste — required for React contenteditable elements
   * on platforms like Instagram and TikTok where programmatic typing doesn't trigger
   * React state updates.
   *
   * Uses: pbcopy → Cmd+V via Puppeteer keyboard API
   */
  async typeViaClipboard(text: string): Promise<void> {
    const p = await this.getPage();
    console.log(`[chrome-driver:${this.opts.platform}] typeViaClipboard: ${text.length} chars`);

    // Write to macOS clipboard
    execSync('pbcopy', { input: text, encoding: 'utf8' });

    // Paste via Cmd+V
    await p.keyboard.down('Meta');
    await p.keyboard.press('v');
    await p.keyboard.up('Meta');

    // Small delay to let React process the paste event
    await new Promise(r => setTimeout(r, 150));
  }

  async pressKey(key: string): Promise<void> {
    const p = await this.getPage();
    console.log(`[chrome-driver:${this.opts.platform}] pressKey: ${key}`);
    await p.keyboard.press(key as Parameters<typeof p.keyboard.press>[0]);
  }

  // ── Public: JavaScript evaluation ─────────────────────────────────────────

  async evalJS<T>(script: string): Promise<T> {
    const p = await this.getPage();
    const preview = script.slice(0, 60).replace(/\s+/g, ' ');
    console.log(`[chrome-driver:${this.opts.platform}] evalJS: ${preview}...`);
    try {
      const result = await p.evaluate(script) as T;
      return result;
    } catch (err) {
      console.error(`[chrome-driver:${this.opts.platform}] evalJS failed: ${(err as Error).message}`);
      throw err;
    }
  }

  // ── Public: Screenshot ────────────────────────────────────────────────────

  async takeScreenshot(): Promise<string> {
    const p = await this.getPage();
    const buf = await p.screenshot({ encoding: 'base64', type: 'jpeg', quality: 80 });
    return buf as string;
  }

  // ── Public: Tab claim system ──────────────────────────────────────────────
  // Mirrors the Safari tab-claim format so the same tooling can check both.

  /** Claim this platform's Chrome tab. Throws if already claimed by another process. */
  claim(claimedBy = `pid:${process.pid}`): void {
    const claims = this.readClaims();
    const existing = claims[this.opts.platform];

    // Check if an active claim already exists
    if (existing && Date.now() - existing.claimedAt < CLAIM_TTL_MS && existing.claimedBy !== claimedBy) {
      throw Object.assign(
        new Error(`Chrome tab for ${this.opts.platform} already claimed by ${existing.claimedBy}`),
        { code: 'TAB_CLAIMED', claimedBy: existing.claimedBy }
      );
    }

    claims[this.opts.platform] = {
      platform: this.opts.platform,
      claimedAt: Date.now(),
      claimedBy,
      cdpPort: this.opts.cdpPort,
    };
    this.writeClaims(claims);
    console.log(`[chrome-driver:${this.opts.platform}] Tab claimed by ${claimedBy}`);
  }

  /** Release the claim for this platform. No-op if not claimed. */
  release(claimedBy = `pid:${process.pid}`): void {
    const claims = this.readClaims();
    const existing = claims[this.opts.platform];
    if (existing && existing.claimedBy === claimedBy) {
      delete claims[this.opts.platform];
      this.writeClaims(claims);
      console.log(`[chrome-driver:${this.opts.platform}] Tab claim released`);
    }
  }

  /** Check if this platform's tab is currently claimed (by anyone). */
  isClaimed(): boolean {
    const claims = this.readClaims();
    const existing = claims[this.opts.platform];
    return !!(existing && Date.now() - existing.claimedAt < CLAIM_TTL_MS);
  }

  private readClaims(): Record<string, TabClaim> {
    try {
      if (existsSync(CLAIMS_FILE)) {
        return JSON.parse(readFileSync(CLAIMS_FILE, 'utf8')) as Record<string, TabClaim>;
      }
    } catch {
      // Ignore parse errors — start fresh
    }
    return {};
  }

  private writeClaims(claims: Record<string, TabClaim>): void {
    writeFileSync(CLAIMS_FILE, JSON.stringify(claims, null, 2), 'utf8');
  }

  // ── Public: Lifecycle ─────────────────────────────────────────────────────

  /** Disconnect from Chrome (does NOT close the browser window). */
  async disconnect(): Promise<void> {
    if (this.browser) {
      console.log(`[chrome-driver:${this.opts.platform}] Disconnecting from CDP`);
      await this.browser.disconnect();
      this.browser = null;
      this._page = null;
    }
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Returns a ChromeDriver for the given platform.
 *
 * URL pattern is inferred from platform name (e.g. 'instagram' → 'instagram.com').
 */
export function getChromeDriver(platform: ChromePlatform, urlPatternOverride?: string): ChromeDriver {
  const cdpPort = SHARED_CDP_PORT;

  // Derive URL pattern from platform name
  const urlPattern = urlPatternOverride ?? platformUrlPattern(platform);

  console.log(`[chrome-driver] Factory: platform=${platform} cdpPort=${cdpPort} urlPattern=${urlPattern}`);
  return new ChromeDriver({ platform, cdpPort, urlPattern });
}

function platformUrlPattern(platform: ChromePlatform): string {
  const map: Record<ChromePlatform, string> = {
    instagram: 'instagram.com',
    twitter:   'x.com',
    tiktok:    'tiktok.com',
    threads:   'threads.net',
    linkedin:  'linkedin.com',
  };
  return map[platform];
}

// ─── Exports ──────────────────────────────────────────────────────────────────

export { DEFAULT_CDP_PORTS, CLAIMS_FILE };
