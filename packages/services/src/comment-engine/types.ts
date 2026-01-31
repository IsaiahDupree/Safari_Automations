/**
 * Comment Engine Types
 * 
 * Based on PRD: PRD_Safari_Automation_Management.md (SAFARI-002)
 * 
 * Unified commenting across Twitter, TikTok, Instagram, Threads at 30/hour:
 * - Twitter: 10/hour (6 min interval)
 * - TikTok: 10/hour (6 min interval)
 * - Instagram: 5/hour (12 min interval)
 * - Threads: 5/hour (12 min interval)
 */

export type CommentPlatform = 'twitter' | 'tiktok' | 'instagram' | 'threads';

export type CommentStatus = 
  | 'pending'
  | 'generating'  // AI generating comment
  | 'ready'       // Comment ready to post
  | 'posting'     // Currently posting
  | 'verifying'   // Verifying post succeeded
  | 'completed'
  | 'failed'
  | 'skipped';    // Skipped (duplicate, rate limited, etc.)

export interface PlatformQuota {
  platform: CommentPlatform;
  commentsPerHour: number;
  intervalMinutes: number;
  currentCount: number;
  lastCommentAt: Date | null;
  nextAllowedAt: Date | null;
}

export interface PostTarget {
  platform: CommentPlatform;
  postId: string;
  postUrl: string;
  authorUsername: string;
  authorDisplayName?: string;
  caption?: string;
  hashtags?: string[];
  mediaType?: 'image' | 'video' | 'text' | 'carousel';
  stats?: PostStats;
  discoveredAt: Date;
}

export interface PostStats {
  likes?: number;
  comments?: number;
  shares?: number;
  views?: number;
  saves?: number;
}

export interface CommentTask {
  id: string;
  status: CommentStatus;
  
  // Target
  target: PostTarget;
  
  // Comment content
  generatedComment?: string;
  commentStyle?: CommentStyle;
  
  // Execution
  attemptCount: number;
  maxAttempts: number;
  
  // Timestamps
  createdAt: Date;
  scheduledFor: Date;
  startedAt?: Date;
  completedAt?: Date;
  
  // Result
  postedCommentId?: string;
  verifiedAt?: Date;
  error?: string;
}

export type CommentStyle = 
  | 'engaging'      // Question or conversation starter
  | 'supportive'    // Positive/encouraging
  | 'insightful'    // Add value/perspective
  | 'humorous'      // Light humor (use sparingly)
  | 'curious'       // Express genuine interest
  | 'relatable';    // Share similar experience

export interface CommentGenerationContext {
  target: PostTarget;
  style: CommentStyle;
  maxLength: number;
  avoidPhrases?: string[];
  includeEmoji?: boolean;
  tone?: 'casual' | 'professional' | 'friendly';
  
  // Previous comments to avoid duplicates
  previousComments?: string[];
  
  // Account persona
  accountPersona?: {
    name: string;
    niche: string;
    voice: string;
  };
}

export interface CommentEngineConfig {
  // Rate limits per platform
  quotas: Record<CommentPlatform, { perHour: number; intervalMinutes: number }>;
  
  // Total limit
  totalPerHour: number;
  
  // Timing
  minDelayBetweenCommentsMs: number;
  maxDelayBetweenCommentsMs: number;
  
  // Retries
  maxAttempts: number;
  retryDelayMs: number;
  
  // Comment generation
  defaultStyle: CommentStyle;
  maxCommentLength: number;
  
  // Safety
  requireVerification: boolean;
  skipIfRateLimited: boolean;
}

export const DEFAULT_CONFIG: CommentEngineConfig = {
  quotas: {
    twitter: { perHour: 10, intervalMinutes: 6 },
    tiktok: { perHour: 10, intervalMinutes: 6 },
    instagram: { perHour: 5, intervalMinutes: 12 },
    threads: { perHour: 5, intervalMinutes: 12 },
  },
  totalPerHour: 30,
  minDelayBetweenCommentsMs: 30000,  // 30 seconds
  maxDelayBetweenCommentsMs: 180000, // 3 minutes
  maxAttempts: 3,
  retryDelayMs: 60000, // 1 minute
  defaultStyle: 'engaging',
  maxCommentLength: 280,
  requireVerification: true,
  skipIfRateLimited: true,
};

export interface CommentResult {
  taskId: string;
  success: boolean;
  platform: CommentPlatform;
  postUrl: string;
  comment: string;
  commentId?: string;
  verified: boolean;
  error?: string;
  duration: number;
}

export interface CommentEngineStats {
  // Current hour
  hourlyCount: Record<CommentPlatform, number>;
  totalThisHour: number;
  
  // Session totals
  totalComments: number;
  successfulComments: number;
  failedComments: number;
  skippedComments: number;
  
  // Rates
  successRate: number;
  averageGenerationTimeMs: number;
  averagePostingTimeMs: number;
  
  // By platform
  platformStats: Record<CommentPlatform, {
    total: number;
    successful: number;
    failed: number;
    lastCommentAt: Date | null;
  }>;
}
