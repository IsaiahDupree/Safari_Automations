/**
 * Unified Safari Gateway
 * 
 * Central coordination service for all Safari automations.
 * Manages:
 *  - Safari browser lock (exclusive access)
 *  - Session health per platform
 *  - Request routing to downstream services
 *  - Cross-service status monitoring
 */

import express, { Request, Response } from 'express';
import cors from 'cors';

// ─── Types ──────────────────────────────────────────────────

export type Platform = 
  | 'instagram' | 'tiktok' | 'twitter' | 'threads'
  | 'linkedin' | 'upwork' | 'sora' | 'youtube';

export interface ServiceConfig {
  platform: Platform;
  name: string;
  port: number;
  healthPath: string;
  capabilities: string[];
}

export interface SafariLock {
  holder: string;
  platform: Platform | null;
  acquiredAt: Date;
  expiresAt: Date;
  taskDescription: string;
}

export interface SessionState {
  platform: Platform;
  status: 'active' | 'stale' | 'expired' | 'unknown';
  lastCheck: Date | null;
  lastRefresh: Date | null;
  error: string | null;
}

interface QueueEntry {
  id: string;
  holder: string;
  platform: Platform | null;
  taskDescription: string;
  timeoutMs: number;
  resolve: (acquired: boolean) => void;
  timer: NodeJS.Timeout;
}

// ─── Service Registry ───────────────────────────────────────

const SERVICES: ServiceConfig[] = [
  {
    platform: 'instagram',
    name: 'Instagram DM',
    port: 3100,
    healthPath: '/health',
    capabilities: ['dm', 'conversations', 'threads'],
  },
  {
    platform: 'tiktok',
    name: 'TikTok DM',
    port: 3102,
    healthPath: '/health',
    capabilities: ['dm'],
  },
  {
    platform: 'twitter',
    name: 'Twitter DM',
    port: 3003,
    healthPath: '/health',
    capabilities: ['dm', 'conversations'],
  },
  {
    platform: 'threads',
    name: 'Threads Comments',
    port: 3004,
    healthPath: '/health',
    capabilities: ['comments'],
  },
  {
    platform: 'instagram',
    name: 'Instagram Comments',
    port: 3005,
    healthPath: '/health',
    capabilities: ['comments'],
  },
  {
    platform: 'tiktok',
    name: 'TikTok Comments',
    port: 3006,
    healthPath: '/health',
    capabilities: ['comments'],
  },
  {
    platform: 'twitter',
    name: 'Twitter Comments',
    port: 3007,
    healthPath: '/health',
    capabilities: ['comments'],
  },
  {
    platform: 'upwork',
    name: 'Upwork Automation',
    port: 3104,
    healthPath: '/health',
    capabilities: ['job-scan', 'apply', 'monitor'],
  },
  {
    platform: 'linkedin',
    name: 'LinkedIn Automation',
    port: 3105,
    healthPath: '/health',
    capabilities: ['profile', 'connections', 'dm', 'search', 'outreach'],
  },
];

// Platform login check configs (URL + selector that indicates logged-in)
const LOGIN_CHECKS: Record<Platform, { url: string; selector: string }> = {
  instagram: { url: 'https://www.instagram.com/', selector: 'svg[aria-label="Home"]' },
  tiktok: { url: 'https://www.tiktok.com/foryou', selector: '[data-e2e="profile-icon"]' },
  twitter: { url: 'https://x.com/home', selector: '[data-testid="AppTabBar_Profile_Link"]' },
  threads: { url: 'https://www.threads.net/', selector: '[aria-label="Create"]' },
  linkedin: { url: 'https://www.linkedin.com/feed/', selector: '.feed-identity-module' },
  upwork: { url: 'https://www.upwork.com/nx/find-work/', selector: '[data-test="nav-user-avatar"]' },
  sora: { url: 'https://sora.com/', selector: '[class*="avatar"]' },
  youtube: { url: 'https://www.youtube.com/', selector: '#avatar-btn' },
};

// ─── Safari Lock Manager ────────────────────────────────────

class SafariLockManager {
  private currentLock: SafariLock | null = null;
  private queue: QueueEntry[] = [];
  private lockIdCounter = 0;

  isLocked(): boolean {
    if (!this.currentLock) return false;
    if (new Date() > this.currentLock.expiresAt) {
      console.log(`[Gateway] Lock expired for ${this.currentLock.holder}`);
      this.release(this.currentLock.holder);
      return false;
    }
    return true;
  }

  getLock(): SafariLock | null {
    return this.isLocked() ? this.currentLock : null;
  }

  acquire(holder: string, platform: Platform | null, taskDescription: string, timeoutMs: number = 60000): boolean {
    if (this.isLocked()) return false;
    this.currentLock = {
      holder,
      platform,
      acquiredAt: new Date(),
      expiresAt: new Date(Date.now() + timeoutMs),
      taskDescription,
    };
    console.log(`[Gateway] Lock acquired by ${holder} for ${taskDescription} (${timeoutMs}ms)`);
    return true;
  }

  async acquireAsync(holder: string, platform: Platform | null, taskDescription: string, timeoutMs: number = 60000, waitMs: number = 30000): Promise<boolean> {
    if (this.acquire(holder, platform, taskDescription, timeoutMs)) return true;

    return new Promise<boolean>((resolve) => {
      const id = `lock_${++this.lockIdCounter}`;
      const timer = setTimeout(() => {
        this.queue = this.queue.filter(e => e.id !== id);
        resolve(false);
      }, waitMs);

      this.queue.push({ id, holder, platform, taskDescription, timeoutMs, resolve, timer });
      console.log(`[Gateway] ${holder} queued for lock (${this.queue.length} in queue)`);
    });
  }

  release(holder: string): boolean {
    if (!this.currentLock || this.currentLock.holder !== holder) return false;
    console.log(`[Gateway] Lock released by ${holder}`);
    this.currentLock = null;
    this.processQueue();
    return true;
  }

  forceRelease(): void {
    if (this.currentLock) {
      console.log(`[Gateway] Force-released lock from ${this.currentLock.holder}`);
      this.currentLock = null;
    }
    this.processQueue();
  }

  private processQueue(): void {
    if (this.queue.length === 0 || this.isLocked()) return;
    const next = this.queue.shift()!;
    clearTimeout(next.timer);
    if (this.acquire(next.holder, next.platform, next.taskDescription, next.timeoutMs)) {
      next.resolve(true);
    } else {
      next.resolve(false);
    }
  }

  getQueueLength(): number { return this.queue.length; }
}

// ─── Gateway Server ─────────────────────────────────────────

const PORT = parseInt(process.env.GATEWAY_PORT || '3000');
const app = express();
app.use(cors());
app.use(express.json());

const lockManager = new SafariLockManager();
const sessions: Map<Platform, SessionState> = new Map();

// Initialize session states
for (const platform of Object.keys(LOGIN_CHECKS) as Platform[]) {
  sessions.set(platform, {
    platform,
    status: 'unknown',
    lastCheck: null,
    lastRefresh: null,
    error: null,
  });
}

// ─── Health ─────────────────────────────────────────────────

app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'running',
    service: 'safari-gateway',
    port: PORT,
    timestamp: new Date().toISOString(),
    lock: lockManager.getLock(),
    queueLength: lockManager.getQueueLength(),
  });
});

// ─── Service Discovery ─────────────────────────────────────

app.get('/gateway/services', async (_req: Request, res: Response) => {
  const results = await Promise.all(
    SERVICES.map(async (svc) => {
      let healthy = false;
      try {
        const r = await fetch(`http://localhost:${svc.port}${svc.healthPath}`, {
          signal: AbortSignal.timeout(3000),
        });
        healthy = r.ok;
      } catch {}
      return { ...svc, healthy };
    })
  );
  res.json({ services: results, count: results.length });
});

// ─── Safari Lock ────────────────────────────────────────────

app.post('/gateway/lock/acquire', async (req: Request, res: Response) => {
  const { holder, platform, task, timeoutMs, waitMs } = req.body;
  if (!holder) return res.status(400).json({ error: 'holder required' });

  if (waitMs) {
    const acquired = await lockManager.acquireAsync(
      holder, platform || null, task || '', timeoutMs || 60000, waitMs
    );
    return res.json({ acquired, lock: lockManager.getLock() });
  }

  const acquired = lockManager.acquire(holder, platform || null, task || '', timeoutMs || 60000);
  res.json({ acquired, lock: lockManager.getLock() });
});

app.post('/gateway/lock/release', (req: Request, res: Response) => {
  const { holder } = req.body;
  if (!holder) return res.status(400).json({ error: 'holder required' });
  const released = lockManager.release(holder);
  res.json({ released, lock: lockManager.getLock() });
});

app.post('/gateway/lock/force-release', (_req: Request, res: Response) => {
  lockManager.forceRelease();
  res.json({ released: true, lock: null });
});

app.get('/gateway/lock', (_req: Request, res: Response) => {
  res.json({ lock: lockManager.getLock(), queueLength: lockManager.getQueueLength() });
});

// ─── Sessions ───────────────────────────────────────────────

app.get('/gateway/sessions', (_req: Request, res: Response) => {
  const all = Array.from(sessions.values());
  res.json({
    sessions: all,
    active: all.filter(s => s.status === 'active').length,
    total: all.length,
  });
});

app.get('/gateway/sessions/:platform', (req: Request, res: Response) => {
  const platform = req.params.platform as Platform;
  const session = sessions.get(platform);
  if (!session) return res.status(404).json({ error: `Unknown platform: ${platform}` });
  res.json(session);
});

app.post('/gateway/sessions/check', async (req: Request, res: Response) => {
  const { platform } = req.body;
  if (!platform) return res.status(400).json({ error: 'platform required' });

  const check = LOGIN_CHECKS[platform as Platform];
  if (!check) return res.status(400).json({ error: `Unknown platform: ${platform}` });

  // Need Safari lock to check session
  const acquired = lockManager.acquire('gateway-session-check', platform, `Check ${platform} session`, 30000);
  if (!acquired) {
    return res.status(409).json({ error: 'Safari is locked by another task', lock: lockManager.getLock() });
  }

  try {
    // Route to the appropriate service to check login
    // For now, use a simple approach: try the service's health endpoint
    const service = SERVICES.find(s => s.platform === platform);
    if (service) {
      try {
        const r = await fetch(`http://localhost:${service.port}/health`, {
          signal: AbortSignal.timeout(5000),
        });
        if (r.ok) {
          sessions.set(platform as Platform, {
            platform: platform as Platform,
            status: 'active',
            lastCheck: new Date(),
            lastRefresh: sessions.get(platform as Platform)?.lastRefresh || null,
            error: null,
          });
          return res.json(sessions.get(platform as Platform));
        }
      } catch {}
    }

    sessions.set(platform as Platform, {
      platform: platform as Platform,
      status: 'expired',
      lastCheck: new Date(),
      lastRefresh: null,
      error: 'Service not responding',
    });
    res.json(sessions.get(platform as Platform));
  } finally {
    lockManager.release('gateway-session-check');
  }
});

// ─── Task Routing ───────────────────────────────────────────

app.post('/gateway/route', async (req: Request, res: Response) => {
  const { platform, method, path, body, acquireLock, holder, timeoutMs } = req.body;

  if (!platform || !path) {
    return res.status(400).json({ error: 'platform and path required' });
  }

  const service = SERVICES.find(s => s.platform === platform);
  if (!service) {
    return res.status(404).json({ error: `No service found for platform: ${platform}` });
  }

  // Optionally acquire Safari lock
  if (acquireLock) {
    const lockHolder = holder || `route-${platform}-${Date.now()}`;
    const acquired = await lockManager.acquireAsync(
      lockHolder, platform, `Routed: ${method || 'GET'} ${path}`, timeoutMs || 60000, 30000
    );
    if (!acquired) {
      return res.status(409).json({ error: 'Could not acquire Safari lock', lock: lockManager.getLock() });
    }
    // Auto-release after response
    res.on('finish', () => lockManager.release(lockHolder));
  }

  try {
    const url = `http://localhost:${service.port}${path}`;
    const opts: RequestInit = {
      method: method || 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(timeoutMs || 60000),
    };
    if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
      opts.body = JSON.stringify(body);
    }

    const upstream = await fetch(url, opts);
    const data = await upstream.json();
    res.status(upstream.status).json({
      routed: true,
      service: service.name,
      port: service.port,
      ...data,
    });
  } catch (e: any) {
    res.status(502).json({
      error: `Service ${service.name} (port ${service.port}) unreachable`,
      details: e.message,
    });
  }
});

// ─── Convenience: Status Dashboard ──────────────────────────

app.get('/gateway/dashboard', async (_req: Request, res: Response) => {
  const serviceHealth = await Promise.all(
    SERVICES.map(async (svc) => {
      let healthy = false;
      let latency = 0;
      const start = Date.now();
      try {
        const r = await fetch(`http://localhost:${svc.port}${svc.healthPath}`, {
          signal: AbortSignal.timeout(3000),
        });
        healthy = r.ok;
        latency = Date.now() - start;
      } catch {}
      return {
        name: svc.name,
        platform: svc.platform,
        port: svc.port,
        healthy,
        latency,
        capabilities: svc.capabilities,
      };
    })
  );

  const healthyCount = serviceHealth.filter(s => s.healthy).length;
  const lock = lockManager.getLock();
  const sessionList = Array.from(sessions.values());

  res.json({
    gateway: {
      status: 'running',
      port: PORT,
      uptime: process.uptime(),
    },
    safari: {
      locked: !!lock,
      lock,
      queueLength: lockManager.getQueueLength(),
    },
    services: {
      total: serviceHealth.length,
      healthy: healthyCount,
      unhealthy: serviceHealth.length - healthyCount,
      list: serviceHealth,
    },
    sessions: {
      active: sessionList.filter(s => s.status === 'active').length,
      list: sessionList,
    },
  });
});

// ─── Start ──────────────────────────────────────────────────

export function startGateway(port: number = PORT): void {
  app.listen(port, () => {
    console.log(`\n🌐 Safari Gateway running on http://localhost:${port}`);
    console.log(`   Dashboard:  GET http://localhost:${port}/gateway/dashboard`);
    console.log(`   Services:   GET http://localhost:${port}/gateway/services`);
    console.log(`   Lock:       GET http://localhost:${port}/gateway/lock`);
    console.log(`   Sessions:   GET http://localhost:${port}/gateway/sessions`);
    console.log(`   Route:      POST http://localhost:${port}/gateway/route`);
    console.log(`\n   ${SERVICES.length} registered services across ${new Set(SERVICES.map(s => s.platform)).size} platforms\n`);
  });
}

// Run directly
startGateway();
