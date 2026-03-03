/**
 * TikTok MCP Server — JSON-RPC 2.0 over stdio
 * DM service:       http://localhost:3102
 * Comments service: http://localhost:3006
 * Start: npx tsx packages/tiktok-dm/src/api/mcp-server.ts
 */

import * as readline from 'readline';

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_NAME = 'tiktok-safari-automation';
const SERVER_VERSION = '1.0.0';
const DM_BASE = 'http://localhost:3102';
const COMMENTS_BASE = 'http://localhost:3006';
const TIMEOUT_MS = 30_000;

async function api(base: string, method: 'GET' | 'POST', path: string, body?: Record<string, unknown>): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: ctrl.signal });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    return JSON.parse(text);
  } finally { clearTimeout(t); }
}

const TOOLS = [
  { name: 'tiktok_send_dm', description: 'Send a DM to a TikTok user. Uses inbox search → profile fallback → compose-new fallback.', inputSchema: { type: 'object', properties: { username: { type: 'string', description: 'Target username without @' }, text: { type: 'string', description: 'Message text' }, force: { type: 'boolean', description: 'Force send, bypassing active-hours check (default false)', default: false } }, required: ['username', 'text'] } },
  { name: 'tiktok_get_conversations', description: 'List DM conversations from the TikTok inbox.', inputSchema: { type: 'object', properties: {} } },
  { name: 'tiktok_get_unread', description: 'List unread TikTok DM conversations.', inputSchema: { type: 'object', properties: {} } },
  { name: 'tiktok_get_messages', description: 'Read messages from the currently open TikTok conversation.', inputSchema: { type: 'object', properties: { limit: { type: 'number', description: 'Max messages (default 20)', default: 20 } } } },
  { name: 'tiktok_ai_generate_dm', description: 'Generate an AI-powered DM using OpenAI GPT-4o-mini. Requires OPENAI_API_KEY env var.', inputSchema: { type: 'object', properties: { username: { type: 'string', description: 'Target username' }, purpose: { type: 'string', description: 'Purpose of DM (e.g., "networking", "collab")' }, topic: { type: 'string', description: 'Optional topic to mention' } }, required: ['username'] } },
  { name: 'tiktok_get_profile', description: 'Get TikTok user profile information (displayName, bio, followers, following, likes).', inputSchema: { type: 'object', properties: { username: { type: 'string', description: 'TikTok username without @' } }, required: ['username'] } },
  { name: 'tiktok_get_trending', description: 'Get trending TikTok videos from For You page.', inputSchema: { type: 'object', properties: { limit: { type: 'number', description: 'Max videos to return (default 20)', default: 20 } } } },
  { name: 'tiktok_post_comment', description: 'Post a comment on a TikTok video. REQUIRES a direct video URL (tiktok.com/@username/video/ID).', inputSchema: { type: 'object', properties: { postUrl: { type: 'string', description: 'Full TikTok video URL (e.g. https://www.tiktok.com/@user/video/1234567890)' }, text: { type: 'string', description: 'Comment text' } }, required: ['postUrl', 'text'] } },
  { name: 'tiktok_get_comments', description: 'Get comments from a TikTok video. Navigate to the video first or pass postUrl.', inputSchema: { type: 'object', properties: { postUrl: { type: 'string', description: 'TikTok video URL to navigate to first' }, limit: { type: 'number', description: 'Max comments (default 50)', default: 50 } } } },
  { name: 'tiktok_search', description: 'Search TikTok for videos by keyword. Returns author, text, likes, views, comments, URL.', inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Search query' }, maxResults: { type: 'number', description: 'Max results (default 20)', default: 20 } }, required: ['query'] } },
  { name: 'tiktok_video_metrics', description: 'Get engagement metrics (likes, views, comments, shares) from a TikTok video URL.', inputSchema: { type: 'object', properties: { videoUrl: { type: 'string', description: 'Full TikTok video URL' } }, required: ['videoUrl'] } },
  { name: 'tiktok_session_ensure', description: 'Ensure Safari is on the correct TikTok tab and lock it as the active session.', inputSchema: { type: 'object', properties: {} } },
  { name: 'tiktok_session_status', description: 'Get the current TikTok Safari session status.', inputSchema: { type: 'object', properties: {} } },
  { name: 'tiktok_session_clear', description: 'Clear the tracked TikTok Safari session.', inputSchema: { type: 'object', properties: {} } },
  { name: 'tiktok_get_status', description: 'Get TikTok service health and current page URL.', inputSchema: { type: 'object', properties: {} } },
  { name: 'tiktok_navigate_inbox', description: 'Navigate Safari to the TikTok DM inbox.', inputSchema: { type: 'object', properties: {} } },
];

async function executeTool(name: string, args: Record<string, unknown>): Promise<{ content: Array<{ type: string; text: string }> }> {
  let result: unknown;
  switch (name) {
    case 'tiktok_send_dm':          result = await api(DM_BASE, 'POST', '/api/tiktok/messages/send-to', { username: args.username, text: args.text, force: args.force }); break;
    case 'tiktok_get_conversations': result = await api(DM_BASE, 'GET',  '/api/tiktok/conversations'); break;
    case 'tiktok_get_unread':       result = await api(DM_BASE, 'GET',  '/api/tiktok/conversations/unread'); break;
    case 'tiktok_get_messages':     result = await api(DM_BASE, 'GET',  `/api/tiktok/messages?limit=${args.limit ?? 20}`); break;
    case 'tiktok_ai_generate_dm':   result = await api(DM_BASE, 'POST', '/api/tiktok/ai/generate', { username: args.username, purpose: args.purpose, topic: args.topic }); break;
    case 'tiktok_get_profile':      result = await api(DM_BASE, 'GET',  `/api/tiktok/profile/${args.username}`); break;
    case 'tiktok_get_trending':     result = await api(COMMENTS_BASE, 'GET', `/api/tiktok/trending?limit=${args.limit ?? 20}`); break;
    case 'tiktok_post_comment':     result = await api(COMMENTS_BASE, 'POST', '/api/tiktok/comments/post', { postUrl: args.postUrl, text: args.text }); break;
    case 'tiktok_get_comments': {
      if (args.postUrl) await api(COMMENTS_BASE, 'POST', '/api/tiktok/navigate', { url: args.postUrl }).catch(() => {});
      result = await api(COMMENTS_BASE, 'GET', `/api/tiktok/comments${args.limit ? `?limit=${args.limit}` : ''}`);
      break;
    }
    case 'tiktok_search':           result = await api(COMMENTS_BASE, 'POST', '/api/tiktok/search-cards', { query: args.query, maxResults: args.maxResults ?? 20 }); break;
    case 'tiktok_video_metrics': {
      await api(COMMENTS_BASE, 'POST', '/api/tiktok/navigate', { url: args.videoUrl }).catch(() => {});
      result = await api(COMMENTS_BASE, 'GET', '/api/tiktok/video-metrics');
      break;
    }
    case 'tiktok_session_ensure':   result = await api(DM_BASE, 'POST', '/api/session/ensure'); break;
    case 'tiktok_session_status':   result = await api(DM_BASE, 'GET',  '/api/session/status'); break;
    case 'tiktok_session_clear':    result = await api(DM_BASE, 'POST', '/api/session/clear'); break;
    case 'tiktok_get_status':       result = await api(DM_BASE, 'GET',  '/health'); break;
    case 'tiktok_navigate_inbox':   result = await api(DM_BASE, 'POST', '/api/tiktok/inbox/navigate'); break;
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
        if (e.code) return { jsonrpc: '2.0', id, error: { code: e.code, message: e.message || 'Tool error' } };
        return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true } };
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