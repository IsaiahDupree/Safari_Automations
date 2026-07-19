/**
 * TikTok DM Automation Exports
 */

// Chrome/Puppeteer driver (replaces Safari/AppleScript)
// ChromeDriver is also exported as SafariDriver so dm-operations.ts compiles without changes.
export { ChromeDriver, ChromeDriver as SafariDriver, getDefaultDriver, setDefaultDriver } from './chrome-driver.js';

// SessionInfo compat stub (Safari driver used window/tab indices; Chrome driver does not)
export type SessionInfo = { found: boolean; windowIndex: number; tabIndex: number; url: string };

export {
  checkAndRetryError,
  hasErrorState,
  detectTikTokRateLimit,
  navigateToInbox,
  listConversations,
  openConversation,
  readMessages,
  sendMessage,
  startNewConversation,
  sendDMByUsername,
  sendDMFromProfileUrl,
  scrollConversations,
  enrichContact,
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
