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

function structuredError(status: number, body: string, platform: string): never {
  if (status === 429) throw { code: 'RATE_LIMITED', message: 'Rate limit hit — wait before retrying', retryAfter: 60, platform };
  if (status === 401 || status === 403) throw { code: 'SESSION_EXPIRED', message: 'Safari session expired or unauthorized', action: `call ${platform}_session_ensure`, platform };
  if (status === 404) throw { code: 'NOT_FOUND', message: body.slice(0, 100), platform };
  throw { code: 'API_ERROR', message: `HTTP ${status}: ${body.slice(0, 200)}`, platform };
}

function formatMcpError(e: unknown, platform = 'twitter'): string {
  const msg = e instanceof Error ? e.message : String(e);
  const lowerMsg = msg.toLowerCase();

  // Rate limit detection
  if (lowerMsg.includes('429') || lowerMsg.includes('rate limit')) {
    return JSON.stringify({ code: 'RATE_LIMITED', retryAfter: 60, platform, action: 'wait retryAfter seconds then retry' });
  }

  // Session expired detection
  if (lowerMsg.includes('401') || lowerMsg.includes('session') || lowerMsg.includes('login')) {
    return JSON.stringify({ code: 'SESSION_EXPIRED', platform, action: 'call twitter_session_ensure then retry' });
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
    if (!res.ok) structuredError(res.status, text, 'twitter');
    return JSON.parse(text);
  } catch (err) {
    const e = err as { name?: string; cause?: { code?: string } };
    if (e.name === 'AbortError') throw { code: 'SERVICE_DOWN', message: `${base} did not respond within ${TIMEOUT_MS / 1000}s — is the service running?`, base };
    if ((e as { code?: string }).code === 'ECONNREFUSED' || e.cause?.code === 'ECONNREFUSED') throw { code: 'SERVICE_DOWN', message: `${base} is not running`, base };
    throw err;
  } finally { clearTimeout(t); }
}

const TOOLS = [
  { name: 'twitter_send_dm', description: 'Send a DM to a Twitter/X user. Uses profile→Message button with inbox compose fallback for restricted accounts. Set dryRun=true to preview without sending.', inputSchema: { type: 'object', properties: { username: { type: 'string', description: 'Target username without @' }, text: { type: 'string', description: 'Message text' }, force: { type: 'boolean', description: 'Bypass active-hours check (default false)', default: false }, dryRun: { type: 'boolean', description: 'Return preview without sending', default: false } }, required: ['username', 'text'] } },
  { name: 'twitter_ai_generate_dm', description: 'Generate a personalized DM using OpenAI GPT-4o-mini. Returns message text ready to send.', inputSchema: { type: 'object', properties: { username: { type: 'string', description: 'Target username without @' }, purpose: { type: 'string', description: 'Purpose of the message (e.g., networking, collaboration)' }, topic: { type: 'string', description: 'Optional topic to mention' } }, required: ['username', 'purpose'] } },
  { name: 'twitter_get_conversations', description: 'List DM conversations from the Twitter/X inbox. Supports pagination via cursor.', inputSchema: { type: 'object', properties: { limit: { type: 'number', description: 'Max conversations (default 20)', default: 20 }, cursor: { type: 'string', description: 'Optional pagination cursor from previous response' } } }, outputSchema: { type: 'object', properties: { conversations: { type: 'array', items: { type: 'object', properties: { username: { type: 'string' }, lastMessage: { type: 'string' }, unread: { type: 'boolean' }, timestamp: { type: 'string' } }, required: ['username'] } }, count: { type: 'number' }, nextCursor: { type: 'string' } }, required: ['conversations', 'count'] } },
  { name: 'twitter_search_conversations', description: 'Search DM conversations by username or keyword. Returns matching conversations with preview and unread status.', inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Username or keyword to search for' } }, required: ['query'] } },
  { name: 'twitter_get_unread', description: 'List unread DM conversations on Twitter/X.', inputSchema: { type: 'object', properties: {} } },
  { name: 'twitter_get_messages', description: 'Read messages from the currently open Twitter/X conversation.', inputSchema: { type: 'object', properties: { limit: { type: 'number', description: 'Max messages (default 20)', default: 20 } } }, outputSchema: { type: 'object', properties: { messages: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, sender: { type: 'string' }, text: { type: 'string' }, timestamp: { type: 'string' }, isRead: { type: 'boolean' } }, required: ['sender', 'text'] } }, count: { type: 'number' } }, required: ['messages', 'count'] } },
  { name: 'twitter_open_conversation', description: 'Open a DM conversation with a specific user.', inputSchema: { type: 'object', properties: { username: { type: 'string', description: 'Username to open conversation with' } }, required: ['username'] } },
  { name: 'twitter_new_conversation', description: 'Start a brand-new DM conversation with a user who you have no prior thread with.', inputSchema: { type: 'object', properties: { username: { type: 'string', description: 'Username to message' } }, required: ['username'] } },
  { name: 'twitter_post_comment', description: 'Reply to a tweet by URL. Supports useAI=true to auto-generate a reply with GPT-4o. Set dryRun=true to preview without posting.', inputSchema: { type: 'object', properties: { postUrl: { type: 'string', description: 'Full tweet URL to reply to' }, text: { type: 'string', description: 'Reply text (omit if useAI=true)' }, useAI: { type: 'boolean', description: 'Auto-generate reply with GPT-4o', default: false }, dryRun: { type: 'boolean', description: 'Return preview without posting', default: false } }, required: ['postUrl'] } },
  { name: 'twitter_search', description: 'Search tweets by keyword. Returns author, text, likes, retweets, views, URL.', inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Search query' }, tab: { type: 'string', enum: ['top', 'latest', 'people', 'media'], description: 'Search tab (default: top)', default: 'top' }, maxResults: { type: 'number', description: 'Max results (default 20)', default: 20 } }, required: ['query'] } },
  { name: 'twitter_timeline', description: 'Get recent tweets from a user\'s profile timeline.', inputSchema: { type: 'object', properties: { handle: { type: 'string', description: 'Twitter handle without @' }, maxResults: { type: 'number', description: 'Max tweets (default 20)', default: 20 } }, required: ['handle'] } },
  { name: 'twitter_compose_tweet', description: 'Compose and post a new tweet. Supports AI generation, reply settings. Set dryRun=true to preview without posting.', inputSchema: { type: 'object', properties: { text: { type: 'string', description: 'Tweet text (omit if useAI=true)' }, useAI: { type: 'boolean', description: 'Generate tweet with GPT-4o', default: false }, topic: { type: 'string', description: 'Topic for AI generation' }, replySettings: { type: 'string', enum: ['everyone', 'following', 'verified', 'mentioned'], description: 'Who can reply', default: 'everyone' }, dryRun: { type: 'boolean', description: 'Return preview without posting', default: false } } } },
  { name: 'twitter_like_tweet', description: 'Like a tweet by URL. Clicks the like button. Set dryRun=true to preview without liking.', inputSchema: { type: 'object', properties: { tweetUrl: { type: 'string', description: 'Full tweet URL' }, dryRun: { type: 'boolean', description: 'Return preview without liking', default: false } }, required: ['tweetUrl'] } },
  { name: 'twitter_retweet', description: 'Retweet a tweet by URL. Clicks retweet and confirms. Set dryRun=true to preview without retweeting.', inputSchema: { type: 'object', properties: { tweetUrl: { type: 'string', description: 'Full tweet URL' }, dryRun: { type: 'boolean', description: 'Return preview without retweeting', default: false } }, required: ['tweetUrl'] } },
  { name: 'twitter_bookmark_tweet', description: 'Bookmark or unbookmark a tweet by URL.', inputSchema: { type: 'object', properties: { tweetUrl: { type: 'string', description: 'Full tweet URL' } }, required: ['tweetUrl'] } },
  { name: 'twitter_get_tweet_metrics', description: 'Get engagement metrics for a tweet (likes, retweets, replies, views).', inputSchema: { type: 'object', properties: { tweetUrl: { type: 'string', description: 'Full tweet URL' } }, required: ['tweetUrl'] } },
  { name: 'twitter_get_profile', description: 'Get profile information for a Twitter/X user (display name, bio, followers, following, verified status).', inputSchema: { type: 'object', properties: { handle: { type: 'string', description: 'Twitter handle without @' } }, required: ['handle'] } },
  { name: 'twitter_session_ensure', description: 'Ensure Safari is on the correct Twitter/X tab and lock it as the active session.', inputSchema: { type: 'object', properties: {} } },
  { name: 'twitter_session_status', description: 'Get the current Twitter/X Safari session status.', inputSchema: { type: 'object', properties: {} } },
  { name: 'twitter_session_clear', description: 'Clear the tracked Twitter/X Safari session.', inputSchema: { type: 'object', properties: {} } },
  { name: 'twitter_get_status', description: 'Get Twitter/X service health and current page URL.', inputSchema: { type: 'object', properties: {} } },
  { name: 'twitter_navigate_inbox', description: 'Navigate Safari to the Twitter/X DM inbox.', inputSchema: { type: 'object', properties: {} } },
  { name: 'twitter_is_ready', description: 'Check if DM service (:3003) and Comments service (:3007) are reachable before attempting any action. Call this first each session.', inputSchema: { type: 'object', properties: {} } },
  { name: 'twitter_crm_get_contact', description: 'Get CRMLite contact record by Twitter username. Returns contact history, interactions, tags, and pipeline stage across all platforms.', inputSchema: { type: 'object', properties: { username: { type: 'string', description: 'Twitter username without @' } }, required: ['username'] } },
  { name: 'twitter_discover_prospects', description: 'Discover and score ICP-matching Twitter/X users from search results and recent DM conversations. Returns ranked candidates with bio keyword signals and follower data. Set dryRun=true to skip navigation.', inputSchema: { type: 'object', properties: { keywords: { type: 'array', items: { type: 'string' }, description: 'Search keywords/hashtags (default: buildinpublic, saasfounder, aiautomation)' }, sources: { type: 'array', items: { type: 'string', enum: ['search', 'conversations'] }, description: 'Data sources to use (default: both)' }, maxCandidates: { type: 'number', description: 'Max profiles to enrich (default 15, max 20)', default: 15 }, minScore: { type: 'number', description: 'Minimum ICP score to include (default 30)', default: 30 }, dryRun: { type: 'boolean', description: 'Return empty immediately without navigating', default: false } } } },
  { name: 'twitter_score_prospect', description: 'Enrich and score a single Twitter/X user against the ICP. Returns profile data + icpScore (0-100) + icpSignals explaining the score.', inputSchema: { type: 'object', properties: { handle: { type: 'string', description: 'Twitter handle without @' } }, required: ['handle'] } },
  { name: 'twitter_queue_prospect', description: 'Add a scored Twitter/X prospect to the suggested_actions outreach queue. No DM is sent — requires human review first.', inputSchema: { type: 'object', properties: { username: { type: 'string', description: 'Twitter username without @' }, message: { type: 'string', description: 'Outreach message to queue' }, priority: { type: 'number', description: 'Priority 1-10 (default 5)', default: 5 } }, required: ['username', 'message'] } },
];

async function executeTool(name: string, args: Record<string, unknown>): Promise<{ content: Array<{ type: string; text: string }> }> {
  let result: unknown;
  switch (name) {
    case 'twitter_send_dm':
      if (args.dryRun) { result = { dryRun: true, wouldSend: { platform: 'twitter', to: args.username, text: args.text } }; break; }
      result = await api(DM_BASE, 'POST', '/api/twitter/messages/send-to', { username: args.username, text: args.text, force: args.force }); break;
    case 'twitter_ai_generate_dm':   result = await api(DM_BASE, 'POST', '/api/twitter/ai/generate', { username: args.username, purpose: args.purpose, topic: args.topic }); break;
    case 'twitter_get_conversations': {
      const cursor = args.cursor ? `?cursor=${encodeURIComponent(args.cursor as string)}` : '';
      const data = await api(DM_BASE, 'GET', `/api/twitter/conversations${cursor}`) as any;
      // Normalize to { conversations, count, nextCursor? }
      result = { conversations: data.conversations || data, count: data.count || (data.conversations || data).length, nextCursor: data.nextCursor };
      break;
    }
    case 'twitter_search_conversations': result = await api(DM_BASE, 'GET',  `/api/twitter/conversations/search?q=${encodeURIComponent(args.query as string)}`); break;
    case 'twitter_get_unread':       result = await api(DM_BASE, 'GET',  '/api/twitter/conversations/unread'); break;
    case 'twitter_get_messages':     result = await api(DM_BASE, 'GET',  `/api/twitter/messages?limit=${args.limit ?? 20}`); break;
    case 'twitter_open_conversation': result = await api(DM_BASE, 'POST', '/api/twitter/conversations/open', { username: args.username }); break;
    case 'twitter_new_conversation':  result = await api(DM_BASE, 'POST', '/api/twitter/conversations/new', { username: args.username }); break;
    case 'twitter_post_comment':
      if (args.dryRun) { result = { dryRun: true, wouldPost: { platform: 'twitter', postUrl: args.postUrl, text: args.text, useAI: args.useAI } }; break; }
      result = await api(COMMENTS_BASE, 'POST', '/api/twitter/tweet/reply', { url: args.postUrl, text: args.text, useAI: args.useAI }); break;
    case 'twitter_search':           result = await api(COMMENTS_BASE, 'POST', '/api/twitter/search', { query: args.query, tab: args.tab ?? 'top', maxResults: args.maxResults ?? 20 }); break;
    case 'twitter_timeline':         result = await api(COMMENTS_BASE, 'POST', '/api/twitter/timeline', { handle: args.handle, maxResults: args.maxResults ?? 20 }); break;
    case 'twitter_compose_tweet':
      if (args.dryRun) { result = { dryRun: true, wouldTweet: { platform: 'twitter', text: args.text, useAI: args.useAI, topic: args.topic, replySettings: args.replySettings } }; break; }
      result = await api(COMMENTS_BASE, 'POST', '/api/twitter/tweet', { text: args.text, useAI: args.useAI, topic: args.topic, replySettings: args.replySettings }); break;
    case 'twitter_like_tweet':
      if (args.dryRun) { result = { dryRun: true, wouldLike: { platform: 'twitter', tweetUrl: args.tweetUrl } }; break; }
      result = await api(COMMENTS_BASE, 'POST', '/api/twitter/tweet/like', { tweetUrl: args.tweetUrl }); break;
    case 'twitter_retweet':
      if (args.dryRun) { result = { dryRun: true, wouldRetweet: { platform: 'twitter', tweetUrl: args.tweetUrl } }; break; }
      result = await api(COMMENTS_BASE, 'POST', '/api/twitter/tweet/retweet', { tweetUrl: args.tweetUrl }); break;
    case 'twitter_bookmark_tweet':   result = await api(COMMENTS_BASE, 'POST', '/api/twitter/tweet/bookmark', { tweetUrl: args.tweetUrl }); break;
    case 'twitter_get_tweet_metrics': result = await api(COMMENTS_BASE, 'GET',  `/api/twitter/tweet/metrics?tweetUrl=${encodeURIComponent(args.tweetUrl as string)}`); break;
    case 'twitter_get_profile':      result = await api(DM_BASE, 'GET',  `/api/twitter/profile/${args.handle}`); break;
    case 'twitter_session_ensure':   result = await api(DM_BASE, 'POST', '/api/session/ensure'); break;
    case 'twitter_session_status':   result = await api(DM_BASE, 'GET',  '/api/session/status'); break;
    case 'twitter_session_clear':    result = await api(DM_BASE, 'POST', '/api/session/clear'); break;
    case 'twitter_get_status':       result = await api(DM_BASE, 'GET',  '/health'); break;
    case 'twitter_navigate_inbox':   result = await api(DM_BASE, 'POST', '/api/twitter/inbox/navigate'); break;
    case 'twitter_is_ready': {
      const check = async (url: string) => { try { const r = await fetch(`${url}/health`, { signal: AbortSignal.timeout(5000) }); return r.ok; } catch { return false; } };
      const [dm, comments] = await Promise.all([check(DM_BASE), check(COMMENTS_BASE)]);
      result = { dm, comments, ready: dm && comments, dmUrl: DM_BASE, commentsUrl: COMMENTS_BASE };
      break;
    }
    case 'twitter_crm_get_contact': {
      const username = args.username as string;
      const crmUrl = `https://crmlite-h3k1s46jj-isaiahduprees-projects.vercel.app/api/contacts/by-username/twitter/${encodeURIComponent(username)}`;
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
    case 'twitter_discover_prospects':
      result = await api(DM_BASE, 'POST', '/api/twitter/prospect/discover', {
        keywords: args.keywords, sources: args.sources, maxCandidates: args.maxCandidates,
        minScore: args.minScore, dryRun: args.dryRun,
      }); break;
    case 'twitter_score_prospect':
      result = await api(DM_BASE, 'GET', `/api/twitter/prospect/score/${encodeURIComponent(args.handle as string)}`); break;
    case 'twitter_queue_prospect': {
      const username = args.username as string;
      result = await api(DM_BASE, 'POST', '/api/twitter/outreach/queue', {
        contact_id: username,
        platform: 'twitter',
        template_id: 'manual',
        lane: 'cold',
        message: args.message,
        personalized_message: args.message,
        priority: args.priority ?? 5,
        phase: 'discovery',
        status: 'pending',
      }); break;
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