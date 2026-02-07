#!/usr/bin/env npx tsx
/**
 * Sora Valentine's Day Love Trilogies Runner
 * 8 Movies × 3 Parts = 24 Videos
 * Exploring all faces of love featuring @isaiahdupree
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MOVIES_FILE = path.join(__dirname, '..', 'sora-valentines-love-trilogies-v2.json');

interface Video {
  part: number;
  title: string;
  stage: string;
  prompt: string;
}

interface LoveInterest {
  name: string;
  description: string;
}

interface Movie {
  id: number;
  title: string;
  loveType: string;
  theme: string;
  loveInterest: LoveInterest;
  videos: Video[];
}

interface MoviesData {
  theme: string;
  movies: Movie[];
}

async function runMovie(movie: Movie, outputBaseDir: string): Promise<number> {
  const movieKey = movie.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const outputDir = path.join(outputBaseDir, movieKey);
  
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`💕 MOVIE ${movie.id}: ${movie.title}`);
  console.log(`   Love Type: ${movie.loveType}`);
  console.log(`   Theme: ${movie.theme}`);
  console.log(`   Love Interest: ${movie.loveInterest.name}`);
  console.log('═'.repeat(70));
  
  const { SoraFullAutomation } = await import('../packages/services/src/sora/sora-full-automation');
  let completed = 0;
  
  for (const video of movie.videos) {
    console.log(`\n┌─────────────────────────────────────────────────────────────────────┐`);
    console.log(`│ 💗 PART ${video.part}/3: ${video.title.toUpperCase()}`);
    console.log(`│ Stage: ${video.stage}`);
    console.log(`└─────────────────────────────────────────────────────────────────────┘`);
    console.log(`Prompt: ${video.prompt.slice(0, 80)}...`);
    console.log('⏳ Submitting to Sora...\n');
    
    try {
      const sora = new SoraFullAutomation();
      const result = await sora.fullRun(video.prompt);
      
      if (result.download?.success && result.download.filePath) {
        const destPath = path.join(outputDir, `part-${video.part}-${video.title.toLowerCase().replace(/\s+/g, '-')}.mp4`);
        fs.copyFileSync(result.download.filePath, destPath);
        console.log(`✅ Generated: ${destPath}`);
        completed++;
      } else {
        console.log(`❌ Failed: ${result.download?.error || result.poll?.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.log(`❌ Error: ${error instanceof Error ? error.message : 'Unknown'}`);
    }
    
    if (video.part < 3) {
      console.log('\n⏳ Waiting 15s before next part...');
      await new Promise(r => setTimeout(r, 15000));
    }
  }
  
  return completed;
}

async function main(): Promise<void> {
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║   💕 SORA VALENTINE\'S DAY LOVE TRILOGIES 💕                          ║');
  console.log('║   @isaiahdupree - The Many Faces of Love                             ║');
  console.log('║   24 Videos Total (8 Movies × 3 Parts)                               ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');
  
  const data: MoviesData = JSON.parse(fs.readFileSync(MOVIES_FILE, 'utf-8'));
  
  console.log('\n💝 Love Stories to generate:');
  for (const m of data.movies) {
    console.log(`   ${m.id}. ${m.title} (${m.loveType})`);
    console.log(`      💕 With: ${m.loveInterest.name}`);
  }
  
  console.log('\n📊 Checking Sora credits...');
  const { SoraFullAutomation } = await import('../packages/services/src/sora/sora-full-automation');
  const sora = new SoraFullAutomation();
  const usage = await sora.getUsage();
  
  console.log(`   Credits available: ${usage.videoGensLeft ?? 'Unknown'}`);
  console.log(`   Credits needed: 24 (8 movies × 3 parts)`);
  
  if (usage.videoGensLeft !== null && usage.videoGensLeft < 24) {
    console.log(`\n⚠️  Warning: Only ${usage.videoGensLeft} credits. Will generate as many as possible.`);
  }
  
  const outputBaseDir = path.join(process.env.HOME || '', 'sora-videos', 'valentines-love');
  if (!fs.existsSync(outputBaseDir)) {
    fs.mkdirSync(outputBaseDir, { recursive: true });
  }
  
  console.log(`\n📂 Output: ${outputBaseDir}`);
  
  const startMovie = parseInt(process.argv[2] || '1', 10);
  const startPart = parseInt(process.argv[3] || '1', 10);
  
  console.log(`\n🚀 Starting from Movie ${startMovie}, Part ${startPart}...`);
  
  const startTime = Date.now();
  let totalCompleted = 0;
  
  for (const movie of data.movies) {
    if (movie.id < startMovie) {
      console.log(`\n⏭️  Skipping Movie ${movie.id}: ${movie.title}`);
      continue;
    }
    
    if (movie.id === startMovie && startPart > 1) {
      movie.videos = movie.videos.filter(v => v.part >= startPart);
    }
    
    const completed = await runMovie(movie, outputBaseDir);
    totalCompleted += completed;
    
    if (movie.id < data.movies.length) {
      console.log('\n⏳ Waiting 30s before next love story...');
      await new Promise(r => setTimeout(r, 30000));
    }
  }
  
  const totalTime = Math.round((Date.now() - startTime) / 1000 / 60);
  
  console.log('\n' + '═'.repeat(70));
  console.log('💕 FINAL SUMMARY');
  console.log('═'.repeat(70));
  console.log(`   Videos completed: ${totalCompleted}/24`);
  console.log(`   Total time: ${totalTime} minutes`);
  console.log(`   Output: ${outputBaseDir}`);
  console.log('\n💝 Happy Valentine\'s Day! Love stories complete.');
}

main().catch(console.error);
