#!/usr/bin/env npx tsx
/**
 * Sora Valentine's Chad Advice Runner
 * 3 Videos - @isaiahdupree giving chad dating advice
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_FILE = path.join(__dirname, '..', 'sora-valentines-chad-advice.json');

interface Video {
  id: number;
  title: string;
  prompt: string;
}

interface ConfigData {
  theme: string;
  videos: Video[];
}

async function main(): Promise<void> {
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║   😎 SORA VALENTINE\'S CHAD ADVICE 😎                                 ║');
  console.log('║   @isaiahdupree dropping knowledge                                   ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');

  const data: ConfigData = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
  
  console.log(`\n📋 Videos to generate: ${data.videos.length}`);
  for (const v of data.videos) {
    console.log(`   ${v.id}. ${v.title}`);
  }

  const outputDir = path.join(process.env.HOME || '', 'sora-videos', 'chad-advice');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  console.log(`\n📂 Output: ${outputDir}`);

  const { SoraFullAutomation } = await import('../packages/services/src/sora/sora-full-automation');
  
  let completed = 0;
  
  for (const video of data.videos) {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`😎 VIDEO ${video.id}: ${video.title.toUpperCase()}`);
    console.log('═'.repeat(60));
    console.log(`Prompt: ${video.prompt.slice(0, 80)}...`);
    console.log('\n⏳ Submitting to Sora...');

    try {
      const sora = new SoraFullAutomation();
      const result = await sora.fullRun(video.prompt);

      if (result.download?.success && result.download.filePath) {
        const destPath = path.join(outputDir, `${video.id}-${video.title.toLowerCase().replace(/\s+/g, '-')}.mp4`);
        fs.copyFileSync(result.download.filePath, destPath);
        console.log(`✅ Generated: ${destPath}`);
        completed++;
      } else {
        console.log(`❌ Failed: ${result.download?.error || result.poll?.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.log(`❌ Error: ${error instanceof Error ? error.message : 'Unknown'}`);
    }

    if (video.id < data.videos.length) {
      console.log('\n⏳ Waiting 15s before next video...');
      await new Promise(r => setTimeout(r, 15000));
    }
  }

  console.log('\n' + '═'.repeat(60));
  console.log('😎 CHAD ADVICE COMPLETE');
  console.log('═'.repeat(60));
  console.log(`   Videos completed: ${completed}/${data.videos.length}`);
  console.log(`   Output: ${outputDir}`);
}

main().catch(console.error);
