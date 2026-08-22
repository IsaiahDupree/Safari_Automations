/**
 * Sora Automation API Server — port 7070
 *
 * Async command-queue API consumed by actp-worker/safari_executor.py
 *
 * Endpoints:
 *   GET  /health                  — health check
 *   GET  /ready                   — readiness (is Sora tab claimed?)
 *   POST /v1/focus                — bring Safari to foreground
 *   GET  /v1/sora/usage           — credits/usage
 *   POST /v1/commands             — submit command → 202 + {command_id}
 *   GET  /v1/commands/:id         — poll status
 *   GET  /v1/commands             — list recent commands
 *   DELETE /v1/commands/:id       — cancel pending command
 *
 * WebSocket telemetry: ws://localhost:7071/v1/stream
 */

import 'dotenv/config';
import express, { Request, Response } from 'express';
import cors from 'cors';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';

// ─── Supabase logging ──────────────────────────────────────────────────────────
const SUPA_URL = process.env.SUPABASE_URL || 'https://ivhfuhxorppptyuofbgq.supabase.co';
const SUPA_KEY = process.env.SUPABASE_ANON_KEY || '';

async function logSoraCommand(cmd: import('../automation/types.js').Command): Promise<void> {
  if (!SUPA_KEY) return;
  try {
    await fetch(`${SUPA_URL}/rest/v1/sora_commands`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPA_KEY,
        'Authorization': `Bearer ${SUPA_KEY}`,
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({
        command_id: cmd.id,
        type: cmd.type,
        status: cmd.status,
        payload: cmd.payload,
        result: cmd.result,
        error: cmd.error,
        created_at: cmd.createdAt,
        started_at: cmd.startedAt,
        completed_at: cmd.completedAt,
      }),
    });
  } catch { /* non-fatal */ }
}

import { SafariDriver, getDefaultDriver } from '../automation/safari-driver.js';
import { TabCoordinator } from '../automation/tab-coordinator.js';
import { queue } from '../automation/command-queue.js';
import {
  SORA_PATTERN,
  SORA_URL,
  getSoraUsage,
  submitGeneration,
  waitForGeneration,
  downloadLatestVideo,
  removeWatermark,
} from '../automation/sora-operations.js';
import type { CommandPayload, CommandType, TelemetryEvent } from '../automation/types.js';

const execFileAsync = promisify(execFile);

async function requireSafariInteractivePermit(): Promise<void> {
  const clientPath = '../../../shared/safari-lane-client.js';
  const client = await import(clientPath) as {
    requireSafariLanePermit(mode: 'interactive'): Promise<unknown>;
  };
  await client.requireSafariLanePermit('interactive');
}

async function withSafariForegroundInput<T>(activateOwnedTab: () => Promise<void>, performInput: () => Promise<T>): Promise<T> {
  const clientPath = '../../../shared/safari-lane-client.js';
  const client = await import(clientPath) as { runSafariForegroundInput<T>(activateOwnedTab: () => Promise<void>, performInput: () => Promise<T>): Promise<T> };
  return client.runSafariForegroundInput(activateOwnedTab, performInput);
}

const PORT = parseInt(process.env.SORA_PORT || '7070', 10);
const WS_PORT = PORT + 1;
const SERVICE_NAME = 'sora-automation';
const OPEN_URL = SORA_URL;
const BROWSER_ENFORCER = '/Users/isaiahdupree/Documents/Software/Safari Automation/ops/browser-enforcer.py';

const app = express();
app.use(cors());
app.use(express.json());

// ─── Tab claim ────────────────────────────────────────────────────────────────

const activeCoordinators = new Map<string, TabCoordinator>();

interface EnforcerStatus {
  safari?: { root_pids?: number[] };
  state?: { cool_until?: { safari?: number } };
}

async function readEnforcerStatus(): Promise<EnforcerStatus> {
  const { stdout } = await execFileAsync(
    '/usr/bin/python3',
    [BROWSER_ENFORCER, 'status'],
    { timeout: 10_000, encoding: 'utf8' }
  );
  return JSON.parse(String(stdout)) as EnforcerStatus;
}

async function focusManagedSafari(): Promise<void> {
  await requireSafariInteractivePermit();
  const claim = await ensureTabClaim();
  if (!claim || claim.windowIndex !== 2 || !Number.isInteger(claim.windowId) || Number(claim.windowId) <= 0) {
    throw new Error('Sora focus requires a stable claimed Safari agent tab in Window 2');
  }
  let status = await readEnforcerStatus();
  let remaining = Math.max(
    0,
    Math.ceil(Number(status.state?.cool_until?.safari || 0) - Date.now() / 1000)
  );
  if (remaining > 0) {
    throw new Error(`Safari is in the enforced cooling window (${remaining}s remaining)`);
  }

  if ((status.safari?.root_pids?.length || 0) !== 1) {
    await execFileAsync(
      '/usr/bin/python3',
      [BROWSER_ENFORCER, 'ensure', 'safari'],
      { timeout: 30_000, encoding: 'utf8' }
    );
    status = await readEnforcerStatus();
    remaining = Math.max(
      0,
      Math.ceil(Number(status.state?.cool_until?.safari || 0) - Date.now() / 1000)
    );
    if (remaining > 0 || (status.safari?.root_pids?.length || 0) !== 1) {
      throw new Error('Managed Safari is unavailable after enforcer ensure');
    }
  }

  const activateScript = `
tell application "Safari"
  set agentWindow to first window whose id is ${claim.windowId}
  set agentTab to tab ${claim.tabIndex} of agentWindow
  activate
  set current tab of agentWindow to agentTab
  set index of agentWindow to 1
end tell
tell application "System Events"
  set frontmost of process "Safari" to true
end tell`;
  await withSafariForegroundInput(
    async () => {
      await execFileAsync('/usr/bin/osascript', ['-e', activateScript], { timeout: 5000, encoding: 'utf8' });
    },
    async () => undefined,
  );
}

async function ensureTabClaim(): Promise<{ windowId?: number; windowIndex: number; tabIndex: number } | null> {
  const claims = await TabCoordinator.listClaims();
  const myClaim = claims.find(c => c.service === SERVICE_NAME);
  if (myClaim) {
    getDefaultDriver().setTrackedTab(myClaim.windowIndex, myClaim.tabIndex, myClaim.windowId);
    return myClaim;
  }
  return null;
}

// ─── WebSocket telemetry ──────────────────────────────────────────────────────

const wsClients = new Set<WebSocket>();

function broadcastEvent(event: TelemetryEvent): void {
  const payload = JSON.stringify(event);
  for (const client of wsClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

const wss = new WebSocketServer({ port: WS_PORT });
wss.on('connection', (ws) => {
  wsClients.add(ws);
  ws.on('close', () => wsClients.delete(ws));
});

// ─── Command executor ─────────────────────────────────────────────────────────

async function executeCommand(commandId: string): Promise<void> {
  const cmd = queue.get(commandId);
  if (!cmd) return;

  const driver = getDefaultDriver();
  const emit = (type: TelemetryEvent['type'], data: Record<string, unknown> = {}) => {
    broadcastEvent({ type, commandId, timestamp: new Date().toISOString(), data });
  };

  queue.markRunning(commandId);
  emit('status.changed', { status: 'RUNNING' });

  let operationCoord: TabCoordinator | null = null;
  let operationHeartbeat: ReturnType<typeof setInterval> | null = null;
  let operationAgentId: string | null = null;

  try {
    const payload: CommandPayload = cmd.payload;

    if (cmd.type === 'sora.generate' || cmd.type === 'sora.generate.clean') {
      const autoId = `sora-auto-${Date.now()}`;
      operationAgentId = autoId;
      operationCoord = new TabCoordinator(autoId, SERVICE_NAME, PORT, SORA_PATTERN, OPEN_URL);
      activeCoordinators.set(autoId, operationCoord);
      const operationClaim = await operationCoord.beginOperation();
      driver.setTrackedTab(
        operationClaim.windowIndex,
        operationClaim.tabIndex,
        operationClaim.windowId,
      );
      operationHeartbeat = setInterval(() => {
        void operationCoord?.heartbeat().catch(() => {});
      }, 15_000);
    }

    // ── sora.generate ───────────────────────────────────────────────────────
    if (cmd.type === 'sora.generate' || cmd.type === 'sora.generate.clean') {
      if (!payload.prompt) throw new Error('payload.prompt is required for sora.generate');

      emit('progress', { message: 'Submitting generation request...' });
      const genId = await submitGeneration(driver, {
        prompt: payload.prompt,
        duration: payload.duration,
        aspect_ratio: payload.aspect_ratio,
        character: payload.character,
      });

      emit('progress', { message: 'Waiting for generation to complete...', genId });
      await waitForGeneration(driver, genId);

      emit('progress', { message: 'Downloading video...' });
      const videoPath = await downloadLatestVideo(driver);
      const fileStat = await import('fs/promises').then(m => m.stat(videoPath).catch(() => null));
      const fileSize = fileStat?.size ?? 0;

      emit('sora.video.downloaded', { videoPath, fileSize });

      if (cmd.type === 'sora.generate.clean') {
        emit('progress', { message: 'Removing watermark...' });
        const cleanedPath = await removeWatermark(videoPath);
        const cleanedStat = await import('fs/promises').then(m => m.stat(cleanedPath).catch(() => null));
        const cleanedSize = cleanedStat?.size ?? 0;

        emit('sora.video.cleaned', { cleanedPath, cleanedSize });
        queue.markSucceeded(commandId, { video_path: videoPath, cleaned_path: cleanedPath, file_size: fileSize, cleaned_size: cleanedSize });
      } else {
        queue.markSucceeded(commandId, { video_path: videoPath, file_size: fileSize });
      }
    }

    // ── sora.clean ──────────────────────────────────────────────────────────
    else if (cmd.type === 'sora.clean') {
      if (!payload.video_path) throw new Error('payload.video_path is required for sora.clean');

      emit('progress', { message: 'Removing watermark...' });
      const cleanedPath = await removeWatermark(payload.video_path);
      const cleanedStat = await import('fs/promises').then(m => m.stat(cleanedPath).catch(() => null));
      const cleanedSize = cleanedStat?.size ?? 0;

      emit('sora.video.cleaned', { cleanedPath, cleanedSize });
      queue.markSucceeded(commandId, { video_path: payload.video_path, cleaned_path: cleanedPath, cleaned_size: cleanedSize });
    }

    // ── upload.* ────────────────────────────────────────────────────────────
    else if (cmd.type.startsWith('upload.')) {
      throw new Error(`Upload commands (${cmd.type}) are handled by platform-specific services, not sora-automation.`);
    }

    else {
      throw new Error(`Unknown command type: ${cmd.type}`);
    }

    emit('status.changed', { status: 'SUCCEEDED' });
    logSoraCommand(queue.get(commandId)!).catch(() => {});

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[sora-automation] Command ${commandId} failed:`, message);
    queue.markFailed(commandId, message);
    broadcastEvent({ type: 'status.changed', commandId, timestamp: new Date().toISOString(), data: { status: 'FAILED', error: message } });
    logSoraCommand(queue.get(commandId)!).catch(() => {});
  } finally {
    if (operationHeartbeat) clearInterval(operationHeartbeat);
    if (operationCoord) {
      if (operationAgentId) activeCoordinators.delete(operationAgentId);
      try { await operationCoord.endOperation(); } catch { /* drain cleanup retries on next startup */ }
    }
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// GET /health
app.get('/health', async (_req: Request, res: Response) => {
  const claim = await ensureTabClaim();
  const pending = queue.list().filter(c => c.status === 'PENDING' || c.status === 'RUNNING').length;
  res.json({
    status: 'ok',
    service: SERVICE_NAME,
    port: PORT,
    timestamp: new Date().toISOString(),
    tabClaimed: !!claim,
    pendingCommands: pending,
  });
});

// GET /ready
app.get('/ready', async (_req: Request, res: Response) => {
  const claim = await ensureTabClaim();
  if (claim) {
    res.json({ ready: true, windowIndex: claim.windowIndex, tabIndex: claim.tabIndex });
  } else {
    res.status(503).json({
      ready: false,
      reason: 'No sora.com tab claimed. Run "/Users/isaiahdupree/Documents/Software/Safari Automation/scripts/open-local-to-cloud-tabs.sh" to reuse or claim a capped shared Safari tab.',
    });
  }
});

// POST /v1/focus
app.post('/v1/focus', async (req: Request, res: Response) => {
  const { app: targetApp = 'Safari' } = req.body as { app?: string };
  if (targetApp !== 'Safari') {
    res.status(400).json({
      success: false,
      error: 'sora-automation focus is restricted to the managed Safari singleton',
    });
    return;
  }
  try {
    await focusManagedSafari();
    res.json({ success: true, app: 'Safari' });
  } catch (err) {
    res.status(503).json({ success: false, error: String(err) });
  }
});

// GET /v1/sora/usage
app.get('/v1/sora/usage', async (_req: Request, res: Response) => {
  try {
    const claim = await ensureTabClaim();
    if (!claim) {
      res.json({ videos_generated_today: -1, daily_limit: -1, remaining: -1, plan: 'unknown', error: 'no tab claimed' });
      return;
    }
    const usage = await getSoraUsage(getDefaultDriver());
    res.json(usage);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /v1/commands
app.post('/v1/commands', async (req: Request, res: Response) => {
  const { type, payload } = req.body as { type?: CommandType; payload?: CommandPayload };
  if (!type) {
    res.status(400).json({ error: 'type is required' });
    return;
  }

  const cmd = queue.enqueue(type, payload || {});
  console.log(`[sora-automation] Enqueued ${type} → ${cmd.id}`);

  // Run async (don't await)
  setImmediate(() => executeCommand(cmd.id));

  res.status(202).json({ command_id: cmd.id, status: cmd.status, createdAt: cmd.createdAt });
});

// GET /v1/commands/:id
app.get('/v1/commands/:id', (req: Request, res: Response) => {
  const cmd = queue.get(req.params.id);
  if (!cmd) {
    res.status(404).json({ error: `Command ${req.params.id} not found` });
    return;
  }
  res.json(cmd);
});

// GET /v1/commands
app.get('/v1/commands', (_req: Request, res: Response) => {
  res.json({ commands: queue.list().slice(0, 50) });
});

// DELETE /v1/commands/:id
app.delete('/v1/commands/:id', (req: Request, res: Response) => {
  const cancelled = queue.cancel(req.params.id);
  res.json({ cancelled, id: req.params.id });
});

// ─── Tab claim + startup ──────────────────────────────────────────────────────

// Prune old commands every hour
setInterval(() => queue.prune(), 60 * 60 * 1000);

// Listen
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[sora-automation] HTTP server on :${PORT}`);
  console.log(`[sora-automation] WebSocket telemetry on :${WS_PORT}`);
  console.log(`   Health:   GET  http://localhost:${PORT}/health`);
  console.log(`   Ready:    GET  http://localhost:${PORT}/ready`);
  console.log(`   Usage:    GET  http://localhost:${PORT}/v1/sora/usage`);
  console.log(`   Submit:   POST http://localhost:${PORT}/v1/commands`);
  console.log(`   Poll:     GET  http://localhost:${PORT}/v1/commands/:id`);
  console.log(`   WS stream ws://localhost:${WS_PORT}/v1/stream`);
});
