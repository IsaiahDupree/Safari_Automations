import { Builder, WebDriver, By, until, WebElement } from 'selenium-webdriver';
import safari from 'selenium-webdriver/safari';
import type {
  Browser,
  BrowserOptions,
  Element,
  Cookie,
  NavigationOptions,
  WaitOptions,
} from './types';

const DEFAULT_TIMEOUT = 30000;

export class SafariBrowser implements Browser {
  private driver: WebDriver | null = null;
  private options: BrowserOptions;

  constructor(options: BrowserOptions = {}) {
    this.options = {
      timeout: DEFAULT_TIMEOUT,
      screenshotOnFailure: true,
      ...options,
    };
  }

  async initialize(): Promise<void> {
    const safariOptions = new safari.Options();

    this.driver = await new Builder()
      .forBrowser('safari')
      .setSafariOptions(safariOptions)
      .build();

    await this.driver.manage().setTimeouts({
      implicit: 0,
      pageLoad: this.options.timeout,
      script: this.options.timeout,
    });
  }

  async close(): Promise<void> {
    if (this.driver) {
      await this.driver.quit();
      this.driver = null;
    }
  }

  private getDriver(): WebDriver {
    if (!this.driver) {
      throw new Error('Browser not initialized. Call initialize() first.');
    }
    return this.driver;
  }

  // Navigation
  async navigate(url: string, options?: NavigationOptions): Promise<void> {
    const driver = this.getDriver();
    await driver.get(url);

    if (options?.waitUntil === 'networkidle') {
      await this.waitForNetworkIdle();
    }
  }

  async refresh(): Promise<void> {
    await this.getDriver().navigate().refresh();
  }

  async back(): Promise<void> {
    await this.getDriver().navigate().back();
  }

  async forward(): Promise<void> {
    await this.getDriver().navigate().forward();
  }

  async getCurrentUrl(): Promise<string> {
    return this.getDriver().getCurrentUrl();
  }

  // Elements
  async findElement(selector: string): Promise<Element> {
    const driver = this.getDriver();
    const webElement = await driver.findElement(By.css(selector));
    return this.wrapElement(webElement);
  }

  async findElements(selector: string): Promise<Element[]> {
    const driver = this.getDriver();
    const webElements = await driver.findElements(By.css(selector));
    return webElements.map((el) => this.wrapElement(el));
  }

  async findElementSafe(selector: string): Promise<Element | null> {
    try {
      const elements = await this.findElements(selector);
      return elements.length > 0 ? elements[0] : null;
    } catch {
      return null;
    }
  }

  async waitForElement(
    selector: string,
    options?: WaitOptions
  ): Promise<Element> {
    const driver = this.getDriver();
    const timeout = options?.timeout || this.options.timeout || DEFAULT_TIMEOUT;

    const webElement = await driver.wait(
      until.elementLocated(By.css(selector)),
      timeout
    );

    return this.wrapElement(webElement);
  }

  async elementExists(selector: string): Promise<boolean> {
    const elements = await this.findElements(selector);
    return elements.length > 0;
  }

  async textExists(text: string): Promise<boolean> {
    const driver = this.getDriver();
    const pageSource = await driver.getPageSource();
    return pageSource.includes(text);
  }

  // Actions
  async click(element: Element): Promise<void> {
    await element.click();
  }

  async type(element: Element, text: string): Promise<void> {
    await element.type(text);
  }

  async clear(element: Element): Promise<void> {
    await element.clear();
  }

  async scroll(direction: 'up' | 'down', amount: number = 300): Promise<void> {
    const driver = this.getDriver();
    const scrollAmount = direction === 'down' ? amount : -amount;
    await driver.executeScript(`window.scrollBy(0, ${scrollAmount})`);
  }

  async scrollToElement(element: Element): Promise<void> {
    const driver = this.getDriver();
    await driver.executeScript(
      'arguments[0].scrollIntoView({ behavior: "smooth", block: "center" })',
      (element as WrappedElement).webElement
    );
  }

  // State
  async getCookies(): Promise<Cookie[]> {
    const driver = this.getDriver();
    const cookies = await driver.manage().getCookies();
    return cookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      expires: c.expiry ? Math.floor(typeof c.expiry === 'number' ? c.expiry : c.expiry.getTime() / 1000) : undefined,
      httpOnly: c.httpOnly,
      secure: c.secure,
      sameSite: c.sameSite as Cookie['sameSite'],
    }));
  }

  async setCookies(cookies: Cookie[]): Promise<void> {
    const driver = this.getDriver();
    for (const cookie of cookies) {
      await driver.manage().addCookie({
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        expiry: cookie.expires ? new Date(cookie.expires * 1000) : undefined,
        httpOnly: cookie.httpOnly,
        secure: cookie.secure,
        sameSite: cookie.sameSite,
      });
    }
  }

  async clearCookies(): Promise<void> {
    await this.getDriver().manage().deleteAllCookies();
  }

  async takeScreenshot(): Promise<Buffer> {
    const driver = this.getDriver();
    const base64 = await driver.takeScreenshot();
    return Buffer.from(base64, 'base64');
  }

  async getPageSource(): Promise<string> {
    return this.getDriver().getPageSource();
  }

  // JavaScript
  async executeScript<T>(script: string, ...args: unknown[]): Promise<T> {
    const driver = this.getDriver();
    return driver.executeScript(script, ...args) as Promise<T>;
  }

  // Waits
  async waitForEnabled(element: Element, options?: WaitOptions): Promise<void> {
    const timeout = options?.timeout || this.options.timeout || DEFAULT_TIMEOUT;
    const pollInterval = options?.pollInterval || 100;

    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      if (await element.isEnabled()) {
        return;
      }
      await this.sleep(pollInterval);
    }

    throw new Error('Element did not become enabled within timeout');
  }

  async waitForText(text: string, options?: WaitOptions): Promise<void> {
    const timeout = options?.timeout || this.options.timeout || DEFAULT_TIMEOUT;
    const pollInterval = options?.pollInterval || 100;

    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      if (await this.textExists(text)) {
        return;
      }
      await this.sleep(pollInterval);
    }

    throw new Error(`Text "${text}" did not appear within timeout`);
  }

  async waitForNavigation(options?: WaitOptions): Promise<void> {
    const timeout = options?.timeout || this.options.timeout || DEFAULT_TIMEOUT;
    const driver = this.getDriver();

    await driver.wait(async () => {
      const readyState = await driver.executeScript(
        'return document.readyState'
      );
      return readyState === 'complete';
    }, timeout);
  }

  // Private helpers
  private wrapElement(webElement: WebElement): Element {
    return new WrappedElement(webElement);
  }

  private async waitForNetworkIdle(): Promise<void> {
    await this.sleep(1000);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

class WrappedElement implements Element {
  webElement: WebElement;

  constructor(webElement: WebElement) {
    this.webElement = webElement;
  }

  async click(): Promise<void> {
    await this.webElement.click();
  }

  async type(text: string): Promise<void> {
    await this.webElement.sendKeys(text);
  }

  async clear(): Promise<void> {
    await this.webElement.clear();
  }

  async getText(): Promise<string> {
    return this.webElement.getText();
  }

  async getAttribute(name: string): Promise<string | null> {
    return this.webElement.getAttribute(name);
  }

  async isDisplayed(): Promise<boolean> {
    return this.webElement.isDisplayed();
  }

  async isEnabled(): Promise<boolean> {
    return this.webElement.isEnabled();
  }

  async getTagName(): Promise<string> {
    return this.webElement.getTagName();
  }

  async getCssValue(property: string): Promise<string> {
    return this.webElement.getCssValue(property);
  }
}
