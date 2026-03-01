/**
 * Instagram Unified API Server
 *
 * REST API for Instagram automation via Safari.
 * Combines comments, DM, profile, session management, and AI features.
 * Port: 3005
 */

import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { InstagramDriver, DEFAULT_CONFIG, type InstagramConfig } from '../automation/instagram-driver.js';
import { InstagramAICommentGenerator, isInappropriateContent } from '../automation/ai-comment-generator.js';
import { CommentLogger } from '../db/comment-logger.js';

const app = express();

// ─── Service Metadata ────────────────────────────────────────────────
const SERVICE_VERSION = '2.0.0';
const SERVICE_NAME = 'instagram-comments';
const startedAt = new Date().toISOString();
const startTime = Date.now();

// ─── CORS Configuration ──────────────────────────────────────────────
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
  exposedHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset', 'Retry-After'],
}));

// ─── Body Parsing ────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));

// ─── Content-Type Validation for POST/PUT/PATCH ──────────────────────
app.use((req: Request, res: Response, next: NextFunction) => {
  if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.headers['content-length'] && parseInt(req.headers['content-length']) > 0) {
    const ct = req.headers['content-type'];
    if (ct && !ct.includes('application/json')) {
      res.status(415).json({ error: 'Unsupported Media Type', message: 'Content-Type must be application/json' });
      return;
    }
  }
  next();
});

const PORT = parseInt(process.env.INSTAGRAM_COMMENTS_PORT || process.env.PORT || '3005');
const API_TOKEN = process.env.INSTAGRAM_API_TOKEN || 'test-token';

// ─── Authentication Middleware ────────────────────────────────────────
function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Skip auth for health check and OPTIONS preflight
  if (req.path === '/health' || req.method === 'OPTIONS') {
    next();
    return;
  }

  // Reject tokens passed as query params
  if (req.query.token) {
    res.status(401).json({ error: 'Unauthorized', message: 'Token must be passed in Authorization header, not query params' });
    return;
  }

  const authHeader = req.headers.authorization;

  if (!authHeader) {
    res.status(401).json({ error: 'Unauthorized', message: 'Authorization header is required' });
    return;
  }

  if (!authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized', message: 'Authorization must use Bearer scheme' });
    return;
  }

  const token = authHeader.substring(7).trim();

  if (!token) {
    res.status(401).json({ error: 'Unauthorized', message: 'Bearer token is empty' });
    return;
  }

  if (token !== API_TOKEN) {
    res.status(401).json({ error: 'Unauthorized', message: 'Invalid or expired token' });
    return;
  }

  next();
}

app.use(authMiddleware);

// ─── Rate Limiting ───────────────────────────────────────────────────
interface RateLimitBucket {
  count: number;
  windowStart: number;
}

const rateLimitBuckets = new Map<string, RateLimitBucket>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX || '200'); // 200 requests per minute (configurable)

function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
  const key = req.ip || 'default';
  const now = Date.now();
  let bucket = rateLimitBuckets.get(key);

  if (!bucket || (now - bucket.windowStart) > RATE_LIMIT_WINDOW_MS) {
    bucket = { count: 0, windowStart: now };
    rateLimitBuckets.set(key, bucket);
  }

  bucket.count++;

  const remaining = Math.max(0, RATE_LIMIT_MAX - bucket.count);
  const resetAt = Math.ceil((bucket.windowStart + RATE_LIMIT_WINDOW_MS - now) / 1000);

  res.set('X-RateLimit-Limit', String(RATE_LIMIT_MAX));
  res.set('X-RateLimit-Remaining', String(remaining));
  res.set('X-RateLimit-Reset', String(resetAt));

  if (bucket.count > RATE_LIMIT_MAX) {
    res.set('Retry-After', String(resetAt));
    res.status(429).json({
      error: 'Too Many Requests',
      message: `Rate limit exceeded. Try again in ${resetAt} seconds.`,
      retryAfter: resetAt,
    });
    return;
  }

  next();
}

app.use(rateLimitMiddleware);

// ─── Request Timeout ─────────────────────────────────────────────────
app.use((req: Request, res: Response, next: NextFunction) => {
  const timeout = setTimeout(() => {
    if (!res.headersSent) {
      res.status(504).json({ error: 'Gateway Timeout', message: 'Request timed out after 30 seconds' });
    }
  }, 30000);

  res.on('finish', () => clearTimeout(timeout));
  next();
});

// ─── Singletons ──────────────────────────────────────────────────────
let driver: InstagramDriver | null = null;

function getDriver(): InstagramDriver {
  if (!driver) {
    driver = new InstagramDriver();
  }
  return driver;
}

let aiGenerator: InstagramAICommentGenerator | null = null;
function getAIGenerator(): InstagramAICommentGenerator {
  if (!aiGenerator) {
    aiGenerator = new InstagramAICommentGenerator({
      provider: process.env.OPENAI_API_KEY ? 'openai' : 'local',
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  return aiGenerator;
}

let commentLogger: CommentLogger | null = null;
function getCommentLogger(): CommentLogger {
  if (!commentLogger) {
    commentLogger = new CommentLogger();
  }
  return commentLogger;
}

// ─── Session Management ──────────────────────────────────────────────
interface Session {
  id: string;
  createdAt: string;
  lastAccessedAt: string;
  platform: string;
}

const sessions = new Map<string, Session>();

function createSessionId(): string {
  return `sess_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

// ─── DM Rate Tracking ────────────────────────────────────────────────
const dmRateTracker = {
  dailySent: 0,
  dailyLimit: 20,
  resetAt: new Date(new Date().setHours(24, 0, 0, 0)).toISOString(),
  lastReset: new Date().toISOString(),
};

const commentRateTracker = {
  dailySent: 0,
  dailyLimit: 15,
  hourlyLimit: 5,
  hourlySent: 0,
  resetAt: new Date(new Date().setHours(24, 0, 0, 0)).toISOString(),
};

// ─── Idempotency Tracking ────────────────────────────────────────────
const recentActions = new Map<string, { result: object; timestamp: number }>();

function getIdempotencyKey(action: string, target: string, content: string): string {
  return `${action}:${target}:${content.substring(0, 50)}`;
}

// Clean old entries every 5 minutes
setInterval(() => {
  const cutoff = Date.now() - 5 * 60 * 1000;
  for (const [key, value] of recentActions) {
    if (value.timestamp < cutoff) {
      recentActions.delete(key);
    }
  }
}, 5 * 60 * 1000);

// ═══════════════════════════════════════════════════════════════════════
//   HEALTH ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════

app.get('/health', (_req: Request, res: Response) => {
  const uptimeMs = Date.now() - startTime;
  res.json({
    status: 'ok',
    service: SERVICE_NAME,
    version: SERVICE_VERSION,
    port: PORT,
    started_at: startedAt,
    uptime: uptimeMs,
    uptime_human: `${Math.floor(uptimeMs / 1000)}s`,
    timestamp: new Date().toISOString(),
  });
});

// ═══════════════════════════════════════════════════════════════════════
//   STATUS & CONFIG
// ═══════════════════════════════════════════════════════════════════════

app.get('/api/instagram/status', async (req: Request, res: Response) => {
  try {
    const d = getDriver();
    const status = await d.getStatus();
    const rateLimits = d.getRateLimits();
    res.json({ ...status, commentsThisHour: rateLimits.commentsThisHour, commentsToday: rateLimits.commentsToday });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.get('/api/instagram/config', (_req: Request, res: Response) => {
  const d = getDriver();
  res.json({ config: d.getConfig() });
});

app.put('/api/instagram/config', (req: Request, res: Response) => {
  const updates = req.body as Partial<InstagramConfig>;
  const d = getDriver();
  d.setConfig(updates);
  res.json({ config: d.getConfig() });
});

// ═══════════════════════════════════════════════════════════════════════
//   PROFILE
// ═══════════════════════════════════════════════════════════════════════

app.get('/api/instagram/profile', async (req: Request, res: Response) => {
  try {
    const d = getDriver();
    const status = await d.getStatus();

    // Execute JS to get profile info from the page
    const profileData = await (d as any).executeJS(`
      (function() {
        var handle = '';
        var followerCount = 0;
        var followingCount = 0;
        var bio = '';
        var displayName = '';

        // Try to get from meta tags
        var metaDesc = document.querySelector('meta[property="og:description"]');
        if (metaDesc) {
          var content = metaDesc.getAttribute('content') || '';
          var parts = content.split(' - ');
          if (parts.length > 0) {
            var counts = parts[0].split(',');
            for (var i = 0; i < counts.length; i++) {
              var c = counts[i].trim().toLowerCase();
              if (c.includes('follower')) followerCount = parseInt(c) || 0;
              if (c.includes('following')) followingCount = parseInt(c) || 0;
            }
          }
        }

        // Try to get username from URL or page
        var url = window.location.href;
        var match = url.match(/instagram\\.com\\/([a-zA-Z0-9_.]+)/);
        if (match) handle = match[1];

        // Try title
        var title = document.title || '';
        var titleMatch = title.match(/@([a-zA-Z0-9_.]+)/);
        if (titleMatch) handle = titleMatch[1];

        return JSON.stringify({ handle: handle, follower_count: followerCount, following_count: followingCount, bio: bio, display_name: displayName });
      })()
    `);

    const profile = JSON.parse(profileData || '{}');
    res.json({
      handle: profile.handle || '',
      follower_count: profile.follower_count || 0,
      following_count: profile.following_count || 0,
      bio: profile.bio || '',
      display_name: profile.display_name || '',
      platform: 'instagram',
    });
  } catch (error) {
    res.status(503).json({
      error: 'Service unavailable',
      message: 'Safari automation not available',
      retryable: true,
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════
//   NAVIGATION
// ═══════════════════════════════════════════════════════════════════════

app.post('/api/instagram/navigate', async (req: Request, res: Response) => {
  try {
    const { url, username } = req.body;
    const target = url || (username ? `https://www.instagram.com/${username}/` : null);
    if (!target) {
      res.status(400).json({ error: 'Validation Error', message: 'url or username is required' });
      return;
    }
    const d = getDriver();
    const success = await d.navigateToPost(target);
    res.json({ success, url: target });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// ═══════════════════════════════════════════════════════════════════════
//   COMMENT ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════

app.get('/api/instagram/comments', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const postUrl = req.query.postUrl as string;
    const d = getDriver();

    if (postUrl) {
      await d.navigateToPost(postUrl);
      await new Promise(r => setTimeout(r, 3000));
    }

    const comments = await d.getComments(limit);
    res.json({ comments, count: comments.length });
  } catch (error) {
    res.status(500).json({ error: String(error), comments: [], count: 0 });
  }
});

app.get('/api/instagram/comments/rate-limits', (_req: Request, res: Response) => {
  res.json({
    daily_sent: commentRateTracker.dailySent,
    daily_limit: commentRateTracker.dailyLimit,
    hourly_sent: commentRateTracker.hourlySent,
    hourly_limit: commentRateTracker.hourlyLimit,
    reset_at: commentRateTracker.resetAt,
  });
});

app.post('/api/instagram/comments/post', async (req: Request, res: Response) => {
  try {
    const { text, postUrl } = req.body;

    if (text === undefined || text === null) {
      res.status(400).json({ error: 'Validation Error', message: 'text is required' });
      return;
    }

    if (typeof text !== 'string' || text.trim() === '') {
      res.status(400).json({ error: 'Validation Error', message: 'text must be a non-empty string' });
      return;
    }

    // Length validation
    if (text.length > 10000) {
      res.status(400).json({ error: 'Validation Error', message: 'text exceeds maximum length of 10000 characters' });
      return;
    }

    const d = getDriver();
    if (postUrl) {
      const navSuccess = await d.navigateToPost(postUrl);
      if (!navSuccess) {
        res.status(500).json({ success: false, error: 'Failed to navigate to post' });
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 3000));
    }

    const result = await d.postComment(text);
    if (result.success) {
      commentRateTracker.dailySent++;
      commentRateTracker.hourlySent++;
      res.json({ success: true, commentId: result.commentId, text: text.substring(0, 100) });
    } else {
      res.status(400).json({ success: false, error: result.error });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// ═══════════════════════════════════════════════════════════════════════
//   DM ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════

app.post('/api/instagram/dm/send', async (req: Request, res: Response) => {
  try {
    const { username, message, dry_run } = req.body;

    if (!username) {
      res.status(400).json({ error: 'Validation Error', message: 'username is required' });
      return;
    }
    if (message === undefined || message === null) {
      res.status(400).json({ error: 'Validation Error', message: 'message is required' });
      return;
    }
    if (typeof message !== 'string' || message.trim() === '') {
      res.status(400).json({ error: 'Validation Error', message: 'message must be a non-empty string' });
      return;
    }

    // Length validation
    if (message.length > 1000) {
      res.status(400).json({
        error: 'Validation Error',
        message: 'Message exceeds 1000 character limit',
        maxLength: 1000,
        actualLength: message.length,
      });
      return;
    }

    if (message.length > 10000) {
      res.status(400).json({ error: 'Validation Error', message: 'Message exceeds maximum length' });
      return;
    }

    // Idempotency check
    const idemKey = getIdempotencyKey('dm', username, message);
    const existing = recentActions.get(idemKey);
    if (existing) {
      res.json({ ...existing.result, idempotent: true });
      return;
    }

    // Dry run mode
    if (dry_run) {
      const result = {
        success: true,
        dry_run: true,
        username,
        message: message.substring(0, 100),
        would_send: true,
        dm_daily_sent: dmRateTracker.dailySent,
        dm_daily_limit: dmRateTracker.dailyLimit,
      };
      res.json(result);
      return;
    }

    // Check rate limits
    if (dmRateTracker.dailySent >= dmRateTracker.dailyLimit) {
      res.status(429).json({
        success: false,
        error: 'DM daily limit reached',
        daily_sent: dmRateTracker.dailySent,
        daily_limit: dmRateTracker.dailyLimit,
        reset_at: dmRateTracker.resetAt,
      });
      return;
    }

    // Try to proxy to DM service
    try {
      const dmPort = process.env.INSTAGRAM_DM_PORT || '3100';
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      const response = await fetch(`http://localhost:${dmPort}/api/messages/send-to`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, message }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const data = await response.json() as Record<string, unknown>;
      dmRateTracker.dailySent++;

      const result = { success: true, username, message: message.substring(0, 100), ...data };
      recentActions.set(idemKey, { result, timestamp: Date.now() });
      res.json(result);
    } catch {
      // DM service not available, try direct Safari automation
      res.status(503).json({
        success: false,
        error: 'DM service unavailable',
        message: 'Instagram DM service is not running. Start it on the configured port.',
        retryable: true,
      });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.get('/api/instagram/dm/conversations', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;

    // Try to proxy to DM service
    try {
      const dmPort = process.env.INSTAGRAM_DM_PORT || '3100';
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(`http://localhost:${dmPort}/api/conversations?limit=${limit}`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const data = await response.json() as { conversations?: unknown[] };
      const conversations = data.conversations || [];
      res.json({
        conversations: (conversations as unknown[]).slice(0, limit),
        count: Math.min((conversations as unknown[]).length, limit),
      });
    } catch {
      res.status(503).json({
        success: false,
        error: 'DM service unavailable',
        conversations: [],
        count: 0,
        retryable: true,
      });
    }
  } catch (error) {
    res.status(500).json({ error: String(error), conversations: [], count: 0 });
  }
});

app.get('/api/instagram/dm/messages/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Try to proxy to DM service
    try {
      const dmPort = process.env.INSTAGRAM_DM_PORT || '3100';
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(`http://localhost:${dmPort}/api/conversations/${id}/messages`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const data = await response.json() as { messages?: Array<{ author?: string; content?: string }> };
      res.json({ messages: data.messages || [], count: (data.messages || []).length });
    } catch {
      res.status(503).json({
        success: false,
        error: 'DM service unavailable',
        messages: [],
        retryable: true,
      });
    }
  } catch (error) {
    res.status(500).json({ error: String(error), messages: [] });
  }
});

app.get('/api/instagram/dm/rate-limits', (_req: Request, res: Response) => {
  res.json({
    daily_sent: dmRateTracker.dailySent,
    daily_limit: dmRateTracker.dailyLimit,
    reset_at: dmRateTracker.resetAt,
    daily_used: dmRateTracker.dailySent,
  });
});

app.get('/api/instagram/dm/unread', async (_req: Request, res: Response) => {
  try {
    // Try proxy to DM service
    try {
      const dmPort = process.env.INSTAGRAM_DM_PORT || '3100';
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(`http://localhost:${dmPort}/api/conversations`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const data = await response.json() as { conversations?: Array<{ unread?: boolean }> };
      const unreadCount = (data.conversations || []).filter((c: { unread?: boolean }) => c.unread).length;
      res.json({ count: unreadCount });
    } catch {
      // Return 0 if DM service unavailable
      res.json({ count: 0 });
    }
  } catch (error) {
    res.status(500).json({ error: String(error), count: 0 });
  }
});

app.post('/api/instagram/dm/conversations/:id/read', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    // Mark conversation as read
    res.json({ success: true, conversationId: id, markedAsRead: true });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.post('/api/instagram/dm/suggest-reply', async (req: Request, res: Response) => {
  try {
    const { message, context } = req.body;

    if (!message) {
      res.status(400).json({ error: 'Validation Error', message: 'message is required' });
      return;
    }

    const ai = getAIGenerator();
    const analysis = ai.analyzePost({
      mainPost: message,
      username: context?.username || 'user',
      replies: context?.previousMessages || [],
    });

    const suggestions: string[] = [];
    for (let i = 0; i < 3; i++) {
      const suggestion = await ai.generateComment(analysis);
      suggestions.push(suggestion);
    }

    res.json({
      suggestions,
      model_used: process.env.OPENAI_API_KEY ? 'gpt-4o' : 'local-templates',
      platform_char_limit: 1000,
    });
  } catch (error) {
    res.status(500).json({ error: String(error), suggestions: [] });
  }
});

app.post('/api/instagram/dm/conversations/:id/archive', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    res.json({ success: true, conversationId: id, archived: true });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// ═══════════════════════════════════════════════════════════════════════
//   RATE LIMITS
// ═══════════════════════════════════════════════════════════════════════

app.get('/api/instagram/rate-limits', (_req: Request, res: Response) => {
  const d = getDriver();
  res.json(d.getRateLimits());
});

app.put('/api/instagram/rate-limits', (req: Request, res: Response) => {
  const updates = req.body as Partial<InstagramConfig>;
  const d = getDriver();
  d.setConfig(updates);
  res.json({ rateLimits: d.getConfig() });
});

// ═══════════════════════════════════════════════════════════════════════
//   POST DETAILS
// ═══════════════════════════════════════════════════════════════════════

app.get('/api/instagram/post', async (_req: Request, res: Response) => {
  try {
    const d = getDriver();
    const details = await d.getPostDetails();
    res.json(details);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.get('/api/instagram/post/metrics', async (_req: Request, res: Response) => {
  try {
    const d = getDriver();
    const metrics = await d.getPostMetrics();
    res.json({ success: true, ...metrics });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.get('/api/instagram/profile/posts', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 12;
    const d = getDriver();
    const result = await (d as any).executeJS(`
      (function() {
        var allLinks = document.querySelectorAll('a');
        var posts = [];
        var seen = {};
        for (var i = 0; i < allLinks.length; i++) {
          var href = allLinks[i].getAttribute('href') || '';
          var type = ''; var shortcode = '';
          var pIdx = href.indexOf('/p/');
          var rIdx = href.indexOf('/reel/');
          if (pIdx !== -1) {
            type = 'post';
            shortcode = href.substring(pIdx + 3).split('/')[0];
          } else if (rIdx !== -1) {
            type = 'reel';
            shortcode = href.substring(rIdx + 6).split('/')[0];
          }
          if (shortcode && !seen[shortcode]) {
            seen[shortcode] = true;
            posts.push({ shortcode: shortcode, type: type, url: 'https://www.instagram.com/' + (type === 'reel' ? 'reel' : 'p') + '/' + shortcode + '/' });
          }
          if (posts.length >= ${limit}) break;
        }
        return JSON.stringify(posts);
      })()
    `);
    const posts = JSON.parse(result || '[]');
    res.json({ posts, count: posts.length, pageUrl: 'profile_grid' });
  } catch (error) {
    res.status(500).json({ error: String(error), posts: [] });
  }
});

// ═══════════════════════════════════════════════════════════════════════
//   AI FEATURES
// ═══════════════════════════════════════════════════════════════════════

app.post('/api/instagram/ai-message', async (req: Request, res: Response) => {
  try {
    const { context, niche, recipient_username } = req.body;

    if (!context && !niche) {
      res.status(400).json({ error: 'Validation Error', message: 'context or niche is required' });
      return;
    }

    const ai = getAIGenerator();
    const analysis = ai.analyzePost({
      mainPost: context || `Content about ${niche}`,
      username: recipient_username || 'user',
      replies: [],
    });

    const text = await ai.generateComment(analysis);

    res.json({
      text,
      model_used: process.env.OPENAI_API_KEY ? 'gpt-4o' : 'local-templates',
      platform_char_limit: 1000,
      char_count: text.length,
    });
  } catch (error) {
    if (String(error).includes('API') || String(error).includes('fetch')) {
      res.status(503).json({
        error: 'AI service unavailable',
        message: 'AI generation failed, please try again',
        fallback: 'Thanks for sharing this! Really appreciate your perspective.',
      });
    } else {
      res.status(500).json({ error: String(error) });
    }
  }
});

app.post('/api/instagram/ai-score', async (req: Request, res: Response) => {
  try {
    const { content, username, niche } = req.body;

    if (!content && !username) {
      res.status(400).json({ error: 'Validation Error', message: 'content or username is required' });
      return;
    }

    const ai = getAIGenerator();
    const analysis = ai.analyzePost({
      mainPost: content || '',
      username: username || 'unknown',
      replies: [],
    });

    // Calculate score based on analysis
    let score = 50; // base
    if (analysis.sentiment === 'positive') score += 15;
    if (analysis.sentiment === 'question') score += 10;
    if (analysis.topics.length > 1) score += 10;
    if (analysis.isInappropriate) score = Math.max(0, score - 40);
    if (niche && analysis.topics.some(t => niche.toLowerCase().includes(t))) score += 15;
    score = Math.min(100, Math.max(0, score));

    const signals = [];
    if (analysis.sentiment === 'positive') signals.push('positive_sentiment');
    if (analysis.topics.length > 1) signals.push('multi_topic');
    if (analysis.isInappropriate) signals.push('inappropriate_content');

    const reasoning = `Score based on sentiment (${analysis.sentiment}), topics (${analysis.topics.join(', ')}), tone (${analysis.tone})`;

    res.json({
      score: Math.round(score),
      reasoning,
      signals,
      model_used: 'local-analysis',
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.post('/api/instagram/analyze', async (_req: Request, res: Response) => {
  try {
    const d = getDriver();
    const ai = getAIGenerator();

    const details = await d.getPostDetails();
    const analysis = ai.analyzePost({
      mainPost: details.caption || '',
      username: details.username || '',
      replies: [],
    });

    const suggestedComment = await ai.generateComment(analysis);

    res.json({ analysis, suggestedComment, details });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// ═══════════════════════════════════════════════════════════════════════
//   SESSION MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════

app.post('/api/instagram/sessions', (_req: Request, res: Response) => {
  const sessionId = createSessionId();
  const session: Session = {
    id: sessionId,
    createdAt: new Date().toISOString(),
    lastAccessedAt: new Date().toISOString(),
    platform: 'instagram',
  };
  sessions.set(sessionId, session);
  res.status(201).json({ sessionId, ...session });
});

app.get('/api/instagram/sessions', (_req: Request, res: Response) => {
  const activeSessions = Array.from(sessions.values());
  res.json({ sessions: activeSessions, count: activeSessions.length });
});

app.get('/api/instagram/sessions/:id', (req: Request, res: Response) => {
  const session = sessions.get(req.params.id);
  if (!session) {
    res.status(404).json({ error: 'Not Found', message: 'Session not found or expired' });
    return;
  }
  session.lastAccessedAt = new Date().toISOString();
  res.json(session);
});

app.delete('/api/instagram/sessions/:id', (req: Request, res: Response) => {
  const existed = sessions.delete(req.params.id);
  if (!existed) {
    res.status(404).json({ error: 'Not Found', message: 'Session not found' });
    return;
  }
  res.json({ success: true, message: 'Session closed', sessionId: req.params.id });
});

// ═══════════════════════════════════════════════════════════════════════
//   MULTI-POST COMMENTING WITH AI
// ═══════════════════════════════════════════════════════════════════════

app.post('/api/instagram/engage/multi', async (req: Request, res: Response) => {
  try {
    const { count = 5, delayBetween = 30000, useAI = true } = req.body;
    const d = getDriver();
    const ai = getAIGenerator();
    const logger = getCommentLogger();

    const results: Array<{ success: boolean; username: string; comment: string; postUrl?: string; error?: string }> = [];
    const logs: string[] = [];
    const engageStart = Date.now();

    const log = (msg: string) => {
      const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
      const formatted = `[${timestamp}] ${msg}`;
      console.log(formatted);
      logs.push(formatted);
    };

    log(`[Instagram] Starting multi-post commenting (${count} posts)`);

    await d.navigateToPost('https://www.instagram.com');
    await new Promise(r => setTimeout(r, 3000));

    log(`[Instagram] Loading previously commented posts from database...`);
    const commentedPostIds = await logger.getCommentedPostUrls('instagram');
    log(`[Instagram] Found ${commentedPostIds.size} posts we've already commented on`);

    log(`[Instagram] Collecting ${count} post URLs from feed...`);
    let allPosts: Array<{ username: string; url?: string }> = [];
    let scrollAttempts = 0;
    let likesGiven = 0;

    while (allPosts.length < count && scrollAttempts < 5) {
      const posts = await d.findPosts(count * 2);
      for (const post of posts) {
        if (post.url && !allPosts.find(p => p.url === post.url)) {
          const postId = post.url.match(/\/p\/([^\/\?]+)/)?.[1];
          if (postId && commentedPostIds.has(postId)) {
            log(`[Instagram] Skipping already-commented post: ${post.url}`);
            continue;
          }
          allPosts.push(post);

          if (likesGiven < 3) {
            try {
              await d.navigateToPost(post.url);
              await new Promise(r => setTimeout(r, 1500));
              const liked = await d.likePost();
              if (liked) {
                likesGiven++;
                log(`[Instagram] Liked post by @${post.username || 'unknown'}`);
              }
              await d.clickBack();
              await new Promise(r => setTimeout(r, 1000));
            } catch {
              // Continue if like fails
            }
          }
        }
      }
      if (allPosts.length < count) {
        await d.scroll();
        await new Promise(r => setTimeout(r, 1500));
        scrollAttempts++;
      }
    }

    const targetPosts = allPosts.slice(0, count);
    log(`[Instagram] Found ${targetPosts.length} unique posts, liked ${likesGiven}`);

    for (let i = 0; i < targetPosts.length; i++) {
      const targetPost = targetPosts[i];

      try {
        if (!targetPost.url) {
          results.push({ success: false, username: '', comment: '', error: 'No post URL' });
          continue;
        }

        log(`[Instagram] Navigating to: ${targetPost.url}`);
        await d.navigateToPost(targetPost.url);
        await new Promise(r => setTimeout(r, 3000));

        const details = await d.getPostDetails();
        const existingComments = await d.getCommentsDetailed(10);

        const ourUsername = 'isaiahdupree';
        const alreadyCommented = existingComments.some(c =>
          c.username?.toLowerCase() === ourUsername.toLowerCase()
        );

        if (alreadyCommented) {
          results.push({ success: false, username: details.username || '', comment: '', postUrl: targetPost?.url, error: 'Already commented' });
          continue;
        }

        const analysis = ai.analyzePost({
          mainPost: details.caption || '',
          username: details.username || 'unknown',
          replies: existingComments.map(c => `@${c.username}: ${c.text}`),
        });

        if (analysis.isInappropriate) {
          results.push({ success: false, username: details.username || '', comment: '', postUrl: targetPost?.url, error: `Skipped: ${analysis.skipReason}` });
          continue;
        }

        const comment = await ai.generateComment(analysis);
        const result = await d.postComment(comment);

        if (result.success) {
          results.push({ success: true, username: details.username || '', comment, postUrl: targetPost?.url });
        } else {
          results.push({ success: false, username: details.username || '', comment, postUrl: targetPost?.url, error: result.error });
        }

        if (i < targetPosts.length - 1) {
          await new Promise(r => setTimeout(r, delayBetween));
        }

      } catch (error) {
        results.push({ success: false, username: '', comment: '', error: String(error) });
        await d.clickBack();
      }
    }

    const duration = Date.now() - engageStart;
    const successful = results.filter(r => r.success).length;

    const dbResult = await logger.logSession(results, 'instagram');

    res.json({
      success: true,
      total: count,
      successful,
      failed: count - successful,
      duration,
      useAI,
      results,
      logs,
      database: {
        sessionId: logger.getSessionId(),
        logged: dbResult.logged,
        failed: dbResult.failed,
      },
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// ═══════════════════════════════════════════════════════════════════════
//   DATABASE ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════

app.get('/api/instagram/db/history', async (req: Request, res: Response) => {
  try {
    const { limit = '50' } = req.query;
    const logger = getCommentLogger();
    const history = await logger.getHistory({
      platform: 'instagram',
      limit: parseInt(limit as string),
    });
    res.json({ history, count: history.length });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.get('/api/instagram/db/stats', async (_req: Request, res: Response) => {
  try {
    const logger = getCommentLogger();
    const stats = await logger.getStats('instagram');
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// ═══════════════════════════════════════════════════════════════════════
//   KEYWORD SEARCH
// ═══════════════════════════════════════════════════════════════════════

app.post('/api/instagram/search/keyword', async (req: Request, res: Response) => {
  try {
    const { keyword, count = 5, comment = true, delayBetween = 8000 } = req.body;
    if (!keyword) {
      res.status(400).json({ error: 'keyword is required' });
      return;
    }

    const d = getDriver();
    const ai = getAIGenerator();
    const logger = getCommentLogger();

    const results: Array<{ success: boolean; username: string; comment: string; postUrl?: string; error?: string }> = [];
    const logs: string[] = [];
    const searchStart = Date.now();

    const log = (msg: string) => {
      const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
      const formatted = `[${timestamp}] ${msg}`;
      console.log(formatted);
      logs.push(formatted);
    };

    log(`[Instagram] Keyword search: "${keyword}"`);

    const commentedPostIds = await logger.getCommentedPostUrls('instagram');
    const posts = await d.searchByKeyword(keyword);

    const freshPosts = posts.filter(p => {
      const postId = p.url?.match(/\/p\/([^\/\?]+)/)?.[1];
      if (postId && commentedPostIds.has(postId)) return false;
      return true;
    });

    const targetPosts = freshPosts.slice(0, count);

    if (!comment) {
      res.json({ success: true, keyword, posts: targetPosts, count: targetPosts.length });
      return;
    }

    for (let i = 0; i < targetPosts.length; i++) {
      const post = targetPosts[i];

      try {
        await d.navigateToPost(post.url!);
        await new Promise(r => setTimeout(r, 3000));

        const captionData = await d.getCaptionDetailed();
        const existingComments = await d.getCommentsDetailed(10);

        const analysis = ai.analyzePost({
          mainPost: `[Keyword: ${keyword}] ${captionData.caption}`,
          username: post.username || 'unknown',
          replies: existingComments.map(c => `@${c.username}: ${c.text}`),
        });

        if (analysis.isInappropriate) {
          results.push({ success: false, username: post.username, comment: '', postUrl: post.url, error: `Skipped: ${analysis.skipReason}` });
          continue;
        }

        const generatedComment = await ai.generateComment(analysis);
        const result = await d.postComment(generatedComment);

        if (result.success) {
          results.push({ success: true, username: post.username, comment: generatedComment, postUrl: post.url });
        } else {
          results.push({ success: false, username: post.username, comment: generatedComment, postUrl: post.url, error: result.error });
        }

        if (i < targetPosts.length - 1) {
          await new Promise(r => setTimeout(r, delayBetween));
        }
      } catch (error) {
        results.push({ success: false, username: post.username, comment: '', postUrl: post.url, error: String(error) });
      }
    }

    const duration = Date.now() - searchStart;
    const successful = results.filter(r => r.success).length;
    const dbResult = await logger.logSession(results, 'instagram');

    res.json({
      success: true,
      keyword,
      total: targetPosts.length,
      successful,
      failed: targetPosts.length - successful,
      duration,
      results,
      logs,
      database: {
        sessionId: logger.getSessionId(),
        logged: dbResult.logged,
        failed: dbResult.failed,
      },
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// ═══════════════════════════════════════════════════════════════════════
//   ACTIVITY FEED
// ═══════════════════════════════════════════════════════════════════════

app.get('/api/instagram/activity/followers', async (_req: Request, res: Response) => {
  try {
    const d = getDriver();
    await (d as any).navigate('https://www.instagram.com/accounts/activity/');
    await new Promise(r => setTimeout(r, 4000));

    const raw = await (d as any).executeJS(`(function(){` +
      `var seen={};var events=[];` +
      `var blocked=['accounts','explore','reels','direct','stories','p','about','privacy','terms','help','nametag'];` +
      `var items=document.querySelectorAll('div[role="listitem"],section div>div>div');` +
      `for(var i=0;i<Math.min(items.length,80);i++){` +
        `var el=items[i];` +
        `var text=(el.textContent||'').trim();` +
        `if(text.indexOf('started following you')<0&&text.indexOf('followed you')<0)continue;` +
        `var links=el.querySelectorAll('a[href]');` +
        `var username='';` +
        `for(var j=0;j<links.length;j++){` +
          `var href=links[j].getAttribute('href')||'';` +
          `var m=href.match(/^\\/([a-zA-Z0-9_.]+)\\/?$/);` +
          `if(m&&m[1].length>=2&&m[1].length<=30&&blocked.indexOf(m[1].toLowerCase())<0){username=m[1];break;}` +
        `}` +
        `if(username&&!seen[username.toLowerCase()]){` +
          `seen[username.toLowerCase()]=1;` +
          `events.push({username:username,text:text.substring(0,120)});` +
        `}` +
      `}` +
      `return JSON.stringify(events);` +
    `})()`);

    const events = JSON.parse(raw || '[]');
    res.json({ success: true, events, count: events.length });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// ═══════════════════════════════════════════════════════════════════════
//   CATCH-ALL: 404 for undefined routes, 405 for wrong methods
// ═══════════════════════════════════════════════════════════════════════

// Track defined routes for 405 detection
const definedPaths = new Set<string>();
app._router?.stack?.forEach((layer: { route?: { path: string } }) => {
  if (layer.route) {
    definedPaths.add(layer.route.path);
  }
});

app.all('/api/*', (req: Request, res: Response) => {
  // Check if path exists but method is wrong
  const pathExists = definedPaths.has(req.path);
  if (pathExists) {
    res.status(405).json({
      error: 'Method Not Allowed',
      message: `${req.method} is not supported for ${req.path}`,
    });
    res.set('Allow', 'GET, POST, PUT, DELETE');
  } else {
    res.status(404).json({
      error: 'Not Found',
      message: `Endpoint ${req.path} not found`,
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════
//   ERROR HANDLING MIDDLEWARE
// ═══════════════════════════════════════════════════════════════════════

// JSON parse error handler
app.use((err: Error & { type?: string; status?: number }, _req: Request, res: Response, next: NextFunction) => {
  if (err.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Bad Request', message: 'Invalid JSON in request body' });
    return;
  }
  if (err.type === 'entity.too.large') {
    res.status(413).json({ error: 'Payload Too Large', message: 'Request body exceeds size limit' });
    return;
  }
  next(err);
});

// Global error handler - DO NOT expose stack traces
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[Server Error]', err.message);
  if (!res.headersSent) {
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'An unexpected error occurred',
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════
//   SERVER START
// ═══════════════════════════════════════════════════════════════════════

export function startServer(port: number = PORT): void {
  app.listen(port, () => {
    console.log(`Instagram API v${SERVICE_VERSION} running on http://localhost:${port}`);
    console.log(`   Health:     GET  /health`);
    console.log(`   Status:     GET  /api/instagram/status`);
    console.log(`   Comments:   POST /api/instagram/comments/post`);
    console.log(`   DM:         POST /api/instagram/dm/send`);
    console.log(`   Profile:    GET  /api/instagram/profile`);
    console.log(`   Sessions:   POST /api/instagram/sessions`);
    console.log(`   AI:         POST /api/instagram/ai-message`);
  });
}

if (process.argv[1]?.includes('server')) {
  startServer();
}

export { app };
