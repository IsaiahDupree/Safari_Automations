/**
 * Market Research MCP Server — JSON-RPC 2.0 over stdio
 *
 * New MCP server with market_research_ prefixed tools.
 * Delegates to the Market Research REST API on port 3106.
 *
 * Start: npx tsx packages/market-research/src/api/mcp-server.ts
 */

import * as readline from 'readline';

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_NAME = 'market-research-mcp';
const SERVER_VERSION = '2.0.0';
const BASE_URL = process.env.MARKET_RESEARCH_URL || 'http://localhost:3106';
const TIMEOUT_MS = 60_000; // MRM-009: 60s timeout on all long-running research calls

// ─── Error Handling (MRM-010) ─────────────────────────────────────

type ErrorCode = 'SERVICE_DOWN' | 'RATE_LIMITED' | 'TIMEOUT' | 'API_ERROR' | 'NOT_FOUND' | 'SESSION_EXPIRED';

interface StructuredError {
  code: ErrorCode;
  message: string;
  platform?: string;
  retryAfter?: number;
  base?: string;
}

function formatMcpError(e: unknown): string {
  if (typeof e === 'object' && e !== null && 'code' in e) {
    return JSON.stringify(e);
  }
  const msg = e instanceof Error ? e.message : String(e);
  const lower = msg.toLowerCase();

  if (lower.includes('econnrefused') || lower.includes('not running')) {
    return JSON.stringify({ code: 'SERVICE_DOWN', message: `Market Research API (${BASE_URL}) is not running`, base: BASE_URL } satisfies StructuredError);
  }
  if (lower.includes('abort') || lower.includes('timeout')) {
    return JSON.stringify({ code: 'TIMEOUT', message: `Request timed out after ${TIMEOUT_MS / 1000}s`, base: BASE_URL } satisfies StructuredError);
  }
  if (lower.includes('429') || lower.includes('rate limit')) {
    return JSON.stringify({ code: 'RATE_LIMITED', retryAfter: 60, message: 'Rate limit hit — wait before retrying' } satisfies StructuredError);
  }
  return JSON.stringify({ code: 'API_ERROR', message: msg } satisfies StructuredError);
}

// ─── HTTP Client ──────────────────────────────────────────────────

async function api(method: 'GET' | 'POST', path: string, body?: Record<string, unknown>): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (res.status === 429) {
      throw { code: 'RATE_LIMITED', message: 'Rate limit hit — wait before retrying', retryAfter: 60 } satisfies StructuredError;
    }
    if (res.status === 404) {
      throw { code: 'NOT_FOUND', message: text.slice(0, 200) } satisfies StructuredError;
    }
    if (!res.ok) {
      throw { code: 'API_ERROR', message: `HTTP ${res.status}: ${text.slice(0, 200)}` } satisfies StructuredError;
    }
    try { return JSON.parse(text); } catch { return { raw: text }; }
  } catch (err) {
    const e = err as { name?: string; code?: string; cause?: { code?: string } };
    if (e.name === 'AbortError') {
      throw { code: 'TIMEOUT', message: `${BASE_URL} did not respond within ${TIMEOUT_MS / 1000}s`, base: BASE_URL } satisfies StructuredError;
    }
    if (e.code === 'ECONNREFUSED' || e.cause?.code === 'ECONNREFUSED') {
      throw { code: 'SERVICE_DOWN', message: `${BASE_URL} is not running`, base: BASE_URL } satisfies StructuredError;
    }
    throw err;
  } finally {
    clearTimeout(t);
  }
}

// ─── Supabase Client (for ingest/stored) ──────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ivhfuhxorppptyuofbgq.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';

async function supabaseRequest(method: 'GET' | 'POST', table: string, params?: { body?: Record<string, unknown>; query?: string }): Promise<unknown> {
  const url = `${SUPABASE_URL}/rest/v1/${table}${params?.query ? `?${params.query}` : ''}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Prefer': method === 'POST' ? 'return=representation' : '',
  };
  const res = await fetch(url, {
    method,
    headers,
    body: params?.body ? JSON.stringify(params.body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  if (!res.ok) throw { code: 'API_ERROR', message: `Supabase ${res.status}: ${text.slice(0, 200)}` };
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

// ─── Tools ────────────────────────────────────────────────────────

interface Tool {
  name: string;
  description: string;
  inputSchema: { type: 'object'; properties: Record<string, any>; required?: string[] };
}

const PLATFORMS = ['twitter', 'threads', 'instagram', 'facebook', 'tiktok'] as const;

const TOOLS: Tool[] = [
  // MRM-002: is_ready
  {
    name: 'market_research_is_ready',
    description: 'Check if Market Research API (:3106) is reachable. Call this first each session. Returns {ready, port, timestamp}.',
    inputSchema: { type: 'object', properties: {} },
  },
  // MRM-003: Ported from src/mcp/server.ts (6 tools)
  {
    name: 'market_research_search_posts',
    description: 'Search for posts on a social media platform by keyword. Delegates to the Market Research API.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string', enum: [...PLATFORMS], description: 'Platform to search' },
        query: { type: 'string', description: 'Search keyword or phrase' },
      },
      required: ['platform', 'query'],
    },
  },
  {
    name: 'market_research_get_trends',
    description: 'Get cross-platform trending topics and niches.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'market_research_get_top_creators',
    description: 'Get top creators for a specific niche.',
    inputSchema: {
      type: 'object',
      properties: {
        niche: { type: 'string', description: 'Niche to search for top creators' },
        platform: { type: 'string', enum: [...PLATFORMS], description: 'Platform to search' },
        limit: { type: 'number', description: 'Max number of creators to return' },
      },
      required: ['niche'],
    },
  },
  {
    name: 'market_research_get_hashtags',
    description: 'Get trending hashtags for a platform.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string', enum: [...PLATFORMS], description: 'Platform' },
      },
      required: ['platform'],
    },
  },
  {
    name: 'market_research_score_content',
    description: 'Score content quality for a niche (0-100).',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'Content to score' },
        niche: { type: 'string', description: 'Target niche' },
        platform: { type: 'string', description: 'Target platform' },
      },
      required: ['content'],
    },
  },
  {
    name: 'market_research_get_creator_stats',
    description: 'Get engagement statistics for a creator handle.',
    inputSchema: {
      type: 'object',
      properties: {
        handle: { type: 'string', description: 'Creator handle (without @)' },
      },
      required: ['handle'],
    },
  },
  // MRM-004: niche_pipeline
  {
    name: 'market_research_niche_pipeline',
    description: 'Full single-niche collection across all platforms. Runs the niche research pipeline for one niche on a specific platform.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string', enum: [...PLATFORMS], description: 'Platform to research' },
        niche: { type: 'string', description: 'Niche keyword to research' },
        maxResults: { type: 'number', description: 'Max results per search', default: 50 },
      },
      required: ['platform', 'niche'],
    },
  },
  // MRM-005: full_multi_niche
  {
    name: 'market_research_full_multi_niche',
    description: 'Runs niche_pipeline for an array of niches on a given platform. Returns aggregated results.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string', enum: [...PLATFORMS], description: 'Platform to research' },
        niches: { type: 'array', items: { type: 'string' }, description: 'Array of niche keywords to research' },
        maxResults: { type: 'number', description: 'Max results per niche', default: 50 },
      },
      required: ['platform', 'niches'],
    },
  },
  // MRM-006: all_platforms
  {
    name: 'market_research_all_platforms',
    description: 'Cross-platform search for a single keyword across all supported platforms.',
    inputSchema: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: 'Keyword to search across all platforms' },
        maxResults: { type: 'number', description: 'Max results per platform', default: 20 },
      },
      required: ['keyword'],
    },
  },
  // MRM-007: ingest
  {
    name: 'market_research_ingest',
    description: 'Store a raw research result into Supabase market_research_results table.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string', description: 'Source platform' },
        niche: { type: 'string', description: 'Niche/keyword researched' },
        data: { type: 'object', description: 'Raw research result data to store' },
        source_tool: { type: 'string', description: 'Which tool produced this data' },
      },
      required: ['platform', 'niche', 'data'],
    },
  },
  // MRM-008: get_stored
  {
    name: 'market_research_get_stored',
    description: 'Query stored research results from Supabase by niche, platform, and/or date range.',
    inputSchema: {
      type: 'object',
      properties: {
        niche: { type: 'string', description: 'Filter by niche keyword' },
        platform: { type: 'string', description: 'Filter by platform' },
        since: { type: 'string', description: 'ISO date string — only results after this date' },
        limit: { type: 'number', description: 'Max results to return', default: 20 },
      },
    },
  },
];

// ─── Tool Execution ───────────────────────────────────────────────

async function executeTool(name: string, args: Record<string, unknown>): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  let result: unknown;

  switch (name) {
    // MRM-002
    case 'market_research_is_ready': {
      try {
        const r = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(5000) });
        if (r.ok) {
          const data = await r.json();
          result = { ready: true, port: data.port || 3106, timestamp: new Date().toISOString(), ...data };
        } else {
          result = { ready: false, port: 3106, timestamp: new Date().toISOString(), error: `HTTP ${r.status}` };
        }
      } catch {
        result = { ready: false, port: 3106, timestamp: new Date().toISOString(), error: `${BASE_URL} is not reachable` };
      }
      break;
    }

    // MRM-003: Ported tools
    case 'market_research_search_posts':
      result = await api('POST', `/api/research/${args.platform}/search`, { query: args.query });
      break;
    case 'market_research_get_trends':
      result = await api('GET', '/api/research/trends');
      break;
    case 'market_research_get_top_creators':
      result = await api('POST', '/api/research/top-creators', { niche: args.niche, platform: args.platform, limit: args.limit });
      break;
    case 'market_research_get_hashtags':
      result = await api('GET', `/api/research/hashtags/${args.platform}`);
      break;
    case 'market_research_score_content':
      result = await api('POST', '/api/ai/score', { content: args.content, niche: args.niche, platform: args.platform });
      break;
    case 'market_research_get_creator_stats':
      result = await api('GET', `/api/research/creator/${args.handle}`);
      break;

    // MRM-004: niche_pipeline
    case 'market_research_niche_pipeline':
      result = await api('POST', `/api/research/${args.platform}/niche`, {
        niche: args.niche,
        maxResults: args.maxResults,
      });
      break;

    // MRM-005: full_multi_niche
    case 'market_research_full_multi_niche':
      result = await api('POST', `/api/research/${args.platform}/full`, {
        niches: args.niches,
        maxResults: args.maxResults,
      });
      break;

    // MRM-006: all_platforms
    case 'market_research_all_platforms': {
      const keyword = args.keyword as string;
      const maxResults = (args.maxResults as number) || 20;
      const results: Record<string, unknown> = {};
      const errors: Record<string, string> = {};

      await Promise.allSettled(
        PLATFORMS.map(async (platform) => {
          try {
            results[platform] = await api('POST', `/api/research/${platform}/search`, { query: keyword, maxResults });
          } catch (e) {
            errors[platform] = e instanceof Error ? e.message : String(e);
          }
        })
      );
      result = { keyword, results, errors: Object.keys(errors).length > 0 ? errors : undefined };
      break;
    }

    // MRM-007: ingest
    case 'market_research_ingest': {
      if (!SUPABASE_KEY) {
        result = { error: 'SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY not set — cannot ingest' };
        break;
      }
      const row = {
        platform: args.platform,
        niche: args.niche,
        data: args.data,
        source_tool: args.source_tool || 'market_research_ingest',
        created_at: new Date().toISOString(),
      };
      result = await supabaseRequest('POST', 'market_research_results', { body: row });
      break;
    }

    // MRM-008: get_stored
    case 'market_research_get_stored': {
      if (!SUPABASE_KEY) {
        result = { error: 'SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY not set — cannot query' };
        break;
      }
      const filters: string[] = ['select=*', `order=created_at.desc`, `limit=${(args.limit as number) || 20}`];
      if (args.niche) filters.push(`niche=eq.${encodeURIComponent(args.niche as string)}`);
      if (args.platform) filters.push(`platform=eq.${encodeURIComponent(args.platform as string)}`);
      if (args.since) filters.push(`created_at=gte.${encodeURIComponent(args.since as string)}`);
      result = await supabaseRequest('GET', 'market_research_results', { query: filters.join('&') });
      break;
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
  };
}

// ─── JSON-RPC 2.0 Protocol Handler ───────────────────────────────

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number | string;
  method: string;
  params?: Record<string, any>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: any;
  error?: { code: number; message: string; data?: any };
}

async function handleMessage(msg: JsonRpcRequest): Promise<JsonRpcResponse | null> {
  const id = msg.id ?? null;

  // Notifications don't get responses
  if (msg.id === undefined && msg.method === 'notifications/initialized') {
    return null;
  }

  switch (msg.method) {
    case 'initialize':
      return {
        jsonrpc: '2.0',
        id: id!,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        },
      };

    case 'tools/list':
      return {
        jsonrpc: '2.0',
        id: id!,
        result: { tools: TOOLS },
      };

    case 'tools/call': {
      const toolName = msg.params?.name;
      const toolArgs = msg.params?.arguments || {};

      if (!TOOLS.find(t => t.name === toolName)) {
        return {
          jsonrpc: '2.0',
          id: id!,
          error: { code: -32601, message: `Unknown tool: ${toolName}` },
        };
      }

      try {
        const result = await executeTool(toolName, toolArgs);
        return {
          jsonrpc: '2.0',
          id: id!,
          result: { ...result, isError: false },
        };
      } catch (e) {
        return {
          jsonrpc: '2.0',
          id: id!,
          result: {
            content: [{ type: 'text', text: formatMcpError(e) }],
            isError: true,
          },
        };
      }
    }

    case 'ping':
      return { jsonrpc: '2.0', id: id!, result: {} };

    default:
      if (id !== null) {
        return {
          jsonrpc: '2.0',
          id: id!,
          error: { code: -32601, message: `Method not found: ${msg.method}` },
        };
      }
      return null;
  }
}

// ─── Stdio Transport (MRM-011) ────────────────────────────────────

const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on('line', async (line: string) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  try {
    const msg: JsonRpcRequest = JSON.parse(trimmed);
    const response = await handleMessage(msg);
    if (response) {
      process.stdout.write(JSON.stringify(response) + '\n');
    }
  } catch (e) {
    const errResp: JsonRpcResponse = {
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: `Parse error: ${e}` },
    };
    process.stdout.write(JSON.stringify(errResp) + '\n');
  }
});

rl.on('close', () => {
  process.exit(0);
});
