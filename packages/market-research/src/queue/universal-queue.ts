/**
 * Universal Task Queue
 *
 * Platform-agnostic, task-agnostic job queue with:
 *   - Priority-based ordering (critical > high > medium > low)
 *   - Scheduled execution (run at future time)
 *   - Persistent state (survives restarts)
 *   - Worker registry (route tasks to handlers by pattern match)
 *   - Per-task webhooks (notify caller on completion)
 *   - Rate limiting per task-type or platform
 *   - Retry with backoff
 *   - Automatic processing loop
 *
 * Task types are dot-separated strings. Workers register patterns:
 *   "research.*"      — matches research.search, research.niche, etc.
 *   "feedback.*"      — matches feedback.checkback, feedback.analyze
 *   "comment.twitter"  — matches exactly
 *   "*"               — matches everything (catch-all)
 *
 * Any server can:
 *   POST /api/queue/submit     — submit a task
 *   GET  /api/queue/:id        — check status
 *   GET  /api/queue            — list tasks
 *   POST /api/queue/cancel/:id — cancel
 *   POST /api/queue/workers    — register a worker (URL-based or local)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as http from 'http';
import * as https from 'https';

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export type TaskPriority = 'critical' | 'high' | 'medium' | 'low';
export type TaskStatus = 'queued' | 'scheduled' | 'running' | 'completed' | 'failed' | 'cancelled' | 'retrying';

const PRIORITY_ORDER: Record<TaskPriority, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export interface Task {
  id: string;
  type: string;              // e.g. "research.search", "feedback.checkback", "comment.post", "dm.send"
  platform?: string;          // e.g. "twitter", "tiktok", "instagram" — optional
  priority: TaskPriority;
  status: TaskStatus;
  payload: Record<string, any>;
  result?: any;
  error?: string;

  // Scheduling
  scheduledFor?: string;      // ISO timestamp — run at this time (null = immediate)
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;

  // Retry
  retries: number;
  maxRetries: number;
  retryDelayMs: number;       // base delay, multiplied by retry count

  // Notifications
  webhookUrl?: string;        // POST result to this URL on completion
  callbackId?: string;        // correlate with caller's internal ID

  // Metadata
  submittedBy?: string;       // which server/service submitted this
  tags?: string[];
  notes?: string;

  // Worker assignment
  assignedWorker?: string;
}

export interface Worker {
  id: string;
  name: string;
  type: 'local' | 'remote';
  url?: string;               // for remote workers — POST task to this URL
  taskPatterns: string[];     // glob patterns: "research.*", "comment.*", "*"
  platforms?: string[];       // optional platform filter
  maxConcurrent: number;
  currentLoad: number;
  status: 'idle' | 'busy' | 'offline';
  registeredAt: string;
  lastHeartbeat?: string;
  totalProcessed: number;
  totalFailed: number;
  handler?: (task: Task) => Promise<any>;  // for local workers
}

export interface RateLimit {
  key: string;                // e.g. "research.*", "platform:twitter", "comment.post"
  maxPerHour: number;
  maxPerDay: number;
  currentHour: number;
  currentDay: number;
  hourResetAt: string;
  dayResetAt: string;
}

export interface QueueConfig {
  dataDir: string;
  processIntervalMs: number;
  maxConcurrentTasks: number;
  defaultMaxRetries: number;
  defaultRetryDelayMs: number;
  defaultPriority: TaskPriority;
  staleTaskTimeoutMs: number;  // kill tasks running longer than this
}

export const DEFAULT_QUEUE_CONFIG: QueueConfig = {
  dataDir: path.join(os.homedir(), '.task-queue'),
  processIntervalMs: 5000,
  maxConcurrentTasks: 1,       // Safari is single-threaded
  defaultMaxRetries: 2,
  defaultRetryDelayMs: 5000,
  defaultPriority: 'medium',
  staleTaskTimeoutMs: 5 * 60 * 1000,
};

// ═══════════════════════════════════════════════════════════════
// UniversalTaskQueue
// ═══════════════════════════════════════════════════════════════

export class UniversalTaskQueue {
  private config: QueueConfig;
  private tasks: Task[] = [];
  private workers: Worker[] = [];
  private rateLimits: RateLimit[] = [];
  private processing = false;
  private processInterval: ReturnType<typeof setInterval> | null = null;
  private eventListeners: Map<string, Array<(task: Task) => void>> = new Map();

  private tasksFile: string;
  private workersFile: string;
  private rateLimitsFile: string;

  constructor(config: Partial<QueueConfig> = {}) {
    this.config = { ...DEFAULT_QUEUE_CONFIG, ...config };
    this.tasksFile = path.join(this.config.dataDir, 'tasks.json');
    this.workersFile = path.join(this.config.dataDir, 'workers.json');
    this.rateLimitsFile = path.join(this.config.dataDir, 'rate-limits.json');
    this.ensureDir();
    this.load();
  }

  private ensureDir(): void {
    if (!fs.existsSync(this.config.dataDir)) fs.mkdirSync(this.config.dataDir, { recursive: true });
  }

  // ─── Persistence ───────────────────────────────────────────

  private load(): void {
    try { if (fs.existsSync(this.tasksFile)) this.tasks = JSON.parse(fs.readFileSync(this.tasksFile, 'utf-8')); } catch {}
    try {
      if (fs.existsSync(this.workersFile)) {
        const loaded = JSON.parse(fs.readFileSync(this.workersFile, 'utf-8')) as Worker[];
        // Restore remote workers only (local handlers can't be serialized)
        this.workers = loaded.filter(w => w.type === 'remote');
      }
    } catch {}
    try { if (fs.existsSync(this.rateLimitsFile)) this.rateLimits = JSON.parse(fs.readFileSync(this.rateLimitsFile, 'utf-8')); } catch {}

    // Reset any tasks stuck in "running" from a crash
    for (const task of this.tasks) {
      if (task.status === 'running') {
        task.status = 'queued';
        task.assignedWorker = undefined;
        task.startedAt = undefined;
      }
    }

    // Cancel any queued Safari/Medium tasks that were pending from a previous session.
    // These should never auto-execute on boot — a browser takeover requires explicit intent.
    const SAFARI_TASK_PREFIXES = ['medium.', 'blog.', 'comment.', 'dm.', 'scrape.'];
    let cancelledCount = 0;
    for (const task of this.tasks) {
      if (task.status === 'queued' || task.status === 'scheduled' || task.status === 'retrying') {
        const isSafariTask = SAFARI_TASK_PREFIXES.some(prefix => task.type.startsWith(prefix));
        if (isSafariTask) {
          task.status = 'cancelled';
          task.completedAt = new Date().toISOString();
          task.error = 'Cancelled on restart — Safari tasks require explicit trigger';
          cancelledCount++;
        }
      }
    }
    if (cancelledCount > 0) {
      console.log(`[Queue] ⚠️  Cancelled ${cancelledCount} stale Safari task(s) from previous session`);
    }
    this.saveTasks();
  }

  private saveTasks(): void {
    fs.writeFileSync(this.tasksFile, JSON.stringify(this.tasks, null, 2));
  }

  private saveWorkers(): void {
    // Only persist remote workers
    const remote = this.workers.filter(w => w.type === 'remote');
    fs.writeFileSync(this.workersFile, JSON.stringify(remote, null, 2));
  }

  private saveRateLimits(): void {
    fs.writeFileSync(this.rateLimitsFile, JSON.stringify(this.rateLimits, null, 2));
  }

  // ─── Event System ──────────────────────────────────────────

  on(event: string, listener: (task: Task) => void): void {
    const listeners = this.eventListeners.get(event) || [];
    listeners.push(listener);
    this.eventListeners.set(event, listeners);
  }

  private emit(event: string, task: Task): void {
    const listeners = this.eventListeners.get(event) || [];
    for (const l of listeners) { try { l(task); } catch {} }
  }

  // ─── Submit Task ───────────────────────────────────────────

  submit(opts: {
    type: string;
    payload: Record<string, any>;
    platform?: string;
    priority?: TaskPriority;
    scheduledFor?: string;
    maxRetries?: number;
    retryDelayMs?: number;
    webhookUrl?: string;
    callbackId?: string;
    submittedBy?: string;
    tags?: string[];
    notes?: string;
  }): Task {
    const task: Task = {
      id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: opts.type,
      platform: opts.platform,
      priority: opts.priority || this.config.defaultPriority,
      status: opts.scheduledFor ? 'scheduled' : 'queued',
      payload: opts.payload,
      scheduledFor: opts.scheduledFor,
      createdAt: new Date().toISOString(),
      retries: 0,
      maxRetries: opts.maxRetries ?? this.config.defaultMaxRetries,
      retryDelayMs: opts.retryDelayMs ?? this.config.defaultRetryDelayMs,
      webhookUrl: opts.webhookUrl,
      callbackId: opts.callbackId,
      submittedBy: opts.submittedBy,
      tags: opts.tags,
      notes: opts.notes,
    };

    this.tasks.push(task);
    this.saveTasks();
    this.emit('task.submitted', task);
    console.log(`[Queue] Submitted: ${task.id} (${task.type}${task.platform ? ':' + task.platform : ''}) [${task.priority}]`);
    return task;
  }

  // ─── Cancel Task ───────────────────────────────────────────

  cancel(taskId: string): Task | null {
    const task = this.tasks.find(t => t.id === taskId);
    if (!task) return null;
    if (task.status === 'completed' || task.status === 'cancelled') return task;
    task.status = 'cancelled';
    task.completedAt = new Date().toISOString();
    this.saveTasks();
    this.emit('task.cancelled', task);
    return task;
  }

  // ─── Get Task ──────────────────────────────────────────────

  getTask(taskId: string): Task | undefined {
    return this.tasks.find(t => t.id === taskId);
  }

  // ─── List Tasks ────────────────────────────────────────────

  listTasks(filters?: {
    status?: TaskStatus;
    type?: string;
    platform?: string;
    limit?: number;
    submittedBy?: string;
  }): Task[] {
    let result = [...this.tasks];
    if (filters?.status) result = result.filter(t => t.status === filters.status);
    if (filters?.type) result = result.filter(t => this.matchPattern(t.type, filters.type!));
    if (filters?.platform) result = result.filter(t => t.platform === filters.platform);
    if (filters?.submittedBy) result = result.filter(t => t.submittedBy === filters.submittedBy);
    result.sort((a, b) => {
      // Running first, then by priority, then by creation time
      if (a.status === 'running' && b.status !== 'running') return -1;
      if (b.status === 'running' && a.status !== 'running') return 1;
      const pa = PRIORITY_ORDER[a.priority] ?? 3;
      const pb = PRIORITY_ORDER[b.priority] ?? 3;
      if (pa !== pb) return pa - pb;
      return a.createdAt.localeCompare(b.createdAt);
    });
    if (filters?.limit) result = result.slice(0, filters.limit);
    return result;
  }

  // ─── Register Worker ───────────────────────────────────────

  registerWorker(opts: {
    name: string;
    type?: 'local' | 'remote';
    url?: string;
    taskPatterns: string[];
    platforms?: string[];
    maxConcurrent?: number;
    handler?: (task: Task) => Promise<any>;
  }): Worker {
    const worker: Worker = {
      id: `worker_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: opts.name,
      type: opts.type || (opts.handler ? 'local' : 'remote'),
      url: opts.url,
      taskPatterns: opts.taskPatterns,
      platforms: opts.platforms,
      maxConcurrent: opts.maxConcurrent || 1,
      currentLoad: 0,
      status: 'idle',
      registeredAt: new Date().toISOString(),
      totalProcessed: 0,
      totalFailed: 0,
      handler: opts.handler,
    };

    this.workers.push(worker);
    this.saveWorkers();
    console.log(`[Queue] Worker registered: ${worker.name} (${worker.taskPatterns.join(', ')})`);
    return worker;
  }

  removeWorker(workerId: string): boolean {
    const idx = this.workers.findIndex(w => w.id === workerId);
    if (idx === -1) return false;
    this.workers.splice(idx, 1);
    this.saveWorkers();
    return true;
  }

  listWorkers(): Worker[] {
    return this.workers.map(w => ({ ...w, handler: undefined }));
  }

  // ─── Rate Limiting ─────────────────────────────────────────

  setRateLimit(key: string, maxPerHour: number, maxPerDay: number): void {
    const now = new Date();
    const existing = this.rateLimits.find(r => r.key === key);
    if (existing) {
      existing.maxPerHour = maxPerHour;
      existing.maxPerDay = maxPerDay;
    } else {
      this.rateLimits.push({
        key,
        maxPerHour,
        maxPerDay,
        currentHour: 0,
        currentDay: 0,
        hourResetAt: new Date(now.getTime() + 3600000).toISOString(),
        dayResetAt: new Date(now.getTime() + 86400000).toISOString(),
      });
    }
    this.saveRateLimits();
  }

  private checkRateLimit(task: Task): { allowed: boolean; reason?: string } {
    const now = new Date();
    for (const limit of this.rateLimits) {
      const matches = this.matchPattern(task.type, limit.key)
        || (task.platform && limit.key === `platform:${task.platform}`);
      if (!matches) continue;

      // Reset counters if needed
      if (now.toISOString() >= limit.hourResetAt) {
        limit.currentHour = 0;
        limit.hourResetAt = new Date(now.getTime() + 3600000).toISOString();
      }
      if (now.toISOString() >= limit.dayResetAt) {
        limit.currentDay = 0;
        limit.dayResetAt = new Date(now.getTime() + 86400000).toISOString();
      }

      if (limit.currentHour >= limit.maxPerHour) return { allowed: false, reason: `Rate limit: ${limit.key} (${limit.maxPerHour}/hr)` };
      if (limit.currentDay >= limit.maxPerDay) return { allowed: false, reason: `Rate limit: ${limit.key} (${limit.maxPerDay}/day)` };
    }
    return { allowed: true };
  }

  private incrementRateLimit(task: Task): void {
    for (const limit of this.rateLimits) {
      const matches = this.matchPattern(task.type, limit.key)
        || (task.platform && limit.key === `platform:${task.platform}`);
      if (matches) {
        limit.currentHour++;
        limit.currentDay++;
      }
    }
    this.saveRateLimits();
  }

  // ─── Pattern Matching ──────────────────────────────────────

  private matchPattern(value: string, pattern: string): boolean {
    if (pattern === '*') return true;
    if (pattern === value) return true;
    if (pattern.endsWith('.*')) {
      const prefix = pattern.slice(0, -2);
      return value.startsWith(prefix + '.') || value === prefix;
    }
    return false;
  }

  // ─── Find Worker for Task ──────────────────────────────────

  private findWorker(task: Task): Worker | null {
    for (const worker of this.workers) {
      if (worker.currentLoad >= worker.maxConcurrent) continue;
      if (worker.status === 'offline') continue;

      const typeMatch = worker.taskPatterns.some(p => this.matchPattern(task.type, p));
      if (!typeMatch) continue;

      if (task.platform && worker.platforms && worker.platforms.length > 0) {
        if (!worker.platforms.includes(task.platform)) continue;
      }

      return worker;
    }
    return null;
  }

  // ─── Process Queue ─────────────────────────────────────────

  private async processNext(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    try {
      const now = new Date().toISOString();
      const runningCount = this.tasks.filter(t => t.status === 'running').length;
      if (runningCount >= this.config.maxConcurrentTasks) return;

      // Check for stale tasks
      for (const task of this.tasks.filter(t => t.status === 'running')) {
        if (task.startedAt) {
          const elapsed = Date.now() - new Date(task.startedAt).getTime();
          if (elapsed > this.config.staleTaskTimeoutMs) {
            console.log(`[Queue] Stale task ${task.id} (${elapsed}ms) — marking failed`);
            task.status = 'failed';
            task.error = 'Task timed out';
            task.completedAt = new Date().toISOString();
            this.emit('task.failed', task);
          }
        }
      }

      // Promote scheduled tasks that are due
      for (const task of this.tasks.filter(t => t.status === 'scheduled')) {
        if (task.scheduledFor && task.scheduledFor <= now) {
          task.status = 'queued';
        }
      }

      // Find next queued task by priority
      const candidates = this.tasks
        .filter(t => t.status === 'queued')
        .sort((a, b) => {
          const pa = PRIORITY_ORDER[a.priority] ?? 3;
          const pb = PRIORITY_ORDER[b.priority] ?? 3;
          if (pa !== pb) return pa - pb;
          return a.createdAt.localeCompare(b.createdAt);
        });

      for (const task of candidates) {
        if (this.tasks.filter(t => t.status === 'running').length >= this.config.maxConcurrentTasks) break;

        // Rate limit check
        const rateCheck = this.checkRateLimit(task);
        if (!rateCheck.allowed) {
          console.log(`[Queue] ${task.id} rate limited: ${rateCheck.reason}`);
          continue;
        }

        // Find a worker
        const worker = this.findWorker(task);
        if (!worker) continue;

        // Execute
        task.status = 'running';
        task.startedAt = new Date().toISOString();
        task.assignedWorker = worker.id;
        worker.currentLoad++;
        worker.status = 'busy';
        this.saveTasks();
        this.emit('task.started', task);

        // Run async (don't block the loop)
        this.executeTask(task, worker).catch(() => {});
      }

      this.saveTasks();
    } finally {
      this.processing = false;
    }
  }

  // ─── Execute Task ──────────────────────────────────────────

  private async executeTask(task: Task, worker: Worker): Promise<void> {
    const startMs = Date.now();
    try {
      let result: any;

      if (worker.type === 'local' && worker.handler) {
        result = await worker.handler(task);
      } else if (worker.type === 'remote' && worker.url) {
        result = await this.callRemoteWorker(worker.url, task);
      } else {
        throw new Error('Worker has no handler or URL');
      }

      task.status = 'completed';
      task.result = result;
      task.completedAt = new Date().toISOString();
      task.durationMs = Date.now() - startMs;
      worker.totalProcessed++;
      this.incrementRateLimit(task);
      this.emit('task.completed', task);
      console.log(`[Queue] ✅ ${task.id} completed (${task.durationMs}ms)`);

    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      task.retries++;

      if (task.retries <= task.maxRetries) {
        task.status = 'retrying';
        task.error = error;
        const delay = task.retryDelayMs * task.retries;
        task.scheduledFor = new Date(Date.now() + delay).toISOString();
        task.status = 'scheduled';
        console.log(`[Queue] ⟳ ${task.id} retry ${task.retries}/${task.maxRetries} in ${delay}ms`);
      } else {
        task.status = 'failed';
        task.error = error;
        task.completedAt = new Date().toISOString();
        task.durationMs = Date.now() - startMs;
        worker.totalFailed++;
        this.emit('task.failed', task);
        console.log(`[Queue] ❌ ${task.id} failed: ${error}`);
      }
    } finally {
      worker.currentLoad = Math.max(0, worker.currentLoad - 1);
      worker.status = worker.currentLoad > 0 ? 'busy' : 'idle';
      task.assignedWorker = undefined;
      this.saveTasks();
      this.saveWorkers();

      // Fire per-task webhook
      if (task.webhookUrl && (task.status === 'completed' || task.status === 'failed')) {
        this.fireTaskWebhook(task).catch(() => {});
      }
    }
  }

  // ─── Remote Worker Call ────────────────────────────────────

  private async callRemoteWorker(workerUrl: string, task: Task): Promise<any> {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({ task: { id: task.id, type: task.type, platform: task.platform, payload: task.payload, priority: task.priority } });
      const url = new URL(workerUrl);
      const options = {
        method: 'POST',
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      };
      const transport = url.protocol === 'https:' ? https : http;
      const req = transport.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (res.statusCode && res.statusCode >= 400) reject(new Error(parsed.error || `HTTP ${res.statusCode}`));
            else resolve(parsed);
          } catch { resolve(data); }
        });
      });
      req.on('error', reject);
      req.setTimeout(this.config.staleTaskTimeoutMs, () => { req.destroy(); reject(new Error('Worker timeout')); });
      req.write(body);
      req.end();
    });
  }

  // ─── Per-task Webhook ──────────────────────────────────────

  private async fireTaskWebhook(task: Task): Promise<void> {
    if (!task.webhookUrl) return;
    try {
      const body = JSON.stringify({
        event: `task.${task.status}`,
        timestamp: new Date().toISOString(),
        task: { id: task.id, type: task.type, platform: task.platform, status: task.status, result: task.result, error: task.error, durationMs: task.durationMs, callbackId: task.callbackId },
      });
      const url = new URL(task.webhookUrl);
      const transport = url.protocol === 'https:' ? https : http;
      const options = {
        method: 'POST',
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'X-Webhook-Event': `task.${task.status}` },
      };
      await new Promise<void>((resolve) => {
        const req = transport.request(options, (res) => { res.resume(); resolve(); });
        req.on('error', () => resolve());
        req.setTimeout(5000, () => { req.destroy(); resolve(); });
        req.write(body);
        req.end();
      });
    } catch {}
  }

  // ─── Queue Control ─────────────────────────────────────────

  start(): void {
    if (this.processInterval) return;
    this.processInterval = setInterval(() => this.processNext(), this.config.processIntervalMs);
    console.log(`[Queue] Started — processing every ${this.config.processIntervalMs / 1000}s`);
    // NOTE: No immediate processNext() call — first tick happens after processIntervalMs.
    // This prevents a burst of Safari tasks immediately after an external server calls start().
  }

  stop(): void {
    if (this.processInterval) {
      clearInterval(this.processInterval);
      this.processInterval = null;
      console.log('[Queue] Stopped');
    }
  }

  isRunning(): boolean { return !!this.processInterval; }

  // ─── Cleanup ───────────────────────────────────────────────

  cleanup(olderThanMs = 7 * 24 * 60 * 60 * 1000): number {
    const cutoff = new Date(Date.now() - olderThanMs).toISOString();
    const before = this.tasks.length;
    this.tasks = this.tasks.filter(t =>
      t.status === 'queued' || t.status === 'scheduled' || t.status === 'running' ||
      (t.completedAt && t.completedAt > cutoff)
    );
    const removed = before - this.tasks.length;
    if (removed > 0) this.saveTasks();
    return removed;
  }

  // ─── Stats ─────────────────────────────────────────────────

  getStats(): Record<string, any> {
    const byStatus: Record<string, number> = {};
    const byType: Record<string, number> = {};
    const byPlatform: Record<string, number> = {};

    for (const t of this.tasks) {
      byStatus[t.status] = (byStatus[t.status] || 0) + 1;
      byType[t.type] = (byType[t.type] || 0) + 1;
      if (t.platform) byPlatform[t.platform] = (byPlatform[t.platform] || 0) + 1;
    }

    return {
      total: this.tasks.length,
      byStatus,
      byType,
      byPlatform,
      workers: this.workers.length,
      workersActive: this.workers.filter(w => w.status !== 'offline').length,
      rateLimits: this.rateLimits.length,
      running: this.isRunning(),
      processIntervalMs: this.config.processIntervalMs,
      maxConcurrent: this.config.maxConcurrentTasks,
    };
  }
}
