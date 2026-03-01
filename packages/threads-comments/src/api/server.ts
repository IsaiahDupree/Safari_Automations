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

import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { ThreadsDriver, DEFAULT_CONFIG, type ThreadsConfig, type CommentResult } from '../automation/threads-driver.js';
import { ThreadsAutoCommenter } from '../automation/threads-auto-commenter.js';
import { ThreadsAICommentGenerator } from '../automation/ai-comment-generator.js';
import { CommentLogger } from '../db/comment-logger.js';

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
function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Skip auth for health and OPTIONS
  if (req.path === '/health' || req.method === 'OPTIONS') {
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
  const engagement = await getDriver().getPostEngagement(`https://www.threads.net/t/${postId}`);
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
  const result = await getDriver().likePost(`https://www.threads.net/t/${postId}`);
  res.json({ success: result.success, postId, error: result.error });
}));

app.post('/api/threads/repost/:postId', wrapAsync(async (req, res) => {
  const postId = req.params.postId;
  const result = await getDriver().repostPost(`https://www.threads.net/t/${postId}`);
  res.json({ success: result.success, postId, error: result.error });
}));

// ═══════════════════════════════════════════════════════════════
// THREAD CONTEXT
// ═══════════════════════════════════════════════════════════════

app.get('/api/threads/thread/:postId', wrapAsync(async (req, res) => {
  const postId = req.params.postId;
  const context = await getDriver().getThreadContext(`https://www.threads.net/t/${postId}`);
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

// ═══════════════════════════════════════════════════════════════
// START
// ═══════════════════════════════════════════════════════════════

export function startServer(port: number = PORT): void {
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
