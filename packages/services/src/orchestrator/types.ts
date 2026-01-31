/**
 * Orchestrator Types
 */

import type { CommentPlatform } from '../comment-engine/types';

export interface OrchestratorConfig {
  // Timing
  commentsPerHour: number;
  discoveryIntervalMinutes: number;
  sessionCheckIntervalMinutes: number;
  
  // Platforms
  enabledPlatforms: CommentPlatform[];
  
  // AI
  openaiApiKey?: string;
  commentStyle: 'engaging' | 'supportive' | 'insightful' | 'curious';
  
  // Safety
  requireLoginVerification: boolean;
  pauseOnError: boolean;
  maxConsecutiveErrors: number;
  
  // Hours
  quietHoursStart?: number; // 0-23
  quietHoursEnd?: number;   // 0-23
}

export interface OrchestratorStatus {
  isRunning: boolean;
  startedAt: Date | null;
  
  // Sessions
  loggedInPlatforms: CommentPlatform[];
  
  // Comments
  commentsThisHour: number;
  commentsToday: number;
  lastCommentAt: Date | null;
  
  // Discovery
  postsInQueue: number;
  lastDiscoveryAt: Date | null;
  
  // Errors
  consecutiveErrors: number;
  lastError: string | null;
}

export const DEFAULT_ORCHESTRATOR_CONFIG: OrchestratorConfig = {
  commentsPerHour: 30,
  discoveryIntervalMinutes: 30,
  sessionCheckIntervalMinutes: 15,
  enabledPlatforms: ['instagram', 'twitter', 'tiktok', 'threads'],
  commentStyle: 'engaging',
  requireLoginVerification: true,
  pauseOnError: false,
  maxConsecutiveErrors: 5,
  quietHoursStart: 23, // 11 PM
  quietHoursEnd: 7,    // 7 AM
};
