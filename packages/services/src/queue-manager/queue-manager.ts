/**
 * Browser Queue Manager
 * 
 * Central queue that serializes all Safari browser operations.
 * Based on PRD: PRD_Safari_Automation_Management.md (SAFARI-001)
 */

import type { QueueTask, QueueConfig, QueueStats, QueuePriority, TaskStatus } from './types';

const DEFAULT_CONFIG: QueueConfig = {
  maxConcurrent: 1, // Safari can only do one thing at a time
  defaultRetries: 3,
  defaultRetryDelayMs: 5000,
  processingIntervalMs: 1000,
};

export class BrowserQueueManager {
  private queue: QueueTask[] = [];
  private running: QueueTask[] = [];
  private completed: QueueTask[] = [];
  private config: QueueConfig;
  private isProcessing = false;
  private intervalId: NodeJS.Timeout | null = null;

  constructor(config: Partial<QueueConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Add a task to the queue
   */
  enqueue(task: Omit<QueueTask, 'id' | 'status' | 'createdAt' | 'retryCount'>): string {
    const id = `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const fullTask: QueueTask = {
      ...task,
      id,
      status: 'pending',
      createdAt: new Date(),
      retryCount: 0,
      maxRetries: task.maxRetries ?? this.config.defaultRetries,
      retryDelayMs: task.retryDelayMs ?? this.config.defaultRetryDelayMs,
    };

    // Insert in priority order (lower number = higher priority)
    const insertIndex = this.queue.findIndex(t => t.priority > fullTask.priority);
    if (insertIndex === -1) {
      this.queue.push(fullTask);
    } else {
      this.queue.splice(insertIndex, 0, fullTask);
    }

    console.log(`Task ${id} enqueued with priority ${task.priority}`);
    return id;
  }

  /**
   * Start processing the queue
   */
  start(): void {
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;
    console.log('Queue manager started');

    this.intervalId = setInterval(() => {
      this.processNext();
    }, this.config.processingIntervalMs);

    // Process immediately
    this.processNext();
  }

  /**
   * Stop processing the queue
   */
  stop(): void {
    if (!this.isProcessing) {
      return;
    }

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    this.isProcessing = false;
    console.log('Queue manager stopped');
  }

  /**
   * Get queue statistics
   */
  getStats(): QueueStats {
    const completedTimes = this.completed
      .filter(t => t.startedAt && t.completedAt)
      .map(t => t.completedAt!.getTime() - t.startedAt!.getTime());

    const avgTime = completedTimes.length > 0
      ? completedTimes.reduce((a, b) => a + b, 0) / completedTimes.length
      : 0;

    return {
      pending: this.queue.length,
      running: this.running.length,
      completed: this.completed.filter(t => t.status === 'completed').length,
      failed: this.completed.filter(t => t.status === 'failed').length,
      totalProcessed: this.completed.length,
      avgProcessingTimeMs: avgTime,
    };
  }

  /**
   * Get task by ID
   */
  getTask(id: string): QueueTask | null {
    return (
      this.queue.find(t => t.id === id) ??
      this.running.find(t => t.id === id) ??
      this.completed.find(t => t.id === id) ??
      null
    );
  }

  /**
   * Cancel a pending task
   */
  cancel(id: string): boolean {
    const index = this.queue.findIndex(t => t.id === id);
    if (index === -1) {
      return false;
    }

    const task = this.queue.splice(index, 1)[0];
    task.status = 'cancelled';
    this.completed.push(task);
    console.log(`Task ${id} cancelled`);
    return true;
  }

  /**
   * Clear all pending tasks
   */
  clearQueue(): number {
    const count = this.queue.length;
    for (const task of this.queue) {
      task.status = 'cancelled';
      this.completed.push(task);
    }
    this.queue = [];
    return count;
  }

  /**
   * Process the next task in the queue
   */
  private async processNext(): Promise<void> {
    if (this.running.length >= this.config.maxConcurrent) {
      return;
    }

    const task = this.queue.shift();
    if (!task) {
      return;
    }

    task.status = 'running';
    task.startedAt = new Date();
    this.running.push(task);

    try {
      console.log(`Processing task ${task.id} (${task.type})`);
      const result = await task.execute();
      
      task.status = 'completed';
      task.completedAt = new Date();
      task.onComplete?.(result);
      
      console.log(`Task ${task.id} completed`);
    } catch (error) {
      console.error(`Task ${task.id} failed:`, error);
      
      if (task.retryCount < task.maxRetries) {
        task.retryCount++;
        task.status = 'pending';
        
        // Re-queue with delay
        setTimeout(() => {
          this.queue.unshift(task);
        }, task.retryDelayMs);
        
        console.log(`Task ${task.id} will retry (${task.retryCount}/${task.maxRetries})`);
      } else {
        task.status = 'failed';
        task.completedAt = new Date();
        task.onError?.(error instanceof Error ? error : new Error(String(error)));
      }
    } finally {
      const runningIndex = this.running.findIndex(t => t.id === task.id);
      if (runningIndex !== -1) {
        this.running.splice(runningIndex, 1);
      }
      
      if (task.status === 'completed' || task.status === 'failed') {
        this.completed.push(task);
      }
    }
  }
}
