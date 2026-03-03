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

function structuredError(status: number, body: string, platform: string): never {
  if (status === 429) throw { code: 'RATE_LIMITED', message: 'Rate limit hit — wait before retrying', retryAfter: 60, platform };
  if (status === 401 || status === 403) throw { code: 'SESSION_EXPIRED', message: 'Safari session expired or unauthorized', action: `call ${platform}_session_ensure`, platform };
  if (status === 404) throw { code: 'NOT_FOUND', message: body.slice(0, 100), platform };
  throw { code: 'API_ERROR', message: `HTTP ${status}: ${body.slice(0, 200)}`, platform };
}

function formatMcpError(e: unknown, platform = 'tiktok'): string {
  const msg = e instanceof Error ? e.message : String(e);
  const lowerMsg = msg.toLowerCase();

  // Rate limit detection
  if (lowerMsg.includes('429') || lowerMsg.includes('rate limit')) {
    return JSON.stringify({ code: 'RATE_LIMITED', retryAfter: 60, platform, action: 'wait retryAfter seconds then retry' });
  }

  // Session expired detection
  if (lowerMsg.includes('401') || lowerMsg.includes('session') || lowerMsg.includes('login')) {
    return JSON.stringify({ code: 'SESSION_EXPIRED', platform, action: 'call tiktok_session_ensure then retry' });
  }

  // Not found detection
  if (lowerMsg.includes('404') || lowerMsg.includes('not found')) {
    return JSON.stringify({ code: 'NOT_FOUND', platform });
  }

  // Check if already structured
  if (typeof e === 'object' && e !== null && 'code' in e) {
    return JSON.stringify(e);
  }

  // Default error
  return JSON.stringify({ code: 'ERROR', message: msg, platform });
}

async function api(base: string, method: 'GET' | 'POST', path: string, body?: Record<string, unknown>): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: ctrl.signal });
    const text = await res.text();
    if (!res.ok) structuredError(res.status, text, 'tiktok');
    return JSON.parse(text);
  } catch (err) {
    const e = err as { name?: string; cause?: { code?: string } };
    if (e.name === 'AbortError') throw { code: 'SERVICE_DOWN', message: `${base} did not respond within ${TIMEOUT_MS / 1000}s — is the service running?`, base };
    if ((e as { code?: string }).code === 'ECONNREFUSED' || e.cause?.code === 'ECONNREFUSED') throw { code: 'SERVICE_DOWN', message: `${base} is not running`, base };
    throw err;
  } finally { clearTimeout(t); }
}

const TOOLS = [
  { name: 'tiktok_send_dm', description: 'Send a DM to a TikTok user. Uses inbox search → profile fallback → compose-new fallback. Set dryRun=true to preview without sending.', inputSchema: { type: 'object', properties: { username: { type: 'string', description: 'Target username without @' }, text: { type: 'string', description: 'Message text' }, force: { type: 'boolean', description: 'Force send, bypassing active-hours check (default false)', default: false }, dryRun: { type: 'boolean', description: 'Return preview without sending', default: false } }, required: ['username', 'text'] } },
  { name: 'tiktok_get_conversations', description: 'List DM conversations from the TikTok inbox. Supports pagination via cursor.', inputSchema: { type: 'object', properties: { limit: { type: 'number', description: 'Max conversations (default 20)', default: 20 }, cursor: { type: 'string', description: 'Optional pagination cursor from previous response' } } }, outputSchema: { type: 'object', properties: { conversations: { type: 'array', items: { type: 'object', properties: { username: { type: 'string' }, lastMessage: { type: 'string' }, unread: { type: 'boolean' }, timestamp: { type: 'string' } }, required: ['username'] } }, count: { type: 'number' }, nextCursor: { type: 'string' } }, required: ['conversations', 'count'] } },
  { name: 'tiktok_get_unread', description: 'List unread TikTok DM conversations.', inputSchema: { type: 'object', properties: {} } },
  { name: 'tiktok_get_messages', description: 'Read messages from the currently open TikTok conversation.', inputSchema: { type: 'object', properties: { limit: { type: 'number', description: 'Max messages (default 20)', default: 20 } } }, outputSchema: { type: 'object', properties: { messages: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, sender: { type: 'string' }, text: { type: 'string' }, timestamp: { type: 'string' }, isRead: { type: 'boolean' } }, required: ['sender', 'text'] } }, count: { type: 'number' } }, required: ['messages', 'count'] } },
  { name: 'tiktok_ai_generate_dm', description: 'Generate an AI-powered DM using OpenAI GPT-4o-mini. Requires OPENAI_API_KEY env var.', inputSchema: { type: 'object', properties: { username: { type: 'string', description: 'Target username' }, purpose: { type: 'string', description: 'Purpose of DM (e.g., "networking", "collab")' }, topic: { type: 'string', description: 'Optional topic to mention' } }, required: ['username'] } },
  { name: 'tiktok_get_profile', description: 'Get TikTok user profile information (displayName, bio, followers, following, likes).', inputSchema: { type: 'object', properties: { username: { type: 'string', description: 'TikTok username without @' } }, required: ['username'] } },
  { name: 'tiktok_get_trending', description: 'Get trending TikTok videos from For You page.', inputSchema: { type: 'object', properties: { limit: { type: 'number', description: 'Max videos to return (default 20)', default: 20 } } } },
  { name: 'tiktok_post_comment', description: 'Post a comment on a TikTok video. REQUIRES a direct video URL (tiktok.com/@username/video/ID). Set dryRun=true to preview without posting.', inputSchema: { type: 'object', properties: { postUrl: { type: 'string', description: 'Full TikTok video URL (e.g. https://www.tiktok.com/@user/video/1234567890)' }, text: { type: 'string', description: 'Comment text' }, dryRun: { type: 'boolean', description: 'Return preview without posting', default: false } }, required: ['postUrl', 'text'] } },
  { name: 'tiktok_get_comments', description: 'Get comments from a TikTok video. Navigate to the video first or pass postUrl.', inputSchema: { type: 'object', properties: { postUrl: { type: 'string', description: 'TikTok video URL to navigate to first' }, limit: { type: 'number', description: 'Max comments (default 50)', default: 50 } } } },
  { name: 'tiktok_search', description: 'Search TikTok for videos by keyword. Returns author, text, likes, views, comments, URL.', inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Search query' }, maxResults: { type: 'number', description: 'Max results (default 20)', default: 20 } }, required: ['query'] } },
  { name: 'tiktok_video_metrics', description: 'Get engagement metrics (likes, views, comments, shares) from a TikTok video URL.', inputSchema: { type: 'object', properties: { videoUrl: { type: 'string', description: 'Full TikTok video URL' } }, required: ['videoUrl'] } },
  { name: 'tiktok_session_ensure', description: 'Ensure Safari is on the correct TikTok tab and lock it as the active session.', inputSchema: { type: 'object', properties: {} } },
  { name: 'tiktok_session_status', description: 'Get the current TikTok Safari session status.', inputSchema: { type: 'object', properties: {} } },
  { name: 'tiktok_session_clear', description: 'Clear the tracked TikTok Safari session.', inputSchema: { type: 'object', properties: {} } },
  { name: 'tiktok_get_status', description: 'Get TikTok service health and current page URL.', inputSchema: { type: 'object', properties: {} } },
  { name: 'tiktok_navigate_inbox', description: 'Navigate Safari to the TikTok DM inbox.', inputSchema: { type: 'object', properties: {} } },
  { name: 'tiktok_is_ready', description: 'Check if DM service (:3102) and Comments service (:3006) are reachable before attempting any action. Call this first each session.', inputSchema: { type: 'object', properties: {} } },
  { name: 'tiktok_crm_get_contact', description: 'Get CRMLite contact record by TikTok username. Returns contact history, interactions, tags, and pipeline stage across all platforms.', inputSchema: { type: 'object', properties: { username: { type: 'string', description: 'TikTok username without @' } }, required: ['username'] } },
];

async function executeTool(name: string, args: Record<string, unknown>): Promise<{ content: Array<{ type: string; text: string }> }> {
  let result: unknown;
  switch (name) {
    case 'tiktok_send_dm':
      if (args.dryRun) { result = { dryRun: true, wouldSend: { platform: 'tiktok', to: args.username, text: args.text } }; break; }
      result = await api(DM_BASE, 'POST', '/api/tiktok/messages/send-to', { username: args.username, text: args.text }); break;
    case 'tiktok_get_conversations': {
      const cursor = args.cursor ? `?cursor=${encodeURIComponent(args.cursor as string)}` : '';
      const data = await api(DM_BASE, 'GET', `/api/tiktok/conversations${cursor}`) as any;
      // Normalize to { conversations, count, nextCursor? }
      result = { conversations: data.conversations || data, count: data.count || (data.conversations || data).length, nextCursor: data.nextCursor };
      break;
    }
    case 'tiktok_get_unread':       result = await api(DM_BASE, 'GET',  '/api/tiktok/conversations/unread'); break;
    case 'tiktok_get_messages':     result = await api(DM_BASE, 'GET',  `/api/tiktok/messages?limit=${args.limit ?? 20}`); break;
    case 'tiktok_ai_generate_dm':   result = await api(DM_BASE, 'POST', '/api/tiktok/ai/generate', { username: args.username, purpose: args.purpose, topic: args.topic }); break;
    case 'tiktok_get_profile':      result = await api(DM_BASE, 'GET',  `/api/tiktok/profile/${args.username}`); break;
    case 'tiktok_get_trending':     result = await api(COMMENTS_BASE, 'GET', `/api/tiktok/trending?limit=${args.limit ?? 20}`); break;
    case 'tiktok_post_comment':
      if (args.dryRun) { result = { dryRun: true, wouldPost: { platform: 'tiktok', postUrl: args.postUrl, text: args.text } }; break; }
      result = await api(COMMENTS_BASE, 'POST', '/api/tiktok/comments/post', { postUrl: args.postUrl, text: args.text }); break;
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
    case 'tiktok_is_ready': {
      const check = async (url: string) => { try { const r = await fetch(`${url}/health`, { signal: AbortSignal.timeout(5000) }); return r.ok; } catch { return false; } };
      const [dm, comments] = await Promise.all([check(DM_BASE), check(COMMENTS_BASE)]);
      result = { dm, comments, ready: dm && comments, dmUrl: DM_BASE, commentsUrl: COMMENTS_BASE };
      break;
    }
    case 'tiktok_crm_get_contact': {
      const username = args.username as string;
      const crmUrl = `https://crmlite-h3k1s46jj-isaiahduprees-projects.vercel.app/api/contacts/by-username/tiktok/${encodeURIComponent(username)}`;
      try {
        const res = await fetch(crmUrl, { signal: AbortSignal.timeout(5000) });
        if (res.status === 404) { result = { found: false, username }; break; }
        if (!res.ok) throw new Error(`CRMLite returned ${res.status}`);
        result = await res.json();
      } catch (err) {
        result = { found: false, username, error: err instanceof Error ? err.message : String(err) };
      }
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