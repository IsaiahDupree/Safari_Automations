/**
 * Unified Market Research API Server
 *
 * Exposes all 5 platform researchers (Twitter, Threads, Instagram, Facebook, TikTok)
 * via REST endpoints so any external server can trigger research, check status,
 * and retrieve structured results.
 *
 * Port: 3106
 *
 * Endpoints:
 *   GET  /health                              — health check
 *   GET  /api/research/platforms              — list supported platforms
 *
 *   POST /api/research/:platform/search       — search a single query
 *   POST /api/research/:platform/niche        — research a single niche (full pipeline)
 *   POST /api/research/:platform/full         — multi-niche research (the big one)
 *   POST /api/research/all/full               — run across ALL platforms
 *
 *   GET  /api/research/status                 — current job status
 *   GET  /api/research/results                — list saved result files
 *   GET  /api/research/results/:filename      — download a specific result file
 *   GET  /api/research/results/latest/:platform — get latest results for a platform
 *
 * Start:
 *   npx tsx packages/market-research/src/api/server.ts
 */

import express, { Request, Response } from 'express';
import cors from 'cors';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ─── Platform Researchers (lazy-loaded to avoid import issues) ────

import { TwitterResearcher } from '../../../twitter-comments/src/automation/twitter-researcher.js';
import { ThreadsResearcher } from '../../../threads-comments/src/automation/threads-researcher.js';
import { InstagramResearcher } from '../../../instagram-comments/src/automation/instagram-researcher.js';
import { FacebookResearcher } from '../../../facebook-comments/src/automation/facebook-researcher.js';
import { TikTokResearcher } from '../../../tiktok-comments/src/automation/tiktok-researcher.js';

// ─── Types ───────────────────────────────────────────────────────

interface ResearchJob {
  id: string;
  platform: string;
  niches: string[];
  status: 'queued' | 'running' | 'completed' | 'failed';
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  resultFile?: string;
  error?: string;
  progress?: {
    currentNiche: string;
    nichesCompleted: number;
    totalNiches: number;
  };
}

type Platform = 'twitter' | 'threads' | 'instagram' | 'facebook' | 'tiktok';

const PLATFORMS: Platform[] = ['twitter', 'threads', 'instagram', 'facebook', 'tiktok'];

const DEFAULT_OUTPUT_DIR = path.join(os.homedir(), 'Documents/market-research');

// ─── State ───────────────────────────────────────────────────────

const jobs: Map<string, ResearchJob> = new Map();
let currentJob: ResearchJob | null = null;

// ─── Researcher Factory ──────────────────────────────────────────

function createResearcher(platform: Platform, config: Record<string, any> = {}) {
  const outputDir = config.outputDir || path.join(DEFAULT_OUTPUT_DIR, platform);

  switch (platform) {
    case 'twitter':
      return new TwitterResearcher({
        tweetsPerNiche: config.postsPerNiche || 1000,
        creatorsPerNiche: config.creatorsPerNiche || 100,
        scrollPauseMs: config.scrollPauseMs || 2000,
        maxScrollsPerSearch: config.maxScrollsPerSearch || 200,
        outputDir,
        ...config,
      });
    case 'threads':
      return new ThreadsResearcher({
        postsPerNiche: config.postsPerNiche || 1000,
        creatorsPerNiche: config.creatorsPerNiche || 100,
        scrollPauseMs: config.scrollPauseMs || 2000,
        maxScrollsPerSearch: config.maxScrollsPerSearch || 200,
        outputDir,
        ...config,
      });
    case 'instagram':
      return new InstagramResearcher({
        postsPerNiche: config.postsPerNiche || 1000,
        creatorsPerNiche: config.creatorsPerNiche || 100,
        detailedScrapeTop: config.detailedScrapeTop || 50,
        scrollPauseMs: config.scrollPauseMs || 1800,
        maxScrollsPerSearch: config.maxScrollsPerSearch || 200,
        outputDir,
        ...config,
      });
    case 'facebook':
      return new FacebookResearcher({
        postsPerNiche: config.postsPerNiche || 1000,
        creatorsPerNiche: config.creatorsPerNiche || 100,
        scrollPauseMs: config.scrollPauseMs || 2000,
        maxScrollsPerSearch: config.maxScrollsPerSearch || 200,
        outputDir,
        ...config,
      });
    case 'tiktok':
      return new TikTokResearcher({
        videosPerNiche: config.postsPerNiche || 1000,
        creatorsPerNiche: config.creatorsPerNiche || 100,
        scrollPauseMs: config.scrollPauseMs || 1800,
        maxScrollsPerSearch: config.maxScrollsPerSearch || 200,
        outputDir,
        ...config,
      });
    default:
      throw new Error(`Unknown platform: ${platform}`);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────

function generateJobId(): string {
  return `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function listResultFiles(platform?: string): Array<{ filename: string; platform: string; size: number; modified: string }> {
  const results: Array<{ filename: string; platform: string; size: number; modified: string }> = [];
  const baseDir = DEFAULT_OUTPUT_DIR;

  const dirs = platform ? [platform] : PLATFORMS;
  for (const p of dirs) {
    const dir = path.join(baseDir, p);
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      const stat = fs.statSync(path.join(dir, file));
      results.push({
        filename: `${p}/${file}`,
        platform: p,
        size: stat.size,
        modified: stat.mtime.toISOString(),
      });
    }
  }

  return results.sort((a, b) => b.modified.localeCompare(a.modified));
}

// ─── Express App ─────────────────────────────────────────────────

const app = express();
app.use(cors());
app.use(express.json());

const PORT = parseInt(process.env.RESEARCH_PORT || process.env.PORT || '3106');

// ─── Health ──────────────────────────────────────────────────────

app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'market-research',
    port: PORT,
    platforms: PLATFORMS,
    currentJob: currentJob ? { id: currentJob.id, platform: currentJob.platform, status: currentJob.status } : null,
    jobsTotal: jobs.size,
  });
});

// ─── List platforms ──────────────────────────────────────────────

app.get('/api/research/platforms', (_req: Request, res: Response) => {
  res.json({
    platforms: PLATFORMS.map(p => ({
      name: p,
      searchMethod: {
        twitter: 'x.com/search?q=',
        threads: 'threads.net/search?q=',
        instagram: '/explore/tags/{hashtag}/',
        facebook: 'facebook.com/search/posts/?q=',
        tiktok: 'tiktok.com/search/video?q=',
      }[p],
      metrics: {
        twitter: ['likes', 'retweets', 'replies'],
        threads: ['likes', 'reposts', 'replies'],
        instagram: ['likes', 'comments'],
        facebook: ['reactions', 'comments', 'shares'],
        tiktok: ['views', 'likes', 'comments', 'shares'],
      }[p],
    })),
    defaults: {
      postsPerNiche: 1000,
      creatorsPerNiche: 100,
    },
  });
});

// ─── Search (single query, returns immediately) ──────────────────

app.post('/api/research/:platform/search', async (req: Request, res: Response) => {
  const platform = req.params.platform as Platform;
  if (!PLATFORMS.includes(platform)) {
    res.status(400).json({ error: `Invalid platform. Must be one of: ${PLATFORMS.join(', ')}` });
    return;
  }

  const { query, config } = req.body;
  if (!query) {
    res.status(400).json({ error: 'query is required' });
    return;
  }

  try {
    const researcher = createResearcher(platform, config || {});

    // Search and extract visible posts
    let searchOk: boolean;
    if (platform === 'instagram') {
      searchOk = await (researcher as InstagramResearcher).searchHashtag(query);
    } else {
      searchOk = await (researcher as any).search(query);
    }

    if (!searchOk) {
      res.json({ success: false, error: 'Search returned no results or failed to load', platform, query });
      return;
    }

    // Extract visible posts
    let posts: any[];
    if (platform === 'instagram') {
      posts = await (researcher as InstagramResearcher).extractPostUrls(query);
    } else if (platform === 'tiktok') {
      posts = await (researcher as TikTokResearcher).extractVisibleVideos(query);
    } else {
      posts = await (researcher as any).extractVisiblePosts(query);
    }

    res.json({ success: true, platform, query, posts, count: posts.length });
  } catch (e) {
    res.status(500).json({ error: String(e), platform, query });
  }
});

// ─── Single niche research (async, returns job ID) ───────────────

app.post('/api/research/:platform/niche', async (req: Request, res: Response) => {
  const platform = req.params.platform as Platform;
  if (!PLATFORMS.includes(platform)) {
    res.status(400).json({ error: `Invalid platform. Must be one of: ${PLATFORMS.join(', ')}` });
    return;
  }

  const { niche, config } = req.body;
  if (!niche) {
    res.status(400).json({ error: 'niche is required' });
    return;
  }

  if (currentJob && currentJob.status === 'running') {
    res.status(409).json({ error: 'A research job is already running', currentJob: { id: currentJob.id, platform: currentJob.platform } });
    return;
  }

  const job: ResearchJob = {
    id: generateJobId(),
    platform,
    niches: [niche],
    status: 'running',
    startedAt: new Date().toISOString(),
    progress: { currentNiche: niche, nichesCompleted: 0, totalNiches: 1 },
  };
  jobs.set(job.id, job);
  currentJob = job;

  // Return immediately with job ID
  res.json({ jobId: job.id, status: 'running', platform, niche });

  // Run async
  try {
    const researcher = createResearcher(platform, config || {});
    const result = await (researcher as any).researchNiche(niche);
    const filepath = await (researcher as any).saveResults([result], 'niche');

    job.status = 'completed';
    job.completedAt = new Date().toISOString();
    job.durationMs = Date.now() - new Date(job.startedAt).getTime();
    job.resultFile = filepath;
    job.progress = { currentNiche: niche, nichesCompleted: 1, totalNiches: 1 };
  } catch (e) {
    job.status = 'failed';
    job.error = String(e);
    job.completedAt = new Date().toISOString();
  }
  currentJob = null;
});

// ─── Multi-niche research (async, returns job ID) ────────────────

app.post('/api/research/:platform/full', async (req: Request, res: Response) => {
  const platform = req.params.platform as Platform;
  if (!PLATFORMS.includes(platform)) {
    res.status(400).json({ error: `Invalid platform. Must be one of: ${PLATFORMS.join(', ')}` });
    return;
  }

  const { niches, config } = req.body;
  if (!niches || !Array.isArray(niches) || niches.length === 0) {
    res.status(400).json({ error: 'niches array is required (e.g. ["AI automation", "content marketing"])' });
    return;
  }

  if (currentJob && currentJob.status === 'running') {
    res.status(409).json({ error: 'A research job is already running', currentJob: { id: currentJob.id, platform: currentJob.platform } });
    return;
  }

  const job: ResearchJob = {
    id: generateJobId(),
    platform,
    niches,
    status: 'running',
    startedAt: new Date().toISOString(),
    progress: { currentNiche: niches[0], nichesCompleted: 0, totalNiches: niches.length },
  };
  jobs.set(job.id, job);
  currentJob = job;

  res.json({ jobId: job.id, status: 'running', platform, niches, estimatedMinutes: niches.length * 5 });

  // Run async
  try {
    const researcher = createResearcher(platform, config || {});
    const { results, summary } = await (researcher as any).runFullResearch(niches);

    job.status = 'completed';
    job.completedAt = new Date().toISOString();
    job.durationMs = summary.totalDurationMs;
    job.progress = { currentNiche: niches[niches.length - 1], nichesCompleted: niches.length, totalNiches: niches.length };

    // Find the latest saved file
    const files = listResultFiles(platform);
    if (files.length > 0) job.resultFile = path.join(DEFAULT_OUTPUT_DIR, files[0].filename);
  } catch (e) {
    job.status = 'failed';
    job.error = String(e);
    job.completedAt = new Date().toISOString();
  }
  currentJob = null;
});

// ─── Cross-platform research (all 5 platforms) ───────────────────

app.post('/api/research/all/full', async (req: Request, res: Response) => {
  const { niches, config, platforms: requestedPlatforms } = req.body;
  if (!niches || !Array.isArray(niches) || niches.length === 0) {
    res.status(400).json({ error: 'niches array is required' });
    return;
  }

  if (currentJob && currentJob.status === 'running') {
    res.status(409).json({ error: 'A research job is already running', currentJob: { id: currentJob.id, platform: currentJob.platform } });
    return;
  }

  const activePlatforms: Platform[] = requestedPlatforms
    ? (requestedPlatforms as string[]).filter((p): p is Platform => PLATFORMS.includes(p as Platform))
    : [...PLATFORMS];

  const job: ResearchJob = {
    id: generateJobId(),
    platform: 'all',
    niches,
    status: 'running',
    startedAt: new Date().toISOString(),
    progress: { currentNiche: '', nichesCompleted: 0, totalNiches: activePlatforms.length * niches.length },
  };
  jobs.set(job.id, job);
  currentJob = job;

  res.json({
    jobId: job.id,
    status: 'running',
    platforms: activePlatforms,
    niches,
    estimatedMinutes: activePlatforms.length * niches.length * 5,
  });

  // Run async: one platform at a time (they share Safari)
  const allResults: Record<string, any> = {};
  try {
    for (let pi = 0; pi < activePlatforms.length; pi++) {
      const platform = activePlatforms[pi];
      job.progress = {
        currentNiche: `${platform} (${pi + 1}/${activePlatforms.length})`,
        nichesCompleted: pi * niches.length,
        totalNiches: activePlatforms.length * niches.length,
      };

      try {
        const researcher = createResearcher(platform, config || {});
        const { results } = await (researcher as any).runFullResearch(niches);
        allResults[platform] = results;
      } catch (e) {
        console.error(`[Research] ${platform} failed:`, e);
        allResults[platform] = { error: String(e) };
      }
    }

    // Save combined results
    const combinedDir = path.join(DEFAULT_OUTPUT_DIR, 'combined');
    if (!fs.existsSync(combinedDir)) fs.mkdirSync(combinedDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filepath = path.join(combinedDir, `all-platforms-${timestamp}.json`);
    fs.writeFileSync(filepath, JSON.stringify({
      metadata: { generatedAt: new Date().toISOString(), platforms: activePlatforms, niches },
      results: allResults,
    }, null, 2));

    job.status = 'completed';
    job.completedAt = new Date().toISOString();
    job.durationMs = Date.now() - new Date(job.startedAt).getTime();
    job.resultFile = filepath;
    job.progress = { currentNiche: 'done', nichesCompleted: activePlatforms.length * niches.length, totalNiches: activePlatforms.length * niches.length };
  } catch (e) {
    job.status = 'failed';
    job.error = String(e);
    job.completedAt = new Date().toISOString();
  }
  currentJob = null;
});

// ─── Job status ──────────────────────────────────────────────────

app.get('/api/research/status', (_req: Request, res: Response) => {
  const allJobs = Array.from(jobs.values())
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, 20);

  res.json({
    currentJob: currentJob || null,
    recentJobs: allJobs,
  });
});

app.get('/api/research/status/:jobId', (req: Request, res: Response) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }
  res.json(job);
});

// ─── Results ─────────────────────────────────────────────────────

app.get('/api/research/results', (req: Request, res: Response) => {
  const platform = req.query.platform as string | undefined;
  const files = listResultFiles(platform);
  res.json({ files, count: files.length });
});

app.get('/api/research/results/latest/:platform', (req: Request, res: Response) => {
  const platform = req.params.platform;
  const files = listResultFiles(platform === 'all' ? undefined : platform);
  if (files.length === 0) {
    res.status(404).json({ error: `No results found for ${platform}` });
    return;
  }

  const filepath = path.join(DEFAULT_OUTPUT_DIR, files[0].filename);
  try {
    const content = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
    res.json({ file: files[0], data: content });
  } catch (e) {
    res.status(500).json({ error: `Failed to read file: ${e}` });
  }
});

app.get('/api/research/results/file/*', (req: Request, res: Response) => {
  // Extract everything after /file/
  const relativePath = req.params[0] || '';
  if (!relativePath || relativePath.includes('..')) {
    res.status(400).json({ error: 'Invalid path' });
    return;
  }

  const filepath = path.join(DEFAULT_OUTPUT_DIR, relativePath);
  if (!fs.existsSync(filepath)) {
    res.status(404).json({ error: 'File not found' });
    return;
  }

  try {
    const content = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
    const stat = fs.statSync(filepath);
    res.json({ filename: relativePath, size: stat.size, modified: stat.mtime.toISOString(), data: content });
  } catch (e) {
    res.status(500).json({ error: `Failed to read: ${e}` });
  }
});

// ─── Download raw JSON file ──────────────────────────────────────

app.get('/api/research/download/*', (req: Request, res: Response) => {
  const relativePath = req.params[0] || '';
  if (!relativePath || relativePath.includes('..')) {
    res.status(400).json({ error: 'Invalid path' });
    return;
  }

  const filepath = path.join(DEFAULT_OUTPUT_DIR, relativePath);
  if (!fs.existsSync(filepath)) {
    res.status(404).json({ error: 'File not found' });
    return;
  }

  res.download(filepath);
});

// ─── Start Server ────────────────────────────────────────────────

export function startServer(port: number = PORT): void {
  app.listen(port, () => {
    console.log(`\n🔬 Market Research API running on http://localhost:${port}`);
    console.log(`   Health:         GET  /health`);
    console.log(`   Platforms:      GET  /api/research/platforms`);
    console.log(`   Search:         POST /api/research/:platform/search       {query}`);
    console.log(`   Niche:          POST /api/research/:platform/niche        {niche, config?}`);
    console.log(`   Full research:  POST /api/research/:platform/full         {niches[], config?}`);
    console.log(`   All platforms:  POST /api/research/all/full               {niches[], platforms?, config?}`);
    console.log(`   Job status:     GET  /api/research/status`);
    console.log(`   Job detail:     GET  /api/research/status/:jobId`);
    console.log(`   List results:   GET  /api/research/results?platform=`);
    console.log(`   Latest result:  GET  /api/research/results/latest/:platform`);
    console.log(`   Read file:      GET  /api/research/results/file/:path`);
    console.log(`   Download:       GET  /api/research/download/:path`);
    console.log(`\n   Platforms: ${PLATFORMS.join(', ')}`);
    console.log(`   Output dir: ${DEFAULT_OUTPUT_DIR}\n`);
  });
}

if (process.argv[1]?.includes('server')) startServer();

export { app };
