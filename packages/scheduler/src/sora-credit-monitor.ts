/**
 * Sora Credit Monitor
 * 
 * Monitors Sora video generation credits and triggers callbacks when credits become available.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import type { SoraCreditStatus } from './types.js';

const execAsync = promisify(exec);

export interface CreditRefreshCallback {
  threshold: number;
  callback: () => void;
  triggered: boolean;
}

export class SoraCreditMonitor {
  private lastStatus: SoraCreditStatus | null = null;
  private checkIntervalMs: number;
  private intervalId: NodeJS.Timeout | null = null;
  private callbacks: CreditRefreshCallback[] = [];
  private isMonitoring = false;

  constructor(checkIntervalMs: number = 60 * 60 * 1000) { // Default: 1 hour
    this.checkIntervalMs = checkIntervalMs;
  }

  /**
   * Start monitoring Sora credits
   */
  start(): void {
    if (this.isMonitoring) return;
    
    this.isMonitoring = true;
    console.log('[SORA-MONITOR] Starting credit monitor...');
    
    // Check immediately
    this.checkCredits();
    
    // Then check periodically
    this.intervalId = setInterval(() => {
      this.checkCredits();
    }, this.checkIntervalMs);
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (!this.isMonitoring) return;
    
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    
    this.isMonitoring = false;
    console.log('[SORA-MONITOR] Stopped credit monitor');
  }

  /**
   * Register callback for when credits reach threshold
   */
  onCreditsAvailable(threshold: number, callback: () => void): void {
    this.callbacks.push({ threshold, callback, triggered: false });
  }

  /**
   * Clear all callbacks
   */
  clearCallbacks(): void {
    this.callbacks = [];
  }

  /**
   * Get current credit status
   */
  getStatus(): SoraCreditStatus | null {
    return this.lastStatus;
  }

  /**
   * Check credits and trigger callbacks
   */
  async checkCredits(): Promise<SoraCreditStatus | null> {
    try {
      console.log('[SORA-MONITOR] Checking Sora credits...');
      
      // Use a script file instead of inline eval to avoid top-level await issues
      const result = await execAsync(
        `npx tsx scripts/sora-usage-test.ts 2>/dev/null | tail -1`,
        { cwd: '/Users/isaiahdupree/Documents/Software/Safari Automation' }
      );
      
      // Try to parse usage from output - look for the JSON-like pattern
      const output = result.stdout.trim();
      let freeCredits = 0;
      let paidCredits = 0;
      
      // Parse "Usage: X gens left (Y free, Z paid)" format
      const match = output.match(/Usage:\s*(\d+)\s*gens.*\((\d+)\s*free,\s*(\d+)\s*paid\)/i);
      if (match) {
        freeCredits = parseInt(match[2]) || 0;
        paidCredits = parseInt(match[3]) || 0;
      }
      
      const status: SoraCreditStatus = {
        freeCredits,
        paidCredits,
        totalCredits: freeCredits + paidCredits,
        lastChecked: new Date(),
        estimatedRefreshTime: this.estimateRefreshTime(),
        refreshIntervalHours: 24,
      };
      
      const prevTotal = this.lastStatus?.totalCredits || 0;
      this.lastStatus = status;
      
      console.log(`[SORA-MONITOR] Credits: ${status.totalCredits} (${status.freeCredits} free, ${status.paidCredits} paid)`);
      
      // Check if credits increased (refresh happened)
      if (status.totalCredits > prevTotal && prevTotal > 0) {
        console.log('[SORA-MONITOR] 🎉 Credits refreshed!');
      }
      
      // Trigger callbacks
      this.checkCallbacks(status);
      
      return status;
    } catch (error) {
      console.error('[SORA-MONITOR] Error checking credits:', error);
      return null;
    }
  }

  /**
   * Check and trigger callbacks based on current credits
   */
  private checkCallbacks(status: SoraCreditStatus): void {
    for (const cb of this.callbacks) {
      if (!cb.triggered && status.totalCredits >= cb.threshold) {
        console.log(`[SORA-MONITOR] 🔔 Credits threshold ${cb.threshold} reached, triggering callback`);
        cb.triggered = true;
        cb.callback();
      }
    }
  }

  /**
   * Estimate when credits will refresh based on patterns
   */
  private estimateRefreshTime(): Date | null {
    // Sora typically refreshes daily at midnight UTC
    const now = new Date();
    const nextMidnightUTC = new Date(now);
    nextMidnightUTC.setUTCHours(24, 0, 0, 0);
    return nextMidnightUTC;
  }

  /**
   * Get time until credits refresh
   */
  getTimeUntilRefresh(): string {
    const refreshTime = this.estimateRefreshTime();
    if (!refreshTime) return 'Unknown';
    
    const now = new Date();
    const diff = refreshTime.getTime() - now.getTime();
    
    if (diff <= 0) return 'Soon';
    
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    
    return `${hours}h ${minutes}m`;
  }
}
