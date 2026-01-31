#!/usr/bin/env npx tsx
/**
 * Daily MediaPoster Scheduler
 * 
 * Sends videos from ready-to-post folder to MediaPoster External Scheduling API.
 * Videos are scheduled via Blotato for YouTube and TikTok posting.
 * 
 * Uses: /api/external/submit endpoint
 * Docs: MediaPoster/docs/EXTERNAL_SCHEDULING_API.md
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
const MEDIAPOSTER_BASE_URL = process.env.MEDIAPOSTER_URL || 'http://localhost:5555';

// Blotato Account IDs (from EXTERNAL_SCHEDULING_API.md)
const BLOTATO_ACCOUNTS = {
  tiktok: '710',      // @isaiah_dupree
  youtube: '228',     // Isaiah Dupree
  instagram: '807',   // @the_isaiah_dupree
};

interface ScheduleTarget {
  platform: string;
  account_id: string;
  scheduled_at: string;
  title?: string;
  caption?: string;
}

interface ScheduleConfig {
  videosPerDay: number;
  platforms: string[];
  character: string;
  postIntervalHours: number;  // Hours between TikTok and YouTube posts
}

interface PostResult {
  video: string;
  success: boolean;
  videoId?: string;
  scheduledPosts?: any[];
  error?: string;
}

const DEFAULT_CONFIG: ScheduleConfig = {
  videosPerDay: 2,           // Post 2 videos per day
  platforms: ['tiktok', 'youtube'],
  character: 'isaiahdupree',
  postIntervalHours: 1,      // YouTube posts 1 hour after TikTok
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
 * Build schedule targets for a video
 * Schedules TikTok first, then YouTube 1 hour later
 */
function buildScheduleTargets(config: ScheduleConfig, baseTime: Date): ScheduleTarget[] {
  const targets: ScheduleTarget[] = [];
  
  config.platforms.forEach((platform, index) => {
    const accountId = BLOTATO_ACCOUNTS[platform as keyof typeof BLOTATO_ACCOUNTS];
    if (!accountId) {
      console.warn(`    ⚠️  Unknown platform: ${platform}`);
      return;
    }
    
    // Stagger posts by postIntervalHours
    const scheduledTime = new Date(baseTime.getTime() + (index * config.postIntervalHours * 60 * 60 * 1000));
    
    targets.push({
      platform,
      account_id: accountId,
      scheduled_at: scheduledTime.toISOString(),
    });
  });
  
  return targets;
}

/**
 * Send video to MediaPoster External Scheduling API
 * Uses /api/external/submit endpoint with Blotato account IDs
 */
async function sendToMediaPoster(videoPath: string, config: ScheduleConfig, videoIndex: number): Promise<PostResult> {
  const filename = path.basename(videoPath);
  const baseName = path.basename(videoPath, '.mp4').replace('_ready', '');
  
  // Calculate scheduled time (stagger videos throughout the day)
  // First video at 12 PM, second at 3 PM, etc.
  const baseTime = new Date();
  baseTime.setHours(12 + (videoIndex * 3), 0, 0, 0);  // 12 PM, 3 PM, 6 PM...
  
  // If time has passed today, schedule for tomorrow
  if (baseTime < new Date()) {
    baseTime.setDate(baseTime.getDate() + 1);
  }
  
  const targets = buildScheduleTargets(config, baseTime);
  
  try {
    const response = await fetch(`${MEDIAPOSTER_BASE_URL}/api/external/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        video_url: `file://${videoPath}`,  // Local file path
        video_path: videoPath,              // Alternative for local files
        title: `Badass Marathon - ${baseName}`,
        caption: `🔥 Daily motivation! #badass #motivation #ai #sora`,
        hashtags: ['#badass', '#motivation', '#ai', '#sora', '#viral'],
        targets,
        source_id: `safari-${baseName}-${Date.now()}`,
        source_system: 'safari-automation-hq-pipeline',
      }),
    });
    
    if (response.ok) {
      const result = await response.json() as any;
      return { 
        video: filename, 
        success: true, 
        videoId: result.video_id,
        scheduledPosts: result.scheduled_posts,
      };
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
      console.log(`    ⏭️  [DRY RUN] Would send to MediaPoster External API`);
      console.log(`    🎯 Targets: TikTok (710), YouTube (228)`);
      results.push({ video: filename, success: true, videoId: 'dry-run' });
    } else {
      const result = await sendToMediaPoster(video, { ...DEFAULT_CONFIG, videosPerDay: limit }, i);
      results.push(result);
      
      if (result.success) {
        console.log(`    ✅ Scheduled! Video ID: ${result.videoId}`);
        if (result.scheduledPosts) {
          result.scheduledPosts.forEach((post: any) => {
            console.log(`       📅 ${post.platform}: ${new Date(post.scheduled_at).toLocaleString()}`);
          });
        }
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
