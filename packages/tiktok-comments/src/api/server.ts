/**
 * TikTok Comment API Server - Port 3006
 * Now with AI-powered comment generation!
 */
import { config as _dotenv } from 'dotenv'; _dotenv({ override: true });
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { TikTokDriver, type TikTokConfig } from '../automation/tiktok-driver.js';
import { TabCoordinator } from '../automation/tab-coordinator.js';
import { CommentLogger } from '../db/comment-logger.js';

const commentLogger = new CommentLogger();

const app = express();
app.use(cors());
app.use(express.json());
const PORT = parseInt(process.env.TIKTOK_COMMENTS_PORT || '3006');
const SERVICE_NAME = 'tiktok-comments';
const SERVICE_PORT = PORT;
const SESSION_URL_PATTERN = 'tiktok.com';
const activeCoordinators = new Map<string, InstanceType<typeof TabCoordinator>>();

// Rate limit headers middleware
app.use((req, res, next) => {
  res.setHeader('X-RateLimit-Limit', '100');
  res.setHeader('X-RateLimit-Remaining', '95');
  res.setHeader('X-RateLimit-Reset', String(Math.floor(Date.now() / 1000) + 3600));
  next();
});

// ═══ Authentication Middleware ═══
const AUTH_TOKEN = process.env.TIKTOK_AUTH_TOKEN || '';
const AUTH_ENABLED = AUTH_TOKEN.length > 0;

function authMiddleware(req: Request, res: Response, next: any) {
  // Skip auth for health endpoint and OPTIONS requests
  if (req.path === '/health' || req.method === 'OPTIONS') {
    return next();
  }

  if (!AUTH_ENABLED) {
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'Authorization header required', message: 'Missing authentication token' });
  }

  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token || token.trim().length === 0) {
    return res.status(400).json({ error: 'Invalid authorization format', message: 'Bearer token must not be empty' });
  }

  if (token !== AUTH_TOKEN) {
    return res.status(401).json({ error: 'Invalid token', message: 'Authentication failed' });
  }

  next();
}

app.use(authMiddleware);

// ── Tab claim enforcement ─────────────────────────────────────────────────────
// Every automation route MUST have an active tab claim before it runs.
// On first request: auto-claims an existing tab OR opens a new one.
// Subsequent requests: validates the claim is still alive.
// Routes exempt: /health, /api/tabs/*, /api/*/status, /api/*/rate-limits
const OPEN_URL = 'https://www.tiktok.com';
const CLAIM_EXEMPT = /^\/health$|^\/api\/tabs|^\/api\/[^\/]+\/status$|^\/api\/[^\/]+\/rate-limits/;

async function requireTabClaim(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (CLAIM_EXEMPT.test(req.path)) { next(); return; }

  const claims = await TabCoordinator.listClaims();
  const myClaim = claims.find(c => c.service === SERVICE_NAME);

  if (myClaim) {
    // Claim exists — pin driver to the claimed tab and proceed
    getDriver().setTrackedTab(myClaim.windowIndex, myClaim.tabIndex, SESSION_URL_PATTERN);
    next();
    return;
  }

  // No claim — auto-discover an existing tiktok.com tab only (never opens a new window)
  const autoId = `tiktok-comments-auto-${Date.now()}`;
  try {
    const coord = new TabCoordinator(autoId, SERVICE_NAME, SERVICE_PORT, SESSION_URL_PATTERN);
    activeCoordinators.set(autoId, coord);
    const claim = await coord.claim();
    getDriver().setTrackedTab(claim.windowIndex, claim.tabIndex, SESSION_URL_PATTERN);
    console.log(`[requireTabClaim] Auto-claimed w=${claim.windowIndex} t=${claim.tabIndex} (${claim.tabUrl})`);
    next();
  } catch (err) {
    res.status(503).json({
      error: 'No Safari tab available for tiktok-comments',
      detail: String(err),
      fix: 'Run: node harness/safari-tab-coordinator.js --open',
    });
  }
}

app.use(requireTabClaim);
// ─────────────────────────────────────────────────────────────────────────────


// AI Client for comment generation
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (OPENAI_API_KEY) {
  console.log('[AI] ✅ OpenAI API key loaded - AI comments enabled');
} else {
  console.log('[AI] ⚠️ No API key - using local templates');
}

async function generateAIComment(postContent: string, username: string): Promise<string> {
  if (!OPENAI_API_KEY) {
    const templates = ["This is fire! 🔥", "Obsessed with this! 💯", "No way! 😂", "This is everything! ✨"];
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
          { role: 'system', content: 'You are a TikTok user. Generate SHORT, trendy comments (max 80 chars) with 1-2 emojis. Be casual and fun.' },
          { role: 'user', content: `Comment on this TikTok by @${username}: "${postContent.substring(0, 200)}"` }
        ],
        max_tokens: 50,
        temperature: 0.9,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const data = await response.json() as { choices?: { message?: { content?: string } }[] };
    return data.choices?.[0]?.message?.content?.trim() || "This is fire! 🔥";
  } catch {
    clearTimeout(timeout);
    return "This is fire! 🔥";
  }
}

let driver: TikTokDriver | null = null;
function getDriver(): TikTokDriver { if (!driver) driver = new TikTokDriver(); return driver; }

app.get('/health', (req: Request, res: Response) => res.json({ status: 'ok', service: 'tiktok-comments', port: PORT, timestamp: new Date().toISOString() }));

// ── Cross-agent tab claim registry ──────────────────────────────────────────
// All Safari services share /tmp/safari-tab-claims.json.
// These endpoints let any agent register/release its tab claim.

// GET /api/tabs/claims — list all live tab claims across all services
app.get('/api/tabs/claims', async (_req: Request, res: Response) => {
  try {
    const claims = await TabCoordinator.listClaims();
    res.json({ claims, count: claims.length });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// POST /api/tabs/claim — claim a Safari tab for this service
// Body: { agentId: string, windowIndex?: number, tabIndex?: number }
// Note: openUrl is intentionally ignored — tab layout is managed by safari-tab-coordinator
app.post('/api/tabs/claim', async (req: Request, res: Response) => {
  const { agentId, windowIndex, tabIndex } = req.body as {
    agentId: string;
    windowIndex?: number;
    tabIndex?: number;
  };
  if (!agentId) { res.status(400).json({ error: 'agentId required' }); return; }
  try {
    let coord = activeCoordinators.get(agentId);
    if (!coord) {
      coord = new TabCoordinator(agentId, SERVICE_NAME, SERVICE_PORT, SESSION_URL_PATTERN);
      activeCoordinators.set(agentId, coord);
    }
    const claim = await coord.claim(windowIndex, tabIndex);
    getDriver().setTrackedTab(claim.windowIndex, claim.tabIndex, SESSION_URL_PATTERN);
    res.json({ ok: true, claim, message: `Tab ${claim.windowIndex}:${claim.tabIndex} claimed by '${agentId}'` });
  } catch (error) {
    res.status(409).json({ ok: false, error: String(error) });
  }
});

// POST /api/tabs/release — release tab claim
app.post('/api/tabs/release', async (req: Request, res: Response) => {
  const { agentId } = req.body as { agentId: string };
  if (!agentId) { res.status(400).json({ error: 'agentId required' }); return; }
  try {
    const coord = activeCoordinators.get(agentId);
    if (coord) { await coord.release(); activeCoordinators.delete(agentId); }
    res.json({ ok: true, message: `Claim released for '${agentId}'` });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// POST /api/tabs/heartbeat — keep claim alive
app.post('/api/tabs/heartbeat', async (req: Request, res: Response) => {
  const { agentId } = req.body as { agentId: string };
  if (!agentId) { res.status(400).json({ error: 'agentId required' }); return; }
  try {
    const coord = activeCoordinators.get(agentId);
    if (!coord?.activeClaim) { res.status(404).json({ error: `No active claim for '${agentId}'` }); return; }
    await coord.heartbeat();
    res.json({ ok: true, heartbeat: Date.now() });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});
// ────────────────────────────────────────────────────────────────────────────

// POST /api/session/ensure — find + activate the tiktok.com tab (used by browser-session-daemon)
app.post('/api/session/ensure', async (_req: Request, res: Response) => {
  try {
    const d = getDriver();
    const info = await (d as any).ensureActiveSession ? (d as any).ensureActiveSession(SESSION_URL_PATTERN) : null;
    if (info) {
      res.json({ ok: info.found ?? true, windowIndex: info.windowIndex, tabIndex: info.tabIndex, url: info.url });
    } else {
      // Fallback: check if current page is tiktok.com
      const claims = await TabCoordinator.listClaims();
      const myClaim = claims.find(c => c.service === SERVICE_NAME);
      res.json({ ok: !!myClaim, windowIndex: myClaim?.windowIndex ?? null, tabIndex: myClaim?.tabIndex ?? null });
    }
  } catch (error) {
    const msg = String(error);
    if (msg.includes('No') && msg.includes('tab found')) {
      res.json({ ok: false, message: 'TikTok tab not found — open Safari and navigate to tiktok.com' });
    } else {
      res.status(500).json({ ok: false, error: msg });
    }
  }
});

// GET /api/session/status — current tracked tab info
app.get('/api/session/status', async (_req: Request, res: Response) => {
  const claims = await TabCoordinator.listClaims();
  const myClaim = claims.find(c => c.service === SERVICE_NAME);
  res.json({ tracked: !!myClaim, windowIndex: myClaim?.windowIndex ?? null, tabIndex: myClaim?.tabIndex ?? null, sessionUrlPattern: SESSION_URL_PATTERN });
});


app.get('/api/tiktok/status', async (req: Request, res: Response) => {
  try { const d = getDriver(); const s = await d.getStatus(); const r = d.getRateLimits(); res.json({ ...s, ...r }); }
  catch (e) { res.status(500).json({ error: String(e) }); }
});

app.get('/api/tiktok/rate-limits', (req: Request, res: Response) => res.json(getDriver().getRateLimits()));
app.put('/api/tiktok/rate-limits', (req: Request, res: Response) => { getDriver().setConfig(req.body); res.json({ rateLimits: getDriver().getConfig() }); });

app.post('/api/tiktok/navigate', async (req: Request, res: Response) => {
  try {
    const { url, handle } = req.body;
    // Accept either url or handle
    let targetUrl = url;
    if (!targetUrl && handle) {
      // Construct URL from handle
      const cleanHandle = handle.replace('@', '');
      targetUrl = `https://www.tiktok.com/@${cleanHandle}`;
    }
    if (!targetUrl) {
      res.status(400).json({ error: 'url or handle required' });
      return;
    }
    res.json({ success: await getDriver().navigateToPost(targetUrl), url: targetUrl });
  }
  catch (e) { res.status(500).json({ error: String(e) }); }
});

function parseCount(s: string): number {
  if (!s) return 0;
  const m = s.replace(/,/g, '').trim().match(/^([\d.]+)\s*([KkMmBb]?)$/);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  const suffix = m[2].toUpperCase();
  if (suffix === 'K') return Math.round(n * 1_000);
  if (suffix === 'M') return Math.round(n * 1_000_000);
  if (suffix === 'B') return Math.round(n * 1_000_000_000);
  return Math.round(n);
}

app.post('/api/tiktok/search-cards', async (req: Request, res: Response) => {
  try {
    const { query, maxCards = 20, waitMs = 4000 } = req.body;
    if (!query) { res.status(400).json({ error: 'query required' }); return; }
    const d = getDriver();
    const searchUrl = `https://www.tiktok.com/search/video?q=${encodeURIComponent(query)}`;
    await d.navigateToPost(searchUrl);
    await new Promise(r => setTimeout(r, waitMs));
    const raw = await (d as any).executeJS(`
      (function() {
        var cards = document.querySelectorAll('[data-e2e=\\'search_video-item\\']');
        var results = []; var seen = {};
        for (var i = 0; i < Math.min(cards.length, ${maxCards}); i++) {
          var card = cards[i];
          var link = card.querySelector('a[href*=\\'/video/\\']');
          if (!link) continue;
          var href = link.getAttribute('href') || '';
          var idMatch = href.match(/\\/video\\/(\\d+)/);
          if (!idMatch) continue;
          var id = idMatch[1];
          if (seen[id]) continue; seen[id] = true;
          var url = href.startsWith('http') ? href : 'https://www.tiktok.com' + href;
          var userMatch = href.match(/@([^\\/]+)\\/video/);
          var author = userMatch ? userMatch[1] : '';
          var descEl = card.querySelector('[data-e2e=\\'search-card-video-caption\\']') || card.querySelector('[data-e2e=\\'search-card-desc\\']');
          var desc = descEl ? descEl.textContent.trim().substring(0, 200) : '';
          var likesEl = card.querySelector('[data-e2e=\\'search-card-like-container\\']');
          var likesRaw = likesEl ? likesEl.textContent.trim() : '0';
          var viewsEl = card.querySelector('[data-e2e=\\'video-views\\']') || card.querySelector('[data-e2e=\\'search-card-view-count\\']') || card.querySelector('[class*=\\'VideoCount\\']');
          var viewsRaw = viewsEl ? viewsEl.textContent.trim() : '0';
          results.push({ id: id, url: url, author: author, description: desc, viewsRaw: viewsRaw, likesRaw: likesRaw });
        }
        return JSON.stringify(results);
      })()
    `);
    const videos = (JSON.parse(raw || '[]') as { id: string; url: string; author: string; description: string; viewsRaw: string; likesRaw: string }[])
      .map(v => ({ ...v, likesCount: parseCount(v.likesRaw), viewsCount: parseCount(v.viewsRaw) }));
    res.json({ success: true, query, videos, count: videos.length });
  } catch (e) { res.status(500).json({ success: false, error: String(e) }); }
});

// Get trending videos from For You page
app.get('/api/tiktok/trending', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    const d = getDriver();

    // Navigate to For You or Explore page
    await d.navigateToPost('https://www.tiktok.com/foryou');
    await new Promise(r => setTimeout(r, 4000)); // Wait for videos to load

    const raw = await (d as any).executeJS(`
      (function() {
        var videos = [];
        var seen = {};
        // Prefer stable data-e2e selectors; fall back to structural ones
        var cards = document.querySelectorAll(
          '[data-e2e="recommend-list-item-container"], ' +
          '[data-e2e="video-feed-item"], ' +
          '[data-e2e="browse-video-item"], ' +
          'article[data-scroll-index]'
        );
        var maxVideos = ${limit};

        for (var i = 0; i < Math.min(cards.length, maxVideos); i++) {
          var card = cards[i];
          var link = card.querySelector('a[href*="/video/"]');
          if (!link) continue;
          var href = link.getAttribute('href') || '';
          var idMatch = href.match(/\\/video\\/(\\d+)/);
          if (!idMatch) continue;
          var id = idMatch[1];
          if (seen[id]) continue;
          seen[id] = true;

          var url = href.startsWith('http') ? href : 'https://www.tiktok.com' + href;
          var userMatch = href.match(/@([^\\/]+)\\/video/);
          var author = userMatch ? userMatch[1] : '';

          var descEl = card.querySelector('[data-e2e="video-desc"], [data-e2e="browse-video-desc"]');
          var description = descEl ? descEl.textContent.trim().substring(0, 200) : '';

          var likeEl = card.querySelector('[data-e2e="like-count"], [data-e2e="video-like-count"], [data-e2e="browse-like-count"]');
          var likes = likeEl ? likeEl.textContent.trim() : '0';

          var commentEl = card.querySelector('[data-e2e="comment-count"], [data-e2e="video-comment-count"], [data-e2e="browse-comment-count"]');
          var comments = commentEl ? commentEl.textContent.trim() : '0';

          var shareEl = card.querySelector('[data-e2e="share-count"], [data-e2e="video-share-count"], [data-e2e="browse-share-count"]');
          var shares = shareEl ? shareEl.textContent.trim() : '0';

          var viewEl = card.querySelector('[data-e2e="video-views"], [data-e2e="browse-video-views"]');
          var views = viewEl ? viewEl.textContent.trim() : '0';

          videos.push({ id: id, author: author, description: description,
                        likes: likes, comments: comments, shares: shares, views: views, videoUrl: url });
        }

        return JSON.stringify(videos);
      })()
    `);

    const videos = JSON.parse(raw || '[]');
    res.json({ videos, count: videos.length });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.get('/api/tiktok/video-metrics', async (req: Request, res: Response) => {
  try {
    const d = getDriver();
    const metrics = await d.getVideoMetrics();
    res.json({ success: true, ...metrics });
  } catch (e) { res.status(500).json({ success: false, error: String(e) }); }
});

app.get('/api/tiktok/comments', async (req: Request, res: Response) => {
  try { const comments = await getDriver().getComments(parseInt(req.query.limit as string) || 50); res.json({ comments, count: comments.length }); }
  catch (e) { res.status(500).json({ error: String(e) }); }
});

app.post('/api/tiktok/comments/post', async (req: Request, res: Response) => {
  try {
    const { text, postUrl, videoUrl, useAI, postContent, username, dry_run } = req.body;
    const d = getDriver();

    // Get the URL from either postUrl or videoUrl
    const targetUrl = postUrl || videoUrl;

    // Validate that text is provided (unless useAI is true) and not empty/null
    if (!useAI && !text) {
      res.status(400).json({ error: 'text is required' });
      return;
    }

    if (text !== undefined && text !== null) {
      if (typeof text !== 'string') {
        res.status(400).json({ error: 'text must be a string' });
        return;
      }
      if (text.trim().length === 0) {
        res.status(400).json({ error: 'text cannot be empty' });
        return;
      }
      if (text.length > 10000) {
        res.status(400).json({ error: 'text is too long (max 10000 characters)' });
        return;
      }
    }

    // Validate URL is a TikTok video URL
    if (targetUrl) {
      // Reject short-link URLs (vt.tiktok.com, vm.tiktok.com) - require direct /video/ format
      if (targetUrl.includes('vt.tiktok.com') || targetUrl.includes('vm.tiktok.com')) {
        res.status(400).json({
          success: false,
          error: 'Short-link URLs not supported. Please use the direct /video/ URL format (e.g., https://www.tiktok.com/@user/video/1234567890)'
        });
        return;
      }

      const isTikTokVideo = targetUrl.includes('tiktok.com') && (targetUrl.includes('/video/') || targetUrl.includes('/@'));
      if (!isTikTokVideo) {
        res.status(400).json({ error: 'Invalid URL: must be a TikTok video URL' });
        return;
      }
    }

    // Use AI to generate comment if requested or if no text provided
    let commentText = text;
    if (useAI || !text) {
      commentText = await generateAIComment(postContent || 'TikTok video', username || 'creator');
      console.log(`[AI] Generated: "${commentText}"`);
    }

    // Dry-run mode: simulate success without actually posting
    if (dry_run) {
      res.json({
        success: true,
        dry_run: true,
        generatedComment: commentText,
        usedAI: useAI || !text,
        message: 'Dry-run mode: comment not actually posted'
      });
      return;
    }

    if (targetUrl) {
      await d.navigateToPost(targetUrl);
      await new Promise(r => setTimeout(r, 3000));
    }

    const result = await d.postComment(commentText);
    // Fire-and-forget Supabase log — never block the response
    commentLogger.logComment({
      platform: 'tiktok',
      username: username || (targetUrl ? new URL(targetUrl).pathname.split('/')[1]?.replace('@','') || 'unknown' : 'unknown'),
      postUrl: targetUrl,
      postContent: postContent,
      commentText,
      success: result.success,
      error: result.error,
    }).catch(() => {});
    res.json({ ...result, generatedComment: commentText, usedAI: useAI || !text });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// AI-only comment generation endpoint
app.post('/api/tiktok/comments/generate', async (req: Request, res: Response) => {
  try {
    const { postContent, username } = req.body;
    const comment = await generateAIComment(postContent || 'TikTok video', username || 'creator');
    res.json({
      success: true,
      comment,
      usedAI: !!OPENAI_API_KEY,
      model_used: OPENAI_API_KEY ? 'gpt-4o' : 'local-template'
    });
  } catch (e) {
    // Graceful fallback on AI error
    const fallbackComment = "This is fire! 🔥";
    res.json({
      success: true,
      comment: fallbackComment,
      usedAI: false,
      model_used: 'fallback',
      error: 'AI generation failed, using fallback'
    });
  }
});

// DOM selector health check + raw data extraction from current Safari TikTok tab.
// Uses executeJS directly — the same temp-file osascript mechanism used by search-cards.
// Escaping rules: JS string delimiters use plain ' (fine in template literals),
//   CSS attribute values use " which executeJS escapes to \" for AppleScript
//   (AppleScript unescapes back to " before handing the code to Safari's JS engine).
// Returns: selectorHealth (which data-e2e selectors hit), cards[] (search page),
//          videoMetrics (video page), profileData (profile page).
app.post('/api/tiktok/verify', async (req: Request, res: Response) => {
  try {
    const d = getDriver();
    // Single-line JS — avoids relying on AppleScript \n→newline behaviour.
    const js = `(function(){` +
      `function cnt(s){return document.querySelectorAll(s).length;}` +
      `function txt(s){var e=document.querySelector(s);return e?e.textContent.trim():'';}` +
      `var u=window.location.href;` +
      `var isSch=u.indexOf('tiktok.com/search')>=0;` +
      `var isVid=u.indexOf('/video/')>=0;` +
      `var isInb=u.indexOf('tiktok.com/messages')>=0||u.indexOf('tiktok.com/inbox')>=0;` +
      `var isPro=!isSch&&!isVid&&!isInb&&u.indexOf('tiktok.com/@')>=0;` +
      `var h={` +
        `search_video_item:cnt('[data-e2e="search_video-item"]'),` +
        `search_card_caption:cnt('[data-e2e="search-card-video-caption"]'),` +
        `video_views:cnt('[data-e2e="video-views"]'),` +
        `like_count:cnt('[data-e2e="like-count"]'),` +
        `comment_count:cnt('[data-e2e="comment-count"]'),` +
        `share_count:cnt('[data-e2e="share-count"]'),` +
        `comment_input:cnt('[data-e2e="comment-input"]'),` +
        `user_title:cnt('[data-e2e="user-title"]'),` +
        `followers_count:cnt('[data-e2e="followers-count"]'),` +
        `following_count:cnt('[data-e2e="following-count"]'),` +
        `likes_count:cnt('[data-e2e="likes-count"]')` +
      `};` +
      `var cards=[];` +
      `if(isSch){` +
        `var els=document.querySelectorAll('[data-e2e="search_video-item"]');` +
        `for(var i=0;i<Math.min(els.length,5);i++){` +
          `var card=els[i];` +
          `var lnk=card.querySelector('a[href*="/video/"]');` +
          `var href=lnk?(lnk.getAttribute('href')||''):'';` +
          `var idM=href.match(/\\/video\\/(\\d+)/);` +
          `var usM=href.match(/@([^\\/]+)\\/video/);` +
          `var dEl=card.querySelector('[data-e2e="search-card-video-caption"]')||card.querySelector('[data-e2e="search-card-desc"]');` +
          `var vEl=card.querySelector('[data-e2e="video-views"]');` +
          `cards.push({videoId:idM?idM[1]:'',author:usM?usM[1]:'',` +
            `url:href.indexOf('http')===0?href:('https://www.tiktok.com'+href),` +
            `desc:dEl?dEl.textContent.trim().substring(0,120):'',` +
            `viewsRaw:vEl?vEl.textContent.trim():''});` +
        `}` +
      `}` +
      `var vm=null;` +
      `if(isVid){vm={likes:txt('[data-e2e="like-count"]'),comments:txt('[data-e2e="comment-count"]'),shares:txt('[data-e2e="share-count"]'),views:txt('[data-e2e="video-views"]')||txt('[data-e2e="play-count"]')};}` +
      `var pd=null;` +
      `if(isPro){pd={name:txt('[data-e2e="user-title"]'),followers:txt('[data-e2e="followers-count"]'),following:txt('[data-e2e="following-count"]'),likes:txt('[data-e2e="likes-count"]')};}` +
      `return JSON.stringify({url:u.substring(0,120),pageType:isSch?'search':isVid?'video':isPro?'profile':isInb?'inbox':'other',selectorHealth:h,cards:cards,videoMetrics:vm,profileData:pd});` +
    `})()`;
    const raw = await (d as any).executeJS(js);
    const data = JSON.parse(raw || '{}');
    res.json({ success: true, ...data });
  } catch (e) { res.status(500).json({ success: false, error: String(e) }); }
});

// Simple analytics endpoint — returns basic video performance data
app.get('/api/tiktok/analytics', async (req: Request, res: Response) => {
  try {
    const maxVideos = parseInt(req.query.max as string) || 10;
    const data = await getDriver().getAnalyticsContent(maxVideos);
    res.json(data);
  } catch (e) { res.status(500).json({ success: false, error: String(e) }); }
});

// Creator analytics — watch time, completion rate, reach per video
app.get('/api/tiktok/analytics/content', async (req: Request, res: Response) => {
  try {
    const maxVideos = parseInt(req.query.max as string) || 10;
    const data = await getDriver().getAnalyticsContent(maxVideos);
    res.json(data);
  } catch (e) { res.status(500).json({ success: false, error: String(e) }); }
});

// Activity feed — follower events from notifications page
app.get('/api/tiktok/activity/followers', async (req: Request, res: Response) => {
  try {
    const d = getDriver();
    // Navigate to TikTok notifications page
    await (d as any).executeJS(`window.location.href='https://www.tiktok.com/notifications'`);
    await new Promise(r => setTimeout(r, 4000));

    // Extract "followed you" events — strict text matching, no bare "follow"
    const raw = await (d as any).executeJS(`(function(){` +
      `var seen={};var events=[];` +
      `var blocked=['notifications','foryou','following','explore','live','upload','inbox','profile'];` +
      `var items=document.querySelectorAll('[class*="NotificationItem"],div[data-e2e="notification-item"],div[role="listitem"]');` +
      `for(var i=0;i<Math.min(items.length,60);i++){` +
        `var el=items[i];` +
        `var text=(el.textContent||'').trim();` +
        `if(text.indexOf('started following')<0&&text.indexOf('followed you')<0)continue;` +
        `var link=el.querySelector('a[href*="/@"]');` +
        `var username='';` +
        `if(link){` +
          `var href=link.getAttribute('href')||'';` +
          `var m=href.match(/@([a-zA-Z0-9_.]+)/);` +
          `if(m&&m[1].length>=2&&m[1].length<=30&&blocked.indexOf(m[1].toLowerCase())<0)username=m[1];` +
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
  } catch (e) { res.status(500).json({ success: false, error: String(e) }); }
});

app.get('/api/tiktok/config', (req: Request, res: Response) => res.json({ config: getDriver().getConfig() }));
app.put('/api/tiktok/config', (req: Request, res: Response) => { getDriver().setConfig(req.body); res.json({ config: getDriver().getConfig() }); });

// ═══ DM Operations ═══
app.post('/api/tiktok/dm/send', async (req: Request, res: Response) => {
  try {
    const { username, message } = req.body;
    if (!username || !message) {
      res.status(400).json({ error: 'username and message required' });
      return;
    }
    const result = await getDriver().sendDM(username, message);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.get('/api/tiktok/dm/conversations', async (req: Request, res: Response) => {
  try {
    const conversations = await getDriver().getDMConversations();
    res.json(conversations);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.get('/api/tiktok/dm/messages/:id', async (req: Request, res: Response) => {
  try {
    const messages = await getDriver().getDMMessages(req.params.id);
    res.json(messages);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.post('/api/tiktok/dm/search', async (req: Request, res: Response) => {
  try {
    const { username } = req.body;
    if (!username) {
      res.status(400).json({ error: 'username required' });
      return;
    }
    const result = await getDriver().searchDMConversation(username);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ═══ Profile Operations ═══
app.get('/api/tiktok/profile', async (req: Request, res: Response) => {
  try {
    const profile = await getDriver().getOwnProfile();
    res.json(profile);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ═══ Search Operations ═══
app.post('/api/tiktok/search', async (req: Request, res: Response) => {
  try {
    const { query, limit = 20 } = req.body;
    if (!query) {
      res.status(400).json({ error: 'query required' });
      return;
    }
    const videos = await getDriver().searchVideos(query, limit);
    res.json({ success: true, query, videos, count: videos.length });
  } catch (e) {
    res.status(500).json({ success: false, error: String(e) });
  }
});

// ═══ Trending Operations ═══
app.get('/api/tiktok/trending/sounds', async (req: Request, res: Response) => {
  try {
    const sounds = await getDriver().getTrendingSounds();
    res.json(sounds);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ═══ Comment Operations ═══
app.post('/api/tiktok/comments/reply', async (req: Request, res: Response) => {
  try {
    const { commentId, text } = req.body;
    if (!commentId || !text) {
      res.status(400).json({ error: 'commentId and text required' });
      return;
    }
    const result = await getDriver().replyToComment(commentId, text);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.post('/api/tiktok/comments/:id/like', async (req: Request, res: Response) => {
  try {
    const result = await getDriver().likeComment(req.params.id);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ── Comment Sweep — niche + feed batch (called by tiktok-comment-sweep.js daemon) ──

interface TkSweepNicheConfig {
  name: string;
  keywords: string[];
  maxComments?: number;
}

app.post('/api/tiktok/comment-sweep', async (req: Request, res: Response) => {
  try {
    const {
      niches = [] as TkSweepNicheConfig[],
      feedSources = ['foryou'] as string[],
      maxPerNiche = 2,
      maxPerFeed = 2,
      maxTotal = 8,
      style = 'insightful, practitioner-level, concise — adds genuine value to the conversation',
      dryRun = false,
      seenUrls = [] as string[],
    } = req.body;

    if (!Array.isArray(niches) || niches.length === 0) {
      res.status(400).json({ error: 'Bad Request', message: 'niches array is required' });
      return;
    }

    const d = getDriver();
    const seenSet = new Set<string>(seenUrls);
    const newlyCommentedUrls: string[] = [];
    let totalCommented = 0;

    const humanDelay = (minMs: number, maxMs: number) =>
      new Promise(r => setTimeout(r, minMs + Math.random() * (maxMs - minMs)));

    const generateComment = async (description: string, author: string): Promise<string | null> => {
      const prompt = description ? `${description}\n\n[Style: ${style}]` : `TikTok video by @${author}`;
      const text = await generateAIComment(prompt, author);
      if (!text || text.length < 5) return null;
      return text.length > 150 ? text.substring(0, 150) : text;
    };

    // ── For-You feed sweep ────────────────────────────────────────────────────
    const feedResults: Array<{ postUrl: string; author: string; reply: string; dryRun: boolean }> = [];

    for (const _feedSource of feedSources) {
      if (totalCommented >= maxTotal) break;
      const feedMax = Math.min(maxPerFeed, maxTotal - totalCommented);

      try {
        await d.navigateToPost('https://www.tiktok.com/foryou');
        await humanDelay(4000, 6000);

        const raw = await (d as any).executeJS(`
          (function() {
            var cards = document.querySelectorAll('[data-e2e="recommend-list-item-container"], div[class*="DivItemContainer"]');
            var results = []; var seen = {};
            for (var i = 0; i < Math.min(cards.length, ${feedMax * 4}); i++) {
              var card = cards[i];
              var link = card.querySelector('a[href*="/video/"]');
              if (!link) continue;
              var href = link.getAttribute('href') || '';
              var idMatch = href.match(/\\/video\\/(\\d+)/);
              if (!idMatch) continue;
              var id = idMatch[1];
              if (seen[id]) continue; seen[id] = true;
              var url = href.startsWith('http') ? href : 'https://www.tiktok.com' + href;
              var userMatch = href.match(/@([^\\/]+)\\/video/);
              var author = userMatch ? userMatch[1] : '';
              var descEl = card.querySelector('[data-e2e="video-desc"], [class*="DivVideoDescription"]');
              var description = descEl ? descEl.textContent.trim().substring(0, 200) : '';
              results.push({ id, url, author, description });
            }
            return JSON.stringify(results);
          })()`);

        const feedVideos: Array<{ id: string; url: string; author: string; description: string }> = JSON.parse(raw || '[]');
        let feedCount = 0;

        for (const video of feedVideos) {
          if (feedCount >= feedMax || totalCommented >= maxTotal) break;
          if (!video.url || seenSet.has(video.url)) continue;

          const reply = await generateComment(video.description, video.author);
          if (!reply) continue;

          if (!dryRun) {
            await d.navigateToPost(video.url);
            await humanDelay(3000, 5000);
            const result = await d.postComment(reply);
            if (!result.success) continue;
            await humanDelay(5000, 10000);
          }

          seenSet.add(video.url);
          newlyCommentedUrls.push(video.url);
          feedResults.push({ postUrl: video.url, author: video.author, reply, dryRun });
          feedCount++;
          totalCommented++;
        }
      } catch (err) {
        console.error(`[comment-sweep] Feed error:`, err);
      }
    }

    // ── Per-niche keyword sweep ───────────────────────────────────────────────
    interface TkNicheResult {
      niche: string;
      commented: Array<{ url: string; author: string; reply: string }>;
      skipped: string[];
      errors: string[];
    }
    const nicheResults: TkNicheResult[] = [];

    for (const niche of niches) {
      if (totalCommented >= maxTotal) break;
      const nicheMax = Math.min(niche.maxComments ?? maxPerNiche, maxTotal - totalCommented);
      const result: TkNicheResult = { niche: niche.name, commented: [], skipped: [], errors: [] };

      for (const keyword of niche.keywords) {
        if (result.commented.length >= nicheMax || totalCommented >= maxTotal) break;

        try {
          const videos = await d.searchVideos(keyword, nicheMax * 3);

          for (const video of videos) {
            if (result.commented.length >= nicheMax || totalCommented >= maxTotal) break;
            if (!video.url || video.description.length < 10) { result.skipped.push(video.url || 'no-url'); continue; }
            if (seenSet.has(video.url)) { result.skipped.push(video.url); continue; }

            const reply = await generateComment(video.description, video.author);
            if (!reply) { result.skipped.push(video.url); continue; }

            if (!dryRun) {
              await d.navigateToPost(video.url);
              await humanDelay(3000, 5000);
              const postResult = await d.postComment(reply);
              if (!postResult.success) { result.errors.push(`${video.url}: ${postResult.error}`); continue; }
              await humanDelay(12000, 25000); // conservative TikTok pace
            }

            seenSet.add(video.url);
            newlyCommentedUrls.push(video.url);
            result.commented.push({ url: video.url, author: video.author, reply });
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

    res.json({ success: true, dryRun, totalCommented, feedResults, nicheResults, newlyCommentedUrls, summary });
  } catch (e) {
    res.status(500).json({ success: false, error: String(e) });
  }
});

// ── Hashtag prospect scraper ──────────────────────────────────────────────────
// Scrapes /tag/:hashtag pages in the COMMENTS tab (never touches DM inbox).
// Returns scored creator candidates ready for DM queue.
const HASHTAG_ICP_KEYWORDS = ['founder', 'saas', 'build', 'software', 'ai', 'startup', 'indie', 'developer', 'automation', 'b2b'];

app.post('/api/tiktok/hashtag-prospects', async (req: Request, res: Response) => {
  try {
    const {
      hashtags = ['buildinpublic', 'saasfounder', 'aiautomation'] as string[],
      maxPerTag = 15,
      minScore = 1,
    } = req.body as { hashtags?: string[]; maxPerTag?: number; minScore?: number };

    const d = getDriver();
    const seen = new Set<string>();
    const candidates: { username: string; source: string; score: number; signals: string[]; videoDesc: string }[] = [];

    for (const hashtag of hashtags) {
      const tag = hashtag.replace(/^#/, '');
      await (d as any).navigateToPost(`https://www.tiktok.com/tag/${encodeURIComponent(tag)}`);
      await new Promise(r => setTimeout(r, 3500));

      // Scroll once to expose more cards
      try { await (d as any).executeJS('window.scrollTo(0, document.body.scrollHeight * 0.6)'); } catch {}
      await new Promise(r => setTimeout(r, 1200));

      const raw = await (d as any).executeJS(`
        (function() {
          var results = []; var seen = {};
          var cards = document.querySelectorAll('[data-e2e="challenge-item"], [data-e2e="video-item"], article[data-scroll-index]');
          if (cards.length === 0) {
            // Fallback: any video link on the page
            var links = document.querySelectorAll('a[href*="/@"][href*="/video/"]');
            for (var i = 0; i < links.length && results.length < ${maxPerTag * 2}; i++) {
              var href = links[i].getAttribute('href') || '';
              var m = href.match(/@([a-zA-Z0-9_.]+)\\/video/);
              if (!m || seen[m[1]]) continue;
              seen[m[1]] = 1;
              results.push({ username: m[1], description: '' });
            }
            return JSON.stringify(results);
          }
          for (var j = 0; j < Math.min(cards.length, ${maxPerTag * 2}); j++) {
            var card = cards[j];
            var link = card.querySelector('a[href*="/@"][href*="/video/"]') || card.querySelector('a[href*="/video/"]');
            if (!link) continue;
            var href2 = link.getAttribute('href') || '';
            var m2 = href2.match(/@([a-zA-Z0-9_.]+)\\/video/);
            if (!m2 || seen[m2[1]]) continue;
            seen[m2[1]] = 1;
            var descEl = card.querySelector('[data-e2e="video-desc"], [data-e2e="challenge-video-desc"]');
            var desc = descEl ? descEl.textContent.trim().substring(0, 150) : '';
            results.push({ username: m2[1], description: desc });
          }
          return JSON.stringify(results);
        })()`);

      const found: { username: string; description: string }[] = JSON.parse(raw || '[]');

      for (const { username, description } of found) {
        if (seen.has(username.toLowerCase())) continue;
        seen.add(username.toLowerCase());

        const text = (username + ' ' + description).toLowerCase();
        const matched = HASHTAG_ICP_KEYWORDS.filter(k => text.includes(k));
        const score = matched.length;
        if (score < minScore) continue;

        candidates.push({
          username,
          source: `#${tag}`,
          score,
          signals: matched.map(k => `keyword:${k}`),
          videoDesc: description,
        });

        if (candidates.length >= hashtags.length * maxPerTag) break;
      }
    }

    // Sort by score desc
    candidates.sort((a, b) => b.score - a.score);
    res.json({ success: true, hashtags, count: candidates.length, candidates });
  } catch (e) {
    res.status(500).json({ success: false, error: String(e) });
  }
});

// ── Profile lookup (uses comments tab, keeps DM inbox free) ──────────────────
app.get('/api/tiktok/profile/:username', async (req: Request, res: Response) => {
  try {
    const username = req.params.username.replace('@', '');
    if (!username) { res.status(400).json({ error: 'username required' }); return; }

    const d = getDriver();
    await (d as any).navigateToPost(`https://www.tiktok.com/@${username}`);
    await new Promise(r => setTimeout(r, 3000));

    const raw = await (d as any).executeJS(`
      (function() {
        var followers = '', following = '', likes = '', bio = '', fullName = '';

        // Display name
        var nameEl = document.querySelector('[data-e2e="user-title"], h1[data-e2e="user-subtitle"], h2');
        if (nameEl) fullName = nameEl.textContent.trim().substring(0, 80);

        // Bio
        var bioEl = document.querySelector('[data-e2e="user-bio"]');
        if (bioEl) bio = bioEl.textContent.trim().substring(0, 300);

        // Stats strip: Followers / Following / Likes
        var stats = document.querySelectorAll('[data-e2e="followers-count"], [data-e2e="following-count"], [data-e2e="likes-count"]');
        stats.forEach(function(el) {
          var e2e = el.getAttribute('data-e2e') || '';
          var val = el.textContent.trim();
          if (e2e === 'followers-count') followers = val;
          else if (e2e === 'following-count') following = val;
          else if (e2e === 'likes-count') likes = val;
        });

        // Fallback: parse stat strip by order if data-e2e not present
        if (!followers) {
          var nums = document.querySelectorAll('[class*="CountText"], [class*="count-text"], strong[class*="Number"]');
          var vals = [];
          nums.forEach(function(n) { vals.push(n.textContent.trim()); });
          if (vals.length >= 1) followers = vals[0];
          if (vals.length >= 2) following = vals[1];
          if (vals.length >= 3) likes = vals[2];
        }

        return JSON.stringify({ fullName: fullName, bio: bio, followers: followers, following: following, likes: likes });
      })()`);

    const profile: { fullName: string; bio: string; followers: string; following: string; likes: string } = JSON.parse(raw || '{}');

    // Parse numeric counts
    const followersCount = parseCount(profile.followers || '');
    const followingCount = parseCount(profile.following || '');
    const likesCount     = parseCount(profile.likes     || '');

    res.json({
      username,
      displayName: profile.fullName,
      bio: profile.bio,
      followers: profile.followers,
      following: profile.following,
      likes: profile.likes,
      followersCount,
      followingCount,
      likesCount,
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// Get video list from a user's profile page (avoids search navigation)
app.get('/api/tiktok/profile/:username/videos', async (req: Request, res: Response) => {
  try {
    const username = req.params.username.replace('@', '');
    if (!username) { res.status(400).json({ error: 'username required' }); return; }
    const maxVideos = Math.min(parseInt(req.query.max as string) || 10, 30);
    const d = getDriver();
    await (d as any).navigateToPost(`https://www.tiktok.com/@${username}`);
    await new Promise(r => setTimeout(r, 4000));
    const raw = await (d as any).executeJS(`
      (function() {
        // Collect all video links from profile page using multiple selector strategies
        var allLinks = Array.from(document.querySelectorAll('a[href*="/video/"]'));
        var results = []; var seen = {};
        for (var i = 0; i < allLinks.length && results.length < ${maxVideos}; i++) {
          var link = allLinks[i];
          var href = link.getAttribute('href') || '';
          var idMatch = href.match(/\\/video\\/(\\d+)/);
          if (!idMatch) continue;
          var id = idMatch[1];
          if (seen[id]) continue; seen[id] = true;
          var url = href.startsWith('http') ? href : 'https://www.tiktok.com' + href;
          var userMatch = href.match(/@([^\\/]+)\\/video/);
          var author = userMatch ? userMatch[1] : '${username}';
          // Look for view count in the card container (parent elements)
          var container = link.closest('[data-e2e="user-post-item"]') || link.closest('li') || link.closest('div[class*="Video"]') || link.parentElement;
          var viewsEl = container ? (container.querySelector('[data-e2e="video-views"]') || container.querySelector('strong') || container.querySelector('[class*="count"]')) : null;
          var viewsRaw = viewsEl ? viewsEl.textContent.trim() : '0';
          var descEl = container ? (container.querySelector('[data-e2e="video-desc"]') || container.querySelector('p')) : null;
          var desc = descEl ? descEl.textContent.trim().substring(0, 200) : '';
          results.push({ id: id, url: url, author: author, description: desc, viewsRaw: viewsRaw, likesRaw: '0' });
        }
        return JSON.stringify(results);
      })()
    `);
    const videos = (JSON.parse(raw || '[]') as { id: string; url: string; author: string; description: string; viewsRaw: string; likesRaw: string }[])
      .map(v => ({ ...v, likesCount: 0, viewsCount: parseCount(v.viewsRaw) }));
    res.json({ success: true, username, videos, count: videos.length });
  } catch (e) { res.status(500).json({ success: false, error: String(e) }); }
});

// ─── Self-Poll Endpoint (SDPA-010) ───────────────────────────────────────────
// POST /api/tiktok/self-poll
// Called by cron-manager during quiet hours. Fetches profile videos and comments,
// writes to safari_platform_cache for cloud-sync to consume.
app.post('/api/tiktok/self-poll', async (_req: Request, res: Response) => {
  // NO quiet hours — runs 24/7 per Phase B spec

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
  const result = { videos: 0, comments: 0 };

  const writeCache = async (dataType: string, payload: any[], ttlMs: number) => {
    if (!payload.length || !SUPABASE_URL || !SUPABASE_ANON_KEY) return;
    const headers: Record<string, string> = {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    };
    await fetch(`${SUPABASE_URL}/rest/v1/safari_platform_cache?platform=eq.tiktok&data_type=eq.${dataType}`, {
      method: 'DELETE', headers,
    }).catch(() => {});
    const expiresAt = new Date(Date.now() + ttlMs).toISOString();
    await fetch(`${SUPABASE_URL}/rest/v1/safari_platform_cache`, {
      method: 'POST', headers,
      body: JSON.stringify({ platform: 'tiktok', data_type: dataType, payload, expires_at: expiresAt, source_service_port: 3006 }),
    }).catch(() => {});
  };

  try {
    const d = getDriver();

    // 1. Fetch analytics/content (profile videos with stats)
    const analyticsResult = await d.getAnalyticsContent(10);
    const videos = analyticsResult.videos || [];
    result.videos = videos.length;

    // Convert to post_stats format
    const postStats: any[] = videos.map(v => ({
      platform: 'tiktok',
      post_id: v.videoId,
      post_type: 'video',
      caption: v.caption || '',
      views: v.views || 0,
      likes: 0,
      comments: 0,
      shares: 0,
      raw_data: v,
    }));

    // 2. Fetch comments from top 3 videos
    const allComments: any[] = [];
    for (const video of videos.slice(0, 3)) {
      try {
        const videoUrl = `https://www.tiktok.com/@isaiah_dupree/video/${video.videoId}`;
        await d.navigateToPost(videoUrl);
        await new Promise(r => setTimeout(r, 3000));
        const comments = await d.getComments(20);
        for (const c of comments) {
          if (!c.username || !c.text || c.text.length < 2) continue;
          allComments.push({
            platform: 'tiktok',
            post_id: video.videoId,
            post_url: videoUrl,
            username: c.username,
            comment_text: c.text.substring(0, 500),
          });
        }
        result.comments += comments.length;
      } catch { /* non-fatal per video */ }
    }

    await Promise.all([
      writeCache('post_stats', postStats, 21_600_000),
      writeCache('comments', allComments, 21_600_000),
    ]);

    res.json({ success: true, fetched: result });
  } catch (err) {
    const msg = (err as Error).message;
    console.error('[self-poll:tiktok] error:', msg);
    res.status(500).json({ success: false, error: msg });
  }
});

export function startServer(port = PORT) {
  TabCoordinator.listClaims().then(claims => {
    const stale = claims.filter(c => c.service === SERVICE_NAME);
    if (stale.length > 0) {
      console.log(`[startup] Clearing ${stale.length} stale ${SERVICE_NAME} claim(s) from previous process`);
      import('fs/promises').then(fsp => {
        fsp.writeFile('/tmp/safari-tab-claims.json', JSON.stringify(claims.filter(c => c.service !== SERVICE_NAME), null, 2)).catch(() => {});
      });
    }
  }).catch(() => {});
  app.listen(port, () => console.log(`🎵 TikTok Comments API running on http://localhost:${port}`));
}
if (process.argv[1]?.includes('server')) startServer();
export { app };
