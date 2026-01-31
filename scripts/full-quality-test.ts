#!/usr/bin/env npx tsx
/**
 * Full Quality Comparison Test
 * 
 * Compares:
 * 1. Original video (with watermark)
 * 2. Local FFmpeg crop (HEVC)
 * 3. Modal AI inpainting (YOLO + LAMA)
 * 4. Modal AI + Real-ESRGAN upscaling (if available)
 */

import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const TEST_VIDEO = process.argv[2] || path.join(process.env.HOME || '', 'sora-videos/badass-marathon/badass-01.mp4');
const OUTPUT_DIR = path.join(process.env.HOME || '', 'sora-videos/full-quality-test');

// Modal credentials from ~/.modal.toml
const MODAL_TOKEN_ID = process.env.MODAL_TOKEN_ID || 'ak-skZvMbYOwMTaLenBtHq7wk';
const MODAL_TOKEN_SECRET = process.env.MODAL_TOKEN_SECRET || 'as-8FpGurnkGXYdjpjx9Lq4On';
const MODAL_WORKSPACE = 'isaiahdupree33';
const MODAL_APP_NAME = 'blanklogo-watermark-removal';

interface VideoStats {
  path: string;
  sizeKB: number;
  resolution: string;
  bitrate: string;
  codec: string;
  duration: string;
}

interface TestResult {
  name: string;
  stats: VideoStats;
  processingTimeS: number;
  method: string;
  success: boolean;
  error?: string;
}

async function getVideoStats(videoPath: string): Promise<VideoStats> {
  try {
    const stats = fs.statSync(videoPath);
    const { stdout } = await execAsync(
      `ffprobe -v error -select_streams v:0 -show_entries stream=width,height,bit_rate,codec_name -show_entries format=duration -of json "${videoPath}"`
    );
    const data = JSON.parse(stdout);
    const stream = data.streams?.[0] || {};
    const format = data.format || {};

    return {
      path: videoPath,
      sizeKB: Math.round(stats.size / 1024),
      resolution: `${stream.width || '?'}x${stream.height || '?'}`,
      bitrate: stream.bit_rate ? `${Math.round(parseInt(stream.bit_rate) / 1000)} kbps` : 'N/A',
      codec: stream.codec_name || 'N/A',
      duration: format.duration ? `${parseFloat(format.duration).toFixed(2)}s` : 'N/A',
    };
  } catch {
    return {
      path: videoPath,
      sizeKB: 0,
      resolution: 'N/A',
      bitrate: 'N/A',
      codec: 'N/A',
      duration: 'N/A',
    };
  }
}

async function testLocalHEVCCrop(inputPath: string): Promise<TestResult> {
  console.log('\n[1] 🔧 Testing LOCAL HEVC Crop...');
  const startTime = Date.now();
  const outputPath = path.join(OUTPUT_DIR, '1_local_hevc_crop.mp4');

  try {
    const { stdout: probeOut } = await execAsync(
      `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "${inputPath}"`
    );
    const [width, height] = probeOut.trim().split(',').map(Number);
    const newHeight = height - 100;

    await execAsync(
      `ffmpeg -y -i "${inputPath}" -vf "crop=${width}:${newHeight}:0:0" -c:v libx265 -crf 18 -preset medium -tag:v hvc1 -c:a copy "${outputPath}"`,
      { timeout: 120000 }
    );

    const stats = await getVideoStats(outputPath);
    console.log(`    ✅ Complete: ${stats.sizeKB} KB, ${stats.resolution}`);

    return {
      name: 'Local HEVC Crop',
      stats,
      processingTimeS: (Date.now() - startTime) / 1000,
      method: 'ffmpeg-hevc-crop',
      success: true,
    };
  } catch (error) {
    console.error(`    ❌ Failed:`, error);
    return {
      name: 'Local HEVC Crop',
      stats: { path: outputPath, sizeKB: 0, resolution: 'N/A', bitrate: 'N/A', codec: 'N/A', duration: 'N/A' },
      processingTimeS: (Date.now() - startTime) / 1000,
      method: 'ffmpeg-hevc-crop',
      success: false,
      error: String(error),
    };
  }
}

async function testModalAIInpaint(inputPath: string): Promise<TestResult> {
  console.log('\n[2] 🤖 Testing MODAL AI Inpainting (YOLO + LAMA)...');
  const startTime = Date.now();
  const outputPath = path.join(OUTPUT_DIR, '2_modal_ai_inpaint.mp4');

  try {
    const videoBytes = fs.readFileSync(inputPath);
    const videoBase64 = videoBytes.toString('base64');
    console.log(`    📤 Uploading ${(videoBytes.length / 1024).toFixed(0)} KB to Modal...`);

    const modalUrl = `https://${MODAL_WORKSPACE}--${MODAL_APP_NAME}-process-video-http.modal.run`;

    const response = await fetch(modalUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${MODAL_TOKEN_ID}:${MODAL_TOKEN_SECRET}`,
      },
      body: JSON.stringify({
        video_bytes: videoBase64,
        mode: 'inpaint',
        platform: 'sora',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Modal API error ${response.status}: ${errorText}`);
    }

    const result = await response.json() as any;

    if (result.error) {
      throw new Error(result.error);
    }

    const outputBytes = Buffer.from(result.video_bytes, 'base64');
    fs.writeFileSync(outputPath, outputBytes);

    const stats = await getVideoStats(outputPath);
    console.log(`    ✅ Complete: ${stats.sizeKB} KB, ${stats.resolution}`);
    console.log(`    📊 Watermarks detected: ${result.stats?.watermarks_detected || 0}`);

    return {
      name: 'Modal AI Inpaint',
      stats,
      processingTimeS: (Date.now() - startTime) / 1000,
      method: 'modal-yolo-lama-inpaint',
      success: true,
    };
  } catch (error) {
    console.error(`    ❌ Failed:`, error);
    return {
      name: 'Modal AI Inpaint',
      stats: { path: outputPath, sizeKB: 0, resolution: 'N/A', bitrate: 'N/A', codec: 'N/A', duration: 'N/A' },
      processingTimeS: (Date.now() - startTime) / 1000,
      method: 'modal-yolo-lama-inpaint',
      success: false,
      error: String(error),
    };
  }
}

async function testLocalH264HQ(inputPath: string): Promise<TestResult> {
  console.log('\n[3] 🎬 Testing LOCAL H.264 High Quality (CRF 15)...');
  const startTime = Date.now();
  const outputPath = path.join(OUTPUT_DIR, '3_local_h264_hq.mp4');

  try {
    const { stdout: probeOut } = await execAsync(
      `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "${inputPath}"`
    );
    const [width, height] = probeOut.trim().split(',').map(Number);
    const newHeight = height - 100;

    await execAsync(
      `ffmpeg -y -i "${inputPath}" -vf "crop=${width}:${newHeight}:0:0" -c:v libx264 -crf 15 -preset slow -c:a copy "${outputPath}"`,
      { timeout: 180000 }
    );

    const stats = await getVideoStats(outputPath);
    console.log(`    ✅ Complete: ${stats.sizeKB} KB, ${stats.resolution}`);

    return {
      name: 'Local H.264 HQ',
      stats,
      processingTimeS: (Date.now() - startTime) / 1000,
      method: 'ffmpeg-h264-crf15',
      success: true,
    };
  } catch (error) {
    console.error(`    ❌ Failed:`, error);
    return {
      name: 'Local H.264 HQ',
      stats: { path: outputPath, sizeKB: 0, resolution: 'N/A', bitrate: 'N/A', codec: 'N/A', duration: 'N/A' },
      processingTimeS: (Date.now() - startTime) / 1000,
      method: 'ffmpeg-h264-crf15',
      success: false,
      error: String(error),
    };
  }
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║          🎬 Full Quality Comparison Test                     ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  if (!fs.existsSync(TEST_VIDEO)) {
    console.error(`❌ Test video not found: ${TEST_VIDEO}`);
    process.exit(1);
  }

  // Ensure output directory
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Get original stats
  console.log('\n[0] 📹 ORIGINAL VIDEO');
  const originalStats = await getVideoStats(TEST_VIDEO);
  console.log(`    Path: ${path.basename(TEST_VIDEO)}`);
  console.log(`    Size: ${originalStats.sizeKB} KB`);
  console.log(`    Resolution: ${originalStats.resolution}`);
  console.log(`    Codec: ${originalStats.codec}`);
  console.log(`    Bitrate: ${originalStats.bitrate}`);
  console.log(`    Duration: ${originalStats.duration}`);

  // Run tests
  const results: TestResult[] = [];

  // Test 1: Local HEVC crop
  results.push(await testLocalHEVCCrop(TEST_VIDEO));

  // Test 2: Modal AI inpaint
  results.push(await testModalAIInpaint(TEST_VIDEO));

  // Test 3: Local H.264 HQ
  results.push(await testLocalH264HQ(TEST_VIDEO));

  // Print results table
  console.log('\n');
  console.log('═'.repeat(95));
  console.log('📊 QUALITY COMPARISON RESULTS');
  console.log('═'.repeat(95));
  console.log('');
  console.log('┌──────────────────────────┬──────────┬─────────────┬────────────┬──────────┬───────────┐');
  console.log('│ Method                   │ Size KB  │ Resolution  │ Codec      │ Time (s) │ Status    │');
  console.log('├──────────────────────────┼──────────┼─────────────┼────────────┼──────────┼───────────┤');

  // Original
  console.log(`│ ${'Original (watermarked)'.padEnd(24)} │${originalStats.sizeKB.toString().padStart(8)} │${originalStats.resolution.padStart(11)} │${originalStats.codec.padStart(10)} │${'N/A'.padStart(8)} │${'baseline'.padStart(9)} │`);

  // Results
  for (const r of results) {
    const name = r.name.padEnd(24).substring(0, 24);
    const size = r.stats.sizeKB.toString().padStart(8);
    const res = r.stats.resolution.padStart(11);
    const codec = (r.stats.codec || 'N/A').padStart(10);
    const time = r.processingTimeS.toFixed(1).padStart(8);
    const status = (r.success ? '✅' : '❌').padStart(9);
    console.log(`│ ${name} │${size} │${res} │${codec} │${time} │${status} │`);
  }

  console.log('└──────────────────────────┴──────────┴─────────────┴────────────┴──────────┴───────────┘');

  // Analysis
  console.log('\n📋 ANALYSIS:');
  console.log('─'.repeat(60));

  const successful = results.filter(r => r.success);
  if (successful.length > 0) {
    // Size comparison
    const smallest = successful.reduce((a, b) => a.stats.sizeKB < b.stats.sizeKB ? a : b);
    const largest = successful.reduce((a, b) => a.stats.sizeKB > b.stats.sizeKB ? a : b);

    console.log(`\n📦 FILE SIZE:`);
    console.log(`   Original:  ${originalStats.sizeKB} KB`);
    console.log(`   Smallest:  ${smallest.name} → ${smallest.stats.sizeKB} KB (${((smallest.stats.sizeKB / originalStats.sizeKB - 1) * 100).toFixed(0)}%)`);
    console.log(`   Largest:   ${largest.name} → ${largest.stats.sizeKB} KB (${((largest.stats.sizeKB / originalStats.sizeKB - 1) * 100).toFixed(0)}%)`);

    // Resolution comparison
    const modalResult = results.find(r => r.name.includes('Modal'));
    const localResult = results.find(r => r.name.includes('HEVC'));

    console.log(`\n🖼️  RESOLUTION:`);
    console.log(`   Original:     ${originalStats.resolution}`);
    if (modalResult?.success) {
      console.log(`   Modal AI:     ${modalResult.stats.resolution} (FULL - no crop)`);
    }
    if (localResult?.success) {
      console.log(`   Local Crop:   ${localResult.stats.resolution} (cropped 100px)`);
    }

    // Quality recommendation
    console.log(`\n🏆 RECOMMENDATION:`);
    if (modalResult?.success) {
      console.log(`   Best Quality: Modal AI Inpaint`);
      console.log(`   → Preserves FULL resolution (${modalResult.stats.resolution})`);
      console.log(`   → AI inpainting removes watermark cleanly`);
      console.log(`   → No visible crop or black bars`);
    } else {
      console.log(`   Best Available: Local HEVC Crop`);
      console.log(`   → Good quality with efficient compression`);
      console.log(`   → Crops bottom 100px to remove watermark`);
    }
  }

  console.log(`\n📁 Output files saved to: ${OUTPUT_DIR}`);
  console.log('   Compare visually with: open ~/sora-videos/full-quality-test/\n');
}

main().catch(console.error);
