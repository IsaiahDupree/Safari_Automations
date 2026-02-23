/**
 * Built-in Workers for the Universal Task Queue
 *
 * Registers local handlers for all existing Safari Automation capabilities.
 * Each worker maps task types to actual function calls.
 *
 * Task type taxonomy:
 *   research.search     — single keyword search on a platform
 *   research.niche      — full niche research pipeline
 *   research.full       — multi-niche research
 *   feedback.checkback  — run due check-backs
 *   feedback.analyze    — analyze + update strategy
 *   feedback.metrics    — extract metrics for a tweet URL
 *   feedback.cycle      — full feedback loop cycle
 *   feedback.register   — register a tweet for tracking
 *   comment.post        — post a comment/reply on a platform
 *   dm.send             — send a DM on a platform
 *   video.publish       — queue a video for publishing
 *   scrape.profile      — extract profile data
 */

import type { UniversalTaskQueue, Task } from './universal-queue.js';

// ─── Platform service URLs ──────────────────────────────────────

const SERVICES: Record<string, { port: number; basePath: string }> = {
  'twitter-comments': { port: 3007, basePath: '/api/twitter' },
  'twitter-dm':       { port: 3003, basePath: '/api/twitter' },
  'instagram-comments': { port: 3005, basePath: '/api/instagram' },
  'instagram-dm':     { port: 3100, basePath: '/api' },
  'tiktok-comments':  { port: 3006, basePath: '/api/tiktok' },
  'tiktok-dm':        { port: 3102, basePath: '/api/tiktok' },
  'threads-comments': { port: 3004, basePath: '/api/threads' },
  'linkedin':         { port: 3105, basePath: '/api/linkedin' },
  'upwork':           { port: 3104, basePath: '/api/upwork' },
  'publish':          { port: 5555, basePath: '/api/publish-controls' },
};

// ─── HTTP helper ─────────────────────────────────────────────────

async function callService(port: number, method: string, path: string, body?: any): Promise<any> {
  const http = await import('http');
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const options = {
      hostname: 'localhost',
      port,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode && res.statusCode >= 400) reject(new Error(parsed.error || `HTTP ${res.statusCode}`));
          else resolve(parsed);
        } catch { resolve(data); }
      });
    });
    req.on('error', reject);
    req.setTimeout(120000, () => { req.destroy(); reject(new Error('Service timeout')); });
    if (payload) req.write(payload);
    req.end();
  });
}

// ─── Register all built-in workers ──────────────────────────────

export function registerBuiltinWorkers(queue: UniversalTaskQueue, feedbackLoop?: any): void {

  // ═══ Research Worker ════════════════════════════════════════════

  queue.registerWorker({
    name: 'Research Worker',
    type: 'local',
    taskPatterns: ['research.*'],
    maxConcurrent: 1,
    handler: async (task: Task) => {
      const { type, platform, payload } = task;

      if (type === 'research.search') {
        return callService(3106, 'POST', `/api/research/${platform || payload.platform}/search`, {
          query: payload.query,
          config: payload.config,
        });
      }

      if (type === 'research.niche') {
        return callService(3106, 'POST', `/api/research/${platform || payload.platform}/niche`, {
          niche: payload.niche,
          config: payload.config,
        });
      }

      if (type === 'research.full') {
        return callService(3106, 'POST', `/api/research/${platform || payload.platform}/full`, {
          niches: payload.niches,
          config: payload.config,
        });
      }

      if (type === 'research.all') {
        return callService(3106, 'POST', '/api/research/all/full', {
          niches: payload.niches,
          platforms: payload.platforms,
          config: payload.config,
        });
      }

      throw new Error(`Unknown research task type: ${type}`);
    },
  });

  // ═══ Feedback Loop Worker ══════════════════════════════════════

  queue.registerWorker({
    name: 'Feedback Loop Worker',
    type: 'local',
    taskPatterns: ['feedback.*'],
    maxConcurrent: 1,
    handler: async (task: Task) => {
      const { type, payload } = task;

      if (type === 'feedback.register') {
        return callService(3106, 'POST', '/api/feedback/register', {
          tweetUrl: payload.tweetUrl,
          text: payload.text,
          niche: payload.niche,
          offer: payload.offer,
        });
      }

      if (type === 'feedback.checkback') {
        return callService(3106, 'POST', '/api/feedback/check-backs');
      }

      if (type === 'feedback.analyze') {
        return callService(3106, 'POST', '/api/feedback/analyze');
      }

      if (type === 'feedback.metrics') {
        return callService(3106, 'POST', '/api/feedback/metrics', { tweetUrl: payload.tweetUrl });
      }

      if (type === 'feedback.cycle') {
        return callService(3106, 'POST', '/api/feedback/cycle', {
          niche: payload.niche,
          style: payload.style,
          offer: payload.offer,
        });
      }

      if (type === 'feedback.prompt') {
        return callService(3106, 'POST', '/api/feedback/generate-prompt', {
          niche: payload.niche,
          style: payload.style,
          offer: payload.offer,
        });
      }

      throw new Error(`Unknown feedback task type: ${type}`);
    },
  });

  // ═══ Comment Worker ════════════════════════════════════════════

  queue.registerWorker({
    name: 'Comment Worker',
    type: 'local',
    taskPatterns: ['comment.*'],
    maxConcurrent: 1,
    handler: async (task: Task) => {
      const { platform, payload } = task;
      const p = platform || payload.platform;

      const serviceMap: Record<string, { port: number; path: string }> = {
        twitter:   { port: 3007, path: '/api/twitter/comments/post' },
        threads:   { port: 3004, path: '/api/threads/comments/post' },
        instagram: { port: 3005, path: '/api/instagram/comments/post' },
        tiktok:    { port: 3006, path: '/api/tiktok/comments/post' },
      };

      const svc = serviceMap[p];
      if (!svc) throw new Error(`No comment service for platform: ${p}`);

      return callService(svc.port, 'POST', svc.path, {
        url: payload.url || payload.postUrl,
        text: payload.text || payload.comment,
      });
    },
  });

  // ═══ DM Worker ═════════════════════════════════════════════════

  queue.registerWorker({
    name: 'DM Worker',
    type: 'local',
    taskPatterns: ['dm.*'],
    maxConcurrent: 1,
    handler: async (task: Task) => {
      const { platform, payload } = task;
      const p = platform || payload.platform;

      const serviceMap: Record<string, { port: number; path: string }> = {
        twitter:   { port: 3003, path: '/api/twitter/messages/send-to' },
        instagram: { port: 3100, path: '/api/messages/smart-send' },
        tiktok:    { port: 3102, path: '/api/tiktok/messages/send-to' },
        linkedin:  { port: 3105, path: '/api/linkedin/messages/send-to' },
      };

      const svc = serviceMap[p];
      if (!svc) throw new Error(`No DM service for platform: ${p}`);

      return callService(svc.port, 'POST', svc.path, {
        username: payload.username || payload.recipient,
        text: payload.text || payload.message,
        threadId: payload.threadId,
      });
    },
  });

  // ═══ Video Publish Worker ══════════════════════════════════════

  queue.registerWorker({
    name: 'Video Publish Worker',
    type: 'local',
    taskPatterns: ['video.*'],
    maxConcurrent: 1,
    handler: async (task: Task) => {
      const { type, payload } = task;

      if (type === 'video.queue') {
        return callService(5555, 'POST', '/api/publish-controls/queue', payload);
      }

      if (type === 'video.process') {
        const max = payload.maxItems || 1;
        return callService(5555, 'POST', `/api/publish-controls/process/batch?max_items=${max}`);
      }

      if (type === 'video.status') {
        return callService(5555, 'GET', '/api/publish-controls/status');
      }

      throw new Error(`Unknown video task type: ${type}`);
    },
  });

  // ═══ Scrape Worker ═════════════════════════════════════════════

  queue.registerWorker({
    name: 'Scrape Worker',
    type: 'local',
    taskPatterns: ['scrape.*'],
    maxConcurrent: 1,
    handler: async (task: Task) => {
      const { type, platform, payload } = task;
      const p = platform || payload.platform;

      if (type === 'scrape.profile' && p === 'linkedin') {
        return callService(3105, 'GET', `/api/linkedin/profile/${encodeURIComponent(payload.username)}`);
      }

      if (type === 'scrape.jobs' && p === 'upwork') {
        return callService(3104, 'POST', '/api/upwork/jobs/search', {
          keywords: payload.keywords,
          filters: payload.filters,
        });
      }

      throw new Error(`Unknown scrape task type: ${type} for platform: ${p}`);
    },
  });

  // ═══ Catch-all Remote Worker (for future extensibility) ═══════

  // External servers can register their own workers via the API:
  //   POST /api/queue/workers
  //   { name: "My Custom Worker", url: "http://myserver:8080/process", taskPatterns: ["custom.*"] }

  console.log(`[Queue] ${queue.listWorkers().length} built-in workers registered`);
}
