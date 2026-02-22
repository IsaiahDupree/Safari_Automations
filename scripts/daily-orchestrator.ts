#!/usr/bin/env npx tsx
/**
 * Daily Content Orchestrator
 * ==========================
 * End-to-end daily automation: UGC generation → Sora video selection → publish queue
 *
 * Combines:
 * 1. Fresh UGC script generation (offer-aware, trend-driven)
 * 2. Existing cleaned Sora video library (137 videos)
 * 3. Blotato publishing queue (YouTube, TikTok, Instagram)
 *
 * Usage:
 *   npx tsx scripts/daily-orchestrator.ts                    # Full daily run
 *   npx tsx scripts/daily-orchestrator.ts --dry-run          # Preview
 *   npx tsx scripts/daily-orchestrator.ts --ugc-only         # Just generate UGC scripts
 *   npx tsx scripts/daily-orchestrator.ts --sora-only        # Just queue existing Sora videos
 *   npx tsx scripts/daily-orchestrator.ts --platforms youtube,tiktok
 *   npx tsx scripts/daily-orchestrator.ts --ugc-count 3 --sora-count 4
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────────

const BACKEND_URL = 'http://localhost:5555';
const SORA_VIDEOS_DIR = path.join(process.env.HOME || '', 'sora-videos');

const YOUTUBE_ACCOUNTS = [
  { id: '228', username: 'Isaiah Dupree', platform: 'youtube' },
];
const TIKTOK_ACCOUNTS = [
  { id: '710', username: 'isaiah_dupree', platform: 'tiktok' },
];
const INSTAGRAM_ACCOUNTS = [
  { id: '807', username: 'the_isaiah_dupree', platform: 'instagram' },
];

const DEFAULT_UGC_COUNT = 2;
const DEFAULT_SORA_COUNT = 3;
const DEFAULT_PLATFORMS = ['youtube'];

// ─────────────────────────────────────────────────────────────────────────────
// API HELPERS
// ─────────────────────────────────────────────────────────────────────────────

async function api(endpoint: string, method = 'GET', body?: any): Promise<any> {
  const url = `${BACKEND_URL}${endpoint}`;
  const opts: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text.substring(0, 200)}`);
  }
  return res.json();
}

function getAccountsForPlatform(platform: string) {
  switch (platform) {
    case 'youtube': return YOUTUBE_ACCOUNTS;
    case 'tiktok': return TIKTOK_ACCOUNTS;
    case 'instagram': return INSTAGRAM_ACCOUNTS;
    default: return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 1: GENERATE FRESH UGC SCRIPTS
// ─────────────────────────────────────────────────────────────────────────────

async function generateUGCScripts(count: number, dryRun: boolean): Promise<any[]> {
  console.log(`\n🎬 STEP 1: Generate ${count} fresh UGC scripts...`);

  // Get available offers
  const offersData = await api('/api/ugc-content/offers');
  const offers = offersData.offers || [];

  if (offers.length === 0) {
    console.log('  ⚠️  No offers found. Skipping UGC generation.');
    return [];
  }

  console.log(`  📋 ${offers.length} offers available`);

  if (dryRun) {
    console.log(`  🧪 [DRY RUN] Would generate ${count} scripts across ${offers.length} offers`);
    return [];
  }

  const allScripts: any[] = [];
  const perOffer = Math.max(1, Math.ceil(count / offers.length));

  for (const offer of offers) {
    try {
      const result = await api('/api/ugc-content/generate', 'POST', {
        offer_id: offer.id,
        count: perOffer,
        formats: ['sora_ai', 'talking_head'],
      });

      const scripts = result.scripts || [];
      allScripts.push(...scripts);
      console.log(`  ✅ ${scripts.length} scripts for "${offer.title}"`);
    } catch (err: any) {
      console.log(`  ❌ Failed for "${offer.title}": ${err.message}`);
    }
  }

  console.log(`  📊 Total UGC scripts generated: ${allScripts.length}`);
  return allScripts;
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2: SELECT SORA VIDEOS FROM LIBRARY
// ─────────────────────────────────────────────────────────────────────────────

async function selectSoraVideos(count: number, dryRun: boolean): Promise<any[]> {
  console.log(`\n📺 STEP 2: Select ${count} Sora videos from library...`);

  try {
    // Run the daily content pipeline in catalog mode to get fresh data
    const catalogPath = path.join(SORA_VIDEOS_DIR, 'daily-pipeline-catalog.json');
    const publishLogPath = path.join(SORA_VIDEOS_DIR, 'daily-publish-log.json');

    // Rebuild catalog
    execSync('npx tsx scripts/daily-content-pipeline.ts --catalog', {
      cwd: path.join(__dirname, '..'),
      stdio: 'pipe',
    });

    if (!fs.existsSync(catalogPath)) {
      console.log('  ⚠️  No catalog found');
      return [];
    }

    const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'));
    const publishLog: any[] = fs.existsSync(publishLogPath)
      ? JSON.parse(fs.readFileSync(publishLogPath, 'utf-8'))
      : [];

    // Filter available — STRICT: only watermark-free (cleaned) videos
    const available = catalog.videos
      .filter((v: any) => v.exists && v.cleanedPath && v.cleanedPath.includes('/cleaned'))
      .map((v: any) => {
        const published = publishLog.filter((p: any) => p.videoId === v.id);
        return { ...v, publishedCount: published.length };
      })
      .sort((a: any, b: any) => {
        if (a.publishedCount !== b.publishedCount) return a.publishedCount - b.publishedCount;
        if (a.format !== b.format) return a.format === 'single' ? -1 : 1;
        return Math.random() - 0.5;
      });

    // Select with niche diversity
    const selected: any[] = [];
    const usedNiches = new Set<string>();

    for (const v of available) {
      if (selected.length >= count) break;
      const niche = v.niche || 'unknown';
      if (!usedNiches.has(niche) || selected.length >= count - 1) {
        selected.push(v);
        usedNiches.add(niche);
      }
    }

    console.log(`  📊 ${available.length} available, selected ${selected.length}:`);
    for (const v of selected) {
      console.log(`     • [${v.batch}] ${v.movieTitle} — ${v.niche}`);
    }

    return selected;
  } catch (err: any) {
    console.log(`  ❌ Error selecting Sora videos: ${err.message}`);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 3: QUEUE EVERYTHING FOR PUBLISHING
// ─────────────────────────────────────────────────────────────────────────────

async function queueForPublishing(
  ugcScripts: any[],
  soraVideos: any[],
  platforms: string[],
  dryRun: boolean,
): Promise<{ queued: number; failed: number }> {
  console.log(`\n📤 STEP 3: Queue content for publishing...`);
  console.log(`  UGC scripts: ${ugcScripts.length}`);
  console.log(`  Sora videos: ${soraVideos.length}`);
  console.log(`  Platforms: ${platforms.join(', ')}`);

  let queued = 0;
  let failed = 0;

  for (const platform of platforms) {
    const accounts = getAccountsForPlatform(platform);
    if (accounts.length === 0) {
      console.log(`  ⚠️  No accounts for ${platform}`);
      continue;
    }
    const account = accounts[0];

    // Queue UGC scripts
    for (const script of ugcScripts) {
      if (dryRun) {
        console.log(`  🧪 [DRY] UGC → ${platform}: "${script.title}"`);
        queued++;
        continue;
      }

      // Find a matching video to pair with the UGC script
      // Use a random cleaned video as the visual content
      const videoDir = path.join(SORA_VIDEOS_DIR, 'cleaned');
      let videoPath = '';
      try {
        const allMp4 = execSync(`find "${videoDir}" -name "*.mp4" -type f`, { encoding: 'utf-8' })
          .trim().split('\n').filter(Boolean);
        if (allMp4.length > 0) {
          videoPath = allMp4[Math.floor(Math.random() * allMp4.length)];
        }
      } catch { /* ignore */ }

      try {
        const result = await api(`/api/ugc-content/scripts/${script.id}/queue`, 'POST', {
          platform,
          account_id: account.id,
          account_username: account.username,
          video_url: videoPath,
        });
        if (result.queued) {
          queued++;
          console.log(`  ✅ UGC queued → ${platform}: "${script.title}"`);
        }
      } catch (err: any) {
        failed++;
        console.log(`  ❌ UGC failed: ${err.message.substring(0, 80)}`);
      }
    }

    // Queue Sora videos — STRICT: only cleaned (watermark-free) videos
    for (const video of soraVideos) {
      const videoPath = video.cleanedPath;

      // WATERMARK GUARD: Never publish raw Sora videos
      if (!videoPath || !videoPath.includes('/cleaned')) {
        console.log(`  🚫 BLOCKED: "${video.movieTitle}" — no cleaned version (Sora watermark)`);
        failed++;
        continue;
      }

      if (dryRun) {
        console.log(`  🧪 [DRY] Sora → ${platform}: "${video.youtubeTitle || video.movieTitle}"`);
        queued++;
        continue;
      }

      try {
        const result = await api('/api/publish-controls/queue', 'POST', {
          video_url: videoPath,
          caption: video.youtubeDescription || video.caption || '',
          title: video.youtubeTitle || `${video.movieTitle} #shorts`,
          platform,
          account_id: account.id,
          account_username: account.username,
          hashtags: video.hashtags || ['shorts', 'isaiahdupree', 'AIGenerated'],
          priority: 3,
          metadata: {
            source: 'daily-orchestrator',
            batch: video.batch,
            videoId: video.id,
            generated_at: new Date().toISOString(),
          },
        });
        queued++;
        console.log(`  ✅ Sora queued → ${platform}: "${video.movieTitle}"`);
      } catch (err: any) {
        failed++;
        console.log(`  ❌ Sora failed: ${err.message.substring(0, 80)}`);
      }
    }
  }

  return { queued, failed };
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 4: TRIGGER BLOTATO PUBLISHING
// ─────────────────────────────────────────────────────────────────────────────

async function checkBlotatoStatus(): Promise<void> {
  console.log(`\n🔌 STEP 4: Check Blotato publishing readiness...`);

  try {
    const status = await api('/api/publish-controls/status');
    const config = status.config || {};
    const daily = status.daily_summary || {};
    const queue = status.queue_stats || {};

    console.log(`  Global enabled: ${config.global_enabled}`);
    console.log(`  Published today: ${daily.global_published || 0}/${daily.global_limit || '∞'}`);
    console.log(`  Queue: ${JSON.stringify(queue.by_status || {})}`);
    console.log(`  Posting window: ${config.posting_windows?.start || '?'} - ${config.posting_windows?.end || '?'} ${config.posting_windows?.tz || ''}`);

    if (daily.global_published > 0) {
      console.log(`  📊 YouTube today: ${daily.platforms?.youtube?.published_today || 0}`);
      console.log(`  📊 TikTok today: ${daily.platforms?.tiktok?.published_today || 0}`);
    }
  } catch (err: any) {
    console.log(`  ⚠️  Backend status unavailable: ${err.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const ugcOnly = args.includes('--ugc-only');
  const soraOnly = args.includes('--sora-only');

  let ugcCount = DEFAULT_UGC_COUNT;
  const ugcIdx = args.indexOf('--ugc-count');
  if (ugcIdx !== -1) ugcCount = parseInt(args[ugcIdx + 1], 10);

  let soraCount = DEFAULT_SORA_COUNT;
  const soraIdx = args.indexOf('--sora-count');
  if (soraIdx !== -1) soraCount = parseInt(args[soraIdx + 1], 10);

  let platforms = DEFAULT_PLATFORMS;
  const platIdx = args.indexOf('--platforms');
  if (platIdx !== -1) platforms = args[platIdx + 1].split(',');

  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║   🚀 DAILY CONTENT ORCHESTRATOR — @isaiahdupree            ║');
  console.log('║   UGC Scripts + Sora Videos → YouTube/TikTok/IG via Blotato║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`\n📅 ${new Date().toISOString().split('T')[0]} ${new Date().toLocaleTimeString()}`);
  console.log(`🎯 UGC: ${ugcCount} | Sora: ${soraCount} | Platforms: ${platforms.join(', ')}`);
  if (dryRun) console.log('🧪 DRY RUN MODE');

  // Check backend
  try {
    await api('/health');
  } catch {
    console.log('\n❌ Backend not running at localhost:5555');
    process.exit(1);
  }

  // Step 1: UGC generation
  let ugcScripts: any[] = [];
  if (!soraOnly) {
    ugcScripts = await generateUGCScripts(ugcCount, dryRun);
  }

  // Step 2: Sora video selection
  let soraVideos: any[] = [];
  if (!ugcOnly) {
    soraVideos = await selectSoraVideos(soraCount, dryRun);
  }

  // Step 3: Queue for publishing
  const { queued, failed } = await queueForPublishing(ugcScripts, soraVideos, platforms, dryRun);

  // Step 4: Check Blotato status
  await checkBlotatoStatus();

  // Summary
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('📊 DAILY ORCHESTRATOR SUMMARY');
  console.log('══════════════════════════════════════════════════════════════');
  console.log(`   UGC scripts generated: ${ugcScripts.length}`);
  console.log(`   Sora videos selected:  ${soraVideos.length}`);
  console.log(`   Total queued:          ${queued}`);
  console.log(`   Failed:                ${failed}`);
  console.log(`   Platforms:             ${platforms.join(', ')}`);
  if (dryRun) console.log('   Mode: DRY RUN');
  console.log('══════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
