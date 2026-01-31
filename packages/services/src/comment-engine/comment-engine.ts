/**
 * Comment Engine
 * 
 * Unified comment engine that distributes comments across platforms.
 * Based on PRD: PRD_Safari_Automation_Management.md (SAFARI-002)
 */

import type {
  CommentPlatform,
  CommentTask,
  CommentStatus,
  PostTarget,
  CommentStyle,
  CommentEngineConfig,
  CommentEngineStats,
  CommentResult,
  PlatformQuota,
  CommentGenerationContext,
} from './types';
import { DEFAULT_CONFIG } from './types';

export class CommentEngine {
  private config: CommentEngineConfig;
  private queue: CommentTask[] = [];
  private completed: CommentTask[] = [];
  private quotas: Map<CommentPlatform, PlatformQuota> = new Map();
  private isRunning = false;
  private intervalId: NodeJS.Timeout | null = null;
  
  // Callbacks
  private onCommentGenerate?: (context: CommentGenerationContext) => Promise<string>;
  private onCommentPost?: (task: CommentTask) => Promise<{ commentId: string }>;
  private onCommentVerify?: (task: CommentTask) => Promise<boolean>;

  constructor(config: Partial<CommentEngineConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.initializeQuotas();
  }

  /**
   * Set the comment generation callback (AI integration)
   */
  setCommentGenerator(
    generator: (context: CommentGenerationContext) => Promise<string>
  ): void {
    this.onCommentGenerate = generator;
  }

  /**
   * Set the comment posting callback (browser automation)
   */
  setCommentPoster(
    poster: (task: CommentTask) => Promise<{ commentId: string }>
  ): void {
    this.onCommentPost = poster;
  }

  /**
   * Set the comment verification callback
   */
  setCommentVerifier(
    verifier: (task: CommentTask) => Promise<boolean>
  ): void {
    this.onCommentVerify = verifier;
  }

  /**
   * Initialize platform quotas
   */
  private initializeQuotas(): void {
    const platforms: CommentPlatform[] = ['twitter', 'tiktok', 'instagram', 'threads'];
    
    for (const platform of platforms) {
      const quota = this.config.quotas[platform];
      this.quotas.set(platform, {
        platform,
        commentsPerHour: quota.perHour,
        intervalMinutes: quota.intervalMinutes,
        currentCount: 0,
        lastCommentAt: null,
        nextAllowedAt: null,
      });
    }
  }

  /**
   * Add a post target to the comment queue
   */
  enqueue(target: PostTarget, style?: CommentStyle): string {
    const id = `comment_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const task: CommentTask = {
      id,
      status: 'pending',
      target,
      commentStyle: style ?? this.config.defaultStyle,
      attemptCount: 0,
      maxAttempts: this.config.maxAttempts,
      createdAt: new Date(),
      scheduledFor: this.calculateScheduledTime(target.platform),
    };

    // Insert in scheduled order
    const insertIndex = this.queue.findIndex(
      t => t.scheduledFor > task.scheduledFor
    );
    
    if (insertIndex === -1) {
      this.queue.push(task);
    } else {
      this.queue.splice(insertIndex, 0, task);
    }

    console.log(`Comment task ${id} enqueued for ${target.platform}`);
    return id;
  }

  /**
   * Calculate when a comment can be scheduled based on quotas
   */
  private calculateScheduledTime(platform: CommentPlatform): Date {
    const quota = this.quotas.get(platform)!;
    const now = new Date();
    
    if (!quota.lastCommentAt) {
      return now;
    }

    const nextAllowed = new Date(
      quota.lastCommentAt.getTime() + quota.intervalMinutes * 60 * 1000
    );

    return nextAllowed > now ? nextAllowed : now;
  }

  /**
   * Start the comment engine
   */
  start(): void {
    if (this.isRunning) {
      console.log('Comment engine already running');
      return;
    }

    this.isRunning = true;
    console.log('Comment engine started');

    // Process every 30 seconds
    this.intervalId = setInterval(() => {
      this.processNext();
    }, 30000);

    // Start immediately
    this.processNext();
  }

  /**
   * Stop the comment engine
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    this.isRunning = false;
    console.log('Comment engine stopped');
  }

  /**
   * Process the next comment task
   */
  private async processNext(): Promise<void> {
    const now = new Date();
    
    // Find the next task that's ready
    const taskIndex = this.queue.findIndex(t => 
      t.status === 'pending' && 
      t.scheduledFor <= now &&
      this.canCommentOnPlatform(t.target.platform)
    );

    if (taskIndex === -1) {
      return;
    }

    const task = this.queue.splice(taskIndex, 1)[0];
    await this.executeTask(task);
  }

  /**
   * Check if we can comment on a platform (quota check)
   */
  private canCommentOnPlatform(platform: CommentPlatform): boolean {
    const quota = this.quotas.get(platform)!;
    const now = Date.now();

    // Reset hourly count if needed
    if (quota.lastCommentAt) {
      const hourAgo = now - 60 * 60 * 1000;
      if (quota.lastCommentAt.getTime() < hourAgo) {
        quota.currentCount = 0;
      }
    }

    // Check if under quota
    if (quota.currentCount >= quota.commentsPerHour) {
      return false;
    }

    // Check interval
    if (quota.nextAllowedAt && quota.nextAllowedAt.getTime() > now) {
      return false;
    }

    return true;
  }

  /**
   * Execute a comment task
   */
  private async executeTask(task: CommentTask): Promise<CommentResult> {
    const startTime = Date.now();
    task.status = 'generating';
    task.startedAt = new Date();
    task.attemptCount++;

    try {
      // Step 1: Generate comment
      if (!task.generatedComment && this.onCommentGenerate) {
        const context: CommentGenerationContext = {
          target: task.target,
          style: task.commentStyle!,
          maxLength: this.config.maxCommentLength,
          includeEmoji: true,
          tone: 'friendly',
        };

        task.generatedComment = await this.onCommentGenerate(context);
        console.log(`Generated comment for ${task.target.platform}: "${task.generatedComment}"`);
      }

      if (!task.generatedComment) {
        throw new Error('No comment generated');
      }

      // Step 2: Post comment
      task.status = 'posting';
      
      if (this.onCommentPost) {
        const result = await this.onCommentPost(task);
        task.postedCommentId = result.commentId;
      } else {
        // Simulate posting for testing
        console.log(`[SIMULATE] Posting comment to ${task.target.postUrl}`);
        task.postedCommentId = `simulated_${Date.now()}`;
      }

      // Step 3: Verify comment
      task.status = 'verifying';
      
      if (this.config.requireVerification && this.onCommentVerify) {
        const verified = await this.onCommentVerify(task);
        if (!verified) {
          throw new Error('Comment verification failed');
        }
        task.verifiedAt = new Date();
      }

      // Success
      task.status = 'completed';
      task.completedAt = new Date();
      
      // Update quota
      this.updateQuota(task.target.platform);
      
      this.completed.push(task);

      const duration = Date.now() - startTime;
      console.log(`Comment task ${task.id} completed in ${duration}ms`);

      return {
        taskId: task.id,
        success: true,
        platform: task.target.platform,
        postUrl: task.target.postUrl,
        comment: task.generatedComment,
        commentId: task.postedCommentId,
        verified: !!task.verifiedAt,
        duration,
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`Comment task ${task.id} failed:`, errorMessage);

      // Retry logic
      if (task.attemptCount < task.maxAttempts) {
        task.status = 'pending';
        task.scheduledFor = new Date(Date.now() + this.config.retryDelayMs);
        this.queue.push(task);
        console.log(`Comment task ${task.id} will retry (${task.attemptCount}/${task.maxAttempts})`);
      } else {
        task.status = 'failed';
        task.completedAt = new Date();
        task.error = errorMessage;
        this.completed.push(task);
      }

      return {
        taskId: task.id,
        success: false,
        platform: task.target.platform,
        postUrl: task.target.postUrl,
        comment: task.generatedComment ?? '',
        verified: false,
        error: errorMessage,
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Update platform quota after successful comment
   */
  private updateQuota(platform: CommentPlatform): void {
    const quota = this.quotas.get(platform)!;
    quota.currentCount++;
    quota.lastCommentAt = new Date();
    quota.nextAllowedAt = new Date(
      Date.now() + quota.intervalMinutes * 60 * 1000
    );
  }

  /**
   * Get current statistics
   */
  getStats(): CommentEngineStats {
    const hourlyCount: Record<CommentPlatform, number> = {
      twitter: 0,
      tiktok: 0,
      instagram: 0,
      threads: 0,
    };

    const platformStats: Record<CommentPlatform, {
      total: number;
      successful: number;
      failed: number;
      lastCommentAt: Date | null;
    }> = {
      twitter: { total: 0, successful: 0, failed: 0, lastCommentAt: null },
      tiktok: { total: 0, successful: 0, failed: 0, lastCommentAt: null },
      instagram: { total: 0, successful: 0, failed: 0, lastCommentAt: null },
      threads: { total: 0, successful: 0, failed: 0, lastCommentAt: null },
    };

    let totalComments = 0;
    let successfulComments = 0;
    let failedComments = 0;
    let skippedComments = 0;

    for (const task of this.completed) {
      totalComments++;
      const platform = task.target.platform;
      platformStats[platform].total++;

      if (task.status === 'completed') {
        successfulComments++;
        platformStats[platform].successful++;
        
        if (!platformStats[platform].lastCommentAt || 
            (task.completedAt && task.completedAt > platformStats[platform].lastCommentAt)) {
          platformStats[platform].lastCommentAt = task.completedAt!;
        }
      } else if (task.status === 'failed') {
        failedComments++;
        platformStats[platform].failed++;
      } else if (task.status === 'skipped') {
        skippedComments++;
      }
    }

    // Current hour counts from quotas
    for (const [platform, quota] of this.quotas) {
      hourlyCount[platform] = quota.currentCount;
    }

    const totalThisHour = Object.values(hourlyCount).reduce((a, b) => a + b, 0);
    const successRate = totalComments > 0 ? successfulComments / totalComments : 0;

    return {
      hourlyCount,
      totalThisHour,
      totalComments,
      successfulComments,
      failedComments,
      skippedComments,
      successRate,
      averageGenerationTimeMs: 0, // TODO: track this
      averagePostingTimeMs: 0,    // TODO: track this
      platformStats,
    };
  }

  /**
   * Get queue status
   */
  getQueueStatus(): {
    pending: number;
    byPlatform: Record<CommentPlatform, number>;
    nextScheduled: Date | null;
  } {
    const byPlatform: Record<CommentPlatform, number> = {
      twitter: 0,
      tiktok: 0,
      instagram: 0,
      threads: 0,
    };

    for (const task of this.queue) {
      byPlatform[task.target.platform]++;
    }

    return {
      pending: this.queue.length,
      byPlatform,
      nextScheduled: this.queue[0]?.scheduledFor ?? null,
    };
  }

  /**
   * Get quota status for all platforms
   */
  getQuotaStatus(): PlatformQuota[] {
    return Array.from(this.quotas.values());
  }
}
