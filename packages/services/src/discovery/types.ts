/**
 * Post Discovery Types
 */

import type { CommentPlatform, PostTarget } from '../comment-engine/types';

export type DiscoverySource = 
  | 'feed'       // Main feed/FYP
  | 'explore'    // Explore/discover page
  | 'hashtag'    // Hashtag search
  | 'profile'    // Specific profile
  | 'trending';  // Trending topics

export interface DiscoveryFilter {
  minLikes?: number;
  maxLikes?: number;
  minComments?: number;
  maxComments?: number;
  minFollowers?: number;
  maxFollowers?: number;
  hashtags?: string[];
  excludeHashtags?: string[];
  languages?: string[];
  mediaTypes?: ('image' | 'video' | 'text' | 'carousel')[];
  maxAgeHours?: number;
  excludeUsernames?: string[];
}

export interface DiscoveryConfig {
  platforms: CommentPlatform[];
  sources: DiscoverySource[];
  filter: DiscoveryFilter;
  maxPostsPerRun: number;
  cooldownMinutes: number;
  dedupeWindow: number; // Hours to track already-seen posts
}

export interface DiscoveredPost extends PostTarget {
  source: DiscoverySource;
  score: number; // Engagement potential score
  alreadyCommented: boolean;
  discoveredAt: Date;
}

export const DEFAULT_DISCOVERY_CONFIG: DiscoveryConfig = {
  platforms: ['instagram', 'twitter', 'tiktok', 'threads'],
  sources: ['feed', 'explore'],
  filter: {
    minLikes: 100,
    maxLikes: 100000,
    minComments: 5,
    maxComments: 1000,
    maxAgeHours: 24,
  },
  maxPostsPerRun: 20,
  cooldownMinutes: 30,
  dedupeWindow: 72, // 3 days
};
