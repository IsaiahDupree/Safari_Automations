/**
 * Automation Orchestrator
 * 
 * Main orchestrator that coordinates all Safari automation services.
 */

import type { OrchestratorConfig, OrchestratorStatus } from './types';
import { DEFAULT_ORCHESTRATOR_CONFIG } from './types';
import type { CommentPlatform, PostTarget, CommentStyle } from '../comment-engine/types';

export class AutomationOrchestrator {
  private config: OrchestratorConfig;
  private status: OrchestratorStatus;
  private intervals: NodeJS.Timeout[] = [];

  // Service callbacks (set externally)
  private onCheckLogin?: (platform: CommentPlatform) => Promise<boolean>;
  private onDiscoverPosts?: (platform: CommentPlatform) => Promise<PostTarget[]>;
  private onGenerateComment?: (target: PostTarget, style: CommentStyle) => Promise<string>;
  private onPostComment?: (target: PostTarget, comment: string) => Promise<boolean>;

  constructor(config: Partial<OrchestratorConfig> = {}) {
    this.config = { ...DEFAULT_ORCHESTRATOR_CONFIG, ...config };
    this.status = this.createInitialStatus();
  }

  private createInitialStatus(): OrchestratorStatus {
    return {
      isRunning: false,
      startedAt: null,
      loggedInPlatforms: [],
      commentsThisHour: 0,
      commentsToday: 0,
      lastCommentAt: null,
      postsInQueue: 0,
      lastDiscoveryAt: null,
      consecutiveErrors: 0,
      lastError: null,
    };
  }

  /**
   * Configure service callbacks
   */
  configure(options: {
    onCheckLogin?: (platform: CommentPlatform) => Promise<boolean>;
    onDiscoverPosts?: (platform: CommentPlatform) => Promise<PostTarget[]>;
    onGenerateComment?: (target: PostTarget, style: CommentStyle) => Promise<string>;
    onPostComment?: (target: PostTarget, comment: string) => Promise<boolean>;
  }): void {
    if (options.onCheckLogin) this.onCheckLogin = options.onCheckLogin;
    if (options.onDiscoverPosts) this.onDiscoverPosts = options.onDiscoverPosts;
    if (options.onGenerateComment) this.onGenerateComment = options.onGenerateComment;
    if (options.onPostComment) this.onPostComment = options.onPostComment;
  }

  /**
   * Start the orchestrator
   */
  async start(): Promise<boolean> {
    if (this.status.isRunning) {
      console.log('Orchestrator already running');
      return false;
    }

    console.log('Starting automation orchestrator...');

    // Verify logins if required
    if (this.config.requireLoginVerification) {
      await this.verifyLogins();
      
      if (this.status.loggedInPlatforms.length === 0) {
        console.error('No platforms logged in. Aborting start.');
        return false;
      }
    }

    this.status.isRunning = true;
    this.status.startedAt = new Date();

    // Start comment loop
    const commentIntervalMs = (60 / this.config.commentsPerHour) * 60 * 1000;
    this.intervals.push(
      setInterval(() => this.commentLoop(), commentIntervalMs)
    );

    // Start discovery loop
    this.intervals.push(
      setInterval(
        () => this.discoveryLoop(),
        this.config.discoveryIntervalMinutes * 60 * 1000
      )
    );

    // Start session check loop
    this.intervals.push(
      setInterval(
        () => this.sessionCheckLoop(),
        this.config.sessionCheckIntervalMinutes * 60 * 1000
      )
    );

    // Reset hourly counts
    this.intervals.push(
      setInterval(() => this.resetHourlyCounts(), 60 * 60 * 1000)
    );

    // Run initial loops
    await this.discoveryLoop();
    await this.commentLoop();

    console.log('Orchestrator started successfully');
    return true;
  }

  /**
   * Stop the orchestrator
   */
  stop(): void {
    if (!this.status.isRunning) {
      return;
    }

    console.log('Stopping orchestrator...');

    for (const interval of this.intervals) {
      clearInterval(interval);
    }
    this.intervals = [];

    this.status.isRunning = false;
    console.log('Orchestrator stopped');
  }

  /**
   * Get current status
   */
  getStatus(): OrchestratorStatus {
    return { ...this.status };
  }

  /**
   * Verify login status for all platforms
   */
  private async verifyLogins(): Promise<void> {
    if (!this.onCheckLogin) {
      console.warn('No login check callback configured');
      return;
    }

    this.status.loggedInPlatforms = [];

    for (const platform of this.config.enabledPlatforms) {
      try {
        const loggedIn = await this.onCheckLogin(platform);
        if (loggedIn) {
          this.status.loggedInPlatforms.push(platform);
          console.log(`✓ ${platform}: Logged in`);
        } else {
          console.log(`✗ ${platform}: Not logged in`);
        }
      } catch (error) {
        console.error(`Error checking ${platform} login:`, error);
      }
    }
  }

  /**
   * Main comment posting loop
   */
  private async commentLoop(): Promise<void> {
    if (!this.status.isRunning) return;
    if (this.isQuietHours()) {
      console.log('Quiet hours - skipping comment');
      return;
    }

    // Check for too many errors
    if (this.status.consecutiveErrors >= this.config.maxConsecutiveErrors) {
      if (this.config.pauseOnError) {
        console.error('Too many errors - pausing orchestrator');
        this.stop();
        return;
      }
    }

    // Check hourly limit
    if (this.status.commentsThisHour >= this.config.commentsPerHour) {
      console.log('Hourly comment limit reached');
      return;
    }

    try {
      // Get next post to comment on (would come from queue)
      const platform = this.getNextPlatform();
      if (!platform) {
        console.log('No platforms available for commenting');
        return;
      }

      // Discover posts if needed
      if (this.status.postsInQueue === 0 && this.onDiscoverPosts) {
        const posts = await this.onDiscoverPosts(platform);
        this.status.postsInQueue = posts.length;
        
        if (posts.length === 0) {
          console.log(`No posts found for ${platform}`);
          return;
        }
      }

      console.log(`Comment loop: Would post to ${platform}`);
      
      // Simulated success for now
      this.status.commentsThisHour++;
      this.status.commentsToday++;
      this.status.lastCommentAt = new Date();
      this.status.consecutiveErrors = 0;

    } catch (error) {
      this.status.consecutiveErrors++;
      this.status.lastError = error instanceof Error ? error.message : String(error);
      console.error('Comment loop error:', error);
    }
  }

  /**
   * Post discovery loop
   */
  private async discoveryLoop(): Promise<void> {
    if (!this.status.isRunning) return;
    if (!this.onDiscoverPosts) return;

    console.log('Running discovery loop...');

    let totalPosts = 0;

    for (const platform of this.status.loggedInPlatforms) {
      try {
        const posts = await this.onDiscoverPosts(platform);
        totalPosts += posts.length;
        console.log(`Discovered ${posts.length} posts from ${platform}`);
      } catch (error) {
        console.error(`Discovery error for ${platform}:`, error);
      }
    }

    this.status.postsInQueue = totalPosts;
    this.status.lastDiscoveryAt = new Date();
  }

  /**
   * Session health check loop
   */
  private async sessionCheckLoop(): Promise<void> {
    if (!this.status.isRunning) return;

    console.log('Running session check...');
    await this.verifyLogins();
  }

  /**
   * Reset hourly comment counts
   */
  private resetHourlyCounts(): void {
    this.status.commentsThisHour = 0;
    console.log('Hourly counts reset');
  }

  /**
   * Check if current time is within quiet hours
   */
  private isQuietHours(): boolean {
    if (this.config.quietHoursStart === undefined || 
        this.config.quietHoursEnd === undefined) {
      return false;
    }

    const hour = new Date().getHours();
    const start = this.config.quietHoursStart;
    const end = this.config.quietHoursEnd;

    if (start < end) {
      // Normal range (e.g., 23-7 doesn't wrap)
      return hour >= start && hour < end;
    } else {
      // Wraps around midnight (e.g., 23-7)
      return hour >= start || hour < end;
    }
  }

  /**
   * Get next platform to post to (round-robin with quota awareness)
   */
  private getNextPlatform(): CommentPlatform | null {
    if (this.status.loggedInPlatforms.length === 0) {
      return null;
    }

    // Simple round-robin for now
    const idx = this.status.commentsThisHour % this.status.loggedInPlatforms.length;
    return this.status.loggedInPlatforms[idx];
  }

  /**
   * Manually trigger a comment
   */
  async triggerComment(target: PostTarget): Promise<boolean> {
    if (!this.onGenerateComment || !this.onPostComment) {
      console.error('Comment callbacks not configured');
      return false;
    }

    try {
      const comment = await this.onGenerateComment(target, this.config.commentStyle);
      const success = await this.onPostComment(target, comment);
      
      if (success) {
        this.status.commentsThisHour++;
        this.status.commentsToday++;
        this.status.lastCommentAt = new Date();
      }

      return success;
    } catch (error) {
      console.error('Manual comment error:', error);
      return false;
    }
  }
}
