import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { logInfo, logWarn, logError, logDebug } from './logger.js';

const MOD = 'browser';

// ─── Profile resolution ─────────────────────────────────────────────────────
// Priority (highest → lowest):
//   1. CHROME_CDP_URL  — connect to already-running Chrome (no launch needed)
//   2. CHROME_USER_DATA_DIR + CHROME_PROFILE  — use a specific Chrome profile
//   3. Default isolated profile at ~/.linkedin-chrome-profile
const DEFAULT_USER_DATA_DIR = join(homedir(), '.linkedin-chrome-profile');

function resolveUserDataDir(): { userDataDir: string; profileDir: string } {
  const custom = process.env['CHROME_USER_DATA_DIR'];
  if (custom) {
    return { userDataDir: custom, profileDir: process.env['CHROME_PROFILE'] || 'Default' };
  }
  return { userDataDir: DEFAULT_USER_DATA_DIR, profileDir: 'Default' };
}

const CHROME_PATHS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
];

function findChrome(): string {
  for (const p of CHROME_PATHS) {
    if (existsSync(p)) { logDebug(MOD, `Found Chrome at ${p}`); return p; }
  }
  const msg = `Chrome not found. Checked: ${CHROME_PATHS.join(', ')}. Set CHROME_PATH env var.`;
  logError(MOD, msg);
  throw new Error(msg);
}

let browser: Browser | null = null;
let page: Page | null = null;

async function connectToCDP(url: string): Promise<Browser> {
  logInfo(MOD, 'Connecting to existing Chrome via CDP', { url });
  try {
    const b = await puppeteer.connect({ browserURL: url, defaultViewport: null });
    logInfo(MOD, 'CDP connection established', { url });
    b.on('disconnected', () => { logWarn(MOD, 'CDP browser disconnected — resetting state'); browser = null; page = null; });
    return b;
  } catch (err) {
    logError(MOD, 'CDP connection failed', { url, error: (err as Error).message });
    throw Object.assign(new Error(`Cannot connect to Chrome at ${url}: ${(err as Error).message}`), {
      code: 'CDP_CONNECT_FAILED',
      hint: `Make sure Chrome is running with: --remote-debugging-port=9222`,
    });
  }
}

export async function getBrowser(): Promise<Browser> {
  if (browser && browser.connected) { logDebug(MOD, 'Reusing existing browser'); return browser; }

  // Mode 1: Connect to existing Chrome via CDP
  const cdpUrl = process.env['CHROME_CDP_URL'];
  if (cdpUrl) {
    browser = await connectToCDP(cdpUrl);
    return browser;
  }

  // Mode 2: Launch Chrome (with custom profile or default isolated profile)
  const { userDataDir, profileDir } = resolveUserDataDir();
  if (!existsSync(userDataDir)) {
    mkdirSync(userDataDir, { recursive: true });
    logInfo(MOD, `Created user data dir: ${userDataDir}`);
  }
  const executablePath = process.env['CHROME_PATH'] || findChrome();
  const usingCustomProfile = !!process.env['CHROME_USER_DATA_DIR'];
  logInfo(MOD, 'Launching Chrome', { executablePath, userDataDir, profileDir, usingCustomProfile });
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
    logInfo(MOD, 'Chrome launched', { pid: browser.process()?.pid, profileDir });
    browser.on('disconnected', () => {
      logWarn(MOD, 'Browser disconnected — resetting state');
      browser = null; page = null;
    });
    return browser;
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('user data directory is already in use')) {
      logError(MOD, 'Profile is locked by another Chrome instance', { userDataDir, profileDir });
      throw Object.assign(new Error('Chrome profile is already open. Either close Chrome or use CHROME_CDP_URL to connect to it.'), { code: 'PROFILE_LOCKED' });
    }
    logError(MOD, 'Failed to launch Chrome', { error: msg });
    throw err;
  }
}

export async function getPage(): Promise<Page> {
  const b = await getBrowser();
  const pages = await b.pages();
  logDebug(MOD, `Open tabs: ${pages.length}`, { urls: pages.map(p => p.url().slice(0, 60)) });

  const linkedinPage = pages.find(p => p.url().includes('linkedin.com'));
  if (linkedinPage) {
    logDebug(MOD, 'Reusing LinkedIn tab', { url: linkedinPage.url().slice(0, 80) });
    page = linkedinPage; return page;
  }

  if (pages.length > 0) {
    page = pages[pages.length - 1];
    logDebug(MOD, 'Reusing last tab', { url: page.url().slice(0, 80) });
    return page;
  }

  logInfo(MOD, 'Opening new tab');
  page = await b.newPage();
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
  page.on('pageerror', err => logWarn(MOD, 'Page JS error', { error: err.message }));
  page.on('requestfailed', req => logWarn(MOD, 'Request failed', { url: req.url().slice(0, 100), reason: req.failure()?.errorText }));
  return page;
}

export async function navigateTo(url: string, waitUntil: 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2' = 'domcontentloaded'): Promise<Page> {
  const p = await getPage();
  const t = Date.now();
  logInfo(MOD, `Navigating to ${url.slice(0, 80)}`, { waitUntil });
  try {
    await p.goto(url, { waitUntil, timeout: 30_000 });
    const finalUrl = p.url();
    logInfo(MOD, `Navigation complete`, { ms: Date.now() - t, finalUrl: finalUrl.slice(0, 80) });
    if (finalUrl.includes('authwall') || finalUrl.includes('/login')) {
      logWarn(MOD, 'LinkedIn session expired — redirected to login/authwall', { finalUrl });
    }
    return p;
  } catch (err) {
    logError(MOD, `Navigation failed for ${url.slice(0, 80)}`, { ms: Date.now() - t, error: (err as Error).message });
    throw err;
  }
}

export async function waitFor(selector: string, timeoutMs = 10_000): Promise<void> {
  const p = await getPage();
  logDebug(MOD, `Waiting for selector`, { selector, timeoutMs });
  try {
    await p.waitForSelector(selector, { timeout: timeoutMs });
    logDebug(MOD, `Selector found`, { selector });
  } catch (err) {
    logWarn(MOD, `Selector not found within ${timeoutMs}ms`, { selector });
    throw err;
  }
}

export async function evalJS<T>(script: string): Promise<T> {
  const p = await getPage();
  const preview = script.slice(0, 60).replace(/\s+/g, ' ');
  logDebug(MOD, `evalJS: ${preview}...`);
  try {
    const result = await p.evaluate(script) as T;
    logDebug(MOD, 'evalJS complete', { resultType: typeof result });
    return result;
  } catch (err) {
    logError(MOD, 'evalJS failed', { script: preview, error: (err as Error).message });
    throw err;
  }
}

export async function currentUrl(): Promise<string> {
  const p = await getPage();
  return p.url();
}

export async function takeScreenshot(): Promise<string> {
  const p = await getPage();
  const buf = await p.screenshot({ encoding: 'base64', type: 'jpeg', quality: 80 });
  return buf as string;
}

export async function click(selector: string): Promise<void> {
  const p = await getPage();
  logDebug(MOD, `Clicking selector`, { selector });
  try {
    await p.waitForSelector(selector, { timeout: 8_000 });
    await p.click(selector);
    logDebug(MOD, `Clicked`, { selector });
  } catch (err) {
    logError(MOD, `Click failed`, { selector, error: (err as Error).message });
    throw err;
  }
}

export async function clickAtXY(x: number, y: number): Promise<void> {
  const p = await getPage();
  logDebug(MOD, `Clicking at coordinates`, { x, y });
  await p.mouse.click(x, y);
}

export async function typeInto(selector: string, text: string, clearFirst = true): Promise<void> {
  const p = await getPage();
  logDebug(MOD, `Typing into selector`, { selector, length: text.length, clearFirst });
  try {
    await p.waitForSelector(selector, { timeout: 8_000 });
    if (clearFirst) await p.evaluate(`(function(){ const el = document.querySelector(${JSON.stringify(selector)}); if (el) el.value = ''; })()`);
    await p.type(selector, text, { delay: 40 });
    logDebug(MOD, `Type complete`, { selector });
  } catch (err) {
    logError(MOD, `typeInto failed`, { selector, error: (err as Error).message });
    throw err;
  }
}

export async function closeBrowser(): Promise<void> {
  if (browser) {
    logInfo(MOD, 'Closing browser');
    await browser.close();
    browser = null; page = null;
    logInfo(MOD, 'Browser closed');
  }
}
