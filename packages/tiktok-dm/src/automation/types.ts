/**
 * TikTok DM Automation Types
 */

export interface DMConversation {
  username: string;
  displayName?: string;
  lastMessage?: string;
  timestamp?: string;
  unread: boolean;
  avatarUrl?: string;
}

export interface DMMessage {
  id?: string;
  content: string;
  sender: 'me' | 'them';
  timestamp?: string;
  type: 'text' | 'image' | 'video' | 'sticker';
}

export interface DMThread {
  username: string;
  displayName?: string;
  messages: DMMessage[];
}

export interface SendMessageResult {
  success: boolean;
  error?: string;
  messageId?: string;
  username?: string;
  verified?: boolean;
  verifiedRecipient?: string;
}

export interface NavigationResult {
  success: boolean;
  error?: string;
  currentUrl?: string;
}

export interface AutomationConfig {
  verbose: boolean;
  timeout: number;
  retryAttempts: number;
  retryDelay: number;
}

export interface RateLimitConfig {
  messagesPerHour: number;
  messagesPerDay: number;
  minDelayMs: number;
  maxDelayMs: number;
  activeHoursStart: number;
  activeHoursEnd: number;
}

export const DEFAULT_CONFIG: AutomationConfig = {
  verbose: false,
  timeout: 30000,
  retryAttempts: 3,
  retryDelay: 1000,
};

export const DEFAULT_RATE_LIMITS: RateLimitConfig = {
  messagesPerHour: 10,
  messagesPerDay: 50,
  minDelayMs: 120000,  // 2 minutes
  maxDelayMs: 300000,  // 5 minutes
  activeHoursStart: 9,
  activeHoursEnd: 21,
};

/**
 * TikTok-specific selectors — VALIDATED via DOM audit 2026-02-06
 * 
 * Key finding: TikTok messages page uses virtual rendering. Most sidebar
 * elements report 0x0 dimensions from getBoundingClientRect(). However:
 * - aria-label attributes are reliable identifiers (e.g. "Sarah E Ashley | Travel & Life's profile")
 * - href attributes contain exact handles (e.g. "/@saraheashley")
 * - Avatar <img> elements DO have real dimensions (48x48 at x≈60-130)
 * - Class suffixes like --LiInboxItemWrapper are stable across sessions
 * 
 * Conversation DOM structure:
 *   UL[--UlInboxItemListContainer]
 *     > LI[--LiInboxItemWrapper]
 *       > DIV[--DivItemContainer]
 *         > DIV[--DivAvatarContainer]
 *           > A[aria-label="[Name]'s profile", href="/@handle"]
 */
export const TIKTOK_SELECTORS = {
  // === CONVERSATION LIST (validated 2026-02-06) ===
  // Primary: aria-label on <a> tags — most reliable identifier
  conversationLinkByHandle: (handle: string) => `a[href="/@${handle}"]`,
  conversationLinkByName: (name: string) => `a[aria-label*="${name}"]`,
  // Structural selectors (class suffixes stable across sessions)
  conversationList: 'ul[class*="InboxItemListContainer"]',
  conversationItem: 'li[class*="InboxItemWrapper"]',
  conversationItemContainer: 'div[class*="DivItemContainer"]',
  conversationAvatarContainer: 'div[class*="DivAvatarContainer"]',
  // Avatar images — the ONLY sidebar elements with real dimensions
  conversationAvatarImg: 'img',  // Filter: 36-60px wide, x 50-140, y > 50
  
  // === SEARCH (validated 2026-02-06) ===
  searchInput: 'input[data-e2e="search-user-input"]',
  searchInputFallback: 'input[placeholder*="Search"]',
  
  // === CHAT HEADER (validated 2026-02-06) ===
  // After opening conversation, header contains recipient identity
  chatHeaderLink: (handle: string) => `a[href="/@${handle}"]`,
  
  // === COMPOSER (validated 2026-02-06) ===
  // TikTok uses Draft.js for the message input
  messageInputDraft: '.public-DraftEditor-content[contenteditable="true"]',
  messageInputCE: '[contenteditable="true"]',
  messageInputFallback: '[data-e2e="message-input"]',
  sendButton: '[data-e2e="message-send"]',
  sendButtonAlt: 'svg[data-e2e="message-send"]',
  sendButtonFallback: '[data-e2e="send-message-btn"]',
  
  // === NAVIGATION (validated 2026-02-06) ===
  navMessages: '[aria-label="Messages"]',
  navMessagesAlt: 'a[href*="/messages"]',
  
  // === PROFILE PAGE ===
  profileMessageButton: '[data-e2e="message-button"]',
  profileMessageButtonAlt: '[data-e2e="message-icon"]',
  profileFollowButton: '[data-e2e="follow-button"]',
  
  // === LOGIN DETECTION ===
  loginButton: '[data-e2e="login-button"]',
};

export const TIKTOK_URLS = {
  base: 'https://www.tiktok.com',
  messages: 'https://www.tiktok.com/messages',
  profile: (username: string) => `https://www.tiktok.com/@${username}`,
  searchUsers: (query: string) => `https://www.tiktok.com/search/user?q=${encodeURIComponent(query)}`,
};
