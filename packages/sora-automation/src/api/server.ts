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
import { exec } from 'child_process';
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

const execAsync = promisify(exec);

const PORT = parseInt(process.env.SORA_PORT || '7070', 10);
const WS_PORT = PORT + 1;
const SERVICE_NAME = 'sora-automation';
const OPEN_URL = SORA_URL;

const app = express();
app.use(cors());
app.use(express.json());

// ─── Tab claim ────────────────────────────────────────────────────────────────

const activeCoordinators = new Map<string, TabCoordinator>();

async function ensureTabClaim(): Promise<{ windowIndex: number; tabIndex: number } | null> {
  const claims = await TabCoordinator.listClaims();
  const myClaim = claims.find(c => c.service === SERVICE_NAME);
  if (myClaim) {
    getDefaultDriver().setTrackedTab(myClaim.windowIndex, myClaim.tabIndex);
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

  try {
    const payload: CommandPayload = cmd.payload;

    // Ensure we have a Sora tab claimed
    const claim = await ensureTabClaim();
    if (!claim) {
      // Try to find an existing sora.com tab or open a new one
      const found = await driver.findTab(SORA_PATTERN);
      if (found) {
        driver.setTrackedTab(found.windowIndex, found.tabIndex);
        const autoId = `sora-auto-${Date.now()}`;
        const coord = new TabCoordinator(autoId, SERVICE_NAME, PORT, SORA_PATTERN, OPEN_URL);
        activeCoordinators.set(autoId, coord);
        await coord.claim(found.windowIndex, found.tabIndex);
      } else {
        throw new Error(
          'No sora.com tab found. Open Safari, navigate to sora.com, and run safari-tabs-setup.sh to claim the tab.'
        );
      }
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
      reason: 'No sora.com tab claimed. Run safari-tabs-setup.sh to open and claim the Sora tab.',
    });
  }
});

// POST /v1/focus
app.post('/v1/focus', async (req: Request, res: Response) => {
  const { app: targetApp = 'Safari' } = req.body as { app?: string };
  try {
    await execAsync(`osascript -e 'tell application "${targetApp}" to activate'`, { timeout: 5000 });
    res.json({ success: true, app: targetApp });
  } catch (err) {
    res.json({ success: false, error: String(err) });
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
