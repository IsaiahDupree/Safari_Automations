/**
 * Threads Comment API Server
 * Port: 3004
 *
 * Full-featured REST API for Threads automation via Safari with:
 *   - Bearer token authentication
 *   - Input validation & sanitization
 *   - Rate limit headers & 429 enforcement
 *   - Session management
 *   - Structured error responses (always JSON)
 *   - CORS support
 *   - AI comment generation & scoring
 *   - Supabase CRM integration
 */

import { config as _dotenv } from 'dotenv'; _dotenv({ override: true });
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { ThreadsDriver, DEFAULT_CONFIG, type ThreadsConfig, type CommentResult } from '../automation/threads-driver.js';
import { ThreadsAutoCommenter } from '../automation/threads-auto-commenter.js';
import { ThreadsAICommentGenerator } from '../automation/ai-comment-generator.js';
import { CommentLogger } from '../db/comment-logger.js';
import { discoverProspects, scoreICP, ICP_KEYWORDS } from './prospect-discovery.js';
import { TabCoordinator } from '../automation/tab-coordinator.js';
import { SafariDriver } from '../automation/safari-driver.js';

const app = express();

// ═══════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════

const PORT = parseInt(process.env.THREADS_COMMENTS_PORT || process.env.PORT || '3004');
const SERVICE_VERSION = '1.2.0';
const PLATFORM_CHAR_LIMIT = 500;
const MAX_INPUT_LENGTH = 10000;
const AUTH_TOKEN = process.env.THREADS_AUTH_TOKEN || process.env.AUTH_TOKEN || 'threads-local-dev-token';
const startedAt = new Date().toISOString();
const SERVICE_NAME = 'threads-comments';
const SERVICE_PORT = 3004;
const SESSION_URL_PATTERN = 'threads.com';
const activeCoordinators = new Map<string, TabCoordinator>();

const STABLE_AGENT_ID = 'threads-comments-stable';
let stableCoord: InstanceType<typeof TabCoordinator> | null = null;
setInterval(async () => { try { if (stableCoord) await stableCoord.heartbeat(); } catch {} }, 30_000);
let tabDriver: SafariDriver | null = null;
function getTabDriver(): SafariDriver {
  if (!tabDriver) tabDriver = new SafariDriver();
  return tabDriver;
}

// ═══════════════════════════════════════════════════════════════
// Rate Limiter (per-IP sliding window)
// ═══════════════════════════════════════════════════════════════

interface RateLimitBucket {
  requests: number[];
}

const rateLimitStore = new Map<string, RateLimitBucket>();
const RATE_LIMIT = 60; // requests per minute
const RATE_WINDOW_MS = 60_000;

function getRateLimitInfo(ip: string): { remaining: number; limit: number; resetMs: number } {
  const now = Date.now();
  let bucket = rateLimitStore.get(ip);
  if (!bucket) {
    bucket = { requests: [] };
    rateLimitStore.set(ip, bucket);
  }
  // Prune old requests
  bucket.requests = bucket.requests.filter(t => t > now - RATE_WINDOW_MS);
  const remaining = Math.max(0, RATE_LIMIT - bucket.requests.length);
  const oldestInWindow = bucket.requests[0] || now;
  const resetMs = oldestInWindow + RATE_WINDOW_MS - now;
  return { remaining, limit: RATE_LIMIT, resetMs: Math.max(1, Math.ceil(resetMs / 1000)) };
}

function recordRequest(ip: string): void {
  const bucket = rateLimitStore.get(ip) || { requests: [] };
  bucket.requests.push(Date.now());
  rateLimitStore.set(ip, bucket);
}

// ═══════════════════════════════════════════════════════════════
// Session Manager
// ═══════════════════════════════════════════════════════════════

interface Session {
  id: string;
  createdAt: string;
  lastAccessedAt: string;
  platform: string;
}

const sessions = new Map<string, Session>();
const SESSION_EXPIRY_MS = 30 * 60 * 1000; // 30 minutes

function createSession(): Session {
  const id = `sess_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
  const session: Session = {
    id,
    createdAt: new Date().toISOString(),
    lastAccessedAt: new Date().toISOString(),
    platform: 'threads',
  };
  sessions.set(id, session);
  return session;
}

function getSession(id: string): Session | null {
  const session = sessions.get(id);
  if (!session) return null;
  const elapsed = Date.now() - new Date(session.lastAccessedAt).getTime();
  if (elapsed > SESSION_EXPIRY_MS) {
    sessions.delete(id);
    return null;
  }
  session.lastAccessedAt = new Date().toISOString();
  return session;
}

// Clean up expired sessions periodically
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - new Date(session.lastAccessedAt).getTime() > SESSION_EXPIRY_MS) {
      sessions.delete(id);
    }
  }
}, 60_000);

// ═══════════════════════════════════════════════════════════════
// Idempotency tracking
// ═══════════════════════════════════════════════════════════════

const recentActions = new Map<string, { result: unknown; expiresAt: number }>();

function getIdempotencyKey(action: string, ...args: string[]): string {
  return `${action}:${args.join(':')}`;
}

function getCachedAction(key: string): unknown | null {
  const entry = recentActions.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    recentActions.delete(key);
    return null;
  }
  return entry.result;
}

function cacheAction(key: string, result: unknown, ttlMs = 60_000): void {
  recentActions.set(key, { result, expiresAt: Date.now() + ttlMs });
}

// Clean old entries
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of recentActions) {
    if (now > entry.expiresAt) recentActions.delete(key);
  }
}, 30_000);

// ═══════════════════════════════════════════════════════════════
// Middleware
// ═══════════════════════════════════════════════════════════════

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset', 'Retry-After'],
}));

// Parse JSON with content-type enforcement
app.use((req: Request, res: Response, next: NextFunction) => {
  if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.headers['content-length'] && parseInt(req.headers['content-length']) > 0) {
    const ct = req.headers['content-type'] || '';
    if (!ct.includes('application/json') && req.path !== '/health') {
      res.status(415).json({ error: 'Unsupported Media Type', message: 'Content-Type must be application/json' });
      return;
    }
  }
  next();
});

app.use(express.json({ limit: '1mb' }));

// JSON parse error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  if (err instanceof SyntaxError && 'body' in err) {
    res.status(400).json({ error: 'Bad Request', message: 'Invalid JSON body' });
    return;
  }
  next(err);
});

// Rate limit headers on every response
app.use((req: Request, res: Response, next: NextFunction) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const info = getRateLimitInfo(ip);

  res.setHeader('X-RateLimit-Limit', String(info.limit));
  res.setHeader('X-RateLimit-Remaining', String(info.remaining));
  res.setHeader('X-RateLimit-Reset', String(info.resetMs));

  if (info.remaining <= 0 && req.path !== '/health') {
    res.setHeader('Retry-After', String(info.resetMs));
    res.status(429).json({
      error: 'Too Many Requests',
      message: `Rate limit exceeded. Try again in ${info.resetMs}s`,
      retryAfter: info.resetMs,
    });
    return;
  }

  recordRequest(ip);
  next();
});

// Auth middleware (skip for health, OPTIONS)
const AUTH_EXEMPT_PATHS = /^\/health$|^\/api\/session\/|^\/api\/tabs\/|^\/api\/[^/]+\/status$/;

function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Skip auth for health, OPTIONS, and internal tab coordination endpoints
  if (req.method === 'OPTIONS' || AUTH_EXEMPT_PATHS.test(req.path)) {
    next();
    return;
  }

  // Reject token in query param
  if (req.query.token) {
    res.status(401).json({ error: 'Unauthorized', message: 'Token must be provided in Authorization header, not query params' });
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader) {
    res.status(401).json({ error: 'Unauthorized', message: 'Authorization header required' });
    return;
  }

  if (!authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized', message: 'Authorization must use Bearer scheme' });
    return;
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    res.status(401).json({ error: 'Unauthorized', message: 'Bearer token is empty' });
    return;
  }

  if (token !== AUTH_TOKEN) {
    res.status(401).json({ error: 'Unauthorized', message: 'Invalid token' });
    return;
  }

  next();
}

app.use(authMiddleware);

// ── Tab claim enforcement ─────────────────────────────────────────────────────
// Every automation route MUST have an active tab claim before it runs.
// On first request: auto-claims an existing tab OR opens a new one.
// Subsequent requests: validates the claim is still alive.
// Routes exempt: /health, /api/tabs/*, /api/*/status, /api/*/rate-limits
const OPEN_URL = 'https://www.threads.com';
const CLAIM_EXEMPT = /^\/health$|^\/api\/tabs|^\/api\/[^\/]+\/status$|^\/api\/[^\/]+\/rate-limits/;

async function requireTabClaim(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (CLAIM_EXEMPT.test(req.path)) { next(); return; }

  const claims = await TabCoordinator.listClaims();
  const myClaim = claims.find(c => c.agentId === STABLE_AGENT_ID);

  if (myClaim) {
    // Claim exists — pin driver to the claimed tab and proceed
    getDriver().setTrackedTab(myClaim.windowIndex, myClaim.tabIndex, SESSION_URL_PATTERN);
    next();
    return;
  }

  // No claim — auto-claim now (open new tab if needed)
  try {
    if (!stableCoord) {
      stableCoord = new TabCoordinator(STABLE_AGENT_ID, SERVICE_NAME, PORT, SESSION_URL_PATTERN);
      activeCoordinators.set(STABLE_AGENT_ID, stableCoord);
    }
    const claim = await stableCoord.claim();
    getDriver().setTrackedTab(claim.windowIndex, claim.tabIndex, SESSION_URL_PATTERN);
    console.log(`[requireTabClaim] Stable claim: w=${claim.windowIndex} t=${claim.tabIndex}`);
    next();
  } catch (err) {
    res.status(503).json({
      error: 'No Safari tab available for threads-comments',
      detail: String(err),
      fix: `Open Safari and navigate to https://www.threads.com, or POST /api/tabs/claim with { agentId, openUrl: "https://www.threads.com" }`,
    });
  }
}

app.use(requireTabClaim);
// ─────────────────────────────────────────────────────────────────────────────


// ═══════════════════════════════════════════════════════════════
// Singletons
// ═══════════════════════════════════════════════════════════════

let driver: ThreadsDriver | null = null;
function getDriver(): ThreadsDriver {
  if (!driver) driver = new ThreadsDriver();
  return driver;
}

let autoCommenter: ThreadsAutoCommenter | null = null;
function getAutoCommenter(): ThreadsAutoCommenter {
  if (!autoCommenter) autoCommenter = new ThreadsAutoCommenter();
  return autoCommenter;
}

let aiGenerator: ThreadsAICommentGenerator | null = null;
function getAIGenerator(): ThreadsAICommentGenerator {
  if (!aiGenerator) {
    aiGenerator = new ThreadsAICommentGenerator({
      provider: process.env.OPENAI_API_KEY ? 'openai' : 'local',
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  return aiGenerator;
}

let commentLogger: CommentLogger | null = null;
function getCommentLogger(): CommentLogger {
  if (!commentLogger) commentLogger = new CommentLogger();
  return commentLogger;
}

// ═══════════════════════════════════════════════════════════════
// Validation helpers
// ═══════════════════════════════════════════════════════════════

function validateRequired(body: Record<string, unknown>, fields: string[]): string | null {
  for (const field of fields) {
    if (body[field] === undefined || body[field] === null) {
      return `${field} is required`;
    }
    if (typeof body[field] === 'string' && (body[field] as string).trim() === '') {
      return `${field} must not be empty`;
    }
  }
  return null;
}

function validateMaxLength(text: string, maxLen: number = MAX_INPUT_LENGTH): string | null {
  if (text.length > maxLen) {
    return `Text exceeds maximum length of ${maxLen} characters`;
  }
  return null;
}

function sanitizeText(text: string): string {
  // Escape HTML to prevent XSS — do NOT alter the actual text for storage/posting
  return text
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ═══════════════════════════════════════════════════════════════
// Error wrapper
// ═══════════════════════════════════════════════════════════════

function wrapAsync(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    const timeout = setTimeout(() => {
      if (!res.headersSent) {
        res.status(504).json({ error: 'Gateway Timeout', message: 'Request timed out after 30s' });
      }
    }, 30_000);

    fn(req, res)
      .catch((err) => {
        if (!res.headersSent) {
          const message = process.env.NODE_ENV === 'production'
            ? 'Internal Server Error'
            : (err instanceof Error ? err.message : String(err));
          res.status(500).json({ error: 'Internal Server Error', message });
        }
      })
      .finally(() => clearTimeout(timeout));
  };
}

// ═══════════════════════════════════════════════════════════════
// HEALTH (no auth required - handled above)
// ═══════════════════════════════════════════════════════════════

app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'threads-comments',
    version: SERVICE_VERSION,
    port: PORT,
    started_at: startedAt,
    uptime: Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000),
    timestamp: new Date().toISOString(),
  });
});

// ═══════════════════════════════════════════════════════════════
// STATUS
// ═══════════════════════════════════════════════════════════════

app.get('/api/threads/status', wrapAsync(async (req, res) => {
  const d = getDriver();
  const status = await d.getStatus();
  const rateLimits = d.getRateLimits();
  res.json({ ...status, commentsThisHour: rateLimits.commentsThisHour, commentsToday: rateLimits.commentsToday });
}));

// ═══════════════════════════════════════════════════════════════
// RATE LIMITS
// ═══════════════════════════════════════════════════════════════

app.get('/api/threads/rate-limits', (_req: Request, res: Response) => {
  const d = getDriver();
  const limits = d.getRateLimits();
  res.json({
    ...limits,
    daily_used: d.getDailyUsed(),
    hourly_used: d.getHourlyUsed(),
  });
});

app.put('/api/threads/rate-limits', (req: Request, res: Response) => {
  const d = getDriver();
  d.setConfig(req.body as Partial<ThreadsConfig>);
  res.json({ rateLimits: d.getConfig() });
});

// ═══════════════════════════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════════════════════════

app.post('/api/threads/navigate', wrapAsync(async (req, res) => {
  const { url, postUrl } = req.body;
  const target = url || postUrl;
  const err = validateRequired({ url: target }, ['url']);
  if (err) { res.status(400).json({ error: 'Bad Request', message: err }); return; }
  const success = await getDriver().navigateToPost(target);
  res.json({ success, url: target });
}));

// ═══════════════════════════════════════════════════════════════
// COMMENTS — post, get, reply, batch
// ═══════════════════════════════════════════════════════════════

app.get('/api/threads/comments', wrapAsync(async (req, res) => {
  const postUrl = req.query.postUrl as string | undefined;
  const limit = parseInt(req.query.limit as string) || 50;
  const d = getDriver();
  if (postUrl) {
    await d.navigateToPost(decodeURIComponent(postUrl));
    await new Promise(r => setTimeout(r, 3000));
  }
  const comments = await d.getComments(limit);
  res.json({ comments, count: comments.length });
}));

app.post('/api/threads/comments/post', wrapAsync(async (req, res) => {
  const { text, postUrl, dry_run, useAI, postContent, username } = req.body;

  // Dry-run mode
  if (dry_run) {
    const simText = text || 'This is great content! 🔥';
    res.json({
      success: true,
      commentId: `dry_${Date.now()}`,
      text: simText,
      dry_run: true,
      simulated: true,
    });
    return;
  }

  // AI generation if requested
  let commentText = text;
  if (useAI || !text) {
    const ai = getAIGenerator();
    const analysis = ai.analyzePost({
      mainPost: postContent || 'Thread post',
      username: username || 'user',
      replies: [],
    });
    commentText = await ai.generateComment(analysis);
  }

  const err = validateRequired({ text: commentText }, ['text']);
  if (err) { res.status(400).json({ error: 'Bad Request', message: err }); return; }

  const lenErr = validateMaxLength(commentText, MAX_INPUT_LENGTH);
  if (lenErr) { res.status(400).json({ error: 'Bad Request', message: lenErr }); return; }

  const d = getDriver();
  if (postUrl) {
    const navSuccess = await d.navigateToPost(postUrl);
    if (!navSuccess) { res.status(500).json({ error: 'Navigation failed', message: 'Failed to navigate to post' }); return; }
    await new Promise(r => setTimeout(r, 3000));
  }

  // Check idempotency
  const idKey = getIdempotencyKey('comment', postUrl || 'current', commentText);
  const cached = getCachedAction(idKey);
  if (cached) {
    res.json(cached);
    return;
  }

  const result = await d.postComment(commentText);
  const responseBody = {
    success: result.success,
    commentId: result.commentId,
    text: commentText.substring(0, 100),
    verified: result.verified,
    error: result.error,
  };

  if (result.success) {
    cacheAction(idKey, responseBody);

    // Log to Supabase
    const logger = getCommentLogger();
    await logger.logComment({
      platform: 'threads',
      username: username || '',
      postUrl,
      commentText,
      success: true,
    }).catch(() => {});
  }

  res.status(result.success ? 200 : 400).json(responseBody);
}));

app.post('/api/threads/comments/reply', wrapAsync(async (req, res) => {
  const { commentId, text, postUrl } = req.body;
  const err = validateRequired(req.body, ['text']);
  if (err) { res.status(400).json({ error: 'Bad Request', message: err }); return; }

  const d = getDriver();
  if (postUrl) {
    await d.navigateToPost(postUrl);
    await new Promise(r => setTimeout(r, 3000));
  }

  const result = await d.replyToComment(commentId || '', text);
  res.json({
    success: result.success,
    commentId: result.commentId,
    text: text.substring(0, 100),
    error: result.error,
  });
}));

app.post('/api/threads/batch-comment', wrapAsync(async (req, res) => {
  const { posts, delay_between_ms } = req.body;
  if (!Array.isArray(posts) || posts.length === 0) {
    res.status(400).json({ error: 'Bad Request', message: 'posts array is required and must not be empty' });
    return;
  }

  const d = getDriver();
  const results: Array<{ postUrl: string; success: boolean; commentId?: string; error?: string }> = [];
  const delayMs = delay_between_ms || 5000;

  for (let i = 0; i < posts.length; i++) {
    const { postUrl, text } = posts[i];
    if (!postUrl || !text) {
      results.push({ postUrl: postUrl || '', success: false, error: 'postUrl and text required' });
      continue;
    }

    // Rate limit check
    const rateCheck = d.checkRateLimit();
    if (!rateCheck.allowed) {
      results.push({ postUrl, success: false, error: rateCheck.reason });
      break;
    }

    await d.navigateToPost(postUrl);
    await new Promise(r => setTimeout(r, 3000));
    const result = await d.postComment(text);
    results.push({ postUrl, success: result.success, commentId: result.commentId, error: result.error });

    if (i < posts.length - 1) await new Promise(r => setTimeout(r, delayMs));
  }

  res.json({ success: true, results, total: posts.length, successful: results.filter(r => r.success).length });
}));

// ═══════════════════════════════════════════════════════════════
// SEARCH
// ═══════════════════════════════════════════════════════════════

app.post('/api/threads/search', wrapAsync(async (req, res) => {
  const { query, min_likes, max_results, scrolls } = req.body;
  const err = validateRequired(req.body, ['query']);
  if (err) { res.status(400).json({ error: 'Bad Request', message: err }); return; }

  const result = await getDriver().searchPosts(query, {
    minLikes: min_likes || 0,
    maxResults: max_results || 20,
    scrolls: scrolls || 3,
  });
  res.json({ success: true, posts: result.posts, query: result.query, count: result.posts.length });
}));

// ═══════════════════════════════════════════════════════════════
// TRENDING
// ═══════════════════════════════════════════════════════════════

app.get('/api/threads/trending', wrapAsync(async (_req, res) => {
  const topics = await getDriver().getTrending();
  res.json({ success: true, topics, count: topics.length });
}));

// ═══════════════════════════════════════════════════════════════
// PROFILE
// ═══════════════════════════════════════════════════════════════

app.get('/api/threads/profile', wrapAsync(async (_req, res) => {
  const profile = await getDriver().getOwnProfile();
  res.json(profile);
}));

app.get('/api/threads/profile/:handle', wrapAsync(async (req, res) => {
  const handle = req.params.handle;
  const profile = await getDriver().getCreatorProfile(handle);
  res.json(profile);
}));

// ═══════════════════════════════════════════════════════════════
// POST ENGAGEMENT & DETAIL
// ═══════════════════════════════════════════════════════════════

app.get('/api/threads/posts/:postId', wrapAsync(async (req, res) => {
  const postId = req.params.postId;
  // Threads post URLs look like threads.net/@user/post/ID
  const engagement = await getDriver().getPostEngagement(`https://www.threads.com/t/${postId}`);
  res.json({ postId, ...engagement });
}));

app.get('/api/threads/extract', wrapAsync(async (req, res) => {
  const postUrl = req.query.postUrl as string;
  if (!postUrl) { res.status(400).json({ error: 'Bad Request', message: 'postUrl query param required' }); return; }
  const data = await getDriver().extractPost(decodeURIComponent(postUrl));
  res.json(data);
}));

// ═══════════════════════════════════════════════════════════════
// LIKE / REPOST
// ═══════════════════════════════════════════════════════════════

app.post('/api/threads/like/:postId', wrapAsync(async (req, res) => {
  const postId = req.params.postId;
  const result = await getDriver().likePost(`https://www.threads.com/t/${postId}`);
  res.json({ success: result.success, postId, error: result.error });
}));

app.post('/api/threads/repost/:postId', wrapAsync(async (req, res) => {
  const postId = req.params.postId;
  const result = await getDriver().repostPost(`https://www.threads.com/t/${postId}`);
  res.json({ success: result.success, postId, error: result.error });
}));

// ═══════════════════════════════════════════════════════════════
// THREAD CONTEXT
// ═══════════════════════════════════════════════════════════════

app.get('/api/threads/thread/:postId', wrapAsync(async (req, res) => {
  const postId = req.params.postId;
  const context = await getDriver().getThreadContext(`https://www.threads.com/t/${postId}`);
  res.json(context);
}));

// ═══════════════════════════════════════════════════════════════
// RESEARCH / NICHE
// ═══════════════════════════════════════════════════════════════

app.post('/api/threads/research', wrapAsync(async (req, res) => {
  const { niche, query, max_results } = req.body;
  const searchQuery = niche || query;
  const err = validateRequired({ niche: searchQuery }, ['niche']);
  if (err) { res.status(400).json({ error: 'Bad Request', message: 'niche or query is required' }); return; }

  const result = await getDriver().searchPosts(searchQuery, { maxResults: max_results || 50, scrolls: 5 });
  // Sort by engagement
  const sorted = result.posts.sort((a, b) =>
    (b.likes + b.replies * 2 + b.reposts * 3) - (a.likes + a.replies * 2 + a.reposts * 3)
  );
  res.json({ success: true, niche: searchQuery, posts: sorted, count: sorted.length });
}));

// ═══════════════════════════════════════════════════════════════
// AI FEATURES
// ═══════════════════════════════════════════════════════════════

app.post('/api/threads/ai-message', wrapAsync(async (req, res) => {
  const { postContent, username, niche, context: contextStr } = req.body;
  const ai = getAIGenerator();
  const analysis = ai.analyzePost({
    mainPost: postContent || contextStr || 'Threads post',
    username: username || 'user',
    replies: [],
  });
  const message = await ai.generateComment(analysis);

  // Enforce platform char limit
  const trimmed = message.length > PLATFORM_CHAR_LIMIT ? message.substring(0, PLATFORM_CHAR_LIMIT) : message;

  res.json({
    success: true,
    message: trimmed,
    model_used: process.env.OPENAI_API_KEY ? 'gpt-4o' : 'local-templates',
    char_count: trimmed.length,
    platform_limit: PLATFORM_CHAR_LIMIT,
  });
}));

app.post('/api/threads/suggest-reply', wrapAsync(async (req, res) => {
  const { postContent, username, existingComments } = req.body;
  const ai = getAIGenerator();
  const result = await ai.generateFromContext({
    platform: 'threads',
    username: username || 'user',
    postContent: postContent || '',
    existingComments: existingComments || [],
  });

  const text = result.text || '';
  const trimmed = text.length > PLATFORM_CHAR_LIMIT ? text.substring(0, PLATFORM_CHAR_LIMIT) : text;

  res.json({
    success: result.success,
    message: trimmed,
    model_used: process.env.OPENAI_API_KEY ? 'gpt-4o' : 'local-templates',
    char_count: trimmed.length,
    platform_limit: PLATFORM_CHAR_LIMIT,
    error: result.error,
  });
}));

app.post('/api/threads/score', wrapAsync(async (req, res) => {
  const { postContent, username, niche, handle } = req.body;
  const ai = getAIGenerator();
  const analysis = ai.analyzePost({
    mainPost: postContent || '',
    username: username || handle || 'user',
    replies: [],
  });

  // Compute a 0-100 score based on analysis signals
  let score = 50; // base
  if (analysis.sentiment === 'positive') score += 15;
  if (analysis.sentiment === 'question') score += 10;
  if (analysis.sentiment === 'negative') score -= 10;
  if (analysis.topics.length > 1) score += 10;
  if (analysis.topics.includes('tech') || analysis.topics.includes('business')) score += 10;
  if (analysis.isInappropriate) score = Math.max(0, score - 40);
  if (analysis.tone === 'professional') score += 5;
  score = Math.max(0, Math.min(100, Math.round(score)));

  const signals = [
    `sentiment: ${analysis.sentiment}`,
    `topics: ${analysis.topics.join(', ')}`,
    `tone: ${analysis.tone}`,
    ...(analysis.isInappropriate ? [`flagged: ${analysis.skipReason}`] : []),
  ];

  res.json({
    success: true,
    score,
    reasoning: `Score ${score}/100 based on content analysis`,
    signals,
    model_used: 'rule-based-v1',
  });
}));

// ═══════════════════════════════════════════════════════════════
// SESSIONS
// ═══════════════════════════════════════════════════════════════

app.post('/api/threads/sessions', (_req: Request, res: Response) => {
  const session = createSession();
  res.json({ success: true, sessionId: session.id, createdAt: session.createdAt });
});

app.get('/api/threads/sessions', (_req: Request, res: Response) => {
  const activeSessions = Array.from(sessions.values()).map(s => ({
    id: s.id,
    createdAt: s.createdAt,
    lastAccessedAt: s.lastAccessedAt,
  }));
  res.json({ sessions: activeSessions, count: activeSessions.length });
});

app.get('/api/threads/sessions/:sessionId', (req: Request, res: Response) => {
  const session = getSession(req.params.sessionId);
  if (!session) {
    res.status(404).json({ error: 'Not Found', message: 'Session not found or expired' });
    return;
  }
  res.json(session);
});

app.delete('/api/threads/sessions/:sessionId', (req: Request, res: Response) => {
  const existed = sessions.delete(req.params.sessionId);
  res.json({ success: true, removed: existed });
});

// ═══════════════════════════════════════════════════════════════
// ACTIVE HOURS GUARD
// ═══════════════════════════════════════════════════════════════

app.post('/api/threads/action', wrapAsync(async (req, res) => {
  const { action, force, ...params } = req.body;
  const err = validateRequired(req.body, ['action']);
  if (err) { res.status(400).json({ error: 'Bad Request', message: err }); return; }

  const validActions = ['comment', 'like', 'repost', 'search', 'navigate'];
  if (!validActions.includes(action)) {
    res.status(400).json({ error: 'Bad Request', message: `Invalid action. Valid values: ${validActions.join(', ')}` });
    return;
  }

  // Active hours check (8am - 11pm)
  const hour = new Date().getHours();
  if (!force && (hour < 8 || hour > 23)) {
    res.status(400).json({
      error: 'Outside Active Hours',
      message: 'Actions restricted to 8am-11pm. Use force=true to bypass.',
      active_hours: '08:00-23:00',
    });
    return;
  }

  res.json({ success: true, action, force: !!force, processed: true });
}));

// ═══════════════════════════════════════════════════════════════
// SUPABASE / CRM ENDPOINTS
// ═══════════════════════════════════════════════════════════════

app.get('/api/threads/db/history', wrapAsync(async (req, res) => {
  const { limit = '50', sessionId } = req.query;
  const logger = getCommentLogger();
  const history = await logger.getHistory({
    platform: 'threads',
    limit: parseInt(limit as string),
    sessionId: sessionId as string,
  });
  res.json({ history, count: history.length });
}));

app.get('/api/threads/db/stats', wrapAsync(async (_req, res) => {
  const logger = getCommentLogger();
  const stats = await logger.getStats('threads');
  res.json(stats);
}));

// ═══════════════════════════════════════════════════════════════
// ENGAGEMENT ENDPOINTS (preserved from original)
// ═══════════════════════════════════════════════════════════════

app.post('/api/threads/engage', wrapAsync(async (req, res) => {
  const { postUrl } = req.body;
  const ac = getAutoCommenter();
  const result = await ac.engageWithPost(postUrl);
  res.json(result);
}));

app.post('/api/threads/engage/loop', wrapAsync(async (req, res) => {
  const { count = 1, delayBetween = 60000 } = req.body;
  const ac = getAutoCommenter();
  const results = await ac.runEngagementLoop(count, delayBetween);
  res.json({ results, count: results.length, successful: results.filter(r => r.success).length });
}));

app.get('/api/threads/engage/history', (_req: Request, res: Response) => {
  const ac = getAutoCommenter();
  res.json({ commentedUrls: ac.getCommentedUrls() });
});

app.post('/api/threads/engage/multi', wrapAsync(async (req, res) => {
  const { count = 5, delayBetween = 30000, useAI = true, maxRetries = 2, captureScreenshots = false } = req.body;
  const d = getDriver();
  const ai = getAIGenerator();

  const commentGenerator = async (context: { mainPost: string; username: string; replies?: string[] }) => {
    if (useAI) {
      const analysis = ai.analyzePost({
        mainPost: context.mainPost,
        username: context.username,
        replies: context.replies || [],
      });
      if (analysis.isInappropriate) return `__SKIP__:${analysis.skipReason}`;
      return await ai.generateComment(analysis);
    }
    const templates = ["This is amazing! 🔥", "Love this! 👏", "So good! ✨", "Incredible work! 🎨"];
    return templates[Math.floor(Math.random() * templates.length)];
  };

  const result = await d.commentOnMultiplePosts(count, commentGenerator, delayBetween, { maxRetries, captureScreenshots });
  const logger = getCommentLogger();
  const dbResult = await logger.logSession(result.results, 'threads');

  res.json({
    success: true,
    useAI,
    ...result.summary,
    results: result.results,
    logs: result.logs,
    database: { sessionId: logger.getSessionId(), logged: dbResult.logged, failed: dbResult.failed },
  });
}));

// ═══════════════════════════════════════════════════════════════
// PROSPECT DISCOVERY
// ═══════════════════════════════════════════════════════════════

app.post('/api/threads/prospect/discover', wrapAsync(async (req, res) => {
  const params = req.body || {};
  if (params.dryRun) {
    const result = await discoverProspects(params);
    res.json({ success: true, ...result });
    return;
  }
  const agentId = `prospect-discovery-${Date.now()}`;
  let coord: InstanceType<typeof TabCoordinator> | null = null;
  try {
    coord = new TabCoordinator(agentId, SERVICE_NAME, SERVICE_PORT, SESSION_URL_PATTERN);
    const claim = await coord.claim();
    getDriver().setTrackedTab(claim.windowIndex, claim.tabIndex, SESSION_URL_PATTERN);
    console.log(`[prospect-discover] Claimed tab w=${claim.windowIndex} t=${claim.tabIndex}`);
  } catch (err) {
    throw new Error(`Tab claim required but failed: ${err}`);
  }
  try {
    const result = await discoverProspects(params);
    res.json({ success: true, ...result });
  } finally {
    if (coord) {
      try { await coord.release(); } catch { /* ignore */ }
    }
  }
}));

app.get('/api/threads/prospect/score/:handle', wrapAsync(async (req, res) => {
  const { handle } = req.params;
  const profile = await getDriver().getCreatorProfile(handle);
  const { score, signals } = scoreICP(profile, 'direct');
  res.json({ success: true, username: handle, ...profile, icpScore: score, icpSignals: signals, icpKeywords: ICP_KEYWORDS });
}));

// ═══════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════

app.get('/api/threads/config', (_req: Request, res: Response) => {
  res.json({ config: getDriver().getConfig() });
});

app.put('/api/threads/config', (req: Request, res: Response) => {
  const d = getDriver();
  d.setConfig(req.body as Partial<ThreadsConfig>);
  res.json({ config: d.getConfig() });
});

// ═══════════════════════════════════════════════════════════════
// ANALYZE (AI)
// ═══════════════════════════════════════════════════════════════

app.post('/api/threads/analyze', wrapAsync(async (_req, res) => {
  const d = getDriver();
  const ai = getAIGenerator();
  const context = await d.getContext();
  const comments = await d.getComments(10);
  const analysis = ai.analyzePost({
    mainPost: context.mainPost,
    username: context.username,
    replies: comments.map(c => c.text),
  });
  const suggestedComment = await ai.generateComment(analysis);
  res.json({ analysis, suggestedComment, context });
}));

// ═══════════════════════════════════════════════════════════════
// PAGINATION ENDPOINTS
// ═══════════════════════════════════════════════════════════════

app.get('/api/threads/posts', wrapAsync(async (req, res) => {
  const limit = Math.max(0, parseInt(req.query.limit as string) || 10);
  const page = Math.max(0, parseInt(req.query.page as string) || 0);
  const d = getDriver();

  if (limit === 0) {
    res.json({ posts: [], count: 0, page, limit });
    return;
  }

  const posts = await d.findPosts(limit + page * limit);
  const paged = posts.slice(page * limit, (page + 1) * limit);
  res.json({ posts: paged, count: paged.length, page, limit });
}));

// ═══════════════════════════════════════════════════════════════
// TAB COORDINATION
// ═══════════════════════════════════════════════════════════════

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
    getDriver().setTrackedTab(claim.windowIndex, claim.tabIndex, SESSION_URL_PATTERN);
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
    res.json({ ok: info.found, windowIndex: info.windowIndex, tabIndex: info.tabIndex, url: info.url });
  } catch (error) {
    const msg = String(error);
    if (msg.includes('No tab found') || msg.includes('No \'threads') || msg.includes('threads.net')) {
      res.json({ ok: false, error: msg });
    } else {
      res.status(500).json({ error: msg });
    }
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

// ═══════════════════════════════════════════════════════════════
// COMMENT SWEEP — niche + feed batch (called by threads-comment-sweep.js daemon)
// ═══════════════════════════════════════════════════════════════

interface SweepNicheConfig {
  name: string;
  keywords: string[];
  maxComments?: number;
}

app.post('/api/threads/comment-sweep', wrapAsync(async (req, res) => {
  const {
    niches = [] as SweepNicheConfig[],
    feedSources = ['foryou'] as string[],
    maxPerNiche = 5,
    maxPerFeed = 3,
    maxTotal = 20,
    style = 'insightful, practitioner-level, concise — adds genuine value to the conversation',
    dryRun = false,
    seenUrls = [] as string[],
  } = req.body;

  if (!Array.isArray(niches) || niches.length === 0) {
    res.status(400).json({ error: 'Bad Request', message: 'niches array is required and must not be empty' });
    return;
  }

  const d = getDriver();
  const ai = getAIGenerator();
  const seenSet = new Set<string>(seenUrls);
  const newlyCommentedUrls: string[] = [];
  let totalCommented = 0;

  const humanDelay = (minMs: number, maxMs: number) =>
    new Promise(r => setTimeout(r, minMs + Math.random() * (maxMs - minMs)));

  const generateComment = async (postText: string, author: string): Promise<string | null> => {
    try {
      const result = await ai.generateFromContext({
        platform: 'threads',
        username: author || 'user',
        postContent: `${postText}\n\n[Style: ${style}]`,
        existingComments: [],
      });
      const text = result.text || '';
      if (!text || text.length < 10) return null;
      return text.length > PLATFORM_CHAR_LIMIT ? text.substring(0, PLATFORM_CHAR_LIMIT) : text;
    } catch {
      return null;
    }
  };

  // ── Feed sweep ────────────────────────────────────────────────
  const feedResults: Array<{ postUrl: string; author: string; reply: string; dryRun: boolean }> = [];

  for (const feedSource of feedSources) {
    if (totalCommented >= maxTotal) break;
    const feedMax = Math.min(maxPerFeed, maxTotal - totalCommented);

    try {
      // Navigate to home or for-you feed
      const feedUrl = feedSource === 'following'
        ? 'https://www.threads.com/?feed=following'
        : 'https://www.threads.com/';
      await d.navigateToPost(feedUrl);
      await humanDelay(3000, 5000);

      const feedPosts = await d.findPosts(feedMax * 4);
      let feedCount = 0;

      for (const post of feedPosts) {
        if (feedCount >= feedMax || totalCommented >= maxTotal) break;
        if (!post.url || post.text.length < 30) continue;
        if (seenSet.has(post.url)) continue;

        const reply = await generateComment(post.text, post.author || '');
        if (!reply) continue;

        if (!dryRun) {
          await d.navigateToPost(post.url);
          await humanDelay(3000, 5000);
          const result = await d.postComment(reply);
          if (!result.success) continue;
          await humanDelay(4000, 7000);
        }

        seenSet.add(post.url);
        newlyCommentedUrls.push(post.url);
        feedResults.push({ postUrl: post.url, author: post.author || '', reply, dryRun });
        feedCount++;
        totalCommented++;
      }
    } catch (err) {
      console.error(`[comment-sweep] Feed sweep error (${feedSource}):`, err);
    }
  }

  // ── Per-niche keyword sweep ───────────────────────────────────
  interface NicheResult {
    niche: string;
    commented: Array<{ url: string; author: string; reply: string }>;
    skipped: string[];
    errors: string[];
  }
  const nicheResults: NicheResult[] = [];

  for (const niche of niches) {
    if (totalCommented >= maxTotal) break;
    const nicheMax = Math.min(niche.maxComments ?? maxPerNiche, maxTotal - totalCommented);
    const result: NicheResult = { niche: niche.name, commented: [], skipped: [], errors: [] };

    for (const keyword of niche.keywords) {
      if (result.commented.length >= nicheMax || totalCommented >= maxTotal) break;

      try {
        const searchResult = await d.searchPosts(keyword, {
          maxResults: nicheMax * 3,
          scrolls: 2,
        });

        for (const post of searchResult.posts) {
          if (result.commented.length >= nicheMax || totalCommented >= maxTotal) break;
          if (!post.url || post.text.length < 30) { result.skipped.push(post.url || 'no-url'); continue; }
          if (seenSet.has(post.url)) { result.skipped.push(post.url); continue; }

          const reply = await generateComment(post.text, post.author || '');
          if (!reply) { result.skipped.push(post.url); continue; }

          if (!dryRun) {
            await d.navigateToPost(post.url);
            await humanDelay(3000, 5000);
            const postResult = await d.postComment(reply);
            if (!postResult.success) { result.errors.push(`${post.url}: ${postResult.error}`); continue; }
            await humanDelay(8000, 20000); // human-like pace between comments
          }

          seenSet.add(post.url);
          newlyCommentedUrls.push(post.url);
          result.commented.push({ url: post.url, author: post.author || '', reply });
          totalCommented++;
        }
      } catch (err) {
        result.errors.push(`keyword "${keyword}": ${String(err)}`);
      }
    }

    nicheResults.push(result);
  }

  const nicheBreakdown = Object.fromEntries(nicheResults.map(n => [n.niche, n.commented.length]));
  const summary = `${totalCommented} comment${totalCommented !== 1 ? 's' : ''} posted${dryRun ? ' (dry-run)' : ''} — feed: ${feedResults.length}, niches: ${JSON.stringify(nicheBreakdown)}`;

  res.json({
    success: true,
    dryRun,
    totalCommented,
    feedResults,
    nicheResults,
    newlyCommentedUrls,
    summary,
  });
}));

// ═══════════════════════════════════════════════════════════════
// ─── Self-Poll Endpoint (SDPA-009) ───────────────────────────────────────────
// POST /api/threads/self-poll
// Called by cron-manager during quiet hours. Fetches profile posts and comments,
// writes to safari_platform_cache for cloud-sync to consume.
app.post('/api/threads/self-poll', async (_req: Request, res: Response) => {
  // NO quiet hours — runs 24/7 per Phase B spec

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
  const PROFILE_URL = 'https://www.threads.net/@the_isaiah_dupree';
  const result = { posts: 0, comments: 0 };

  const writeCache = async (dataType: string, payload: any[], ttlMs: number) => {
    if (!payload.length || !SUPABASE_URL || !SUPABASE_ANON_KEY) return;
    const headers: Record<string, string> = {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    };
    await fetch(`${SUPABASE_URL}/rest/v1/safari_platform_cache?platform=eq.threads&data_type=eq.${dataType}`, {
      method: 'DELETE', headers,
    }).catch(() => {});
    const expiresAt = new Date(Date.now() + ttlMs).toISOString();
    await fetch(`${SUPABASE_URL}/rest/v1/safari_platform_cache`, {
      method: 'POST', headers,
      body: JSON.stringify({ platform: 'threads', data_type: dataType, payload, expires_at: expiresAt, source_service_port: 3004 }),
    }).catch(() => {});
  };

  try {
    const d = getDriver();

    // Navigate to own profile
    await d.navigateToPost(PROFILE_URL);
    await new Promise(r => setTimeout(r, 4000));

    // Discover posts on profile
    const posts = await d.findPosts(10);
    result.posts = posts.length;

    // Collect post stats
    const postStats: any[] = posts.map(p => ({
      platform: 'threads',
      post_id: p.url?.split('/').pop() || `threads_${p.index}`,
      post_url: p.url,
      post_type: 'text',
      caption: p.content || '',
      likes: 0,
      comments: 0,
      shares: 0,
    }));

    // For each post, get comments (up to 3 posts)
    const allComments: any[] = [];
    for (const post of posts.slice(0, 3)) {
      const postId = post.url?.split('/').pop() || `threads_${post.index}`;
      await d.navigateToPost(post.url);
      await new Promise(r => setTimeout(r, 3000));

      const context = await d.getContext();
      if (context) {
        // Update post stats with engagement numbers
        const statsEntry = postStats.find(s => s.post_id === postId);
        if (statsEntry) {
          statsEntry.likes = parseInt(context.likeCount) || 0;
          statsEntry.comments = parseInt(context.replyCount) || 0;
        }
        // Parse comments from context.replies
        for (const reply of (context.replies || [])) {
          if (!reply || reply.length < 3) continue;
          const firstSpace = reply.indexOf(' ');
          let username = 'unknown';
          let text = reply;
          if (firstSpace > 0 && firstSpace < 30) {
            const fw = reply.substring(0, firstSpace);
            if (fw.length >= 2 && fw.length <= 30) {
              username = fw.replace(/^@/, '').replace(/[:\-]+$/, '');
              text = reply.substring(firstSpace + 1).trim();
            }
          }
          text = text.replace(/^\d{1,2}\/\d{1,2}\/\d{2,4}\s*/, '').replace(/^Replying to @\S+\s*/i, '').trim();
          if (!text || text.length < 3) continue;
          allComments.push({ platform: 'threads', post_id: postId, post_url: post.url, username, comment_text: text.substring(0, 500) });
        }
      }

      // Navigate back
      await d.navigateToPost(PROFILE_URL);
      await new Promise(r => setTimeout(r, 2000));
    }

    result.comments = allComments.length;

    await Promise.all([
      writeCache('post_stats', postStats, 21_600_000),
      writeCache('comments', allComments, 21_600_000),
    ]);

    res.json({ success: true, fetched: result });
  } catch (err) {
    const msg = (err as Error).message;
    console.error('[self-poll:threads] error:', msg);
    res.status(500).json({ success: false, error: msg });
  }
});

// 404 / 405 catch-all
// ═══════════════════════════════════════════════════════════════

// Method Not Allowed for known paths with wrong methods
app.all('/api/threads/comments/post', (req: Request, res: Response) => {
  res.setHeader('Allow', 'POST');
  res.status(405).json({ error: 'Method Not Allowed', message: `${req.method} not allowed. Use POST.`, allowed: ['POST'] });
});
app.all('/api/threads/search', (req: Request, res: Response) => {
  res.setHeader('Allow', 'POST');
  res.status(405).json({ error: 'Method Not Allowed', message: `${req.method} not allowed. Use POST.`, allowed: ['POST'] });
});
app.all('/api/threads/navigate', (req: Request, res: Response) => {
  res.setHeader('Allow', 'POST');
  res.status(405).json({ error: 'Method Not Allowed', message: `${req.method} not allowed. Use POST.`, allowed: ['POST'] });
});

// Generic 404
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not Found', message: 'Endpoint not found' });
});

// Global error handler — always JSON, no stack in production
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  const message = process.env.NODE_ENV === 'production'
    ? 'Internal Server Error'
    : err.message;
  res.status(500).json({ error: 'Internal Server Error', message });
});

// ─── Global Heartbeat Refresh ────────────────────────────────────────
// Keep all active claims alive by refreshing heartbeats every 30s
setInterval(async () => {
  for (const [id, coord] of activeCoordinators) {
    try {
      await coord.heartbeat();
    } catch {
      activeCoordinators.delete(id);
    }
  }
}, 30_000);

// ═══════════════════════════════════════════════════════════════
// START
// ═══════════════════════════════════════════════════════════════

export function startServer(port: number = PORT): void {
  TabCoordinator.listClaims().then(claims => {
    const stale = claims.filter(c => c.service === SERVICE_NAME);
    if (stale.length > 0) {
      console.log(`[startup] Clearing ${stale.length} stale ${SERVICE_NAME} claim(s) from previous process`);
      import('fs/promises').then(fsp => {
        fsp.writeFile('/tmp/safari-tab-claims.json', JSON.stringify(claims.filter(c => c.service !== SERVICE_NAME), null, 2)).catch(() => {});
      });
    }
  }).catch(() => {});

  app.listen(port, () => {
    console.log(`🧵 Threads Comments API running on http://localhost:${port}`);
    console.log(`   Version: ${SERVICE_VERSION}`);
    console.log(`   Health:  GET  /health`);
    console.log(`   Auth:    Bearer token required`);
  });
}

if (process.argv[1]?.includes('server')) {
  startServer();
}

export { app, SERVICE_VERSION, AUTH_TOKEN, startedAt, sessions, rateLimitStore, RATE_LIMIT };
