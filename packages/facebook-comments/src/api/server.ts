/**
 * Facebook Comments & Research API Server — Port 3008
 *
 * Capabilities:
 *   - Post comments on Facebook posts
 *   - Navigate to posts by URL
 *   - Research niches / search posts
 *   - Get session/tab status
 */
import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { FacebookDriver, DEFAULT_CONFIG } from '../automation/facebook-driver.js';
import { FacebookResearcher } from '../automation/facebook-researcher.js';
import { TabCoordinator } from '../automation/tab-coordinator.js';

const app = express();
app.use(cors());
app.use(express.json());
app.use((_req, res, next) => { res.setHeader('Content-Type', 'application/json'); next(); });

const PORT = parseInt(process.env.FACEBOOK_PORT || process.env.PORT || '3008');

// ─── Tab Coordination ────────────────────────────────────────────────────────
const SERVICE_NAME = 'facebook-comments';
const SERVICE_PORT = PORT;
const SESSION_URL_PATTERN = 'facebook.com';
const OPEN_URL = 'https://www.facebook.com';
const activeCoordinators = new Map<string, TabCoordinator>();

let _driver: FacebookDriver | null = null;
let _researcher: FacebookResearcher | null = null;

function getDriver(): FacebookDriver {
  if (!_driver) _driver = new FacebookDriver(DEFAULT_CONFIG);
  return _driver;
}
function getResearcher(): FacebookResearcher {
  if (!_researcher) _researcher = new FacebookResearcher();
  return _researcher;
}

// ─── Auth ───────────────────────────────────────────────────────────────────
const VALID_TOKEN = process.env.API_TOKEN || 'test-token-12345';
const AUTH_EXEMPT = /^\/health$|^\/api\/tabs|^\/api\/session|^\/api\/[^/]+\/status$/;

app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.method === 'OPTIONS' || AUTH_EXEMPT.test(req.path)) { next(); return; }
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ') || header.substring(7) !== VALID_TOKEN) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
});

// ─── Tab Claim Enforcement ───────────────────────────────────────────────────
const CLAIM_EXEMPT = /^\/health$|^\/api\/tabs|^\/api\/session|^\/api\/[^/]+\/status$/;

async function requireTabClaim(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (CLAIM_EXEMPT.test(req.path)) { next(); return; }

  const claims = await TabCoordinator.listClaims();
  const myClaim = claims.find(c => c.service === SERVICE_NAME);

  if (myClaim) { next(); return; }

  const autoId = `facebook-comments-auto-${Date.now()}`;
  try {
    const coord = new TabCoordinator(autoId, SERVICE_NAME, SERVICE_PORT, SESSION_URL_PATTERN, OPEN_URL);
    activeCoordinators.set(autoId, coord);
    const claim = await coord.claim();
    console.log(`[requireTabClaim] Auto-claimed w=${claim.windowIndex} t=${claim.tabIndex}`);
    next();
  } catch (err) {
    res.status(503).json({
      error: 'No Safari tab available for facebook-comments',
      detail: String(err),
      fix: `Open Safari and navigate to ${OPEN_URL}, or POST /api/tabs/claim`,
    });
  }
}

app.use(requireTabClaim);

// ─── Health ──────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'facebook-comments', port: PORT, timestamp: new Date().toISOString() });
});

// ─── Session endpoints ───────────────────────────────────────────────────────
app.get('/api/session/status', (_req, res) => {
  res.json({ sessionUrlPattern: SESSION_URL_PATTERN });
});

app.post('/api/session/ensure', async (_req, res) => {
  const claims = await TabCoordinator.listClaims();
  const myClaim = claims.find(c => c.service === SERVICE_NAME);
  if (myClaim) {
    res.json({ ok: true, windowIndex: myClaim.windowIndex, tabIndex: myClaim.tabIndex, url: myClaim.tabUrl });
    return;
  }
  const autoId = `facebook-comments-auto-${Date.now()}`;
  try {
    const coord = new TabCoordinator(autoId, SERVICE_NAME, SERVICE_PORT, SESSION_URL_PATTERN, OPEN_URL);
    activeCoordinators.set(autoId, coord);
    const claim = await coord.claim();
    res.json({ ok: true, windowIndex: claim.windowIndex, tabIndex: claim.tabIndex, url: claim.tabUrl });
  } catch (err) {
    res.status(503).json({ ok: false, error: String(err) });
  }
});

app.post('/api/session/clear', async (_req, res) => {
  for (const [id, coord] of activeCoordinators) {
    await coord.release();
    activeCoordinators.delete(id);
  }
  _driver = null;
  _researcher = null;
  res.json({ ok: true, message: 'Session cleared' });
});

// ─── Tab claim endpoints ─────────────────────────────────────────────────────
app.get('/api/tabs/claims', async (_req, res) => {
  res.json(await TabCoordinator.listClaims());
});

app.post('/api/tabs/claim', async (req, res) => {
  const { agentId, openUrl } = req.body ?? {};
  if (!agentId) { res.status(400).json({ error: 'agentId required' }); return; }
  try {
    const coord = new TabCoordinator(agentId, SERVICE_NAME, SERVICE_PORT, SESSION_URL_PATTERN, openUrl);
    activeCoordinators.set(agentId, coord);
    const claim = await coord.claim();
    res.json({ ok: true, claim });
  } catch (err) {
    res.status(503).json({ ok: false, error: String(err) });
  }
});

// ─── Facebook status ─────────────────────────────────────────────────────────
app.get('/api/facebook/status', async (_req, res) => {
  try { res.json(await getDriver().getStatus()); }
  catch (e) { res.status(500).json({ error: String(e) }); }
});

// ─── Comment on a post ────────────────────────────────────────────────────────
app.post('/api/facebook/comment', async (req: Request, res: Response) => {
  const { postUrl, text } = req.body ?? {};
  if (!postUrl || !text) {
    res.status(400).json({ error: 'postUrl and text are required' });
    return;
  }
  try {
    const driver = getDriver();
    await driver.navigateToPost(postUrl);
    const result = await driver.postComment(text);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ─── Navigate to post ────────────────────────────────────────────────────────
app.post('/api/facebook/navigate', async (req: Request, res: Response) => {
  const { url } = req.body ?? {};
  if (!url) { res.status(400).json({ error: 'url required' }); return; }
  try {
    res.json({ success: await getDriver().navigateToPost(url), url });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ─── Get post details ────────────────────────────────────────────────────────
app.get('/api/facebook/post', async (_req, res) => {
  try { res.json(await getDriver().getPostDetails()); }
  catch (e) { res.status(500).json({ error: String(e) }); }
});

// ─── Scroll feed ─────────────────────────────────────────────────────────────
app.post('/api/facebook/scroll', async (_req, res) => {
  try { await getDriver().scroll(); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: String(e) }); }
});

// ─── Research endpoints ──────────────────────────────────────────────────────
app.post('/api/facebook/research/search', async (req: Request, res: Response) => {
  const { query } = req.body ?? {};
  if (!query) { res.status(400).json({ error: 'query required' }); return; }
  try {
    const researcher = getResearcher();
    await researcher.search(query);
    const posts = await researcher.extractVisiblePosts(query);
    res.json({ query, posts });
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.post('/api/facebook/research/niche', async (req: Request, res: Response) => {
  const { niche } = req.body ?? {};
  if (!niche) { res.status(400).json({ error: 'niche required' }); return; }
  try {
    res.json(await getResearcher().researchNiche(niche));
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ─── Start ───────────────────────────────────────────────────────────────────
export function startServer(port: number = PORT): void {
  app.listen(port, () => {
    console.log(`\nFacebook Comments API running on http://localhost:${port}`);
    console.log(`   POST /api/facebook/comment            { postUrl, text }`);
    console.log(`   POST /api/facebook/navigate           { url }`);
    console.log(`   GET  /api/facebook/post`);
    console.log(`   POST /api/facebook/scroll`);
    console.log(`   POST /api/facebook/research/search    { query }`);
    console.log(`   POST /api/facebook/research/niche     { niche }`);
    console.log(`   GET  /api/facebook/status`);
    console.log(`   GET  /health\n`);
  });
}

if (process.argv[1]?.includes('server')) startServer();

export { app };
