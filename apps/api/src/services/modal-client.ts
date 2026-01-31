/**
 * Modal GPU Client
 * 
 * Calls Modal serverless GPU for watermark removal using YOLO + LAMA
 * This is the HIGHEST QUALITY option for watermark removal
 */

import { readFileSync, writeFileSync } from 'fs';
import { spawn } from 'child_process';
import { logger } from '../utils/logger.js';

// Read env vars at request time (not import time) so .env is loaded
function getModalConfig() {
  return {
    MODAL_TOKEN_ID: process.env.MODAL_TOKEN_ID,
    MODAL_TOKEN_SECRET: process.env.MODAL_TOKEN_SECRET,
    MODAL_WORKSPACE: process.env.MODAL_WORKSPACE || 'isaiahdupree33',
    MODAL_APP_NAME: process.env.MODAL_APP_NAME || 'blanklogo-watermark-removal',
  };
}

interface ModalResult {
  watermarksDetected: number;
  framesProcessed: number;
  processingTimeS: number;
}

/**
 * Remove watermark using Modal GPU (YOLO + LAMA inpainting)
 * This is the highest quality method - preserves full resolution
 */
export async function removeWatermarkModal(
  inputPath: string,
  outputPath: string,
  platform: string = 'sora',
  onProgress?: (progress: number) => void
): Promise<ModalResult> {
  const config = getModalConfig();
  
  if (!config.MODAL_TOKEN_ID || !config.MODAL_TOKEN_SECRET) {
    throw new Error('Modal credentials not configured');
  }

  logger.info(`[Modal] 🚀 Starting GPU processing for ${platform}`);
  const startTime = Date.now();

  // Read input video
  const videoBytes = readFileSync(inputPath);
  const inputSizeMb = videoBytes.length / 1024 / 1024;
  logger.info(`[Modal]    Input size: ${inputSizeMb.toFixed(2)} MB`);

  onProgress?.(0.1);

  // Call Modal HTTP endpoint
  const modalUrl = `https://${config.MODAL_WORKSPACE}--${config.MODAL_APP_NAME}-process-video-http.modal.run`;

  try {
    const response = await fetch(modalUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.MODAL_TOKEN_ID}:${config.MODAL_TOKEN_SECRET}`,
      },
      body: JSON.stringify({
        video_bytes: videoBytes.toString('base64'),
        mode: 'inpaint',
        platform,
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
        mode: string;
        platform: string;
        input_size_mb: number;
        output_size_mb: number;
        frames_processed: number;
        watermarks_detected: number;
        processing_time_s: number;
      };
    };

    onProgress?.(0.9);

    // Write output
    const outputBytes = Buffer.from(result.video_bytes, 'base64');
    writeFileSync(outputPath, outputBytes);

    const duration = (Date.now() - startTime) / 1000;
    logger.info(`[Modal] ✅ Processing complete in ${duration.toFixed(1)}s`);
    logger.info(`[Modal]    Watermarks detected: ${result.stats.watermarks_detected}`);
    logger.info(`[Modal]    Frames processed: ${result.stats.frames_processed}`);
    logger.info(`[Modal]    Output size: ${result.stats.output_size_mb.toFixed(2)} MB`);

    onProgress?.(1.0);

    return {
      watermarksDetected: result.stats.watermarks_detected,
      framesProcessed: result.stats.frames_processed,
      processingTimeS: result.stats.processing_time_s,
    };

  } catch (error: any) {
    const duration = (Date.now() - startTime) / 1000;
    logger.error(`[Modal] ❌ Failed after ${duration.toFixed(1)}s: ${error.message}`);
    throw error;
  }
}

/**
 * Local watermark removal using FFmpeg crop
 * Fast but lower quality - removes pixels instead of inpainting
 */
export async function removeWatermarkLocal(
  inputPath: string,
  outputPath: string,
  platform: string = 'sora'
): Promise<void> {
  logger.info(`[Local] Using FFmpeg crop for ${platform}`);

  // Platform-specific crop settings
  const cropSettings: Record<string, { position: string; pixels: number }> = {
    sora: { position: 'bottom', pixels: 80 },
    tiktok: { position: 'bottom', pixels: 60 },
    runway: { position: 'bottom', pixels: 50 },
    pika: { position: 'bottom', pixels: 50 },
  };

  const settings = cropSettings[platform] || cropSettings.sora;

  return new Promise((resolve, reject) => {
    // First probe the video to get dimensions
    const probe = spawn('ffprobe', [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height',
      '-of', 'csv=p=0',
      inputPath,
    ]);

    let probeOutput = '';
    probe.stdout.on('data', (data) => {
      probeOutput += data.toString();
    });

    probe.on('close', (code) => {
      if (code !== 0) {
        reject(new Error('Failed to probe video'));
        return;
      }

      const [width, height] = probeOutput.trim().split(',').map(Number);
      logger.info(`[Local] Video dimensions: ${width}x${height}`);

      // Build crop filter
      let cropFilter: string;
      const pixels = settings.pixels;

      switch (settings.position) {
        case 'bottom':
          cropFilter = `crop=${width}:${height - pixels}:0:0`;
          break;
        case 'top':
          cropFilter = `crop=${width}:${height - pixels}:0:${pixels}`;
          break;
        default:
          cropFilter = `crop=${width}:${height - pixels}:0:0`;
      }

      logger.info(`[Local] Applying filter: ${cropFilter}`);

      // Run FFmpeg
      const ffmpeg = spawn('ffmpeg', [
        '-y',
        '-i', inputPath,
        '-vf', cropFilter,
        '-c:v', 'libx264',
        '-preset', 'medium',
        '-crf', '18',
        '-c:a', 'copy',
        '-movflags', '+faststart',
        outputPath,
      ]);

      ffmpeg.stderr.on('data', (data) => {
        const line = data.toString();
        if (line.includes('frame=')) {
          logger.debug(`[Local] ${line.trim()}`);
        }
      });

      ffmpeg.on('close', (code) => {
        if (code === 0) {
          logger.info(`[Local] ✅ Crop complete`);
          resolve();
        } else {
          reject(new Error(`FFmpeg exited with code ${code}`));
        }
      });

      ffmpeg.on('error', reject);
    });

    probe.on('error', reject);
  });
}

/**
 * Check if Modal is available and healthy
 */
export async function checkModalHealth(): Promise<boolean> {
  const config = getModalConfig();
  
  if (!config.MODAL_TOKEN_ID || !config.MODAL_TOKEN_SECRET) {
    return false;
  }

  try {
    const healthUrl = `https://${config.MODAL_WORKSPACE}--${config.MODAL_APP_NAME}-health.modal.run`;
    const response = await fetch(healthUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${config.MODAL_TOKEN_ID}:${config.MODAL_TOKEN_SECRET}`,
      },
    });
    return response.ok;
  } catch {
    return false;
  }
}
