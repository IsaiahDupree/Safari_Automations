/**
 * Twitter/X DM Automation Module
 * 
 * Provides Safari-based Twitter/X DM automation with:
 * - Local/remote Safari driver
 * - DM operations (read, send, list, navigate)
 * - Profile-to-DM flow
 * - REST API server for CRM integration
 * - API client for calling from other servers
 * 
 * @example
 * ```typescript
 * // Direct automation (on Mac with Safari)
 * import { SafariDriver, sendDMByUsername } from '@safari-automation/twitter-dm';
 * 
 * const driver = new SafariDriver();
 * await sendDMByUsername('username', 'Hello!', driver);
 * 
 * // Via API (from CRM server)
 * import { createTwitterDMClient } from '@safari-automation/twitter-dm/api';
 * 
 * const client = createTwitterDMClient('http://localhost:3101');
 * await client.sendMessageTo('username', 'Hello!');
 * ```
 */

// Automation
export {
  // Driver
  SafariDriver,
  getDefaultDriver,
  setDefaultDriver,
  
  // Operations
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
  
  // Types
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
} from './automation/index.js';

// API
export {
  // Server
  startServer,
  app,
  
  // Client
  TwitterDMClient,
  createTwitterDMClient,
  type DMApiClientConfig,
  type ApiResponse,
} from './api/index.js';

// Utils
export {
  isWithinActiveHours,
  randomDelay,
  sleep,
  escapeForAppleScript,
  escapeForJS,
  parseUsername,
  formatTimestamp,
  truncate,
  isValidUsername,
  formatRateLimitStatus,
} from './utils/index.js';
