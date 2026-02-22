#!/usr/bin/env npx tsx
/**
 * Sora DB-Generated Batch Runner
 * Runs video generation for scripts pulled from the SoraScriptGenerator DB
 * 
 * Usage:
 *   npx tsx scripts/sora-db-batch2-runner.ts                    # Run all
 *   npx tsx scripts/sora-db-batch2-runner.ts 5                   # Start from movie 5
 *   npx tsx scripts/sora-db-batch2-runner.ts 5 2                 # Start from movie 5, part 2
 *   npx tsx scripts/sora-db-batch2-runner.ts --trilogies         # Only trilogies
 *   npx tsx scripts/sora-db-batch2-runner.ts --singles           # Only singles
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_FILE = path.join(__dirname, '..', 'sora-db-generated-batch-2.json');

interface Video {
  part: number;
  title: string;
  stage: string;
  prompt: string;
}

interface Movie {
  id: number;
  title: string;
  trend: string;
  format: string;
  theme: string;
  bestPlatform: string;
  captionIdea: string;
  dbId?: string;
  videos: Video[];
}

interface BatchData {
  theme: string;
  totalMovies: number;
  totalVideos: number;
  movies: Movie[];
}

async function runMovie(movie: Movie, outputBaseDir: string): Promise<number> {
  const movieKey = movie.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '');
  const outputDir = path.join(outputBaseDir, movieKey);

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const isTrilogy = movie.videos.length >= 3;
  const icon = isTrilogy ? '🎬' : '🎥';

  console.log(`\n${'═'.repeat(70)}`);
  console.log(`${icon} SCRIPT ${movie.id}: ${movie.title}`);
  console.log(`   Trend: ${movie.trend}`);
  console.log(`   Format: ${movie.format} (${movie.videos.length} video${movie.videos.length > 1 ? 's' : ''})`);
  console.log(`   Platform: ${movie.bestPlatform}`);
  console.log(`   Caption: ${movie.captionIdea}`);
  if (movie.dbId) console.log(`   DB ID: ${movie.dbId}`);
  console.log('═'.repeat(70));

  const { SoraFullAutomation } = await import('../packages/services/src/sora/sora-full-automation.js');
  let completed = 0;

  for (const video of movie.videos) {
    console.log(`\n┌─────────────────────────────────────────────────────────────────────┐`);
    console.log(`│ 🎬 PART ${video.part}/${movie.videos.length}: ${video.title.toUpperCase()}`);
    console.log(`│ Stage: ${video.stage}`);
    console.log(`└─────────────────────────────────────────────────────────────────────┘`);
    console.log(`Prompt: ${video.prompt.slice(0, 100)}...`);
    console.log('⏳ Submitting to Sora...\n');

    try {
      const sora = new SoraFullAutomation();
      const result = await sora.fullRun(video.prompt);

      if (result.download?.success && result.download.filePath) {
        const destFilename = isTrilogy
          ? `part-${video.part}-${video.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.mp4`
          : `${movieKey}.mp4`;
        const destPath = path.join(outputDir, destFilename);
        fs.copyFileSync(result.download.filePath, destPath);
        console.log(`✅ Generated: ${destPath}`);
        completed++;
      } else {
        console.log(`❌ Failed: ${result.download?.error || result.poll?.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.log(`❌ Error: ${error instanceof Error ? error.message : 'Unknown'}`);
    }

    if (video.part < movie.videos.length) {
      console.log('\n⏳ Waiting 15s before next part...');
      await new Promise(r => setTimeout(r, 15000));
    }
  }

  return completed;
}

async function main(): Promise<void> {
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║   🔥 SORA DB-GENERATED BATCH 2 — @isaiahdupree                      ║');
  console.log('║   25 Scripts, 55 Videos (15 trilogies + 10 singles)                  ║');
  console.log('║   Sources: Live Web Trends + Internal + Brand Ideas                   ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');

  const data: BatchData = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));

  const args = process.argv.slice(2);
  const trilogiesOnly = args.includes('--trilogies');
  const singlesOnly = args.includes('--singles');
  const numArgs = args.filter(a => !a.startsWith('--'));
  const startMovie = parseInt(numArgs[0] || '1', 10);
  const startPart = parseInt(numArgs[1] || '1', 10);

  let movies = data.movies;
  if (trilogiesOnly) {
    movies = movies.filter(m => m.videos.length >= 3);
    console.log('\n🎬 Mode: TRILOGIES ONLY');
  } else if (singlesOnly) {
    movies = movies.filter(m => m.videos.length === 1);
    console.log('\n🎥 Mode: SINGLES ONLY');
  }

  console.log('\n📋 Scripts to generate:');
  for (const m of movies) {
    const icon = m.videos.length >= 3 ? '🎬' : '🎥';
    const skipNote = m.id < startMovie ? ' (skip)' : '';
    console.log(`   ${icon} ${m.id}. ${m.title} [${m.trend}] — ${m.videos.length} video${m.videos.length > 1 ? 's' : ''}${skipNote}`);
  }

  const totalVideos = movies.filter(m => m.id >= startMovie).reduce((sum, m) => sum + m.videos.length, 0);

  console.log('\n📊 Checking Sora credits...');
  const { SoraFullAutomation } = await import('../packages/services/src/sora/sora-full-automation.js');
  const sora = new SoraFullAutomation();
  const usage = await sora.getUsage();

  console.log(`   Credits available: ${usage.videoGensLeft ?? 'Unknown'}`);
  console.log(`   Credits needed: ${totalVideos}`);

  if (usage.videoGensLeft !== null && usage.videoGensLeft < totalVideos) {
    console.log(`\n⚠️  Warning: Only ${usage.videoGensLeft} credits available. Will generate as many as possible.`);
  }

  const outputBaseDir = path.join(process.env.HOME || '', 'sora-videos', 'db-generated-batch-2');
  if (!fs.existsSync(outputBaseDir)) {
    fs.mkdirSync(outputBaseDir, { recursive: true });
  }

  console.log(`\n📂 Output: ${outputBaseDir}`);
  console.log(`\n🚀 Starting from Script ${startMovie}${startPart > 1 ? `, Part ${startPart}` : ''}...`);

  const startTime = Date.now();
  let totalCompleted = 0;

  const progressFile = path.join(outputBaseDir, 'progress.json');
  const progress: Record<string, any> = {
    startedAt: new Date().toISOString(),
    config: 'sora-db-generated-batch-2.json',
    results: [],
  };

  for (const movie of movies) {
    if (movie.id < startMovie) continue;

    if (movie.id === startMovie && startPart > 1) {
      movie.videos = movie.videos.filter(v => v.part >= startPart);
    }

    const completed = await runMovie(movie, outputBaseDir);
    totalCompleted += completed;

    progress.results.push({
      id: movie.id,
      title: movie.title,
      trend: movie.trend,
      dbId: movie.dbId,
      videosCompleted: completed,
      videosTotal: movie.videos.length,
    });
    progress.lastUpdated = new Date().toISOString();
    progress.totalCompleted = totalCompleted;
    fs.writeFileSync(progressFile, JSON.stringify(progress, null, 2));

    if (movie.id < movies[movies.length - 1].id) {
      console.log('\n⏳ Waiting 30s before next script...');
      await new Promise(r => setTimeout(r, 30000));
    }
  }

  const totalTime = Math.round((Date.now() - startTime) / 1000 / 60);

  console.log('\n' + '═'.repeat(70));
  console.log('🔥 FINAL SUMMARY');
  console.log('═'.repeat(70));
  console.log(`   Videos completed: ${totalCompleted}/${totalVideos}`);
  console.log(`   Total time: ${totalTime} minutes`);
  console.log(`   Output: ${outputBaseDir}`);
  console.log('\n🎬 DB-generated batch 2 complete!');
}

main().catch(console.error);
