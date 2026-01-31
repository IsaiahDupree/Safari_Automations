#!/usr/bin/env npx tsx
/**
 * Batch Video Processing Pipeline
 * 
 * 1. Organizes videos into proper directories
 * 2. Processes with Modal AI inpainting (watermark removal)
 * 3. Enhances with H.264 high-quality encoding
 * 4. Moves to ready-to-post folder for MediaPoster
 * 
 * Directory Structure:
 *   ~/sora-videos/originals/      - Original watermarked videos
 *   ~/sora-videos/ai-cleaned/     - AI inpainted (watermark removed)
 *   ~/sora-videos/enhanced/       - H.264 enhanced quality
 *   ~/sora-videos/ready-to-post/  - Ready for MediaPoster
 */

import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Configuration
const DIRS = {
  originals: path.join(process.env.HOME || '', 'sora-videos/originals'),
  aiCleaned: path.join(process.env.HOME || '', 'sora-videos/ai-cleaned'),
  enhanced: path.join(process.env.HOME || '', 'sora-videos/enhanced'),
  readyToPost: path.join(process.env.HOME || '', 'sora-videos/ready-to-post'),
};

// Modal credentials from ~/.modal.toml
const MODAL_TOKEN_ID = process.env.MODAL_TOKEN_ID || 'ak-skZvMbYOwMTaLenBtHq7wk';
const MODAL_TOKEN_SECRET = process.env.MODAL_TOKEN_SECRET || 'as-8FpGurnkGXYdjpjx9Lq4On';
const MODAL_WORKSPACE = 'isaiahdupree33';
const MODAL_APP_NAME = 'blanklogo-watermark-removal';

interface ProcessingResult {
  video: string;
  success: boolean;
  originalPath?: string;
  aiCleanedPath?: string;
  enhancedPath?: string;
  readyPath?: string;
  error?: string;
  stats?: {
    originalSizeKB: number;
    aiCleanedSizeKB: number;
    enhancedSizeKB: number;
    watermarksDetected: number;
    totalTimeS: number;
  };
}

/**
 * Ensure all directories exist
 */
function ensureDirectories(): void {
  Object.values(DIRS).forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
}

/**
 * Process video with Modal AI inpainting
 */
async function processWithModalAI(inputPath: string, outputPath: string): Promise<{ success: boolean; watermarksDetected: number; error?: string }> {
  console.log(`    🤖 Modal AI inpainting...`);
  
  try {
    const videoBytes = fs.readFileSync(inputPath);
    const videoBase64 = videoBytes.toString('base64');
    
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
      return { success: false, watermarksDetected: 0, error: `Modal API error ${response.status}: ${errorText}` };
    }
    
    const result = await response.json() as any;
    
    if (result.error) {
      return { success: false, watermarksDetected: 0, error: result.error };
    }
    
    const outputBytes = Buffer.from(result.video_bytes, 'base64');
    fs.writeFileSync(outputPath, outputBytes);
    
    return { success: true, watermarksDetected: result.stats?.watermarks_detected || 0 };
  } catch (error) {
    return { success: false, watermarksDetected: 0, error: String(error) };
  }
}

/**
 * Enhance video with H.264 high-quality encoding
 */
async function enhanceWithH264(inputPath: string, outputPath: string): Promise<{ success: boolean; error?: string }> {
  console.log(`    🎬 H.264 enhancement (CRF 17)...`);
  
  try {
    // High-quality H.264 encoding with CRF 17
    await execAsync(
      `ffmpeg -y -i "${inputPath}" -c:v libx264 -crf 17 -preset slow -profile:v high -level 4.1 -pix_fmt yuv420p -c:a aac -b:a 192k "${outputPath}"`,
      { timeout: 300000 }
    );
    
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

/**
 * Process a single video through the full pipeline
 */
async function processVideo(inputPath: string, baseName: string): Promise<ProcessingResult> {
  const startTime = Date.now();
  const result: ProcessingResult = {
    video: baseName,
    success: false,
  };
  
  try {
    // Step 1: Copy original to originals folder
    result.originalPath = path.join(DIRS.originals, `${baseName}.mp4`);
    if (!fs.existsSync(result.originalPath)) {
      fs.copyFileSync(inputPath, result.originalPath);
    }
    const originalSize = fs.statSync(result.originalPath).size / 1024;
    
    // Step 2: AI inpainting
    result.aiCleanedPath = path.join(DIRS.aiCleaned, `${baseName}_ai.mp4`);
    const aiResult = await processWithModalAI(result.originalPath, result.aiCleanedPath);
    
    if (!aiResult.success) {
      result.error = `AI inpainting failed: ${aiResult.error}`;
      return result;
    }
    
    const aiCleanedSize = fs.statSync(result.aiCleanedPath).size / 1024;
    
    // Step 3: H.264 enhancement
    result.enhancedPath = path.join(DIRS.enhanced, `${baseName}_enhanced.mp4`);
    const enhanceResult = await enhanceWithH264(result.aiCleanedPath, result.enhancedPath);
    
    if (!enhanceResult.success) {
      result.error = `H.264 enhancement failed: ${enhanceResult.error}`;
      return result;
    }
    
    const enhancedSize = fs.statSync(result.enhancedPath).size / 1024;
    
    // Step 4: Copy to ready-to-post
    result.readyPath = path.join(DIRS.readyToPost, `${baseName}_ready.mp4`);
    fs.copyFileSync(result.enhancedPath, result.readyPath);
    
    result.success = true;
    result.stats = {
      originalSizeKB: Math.round(originalSize),
      aiCleanedSizeKB: Math.round(aiCleanedSize),
      enhancedSizeKB: Math.round(enhancedSize),
      watermarksDetected: aiResult.watermarksDetected,
      totalTimeS: (Date.now() - startTime) / 1000,
    };
    
    return result;
  } catch (error) {
    result.error = String(error);
    return result;
  }
}

/**
 * Main batch processing
 */
async function main() {
  const args = process.argv.slice(2);
  const inputDir = args[0] || path.join(process.env.HOME || '', 'sora-videos/badass-marathon');
  
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║        🎬 Batch Video Processing Pipeline                    ║');
  console.log('║        Modal AI Inpainting + H.264 Enhancement               ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  
  // Ensure directories
  ensureDirectories();
  
  // Find videos
  const videos = fs.readdirSync(inputDir)
    .filter(f => f.endsWith('.mp4') && !f.includes('cleaned') && !f.includes('enhanced'))
    .sort();
  
  console.log(`\n📁 Source: ${inputDir}`);
  console.log(`📹 Found ${videos.length} videos to process\n`);
  console.log('📂 Output Structure:');
  console.log(`   originals/     → Original watermarked videos`);
  console.log(`   ai-cleaned/    → AI inpainted (watermark removed)`);
  console.log(`   enhanced/      → H.264 enhanced quality`);
  console.log(`   ready-to-post/ → Ready for MediaPoster`);
  console.log('');
  
  const results: ProcessingResult[] = [];
  
  for (let i = 0; i < videos.length; i++) {
    const video = videos[i];
    const baseName = path.basename(video, '.mp4');
    const inputPath = path.join(inputDir, video);
    
    console.log(`\n[${i + 1}/${videos.length}] 📹 ${video}`);
    console.log('─'.repeat(50));
    
    const result = await processVideo(inputPath, baseName);
    results.push(result);
    
    if (result.success) {
      console.log(`    ✅ Complete!`);
      console.log(`    📊 ${result.stats?.originalSizeKB}KB → ${result.stats?.aiCleanedSizeKB}KB → ${result.stats?.enhancedSizeKB}KB`);
      console.log(`    🎯 Watermarks detected: ${result.stats?.watermarksDetected}`);
      console.log(`    ⏱️  Time: ${result.stats?.totalTimeS.toFixed(1)}s`);
    } else {
      console.log(`    ❌ Failed: ${result.error}`);
    }
  }
  
  // Summary
  const succeeded = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  
  console.log('\n');
  console.log('═'.repeat(60));
  console.log('📊 BATCH PROCESSING SUMMARY');
  console.log('═'.repeat(60));
  console.log(`Total:     ${results.length}`);
  console.log(`Succeeded: ${succeeded.length} ✅`);
  console.log(`Failed:    ${failed.length} ❌`);
  
  if (succeeded.length > 0) {
    const totalOriginal = succeeded.reduce((sum, r) => sum + (r.stats?.originalSizeKB || 0), 0);
    const totalEnhanced = succeeded.reduce((sum, r) => sum + (r.stats?.enhancedSizeKB || 0), 0);
    const totalWatermarks = succeeded.reduce((sum, r) => sum + (r.stats?.watermarksDetected || 0), 0);
    const totalTime = succeeded.reduce((sum, r) => sum + (r.stats?.totalTimeS || 0), 0);
    
    console.log(`\n📈 Stats:`);
    console.log(`   Original total:  ${(totalOriginal / 1024).toFixed(1)} MB`);
    console.log(`   Enhanced total:  ${(totalEnhanced / 1024).toFixed(1)} MB`);
    console.log(`   Watermarks found: ${totalWatermarks}`);
    console.log(`   Total time:      ${(totalTime / 60).toFixed(1)} minutes`);
  }
  
  if (failed.length > 0) {
    console.log(`\n❌ Failed videos:`);
    failed.forEach(r => console.log(`   - ${r.video}: ${r.error}`));
  }
  
  console.log(`\n📁 Ready to post: ${DIRS.readyToPost}`);
  console.log(`   ${succeeded.length} videos ready for MediaPoster\n`);
}

main().catch(console.error);
