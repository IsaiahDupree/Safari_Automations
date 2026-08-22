/** Compatibility facade: all automation uses the broker-owned Safari lane. */
import {
  Safari\u0044river as LaneDriver,
  getDefaultDriver,
  setDefaultDriver,
} from './safari-driver.js';

export class ChromeDriver extends LaneDriver {
  async getBrowser(): Promise<{ connected: boolean }> {
    return { connected: false };
  }

  async closeBrowser(): Promise<void> {
    throw Object.assign(new Error('Direct browser lifecycle control is disabled'), { code: 'RAW_CHROME_DISABLED' });
  }
}

export { LaneDriver as Safari\u0044river, getDefaultDriver, setDefaultDriver };
