/**
 * @safari-automation/tiktok-dm
 * 
 * TikTok DM automation module using Safari browser automation.
 * Designed to be called from a CRM server or used directly on macOS.
 * 
 * @example
 * ```typescript
 * // Direct automation (macOS)
 * import { SafariDriver, navigateToInbox, sendDMByUsername } from '@safari-automation/tiktok-dm';
 * 
 * const driver = new SafariDriver({ verbose: true });
 * await navigateToInbox(driver);
 * await sendDMByUsername('creator123', 'Love your content!', driver);
 * 
 * // Via API client (from any server)
 * import { createTikTokDMClient } from '@safari-automation/tiktok-dm';
 * 
 * const client = createTikTokDMClient('http://mac-server:3102');
 * await client.sendMessageTo('creator123', 'Love your content!');
 * ```
 */

// Automation exports
export {
  SafariDriver,
  type SafariDriverOptions,
  navigateToInbox,
  listConversations,
  openConversation,
  readMessages,
  sendMessage,
  startNewConversation,
  sendDMByUsername,
  sendDMFromProfileUrl,
  scrollConversations,
} from './automation/index.js';

// Types
export {
  type DMConversation,
  type DMMessage,
  type DMThread,
  type SendMessageResult,
  type NavigationResult,
  type AutomationConfig,
  type RateLimitConfig,
  DEFAULT_CONFIG,
  DEFAULT_RATE_LIMITS,
  TIKTOK_SELECTORS,
  TIKTOK_URLS,
} from './automation/types.js';

// API exports
export {
  TikTokDMClient,
  createTikTokDMClient,
  type ApiResponse,
} from './api/client.js';

export { startServer, app } from './api/server.js';

// Utility exports
export {
  isWithinActiveHours,
  getRandomDelay,
  sleep,
  escapeForJs,
  parseUsername,
  isValidUsername,
  formatRateLimitStatus,
  getTimeUntilActiveHours,
  retryWithBackoff,
} from './utils/index.js';
