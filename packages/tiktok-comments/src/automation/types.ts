/**
 * Shared type definitions for TikTok automation
 */

export interface AutomationConfig {
  instanceType?: 'local' | 'remote';
  remoteUrl?: string;
  timeout?: number;
  actionDelay?: number;
  verbose?: boolean;
}

export interface TikTokCreator {
  handle: string;
  displayName: string;
  url: string;
  isVerified: boolean;
  followers: number;
  following: number;
  bio: string;
  videoCount: number;
  totalViews: number;
  totalLikes: number;
  totalComments: number;
  totalShares: number;
  totalEngagement: number;
  avgEngagement: number;
  topVideoUrl: string;
  topVideoEngagement: number;
  topVideos: Array<{
    url: string;
    views: number;
    likes: number;
    comments: number;
    shares: number;
    engagement: number;
  }>;
  niche: string;
}

export interface TikTokVideo {
  id: string;
  url: string;
  author: string;
  description: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  engagement: number;
}
