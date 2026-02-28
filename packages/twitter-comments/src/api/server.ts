/**
 * Twitter Comment API Server - Port 3007
 * Now with AI-powered comment generation!
 */
import 'dotenv/config';
import express, { Request, Response } from 'express';
import cors from 'cors';
import { TwitterDriver, type TwitterConfig, type ComposeOptions, type SearchResult, type TweetDetail } from '../automation/twitter-driver.js';

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
    if (tweetText.length > 280) {
      tweetText = tweetText.substring(0, 277) + '...';
      console.log(`[AI Tweet] Trimmed to 280 chars`);
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
    if (!topic) { res.status(400).json({ error: 'topic required' }); return; }
    const tweet = await generateAITweet(topic, style, context);
    res.json({ success: true, tweet, charCount: tweet.length, maxChars: 280, usedAI: !!OPENAI_API_KEY });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ─── Tweet Search ──────────────────────────────────────────
app.post('/api/twitter/search', async (req: Request, res: Response) => {
  try {
    const { query, tab, maxResults, scrolls } = req.body;
    if (!query) { res.status(400).json({ error: 'query required' }); return; }
    const result = await getDriver().searchTweets(query, { tab, maxResults, scrolls });
    res.json({ success: true, ...result, count: result.tweets.length });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ─── Tweet Detail ──────────────────────────────────────────
app.post('/api/twitter/tweet/detail', async (req: Request, res: Response) => {
  try {
    const { url } = req.body;
    if (!url) { res.status(400).json({ error: 'url required' }); return; }
    const detail = await getDriver().getTweetDetail(url);
    if (!detail) { res.status(404).json({ error: 'Tweet not found or failed to extract' }); return; }
    res.json({ success: true, tweet: detail });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ─── Reply to Tweet ────────────────────────────────────────
app.post('/api/twitter/tweet/reply', async (req: Request, res: Response) => {
  try {
    const { url, text, useAI, topic, style, context } = req.body;
    if (!url) { res.status(400).json({ error: 'url required' }); return; }

    let replyText = text;
    if (useAI || (!text && topic)) {
      if (!topic && !text) { res.status(400).json({ error: 'text or topic required for reply' }); return; }
      replyText = await generateAITweet(topic || text, style, context);
      console.log(`[AI Reply] Generated (${replyText.length} chars): "${replyText}"`);
    }
    if (!replyText) { res.status(400).json({ error: 'text or topic required' }); return; }
    if (replyText.length > 280) replyText = replyText.substring(0, 277) + '...';

    const result = await getDriver().replyToTweet(url, replyText);
    res.json({ ...result, replyText, charCount: replyText.length, usedAI: !!(useAI || (!text && topic)) });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ─── User Timeline ─────────────────────────────────────────
app.post('/api/twitter/timeline', async (req: Request, res: Response) => {
  try {
    const { handle, maxResults } = req.body;
    if (!handle) { res.status(400).json({ error: 'handle required' }); return; }
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
    if (!query) { res.status(400).json({ error: 'query required' }); return; }
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

app.get('/api/twitter/config', (req: Request, res: Response) => res.json({ config: getDriver().getConfig() }));
app.put('/api/twitter/config', (req: Request, res: Response) => { getDriver().setConfig(req.body); res.json({ config: getDriver().getConfig() }); });

export function startServer(port = PORT) { app.listen(port, () => console.log(`🐦 Twitter Comments API running on http://localhost:${port}`)); }
if (process.argv[1]?.includes('server')) startServer();
export { app };
