#!/usr/bin/env npx tsx
/**
 * Daily Content Pipeline
 * ======================
 * Automated daily content mix → YouTube Shorts via Blotato
 *
 * Pipeline:
 * 1. Scan all cleaned Sora videos + config metadata
 * 2. Build content catalog with titles, captions, hashtags
 * 3. Select daily mix (3-5 videos, varied niches)
 * 4. Queue to MediaPoster Backend for Blotato publishing
 *
 * Usage:
 *   npx tsx scripts/daily-content-pipeline.ts                  # Run daily mix
 *   npx tsx scripts/daily-content-pipeline.ts --dry-run        # Preview without queuing
 *   npx tsx scripts/daily-content-pipeline.ts --count 5        # Override daily count
 *   npx tsx scripts/daily-content-pipeline.ts --platform youtube  # YouTube only
 *   npx tsx scripts/daily-content-pipeline.ts --catalog        # Just rebuild catalog
 *   npx tsx scripts/daily-content-pipeline.ts --status         # Show queue status
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────────

const BACKEND_URL = 'http://localhost:5555';
const SORA_VIDEOS_DIR = path.join(process.env.HOME || '', 'sora-videos');
const CLEANED_DIR = path.join(SORA_VIDEOS_DIR, 'cleaned');
const CONFIG_DIR = path.join(__dirname, '..');
const CATALOG_FILE = path.join(SORA_VIDEOS_DIR, 'daily-pipeline-catalog.json');
const PUBLISH_LOG = path.join(SORA_VIDEOS_DIR, 'daily-publish-log.json');

// Blotato YouTube accounts
const YOUTUBE_ACCOUNTS = [
  { id: '228', username: 'Isaiah Dupree', platform: 'youtube' },
  { id: '3370', username: 'lofi creator', platform: 'youtube' },
];

// TikTok accounts for cross-posting
const TIKTOK_ACCOUNTS = [
  { id: '710', username: 'isaiah_dupree', platform: 'tiktok' },
  { id: '243', username: 'the_isaiah_dupree', platform: 'tiktok' },
];

// Instagram accounts for cross-posting
const INSTAGRAM_ACCOUNTS = [
  { id: '807', username: 'the_isaiah_dupree', platform: 'instagram' },
];

const DEFAULT_DAILY_COUNT = 4;
const DEFAULT_PLATFORMS = ['youtube'];

// Config files that define our video metadata
const CONFIG_FILES = [
  { file: 'sora-february-2026-trends.json', cleanedDir: 'february-2026-trends', batch: 'february-trends' },
  { file: 'sora-db-generated-batch-1.json', cleanedDir: 'db-generated-batch-1', batch: 'db-batch-1' },
  { file: 'sora-db-generated-batch-2.json', cleanedDir: 'db-generated-batch-2', batch: 'db-batch-2' },
  { file: 'sora-trending-batch-3.json', cleanedDir: 'trending-batch-3', batch: 'trending-batch-3' },
  { file: 'sora-content-gen-batch-1.json', cleanedDir: 'gen-1771383730615', batch: 'content-gen-1' },
  { file: 'sora-content-gen-batch-2.json', cleanedDir: 'gen-1771467008245', batch: 'content-gen-2' },
  { file: 'sora-content-gen-batch-3.json', cleanedDir: 'gen-1771550847242', batch: 'content-gen-3' },
  { file: 'sora-content-gen-batch-4.json', cleanedDir: 'gen-1771552851698', batch: 'content-gen-4' },
];

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface VideoEntry {
  id: string;
  title: string;
  movieTitle: string;
  caption: string;
  hashtags: string[];
  niche: string;
  trend: string;
  format: string; // single | trilogy
  part: number;
  totalParts: number;
  stage: string;
  prompt: string;
  batch: string;
  cleanedPath: string;
  rawPath: string;
  exists: boolean;
  isWatermarkFree: boolean;
  publishedCount: number;
  lastPublished: string | null;
  youtubeTitle: string;
  youtubeDescription: string;
}

interface PublishLogEntry {
  videoId: string;
  platform: string;
  accountId: string;
  publishedAt: string;
  queueItemId: string;
}

interface DailyCatalog {
  generatedAt: string;
  totalVideos: number;
  totalAvailable: number;
  batches: Record<string, number>;
  videos: VideoEntry[];
}

// ─────────────────────────────────────────────────────────────────────────────
// CATALOG BUILDER
// ─────────────────────────────────────────────────────────────────────────────

function buildCatalog(): DailyCatalog {
  console.log('\n📋 Building content catalog...');
  const videos: VideoEntry[] = [];
  const batchCounts: Record<string, number> = {};

  for (const cfg of CONFIG_FILES) {
    const configPath = path.join(CONFIG_DIR, cfg.file);
    if (!fs.existsSync(configPath)) {
      console.log(`  ⚠️  Config not found: ${cfg.file}`);
      continue;
    }

    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    const movies = config.movies || [];
    let batchCount = 0;

    for (const movie of movies) {
      const movieVideos = movie.videos || [];
      const slug = (movie.title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

      for (const video of movieVideos) {
        const partSlug = movieVideos.length === 1
          ? slug
          : `part-${video.part}-${(video.title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;

        // Try to find cleaned video
        let cleanedPath = '';
        const cleanedBase = path.join(CLEANED_DIR, cfg.cleanedDir);

        // Check subfolder pattern (for per-subfolder cleaning)
        const subfolderPath = path.join(cleanedBase, slug, `cleaned_${partSlug}.mp4`);
        const flatPath = path.join(cleanedBase, `cleaned_${partSlug}.mp4`);
        const directPath = path.join(cleanedBase, slug, `${partSlug}.mp4`);

        if (fs.existsSync(subfolderPath)) {
          cleanedPath = subfolderPath;
        } else if (fs.existsSync(flatPath)) {
          cleanedPath = flatPath;
        } else if (fs.existsSync(directPath)) {
          cleanedPath = directPath;
        } else {
          // Try glob-like search in the directory
          const searchDir = path.join(cleanedBase, slug);
          if (fs.existsSync(searchDir)) {
            const files = fs.readdirSync(searchDir).filter(f => f.endsWith('.mp4'));
            if (files.length > 0 && video.part <= files.length) {
              cleanedPath = path.join(searchDir, files[video.part - 1]);
            }
          }
        }

        // Also check raw video path
        const rawBase = path.join(SORA_VIDEOS_DIR, cfg.cleanedDir);
        let rawPath = '';
        const rawSubfolder = path.join(rawBase, slug, `${partSlug}.mp4`);
        if (fs.existsSync(rawSubfolder)) {
          rawPath = rawSubfolder;
        } else {
          const rawSearchDir = path.join(rawBase, slug);
          if (fs.existsSync(rawSearchDir)) {
            const files = fs.readdirSync(rawSearchDir).filter(f => f.endsWith('.mp4'));
            if (files.length > 0 && video.part <= files.length) {
              rawPath = path.join(rawSearchDir, files[video.part - 1]);
            }
          }
        }

        const videoPath = cleanedPath || rawPath;
        const isWatermarkFree = !!cleanedPath && cleanedPath.includes('/cleaned');
        const videoId = `${cfg.batch}:${movie.id}:${video.part}`;

        // Generate YouTube-optimized metadata
        const youtubeTitle = generateYouTubeTitle(movie, video);
        const youtubeDescription = generateYouTubeDescription(movie, video, config);
        const hashtags = extractHashtags(movie, config);

        videos.push({
          id: videoId,
          title: video.title || movie.title,
          movieTitle: movie.title,
          caption: movie.captionIdea || movie.caption || '',
          hashtags,
          niche: movie.niche || movie.theme || config.theme || '',
          trend: movie.trend || '',
          format: movie.format || (movieVideos.length > 1 ? 'trilogy' : 'single'),
          part: video.part,
          totalParts: movieVideos.length,
          stage: video.stage || '',
          prompt: video.prompt || '',
          batch: cfg.batch,
          cleanedPath: cleanedPath,
          rawPath: rawPath,
          exists: !!videoPath && fs.existsSync(videoPath),
          isWatermarkFree,
          publishedCount: 0,
          lastPublished: null,
          youtubeTitle,
          youtubeDescription,
        });

        if (videoPath && fs.existsSync(videoPath)) batchCount++;
      }
    }

    batchCounts[cfg.batch] = batchCount;
    console.log(`  ✅ ${cfg.file}: ${batchCount} available videos`);
  }

  // Merge with publish log to track what's been published
  const publishLog = loadPublishLog();
  for (const video of videos) {
    const published = publishLog.filter(p => p.videoId === video.id);
    video.publishedCount = published.length;
    video.lastPublished = published.length > 0
      ? published.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))[0].publishedAt
      : null;
  }

  const catalog: DailyCatalog = {
    generatedAt: new Date().toISOString(),
    totalVideos: videos.length,
    totalAvailable: videos.filter(v => v.exists).length,
    batches: batchCounts,
    videos,
  };

  fs.writeFileSync(CATALOG_FILE, JSON.stringify(catalog, null, 2));
  console.log(`  📊 Total: ${catalog.totalVideos} entries, ${catalog.totalAvailable} available`);

  return catalog;
}

function generateYouTubeTitle(movie: any, video: any): string {
  const base = movie.title || video.title || 'Untitled';
  const cleaned = base.replace(/[^a-zA-Z0-9\s\-!?']/g, '').trim();

  // YouTube Shorts titles should be punchy, under 100 chars
  if (movie.format === 'single' || (movie.videos || []).length === 1) {
    return `${cleaned} #shorts`;
  }
  return `${cleaned} — Part ${video.part} #shorts`;
}

function generateYouTubeDescription(movie: any, video: any, config: any): string {
  const parts: string[] = [];

  if (movie.captionIdea || movie.caption) {
    parts.push(movie.captionIdea || movie.caption);
  }

  parts.push('');
  parts.push(`🎬 Created with AI by @isaiahdupree`);

  if (movie.trend) {
    parts.push(`📈 Trend: ${movie.trend}`);
  }
  if (movie.niche) {
    parts.push(`🏷️ Niche: ${movie.niche}`);
  }

  parts.push('');
  parts.push('Follow for more AI-generated content!');
  parts.push('');

  const hashtags = extractHashtags(movie, config);
  if (hashtags.length > 0) {
    parts.push(hashtags.map(h => h.startsWith('#') ? h : `#${h}`).join(' '));
  }

  return parts.join('\n');
}

function extractHashtags(movie: any, config: any): string[] {
  const tags = new Set<string>();

  // From caption
  const caption = movie.captionIdea || movie.caption || '';
  const captionTags = caption.match(/#\w+/g) || [];
  captionTags.forEach((t: string) => tags.add(t.replace('#', '')));

  // Standard tags
  tags.add('shorts');
  tags.add('isaiahdupree');
  tags.add('AIGenerated');
  tags.add('SoraAI');

  // Niche-based tags
  const niche = (movie.niche || '').toLowerCase();
  if (niche.includes('tech') || niche.includes('ai')) {
    tags.add('TechTok');
    tags.add('AI');
  }
  if (niche.includes('fitness') || niche.includes('wellness')) {
    tags.add('FitTok');
    tags.add('Fitness');
  }
  if (niche.includes('finance') || niche.includes('hustle')) {
    tags.add('FinTok');
    tags.add('SideHustle');
  }
  if (niche.includes('comedy') || niche.includes('relatable')) {
    tags.add('Comedy');
    tags.add('Relatable');
  }
  if (niche.includes('lifestyle')) {
    tags.add('Lifestyle');
  }

  return Array.from(tags).slice(0, 15);
}

// ─────────────────────────────────────────────────────────────────────────────
// DAILY MIX SELECTOR
// ─────────────────────────────────────────────────────────────────────────────

function selectDailyMix(catalog: DailyCatalog, count: number): VideoEntry[] {
  console.log(`\n🎲 Selecting ${count} videos for daily mix...`);

  // Filter to available videos that are watermark-free (cleaned) only
  const available = catalog.videos.filter(v => v.exists && v.isWatermarkFree);
  if (available.length === 0) {
    console.log('  ❌ No available videos found');
    return [];
  }

  // Sort by: least published first, then variety by niche/batch
  const sorted = [...available].sort((a, b) => {
    // Prioritize unpublished
    if (a.publishedCount !== b.publishedCount) return a.publishedCount - b.publishedCount;
    // Then by singles over trilogy parts (standalone content)
    if (a.format !== b.format) return a.format === 'single' ? -1 : 1;
    // Then randomize
    return Math.random() - 0.5;
  });

  // Select with niche diversity
  const selected: VideoEntry[] = [];
  const usedNiches = new Set<string>();
  const usedBatches = new Set<string>();

  // First pass: one per niche
  for (const video of sorted) {
    if (selected.length >= count) break;
    const niche = video.niche || 'unknown';
    if (!usedNiches.has(niche)) {
      selected.push(video);
      usedNiches.add(niche);
      usedBatches.add(video.batch);
    }
  }

  // Second pass: fill remaining from different batches
  for (const video of sorted) {
    if (selected.length >= count) break;
    if (selected.includes(video)) continue;
    if (!usedBatches.has(video.batch)) {
      selected.push(video);
      usedBatches.add(video.batch);
    }
  }

  // Third pass: fill any remaining
  for (const video of sorted) {
    if (selected.length >= count) break;
    if (!selected.includes(video)) {
      selected.push(video);
    }
  }

  console.log(`  ✅ Selected ${selected.length} videos:`);
  for (const v of selected) {
    console.log(`     • [${v.batch}] ${v.movieTitle} ${v.totalParts > 1 ? `(Part ${v.part}/${v.totalParts})` : ''} — ${v.niche}`);
  }

  return selected;
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLISH LOG
// ─────────────────────────────────────────────────────────────────────────────

function loadPublishLog(): PublishLogEntry[] {
  if (!fs.existsSync(PUBLISH_LOG)) return [];
  try {
    return JSON.parse(fs.readFileSync(PUBLISH_LOG, 'utf-8'));
  } catch {
    return [];
  }
}

function savePublishLog(log: PublishLogEntry[]): void {
  fs.writeFileSync(PUBLISH_LOG, JSON.stringify(log, null, 2));
}

function addToPublishLog(entry: PublishLogEntry): void {
  const log = loadPublishLog();
  log.push(entry);
  savePublishLog(log);
}

// ─────────────────────────────────────────────────────────────────────────────
// BACKEND API CALLS
// ─────────────────────────────────────────────────────────────────────────────

async function callBackend(endpoint: string, method: string = 'GET', body?: any): Promise<any> {
  const url = `${BACKEND_URL}${endpoint}`;
  const options: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) {
    options.body = JSON.stringify(body);
  }

  try {
    const response = await fetch(url, options);
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`${response.status}: ${text}`);
    }
    return await response.json();
  } catch (error: any) {
    if (error.message?.includes('ECONNREFUSED')) {
      throw new Error(`Backend not running at ${BACKEND_URL}. Start it with: cd MediaPoster/Backend && python main.py`);
    }
    throw error;
  }
}

async function checkBackendHealth(): Promise<boolean> {
  try {
    await callBackend('/health');
    return true;
  } catch {
    return false;
  }
}

async function getPublishingStatus(): Promise<any> {
  return callBackend('/api/publish-controls/status');
}

async function canPublish(platform: string): Promise<boolean> {
  try {
    const result = await callBackend(`/api/publish-controls/can-publish/${platform}`);
    return result.can_publish === true;
  } catch {
    return true; // Default to yes if endpoint unavailable
  }
}

async function queueVideoForPublishing(
  videoPath: string,
  caption: string,
  title: string,
  platform: string,
  accountId: string,
  accountUsername: string,
  hashtags: string[],
): Promise<any> {
  return callBackend('/api/publish-controls/queue', 'POST', {
    video_url: videoPath,
    caption,
    title,
    platform,
    account_id: accountId,
    account_username: accountUsername,
    hashtags,
    priority: 3,
    metadata: {
      source: 'daily-content-pipeline',
      generated_at: new Date().toISOString(),
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PIPELINE
// ─────────────────────────────────────────────────────────────────────────────

async function runDailyPipeline(options: {
  dryRun: boolean;
  count: number;
  platforms: string[];
  catalogOnly: boolean;
  statusOnly: boolean;
}): Promise<void> {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║   📺 DAILY CONTENT PIPELINE — @isaiahdupree                ║');
  console.log('║   Sora Videos → YouTube Shorts via Blotato                 ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`\n📅 Date: ${new Date().toISOString().split('T')[0]}`);
  console.log(`🎯 Platforms: ${options.platforms.join(', ')}`);
  console.log(`📊 Target: ${options.count} videos`);
  if (options.dryRun) console.log('🧪 DRY RUN MODE — no actual publishing');

  // Status check
  if (options.statusOnly) {
    await showStatus();
    return;
  }

  // Step 1: Build catalog
  const catalog = buildCatalog();

  if (options.catalogOnly) {
    console.log(`\n✅ Catalog saved to ${CATALOG_FILE}`);
    return;
  }

  // Step 2: Check backend
  const backendAlive = await checkBackendHealth();
  if (!backendAlive && !options.dryRun) {
    console.log('\n⚠️  Backend not running. Start with: cd MediaPoster/Backend && python main.py');
    console.log('   Proceeding with catalog build only...');
    return;
  }

  // Step 3: Select daily mix
  const dailyMix = selectDailyMix(catalog, options.count);
  if (dailyMix.length === 0) {
    console.log('\n❌ No videos available for publishing');
    return;
  }

  // Step 4: Queue for each platform
  let queued = 0;
  let failed = 0;

  for (const video of dailyMix) {
    for (const platform of options.platforms) {
      const accounts = getAccountsForPlatform(platform);
      if (accounts.length === 0) {
        console.log(`\n⚠️  No accounts for ${platform}`);
        continue;
      }

      // Use primary account
      const account = accounts[0];
      const videoPath = video.cleanedPath;

      // STRICT WATERMARK GUARD: Never publish raw Sora videos
      if (!videoPath || !videoPath.includes('/cleaned')) {
        console.log(`\n🚫 BLOCKED: "${video.youtubeTitle}" — no cleaned version (has Sora watermark)`);
        failed++;
        continue;
      }

      console.log(`\n📤 Queuing: "${video.youtubeTitle}"`);
      console.log(`   Platform: ${platform} → @${account.username}`);
      console.log(`   Video: ${path.basename(videoPath)}`);

      if (options.dryRun) {
        console.log('   🧪 [DRY RUN] Would queue this video');
        queued++;
        continue;
      }

      try {
        // Check rate limits
        const allowed = await canPublish(platform);
        if (!allowed) {
          console.log(`   ⏸️  Rate limited on ${platform}, skipping`);
          continue;
        }

        const result = await queueVideoForPublishing(
          videoPath,
          video.youtubeDescription,
          video.youtubeTitle,
          platform,
          account.id,
          account.username,
          video.hashtags,
        );

        queued++;
        console.log(`   ✅ Queued! ID: ${result.id || 'N/A'}`);

        // Log
        addToPublishLog({
          videoId: video.id,
          platform,
          accountId: account.id,
          publishedAt: new Date().toISOString(),
          queueItemId: result.id || '',
        });

      } catch (error: any) {
        failed++;
        console.log(`   ❌ Failed: ${error.message}`);
      }
    }
  }

  // Summary
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('📊 DAILY PIPELINE SUMMARY');
  console.log('══════════════════════════════════════════════════════════════');
  console.log(`   Videos selected: ${dailyMix.length}`);
  console.log(`   Queued: ${queued}`);
  console.log(`   Failed: ${failed}`);
  console.log(`   Platforms: ${options.platforms.join(', ')}`);
  console.log(`   Catalog: ${catalog.totalAvailable} available / ${catalog.totalVideos} total`);
  if (options.dryRun) console.log('   Mode: DRY RUN (nothing actually queued)');
  console.log('══════════════════════════════════════════════════════════════\n');
}

async function showStatus(): Promise<void> {
  console.log('\n📊 PUBLISHING STATUS');
  console.log('────────────────────────────────────────');

  try {
    const status = await getPublishingStatus();
    console.log(`Global enabled: ${status.config?.global_enabled ?? 'unknown'}`);
    console.log(`Daily limit: ${status.daily_summary?.global_limit ?? 'unknown'}`);
    console.log(`Published today: ${status.daily_summary?.global_published ?? 0}`);
    console.log(`Remaining: ${status.daily_summary?.global_remaining ?? 'unknown'}`);

    if (status.queue_stats) {
      console.log('\nQueue:');
      for (const [st, cnt] of Object.entries(status.queue_stats.by_status || {})) {
        console.log(`  ${st}: ${cnt}`);
      }
    }
  } catch (error: any) {
    console.log(`⚠️  Backend unavailable: ${error.message}`);
  }

  // Local stats
  const log = loadPublishLog();
  const today = new Date().toISOString().split('T')[0];
  const todayEntries = log.filter(e => e.publishedAt.startsWith(today));

  console.log('\nLocal publish log:');
  console.log(`  Total published: ${log.length}`);
  console.log(`  Published today: ${todayEntries.length}`);

  if (fs.existsSync(CATALOG_FILE)) {
    const catalog = JSON.parse(fs.readFileSync(CATALOG_FILE, 'utf-8'));
    console.log(`\nCatalog:`);
    console.log(`  Total videos: ${catalog.totalVideos}`);
    console.log(`  Available: ${catalog.totalAvailable}`);
    for (const [batch, count] of Object.entries(catalog.batches || {})) {
      console.log(`  ${batch}: ${count}`);
    }
  }
}

function getAccountsForPlatform(platform: string): typeof YOUTUBE_ACCOUNTS {
  switch (platform) {
    case 'youtube': return YOUTUBE_ACCOUNTS;
    case 'tiktok': return TIKTOK_ACCOUNTS;
    case 'instagram': return INSTAGRAM_ACCOUNTS;
    default: return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const catalogOnly = args.includes('--catalog');
const statusOnly = args.includes('--status');

let count = DEFAULT_DAILY_COUNT;
const countIdx = args.indexOf('--count');
if (countIdx !== -1 && args[countIdx + 1]) {
  count = parseInt(args[countIdx + 1], 10);
}

let platforms = DEFAULT_PLATFORMS;
const platformIdx = args.indexOf('--platform');
if (platformIdx !== -1 && args[platformIdx + 1]) {
  platforms = [args[platformIdx + 1]];
}
if (args.includes('--all-platforms')) {
  platforms = ['youtube', 'tiktok', 'instagram'];
}

runDailyPipeline({
  dryRun,
  count,
  platforms,
  catalogOnly,
  statusOnly,
}).catch(console.error);
