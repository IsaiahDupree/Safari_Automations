/**
 * Safari Automation API Server
 * 
 * High-quality video processing API for:
 * - Watermark removal (Modal GPU - YOLO + LAMA)
 * - AI upscaling (Replicate - Real-ESRGAN)
 * - High-quality encoding (HEVC/H.264)
 */

import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { config } from 'dotenv';
import { v4 as uuidv4 } from 'uuid';
import { videoRouter } from './routes/video.js';
import { jobsRouter } from './routes/jobs.js';
import { healthRouter } from './routes/health.js';
import { commandsRouter } from './routes/commands.js';
import { JobManager } from './services/job-manager.js';
import { logger } from './utils/logger.js';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env from project root (Safari Automation/) - try multiple paths
const envPaths = [
  resolve(__dirname, '../../../.env'),           // From src/
  resolve(process.cwd(), '../../.env'),          // From apps/api/
  resolve(process.cwd(), '.env'),                // Current dir
];

for (const envPath of envPaths) {
  const result = config({ path: envPath });
  if (!result.error) {
    console.log(`[Config] Loaded .env from: ${envPath}`);
    break;
  }
}

const CONTROL_PORT = parseInt(process.env.CONTROL_PORT || '7070');
const TELEMETRY_PORT = parseInt(process.env.TELEMETRY_PORT || '7071');
const LOCAL_ONLY = process.env.LOCAL_ONLY === 'true';
const IS_PRODUCTION = process.env.NODE_ENV === 'production' || 
                      process.env.VERCEL === '1' || 
                      process.env.RENDER === 'true';

// Block production deployment - this server is LOCAL ONLY
if (IS_PRODUCTION && LOCAL_ONLY) {
  console.error('❌ Safari Automation API is LOCAL ONLY and cannot run in production.');
  console.error('   Set LOCAL_ONLY=false in .env to enable (not recommended).');
  process.exit(1);
}

// Simple router
type Handler = (req: any, res: any, body?: any) => Promise<void>;
const routes: Map<string, Map<string, Handler>> = new Map();

function addRoute(method: string, path: string, handler: Handler) {
  if (!routes.has(method)) {
    routes.set(method, new Map());
  }
  routes.get(method)!.set(path, handler);
}

// Initialize job manager (singleton)
export const jobManager = new JobManager();

// WebSocket clients for job subscriptions
const wsClients: Map<string, Set<WebSocket>> = new Map();

export function broadcastJobUpdate(jobId: string, data: any) {
  const clients = wsClients.get(jobId);
  if (clients) {
    const message = JSON.stringify(data);
    clients.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(message);
      }
    });
  }
}

// Parse JSON body
async function parseBody(req: any): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: any) => body += chunk);
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

// CORS headers
function setCorsHeaders(res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

// Create HTTP server
const server = createServer(async (req, res) => {
  setCorsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url || '/', `http://localhost:${CONTROL_PORT}`);
  const path = url.pathname;
  const method = req.method || 'GET';

  logger.info(`${method} ${path}`);

  // Response helpers
  res.json = (data: any, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };

  res.error = (message: string, status = 500) => {
    res.json({ error: message }, status);
  };

  try {
    // Match routes
    let matched = false;

    // Health check
    if (path === '/health' && method === 'GET') {
      await healthRouter.health(req, res);
      matched = true;
    }

    // Video processing
    else if (path === '/api/v1/video/process' && method === 'POST') {
      const body = await parseBody(req);
      await videoRouter.processVideo(req, res, body);
      matched = true;
    }

    // Job status
    else if (path.startsWith('/api/v1/jobs/') && method === 'GET') {
      const parts = path.split('/');
      const jobId = parts[4];
      
      if (parts[5] === 'download') {
        await jobsRouter.downloadJob(req, res, jobId);
      } else {
        await jobsRouter.getJob(req, res, jobId);
      }
      matched = true;
    }

    // List jobs
    else if (path === '/api/v1/jobs' && method === 'GET') {
      await jobsRouter.listJobs(req, res);
      matched = true;
    }

    // Commands API (ACTP workflow integration)
    else if (path === '/v1/commands' && method === 'POST') {
      const body = await parseBody(req);
      await commandsRouter.submitCommand(req, res, body);
      matched = true;
    }
    else if (path === '/v1/commands' && method === 'GET') {
      await commandsRouter.listCommands(req, res);
      matched = true;
    }
    else if (path.startsWith('/v1/commands/') && method === 'GET') {
      const commandId = path.split('/')[3];
      await commandsRouter.getCommand(req, res, commandId);
      matched = true;
    }

    if (!matched) {
      res.error('Not found', 404);
    }
  } catch (error: any) {
    logger.error(`Request error: ${error.message}`);
    res.error(error.message, 500);
  }
});

// Create WebSocket server for real-time updates
const wss = new WebSocketServer({ port: TELEMETRY_PORT });

wss.on('connection', (ws) => {
  logger.info('[WS] Client connected');

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      
      if (message.type === 'subscribe' && message.job_id) {
        const jobId = message.job_id;
        if (!wsClients.has(jobId)) {
          wsClients.set(jobId, new Set());
        }
        wsClients.get(jobId)!.add(ws);
        logger.info(`[WS] Subscribed to job: ${jobId}`);
        
        // Send current status
        const job = jobManager.getJob(jobId);
        if (job) {
          ws.send(JSON.stringify({
            type: 'status',
            job_id: jobId,
            status: job.status,
            progress: job.progress,
            stage: job.stage,
          }));
        }
      }
    } catch (e) {
      logger.error('[WS] Invalid message');
    }
  });

  ws.on('close', () => {
    // Remove from all subscriptions
    wsClients.forEach((clients, jobId) => {
      clients.delete(ws);
      if (clients.size === 0) {
        wsClients.delete(jobId);
      }
    });
    logger.info('[WS] Client disconnected');
  });
});

// Start server - bind to localhost only for security
const HOST = LOCAL_ONLY ? '127.0.0.1' : '0.0.0.0';

server.listen(CONTROL_PORT, HOST, () => {
  logger.info(`🚀 Safari Automation API running on http://${HOST}:${CONTROL_PORT}`);
  logger.info(`📡 WebSocket telemetry on ws://${HOST}:${TELEMETRY_PORT}`);
  if (LOCAL_ONLY) {
    logger.info(`🔒 LOCAL ONLY mode - bound to localhost, external access blocked`);
  }
  logger.info('');
  logger.info('Endpoints:');
  logger.info(`  POST /api/v1/video/process - Submit video for HQ processing`);
  logger.info(`  GET  /api/v1/jobs/{id}     - Check job status`);
  logger.info(`  GET  /api/v1/jobs/{id}/download - Download processed video`);
  logger.info(`  GET  /health               - Health check`);
});

export { server, wss };
