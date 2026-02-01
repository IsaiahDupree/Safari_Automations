/**
 * Instagram Comment API Server
 * 
 * REST API for Instagram comment automation via Safari.
 * Port: 3005
 */

import express, { Request, Response } from 'express';
import cors from 'cors';
import { InstagramDriver, DEFAULT_CONFIG, type InstagramConfig } from '../automation/instagram-driver.js';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = parseInt(process.env.INSTAGRAM_COMMENTS_PORT || process.env.PORT || '3005');

let driver: InstagramDriver | null = null;

function getDriver(): InstagramDriver {
  if (!driver) {
    driver = new InstagramDriver();
  }
  return driver;
}

app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'instagram-comments',
    port: PORT,
    timestamp: new Date().toISOString(),
  });
});

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

app.get('/api/instagram/rate-limits', (req: Request, res: Response) => {
  const d = getDriver();
  res.json(d.getRateLimits());
});

app.put('/api/instagram/rate-limits', (req: Request, res: Response) => {
  const updates = req.body as Partial<InstagramConfig>;
  const d = getDriver();
  d.setConfig(updates);
  res.json({ rateLimits: d.getConfig() });
});

app.post('/api/instagram/navigate', async (req: Request, res: Response) => {
  try {
    const { url } = req.body;
    if (!url) { res.status(400).json({ error: 'url is required' }); return; }
    const d = getDriver();
    const success = await d.navigateToPost(url);
    res.json({ success, url });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.get('/api/instagram/post', async (req: Request, res: Response) => {
  try {
    const d = getDriver();
    const details = await d.getPostDetails();
    res.json(details);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.get('/api/instagram/comments', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const d = getDriver();
    const comments = await d.getComments(limit);
    res.json({ comments, count: comments.length });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.post('/api/instagram/comments/post', async (req: Request, res: Response) => {
  try {
    const { text, postUrl } = req.body;
    if (!text) { res.status(400).json({ error: 'text is required' }); return; }
    const d = getDriver();
    if (postUrl) {
      const navSuccess = await d.navigateToPost(postUrl);
      if (!navSuccess) { res.status(500).json({ error: 'Failed to navigate to post' }); return; }
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    const result = await d.postComment(text);
    if (result.success) {
      res.json({ success: true, commentId: result.commentId, text: text.substring(0, 100) });
    } else {
      res.status(400).json({ success: false, error: result.error });
    }
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.get('/api/instagram/config', (req: Request, res: Response) => {
  const d = getDriver();
  res.json({ config: d.getConfig() });
});

app.put('/api/instagram/config', (req: Request, res: Response) => {
  const updates = req.body as Partial<InstagramConfig>;
  const d = getDriver();
  d.setConfig(updates);
  res.json({ config: d.getConfig() });
});

export function startServer(port: number = PORT): void {
  app.listen(port, () => {
    console.log(`📸 Instagram Comments API running on http://localhost:${port}`);
    console.log(`   Health:   GET  /health`);
    console.log(`   Status:   GET  /api/instagram/status`);
    console.log(`   Post:     POST /api/instagram/comments/post`);
  });
}

if (process.argv[1]?.includes('server')) {
  startServer();
}

export { app };
