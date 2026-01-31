/**
 * Job management routes
 */

import { createReadStream, existsSync, statSync } from 'fs';
import { jobManager } from '../index.js';
import { logger } from '../utils/logger.js';

export const jobsRouter = {
  async getJob(req: any, res: any, jobId: string) {
    const job = jobManager.getJob(jobId);

    if (!job) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Job not found' }));
      return;
    }

    const response: any = {
      job_id: job.id,
      status: job.status,
      progress: job.progress,
      stage: job.stage,
      created_at: job.created_at,
      started_at: job.started_at,
      completed_at: job.completed_at,
    };

    if (job.result) {
      response.result = job.result;
    }

    if (job.error) {
      response.error = job.error;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response));
  },

  async listJobs(req: any, res: any) {
    const jobs = jobManager.listJobs(50);

    const response = jobs.map(job => ({
      job_id: job.id,
      status: job.status,
      progress: job.progress,
      created_at: job.created_at,
      completed_at: job.completed_at,
    }));

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ jobs: response }));
  },

  async downloadJob(req: any, res: any, jobId: string) {
    const job = jobManager.getJob(jobId);

    if (!job) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Job not found' }));
      return;
    }

    if (job.status !== 'completed') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Job not completed yet' }));
      return;
    }

    // If we have video_bytes in result, return that
    if (job.result?.video_bytes) {
      const buffer = Buffer.from(job.result.video_bytes, 'base64');
      res.writeHead(200, {
        'Content-Type': 'video/mp4',
        'Content-Length': buffer.length,
        'Content-Disposition': `attachment; filename="processed_${jobId}.mp4"`,
      });
      res.end(buffer);
      return;
    }

    // If we have a local file path
    if (job.output_path && existsSync(job.output_path)) {
      const stats = statSync(job.output_path);
      res.writeHead(200, {
        'Content-Type': 'video/mp4',
        'Content-Length': stats.size,
        'Content-Disposition': `attachment; filename="processed_${jobId}.mp4"`,
      });
      createReadStream(job.output_path).pipe(res);
      return;
    }

    // If we have a URL, redirect
    if (job.result?.video_url) {
      res.writeHead(302, { 'Location': job.result.video_url });
      res.end();
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'No video available' }));
  },
};
