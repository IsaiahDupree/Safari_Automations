/**
 * BAC-002: Unified Browser Control Server
 *
 * Central dispatch router for all browser automation agents.
 * Routes commands to Safari (Instagram, TikTok, Twitter, Threads, Upwork)
 * and Chrome (LinkedIn) based on platform registration.
 *
 * Port: 3110 (configurable via UNIFIED_CONTROL_PORT)
 *
 * Endpoints:
 *   POST /api/browser/command - Dispatch a browser command
 *   GET /api/browser/agents - List all registered agents
 *   GET /health - Health check all agents
 */

import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import {
  dispatchCommand,
  listAgents,
  healthCheckAll,
  BrowserCommandSchema,
  BrowserCommandRequest,
} from './router.js';

const app = express();
const PORT = parseInt(process.env.UNIFIED_CONTROL_PORT || '3110', 10);

// Middleware
app.use(cors());
app.use(express.json());

// Request logging
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
  });
  next();
});

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * POST /api/browser/command
 *
 * Dispatch a browser command to the appropriate service.
 *
 * Body:
 *   {
 *     "platform": "instagram",
 *     "action": "search",
 *     "params": { "keyword": "ai automation" },
 *     "task_id": "optional-task-id"
 *   }
 *
 * Response:
 *   {
 *     "success": true,
 *     "result": { ... },
 *     "screenshot_url": "https://...",
 *     "metadata": { "service_url": "...", "platform": "...", "browser_type": "..." }
 *   }
 */
app.post('/api/browser/command', async (req: Request, res: Response) => {
  try {
    // Validate request
    const parsed = BrowserCommandSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: 'Invalid request',
        details: parsed.error.flatten(),
      });
    }

    const request: BrowserCommandRequest = parsed.data;

    // Dispatch command
    const response = await dispatchCommand(request);

    // Return unified response
    const statusCode = response.success ? 200 : 500;
    res.status(statusCode).json(response);

  } catch (error) {
    console.error('[server] /api/browser/command error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
});

/**
 * GET /api/browser/agents
 *
 * List all registered browser agents.
 *
 * Query params:
 *   ?health_status=healthy  (optional)
 *
 * Response:
 *   {
 *     "agents": [
 *       {
 *         "id": "...",
 *         "platform": "instagram",
 *         "browser_type": "safari",
 *         "service_url": "http://localhost:3100",
 *         "supported_actions": ["dm", "comment", "search"],
 *         "health_status": "healthy",
 *         "last_heartbeat_at": "2026-03-07T..."
 *       },
 *       ...
 *     ]
 *   }
 */
app.get('/api/browser/agents', async (req: Request, res: Response) => {
  try {
    const healthStatus = req.query.health_status as string | undefined;

    const agents = await listAgents(healthStatus);

    res.json({ agents });

  } catch (error) {
    console.error('[server] /api/browser/agents error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
});

/**
 * GET /health
 *
 * Health check all registered agents.
 *
 * Response:
 *   {
 *     "status": "ok" | "degraded" | "down",
 *     "healthy_count": 5,
 *     "total_count": 6,
 *     "agents": [
 *       {
 *         "platform": "instagram",
 *         "browser_type": "safari",
 *         "service_url": "http://localhost:3100",
 *         "status": "healthy",
 *         "status_code": 200
 *       },
 *       ...
 *     ]
 *   }
 */
app.get('/health', async (req: Request, res: Response) => {
  try {
    const health = await healthCheckAll();

    const statusCode = health.status === 'ok' ? 200 : health.status === 'degraded' ? 206 : 503;

    res.status(statusCode).json(health);

  } catch (error) {
    console.error('[server] /health error:', error);
    res.status(500).json({
      status: 'error',
      error: error instanceof Error ? error.message : 'Health check failed',
    });
  }
});

/**
 * GET /
 *
 * Root endpoint - service info.
 */
app.get('/', (req: Request, res: Response) => {
  res.json({
    service: 'unified-browser-control',
    version: '1.0.0',
    description: 'BAC-002: Unified dispatch router for all browser automation agents',
    endpoints: {
      'POST /api/browser/command': 'Dispatch a browser command',
      'GET /api/browser/agents': 'List all registered agents',
      'GET /health': 'Health check all agents',
    },
    github: 'https://github.com/isaiahdupree/Safari-Automation',
  });
});

// ─── Start Server ─────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log('┌─────────────────────────────────────────────────────────┐');
  console.log('│  Unified Browser Control API (BAC-002)                  │');
  console.log('├─────────────────────────────────────────────────────────┤');
  console.log(`│  Port: ${PORT}                                             │`);
  console.log('│  Endpoints:                                             │');
  console.log('│    POST /api/browser/command                            │');
  console.log('│    GET  /api/browser/agents                             │');
  console.log('│    GET  /health                                         │');
  console.log('└─────────────────────────────────────────────────────────┘');
  console.log('');
  console.log('Ready to route browser commands to registered agents.');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[server] SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[server] SIGINT received, shutting down gracefully...');
  process.exit(0);
});
