/**
 * TikTok Comments MCP Server — JSON-RPC 2.0 over stdio
 *
 * Implements the Model Context Protocol (MCP) for tool-calling integration.
 * Reads JSON-RPC messages from stdin, writes responses to stdout.
 * Delegates to the TikTok Comments REST API on port 3006.
 */

import * as readline from 'readline';

const TIKTOK_BASE = 'http://localhost:3006';
const TIKTOK_AUTH = process.env.TIKTOK_AUTH_TOKEN || '';
const TIMEOUT_MS = 30_000;

// ═══════════════════════════════════════════════════════════════
// Structured error codes
// ═══════════════════════════════════════════════════════════════

const ERROR_CODES = {
  RATE_LIMITED: { code: 4290, message: 'Rate limited by TikTok — wait before retrying' },
  SESSION_EXPIRED: { code: 4010, message: 'TikTok session expired — re-login in Safari' },
  SERVICE_DOWN: { code: 5030, message: 'TikTok Comments service is not reachable' },
} as const;

function classifyError(err: unknown): { code: string; message: string } {
  const e = err as { name?: string; cause?: { code?: string }; message?: string; code?: string };
  if (e.name === 'AbortError') return { code: 'SERVICE_DOWN', message: ERROR_CODES.SERVICE_DOWN.message };
  if (e.code === 'ECONNREFUSED' || e.cause?.code === 'ECONNREFUSED') return { code: 'SERVICE_DOWN', message: ERROR_CODES.SERVICE_DOWN.message };
  const msg = e.message || String(err);
  if (msg.includes('rate limit') || msg.includes('too many')) return { code: 'RATE_LIMITED', message: ERROR_CODES.RATE_LIMITED.message };
  if (msg.includes('session') || msg.includes('log in') || msg.includes('login')) return { code: 'SESSION_EXPIRED', message: ERROR_CODES.SESSION_EXPIRED.message };
  return { code: 'UNKNOWN', message: msg };
}

// ═══════════════════════════════════════════════════════════════
// HTTP helper — calls the REST API on port 3006
// ═══════════════════════════════════════════════════════════════

async function api(method: 'GET' | 'POST' | 'PUT', path: string, body?: Record<string, unknown>): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (TIKTOK_AUTH) headers['Authorization'] = `Bearer ${TIKTOK_AUTH}`;
    const res = await fetch(`${TIKTOK_BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      // Check for structured error patterns from REST API
      if (res.status === 429) throw { code: 'RATE_LIMITED', message: ERROR_CODES.RATE_LIMITED.message };
      if (res.status === 401) throw { code: 'SESSION_EXPIRED', message: ERROR_CODES.SESSION_EXPIRED.message };
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    return JSON.parse(text);
  } catch (err) {
    const classified = classifyError(err);
    if (classified.code !== 'UNKNOWN') throw classified;
    throw err;
  } finally { clearTimeout(t); }
}

// ═══════════════════════════════════════════════════════════════
// Protocol constants
// ═══════════════════════════════════════════════════════════════

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_NAME = 'tiktok-comments-safari-automation';
const SERVER_VERSION = '1.0.0';

// ═══════════════════════════════════════════════════════════════
// Tool definitions
// ═══════════════════════════════════════════════════════════════

const TOOLS = [
  {
    name: 'tiktok_comments_is_ready',
    description: 'Check if TikTok Comments service (:3006) is reachable. Returns {ready, port, timestamp}.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'tiktok_comments_get_status',
    description: 'Get current TikTok session status — login state, current URL, rate limits.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'tiktok_comments_navigate',
    description: 'Navigate Safari to a TikTok video URL. Must be in /video/ format (no short-links).',
    inputSchema: {
      type: 'object',
      properties: {
        videoUrl: { type: 'string', description: 'TikTok video URL (must contain /video/)' },
      },
      required: ['videoUrl'],
    },
  },
  {
    name: 'tiktok_comments_post',
    description: 'Post a comment on a TikTok video. Supports dryRun mode.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Comment text to post' },
        videoUrl: { type: 'string', description: 'Optional video URL to navigate to first' },
        dryRun: { type: 'boolean', description: 'If true, simulate without posting', default: false },
      },
      required: ['text'],
    },
  },
  {
    name: 'tiktok_comments_get',
    description: 'Get comments from the current TikTok video page.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max comments to return', default: 50 },
      },
    },
  },
  {
    name: 'tiktok_comments_search',
    description: 'Search TikTok videos by keyword.',
    inputSchema: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: 'Search query' },
        limit: { type: 'number', description: 'Max results', default: 20 },
      },
      required: ['keyword'],
    },
  },
  {
    name: 'tiktok_comments_trending',
    description: 'Get trending TikTok videos from the For You page.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max videos to return', default: 20 },
      },
    },
  },
  {
    name: 'tiktok_comments_like',
    description: 'Like a TikTok comment by commentId. Supports dryRun mode.',
    inputSchema: {
      type: 'object',
      properties: {
        commentId: { type: 'string', description: 'Comment ID to like' },
        dryRun: { type: 'boolean', description: 'If true, simulate without liking', default: false },
      },
      required: ['commentId'],
    },
  },
  {
    name: 'tiktok_comments_get_metrics',
    description: 'Get engagement metrics (views, likes, comments, shares) for the current TikTok video.',
    inputSchema: { type: 'object', properties: {} },
  },
];

// ═══════════════════════════════════════════════════════════════
// Tool execution
// ═══════════════════════════════════════════════════════════════

async function executeTool(name: string, args: Record<string, unknown>): Promise<{ content: Array<{ type: string; text: string }> }> {
  switch (name) {
    case 'tiktok_comments_is_ready': {
      try {
        const r = await fetch(`${TIKTOK_BASE}/health`, { signal: AbortSignal.timeout(5000) });
        const data = await r.json() as Record<string, unknown>;
        return { content: [{ type: 'text', text: JSON.stringify({ ready: r.ok, port: 3006, timestamp: new Date().toISOString(), status: data.status }) }] };
      } catch {
        return { content: [{ type: 'text', text: JSON.stringify({ ready: false, port: 3006, timestamp: new Date().toISOString(), error: ERROR_CODES.SERVICE_DOWN.message }) }] };
      }
    }

    case 'tiktok_comments_get_status': {
      const result = await api('GET', '/api/tiktok/status');
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }

    case 'tiktok_comments_navigate': {
      const videoUrl = args.videoUrl as string;
      if (!videoUrl.includes('/video/')) {
        return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'URL must contain /video/ — short-links not supported' }) }] };
      }
      const result = await api('POST', '/api/tiktok/navigate', { url: videoUrl });
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }

    case 'tiktok_comments_post': {
      const text = args.text as string;
      const videoUrl = args.videoUrl as string | undefined;
      const dryRun = args.dryRun as boolean | undefined;
      const result = await api('POST', '/api/tiktok/comments/post', {
        text,
        videoUrl,
        dry_run: dryRun || false,
      });
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }

    case 'tiktok_comments_get': {
      const limit = (args.limit as number) || 50;
      const result = await api('GET', `/api/tiktok/comments?limit=${limit}`);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }

    case 'tiktok_comments_search': {
      const keyword = args.keyword as string;
      const limit = (args.limit as number) || 20;
      const result = await api('POST', '/api/tiktok/search', { query: keyword, limit });
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }

    case 'tiktok_comments_trending': {
      const limit = (args.limit as number) || 20;
      const result = await api('GET', `/api/tiktok/trending?limit=${limit}`);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }

    case 'tiktok_comments_like': {
      const commentId = args.commentId as string;
      const dryRun = args.dryRun as boolean | undefined;
      if (dryRun) {
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, dryRun: true, commentId, message: 'Dry-run: comment not actually liked' }) }] };
      }
      const result = await api('POST', `/api/tiktok/comments/${encodeURIComponent(commentId)}/like`);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }

    case 'tiktok_comments_get_metrics': {
      const result = await api('GET', '/api/tiktok/video-metrics');
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }

    default:
      throw { code: -32601, message: `Unknown tool: ${name}` };
  }
}

// ═══════════════════════════════════════════════════════════════
// JSON-RPC 2.0 handler
// ═══════════════════════════════════════════════════════════════

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number | string | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

async function handleRequest(request: JsonRpcRequest): Promise<JsonRpcResponse | null> {
  const id = request.id ?? null;

  if (request.id === undefined && request.method !== 'initialize') {
    return null;
  }

  switch (request.method) {
    case 'initialize':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        },
      };

    case 'notifications/initialized':
      return null;

    case 'tools/list':
      return {
        jsonrpc: '2.0',
        id,
        result: { tools: TOOLS },
      };

    case 'tools/call': {
      const params = request.params || {};
      const toolName = params.name as string;
      const toolArgs = (params.arguments || {}) as Record<string, unknown>;

      if (!toolName) {
        return { jsonrpc: '2.0', id, error: { code: -32602, message: 'Missing tool name' } };
      }

      const toolExists = TOOLS.some(t => t.name === toolName);
      if (!toolExists) {
        return { jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown tool: ${toolName}` } };
      }

      try {
        const result = await executeTool(toolName, toolArgs);
        return { jsonrpc: '2.0', id, result };
      } catch (err) {
        const errObj = err as { code?: number | string; message?: string };

        // Structured error codes
        if (errObj.code === 'RATE_LIMITED') {
          return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify({ error: 'RATE_LIMITED', message: errObj.message }) }], isError: true } };
        }
        if (errObj.code === 'SESSION_EXPIRED') {
          return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify({ error: 'SESSION_EXPIRED', message: errObj.message }) }], isError: true } };
        }
        if (errObj.code === 'SERVICE_DOWN') {
          return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify({ error: 'SERVICE_DOWN', message: errObj.message }) }], isError: true } };
        }

        if (typeof errObj.code === 'number') {
          return { jsonrpc: '2.0', id, error: { code: errObj.code, message: errObj.message || 'Tool error' } };
        }

        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
            isError: true,
          },
        };
      }
    }

    default:
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Method not found: ${request.method}` },
      };
  }
}

// ═══════════════════════════════════════════════════════════════
// stdio transport
// ═══════════════════════════════════════════════════════════════

export function startMCPServer(): void {
  const rl = readline.createInterface({ input: process.stdin, terminal: false });

  rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let request: JsonRpcRequest;
    try {
      request = JSON.parse(trimmed);
    } catch {
      const resp: JsonRpcResponse = {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error' },
      };
      process.stdout.write(JSON.stringify(resp) + '\n');
      return;
    }

    const response = await handleRequest(request);
    if (response) {
      process.stdout.write(JSON.stringify(response) + '\n');
    }
  });

  rl.on('close', () => {
    process.exit(0);
  });

  process.stderr.write(`[MCP] ${SERVER_NAME} v${SERVER_VERSION} started on stdio\n`);
}

// Auto-start if run directly
if (process.argv[1]?.includes('mcp-server')) {
  startMCPServer();
}
