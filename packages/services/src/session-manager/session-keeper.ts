/**
 * Session Keeper
 * 
 * Background service that keeps sessions alive by periodically refreshing them.
 * Based on PRD: PRD_SAFARI_SESSION_MANAGER.md
 */

import type { Platform, SessionState, PLATFORM_CONFIGS } from './types';
import { SessionManager } from './session-manager';

export interface SessionKeeperConfig {
  checkIntervalMs: number;
  onSessionExpired?: (platform: Platform) => void;
  onSessionRefreshed?: (platform: Platform) => void;
}

export class SessionKeeper {
  private sessionManager: SessionManager;
  private config: SessionKeeperConfig;
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(sessionManager: SessionManager, config: Partial<SessionKeeperConfig> = {}) {
    this.sessionManager = sessionManager;
    this.config = {
      checkIntervalMs: config.checkIntervalMs ?? 60000, // 1 minute default
      onSessionExpired: config.onSessionExpired,
      onSessionRefreshed: config.onSessionRefreshed,
    };
  }

  /**
   * Start the session keeper background service
   */
  start(): void {
    if (this.isRunning) {
      console.log('Session keeper already running');
      return;
    }

    this.isRunning = true;
    console.log('Session keeper started');

    this.intervalId = setInterval(() => {
      this.checkAndRefresh();
    }, this.config.checkIntervalMs);

    // Run immediately on start
    this.checkAndRefresh();
  }

  /**
   * Stop the session keeper
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
    console.log('Session keeper stopped');
  }

  /**
   * Check if the keeper is running
   */
  getStatus(): { isRunning: boolean; lastCheck: Date | null } {
    return {
      isRunning: this.isRunning,
      lastCheck: null, // TODO: track last check time
    };
  }

  /**
   * Check all sessions and refresh stale ones
   */
  private async checkAndRefresh(): Promise<void> {
    const sessions = this.sessionManager.getAllSessions();

    for (const session of sessions) {
      if (session.status === 'paused') {
        continue;
      }

      try {
        // Check if session needs refresh
        if (this.needsRefresh(session)) {
          await this.refreshSession(session.platform);
        }
      } catch (error) {
        console.error(`Error checking session for ${session.platform}:`, error);
        this.sessionManager.markExpired(
          session.platform,
          error instanceof Error ? error.message : 'Unknown error'
        );
        this.config.onSessionExpired?.(session.platform);
      }
    }
  }

  /**
   * Check if a session needs refresh
   */
  private needsRefresh(session: SessionState): boolean {
    if (session.status !== 'active') {
      return false;
    }

    if (!session.lastRefresh) {
      return true;
    }

    // Default to 30 minutes if not configured
    const refreshIntervalMs = 30 * 60 * 1000;
    const timeSinceRefresh = Date.now() - session.lastRefresh.getTime();

    return timeSinceRefresh > refreshIntervalMs;
  }

  /**
   * Refresh a session by navigating to the platform
   */
  private async refreshSession(platform: Platform): Promise<void> {
    console.log(`Refreshing session for ${platform}...`);

    // TODO: Implement actual browser refresh logic
    // This will use the Safari controller to navigate and verify login

    this.sessionManager.updateSession(platform, {
      lastRefresh: new Date(),
    });

    this.config.onSessionRefreshed?.(platform);
    console.log(`Session refreshed for ${platform}`);
  }
}
