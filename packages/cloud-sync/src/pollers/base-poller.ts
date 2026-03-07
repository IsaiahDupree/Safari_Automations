/**
 * Base poller — shared HTTP helpers for calling Safari automation services
 */
import { Platform, PlatformDM, PlatformNotification, PostStats, PlatformComment, FollowerEvent, LinkedInInvitation } from '../types';

export abstract class BasePoller {
  protected platform: Platform;
  protected port: number;
  protected baseUrl: string;
  protected authToken: string | null;

  constructor(platform: Platform, port: number, authToken?: string) {
    this.platform = platform;
    this.port = port;
    this.baseUrl = `http://localhost:${port}`;
    this.authToken = authToken || null;
  }

  protected authHeaders(): Record<string, string> {
    return this.authToken ? { 'Authorization': `Bearer ${this.authToken}` } : {};
  }

  async isServiceHealthy(): Promise<boolean> {
    try {
      const r = await fetch(`${this.baseUrl}/health`, { signal: AbortSignal.timeout(3000) });
      return r.ok;
    } catch {
      return false;
    }
  }

  protected async get<T = any>(path: string): Promise<T | null> {
    try {
      const r = await fetch(`${this.baseUrl}${path}`, {
        headers: this.authHeaders(),
        signal: AbortSignal.timeout(15000),
      });
      if (!r.ok) return null;
      return await r.json() as T;
    } catch (e) {
      console.error(`[Poller:${this.platform}] GET ${path} failed:`, (e as Error).message);
      return null;
    }
  }

  protected async post<T = any>(path: string, body?: any): Promise<T | null> {
    try {
      const r = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this.authHeaders() },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15000),
      });
      if (!r.ok) return null;
      return await r.json() as T;
    } catch (e) {
      console.error(`[Poller:${this.platform}] POST ${path} failed:`, (e as Error).message);
      return null;
    }
  }

  /**
   * Helper: fetch from a different port (e.g. comments service vs DM service)
   */
  protected async fetchService<T = any>(port: number, method: 'GET' | 'POST', path: string, body?: any): Promise<T | null> {
    try {
      const url = `http://localhost:${port}${path}`;
      const opts: RequestInit = {
        method,
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(20000),
      };
      if (body && method === 'POST') opts.body = JSON.stringify(body);
      const r = await fetch(url, opts);
      if (!r.ok) return null;
      return await r.json() as T;
    } catch (e) {
      console.error(`[Poller:${this.platform}] ${method} localhost:${port}${path} failed:`, (e as Error).message);
      return null;
    }
  }

  /**
   * Verify the current page URL contains the expected domain.
   * Use this after navigation to prevent cross-platform bleed / stale-page extraction.
   * @param servicePort - port of the service to check via status endpoint
   * @param expectedDomain - domain substring the URL must contain (e.g. 'instagram.com')
   */
  protected async verifyPageDomain(servicePort: number, expectedDomain: string): Promise<boolean> {
    try {
      const statusPath = `/api/${this.platform}/status`;
      const r = await fetch(`http://localhost:${servicePort}${statusPath}`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!r.ok) return false;
      const data = await r.json() as { url?: string; currentUrl?: string; pageUrl?: string };
      const url = data.url || data.currentUrl || data.pageUrl || '';
      if (!url) return true; // status doesn't expose URL — can't verify, allow
      return url.includes(expectedDomain);
    } catch {
      return true; // network error checking — allow, don't block
    }
  }

  abstract pollDMs(): Promise<PlatformDM[]>;
  abstract pollNotifications(): Promise<PlatformNotification[]>;
  abstract pollPostStats(): Promise<PostStats[]>;
  pollInvitations?(): Promise<LinkedInInvitation[]>;
  pollComments?(): Promise<PlatformComment[]>;
  pollFollowers?(): Promise<FollowerEvent[]>;
}
