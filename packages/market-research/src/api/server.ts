/**
 * Unified Market Research API Server
 *
 * Exposes all 5 platform researchers (Twitter, Threads, Instagram, Facebook, TikTok)
 * via REST endpoints so any external server can trigger research, check status,
 * and retrieve structured results.
 *
 * Port: 3106
 *
 * Endpoints:
 *   GET  /health                              — health check
 *   GET  /api/research/platforms              — list supported platforms
 *
 *   POST /api/research/:platform/search       — search a single query
 *   POST /api/research/:platform/niche        — research a single niche (full pipeline)
 *   POST /api/research/:platform/full         — multi-niche research (the big one)
 *   POST /api/research/all/full               — run across ALL platforms
 *
 *   GET  /api/research/status                 — current job status
 *   GET  /api/research/results                — list saved result files
 *   GET  /api/research/results/:filename      — download a specific result file
 *   GET  /api/research/results/latest/:platform — get latest results for a platform
 *
 * Start:
 *   npx tsx packages/market-research/src/api/server.ts
 */

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as http from 'http';
import * as https from 'https';

// ─── Platform Researchers (lazy-loaded to avoid import issues) ────

import { TwitterResearcher } from '../../../twitter-comments/src/automation/twitter-researcher.js';
import { ThreadsResearcher } from '../../../threads-comments/src/automation/threads-researcher.js';
import { InstagramResearcher } from '../../../instagram-comments/src/automation/instagram-researcher.js';
import { FacebookResearcher } from '../../../facebook-comments/src/automation/facebook-researcher.js';
import { TikTokResearcher } from '../../../tiktok-comments/src/automation/tiktok-researcher.js';
import { TwitterFeedbackLoop } from '../../../twitter-comments/src/automation/twitter-feedback-loop.js';
import type { OfferContext, NicheContext } from '../../../twitter-comments/src/automation/twitter-feedback-loop.js';
import { UniversalTaskQueue } from '../queue/universal-queue.js';
import type { TaskPriority, TaskStatus } from '../queue/universal-queue.js';
import { registerBuiltinWorkers } from '../queue/builtin-workers.js';

// ─── Auth & Webhooks ─────────────────────────────────────────────

const API_KEY = process.env.RESEARCH_API_KEY || '';
const WEBHOOKS_FILE = path.join(os.homedir(), '.twitter-feedback', 'webhooks.json');

interface WebhookRegistration {
  id: string;
  url: string;
  events: string[];  // 'checkback.complete' | 'strategy.updated' | 'tweet.classified' | 'job.complete' | '*'
  secret?: string;
  createdAt: string;
  lastDelivery?: string;
  failCount: number;
}

function loadWebhooks(): WebhookRegistration[] {
  try { return fs.existsSync(WEBHOOKS_FILE) ? JSON.parse(fs.readFileSync(WEBHOOKS_FILE, 'utf-8')) : []; }
  catch { return []; }
}

function saveWebhooks(hooks: WebhookRegistration[]): void {
  const dir = path.dirname(WEBHOOKS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(WEBHOOKS_FILE, JSON.stringify(hooks, null, 2));
}

async function fireWebhook(event: string, payload: Record<string, any>): Promise<void> {
  const hooks = loadWebhooks().filter(h => h.events.includes('*') || h.events.includes(event));
  for (const hook of hooks) {
    try {
      const body = JSON.stringify({ event, timestamp: new Date().toISOString(), data: payload });
      const url = new URL(hook.url);
      const options = {
        method: 'POST',
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'X-Webhook-Event': event,
          ...(hook.secret ? { 'X-Webhook-Secret': hook.secret } : {}),
        },
      };
      const transport = url.protocol === 'https:' ? https : http;
      await new Promise<void>((resolve) => {
        const req = transport.request(options, (res) => { res.resume(); resolve(); });
        req.on('error', () => { hook.failCount++; resolve(); });
        req.setTimeout(5000, () => { req.destroy(); resolve(); });
        req.write(body);
        req.end();
      });
      hook.lastDelivery = new Date().toISOString();
    } catch { hook.failCount++; }
  }
  saveWebhooks(hooks);
}

// ─── API Key Auth Middleware ─────────────────────────────────────

function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Skip auth if no key configured or if it's a health check
  if (!API_KEY || req.path === '/health') { next(); return; }

  const provided = req.headers['x-api-key'] as string
    || req.headers['authorization']?.replace('Bearer ', '')
    || req.query.api_key as string;

  if (provided === API_KEY) { next(); return; }

  res.status(401).json({ error: 'Unauthorized. Set X-API-Key header or ?api_key= query param.' });
}

// ─── Auto-Scheduler ──────────────────────────────────────────────

let autoSchedulerInterval: ReturnType<typeof setInterval> | null = null;
let autoSchedulerRunning = false;
const AUTO_CHECK_INTERVAL_MS = 10 * 60 * 1000; // every 10 minutes

async function autoSchedulerTick(): Promise<void> {
  if (autoSchedulerRunning) return;
  autoSchedulerRunning = true;
  try {
    const due = feedbackLoop.tracker.getDueForCheckBack();
    if (due.length > 0) {
      console.log(`[AutoScheduler] ${due.length} tweets due for check-back`);
      const results = await feedbackLoop.runCheckBacks();
      console.log(`[AutoScheduler] Checked ${results.checked} tweets`);

      // Auto-analyze after check-backs
      if (results.checked > 0) {
        const strategy = feedbackLoop.analyze();
        console.log(`[AutoScheduler] Strategy updated (${strategy.totalTweetsAnalyzed} tweets)`);
        await fireWebhook('checkback.complete', {
          checked: results.checked,
          totalTracked: feedbackLoop.tracker.getStats().totalTracked,
        });
        await fireWebhook('strategy.updated', {
          totalTweetsAnalyzed: strategy.totalTweetsAnalyzed,
          avgEngagementRate: strategy.avgEngagementRate,
        });
      }
    }
  } catch (e) {
    console.error(`[AutoScheduler] Error: ${e}`);
  }
  autoSchedulerRunning = false;
}

function startAutoScheduler(): void {
  if (autoSchedulerInterval) return;
  autoSchedulerInterval = setInterval(autoSchedulerTick, AUTO_CHECK_INTERVAL_MS);
  console.log(`[AutoScheduler] Started — checking every ${AUTO_CHECK_INTERVAL_MS / 60000} minutes`);
  // Run once immediately
  setTimeout(autoSchedulerTick, 5000);
}

function stopAutoScheduler(): void {
  if (autoSchedulerInterval) {
    clearInterval(autoSchedulerInterval);
    autoSchedulerInterval = null;
    console.log('[AutoScheduler] Stopped');
  }
}

// ─── Types ───────────────────────────────────────────────────────

interface ResearchJob {
  id: string;
  platform: string;
  niches: string[];
  status: 'queued' | 'running' | 'completed' | 'failed';
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  resultFile?: string;
  error?: string;
  progress?: {
    currentNiche: string;
    nichesCompleted: number;
    totalNiches: number;
  };
}

type Platform = 'twitter' | 'threads' | 'instagram' | 'facebook' | 'tiktok';

const PLATFORMS: Platform[] = ['twitter', 'threads', 'instagram', 'facebook', 'tiktok'];

const DEFAULT_OUTPUT_DIR = path.join(os.homedir(), 'Documents/market-research');

// ─── State ───────────────────────────────────────────────────────

const jobs: Map<string, ResearchJob> = new Map();
let currentJob: ResearchJob | null = null;

// ─── Researcher Factory ──────────────────────────────────────────

function createResearcher(platform: Platform, config: Record<string, any> = {}) {
  const outputDir = config.outputDir || path.join(DEFAULT_OUTPUT_DIR, platform);

  switch (platform) {
    case 'twitter':
      return new TwitterResearcher({
        tweetsPerNiche: config.postsPerNiche || 1000,
        creatorsPerNiche: config.creatorsPerNiche || 100,
        scrollPauseMs: config.scrollPauseMs || 2000,
        maxScrollsPerSearch: config.maxScrollsPerSearch || 200,
        outputDir,
        ...config,
      });
    case 'threads':
      return new ThreadsResearcher({
        postsPerNiche: config.postsPerNiche || 1000,
        creatorsPerNiche: config.creatorsPerNiche || 100,
        scrollPauseMs: config.scrollPauseMs || 2000,
        maxScrollsPerSearch: config.maxScrollsPerSearch || 200,
        outputDir,
        ...config,
      });
    case 'instagram':
      return new InstagramResearcher({
        postsPerNiche: config.postsPerNiche || 1000,
        creatorsPerNiche: config.creatorsPerNiche || 100,
        detailedScrapeTop: config.detailedScrapeTop || 50,
        scrollPauseMs: config.scrollPauseMs || 1800,
        maxScrollsPerSearch: config.maxScrollsPerSearch || 200,
        outputDir,
        ...config,
      });
    case 'facebook':
      return new FacebookResearcher({
        postsPerNiche: config.postsPerNiche || 1000,
        creatorsPerNiche: config.creatorsPerNiche || 100,
        scrollPauseMs: config.scrollPauseMs || 2000,
        maxScrollsPerSearch: config.maxScrollsPerSearch || 200,
        outputDir,
        ...config,
      });
    case 'tiktok':
      return new TikTokResearcher({
        videosPerNiche: config.postsPerNiche || 1000,
        creatorsPerNiche: config.creatorsPerNiche || 100,
        scrollPauseMs: config.scrollPauseMs || 1800,
        maxScrollsPerSearch: config.maxScrollsPerSearch || 200,
        outputDir,
        ...config,
      });
    default:
      throw new Error(`Unknown platform: ${platform}`);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────

function generateJobId(): string {
  return `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function listResultFiles(platform?: string): Array<{ filename: string; platform: string; size: number; modified: string }> {
  const results: Array<{ filename: string; platform: string; size: number; modified: string }> = [];
  const baseDir = DEFAULT_OUTPUT_DIR;

  const dirs = platform ? [platform] : PLATFORMS;
  for (const p of dirs) {
    const dir = path.join(baseDir, p);
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      const stat = fs.statSync(path.join(dir, file));
      results.push({
        filename: `${p}/${file}`,
        platform: p,
        size: stat.size,
        modified: stat.mtime.toISOString(),
      });
    }
  }

  return results.sort((a, b) => b.modified.localeCompare(a.modified));
}

// ─── Express App ─────────────────────────────────────────────────

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(authMiddleware);

const PORT = parseInt(process.env.RESEARCH_PORT || process.env.PORT || '3106');

// ─── Health ──────────────────────────────────────────────────────

app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'market-research',
    port: PORT,
    platforms: PLATFORMS,
    currentJob: currentJob ? { id: currentJob.id, platform: currentJob.platform, status: currentJob.status } : null,
    jobsTotal: jobs.size,
  });
});

// ─── List platforms ──────────────────────────────────────────────

app.get('/api/research/platforms', (_req: Request, res: Response) => {
  res.json({
    platforms: PLATFORMS.map(p => ({
      name: p,
      searchMethod: {
        twitter: 'x.com/search?q=',
        threads: 'threads.net/search?q=',
        instagram: '/explore/tags/{hashtag}/',
        facebook: 'facebook.com/search/posts/?q=',
        tiktok: 'tiktok.com/search/video?q=',
      }[p],
      metrics: {
        twitter: ['likes', 'retweets', 'replies'],
        threads: ['likes', 'reposts', 'replies'],
        instagram: ['likes', 'comments'],
        facebook: ['reactions', 'comments', 'shares'],
        tiktok: ['views', 'likes', 'comments', 'shares'],
      }[p],
    })),
    defaults: {
      postsPerNiche: 1000,
      creatorsPerNiche: 100,
    },
  });
});

// ─── Search (single query, returns immediately) ──────────────────

app.post('/api/research/:platform/search', async (req: Request, res: Response) => {
  const platform = req.params.platform as Platform;
  if (!PLATFORMS.includes(platform)) {
    res.status(400).json({ error: `Invalid platform. Must be one of: ${PLATFORMS.join(', ')}` });
    return;
  }

  const { query, config } = req.body;
  if (!query) {
    res.status(400).json({ error: 'query is required' });
    return;
  }

  try {
    const researcher = createResearcher(platform, config || {});

    // Search and extract visible posts
    let searchOk: boolean;
    if (platform === 'instagram') {
      searchOk = await (researcher as InstagramResearcher).searchHashtag(query);
    } else {
      searchOk = await (researcher as any).search(query);
    }

    if (!searchOk) {
      res.json({ success: false, error: 'Search returned no results or failed to load', platform, query });
      return;
    }

    // Extract visible posts
    let posts: any[];
    if (platform === 'instagram') {
      posts = await (researcher as InstagramResearcher).extractPostUrls(query);
    } else if (platform === 'tiktok') {
      posts = await (researcher as TikTokResearcher).extractVisibleVideos(query);
    } else {
      posts = await (researcher as any).extractVisiblePosts(query);
    }

    res.json({ success: true, platform, query, posts, count: posts.length });
  } catch (e) {
    res.status(500).json({ error: String(e), platform, query });
  }
});

// ─── Single niche research (async, returns job ID) ───────────────

app.post('/api/research/:platform/niche', async (req: Request, res: Response) => {
  const platform = req.params.platform as Platform;
  if (!PLATFORMS.includes(platform)) {
    res.status(400).json({ error: `Invalid platform. Must be one of: ${PLATFORMS.join(', ')}` });
    return;
  }

  const { niche, config } = req.body;
  if (!niche) {
    res.status(400).json({ error: 'niche is required' });
    return;
  }

  if (currentJob && currentJob.status === 'running') {
    res.status(409).json({ error: 'A research job is already running', currentJob: { id: currentJob.id, platform: currentJob.platform } });
    return;
  }

  const job: ResearchJob = {
    id: generateJobId(),
    platform,
    niches: [niche],
    status: 'running',
    startedAt: new Date().toISOString(),
    progress: { currentNiche: niche, nichesCompleted: 0, totalNiches: 1 },
  };
  jobs.set(job.id, job);
  currentJob = job;

  // Return immediately with job ID
  res.json({ jobId: job.id, status: 'running', platform, niche });

  // Run async
  try {
    const researcher = createResearcher(platform, config || {});
    const result = await (researcher as any).researchNiche(niche);
    const filepath = await (researcher as any).saveResults([result], 'niche');

    job.status = 'completed';
    job.completedAt = new Date().toISOString();
    job.durationMs = Date.now() - new Date(job.startedAt).getTime();
    job.resultFile = filepath;
    job.progress = { currentNiche: niche, nichesCompleted: 1, totalNiches: 1 };
  } catch (e) {
    job.status = 'failed';
    job.error = String(e);
    job.completedAt = new Date().toISOString();
  }
  currentJob = null;
});

// ─── Multi-niche research (async, returns job ID) ────────────────

app.post('/api/research/:platform/full', async (req: Request, res: Response) => {
  const platform = req.params.platform as Platform;
  if (!PLATFORMS.includes(platform)) {
    res.status(400).json({ error: `Invalid platform. Must be one of: ${PLATFORMS.join(', ')}` });
    return;
  }

  const { niches, config } = req.body;
  if (!niches || !Array.isArray(niches) || niches.length === 0) {
    res.status(400).json({ error: 'niches array is required (e.g. ["AI automation", "content marketing"])' });
    return;
  }

  if (currentJob && currentJob.status === 'running') {
    res.status(409).json({ error: 'A research job is already running', currentJob: { id: currentJob.id, platform: currentJob.platform } });
    return;
  }

  const job: ResearchJob = {
    id: generateJobId(),
    platform,
    niches,
    status: 'running',
    startedAt: new Date().toISOString(),
    progress: { currentNiche: niches[0], nichesCompleted: 0, totalNiches: niches.length },
  };
  jobs.set(job.id, job);
  currentJob = job;

  res.json({ jobId: job.id, status: 'running', platform, niches, estimatedMinutes: niches.length * 5 });

  // Run async
  try {
    const researcher = createResearcher(platform, config || {});
    const { results, summary } = await (researcher as any).runFullResearch(niches);

    job.status = 'completed';
    job.completedAt = new Date().toISOString();
    job.durationMs = summary.totalDurationMs;
    job.progress = { currentNiche: niches[niches.length - 1], nichesCompleted: niches.length, totalNiches: niches.length };

    // Find the latest saved file
    const files = listResultFiles(platform);
    if (files.length > 0) job.resultFile = path.join(DEFAULT_OUTPUT_DIR, files[0].filename);
  } catch (e) {
    job.status = 'failed';
    job.error = String(e);
    job.completedAt = new Date().toISOString();
  }
  currentJob = null;
});

// ─── Cross-platform research (all 5 platforms) ───────────────────

app.post('/api/research/all/full', async (req: Request, res: Response) => {
  const { niches, config, platforms: requestedPlatforms } = req.body;
  if (!niches || !Array.isArray(niches) || niches.length === 0) {
    res.status(400).json({ error: 'niches array is required' });
    return;
  }

  if (currentJob && currentJob.status === 'running') {
    res.status(409).json({ error: 'A research job is already running', currentJob: { id: currentJob.id, platform: currentJob.platform } });
    return;
  }

  const activePlatforms: Platform[] = requestedPlatforms
    ? (requestedPlatforms as string[]).filter((p): p is Platform => PLATFORMS.includes(p as Platform))
    : [...PLATFORMS];

  const job: ResearchJob = {
    id: generateJobId(),
    platform: 'all',
    niches,
    status: 'running',
    startedAt: new Date().toISOString(),
    progress: { currentNiche: '', nichesCompleted: 0, totalNiches: activePlatforms.length * niches.length },
  };
  jobs.set(job.id, job);
  currentJob = job;

  res.json({
    jobId: job.id,
    status: 'running',
    platforms: activePlatforms,
    niches,
    estimatedMinutes: activePlatforms.length * niches.length * 5,
  });

  // Run async: one platform at a time (they share Safari)
  const allResults: Record<string, any> = {};
  try {
    for (let pi = 0; pi < activePlatforms.length; pi++) {
      const platform = activePlatforms[pi];
      job.progress = {
        currentNiche: `${platform} (${pi + 1}/${activePlatforms.length})`,
        nichesCompleted: pi * niches.length,
        totalNiches: activePlatforms.length * niches.length,
      };

      try {
        const researcher = createResearcher(platform, config || {});
        const { results } = await (researcher as any).runFullResearch(niches);
        allResults[platform] = results;
      } catch (e) {
        console.error(`[Research] ${platform} failed:`, e);
        allResults[platform] = { error: String(e) };
      }
    }

    // Save combined results
    const combinedDir = path.join(DEFAULT_OUTPUT_DIR, 'combined');
    if (!fs.existsSync(combinedDir)) fs.mkdirSync(combinedDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filepath = path.join(combinedDir, `all-platforms-${timestamp}.json`);
    fs.writeFileSync(filepath, JSON.stringify({
      metadata: { generatedAt: new Date().toISOString(), platforms: activePlatforms, niches },
      results: allResults,
    }, null, 2));

    job.status = 'completed';
    job.completedAt = new Date().toISOString();
    job.durationMs = Date.now() - new Date(job.startedAt).getTime();
    job.resultFile = filepath;
    job.progress = { currentNiche: 'done', nichesCompleted: activePlatforms.length * niches.length, totalNiches: activePlatforms.length * niches.length };
  } catch (e) {
    job.status = 'failed';
    job.error = String(e);
    job.completedAt = new Date().toISOString();
  }
  currentJob = null;
});

// ─── Job status ──────────────────────────────────────────────────

app.get('/api/research/status', (_req: Request, res: Response) => {
  const allJobs = Array.from(jobs.values())
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, 20);

  res.json({
    currentJob: currentJob || null,
    recentJobs: allJobs,
  });
});

app.get('/api/research/status/:jobId', (req: Request, res: Response) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }
  res.json(job);
});

// ─── Results ─────────────────────────────────────────────────────

app.get('/api/research/results', (req: Request, res: Response) => {
  const platform = req.query.platform as string | undefined;
  const files = listResultFiles(platform);
  res.json({ files, count: files.length });
});

app.get('/api/research/results/latest/:platform', (req: Request, res: Response) => {
  const platform = req.params.platform;
  const files = listResultFiles(platform === 'all' ? undefined : platform);
  if (files.length === 0) {
    res.status(404).json({ error: `No results found for ${platform}` });
    return;
  }

  const filepath = path.join(DEFAULT_OUTPUT_DIR, files[0].filename);
  try {
    const content = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
    res.json({ file: files[0], data: content });
  } catch (e) {
    res.status(500).json({ error: `Failed to read file: ${e}` });
  }
});

app.get('/api/research/results/file/*', (req: Request, res: Response) => {
  // Extract everything after /file/
  const relativePath = req.params[0] || '';
  if (!relativePath || relativePath.includes('..')) {
    res.status(400).json({ error: 'Invalid path' });
    return;
  }

  const filepath = path.join(DEFAULT_OUTPUT_DIR, relativePath);
  if (!fs.existsSync(filepath)) {
    res.status(404).json({ error: 'File not found' });
    return;
  }

  try {
    const content = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
    const stat = fs.statSync(filepath);
    res.json({ filename: relativePath, size: stat.size, modified: stat.mtime.toISOString(), data: content });
  } catch (e) {
    res.status(500).json({ error: `Failed to read: ${e}` });
  }
});

// ─── Download raw JSON file ──────────────────────────────────────

app.get('/api/research/download/*', (req: Request, res: Response) => {
  const relativePath = req.params[0] || '';
  if (!relativePath || relativePath.includes('..')) {
    res.status(400).json({ error: 'Invalid path' });
    return;
  }

  const filepath = path.join(DEFAULT_OUTPUT_DIR, relativePath);
  if (!fs.existsSync(filepath)) {
    res.status(404).json({ error: 'File not found' });
    return;
  }

  res.download(filepath);
});

// ═══════════════════════════════════════════════════════════════════
// TWITTER FEEDBACK LOOP API
// ═══════════════════════════════════════════════════════════════════

const feedbackLoop = new TwitterFeedbackLoop();

// ─── Webhook management ──────────────────────────────────────────

app.get('/api/webhooks', (_req: Request, res: Response) => {
  res.json({ webhooks: loadWebhooks().map(w => ({ ...w, secret: w.secret ? '***' : undefined })) });
});

app.post('/api/webhooks', (req: Request, res: Response) => {
  const { url, events, secret } = req.body;
  if (!url) { res.status(400).json({ error: 'url is required' }); return; }

  const hook: WebhookRegistration = {
    id: `wh_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    url,
    events: events || ['*'],
    secret,
    createdAt: new Date().toISOString(),
    failCount: 0,
  };

  const hooks = loadWebhooks();
  hooks.push(hook);
  saveWebhooks(hooks);
  res.json({ success: true, webhook: { ...hook, secret: secret ? '***' : undefined } });
});

app.delete('/api/webhooks/:id', (req: Request, res: Response) => {
  const hooks = loadWebhooks().filter(h => h.id !== req.params.id);
  saveWebhooks(hooks);
  res.json({ success: true, remaining: hooks.length });
});

app.post('/api/webhooks/test', async (req: Request, res: Response) => {
  const { url } = req.body;
  if (!url) { res.status(400).json({ error: 'url is required' }); return; }
  try {
    await fireWebhook('test', { message: 'Webhook test from Market Research API' });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ─── Auto-scheduler control ──────────────────────────────────────

app.get('/api/scheduler/status', (_req: Request, res: Response) => {
  res.json({
    running: !!autoSchedulerInterval,
    intervalMs: AUTO_CHECK_INTERVAL_MS,
    intervalMinutes: AUTO_CHECK_INTERVAL_MS / 60000,
    currentlyProcessing: autoSchedulerRunning,
    dueNow: feedbackLoop.tracker.getDueForCheckBack().length,
  });
});

app.post('/api/scheduler/start', (_req: Request, res: Response) => {
  startAutoScheduler();
  res.json({ success: true, running: true, intervalMinutes: AUTO_CHECK_INTERVAL_MS / 60000 });
});

app.post('/api/scheduler/stop', (_req: Request, res: Response) => {
  stopAutoScheduler();
  res.json({ success: true, running: false });
});

app.post('/api/scheduler/trigger', async (_req: Request, res: Response) => {
  try {
    await autoSchedulerTick();
    res.json({ success: true, message: 'Manual tick complete' });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ─── Feedback loop status ────────────────────────────────────────

app.get('/api/feedback/status', (_req: Request, res: Response) => {
  res.json(feedbackLoop.getStatus());
});

// ─── Register a posted tweet for tracking ────────────────────────

app.post('/api/feedback/register', (req: Request, res: Response) => {
  const { tweetUrl, text, niche, offer } = req.body;
  if (!tweetUrl || !text) {
    res.status(400).json({ error: 'tweetUrl and text are required' });
    return;
  }

  const tracked = feedbackLoop.registerPostedTweet(tweetUrl, text, niche || 'general', offer || '');
  res.json({ success: true, tweet: tracked });
});

// ─── Batch register multiple tweets ──────────────────────────────

app.post('/api/feedback/register/batch', (req: Request, res: Response) => {
  const { tweets } = req.body;
  if (!tweets || !Array.isArray(tweets)) {
    res.status(400).json({ error: 'tweets array is required (each: {tweetUrl, text, niche?, offer?})' });
    return;
  }

  const results = tweets.map((t: any) => {
    if (!t.tweetUrl || !t.text) return { error: 'tweetUrl and text required', input: t };
    return feedbackLoop.registerPostedTweet(t.tweetUrl, t.text, t.niche || 'general', t.offer || '');
  });
  res.json({ success: true, registered: results.length, tweets: results });
});

// ─── Run scheduled check-backs ───────────────────────────────────

app.post('/api/feedback/check-backs', async (_req: Request, res: Response) => {
  try {
    const results = await feedbackLoop.runCheckBacks();
    res.json(results);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ─── Extract metrics for a specific tweet URL ────────────────────

app.post('/api/feedback/metrics', async (req: Request, res: Response) => {
  const { tweetUrl } = req.body;
  if (!tweetUrl) {
    res.status(400).json({ error: 'tweetUrl is required' });
    return;
  }

  try {
    const metrics = await feedbackLoop.tracker.extractMetrics(tweetUrl);
    res.json({ success: !!metrics, tweetUrl, metrics });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ─── Analyze performance & update strategy ───────────────────────

app.post('/api/feedback/analyze', (_req: Request, res: Response) => {
  try {
    const strategy = feedbackLoop.analyze();
    res.json({ success: true, strategy });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ─── Get current strategy context ────────────────────────────────

app.get('/api/feedback/strategy', (_req: Request, res: Response) => {
  const strategy = feedbackLoop.refiner.loadStrategy();
  if (!strategy) {
    res.status(404).json({ error: 'No strategy generated yet. POST /api/feedback/analyze first.' });
    return;
  }
  res.json(strategy);
});

// ─── Generate optimized tweet prompt ─────────────────────────────

app.post('/api/feedback/generate-prompt', (req: Request, res: Response) => {
  const { niche, style, offer } = req.body;
  if (!niche) {
    res.status(400).json({ error: 'niche is required' });
    return;
  }

  const prompt = feedbackLoop.generateTweetPrompt(niche, { style, offer });
  res.json({ niche, style: style || 'educational', prompt });
});

// ─── Run full feedback cycle (check → analyze → generate) ───────

app.post('/api/feedback/cycle', async (req: Request, res: Response) => {
  const { niche, style, offer } = req.body;
  if (!niche) {
    res.status(400).json({ error: 'niche is required' });
    return;
  }

  try {
    const result = await feedbackLoop.runCycle(niche, { style, offer });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ─── Set offers for promotion context ────────────────────────────

app.post('/api/feedback/offers', (req: Request, res: Response) => {
  const { offers } = req.body;
  if (!offers || !Array.isArray(offers)) {
    res.status(400).json({ error: 'offers array is required' });
    return;
  }
  feedbackLoop.setOffers(offers as OfferContext[]);
  res.json({ success: true, count: offers.length });
});

app.get('/api/feedback/offers', (_req: Request, res: Response) => {
  res.json({ offers: feedbackLoop.getOffers() });
});

// ─── Set niche context for prompt refinement ─────────────────────

app.post('/api/feedback/niches', (req: Request, res: Response) => {
  const { niches } = req.body;
  if (!niches || !Array.isArray(niches)) {
    res.status(400).json({ error: 'niches array is required' });
    return;
  }
  feedbackLoop.setNiches(niches as NicheContext[]);
  res.json({ success: true, count: niches.length });
});

app.get('/api/feedback/niches', (_req: Request, res: Response) => {
  res.json({ niches: feedbackLoop.getNiches() });
});

// ─── List all tracked tweets ─────────────────────────────────────

app.get('/api/feedback/tweets', (req: Request, res: Response) => {
  const classification = req.query.classification as string;
  const status = req.query.status as string;

  let tweets = feedbackLoop.tracker.getAllTweets();

  if (classification) {
    tweets = tweets.filter(t => t.classification === classification);
  }
  if (status === 'pending') {
    tweets = feedbackLoop.tracker.getPending();
  } else if (status === 'tracked') {
    tweets = feedbackLoop.tracker.getFullyTracked();
  }

  res.json({ tweets, count: tweets.length });
});

// ─── Get tweets due for check-back ───────────────────────────────

app.get('/api/feedback/due', (_req: Request, res: Response) => {
  const due = feedbackLoop.tracker.getDueForCheckBack();
  res.json({ due, count: due.length });
});

// ═══════════════════════════════════════════════════════════════════
// UNIVERSAL TASK QUEUE
// ═══════════════════════════════════════════════════════════════════

const taskQueue = new UniversalTaskQueue();
registerBuiltinWorkers(taskQueue, feedbackLoop);

// ─── Submit a task ───────────────────────────────────────────────

app.post('/api/queue/submit', (req: Request, res: Response) => {
  const { type, payload, platform, priority, scheduledFor, maxRetries, retryDelayMs, webhookUrl, callbackId, submittedBy, tags, notes } = req.body;
  if (!type || !payload) {
    res.status(400).json({ error: 'type and payload are required' });
    return;
  }

  const task = taskQueue.submit({
    type,
    payload,
    platform,
    priority: priority as TaskPriority,
    scheduledFor,
    maxRetries,
    retryDelayMs,
    webhookUrl,
    callbackId,
    submittedBy,
    tags,
    notes,
  });

  res.json({ success: true, task });
});

// ─── Submit batch of tasks ───────────────────────────────────────

app.post('/api/queue/submit/batch', (req: Request, res: Response) => {
  const { tasks: taskList } = req.body;
  if (!taskList || !Array.isArray(taskList)) {
    res.status(400).json({ error: 'tasks array is required' });
    return;
  }

  const results = taskList.map((t: any) => {
    if (!t.type || !t.payload) return { error: 'type and payload required', input: t };
    return taskQueue.submit(t);
  });

  res.json({ success: true, submitted: results.length, tasks: results });
});

// ─── Get task by ID ──────────────────────────────────────────────

app.get('/api/queue/:taskId', (req: Request, res: Response) => {
  // Exclude paths that would match other routes
  if (['stats', 'workers', 'rate-limits', 'control'].includes(req.params.taskId)) { return; }

  const task = taskQueue.getTask(req.params.taskId);
  if (!task) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }
  res.json(task);
});

// ─── List tasks with filters ─────────────────────────────────────

app.get('/api/queue', (req: Request, res: Response) => {
  const tasks = taskQueue.listTasks({
    status: req.query.status as TaskStatus | undefined,
    type: req.query.type as string | undefined,
    platform: req.query.platform as string | undefined,
    limit: req.query.limit ? parseInt(req.query.limit as string) : 50,
    submittedBy: req.query.submittedBy as string | undefined,
  });

  res.json({ tasks, count: tasks.length });
});

// ─── Cancel a task ───────────────────────────────────────────────

app.post('/api/queue/cancel/:taskId', (req: Request, res: Response) => {
  const task = taskQueue.cancel(req.params.taskId);
  if (!task) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }
  res.json({ success: true, task });
});

// ─── Queue stats ─────────────────────────────────────────────────

app.get('/api/queue/stats', (_req: Request, res: Response) => {
  res.json(taskQueue.getStats());
});

// ─── Register a remote worker ────────────────────────────────────

app.post('/api/queue/workers', (req: Request, res: Response) => {
  const { name, url, taskPatterns, platforms, maxConcurrent } = req.body;
  if (!name || !url || !taskPatterns) {
    res.status(400).json({ error: 'name, url, and taskPatterns are required' });
    return;
  }

  const worker = taskQueue.registerWorker({
    name,
    type: 'remote',
    url,
    taskPatterns,
    platforms,
    maxConcurrent,
  });

  res.json({ success: true, worker: { ...worker, handler: undefined } });
});

// ─── List workers ────────────────────────────────────────────────

app.get('/api/queue/workers', (_req: Request, res: Response) => {
  res.json({ workers: taskQueue.listWorkers() });
});

// ─── Remove a worker ─────────────────────────────────────────────

app.delete('/api/queue/workers/:workerId', (req: Request, res: Response) => {
  const ok = taskQueue.removeWorker(req.params.workerId);
  if (!ok) {
    res.status(404).json({ error: 'Worker not found' });
    return;
  }
  res.json({ success: true });
});

// ─── Rate limits ─────────────────────────────────────────────────

app.post('/api/queue/rate-limits', (req: Request, res: Response) => {
  const { key, maxPerHour, maxPerDay } = req.body;
  if (!key || maxPerHour === undefined || maxPerDay === undefined) {
    res.status(400).json({ error: 'key, maxPerHour, and maxPerDay are required' });
    return;
  }
  taskQueue.setRateLimit(key, maxPerHour, maxPerDay);
  res.json({ success: true, key, maxPerHour, maxPerDay });
});

// ─── Queue control ───────────────────────────────────────────────

app.post('/api/queue/control/start', (_req: Request, res: Response) => {
  taskQueue.start();
  res.json({ success: true, running: true });
});

app.post('/api/queue/control/stop', (_req: Request, res: Response) => {
  taskQueue.stop();
  res.json({ success: true, running: false });
});

app.post('/api/queue/control/cleanup', (req: Request, res: Response) => {
  const olderThanMs = req.body.olderThanMs || 7 * 24 * 60 * 60 * 1000;
  const removed = taskQueue.cleanup(olderThanMs);
  res.json({ success: true, removed });
});

// ─── Start Server ────────────────────────────────────────────────

export function startServer(port: number = PORT): void {
  app.listen(port, () => {
    console.log(`\n🔬 Market Research API running on http://localhost:${port}`);
    console.log(`   Auth: ${API_KEY ? 'ENABLED (X-API-Key header required)' : 'DISABLED (set RESEARCH_API_KEY to enable)'}`);
    console.log(`\n   ── RESEARCH ──`);
    console.log(`   Platforms:      GET  /api/research/platforms`);
    console.log(`   Search:         POST /api/research/:platform/search       {query}`);
    console.log(`   Niche:          POST /api/research/:platform/niche        {niche}`);
    console.log(`   Full research:  POST /api/research/:platform/full         {niches[]}`);
    console.log(`   All platforms:  POST /api/research/all/full               {niches[]}`);
    console.log(`   Job status:     GET  /api/research/status`);
    console.log(`   Results:        GET  /api/research/results`);
    console.log(`   Latest:         GET  /api/research/results/latest/:platform`);
    console.log(`\n   ── FEEDBACK LOOP ──`);
    console.log(`   Status:         GET  /api/feedback/status`);
    console.log(`   Register:       POST /api/feedback/register              {tweetUrl, text, niche}`);
    console.log(`   Batch register: POST /api/feedback/register/batch        {tweets[]}`);
    console.log(`   Check-backs:    POST /api/feedback/check-backs`);
    console.log(`   Metrics:        POST /api/feedback/metrics               {tweetUrl}`);
    console.log(`   Analyze:        POST /api/feedback/analyze`);
    console.log(`   Strategy:       GET  /api/feedback/strategy`);
    console.log(`   Gen prompt:     POST /api/feedback/generate-prompt       {niche, style?}`);
    console.log(`   Full cycle:     POST /api/feedback/cycle                 {niche, style?}`);
    console.log(`   Offers:         POST /api/feedback/offers                {offers[]}`);
    console.log(`   Niches:         POST /api/feedback/niches                {niches[]}`);
    console.log(`   Tweets:         GET  /api/feedback/tweets?classification=&status=`);
    console.log(`   Due:            GET  /api/feedback/due`);
    console.log(`\n   ── UNIVERSAL QUEUE ──`);
    console.log(`   Submit:         POST /api/queue/submit                   {type, payload, platform?, priority?}`);
    console.log(`   Submit batch:   POST /api/queue/submit/batch             {tasks[]}`);
    console.log(`   Get task:       GET  /api/queue/:taskId`);
    console.log(`   List tasks:     GET  /api/queue?status=&type=&platform=&limit=`);
    console.log(`   Cancel:         POST /api/queue/cancel/:taskId`);
    console.log(`   Stats:          GET  /api/queue/stats`);
    console.log(`   Add worker:     POST /api/queue/workers                  {name, url, taskPatterns[]}`);
    console.log(`   List workers:   GET  /api/queue/workers`);
    console.log(`   Remove worker:  DELETE /api/queue/workers/:id`);
    console.log(`   Rate limits:    POST /api/queue/rate-limits              {key, maxPerHour, maxPerDay}`);
    console.log(`   Start queue:    POST /api/queue/control/start`);
    console.log(`   Stop queue:     POST /api/queue/control/stop`);
    console.log(`   Cleanup:        POST /api/queue/control/cleanup          {olderThanMs?}`);
    console.log(`\n   ── WEBHOOKS ──`);
    console.log(`   List:           GET  /api/webhooks`);
    console.log(`   Register:       POST /api/webhooks                      {url, events[], secret?}`);
    console.log(`   Delete:         DELETE /api/webhooks/:id`);
    console.log(`   Test:           POST /api/webhooks/test                  {url}`);
    console.log(`\n   ── AUTO-SCHEDULER ──`);
    console.log(`   Status:         GET  /api/scheduler/status`);
    console.log(`   Start:          POST /api/scheduler/start`);
    console.log(`   Stop:           POST /api/scheduler/stop`);
    console.log(`   Trigger now:    POST /api/scheduler/trigger`);
    console.log(`\n   Platforms: ${PLATFORMS.join(', ')}`);
    console.log(`   Output dir: ${DEFAULT_OUTPUT_DIR}`);
    console.log(`   Webhooks: ${loadWebhooks().length} registered`);
    console.log(`   Queue workers: ${taskQueue.listWorkers().length}\n`);

    // Auto-start
    startAutoScheduler();
    taskQueue.start();
  });
}

if (process.argv[1]?.includes('server')) startServer();

export { app };
