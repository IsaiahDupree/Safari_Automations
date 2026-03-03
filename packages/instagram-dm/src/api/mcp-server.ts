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

function structuredError(status: number, body: string, platform: string): never {
  if (status === 429) throw { code: 'RATE_LIMITED', message: 'Rate limit hit — wait before retrying', retryAfter: 60, platform };
  if (status === 401 || status === 403) throw { code: 'SESSION_EXPIRED', message: 'Safari session expired or unauthorized', action: `call ${platform}_session_ensure`, platform };
  if (status === 404) throw { code: 'NOT_FOUND', message: body.slice(0, 100), platform };
  throw { code: 'API_ERROR', message: `HTTP ${status}: ${body.slice(0, 200)}`, platform };
}

function formatMcpError(e: unknown, platform = 'instagram'): string {
  const msg = e instanceof Error ? e.message : String(e);
  const lowerMsg = msg.toLowerCase();

  // Rate limit detection
  if (lowerMsg.includes('429') || lowerMsg.includes('rate limit')) {
    return JSON.stringify({ code: 'RATE_LIMITED', retryAfter: 60, platform, action: 'wait retryAfter seconds then retry' });
  }

  // Session expired detection
  if (lowerMsg.includes('401') || lowerMsg.includes('session') || lowerMsg.includes('login')) {
    return JSON.stringify({ code: 'SESSION_EXPIRED', platform, action: 'call instagram_session_ensure then retry' });
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
    if (!res.ok) structuredError(res.status, text, 'instagram');
    return JSON.parse(text);
  } catch (err) {
    const e = err as { name?: string; cause?: { code?: string } };
    if (e.name === 'AbortError') throw { code: 'SERVICE_DOWN', message: `${base} did not respond within ${TIMEOUT_MS / 1000}s — is the service running?`, base };
    if ((e as { code?: string }).code === 'ECONNREFUSED' || e.cause?.code === 'ECONNREFUSED') throw { code: 'SERVICE_DOWN', message: `${base} is not running`, base };
    throw err;
  } finally { clearTimeout(t); }
}

const TOOLS = [
  { name: 'instagram_send_dm', description: 'Send a DM to an Instagram user. Navigates profile → opens DM → types → sends. Set dryRun=true to preview without sending.', inputSchema: { type: 'object', properties: { username: { type: 'string', description: 'Target username without @' }, text: { type: 'string', description: 'Message text' }, dryRun: { type: 'boolean', description: 'Return preview of what would be sent without actually sending', default: false } }, required: ['username', 'text'] } },
  { name: 'instagram_get_conversations', description: 'List recent DM conversations from the Instagram inbox. Supports pagination via cursor.', inputSchema: { type: 'object', properties: { limit: { type: 'number', description: 'Max conversations to return (default 20)', default: 20 }, cursor: { type: 'string', description: 'Optional pagination cursor from previous response' } } }, outputSchema: { type: 'object', properties: { conversations: { type: 'array', items: { type: 'object', properties: { username: { type: 'string' }, lastMessage: { type: 'string' }, unread: { type: 'boolean' }, timestamp: { type: 'string' } }, required: ['username'] } }, count: { type: 'number' }, nextCursor: { type: 'string' } }, required: ['conversations', 'count'] } },
  { name: 'instagram_get_unread', description: 'Get unread DM conversations by detecting unread badges/indicators.', inputSchema: { type: 'object', properties: {} } },
  { name: 'instagram_get_messages', description: 'Read messages from the currently open Instagram conversation.', inputSchema: { type: 'object', properties: { limit: { type: 'number', description: 'Max messages (default 20)', default: 20 } } }, outputSchema: { type: 'object', properties: { messages: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, sender: { type: 'string' }, text: { type: 'string' }, timestamp: { type: 'string' }, isRead: { type: 'boolean' } }, required: ['sender', 'text'] } }, count: { type: 'number' } }, required: ['messages', 'count'] } },
  { name: 'instagram_open_conversation', description: 'Open a DM conversation with a specific user in the Instagram inbox.', inputSchema: { type: 'object', properties: { username: { type: 'string', description: 'Username to open conversation with' } }, required: ['username'] } },
  { name: 'instagram_accept_request', description: 'Accept a message request from a user. Navigates to requests tab and clicks Accept. Set dryRun=true to preview without accepting.', inputSchema: { type: 'object', properties: { username: { type: 'string', description: 'Username to accept request from' }, dryRun: { type: 'boolean', description: 'Return preview of what would be accepted without actually accepting', default: false } }, required: ['username'] } },
  { name: 'instagram_decline_request', description: 'Decline a message request from a user. Navigates to requests tab and clicks Decline.', inputSchema: { type: 'object', properties: { username: { type: 'string', description: 'Username to decline request from' } }, required: ['username'] } },
  { name: 'instagram_get_profile', description: 'Get Instagram profile information (name, bio, followers, following, posts, verified status).', inputSchema: { type: 'object', properties: { username: { type: 'string', description: 'Username to fetch profile for' } }, required: ['username'] } },
  { name: 'instagram_post_comment', description: 'Post a comment on an Instagram post by URL. Set dryRun=true to preview without posting.', inputSchema: { type: 'object', properties: { postUrl: { type: 'string', description: 'Full Instagram post URL' }, text: { type: 'string', description: 'Comment text' }, dryRun: { type: 'boolean', description: 'Return preview of what would be posted without actually posting', default: false } }, required: ['postUrl', 'text'] } },
  { name: 'instagram_get_comments', description: 'Get comments from an Instagram post. Navigate to the post first or pass postUrl.', inputSchema: { type: 'object', properties: { postUrl: { type: 'string', description: 'Optional: post URL to navigate to first' }, limit: { type: 'number', description: 'Max comments (default 50)', default: 50 } } } },
  { name: 'instagram_session_ensure', description: 'Ensure Safari is on the correct Instagram tab and lock it as the active session.', inputSchema: { type: 'object', properties: {} } },
  { name: 'instagram_session_status', description: 'Get the current Instagram Safari session status (window/tab, URL, last verified).', inputSchema: { type: 'object', properties: {} } },
  { name: 'instagram_session_clear', description: 'Clear the tracked Instagram Safari session. Use after restarting Safari or switching tabs.', inputSchema: { type: 'object', properties: {} } },
  { name: 'instagram_get_status', description: 'Get Instagram service health and current page URL.', inputSchema: { type: 'object', properties: {} } },
  { name: 'instagram_navigate_inbox', description: 'Navigate Safari to the Instagram DM inbox.', inputSchema: { type: 'object', properties: {} } },
  { name: 'instagram_ai_generate_dm', description: 'Generate an AI-written DM for a user using GPT-4o.', inputSchema: { type: 'object', properties: { username: { type: 'string', description: 'Target username' }, purpose: { type: 'string', description: 'Purpose of outreach (e.g. "collab offer", "lead follow-up")' }, topic: { type: 'string', description: 'Optional topic to reference' } }, required: ['username', 'purpose'] } },
  { name: 'instagram_is_ready', description: 'Check if DM service (:3100) and Comments service (:3005) are reachable before attempting any action. Call this first each session.', inputSchema: { type: 'object', properties: {} } },
  { name: 'instagram_crm_get_contact', description: 'Get CRMLite contact record by Instagram username. Returns contact history, interactions, tags, and pipeline stage across all platforms.', inputSchema: { type: 'object', properties: { username: { type: 'string', description: 'Instagram username without @' } }, required: ['username'] } },
];

async function executeTool(name: string, args: Record<string, unknown>): Promise<{ content: Array<{ type: string; text: string }> }> {
  let result: unknown;
  switch (name) {
    case 'instagram_send_dm':
      if (args.dryRun) { result = { dryRun: true, wouldSend: { platform: 'instagram', to: args.username, text: args.text } }; break; }
      result = await api(DM_BASE, 'POST', '/api/messages/send-to', { username: args.username, text: args.text }); break;
    case 'instagram_get_conversations': {
      const cursor = args.cursor ? `?cursor=${encodeURIComponent(args.cursor as string)}` : '';
      const data = await api(DM_BASE, 'GET', `/api/conversations${cursor}`) as any;
      // Normalize to { conversations, count, nextCursor? }
      result = { conversations: data.conversations || data, count: data.count || (data.conversations || data).length, nextCursor: data.nextCursor };
      break;
    }
    case 'instagram_get_unread':     result = await api(DM_BASE, 'GET', '/api/conversations/unread'); break;
    case 'instagram_get_messages':   result = await api(DM_BASE, 'GET', `/api/messages?limit=${args.limit ?? 20}`); break;
    case 'instagram_open_conversation': result = await api(DM_BASE, 'POST', '/api/conversations/open', { username: args.username }); break;
    case 'instagram_accept_request':
      if (args.dryRun) { result = { dryRun: true, wouldAccept: { platform: 'instagram', username: args.username } }; break; }
      result = await api(DM_BASE, 'POST', `/api/requests/${args.username}/accept`); break;
    case 'instagram_decline_request': result = await api(DM_BASE, 'POST', `/api/requests/${args.username}/decline`); break;
    case 'instagram_get_profile':    result = await api(DM_BASE, 'GET', `/api/profile/${args.username}`); break;
    case 'instagram_post_comment':
      if (args.dryRun) { result = { dryRun: true, wouldPost: { platform: 'instagram', postUrl: args.postUrl, text: args.text } }; break; }
      result = await api(COMMENTS_BASE, 'POST', '/api/instagram/comments/post', { postUrl: args.postUrl, text: args.text }); break;
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
    case 'instagram_is_ready': {
      const check = async (url: string) => { try { const r = await fetch(`${url}/health`, { signal: AbortSignal.timeout(5000) }); return r.ok; } catch { return false; } };
      const [dm, comments] = await Promise.all([check(DM_BASE), check(COMMENTS_BASE)]);
      result = { dm, comments, ready: dm && comments, dmUrl: DM_BASE, commentsUrl: COMMENTS_BASE };
      break;
    }
    case 'instagram_crm_get_contact': {
      const username = args.username as string;
      const crmUrl = `https://crmlite-h3k1s46jj-isaiahduprees-projects.vercel.app/api/contacts/by-username/instagram/${encodeURIComponent(username)}`;
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