/**
 * Instagram DM Automation Types
 */

export interface DMConversation {
  username: string;
  threadId?: string;
  displayName?: string;
  profilePicUrl?: string;
  lastMessage?: string;
  lastMessageAt?: string;
  unreadCount?: number;
  isVerified?: boolean;
}

export interface DMMessage {
  text: string;
  timestamp?: string;
  isOutbound: boolean;
  mediaUrl?: string;
  messageType: 'text' | 'image' | 'video' | 'audio' | 'story_reply' | 'link';
}

export interface DMThread {
  username: string;
  messages: DMMessage[];
  participantCount: number;
}

export type DMTab = 'primary' | 'general' | 'requests' | 'hidden_requests';

export interface SendMessageResult {
  success: boolean;
  error?: string;
  messageId?: string;
  verified?: boolean;
  verifiedRecipient?: string;
}

export interface NavigationResult {
  success: boolean;
  currentUrl?: string;
  error?: string;
}

export interface AutomationConfig {
  /** Safari instance type: 'local' or 'remote' */
  instanceType: 'local' | 'remote';
  /** Remote Safari URL (if using remote instance) */
  remoteUrl?: string;
  /** Timeout for operations in ms */
  timeout: number;
  /** Delay between actions in ms */
  actionDelay: number;
  /** Whether to log verbose output */
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
  messagesPerHour: 10,
  messagesPerDay: 30,
  minDelayMs: 60000,
  maxDelayMs: 300000,
  activeHoursStart: 9,
  activeHoursEnd: 21,
};
