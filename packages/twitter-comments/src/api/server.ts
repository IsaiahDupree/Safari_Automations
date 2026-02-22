/**
 * Twitter Comment API Server - Port 3007
 * Now with AI-powered comment generation!
 */
import 'dotenv/config';
import express, { Request, Response } from 'express';
import cors from 'cors';
import { TwitterDriver, type TwitterConfig } from '../automation/twitter-driver.js';

const app = express();
app.use(cors());
app.use(express.json());
const PORT = parseInt(process.env.TWITTER_COMMENTS_PORT || '3007');

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

app.get('/health', (req: Request, res: Response) => res.json({ status: 'ok', service: 'twitter-comments', port: PORT, timestamp: new Date().toISOString() }));

app.get('/api/twitter/status', async (req: Request, res: Response) => {
  try { const d = getDriver(); const s = await d.getStatus(); const r = d.getRateLimits(); res.json({ ...s, ...r }); }
  catch (e) { res.status(500).json({ error: String(e) }); }
});

app.get('/api/twitter/rate-limits', (req: Request, res: Response) => res.json(getDriver().getRateLimits()));
app.put('/api/twitter/rate-limits', (req: Request, res: Response) => { getDriver().setConfig(req.body); res.json({ rateLimits: getDriver().getConfig() }); });

app.post('/api/twitter/navigate', async (req: Request, res: Response) => {
  try { const { url } = req.body; if (!url) { res.status(400).json({ error: 'url required' }); return; } res.json({ success: await getDriver().navigateToPost(url), url }); }
  catch (e) { res.status(500).json({ error: String(e) }); }
});

app.get('/api/twitter/comments', async (req: Request, res: Response) => {
  try { const comments = await getDriver().getComments(parseInt(req.query.limit as string) || 50); res.json({ comments, count: comments.length }); }
  catch (e) { res.status(500).json({ error: String(e) }); }
});

app.post('/api/twitter/comments/post', async (req: Request, res: Response) => {
  try {
    const { text, postUrl, useAI, postContent, username } = req.body;
    const d = getDriver();
    if (postUrl) { await d.navigateToPost(postUrl); await new Promise(r => setTimeout(r, 3000)); }
    
    // Use AI to generate comment if requested or if no text provided
    let commentText = text;
    if (useAI || !text) {
      commentText = await generateAIComment(postContent || 'Tweet', username || 'user');
      console.log(`[AI] Generated: "${commentText}"`);
    }
    
    if (!commentText) { res.status(400).json({ error: 'text required or useAI must be true' }); return; }
    const result = await d.postComment(commentText);
    res.json({ ...result, generatedComment: commentText, usedAI: useAI || !text });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// AI-only comment generation endpoint
app.post('/api/twitter/comments/generate', async (req: Request, res: Response) => {
  try {
    const { postContent, username } = req.body;
    const comment = await generateAIComment(postContent || 'Tweet', username || 'user');
    res.json({ success: true, comment, usedAI: !!OPENAI_API_KEY });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.get('/api/twitter/config', (req: Request, res: Response) => res.json({ config: getDriver().getConfig() }));
app.put('/api/twitter/config', (req: Request, res: Response) => { getDriver().setConfig(req.body); res.json({ config: getDriver().getConfig() }); });

export function startServer(port = PORT) { app.listen(port, () => console.log(`🐦 Twitter Comments API running on http://localhost:${port}`)); }
if (process.argv[1]?.includes('server')) startServer();
export { app };
