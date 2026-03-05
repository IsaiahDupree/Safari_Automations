/**
 * Twitter Comments MCP Server — JSON-RPC 2.0 over stdio
 *
 * Implements the Model Context Protocol (MCP) for tool-calling integration.
 * Reads JSON-RPC messages from stdin, writes responses to stdout.
 * Delegates to the Twitter Comments REST API on port 3007.
 */

import * as readline from 'readline';

const TWITTER_BASE = 'http://localhost:3007';
const TWITTER_AUTH = process.env.TWITTER_AUTH_TOKEN || process.env.API_TOKEN || 'test-token-12345';
const TIMEOUT_MS = 30_000;

// ═══════════════════════════════════════════════════════════════
// Structured error codes
// ═══════════════════════════════════════════════════════════════

const ERROR_CODES = {
  RATE_LIMITED: { code: 4290, message: 'Rate limited by Twitter/X — wait before retrying' },
  SESSION_EXPIRED: { code: 4010, message: 'Twitter/X session expired — re-login in Safari' },
  SERVICE_DOWN: { code: 5030, message: 'Twitter Comments service is not reachable' },
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
// HTTP helper — calls the REST API on port 3007
// ═══════════════════════════════════════════════════════════════

async function api(method: 'GET' | 'POST' | 'PUT', path: string, body?: Record<string, unknown>): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${TWITTER_AUTH}`,
    };
    const res = await fetch(`${TWITTER_BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (!res.ok) {
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
const SERVER_NAME = 'twitter-comments-safari-automation';
const SERVER_VERSION = '1.0.0';

// ═══════════════════════════════════════════════════════════════
// Tool definitions
// ═══════════════════════════════════════════════════════════════

const TOOLS = [
  {
    name: 'twitter_comments_is_ready',
    description: 'Check if Twitter Comments service (:3007) is reachable. Returns {ready, port, timestamp}.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'twitter_comments_post_reply',
    description: 'Reply to a tweet by URL. Supports dryRun mode to preview without posting.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Tweet URL to reply to' },
        text: { type: 'string', description: 'Reply text (max 280 chars)' },
        dryRun: { type: 'boolean', description: 'If true, simulate without posting', default: false },
      },
      required: ['url', 'text'],
    },
  },
  {
    name: 'twitter_comments_search',
    description: 'Search Twitter/X for tweets matching a query.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        tab: { type: 'string', description: 'Search tab: top, latest, people, media', default: 'top' },
        maxResults: { type: 'number', description: 'Max results to return', default: 20 },
      },
      required: ['query'],
    },
  },
  {
    name: 'twitter_comments_timeline',
    description: 'Get recent tweets from a Twitter/X user timeline.',
    inputSchema: {
      type: 'object',
      properties: {
        username: { type: 'string', description: 'Twitter handle (without @)' },
        maxResults: { type: 'number', description: 'Max tweets to return', default: 20 },
      },
      required: ['username'],
    },
  },
  {
    name: 'twitter_comments_compose',
    description: 'Compose and post a new tweet. Supports dryRun mode.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Tweet text (max 280 chars)' },
        dryRun: { type: 'boolean', description: 'If true, simulate without posting', default: false },
      },
      required: ['text'],
    },
  },
  {
    name: 'twitter_comments_like',
    description: 'Like a tweet by URL. Supports dryRun mode.',
    inputSchema: {
      type: 'object',
      properties: {
        tweetUrl: { type: 'string', description: 'Tweet URL to like' },
        dryRun: { type: 'boolean', description: 'If true, simulate without liking', default: false },
      },
      required: ['tweetUrl'],
    },
  },
  {
    name: 'twitter_comments_retweet',
    description: 'Retweet a tweet by URL. Supports dryRun mode.',
    inputSchema: {
      type: 'object',
      properties: {
        tweetUrl: { type: 'string', description: 'Tweet URL to retweet' },
        dryRun: { type: 'boolean', description: 'If true, simulate without retweeting', default: false },
      },
      required: ['tweetUrl'],
    },
  },
  {
    name: 'twitter_comments_bookmark',
    description: 'Bookmark a tweet by URL.',
    inputSchema: {
      type: 'object',
      properties: {
        tweetUrl: { type: 'string', description: 'Tweet URL to bookmark' },
      },
      required: ['tweetUrl'],
    },
  },
  {
    name: 'twitter_comments_get_metrics',
    description: 'Get engagement metrics (likes, retweets, replies, views) for a tweet.',
    inputSchema: {
      type: 'object',
      properties: {
        tweetUrl: { type: 'string', description: 'Tweet URL to get metrics for' },
      },
      required: ['tweetUrl'],
    },
  },
];

// ═══════════════════════════════════════════════════════════════
// Tool execution
// ═══════════════════════════════════════════════════════════════

async function executeTool(name: string, args: Record<string, unknown>): Promise<{ content: Array<{ type: string; text: string }> }> {
  switch (name) {
    case 'twitter_comments_is_ready': {
      try {
        const r = await fetch(`${TWITTER_BASE}/health`, { signal: AbortSignal.timeout(5000) });
        const data = await r.json() as Record<string, unknown>;
        return { content: [{ type: 'text', text: JSON.stringify({ ready: r.ok, port: 3007, timestamp: new Date().toISOString(), status: data.status }) }] };
      } catch {
        return { content: [{ type: 'text', text: JSON.stringify({ ready: false, port: 3007, timestamp: new Date().toISOString(), error: ERROR_CODES.SERVICE_DOWN.message }) }] };
      }
    }

    case 'twitter_comments_post_reply': {
      const url = args.url as string;
      const text = args.text as string;
      const dryRun = args.dryRun as boolean | undefined;
      if (dryRun) {
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, dryRun: true, url, text, charCount: text.length, message: 'Dry-run: reply not actually posted' }) }] };
      }
      const result = await api('POST', '/api/twitter/tweet/reply', { url, text });
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }

    case 'twitter_comments_search': {
      const query = args.query as string;
      const tab = (args.tab as string) || 'top';
      const maxResults = (args.maxResults as number) || 20;
      const result = await api('POST', '/api/twitter/search', { query, tab, maxResults });
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }

    case 'twitter_comments_timeline': {
      const handle = args.username as string;
      const maxResults = (args.maxResults as number) || 20;
      const result = await api('POST', '/api/twitter/timeline', { handle, maxResults });
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }

    case 'twitter_comments_compose': {
      const text = args.text as string;
      const dryRun = args.dryRun as boolean | undefined;
      if (dryRun) {
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, dryRun: true, text, charCount: text.length, message: 'Dry-run: tweet not actually posted' }) }] };
      }
      const result = await api('POST', '/api/twitter/tweet', { text });
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }

    case 'twitter_comments_like': {
      const tweetUrl = args.tweetUrl as string;
      const dryRun = args.dryRun as boolean | undefined;
      if (dryRun) {
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, dryRun: true, tweetUrl, message: 'Dry-run: tweet not actually liked' }) }] };
      }
      const result = await api('POST', '/api/twitter/tweet/like', { tweetUrl });
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }

    case 'twitter_comments_retweet': {
      const tweetUrl = args.tweetUrl as string;
      const dryRun = args.dryRun as boolean | undefined;
      if (dryRun) {
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, dryRun: true, tweetUrl, message: 'Dry-run: tweet not actually retweeted' }) }] };
      }
      const result = await api('POST', '/api/twitter/tweet/retweet', { tweetUrl });
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }

    case 'twitter_comments_bookmark': {
      const tweetUrl = args.tweetUrl as string;
      const result = await api('POST', '/api/twitter/tweet/bookmark', { tweetUrl });
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }

    case 'twitter_comments_get_metrics': {
      const tweetUrl = args.tweetUrl as string;
      const result = await api('GET', `/api/twitter/tweet/metrics?tweetUrl=${encodeURIComponent(tweetUrl)}`);
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
