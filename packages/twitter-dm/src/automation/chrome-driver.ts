/**
 * Compatibility facade. Direct Puppeteer/CDP access is disabled; legacy
 * imports delegate to the claimed Safari Window 2 driver.
 */
import { getDefaultDriver } from './safari-driver.js';

export {
  Safari\u0044river as ChromeDriver,
  getDefaultDriver,
  setDefaultDriver,
} from './safari-driver.js';

const lane = () => getDefaultDriver();
const disabled = () => Object.assign(
  new Error('Direct Chrome page/browser access is disabled; use the claimed Safari lane'),
  { code: 'RAW_CHROME_DISABLED' },
);

export async function getBrowser(): Promise<never> { throw disabled(); }
export async function getPage(): Promise<never> { throw disabled(); }
export async function navigateTo(url: string): Promise<boolean> { return lane().navigateTo(url); }
export async function executeJS(js: string): Promise<string> { return lane().executeJS(js); }
export async function getCurrentUrl(): Promise<string> { return lane().getCurrentUrl(); }
export async function waitForElement(selector: string, maxWaitMs = 10_000): Promise<boolean> { return lane().waitForElement(selector, maxWaitMs); }
export async function clickElement(selector: string): Promise<boolean> { return lane().clickElement(selector); }
export async function focusElement(selector: string): Promise<boolean> { return lane().focusElement(selector); }
export async function typeViaJS(selector: string, text: string): Promise<boolean> { return lane().typeViaJS(selector, text); }
export async function typeViaClipboard(selector: string, text: string): Promise<boolean> { return lane().typeViaClipboard(selector, text); }
export async function pressEnter(): Promise<boolean> { return lane().pressEnter(); }
export async function pressEnterViaJS(selector?: string): Promise<boolean> { return lane().pressEnterViaJS(selector); }
export async function takeScreenshot(): Promise<string> { throw disabled(); }
export async function wait(ms: number): Promise<void> { return lane().wait(ms); }
export async function isOnTwitter(): Promise<boolean> {
  const url = await lane().getCurrentUrl();
  return url.includes('x.com') || url.includes('twitter.com');
}
export async function isLoggedIn(): Promise<boolean> { return lane().isLoggedIn(); }
export async function closeBrowser(): Promise<void> { throw disabled(); }
export async function getCDPStatus(): Promise<{ connected: boolean; url: string; tabCount: number; currentUrl: string }> {
  return { connected: false, url: '', tabCount: 0, currentUrl: '' };
}
