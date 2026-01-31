/**
 * Telemetry Plane WebSocket Server (Port 7071)
 * Real-time event streaming with cursor-based replay
 */

import { WebSocketServer, WebSocket } from 'ws';
import { telemetryEmitter } from './event-emitter';
import { SubscribeMessage, SubscribedMessage, EventEnvelope } from './types';

const PORT = parseInt(process.env.TELEMETRY_PORT || '7071', 10);

interface ClientState {
  ws: WebSocket;
  subscriberId?: string;
  authenticated: boolean;
}

const clients: Map<WebSocket, ClientState> = new Map();

export function startTelemetryServer(port = PORT): WebSocketServer {
  const wss = new WebSocketServer({ port });

  console.log(`[TELEMETRY] Telemetry Plane listening on ws://localhost:${port}`);

  wss.on('connection', (ws: WebSocket, req) => {
    console.log(`[TELEMETRY] Client connected from ${req.socket.remoteAddress}`);

    const state: ClientState = {
      ws,
      authenticated: true, // For development; add auth in production
    };
    clients.set(ws, state);

    // Send welcome message
    ws.send(JSON.stringify({
      type: 'connected',
      message: 'Connected to Safari Manager Telemetry',
      cursor: telemetryEmitter.getCurrentCursor(),
    }));

    ws.on('message', (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        handleMessage(ws, state, message);
      } catch (error) {
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Invalid JSON',
        }));
      }
    });

    ws.on('close', () => {
      console.log('[TELEMETRY] Client disconnected');
      if (state.subscriberId) {
        telemetryEmitter.unsubscribe(state.subscriberId);
      }
      clients.delete(ws);
    });

    ws.on('error', (error) => {
      console.error('[TELEMETRY] WebSocket error:', error);
    });
  });

  return wss;
}

function handleMessage(ws: WebSocket, state: ClientState, message: any): void {
  switch (message.type) {
    case 'subscribe':
      handleSubscribe(ws, state, message as SubscribeMessage);
      break;

    case 'unsubscribe':
      handleUnsubscribe(state);
      break;

    case 'ping':
      ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
      break;

    default:
      ws.send(JSON.stringify({
        type: 'error',
        message: `Unknown message type: ${message.type}`,
      }));
  }
}

function handleSubscribe(ws: WebSocket, state: ClientState, message: SubscribeMessage): void {
  // Unsubscribe from previous subscription if exists
  if (state.subscriberId) {
    telemetryEmitter.unsubscribe(state.subscriberId);
  }

  // Create send function
  const send = (event: EventEnvelope) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(event));
    }
  };

  // Subscribe with filters
  state.subscriberId = telemetryEmitter.subscribe(
    send,
    message.filters || {},
    message.cursor
  );

  // Send confirmation
  const response: SubscribedMessage = {
    type: 'subscribed',
    cursor: telemetryEmitter.getCurrentCursor(),
  };
  ws.send(JSON.stringify(response));

  console.log(`[TELEMETRY] Client subscribed with filters:`, message.filters || 'none');
}

function handleUnsubscribe(state: ClientState): void {
  if (state.subscriberId) {
    telemetryEmitter.unsubscribe(state.subscriberId);
    state.subscriberId = undefined;
  }
}

// Broadcast to all connected clients (for system-wide events)
export function broadcast(event: EventEnvelope): void {
  clients.forEach((state) => {
    if (state.ws.readyState === WebSocket.OPEN) {
      state.ws.send(JSON.stringify(event));
    }
  });
}

// Run directly
if (require.main === module) {
  startTelemetryServer();
}
