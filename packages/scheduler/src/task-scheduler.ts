/**
 * Safari Task Scheduler
 * 
 * Central scheduler that coordinates all Safari automation tasks with
 * resource awareness, priority queuing, and dependency management.
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import type {
  ScheduledTask,
  SchedulerConfig,
  SchedulerStatus,
  TaskType,
  TaskPriority,
  Platform,
  ResourceRequirements,
  SoraCreditStatus,
  PlatformStatus,
  DEFAULT_SCHEDULER_CONFIG,
} from './types.js';
import { SoraCreditMonitor } from './sora-credit-monitor.js';

export class TaskScheduler extends EventEmitter {
  private config: SchedulerConfig;
  private queue: ScheduledTask[] = [];
  private running: ScheduledTask[] = [];
  private completed: ScheduledTask[] = [];
  private isRunning = false;
  private startedAt: Date | null = null;
  private intervalId: NodeJS.Timeout | null = null;
  private soraMonitor: SoraCreditMonitor;
  private platformStatus: Map<Platform, PlatformStatus> = new Map();

  constructor(config: Partial<SchedulerConfig> = {}) {
    super();
    this.config = { 
      persistPath: './scheduler-state.json',
      checkIntervalMs: 5000,
      maxConcurrentTasks: 1,
      defaultRetries: 3,
      enableSoraMonitor: true,
      soraCheckIntervalMs: 60 * 60 * 1000, // 1 hour
      ...config 
    };
    this.soraMonitor = new SoraCreditMonitor(this.config.soraCheckIntervalMs);
    this.initializePlatforms();
    this.loadState();
  }

  private initializePlatforms(): void {
    const platforms: Platform[] = ['tiktok', 'instagram', 'twitter', 'sora'];
    for (const platform of platforms) {
      this.platformStatus.set(platform, {
        platform,
        isReady: true,
        isLoggedIn: false,
        messagesThisHour: 0,
        messagesToday: 0,
      });
    }
  }

  /**
   * Schedule a new task
   */
  schedule(options: {
    type: TaskType;
    name: string;
    platform?: Platform;
    priority?: TaskPriority;
    scheduledFor?: Date;
    dependencies?: string[];
    resourceRequirements?: ResourceRequirements;
    maxRetries?: number;
    payload?: Record<string, unknown>;
  }): string {
    const id = `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const task: ScheduledTask = {
      id,
      type: options.type,
      name: options.name,
      platform: options.platform,
      priority: options.priority || 3,
      scheduledFor: options.scheduledFor || new Date(),
      createdAt: new Date(),
      dependencies: options.dependencies,
      resourceRequirements: options.resourceRequirements,
      status: 'pending',
      retryCount: 0,
      maxRetries: options.maxRetries ?? this.config.defaultRetries,
      payload: options.payload || {},
    };

    // Insert in priority order
    const insertIndex = this.queue.findIndex(t => t.priority > task.priority);
    if (insertIndex === -1) {
      this.queue.push(task);
    } else {
      this.queue.splice(insertIndex, 0, task);
    }

    console.log(`[SCHEDULER] 📋 Task scheduled: ${task.name} (${task.id})`);
    this.emit('taskScheduled', task);
    this.saveState();
    
    return id;
  }

  /**
   * Schedule a Sora trilogy generation
   */
  scheduleSoraTrilogy(trilogyId: string, trilogyName: string, options?: {
    priority?: TaskPriority;
    waitForCredits?: number;
  }): string {
    const taskId = this.schedule({
      type: 'sora',
      name: `Sora Trilogy: ${trilogyName}`,
      platform: 'sora',
      priority: options?.priority || 2,
      resourceRequirements: {
        soraCredits: options?.waitForCredits || 3,
        safariExclusive: true,
      },
      payload: {
        trilogyId,
        trilogyName,
        command: `npx tsx scripts/sora-trilogy-runner.ts --story ${trilogyId}`,
      },
    });

    // If waiting for credits, register callback
    if (options?.waitForCredits) {
      console.log(`[SCHEDULER] ⏳ Waiting for ${options.waitForCredits} Sora credits for ${trilogyName}`);
      this.soraMonitor.onCreditsAvailable(options.waitForCredits, () => {
        const task = this.queue.find(t => t.id === taskId);
        if (task && task.status === 'waiting') {
          task.status = 'pending';
          console.log(`[SCHEDULER] ✅ Credits available! ${trilogyName} ready to run`);
        }
      });
    }

    return taskId;
  }

  /**
   * Schedule DM automation session
   */
  scheduleDMSession(platform: Platform, options?: {
    priority?: TaskPriority;
    duration?: number;
    startTime?: Date;
  }): string {
    return this.schedule({
      type: 'dm',
      name: `DM Session: ${platform}`,
      platform,
      priority: options?.priority || 3,
      scheduledFor: options?.startTime || new Date(),
      resourceRequirements: {
        platform,
        safariExclusive: true,
      },
      payload: {
        duration: options?.duration || 60 * 60 * 1000, // 1 hour default
      },
    });
  }

  /**
   * Cancel a task
   */
  cancel(taskId: string): boolean {
    const index = this.queue.findIndex(t => t.id === taskId);
    if (index === -1) return false;

    const task = this.queue[index];
    task.status = 'cancelled';
    this.queue.splice(index, 1);
    this.completed.push(task);
    
    console.log(`[SCHEDULER] ❌ Task cancelled: ${task.name}`);
    this.saveState();
    return true;
  }

  /**
   * Start the scheduler
   */
  start(): void {
    if (this.isRunning) {
      console.log('[SCHEDULER] Already running');
      return;
    }

    this.isRunning = true;
    this.startedAt = new Date();
    console.log('[SCHEDULER] 🚀 Starting task scheduler...');

    // Start Sora credit monitor
    if (this.config.enableSoraMonitor) {
      this.soraMonitor.start();
    }

    // Start processing loop
    this.intervalId = setInterval(() => {
      this.processQueue();
    }, this.config.checkIntervalMs);

    // Process immediately
    this.processQueue();
  }

  /**
   * Stop the scheduler
   */
  stop(): void {
    if (!this.isRunning) return;

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    this.soraMonitor.stop();
    this.isRunning = false;
    
    console.log('[SCHEDULER] ⏹️ Scheduler stopped');
    this.saveState();
  }

  /**
   * Pause the scheduler (keeps state, stops processing)
   */
  pause(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    console.log('[SCHEDULER] ⏸️ Scheduler paused');
  }

  /**
   * Resume the scheduler
   */
  resume(): void {
    if (!this.isRunning) {
      this.start();
      return;
    }

    if (!this.intervalId) {
      this.intervalId = setInterval(() => {
        this.processQueue();
      }, this.config.checkIntervalMs);
      console.log('[SCHEDULER] ▶️ Scheduler resumed');
    }
  }

  /**
   * Get current status
   */
  getStatus(): SchedulerStatus {
    return {
      isRunning: this.isRunning,
      startedAt: this.startedAt,
      tasksInQueue: this.queue.length,
      tasksRunning: this.running.length,
      tasksCompleted: this.completed.filter(t => t.status === 'completed').length,
      tasksFailed: this.completed.filter(t => t.status === 'failed').length,
      soraCredits: this.soraMonitor.getStatus(),
      platforms: Array.from(this.platformStatus.values()),
    };
  }

  /**
   * Get queue
   */
  getQueue(): ScheduledTask[] {
    return [...this.queue];
  }

  /**
   * Get running tasks
   */
  getRunning(): ScheduledTask[] {
    return [...this.running];
  }

  /**
   * Get completed tasks
   */
  getCompleted(limit?: number): ScheduledTask[] {
    const sorted = [...this.completed].sort(
      (a, b) => (b.completedAt?.getTime() || 0) - (a.completedAt?.getTime() || 0)
    );
    return limit ? sorted.slice(0, limit) : sorted;
  }

  /**
   * Process the queue
   */
  private async processQueue(): Promise<void> {
    if (this.running.length >= this.config.maxConcurrentTasks) {
      return;
    }

    // Check quiet hours
    if (this.isQuietHours()) {
      return;
    }

    // Find next ready task
    const task = this.findNextReadyTask();
    if (!task) return;

    await this.executeTask(task);
  }

  /**
   * Find the next task that's ready to run
   */
  private findNextReadyTask(): ScheduledTask | null {
    const now = new Date();

    for (const task of this.queue) {
      // Skip if not yet scheduled
      if (task.scheduledFor > now) continue;

      // Skip if waiting for resources
      if (task.status === 'waiting') continue;

      // Check dependencies
      if (task.dependencies?.length) {
        const allComplete = task.dependencies.every(depId =>
          this.completed.some(t => t.id === depId && t.status === 'completed')
        );
        if (!allComplete) continue;
      }

      // Check resource requirements
      if (!this.checkResourceRequirements(task)) {
        task.status = 'waiting';
        continue;
      }

      return task;
    }

    return null;
  }

  /**
   * Check if task's resource requirements are met
   */
  private checkResourceRequirements(task: ScheduledTask): boolean {
    const req = task.resourceRequirements;
    if (!req) return true;

    // Check Sora credits
    if (req.soraCredits) {
      const credits = this.soraMonitor.getStatus();
      if (!credits || credits.totalCredits < req.soraCredits) {
        return false;
      }
    }

    // Check platform availability
    if (req.platform) {
      const platform = this.platformStatus.get(req.platform);
      if (!platform?.isReady) return false;
    }

    return true;
  }

  /**
   * Execute a task
   */
  private async executeTask(task: ScheduledTask): Promise<void> {
    // Move from queue to running
    const index = this.queue.indexOf(task);
    if (index !== -1) {
      this.queue.splice(index, 1);
    }
    
    task.status = 'running';
    task.startedAt = new Date();
    this.running.push(task);
    
    console.log(`[SCHEDULER] ▶️ Starting task: ${task.name}`);
    this.emit('taskStarted', task);

    try {
      // Execute based on task type
      const result = await this.runTask(task);
      
      task.status = 'completed';
      task.completedAt = new Date();
      task.result = result;
      
      console.log(`[SCHEDULER] ✅ Task completed: ${task.name}`);
      this.emit('taskCompleted', task);
      
    } catch (error) {
      task.retryCount++;
      task.error = error instanceof Error ? error.message : String(error);
      
      if (task.retryCount < task.maxRetries) {
        // Retry
        task.status = 'pending';
        this.queue.push(task);
        console.log(`[SCHEDULER] 🔄 Task retry ${task.retryCount}/${task.maxRetries}: ${task.name}`);
      } else {
        task.status = 'failed';
        task.completedAt = new Date();
        console.log(`[SCHEDULER] ❌ Task failed: ${task.name} - ${task.error}`);
        this.emit('taskFailed', task, error);
      }
    }

    // Move from running to completed
    const runIndex = this.running.indexOf(task);
    if (runIndex !== -1) {
      this.running.splice(runIndex, 1);
    }
    if (task.status === 'completed' || task.status === 'failed') {
      this.completed.push(task);
    }

    this.saveState();
  }

  /**
   * Run the actual task
   */
  private async runTask(task: ScheduledTask): Promise<unknown> {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    switch (task.type) {
      case 'sora': {
        const command = task.payload.command as string;
        if (!command) throw new Error('No command specified for Sora task');
        
        const { stdout, stderr } = await execAsync(command, {
          cwd: '/Users/isaiahdupree/Documents/Software/Safari Automation',
          timeout: 60 * 60 * 1000, // 1 hour timeout
        });
        
        return { stdout, stderr };
      }

      case 'dm': {
        // DM session - would integrate with DM APIs
        console.log(`[SCHEDULER] Running DM session for ${task.platform}`);
        return { message: 'DM session completed' };
      }

      case 'comment': {
        console.log(`[SCHEDULER] Running comment task`);
        return { message: 'Comment task completed' };
      }

      case 'discovery': {
        console.log(`[SCHEDULER] Running discovery task`);
        return { message: 'Discovery completed' };
      }

      case 'sync': {
        console.log(`[SCHEDULER] Running sync task`);
        return { message: 'Sync completed' };
      }

      default:
        throw new Error(`Unknown task type: ${task.type}`);
    }
  }

  /**
   * Check if in quiet hours
   */
  private isQuietHours(): boolean {
    if (!this.config.quietHoursStart || !this.config.quietHoursEnd) {
      return false;
    }

    const hour = new Date().getHours();
    const start = this.config.quietHoursStart;
    const end = this.config.quietHoursEnd;

    if (start < end) {
      return hour >= start && hour < end;
    }
    return hour >= start || hour < end;
  }

  /**
   * Save state to disk
   */
  private saveState(): void {
    try {
      const state = {
        queue: this.queue,
        completed: this.completed.slice(-100), // Keep last 100
        savedAt: new Date().toISOString(),
      };
      fs.writeFileSync(this.config.persistPath, JSON.stringify(state, null, 2));
    } catch (error) {
      console.error('[SCHEDULER] Error saving state:', error);
    }
  }

  /**
   * Load state from disk
   */
  private loadState(): void {
    try {
      if (fs.existsSync(this.config.persistPath)) {
        const data = fs.readFileSync(this.config.persistPath, 'utf-8');
        const state = JSON.parse(data);
        
        // Restore queue (rehydrate dates)
        this.queue = (state.queue || []).map((t: ScheduledTask) => ({
          ...t,
          scheduledFor: new Date(t.scheduledFor),
          createdAt: new Date(t.createdAt),
          startedAt: t.startedAt ? new Date(t.startedAt) : undefined,
          completedAt: t.completedAt ? new Date(t.completedAt) : undefined,
        }));
        
        this.completed = state.completed || [];
        console.log(`[SCHEDULER] Loaded ${this.queue.length} pending tasks from state`);
      }
    } catch (error) {
      console.error('[SCHEDULER] Error loading state:', error);
    }
  }
}
