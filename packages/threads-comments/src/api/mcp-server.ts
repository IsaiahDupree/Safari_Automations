/**
 * Threads MCP Server — JSON-RPC 2.0 over stdio
 *
 * Implements the Model Context Protocol (MCP) for tool-calling integration.
 * Reads JSON-RPC messages from stdin, writes responses to stdout.
 */

import { ThreadsDriver } from '../automation/threads-driver.js';
import { ThreadsAICommentGenerator } from '../automation/ai-comment-generator.js';
import * as readline from 'readline';
import * as fs from 'fs/promises';

// ─── Tab Claim Guard ─────────────────────────────────────────────────────────
const CLAIMS_FILE = '/tmp/safari-tab-claims.json';
const CLAIM_TTL_MS = 60_000;
const MY_SERVICE = 'threads-comments';
interface TabClaim { agentId: string; service: string; port: number; urlPattern: string; windowIndex: number; tabIndex: number; tabUrl: string; heartbeat: number; }
async function readActiveClaims(): Promise<TabClaim[]> {
  try { const raw = await fs.readFile(CLAIMS_FILE, 'utf-8'); const all: TabClaim[] = JSON.parse(raw); const now = Date.now(); return all.filter(c => (now - c.heartbeat) < CLAIM_TTL_MS); } catch { return []; }
}
async function checkNavigationConflict(): Promise<{ conflict: false } | { conflict: true; blocker: TabClaim }> {
  const claims = await readActiveClaims();
  const myClaim = claims.find(c => c.service === MY_SERVICE);
  const myTab = myClaim ? `${myClaim.windowIndex}:${myClaim.tabIndex}` : null;
  const blocker = claims.find(c => c.service !== MY_SERVICE && myTab && `${c.windowIndex}:${c.tabIndex}` === myTab);
  return blocker ? { conflict: true, blocker } : { conflict: false };
}

const THREADS_BASE = 'http://localhost:3004';
const THREADS_AUTH = process.env.THREADS_AUTH_TOKEN || 'threads-local-dev-token';
const TIMEOUT_MS = 30_000;

async function api(method: 'GET' | 'POST', path: string, body?: Record<string, unknown>): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${THREADS_BASE}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${THREADS_AUTH}` },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    return JSON.parse(text);
  } catch (err) {
    const e = err as { name?: string; cause?: { code?: string } };
    if (e.name === 'AbortError') throw { code: 'SERVICE_DOWN', message: `${THREADS_BASE} did not respond within ${TIMEOUT_MS / 1000}s` };
    if ((e as { code?: string }).code === 'ECONNREFUSED' || e.cause?.code === 'ECONNREFUSED') throw { code: 'SERVICE_DOWN', message: `${THREADS_BASE} is not running` };
    throw err;
  } finally { clearTimeout(t); }
}

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
  { name: 'threads_discover_prospects', description: 'Discover and score ICP-matching Threads creators from keyword search. Returns ranked candidates with bio signals, follower count, and engagement rate. Set dryRun=true to skip navigation.', inputSchema: { type: 'object', properties: { keywords: { type: 'array', items: { type: 'string' }, description: 'Search keywords (default: buildinpublic, saasfounder, aiautomation)' }, maxCandidates: { type: 'number', description: 'Max profiles to enrich (default 15, max 20)', default: 15 }, minScore: { type: 'number', description: 'Min ICP score to include (default 30)', default: 30 }, dryRun: { type: 'boolean', description: 'Return empty immediately without navigating', default: false } } } },
  { name: 'threads_score_prospect', description: 'Enrich and score a single Threads creator against the ICP. Returns profile + icpScore (0-100) + icpSignals. Threads profiles include engagement_rate and avg_likes which boost the score.', inputSchema: { type: 'object', properties: { handle: { type: 'string', description: 'Threads handle without @' } }, required: ['handle'] } },
  { name: 'threads_queue_engagement', description: 'Queue a Threads creator for comment engagement (warm-up outreach). Finds their recent posts and schedules comments via safari_command_queue. No DM is sent — Threads has no DM. For direct outreach, use instagram_send_dm (same account).', inputSchema: { type: 'object', properties: { handle: { type: 'string', description: 'Threads handle without @' }, keyword: { type: 'string', description: 'Topic/keyword to use for finding their posts to engage on' }, dryRun: { type: 'boolean', description: 'Preview without queuing', default: false } }, required: ['handle'] } },
  { name: 'threads_is_ready', description: 'Check if Threads service (:3004) is reachable before attempting any action.', inputSchema: { type: 'object', properties: {} } },
  { name: 'threads_session_ensure', description: 'Ensure the threads-comments service has an active Safari tab claim. Call before any navigation to avoid hijacking the user\'s active browsing tab.', inputSchema: { type: 'object', properties: {} } },
  { name: 'threads_claim_status', description: 'Read current Safari tab claims. Shows which services own which tabs and any conflicts with threads-comments.', inputSchema: { type: 'object', properties: {} } },
  { name: 'threads_release_session', description: 'Release the threads-comments tab claim so the Safari tab is freed for other services or user browsing.', inputSchema: { type: 'object', properties: {} } },
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
      const _thNavConflict = await checkNavigationConflict();
      if (_thNavConflict.conflict) throw { code: 'TAB_CONFLICT', message: `Safari tab claimed by '${_thNavConflict.blocker.service}' (:${_thNavConflict.blocker.port}). Call threads_session_ensure first.`, blocker: _thNavConflict.blocker };
      const success = await d.navigateToPost(url);
      return { content: [{ type: 'text', text: JSON.stringify({ success, url }) }] };
    }
    case 'threads_post_comment': {
      const text = args.text as string;
      const postUrl = args.postUrl as string | undefined;
      const _thPostConflict = await checkNavigationConflict();
      if (_thPostConflict.conflict) throw { code: 'TAB_CONFLICT', message: `Safari tab claimed by '${_thPostConflict.blocker.service}' (:${_thPostConflict.blocker.port}). Cannot post comment while another service owns the tab.`, blocker: _thPostConflict.blocker };
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
    case 'threads_discover_prospects': {
      const result = await api('POST', '/api/threads/prospect/discover', {
        keywords: args.keywords, maxCandidates: args.maxCandidates,
        minScore: args.minScore, dryRun: args.dryRun,
      });
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
    case 'threads_score_prospect': {
      const result = await api('GET', `/api/threads/prospect/score/${encodeURIComponent(args.handle as string)}`);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
    case 'threads_queue_engagement': {
      if (args.dryRun) {
        return { content: [{ type: 'text', text: JSON.stringify({ dryRun: true, wouldEngage: { platform: 'threads', handle: args.handle, keyword: args.keyword } }) }] };
      }
      // Find posts from this creator then queue engagement via search
      const searchResult = await api('POST', '/api/threads/search', {
        query: args.keyword || (args.handle as string), max_results: 5,
      }) as { posts?: { url?: string; author?: string }[] };
      const posts = (searchResult.posts || []).filter(p => p.author === args.handle as string);
      const result = { handle: args.handle, postsFound: posts.length, note: 'Use threads_post_comment on each post URL to engage' };
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
    case 'threads_is_ready': {
      try {
        const r = await fetch(`${THREADS_BASE}/health`, { signal: AbortSignal.timeout(5000) });
        const data = await r.json() as Record<string, unknown>;
        return { content: [{ type: 'text', text: JSON.stringify({ ready: r.ok, status: data.status, url: THREADS_BASE }) }] };
      } catch {
        return { content: [{ type: 'text', text: JSON.stringify({ ready: false, url: THREADS_BASE, error: 'Service not reachable' }) }] };
      }
    }
    case 'threads_session_ensure':
      return { content: [{ type: 'text', text: JSON.stringify(await api('POST', '/api/session/ensure', {})) }] };

    case 'threads_claim_status': {
      const claims = await readActiveClaims();
      const myClaim = claims.find(c => c.service === MY_SERVICE);
      const otherClaims = claims.filter(c => c.service !== MY_SERVICE);
      const myTab = myClaim ? `${myClaim.windowIndex}:${myClaim.tabIndex}` : null;
      const conflicts = otherClaims.filter(c => myTab && `${c.windowIndex}:${c.tabIndex}` === myTab);
      return { content: [{ type: 'text', text: JSON.stringify({ my_claim: myClaim ?? null, other_services: otherClaims, conflicts, has_conflict: conflicts.length > 0 }) }] };
    }

    case 'threads_release_session':
      return { content: [{ type: 'text', text: JSON.stringify(await api('POST', '/api/session/clear', {})) }] };

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
