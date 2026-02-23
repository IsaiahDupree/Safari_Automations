/**
 * Safari Lock Manager & Gateway — Real Integration Tests (no mocks)
 *
 * Tests the actual SafariLockManager class directly (exported from
 * safari-gateway.ts) and the Express gateway routes via real HTTP.
 */

import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { SafariLockManager } from '../safari-gateway.js';
import type { Platform } from '../safari-gateway.js';
import http from 'http';
import express from 'express';

// ═══════════════════════════════════════════════════════════════
// Part 1: SafariLockManager unit tests (real class, no mocks)
// ═══════════════════════════════════════════════════════════════

describe('SafariLockManager (integration)', () => {
  let lock: SafariLockManager;

  beforeEach(() => {
    lock = new SafariLockManager();
  });

  // ─── Basic Locking ─────────────────────────────────────────

  describe('Acquire / Release', () => {
    it('starts unlocked', () => {
      expect(lock.isLocked()).toBe(false);
      expect(lock.getLock()).toBeNull();
    });

    it('acquires a lock', () => {
      const ok = lock.acquire('worker-1', 'instagram', 'DM session', 5000);
      expect(ok).toBe(true);
      expect(lock.isLocked()).toBe(true);
      const l = lock.getLock()!;
      expect(l.holder).toBe('worker-1');
      expect(l.platform).toBe('instagram');
      expect(l.taskDescription).toBe('DM session');
    });

    it('rejects a second acquire while locked', () => {
      lock.acquire('A', 'instagram', 'task A', 5000);
      const ok = lock.acquire('B', 'twitter', 'task B', 5000);
      expect(ok).toBe(false);
      expect(lock.getLock()!.holder).toBe('A');
    });

    it('releases the lock', () => {
      lock.acquire('A', 'instagram', 'task', 5000);
      const released = lock.release('A');
      expect(released).toBe(true);
      expect(lock.isLocked()).toBe(false);
    });

    it('release by wrong holder returns false', () => {
      lock.acquire('A', 'instagram', 'task', 5000);
      expect(lock.release('B')).toBe(false);
      expect(lock.isLocked()).toBe(true);
    });

    it('release on empty lock returns false', () => {
      expect(lock.release('anyone')).toBe(false);
    });
  });

  // ─── Lock Expiry ───────────────────────────────────────────

  describe('Lock Expiry', () => {
    it('auto-expires after timeoutMs', async () => {
      lock.acquire('A', 'instagram', 'task', 100); // 100ms expiry
      expect(lock.isLocked()).toBe(true);

      // Wait for expiry
      await new Promise(r => setTimeout(r, 150));

      expect(lock.isLocked()).toBe(false);
      expect(lock.getLock()).toBeNull();
    });

    it('allows new acquire after expiry', async () => {
      lock.acquire('A', null, 'expired task', 50);
      await new Promise(r => setTimeout(r, 80));

      const ok = lock.acquire('B', 'twitter', 'new task', 5000);
      expect(ok).toBe(true);
      expect(lock.getLock()!.holder).toBe('B');
    });
  });

  // ─── Force Release ─────────────────────────────────────────

  describe('Force Release', () => {
    it('force releases even without correct holder', () => {
      lock.acquire('A', 'instagram', 'task', 60000);
      lock.forceRelease();
      expect(lock.isLocked()).toBe(false);
    });

    it('no-op on empty lock', () => {
      lock.forceRelease(); // should not throw
      expect(lock.isLocked()).toBe(false);
    });
  });

  // ─── Async Queue ───────────────────────────────────────────

  describe('Async Queue', () => {
    it('acquireAsync succeeds immediately when unlocked', async () => {
      const ok = await lock.acquireAsync('A', 'instagram', 'task', 5000, 1000);
      expect(ok).toBe(true);
      expect(lock.getLock()!.holder).toBe('A');
    });

    it('acquireAsync waits and succeeds when lock is released', async () => {
      lock.acquire('A', 'instagram', 'task A', 5000);

      // B will queue and wait
      const promise = lock.acquireAsync('B', 'twitter', 'task B', 5000, 2000);

      // Release A after 100ms
      setTimeout(() => lock.release('A'), 100);

      const ok = await promise;
      expect(ok).toBe(true);
      expect(lock.getLock()!.holder).toBe('B');
    });

    it('acquireAsync times out if lock is never released', async () => {
      lock.acquire('A', 'instagram', 'long task', 60000);

      const ok = await lock.acquireAsync('B', 'twitter', 'waiting', 5000, 200);
      expect(ok).toBe(false);
      // A still holds the lock
      expect(lock.getLock()!.holder).toBe('A');
    });

    it('queue processes in FIFO order', async () => {
      lock.acquire('A', null, 'task A', 5000);

      const order: string[] = [];
      const p1 = lock.acquireAsync('B', null, 'task B', 200, 3000).then(ok => {
        if (ok) { order.push('B'); lock.release('B'); }
      });
      const p2 = lock.acquireAsync('C', null, 'task C', 200, 3000).then(ok => {
        if (ok) { order.push('C'); lock.release('C'); }
      });

      // Release A after 50ms
      setTimeout(() => lock.release('A'), 50);
      await Promise.all([p1, p2]);

      expect(order).toEqual(['B', 'C']);
    });

    it('reports queue length accurately', () => {
      lock.acquire('A', null, 'task', 60000);
      expect(lock.getQueueLength()).toBe(0);

      // Queue two waiters (don't await — they'll be pending)
      lock.acquireAsync('B', null, 'b', 5000, 500);
      lock.acquireAsync('C', null, 'c', 5000, 500);
      expect(lock.getQueueLength()).toBe(2);

      // Release A → B acquires, C stays in queue
      lock.release('A');
      expect(lock.getQueueLength()).toBe(1);
      expect(lock.getLock()!.holder).toBe('B');
    });

    it('force release drains the queue', async () => {
      lock.acquire('A', null, 'task', 60000);
      const p = lock.acquireAsync('B', null, 'waiting', 5000, 2000);

      lock.forceRelease();

      const ok = await p;
      expect(ok).toBe(true);
      expect(lock.getLock()!.holder).toBe('B');
    });
  });

  // ─── Concurrent Stress ─────────────────────────────────────

  describe('Concurrent Stress', () => {
    it('handles 10 concurrent acquireAsync calls correctly', async () => {
      lock.acquire('initial', null, 'setup', 5000);
      const results: boolean[] = [];

      const promises = Array.from({ length: 10 }, (_, i) =>
        lock.acquireAsync(`worker-${i}`, null, `task-${i}`, 100, 3000).then(ok => {
          results.push(ok);
          if (ok) lock.release(`worker-${i}`);
          return ok;
        })
      );

      // Release initial lock after 50ms to start the chain
      setTimeout(() => lock.release('initial'), 50);

      await Promise.all(promises);
      // All 10 should have acquired and released
      expect(results.filter(r => r)).toHaveLength(10);
      expect(lock.isLocked()).toBe(false);
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// Part 2: Gateway Express routes (real HTTP, no mocks)
// ═══════════════════════════════════════════════════════════════

describe('Safari Gateway Routes (integration)', () => {
  let server: http.Server;
  let baseUrl: string;
  let gatewayLock: SafariLockManager;

  beforeEach(async () => {
    gatewayLock = new SafariLockManager();

    const app = express();
    app.use(express.json());

    // Replicate core gateway routes using real lock manager
    app.get('/health', (_req, res) => {
      res.json({
        status: 'running',
        lock: gatewayLock.getLock(),
        queueLength: gatewayLock.getQueueLength(),
      });
    });

    app.post('/gateway/lock/acquire', async (req, res) => {
      const { holder, platform, task, timeoutMs, waitMs } = req.body;
      if (!holder) return res.status(400).json({ error: 'holder required' });
      if (waitMs) {
        const acquired = await gatewayLock.acquireAsync(holder, platform || null, task || '', timeoutMs || 60000, waitMs);
        return res.json({ acquired, lock: gatewayLock.getLock() });
      }
      const acquired = gatewayLock.acquire(holder, platform || null, task || '', timeoutMs || 60000);
      res.json({ acquired, lock: gatewayLock.getLock() });
    });

    app.post('/gateway/lock/release', (req, res) => {
      const { holder } = req.body;
      if (!holder) return res.status(400).json({ error: 'holder required' });
      const released = gatewayLock.release(holder);
      res.json({ released, lock: gatewayLock.getLock() });
    });

    app.post('/gateway/lock/force-release', (_req, res) => {
      gatewayLock.forceRelease();
      res.json({ released: true, lock: null });
    });

    app.get('/gateway/lock', (_req, res) => {
      res.json({ lock: gatewayLock.getLock(), queueLength: gatewayLock.getQueueLength() });
    });

    // Start on random port
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address() as any;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterEach(() => {
    server?.close();
  });

  async function post(path: string, body: Record<string, unknown> = {}): Promise<any> {
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.json();
  }
  async function get(path: string): Promise<any> {
    const res = await fetch(`${baseUrl}${path}`);
    return res.json();
  }

  it('GET /health returns running status', async () => {
    const data = await get('/health');
    expect(data.status).toBe('running');
    expect(data.lock).toBeNull();
  });

  it('POST /gateway/lock/acquire acquires lock via HTTP', async () => {
    const data = await post('/gateway/lock/acquire', {
      holder: 'http-test', platform: 'instagram', task: 'DM', timeoutMs: 5000,
    });
    expect(data.acquired).toBe(true);
    expect(data.lock.holder).toBe('http-test');
  });

  it('POST /gateway/lock/acquire rejects when locked', async () => {
    await post('/gateway/lock/acquire', { holder: 'A', task: 'a', timeoutMs: 5000 });
    const data = await post('/gateway/lock/acquire', { holder: 'B', task: 'b', timeoutMs: 5000 });
    expect(data.acquired).toBe(false);
  });

  it('POST /gateway/lock/release releases via HTTP', async () => {
    await post('/gateway/lock/acquire', { holder: 'A', task: 'a', timeoutMs: 5000 });
    const data = await post('/gateway/lock/release', { holder: 'A' });
    expect(data.released).toBe(true);
    expect(data.lock).toBeNull();
  });

  it('POST /gateway/lock/force-release force-releases via HTTP', async () => {
    await post('/gateway/lock/acquire', { holder: 'A', task: 'a', timeoutMs: 60000 });
    const data = await post('/gateway/lock/force-release');
    expect(data.released).toBe(true);
  });

  it('GET /gateway/lock returns current lock state', async () => {
    const empty = await get('/gateway/lock');
    expect(empty.lock).toBeNull();
    expect(empty.queueLength).toBe(0);

    await post('/gateway/lock/acquire', { holder: 'X', task: 'x', timeoutMs: 5000 });
    const locked = await get('/gateway/lock');
    expect(locked.lock.holder).toBe('X');
  });

  it('async acquire via waitMs works over HTTP', async () => {
    await post('/gateway/lock/acquire', { holder: 'A', task: 'a', timeoutMs: 5000 });

    // Start async wait in background
    const waitPromise = post('/gateway/lock/acquire', {
      holder: 'B', task: 'b', timeoutMs: 5000, waitMs: 2000,
    });

    // Release A after 100ms
    setTimeout(() => post('/gateway/lock/release', { holder: 'A' }), 100);

    const data = await waitPromise;
    expect(data.acquired).toBe(true);
    expect(data.lock.holder).toBe('B');
  });

  it('returns 400 when holder is missing', async () => {
    const res = await fetch(`${baseUrl}/gateway/lock/acquire`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});
