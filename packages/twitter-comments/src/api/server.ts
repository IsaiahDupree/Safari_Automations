/**
 * Twitter Comment API Server - Port 3007
 * Now with AI-powered comment generation!
 */
import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { TwitterDriver, type TwitterConfig, type ComposeOptions, type SearchResult, type TweetDetail } from '../automation/twitter-driver.js';
import { TabCoordinator } from '../automation/tab-coordinator.js';
import { SafariDriver } from '../automation/safari-driver.js';

const app = express();
app.use(cors());
app.use(express.json());

// Ensure all responses have JSON content-type
app.use((req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Content-Type', 'application/json');
  next();
});

const PORT = parseInt(process.env.TWITTER_COMMENTS_PORT || '3007');

// ─── Tab Coordination ────────────────────────────────────────────────
const SERVICE_NAME = 'twitter-comments';
const SERVICE_PORT = 3007;
const SESSION_URL_PATTERN = 'x.com';
const activeCoordinators = new Map<string, TabCoordinator>();
let tabDriver: SafariDriver | null = null;
function getTabDriver(): SafariDriver {
  if (!tabDriver) tabDriver = new SafariDriver();
  return tabDriver;
}

// ─── Authentication Middleware ──────────────────────────────
const VALID_TOKEN = process.env.API_TOKEN || 'test-token-12345';

function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    res.status(401).json({ error: 'Unauthorized', message: 'Authorization header required' });
    return;
  }

  if (!authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized', message: 'Invalid authorization format. Use: Bearer <token>' });
    return;
  }

  const token = authHeader.substring(7);

  if (!token || token.trim() === '') {
    res.status(400).json({ error: 'Bad Request', message: 'Bearer token cannot be empty' });
    return;
  }

  if (token !== VALID_TOKEN) {
    res.status(401).json({ error: 'Unauthorized', message: 'Invalid token' });
    return;
  }

  next();
}

// ─── Input Validation Helpers ───────────────────────────────
function validateRequired(res: Response, fields: { name: string; value: any }[]): boolean {
  for (const field of fields) {
    if (field.value === undefined) {
      res.status(400).json({ error: 'Bad Request', message: `Missing required field: ${field.name}` });
      return false;
    }
    if (field.value === null) {
      res.status(400).json({ error: 'Bad Request', message: `Field '${field.name}' cannot be null` });
      return false;
    }
    if (typeof field.value === 'string' && field.value.trim() === '') {
      res.status(400).json({ error: 'Bad Request', message: `Field '${field.name}' cannot be empty` });
      return false;
    }
  }
  return true;
}

function sanitizeText(text: string): string {
  // Basic SQL injection prevention - remove SQL keywords in unsafe patterns
  // This is a simple layer; real apps should use parameterized queries
  const sqlPattern = /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|UNION|SCRIPT)\b)/gi;
  return text.replace(sqlPattern, (match) => `[FILTERED:${match}]`);
}

// ─── Error Handler Middleware ───────────────────────────────
function errorHandler(err: any, req: Request, res: Response, next: NextFunction) {
  console.error('[Error]', err);

  const isProd = process.env.NODE_ENV === 'production';
  const errorResponse: any = {
    error: 'Internal Server Error',
    message: isProd ? 'An error occurred processing your request' : String(err)
  };

  // Never expose stack traces in production
  if (!isProd && err.stack) {
    errorResponse.stack = err.stack;
  }

  res.setHeader('Content-Type', 'application/json');
  res.status(500).json(errorResponse);
}

// AI Client for comment generation
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (OPENAI_API_KEY) {
  console.log('[AI] ✅ OpenAI API key loaded - AI comments enabled');
} else {
  console.log('[AI] ⚠️ No API key - using local templates');
}

async function generateAIComment(postContent: string, username: string): Promise<string> {
  if (!OPENAI_API_KEY) {
    const templates = ["This! 💯", "Exactly what I was thinking 🎯", "Well said 👏", "Facts 🔥"];
    return templates[Math.floor(Math.random() * templates.length)];
  }
  
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: 'You are a Twitter/X user. Generate SHORT, witty comments (max 100 chars) with 1 emoji. Be concise and clever.' },
          { role: 'user', content: `Reply to this tweet by @${username}: "${postContent.substring(0, 200)}"` }
        ],
        max_tokens: 50,
        temperature: 0.85,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const data = await response.json() as { choices?: { message?: { content?: string } }[] };
    return data.choices?.[0]?.message?.content?.trim() || "This! 💯";
  } catch {
    clearTimeout(timeout);
    return "This! 💯";
  }
}

let driver: TwitterDriver | null = null;
function getDriver(): TwitterDriver { if (!driver) driver = new TwitterDriver(); return driver; }

// ─── Public Routes (no auth required) ──────────────────────
app.get('/health', (req: Request, res: Response) => res.json({ status: 'ok', service: 'twitter-comments', port: PORT, timestamp: new Date().toISOString(), version: '1.0.0', uptime: process.uptime() }));

// ─── Protected Routes (auth required) ───────────────────────
app.use('/api', authMiddleware);

// ── Tab claim enforcement ─────────────────────────────────────────────────────
// Every automation route MUST have an active tab claim before it runs.
// On first request: auto-claims an existing tab OR opens a new one.
// Subsequent requests: validates the claim is still alive.
// Routes exempt: /health, /api/tabs/*, /api/*/status, /api/*/rate-limits
const OPEN_URL = 'https://x.com';
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
  const autoId = `twitter-comments-auto-${Date.now()}`;
  try {
    const coord = new TabCoordinator(autoId, SERVICE_NAME, PORT, SESSION_URL_PATTERN, OPEN_URL);
    activeCoordinators.set(autoId, coord);
    const claim = await coord.claim();
    getTabDriver().setTrackedTab(claim.windowIndex, claim.tabIndex, SESSION_URL_PATTERN);
    console.log(`[requireTabClaim] Auto-claimed w=${claim.windowIndex} t=${claim.tabIndex} (${claim.tabUrl})`);
    next();
  } catch (err) {
    res.status(503).json({
      error: 'No Safari tab available for twitter-comments',
      detail: String(err),
      fix: `Open Safari and navigate to https://x.com, or POST /api/tabs/claim with { agentId, openUrl: "https://x.com" }`,
    });
  }
}

app.use(requireTabClaim);
// ─────────────────────────────────────────────────────────────────────────────


app.get('/api/twitter/status', async (req: Request, res: Response) => {
  try { const d = getDriver(); const s = await d.getStatus(); const r = d.getRateLimits(); res.json({ ...s, ...r }); }
  catch (e) { res.status(500).json({ error: String(e) }); }
});

app.get('/api/twitter/rate-limits', (req: Request, res: Response) => res.json(getDriver().getRateLimits()));
app.put('/api/twitter/rate-limits', (req: Request, res: Response) => { getDriver().setConfig(req.body); res.json({ rateLimits: getDriver().getConfig() }); });

app.post('/api/twitter/navigate', async (req: Request, res: Response) => {
  try {
    const { url } = req.body;
    if (!validateRequired(res, [{ name: 'url', value: url }])) return;
    res.json({ success: await getDriver().navigateToPost(url), url });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.get('/api/twitter/comments', async (req: Request, res: Response) => {
  try { const comments = await getDriver().getComments(parseInt(req.query.limit as string) || 50); res.json({ comments, count: comments.length }); }
  catch (e) { res.status(500).json({ error: String(e) }); }
});

app.post('/api/twitter/comments/post', async (req: Request, res: Response) => {
  try {
    const { text, postUrl, useAI, postContent, username } = req.body;

    // Validate required fields based on mode
    if (!useAI && !validateRequired(res, [{ name: 'text', value: text }])) return;
    if (!postUrl && !validateRequired(res, [{ name: 'postUrl', value: postUrl }])) return;

    // Validate URL format
    if (postUrl) {
      try {
        new URL(postUrl);
      } catch {
        res.status(400).json({ success: false, error: 'Invalid URL format for postUrl' });
        return;
      }
    }

    const d = getDriver();
    if (postUrl) { await d.navigateToPost(postUrl); await new Promise(r => setTimeout(r, 3000)); }

    // Use AI to generate comment if requested or if no text provided
    let commentText = text;
    let aiGenerated = false;
    if (useAI || !text) {
      commentText = await generateAIComment(postContent || 'Tweet', username || 'user');
      aiGenerated = true;
      console.log(`[AI] Generated: "${commentText}"`);
    }

    if (!commentText) { res.status(400).json({ error: 'text required or useAI must be true' }); return; }

    // Sanitize text to prevent SQL injection
    commentText = sanitizeText(commentText);

    // Validate 280 character limit - REJECT, don't truncate
    if (commentText.length > 280) {
      res.status(400).json({
        error: 'Validation Error',
        message: `Tweet text exceeds 280 character limit (${commentText.length} characters)`,
        charCount: commentText.length,
        maxChars: 280
      });
      return;
    }

    const result = await d.postComment(commentText);
    res.json({
      ...result,
      success: result.success || false,
      generatedComment: commentText,
      ai_generated: aiGenerated,
      usedAI: aiGenerated,
      charCount: commentText.length
    });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// AI-only comment generation endpoint
app.post('/api/twitter/comments/generate', async (req: Request, res: Response) => {
  try {
    const { postContent, username } = req.body;
    // postContent is optional - will use default if not provided
    const comment = await generateAIComment(postContent || 'Tweet', username || 'user');
    res.json({ success: true, comment, usedAI: !!OPENAI_API_KEY });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ─── AI Tweet Generation ─────────────────────────────────────

async function generateAITweet(topic: string, style?: string, context?: string): Promise<string> {
  if (!OPENAI_API_KEY) {
    return `Thoughts on ${topic}... This is something worth exploring further. What does everyone think? Share your perspective below.`;
  }

  const targetChars = 224; // ~80% of 280
  const styleHint = style || 'insightful, authentic, conversational';
  const contextHint = context ? `\nAdditional context: ${context}` : '';

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: `You are a Twitter/X thought leader. Write tweets that are EXACTLY ${targetChars - 20} to ${targetChars} characters long (including spaces and emojis). This is critical — count carefully.

Style: ${styleHint}
Rules:
- Use 1-2 relevant emojis max
- No hashtags unless specifically asked
- Sound human and authentic, not corporate
- Include a hook or strong opening line
- End with a thought-provoking statement, call to action, or perspective
- Use line breaks for readability when it makes sense
- MUST be ${targetChars - 20} to ${targetChars} characters. Count every character including spaces.`
          },
          {
            role: 'user',
            content: `Write a tweet about: ${topic}${contextHint}\n\nRemember: aim for exactly ~${targetChars} characters total.`
          }
        ],
        max_tokens: 150,
        temperature: 0.9,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const data = await response.json() as { choices?: { message?: { content?: string } }[] };
    let tweet = data.choices?.[0]?.message?.content?.trim() || '';
    // Strip wrapping quotes if AI added them
    if ((tweet.startsWith('"') && tweet.endsWith('"')) || (tweet.startsWith("'") && tweet.endsWith("'"))) {
      tweet = tweet.slice(1, -1);
    }
    if (!tweet) return `Exploring ${topic} — there's so much potential here. The future is being built right now and most people aren't paying attention. What's your take?`;
    return tweet;
  } catch {
    clearTimeout(timeout);
    return `Exploring ${topic} — there's so much potential here. The future is being built right now and most people aren't paying attention. What's your take?`;
  }
}

// ─── Compose Tweet ──────────────────────────────────────────
app.post('/api/twitter/tweet', async (req: Request, res: Response) => {
  try {
    const { text, useAI, topic, style, context, audience, replySettings, poll, schedule, location, media, thread } = req.body;

    let tweetText = text;
    if (useAI || (!text && topic)) {
      if (!topic && !text) { res.status(400).json({ error: 'text or topic required' }); return; }
      tweetText = await generateAITweet(topic || text, style, context);
      console.log(`[AI Tweet] Generated (${tweetText.length} chars): "${tweetText}"`);
    }

    if (!tweetText) { res.status(400).json({ error: 'text or topic required' }); return; }

    // Sanitize text
    tweetText = sanitizeText(tweetText);

    // Validate 280 character limit - REJECT, don't truncate
    if (tweetText.length > 280) {
      res.status(400).json({
        error: 'Validation Error',
        message: `Tweet text exceeds 280 character limit (${tweetText.length} characters)`,
        charCount: tweetText.length,
        maxChars: 280
      });
      return;
    }

    // Build compose options from request body
    const options: ComposeOptions = {};
    if (audience) options.audience = audience;
    if (replySettings) options.replySettings = replySettings;
    if (poll) options.poll = poll;
    if (schedule) options.schedule = schedule;
    if (location) options.location = location;
    if (media) options.media = media;
    if (thread) options.thread = thread;
    const hasOptions = Object.keys(options).length > 0;

    const result = await getDriver().composeTweet(tweetText, hasOptions ? options : undefined);
    res.json({ ...result, tweetText, charCount: tweetText.length, usedAI: !!(useAI || (!text && topic)) });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ─── AI Tweet Generation Only (preview without posting) ─────
app.post('/api/twitter/tweet/generate', async (req: Request, res: Response) => {
  try {
    const { topic, style, context } = req.body;
    if (!validateRequired(res, [{ name: 'topic', value: topic }])) return;
    const tweet = await generateAITweet(topic, style, context);
    res.json({ success: true, tweet, charCount: tweet.length, maxChars: 280, usedAI: !!OPENAI_API_KEY });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ─── Tweet Search ──────────────────────────────────────────
app.post('/api/twitter/search', async (req: Request, res: Response) => {
  try {
    const { query, tab, maxResults, scrolls } = req.body;
    if (!validateRequired(res, [{ name: 'query', value: query }])) return;
    const result = await getDriver().searchTweets(query, { tab, maxResults, scrolls });
    res.json({ success: true, ...result, count: result.tweets.length });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ─── Tweet Detail ──────────────────────────────────────────
app.post('/api/twitter/tweet/detail', async (req: Request, res: Response) => {
  try {
    const { url } = req.body;
    if (!validateRequired(res, [{ name: 'url', value: url }])) return;
    const detail = await getDriver().getTweetDetail(url);
    if (!detail) { res.status(404).json({ error: 'Tweet not found or failed to extract' }); return; }
    res.json({ success: true, tweet: detail });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ─── Reply to Tweet ────────────────────────────────────────
app.post('/api/twitter/tweet/reply', async (req: Request, res: Response) => {
  try {
    const { url, text, useAI, topic, style, context } = req.body;
    if (!validateRequired(res, [{ name: 'url', value: url }])) return;

    let replyText = text;
    if (useAI || (!text && topic)) {
      if (!topic && !text) { res.status(400).json({ error: 'text or topic required for reply' }); return; }
      replyText = await generateAITweet(topic || text, style, context);
      console.log(`[AI Reply] Generated (${replyText.length} chars): "${replyText}"`);
    }
    if (!replyText) { res.status(400).json({ error: 'text or topic required' }); return; }

    // Sanitize text
    replyText = sanitizeText(replyText);

    // Validate 280 character limit - REJECT, don't truncate
    if (replyText.length > 280) {
      res.status(400).json({
        error: 'Validation Error',
        message: `Reply text exceeds 280 character limit (${replyText.length} characters)`,
        charCount: replyText.length,
        maxChars: 280
      });
      return;
    }

    const result = await getDriver().replyToTweet(url, replyText);
    res.json({ ...result, replyText, charCount: replyText.length, usedAI: !!(useAI || (!text && topic)) });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ─── User Timeline ─────────────────────────────────────────
app.post('/api/twitter/timeline', async (req: Request, res: Response) => {
  try {
    const { handle, maxResults } = req.body;
    if (!validateRequired(res, [{ name: 'handle', value: handle }])) return;
    const result = await getDriver().getUserTimeline(handle, maxResults);
    res.json({ success: true, ...result, count: result.tweets.length });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ─── Home Feed ─────────────────────────────────────────────
app.post('/api/twitter/feed', async (req: Request, res: Response) => {
  try {
    const { tab, maxResults } = req.body;
    const result = await getDriver().getHomeFeed(tab || 'foryou', maxResults);
    res.json({ success: true, ...result, count: result.tweets.length });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ─── Search + Reply (find posts and reply) ─────────────────
app.post('/api/twitter/search-and-reply', async (req: Request, res: Response) => {
  try {
    const { query, tab, replyText, useAI, topic, style, context, maxReplies } = req.body;
    if (!validateRequired(res, [{ name: 'query', value: query }])) return;
    if (!replyText && !useAI && !topic) { res.status(400).json({ error: 'replyText or useAI+topic required' }); return; }

    const limit = maxReplies || 1;
    const searchResult = await getDriver().searchTweets(query, { tab, maxResults: limit + 5 });
    if (searchResult.tweets.length === 0) {
      res.json({ success: false, error: 'No tweets found', query });
      return;
    }

    const replies: { tweetUrl: string; author: string; replyText: string; result: any }[] = [];
    for (let i = 0; i < Math.min(limit, searchResult.tweets.length); i++) {
      const tweet = searchResult.tweets[i];
      if (!tweet.tweetUrl) continue;

      let text = replyText;
      if (useAI || (!replyText && topic)) {
        const ctx = `Replying to @${tweet.handle}: "${tweet.text.substring(0, 100)}"`;
        text = await generateAITweet(topic || query, style, ctx);
      }
      if (!text) continue;
      if (text.length > 280) text = text.substring(0, 277) + '...';

      const result = await getDriver().replyToTweet(tweet.tweetUrl, text);
      replies.push({ tweetUrl: tweet.tweetUrl, author: tweet.handle, replyText: text, result });

      // Small delay between replies
      if (i < limit - 1) await new Promise(r => setTimeout(r, 3000));
    }

    res.json({ success: true, query, tweetsFound: searchResult.tweets.length, replies, repliesPosted: replies.filter(r => r.result?.success).length });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// === NOTIFICATIONS SCRAPING ===
app.get('/api/twitter/notifications', async (req: Request, res: Response) => {
  try {
    const d = getDriver();
    await (d as any).navigate('https://x.com/notifications');
    await new Promise(r => setTimeout(r, 4000));

    const raw = await (d as any).executeJS(`
      (function() {
        var items = [];
        var cells = document.querySelectorAll('[data-testid="cellInnerDiv"]');
        for (var i = 0; i < Math.min(cells.length, 30); i++) {
          var cell = cells[i];
          var text = (cell.innerText || '').trim();
          if (!text || text.length < 5) continue;
          var type = 'other';
          var actor = '';
          var lower = text.toLowerCase();
          if (lower.indexOf('followed you') !== -1) type = 'follow';
          else if (lower.indexOf('liked your') !== -1) type = 'like';
          else if (lower.indexOf('retweeted your') !== -1 || lower.indexOf('reposted your') !== -1) type = 'repost';
          else if (lower.indexOf('replied') !== -1) type = 'reply';
          else if (lower.indexOf('mentioned you') !== -1) type = 'mention';
          var links = cell.querySelectorAll('a[href^="/"]');
          for (var j = 0; j < links.length; j++) {
            var href = links[j].getAttribute('href') || '';
            if (href.match(/^\\/[a-zA-Z0-9_]+$/) && href.indexOf('/') === 0 && href.split('/').length === 2) {
              actor = href.substring(1);
              break;
            }
          }
          items.push({ type: type, actor: actor, text: text.substring(0, 200) });
        }
        return JSON.stringify(items);
      })()
    `);

    const notifications = JSON.parse(raw || '[]');
    res.json({ success: true, notifications, count: notifications.length });
  } catch (e) { res.status(500).json({ success: false, error: String(e) }); }
});

// ─── Tweet Engagement ───────────────────────────────────────
app.post('/api/twitter/tweet/like', async (req: Request, res: Response) => {
  try {
    const { tweetUrl } = req.body;
    if (!validateRequired(res, [{ name: 'tweetUrl', value: tweetUrl }])) return;

    const result = await getDriver().likeTweet(tweetUrl);
    res.json({ ...result, tweetUrl });
  } catch (e) { res.status(500).json({ success: false, error: String(e) }); }
});

app.post('/api/twitter/tweet/retweet', async (req: Request, res: Response) => {
  try {
    const { tweetUrl } = req.body;
    if (!validateRequired(res, [{ name: 'tweetUrl', value: tweetUrl }])) return;

    const result = await getDriver().retweetTweet(tweetUrl);
    res.json({ ...result, tweetUrl });
  } catch (e) { res.status(500).json({ success: false, error: String(e) }); }
});

app.post('/api/twitter/tweet/bookmark', async (req: Request, res: Response) => {
  try {
    const { tweetUrl } = req.body;
    if (!validateRequired(res, [{ name: 'tweetUrl', value: tweetUrl }])) return;

    const result = await getDriver().bookmarkTweet(tweetUrl);
    res.json({ ...result, tweetUrl });
  } catch (e) { res.status(500).json({ success: false, error: String(e) }); }
});

app.get('/api/twitter/tweet/metrics', async (req: Request, res: Response) => {
  try {
    const { tweetUrl } = req.query;
    if (!validateRequired(res, [{ name: 'tweetUrl', value: tweetUrl }])) return;

    const result = await getDriver().getTweetMetrics(tweetUrl as string);
    res.json({ ...result, tweetUrl });
  } catch (e) { res.status(500).json({ success: false, error: String(e) }); }
});

app.get('/api/twitter/config', (req: Request, res: Response) => res.json({ config: getDriver().getConfig() }));
app.put('/api/twitter/config', (req: Request, res: Response) => { getDriver().setConfig(req.body); res.json({ config: getDriver().getConfig() }); });

// ─── Tab Coordination Endpoints ──────────────────────────────────────

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

// ─── Error Handler (must be last) ──────────────────────────
app.use(errorHandler);

export function startServer(port = PORT) { app.listen(port, () => console.log(`🐦 Twitter Comments API running on http://localhost:${port}`)); }
if (process.argv[1]?.includes('server')) startServer();
export { app };
