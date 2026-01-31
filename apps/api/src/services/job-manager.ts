/**
 * Job Manager - Tracks video processing jobs
 */

import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger.js';

export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed';

export interface JobResult {
  video_url?: string;
  video_bytes?: string;
  video_path?: string;
  stats: {
    input_size_mb: number;
    output_size_mb: number;
    processing_time_s: number;
    watermarks_detected: number;
    frames_processed: number;
    upscaled: boolean;
    method: string;
  };
}

export interface Job {
  id: string;
  status: JobStatus;
  progress: number;
  stage: string;
  created_at: string;
  started_at?: string;
  completed_at?: string;
  options: any;
  metadata: any;
  result?: JobResult;
  error?: string;
  input_path?: string;
  output_path?: string;
}

export class JobManager {
  private jobs: Map<string, Job> = new Map();
  private onUpdateCallbacks: Map<string, ((job: Job) => void)[]> = new Map();

  createJob(options: any, metadata: any = {}): Job {
    const job: Job = {
      id: `sa-job-${uuidv4().slice(0, 8)}`,
      status: 'queued',
      progress: 0,
      stage: 'queued',
      created_at: new Date().toISOString(),
      options,
      metadata,
    };

    this.jobs.set(job.id, job);
    logger.info(`[JobManager] Created job: ${job.id}`);
    return job;
  }

  getJob(jobId: string): Job | undefined {
    return this.jobs.get(jobId);
  }

  listJobs(limit = 50): Job[] {
    return Array.from(this.jobs.values())
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, limit);
  }

  updateJob(jobId: string, updates: Partial<Job>): Job | undefined {
    const job = this.jobs.get(jobId);
    if (!job) return undefined;

    Object.assign(job, updates);
    this.jobs.set(jobId, job);

    // Trigger callbacks
    const callbacks = this.onUpdateCallbacks.get(jobId) || [];
    callbacks.forEach(cb => cb(job));

    return job;
  }

  startJob(jobId: string): Job | undefined {
    return this.updateJob(jobId, {
      status: 'processing',
      started_at: new Date().toISOString(),
      stage: 'starting',
    });
  }

  updateProgress(jobId: string, progress: number, stage: string): Job | undefined {
    return this.updateJob(jobId, { progress, stage });
  }

  completeJob(jobId: string, result: JobResult): Job | undefined {
    return this.updateJob(jobId, {
      status: 'completed',
      progress: 100,
      stage: 'completed',
      completed_at: new Date().toISOString(),
      result,
    });
  }

  failJob(jobId: string, error: string): Job | undefined {
    return this.updateJob(jobId, {
      status: 'failed',
      stage: 'failed',
      completed_at: new Date().toISOString(),
      error,
    });
  }

  onUpdate(jobId: string, callback: (job: Job) => void): () => void {
    if (!this.onUpdateCallbacks.has(jobId)) {
      this.onUpdateCallbacks.set(jobId, []);
    }
    this.onUpdateCallbacks.get(jobId)!.push(callback);

    // Return unsubscribe function
    return () => {
      const callbacks = this.onUpdateCallbacks.get(jobId);
      if (callbacks) {
        const index = callbacks.indexOf(callback);
        if (index > -1) callbacks.splice(index, 1);
      }
    };
  }

  // Cleanup old jobs (older than 24h)
  cleanup(): void {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    let cleaned = 0;

    this.jobs.forEach((job, id) => {
      if (new Date(job.created_at).getTime() < cutoff) {
        this.jobs.delete(id);
        this.onUpdateCallbacks.delete(id);
        cleaned++;
      }
    });

    if (cleaned > 0) {
      logger.info(`[JobManager] Cleaned up ${cleaned} old jobs`);
    }
  }
}
