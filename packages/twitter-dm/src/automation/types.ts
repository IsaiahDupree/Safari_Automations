/**
 * Twitter/X DM Automation Types
 */

export interface DMConversation {
  username: string;
  displayName?: string;
  profilePicUrl?: string;
  lastMessage?: string;
  lastMessageAt?: string;
  unreadCount?: number;
  isVerified?: boolean;
  conversationId?: string;
}

export interface DMMessage {
  text: string;
  timestamp?: string;
  isOutbound: boolean;
  mediaUrl?: string;
  messageType: 'text' | 'image' | 'video' | 'gif' | 'link';
}

export interface DMThread {
  username: string;
  messages: DMMessage[];
  participantCount: number;
}

export type DMTab = 'inbox' | 'requests';

export interface SendMessageResult {
  success: boolean;
  error?: string;
  messageId?: string;
}

export interface NavigationResult {
  success: boolean;
  currentUrl?: string;
  error?: string;
}

export interface ProfileDMResult {
  success: boolean;
  error?: string;
  username?: string;
}

export interface AutomationConfig {
  instanceType: 'local' | 'remote';
  remoteUrl?: string;
  timeout: number;
  actionDelay: number;
  verbose: boolean;
}

export const DEFAULT_CONFIG: AutomationConfig = {
  instanceType: 'local',
  timeout: 30000,
  actionDelay: 1000,
  verbose: false,
};

export interface RateLimitConfig {
  messagesPerHour: number;
  messagesPerDay: number;
  minDelayMs: number;
  maxDelayMs: number;
  activeHoursStart: number;
  activeHoursEnd: number;
}

export const DEFAULT_RATE_LIMITS: RateLimitConfig = {
  messagesPerHour: 15,
  messagesPerDay: 100,
  minDelayMs: 90000,
  maxDelayMs: 240000,
  activeHoursStart: 9,
  activeHoursEnd: 21,
};

export const TWITTER_SELECTORS = {
  // Navigation
  dmNavLink: '[data-testid="AppTabBar_DirectMessage_Link"]',
  profileLink: '[data-testid="AppTabBar_Profile_Link"]',
  
  // Login Detection
  accountSwitcher: '[data-testid="SideNav_AccountSwitcher_Button"]',
  loginButton: '[data-testid="loginButton"]',
  userAvatar: '[data-testid="UserAvatar-Container"]',
  
  // DM Container
  dmContainer: '[data-testid="dm-container"]',
  dmInboxPanel: '[data-testid="dm-inbox-panel"]',
  dmConversationPanel: '[data-testid="dm-conversation-panel"]',
  dmTimeline: '[data-testid="DM_timeline"]',
  
  // Inbox
  dmInboxTitle: '[data-testid="dm-inbox-title"]',
  dmNewChatButton: '[data-testid="NewDM_Button"]',
  dmSearchBar: '[data-testid="SearchBox_Search_Input"]',
  
  // Conversations
  dmConversationItem: '[data-testid="conversation"]',
  dmConversationAvatar: '[data-testid="UserAvatar-Container"]',
  dmConversationName: '[data-testid="conversation-name"]',
  
  // Messages
  dmMessageEntry: '[data-testid="messageEntry"]',
  dmMessageBubble: '[data-testid="message-bubble"]',
  dmMessageText: '[data-testid="tweetText"]',
  
  // Composer
  dmComposerTextarea: '[data-testid="dm-composer-textarea"]',
  dmComposerSendButton: '[data-testid="dm-composer-send-button"]',
  dmMediaButton: '[data-testid="dm-media-picker"]',
  dmGifButton: '[data-testid="dm-gif-picker"]',
  
  // Profile DM
  sendDMFromProfile: '[data-testid="sendDMFromProfile"]',
  
  // Requests
  dmRequestsTab: '[data-testid="dm-inbox-requests"]',
};
