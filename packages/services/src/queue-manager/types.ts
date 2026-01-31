/**
 * Browser Queue Manager Types
 * Based on PRD: PRD_Safari_Automation_Management.md
 */

export type QueuePriority = 1 | 2 | 3 | 4 | 5;

export const PRIORITY = {
  SORA_POLLING: 1 as QueuePriority,      // Highest - Active generation polling
  TWITTER_POSTING: 2 as QueuePriority,   // Time-sensitive posting
  COMMENTING: 3 as QueuePriority,        // 30/hour commenting
  STATS_POLLING: 4 as QueuePriority,     // Passive stats collection
  TREND_DISCOVERY: 5 as QueuePriority,   // Background scraping
} as const;

export type TaskStatus = 
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type TaskType =
  | 'sora_poll'
  | 'twitter_post'
  | 'comment'
  | 'like'
  | 'dm'
  | 'stats_poll'
  | 'trend_scrape'
  | 'session_refresh'
  | 'custom';

export interface QueueTask {
  id: string;
  type: TaskType;
  priority: QueuePriority;
  status: TaskStatus;
  
  // Task details
  platform?: string;
  targetUrl?: string;
  payload?: Record<string, unknown>;
  
  // Execution
  execute: () => Promise<unknown>;
  onComplete?: (result: unknown) => void;
  onError?: (error: Error) => void;
  
  // Timing
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  
  // Retry
  retryCount: number;
  maxRetries: number;
  retryDelayMs: number;
}

export interface QueueConfig {
  maxConcurrent: number;
  defaultRetries: number;
  defaultRetryDelayMs: number;
  processingIntervalMs: number;
}

export interface QueueStats {
  pending: number;
  running: number;
  completed: number;
  failed: number;
  totalProcessed: number;
  avgProcessingTimeMs: number;
}
