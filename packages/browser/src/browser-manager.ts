import { SafariBrowser } from './safari-browser';
import type { Browser, BrowserOptions } from './types';

export class BrowserManager {
  private browser: Browser | null = null;
  private options: BrowserOptions;

  constructor(options: BrowserOptions = {}) {
    this.options = options;
  }

  async getBrowser(): Promise<Browser> {
    if (!this.browser) {
      this.browser = new SafariBrowser(this.options);
      await this.browser.initialize();
    }
    return this.browser;
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  isInitialized(): boolean {
    return this.browser !== null;
  }
}
