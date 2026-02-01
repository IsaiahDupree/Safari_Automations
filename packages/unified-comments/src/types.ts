/**
 * Unified Comments Types
 */

export type CommentPlatform = 'threads' | 'instagram' | 'tiktok' | 'twitter';

export interface PlatformConfig {
  platform: CommentPlatform;
  apiUrl: string;
  port: number;
}

export const PLATFORM_CONFIGS: Record<CommentPlatform, PlatformConfig> = {
  threads: { platform: 'threads', apiUrl: 'http://localhost:3004', port: 3004 },
  instagram: { platform: 'instagram', apiUrl: 'http://localhost:3005', port: 3005 },
  tiktok: { platform: 'tiktok', apiUrl: 'http://localhost:3006', port: 3006 },
  twitter: { platform: 'twitter', apiUrl: 'http://localhost:3007', port: 3007 },
};

export interface Comment {
  username: string;
  text: string;
  timestamp?: string;
}

export interface CommentResult {
  success: boolean;
  platform: CommentPlatform;
  commentId?: string;
  error?: string;
}

export interface PlatformStatus {
  platform: CommentPlatform;
  isOnline: boolean;
  isLoggedIn: boolean;
  currentUrl?: string;
  commentsThisHour: number;
  commentsToday: number;
}

export interface UnifiedCommentsConfig {
  threadsApiUrl: string;
  instagramApiUrl: string;
  tiktokApiUrl: string;
  twitterApiUrl: string;
  timeout: number;
}

export const DEFAULT_CONFIG: UnifiedCommentsConfig = {
  threadsApiUrl: 'http://localhost:3004',
  instagramApiUrl: 'http://localhost:3005',
  tiktokApiUrl: 'http://localhost:3006',
  twitterApiUrl: 'http://localhost:3007',
  timeout: 30000,
};
