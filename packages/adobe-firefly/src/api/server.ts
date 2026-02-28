/**
 * Adobe Firefly Automation API Server - Port 3110
 *
 * Endpoints:
 *   GET  /health                      — liveness check
 *   GET  /api/firefly/status          — current Safari / Firefly session state
 *   POST /api/firefly/navigate        — navigate Safari to Firefly generator
 *   POST /api/firefly/generate        — generate images from a text prompt
 *   GET  /api/firefly/images          — extract image URLs from current page
 *   POST /api/firefly/download        — download current images to local disk
 *   GET  /api/firefly/config          — get driver config
 *   PUT  /api/firefly/config          — update driver config
 *   GET  /api/firefly/rate-limits     — rate-limit info
 */

import 'dotenv/config';
import express, { Request, Response } from 'express';
import cors from 'cors';
import * as path from 'path';
import * as os from 'os';
import { FireflyDriver, type GenerateOptions } from '../automation/firefly-driver.js';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = parseInt(process.env.ADOBE_FIREFLY_PORT || '3110');

// Simple in-memory rate tracking
interface RateLimits {
  generationsPerHour: number;
  generationsPerDay: number;
  minDelayBetweenGenerationsMs: number;
  generationsThisHour: number;
  generationsToday: number;
  lastGenerationAt: string | null;
}

const rateLimits: RateLimits = {
  generationsPerHour: parseInt(process.env.FIREFLY_GENS_PER_HOUR || '20'),
  generationsPerDay: parseInt(process.env.FIREFLY_GENS_PER_DAY || '100'),
  minDelayBetweenGenerationsMs: parseInt(process.env.FIREFLY_MIN_DELAY_MS || '5000'),
  generationsThisHour: 0,
  generationsToday: 0,
  lastGenerationAt: null,
};

// Reset counters
setInterval(() => { rateLimits.generationsThisHour = 0; }, 60 * 60 * 1000);
setInterval(() => { rateLimits.generationsToday = 0; }, 24 * 60 * 60 * 1000);

function canGenerate(): { ok: boolean; reason?: string } {
  if (rateLimits.generationsThisHour >= rateLimits.generationsPerHour) {
    return { ok: false, reason: `Hourly limit reached (${rateLimits.generationsPerHour}/hr)` };
  }
  if (rateLimits.generationsToday >= rateLimits.generationsPerDay) {
    return { ok: false, reason: `Daily limit reached (${rateLimits.generationsPerDay}/day)` };
  }
  if (rateLimits.lastGenerationAt) {
    const elapsed = Date.now() - new Date(rateLimits.lastGenerationAt).getTime();
    if (elapsed < rateLimits.minDelayBetweenGenerationsMs) {
      const waitMs = rateLimits.minDelayBetweenGenerationsMs - elapsed;
      return { ok: false, reason: `Minimum delay not met — wait ${Math.ceil(waitMs / 1000)}s` };
    }
  }
  return { ok: true };
}

function recordGeneration(): void {
  rateLimits.generationsThisHour++;
  rateLimits.generationsToday++;
  rateLimits.lastGenerationAt = new Date().toISOString();
}

let driver: FireflyDriver | null = null;

function getDriver(): FireflyDriver {
  if (!driver) {
    driver = new FireflyDriver({
      downloadsDir: process.env.FIREFLY_DOWNLOADS_DIR ||
        path.join(os.homedir(), 'Downloads', 'firefly-generated'),
      maxGenerateWaitMs: parseInt(process.env.FIREFLY_GENERATE_TIMEOUT_MS || '90000'),
    });
  }
  return driver;
}

// ──────────────────────────────────────────────
// Routes
// ──────────────────────────────────────────────

app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'adobe-firefly',
    port: PORT,
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/firefly/status', async (_req: Request, res: Response) => {
  try {
    const status = await getDriver().getStatus();
    res.json({ ...status, rateLimits });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.post('/api/firefly/navigate', async (_req: Request, res: Response) => {
  try {
    const ok = await getDriver().navigateToGenerator();
    res.json({ success: ok, url: 'https://firefly.adobe.com/inspire/image-generator' });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.post('/api/firefly/generate', async (req: Request, res: Response) => {
  try {
    const { prompt, negativePrompt, aspectRatio, contentType, style, count } = req.body as GenerateOptions & { prompt?: string };

    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      res.status(400).json({ error: 'prompt is required' });
      return;
    }

    const check = canGenerate();
    if (!check.ok) {
      res.status(429).json({ error: check.reason, rateLimits });
      return;
    }

    console.log(`[Firefly] Generate request: "${prompt.substring(0, 80)}"`);
    recordGeneration();

    const result = await getDriver().generate({
      prompt: prompt.trim(),
      negativePrompt,
      aspectRatio,
      contentType,
      style,
      count,
    });

    res.json({
      ...result,
      rateLimits: {
        generationsThisHour: rateLimits.generationsThisHour,
        generationsToday: rateLimits.generationsToday,
      },
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.get('/api/firefly/images', async (_req: Request, res: Response) => {
  try {
    const urls = await getDriver().getGeneratedImageUrls();
    res.json({ imageUrls: urls, count: urls.length });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.post('/api/firefly/download', async (req: Request, res: Response) => {
  try {
    const { prompt = 'untitled' } = req.body as { prompt?: string };
    const savedPaths = await getDriver().downloadGeneratedImages(prompt);
    res.json({ success: savedPaths.length > 0, savedPaths, count: savedPaths.length });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.get('/api/firefly/config', (_req: Request, res: Response) => {
  res.json({ config: getDriver().getConfig() });
});

app.put('/api/firefly/config', (req: Request, res: Response) => {
  getDriver().setConfig(req.body);
  res.json({ config: getDriver().getConfig() });
});

app.get('/api/firefly/rate-limits', (_req: Request, res: Response) => {
  res.json({ rateLimits });
});

app.put('/api/firefly/rate-limits', (req: Request, res: Response) => {
  Object.assign(rateLimits, req.body);
  res.json({ rateLimits });
});

export function startServer(port = PORT): void {
  app.listen(port, () => {
    console.log(`🔥 Adobe Firefly Automation API running on http://localhost:${port}`);
    console.log(`   Downloads dir: ${process.env.FIREFLY_DOWNLOADS_DIR || '~/Downloads/firefly-generated'}`);
  });
}

if (process.argv[1]?.includes('server')) startServer();
export { app };
