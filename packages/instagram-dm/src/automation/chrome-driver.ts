/**
 * Compatibility facade. Local Chrome stays behind its resource-capped broker;
 * callers here use independently targeted Safari automation.
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
  return Object.assign(new Error('Direct local-Chrome access is disabled here; use open Safari automation or the resource-capped Chrome broker'), {
    code: 'RAW_CHROME_DISABLED',
  });
}

export async function getPage(): Promise<LegacyPage> {
  throw disabled();
}

export async function ensureInstagramTab(): Promise<LegacyPage> {
  throw disabled();
}
