#!/usr/bin/env npx tsx
/**
 * Video Pipeline CLI
 * Download → Watermark Removal → MediaPoster Alert
 * 
 * Usage:
 *   npx tsx scripts/video-pipeline.ts --video /path/to/video.mp4 --prompt "@isaiahdupree on Mars"
 *   npx tsx scripts/video-pipeline.ts --dir ~/sora-videos/badass-marathon/ --character isaiahdupree
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';

const execAsync = promisify(exec);

const DEFAULT_CLEANED_DIR = path.join(process.env.HOME || '~', 'sora-videos', 'cleaned');
const WATERMARK_CLEANER_PATH = '/Users/isaiahdupree/Documents/Software/MediaPoster/Backend/SoraWatermarkCleaner';
const DEFAULT_MEDIAPOSTER_URL = 'http://localhost:5555/api/webhooks/video-ready';

interface PipelineOptions {
  prompt: string;
  character: string;
  removeWatermark?: boolean;
  alertMediaPoster?: boolean;
  mediaPosterUrl?: string;
  platforms?: string[];
  autoPublish?: boolean;
  cleanedDir?: string;
}

interface PipelineResult {
  success: boolean;
  videoPath: string;
  cleanedPath?: string;
  error?: string;
  stages: {
    watermarkRemoval?: { success: boolean; durationMs?: number; error?: string };
    mediaPosterAlert?: { success: boolean; jobId?: string; error?: string };
  };
}

class VideoPipeline {
  private cleanedDir: string;
  private mediaPosterUrl: string;

  constructor() {
    this.cleanedDir = DEFAULT_CLEANED_DIR;
    this.mediaPosterUrl = DEFAULT_MEDIAPOSTER_URL;
    if (!fs.existsSync(this.cleanedDir)) {
      fs.mkdirSync(this.cleanedDir, { recursive: true });
    }
  }

  async processVideo(videoPath: string, options: PipelineOptions): Promise<PipelineResult> {
    const result: PipelineResult = { success: false, videoPath, stages: {} };

    if (!fs.existsSync(videoPath)) {
      result.error = `Video not found: ${videoPath}`;
      return result;
    }

    // Stage 1: Watermark Removal
    if (options.removeWatermark !== false) {
      const cleanResult = await this.removeWatermark(videoPath, options);
      result.stages.watermarkRemoval = cleanResult;
      if (cleanResult.success) {
        result.cleanedPath = cleanResult.cleanedPath;
      }
    } else {
      result.cleanedPath = videoPath;
    }

    // Stage 2: Alert MediaPoster
    if (options.alertMediaPoster !== false) {
      const alertResult = await this.alertMediaPoster(result.cleanedPath || videoPath, videoPath, options);
      result.stages.mediaPosterAlert = alertResult;
    }

    result.success = !!(result.cleanedPath || !options.removeWatermark);
    return result;
  }

  async processDirectory(dirPath: string, options: Omit<PipelineOptions, 'prompt'>): Promise<{ total: number; succeeded: number; failed: number; results: PipelineResult[] }> {
    const files = fs.readdirSync(dirPath)
      .filter(f => f.endsWith('.mp4') && !f.startsWith('cleaned_'))
      .map(f => path.join(dirPath, f));

    const results: PipelineResult[] = [];
    let succeeded = 0, failed = 0;

    for (let i = 0; i < files.length; i++) {
      console.log(`\n[${i + 1}/${files.length}] Processing ${path.basename(files[i])}...`);
      const result = await this.processVideo(files[i], { ...options, prompt: `Video ${i + 1}` });
      results.push(result);
      result.success ? succeeded++ : failed++;
      if (i < files.length - 1) await this.delay(1000);
    }

    return { total: files.length, succeeded, failed, results };
  }

  private async removeWatermark(videoPath: string, options: PipelineOptions): Promise<{ success: boolean; cleanedPath?: string; durationMs?: number; error?: string }> {
    const filename = path.basename(videoPath, '.mp4');
    const outputDir = options.cleanedDir || this.cleanedDir;
    const cleanedPath = path.join(outputDir, `cleaned_${filename}.mp4`);

    if (fs.existsSync(cleanedPath)) {
      console.log(`[Pipeline] Skipping (already cleaned)`);
      return { success: true, cleanedPath, durationMs: 0 };
    }

    console.log(`[Pipeline] Removing watermark...`);
    const startTime = Date.now();

    try {
      if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
      // Create temp input dir with single video
      const tempInputDir = path.join(outputDir, '.temp_input');
      if (!fs.existsSync(tempInputDir)) fs.mkdirSync(tempInputDir, { recursive: true });
      const tempInput = path.join(tempInputDir, path.basename(videoPath));
      fs.copyFileSync(videoPath, tempInput);
      
      const cmd = `cd "${WATERMARK_CLEANER_PATH}" && uv run python cli.py -i "${tempInputDir}" -o "${outputDir}"`;
      await execAsync(cmd, { timeout: 300000 });
      
      // Cleanup temp
      fs.unlinkSync(tempInput);
      fs.rmdirSync(tempInputDir);
      const durationMs = Date.now() - startTime;

      if (!fs.existsSync(cleanedPath)) throw new Error('Cleaned video not created');
      console.log(`[Pipeline] ✅ Watermark removed in ${(durationMs / 1000).toFixed(1)}s`);
      return { success: true, cleanedPath, durationMs };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[Pipeline] ❌ Watermark removal failed: ${errorMsg}`);
      return { success: false, durationMs: Date.now() - startTime, error: errorMsg };
    }
  }

  private async alertMediaPoster(videoPath: string, rawPath: string, options: PipelineOptions): Promise<{ success: boolean; jobId?: string; error?: string }> {
    console.log(`[Pipeline] Alerting MediaPoster...`);
    try {
      const payload = {
        video_path: videoPath,
        raw_path: rawPath !== videoPath ? rawPath : undefined,
        prompt: options.prompt,
        character: options.character,
        source: 'sora',
        platforms: options.platforms || ['youtube', 'tiktok'],
        auto_publish: options.autoPublish || false,
      };

      const response = await fetch(options.mediaPosterUrl || this.mediaPosterUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json() as { job_id?: string; id?: string };
      console.log(`[Pipeline] ✅ MediaPoster alerted`);
      return { success: true, jobId: result.job_id || result.id };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.warn(`[Pipeline] ⚠️ MediaPoster alert failed: ${errorMsg}`);
      return { success: false, error: errorMsg };
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

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
