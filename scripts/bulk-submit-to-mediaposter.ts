#!/usr/bin/env npx tsx
/**
 * Bulk Submit Videos to MediaPoster
 * 
 * Submits ALL ready videos to MediaPoster in one batch operation.
 * MediaPoster's smart-schedule handles optimal timing automatically.
 * 
 * Features:
 * - Bulk submit all videos at once (no daily cron needed)
 * - Tracks submission state in local JSON file
 * - Reports when all videos are successfully submitted
 * - Resumes from where it left off if interrupted
 * 
 * Usage:
 *   npx tsx scripts/bulk-submit-to-mediaposter.ts
 *   npx tsx scripts/bulk-submit-to-mediaposter.ts --dry-run
 *   npx tsx scripts/bulk-submit-to-mediaposter.ts --reset  # Clear state and resubmit all
 */

import * as fs from 'fs';
import * as path from 'path';

const READY_DIR = path.join(process.env.HOME || '', 'sora-videos/ready-to-post');
const POSTED_DIR = path.join(process.env.HOME || '', 'sora-videos/posted');
const STATE_FILE = path.join(process.env.HOME || '', 'sora-videos/.submission-state.json');
const MEDIAPOSTER_URL = process.env.MEDIAPOSTER_URL || 'http://localhost:5555';

interface SubmissionState {
  lastRun: string;
  submitted: Record<string, {
    videoId: string;
    submittedAt: string;
    platforms: string[];
    status: 'pending' | 'scheduled' | 'posted' | 'failed';
  }>;
  totalSubmitted: number;
  totalFailed: number;
}

interface SubmitResult {
  filename: string;
  success: boolean;
  videoId?: string;
  scheduledPosts?: any[];
  error?: string;
}

const DEFAULT_PLATFORMS = ['tiktok', 'youtube'];

function loadState(): SubmissionState {
  if (fs.existsSync(STATE_FILE)) {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
  }
  return {
    lastRun: '',
    submitted: {},
    totalSubmitted: 0,
    totalFailed: 0,
  };
}

function saveState(state: SubmissionState): void {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function getReadyVideos(): string[] {
  if (!fs.existsSync(READY_DIR)) {
    return [];
  }
  return fs.readdirSync(READY_DIR)
    .filter(f => f.endsWith('.mp4'))
    .sort()
    .map(f => path.join(READY_DIR, f));
}

async function submitVideo(videoPath: string): Promise<SubmitResult> {
  const filename = path.basename(videoPath);
  const baseName = path.basename(videoPath, '.mp4').replace('_ready', '');
  
  try {
    // Use smart-schedule endpoint - MediaPoster decides optimal times
    const response = await fetch(`${MEDIAPOSTER_URL}/api/external/smart-schedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        video_path: videoPath,
        title: `Badass Marathon - ${baseName}`,
        caption: `🔥 Daily motivation! #badass #motivation #ai #sora`,
        hashtags: ['#badass', '#motivation', '#ai', '#sora', '#viral'],
        platforms: DEFAULT_PLATFORMS,
        source_id: `safari-bulk-${baseName}-${Date.now()}`,
        source_system: 'safari-automation-bulk',
      }),
    });
    
    if (response.ok) {
      const result = await response.json() as any;
      return {
        filename,
        success: true,
        videoId: result.video_id,
        scheduledPosts: result.scheduled_posts,
      };
    } else {
      const errorText = await response.text();
      return {
        filename,
        success: false,
        error: `HTTP ${response.status}: ${errorText.substring(0, 200)}`,
      };
    }
  } catch (error) {
    return {
      filename,
      success: false,
      error: String(error),
    };
  }
}

function moveToPosted(videoPath: string): void {
  if (!fs.existsSync(POSTED_DIR)) {
    fs.mkdirSync(POSTED_DIR, { recursive: true });
  }
  const filename = path.basename(videoPath);
  const destPath = path.join(POSTED_DIR, filename);
  fs.renameSync(videoPath, destPath);
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const reset = args.includes('--reset');
  
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║        📤 Bulk Submit to MediaPoster                         ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`\n📅 ${new Date().toISOString()}`);
  console.log(`📁 Source: ${READY_DIR}`);
  console.log(`🎯 Platforms: ${DEFAULT_PLATFORMS.join(', ')}`);
  if (dryRun) console.log('🔄 Mode: DRY RUN');
  
  // Load or reset state
  let state = reset ? {
    lastRun: '',
    submitted: {},
    totalSubmitted: 0,
    totalFailed: 0,
  } : loadState();
  
  if (reset) {
    console.log('🔄 State reset - will resubmit all videos\n');
  }
  
  // Get all ready videos
  const allVideos = getReadyVideos();
  console.log(`\n📹 Found ${allVideos.length} videos in ready-to-post/`);
  
  // Filter out already submitted
  const alreadySubmitted = Object.keys(state.submitted);
  const toSubmit = allVideos.filter(v => {
    const filename = path.basename(v);
    return !alreadySubmitted.includes(filename);
  });
  
  if (alreadySubmitted.length > 0) {
    console.log(`✅ Already submitted: ${alreadySubmitted.length}`);
  }
  console.log(`📤 To submit: ${toSubmit.length}`);
  
  if (toSubmit.length === 0) {
    console.log('\n✅ ALL VIDEOS ALREADY SUBMITTED!');
    console.log(`   Total in state: ${state.totalSubmitted} submitted, ${state.totalFailed} failed`);
    console.log(`   Last run: ${state.lastRun}`);
    return;
  }
  
  console.log('\n─── SUBMITTING ───────────────────────────────────────────────\n');
  
  const results: SubmitResult[] = [];
  
  for (let i = 0; i < toSubmit.length; i++) {
    const videoPath = toSubmit[i];
    const filename = path.basename(videoPath);
    
    console.log(`[${i + 1}/${toSubmit.length}] 📹 ${filename}`);
    
    if (dryRun) {
      console.log(`    ⏭️  [DRY RUN] Would submit to MediaPoster`);
      results.push({ filename, success: true, videoId: 'dry-run' });
      continue;
    }
    
    const result = await submitVideo(videoPath);
    results.push(result);
    
    if (result.success) {
      console.log(`    ✅ Submitted! Video ID: ${result.videoId}`);
      if (result.scheduledPosts) {
        result.scheduledPosts.forEach((post: any) => {
          const time = post.allocated_time || post.scheduled_at;
          console.log(`       📅 ${post.platform}: ${time ? new Date(time).toLocaleString() : 'queued'}`);
        });
      }
      
      // Update state
      state.submitted[filename] = {
        videoId: result.videoId || 'unknown',
        submittedAt: new Date().toISOString(),
        platforms: DEFAULT_PLATFORMS,
        status: 'scheduled',
      };
      state.totalSubmitted++;
      
      // Move to posted
      moveToPosted(videoPath);
      console.log(`    📁 Moved to posted/`);
    } else {
      console.log(`    ❌ Failed: ${result.error}`);
      state.totalFailed++;
    }
    
    // Save state after each video (resume support)
    state.lastRun = new Date().toISOString();
    saveState(state);
    
    // Small delay between submissions
    if (i < toSubmit.length - 1) {
      await new Promise(r => setTimeout(r, 500));
    }
  }
  
  // Final summary
  const succeeded = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  
  console.log('\n' + '═'.repeat(60));
  console.log('📊 BULK SUBMISSION COMPLETE');
  console.log('═'.repeat(60));
  console.log(`\nThis batch:`);
  console.log(`  Submitted: ${succeeded} ✅`);
  console.log(`  Failed:    ${failed} ❌`);
  
  console.log(`\nAll-time totals:`);
  console.log(`  Total submitted: ${state.totalSubmitted}`);
  console.log(`  Total failed:    ${state.totalFailed}`);
  
  // Check remaining
  const remainingVideos = getReadyVideos();
  if (remainingVideos.length === 0) {
    console.log('\n🎉 ALL VIDEOS SUCCESSFULLY SUBMITTED TO MEDIAPOSTER!');
    console.log('   MediaPoster will handle optimal scheduling automatically.');
  } else {
    console.log(`\n⚠️  ${remainingVideos.length} videos still in ready-to-post/ (failed submissions)`);
  }
  
  console.log(`\n📁 State saved to: ${STATE_FILE}`);
  console.log(`📁 Posted videos: ${POSTED_DIR}`);
  console.log('\n');
}

main().catch(console.error);
