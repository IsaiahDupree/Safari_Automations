/**
 * Twitter Comment API Server - Port 3007
 */
import express, { Request, Response } from 'express';
import cors from 'cors';
import { TwitterDriver, type TwitterConfig } from '../automation/twitter-driver.js';

const app = express();
app.use(cors());
app.use(express.json());
const PORT = parseInt(process.env.TWITTER_COMMENTS_PORT || '3007');

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
    const { text, postUrl } = req.body;
    if (!text) { res.status(400).json({ error: 'text required' }); return; }
    const d = getDriver();
    if (postUrl) { await d.navigateToPost(postUrl); await new Promise(r => setTimeout(r, 3000)); }
    const result = await d.postComment(text);
    res.json(result);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.get('/api/twitter/config', (req: Request, res: Response) => res.json({ config: getDriver().getConfig() }));
app.put('/api/twitter/config', (req: Request, res: Response) => { getDriver().setConfig(req.body); res.json({ config: getDriver().getConfig() }); });

export function startServer(port = PORT) { app.listen(port, () => console.log(`🐦 Twitter Comments API running on http://localhost:${port}`)); }
if (process.argv[1]?.includes('server')) startServer();
export { app };
