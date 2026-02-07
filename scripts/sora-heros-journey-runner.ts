#!/usr/bin/env npx tsx
/**
 * Sora Hero's Journey 3-Movie Runner
 * 3 Movies × 6 Parts = 18 Videos Total
 * Following Joseph Campbell's Monomyth Structure
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MOVIES_FILE = path.join(__dirname, '..', 'sora-heros-journey-3movies.json');

interface Video {
  part: number;
  stage: string;
  title: string;
  prompt: string;
}

interface Movie {
  id: number;
  title: string;
  theme: string;
  videos: Video[];
}

interface MoviesData {
  stageMapping: Record<string, string>;
  movies: Movie[];
}

async function runMovie(movie: Movie, outputBaseDir: string): Promise<number> {
  const movieKey = movie.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const outputDir = path.join(outputBaseDir, movieKey);
  
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`🎬 MOVIE ${movie.id}: ${movie.title}`);
  console.log(`   Theme: ${movie.theme}`);
  console.log('═'.repeat(70));
  
  const { SoraFullAutomation } = await import('../packages/services/src/sora/sora-full-automation');
  let completed = 0;
  
  for (const video of movie.videos) {
    console.log(`\n┌─────────────────────────────────────────────────────────────────────┐`);
    console.log(`│ PART ${video.part}/6: ${video.title.toUpperCase()}`);
    console.log(`│ Hero's Journey Stage: ${video.stage}`);
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
    
    // Wait between parts
    if (video.part < 6) {
      console.log('\n⏳ Waiting 15s before next part...');
      await new Promise(r => setTimeout(r, 15000));
    }
  }
  
  return completed;
}

async function main(): Promise<void> {
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║   SORA HERO\'S JOURNEY - 3 EPIC MOVIES                                ║');
  console.log('║   @isaiahdupree - Following Joseph Campbell\'s Monomyth               ║');
  console.log('║   18 Videos Total (3 Movies × 6 Parts)                               ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');
  
  const data: MoviesData = JSON.parse(fs.readFileSync(MOVIES_FILE, 'utf-8'));
  
  console.log('\n📖 Hero\'s Journey Stage Mapping:');
  for (const [part, stage] of Object.entries(data.stageMapping)) {
    console.log(`   ${part}: ${stage}`);
  }
  
  console.log('\n🎬 Movies to generate:');
  for (const m of data.movies) {
    console.log(`   ${m.id}. ${m.title}`);
    console.log(`      "${m.theme}"`);
  }
  
  // Check usage
  console.log('\n📊 Checking Sora credits...');
  const { SoraFullAutomation } = await import('../packages/services/src/sora/sora-full-automation');
  const sora = new SoraFullAutomation();
  const usage = await sora.getUsage();
  
  console.log(`   Credits available: ${usage.videoGensLeft ?? 'Unknown'}`);
  console.log(`   Credits needed: 18 (3 movies × 6 parts)`);
  
  if (usage.videoGensLeft !== null && usage.videoGensLeft < 18) {
    console.log(`\n⚠️  Warning: Only ${usage.videoGensLeft} credits. Will generate as many as possible.`);
  }
  
  const outputBaseDir = path.join(process.env.HOME || '', 'sora-videos', 'heros-journey');
  if (!fs.existsSync(outputBaseDir)) {
    fs.mkdirSync(outputBaseDir, { recursive: true });
  }
  
  console.log(`\n📂 Output: ${outputBaseDir}`);
  
  // Parse args: movie number to start from (1-3)
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
    
    // Filter parts if starting mid-movie
    if (movie.id === startMovie && startPart > 1) {
      movie.videos = movie.videos.filter(v => v.part >= startPart);
    }
    
    const completed = await runMovie(movie, outputBaseDir);
    totalCompleted += completed;
    
    // Wait between movies
    if (movie.id < data.movies.length) {
      console.log('\n⏳ Waiting 30s before next movie...');
      await new Promise(r => setTimeout(r, 30000));
    }
  }
  
  const totalTime = Math.round((Date.now() - startTime) / 1000 / 60);
  
  console.log('\n' + '═'.repeat(70));
  console.log('📊 FINAL SUMMARY');
  console.log('═'.repeat(70));
  console.log(`   Videos completed: ${totalCompleted}/18`);
  console.log(`   Total time: ${totalTime} minutes`);
  console.log(`   Output: ${outputBaseDir}`);
  console.log('\n🎉 Hero\'s Journey complete! The hero has returned transformed.');
}

main().catch(console.error);
