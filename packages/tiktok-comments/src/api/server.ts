/**
 * TikTok Comment API Server - Port 3006
 * Now with AI-powered comment generation!
 */
import 'dotenv/config';
import express, { Request, Response } from 'express';
import cors from 'cors';
import { TikTokDriver, type TikTokConfig } from '../automation/tiktok-driver.js';

const app = express();
app.use(cors());
app.use(express.json());
const PORT = parseInt(process.env.TIKTOK_COMMENTS_PORT || '3006');

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

app.get('/api/tiktok/status', async (req: Request, res: Response) => {
  try { const d = getDriver(); const s = await d.getStatus(); const r = d.getRateLimits(); res.json({ ...s, ...r }); }
  catch (e) { res.status(500).json({ error: String(e) }); }
});

app.get('/api/tiktok/rate-limits', (req: Request, res: Response) => res.json(getDriver().getRateLimits()));
app.put('/api/tiktok/rate-limits', (req: Request, res: Response) => { getDriver().setConfig(req.body); res.json({ rateLimits: getDriver().getConfig() }); });

app.post('/api/tiktok/navigate', async (req: Request, res: Response) => {
  try { const { url } = req.body; if (!url) { res.status(400).json({ error: 'url required' }); return; } res.json({ success: await getDriver().navigateToPost(url), url }); }
  catch (e) { res.status(500).json({ error: String(e) }); }
});

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
          var vwEl = card.querySelector('[data-e2e=\\'search-card-like-container\\']');
          var likesRaw = vwEl ? vwEl.textContent.trim() : '0';
          var viewsEl = card.querySelector('[class*=\\'VideoCount\\']') || card.querySelector('[class*=\\'video-count\\']') || card.querySelector('strong[class*=\\'StrongVideoCount\\']');
          var viewsRaw = viewsEl ? viewsEl.textContent.trim() : '0';
          results.push({ id: id, url: url, author: author, description: desc, viewsRaw: viewsRaw, likesRaw: likesRaw });
        }
        return JSON.stringify(results);
      })()
    `);
    const videos = JSON.parse(raw || '[]');
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
        // TikTok For You page uses video cards or feed items
        var cards = document.querySelectorAll('[data-e2e="recommend-list-item-container"], div[class*="DivItemContainer"]');
        var maxVideos = ${limit};

        for (var i = 0; i < Math.min(cards.length, maxVideos); i++) {
          var card = cards[i];
          // Extract video link
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

          // Extract description/caption
          var descEl = card.querySelector('[data-e2e="video-desc"], [class*="DivVideoDescription"]');
          var description = descEl ? descEl.textContent.trim().substring(0, 200) : '';

          // Extract engagement metrics
          var likeEl = card.querySelector('[data-e2e="like-count"], [data-e2e="video-like-count"]');
          var likes = likeEl ? likeEl.textContent.trim() : '0';

          var commentEl = card.querySelector('[data-e2e="comment-count"], [data-e2e="video-comment-count"]');
          var comments = commentEl ? commentEl.textContent.trim() : '0';

          var shareEl = card.querySelector('[data-e2e="share-count"], [data-e2e="video-share-count"]');
          var shares = shareEl ? shareEl.textContent.trim() : '0';

          var viewEl = card.querySelector('[data-e2e="video-views"]');
          var views = viewEl ? viewEl.textContent.trim() : '0';

          videos.push({
            id: id,
            author: author,
            description: description,
            likes: likes,
            comments: comments,
            shares: shares,
            views: views,
            videoUrl: url
          });
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

export function startServer(port = PORT) { app.listen(port, () => console.log(`🎵 TikTok Comments API running on http://localhost:${port}`)); }
if (process.argv[1]?.includes('server')) startServer();
export { app };
