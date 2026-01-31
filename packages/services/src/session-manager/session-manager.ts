/**
 * Session Manager
 * 
 * Core service for managing Safari browser sessions across platforms.
 * Based on PRD: PRD_SAFARI_SESSION_MANAGER.md
 */

import type {
  Platform,
  SessionState,
  SessionStatus,
  AccountInfo,
  PLATFORM_CONFIGS,
} from './types';

export interface SessionManagerConfig {
  checkIntervalMs?: number;
  defaultRefreshIntervalMinutes?: number;
}

export class SessionManager {
  private sessions: Map<Platform, SessionState> = new Map();
  private config: Required<SessionManagerConfig>;

  constructor(config: SessionManagerConfig = {}) {
    this.config = {
      checkIntervalMs: config.checkIntervalMs ?? 60000,
      defaultRefreshIntervalMinutes: config.defaultRefreshIntervalMinutes ?? 30,
    };
  }

  /**
   * Get current session state for a platform
   */
  getSession(platform: Platform): SessionState | null {
    return this.sessions.get(platform) ?? null;
  }

  /**
   * Get all session states
   */
  getAllSessions(): SessionState[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Check if a platform session is logged in
   */
  async checkLoginStatus(platform: Platform): Promise<boolean> {
    // This will be implemented with actual browser checking
    const session = this.sessions.get(platform);
    if (!session) return false;
    return session.status === 'active' || session.status === 'stale';
  }

  /**
   * Update session state
   */
  updateSession(platform: Platform, update: Partial<SessionState>): void {
    const current = this.sessions.get(platform) ?? {
      platform,
      status: 'expired' as SessionStatus,
      username: null,
      lastCheck: null,
      lastRefresh: null,
      lastLogin: null,
      error: null,
    };

    this.sessions.set(platform, {
      ...current,
      ...update,
      lastCheck: new Date(),
    });
  }

  /**
   * Mark session as active
   */
  markActive(platform: Platform, username: string): void {
    this.updateSession(platform, {
      status: 'active',
      username,
      lastRefresh: new Date(),
      error: null,
    });
  }

  /**
   * Mark session as expired
   */
  markExpired(platform: Platform, error?: string): void {
    this.updateSession(platform, {
      status: 'expired',
      error: error ?? null,
    });
  }

  /**
   * Mark session as stale (needs refresh)
   */
  markStale(platform: Platform): void {
    this.updateSession(platform, {
      status: 'stale',
    });
  }

  /**
   * Get sessions that need refresh
   */
  getStaleSessionsconfiguredRefreshInterval(refreshIntervalMinutes: number = this.config.defaultRefreshIntervalMinutes): Platform[] {
    const now = Date.now();
    const stale: Platform[] = [];

    for (const [platform, session] of this.sessions) {
      if (session.status === 'active' && session.lastRefresh) {
        const timeSinceRefresh = now - session.lastRefresh.getTime();
        if (timeSinceRefresh > refreshIntervalMinutes * 60 * 1000) {
          stale.push(platform);
        }
      }
    }

    return stale;
  }

  /**
   * Get session health summary
   */
  getHealthSummary(): {
    total: number;
    active: number;
    stale: number;
    expired: number;
    platforms: Record<Platform, SessionStatus>;
  } {
    let active = 0;
    let stale = 0;
    let expired = 0;
    const platforms: Partial<Record<Platform, SessionStatus>> = {};

    for (const [platform, session] of this.sessions) {
      platforms[platform] = session.status;
      switch (session.status) {
        case 'active':
          active++;
          break;
        case 'stale':
          stale++;
          break;
        case 'expired':
          expired++;
          break;
      }
    }

    return {
      total: this.sessions.size,
      active,
      stale,
      expired,
      platforms: platforms as Record<Platform, SessionStatus>,
    };
  }
}
