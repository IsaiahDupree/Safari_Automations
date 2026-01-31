/**
 * Control Plane HTTP Server (Port 7070)
 * REST API for commands and queries
 */

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import {
  createCommand,
  getCommand,
  cancelCommand,
  listCommands,
} from './command-handler';
import { telemetryEmitter } from './event-emitter';
import {
  CommandEnvelope,
  HealthResponse,
  ReadyResponse,
  CommandResponse,
} from './types';

const app = express();
const PORT = process.env.CONTROL_PORT || 7070;

// Middleware
app.use(cors());
app.use(express.json());

// Request logging
app.use((req: Request, _res: Response, next: NextFunction) => {
  console.log(`[CONTROL] ${req.method} ${req.path}`);
  next();
});

// Simple auth middleware (expand for production)
const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  
  // For now, accept any token or no token (development mode)
  // In production, validate against known tokens
  if (process.env.REQUIRE_AUTH === 'true' && !token) {
    return res.status(401).json({ error: 'Authorization required' });
  }
  
  next();
};

// =============================================================================
// Health & Readiness
// =============================================================================

app.get('/health', (_req: Request, res: Response) => {
  const response: HealthResponse = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
  };
  res.json(response);
});

app.get('/ready', async (_req: Request, res: Response) => {
  // Check dependencies
  const response: ReadyResponse = {
    ready: true,
    checks: {
      database: true, // In-memory for now
      safari: true,   // Assume available
      selectors: true,
    },
  };
  res.json(response);
});

// =============================================================================
// Sessions (placeholder - expand as needed)
// =============================================================================

const sessions: Map<string, { id: string; created_at: string; status: string }> = new Map();

app.post('/v1/sessions', authMiddleware, (req: Request, res: Response) => {
  const session_id = uuidv4();
  const session = {
    id: session_id,
    created_at: new Date().toISOString(),
    status: 'active',
    ...req.body,
  };
  sessions.set(session_id, session);
  res.status(201).json(session);
});

app.get('/v1/sessions/:id', authMiddleware, (req: Request, res: Response) => {
  const session = sessions.get(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  res.json(session);
});

app.delete('/v1/sessions/:id', authMiddleware, (req: Request, res: Response) => {
  const session = sessions.get(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  session.status = 'closed';
  res.json(session);
});

// =============================================================================
// Commands
// =============================================================================

app.post('/v1/commands', authMiddleware, (req: Request, res: Response) => {
  const envelope: Partial<CommandEnvelope> = {
    command_id: uuidv4(),
    requested_at: new Date().toISOString(),
    ...req.body,
  };

  // Validate required fields
  if (!envelope.type) {
    return res.status(400).json({ error: 'Missing required field: type' });
  }

  const state = createCommand(envelope);

  const response: CommandResponse = {
    command_id: state.command_id,
    status: state.status,
    accepted_at: state.created_at,
  };

  res.status(202).json(response);
});

app.get('/v1/commands/:id', authMiddleware, (req: Request, res: Response) => {
  const state = getCommand(req.params.id);
  if (!state) {
    return res.status(404).json({ error: 'Command not found' });
  }
  res.json(state);
});

app.post('/v1/commands/:id/cancel', authMiddleware, (req: Request, res: Response) => {
  const success = cancelCommand(req.params.id);
  if (!success) {
    return res.status(400).json({ error: 'Cannot cancel command' });
  }
  res.json({ cancelled: true });
});

app.get('/v1/commands', authMiddleware, (req: Request, res: Response) => {
  const filters = {
    status: req.query.status as string | undefined,
    since: req.query.since as string | undefined,
  };
  const commands = listCommands(filters as any);
  res.json({ commands, total: commands.length });
});

// =============================================================================
// Sora-specific endpoints
// =============================================================================

app.get('/v1/sora/usage', authMiddleware, async (_req: Request, res: Response) => {
  try {
    const { SoraFullAutomation } = await import('../../services/src/sora/sora-full-automation');
    const sora = new SoraFullAutomation();
    const usage = await sora.getUsage();
    res.json(usage);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to get usage',
    });
  }
});

// =============================================================================
// Telemetry info
// =============================================================================

app.get('/v1/telemetry/stats', authMiddleware, (_req: Request, res: Response) => {
  res.json({
    subscribers: telemetryEmitter.getSubscriberCount(),
    events_stored: telemetryEmitter.getEventCount(),
    current_cursor: telemetryEmitter.getCurrentCursor(),
  });
});

// =============================================================================
// OpenAPI spec endpoint
// =============================================================================

app.get('/openapi.json', (_req: Request, res: Response) => {
  res.json({
    openapi: '3.0.0',
    info: {
      title: 'Safari Manager Control API',
      version: '1.0.0',
      description: 'Control Plane for Safari automation commands',
    },
    servers: [{ url: `http://localhost:${PORT}` }],
    paths: {
      '/health': {
        get: { summary: 'Health check', responses: { '200': { description: 'Healthy' } } },
      },
      '/ready': {
        get: { summary: 'Readiness check', responses: { '200': { description: 'Ready' } } },
      },
      '/v1/commands': {
        post: { summary: 'Submit command', responses: { '202': { description: 'Accepted' } } },
        get: { summary: 'List commands', responses: { '200': { description: 'Command list' } } },
      },
      '/v1/commands/{id}': {
        get: { summary: 'Get command', responses: { '200': { description: 'Command state' } } },
      },
      '/v1/sora/usage': {
        get: { summary: 'Get Sora usage', responses: { '200': { description: 'Usage info' } } },
      },
    },
  });
});

// =============================================================================
// Error handler
// =============================================================================

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[CONTROL] Error:', err);
  res.status(500).json({ error: err.message });
});

// =============================================================================
// Start server
// =============================================================================

export function startControlServer(port = PORT): void {
  app.listen(port, () => {
    console.log(`[CONTROL] Control Plane listening on http://localhost:${port}`);
    console.log(`[CONTROL] OpenAPI spec at http://localhost:${port}/openapi.json`);
  });
}

// Run directly
if (require.main === module) {
  startControlServer();
}

export { app };
