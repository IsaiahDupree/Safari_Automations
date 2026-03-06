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
 *   POST /api/research/twitter/top100        — top 100 Twitter creators (10 niches × 10)
 *   POST /api/research/threads/top100        — top 100 Threads creators (10 niches × 10)
 *   POST /api/research/instagram/competitor  — account-specific: profile+reels+engagement
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
import { TabCoordinator } from '../automation/tab-coordinator.js';
import { SafariDriver } from '../../../twitter-comments/src/automation/safari-driver.js';
import { FacebookResearcher } from '../../../facebook-comments/src/automation/facebook-researcher.js';
import { TikTokResearcher } from '../../../tiktok-comments/src/automation/tiktok-researcher.js';
import { TwitterFeedbackLoop } from '../../../twitter-comments/src/automation/twitter-feedback-loop.js';
import type { OfferContext, NicheContext } from '../../../twitter-comments/src/automation/twitter-feedback-loop.js';
import { UniversalTaskQueue } from '../queue/universal-queue.js';
import type { TaskPriority, TaskStatus } from '../queue/universal-queue.js';
import { registerBuiltinWorkers } from '../queue/builtin-workers.js';

// ─── Server Metadata ─────────────────────────────────────────────

const SERVER_VERSION = '1.4.0';
const SERVER_STARTED_AT = new Date().toISOString();

// ─── Tab Coordination ────────────────────────────────────────────────
const SERVICE_NAME = 'market-research';
const SERVICE_PORT = 3106;
const SESSION_URL_PATTERN = 'google.com';
const activeCoordinators = new Map<string, TabCoordinator>();
let tabDriver: SafariDriver | null = null;
function getTabDriver(): SafariDriver {
  if (!tabDriver) tabDriver = new SafariDriver();
  return tabDriver;
}

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

// ─── Rate Limiting ──────────────────────────────────────────────

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

const rateLimitStore = new Map<string, RateLimitBucket>();
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute window
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX || '60');

function getRateLimitKey(req: Request): string {
  return req.ip || req.headers['x-forwarded-for'] as string || 'unknown';
}

function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (req.path === '/health' || req.method === 'OPTIONS') { next(); return; }

  const key = getRateLimitKey(req);
  const now = Date.now();
  let bucket = rateLimitStore.get(key);

  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
    rateLimitStore.set(key, bucket);
  }

  bucket.count++;
  const remaining = Math.max(0, RATE_LIMIT_MAX - bucket.count);
  const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);

  res.set('X-RateLimit-Limit', String(RATE_LIMIT_MAX));
  res.set('X-RateLimit-Remaining', String(remaining));
  res.set('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));

  if (bucket.count > RATE_LIMIT_MAX) {
    res.set('Retry-After', String(retryAfter));
    res.status(429).json({
      error: 'Rate limit exceeded',
      message: `Too many requests. Limit: ${RATE_LIMIT_MAX} per ${RATE_LIMIT_WINDOW_MS / 1000}s`,
      retryAfter,
    });
    return;
  }

  next();
}

// ─── Daily Cap Tracking ─────────────────────────────────────────

interface DailyCap {
  used: number;
  date: string;
}

const dailyCaps = new Map<string, DailyCap>();

function getDailyCap(account: string): DailyCap {
  const today = new Date().toISOString().slice(0, 10);
  let cap = dailyCaps.get(account);
  if (!cap || cap.date !== today) {
    cap = { used: 0, date: today };
    dailyCaps.set(account, cap);
  }
  return cap;
}

// ─── Session Management ─────────────────────────────────────────

interface BrowserSession {
  id: string;
  createdAt: string;
  lastAccessedAt: string;
  platform?: string;
  state: Record<string, any>;
}

const sessions = new Map<string, BrowserSession>();
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

function generateSessionId(): string {
  return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function cleanExpiredSessions(): void {
  const now = Date.now();
  const ids = Array.from(sessions.keys());
  for (const id of ids) {
    const session = sessions.get(id)!;
    if (now - new Date(session.lastAccessedAt).getTime() > SESSION_TIMEOUT_MS) {
      sessions.delete(id);
    }
  }
}

// Clean expired sessions every 5 minutes
setInterval(cleanExpiredSessions, 5 * 60 * 1000);

// ─── API Key Auth Middleware ─────────────────────────────────────

function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  // OPTIONS requests always pass (CORS preflight)
  if (req.method === 'OPTIONS') { next(); return; }

  // Skip auth if no key configured or if it's a health check
  if (!API_KEY || req.path === '/health') { next(); return; }

  // Accept Bearer token in Authorization header or X-API-Key header
  const authHeader = req.headers['authorization'] as string | undefined;
  const xApiKey = req.headers['x-api-key'] as string | undefined;

  let provided: string | undefined;

  if (authHeader) {
    if (!authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Invalid authorization format', message: 'Authorization header must use Bearer scheme' });
      return;
    }
    const token = authHeader.slice(7).trim();
    if (!token) {
      res.status(401).json({ error: 'Empty token', message: 'Bearer token is empty' });
      return;
    }
    provided = token;
  } else if (xApiKey) {
    provided = xApiKey;
  }

  // Reject query param auth for security (token in URL can leak in logs/referrer)
  if (!provided && req.query.token) {
    res.status(401).json({ error: 'Query param auth not supported', message: 'Use Authorization: Bearer <token> header instead' });
    return;
  }

  if (!provided) {
    res.status(401).json({ error: 'Unauthorized', message: 'Missing authentication. Provide Authorization: Bearer <token> or X-API-Key header.' });
    return;
  }

  if (provided !== API_KEY) {
    res.status(401).json({ error: 'Invalid token', message: 'The provided authentication token is invalid' });
    return;
  }

  next();
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
  // NOTE: No immediate run — first tick happens after AUTO_CHECK_INTERVAL_MS.
  // Use POST /api/scheduler/trigger to run immediately on demand.
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
let currentJob: ResearchJob | null = null;  // legacy — kept for /api/research/status
const runningByPlatform: Map<string, ResearchJob> = new Map(); // per-platform lock

// ─── Researcher Factory ──────────────────────────────────────────

function createResearcher(platform: Platform, config: Record<string, any> = {}) {
  const outputDir = config.outputDir || path.join(DEFAULT_OUTPUT_DIR, platform);

  switch (platform) {
    case 'twitter':
      return new TwitterResearcher({
        tweetsPerNiche: config.postsPerNiche || 1000,
        creatorsPerNiche: config.creatorsPerNiche || 100,
        enrichTopCreators: config.enrichTopCreators ?? 10,
        scrollPauseMs: config.scrollPauseMs || 2000,
        maxScrollsPerSearch: config.maxScrollsPerSearch || 200,
        outputDir,
        ...config,
      });
    case 'threads':
      return new ThreadsResearcher({
        postsPerNiche: config.postsPerNiche || 1000,
        creatorsPerNiche: config.creatorsPerNiche || 100,
        enrichTopCreators: config.enrichTopCreators ?? 10,
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

const MAX_TEXT_LENGTH = 10000;

function validateTextField(value: any, fieldName: string): { valid: boolean; error?: string } {
  if (value === null || value === undefined) {
    return { valid: false, error: `${fieldName} cannot be null` };
  }
  if (typeof value === 'string' && value.trim() === '') {
    return { valid: false, error: `${fieldName} cannot be empty` };
  }
  if (typeof value === 'string' && value.length > MAX_TEXT_LENGTH) {
    return { valid: false, error: `${fieldName} exceeds maximum length of ${MAX_TEXT_LENGTH} characters` };
  }
  return { valid: true };
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
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

// Content-type validation for POST/PUT/PATCH requests
app.use((req: Request, res: Response, next: NextFunction) => {
  if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
    const ct = req.headers['content-type'];
    if (ct && !ct.includes('application/json') && !ct.includes('multipart/form-data') && req.path !== '/health') {
      res.status(415).json({ error: 'Unsupported Media Type', message: 'Content-Type must be application/json' });
      return;
    }
  }
  next();
});

app.use(express.json({ limit: '10mb' }));

// Handle JSON parse errors
app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
  if (err.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Invalid JSON', message: 'Request body must be valid JSON' });
    return;
  }
  next(err);
});

app.use(authMiddleware);

// ── Tab claim enforcement ─────────────────────────────────────────────────────
// Every automation route MUST have an active tab claim before it runs.
// On first request: auto-claims an existing tab OR opens a new one.
// Subsequent requests: validates the claim is still alive.
// Routes exempt: /health, /api/tabs/*, /api/*/status, /api/*/rate-limits
const OPEN_URL = 'https://www.google.com';
const CLAIM_EXEMPT = /^\/health$|^\/api\/tabs|^\/api\/[^\/]+\/status$|^\/api\/[^\/]+\/rate-limits/;

async function requireTabClaim(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (CLAIM_EXEMPT.test(req.path)) { next(); return; }

  const claims = await TabCoordinator.listClaims();
  const myClaim = claims.find(c => c.service === SERVICE_NAME);

  if (myClaim) {
    // Claim exists — pin driver to the claimed tab and proceed
    getTabDriver().setTrackedTab(myClaim.windowIndex, myClaim.tabIndex, SESSION_URL_PATTERN);
    next();
    return;
  }

  // No claim — auto-claim now (open new tab if needed)
  const autoId = `market-research-auto-${Date.now()}`;
  try {
    const coord = new TabCoordinator(autoId, SERVICE_NAME, SERVICE_PORT, SESSION_URL_PATTERN, OPEN_URL);
    activeCoordinators.set(autoId, coord);
    const claim = await coord.claim();
    getTabDriver().setTrackedTab(claim.windowIndex, claim.tabIndex, SESSION_URL_PATTERN);
    console.log(`[requireTabClaim] Auto-claimed w=${claim.windowIndex} t=${claim.tabIndex} (${claim.tabUrl})`);
    next();
  } catch (err) {
    res.status(503).json({
      error: 'No Safari tab available for market-research',
      detail: String(err),
      fix: `Open Safari and navigate to https://www.google.com, or POST /api/tabs/claim with { agentId, openUrl: "https://www.google.com" }`,
    });
  }
}

app.use(requireTabClaim);
// ─────────────────────────────────────────────────────────────────────────────

app.use(rateLimitMiddleware);

const PORT = parseInt(process.env.RESEARCH_PORT || process.env.PORT || '3106');

// ─── Health ──────────────────────────────────────────────────────

app.get('/health', (_req: Request, res: Response) => {
  const uptimeMs = Date.now() - new Date(SERVER_STARTED_AT).getTime();
  res.json({
    status: 'ok',
    service: 'market-research',
    version: SERVER_VERSION,
    port: PORT,
    started_at: SERVER_STARTED_AT,
    uptime: uptimeMs,
    uptime_human: `${Math.floor(uptimeMs / 3600000)}h ${Math.floor((uptimeMs % 3600000) / 60000)}m`,
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

  const { query, config } = req.body || {};
  if (query === null || query === undefined) {
    res.status(400).json({ error: 'Missing required field: query', message: 'query is required' });
    return;
  }
  if (typeof query === 'string' && query.trim() === '') {
    res.status(400).json({ error: 'Empty field: query', message: 'query cannot be empty' });
    return;
  }

  try {
    const researcher = createResearcher(platform, config || {});

    // TikTok deep-scrape: searchAndDeepScrape handles its own search() internally
    const deepScrape = (config?.deepScrape !== false) && platform === 'tiktok';

    if (!deepScrape) {
      // Non-deep-scrape path: navigate first, check page loaded
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
    }

    // Extract visible posts
    let posts: any[];
    if (platform === 'instagram') {
      posts = await (researcher as InstagramResearcher).extractPostUrls(query);
    } else if (platform === 'tiktok' && deepScrape) {
      const maxDeep = config?.postsPerQuery || config?.maxPosts || 8;
      posts = await (researcher as TikTokResearcher).searchAndDeepScrape(query, query, maxDeep);
    } else if (platform === 'tiktok') {
      posts = await (researcher as TikTokResearcher).extractVisibleVideos(query);
    } else if (platform === 'twitter') {
      posts = await (researcher as TwitterResearcher).extractVisibleTweets(query);
    } else {
      // threads and others — try extractVisibleTweets then fall back to extractVisiblePosts
      const r = researcher as any;
      posts = typeof r.extractVisibleTweets === 'function'
        ? await r.extractVisibleTweets(query)
        : typeof r.extractVisiblePosts === 'function'
          ? await r.extractVisiblePosts(query)
          : [];
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

  const existingForPlatform = runningByPlatform.get(platform);
  if (existingForPlatform && existingForPlatform.status === 'running') {
    res.status(409).json({ error: 'A research job is already running for this platform', currentJob: { id: existingForPlatform.id, platform } });
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
  runningByPlatform.set(platform, job);
  currentJob = job;  // keep legacy field updated

  // sync:true — await results and return them directly (useful for tests and small configs)
  if (config?.sync === true) {
    try {
      const researcher = createResearcher(platform, config || {});
      const result = await (researcher as any).researchNiche(niche);
      const filepath = await (researcher as any).saveResults([result], 'niche');
      job.status = 'completed';
      job.completedAt = new Date().toISOString();
      job.durationMs = Date.now() - new Date(job.startedAt).getTime();
      job.resultFile = filepath;
      job.progress = { currentNiche: niche, nichesCompleted: 1, totalNiches: 1 };
      runningByPlatform.delete(platform);
      if (currentJob?.id === job.id) currentJob = null;
      res.json({ success: true, jobId: job.id, platform, niche,
        topCreators: result.creators || [], tweets: result.tweets || [],
        durationMs: job.durationMs });
    } catch (e) {
      job.status = 'failed';
      job.error = String(e);
      job.completedAt = new Date().toISOString();
      runningByPlatform.delete(platform);
      if (currentJob?.id === job.id) currentJob = null;
      res.status(500).json({ error: String(e), platform, niche });
    }
    return;
  }

  // Return immediately with job ID (async default)
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
  runningByPlatform.delete(platform);
  if (currentJob?.id === job.id) currentJob = null;
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

// ─── Twitter top-100 creators (sync, 10 niches × 10 creators) ───

app.post('/api/research/twitter/top100', async (req: Request, res: Response) => {
  const existingForPlatform = runningByPlatform.get('twitter');
  if (existingForPlatform && existingForPlatform.status === 'running') {
    res.status(409).json({ error: 'A Twitter research job is already running', currentJob: { id: existingForPlatform.id } });
    return;
  }

  const {
    niches: reqNiches,
    postsPerNiche = 20,
    creatorsPerNiche = 10,
    enrichTopCreators = 10,
    config: extraConfig = {},
  } = req.body;

  const TWITTER_NICHES_DEFAULT = [
    'AI automation',
    'AI copywriting',
    'content marketing',
    'solopreneur',
    'personal branding',
    'digital marketing',
    'social media growth',
    'email marketing',
    'entrepreneurship',
    'creator economy',
  ];
  const niches: string[] = (reqNiches && Array.isArray(reqNiches) && reqNiches.length > 0)
    ? reqNiches.slice(0, 10)
    : TWITTER_NICHES_DEFAULT;

  const job: ResearchJob = {
    id: generateJobId(),
    platform: 'twitter',
    niches,
    status: 'running',
    startedAt: new Date().toISOString(),
    progress: { currentNiche: niches[0], nichesCompleted: 0, totalNiches: niches.length },
  };
  jobs.set(job.id, job);
  runningByPlatform.set('twitter', job);
  currentJob = job;

  console.log(`[top100] Starting Twitter top-100: ${niches.length} niches × ${creatorsPerNiche} creators each`);

  try {
    const researcher = new TwitterResearcher({
      tweetsPerNiche: postsPerNiche,
      creatorsPerNiche,
      enrichTopCreators,
      scrollPauseMs: 1500,
      maxScrollsPerSearch: 50,
      ...extraConfig,
    });

    const allCreators: any[] = [];
    const nicheResults: any[] = [];

    for (let i = 0; i < niches.length; i++) {
      const niche = niches[i];
      job.progress = { currentNiche: niche, nichesCompleted: i, totalNiches: niches.length };
      console.log(`[top100] Niche ${i + 1}/${niches.length}: "${niche}"`);
      try {
        const result = await researcher.researchNiche(niche);
        nicheResults.push({ niche, creatorCount: result.creators.length, tweetCount: result.tweets.length });
        for (const c of result.creators) {
          allCreators.push(c);
        }
      } catch (e) {
        console.log(`[top100] Niche "${niche}" failed: ${e}`);
        nicheResults.push({ niche, error: String(e) });
      }
      if (i < niches.length - 1) await new Promise(r => setTimeout(r, 2000));
    }

    // Deduplicate and merge creators across niches (by handle, keep highest engagement)
    const merged = new Map<string, any>();
    for (const c of allCreators) {
      const existing = merged.get(c.handle);
      if (!existing || c.totalEngagement > existing.totalEngagement) {
        merged.set(c.handle, c);
      }
    }
    const top100 = Array.from(merged.values())
      .sort((a, b) => b.totalEngagement - a.totalEngagement)
      .slice(0, 100);

    job.status = 'completed';
    job.completedAt = new Date().toISOString();
    job.durationMs = Date.now() - new Date(job.startedAt).getTime();
    job.progress = { currentNiche: niches[niches.length - 1], nichesCompleted: niches.length, totalNiches: niches.length };
    runningByPlatform.delete('twitter');
    if (currentJob?.id === job.id) currentJob = null;

    res.json({
      success: true,
      jobId: job.id,
      platform: 'twitter',
      niches,
      topCreators: top100,
      nicheResults,
      totalCreators: top100.length,
      durationMs: job.durationMs,
    });
  } catch (e) {
    job.status = 'failed';
    job.error = String(e);
    job.completedAt = new Date().toISOString();
    runningByPlatform.delete('twitter');
    if (currentJob?.id === job.id) currentJob = null;
    res.status(500).json({ error: String(e) });
  }
});

// ─── Threads top-100 creators (sync, 10 niches × 10 creators) ───

app.post('/api/research/threads/top100', async (req: Request, res: Response) => {
  const existingForPlatform = runningByPlatform.get('threads');
  if (existingForPlatform && existingForPlatform.status === 'running') {
    res.status(409).json({ error: 'A Threads research job is already running', currentJob: { id: existingForPlatform.id } });
    return;
  }

  const {
    niches: reqNiches,
    postsPerNiche = 20,
    creatorsPerNiche = 10,
    enrichTopCreators = 10,
    config: extraConfig = {},
  } = req.body;

  const THREADS_NICHES_DEFAULT = [
    'AI tools',
    'content creation',
    'solopreneur',
    'personal branding',
    'digital marketing',
    'entrepreneurship',
    'social media growth',
    'productivity',
    'creator economy',
    'business growth',
  ];
  const niches: string[] = (reqNiches && Array.isArray(reqNiches) && reqNiches.length > 0)
    ? reqNiches.slice(0, 10)
    : THREADS_NICHES_DEFAULT;

  const job: ResearchJob = {
    id: generateJobId(),
    platform: 'threads',
    niches,
    status: 'running',
    startedAt: new Date().toISOString(),
    progress: { currentNiche: niches[0], nichesCompleted: 0, totalNiches: niches.length },
  };
  jobs.set(job.id, job);
  runningByPlatform.set('threads', job);
  currentJob = job;

  console.log(`[top100-threads] Starting Threads top-100: ${niches.length} niches × ${creatorsPerNiche} creators each`);

  try {
    const researcher = new ThreadsResearcher({
      postsPerNiche,
      creatorsPerNiche,
      enrichTopCreators,
      scrollPauseMs: 1500,
      maxScrollsPerSearch: 50,
      ...extraConfig,
    });

    const allCreators: any[] = [];
    const nicheResults: any[] = [];

    for (let i = 0; i < niches.length; i++) {
      const niche = niches[i];
      job.progress = { currentNiche: niche, nichesCompleted: i, totalNiches: niches.length };
      console.log(`[top100-threads] Niche ${i + 1}/${niches.length}: "${niche}"`);
      try {
        const result = await researcher.researchNiche(niche);
        nicheResults.push({ niche, creatorCount: result.creators.length, postCount: result.posts.length });
        for (const c of result.creators) allCreators.push(c);
      } catch (e) {
        console.log(`[top100-threads] Niche "${niche}" failed: ${e}`);
        nicheResults.push({ niche, error: String(e) });
      }
      if (i < niches.length - 1) await new Promise(r => setTimeout(r, 2000));
    }

    // Deduplicate by handle, keep highest engagement
    const merged = new Map<string, any>();
    for (const c of allCreators) {
      const existing = merged.get(c.handle);
      if (!existing || c.totalEngagement > existing.totalEngagement) merged.set(c.handle, c);
    }
    const top100 = Array.from(merged.values())
      .sort((a, b) => b.totalEngagement - a.totalEngagement)
      .slice(0, 100);

    job.status = 'completed';
    job.completedAt = new Date().toISOString();
    job.durationMs = Date.now() - new Date(job.startedAt).getTime();
    job.progress = { currentNiche: niches[niches.length - 1], nichesCompleted: niches.length, totalNiches: niches.length };
    runningByPlatform.delete('threads');
    if (currentJob?.id === job.id) currentJob = null;

    res.json({
      success: true,
      jobId: job.id,
      platform: 'threads',
      niches,
      topCreators: top100,
      nicheResults,
      totalCreators: top100.length,
      durationMs: job.durationMs,
    });
  } catch (e) {
    job.status = 'failed';
    job.error = String(e);
    job.completedAt = new Date().toISOString();
    runningByPlatform.delete('threads');
    if (currentJob?.id === job.id) currentJob = null;
    res.status(500).json({ error: String(e) });
  }
});

// ─── Instagram competitor research (account-specific) ───────────

app.post('/api/research/instagram/competitor', async (req: Request, res: Response) => {
  const existingForPlatform = runningByPlatform.get('instagram');
  if (existingForPlatform && existingForPlatform.status === 'running') {
    res.status(409).json({ error: 'An Instagram research job is already running', currentJob: { id: existingForPlatform.id } });
    return;
  }

  const {
    username,
    maxPosts = 100,
    detailedScrapeTop = 30,
  } = req.body;

  if (!username || typeof username !== 'string') {
    res.status(400).json({ error: 'username is required' });
    return;
  }

  const handle = username.replace(/^@/, '').trim();

  const job: ResearchJob = {
    id: generateJobId(),
    platform: 'instagram',
    niches: [handle],
    status: 'running',
    startedAt: new Date().toISOString(),
    progress: { currentNiche: handle, nichesCompleted: 0, totalNiches: 1 },
  };
  jobs.set(job.id, job);
  runningByPlatform.set('instagram', job);
  currentJob = job;

  console.log(`[competitor-ig] @${handle}: maxPosts=${maxPosts} detailedTop=${detailedScrapeTop}`);

  try {
    const researcher = new InstagramResearcher({ timeout: 45000 });
    const result = await researcher.competitorResearch(handle, maxPosts, detailedScrapeTop);

    job.status = 'completed';
    job.completedAt = new Date().toISOString();
    job.durationMs = Date.now() - new Date(job.startedAt).getTime();
    job.progress = { currentNiche: handle, nichesCompleted: 1, totalNiches: 1 };
    runningByPlatform.delete('instagram');
    if (currentJob?.id === job.id) currentJob = null;

    console.log(`[competitor-ig] @${handle} done: ${result.stats.totalCollected} posts, followers=${result.profile.followers}`);

    res.json({
      success: true,
      jobId: job.id,
      ...result,
      durationMs: job.durationMs,
    });
  } catch (e) {
    job.status = 'failed';
    job.error = String(e);
    job.completedAt = new Date().toISOString();
    runningByPlatform.delete('instagram');
    if (currentJob?.id === job.id) currentJob = null;
    res.status(500).json({ error: String(e) });
  }
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

// ═══════════════════════════════════════════════════════════════════
// MARKET RESEARCH EXTENDED API (trends, creators, hashtags, etc.)
// ═══════════════════════════════════════════════════════════════════

// ─── Get cross-platform trends ──────────────────────────────────

app.get('/api/research/trends', (_req: Request, res: Response) => {
  const files = listResultFiles();
  const nicheStats: Record<string, { posts: number; engagement: number; platforms: Set<string> }> = {};

  // Aggregate from cached result files
  for (const f of files.slice(0, 20)) {
    try {
      const filepath = path.join(DEFAULT_OUTPUT_DIR, f.filename);
      const data = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
      const niches = data.metadata?.niches || data.niches || [];
      for (const n of niches) {
        if (!nicheStats[n]) nicheStats[n] = { posts: 0, engagement: 0, platforms: new Set() };
        nicheStats[n].posts += data.metadata?.totalPosts || 10;
        nicheStats[n].engagement += data.metadata?.avgEngagement || 100;
        nicheStats[n].platforms.add(f.platform);
      }
    } catch { /* skip unreadable */ }
  }

  const trends = Object.entries(nicheStats)
    .map(([niche, stats]) => ({
      niche,
      posts: stats.posts,
      avg_engagement: Math.round(stats.engagement / Math.max(1, stats.platforms.size)),
      platforms: Array.from(stats.platforms),
    }))
    .sort((a, b) => b.avg_engagement - a.avg_engagement)
    .slice(0, 20);

  res.json({ trends, count: trends.length, updated_at: new Date().toISOString() });
});

// ─── Get top creators for niche ─────────────────────────────────

app.post('/api/research/top-creators', async (req: Request, res: Response) => {
  const { niche, platform, limit: maxCreators = 20 } = req.body;
  if (!niche) {
    res.status(400).json({ error: 'Missing required field: niche', message: 'niche is required' });
    return;
  }

  // Try to find cached results first
  const targetPlatform = platform || 'twitter';
  const files = listResultFiles(targetPlatform);
  let creators: any[] = [];

  for (const f of files.slice(0, 5)) {
    try {
      const filepath = path.join(DEFAULT_OUTPUT_DIR, f.filename);
      const data = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
      const nicheData = data.niches?.[niche] || data.results?.find((r: any) => r.niche === niche);
      if (nicheData?.creators) {
        creators.push(...nicheData.creators);
      }
    } catch { /* skip */ }
  }

  creators = creators
    .sort((a, b) => (b.totalEngagement || b.engagement || 0) - (a.totalEngagement || a.engagement || 0))
    .slice(0, maxCreators);

  res.json({ creators, count: creators.length, niche, platform: targetPlatform });
});

// ─── Run competitor research job (async) ────────────────────────

app.post('/api/research/competitor', async (req: Request, res: Response) => {
  const { niche, platform, handles } = req.body;
  if (!niche) {
    res.status(400).json({ error: 'Missing required field: niche', message: 'niche is required' });
    return;
  }

  const job: ResearchJob = {
    id: generateJobId(),
    platform: platform || 'all',
    niches: [niche],
    status: 'queued',
    startedAt: new Date().toISOString(),
    progress: { currentNiche: niche, nichesCompleted: 0, totalNiches: 1 },
  };
  jobs.set(job.id, job);

  res.json({ job_id: job.id, status: 'queued', niche, platform: platform || 'all' });

  // Would run async research in background
  job.status = 'running';
});

// ─── Poll job status ────────────────────────────────────────────

app.get('/api/research/jobs/:jobId', (req: Request, res: Response) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }
  res.json({
    job_id: job.id,
    status: job.status,
    platform: job.platform,
    progress: job.progress,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    durationMs: job.durationMs,
    resultFile: job.resultFile,
    error: job.error,
  });
});

// ─── Get engagement stats for post ──────────────────────────────

app.get('/api/research/post', async (req: Request, res: Response) => {
  const url = req.query.url as string;
  if (!url) {
    res.status(400).json({ error: 'Missing required field: url', message: 'url query parameter is required' });
    return;
  }

  // Determine platform from URL
  let platform = 'unknown';
  if (url.includes('twitter.com') || url.includes('x.com')) platform = 'twitter';
  else if (url.includes('instagram.com')) platform = 'instagram';
  else if (url.includes('tiktok.com')) platform = 'tiktok';
  else if (url.includes('threads.net')) platform = 'threads';
  else if (url.includes('facebook.com')) platform = 'facebook';

  res.json({
    url,
    platform,
    likes: 0,
    views: 0,
    comments: 0,
    shares: 0,
    engagement_rate: 0,
    fetched_at: new Date().toISOString(),
    note: 'Live metrics require Safari automation session',
  });
});

// ─── Get niche performance summary ──────────────────────────────

app.get('/api/research/niches/:niche', (req: Request, res: Response) => {
  const niche = decodeURIComponent(req.params.niche);
  const files = listResultFiles();

  let totalViews = 0;
  let totalPosts = 0;
  const formats: Record<string, number> = {};

  for (const f of files.slice(0, 10)) {
    try {
      const filepath = path.join(DEFAULT_OUTPUT_DIR, f.filename);
      const data = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
      if (data.metadata?.niches?.includes(niche) || data.niche === niche) {
        totalViews += data.metadata?.totalViews || 0;
        totalPosts += data.metadata?.totalPosts || 0;
        if (data.topFormats) {
          for (const fmt of data.topFormats) {
            formats[fmt.format] = (formats[fmt.format] || 0) + fmt.count;
          }
        }
      }
    } catch { /* skip */ }
  }

  const topFormats = Object.entries(formats)
    .map(([format, count]) => ({ format, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  res.json({
    niche,
    avg_views: totalPosts > 0 ? Math.round(totalViews / totalPosts) : 0,
    total_posts: totalPosts,
    top_formats: topFormats,
    updated_at: new Date().toISOString(),
  });
});

// ─── Get trending hashtags by platform ──────────────────────────

app.get('/api/research/hashtags/:platform', (req: Request, res: Response) => {
  const platform = req.params.platform;
  if (!PLATFORMS.includes(platform as Platform)) {
    res.status(400).json({ error: `Invalid platform. Must be one of: ${PLATFORMS.join(', ')}`, message: `Invalid enum value: ${platform}` });
    return;
  }

  const files = listResultFiles(platform);
  const hashtagCounts: Record<string, number> = {};

  for (const f of files.slice(0, 5)) {
    try {
      const filepath = path.join(DEFAULT_OUTPUT_DIR, f.filename);
      const data = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
      const hashtags = data.metadata?.hashtags || data.hashtags || [];
      for (const tag of hashtags) {
        hashtagCounts[tag] = (hashtagCounts[tag] || 0) + 1;
      }
    } catch { /* skip */ }
  }

  const trending = Object.entries(hashtagCounts)
    .map(([hashtag, count]) => ({ hashtag, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 30);

  res.json({ platform, trending, count: trending.length });
});

// ─── Batch keyword search ───────────────────────────────────────

app.post('/api/research/batch', async (req: Request, res: Response) => {
  const { keywords, platform, config } = req.body;
  if (!keywords || !Array.isArray(keywords) || keywords.length === 0) {
    res.status(400).json({ error: 'Missing required field: keywords', message: 'keywords array is required' });
    return;
  }

  const targetPlatform = (platform || 'twitter') as Platform;
  if (!PLATFORMS.includes(targetPlatform)) {
    res.status(400).json({ error: `Invalid platform. Must be one of: ${PLATFORMS.join(', ')}`, message: `Invalid enum value: ${platform}` });
    return;
  }

  const results: Record<string, any> = {};
  for (const kw of keywords) {
    results[kw] = { keyword: kw, posts: [], count: 0, note: 'Live search requires Safari session' };
  }

  res.json({ platform: targetPlatform, keywords, results, total_keywords: keywords.length });
});

// ─── Get niche resonance score ──────────────────────────────────

app.get('/api/research/resonance/:niche/:platform', (req: Request, res: Response) => {
  const niche = decodeURIComponent(req.params.niche);
  const platform = req.params.platform;

  if (!PLATFORMS.includes(platform as Platform)) {
    res.status(400).json({ error: `Invalid platform. Must be one of: ${PLATFORMS.join(', ')}`, message: `Invalid enum value: ${platform}` });
    return;
  }

  // Calculate score from cached data
  const files = listResultFiles(platform);
  let score = 50; // default mid-score

  for (const f of files.slice(0, 3)) {
    try {
      const filepath = path.join(DEFAULT_OUTPUT_DIR, f.filename);
      const data = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
      if (data.metadata?.niches?.includes(niche)) {
        const engagement = data.metadata?.avgEngagement || 0;
        score = Math.min(100, Math.max(0, Math.round(engagement / 100)));
      }
    } catch { /* skip */ }
  }

  res.json({ niche, platform, score, max_score: 100, calculated_at: new Date().toISOString() });
});

// ─── Get top posts for keyword ──────────────────────────────────

app.post('/api/research/top-posts', async (req: Request, res: Response) => {
  const { keyword, platform, limit: maxPosts = 20 } = req.body;
  if (!keyword) {
    res.status(400).json({ error: 'Missing required field: keyword', message: 'keyword is required' });
    return;
  }

  const targetPlatform = platform || 'twitter';
  res.json({
    keyword,
    platform: targetPlatform,
    posts: [],
    count: 0,
    note: 'Live search requires Safari session',
  });
});

// ─── Get creator engagement score ───────────────────────────────

app.get('/api/research/creator/:handle', (req: Request, res: Response) => {
  const handle = req.params.handle.replace(/^@/, '');

  // Look through cached results for this creator
  const files = listResultFiles();
  let totalEngagement = 0;
  let postCount = 0;

  for (const f of files.slice(0, 10)) {
    try {
      const filepath = path.join(DEFAULT_OUTPUT_DIR, f.filename);
      const data = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
      // Search through creators in results
      const allCreators = data.creators || [];
      for (const c of allCreators) {
        if (c.handle === handle || c.handle === `@${handle}`) {
          totalEngagement += c.totalEngagement || 0;
          postCount += c.postCount || c.tweetCount || 0;
        }
      }
    } catch { /* skip */ }
  }

  res.json({
    handle,
    total_engagement: totalEngagement,
    avg_per_post: postCount > 0 ? Math.round(totalEngagement / postCount) : 0,
    post_count: postCount,
    fetched_at: new Date().toISOString(),
  });
});

// ═══════════════════════════════════════════════════════════════════
// SESSION MANAGEMENT
// ═══════════════════════════════════════════════════════════════════

app.post('/api/sessions', (_req: Request, res: Response) => {
  const session: BrowserSession = {
    id: generateSessionId(),
    createdAt: new Date().toISOString(),
    lastAccessedAt: new Date().toISOString(),
    state: {},
  };
  sessions.set(session.id, session);
  res.json({ sessionId: session.id, createdAt: session.createdAt });
});

app.get('/api/sessions', (_req: Request, res: Response) => {
  cleanExpiredSessions();
  const active = Array.from(sessions.values()).map(s => ({
    id: s.id,
    createdAt: s.createdAt,
    lastAccessedAt: s.lastAccessedAt,
    platform: s.platform,
  }));
  res.json({ sessions: active, count: active.length });
});

app.get('/api/sessions/:sessionId', (req: Request, res: Response) => {
  const session = sessions.get(req.params.sessionId);
  if (!session) {
    res.status(404).json({ error: 'Session not found or expired' });
    return;
  }

  // Check if expired
  if (Date.now() - new Date(session.lastAccessedAt).getTime() > SESSION_TIMEOUT_MS) {
    sessions.delete(req.params.sessionId);
    res.status(404).json({ error: 'Session expired' });
    return;
  }

  session.lastAccessedAt = new Date().toISOString();
  res.json({ session });
});

app.delete('/api/sessions/:sessionId', (req: Request, res: Response) => {
  const existed = sessions.delete(req.params.sessionId);
  res.json({ success: true, removed: existed });
});

// ─── Rate limit info endpoint ───────────────────────────────────

app.get('/api/rate-limits', (_req: Request, res: Response) => {
  const accounts: Record<string, DailyCap> = {};
  const keys = Array.from(dailyCaps.keys());
  for (const key of keys) {
    accounts[key] = dailyCaps.get(key)!;
  }
  res.json({
    window_ms: RATE_LIMIT_WINDOW_MS,
    max_per_window: RATE_LIMIT_MAX,
    accounts,
  });
});

// ═══════════════════════════════════════════════════════════════════
// AI FEATURES
// ═══════════════════════════════════════════════════════════════════

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';

app.post('/api/ai/suggest-reply', async (req: Request, res: Response) => {
  const { context, platform, niche, max_length } = req.body;
  if (!context) {
    res.status(400).json({ error: 'Missing required field: context', message: 'context is required' });
    return;
  }

  const platformLimits: Record<string, number> = {
    twitter: 280,
    instagram: 2200,
    tiktok: 150,
    threads: 500,
    facebook: 63206,
  };
  const charLimit = max_length || platformLimits[platform as string] || 500;

  if (!ANTHROPIC_API_KEY) {
    res.status(503).json({
      error: 'AI service unavailable',
      message: 'ANTHROPIC_API_KEY not configured',
      fallback: `Thanks for sharing! This resonates with the ${niche || 'general'} community.`,
    });
    return;
  }

  try {
    const body = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: `Generate a reply for a ${platform || 'social media'} post in the ${niche || 'general'} niche. Context: ${context}. Keep it under ${charLimit} characters. Return only the reply text.`,
      }],
    });

    const response = await new Promise<string>((resolve, reject) => {
      const req = https.request({
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Length': Buffer.byteLength(body),
        },
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => resolve(data));
      });
      req.on('error', reject);
      req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
      req.write(body);
      req.end();
    });

    const result = JSON.parse(response);
    const text = result.content?.[0]?.text || '';

    res.json({
      reply: text.slice(0, charLimit),
      model_used: 'claude-haiku-4-5-20251001',
      char_count: Math.min(text.length, charLimit),
      char_limit: charLimit,
      platform: platform || 'general',
    });
  } catch (e) {
    res.status(503).json({
      error: 'AI generation failed',
      message: String(e),
      fallback: `Great insight on ${niche || 'this topic'}! Would love to discuss further.`,
    });
  }
});

app.post('/api/ai/score', async (req: Request, res: Response) => {
  const { content, platform, niche, criteria } = req.body;
  if (!content) {
    res.status(400).json({ error: 'Missing required field: content', message: 'content is required' });
    return;
  }

  if (!ANTHROPIC_API_KEY) {
    // Return a deterministic score based on content length as fallback
    const score = Math.min(100, Math.max(0, Math.round((content.length / 10) * 5 + 30)));
    res.json({
      score,
      model_used: 'fallback-heuristic',
      reasoning: ['Score based on content length heuristic', `Content has ${content.length} characters`],
      signals: ['length_analysis'],
    });
    return;
  }

  try {
    const body = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: `Score this ${platform || 'social media'} content for the ${niche || 'general'} niche on a scale of 0-100. Content: "${content}". Respond with ONLY JSON: {"score": <number>, "reasoning": ["<reason1>", "<reason2>"], "signals": ["<signal1>"]}`,
      }],
    });

    const response = await new Promise<string>((resolve, reject) => {
      const req = https.request({
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Length': Buffer.byteLength(body),
        },
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => resolve(data));
      });
      req.on('error', reject);
      req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
      req.write(body);
      req.end();
    });

    const result = JSON.parse(response);
    const text = result.content?.[0]?.text || '';
    const parsed = JSON.parse(text);
    const score = Math.min(100, Math.max(0, Math.round(parsed.score || 50)));

    res.json({
      score,
      model_used: 'claude-haiku-4-5-20251001',
      reasoning: parsed.reasoning || ['AI analysis complete'],
      signals: parsed.signals || ['content_quality'],
    });
  } catch (e) {
    const score = Math.min(100, Math.max(0, Math.round((content.length / 10) * 5 + 30)));
    res.json({
      score,
      model_used: 'fallback-heuristic',
      reasoning: ['Fallback scoring due to AI error', String(e)],
      signals: ['length_analysis'],
    });
  }
});

// ═══════════════════════════════════════════════════════════════════
// TAB COORDINATION
// ═══════════════════════════════════════════════════════════════════

app.get('/api/tabs/claims', async (_req, res) => {
  const claims = await TabCoordinator.listClaims();
  res.json({ claims, count: claims.length });
});

app.post('/api/tabs/claim', async (req, res) => {
  const { agentId, windowIndex, tabIndex } = req.body;
  if (!agentId) { res.status(400).json({ error: 'agentId required' }); return; }
  try {
    let coord = activeCoordinators.get(agentId);
    if (!coord) {
      coord = new TabCoordinator(agentId, SERVICE_NAME, SERVICE_PORT, SESSION_URL_PATTERN);
      activeCoordinators.set(agentId, coord);
    }
    const claim = await coord.claim(windowIndex, tabIndex);
    res.json({ ok: true, claim });
  } catch (error) {
    res.status(409).json({ ok: false, error: String(error) });
  }
});

app.post('/api/tabs/release', async (req, res) => {
  const { agentId } = req.body;
  if (!agentId) { res.status(400).json({ error: 'agentId required' }); return; }
  const coord = activeCoordinators.get(agentId);
  if (coord) { await coord.release(); activeCoordinators.delete(agentId); }
  res.json({ ok: true });
});

app.post('/api/tabs/heartbeat', async (req, res) => {
  const { agentId } = req.body;
  if (!agentId) { res.status(400).json({ error: 'agentId required' }); return; }
  const coord = activeCoordinators.get(agentId);
  if (!coord) { res.status(404).json({ error: `No claim for '${agentId}'` }); return; }
  await coord.heartbeat();
  res.json({ ok: true, heartbeat: Date.now() });
});

app.get('/api/session/status', (req, res) => {
  const info = getTabDriver().getSessionInfo();
  res.json({
    tracked: !!(info?.windowIndex),
    windowIndex: info?.windowIndex ?? null,
    tabIndex: info?.tabIndex ?? null,
    sessionUrlPattern: SESSION_URL_PATTERN,
  });
});

app.post('/api/session/ensure', async (req, res) => {
  try {
    const info = await getTabDriver().ensureActiveSession(SESSION_URL_PATTERN);
    res.json({
      ok: info.found,
      windowIndex: info.windowIndex,
      tabIndex: info.tabIndex,
      url: info.url,
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.post('/api/session/clear', (req, res) => {
  getTabDriver().clearTrackedSession();
  res.json({ ok: true, message: 'Tracked session cleared' });
});

app.post('/api/debug/eval', async (req, res) => {
  try {
    const { js } = req.body;
    if (!js) { res.status(400).json({ error: 'js required' }); return; }
    const result = await getTabDriver().executeJS(js);
    res.json({ result });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// Global 30s heartbeat refresh
setInterval(async () => {
  for (const [id, coord] of activeCoordinators) {
    try { await coord.heartbeat(); }
    catch { activeCoordinators.delete(id); }
  }
}, 30_000);

// ═══════════════════════════════════════════════════════════════════
// ERROR HANDLING (must come after all routes)
// ═══════════════════════════════════════════════════════════════════

// 404 handler for unknown routes
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found', message: `Route not found: ${_req.method} ${_req.path}` });
});

// Global error handler — no stack traces in production
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error(`[Error] ${err.message || err}`);
  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    error: status === 500 ? 'Internal server error' : (err.message || 'Unknown error'),
    message: err.message || 'An unexpected error occurred',
  });
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

    // Queue and AutoScheduler do NOT auto-start on boot.
    // They must be explicitly started by an external server:
    //   POST /api/queue/control/start
    //   POST /api/scheduler/start
    // To opt-in to auto-start (e.g. in a dedicated worker environment),
    // set env var: SAFARI_AUTO_START=true
    if (process.env.SAFARI_AUTO_START === 'true') {
      startAutoScheduler();
      taskQueue.start();
      console.log('[Server] ⚠️  SAFARI_AUTO_START=true — queue and scheduler started automatically');
    } else {
      console.log('[Server] 🔒 Queue and scheduler are PAUSED — start them via API when ready');
    }
  });
}

if (process.argv[1]?.includes('server')) startServer();

export { app };
