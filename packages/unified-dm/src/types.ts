/**
 * Unified DM Client Types
 */

export type Platform = 'tiktok' | 'instagram' | 'twitter';

export interface Conversation {
  id: string;
  platform: Platform;
  username: string;
  displayName?: string;
  lastMessage?: string;
  lastMessageTime?: Date;
  unread: boolean;
  avatar?: string;
}

export interface Message {
  id: string;
  platform: Platform;
  conversationId: string;
  sender: 'me' | 'them';
  text: string;
  timestamp: Date;
  type: 'text' | 'image' | 'video' | 'link';
}

export interface SendResult {
  success: boolean;
  platform: Platform;
  messageId?: string;
  error?: string;
}

export interface PlatformStatus {
  platform: Platform;
  isOnline: boolean;
  isLoggedIn: boolean;
  messagesThisHour: number;
  messagesToday: number;
  error?: string;
}

export interface UnifiedDMConfig {
  tiktokApiUrl: string;
  instagramApiUrl: string;
  twitterApiUrl: string;
  timeout: number;
}

export const DEFAULT_CONFIG: UnifiedDMConfig = {
  tiktokApiUrl: 'http://localhost:3002',
  instagramApiUrl: 'http://localhost:3001',
  twitterApiUrl: 'http://localhost:3003',
  timeout: 30000,
};
