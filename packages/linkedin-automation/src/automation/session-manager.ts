/**
 * Session Manager
 * Manages browser sessions with unique IDs, expiration, and resource cleanup
 */

import { SafariDriver } from './safari-driver.js';
import type { AutomationConfig } from './types.js';

export interface BrowserSession {
  id: string;
  driver: SafariDriver;
  createdAt: number;
  lastAccessedAt: number;
  expiresAt: number;
  metadata?: Record<string, any>;
}

export class SessionManager {
  private sessions: Map<string, BrowserSession> = new Map();
  private static DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 minutes
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    // Run cleanup every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredSessions();
    }, 5 * 60 * 1000);
  }

  /**
   * Create a new browser session with unique ID
   */
  createSession(config?: Partial<AutomationConfig>, ttlMs?: number): BrowserSession {
    const id = this.generateSessionId();
    const now = Date.now();
    const ttl = ttlMs || SessionManager.DEFAULT_TTL_MS;

    const session: BrowserSession = {
      id,
      driver: new SafariDriver(config),
      createdAt: now,
      lastAccessedAt: now,
      expiresAt: now + ttl,
    };

    this.sessions.set(id, session);
    return session;
  }

  /**
   * Get a session by ID
   */
  getSession(id: string): BrowserSession | null {
    const session = this.sessions.get(id);
    if (!session) {
      return null;
    }

    // Check if expired
    if (Date.now() > session.expiresAt) {
      this.closeSession(id);
      return null;
    }

    // Update last accessed time
    session.lastAccessedAt = Date.now();
    return session;
  }

  /**
   * List all active sessions
   */
  listSessions(): Array<{
    id: string;
    createdAt: number;
    lastAccessedAt: number;
    expiresAt: number;
    timeToExpire: number;
  }> {
    const now = Date.now();
    return Array.from(this.sessions.values())
      .filter(s => s.expiresAt > now)
      .map(s => ({
        id: s.id,
        createdAt: s.createdAt,
        lastAccessedAt: s.lastAccessedAt,
        expiresAt: s.expiresAt,
        timeToExpire: Math.max(0, s.expiresAt - now),
      }));
  }

  /**
   * Close a session and free resources
   */
  closeSession(id: string): boolean {
    const session = this.sessions.get(id);
    if (!session) {
      return false;
    }

    // Clean up driver resources if needed
    // (SafariDriver doesn't have cleanup currently, but we leave room for it)
    this.sessions.delete(id);
    return true;
  }

  /**
   * Extend session expiration
   */
  extendSession(id: string, ttlMs?: number): boolean {
    const session = this.sessions.get(id);
    if (!session) {
      return false;
    }

    const ttl = ttlMs || SessionManager.DEFAULT_TTL_MS;
    session.expiresAt = Date.now() + ttl;
    session.lastAccessedAt = Date.now();
    return true;
  }

  /**
   * Cleanup expired sessions
   */
  private cleanupExpiredSessions(): void {
    const now = Date.now();
    const expiredIds: string[] = [];

    for (const [id, session] of this.sessions.entries()) {
      if (session.expiresAt <= now) {
        expiredIds.push(id);
      }
    }

    for (const id of expiredIds) {
      this.closeSession(id);
    }

    if (expiredIds.length > 0) {
      console.log(`[SessionManager] Cleaned up ${expiredIds.length} expired session(s)`);
    }
  }

  /**
   * Generate unique session ID
   */
  private generateSessionId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 15);
    return `lnkd-${timestamp}-${random}`;
  }

  /**
   * Destroy all sessions and stop cleanup
   */
  destroy(): void {
    clearInterval(this.cleanupInterval);
    for (const id of this.sessions.keys()) {
      this.closeSession(id);
    }
  }

  /**
   * Get session count
   */
  getSessionCount(): number {
    return this.sessions.size;
  }
}

// Singleton instance
let instance: SessionManager | null = null;

export function getSessionManager(): SessionManager {
  if (!instance) {
    instance = new SessionManager();
  }
  return instance;
}
