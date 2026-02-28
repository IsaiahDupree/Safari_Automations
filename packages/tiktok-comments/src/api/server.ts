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
          var vwEl = card.querySelector('[data-e2e=\\'video-views\\']');
          var viewsRaw = vwEl ? vwEl.textContent.trim() : '0';
          results.push({ id: id, url: url, author: author, description: desc, viewsRaw: viewsRaw });
        }
        return JSON.stringify(results);
      })()
    `);
    const videos = JSON.parse(raw || '[]');
    res.json({ success: true, query, videos, count: videos.length });
  } catch (e) { res.status(500).json({ success: false, error: String(e) }); }
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
    const { text, postUrl, useAI, postContent, username } = req.body;
    const d = getDriver();
    if (postUrl) { await d.navigateToPost(postUrl); await new Promise(r => setTimeout(r, 3000)); }
    
    // Use AI to generate comment if requested or if no text provided
    let commentText = text;
    if (useAI || !text) {
      commentText = await generateAIComment(postContent || 'TikTok video', username || 'creator');
      console.log(`[AI] Generated: "${commentText}"`);
    }
    
    if (!commentText) { res.status(400).json({ error: 'text required or useAI must be true' }); return; }
    const result = await d.postComment(commentText);
    res.json({ ...result, generatedComment: commentText, usedAI: useAI || !text });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// AI-only comment generation endpoint
app.post('/api/tiktok/comments/generate', async (req: Request, res: Response) => {
  try {
    const { postContent, username } = req.body;
    const comment = await generateAIComment(postContent || 'TikTok video', username || 'creator');
    res.json({ success: true, comment, usedAI: !!OPENAI_API_KEY });
  } catch (e) { res.status(500).json({ error: String(e) }); }
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

app.get('/api/tiktok/config', (req: Request, res: Response) => res.json({ config: getDriver().getConfig() }));
app.put('/api/tiktok/config', (req: Request, res: Response) => { getDriver().setConfig(req.body); res.json({ config: getDriver().getConfig() }); });

export function startServer(port = PORT) { app.listen(port, () => console.log(`🎵 TikTok Comments API running on http://localhost:${port}`)); }
if (process.argv[1]?.includes('server')) startServer();
export { app };
