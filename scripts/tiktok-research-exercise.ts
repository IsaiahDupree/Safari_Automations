/**
 * TikTok Market Research Exercise
 *
 * Two-phase workflow:
 *   Phase 1 — Shallow search (port 3106, deepScrape: false)
 *     → navigates Safari to tiktok.com/search/video?q=...
 *     → extracts video cards: URL, author, description, view count
 *
 *   Phase 2 — Per-video deep dive (port 3006) for each URL:
 *     POST /api/tiktok/navigate       → open video page in Safari
 *     GET  /api/tiktok/video-metrics  → likes, comments, shares, views
 *     GET  /api/tiktok/comments       → top N comment texts
 *
 * Run:
 *   npx tsx scripts/tiktok-research-exercise.ts "solopreneur"
 *   npx tsx scripts/tiktok-research-exercise.ts "AI tools" --max 3
 *   npx tsx scripts/tiktok-research-exercise.ts "content creator" --no-comments
 *   npx tsx scripts/tiktok-research-exercise.ts "fitness" --max 5 --comments 15
 */

const RESEARCH_BASE = 'http://localhost:3106';
const COMMENTS_BASE = 'http://localhost:3006';

// ─── CLI ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const keyword       = args.find(a => !a.startsWith('--')) ?? 'solopreneur';
const maxVideosArg  = args.find(a => a.startsWith('--max='))?.split('=')[1];
const maxVideosNext = args.includes('--max') ? args[args.indexOf('--max') + 1] : undefined;
const maxVideos     = parseInt(maxVideosArg ?? maxVideosNext ?? '5');
const skipComments  = args.includes('--no-comments');
const commentsLimitArg = args.find(a => a.startsWith('--comments='))?.split('=')[1];
const commentsLimit = parseInt(commentsLimitArg ?? '10');
// extra wait ms between video navigations (increase if TikTok is slow)
const navWaitMs     = parseInt(args.find(a => a.startsWith('--wait='))?.split('=')[1] ?? '5000');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function bar(score: number, max: number, width = 20): string {
  const filled = Math.round((score / (max || 1)) * width);
  return '█'.repeat(Math.max(0, filled)) + '░'.repeat(Math.max(0, width - filled));
}

function wait(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function apiPost(base: string, path: string, body: any): Promise<any> {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function apiGet(base: string, path: string): Promise<any> {
  const res = await fetch(`${base}${path}`);
  return res.json();
}

// ─── Phase 0: Health + Login check ───────────────────────────────────────────

async function checkServices() {
  console.log(`\n${'═'.repeat(64)}`);
  console.log(`  TikTok Market Research Exercise`);
  console.log(`  Keyword : "${keyword}"   Max videos: ${maxVideos}`);
  console.log(`  Comments: ${skipComments ? 'SKIP (--no-comments)' : `top ${commentsLimit}`}   Nav wait: ${navWaitMs}ms`);
  console.log('═'.repeat(64));

  console.log('\n[0] Checking services...');
  const [mh, ch] = await Promise.all([
    apiGet(RESEARCH_BASE, '/health').catch(() => null),
    apiGet(COMMENTS_BASE, '/health').catch(() => null),
  ]);

  if (!mh?.status) {
    console.error('  ✗  market-research (3106) not running');
    console.error('     Start: PORT=3106 npx tsx packages/market-research/src/api/server.ts &');
    process.exit(1);
  }
  if (!ch?.status) {
    console.error('  ✗  tiktok-comments (3006) not running');
    console.error('     Start: PORT=3006 npx tsx packages/tiktok-comments/src/api/server.ts &');
    process.exit(1);
  }
  console.log('  ✓  market-research:3106   ✓  tiktok-comments:3006');

  // Check TikTok login status
  const status = await apiGet(COMMENTS_BASE, '/api/tiktok/status').catch(() => null);
  if (status) {
    const loginStr = status.isLoggedIn ? '✓ logged in' : '⚠ NOT logged in';
    const ttStr    = status.isOnTikTok  ? '✓ on TikTok'  : '⊘ not on TikTok';
    console.log(`  TikTok: ${loginStr}   ${ttStr}   ${(status.currentUrl ?? '').substring(0, 60)}`);
    if (!status.isLoggedIn) {
      console.log('  ⚠  Warning: not logged in — some videos may not show metrics');
    }
  }
}

// ─── Phase 1: Shallow search → video URLs (via tiktok-comments driver) ───────

async function shallowSearch(): Promise<any[]> {
  console.log(`\n[1] Shallow search for "${keyword}"...`);
  console.log(`  ⏳  Navigating Safari to tiktok.com/search/video — ~${Math.round(navWaitMs / 1000 + 4)}s\n`);

  // Use /api/tiktok/search-cards (port 3006) which uses the driver's executeJS
  // (avoids TikTokResearcher double-quote escaping bug with CSS attribute selectors)
  const result = await apiPost(COMMENTS_BASE, '/api/tiktok/search-cards', {
    query: keyword,
    maxCards: maxVideos,
    waitMs: navWaitMs,
  });

  if (!result?.success || !Array.isArray(result.videos)) {
    console.error('  ✗  Search failed:', JSON.stringify(result).substring(0, 200));
    process.exit(1);
  }

  const videos: any[] = result.videos.slice(0, maxVideos);
  if (videos.length === 0) {
    console.log('  ⚠  0 videos found. Possible causes:');
    console.log('     - Safari not open or TikTok search cards did not render');
    console.log('     - Try increasing --wait (default 5000ms): e.g. --wait=10000');
    console.log('     - TikTok may require login for this search');
    process.exit(1);
  }

  // Parse abbreviated view counts from search cards
  function parseViews(raw: string): number {
    if (!raw) return 0;
    const t = raw.trim().replace(/,/g, '');
    const m = t.match(/^([\d.]+)\s*([KkMmBb]?)$/);
    if (!m) return 0;
    let v = parseFloat(m[1]) || 0;
    const s = m[2].toUpperCase();
    if (s === 'K') v *= 1e3;
    else if (s === 'M') v *= 1e6;
    else if (s === 'B') v *= 1e9;
    return Math.round(v);
  }

  console.log(`  ✓  ${videos.length} video URLs collected from search page\n`);
  for (let i = 0; i < videos.length; i++) {
    const v = videos[i];
    v.views = parseViews(v.viewsRaw ?? '0');
    console.log(`  [${i + 1}] @${v.author ?? 'unknown'}`);
    console.log(`       ${v.url}`);
    console.log(`       Views: ${fmt(v.views)}   "${(v.description ?? '').substring(0, 60)}"`);
  }
  return videos;
}

// ─── Phase 2: Navigate to each video → metrics + comments ────────────────────

interface VideoResult {
  url: string;
  author: string;
  description: string;
  searchViews: number;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  engagementScore: number;
  topComments: Array<{ username: string; text: string }>;
}

async function deepDiveVideos(videos: any[]): Promise<VideoResult[]> {
  console.log(`\n[2] Deep-diving ${videos.length} videos (navigate → metrics → comments)...`);
  console.log(`  ⏳  ~${Math.round(navWaitMs / 1000 + 8)}s per video\n`);

  const results: VideoResult[] = [];

  for (let i = 0; i < videos.length; i++) {
    const v = videos[i];
    console.log(`  ─── Video ${i + 1}/${videos.length}: @${v.author ?? 'unknown'} ───`);
    console.log(`  URL: ${v.url}`);

    // Navigate
    process.stdout.write('  Navigate...');
    const nav = await apiPost(COMMENTS_BASE, '/api/tiktok/navigate', { url: v.url }).catch(e => ({ success: false, error: String(e) }));
    if (!nav.success) {
      console.log(` ✗ failed: ${nav.error ?? JSON.stringify(nav)}`);
      results.push({ url: v.url, author: v.author ?? '', description: v.description ?? '', searchViews: v.views ?? 0, views: 0, likes: 0, comments: 0, shares: 0, engagementScore: 0, topComments: [] });
      continue;
    }
    console.log(' ✓  Waiting for page to load...');
    await wait(navWaitMs);   // let TikTok video page fully render

    // Engagement metrics
    process.stdout.write('  Metrics...');
    const metrics = await apiGet(COMMENTS_BASE, '/api/tiktok/video-metrics').catch(e => ({ success: false, error: String(e) }));
    let views = 0, likes = 0, cmts = 0, shares = 0;
    if (metrics?.success !== false) {
      views  = metrics.views  ?? 0;
      likes  = metrics.likes  ?? 0;
      cmts   = metrics.comments ?? 0;
      shares = metrics.shares ?? 0;
      console.log(` ✓  views=${fmt(views)} likes=${fmt(likes)} comments=${fmt(cmts)} shares=${fmt(shares)}`);
    } else {
      console.log(` ⚠  ${metrics.error ?? 'failed'}`);
    }

    // Comments
    let topComments: Array<{ username: string; text: string }> = [];
    if (!skipComments) {
      process.stdout.write(`  Comments (top ${commentsLimit})...`);
      await wait(2000);  // let comments load
      const commentData = await apiGet(COMMENTS_BASE, `/api/tiktok/comments?limit=${commentsLimit}`).catch(e => ({ error: String(e) }));
      if (!commentData.error) {
        topComments = commentData.comments ?? [];
        console.log(` ✓  ${topComments.length} loaded`);
      } else {
        console.log(` ⚠  ${commentData.error}`);
      }
    }

    const engagementScore = likes + cmts * 2 + shares * 3;
    results.push({
      url: v.url,
      author: v.author ?? '',
      description: v.description ?? '',
      searchViews: v.views ?? 0,
      views, likes, comments: cmts, shares, engagementScore, topComments,
    });

    console.log('');
  }
  return results;
}

// ─── Phase 3: Display report ──────────────────────────────────────────────────

function displayReport(results: VideoResult[]) {
  const maxScore = Math.max(...results.map(r => r.engagementScore), 1);

  console.log(`\n${'═'.repeat(64)}`);
  console.log('  RESULTS — POST LINKS + ENGAGEMENT METRICS');
  console.log('═'.repeat(64));

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    console.log(`\n  [${i + 1}] @${r.author}`);
    console.log(`      URL     : ${r.url}`);
    console.log(`      Caption : ${r.description.substring(0, 80)}${r.description.length > 80 ? '…' : ''}`);
    console.log(`      Views   : ${fmt(r.views)} (search card: ${fmt(r.searchViews)})`);
    console.log(`      Likes   : ${fmt(r.likes)}`);
    console.log(`      Comments: ${fmt(r.comments)}`);
    console.log(`      Shares  : ${fmt(r.shares)}`);
    console.log(`      Score   : ${fmt(r.engagementScore).padStart(7)}   ${bar(r.engagementScore, maxScore)}`);

    if (!skipComments && r.topComments.length > 0) {
      console.log(`      Top comments:`);
      for (const c of r.topComments) {
        const user = (c.username ?? '').substring(0, 18).padEnd(18);
        const text = (c.text ?? '').replace(/\n/g, ' ').substring(0, 70);
        console.log(`        @${user} "${text}"`);
      }
    } else if (!skipComments) {
      console.log('      Top comments: (none loaded)');
    }
  }

  // Top creators ranking
  const byAuthor = new Map<string, { total: number; count: number }>();
  for (const r of results) {
    const e = byAuthor.get(r.author);
    if (!e) byAuthor.set(r.author, { total: r.engagementScore, count: 1 });
    else { e.total += r.engagementScore; e.count++; }
  }
  const ranked = [...byAuthor.entries()]
    .map(([h, d]) => ({ handle: h, ...d }))
    .sort((a, b) => b.total - a.total);

  console.log(`\n${'─'.repeat(64)}`);
  console.log('  TOP CREATORS (ranked by total engagement score)');
  console.log('─'.repeat(64));
  const cMax = ranked[0]?.total ?? 1;
  for (const c of ranked) {
    const avg = c.count > 0 ? Math.round(c.total / c.count) : 0;
    console.log(`  @${c.handle.padEnd(26)} ${fmt(c.total).padStart(7)} pts  avg ${fmt(avg).padStart(6)}  ${bar(c.total, cMax, 14)}`);
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  await checkServices();
  const videos  = await shallowSearch();
  const results = await deepDiveVideos(videos);
  displayReport(results);

  console.log(`\n${'═'.repeat(64)}`);
  console.log(`  Done. ${results.length} videos analysed for "${keyword}"`);
  console.log('═'.repeat(64) + '\n');
}

main().catch(err => {
  console.error('\n❌ Uncaught error:', err);
  process.exit(1);
});
