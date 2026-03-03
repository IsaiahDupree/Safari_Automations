/**
 * Instagram MCP Server — JSON-RPC 2.0 over stdio
 * DM service: http://localhost:3100
 * Comments service: http://localhost:3005
 * Start: npx tsx packages/instagram-dm/src/api/mcp-server.ts
 */

import * as readline from 'readline';

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_NAME = 'instagram-safari-automation';
const SERVER_VERSION = '1.0.0';
const DM_BASE = 'http://localhost:3100';
const COMMENTS_BASE = 'http://localhost:3005';
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
  { name: 'instagram_send_dm', description: 'Send a DM to an Instagram user. Navigates profile → opens DM → types → sends.', inputSchema: { type: 'object', properties: { username: { type: 'string', description: 'Target username without @' }, text: { type: 'string', description: 'Message text' } }, required: ['username', 'text'] } },
  { name: 'instagram_get_conversations', description: 'List recent DM conversations from the Instagram inbox.', inputSchema: { type: 'object', properties: { limit: { type: 'number', description: 'Max conversations to return (default 20)', default: 20 } } } },
  { name: 'instagram_get_unread', description: 'Get unread DM conversations by detecting unread badges/indicators.', inputSchema: { type: 'object', properties: {} } },
  { name: 'instagram_get_messages', description: 'Read messages from the currently open Instagram conversation.', inputSchema: { type: 'object', properties: { limit: { type: 'number', description: 'Max messages (default 20)', default: 20 } } } },
  { name: 'instagram_open_conversation', description: 'Open a DM conversation with a specific user in the Instagram inbox.', inputSchema: { type: 'object', properties: { username: { type: 'string', description: 'Username to open conversation with' } }, required: ['username'] } },
  { name: 'instagram_accept_request', description: 'Accept a message request from a user. Navigates to requests tab and clicks Accept.', inputSchema: { type: 'object', properties: { username: { type: 'string', description: 'Username to accept request from' } }, required: ['username'] } },
  { name: 'instagram_decline_request', description: 'Decline a message request from a user. Navigates to requests tab and clicks Decline.', inputSchema: { type: 'object', properties: { username: { type: 'string', description: 'Username to decline request from' } }, required: ['username'] } },
  { name: 'instagram_get_profile', description: 'Get Instagram profile information (name, bio, followers, following, posts, verified status).', inputSchema: { type: 'object', properties: { username: { type: 'string', description: 'Username to fetch profile for' } }, required: ['username'] } },
  { name: 'instagram_post_comment', description: 'Post a comment on an Instagram post by URL.', inputSchema: { type: 'object', properties: { postUrl: { type: 'string', description: 'Full Instagram post URL' }, text: { type: 'string', description: 'Comment text' } }, required: ['postUrl', 'text'] } },
  { name: 'instagram_get_comments', description: 'Get comments from an Instagram post. Navigate to the post first or pass postUrl.', inputSchema: { type: 'object', properties: { postUrl: { type: 'string', description: 'Optional: post URL to navigate to first' }, limit: { type: 'number', description: 'Max comments (default 50)', default: 50 } } } },
  { name: 'instagram_session_ensure', description: 'Ensure Safari is on the correct Instagram tab and lock it as the active session.', inputSchema: { type: 'object', properties: {} } },
  { name: 'instagram_session_status', description: 'Get the current Instagram Safari session status (window/tab, URL, last verified).', inputSchema: { type: 'object', properties: {} } },
  { name: 'instagram_session_clear', description: 'Clear the tracked Instagram Safari session. Use after restarting Safari or switching tabs.', inputSchema: { type: 'object', properties: {} } },
  { name: 'instagram_get_status', description: 'Get Instagram service health and current page URL.', inputSchema: { type: 'object', properties: {} } },
  { name: 'instagram_navigate_inbox', description: 'Navigate Safari to the Instagram DM inbox.', inputSchema: { type: 'object', properties: {} } },
  { name: 'instagram_ai_generate_dm', description: 'Generate an AI-written DM for a user using GPT-4o.', inputSchema: { type: 'object', properties: { username: { type: 'string', description: 'Target username' }, purpose: { type: 'string', description: 'Purpose of outreach (e.g. "collab offer", "lead follow-up")' }, topic: { type: 'string', description: 'Optional topic to reference' } }, required: ['username', 'purpose'] } },
];

async function executeTool(name: string, args: Record<string, unknown>): Promise<{ content: Array<{ type: string; text: string }> }> {
  let result: unknown;
  switch (name) {
    case 'instagram_send_dm':        result = await api(DM_BASE, 'POST', '/api/messages/send-to', { username: args.username, text: args.text }); break;
    case 'instagram_get_conversations': result = await api(DM_BASE, 'GET', '/api/conversations'); break;
    case 'instagram_get_unread':     result = await api(DM_BASE, 'GET', '/api/conversations/unread'); break;
    case 'instagram_get_messages':   result = await api(DM_BASE, 'GET', `/api/messages?limit=${args.limit ?? 20}`); break;
    case 'instagram_open_conversation': result = await api(DM_BASE, 'POST', '/api/conversations/open', { username: args.username }); break;
    case 'instagram_accept_request': result = await api(DM_BASE, 'POST', `/api/requests/${args.username}/accept`); break;
    case 'instagram_decline_request': result = await api(DM_BASE, 'POST', `/api/requests/${args.username}/decline`); break;
    case 'instagram_get_profile':    result = await api(DM_BASE, 'GET', `/api/profile/${args.username}`); break;
    case 'instagram_post_comment':   result = await api(COMMENTS_BASE, 'POST', '/api/instagram/comments/post', { postUrl: args.postUrl, text: args.text }); break;
    case 'instagram_get_comments': {
      if (args.postUrl) await api(COMMENTS_BASE, 'POST', '/api/instagram/comments/navigate', { url: args.postUrl }).catch(() => {});
      result = await api(COMMENTS_BASE, 'GET', `/api/instagram/comments${args.limit ? `?limit=${args.limit}` : ''}`);
      break;
    }
    case 'instagram_session_ensure':  result = await api(DM_BASE, 'POST', '/api/session/ensure'); break;
    case 'instagram_session_status':  result = await api(DM_BASE, 'GET',  '/api/session/status'); break;
    case 'instagram_session_clear':   result = await api(DM_BASE, 'POST', '/api/session/clear'); break;
    case 'instagram_get_status':      result = await api(DM_BASE, 'GET',  '/health'); break;
    case 'instagram_navigate_inbox':  result = await api(DM_BASE, 'POST', '/api/inbox/navigate'); break;
    case 'instagram_ai_generate_dm':  result = await api(DM_BASE, 'POST', '/api/ai/generate', { username: args.username, purpose: args.purpose, topic: args.topic }); break;
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