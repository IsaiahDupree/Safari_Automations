/**
 * Twitter/X MCP Server — JSON-RPC 2.0 over stdio
 * DM service:       http://localhost:3003
 * Comments service: http://localhost:3007
 * Start: npx tsx packages/twitter-dm/src/api/mcp-server.ts
 */

import * as readline from 'readline';

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_NAME = 'twitter-safari-automation';
const SERVER_VERSION = '1.0.0';
const DM_BASE = 'http://localhost:3003';
const COMMENTS_BASE = 'http://localhost:3007';
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
  { name: 'twitter_send_dm', description: 'Send a DM to a Twitter/X user. Uses profile→Message button with inbox compose fallback for restricted accounts.', inputSchema: { type: 'object', properties: { username: { type: 'string', description: 'Target username without @' }, text: { type: 'string', description: 'Message text' }, force: { type: 'boolean', description: 'Bypass active-hours check (default false)', default: false } }, required: ['username', 'text'] } },
  { name: 'twitter_ai_generate_dm', description: 'Generate a personalized DM using OpenAI GPT-4o-mini. Returns message text ready to send.', inputSchema: { type: 'object', properties: { username: { type: 'string', description: 'Target username without @' }, purpose: { type: 'string', description: 'Purpose of the message (e.g., networking, collaboration)' }, topic: { type: 'string', description: 'Optional topic to mention' } }, required: ['username', 'purpose'] } },
  { name: 'twitter_get_conversations', description: 'List DM conversations from the Twitter/X inbox.', inputSchema: { type: 'object', properties: { limit: { type: 'number', description: 'Max conversations (default 20)', default: 20 } } } },
  { name: 'twitter_search_conversations', description: 'Search DM conversations by username or keyword. Returns matching conversations with preview and unread status.', inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Username or keyword to search for' } }, required: ['query'] } },
  { name: 'twitter_get_unread', description: 'List unread DM conversations on Twitter/X.', inputSchema: { type: 'object', properties: {} } },
  { name: 'twitter_get_messages', description: 'Read messages from the currently open Twitter/X conversation.', inputSchema: { type: 'object', properties: { limit: { type: 'number', description: 'Max messages (default 20)', default: 20 } } } },
  { name: 'twitter_open_conversation', description: 'Open a DM conversation with a specific user.', inputSchema: { type: 'object', properties: { username: { type: 'string', description: 'Username to open conversation with' } }, required: ['username'] } },
  { name: 'twitter_new_conversation', description: 'Start a brand-new DM conversation with a user who you have no prior thread with.', inputSchema: { type: 'object', properties: { username: { type: 'string', description: 'Username to message' } }, required: ['username'] } },
  { name: 'twitter_post_comment', description: 'Reply to a tweet by URL. Supports useAI=true to auto-generate a reply with GPT-4o.', inputSchema: { type: 'object', properties: { postUrl: { type: 'string', description: 'Full tweet URL to reply to' }, text: { type: 'string', description: 'Reply text (omit if useAI=true)' }, useAI: { type: 'boolean', description: 'Auto-generate reply with GPT-4o', default: false } }, required: ['postUrl'] } },
  { name: 'twitter_search', description: 'Search tweets by keyword. Returns author, text, likes, retweets, views, URL.', inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Search query' }, tab: { type: 'string', enum: ['top', 'latest', 'people', 'media'], description: 'Search tab (default: top)', default: 'top' }, maxResults: { type: 'number', description: 'Max results (default 20)', default: 20 } }, required: ['query'] } },
  { name: 'twitter_timeline', description: 'Get recent tweets from a user\'s profile timeline.', inputSchema: { type: 'object', properties: { handle: { type: 'string', description: 'Twitter handle without @' }, maxResults: { type: 'number', description: 'Max tweets (default 20)', default: 20 } }, required: ['handle'] } },
  { name: 'twitter_compose_tweet', description: 'Compose and post a new tweet. Supports AI generation, reply settings, polls, threads.', inputSchema: { type: 'object', properties: { text: { type: 'string', description: 'Tweet text (omit if useAI=true)' }, useAI: { type: 'boolean', description: 'Generate tweet with GPT-4o', default: false }, topic: { type: 'string', description: 'Topic for AI generation' }, replySettings: { type: 'string', enum: ['everyone', 'following', 'verified', 'mentioned'], description: 'Who can reply', default: 'everyone' } } } },
  { name: 'twitter_like_tweet', description: 'Like a tweet by URL. Clicks the like button.', inputSchema: { type: 'object', properties: { tweetUrl: { type: 'string', description: 'Full tweet URL' } }, required: ['tweetUrl'] } },
  { name: 'twitter_retweet', description: 'Retweet a tweet by URL. Clicks retweet and confirms.', inputSchema: { type: 'object', properties: { tweetUrl: { type: 'string', description: 'Full tweet URL' } }, required: ['tweetUrl'] } },
  { name: 'twitter_bookmark_tweet', description: 'Bookmark or unbookmark a tweet by URL.', inputSchema: { type: 'object', properties: { tweetUrl: { type: 'string', description: 'Full tweet URL' } }, required: ['tweetUrl'] } },
  { name: 'twitter_get_tweet_metrics', description: 'Get engagement metrics for a tweet (likes, retweets, replies, views).', inputSchema: { type: 'object', properties: { tweetUrl: { type: 'string', description: 'Full tweet URL' } }, required: ['tweetUrl'] } },
  { name: 'twitter_get_profile', description: 'Get profile information for a Twitter/X user (display name, bio, followers, following, verified status).', inputSchema: { type: 'object', properties: { handle: { type: 'string', description: 'Twitter handle without @' } }, required: ['handle'] } },
  { name: 'twitter_session_ensure', description: 'Ensure Safari is on the correct Twitter/X tab and lock it as the active session.', inputSchema: { type: 'object', properties: {} } },
  { name: 'twitter_session_status', description: 'Get the current Twitter/X Safari session status.', inputSchema: { type: 'object', properties: {} } },
  { name: 'twitter_session_clear', description: 'Clear the tracked Twitter/X Safari session.', inputSchema: { type: 'object', properties: {} } },
  { name: 'twitter_get_status', description: 'Get Twitter/X service health and current page URL.', inputSchema: { type: 'object', properties: {} } },
  { name: 'twitter_navigate_inbox', description: 'Navigate Safari to the Twitter/X DM inbox.', inputSchema: { type: 'object', properties: {} } },
];

async function executeTool(name: string, args: Record<string, unknown>): Promise<{ content: Array<{ type: string; text: string }> }> {
  let result: unknown;
  switch (name) {
    case 'twitter_send_dm':          result = await api(DM_BASE, 'POST', '/api/twitter/messages/send-to', { username: args.username, text: args.text, force: args.force }); break;
    case 'twitter_ai_generate_dm':   result = await api(DM_BASE, 'POST', '/api/twitter/ai/generate', { username: args.username, purpose: args.purpose, topic: args.topic }); break;
    case 'twitter_get_conversations': result = await api(DM_BASE, 'GET',  '/api/twitter/conversations'); break;
    case 'twitter_search_conversations': result = await api(DM_BASE, 'GET',  `/api/twitter/conversations/search?q=${encodeURIComponent(args.query as string)}`); break;
    case 'twitter_get_unread':       result = await api(DM_BASE, 'GET',  '/api/twitter/conversations/unread'); break;
    case 'twitter_get_messages':     result = await api(DM_BASE, 'GET',  `/api/twitter/messages?limit=${args.limit ?? 20}`); break;
    case 'twitter_open_conversation': result = await api(DM_BASE, 'POST', '/api/twitter/conversations/open', { username: args.username }); break;
    case 'twitter_new_conversation':  result = await api(DM_BASE, 'POST', '/api/twitter/conversations/new', { username: args.username }); break;
    case 'twitter_post_comment':     result = await api(COMMENTS_BASE, 'POST', '/api/twitter/tweet/reply', { url: args.postUrl, text: args.text, useAI: args.useAI }); break;
    case 'twitter_search':           result = await api(COMMENTS_BASE, 'POST', '/api/twitter/search', { query: args.query, tab: args.tab ?? 'top', maxResults: args.maxResults ?? 20 }); break;
    case 'twitter_timeline':         result = await api(COMMENTS_BASE, 'POST', '/api/twitter/timeline', { handle: args.handle, maxResults: args.maxResults ?? 20 }); break;
    case 'twitter_compose_tweet':    result = await api(COMMENTS_BASE, 'POST', '/api/twitter/tweet', { text: args.text, useAI: args.useAI, topic: args.topic, replySettings: args.replySettings }); break;
    case 'twitter_like_tweet':       result = await api(COMMENTS_BASE, 'POST', '/api/twitter/tweet/like', { tweetUrl: args.tweetUrl }); break;
    case 'twitter_retweet':          result = await api(COMMENTS_BASE, 'POST', '/api/twitter/tweet/retweet', { tweetUrl: args.tweetUrl }); break;
    case 'twitter_bookmark_tweet':   result = await api(COMMENTS_BASE, 'POST', '/api/twitter/tweet/bookmark', { tweetUrl: args.tweetUrl }); break;
    case 'twitter_get_tweet_metrics': result = await api(COMMENTS_BASE, 'GET',  `/api/twitter/tweet/metrics?tweetUrl=${encodeURIComponent(args.tweetUrl as string)}`); break;
    case 'twitter_get_profile':      result = await api(DM_BASE, 'GET',  `/api/twitter/profile/${args.handle}`); break;
    case 'twitter_session_ensure':   result = await api(DM_BASE, 'POST', '/api/session/ensure'); break;
    case 'twitter_session_status':   result = await api(DM_BASE, 'GET',  '/api/session/status'); break;
    case 'twitter_session_clear':    result = await api(DM_BASE, 'POST', '/api/session/clear'); break;
    case 'twitter_get_status':       result = await api(DM_BASE, 'GET',  '/health'); break;
    case 'twitter_navigate_inbox':   result = await api(DM_BASE, 'POST', '/api/twitter/inbox/navigate'); break;
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