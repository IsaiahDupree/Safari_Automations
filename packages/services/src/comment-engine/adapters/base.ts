/**
 * Base Comment Adapter
 * 
 * Abstract interface for platform-specific comment posting.
 */

import type { CommentTask, PostTarget } from '../types';

export interface AdapterConfig {
  timeout?: number;
  retryDelay?: number;
  screenshotOnError?: boolean;
}

export interface PostCommentResult {
  success: boolean;
  commentId?: string;
  error?: string;
  screenshot?: string;
}

export interface VerifyCommentResult {
  found: boolean;
  commentId?: string;
  content?: string;
  timestamp?: Date;
}

export interface CommentAdapter {
  readonly platform: string;
  
  /**
   * Post a comment to a post
   */
  postComment(task: CommentTask): Promise<PostCommentResult>;
  
  /**
   * Verify a comment was posted successfully
   */
  verifyComment(task: CommentTask): Promise<VerifyCommentResult>;
  
  /**
   * Check if we can comment on a post (not disabled, etc.)
   */
  canComment(target: PostTarget): Promise<boolean>;
  
  /**
   * Navigate to a post URL
   */
  navigateToPost(url: string): Promise<boolean>;
  
  /**
   * Get the comment input selector
   */
  getCommentInputSelector(): string;
  
  /**
   * Get the submit button selector
   */
  getSubmitButtonSelector(): string;
}

/**
 * Base adapter implementation with common functionality
 */
export abstract class BaseCommentAdapter implements CommentAdapter {
  abstract readonly platform: string;
  protected config: AdapterConfig;

  constructor(config: AdapterConfig = {}) {
    this.config = {
      timeout: config.timeout ?? 30000,
      retryDelay: config.retryDelay ?? 2000,
      screenshotOnError: config.screenshotOnError ?? true,
    };
  }

  abstract postComment(task: CommentTask): Promise<PostCommentResult>;
  abstract verifyComment(task: CommentTask): Promise<VerifyCommentResult>;
  abstract canComment(target: PostTarget): Promise<boolean>;
  abstract navigateToPost(url: string): Promise<boolean>;
  abstract getCommentInputSelector(): string;
  abstract getSubmitButtonSelector(): string;

  /**
   * Wait for a specified duration
   */
  protected async wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Add random jitter to timing
   */
  protected jitter(baseMs: number, variance: number = 0.3): number {
    const min = baseMs * (1 - variance);
    const max = baseMs * (1 + variance);
    return Math.floor(Math.random() * (max - min) + min);
  }
}
