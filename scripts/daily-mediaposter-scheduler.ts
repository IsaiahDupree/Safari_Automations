#!/usr/bin/env npx tsx
/**
 * Daily MediaPoster Scheduler
 * 
 * Sends videos from ready-to-post folder to MediaPoster for YouTube and TikTok.
 * Designed to run once per day via cron or manually.
 * 
 * Usage:
 *   npx tsx scripts/daily-mediaposter-scheduler.ts
 *   npx tsx scripts/daily-mediaposter-scheduler.ts --dry-run
 *   npx tsx scripts/daily-mediaposter-scheduler.ts --limit 5
 */

import * as fs from 'fs';
import * as path from 'path';

const READY_DIR = path.join(process.env.HOME || '', 'sora-videos/ready-to-post');
const POSTED_DIR = path.join(process.env.HOME || '', 'sora-videos/posted');
const MEDIAPOSTER_URL = process.env.MEDIAPOSTER_WEBHOOK_URL || 'http://localhost:5555/api/webhooks/video-ready';

interface ScheduleConfig {
  videosPerDay: number;
  platforms: string[];
  character: string;
  autoPublish: boolean;
}

interface PostResult {
  video: string;
  success: boolean;
  jobId?: string;
  error?: string;
}

const DEFAULT_CONFIG: ScheduleConfig = {
  videosPerDay: 2,  // Post 2 videos per day (1 YouTube, 1 TikTok each)
  platforms: ['youtube', 'tiktok'],
  character: 'isaiahdupree',
  autoPublish: false,  // Queue for review first
};

/**
 * Get videos ready to post
 */
function getReadyVideos(): string[] {
  if (!fs.existsSync(READY_DIR)) {
    return [];
  }
  
  return fs.readdirSync(READY_DIR)
    .filter(f => f.endsWith('.mp4'))
    .sort()
    .map(f => path.join(READY_DIR, f));
}

/**
 * Send video to MediaPoster
 */
async function sendToMediaPoster(videoPath: string, config: ScheduleConfig): Promise<PostResult> {
  const filename = path.basename(videoPath);
  
  try {
    const response = await fetch(MEDIAPOSTER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        video_path: videoPath,
        source: 'sora',
        character: config.character,
        platforms: config.platforms,
        auto_publish: config.autoPublish,
        metadata: {
          processed_by: 'safari-automation-hq-pipeline',
          series: 'badass-marathon',
          scheduled_date: new Date().toISOString().split('T')[0],
        },
      }),
    });
    
    if (response.ok) {
      const result = await response.json() as any;
      return { video: filename, success: true, jobId: result.job_id };
    } else {
      const errorText = await response.text();
      return { video: filename, success: false, error: `HTTP ${response.status}: ${errorText}` };
    }
  } catch (error) {
    return { video: filename, success: false, error: String(error) };
  }
}

/**
 * Move video to posted folder
 */
function moveToPosted(videoPath: string): void {
  if (!fs.existsSync(POSTED_DIR)) {
    fs.mkdirSync(POSTED_DIR, { recursive: true });
  }
  
  const filename = path.basename(videoPath);
  const destPath = path.join(POSTED_DIR, filename);
  fs.renameSync(videoPath, destPath);
}

/**
 * Main scheduler
 */
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const limitArg = args.find(a => a.startsWith('--limit'));
  const limit = limitArg ? parseInt(args[args.indexOf(limitArg) + 1] || '2', 10) : DEFAULT_CONFIG.videosPerDay;
  
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║        📤 Daily MediaPoster Scheduler                        ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`\n📅 Date: ${new Date().toISOString().split('T')[0]}`);
  console.log(`📁 Source: ${READY_DIR}`);
  console.log(`🎯 Platforms: ${DEFAULT_CONFIG.platforms.join(', ')}`);
  console.log(`📊 Videos per day: ${limit}`);
  console.log(`🔄 Dry run: ${dryRun ? 'YES' : 'NO'}`);
  
  const videos = getReadyVideos();
  console.log(`\n📹 Found ${videos.length} videos ready to post`);
  
  if (videos.length === 0) {
    console.log('\n✅ No videos to post today.');
    return;
  }
  
  const toPost = videos.slice(0, limit);
  console.log(`📤 Will post ${toPost.length} videos today\n`);
  
  const results: PostResult[] = [];
  
  for (let i = 0; i < toPost.length; i++) {
    const video = toPost[i];
    const filename = path.basename(video);
    
    console.log(`[${i + 1}/${toPost.length}] 📹 ${filename}`);
    
    if (dryRun) {
      console.log(`    ⏭️  [DRY RUN] Would send to MediaPoster`);
      results.push({ video: filename, success: true, jobId: 'dry-run' });
    } else {
      const result = await sendToMediaPoster(video, { ...DEFAULT_CONFIG, videosPerDay: limit });
      results.push(result);
      
      if (result.success) {
        console.log(`    ✅ Sent! Job ID: ${result.jobId}`);
        moveToPosted(video);
        console.log(`    📁 Moved to posted/`);
      } else {
        console.log(`    ❌ Failed: ${result.error}`);
      }
    }
  }
  
  // Summary
  const succeeded = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  
  console.log('\n' + '═'.repeat(50));
  console.log('📊 DAILY SCHEDULE SUMMARY');
  console.log('═'.repeat(50));
  console.log(`Sent:    ${succeeded} ✅`);
  console.log(`Failed:  ${failed} ❌`);
  console.log(`Remaining: ${videos.length - toPost.length} videos`);
  
  if (!dryRun && succeeded > 0) {
    console.log(`\n📁 Posted videos moved to: ${POSTED_DIR}`);
  }
  
  // Show remaining schedule
  const remaining = videos.length - toPost.length;
  if (remaining > 0) {
    const daysLeft = Math.ceil(remaining / limit);
    console.log(`\n📅 At ${limit} videos/day, ${remaining} videos will take ${daysLeft} more days`);
  }
  
  console.log('\n');
}

main().catch(console.error);
