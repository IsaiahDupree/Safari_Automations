/**
 * Sora Batch Mars Generation
 * 
 * Generates 3 Mars-themed videos with @isaiahdupree character.
 * 
 * Run with: npx tsx scripts/sora-batch-mars.ts
 */

import { SoraFullAutomation } from '../packages/services/src/sora/sora-full-automation';
import * as fs from 'fs';

const MARS_PROMPTS = [
  'An astronaut taking the first steps on Mars, red dust clouds rising around their boots, with a dramatic view of the barren Martian landscape stretching to the horizon under a pale pink sky',
  'A futuristic Mars colony at sunset, showing glass domes, solar panels, and humans in spacesuits walking between habitats, with Earth visible as a tiny blue dot in the sky',
  'Inside a Mars rover cockpit, an astronaut looking out at towering Martian mountains and ancient dried riverbeds, dashboard lights reflecting off their helmet visor',
];

interface BatchResult {
  prompt: string;
  success: boolean;
  filePath?: string;
  fileSize?: number;
  timeMs: number;
  error?: string;
}

async function runBatchGeneration(): Promise<void> {
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║   SORA BATCH MARS GENERATION - 3 VIDEOS               ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');

  const sora = new SoraFullAutomation({
    pollIntervalMs: 15000,
    maxPollAttempts: 40,
  });

  // Check usage first
  console.log('Checking usage...\n');
  const usage = await sora.getUsage();
  
  if (!usage.success) {
    console.error('❌ Failed to get usage info');
    return;
  }

  console.log(`Video gens available: ${usage.videoGensLeft}`);
  console.log(`Need: 3 generations\n`);

  if (usage.videoGensLeft !== null && usage.videoGensLeft < 3) {
    console.error(`❌ Not enough generations! Have ${usage.videoGensLeft}, need 3`);
    console.log(`More available on: ${usage.nextAvailableDate}`);
    return;
  }

  const results: BatchResult[] = [];
  const startTime = Date.now();

  for (let i = 0; i < MARS_PROMPTS.length; i++) {
    const prompt = MARS_PROMPTS[i];
    const videoStart = Date.now();

    console.log(`\n${'='.repeat(60)}`);
    console.log(`VIDEO ${i + 1}/${MARS_PROMPTS.length}`);
    console.log(`${'='.repeat(60)}`);
    console.log(`Prompt: "${prompt.slice(0, 60)}..."\n`);

    try {
      const result = await sora.fullRun(prompt);

      results.push({
        prompt: prompt.slice(0, 50) + '...',
        success: result.download?.success || false,
        filePath: result.download?.filePath,
        fileSize: result.download?.fileSize,
        timeMs: Date.now() - videoStart,
        error: result.download?.error || result.poll?.error || result.submit.error,
      });

      if (result.download?.success) {
        console.log(`✅ Video ${i + 1} complete: ${result.download.filePath}`);
      } else {
        console.log(`❌ Video ${i + 1} failed`);
      }

      // Wait between generations to avoid rate limiting
      if (i < MARS_PROMPTS.length - 1) {
        console.log('\nWaiting 10s before next generation...');
        await new Promise(r => setTimeout(r, 10000));
      }

    } catch (error) {
      results.push({
        prompt: prompt.slice(0, 50) + '...',
        success: false,
        timeMs: Date.now() - videoStart,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  // Print summary
  const totalTime = Date.now() - startTime;
  const successCount = results.filter(r => r.success).length;

  console.log('\n' + '═'.repeat(60));
  console.log('BATCH GENERATION SUMMARY');
  console.log('═'.repeat(60));
  console.log(`Total videos: ${MARS_PROMPTS.length}`);
  console.log(`Successful: ${successCount}`);
  console.log(`Failed: ${MARS_PROMPTS.length - successCount}`);
  console.log(`Total time: ${Math.round(totalTime / 1000 / 60)} minutes`);

  console.log('\nResults:');
  results.forEach((r, i) => {
    const status = r.success ? '✅' : '❌';
    const size = r.fileSize ? `(${Math.round(r.fileSize / 1024)}KB)` : '';
    console.log(`  ${i + 1}. ${status} ${r.prompt} ${size}`);
    if (r.filePath) console.log(`     → ${r.filePath}`);
    if (r.error) console.log(`     Error: ${r.error}`);
  });

  // Save results to JSON
  const outputPath = '/Users/isaiahdupree/Downloads/sora-videos/batch-results.json';
  fs.writeFileSync(outputPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    totalVideos: MARS_PROMPTS.length,
    successCount,
    totalTimeMs: totalTime,
    results,
  }, null, 2));
  console.log(`\nResults saved to: ${outputPath}`);

  // List generated files
  console.log('\nGenerated video files:');
  results.filter(r => r.filePath).forEach(r => {
    console.log(`  ${r.filePath}`);
  });
}

runBatchGeneration().catch(console.error);
