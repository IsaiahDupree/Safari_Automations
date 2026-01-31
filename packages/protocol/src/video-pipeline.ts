/**
 * Video Pipeline: Download → Watermark Removal → MediaPoster Alert
 * 
 * Automates the full flow from Sora video generation to publishing
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { SafariSupabaseClient, getSupabaseClient } from './supabase-client';
import { telemetryEmitter } from './event-emitter';
import { v4 as uuidv4 } from 'uuid';

const execAsync = promisify(exec);

// ============================================================================
// TYPES
// ============================================================================

export interface PipelineOptions {
  prompt: string;
  character: string;
  commandId?: string;
  
  // Processing
  removeWatermark?: boolean;
  skipExisting?: boolean;
  cleanedDir?: string;
  
  // MediaPoster
  alertMediaPoster?: boolean;
  mediaPosterUrl?: string;
  platforms?: string[];
  autoPublish?: boolean;
  
  // Logging
  logToSupabase?: boolean;
}

export interface PipelineResult {
  success: boolean;
  videoPath: string;
  cleanedPath?: string;
  mediaPosterJobId?: string;
  error?: string;
  stages: {
    watermarkRemoval?: {
      success: boolean;
      durationMs?: number;
      error?: string;
    };
    mediaPosterAlert?: {
      success: boolean;
      jobId?: string;
      error?: string;
    };
    supabaseLog?: {
      success: boolean;
      videoId?: string;
      error?: string;
    };
  };
}

export interface BatchResult {
  total: number;
  succeeded: number;
  failed: number;
  results: PipelineResult[];
}

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_CLEANED_DIR = path.join(process.env.HOME || '~', 'sora-videos', 'cleaned');
const WATERMARK_CLEANER_PATH = '/Users/isaiahdupree/Documents/Software/MediaPoster/Backend/SoraWatermarkCleaner';
const DEFAULT_MEDIAPOSTER_URL = 'http://localhost:5555/api/webhooks/video-ready';

// ============================================================================
// VIDEO PIPELINE CLASS
// ============================================================================

export class VideoPipeline {
  private supabase: SafariSupabaseClient | null = null;
  private cleanedDir: string;
  private mediaPosterUrl: string;

  constructor(options?: {
    cleanedDir?: string;
    mediaPosterUrl?: string;
    useSupabase?: boolean;
  }) {
    this.cleanedDir = options?.cleanedDir || DEFAULT_CLEANED_DIR;
    this.mediaPosterUrl = options?.mediaPosterUrl || DEFAULT_MEDIAPOSTER_URL;

    if (options?.useSupabase !== false) {
      try {
        this.supabase = getSupabaseClient();
      } catch (e) {
        console.warn('[Pipeline] Supabase not configured, logging disabled');
      }
    }

    // Ensure cleaned directory exists
    if (!fs.existsSync(this.cleanedDir)) {
      fs.mkdirSync(this.cleanedDir, { recursive: true });
    }
  }

  /**
   * Process a single video through the pipeline
   */
  async processVideo(videoPath: string, options: PipelineOptions): Promise<PipelineResult> {
    const result: PipelineResult = {
      success: false,
      videoPath,
      stages: {},
    };

    const commandId = options.commandId || `pipeline-${uuidv4().slice(0, 8)}`;

    console.log(`\n[Pipeline] Processing: ${path.basename(videoPath)}`);
    this.emitEvent('pipeline.started', commandId, { videoPath, options });

    // Validate input
    if (!fs.existsSync(videoPath)) {
      result.error = `Video not found: ${videoPath}`;
      this.emitEvent('pipeline.error', commandId, { error: result.error, stage: 'validation' });
      return result;
    }

    // Stage 1: Watermark Removal
    if (options.removeWatermark !== false) {
      const cleanedPath = await this.removeWatermark(videoPath, options, commandId);
      result.stages.watermarkRemoval = cleanedPath.stages.watermarkRemoval;

      if (cleanedPath.success) {
        result.cleanedPath = cleanedPath.cleanedPath;
      } else if (!options.skipExisting) {
        // If watermark removal fails and we can't skip, use raw video
        console.warn('[Pipeline] Watermark removal failed, using raw video');
        result.cleanedPath = videoPath;
      }
    } else {
      result.cleanedPath = videoPath;
    }

    // Stage 2: Log to Supabase
    if (options.logToSupabase !== false && this.supabase) {
      const logResult = await this.logToSupabase(videoPath, result.cleanedPath, options, commandId);
      result.stages.supabaseLog = logResult;
    }

    // Stage 3: Alert MediaPoster
    if (options.alertMediaPoster !== false) {
      const alertResult = await this.alertMediaPoster(
        result.cleanedPath || videoPath,
        videoPath,
        options,
        commandId
      );
      result.stages.mediaPosterAlert = alertResult;
      result.mediaPosterJobId = alertResult.jobId;
    }

    // Determine overall success
    result.success = !!(result.cleanedPath || !options.removeWatermark);
    
    this.emitEvent('pipeline.completed', commandId, {
      success: result.success,
      cleanedPath: result.cleanedPath,
      mediaPosterJobId: result.mediaPosterJobId,
    });

    console.log(`[Pipeline] ${result.success ? '✅' : '❌'} Complete: ${path.basename(videoPath)}`);
    return result;
  }

  /**
   * Process multiple videos in batch
   */
  async processBatch(
    videoPaths: string[],
    options: Omit<PipelineOptions, 'prompt'> & { prompts?: Record<string, string> }
  ): Promise<BatchResult> {
    const results: PipelineResult[] = [];
    let succeeded = 0;
    let failed = 0;

    console.log(`\n[Pipeline] Batch processing ${videoPaths.length} videos`);

    for (let i = 0; i < videoPaths.length; i++) {
      const videoPath = videoPaths[i];
      const prompt = options.prompts?.[videoPath] || `Video ${i + 1}`;

      console.log(`\n[${i + 1}/${videoPaths.length}] Processing...`);

      const result = await this.processVideo(videoPath, {
        ...options,
        prompt,
      });

      results.push(result);
      if (result.success) {
        succeeded++;
      } else {
        failed++;
      }

      // Small delay between videos
      if (i < videoPaths.length - 1) {
        await this.delay(1000);
      }
    }

    console.log(`\n[Pipeline] Batch complete: ${succeeded}/${videoPaths.length} succeeded`);

    return {
      total: videoPaths.length,
      succeeded,
      failed,
      results,
    };
  }

  /**
   * Process all videos in a directory
   */
  async processDirectory(
    dirPath: string,
    options: Omit<PipelineOptions, 'prompt'>
  ): Promise<BatchResult> {
    if (!fs.existsSync(dirPath)) {
      throw new Error(`Directory not found: ${dirPath}`);
    }

    const files = fs.readdirSync(dirPath)
      .filter(f => f.endsWith('.mp4') && !f.startsWith('cleaned_'))
      .map(f => path.join(dirPath, f));

    console.log(`[Pipeline] Found ${files.length} videos in ${dirPath}`);

    return this.processBatch(files, {
      ...options,
      prompts: files.reduce((acc, f) => {
        acc[f] = `Video: ${path.basename(f)}`;
        return acc;
      }, {} as Record<string, string>),
    });
  }

  // ============================================================================
  // PRIVATE METHODS
  // ============================================================================

  private async removeWatermark(
    videoPath: string,
    options: PipelineOptions,
    commandId: string
  ): Promise<{ success: boolean; cleanedPath?: string; stages: PipelineResult['stages'] }> {
    const filename = path.basename(videoPath, '.mp4');
    const cleanedPath = path.join(
      options.cleanedDir || this.cleanedDir,
      `cleaned_${filename}.mp4`
    );

    // Check if already cleaned
    if (options.skipExisting && fs.existsSync(cleanedPath)) {
      console.log(`[Pipeline] Skipping watermark removal (already exists)`);
      return {
        success: true,
        cleanedPath,
        stages: {
          watermarkRemoval: { success: true, durationMs: 0 },
        },
      };
    }

    console.log(`[Pipeline] Removing watermark...`);
    this.emitEvent('watermark.started', commandId, { inputPath: videoPath });

    const startTime = Date.now();

    try {
      // Ensure output directory exists
      const outputDir = path.dirname(cleanedPath);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      // Run watermark cleaner
      const cmd = `cd "${WATERMARK_CLEANER_PATH}" && uv run python -m SoraWatermarkCleaner.WaterMarkCleaner --input "${videoPath}" --output "${outputDir}"`;
      
      const { stdout, stderr } = await execAsync(cmd, { timeout: 300000 }); // 5 min timeout

      const durationMs = Date.now() - startTime;

      // Verify output exists
      if (!fs.existsSync(cleanedPath)) {
        throw new Error('Cleaned video not created');
      }

      console.log(`[Pipeline] ✅ Watermark removed in ${(durationMs / 1000).toFixed(1)}s`);
      this.emitEvent('watermark.completed', commandId, {
        inputPath: videoPath,
        outputPath: cleanedPath,
        durationMs,
      });

      return {
        success: true,
        cleanedPath,
        stages: {
          watermarkRemoval: { success: true, durationMs },
        },
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMsg = error instanceof Error ? error.message : String(error);
      
      console.error(`[Pipeline] ❌ Watermark removal failed: ${errorMsg}`);
      this.emitEvent('watermark.error', commandId, { error: errorMsg });

      return {
        success: false,
        stages: {
          watermarkRemoval: { success: false, durationMs, error: errorMsg },
        },
      };
    }
  }

  private async logToSupabase(
    rawPath: string,
    cleanedPath: string | undefined,
    options: PipelineOptions,
    commandId: string
  ): Promise<{ success: boolean; videoId?: string; error?: string }> {
    if (!this.supabase) {
      return { success: false, error: 'Supabase not configured' };
    }

    try {
      const stats = fs.statSync(rawPath);
      const cleanedStats = cleanedPath && fs.existsSync(cleanedPath) 
        ? fs.statSync(cleanedPath) 
        : null;

      const video = await this.supabase.insertVideo({
        command_id: commandId,
        prompt: options.prompt,
        character: options.character,
        raw_path: rawPath,
        raw_size: stats.size,
        cleaned_path: cleanedPath,
        cleaned_size: cleanedStats?.size,
        status: cleanedPath ? 'cleaned' : 'ready',
        cleaned_at: cleanedPath ? new Date().toISOString() : undefined,
      });

      if (video) {
        return { success: true, videoId: video.id };
      }
      return { success: false, error: 'Insert returned null' };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMsg };
    }
  }

  private async alertMediaPoster(
    videoPath: string,
    rawPath: string,
    options: PipelineOptions,
    commandId: string
  ): Promise<{ success: boolean; jobId?: string; error?: string }> {
    console.log(`[Pipeline] Alerting MediaPoster...`);
    this.emitEvent('mediaposter.alerting', commandId, { videoPath });

    try {
      const payload = {
        video_path: videoPath,
        raw_path: rawPath !== videoPath ? rawPath : undefined,
        prompt: options.prompt,
        character: options.character,
        source: 'sora',
        platforms: options.platforms || ['youtube', 'tiktok'],
        auto_publish: options.autoPublish || false,
        metadata: {
          command_id: commandId,
          file_size: fs.existsSync(videoPath) ? fs.statSync(videoPath).size : undefined,
        },
      };

      const response = await fetch(options.mediaPosterUrl || this.mediaPosterUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json() as { job_id?: string; id?: string };
      const jobId = result.job_id || result.id;

      console.log(`[Pipeline] ✅ MediaPoster alerted (job: ${jobId || 'queued'})`);
      this.emitEvent('mediaposter.alerted', commandId, { videoPath, jobId });

      return { success: true, jobId };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.warn(`[Pipeline] ⚠️ MediaPoster alert failed: ${errorMsg}`);
      this.emitEvent('mediaposter.error', commandId, { error: errorMsg });

      // Don't fail the pipeline if MediaPoster is unreachable
      return { success: false, error: errorMsg };
    }
  }

  private emitEvent(type: string, commandId: string, payload: Record<string, unknown>) {
    // Log event locally - telemetry integration optional
    console.log(`[Event] ${type}`, { commandId, ...payload });
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

let pipelineInstance: VideoPipeline | null = null;

export function getPipeline(): VideoPipeline {
  if (!pipelineInstance) {
    pipelineInstance = new VideoPipeline();
  }
  return pipelineInstance;
}

export async function processVideo(
  videoPath: string,
  options: PipelineOptions
): Promise<PipelineResult> {
  return getPipeline().processVideo(videoPath, options);
}

export async function processBatch(
  videoPaths: string[],
  options: Omit<PipelineOptions, 'prompt'> & { prompts?: Record<string, string> }
): Promise<BatchResult> {
  return getPipeline().processBatch(videoPaths, options);
}

export async function processDirectory(
  dirPath: string,
  options: Omit<PipelineOptions, 'prompt'>
): Promise<BatchResult> {
  return getPipeline().processDirectory(dirPath, options);
}
