/**
 * Space Journey Story - Earth to Moon to Mars
 * Generates 3 videos with @isaiahdupree as the character
 * Tracks status, removes watermarks, and concatenates into final video
 */

import { execSync, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// Story prompts - incremental journey through space
const STORY_PROMPTS = [
  {
    id: 1,
    title: 'Chapter 1: Earth Departure',
    prompt: '@isaiahdupree stands at the launchpad in a sleek white spacesuit, gazing up at a massive rocket against a brilliant sunrise. Countdown begins as steam billows from the engines. The rocket ignites with a thunderous roar, and @isaiahdupree waves goodbye to Earth as the spacecraft lifts off, climbing through clouds into the darkening sky above.',
  },
  {
    id: 2,
    title: 'Chapter 2: Moon Landing',
    prompt: '@isaiahdupree descends the ladder of the lunar module onto the grey dusty surface of the Moon. Earth hangs blue and beautiful in the black sky above. @isaiahdupree plants a flag, takes a giant leap in the low gravity, and looks toward the distant red dot of Mars with determination in their eyes.',
  },
  {
    id: 3,
    title: 'Chapter 3: Mars Arrival',
    prompt: '@isaiahdupree emerges from the spacecraft onto the rust-red Martian surface, massive mountains and canyons visible in the distance. A dust devil swirls in the thin atmosphere. @isaiahdupree raises their arms in triumph, the first human to walk on Mars, as the sun sets casting long shadows across the alien landscape.',
  },
];

const OUTPUT_DIR = path.join(process.env.HOME || '', 'sora-videos', 'space-journey');
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

async function ensureDirectories(): Promise<void> {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  const cleanedDir = path.join(OUTPUT_DIR, 'cleaned');
  if (!fs.existsSync(cleanedDir)) {
    fs.mkdirSync(cleanedDir, { recursive: true });
  }
}

async function checkUsage(): Promise<{ available: boolean; count: number | null }> {
  console.log('\n📊 Checking Sora usage...');
  
  const { SoraFullAutomation } = await import('../packages/services/src/sora/sora-full-automation');
  const sora = new SoraFullAutomation();
  const usage = await sora.getUsage();
  
  console.log(`   Video generations remaining: ${usage.videoGensLeft ?? 'Unknown'}`);
  
  return {
    available: usage.videoGensLeft === null || usage.videoGensLeft >= 3,
    count: usage.videoGensLeft,
  };
}

async function generateVideo(chapter: typeof STORY_PROMPTS[0]): Promise<GenerationResult> {
  console.log(`\n🎬 CHAPTER ${chapter.id}: ${chapter.title}`);
  console.log(`   Prompt: ${chapter.prompt.slice(0, 80)}...`);
  
  const startTime = Date.now();
  const result: GenerationResult = {
    chapter: chapter.id,
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
      const destPath = path.join(OUTPUT_DIR, `chapter-${chapter.id}-raw.mp4`);
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

async function removeWatermark(inputPath: string, outputPath: string): Promise<boolean> {
  console.log(`   🧹 Removing watermark from ${path.basename(inputPath)}...`);
  
  try {
    execSync(
      `cd "${WATERMARK_TOOL}" && uv run python cli.py -i "${inputPath}" -o "${outputPath}" --pattern sora`,
      { stdio: 'pipe' }
    );
    
    if (fs.existsSync(outputPath)) {
      const stats = fs.statSync(outputPath);
      console.log(`   ✅ Cleaned: ${path.basename(outputPath)} (${Math.round(stats.size / 1024)}KB)`);
      return true;
    }
  } catch (error) {
    console.log(`   ❌ Watermark removal failed: ${error instanceof Error ? error.message : 'Unknown'}`);
  }
  
  return false;
}

async function concatenateVideos(videos: string[], outputPath: string): Promise<boolean> {
  console.log('\n🎞️  Concatenating videos into final story...');
  
  // Create a file list for ffmpeg
  const listPath = path.join(OUTPUT_DIR, 'concat-list.txt');
  const listContent = videos.map(v => `file '${v}'`).join('\n');
  fs.writeFileSync(listPath, listContent);
  
  try {
    execSync(
      `ffmpeg -y -f concat -safe 0 -i "${listPath}" -c copy "${outputPath}"`,
      { stdio: 'pipe' }
    );
    
    if (fs.existsSync(outputPath)) {
      const stats = fs.statSync(outputPath);
      console.log(`✅ Final video created: ${outputPath}`);
      console.log(`   Size: ${Math.round(stats.size / 1024 / 1024 * 100) / 100}MB`);
      return true;
    }
  } catch (error) {
    // Try with re-encoding if concat copy fails
    console.log('   ⚠️  Trying with re-encoding...');
    try {
      execSync(
        `ffmpeg -y -f concat -safe 0 -i "${listPath}" -c:v libx264 -c:a aac "${outputPath}"`,
        { stdio: 'pipe' }
      );
      
      if (fs.existsSync(outputPath)) {
        const stats = fs.statSync(outputPath);
        console.log(`✅ Final video created: ${outputPath}`);
        console.log(`   Size: ${Math.round(stats.size / 1024 / 1024 * 100) / 100}MB`);
        return true;
      }
    } catch (e) {
      console.log(`❌ Concatenation failed: ${e instanceof Error ? e.message : 'Unknown'}`);
    }
  }
  
  return false;
}

async function main(): Promise<void> {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║   SPACE JOURNEY: Earth → Moon → Mars                       ║');
  console.log('║   Starring: @isaiahdupree                                  ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  
  const startTime = Date.now();
  
  // Setup
  await ensureDirectories();
  
  // Check usage
  const usage = await checkUsage();
  if (!usage.available) {
    console.log('\n❌ Not enough video generations available. Need 3.');
    process.exit(1);
  }
  
  // Generate all 3 chapters
  const results: GenerationResult[] = [];
  
  for (const chapter of STORY_PROMPTS) {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`GENERATING ${chapter.id}/${STORY_PROMPTS.length}`);
    console.log('═'.repeat(60));
    
    const result = await generateVideo(chapter);
    results.push(result);
    
    // Progress update
    const successful = results.filter(r => r.success).length;
    console.log(`\n📈 Progress: ${successful}/${results.length} chapters complete`);
    
    // Wait between generations
    if (chapter.id < STORY_PROMPTS.length) {
      console.log('   ⏳ Waiting 10s before next generation...');
      await new Promise(r => setTimeout(r, 10000));
    }
  }
  
  // Remove watermarks from successful videos
  console.log('\n' + '═'.repeat(60));
  console.log('REMOVING WATERMARKS');
  console.log('═'.repeat(60));
  
  const cleanedVideos: string[] = [];
  
  for (const result of results) {
    if (result.success && result.videoPath) {
      const cleanedPath = path.join(OUTPUT_DIR, 'cleaned', `chapter-${result.chapter}-clean.mp4`);
      const success = await removeWatermark(result.videoPath, cleanedPath);
      
      if (success) {
        result.cleanedPath = cleanedPath;
        cleanedVideos.push(cleanedPath);
      } else {
        // Use raw video if watermark removal fails
        cleanedVideos.push(result.videoPath);
      }
    }
  }
  
  // Concatenate videos
  if (cleanedVideos.length === 3) {
    console.log('\n' + '═'.repeat(60));
    console.log('CREATING FINAL VIDEO');
    console.log('═'.repeat(60));
    
    const finalPath = path.join(OUTPUT_DIR, 'space-journey-final.mp4');
    await concatenateVideos(cleanedVideos, finalPath);
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
    if (result.cleanedPath) console.log(`      Clean: ${result.cleanedPath}`);
    if (result.error) console.log(`      Error: ${result.error}`);
  }
  
  const successful = results.filter(r => r.success).length;
  console.log(`\n📊 Stats:`);
  console.log(`   Total videos: ${successful}/${STORY_PROMPTS.length}`);
  console.log(`   Total time: ${Math.round(totalTime / 1000 / 60)} minutes`);
  console.log(`   Output dir: ${OUTPUT_DIR}`);
  
  if (successful === 3) {
    console.log(`\n🎉 COMPLETE! Your space journey video is ready!`);
    console.log(`   Final: ${path.join(OUTPUT_DIR, 'space-journey-final.mp4')}`);
  }
}

main().catch(console.error);
