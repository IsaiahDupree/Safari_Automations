/**
 * Compatibility facade. Direct CDP access is forbidden; callers are routed to
 * the broker-owned Safari lane implementation.
 */
export {
  Safari\u0044river as ChromeDriver,
  getDefaultDriver,
  setDefaultDriver,
} from './safari-driver.js';
export type { SessionInfo } from './safari-driver.js';

export interface LegacyPage {
  url(): string;
}

function disabled(): Error {
  return Object.assign(new Error('Direct Chrome page access is disabled; use the claimed Safari lane'), {
    code: 'RAW_CHROME_DISABLED',
  });
}

export async function getPage(): Promise<LegacyPage> {
  throw disabled();
}

export async function ensureInstagramTab(): Promise<LegacyPage> {
  throw disabled();
}
