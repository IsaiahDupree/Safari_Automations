#!/usr/bin/env npx tsx
/**
 * Sora Story Generator - Prompt Agnostic
 * Generates N videos with @isaiahdupree as the character
 * Tracks status, removes watermarks, and concatenates into final video
 * 
 * Usage:
 *   npx tsx scripts/sora-story-generator.ts --story badass
 *   npx tsx scripts/sora-story-generator.ts --story space
 *   npx tsx scripts/sora-story-generator.ts --prompts "prompt1" "prompt2" "prompt3"
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// STORY PRESETS - Add your own!
// ============================================================================

const STORY_PRESETS: Record<string, Array<{ title: string; prompt: string }>> = {
  badass: [
    {
      title: 'Chapter 1: Volcano Surfing',
      prompt: '@isaiahdupree rides a titanium surfboard down the side of an erupting volcano, molten lava spraying on both sides, wearing a flame-resistant suit with the visor up showing pure determination. Explosions of fire behind them as they carve through rivers of magma, the sky glowing orange and red.',
    },
    {
      title: 'Chapter 2: Skydive Through Lightning',
      prompt: '@isaiahdupree freefalls through a massive thunderstorm without a parachute, lightning bolts striking all around them, electricity arcing off their wingsuit. They spin and dodge between bolts, grinning as they plummet through the chaos of the storm, clouds swirling violently.',
    },
    {
      title: 'Chapter 3: Riding a Meteor',
      prompt: '@isaiahdupree stands on a flaming meteor hurtling through Earths atmosphere, the ground rapidly approaching below. Fire and plasma trail behind as they surf the space rock, then at the last second leap off and deploy a parachute as the meteor explodes into the ocean behind them in a massive impact.',
    },
  ],

  space: [
    {
      title: 'Chapter 1: Earth Departure',
      prompt: '@isaiahdupree stands at the launchpad in a sleek white spacesuit, gazing up at a massive rocket against a brilliant sunrise. Countdown begins as steam billows from the engines. The rocket ignites with a thunderous roar, and @isaiahdupree waves goodbye to Earth as the spacecraft lifts off, climbing through clouds into the darkening sky above.',
    },
    {
      title: 'Chapter 2: Moon Landing',
      prompt: '@isaiahdupree descends the ladder of the lunar module onto the grey dusty surface of the Moon. Earth hangs blue and beautiful in the black sky above. @isaiahdupree plants a flag, takes a giant leap in the low gravity, and looks toward the distant red dot of Mars with determination in their eyes.',
    },
    {
      title: 'Chapter 3: Mars Arrival',
      prompt: '@isaiahdupree emerges from the spacecraft onto the rust-red Martian surface, massive mountains and canyons visible in the distance. A dust devil swirls in the thin atmosphere. @isaiahdupree raises their arms in triumph, the first human to walk on Mars, as the sun sets casting long shadows across the alien landscape.',
    },
  ],

  action: [
    {
      title: 'Chapter 1: Building Jump',
      prompt: '@isaiahdupree sprints across a rooftop and leaps across a massive gap between skyscrapers, city lights glittering far below. Slow motion capture of the jump, arms extended, coat billowing in the wind, landing in a perfect roll on the opposite building.',
    },
    {
      title: 'Chapter 2: Car Chase',
      prompt: '@isaiahdupree drives a black sports car at high speed through narrow city streets, drifting around corners with sparks flying. Other cars crash behind them, explosions lighting up the night as they weave through traffic with incredible precision.',
    },
    {
      title: 'Chapter 3: Helicopter Escape',
      prompt: '@isaiahdupree climbs a rope ladder hanging from a helicopter as it lifts off from an exploding building. The entire structure collapses in a massive fireball behind them as they pull themselves into the helicopter, looking back at the destruction with a satisfied smile.',
    },
  ],

  nature: [
    {
      title: 'Chapter 1: Shark Dive',
      prompt: '@isaiahdupree swims freely among a school of great white sharks in crystal clear ocean water, no cage, touching the nose of the largest shark as sunbeams pierce through the surface above. The sharks circle peacefully around them.',
    },
    {
      title: 'Chapter 2: Tornado Chase',
      prompt: '@isaiahdupree stands in an open field as a massive F5 tornado approaches, hair and clothes whipping in the wind. Instead of running, they walk toward it, reaching out to touch the swirling vortex of debris and fury.',
    },
    {
      title: 'Chapter 3: Avalanche Ride',
      prompt: '@isaiahdupree snowboards down a mountain as a massive avalanche roars behind them, snow and ice crashing like a tidal wave. They outrun the wall of white, launching off a cliff and deploying a parachute as the mountain collapses below.',
    },
  ],
};

// ============================================================================
// CONFIGURATION
// ============================================================================

const WATERMARK_TOOL = '/Users/isaiahdupree/Documents/Software/MediaPoster/Backend/SoraWatermarkCleaner';

interface GenerationResult {
  chapter: number;
  title: string;
  prompt: string;
  videoPath?: string;
  cleanedPath?: string;
  success: boolean;
  error?: string;
  durationMs?: number;
}

function parseArgs(): { storyName: string; outputDir: string; prompts: Array<{ title: string; prompt: string }> } {
  const args = process.argv.slice(2);
  let storyName = 'custom';
  let prompts: Array<{ title: string; prompt: string }> = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--story' && args[i + 1]) {
      storyName = args[i + 1];
      if (STORY_PRESETS[storyName]) {
        prompts = STORY_PRESETS[storyName];
      } else {
        console.error(`Unknown story preset: ${storyName}`);
        console.error(`Available presets: ${Object.keys(STORY_PRESETS).join(', ')}`);
        process.exit(1);
      }
      i++;
    } else if (args[i] === '--prompts') {
      // Collect all remaining args as prompts
      for (let j = i + 1; j < args.length && !args[j].startsWith('--'); j++) {
        prompts.push({
          title: `Chapter ${prompts.length + 1}`,
          prompt: args[j].includes('@isaiahdupree') ? args[j] : `@isaiahdupree ${args[j]}`,
        });
      }
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
Sora Story Generator - Create epic video stories with @isaiahdupree

Usage:
  npx tsx scripts/sora-story-generator.ts --story <preset>
  npx tsx scripts/sora-story-generator.ts --prompts "prompt1" "prompt2" "prompt3"

Story Presets:
  ${Object.keys(STORY_PRESETS).map(k => `${k.padEnd(10)} - ${STORY_PRESETS[k][0].title.split(':')[1]?.trim() || k}`).join('\n  ')}

Examples:
  npx tsx scripts/sora-story-generator.ts --story badass
  npx tsx scripts/sora-story-generator.ts --story space
  npx tsx scripts/sora-story-generator.ts --prompts "riding a dragon" "fighting a giant" "celebrating victory"
`);
      process.exit(0);
    }
  }

  // Default to badass if no args
  if (prompts.length === 0) {
    storyName = 'badass';
    prompts = STORY_PRESETS.badass;
  }

  const outputDir = path.join(process.env.HOME || '', 'sora-videos', storyName);

  return { storyName, outputDir, prompts };
}

async function ensureDirectories(outputDir: string): Promise<void> {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  const cleanedDir = path.join(outputDir, 'cleaned');
  if (!fs.existsSync(cleanedDir)) {
    fs.mkdirSync(cleanedDir, { recursive: true });
  }
}

async function checkUsage(needed: number): Promise<{ available: boolean; count: number | null }> {
  console.log('\n📊 Checking Sora usage...');

  const { SoraFullAutomation } = await import('../packages/services/src/sora/sora-full-automation');
  const sora = new SoraFullAutomation();
  const usage = await sora.getUsage();

  console.log(`   Video generations remaining: ${usage.videoGensLeft ?? 'Unknown'}`);

  return {
    available: usage.videoGensLeft === null || usage.videoGensLeft >= needed,
    count: usage.videoGensLeft,
  };
}

async function generateVideo(
  chapter: { title: string; prompt: string },
  chapterNum: number,
  outputDir: string
): Promise<GenerationResult> {
  console.log(`\n🎬 CHAPTER ${chapterNum}: ${chapter.title}`);
  console.log(`   Prompt: ${chapter.prompt.slice(0, 80)}...`);

  const startTime = Date.now();
  const result: GenerationResult = {
    chapter: chapterNum,
    title: chapter.title,
    prompt: chapter.prompt,
    success: false,
  };

  try {
    const { SoraFullAutomation } = await import('../packages/services/src/sora/sora-full-automation');
    const sora = new SoraFullAutomation();

    console.log('   ⏳ Submitting prompt...');
    const genResult = await sora.fullRun(chapter.prompt);

    if (genResult.download?.success && genResult.download.filePath) {
      result.videoPath = genResult.download.filePath;
      result.success = true;
      result.durationMs = Date.now() - startTime;

      // Copy to our output directory with chapter naming
      const destPath = path.join(outputDir, `chapter-${chapterNum}-raw.mp4`);
      fs.copyFileSync(result.videoPath, destPath);
      result.videoPath = destPath;

      console.log(`   ✅ Generated: ${destPath}`);
      console.log(`   ⏱️  Duration: ${Math.round(result.durationMs / 1000)}s`);
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

async function removeWatermarks(outputDir: string): Promise<void> {
  console.log('\n🧹 Removing watermarks (batch)...');

  const cleanedDir = path.join(outputDir, 'cleaned');

  try {
    execSync(
      `cd "${WATERMARK_TOOL}" && uv run python cli.py -i "${outputDir}" -o "${cleanedDir}" -p "chapter-*-raw.mp4"`,
      { stdio: 'inherit' }
    );
    console.log('   ✅ Watermarks removed!');
  } catch (error) {
    console.log(`   ❌ Watermark removal failed: ${error instanceof Error ? error.message : 'Unknown'}`);
  }
}

async function concatenateVideos(outputDir: string, storyName: string, numChapters: number): Promise<string | null> {
  console.log('\n🎞️  Concatenating videos into final story...');

  const cleanedDir = path.join(outputDir, 'cleaned');
  const videos: string[] = [];

  // Find cleaned videos
  for (let i = 1; i <= numChapters; i++) {
    const cleanedPath = path.join(cleanedDir, `cleaned_chapter-${i}-raw.mp4`);
    const rawPath = path.join(outputDir, `chapter-${i}-raw.mp4`);

    if (fs.existsSync(cleanedPath)) {
      videos.push(cleanedPath);
    } else if (fs.existsSync(rawPath)) {
      videos.push(rawPath);
    }
  }

  if (videos.length === 0) {
    console.log('   ❌ No videos to concatenate');
    return null;
  }

  // Create a file list for ffmpeg
  const listPath = path.join(outputDir, 'concat-list.txt');
  const listContent = videos.map((v) => `file '${v}'`).join('\n');
  fs.writeFileSync(listPath, listContent);

  const finalPath = path.join(outputDir, `${storyName}-final.mp4`);

  try {
    execSync(`ffmpeg -y -f concat -safe 0 -i "${listPath}" -c copy "${finalPath}"`, { stdio: 'pipe' });

    if (fs.existsSync(finalPath)) {
      const stats = fs.statSync(finalPath);
      console.log(`✅ Final video created: ${finalPath}`);
      console.log(`   Size: ${Math.round((stats.size / 1024 / 1024) * 100) / 100}MB`);
      return finalPath;
    }
  } catch {
    // Try with re-encoding if concat copy fails
    console.log('   ⚠️  Trying with re-encoding...');
    try {
      execSync(`ffmpeg -y -f concat -safe 0 -i "${listPath}" -c:v libx264 -c:a aac "${finalPath}"`, { stdio: 'pipe' });

      if (fs.existsSync(finalPath)) {
        const stats = fs.statSync(finalPath);
        console.log(`✅ Final video created: ${finalPath}`);
        console.log(`   Size: ${Math.round((stats.size / 1024 / 1024) * 100) / 100}MB`);
        return finalPath;
      }
    } catch (e) {
      console.log(`❌ Concatenation failed: ${e instanceof Error ? e.message : 'Unknown'}`);
    }
  }

  return null;
}

async function main(): Promise<void> {
  const { storyName, outputDir, prompts } = parseArgs();

  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log(`║   SORA STORY: ${storyName.toUpperCase().padEnd(43)}║`);
  console.log('║   Starring: @isaiahdupree                                  ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  console.log(`\n📖 Story chapters:`);
  prompts.forEach((p, i) => console.log(`   ${i + 1}. ${p.title}`));

  const startTime = Date.now();

  // Setup
  await ensureDirectories(outputDir);

  // Check usage
  const usage = await checkUsage(prompts.length);
  if (!usage.available) {
    console.log(`\n❌ Not enough video generations available. Need ${prompts.length}.`);
    process.exit(1);
  }

  // Generate all chapters
  const results: GenerationResult[] = [];

  for (let i = 0; i < prompts.length; i++) {
    const chapter = prompts[i];
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`GENERATING ${i + 1}/${prompts.length}`);
    console.log('═'.repeat(60));

    const result = await generateVideo(chapter, i + 1, outputDir);
    results.push(result);

    // Progress update
    const successful = results.filter((r) => r.success).length;
    console.log(`\n📈 Progress: ${successful}/${results.length} chapters complete`);

    // Wait between generations
    if (i < prompts.length - 1) {
      console.log('   ⏳ Waiting 10s before next generation...');
      await new Promise((r) => setTimeout(r, 10000));
    }
  }

  // Remove watermarks
  console.log('\n' + '═'.repeat(60));
  console.log('REMOVING WATERMARKS');
  console.log('═'.repeat(60));

  await removeWatermarks(outputDir);

  // Concatenate videos
  const successful = results.filter((r) => r.success).length;
  if (successful > 0) {
    console.log('\n' + '═'.repeat(60));
    console.log('CREATING FINAL VIDEO');
    console.log('═'.repeat(60));

    await concatenateVideos(outputDir, storyName, prompts.length);
  }

  // Final summary
  const totalTime = Date.now() - startTime;

  console.log('\n' + '═'.repeat(60));
  console.log('SUMMARY');
  console.log('═'.repeat(60));

  console.log('\n📋 Results:');
  for (const result of results) {
    const status = result.success ? '✅' : '❌';
    console.log(`   ${status} Chapter ${result.chapter}: ${result.title}`);
    if (result.videoPath) console.log(`      Raw: ${result.videoPath}`);
    if (result.error) console.log(`      Error: ${result.error}`);
  }

  console.log(`\n📊 Stats:`);
  console.log(`   Total videos: ${successful}/${prompts.length}`);
  console.log(`   Total time: ${Math.round(totalTime / 1000 / 60)} minutes`);
  console.log(`   Output dir: ${outputDir}`);

  if (successful === prompts.length) {
    console.log(`\n🎉 COMPLETE! Your "${storyName}" story is ready!`);
    console.log(`   Final: ${path.join(outputDir, `${storyName}-final.mp4`)}`);
  }
}

main().catch(console.error);
