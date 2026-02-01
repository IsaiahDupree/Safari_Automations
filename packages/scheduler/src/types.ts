/**
 * Safari Task Scheduler Types
 */

export type TaskType = 'sora' | 'dm' | 'comment' | 'discovery' | 'sync';
export type Platform = 'tiktok' | 'instagram' | 'twitter' | 'sora';
export type TaskStatus = 'pending' | 'scheduled' | 'waiting' | 'running' | 'completed' | 'failed' | 'cancelled';
export type TaskPriority = 1 | 2 | 3 | 4 | 5; // 1 = highest

export interface ScheduledTask {
  id: string;
  type: TaskType;
  name: string;
  platform?: Platform;
  priority: TaskPriority;
  scheduledFor: Date;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  dependencies?: string[];
  resourceRequirements?: ResourceRequirements;
  status: TaskStatus;
  retryCount: number;
  maxRetries: number;
  error?: string;
  result?: unknown;
  payload: Record<string, unknown>;
}

export interface ResourceRequirements {
  soraCredits?: number;
  platform?: Platform;
  safariExclusive?: boolean;
}

export interface SoraCreditStatus {
  freeCredits: number;
  paidCredits: number;
  totalCredits: number;
  lastChecked: Date;
  estimatedRefreshTime: Date | null;
  refreshIntervalHours: number;
}

export interface PlatformStatus {
  platform: Platform;
  isReady: boolean;
  isLoggedIn: boolean;
  cooldownUntil?: Date;
  messagesThisHour: number;
  messagesToday: number;
  lastActivity?: Date;
}

export interface SchedulerConfig {
  persistPath: string;
  checkIntervalMs: number;
  maxConcurrentTasks: number;
  defaultRetries: number;
  quietHoursStart?: number;
  quietHoursEnd?: number;
  enableSoraMonitor: boolean;
  soraCheckIntervalMs: number;
}

export interface SchedulerStatus {
  isRunning: boolean;
  startedAt: Date | null;
  tasksInQueue: number;
  tasksRunning: number;
  tasksCompleted: number;
  tasksFailed: number;
  soraCredits: SoraCreditStatus | null;
  platforms: PlatformStatus[];
}

export interface SchedulerEvents {
  taskScheduled: (task: ScheduledTask) => void;
  taskStarted: (task: ScheduledTask) => void;
  taskCompleted: (task: ScheduledTask) => void;
  taskFailed: (task: ScheduledTask, error: Error) => void;
  creditsRefreshed: (credits: SoraCreditStatus) => void;
  resourceAvailable: (resource: string) => void;
}

export const DEFAULT_SCHEDULER_CONFIG: SchedulerConfig = {
  persistPath: './scheduler-state.json',
  checkIntervalMs: 5000,
  maxConcurrentTasks: 1,
  defaultRetries: 3,
  enableSoraMonitor: true,
  soraCheckIntervalMs: 5 * 60 * 1000, // 5 minutes
};
