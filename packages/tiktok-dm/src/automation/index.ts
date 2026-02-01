/**
 * TikTok DM Automation Exports
 */

export { SafariDriver, type SafariDriverOptions } from './safari-driver.js';

export {
  checkAndRetryError,
  hasErrorState,
  navigateToInbox,
  listConversations,
  openConversation,
  readMessages,
  sendMessage,
  startNewConversation,
  sendDMByUsername,
  sendDMFromProfileUrl,
  scrollConversations,
} from './dm-operations.js';

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
} from './types.js';
