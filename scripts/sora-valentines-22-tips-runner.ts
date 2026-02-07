#!/usr/bin/env npx tsx
/**
 * Sora Valentine's Day 22 Tips Video Runner
 * 22 Unique Videos — one per Valentine's Day tip featuring @isaiahdupree
 * 
 * References:
 *   - SoraFullAutomation: packages/services/src/sora/sora-full-automation.ts
 *   - SoraSelectors:      packages/services/src/sora/sora-selectors.ts  
 *   - SafariExecutor:     packages/services/src/safari/safari-executor.ts
 *   - Story Generator:    packages/services/src/sora/story-generator.ts
 *   - Tips Content:       content/valentines-day-tips-2026.md
 *   - Video Config:       sora-valentines-22-tips.json
 * 
 * Usage:
 *   npx tsx scripts/sora-valentines-22-tips-runner.ts              # Run all 22
 *   npx tsx scripts/sora-valentines-22-tips-runner.ts 5            # Start from video 5
 *   npx tsx scripts/sora-valentines-22-tips-runner.ts --credits    # Check credits only
 *   npx tsx scripts/sora-valentines-22-tips-runner.ts --list       # List all 22 prompts
 *   npx tsx scripts/sora-valentines-22-tips-runner.ts --dry-run    # Preview without generating
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Config paths
const CONFIG_FILE = path.join(__dirname, '..', 'sora-valentines-22-tips.json');
const OUTPUT_DIR = path.join(process.env.HOME || '', 'sora-videos', 'valentines-22-tips');

// Automation engine loaded dynamically (same pattern as sora-valentines-runner.ts)
// Source: packages/services/src/sora/sora-full-automation.ts
// This class handles: navigate to sora.chatgpt.com → enter prompt with @isaiahdupree prefix
// → click Create → poll drafts page → detect spinner (circle.-rotate-90) → download video
//
// Also available but not used directly here:
// - SoraRealAutomation (packages/services/src/sora/sora-real-automation.ts) — alternative automation
// - SORA_SELECTORS (packages/services/src/sora/sora-selectors.ts) — verified CSS selectors
// - SoraStoryGenerator (packages/services/src/sora/story-generator.ts) — AI prompt generation
// - SoraRateLimiter (packages/services/src/sora/sora-rate-limiter.ts) — rate limiting

async function loadSoraAutomation() {
  const { SoraFullAutomation } = await import('../packages/services/src/sora/sora-full-automation');
  return SoraFullAutomation;
}

interface VideoConfig {
  id: number;
  tipTitle: string;
  prompt: string;
}

interface RunConfig {
  generatedAt: string;
  character: string;
  theme: string;
  totalVideos: number;
  videos: VideoConfig[];
}

interface VideoResult {
  id: number;
  tipTitle: string;
  success: boolean;
  filePath?: string;
  fileSize?: number;
  timeMs?: number;
  error?: string;
}

// ============================================================================
// COMMANDS
// ============================================================================

async function checkCredits(): Promise<number | null> {
  console.log('\n📊 Checking Sora credits...');
  const SoraFullAutomation = await loadSoraAutomation();
  const sora = new SoraFullAutomation();
  const usage = await sora.getUsage();

  console.log(`   Video gens left: ${usage.videoGensLeft ?? 'Unknown'}`);
  console.log(`   Free: ${usage.freeCount ?? '?'}`);
  console.log(`   Paid: ${usage.paidCount ?? '?'}`);
  if (usage.nextAvailableDate) {
    console.log(`   More available: ${usage.nextAvailableDate}`);
  }
  return usage.videoGensLeft;
}

function listVideos(config: RunConfig): void {
  console.log(`\n📋 ${config.totalVideos} Valentine's Day Tip Videos:\n`);
  for (const video of config.videos) {
    console.log(`  ${String(video.id).padStart(2)}. ${video.tipTitle}`);
    console.log(`      ${video.prompt.slice(0, 90)}...`);
    console.log();
  }
}

async function generateVideo(video: VideoConfig, outputDir: string): Promise<VideoResult> {
  const startTime = Date.now();
  const SoraFullAutomation = await loadSoraAutomation();
  const sora = new SoraFullAutomation();

  console.log(`\n┌${'─'.repeat(68)}┐`);
  console.log(`│ 🎬 VIDEO ${String(video.id).padStart(2)}/22: ${video.tipTitle.toUpperCase().slice(0, 50).padEnd(50)} │`);
  console.log(`└${'─'.repeat(68)}┘`);
  console.log(`Prompt: ${video.prompt.slice(0, 100)}...`);
  console.log('⏳ Submitting to Sora...\n');

  try {
    // SoraFullAutomation.fullRun() does:
    // 1. submitPrompt() — navigates to sora.chatgpt.com, enters prompt via React-compatible
    //    textarea setter (JS_SET_TEXTAREA_VALUE from sora-selectors.ts), clicks "Create video"
    // 2. pollUntilReady() — navigates to /drafts, checks for spinner (circle.-rotate-90),
    //    waits for video element with src and readyState=4, includes mouse wiggle at poll 15+
    //    and Safari recovery at poll 30
    // 3. downloadVideo() — downloads via curl to ~/Downloads/sora-videos/
    const result = await sora.fullRun(video.prompt);

    const timeMs = Date.now() - startTime;

    if (result.download?.success && result.download.filePath) {
      const destPath = path.join(outputDir, `tip-${String(video.id).padStart(2, '0')}-${video.tipTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}.mp4`);
      fs.copyFileSync(result.download.filePath, destPath);
      const fileSize = fs.statSync(destPath).size;

      console.log(`✅ Video ${video.id}/22 generated: ${destPath}`);
      console.log(`   Size: ${Math.round(fileSize / 1024)}KB | Time: ${Math.round(timeMs / 1000)}s`);

      return { id: video.id, tipTitle: video.tipTitle, success: true, filePath: destPath, fileSize, timeMs };
    } else {
      const error = result.download?.error || result.poll?.error || result.submit.error || 'Unknown error';
      console.log(`❌ Video ${video.id}/22 failed: ${error}`);
      return { id: video.id, tipTitle: video.tipTitle, success: false, error, timeMs };
    }
  } catch (error) {
    const timeMs = Date.now() - startTime;
    const errMsg = error instanceof Error ? error.message : 'Unknown error';
    console.log(`❌ Video ${video.id}/22 error: ${errMsg}`);
    return { id: video.id, tipTitle: video.tipTitle, success: false, error: errMsg, timeMs };
  }
}

// ============================================================================
// MAIN
// ============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Header
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║   💝 SORA VALENTINE\'S DAY — 22 TIPS VIDEO GENERATOR 💝              ║');
  console.log('║   @isaiahdupree — One Video Per Tip                                 ║');
  console.log('║   22 Unique Standalone Videos                                       ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');

  // Load config
  if (!fs.existsSync(CONFIG_FILE)) {
    console.error(`\n❌ Config not found: ${CONFIG_FILE}`);
    console.error('   Expected: sora-valentines-22-tips.json in project root');
    process.exit(1);
  }
  const config: RunConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));

  // Handle flags
  if (args.includes('--credits')) {
    await checkCredits();
    return;
  }

  if (args.includes('--list')) {
    listVideos(config);
    return;
  }

  if (args.includes('--dry-run')) {
    listVideos(config);
    console.log('\n🔍 DRY RUN — No videos will be generated.');
    const credits = await checkCredits();
    console.log(`\n   Videos to generate: ${config.totalVideos}`);
    console.log(`   Credits available: ${credits ?? 'Unknown'}`);
    if (credits !== null && credits < config.totalVideos) {
      console.log(`   ⚠️  Not enough credits. Will generate ${credits} of ${config.totalVideos}.`);
    }
    return;
  }

  // Determine starting video
  const startFrom = parseInt(args[0] || '1', 10);
  if (startFrom < 1 || startFrom > 22) {
    console.error(`\n❌ Invalid start video: ${startFrom}. Must be 1-22.`);
    process.exit(1);
  }

  // Show plan
  console.log(`\n💝 Videos to generate: ${config.totalVideos - startFrom + 1} (starting from #${startFrom})`);
  for (const v of config.videos) {
    const marker = v.id < startFrom ? '⏭️ ' : '🎬';
    console.log(`   ${marker} ${String(v.id).padStart(2)}. ${v.tipTitle}`);
  }

  // Check credits
  console.log('\n📊 Checking Sora credits...');
  const credits = await checkCredits();
  const videosNeeded = config.totalVideos - startFrom + 1;

  if (credits !== null && credits < videosNeeded) {
    console.log(`\n⚠️  Only ${credits} credits available, need ${videosNeeded}. Will generate as many as possible.`);
  }

  // Create output directory
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  console.log(`\n📂 Output: ${OUTPUT_DIR}`);

  // Wait between videos (seconds)
  const WAIT_BETWEEN = 20000; // 20s between videos

  // Run generation
  console.log(`\n🚀 Starting generation from video #${startFrom}...\n`);
  const startTime = Date.now();
  const results: VideoResult[] = [];

  for (const video of config.videos) {
    if (video.id < startFrom) {
      console.log(`⏭️  Skipping #${video.id}: ${video.tipTitle}`);
      continue;
    }

    const result = await generateVideo(video, OUTPUT_DIR);
    results.push(result);

    // Save progress after each video
    const progressPath = path.join(OUTPUT_DIR, 'progress.json');
    fs.writeFileSync(progressPath, JSON.stringify({
      startedAt: new Date(startTime).toISOString(),
      lastUpdated: new Date().toISOString(),
      startedFrom: startFrom,
      results,
      completed: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      remaining: config.totalVideos - startFrom + 1 - results.length,
    }, null, 2));

    // Wait between videos (unless last one)
    if (video.id < config.totalVideos) {
      console.log(`\n⏳ Waiting ${WAIT_BETWEEN / 1000}s before next video...`);
      await new Promise(r => setTimeout(r, WAIT_BETWEEN));
    }
  }

  // Final summary
  const totalTime = Math.round((Date.now() - startTime) / 1000 / 60);
  const completed = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  console.log('\n' + '═'.repeat(70));
  console.log('💝 FINAL SUMMARY — Valentine\'s 22 Tips Videos');
  console.log('═'.repeat(70));
  console.log(`   ✅ Completed: ${completed}/${results.length}`);
  console.log(`   ❌ Failed: ${failed}/${results.length}`);
  console.log(`   ⏱️  Total time: ${totalTime} minutes`);
  console.log(`   📂 Output: ${OUTPUT_DIR}`);

  if (failed > 0) {
    console.log('\n   Failed videos:');
    for (const r of results.filter(r => !r.success)) {
      console.log(`     #${r.id} ${r.tipTitle}: ${r.error}`);
    }
    console.log(`\n   To retry failed videos, run from the first failed ID:`);
    const firstFailed = results.find(r => !r.success);
    if (firstFailed) {
      console.log(`     npx tsx scripts/sora-valentines-22-tips-runner.ts ${firstFailed.id}`);
    }
  }

  console.log('\n💝 Happy Valentine\'s Day! @isaiahdupree');
}

main().catch(err => {
  console.error('❌ Fatal error:', err.message);
  process.exit(1);
});
