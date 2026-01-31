/**
 * AI Video Upscaler
 * 
 * Uses Modal GPU with Real-ESRGAN for high-quality video upscaling
 * This produces the HIGHEST QUALITY upscaling available
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { spawn } from 'child_process';
import { join } from 'path';
import { tmpdir } from 'os';
import { logger } from '../utils/logger.js';

const TEMP_DIR = join(tmpdir(), 'safari-automation', 'upscale');

// Ensure temp directory exists
if (!existsSync(TEMP_DIR)) {
  mkdirSync(TEMP_DIR, { recursive: true });
}

// Modal configuration (same as watermark removal)
function getModalConfig() {
  return {
    MODAL_TOKEN_ID: process.env.MODAL_TOKEN_ID,
    MODAL_TOKEN_SECRET: process.env.MODAL_TOKEN_SECRET,
    MODAL_WORKSPACE: process.env.MODAL_WORKSPACE || 'isaiahdupree33',
    MODAL_APP_NAME: process.env.MODAL_APP_NAME || 'blanklogo-watermark-removal',
  };
}

/**
 * Upscale video using Real-ESRGAN via Modal GPU
 */
export async function upscaleVideo(
  inputPath: string,
  outputPath: string,
  scale: 2 | 4 = 2,
  model: string = 'real-esrgan',
  onProgress?: (progress: number) => void
): Promise<void> {
  const config = getModalConfig();
  
  if (!config.MODAL_TOKEN_ID || !config.MODAL_TOKEN_SECRET) {
    logger.warn('[Upscaler] Modal not configured, falling back to local FFmpeg upscale');
    return upscaleVideoLocal(inputPath, outputPath, scale);
  }

  logger.info(`[Upscaler] Starting ${scale}x upscale with Modal GPU (Real-ESRGAN)`);
  const startTime = Date.now();

  // Read video
  const videoBytes = readFileSync(inputPath);
  const videoBase64 = videoBytes.toString('base64');

  logger.info(`[Upscaler] Input size: ${(videoBytes.length / 1024 / 1024).toFixed(2)} MB`);
  onProgress?.(0.1);

  // Call Modal upscale endpoint
  const modalUrl = `https://${config.MODAL_WORKSPACE}--${config.MODAL_APP_NAME}-upscale-video-http.modal.run`;

  try {
    const response = await fetch(modalUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.MODAL_TOKEN_ID}:${config.MODAL_TOKEN_SECRET}`,
      },
      body: JSON.stringify({
        video_bytes: videoBase64,
        scale: scale,
      }),
    });

    onProgress?.(0.5);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Modal API error: ${response.status} - ${errorText}`);
    }

    const result = await response.json() as {
      video_bytes: string;
      stats: {
        scale: number;
        input_size_mb: number;
        output_size_mb: number;
        input_resolution: string;
        output_resolution: string;
        frames_processed: number;
        processing_time_s: number;
      };
    };

    onProgress?.(0.9);

    // Write output
    const outputBytes = Buffer.from(result.video_bytes, 'base64');
    writeFileSync(outputPath, outputBytes);

    const duration = (Date.now() - startTime) / 1000;
    logger.info(`[Upscaler] ✅ Complete in ${duration.toFixed(1)}s`);
    logger.info(`[Upscaler]    Resolution: ${result.stats.input_resolution} → ${result.stats.output_resolution}`);
    logger.info(`[Upscaler]    Output size: ${result.stats.output_size_mb.toFixed(2)} MB`);

    onProgress?.(1.0);

  } catch (error: any) {
    const duration = (Date.now() - startTime) / 1000;
    logger.error(`[Upscaler] ❌ Modal failed after ${duration.toFixed(1)}s: ${error.message}`);
    
    // Fall back to local upscaling
    logger.info(`[Upscaler] Falling back to local FFmpeg upscale`);
    return upscaleVideoLocal(inputPath, outputPath, scale);
  }
}

/**
 * Local FFmpeg-based upscaling (fallback, lower quality)
 * Uses lanczos scaling algorithm
 */
export async function upscaleVideoLocal(
  inputPath: string,
  outputPath: string,
  scale: 2 | 4 = 2
): Promise<void> {
  logger.info(`[Upscaler] Using local FFmpeg ${scale}x upscale`);

  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-y',
      '-i', inputPath,
      '-vf', `scale=iw*${scale}:ih*${scale}:flags=lanczos`,
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', '18',
      '-c:a', 'copy',
      outputPath,
    ]);

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        logger.info(`[Upscaler] ✅ Local upscale complete`);
        resolve();
      } else {
        reject(new Error(`FFmpeg exited with code ${code}`));
      }
    });

    ffmpeg.on('error', reject);
  });
}
