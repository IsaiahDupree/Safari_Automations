/**
 * Video processing routes
 */

import { jobManager, broadcastJobUpdate } from '../index.js';
import { processVideoJob } from '../services/video-processor.js';
import { logger } from '../utils/logger.js';

interface ProcessVideoRequest {
  video_url?: string;
  video_bytes?: string;
  options?: {
    watermark_removal?: {
      enabled?: boolean;
      method?: 'modal' | 'local' | 'auto';
      platform?: 'sora' | 'tiktok' | 'runway' | 'pika';
    };
    upscaling?: {
      enabled?: boolean;
      scale?: 2 | 4;
      model?: string;
    };
    encoding?: {
      codec?: 'hevc' | 'h264';
      crf?: number;
      preset?: string;
    };
    callback?: {
      webhook_url?: string;
      include_video_bytes?: boolean;
    };
  };
  metadata?: Record<string, any>;
}

export const videoRouter = {
  async processVideo(req: any, res: any, body: ProcessVideoRequest) {
    logger.info('[Video] Processing request received');

    // Validate input
    if (!body.video_url && !body.video_bytes) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Either video_url or video_bytes is required' }));
      return;
    }

    // Create job with default options
    const options = {
      watermark_removal: {
        enabled: body.options?.watermark_removal?.enabled ?? true,
        method: body.options?.watermark_removal?.method || 'auto',
        platform: body.options?.watermark_removal?.platform || 'sora',
      },
      upscaling: {
        enabled: body.options?.upscaling?.enabled ?? true,
        scale: body.options?.upscaling?.scale || 2,
        model: body.options?.upscaling?.model || 'real-esrgan',
      },
      encoding: {
        codec: body.options?.encoding?.codec || 'hevc',
        crf: body.options?.encoding?.crf ?? 18,
        preset: body.options?.encoding?.preset || 'medium',
      },
      callback: body.options?.callback,
    };

    const job = jobManager.createJob(options, body.metadata || {});

    // Estimate processing time
    let estimatedTime = 60; // Base 60s
    if (options.watermark_removal.enabled && options.watermark_removal.method !== 'local') {
      estimatedTime += 60; // +60s for Modal AI
    }
    if (options.upscaling.enabled) {
      estimatedTime += options.upscaling.scale === 4 ? 180 : 120; // +2-3 min for upscaling
    }

    // Send immediate response
    res.writeHead(202, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      job_id: job.id,
      status: 'queued',
      estimated_time_seconds: estimatedTime,
      tracking_url: `http://localhost:${process.env.CONTROL_PORT || 7070}/api/v1/jobs/${job.id}`,
    }));

    // Process in background
    processVideoJob(job.id, body.video_url, body.video_bytes, options)
      .then(() => {
        logger.info(`[Video] Job ${job.id} completed successfully`);
      })
      .catch((error) => {
        logger.error(`[Video] Job ${job.id} failed: ${error.message}`);
        jobManager.failJob(job.id, error.message);
        broadcastJobUpdate(job.id, {
          type: 'failed',
          job_id: job.id,
          error: error.message,
        });
      });
  },
};
