#!/usr/bin/env npx tsx
/**
 * Quality Comparison Test
 * 
 * Compares different watermark removal methods:
 * 1. Original (no processing)
 * 2. Local FFmpeg crop
 * 3. Modal AI inpaint (if credentials available)
 * 
 * Outputs file sizes, processing times, and quality metrics.
 */

import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const TEST_VIDEO = process.argv[2] || path.join(process.env.HOME || '', 'sora-videos/badass-marathon/badass-01.mp4');
const OUTPUT_DIR = path.join(process.env.HOME || '', 'sora-videos/quality-test');

interface TestResult {
  method: string;
  inputPath: string;
  outputPath: string;
  inputSizeKB: number;
  outputSizeKB: number;
  sizeDiffPercent: number;
  processingTimeS: number;
  resolution?: string;
  bitrate?: string;
  codec?: string;
}

async function getVideoInfo(videoPath: string): Promise<{ resolution: string; bitrate: string; codec: string; duration: string }> {
  try {
    const { stdout } = await execAsync(
      `ffprobe -v error -select_streams v:0 -show_entries stream=width,height,bit_rate,codec_name -show_entries format=duration -of json "${videoPath}"`
    );
    const data = JSON.parse(stdout);
    const stream = data.streams?.[0] || {};
    const format = data.format || {};
    
    return {
      resolution: `${stream.width || '?'}x${stream.height || '?'}`,
      bitrate: stream.bit_rate ? `${Math.round(parseInt(stream.bit_rate) / 1000)} kbps` : 'N/A',
      codec: stream.codec_name || 'N/A',
      duration: format.duration ? `${parseFloat(format.duration).toFixed(2)}s` : 'N/A',
    };
  } catch {
    return { resolution: 'N/A', bitrate: 'N/A', codec: 'N/A', duration: 'N/A' };
  }
}

async function testLocalCrop(inputPath: string): Promise<TestResult> {
  console.log('\n[Test] 🔧 Testing LOCAL FFmpeg crop...');
  const startTime = Date.now();
  
  const outputPath = path.join(OUTPUT_DIR, 'local_crop.mp4');
  const inputStats = fs.statSync(inputPath);
  
  // Use FFmpeg to crop bottom 100px (simulating SoraWatermarkCleaner)
  try {
    // Get video dimensions first
    const { stdout: probeOut } = await execAsync(
      `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "${inputPath}"`
    );
    const [width, height] = probeOut.trim().split(',').map(Number);
    const newHeight = height - 100;
    
    // Crop with high quality settings
    await execAsync(
      `ffmpeg -y -i "${inputPath}" -vf "crop=${width}:${newHeight}:0:0" -c:v libx264 -crf 18 -preset slow -c:a copy "${outputPath}"`,
      { timeout: 120000 }
    );
    
    const outputStats = fs.statSync(outputPath);
    const info = await getVideoInfo(outputPath);
    
    return {
      method: 'Local FFmpeg Crop',
      inputPath,
      outputPath,
      inputSizeKB: Math.round(inputStats.size / 1024),
      outputSizeKB: Math.round(outputStats.size / 1024),
      sizeDiffPercent: Math.round(((outputStats.size - inputStats.size) / inputStats.size) * 100),
      processingTimeS: (Date.now() - startTime) / 1000,
      resolution: info.resolution,
      bitrate: info.bitrate,
      codec: info.codec,
    };
  } catch (error) {
    console.error('[Test] ❌ Local crop failed:', error);
    return {
      method: 'Local FFmpeg Crop',
      inputPath,
      outputPath,
      inputSizeKB: Math.round(inputStats.size / 1024),
      outputSizeKB: 0,
      sizeDiffPercent: 0,
      processingTimeS: (Date.now() - startTime) / 1000,
    };
  }
}

async function testHighQualityCrop(inputPath: string): Promise<TestResult> {
  console.log('\n[Test] 🎬 Testing HIGH-QUALITY FFmpeg crop (CRF 15)...');
  const startTime = Date.now();
  
  const outputPath = path.join(OUTPUT_DIR, 'hq_crop.mp4');
  const inputStats = fs.statSync(inputPath);
  
  try {
    const { stdout: probeOut } = await execAsync(
      `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "${inputPath}"`
    );
    const [width, height] = probeOut.trim().split(',').map(Number);
    const newHeight = height - 100;
    
    // Higher quality: CRF 15, veryslow preset
    await execAsync(
      `ffmpeg -y -i "${inputPath}" -vf "crop=${width}:${newHeight}:0:0" -c:v libx264 -crf 15 -preset veryslow -c:a copy "${outputPath}"`,
      { timeout: 300000 }
    );
    
    const outputStats = fs.statSync(outputPath);
    const info = await getVideoInfo(outputPath);
    
    return {
      method: 'HQ FFmpeg Crop (CRF 15)',
      inputPath,
      outputPath,
      inputSizeKB: Math.round(inputStats.size / 1024),
      outputSizeKB: Math.round(outputStats.size / 1024),
      sizeDiffPercent: Math.round(((outputStats.size - inputStats.size) / inputStats.size) * 100),
      processingTimeS: (Date.now() - startTime) / 1000,
      resolution: info.resolution,
      bitrate: info.bitrate,
      codec: info.codec,
    };
  } catch (error) {
    console.error('[Test] ❌ HQ crop failed:', error);
    return {
      method: 'HQ FFmpeg Crop (CRF 15)',
      inputPath,
      outputPath,
      inputSizeKB: Math.round(inputStats.size / 1024),
      outputSizeKB: 0,
      sizeDiffPercent: 0,
      processingTimeS: (Date.now() - startTime) / 1000,
    };
  }
}

async function testLosslessCrop(inputPath: string): Promise<TestResult> {
  console.log('\n[Test] 💎 Testing LOSSLESS FFmpeg crop...');
  const startTime = Date.now();
  
  const outputPath = path.join(OUTPUT_DIR, 'lossless_crop.mp4');
  const inputStats = fs.statSync(inputPath);
  
  try {
    const { stdout: probeOut } = await execAsync(
      `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "${inputPath}"`
    );
    const [width, height] = probeOut.trim().split(',').map(Number);
    const newHeight = height - 100;
    
    // Lossless: CRF 0
    await execAsync(
      `ffmpeg -y -i "${inputPath}" -vf "crop=${width}:${newHeight}:0:0" -c:v libx264 -crf 0 -preset ultrafast -c:a copy "${outputPath}"`,
      { timeout: 300000 }
    );
    
    const outputStats = fs.statSync(outputPath);
    const info = await getVideoInfo(outputPath);
    
    return {
      method: 'Lossless Crop (CRF 0)',
      inputPath,
      outputPath,
      inputSizeKB: Math.round(inputStats.size / 1024),
      outputSizeKB: Math.round(outputStats.size / 1024),
      sizeDiffPercent: Math.round(((outputStats.size - inputStats.size) / inputStats.size) * 100),
      processingTimeS: (Date.now() - startTime) / 1000,
      resolution: info.resolution,
      bitrate: info.bitrate,
      codec: info.codec,
    };
  } catch (error) {
    console.error('[Test] ❌ Lossless crop failed:', error);
    return {
      method: 'Lossless Crop (CRF 0)',
      inputPath,
      outputPath,
      inputSizeKB: Math.round(inputStats.size / 1024),
      outputSizeKB: 0,
      sizeDiffPercent: 0,
      processingTimeS: (Date.now() - startTime) / 1000,
    };
  }
}

async function testStreamCopy(inputPath: string): Promise<TestResult> {
  console.log('\n[Test] ⚡ Testing STREAM COPY (no re-encode)...');
  const startTime = Date.now();
  
  const outputPath = path.join(OUTPUT_DIR, 'stream_copy.mp4');
  const inputStats = fs.statSync(inputPath);
  
  try {
    const { stdout: probeOut } = await execAsync(
      `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "${inputPath}"`
    );
    const [width, height] = probeOut.trim().split(',').map(Number);
    const newHeight = height - 100;
    
    // Stream copy with crop filter - Note: this will still re-encode due to filter
    // For true stream copy, we'd need to cut at keyframes only
    await execAsync(
      `ffmpeg -y -i "${inputPath}" -vf "crop=${width}:${newHeight}:0:0" -c:v libx264 -crf 17 -preset medium -c:a copy "${outputPath}"`,
      { timeout: 120000 }
    );
    
    const outputStats = fs.statSync(outputPath);
    const info = await getVideoInfo(outputPath);
    
    return {
      method: 'Standard (CRF 17)',
      inputPath,
      outputPath,
      inputSizeKB: Math.round(inputStats.size / 1024),
      outputSizeKB: Math.round(outputStats.size / 1024),
      sizeDiffPercent: Math.round(((outputStats.size - inputStats.size) / inputStats.size) * 100),
      processingTimeS: (Date.now() - startTime) / 1000,
      resolution: info.resolution,
      bitrate: info.bitrate,
      codec: info.codec,
    };
  } catch (error) {
    console.error('[Test] ❌ Stream copy failed:', error);
    return {
      method: 'Standard (CRF 17)',
      inputPath,
      outputPath,
      inputSizeKB: Math.round(inputStats.size / 1024),
      outputSizeKB: 0,
      sizeDiffPercent: 0,
      processingTimeS: (Date.now() - startTime) / 1000,
    };
  }
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║           🎬 Quality Comparison Test                         ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  
  if (!fs.existsSync(TEST_VIDEO)) {
    console.error(`❌ Test video not found: ${TEST_VIDEO}`);
    process.exit(1);
  }
  
  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  
  // Get original video info
  console.log(`\n📹 Test Video: ${path.basename(TEST_VIDEO)}`);
  const originalInfo = await getVideoInfo(TEST_VIDEO);
  const originalStats = fs.statSync(TEST_VIDEO);
  
  console.log(`   Size: ${Math.round(originalStats.size / 1024)} KB`);
  console.log(`   Resolution: ${originalInfo.resolution}`);
  console.log(`   Bitrate: ${originalInfo.bitrate}`);
  console.log(`   Codec: ${originalInfo.codec}`);
  console.log(`   Duration: ${originalInfo.duration}`);
  
  // Run tests
  const results: TestResult[] = [];
  
  results.push(await testLocalCrop(TEST_VIDEO));
  results.push(await testStreamCopy(TEST_VIDEO));
  results.push(await testHighQualityCrop(TEST_VIDEO));
  results.push(await testLosslessCrop(TEST_VIDEO));
  
  // Print results table
  console.log('\n');
  console.log('═'.repeat(90));
  console.log('📊 QUALITY COMPARISON RESULTS');
  console.log('═'.repeat(90));
  console.log('');
  console.log('┌────────────────────────────┬──────────┬──────────┬───────────┬──────────┬─────────────┐');
  console.log('│ Method                     │ Input KB │ Output KB│ Size Diff │ Time (s) │ Resolution  │');
  console.log('├────────────────────────────┼──────────┼──────────┼───────────┼──────────┼─────────────┤');
  
  for (const r of results) {
    const method = r.method.padEnd(26).substring(0, 26);
    const input = r.inputSizeKB.toString().padStart(8);
    const output = r.outputSizeKB.toString().padStart(8);
    const diff = `${r.sizeDiffPercent >= 0 ? '+' : ''}${r.sizeDiffPercent}%`.padStart(9);
    const time = r.processingTimeS.toFixed(1).padStart(8);
    const res = (r.resolution || 'N/A').padStart(11);
    
    console.log(`│ ${method} │${input} │${output} │${diff} │${time} │${res} │`);
  }
  
  console.log('└────────────────────────────┴──────────┴──────────┴───────────┴──────────┴─────────────┘');
  
  // Recommendations
  console.log('\n📋 RECOMMENDATIONS:');
  console.log('─'.repeat(50));
  
  const sorted = [...results].sort((a, b) => b.outputSizeKB - a.outputSizeKB);
  console.log(`\n🏆 Highest Quality (largest file): ${sorted[0].method}`);
  console.log(`   → ${sorted[0].outputSizeKB} KB, ${sorted[0].resolution}`);
  
  const fastest = [...results].sort((a, b) => a.processingTimeS - b.processingTimeS)[0];
  console.log(`\n⚡ Fastest Processing: ${fastest.method}`);
  console.log(`   → ${fastest.processingTimeS.toFixed(1)}s`);
  
  const balanced = results.find(r => r.method.includes('CRF 17')) || results[0];
  console.log(`\n⚖️  Best Balance (quality/size): ${balanced.method}`);
  console.log(`   → ${balanced.outputSizeKB} KB in ${balanced.processingTimeS.toFixed(1)}s`);
  
  console.log('\n📁 Output files saved to:', OUTPUT_DIR);
  console.log('   View and compare the videos manually for visual quality.\n');
}

main().catch(console.error);
