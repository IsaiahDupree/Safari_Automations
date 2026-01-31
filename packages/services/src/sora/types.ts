/**
 * Sora Rate Limiter Types
 * 
 * Configurable rate limiting for Sora video generation.
 * Default: Very conservative - only a few videos per day.
 */

export interface SoraRateLimitConfig {
  // MASTER SWITCH - disabled by default, must be explicitly enabled
  enabled: boolean;                  // Default: FALSE - completely disabled
  
  // Daily limits
  maxVideosPerDay: number;           // Default: 5 (not 30!)
  maxConcurrentGenerations: number;  // Default: 1
  
  // Timing
  minIntervalBetweenGenerationsMs: number;  // Default: 4 hours
  cooldownAfterErrorMs: number;             // Default: 1 hour
  
  // Hours when Sora can run (24h format)
  allowedStartHour: number;  // Default: 10 (10 AM)
  allowedEndHour: number;    // Default: 18 (6 PM)
  
  // Days of week (0=Sunday, 6=Saturday)
  allowedDays: number[];     // Default: weekdays only [1,2,3,4,5]
  
  // Safety
  requireManualApproval: boolean;  // Default: true
  pauseOnConsecutiveErrors: number; // Default: 2
  
  // Single-shot mode: run once then auto-disable
  singleShotMode: boolean;          // Default: true - only run 1 check then stop
}

export interface SoraGenerationRequest {
  id: string;
  prompt: string;
  style?: string;
  duration?: number;
  createdAt: Date;
  scheduledFor: Date;
  status: SoraGenerationStatus;
}

export type SoraGenerationStatus = 
  | 'pending'
  | 'approved'     // Manual approval received
  | 'generating'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface SoraUsageStats {
  today: {
    generated: number;
    failed: number;
    remaining: number;
  };
  thisWeek: {
    generated: number;
    failed: number;
  };
  lastGeneration: Date | null;
  nextAllowedGeneration: Date | null;
  consecutiveErrors: number;
  isPaused: boolean;
  pauseReason?: string;
}

export const DEFAULT_SORA_CONFIG: SoraRateLimitConfig = {
  // DISABLED BY DEFAULT - must explicitly enable
  enabled: false,
  singleShotMode: true,  // Only run once then auto-disable
  
  // VERY conservative defaults - only 5 per day, not 30
  maxVideosPerDay: 5,
  maxConcurrentGenerations: 1,
  
  // 4 hours between generations
  minIntervalBetweenGenerationsMs: 4 * 60 * 60 * 1000,
  cooldownAfterErrorMs: 60 * 60 * 1000, // 1 hour
  
  // Only during business hours
  allowedStartHour: 10,  // 10 AM
  allowedEndHour: 18,    // 6 PM
  
  // Weekdays only
  allowedDays: [1, 2, 3, 4, 5],
  
  // Safety first
  requireManualApproval: true,
  pauseOnConsecutiveErrors: 2,
};

// Even more conservative preset - also DISABLED by default
export const MINIMAL_SORA_CONFIG: SoraRateLimitConfig = {
  enabled: false,              // DISABLED - must explicitly enable
  singleShotMode: true,        // Only run once then stop
  maxVideosPerDay: 2,
  maxConcurrentGenerations: 1,
  minIntervalBetweenGenerationsMs: 8 * 60 * 60 * 1000, // 8 hours
  cooldownAfterErrorMs: 2 * 60 * 60 * 1000, // 2 hours
  allowedStartHour: 12,
  allowedEndHour: 16,
  allowedDays: [2, 4], // Tuesday and Thursday only
  requireManualApproval: true,
  pauseOnConsecutiveErrors: 1,
};
