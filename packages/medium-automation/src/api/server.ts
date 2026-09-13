/**
 * Medium Automation API Server
 *
 * Port 3107 — REST endpoints for Medium blogging automation
 *
 * Capabilities:
 *   - Create & publish blog posts
 *   - Clap on articles (1-50x)
 *   - Respond/comment on articles
 *   - Follow authors
 *   - Bookmark articles
 *   - Read & extract article content + metrics
 *   - Search articles
 *   - Read user profiles
 *   - Get your stats & stories
 *   - Read your feed
 */

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { MediumOperations } from '../automation/medium-operations.js';
import type { PostDraft } from '../automation/medium-operations.js';
import { MonetizationEngine } from '../automation/monetization-engine.js';
import { MediumResearcher } from '../automation/medium-researcher.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

const PORT = parseInt(process.env.MEDIUM_PORT || '3107');
const medium = new MediumOperations();
const monetization = new MonetizationEngine(medium);
const researcher = new MediumResearcher();

// ─── Health ──────────────────────────────────────────────────

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'medium-automation', port: PORT });
});

// ─── Status (login check) ───────────────────────────────────

app.get('/api/medium/status', async (_req: Request, res: Response) => {
  try {
    const status = await medium.checkStatus();
    res.json(status);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ═══════════════════════════════════════════════════════════════
// BLOG POST OPERATIONS
// ═══════════════════════════════════════════════════════════════

// ─── Create & Publish a Post ─────────────────────────────────

app.post('/api/medium/posts/create', async (req: Request, res: Response) => {
  try {
    const { title, body, tags, subtitle, publish } = req.body;
    if (!title || !body) {
      res.status(400).json({ error: 'title and body are required' });
      return;
    }

    const draft: PostDraft = {
      title,
      body,
      tags,
      subtitle,
      publishImmediately: publish !== false,
    };

    const result = await medium.createPost(draft);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ─── Get My Stories/Drafts ───────────────────────────────────

app.get('/api/medium/posts/mine', async (_req: Request, res: Response) => {
  try {
    const stories = await medium.getMyStories();
    res.json({ stories, count: stories.length });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ═══════════════════════════════════════════════════════════════
// ARTICLE INTERACTIONS
// ═══════════════════════════════════════════════════════════════

// ─── Clap on Article ─────────────────────────────────────────

app.post('/api/medium/articles/clap', async (req: Request, res: Response) => {
  try {
    const { url, claps } = req.body;
    if (!url) {
      res.status(400).json({ error: 'url is required' });
      return;
    }
    const result = await medium.clapArticle(url, claps || 1);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ─── Respond to Article ──────────────────────────────────────

app.post('/api/medium/articles/respond', async (req: Request, res: Response) => {
  try {
    const { url, text } = req.body;
    if (!url || !text) {
      res.status(400).json({ error: 'url and text are required' });
      return;
    }
    const result = await medium.respondToArticle(url, text);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ─── Bookmark Article ────────────────────────────────────────

app.post('/api/medium/articles/bookmark', async (req: Request, res: Response) => {
  try {
    const { url } = req.body;
    if (!url) {
      res.status(400).json({ error: 'url is required' });
      return;
    }
    const result = await medium.bookmarkArticle(url);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ─── Read Article Content ────────────────────────────────────

app.post('/api/medium/articles/read', async (req: Request, res: Response) => {
  try {
    const { url } = req.body;
    if (!url) {
      res.status(400).json({ error: 'url is required' });
      return;
    }
    const article = await medium.readArticle(url);
    if (!article) {
      res.status(404).json({ error: 'Could not read article' });
      return;
    }
    res.json(article);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ─── Get Article Metrics ─────────────────────────────────────

app.post('/api/medium/articles/metrics', async (req: Request, res: Response) => {
  try {
    const { url } = req.body;
    if (!url) {
      res.status(400).json({ error: 'url is required' });
      return;
    }
    const metrics = await medium.getArticleMetrics(url);
    if (!metrics) {
      res.status(404).json({ error: 'Could not get metrics' });
      return;
    }
    res.json({ url, ...metrics });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ═══════════════════════════════════════════════════════════════
// USER & SOCIAL
// ═══════════════════════════════════════════════════════════════

// ─── Follow Author ───────────────────────────────────────────

app.post('/api/medium/users/follow', async (req: Request, res: Response) => {
  try {
    const { username, url } = req.body;
    const authorUrl = url || (username ? `https://medium.com/@${username}` : null);
    if (!authorUrl) {
      res.status(400).json({ error: 'username or url is required' });
      return;
    }
    const result = await medium.followAuthor(authorUrl);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ─── Read User Profile ───────────────────────────────────────

app.get('/api/medium/users/:username', async (req: Request, res: Response) => {
  try {
    const profile = await medium.readProfile(req.params.username);
    if (!profile) {
      res.status(404).json({ error: 'Could not read profile' });
      return;
    }
    res.json(profile);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ═══════════════════════════════════════════════════════════════
// DISCOVERY
// ═══════════════════════════════════════════════════════════════

// ─── Read Feed ───────────────────────────────────────────────

app.get('/api/medium/feed', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;
    const feed = await medium.readFeed(limit);
    res.json({ articles: feed, count: feed.length });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ─── Search Articles ─────────────────────────────────────────

app.post('/api/medium/search', async (req: Request, res: Response) => {
  try {
    const { query, limit } = req.body;
    if (!query) {
      res.status(400).json({ error: 'query is required' });
      return;
    }
    const results = await medium.searchArticles(query, limit || 10);
    res.json({ results, count: results.length, query });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ═══════════════════════════════════════════════════════════════
// STATS
// ═══════════════════════════════════════════════════════════════

app.get('/api/medium/stats', async (_req: Request, res: Response) => {
  try {
    const stats = await medium.getMyStats();
    if (!stats) {
      res.status(404).json({ error: 'Could not get stats' });
      return;
    }
    res.json(stats);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ═══════════════════════════════════════════════════════════════
// STORY MANAGEMENT & PAYWALL
// ═══════════════════════════════════════════════════════════════

// ─── List Published Stories ──────────────────────────────────

app.get('/api/medium/stories/published', async (req: Request, res: Response) => {
  try {
    const maxStories = parseInt(req.query.max as string) || 100;
    const scrollPages = parseInt(req.query.scrollPages as string) || 5;
    const result = await medium.listPublishedStories({ maxStories, scrollPages });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ─── Collect All Story IDs (deep scroll) ─────────────────────

app.get('/api/medium/stories/all-ids', async (req: Request, res: Response) => {
  try {
    const max = parseInt(req.query.max as string) || 500;
    const stories = await medium.collectAllStoryIds(max);
    res.json({ stories, count: stories.length });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ─── Get Story Settings ──────────────────────────────────────

app.get('/api/medium/stories/:storyId/settings', async (req: Request, res: Response) => {
  try {
    const settings = await medium.getStorySettings(req.params.storyId);
    if (!settings) {
      res.status(404).json({ error: 'Could not load story settings' });
      return;
    }
    res.json(settings);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ─── Get Story Stats ─────────────────────────────────────────

app.get('/api/medium/stories/:storyId/stats', async (req: Request, res: Response) => {
  try {
    const stats = await medium.getStoryStats(req.params.storyId);
    if (!stats) {
      res.status(404).json({ error: 'Could not load story stats' });
      return;
    }
    res.json(stats);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ─── Add Paywall to a Story ──────────────────────────────────

app.post('/api/medium/stories/:storyId/paywall/add', async (req: Request, res: Response) => {
  try {
    const result = await medium.togglePaywall(req.params.storyId, 'add');
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ─── Remove Paywall from a Story ─────────────────────────────

app.post('/api/medium/stories/:storyId/paywall/remove', async (req: Request, res: Response) => {
  try {
    const result = await medium.togglePaywall(req.params.storyId, 'remove');
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ─── Batch Add Paywall ───────────────────────────────────────

app.post('/api/medium/stories/paywall/batch-add', async (req: Request, res: Response) => {
  try {
    const { storyIds, delayMs } = req.body;
    if (!storyIds || !Array.isArray(storyIds) || storyIds.length === 0) {
      res.status(400).json({ error: 'storyIds array is required' });
      return;
    }
    const result = await medium.batchTogglePaywall(storyIds, 'add', delayMs || 3000);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ─── Batch Remove Paywall ────────────────────────────────────

app.post('/api/medium/stories/paywall/batch-remove', async (req: Request, res: Response) => {
  try {
    const { storyIds, delayMs } = req.body;
    if (!storyIds || !Array.isArray(storyIds) || storyIds.length === 0) {
      res.status(400).json({ error: 'storyIds array is required' });
      return;
    }
    const result = await medium.batchTogglePaywall(storyIds, 'remove', delayMs || 3000);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ═══════════════════════════════════════════════════════════════
// MONETIZATION ENGINE
// ═══════════════════════════════════════════════════════════════

// ─── Earnings ────────────────────────────────────────────────

app.get('/api/medium/monetization/earnings', async (_req: Request, res: Response) => {
  try {
    const earnings = await monetization.getEarnings();
    res.json(earnings);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ─── Audience Stats ──────────────────────────────────────────

app.get('/api/medium/monetization/audience', async (_req: Request, res: Response) => {
  try {
    const audience = await monetization.getAudienceStats();
    res.json(audience);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ─── Paywall Analysis ────────────────────────────────────────

app.get('/api/medium/monetization/analyze', async (req: Request, res: Response) => {
  try {
    const maxStories = parseInt(req.query.max as string) || 200;
    const scrollPages = parseInt(req.query.scrollPages as string) || 15;
    const result = await monetization.analyzeForPaywall({ maxStories, scrollPages });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ─── Execute Paywall Recommendations ─────────────────────────

app.post('/api/medium/monetization/execute', async (req: Request, res: Response) => {
  try {
    const { storyIds, action } = req.body;
    if (!storyIds || !Array.isArray(storyIds)) {
      res.status(400).json({ error: 'storyIds array is required' });
      return;
    }
    const result = await medium.batchTogglePaywall(storyIds, action || 'add');
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ─── SEO Audit ───────────────────────────────────────────────

app.post('/api/medium/monetization/seo/audit', async (req: Request, res: Response) => {
  try {
    const { storyIds } = req.body;
    if (!storyIds || !Array.isArray(storyIds) || storyIds.length === 0) {
      res.status(400).json({ error: 'storyIds array is required' });
      return;
    }
    const result = await monetization.auditSEO(storyIds);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ─── Update SEO for a Story ──────────────────────────────────

app.post('/api/medium/monetization/seo/update', async (req: Request, res: Response) => {
  try {
    const { storyId, seoTitle, seoDescription } = req.body;
    if (!storyId) {
      res.status(400).json({ error: 'storyId is required' });
      return;
    }
    const result = await monetization.updateSEO(storyId, seoTitle, seoDescription);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ─── Full Monetization Report ────────────────────────────────

app.get('/api/medium/monetization/report', async (_req: Request, res: Response) => {
  try {
    const report = await monetization.generateFullReport();
    res.json(report);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ─── Saved Reports ───────────────────────────────────────────

app.get('/api/medium/monetization/reports', async (_req: Request, res: Response) => {
  try {
    const reports = monetization.listSavedReports();
    res.json({ reports, count: reports.length });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ═══════════════════════════════════════════════════════════════
// MARKET RESEARCH
// ═══════════════════════════════════════════════════════════════

// ─── Research a Single Niche ─────────────────────────────────

app.post('/api/medium/research/niche', async (req: Request, res: Response) => {
  try {
    const { niche } = req.body;
    if (!niche) {
      res.status(400).json({ error: 'niche is required (e.g. "artificial-intelligence", "saas", "personal-branding")' });
      return;
    }
    const result = await researcher.researchNiche(niche);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ─── Research Multiple Niches ────────────────────────────────

app.post('/api/medium/research/multi', async (req: Request, res: Response) => {
  try {
    const { niches } = req.body;
    if (!niches || !Array.isArray(niches) || niches.length === 0) {
      res.status(400).json({ error: 'niches array is required' });
      return;
    }
    const result = await researcher.researchMultipleNiches(niches);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ─── Discover Top Authors Across Niches ──────────────────────

app.post('/api/medium/research/top-authors', async (req: Request, res: Response) => {
  try {
    const { niches, minFollowers } = req.body;
    if (!niches || !Array.isArray(niches) || niches.length === 0) {
      res.status(400).json({ error: 'niches array is required' });
      return;
    }
    const authors = await researcher.discoverTopAuthors(niches, minFollowers || 1000);
    res.json({ authors, count: authors.length });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ─── News Summary Across Niches ──────────────────────────────

app.post('/api/medium/research/news', async (req: Request, res: Response) => {
  try {
    const { niches } = req.body;
    if (!niches || !Array.isArray(niches) || niches.length === 0) {
      res.status(400).json({ error: 'niches array is required' });
      return;
    }
    const summaries = await researcher.getNewsSummary(niches);
    res.json({ summaries, count: summaries.length });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ─── Research + Forward to External Server ───────────────────

app.post('/api/medium/research/forward', async (req: Request, res: Response) => {
  try {
    const { niches, webhook } = req.body;
    if (!niches || !Array.isArray(niches) || niches.length === 0) {
      res.status(400).json({ error: 'niches array is required' });
      return;
    }
    if (!webhook || !webhook.url) {
      res.status(400).json({ error: 'webhook.url is required' });
      return;
    }
    const result = await researcher.researchAndForward(niches, webhook);
    res.json({
      researchSummary: {
        niches: result.research.niches.length,
        totalAuthors: result.research.allTopAuthors.length,
        totalArticles: result.research.allTrendingArticles.length,
      },
      forwarded: result.forwarded,
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ─── Saved Research ──────────────────────────────────────────

app.get('/api/medium/research/saved', async (_req: Request, res: Response) => {
  try {
    const files = researcher.listSavedResearch();
    res.json({ files, count: files.length });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ═══════════════════════════════════════════════════════════════
// START SERVER
// ═══════════════════════════════════════════════════════════════

export function startServer(port: number = PORT): void {
  app.listen(port, () => {
    console.log(`\n📝 Medium Automation API running on http://localhost:${port}`);
    console.log(`\n   ── BLOG POSTS ──`);
    console.log(`   Create/Publish:  POST /api/medium/posts/create          {title, body, tags?, subtitle?, publish?}`);
    console.log(`   My stories:      GET  /api/medium/posts/mine`);
    console.log(`\n   ── ARTICLE INTERACTIONS ──`);
    console.log(`   Clap:            POST /api/medium/articles/clap         {url, claps?}`);
    console.log(`   Respond:         POST /api/medium/articles/respond      {url, text}`);
    console.log(`   Bookmark:        POST /api/medium/articles/bookmark     {url}`);
    console.log(`   Read article:    POST /api/medium/articles/read         {url}`);
    console.log(`   Get metrics:     POST /api/medium/articles/metrics      {url}`);
    console.log(`\n   ── USERS & SOCIAL ──`);
    console.log(`   Follow:          POST /api/medium/users/follow          {username | url}`);
    console.log(`   Read profile:    GET  /api/medium/users/:username`);
    console.log(`\n   ── DISCOVERY ──`);
    console.log(`   Feed:            GET  /api/medium/feed?limit=10`);
    console.log(`   Search:          POST /api/medium/search                {query, limit?}`);
    console.log(`\n   ── STORY MANAGEMENT & PAYWALL ──`);
    console.log(`   Published list:  GET  /api/medium/stories/published     ?max=100&scrollPages=5`);
    console.log(`   All story IDs:   GET  /api/medium/stories/all-ids       ?max=500`);
    console.log(`   Story settings:  GET  /api/medium/stories/:id/settings`);
    console.log(`   Story stats:     GET  /api/medium/stories/:id/stats`);
    console.log(`   Add paywall:     POST /api/medium/stories/:id/paywall/add`);
    console.log(`   Remove paywall:  POST /api/medium/stories/:id/paywall/remove`);
    console.log(`   Batch add:       POST /api/medium/stories/paywall/batch-add     {storyIds[]}`);
    console.log(`   Batch remove:    POST /api/medium/stories/paywall/batch-remove  {storyIds[]}`);
    console.log(`\n   ── MONETIZATION ENGINE ──`);
    console.log(`   Earnings:        GET  /api/medium/monetization/earnings`);
    console.log(`   Audience:        GET  /api/medium/monetization/audience`);
    console.log(`   Analyze:         GET  /api/medium/monetization/analyze       ?max=200&scrollPages=15`);
    console.log(`   Execute:         POST /api/medium/monetization/execute       {storyIds[], action}`);
    console.log(`   SEO audit:       POST /api/medium/monetization/seo/audit     {storyIds[]}`);
    console.log(`   SEO update:      POST /api/medium/monetization/seo/update    {storyId, seoTitle?, seoDescription?}`);
    console.log(`   Full report:     GET  /api/medium/monetization/report`);
    console.log(`   Saved reports:   GET  /api/medium/monetization/reports`);
    console.log(`\n   ── MARKET RESEARCH ──`);
    console.log(`   Single niche:    POST /api/medium/research/niche        {niche}`);
    console.log(`   Multi-niche:     POST /api/medium/research/multi        {niches[]}`);
    console.log(`   Top authors:     POST /api/medium/research/top-authors  {niches[], minFollowers?}`);
    console.log(`   News summary:    POST /api/medium/research/news         {niches[]}`);
    console.log(`   Forward:         POST /api/medium/research/forward      {niches[], webhook:{url,headers?}}`);
    console.log(`   Saved research:  GET  /api/medium/research/saved`);
    console.log(`\n   ── STATS ──`);
    console.log(`   Status:          GET  /api/medium/status`);
    console.log(`   My stats:        GET  /api/medium/stats\n`);
  });
}

if (process.argv[1]?.includes('server')) startServer();

export { app };
