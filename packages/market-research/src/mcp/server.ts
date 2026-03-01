/**
 * Market Research MCP Server (stdio transport)
 *
 * Implements the Model Context Protocol for tool calling over stdio.
 * Provides research tools that delegate to the Market Research API.
 *
 * Usage:
 *   echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test"}}}' | npx tsx packages/market-research/src/mcp/server.ts
 */

import * as readline from 'readline';

// ─── Types ───────────────────────────────────────────────────────

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

interface Tool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

// ─── Tools ───────────────────────────────────────────────────────

const TOOLS: Tool[] = [
  {
    name: 'search_posts',
    description: 'Search for posts on a social media platform by keyword',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string', enum: ['twitter', 'threads', 'instagram', 'facebook', 'tiktok'], description: 'Platform to search' },
        query: { type: 'string', description: 'Search keyword or phrase' },
      },
      required: ['platform', 'query'],
    },
  },
  {
    name: 'get_trends',
    description: 'Get cross-platform trending topics and niches',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_top_creators',
    description: 'Get top creators for a specific niche',
    inputSchema: {
      type: 'object',
      properties: {
        niche: { type: 'string', description: 'Niche to search for top creators' },
        platform: { type: 'string', description: 'Platform to search', enum: ['twitter', 'threads', 'instagram', 'facebook', 'tiktok'] },
        limit: { type: 'number', description: 'Max number of creators to return' },
      },
      required: ['niche'],
    },
  },
  {
    name: 'get_hashtags',
    description: 'Get trending hashtags for a platform',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string', enum: ['twitter', 'threads', 'instagram', 'facebook', 'tiktok'], description: 'Platform' },
      },
      required: ['platform'],
    },
  },
  {
    name: 'score_content',
    description: 'Score content quality for a niche (0-100)',
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
    name: 'get_creator_stats',
    description: 'Get engagement statistics for a creator handle',
    inputSchema: {
      type: 'object',
      properties: {
        handle: { type: 'string', description: 'Creator handle (without @)' },
      },
      required: ['handle'],
    },
  },
];

// ─── Tool Handlers ───────────────────────────────────────────────

const BASE_URL = process.env.MARKET_RESEARCH_URL || 'http://localhost:3106';
const API_KEY = process.env.RESEARCH_API_KEY || '';

async function apiRequest(method: string, path: string, body?: any): Promise<any> {
  const url = `${BASE_URL}${path}`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (API_KEY) headers['Authorization'] = `Bearer ${API_KEY}`;

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    return await res.json();
  } catch (e) {
    return { error: String(e) };
  }
}

async function handleToolCall(name: string, args: Record<string, any>): Promise<any> {
  switch (name) {
    case 'search_posts':
      return apiRequest('POST', `/api/research/${args.platform}/search`, { query: args.query });
    case 'get_trends':
      return apiRequest('GET', '/api/research/trends');
    case 'get_top_creators':
      return apiRequest('POST', '/api/research/top-creators', { niche: args.niche, platform: args.platform, limit: args.limit });
    case 'get_hashtags':
      return apiRequest('GET', `/api/research/hashtags/${args.platform}`);
    case 'score_content':
      return apiRequest('POST', '/api/ai/score', { content: args.content, niche: args.niche, platform: args.platform });
    case 'get_creator_stats':
      return apiRequest('GET', `/api/research/creator/${args.handle}`);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ─── MCP Protocol Handler ────────────────────────────────────────

let initialized = false;

async function handleMessage(msg: JsonRpcRequest): Promise<JsonRpcResponse | null> {
  const id = msg.id ?? null;

  // Notifications (no id) don't get responses
  if (msg.id === undefined && msg.method === 'notifications/initialized') {
    initialized = true;
    return null;
  }

  switch (msg.method) {
    case 'initialize':
      return {
        jsonrpc: '2.0',
        id: id!,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: { listChanged: false },
          },
          serverInfo: {
            name: 'market-research-mcp',
            version: '1.4.0',
          },
        },
      };

    case 'tools/list':
      return {
        jsonrpc: '2.0',
        id: id!,
        result: {
          tools: TOOLS,
        },
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
        const result = await handleToolCall(toolName, toolArgs);
        return {
          jsonrpc: '2.0',
          id: id!,
          result: {
            content: [
              { type: 'text', text: JSON.stringify(result, null, 2) },
            ],
            isError: false,
          },
        };
      } catch (e) {
        return {
          jsonrpc: '2.0',
          id: id!,
          result: {
            content: [
              { type: 'text', text: `Error: ${e}` },
            ],
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

// ─── Stdio Transport ─────────────────────────────────────────────

const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on('line', async (line: string) => {
  const trimmed = line.trim();
  if (!trimmed) return; // ignore empty lines

  try {
    const msg: JsonRpcRequest = JSON.parse(trimmed);
    const response = await handleMessage(msg);
    if (response) {
      const json = JSON.stringify(response);
      process.stdout.write(json + '\n');
    }
  } catch (e) {
    // Parse error
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

// Handle timeout for tool calls
const TOOL_TIMEOUT_MS = 30000;
