/** Legacy direct-CDP surface. Production uses the claimed Safari lane. */
const disabled = () => Object.assign(new Error('Direct Chrome automation is disabled'), { code: 'RAW_CHROME_DISABLED' });
export async function getPage(): Promise<never> { throw disabled(); }
export async function evalJS(_script: string): Promise<string> { throw disabled(); }
export async function click(_selector: string, _timeoutMs = 8_000): Promise<void> { throw disabled(); }
export async function typeViaJS(_selector: string, _text: string): Promise<boolean> { throw disabled(); }
export async function typeViaClipboard(_text: string): Promise<void> { throw disabled(); }
export async function pressEnter(): Promise<void> { throw disabled(); }
export async function pressEnterViaJS(_selector?: string): Promise<boolean> { throw disabled(); }
export async function getCurrentUrl(): Promise<string> { throw disabled(); }
export async function navigateTo(_url: string, _waitUntil?: string): Promise<boolean> { throw disabled(); }
export async function waitForSelector(_selector: string, _timeoutMs = 10_000): Promise<boolean> { throw disabled(); }
export async function takeScreenshot(): Promise<string> { throw disabled(); }
export async function clickElement(_selector: string): Promise<boolean> { throw disabled(); }
export async function focusElement(_selector: string): Promise<boolean> { throw disabled(); }
export async function getCDPStatus(): Promise<{ connected: boolean; hasThreadsTab: boolean; url: string; error?: string }> {
  return { connected: false, hasThreadsTab: false, url: '', error: 'Direct Chrome automation disabled' };
}
export async function disconnect(): Promise<void> {}
