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
 * TikTok-specific selectors
 * Based on TIKTOK_SELECTORS_REFERENCE.md
 */
export const TIKTOK_SELECTORS = {
  // Navigation
  messagesIcon: '[data-e2e="top-dm-icon"], [data-e2e="nav-messages"]',
  messagesLink: 'a[href*="/messages"]',
  profileIcon: '[data-e2e="profile-icon"]',
  uploadIcon: '[data-e2e="upload-icon"]',
  inboxIcon: '[data-e2e="inbox-icon"]',
  
  // Conversation List (VALIDATED 2026-01-31)
  conversationList: '[class*="DivConversationListContainer"]',
  conversationItem: '[data-e2e="chat-list-item"]',  // Primary - validated working
  conversationItemAlt: '[class*="LiInboxItemWrapper"]',
  conversationUsername: '[class*="Username"], [class*="PName"]',
  conversationLastMessage: '[class*="LastMessage"], [class*="PPreview"]',
  conversationTime: '[class*="Time"], [class*="SpanTime"]',
  conversationUnread: '[class*="Unread"], [class*="Badge"]',
  newMessageButton: '[class*="SpanNewMessage"], [class*="DivNewMessageButton"]',
  
  // Chat Area
  chatMain: '[class*="DivChatBox"]',
  messageList: '[class*="DivMessageList"]',
  messageItem: '[class*="DivMessageItem"]',
  
  // Composer
  messageInput: '[class*="DivInputContainer"] [contenteditable="true"]',
  messageInputAlt: '[data-e2e="message-input"]',
  messageInputFallback: '[contenteditable="true"]',
  sendButton: '[class*="DivSendButton"]',
  sendButtonAlt: '[data-e2e="send-message-btn"]',
  sendButtonFallback: '[aria-label*="Send"]',
  
  // Profile Page (for profile-to-DM flow) - VALIDATED 2026-01-31
  profileMessageButton: '[data-e2e="message-button"]',  // Primary - validated working
  profileMessageButtonAlt: '[data-e2e="message-icon"]',
  profileFollowButton: '[data-e2e="follow-button"]',
  userTitle: '[data-e2e="user-title"], [class*="UserTitle"]',
  userAvatar: '[data-e2e="user-avatar"]',
  
  // Search
  searchInput: 'input[data-e2e="search-user-input"], input[type="search"]',
  searchUserTab: '[data-e2e="search-user-tab"]',
  searchUserCard: '[data-e2e="search-user-card"]',
  searchUsername: '[data-e2e="search-username"]',
  
  // Inbox/Notifications (distinct from DMs)
  inboxListItem: '[data-e2e="inbox-list-item"]',
  inboxTitle: '[data-e2e="inbox-title"]',
  inboxContent: '[data-e2e="inbox-content"]',
  
  // Login Detection
  loginButton: '[data-e2e="login-button"]',
};

export const TIKTOK_URLS = {
  base: 'https://www.tiktok.com',
  messages: 'https://www.tiktok.com/messages',
  profile: (username: string) => `https://www.tiktok.com/@${username}`,
  searchUsers: (query: string) => `https://www.tiktok.com/search/user?q=${encodeURIComponent(query)}`,
};
