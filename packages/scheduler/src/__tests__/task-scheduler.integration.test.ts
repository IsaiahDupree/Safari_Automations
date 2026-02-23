/**
 * Task Scheduler — Real Integration Tests (no mocks)
 *
 * Exercises the actual TaskScheduler against real file I/O,
 * real event emitters, and real task execution for the simple
 * built-in task types (dm, comment, discovery, sync).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { TaskScheduler } from '../task-scheduler.js';

// Each test gets its own temp file so there's zero cross-test interference
function tmpStatePath(): string {
  return path.join(os.tmpdir(), `scheduler-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
}

function createScheduler(overrides: Record<string, unknown> = {}): TaskScheduler {
  return new TaskScheduler({
    persistPath: tmpStatePath(),
    checkIntervalMs: 999999,   // no auto-processing during tests
    maxConcurrentTasks: 2,
    defaultRetries: 3,
    enableSoraMonitor: false,  // don't launch real sora credit checks
    ...overrides,
  });
}

describe('TaskScheduler (integration)', () => {
  let scheduler: TaskScheduler;
  let statePath: string;

  beforeEach(() => {
    statePath = tmpStatePath();
    scheduler = new TaskScheduler({
      persistPath: statePath,
      checkIntervalMs: 999999,
      maxConcurrentTasks: 2,
      defaultRetries: 3,
      enableSoraMonitor: false,
    });
  });

  afterEach(() => {
    scheduler.stop();
    try { fs.unlinkSync(statePath); } catch {}
  });

  // ─── Queue Management ──────────────────────────────────────

  describe('Queue Management', () => {
    it('schedules a task and assigns an ID', () => {
      const id = scheduler.schedule({ type: 'comment', name: 'Test Comment' });
      expect(id).toMatch(/^task_\d+_/);
      expect(scheduler.getQueue()).toHaveLength(1);
      expect(scheduler.getQueue()[0].name).toBe('Test Comment');
    });

    it('defaults priority to 3', () => {
      scheduler.schedule({ type: 'dm', name: 'Default Priority' });
      expect(scheduler.getQueue()[0].priority).toBe(3);
    });

    it('defaults retries from config', () => {
      scheduler.schedule({ type: 'dm', name: 'Retries' });
      expect(scheduler.getQueue()[0].maxRetries).toBe(3);
    });

    it('honours custom maxRetries', () => {
      scheduler.schedule({ type: 'dm', name: 'Custom', maxRetries: 7 });
      expect(scheduler.getQueue()[0].maxRetries).toBe(7);
    });

    it('sets initial status to pending', () => {
      scheduler.schedule({ type: 'comment', name: 'New' });
      expect(scheduler.getQueue()[0].status).toBe('pending');
    });

    it('defaults scheduledFor to approximately now', () => {
      const before = Date.now();
      scheduler.schedule({ type: 'comment', name: 'Now' });
      const after = Date.now();
      const t = scheduler.getQueue()[0].scheduledFor.getTime();
      expect(t).toBeGreaterThanOrEqual(before);
      expect(t).toBeLessThanOrEqual(after);
    });

    it('allows scheduling for a future time', () => {
      const future = new Date(Date.now() + 60000);
      scheduler.schedule({ type: 'dm', name: 'Future', scheduledFor: future });
      expect(scheduler.getQueue()[0].scheduledFor.getTime()).toBe(future.getTime());
    });
  });

  // ─── Priority Ordering ─────────────────────────────────────

  describe('Priority Ordering', () => {
    it('inserts in priority order (lower number = higher priority)', () => {
      scheduler.schedule({ type: 'dm', name: 'Low', priority: 5 });
      scheduler.schedule({ type: 'dm', name: 'High', priority: 1 });
      scheduler.schedule({ type: 'dm', name: 'Mid', priority: 3 });

      expect(scheduler.getQueue().map(t => t.name)).toEqual(['High', 'Mid', 'Low']);
    });

    it('preserves FIFO for equal priority', () => {
      scheduler.schedule({ type: 'dm', name: 'A', priority: 3 });
      scheduler.schedule({ type: 'dm', name: 'B', priority: 3 });
      scheduler.schedule({ type: 'dm', name: 'C', priority: 3 });
      expect(scheduler.getQueue().map(t => t.name)).toEqual(['A', 'B', 'C']);
    });

    it('inserts urgent task before lower-priority ones', () => {
      scheduler.schedule({ type: 'dm', name: 'P3-1', priority: 3 });
      scheduler.schedule({ type: 'dm', name: 'P3-2', priority: 3 });
      scheduler.schedule({ type: 'dm', name: 'URGENT', priority: 1 });
      expect(scheduler.getQueue()[0].name).toBe('URGENT');
    });
  });

  // ─── Cancel ────────────────────────────────────────────────

  describe('Cancel', () => {
    it('removes task from queue', () => {
      const id = scheduler.schedule({ type: 'dm', name: 'Kill Me' });
      expect(scheduler.cancel(id)).toBe(true);
      expect(scheduler.getQueue()).toHaveLength(0);
    });

    it('moves cancelled task to completed list with status cancelled', () => {
      const id = scheduler.schedule({ type: 'dm', name: 'Kill Me' });
      scheduler.cancel(id);
      const c = scheduler.getCompleted();
      expect(c).toHaveLength(1);
      expect(c[0].status).toBe('cancelled');
    });

    it('returns false for non-existent task', () => {
      expect(scheduler.cancel('fake_id')).toBe(false);
    });
  });

  // ─── Lifecycle (start / stop / pause / resume) ─────────────

  describe('Lifecycle', () => {
    it('reports isRunning correctly', () => {
      expect(scheduler.getStatus().isRunning).toBe(false);
      scheduler.start();
      expect(scheduler.getStatus().isRunning).toBe(true);
      scheduler.stop();
      expect(scheduler.getStatus().isRunning).toBe(false);
    });

    it('does not double-start', () => {
      scheduler.start();
      scheduler.start(); // should be a no-op
      expect(scheduler.getStatus().isRunning).toBe(true);
      scheduler.stop();
    });

    it('pauses and resumes', () => {
      scheduler.start();
      scheduler.pause();
      expect(scheduler.getStatus().isRunning).toBe(true); // paused ≠ stopped
      scheduler.resume();
      expect(scheduler.getStatus().isRunning).toBe(true);
    });

    it('resume on a stopped scheduler starts it', () => {
      expect(scheduler.getStatus().isRunning).toBe(false);
      scheduler.resume();
      expect(scheduler.getStatus().isRunning).toBe(true);
    });
  });

  // ─── Events (real EventEmitter) ────────────────────────────

  describe('Events', () => {
    it('emits taskScheduled with the task object', () => {
      const received: any[] = [];
      scheduler.on('taskScheduled', (task) => received.push(task));
      scheduler.schedule({ type: 'comment', name: 'Evt' });
      expect(received).toHaveLength(1);
      expect(received[0].name).toBe('Evt');
    });

    it('emits taskStarted and taskCompleted on real execution', async () => {
      const events: string[] = [];
      scheduler.on('taskStarted', () => events.push('started'));
      scheduler.on('taskCompleted', () => events.push('completed'));

      scheduler.schedule({ type: 'dm', name: 'DM Run', platform: 'instagram' });

      // Trigger processQueue manually (private — cast)
      await (scheduler as any).processQueue();

      expect(events).toContain('started');
      expect(events).toContain('completed');
    });
  });

  // ─── Real Task Execution ───────────────────────────────────

  describe('Task Execution (real)', () => {
    it('executes a dm task and moves it to completed', async () => {
      scheduler.schedule({ type: 'dm', name: 'Real DM', platform: 'instagram' });
      await (scheduler as any).processQueue();

      expect(scheduler.getQueue()).toHaveLength(0);
      expect(scheduler.getRunning()).toHaveLength(0);
      const c = scheduler.getCompleted();
      expect(c).toHaveLength(1);
      expect(c[0].status).toBe('completed');
      expect(c[0].name).toBe('Real DM');
    });

    it('executes a comment task', async () => {
      scheduler.schedule({ type: 'comment', name: 'Real Comment' });
      await (scheduler as any).processQueue();
      expect(scheduler.getCompleted()[0].status).toBe('completed');
    });

    it('executes a discovery task', async () => {
      scheduler.schedule({ type: 'discovery', name: 'Real Discovery' });
      await (scheduler as any).processQueue();
      expect(scheduler.getCompleted()[0].status).toBe('completed');
    });

    it('executes a sync task', async () => {
      scheduler.schedule({ type: 'sync', name: 'Real Sync' });
      await (scheduler as any).processQueue();
      expect(scheduler.getCompleted()[0].status).toBe('completed');
    });

    it('records startedAt and completedAt as real Dates', async () => {
      const before = Date.now();
      scheduler.schedule({ type: 'dm', name: 'Timestamps', platform: 'twitter' });
      await (scheduler as any).processQueue();
      const after = Date.now();

      const t = scheduler.getCompleted()[0];
      expect(t.startedAt).toBeInstanceOf(Date);
      expect(t.completedAt).toBeInstanceOf(Date);
      expect(t.startedAt!.getTime()).toBeGreaterThanOrEqual(before);
      expect(t.completedAt!.getTime()).toBeLessThanOrEqual(after);
    });
  });

  // ─── Concurrency ───────────────────────────────────────────

  describe('Concurrency', () => {
    it('respects maxConcurrentTasks', () => {
      const s = createScheduler({ maxConcurrentTasks: 1 });
      // Simulate a running task
      (s as any).running.push({ id: 'fake', name: 'Running', status: 'running' });
      s.schedule({ type: 'comment', name: 'Blocked' });

      // processQueue should NOT pick up the new task
      (s as any).processQueue();
      expect(s.getQueue()).toHaveLength(1);
      expect(s.getRunning()).toHaveLength(1);
      s.stop();
    });

    it('runs a second task once first finishes (maxConcurrent=1)', async () => {
      const s = new TaskScheduler({
        persistPath: tmpStatePath(),
        checkIntervalMs: 999999,
        maxConcurrentTasks: 1,
        defaultRetries: 3,
        enableSoraMonitor: false,
      });

      s.schedule({ type: 'dm', name: 'First', platform: 'instagram' });
      s.schedule({ type: 'comment', name: 'Second' });

      // Execute first
      await (s as any).processQueue();
      expect(s.getCompleted().map((t: any) => t.name)).toContain('First');

      // Now second should be runnable
      await (s as any).processQueue();
      expect(s.getCompleted().map((t: any) => t.name)).toContain('Second');
      s.stop();
    });
  });

  // ─── Dependencies ──────────────────────────────────────────

  describe('Dependencies', () => {
    it('skips a task whose dependency has not completed', () => {
      scheduler.schedule({
        type: 'comment',
        name: 'Dependent',
        dependencies: ['nonexistent_dep'],
      });
      const next = (scheduler as any).findNextReadyTask();
      expect(next).toBeNull();
    });

    it('runs a task once its dependency completes', async () => {
      const depId = scheduler.schedule({ type: 'dm', name: 'Dep', platform: 'instagram' });
      scheduler.schedule({ type: 'comment', name: 'Waiter', dependencies: [depId] });

      // Before dep completes
      const before = (scheduler as any).findNextReadyTask();
      expect(before.name).toBe('Dep'); // only dep is ready

      // Execute dep
      await (scheduler as any).processQueue();
      expect(scheduler.getCompleted().some((t: any) => t.id === depId)).toBe(true);

      // Now waiter should be ready
      const after = (scheduler as any).findNextReadyTask();
      expect(after?.name).toBe('Waiter');
    });
  });

  // ─── Quiet Hours ───────────────────────────────────────────

  describe('Quiet Hours', () => {
    it('detects quiet hours (same-day range)', () => {
      const hour = new Date().getHours();
      const s = createScheduler({
        quietHoursStart: hour,
        quietHoursEnd: (hour + 1) % 24,
      });
      expect((s as any).isQuietHours()).toBe(true);
      s.stop();
    });

    it('not quiet outside the range', () => {
      const hour = new Date().getHours();
      const s = createScheduler({
        quietHoursStart: (hour + 2) % 24,
        quietHoursEnd: (hour + 4) % 24,
      });
      // Only quiet if current hour falls in the offset range (it won't)
      expect((s as any).isQuietHours()).toBe(false);
      s.stop();
    });

    it('handles wrap-around quiet hours (e.g. 23–6)', () => {
      const hour = new Date().getHours();
      // Wrap-around range that includes current hour
      const s = createScheduler({
        quietHoursStart: hour,
        quietHoursEnd: (hour - 1 + 24) % 24,  // wraps around
      });
      expect((s as any).isQuietHours()).toBe(true);
      s.stop();
    });
  });

  // ─── State Persistence (real file I/O) ─────────────────────

  describe('State Persistence', () => {
    it('writes state file on schedule', () => {
      scheduler.schedule({ type: 'comment', name: 'Persist Test' });
      expect(fs.existsSync(statePath)).toBe(true);
      const data = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
      expect(data.queue).toHaveLength(1);
      expect(data.queue[0].name).toBe('Persist Test');
    });

    it('writes state file on cancel', () => {
      const id = scheduler.schedule({ type: 'dm', name: 'Cancel Persist' });
      scheduler.cancel(id);
      const data = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
      expect(data.queue).toHaveLength(0);
      expect(data.completed).toHaveLength(1);
      expect(data.completed[0].status).toBe('cancelled');
    });

    it('restores queue and completed from disk on construction', () => {
      // Schedule two tasks, cancel one
      scheduler.schedule({ type: 'comment', name: 'Alive' });
      const killId = scheduler.schedule({ type: 'dm', name: 'Dead' });
      scheduler.cancel(killId);
      scheduler.stop();

      // Create new scheduler reading same state file
      const s2 = new TaskScheduler({
        persistPath: statePath,
        checkIntervalMs: 999999,
        maxConcurrentTasks: 2,
        defaultRetries: 3,
        enableSoraMonitor: false,
      });

      expect(s2.getQueue()).toHaveLength(1);
      expect(s2.getQueue()[0].name).toBe('Alive');
      expect(s2.getQueue()[0].scheduledFor).toBeInstanceOf(Date);
      expect(s2.getQueue()[0].createdAt).toBeInstanceOf(Date);

      const completed = s2.getCompleted();
      expect(completed).toHaveLength(1);
      expect(completed[0].name).toBe('Dead');
      s2.stop();
    });

    it('rehydrates Date fields from serialised JSON strings', () => {
      const now = new Date();
      const state = {
        queue: [{
          id: 'task_rehydrate',
          type: 'dm',
          name: 'Rehydrate',
          priority: 3,
          scheduledFor: now.toISOString(),
          createdAt: now.toISOString(),
          status: 'pending',
          retryCount: 0,
          maxRetries: 3,
          payload: {},
        }],
        completed: [{
          id: 'task_done',
          type: 'comment',
          name: 'Done',
          priority: 3,
          scheduledFor: now.toISOString(),
          createdAt: now.toISOString(),
          startedAt: now.toISOString(),
          completedAt: now.toISOString(),
          status: 'completed',
          retryCount: 0,
          maxRetries: 3,
          payload: {},
        }],
      };
      fs.writeFileSync(statePath, JSON.stringify(state));

      const s2 = new TaskScheduler({
        persistPath: statePath,
        checkIntervalMs: 999999,
        enableSoraMonitor: false,
      });

      const q = s2.getQueue();
      expect(q[0].scheduledFor).toBeInstanceOf(Date);
      expect(q[0].createdAt).toBeInstanceOf(Date);

      const c = s2.getCompleted();
      expect(c[0].startedAt).toBeInstanceOf(Date);
      expect(c[0].completedAt).toBeInstanceOf(Date);
      s2.stop();
    });
  });

  // ─── Completed Tasks Cap ───────────────────────────────────

  describe('Completed Cap', () => {
    it('caps completed at 200 to prevent memory leak', async () => {
      // Pre-fill 199 completed tasks via direct access
      for (let i = 0; i < 199; i++) {
        (scheduler as any).completed.push({
          id: `old_${i}`, name: `Old ${i}`, status: 'completed', completedAt: new Date(),
        });
      }

      // Execute two more tasks to push past 200
      scheduler.schedule({ type: 'dm', name: 'Over 200 A', platform: 'instagram' });
      await (scheduler as any).processQueue();
      scheduler.schedule({ type: 'dm', name: 'Over 200 B', platform: 'twitter' });
      await (scheduler as any).processQueue();

      expect((scheduler as any).completed.length).toBeLessThanOrEqual(200);
    });
  });

  // ─── Status Reporting ──────────────────────────────────────

  describe('Status', () => {
    it('reports accurate queue and running counts', () => {
      scheduler.schedule({ type: 'dm', name: 'A' });
      scheduler.schedule({ type: 'comment', name: 'B' });
      const s = scheduler.getStatus();
      expect(s.tasksInQueue).toBe(2);
      expect(s.tasksRunning).toBe(0);
    });

    it('reports platforms', () => {
      const s = scheduler.getStatus();
      expect(s.platforms.length).toBeGreaterThan(0);
      expect(s.platforms.some(p => p.platform === 'instagram')).toBe(true);
    });
  });
});
