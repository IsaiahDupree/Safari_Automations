/**
 * Chrome CDP Driver — TikTok Comments
 *
 * Connects to the shared Chrome singleton on port 9222.
 * Uses browser.pages() to find or open the tiktok.com tab — never launches a new Chrome.
 *
 * TikTok-specific note: TikTok uses a virtual DOM (React) where comment inputs may have
 * 0×0 bounding rects. typeViaJS uses ClipboardEvent paste + execCommand fallbacks, which
 * bypass the virtual DOM limitations seen with Puppeteer's native page.type().
 *
 * Canonical endpoint: CHROME_CDP_URL=http://localhost:9222
 */

import puppeteer, { type Browser, type Page } from 'puppeteer-core';

const MOD = 'tiktok-comments:chrome-driver';
const PLATFORM_DOMAIN = 'tiktok.com';
const DEFAULT_CDP_URL = 'http://localhost:9222';

function log(level: 'info' | 'warn' | 'error' | 'debug', msg: string, data?: Record<string, unknown>) {
  const prefix = `[${MOD}][${level.toUpperCase()}]`;
  if (data) {
    console[level === 'debug' ? 'log' : level](`${prefix} ${msg}`, data);
  } else {
    console[level === 'debug' ? 'log' : level](`${prefix} ${msg}`);
  }
}

// ─── Module-level singletons ─────────────────────────────────────────────────

let _browser: Browser | null = null;
let _page: Page | null = null;

// ─── Connection ──────────────────────────────────────────────────────────────

async function getBrowser(): Promise<Browser> {
  if (_browser && _browser.connected) return _browser;

  const cdpUrl = DEFAULT_CDP_URL;
  log('info', `Connecting to Chrome CDP at ${cdpUrl}`);

  try {
    _browser = await puppeteer.connect({ browserURL: cdpUrl, defaultViewport: null });
    log('info', 'CDP connection established');
    _browser.on('disconnected', () => {
      log('warn', 'Chrome disconnected — resetting state');
      _browser = null;
      _page = null;
    });
    return _browser;
  } catch (err) {
    const msg = (err as Error).message;
    log('error', `CDP connection failed: ${msg}`);
    throw Object.assign(
      new Error(`Cannot connect to Chrome at ${cdpUrl}: ${msg}`),
      { code: 'CDP_CONNECT_FAILED', hint: 'Ensure the canonical Chrome is running on CDP 9222' }
    );
  }
}

/**
 * Find or open the TikTok tab.
 * Prefers an existing tiktok.com tab; opens a new one if none found.
 */
export async function getPage(): Promise<Page> {
  const b = await getBrowser();
  const pages = await b.pages();

  log('debug', `Open tabs: ${pages.length}`, { urls: pages.map(p => p.url().slice(0, 80)) });

  // Reuse existing TikTok tab
  const existing = pages.find(p => p.url().includes(PLATFORM_DOMAIN));
  if (existing) {
    log('debug', `Reusing TikTok tab: ${existing.url().slice(0, 80)}`);
    _page = existing;
    return _page;
  }

  // Fall back to last open tab
  if (pages.length > 0) {
    _page = pages[pages.length - 1];
    log('debug', `Reusing last tab: ${_page.url().slice(0, 80)}`);
    return _page;
  }

  // Open new tab
  log('info', 'No TikTok tab found — opening new tab');
  _page = await b.newPage();
  await _page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
  _page.on('pageerror', err => log('warn', `Page JS error: ${err.message}`));
  return _page;
}

// ─── Public driver API ───────────────────────────────────────────────────────

/**
 * Execute arbitrary JS in the TikTok page. Returns the stringified result.
 */
export async function evalJS(script: string): Promise<string> {
  const p = await getPage();
  const preview = script.slice(0, 60).replace(/\s+/g, ' ');
  log('debug', `evalJS: ${preview}...`);
  try {
    const result = await p.evaluate(script) as unknown;
    return result === null || result === undefined ? '' : String(result);
  } catch (err) {
    log('error', `evalJS failed: ${(err as Error).message}`);
    throw err;
  }
}

/**
 * Click a CSS selector, waiting up to timeoutMs.
 * Handles TikTok's virtual DOM: if the selector has a 0×0 bounding rect,
 * falls back to a JS .click() call to bypass the invisible element issue.
 */
export async function click(selector: string, timeoutMs = 8_000): Promise<void> {
  const p = await getPage();
  log('debug', `click: ${selector}`);
  await p.waitForSelector(selector, { timeout: timeoutMs });

  // Check for virtual DOM 0×0 rect (TikTok-specific bug)
  const rect = await p.evaluate((sel: string) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { width: r.width, height: r.height, x: r.x, y: r.y };
  }, selector);

  if (!rect || (rect.width === 0 && rect.height === 0)) {
    // Virtual DOM element — use JS click
    log('debug', `Virtual DOM click (0×0 rect): ${selector}`);
    await p.evaluate((sel: string) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (el) el.click();
    }, selector);
  } else {
    await p.click(selector);
  }
}

/**
 * Type text via JS ClipboardEvent paste — background-safe, handles TikTok's DraftEditor.
 * TikTok uses Draft.js (.DraftEditor-editorContainer) which has virtual DOM issues.
 * ClipboardEvent paste is the most reliable method.
 */
export async function typeViaJS(selector: string, text: string): Promise<boolean> {
  const p = await getPage();
  const escaped = JSON.stringify(text);
  // TikTok-specific selector priority: DraftEditor → contenteditable → data-e2e → active
  const selectorJs = selector
    ? `document.querySelector(${JSON.stringify(selector)})`
    : `(document.querySelector('.DraftEditor-editorContainer [contenteditable]') || document.querySelector('[data-e2e="comment-input"] [contenteditable]') || document.querySelector('[contenteditable="true"]') || document.activeElement)`;
  const js = `(function() {
  var el = ${selectorJs};
  if (!el) return 'no_el';
  // Method 1: ClipboardEvent paste — best for DraftEditor
  try {
    el.focus({ preventScroll: true });
    var dt = new DataTransfer();
    dt.setData('text/plain', ${escaped});
    dt.setData('text/html', '<span>' + ${escaped} + '</span>');
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    var len = el.textContent ? el.textContent.trim().length : (el.value || '').length;
    if (len > 0) return 'paste';
  } catch(e) {}
  // Method 2: execCommand insertText
  try {
    el.focus({ preventScroll: true });
    var ok = document.execCommand('selectAll', false, null) && document.execCommand('insertText', false, ${escaped});
    if (ok) return 'execCommand';
  } catch(e) {}
  // Method 3: nativeInputValueSetter
  try {
    var nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value') ||
                       Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
    if (nativeSetter && nativeSetter.set) {
      nativeSetter.set.call(el, ${escaped});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return 'nativeSetter';
    }
  } catch(e) {}
  el.value = ${escaped};
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return 'directSet';
})()`;
  const result = await p.evaluate(js) as string;
  return result !== 'no_el' && result !== '' && result !== 'false';
}

/**
 * Type text using clipboard paste — works with React/DraftEditor contenteditable.
 */
export async function typeViaClipboard(text: string): Promise<void> {
  const p = await getPage();
  log('debug', `typeViaClipboard: ${text.slice(0, 40)}...`);
  const { execSync } = await import('child_process');
  execSync(`printf '%s' ${JSON.stringify(text)} | pbcopy`);
  await p.keyboard.down('Meta');
  await p.keyboard.press('v');
  await p.keyboard.up('Meta');
}

/**
 * Press Enter in the currently focused element.
 */
export async function pressEnter(): Promise<void> {
  const p = await getPage();
  await p.keyboard.press('Enter');
}

/**
 * Press Enter via JS keyboard events (background-safe).
 */
export async function pressEnterViaJS(selector?: string): Promise<boolean> {
  const p = await getPage();
  const selectorJs = selector
    ? `document.querySelector(${JSON.stringify(selector)})`
    : 'document.activeElement';
  const js = `(function() {
  var el = ${selectorJs} || document.activeElement;
  if (!el) return false;
  ['keydown','keypress','keyup'].forEach(function(t) {
    el.dispatchEvent(new KeyboardEvent(t, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
  });
  return true;
})()`;
  const result = await p.evaluate(js) as boolean;
  return result;
}

/**
 * Get the current URL of the TikTok page.
 */
export async function getCurrentUrl(): Promise<string> {
  const p = await getPage();
  return p.url();
}

/**
 * Navigate the TikTok page to a URL.
 */
export async function navigateTo(
  url: string,
  waitUntil: 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2' = 'domcontentloaded'
): Promise<void> {
  const p = await getPage();
  log('info', `Navigating to ${url.slice(0, 80)}`);
  await p.goto(url, { waitUntil, timeout: 30_000 });
}

/**
 * Wait for a CSS selector to appear.
 */
export async function waitForSelector(selector: string, timeoutMs = 10_000): Promise<boolean> {
  const p = await getPage();
  log('debug', `waitForSelector: ${selector} (${timeoutMs}ms)`);
  try {
    await p.waitForSelector(selector, { timeout: timeoutMs });
    return true;
  } catch {
    log('warn', `Selector not found within ${timeoutMs}ms: ${selector}`);
    return false;
  }
}

/**
 * Take a base64-encoded JPEG screenshot.
 */
export async function takeScreenshot(): Promise<string> {
  const p = await getPage();
  const buf = await p.screenshot({ encoding: 'base64', type: 'jpeg', quality: 80 });
  return buf as string;
}

/**
 * Click an element by CSS selector via JS (handles virtual DOM 0×0 elements).
 */
export async function clickElement(selector: string): Promise<boolean> {
  const result = await evalJS(`(function() {
  var el = document.querySelector(${JSON.stringify(selector)});
  if (el) { el.click(); return 'clicked'; }
  return 'not_found';
})()`);
  return result === 'clicked';
}

/**
 * Check whether Chrome CDP is reachable and a TikTok tab exists.
 */
export async function getCDPStatus(): Promise<{ connected: boolean; hasTikTokTab: boolean; url: string; error?: string }> {
  try {
    const b = await getBrowser();
    const pages = await b.pages();
    const tkPage = pages.find(p => p.url().includes(PLATFORM_DOMAIN));
    return {
      connected: true,
      hasTikTokTab: !!tkPage,
      url: tkPage?.url() ?? '',
    };
  } catch (err) {
    return {
      connected: false,
      hasTikTokTab: false,
      url: '',
      error: (err as Error).message,
    };
  }
}

/**
 * Disconnect from Chrome (does not close Chrome itself).
 */
export async function disconnect(): Promise<void> {
  if (_browser) {
    try { _browser.disconnect(); } catch { /* ignore */ }
    _browser = null;
    _page = null;
  }
}
