export interface BrowserOptions {
  timeout?: number;
  screenshotOnFailure?: boolean;
  sessionPath?: string;
  headless?: boolean;
}

export interface Browser {
  initialize(): Promise<void>;
  close(): Promise<void>;

  // Navigation
  navigate(url: string, options?: NavigationOptions): Promise<void>;
  refresh(): Promise<void>;
  back(): Promise<void>;
  forward(): Promise<void>;
  getCurrentUrl(): Promise<string>;

  // Elements
  findElement(selector: string): Promise<Element>;
  findElements(selector: string): Promise<Element[]>;
  findElementSafe(selector: string): Promise<Element | null>;
  waitForElement(selector: string, options?: WaitOptions): Promise<Element>;
  elementExists(selector: string): Promise<boolean>;
  textExists(text: string): Promise<boolean>;

  // Actions
  click(element: Element): Promise<void>;
  type(element: Element, text: string): Promise<void>;
  clear(element: Element): Promise<void>;
  scroll(direction: 'up' | 'down', amount?: number): Promise<void>;
  scrollToElement(element: Element): Promise<void>;

  // State
  getCookies(): Promise<Cookie[]>;
  setCookies(cookies: Cookie[]): Promise<void>;
  clearCookies(): Promise<void>;
  takeScreenshot(): Promise<Buffer>;
  getPageSource(): Promise<string>;

  // JavaScript
  executeScript<T>(script: string, ...args: unknown[]): Promise<T>;

  // Waits
  waitForEnabled(element: Element, options?: WaitOptions): Promise<void>;
  waitForText(text: string, options?: WaitOptions): Promise<void>;
  waitForNavigation(options?: WaitOptions): Promise<void>;
}

export interface Element {
  click(): Promise<void>;
  type(text: string): Promise<void>;
  clear(): Promise<void>;
  getText(): Promise<string>;
  getAttribute(name: string): Promise<string | null>;
  isDisplayed(): Promise<boolean>;
  isEnabled(): Promise<boolean>;
  getTagName(): Promise<string>;
  getCssValue(property: string): Promise<string>;
}

export interface Cookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

export interface NavigationOptions {
  timeout?: number;
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
}

export interface WaitOptions {
  timeout?: number;
  pollInterval?: number;
}

export interface ScreenshotOptions {
  fullPage?: boolean;
  clip?: { x: number; y: number; width: number; height: number };
}
