/**
 * Instagram DM Automation Module
 * 
 * Provides Safari-based Instagram DM automation with:
 * - Local/remote Safari driver
 * - DM operations (read, send, list, navigate)
 * - REST API server for CRM integration
 * - API client for calling from other servers
 * 
 * @example
 * ```typescript
 * // Direct automation (on Mac with Safari)
 * import { SafariDriver, sendMessage, openConversation } from '@safari-automation/instagram-dm';
 * 
 * const driver = new SafariDriver();
 * await openConversation('username', driver);
 * await sendMessage('Hello!', driver);
 * 
 * // Via API (from CRM server)
 * import { createDMClient } from '@safari-automation/instagram-dm/api';
 * 
 * const client = createDMClient('http://localhost:3100');
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
  getAllConversations,
  
  // Types
  type DMConversation,
  type DMMessage,
  type DMThread,
  type DMTab,
  type SendMessageResult,
  type NavigationResult,
  type AutomationConfig,
  type RateLimitConfig,
  DEFAULT_CONFIG,
  DEFAULT_RATE_LIMITS,
} from './automation/index.js';

// API
export {
  // Server
  startServer,
  app,
  
  // Client
  InstagramDMClient,
  createDMClient,
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
} from './utils/index.js';
