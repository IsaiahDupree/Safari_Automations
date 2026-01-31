#!/usr/bin/env npx tsx
/**
 * High-Quality Video Pipeline
 * 
 * Processes Sora videos with maximum quality retention:
 * 1. BlankLogo Modal API (YOLO + LAMA AI inpainting) for watermark removal
 * 2. Real-ESRGAN AI upscaling via Replicate (optional)
 * 3. MediaPoster webhook for YouTube/TikTok publishing
 * 
 * Usage:
 *   npx tsx scripts/hq-video-pipeline.ts --video ~/sora-videos/video.mp4
 *   npx tsx scripts/hq-video-pipeline.ts --dir ~/sora-videos/badass-marathon/ --upscale
 *   npx tsx scripts/hq-video-pipeline.ts --dir ~/sora-videos/ --character isaiahdupree --platforms youtube,tiktok
 */

import * as fs from 'fs';
import * as path from 'path';

// =============================================================================
// CONFIGURATION
// =============================================================================

const CONFIG = {
  // BlankLogo Modal API (AI watermark inpainting)
  MODAL_WORKSPACE: process.env.MODAL_WORKSPACE || 'isaiahdupree33',
  MODAL_APP_NAME: process.env.MODAL_APP_NAME || 'blanklogo-watermark-removal',
  MODAL_TOKEN_ID: process.env.MODAL_TOKEN_ID || '',
  MODAL_TOKEN_SECRET: process.env.MODAL_TOKEN_SECRET || '',
  
  // Replicate API (Real-ESRGAN upscaling)
  REPLICATE_API_TOKEN: process.env.REPLICATE_API_TOKEN || '',
  REPLICATE_ESRGAN_MODEL: 'lucataco/real-esrgan-video:c24c0469dc94e1d09016f882a199f48f12ec5cd4c9fafca05aa6eaa96cd2748b',
  
  // Fallback: Local SoraWatermarkCleaner (FFmpeg crop)
  WATERMARK_CLEANER_PATH: process.env.WATERMARK_CLEANER_PATH || 
    '/Users/isaiahdupree/Documents/Software/MediaPoster/Backend/SoraWatermarkCleaner',
  
  // Output directories
  OUTPUT_DIR: process.env.HQ_OUTPUT_DIR || path.join(process.env.HOME || '', 'sora-videos', 'hq-cleaned'),
  UPSCALED_DIR: process.env.HQ_UPSCALED_DIR || path.join(process.env.HOME || '', 'sora-videos', 'upscaled'),
  
  // MediaPoster
  MEDIAPOSTER_WEBHOOK_URL: process.env.MEDIAPOSTER_WEBHOOK_URL || 'http://localhost:5555/api/webhooks/video-ready',
};

// =============================================================================
// TYPES
// =============================================================================

interface ProcessingOptions {
  mode: 'modal' | 'local' | 'auto';  // Watermark removal method
  upscale: boolean;                   // Enable AI upscaling
  upscaleScale: number;               // 2x or 4x upscaling
  platform: 'sora' | 'tiktok' | 'runway' | 'pika';
  character?: string;
  publishPlatforms?: string[];
  alertMediaPoster: boolean;
}

interface ProcessingResult {
  success: boolean;
  inputPath: string;
  cleanedPath?: string;
  upscaledPath?: string;
  finalPath?: string;
  method: string;
  stats: {
    inputSizeMb: number;
    outputSizeMb: number;
    processingTimeS: number;
    watermarksDetected?: number;
    framesProcessed?: number;
    upscaled?: boolean;
  };
  error?: string;
}

// =============================================================================
// MODAL API CLIENT (BlankLogo - YOLO + LAMA AI Inpainting)
// =============================================================================

async function processWithModal(
  videoPath: string,
  outputPath: string,
  platform: string = 'sora'
): Promise<{ success: boolean; stats?: any; error?: string }> {
  console.log(`[Modal] 🚀 Processing with AI inpainting (YOLO + LAMA)...`);
  
  if (!CONFIG.MODAL_TOKEN_ID || !CONFIG.MODAL_TOKEN_SECRET) {
    console.log(`[Modal] ⚠️ No Modal credentials - falling back to local`);
    return { success: false, error: 'No Modal credentials configured' };
  }
  
  const videoBytes = fs.readFileSync(videoPath);
  const videoBase64 = videoBytes.toString('base64');
  
  console.log(`[Modal]    Input: ${(videoBytes.length / 1024 / 1024).toFixed(2)} MB`);
  
  const modalUrl = `https://${CONFIG.MODAL_WORKSPACE}--${CONFIG.MODAL_APP_NAME}-process-video-http.modal.run`;
  const startTime = Date.now();
  
  try {
    const response = await fetch(modalUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CONFIG.MODAL_TOKEN_ID}:${CONFIG.MODAL_TOKEN_SECRET}`,
      },
      body: JSON.stringify({
        video_bytes: videoBase64,
        mode: 'inpaint',
        platform: platform,
      }),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Modal] ❌ HTTP ${response.status}: ${errorText}`);
      return { success: false, error: `Modal API error: ${response.status}` };
    }
    
    const result = await response.json() as any;
    
    if (result.error) {
      console.error(`[Modal] ❌ Processing error: ${result.error}`);
      return { success: false, error: result.error };
    }
    
    // Decode and save output
    const outputBytes = Buffer.from(result.video_bytes, 'base64');
    fs.writeFileSync(outputPath, outputBytes);
    
    const duration = (Date.now() - startTime) / 1000;
    
    console.log(`[Modal] ✅ Complete in ${duration.toFixed(1)}s`);
    console.log(`[Modal]    Output: ${(outputBytes.length / 1024 / 1024).toFixed(2)} MB`);
    console.log(`[Modal]    Watermarks detected: ${result.stats?.watermarks_detected || 0}`);
    
    return { success: true, stats: result.stats };
  } catch (error) {
    console.error(`[Modal] ❌ Error:`, error);
    return { success: false, error: String(error) };
  }
}

// =============================================================================
// REPLICATE API CLIENT (Real-ESRGAN AI Upscaling)
// =============================================================================

async function upscaleWithReplicate(
  videoPath: string,
  outputPath: string,
  scale: number = 2
): Promise<{ success: boolean; error?: string }> {
  console.log(`[Replicate] 🔍 Upscaling ${scale}x with Real-ESRGAN...`);
  
  if (!CONFIG.REPLICATE_API_TOKEN) {
    console.log(`[Replicate] ⚠️ No Replicate API token - skipping upscale`);
    return { success: false, error: 'No Replicate API token configured' };
  }
  
  const startTime = Date.now();
  
  try {
    // Read video and convert to base64 data URL
    const videoBytes = fs.readFileSync(videoPath);
    const videoBase64 = videoBytes.toString('base64');
    const dataUrl = `data:video/mp4;base64,${videoBase64}`;
    
    console.log(`[Replicate]    Input: ${(videoBytes.length / 1024 / 1024).toFixed(2)} MB`);
    
    // Create prediction
    const createResponse = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        'Authorization': `Token ${CONFIG.REPLICATE_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        version: CONFIG.REPLICATE_ESRGAN_MODEL.split(':')[1],
        input: {
          video: dataUrl,
          scale: scale,
        },
      }),
    });
    
    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      console.error(`[Replicate] ❌ Create failed: ${errorText}`);
      return { success: false, error: `Replicate API error: ${createResponse.status}` };
    }
    
    const prediction = await createResponse.json() as any;
    console.log(`[Replicate]    Prediction ID: ${prediction.id}`);
    
    // Poll for completion
    let status = prediction.status;
    let result = prediction;
    
    while (status === 'starting' || status === 'processing') {
      await new Promise(r => setTimeout(r, 5000));
      
      const pollResponse = await fetch(`https://api.replicate.com/v1/predictions/${prediction.id}`, {
        headers: { 'Authorization': `Token ${CONFIG.REPLICATE_API_TOKEN}` },
      });
      
      result = await pollResponse.json() as any;
      status = result.status;
      console.log(`[Replicate]    Status: ${status}...`);
    }
    
    if (status !== 'succeeded') {
      console.error(`[Replicate] ❌ Failed: ${result.error || status}`);
      return { success: false, error: result.error || status };
    }
    
    // Download output video
    const outputUrl = result.output;
    console.log(`[Replicate]    Downloading from: ${outputUrl}`);
    
    const downloadResponse = await fetch(outputUrl);
    const outputBuffer = Buffer.from(await downloadResponse.arrayBuffer());
    fs.writeFileSync(outputPath, outputBuffer);
    
    const duration = (Date.now() - startTime) / 1000;
    console.log(`[Replicate] ✅ Upscaled in ${duration.toFixed(1)}s`);
    console.log(`[Replicate]    Output: ${(outputBuffer.length / 1024 / 1024).toFixed(2)} MB`);
    
    return { success: true };
  } catch (error) {
    console.error(`[Replicate] ❌ Error:`, error);
    return { success: false, error: String(error) };
  }
}

// =============================================================================
// LOCAL FALLBACK (SoraWatermarkCleaner - FFmpeg crop)
// =============================================================================

async function processWithLocal(
  videoPath: string,
  outputPath: string
): Promise<{ success: boolean; error?: string }> {
  console.log(`[Local] 🔧 Processing with FFmpeg crop...`);
  
  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const execAsync = promisify(exec);
  
  const outputDir = path.dirname(outputPath);
  const tempInputDir = path.join(outputDir, '.temp_input');
  
  try {
    // Create temp directory
    if (!fs.existsSync(tempInputDir)) {
      fs.mkdirSync(tempInputDir, { recursive: true });
    }
    
    // Copy video to temp input
    const tempInput = path.join(tempInputDir, path.basename(videoPath));
    fs.copyFileSync(videoPath, tempInput);
    
    // Run SoraWatermarkCleaner
    const cmd = `cd "${CONFIG.WATERMARK_CLEANER_PATH}" && uv run python cli.py -i "${tempInputDir}" -o "${outputDir}"`;
    await execAsync(cmd, { timeout: 300000 });
    
    // Cleanup temp
    fs.unlinkSync(tempInput);
    fs.rmdirSync(tempInputDir);
    
    // Find output file
    const expectedOutput = path.join(outputDir, `cleaned_${path.basename(videoPath)}`);
    
    if (fs.existsSync(expectedOutput)) {
      // Move to final path if different
      if (expectedOutput !== outputPath) {
        fs.renameSync(expectedOutput, outputPath);
      }
      console.log(`[Local] ✅ Complete`);
      return { success: true };
    }
    
    return { success: false, error: 'Output file not found' };
  } catch (error) {
    console.error(`[Local] ❌ Error:`, error);
    return { success: false, error: String(error) };
  }
}

// =============================================================================
// MEDIAPOSTER WEBHOOK
// =============================================================================

async function alertMediaPoster(
  videoPath: string,
  options: ProcessingOptions
): Promise<{ success: boolean; jobId?: string }> {
  console.log(`[MediaPoster] 📤 Sending webhook...`);
  
  try {
    const response = await fetch(CONFIG.MEDIAPOSTER_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        video_path: videoPath,
        source: 'sora',
        character: options.character || 'isaiahdupree',
        platforms: options.publishPlatforms || ['youtube', 'tiktok'],
        auto_publish: true,
        metadata: {
          processed_with: 'hq-video-pipeline',
          upscaled: options.upscale,
        },
      }),
    });
    
    if (response.ok) {
      const result = await response.json() as any;
      console.log(`[MediaPoster] ✅ Queued for publishing`);
      return { success: true, jobId: result.job_id };
    } else {
      console.log(`[MediaPoster] ⚠️ Failed: ${response.status}`);
      return { success: false };
    }
  } catch (error) {
    console.log(`[MediaPoster] ⚠️ Error: ${error}`);
    return { success: false };
  }
}

// =============================================================================
// MAIN PROCESSING FUNCTION
// =============================================================================

async function processVideo(
  videoPath: string,
  options: ProcessingOptions
): Promise<ProcessingResult> {
  const startTime = Date.now();
  const inputStats = fs.statSync(videoPath);
  const inputSizeMb = inputStats.size / 1024 / 1024;
  
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`📹 Processing: ${path.basename(videoPath)}`);
  console.log(`${'═'.repeat(60)}`);
  console.log(`   Input size: ${inputSizeMb.toFixed(2)} MB`);
  console.log(`   Mode: ${options.mode}`);
  console.log(`   Upscale: ${options.upscale ? `${options.upscaleScale}x` : 'no'}`);
  
  // Ensure output directories exist
  if (!fs.existsSync(CONFIG.OUTPUT_DIR)) {
    fs.mkdirSync(CONFIG.OUTPUT_DIR, { recursive: true });
  }
  if (options.upscale && !fs.existsSync(CONFIG.UPSCALED_DIR)) {
    fs.mkdirSync(CONFIG.UPSCALED_DIR, { recursive: true });
  }
  
  const baseName = path.basename(videoPath, '.mp4');
  const cleanedPath = path.join(CONFIG.OUTPUT_DIR, `hq_${baseName}.mp4`);
  let method = 'unknown';
  let stats: any = {};
  
  // Step 1: Watermark removal
  let cleanResult: { success: boolean; stats?: any; error?: string };
  
  if (options.mode === 'modal' || options.mode === 'auto') {
    cleanResult = await processWithModal(videoPath, cleanedPath, options.platform);
    method = 'modal-inpaint';
    
    if (!cleanResult.success && options.mode === 'auto') {
      console.log(`[Pipeline] Falling back to local processing...`);
      cleanResult = await processWithLocal(videoPath, cleanedPath);
      method = 'local-crop';
    }
  } else {
    cleanResult = await processWithLocal(videoPath, cleanedPath);
    method = 'local-crop';
  }
  
  if (!cleanResult.success) {
    return {
      success: false,
      inputPath: videoPath,
      method,
      stats: {
        inputSizeMb,
        outputSizeMb: 0,
        processingTimeS: (Date.now() - startTime) / 1000,
      },
      error: cleanResult.error || 'Watermark removal failed',
    };
  }
  
  stats = cleanResult.stats || {};
  let finalPath = cleanedPath;
  
  // Step 2: AI upscaling (optional)
  let upscaledPath: string | undefined;
  
  if (options.upscale) {
    upscaledPath = path.join(CONFIG.UPSCALED_DIR, `upscaled_${baseName}.mp4`);
    const upscaleResult = await upscaleWithReplicate(cleanedPath, upscaledPath, options.upscaleScale);
    
    if (upscaleResult.success) {
      finalPath = upscaledPath;
      stats.upscaled = true;
      method += '+esrgan';
    } else {
      console.log(`[Pipeline] Upscaling failed, using cleaned video`);
      upscaledPath = undefined;
    }
  }
  
  // Step 3: Alert MediaPoster
  if (options.alertMediaPoster) {
    await alertMediaPoster(finalPath, options);
  }
  
  const outputStats = fs.statSync(finalPath);
  const outputSizeMb = outputStats.size / 1024 / 1024;
  const processingTimeS = (Date.now() - startTime) / 1000;
  
  console.log(`\n✅ Complete: ${path.basename(finalPath)}`);
  console.log(`   Output: ${outputSizeMb.toFixed(2)} MB`);
  console.log(`   Time: ${processingTimeS.toFixed(1)}s`);
  console.log(`   Method: ${method}`);
  
  return {
    success: true,
    inputPath: videoPath,
    cleanedPath,
    upscaledPath,
    finalPath,
    method,
    stats: {
      inputSizeMb,
      outputSizeMb,
      processingTimeS,
      watermarksDetected: stats.watermarks_detected,
      framesProcessed: stats.frames_processed,
      upscaled: !!upscaledPath,
    },
  };
}

// =============================================================================
// BATCH PROCESSING
// =============================================================================

async function processDirectory(
  dirPath: string,
  options: ProcessingOptions
): Promise<{ total: number; succeeded: number; failed: number; results: ProcessingResult[] }> {
  const files = fs.readdirSync(dirPath)
    .filter(f => f.endsWith('.mp4') && !f.startsWith('cleaned_') && !f.startsWith('hq_'))
    .map(f => path.join(dirPath, f));
  
  console.log(`\n${'╔'.padEnd(59, '═')}╗`);
  console.log(`║     🎬 HQ Video Pipeline: Modal AI + Upscaling           ║`);
  console.log(`${'╚'.padEnd(59, '═')}╝`);
  console.log(`\n📁 Directory: ${dirPath}`);
  console.log(`📹 Found ${files.length} videos`);
  console.log(`🔧 Mode: ${options.mode}`);
  console.log(`🔍 Upscale: ${options.upscale ? `${options.upscaleScale}x Real-ESRGAN` : 'disabled'}`);
  console.log(`📤 MediaPoster: ${options.alertMediaPoster ? 'enabled' : 'disabled'}`);
  
  const results: ProcessingResult[] = [];
  let succeeded = 0;
  let failed = 0;
  
  for (let i = 0; i < files.length; i++) {
    console.log(`\n[${i + 1}/${files.length}] Processing ${path.basename(files[i])}...`);
    
    const result = await processVideo(files[i], options);
    results.push(result);
    
    if (result.success) {
      succeeded++;
    } else {
      failed++;
      console.error(`   ❌ Failed: ${result.error}`);
    }
  }
  
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`📊 BATCH RESULTS`);
  console.log(`${'═'.repeat(60)}`);
  console.log(`Total:     ${files.length}`);
  console.log(`Succeeded: ${succeeded} ✅`);
  console.log(`Failed:    ${failed} ❌`);
  
  return { total: files.length, succeeded, failed, results };
}

// =============================================================================
// CLI
// =============================================================================

async function main() {
  const args = process.argv.slice(2);
  
  // Parse arguments
  const getArg = (name: string): string | undefined => {
    const idx = args.indexOf(`--${name}`);
    return idx !== -1 && args[idx + 1] ? args[idx + 1] : undefined;
  };
  
  const hasFlag = (name: string): boolean => args.includes(`--${name}`);
  
  const videoPath = getArg('video');
  const dirPath = getArg('dir');
  const mode = (getArg('mode') || 'auto') as 'modal' | 'local' | 'auto';
  const upscale = hasFlag('upscale');
  const upscaleScale = parseInt(getArg('scale') || '2', 10);
  const platform = (getArg('platform') || 'sora') as 'sora' | 'tiktok' | 'runway' | 'pika';
  const character = getArg('character');
  const publishPlatforms = getArg('platforms')?.split(',');
  const alertMediaPoster = hasFlag('alert') || !!publishPlatforms;
  
  const options: ProcessingOptions = {
    mode,
    upscale,
    upscaleScale,
    platform,
    character,
    publishPlatforms,
    alertMediaPoster,
  };
  
  if (!videoPath && !dirPath) {
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║     🎬 HQ Video Pipeline - Maximum Quality Processing        ║
╚══════════════════════════════════════════════════════════════╝

Usage:
  npx tsx scripts/hq-video-pipeline.ts --video <path> [options]
  npx tsx scripts/hq-video-pipeline.ts --dir <path> [options]

Options:
  --video <path>      Process a single video
  --dir <path>        Process all videos in directory
  --mode <mode>       Processing mode: modal (AI), local (FFmpeg), auto (default)
  --upscale           Enable Real-ESRGAN AI upscaling
  --scale <n>         Upscale factor: 2 or 4 (default: 2)
  --platform <name>   Source platform: sora, tiktok, runway, pika
  --character <name>  Character name for MediaPoster
  --platforms <list>  Publish platforms: youtube,tiktok
  --alert             Alert MediaPoster when done

Environment Variables:
  MODAL_TOKEN_ID          Modal API token ID
  MODAL_TOKEN_SECRET      Modal API token secret
  REPLICATE_API_TOKEN     Replicate API token for upscaling

Examples:
  # Process with AI inpainting (Modal)
  npx tsx scripts/hq-video-pipeline.ts --video ~/sora-videos/test.mp4 --mode modal

  # Process and upscale 2x
  npx tsx scripts/hq-video-pipeline.ts --video ~/sora-videos/test.mp4 --upscale

  # Batch process and send to MediaPoster
  npx tsx scripts/hq-video-pipeline.ts --dir ~/sora-videos/badass-marathon/ \\
    --character isaiahdupree --platforms youtube,tiktok
`);
    process.exit(0);
  }
  
  if (videoPath) {
    if (!fs.existsSync(videoPath)) {
      console.error(`❌ Video not found: ${videoPath}`);
      process.exit(1);
    }
    await processVideo(videoPath, options);
  } else if (dirPath) {
    if (!fs.existsSync(dirPath)) {
      console.error(`❌ Directory not found: ${dirPath}`);
      process.exit(1);
    }
    await processDirectory(dirPath, options);
  }
}

main().catch(console.error);
