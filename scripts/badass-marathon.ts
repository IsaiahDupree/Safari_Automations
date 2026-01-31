#!/usr/bin/env npx tsx
/**
 * Badass Marathon - 17 Epic Videos for @isaiahdupree
 * The most amazing, badass scenarios ever conceived
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const WATERMARK_TOOL = '/Users/isaiahdupree/Documents/Software/MediaPoster/Backend/SoraWatermarkCleaner';
const OUTPUT_DIR = path.join(process.env.HOME || '', 'sora-videos', 'badass-marathon');

// 17 EPIC BADASS PROMPTS
const PROMPTS = [
  // 1. Ocean/Water
  '@isaiahdupree surfs a 100-foot tsunami wave in downtown Tokyo, buildings crumbling around them as they carve through the massive wall of water with perfect form, city lights reflecting off the spray.',
  
  // 2. Space Combat
  '@isaiahdupree pilots a fighter jet through an asteroid field, dodging massive rocks while being chased by enemy ships, explosions lighting up the void of space as they perform impossible maneuvers.',
  
  // 3. Wildlife
  '@isaiahdupree rides on the back of a charging T-Rex through a prehistoric jungle, velociraptors running alongside, volcanic eruptions in the background as they lead a dinosaur stampede.',
  
  // 4. Urban Legend
  '@isaiahdupree backflips off the top of the Burj Khalifa at night, freefalling past thousands of lit windows, then opens a wingsuit and glides between skyscrapers in Dubai.',
  
  // 5. Natural Disaster
  '@isaiahdupree outruns a pyroclastic flow on a motorcycle, the volcanic ash cloud consuming everything behind them, lava rivers on both sides of the road, jumping over a collapsed bridge.',
  
  // 6. Arctic
  '@isaiahdupree ice climbs a collapsing glacier with bare hands, massive chunks of ice falling around them, a polar bear watching from above, aurora borealis dancing in the sky.',
  
  // 7. Combat
  '@isaiahdupree stands alone in a colosseum, surrounded by 100 armored warriors, swords clashing, spinning and fighting with impossible martial arts as sparks fly in slow motion.',
  
  // 8. Racing
  '@isaiahdupree drifts a Formula 1 car through the Monaco Grand Prix at night during a thunderstorm, sparks flying from the undercarriage, passing opponents on the hairpin turns.',
  
  // 9. Supernatural
  '@isaiahdupree walks calmly through a raging wildfire, flames parting around them like Moses parting the sea, animals following behind to safety, embers swirling like fireflies.',
  
  // 10. Tech/Future
  '@isaiahdupree hacks into a massive holographic display in Times Square, code raining down like The Matrix, drones swarming as they reprogram the entire city grid.',
  
  // 11. Aviation
  '@isaiahdupree wingwalks on a biplane doing barrel rolls through the Grand Canyon at sunset, standing on top with arms spread, canyon walls blurring past inches away.',
  
  // 12. Deep Sea
  '@isaiahdupree descends into the Mariana Trench in a glass sphere, bioluminescent creatures surrounding them, a giant squid wrapping tentacles around the vessel.',
  
  // 13. Mountain
  '@isaiahdupree free solos El Capitan in a thunderstorm, lightning striking the rock face around them, rain pouring, making the final pull onto the summit as the sun breaks through.',
  
  // 14. Desert
  '@isaiahdupree races a sandstorm across the Sahara on a jet-powered hoverboard, ancient pyramids emerging from the dunes, the wall of sand consuming everything behind.',
  
  // 15. Urban Parkour
  '@isaiahdupree performs parkour across Hong Kong rooftops at night, neon signs everywhere, jumping impossible gaps, sliding under AC units, the city a blur of color below.',
  
  // 16. Mythological
  '@isaiahdupree tames a dragon mid-flight over a burning medieval city, grabbing its horns and redirecting it away from the castle, knights watching in awe from below.',
  
  // 17. Ultimate Finale
  '@isaiahdupree stands at the edge of a black hole, time warping around them, stars stretching into lines, reaching out to touch the event horizon as reality bends and fractures.',
];

interface GenerationResult {
  index: number;
  prompt: string;
  success: boolean;
  videoPath?: string;
  cleanedPath?: string;
  error?: string;
  durationMs?: number;
}

async function ensureDirectories(): Promise<void> {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  const cleanedDir = path.join(OUTPUT_DIR, 'cleaned');
  if (!fs.existsSync(cleanedDir)) {
    fs.mkdirSync(cleanedDir, { recursive: true });
  }
}

async function checkUsage(): Promise<number | null> {
  console.log('\n📊 Checking Sora usage...');
  try {
    const { SoraFullAutomation } = await import('../packages/services/src/sora/sora-full-automation');
    const sora = new SoraFullAutomation();
    const usage = await sora.getUsage();
    console.log(`   Video generations remaining: ${usage.videoGensLeft ?? 'Unknown'}`);
    return usage.videoGensLeft;
  } catch (error) {
    console.log(`   ⚠️  Could not check usage: ${error}`);
    return null;
  }
}

async function generateVideo(prompt: string, index: number): Promise<GenerationResult> {
  const startTime = Date.now();
  const result: GenerationResult = {
    index,
    prompt: prompt.slice(0, 60) + '...',
    success: false,
  };

  try {
    const { SoraFullAutomation } = await import('../packages/services/src/sora/sora-full-automation');
    const sora = new SoraFullAutomation();

    console.log(`   ⏳ Submitting prompt...`);
    const genResult = await sora.fullRun(prompt);

    if (genResult.download?.success && genResult.download.filePath) {
      // Copy to our output directory
      const destPath = path.join(OUTPUT_DIR, `badass-${String(index).padStart(2, '0')}.mp4`);
      fs.copyFileSync(genResult.download.filePath, destPath);
      result.videoPath = destPath;
      result.success = true;
      result.durationMs = Date.now() - startTime;
      console.log(`   ✅ Generated: ${destPath}`);
    } else {
      result.error = genResult.download?.error || genResult.poll?.error || genResult.submit.error || 'Unknown error';
      console.log(`   ❌ Failed: ${result.error}`);
    }
  } catch (error) {
    result.error = error instanceof Error ? error.message : 'Unknown error';
    console.log(`   ❌ Error: ${result.error}`);
  }

  return result;
}

async function removeWatermarks(): Promise<void> {
  console.log('\n🧹 Removing watermarks from all videos...');
  const cleanedDir = path.join(OUTPUT_DIR, 'cleaned');
  try {
    execSync(
      `cd "${WATERMARK_TOOL}" && uv run python cli.py -i "${OUTPUT_DIR}" -o "${cleanedDir}" -p "badass-*.mp4"`,
      { stdio: 'inherit', timeout: 1800000 } // 30 min timeout for batch
    );
    console.log('   ✅ Watermarks removed!');
  } catch (error) {
    console.log(`   ❌ Watermark removal failed: ${error instanceof Error ? error.message : 'Unknown'}`);
  }
}

async function main(): Promise<void> {
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║          🔥 BADASS MARATHON - 17 EPIC VIDEOS 🔥                      ║');
  console.log('║                    Starring: @isaiahdupree                           ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');

  await ensureDirectories();

  // Check usage
  const available = await checkUsage();
  if (available !== null && available < PROMPTS.length) {
    console.log(`\n⚠️  Only ${available} generations available. Will generate as many as possible.`);
  }

  const startTime = Date.now();
  const results: GenerationResult[] = [];
  let consecutiveFailures = 0;

  for (let i = 0; i < PROMPTS.length; i++) {
    const prompt = PROMPTS[i];
    
    console.log(`\n${'═'.repeat(70)}`);
    console.log(`🎬 VIDEO ${i + 1}/${PROMPTS.length}`);
    console.log(`${'═'.repeat(70)}`);
    console.log(`📝 ${prompt.slice(0, 100)}...`);

    const result = await generateVideo(prompt, i + 1);
    results.push(result);

    // Track failures
    if (!result.success) {
      consecutiveFailures++;
      if (consecutiveFailures >= 3) {
        console.log('\n⚠️  3 consecutive failures - may have hit rate limit. Waiting 5 minutes...');
        await new Promise(r => setTimeout(r, 300000));
        consecutiveFailures = 0;
      }
    } else {
      consecutiveFailures = 0;
    }

    // Progress update
    const successful = results.filter(r => r.success).length;
    console.log(`\n📈 Progress: ${successful}/${results.length} videos generated`);

    // Wait between generations
    if (i < PROMPTS.length - 1 && result.success) {
      console.log('   ⏳ Waiting 15s before next generation...');
      await new Promise(r => setTimeout(r, 15000));
    }
  }

  // Remove watermarks from all successful videos
  const successfulCount = results.filter(r => r.success).length;
  if (successfulCount > 0) {
    console.log(`\n${'═'.repeat(70)}`);
    console.log('REMOVING WATERMARKS');
    console.log('═'.repeat(70));
    await removeWatermarks();
  }

  // Final summary
  const totalTime = Date.now() - startTime;
  console.log(`\n${'═'.repeat(70)}`);
  console.log('📊 FINAL SUMMARY');
  console.log('═'.repeat(70));

  console.log('\n✅ SUCCESSFUL:');
  for (const r of results.filter(r => r.success)) {
    console.log(`   ${r.index}. ${r.prompt}`);
    if (r.videoPath) console.log(`      📁 ${r.videoPath}`);
  }

  const failed = results.filter(r => !r.success);
  if (failed.length > 0) {
    console.log('\n❌ FAILED:');
    for (const r of failed) {
      console.log(`   ${r.index}. ${r.prompt}`);
      console.log(`      Error: ${r.error}`);
    }
  }

  console.log(`\n📊 Stats:`);
  console.log(`   Total videos: ${successfulCount}/${PROMPTS.length}`);
  console.log(`   Total time: ${Math.round(totalTime / 1000 / 60)} minutes`);
  console.log(`   Output dir: ${OUTPUT_DIR}`);
  console.log(`   Cleaned dir: ${path.join(OUTPUT_DIR, 'cleaned')}`);

  if (successfulCount > 0) {
    console.log(`\n🎉 BADASS MARATHON COMPLETE!`);
  }
}

main().catch(console.error);
