/**
 * Threads MCP Server — JSON-RPC 2.0 over stdio
 *
 * Implements the Model Context Protocol (MCP) for tool-calling integration.
 * Reads JSON-RPC messages from stdin, writes responses to stdout.
 */

import { ThreadsDriver } from '../automation/threads-driver.js';
import { ThreadsAICommentGenerator } from '../automation/ai-comment-generator.js';
import * as readline from 'readline';

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_NAME = 'threads-safari-automation';
const SERVER_VERSION = '1.2.0';

// ═══════════════════════════════════════════════════════════════
// Tool definitions
// ═══════════════════════════════════════════════════════════════

const TOOLS = [
  {
    name: 'threads_navigate',
    description: 'Navigate Safari to a Threads URL',
    inputSchema: {
      type: 'object',
      properties: { url: { type: 'string', description: 'The Threads URL to navigate to' } },
      required: ['url'],
    },
  },
  {
    name: 'threads_post_comment',
    description: 'Post a comment on the current Threads post',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Comment text to post' },
        postUrl: { type: 'string', description: 'Optional post URL to navigate to first' },
      },
      required: ['text'],
    },
  },
  {
    name: 'threads_get_comments',
    description: 'Get comments from the current Threads post',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'Max comments to return', default: 50 } },
    },
  },
  {
    name: 'threads_search',
    description: 'Search Threads posts by keyword',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        max_results: { type: 'number', description: 'Max results', default: 20 },
      },
      required: ['query'],
    },
  },
  {
    name: 'threads_like',
    description: 'Like the current Threads post',
    inputSchema: {
      type: 'object',
      properties: { postUrl: { type: 'string', description: 'Optional post URL' } },
    },
  },
  {
    name: 'threads_get_status',
    description: 'Get current Threads session status',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'threads_get_profile',
    description: 'Get a Threads user profile',
    inputSchema: {
      type: 'object',
      properties: { handle: { type: 'string', description: 'Threads handle (without @)' } },
      required: ['handle'],
    },
  },
  {
    name: 'threads_ai_comment',
    description: 'Generate an AI comment for a Threads post',
    inputSchema: {
      type: 'object',
      properties: {
        postContent: { type: 'string', description: 'The post content to comment on' },
        username: { type: 'string', description: 'Post author username' },
      },
      required: ['postContent'],
    },
  },
];

// ═══════════════════════════════════════════════════════════════
// Tool execution
// ═══════════════════════════════════════════════════════════════

let driver: ThreadsDriver | null = null;
function getDriver(): ThreadsDriver {
  if (!driver) driver = new ThreadsDriver();
  return driver;
}

let aiGen: ThreadsAICommentGenerator | null = null;
function getAI(): ThreadsAICommentGenerator {
  if (!aiGen) aiGen = new ThreadsAICommentGenerator({
    provider: process.env.OPENAI_API_KEY ? 'openai' : 'local',
    apiKey: process.env.OPENAI_API_KEY,
  });
  return aiGen;
}

async function executeTool(name: string, args: Record<string, unknown>): Promise<{ content: Array<{ type: string; text: string }> }> {
  const d = getDriver();

  switch (name) {
    case 'threads_navigate': {
      const url = args.url as string;
      const success = await d.navigateToPost(url);
      return { content: [{ type: 'text', text: JSON.stringify({ success, url }) }] };
    }
    case 'threads_post_comment': {
      const text = args.text as string;
      const postUrl = args.postUrl as string | undefined;
      if (postUrl) {
        await d.navigateToPost(postUrl);
        await new Promise(r => setTimeout(r, 3000));
      }
      const result = await d.postComment(text);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
    case 'threads_get_comments': {
      const limit = (args.limit as number) || 50;
      const comments = await d.getComments(limit);
      return { content: [{ type: 'text', text: JSON.stringify({ comments, count: comments.length }) }] };
    }
    case 'threads_search': {
      const query = args.query as string;
      const maxResults = (args.max_results as number) || 20;
      const result = await d.searchPosts(query, { maxResults });
      return { content: [{ type: 'text', text: JSON.stringify({ posts: result.posts, count: result.posts.length }) }] };
    }
    case 'threads_like': {
      const postUrl = args.postUrl as string | undefined;
      const result = await d.likePost(postUrl);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
    case 'threads_get_status': {
      const status = await d.getStatus();
      return { content: [{ type: 'text', text: JSON.stringify(status) }] };
    }
    case 'threads_get_profile': {
      const handle = args.handle as string;
      const profile = await d.getCreatorProfile(handle);
      return { content: [{ type: 'text', text: JSON.stringify(profile) }] };
    }
    case 'threads_ai_comment': {
      const ai = getAI();
      const analysis = ai.analyzePost({
        mainPost: args.postContent as string,
        username: (args.username as string) || 'user',
        replies: [],
      });
      const comment = await ai.generateComment(analysis);
      return { content: [{ type: 'text', text: comment }] };
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

  // Notifications (no id) don't get responses
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
      return null; // No response needed

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
        const errObj = err as { code?: number; message?: string };
        if (errObj.code) {
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
    if (!trimmed) return; // Ignore empty lines

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
