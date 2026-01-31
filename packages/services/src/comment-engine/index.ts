/**
 * Comment Engine
 * 
 * Unified commenting across Twitter, TikTok, Instagram, Threads at 30/hour.
 * Based on PRD: PRD_Safari_Automation_Management.md (SAFARI-002)
 */

export { CommentEngine } from './comment-engine';
export { AICommentGenerator } from './ai-generator';
export type {
  CommentPlatform,
  CommentStatus,
  CommentTask,
  CommentStyle,
  CommentResult,
  CommentEngineConfig,
  CommentEngineStats,
  PostTarget,
  PostStats,
  PlatformQuota,
  CommentGenerationContext,
} from './types';
export { DEFAULT_CONFIG } from './types';
