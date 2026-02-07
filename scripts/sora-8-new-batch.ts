#!/usr/bin/env npx tsx
/**
 * Sora 8 New Trilogies Batch Runner
 * Generates 8 completely new trilogy themes (24 videos total)
 * Different from all previous prompts
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TRILOGIES_FILE = path.join(__dirname, '..', 'sora-8-new-trilogies.json');

interface Video {
  part: number;
  title: string;
  prompt: string;
}

interface Trilogy {
  id: number;
  name: string;
  theme: string;
  videos: Video[];
}

interface TrilogiesData {
  trilogies: Trilogy[];
}

async function runTrilogy(trilogy: Trilogy, outputBaseDir: string): Promise<void> {
  const storyKey = trilogy.name.toLowerCase().replace(/\s+/g, '_');
  const outputDir = path.join(outputBaseDir, storyKey);
  
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`🎬 TRILOGY ${trilogy.id}: ${trilogy.name.toUpperCase()}`);
  console.log(`   Theme: ${trilogy.theme}`);
  console.log('═'.repeat(70));
  
  const { SoraFullAutomation } = await import('../packages/services/src/sora/sora-full-automation');
  
  for (const video of trilogy.videos) {
    console.log(`\n📽️  Part ${video.part}: ${video.title}`);
    console.log(`   Prompt: ${video.prompt.slice(0, 100)}...`);
    
    try {
      const sora = new SoraFullAutomation();
      console.log('   ⏳ Submitting to Sora...');
      
      const result = await sora.fullRun(video.prompt);
      
      if (result.download?.success && result.download.filePath) {
        const destPath = path.join(outputDir, `part-${video.part}-${video.title.toLowerCase().replace(/\s+/g, '-')}.mp4`);
        fs.copyFileSync(result.download.filePath, destPath);
        console.log(`   ✅ Generated: ${destPath}`);
      } else {
        console.log(`   ❌ Failed: ${result.download?.error || result.poll?.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.log(`   ❌ Error: ${error instanceof Error ? error.message : 'Unknown'}`);
    }
    
    // Wait between generations
    if (video.part < 3) {
      console.log('   ⏳ Waiting 15s before next video...');
      await new Promise(r => setTimeout(r, 15000));
    }
  }
  
  console.log(`\n✅ Trilogy "${trilogy.name}" complete!`);
}

async function main(): Promise<void> {
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║   SORA 8 NEW TRILOGIES - @isaiahdupree Badass Edition                ║');
  console.log('║   24 Videos Total (8 Trilogies x 3 Parts)                            ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');
  
  // Load trilogies
  const data: TrilogiesData = JSON.parse(fs.readFileSync(TRILOGIES_FILE, 'utf-8'));
  
  console.log('\n📖 Trilogies to generate:');
  for (const t of data.trilogies) {
    console.log(`   ${t.id}. ${t.name} - ${t.theme}`);
  }
  
  // Check usage first
  console.log('\n📊 Checking Sora credits...');
  const { SoraFullAutomation } = await import('../packages/services/src/sora/sora-full-automation');
  const sora = new SoraFullAutomation();
  const usage = await sora.getUsage();
  
  console.log(`   Credits available: ${usage.videoGensLeft ?? 'Unknown'}`);
  console.log(`   Credits needed: 24 (8 trilogies × 3 parts)`);
  
  if (usage.videoGensLeft !== null && usage.videoGensLeft < 24) {
    console.log(`\n⚠️  Warning: Only ${usage.videoGensLeft} credits available. Will generate as many as possible.`);
  }
  
  const outputBaseDir = path.join(process.env.HOME || '', 'sora-videos', 'new-8-trilogies');
  if (!fs.existsSync(outputBaseDir)) {
    fs.mkdirSync(outputBaseDir, { recursive: true });
  }
  
  console.log(`\n📂 Output directory: ${outputBaseDir}`);
  
  // Get starting trilogy from args (default 1)
  const startFrom = parseInt(process.argv[2] || '1', 10);
  console.log(`\n🚀 Starting from trilogy ${startFrom}...`);
  
  const startTime = Date.now();
  let completed = 0;
  
  for (const trilogy of data.trilogies) {
    if (trilogy.id < startFrom) {
      console.log(`\n⏭️  Skipping trilogy ${trilogy.id}: ${trilogy.name}`);
      continue;
    }
    
    await runTrilogy(trilogy, outputBaseDir);
    completed++;
    
    // Wait between trilogies
    if (trilogy.id < data.trilogies.length) {
      console.log('\n⏳ Waiting 30s before next trilogy...');
      await new Promise(r => setTimeout(r, 30000));
    }
  }
  
  const totalTime = Math.round((Date.now() - startTime) / 1000 / 60);
  
  console.log('\n' + '═'.repeat(70));
  console.log('📊 FINAL SUMMARY');
  console.log('═'.repeat(70));
  console.log(`   Trilogies completed: ${completed}`);
  console.log(`   Total time: ${totalTime} minutes`);
  console.log(`   Output: ${outputBaseDir}`);
  console.log('\n🎉 Done! Check your sora-videos folder for the results.');
}

main().catch(console.error);
