/**
 * Video Processor Service
 * 
 * Orchestrates the full HQ video processing pipeline:
 * 1. Download/decode input video
 * 2. Remove watermark (Modal GPU - YOLO + LAMA)
 * 3. AI upscale (Replicate - Real-ESRGAN)
 * 4. High-quality encode (FFmpeg - HEVC/H.264)
 */

import { writeFileSync, readFileSync, mkdirSync, existsSync, statSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { jobManager, broadcastJobUpdate } from '../index.js';
import { removeWatermarkModal, removeWatermarkLocal } from './modal-client.js';
import { upscaleVideo } from './upscaler.js';
import { encodeVideo } from './encoder.js';
import { logger } from '../utils/logger.js';

const TEMP_DIR = join(tmpdir(), 'safari-automation');

// Ensure temp directory exists
if (!existsSync(TEMP_DIR)) {
  mkdirSync(TEMP_DIR, { recursive: true });
}

interface ProcessingOptions {
  watermark_removal: {
    enabled: boolean;
    method: 'modal' | 'local' | 'auto';
    platform: 'sora' | 'tiktok' | 'runway' | 'pika';
  };
  upscaling: {
    enabled: boolean;
    scale: 2 | 4;
    model: string;
  };
  encoding: {
    codec: 'hevc' | 'h264';
    crf: number;
    preset: string;
  };
  callback?: {
    webhook_url?: string;
    include_video_bytes?: boolean;
  };
}

function updateProgress(jobId: string, progress: number, stage: string) {
  jobManager.updateProgress(jobId, progress, stage);
  broadcastJobUpdate(jobId, {
    type: 'progress',
    job_id: jobId,
    progress,
    stage,
  });
}

async function downloadVideo(url: string, outputPath: string): Promise<void> {
  logger.info(`[Processor] Downloading from: ${url}`);
  
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download video: ${response.status}`);
  }
  
  const buffer = Buffer.from(await response.arrayBuffer());
  writeFileSync(outputPath, buffer);
  
  const sizeMb = buffer.length / 1024 / 1024;
  logger.info(`[Processor] Downloaded: ${sizeMb.toFixed(2)} MB`);
}

export async function processVideoJob(
  jobId: string,
  videoUrl?: string,
  videoBytes?: string,
  options?: ProcessingOptions
): Promise<void> {
  const startTime = Date.now();
  logger.info(`[Processor] Starting job: ${jobId}`);

  // Get full options with defaults
  const opts: ProcessingOptions = {
    watermark_removal: {
      enabled: options?.watermark_removal?.enabled ?? true,
      method: options?.watermark_removal?.method || 'auto',
      platform: options?.watermark_removal?.platform || 'sora',
    },
    upscaling: {
      enabled: options?.upscaling?.enabled ?? true,
      scale: options?.upscaling?.scale || 2,
      model: options?.upscaling?.model || 'real-esrgan',
    },
    encoding: {
      codec: options?.encoding?.codec || 'hevc',
      crf: options?.encoding?.crf ?? 18,
      preset: options?.encoding?.preset || 'medium',
    },
    callback: options?.callback,
  };

  // Create temp paths
  const inputPath = join(TEMP_DIR, `${jobId}_input.mp4`);
  const watermarkRemovedPath = join(TEMP_DIR, `${jobId}_watermark_removed.mp4`);
  const upscaledPath = join(TEMP_DIR, `${jobId}_upscaled.mp4`);
  const outputPath = join(TEMP_DIR, `${jobId}_output.mp4`);

  let currentPath = inputPath;
  let watermarksDetected = 0;
  let framesProcessed = 0;
  let upscaled = false;
  let method = 'none';

  try {
    // Start job
    jobManager.startJob(jobId);
    updateProgress(jobId, 5, 'downloading');

    // Step 1: Get input video
    if (videoUrl) {
      await downloadVideo(videoUrl, inputPath);
    } else if (videoBytes) {
      const buffer = Buffer.from(videoBytes, 'base64');
      writeFileSync(inputPath, buffer);
      logger.info(`[Processor] Decoded video: ${(buffer.length / 1024 / 1024).toFixed(2)} MB`);
    } else {
      throw new Error('No video input provided');
    }

    const inputSize = statSync(inputPath).size / 1024 / 1024;
    updateProgress(jobId, 10, 'analyzing');
    logger.info(`[Processor] Input size: ${inputSize.toFixed(2)} MB`);

    // Step 2: Remove watermark
    if (opts.watermark_removal.enabled) {
      updateProgress(jobId, 15, 'removing_watermark');
      logger.info(`[Processor] Removing watermark (method: ${opts.watermark_removal.method})`);

      let useModal = opts.watermark_removal.method === 'modal';
      
      // Auto mode: try Modal first, fall back to local
      if (opts.watermark_removal.method === 'auto') {
        useModal = !!process.env.MODAL_TOKEN_ID && !!process.env.MODAL_TOKEN_SECRET;
      }

      if (useModal) {
        try {
          const result = await removeWatermarkModal(
            inputPath,
            watermarkRemovedPath,
            opts.watermark_removal.platform,
            (progress) => updateProgress(jobId, 15 + Math.floor(progress * 0.35), 'removing_watermark')
          );
          watermarksDetected = result.watermarksDetected;
          framesProcessed = result.framesProcessed;
          method = 'modal-inpaint';
          currentPath = watermarkRemovedPath;
          logger.info(`[Processor] Modal processing complete: ${watermarksDetected} watermarks detected`);
        } catch (error: any) {
          logger.warn(`[Processor] Modal failed, falling back to local: ${error.message}`);
          // Fall back to local
          await removeWatermarkLocal(inputPath, watermarkRemovedPath, opts.watermark_removal.platform);
          method = 'local-crop';
          currentPath = watermarkRemovedPath;
        }
      } else {
        await removeWatermarkLocal(inputPath, watermarkRemovedPath, opts.watermark_removal.platform);
        method = 'local-crop';
        currentPath = watermarkRemovedPath;
      }
    }

    updateProgress(jobId, 50, 'watermark_complete');

    // Step 3: AI Upscale
    if (opts.upscaling.enabled) {
      updateProgress(jobId, 55, 'upscaling');
      logger.info(`[Processor] Upscaling ${opts.upscaling.scale}x with ${opts.upscaling.model}`);

      try {
        await upscaleVideo(
          currentPath,
          upscaledPath,
          opts.upscaling.scale,
          opts.upscaling.model,
          (progress) => updateProgress(jobId, 55 + Math.floor(progress * 0.25), 'upscaling')
        );
        currentPath = upscaledPath;
        upscaled = true;
        method = method ? `${method}+esrgan` : 'esrgan';
        logger.info(`[Processor] Upscaling complete`);
      } catch (error: any) {
        logger.warn(`[Processor] Upscaling failed, skipping: ${error.message}`);
        // Continue without upscaling
      }
    }

    updateProgress(jobId, 80, 'encoding');

    // Step 4: Encode final output
    logger.info(`[Processor] Encoding with ${opts.encoding.codec} CRF ${opts.encoding.crf}`);
    await encodeVideo(
      currentPath,
      outputPath,
      opts.encoding.codec,
      opts.encoding.crf,
      opts.encoding.preset
    );

    const outputSize = statSync(outputPath).size / 1024 / 1024;
    const processingTime = (Date.now() - startTime) / 1000;

    updateProgress(jobId, 95, 'finalizing');

    // Read output video
    const outputBytes = readFileSync(outputPath).toString('base64');

    // Complete job
    jobManager.completeJob(jobId, {
      video_bytes: outputBytes,
      video_path: outputPath,
      stats: {
        input_size_mb: inputSize,
        output_size_mb: outputSize,
        processing_time_s: processingTime,
        watermarks_detected: watermarksDetected,
        frames_processed: framesProcessed,
        upscaled,
        method,
      },
    });

    broadcastJobUpdate(jobId, {
      type: 'completed',
      job_id: jobId,
      result: {
        stats: {
          input_size_mb: inputSize,
          output_size_mb: outputSize,
          processing_time_s: processingTime,
          watermarks_detected: watermarksDetected,
          upscaled,
          method,
        },
      },
    });

    // Call webhook if configured
    if (opts.callback?.webhook_url) {
      try {
        const job = jobManager.getJob(jobId);
        await fetch(opts.callback.webhook_url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event: 'video.processed',
            job_id: jobId,
            status: 'completed',
            result: {
              video_bytes: opts.callback.include_video_bytes ? outputBytes : undefined,
              stats: job?.result?.stats,
            },
            metadata: job?.metadata,
          }),
        });
        logger.info(`[Processor] Webhook sent to ${opts.callback.webhook_url}`);
      } catch (error: any) {
        logger.warn(`[Processor] Webhook failed: ${error.message}`);
      }
    }

    logger.info(`[Processor] Job ${jobId} completed in ${processingTime.toFixed(1)}s`);
    logger.info(`[Processor]   Input: ${inputSize.toFixed(2)} MB → Output: ${outputSize.toFixed(2)} MB`);
    logger.info(`[Processor]   Method: ${method}`);

    // Cleanup temp files (keep output)
    try {
      if (existsSync(inputPath)) unlinkSync(inputPath);
      if (existsSync(watermarkRemovedPath) && watermarkRemovedPath !== currentPath) {
        unlinkSync(watermarkRemovedPath);
      }
      if (existsSync(upscaledPath) && upscaledPath !== currentPath) {
        unlinkSync(upscaledPath);
      }
    } catch (e) {
      // Ignore cleanup errors
    }

  } catch (error: any) {
    logger.error(`[Processor] Job ${jobId} failed: ${error.message}`);
    
    jobManager.failJob(jobId, error.message);
    broadcastJobUpdate(jobId, {
      type: 'failed',
      job_id: jobId,
      error: error.message,
    });

    // Cleanup on error
    try {
      if (existsSync(inputPath)) unlinkSync(inputPath);
      if (existsSync(watermarkRemovedPath)) unlinkSync(watermarkRemovedPath);
      if (existsSync(upscaledPath)) unlinkSync(upscaledPath);
      if (existsSync(outputPath)) unlinkSync(outputPath);
    } catch (e) {
      // Ignore cleanup errors
    }

    throw error;
  }
}
