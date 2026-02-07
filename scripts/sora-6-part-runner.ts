#!/usr/bin/env npx tsx
/**
 * Sora 6-Part Epic Runner
 * THE LAST GUARDIAN - @isaiahdupree's epic journey
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const EPIC_FILE = path.join(__dirname, '..', 'sora-6-part-epic.json');

interface Video {
  part: number;
  title: string;
  prompt: string;
}

interface EpicData {
  title: string;
  theme: string;
  videos: Video[];
}

async function main(): Promise<void> {
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║   SORA 6-PART EPIC: THE LAST GUARDIAN                                ║');
  console.log('║   @isaiahdupree - A Legendary Warrior\'s Journey                      ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');
  
  const data: EpicData = JSON.parse(fs.readFileSync(EPIC_FILE, 'utf-8'));
  
  console.log(`\n🎬 "${data.title}"`);
  console.log(`   ${data.theme}\n`);
  
  console.log('📖 Parts to generate:');
  for (const v of data.videos) {
    console.log(`   Part ${v.part}: ${v.title}`);
  }
  
  // Check usage
  console.log('\n📊 Checking Sora credits...');
  const { SoraFullAutomation } = await import('../packages/services/src/sora/sora-full-automation');
  const sora = new SoraFullAutomation();
  const usage = await sora.getUsage();
  
  console.log(`   Credits available: ${usage.videoGensLeft ?? 'Unknown'}`);
  console.log(`   Credits needed: 6`);
  
  if (usage.videoGensLeft !== null && usage.videoGensLeft < 6) {
    console.log(`\n⚠️  Warning: Only ${usage.videoGensLeft} credits. Will generate as many as possible.`);
  }
  
  const outputDir = path.join(process.env.HOME || '', 'sora-videos', 'the-last-guardian');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  console.log(`\n📂 Output: ${outputDir}`);
  
  // Get starting part from args (default 1)
  const startFrom = parseInt(process.argv[2] || '1', 10);
  console.log(`\n🚀 Starting from Part ${startFrom}...\n`);
  
  const startTime = Date.now();
  let completed = 0;
  
  for (const video of data.videos) {
    if (video.part < startFrom) {
      console.log(`⏭️  Skipping Part ${video.part}: ${video.title}`);
      continue;
    }
    
    console.log('═'.repeat(70));
    console.log(`🎬 PART ${video.part}/6: ${video.title.toUpperCase()}`);
    console.log('═'.repeat(70));
    console.log(`Prompt: ${video.prompt.slice(0, 100)}...`);
    console.log('⏳ Submitting to Sora...\n');
    
    try {
      const soraRunner = new SoraFullAutomation();
      const result = await soraRunner.fullRun(video.prompt);
      
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
    
    // Wait between generations
    if (video.part < 6) {
      console.log('\n⏳ Waiting 15s before next part...\n');
      await new Promise(r => setTimeout(r, 15000));
    }
  }
  
  const totalTime = Math.round((Date.now() - startTime) / 1000 / 60);
  
  console.log('\n' + '═'.repeat(70));
  console.log('📊 FINAL SUMMARY');
  console.log('═'.repeat(70));
  console.log(`   Parts completed: ${completed}/6`);
  console.log(`   Total time: ${totalTime} minutes`);
  console.log(`   Output: ${outputDir}`);
  console.log('\n🎉 THE LAST GUARDIAN complete!');
}

main().catch(console.error);
