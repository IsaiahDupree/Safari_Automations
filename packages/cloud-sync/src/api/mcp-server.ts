/**
 * Cloud Sync MCP Server — JSON-RPC 2.0 over stdio
 * Sync service: http://localhost:3200
 * Start: npx tsx packages/cloud-sync/src/api/mcp-server.ts
 */

import * as readline from 'readline';

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_NAME = 'cloud-sync-safari-automation';
const SERVER_VERSION = '1.0.0';
const SYNC_BASE = 'http://localhost:3200';
const TIMEOUT_MS = 30_000;

function formatMcpError(e: unknown, platform = 'cloud-sync'): string {
  const msg = e instanceof Error ? e.message : String(e);
  const lowerMsg = msg.toLowerCase();

  if (typeof e === 'object' && e !== null && 'code' in e) {
    const obj = e as { code?: string; message?: string };
    if (obj.code === 'ECONNREFUSED' || obj.code === 'SERVICE_DOWN') {
      return JSON.stringify({ code: 'SERVICE_DOWN', message: ':3200 not running — start with: PORT=3200 npx tsx packages/cloud-sync/src/api/server.ts', platform });
    }
    return JSON.stringify(e);
  }

  if (lowerMsg.includes('econnrefused') || lowerMsg.includes('aborterror') || lowerMsg.includes('abort')) {
    return JSON.stringify({ code: 'SERVICE_DOWN', message: ':3200 not running — start with: PORT=3200 npx tsx packages/cloud-sync/src/api/server.ts', platform });
  }

  return JSON.stringify({ code: 'API_ERROR', message: msg.slice(0, 200), platform });
}

function structuredError(status: number, body: string, platform: string): never {
  if (status === 429) throw { code: 'RATE_LIMITED', message: 'Rate limit hit — wait before retrying', retryAfter: 60, platform };
  if (status === 401 || status === 403) throw { code: 'SESSION_EXPIRED', message: 'Safari session expired or unauthorized', platform };
  if (status === 404) throw { code: 'NOT_FOUND', message: body.slice(0, 100), platform };
  throw { code: 'API_ERROR', message: `HTTP ${status}: ${body.slice(0, 200)}`, platform };
}

async function api(base: string, method: 'GET' | 'POST', path: string, body?: Record<string, unknown>): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: ctrl.signal });
    const text = await res.text();
    if (!res.ok) structuredError(res.status, text, 'cloud-sync');
    return JSON.parse(text);
  } catch (err) {
    const e = err as { name?: string; cause?: { code?: string }; code?: string };
    if (e.name === 'AbortError') throw { code: 'SERVICE_DOWN', message: `${base} did not respond within ${TIMEOUT_MS / 1000}s — is the service running?`, base };
    if (e.code === 'ECONNREFUSED' || e.cause?.code === 'ECONNREFUSED') throw { code: 'SERVICE_DOWN', message: `${base} is not running`, base };
    throw err;
  } finally { clearTimeout(t); }
}

const TOOLS = [
  {
    name: 'cloud_sync_is_ready',
    description: 'Check if the Cloud Sync service (:3200) is reachable. Call this first each session.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'cloud_sync_status',
    description: 'Get sync engine status including running state, platform health, and dashboard stats.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'cloud_sync_start',
    description: 'Start the background sync engine. It will begin polling all platforms for DMs, notifications, and post stats.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'cloud_sync_stop',
    description: 'Stop the background sync engine.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'cloud_sync_poll',
    description: 'Trigger an immediate poll cycle. Optionally filter by dataType (dms, notifications, post_stats) and/or platform.',
    inputSchema: { type: 'object', properties: { dataType: { type: 'string', enum: ['dms', 'notifications', 'post_stats'], description: 'Type of data to poll (omit for all)' }, platform: { type: 'string', description: 'Platform to poll (omit for all)' } } },
  },
  {
    name: 'cloud_sync_get_notifications',
    description: 'Get unactioned notifications across all platforms. Filter by platform.',
    inputSchema: { type: 'object', properties: { platform: { type: 'string', description: 'Filter by platform' }, limit: { type: 'number', description: 'Max results (default 50)' } } },
  },
  {
    name: 'cloud_sync_action_notification',
    description: 'Mark a notification as actioned. Provide the notification ID and optional action string.',
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'Notification ID' }, action: { type: 'string', description: 'Action taken (default: acknowledged)' } }, required: ['id'] },
  },
  {
    name: 'cloud_sync_get_dms',
    description: 'Get unreplied DMs across all platforms synced by the background engine. Use this to see what messages need a response. Filter by platform.',
    inputSchema: { type: 'object', properties: { platform: { type: 'string', description: 'Filter by platform' }, limit: { type: 'number', description: 'Max results (default 50)' } } },
  },
  {
    name: 'cloud_sync_mark_dm_replied',
    description: 'Mark a DM as replied by its ID.',
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'DM record ID' } }, required: ['id'] },
  },
  {
    name: 'cloud_sync_get_posts',
    description: 'Get post stats across all platforms. Filter by platform.',
    inputSchema: { type: 'object', properties: { platform: { type: 'string', description: 'Filter by platform' }, limit: { type: 'number', description: 'Max results (default 50)' } } },
  },
  {
    name: 'cloud_sync_get_top_posts',
    description: 'Get top performing posts ranked by engagement. Use this to identify winning content patterns.',
    inputSchema: { type: 'object', properties: { platform: { type: 'string', description: 'Filter by platform' }, limit: { type: 'number', description: 'Max results (default 10)' } } },
  },
  {
    name: 'cloud_sync_queue_action',
    description: 'Queue a cloud action for the local Safari worker to execute. action_type can be: comment, send_dm, like, follow, research. priority: 1=highest, 10=lowest (default 5).',
    inputSchema: { type: 'object', properties: { platform: { type: 'string', description: 'Target platform' }, action_type: { type: 'string', description: 'Action type: comment, send_dm, like, follow, research' }, target_username: { type: 'string', description: 'Target username' }, target_post_url: { type: 'string', description: 'Target post URL' }, params: { type: 'object', description: 'Additional parameters' }, priority: { type: 'number', description: 'Priority 1-10 (default 5)', default: 5 } }, required: ['platform', 'action_type'] },
  },
  {
    name: 'cloud_sync_analytics_brief',
    description: 'Get AI-generated content brief based on recent post performance. Use this before creating new content to understand what hooks and formats are working.',
    inputSchema: { type: 'object', properties: { platform: { type: 'string', description: 'Filter by platform' } } },
  },
  {
    name: 'cloud_sync_dashboard',
    description: 'Get dashboard stats: DM counts, notification counts, post stats, action queue size across all platforms.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'cloud_sync_learnings',
    description: 'Get active content learnings extracted from post analytics. Filter by platform.',
    inputSchema: { type: 'object', properties: { platform: { type: 'string', description: 'Filter by platform' } } },
  },
];

async function executeTool(name: string, args: Record<string, unknown>): Promise<{ content: Array<{ type: string; text: string }> }> {
  let result: unknown;
  switch (name) {
    case 'cloud_sync_is_ready': {
      const start = Date.now();
      try {
        const r = await fetch(`${SYNC_BASE}/health`, { signal: AbortSignal.timeout(5000) });
        const ok = r.ok;
        result = { ready: ok, url: SYNC_BASE, latencyMs: Date.now() - start };
      } catch {
        result = { ready: false, url: SYNC_BASE, latencyMs: Date.now() - start };
      }
      break;
    }
    case 'cloud_sync_status':
      result = await api(SYNC_BASE, 'GET', '/api/status');
      break;
    case 'cloud_sync_start':
      result = await api(SYNC_BASE, 'POST', '/api/sync/start');
      break;
    case 'cloud_sync_stop':
      result = await api(SYNC_BASE, 'POST', '/api/sync/stop');
      break;
    case 'cloud_sync_poll':
      result = await api(SYNC_BASE, 'POST', '/api/sync/poll-now', { dataType: args.dataType, platform: args.platform });
      break;
    case 'cloud_sync_get_notifications': {
      const params = new URLSearchParams();
      if (args.platform) params.set('platform', args.platform as string);
      if (args.limit) params.set('limit', String(args.limit));
      const qs = params.toString();
      result = await api(SYNC_BASE, 'GET', `/api/notifications${qs ? '?' + qs : ''}`);
      break;
    }
    case 'cloud_sync_action_notification':
      result = await api(SYNC_BASE, 'POST', `/api/notifications/${args.id}/action`, { action: args.action ?? 'acknowledged' });
      break;
    case 'cloud_sync_get_dms': {
      const params = new URLSearchParams();
      if (args.platform) params.set('platform', args.platform as string);
      if (args.limit) params.set('limit', String(args.limit));
      const qs = params.toString();
      result = await api(SYNC_BASE, 'GET', `/api/dms${qs ? '?' + qs : ''}`);
      break;
    }
    case 'cloud_sync_mark_dm_replied':
      result = await api(SYNC_BASE, 'POST', `/api/dms/${args.id}/replied`);
      break;
    case 'cloud_sync_get_posts': {
      const params = new URLSearchParams();
      if (args.platform) params.set('platform', args.platform as string);
      if (args.limit) params.set('limit', String(args.limit));
      const qs = params.toString();
      result = await api(SYNC_BASE, 'GET', `/api/posts${qs ? '?' + qs : ''}`);
      break;
    }
    case 'cloud_sync_get_top_posts': {
      const params = new URLSearchParams();
      if (args.platform) params.set('platform', args.platform as string);
      if (args.limit) params.set('limit', String(args.limit));
      const qs = params.toString();
      result = await api(SYNC_BASE, 'GET', `/api/posts/top${qs ? '?' + qs : ''}`);
      break;
    }
    case 'cloud_sync_queue_action':
      result = await api(SYNC_BASE, 'POST', '/api/actions/queue', {
        platform: args.platform,
        action_type: args.action_type,
        target_username: args.target_username,
        target_post_url: args.target_post_url,
        params: args.params,
        priority: args.priority,
      });
      break;
    case 'cloud_sync_analytics_brief': {
      const params = new URLSearchParams();
      if (args.platform) params.set('platform', args.platform as string);
      const qs = params.toString();
      result = await api(SYNC_BASE, 'GET', `/api/analytics/brief${qs ? '?' + qs : ''}`);
      break;
    }
    case 'cloud_sync_dashboard':
      result = await api(SYNC_BASE, 'GET', '/api/analytics/dashboard');
      break;
    case 'cloud_sync_learnings': {
      const params = new URLSearchParams();
      if (args.platform) params.set('platform', args.platform as string);
      const qs = params.toString();
      result = await api(SYNC_BASE, 'GET', `/api/analytics/learnings${qs ? '?' + qs : ''}`);
      break;
    }
    default: throw { code: -32601, message: `Unknown tool: ${name}` };
  }
  return { content: [{ type: 'text', text: JSON.stringify(result) }] };
}

interface JsonRpcRequest { jsonrpc: '2.0'; id?: number | string | null; method: string; params?: Record<string, unknown>; }
interface JsonRpcResponse { jsonrpc: '2.0'; id: number | string | null; result?: unknown; error?: { code: number; message: string }; }

async function handleRequest(req: JsonRpcRequest): Promise<JsonRpcResponse | null> {
  const id = req.id ?? null;
  if (req.id === undefined && req.method !== 'initialize') return null;
  switch (req.method) {
    case 'initialize':
      return { jsonrpc: '2.0', id, result: { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: { name: SERVER_NAME, version: SERVER_VERSION } } };
    case 'notifications/initialized': return null;
    case 'tools/list': return { jsonrpc: '2.0', id, result: { tools: TOOLS } };
    case 'tools/call': {
      const p = req.params || {};
      const toolName = p.name as string;
      const toolArgs = (p.arguments || {}) as Record<string, unknown>;
      if (!toolName) return { jsonrpc: '2.0', id, error: { code: -32602, message: 'Missing tool name' } };
      if (!TOOLS.some(t => t.name === toolName)) return { jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown tool: ${toolName}` } };
      try {
        return { jsonrpc: '2.0', id, result: await executeTool(toolName, toolArgs) };
      } catch (err) {
        const e = err as { code?: number; message?: string };
        if (typeof e.code === 'number') return { jsonrpc: '2.0', id, error: { code: e.code, message: e.message || 'Tool error' } };
        return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: formatMcpError(err) }], isError: true } };
      }
    }
    default: return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${req.method}` } };
  }
}

export function startMCPServer(): void {
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let req: JsonRpcRequest;
    try { req = JSON.parse(trimmed); } catch {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) + '\n');
      return;
    }
    const res = await handleRequest(req);
    if (res) process.stdout.write(JSON.stringify(res) + '\n');
  });
  rl.on('close', () => process.exit(0));
  process.stderr.write(`[MCP] ${SERVER_NAME} v${SERVER_VERSION} started\n`);
}

if (process.argv[1]?.includes('mcp-server')) startMCPServer();
