#!/usr/bin/env npx tsx
/**
 * Video Pipeline CLI
 * Download → Watermark Removal → MediaPoster Alert
 * 
 * Usage:
 *   npx tsx scripts/video-pipeline.ts --video /path/to/video.mp4 --prompt "@isaiahdupree on Mars"
 *   npx tsx scripts/video-pipeline.ts --dir ~/sora-videos/badass-marathon/ --character isaiahdupree
 */

import * as fs from 'fs';
import * as path from 'path';
import { VideoPipeline } from '../packages/protocol/src/video-pipeline';

// Parse CLI arguments
const args = process.argv.slice(2);
const getArg = (name: string): string | undefined => {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : undefined;
};
const hasFlag = (name: string): boolean => args.includes(`--${name}`);

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║     📹 Video Pipeline: Download → Clean → Alert              ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  const videoPath = getArg('video');
  const dirPath = getArg('dir');
  const prompt = getArg('prompt') || 'Generated video';
  const character = getArg('character') || 'isaiahdupree';
  const platforms = (getArg('platforms') || 'youtube,tiktok').split(',');
  const skipWatermark = hasFlag('skip-watermark');
  const skipMediaPoster = hasFlag('skip-mediaposter');
  const autoPublish = hasFlag('auto-publish');

  if (!videoPath && !dirPath) {
    console.log('Usage:');
    console.log('  Single video:');
    console.log('    npx tsx scripts/video-pipeline.ts --video /path/to/video.mp4 --prompt "description"');
    console.log('');
    console.log('  Directory batch:');
    console.log('    npx tsx scripts/video-pipeline.ts --dir ~/sora-videos/badass-marathon/');
    console.log('');
    console.log('Options:');
    console.log('  --video <path>        Path to single video');
    console.log('  --dir <path>          Path to directory of videos');
    console.log('  --prompt <text>       Video description/prompt');
    console.log('  --character <name>    Character name (default: isaiahdupree)');
    console.log('  --platforms <list>    Comma-separated platforms (default: youtube,tiktok)');
    console.log('  --skip-watermark      Skip watermark removal');
    console.log('  --skip-mediaposter    Skip MediaPoster alert');
    console.log('  --auto-publish        Auto-publish (default: queue for review)');
    process.exit(1);
  }

  const pipeline = new VideoPipeline();

  const options = {
    character,
    platforms,
    removeWatermark: !skipWatermark,
    alertMediaPoster: !skipMediaPoster,
    autoPublish,
    logToSupabase: true,
  };

  if (videoPath) {
    // Single video mode
    if (!fs.existsSync(videoPath)) {
      console.error(`❌ Video not found: ${videoPath}`);
      process.exit(1);
    }

    console.log(`📹 Processing: ${path.basename(videoPath)}`);
    console.log(`📝 Prompt: ${prompt}`);
    console.log(`👤 Character: ${character}`);
    console.log(`📺 Platforms: ${platforms.join(', ')}`);
    console.log('');

    const result = await pipeline.processVideo(videoPath, {
      ...options,
      prompt,
    });

    printResult(result);
  } else if (dirPath) {
    // Directory batch mode
    if (!fs.existsSync(dirPath)) {
      console.error(`❌ Directory not found: ${dirPath}`);
      process.exit(1);
    }

    const files = fs.readdirSync(dirPath)
      .filter(f => f.endsWith('.mp4') && !f.startsWith('cleaned_'))
      .sort();

    console.log(`📁 Directory: ${dirPath}`);
    console.log(`📹 Found ${files.length} videos`);
    console.log(`👤 Character: ${character}`);
    console.log(`📺 Platforms: ${platforms.join(', ')}`);
    console.log('');

    if (files.length === 0) {
      console.log('No .mp4 files found in directory');
      process.exit(0);
    }

    const result = await pipeline.processDirectory(dirPath, options);

    console.log('\n' + '═'.repeat(60));
    console.log('\n📊 BATCH RESULTS\n');
    console.log(`Total:     ${result.total}`);
    console.log(`Succeeded: ${result.succeeded} ✅`);
    console.log(`Failed:    ${result.failed} ❌`);
    console.log('');

    if (result.failed > 0) {
      console.log('Failed videos:');
      for (const r of result.results.filter(r => !r.success)) {
        console.log(`  - ${path.basename(r.videoPath)}: ${r.error || 'Unknown error'}`);
      }
    }
  }
}

function printResult(result: any) {
  console.log('\n' + '═'.repeat(60));
  console.log('\n📊 RESULT\n');
  console.log(`Status: ${result.success ? '✅ Success' : '❌ Failed'}`);
  console.log(`Video: ${result.videoPath}`);
  
  if (result.cleanedPath) {
    console.log(`Cleaned: ${result.cleanedPath}`);
  }
  
  if (result.mediaPosterJobId) {
    console.log(`MediaPoster Job: ${result.mediaPosterJobId}`);
  }
  
  if (result.error) {
    console.log(`Error: ${result.error}`);
  }

  console.log('\nStages:');
  if (result.stages.watermarkRemoval) {
    const wr = result.stages.watermarkRemoval;
    console.log(`  Watermark Removal: ${wr.success ? '✅' : '❌'} ${wr.durationMs ? `(${(wr.durationMs/1000).toFixed(1)}s)` : ''}`);
    if (wr.error) console.log(`    Error: ${wr.error}`);
  }
  if (result.stages.supabaseLog) {
    const sl = result.stages.supabaseLog;
    console.log(`  Supabase Log: ${sl.success ? '✅' : '⚠️'} ${sl.videoId ? `(${sl.videoId})` : ''}`);
  }
  if (result.stages.mediaPosterAlert) {
    const mp = result.stages.mediaPosterAlert;
    console.log(`  MediaPoster Alert: ${mp.success ? '✅' : '⚠️'} ${mp.jobId ? `(job: ${mp.jobId})` : ''}`);
    if (mp.error) console.log(`    Error: ${mp.error}`);
  }
  console.log('');
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
