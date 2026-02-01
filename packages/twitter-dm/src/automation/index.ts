/**
 * Twitter/X DM Automation - Main Exports
 */

export {
  SafariDriver,
  getDefaultDriver,
  setDefaultDriver,
} from './safari-driver.js';

export {
  navigateToInbox,
  listConversations,
  switchTab,
  openConversation,
  readMessages,
  sendMessage,
  startNewConversation,
  sendDMByUsername,
  sendDMFromProfileUrl,
  getUnreadConversations,
  scrollConversation,
  getAllConversations,
} from './dm-operations.js';

export {
  type DMConversation,
  type DMMessage,
  type DMThread,
  type DMTab,
  type SendMessageResult,
  type NavigationResult,
  type ProfileDMResult,
  type AutomationConfig,
  type RateLimitConfig,
  DEFAULT_CONFIG,
  DEFAULT_RATE_LIMITS,
  TWITTER_SELECTORS,
} from './types.js';
