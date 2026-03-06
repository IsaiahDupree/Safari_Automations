/**
 * Instagram Comments MCP Server — JSON-RPC 2.0 over stdio
 * Comments service: http://localhost:3005
 * Start: npx tsx packages/instagram-comments/src/api/mcp-server.ts
 */

import * as readline from 'readline';
import * as fs from 'fs/promises';

// ─── Tab Claim Guard ─────────────────────────────────────────────────────────
// Mirrors /tmp/safari-tab-claims.json so the MCP layer can detect cross-service
// conflicts BEFORE issuing a navigation call that would hijack another tab.

const CLAIMS_FILE = '/tmp/safari-tab-claims.json';
const CLAIM_TTL_MS = 60_000;
const MY_SERVICE = 'instagram-comments';

interface TabClaim { agentId: string; service: string; port: number; urlPattern: string; windowIndex: number; tabIndex: number; tabUrl: string; heartbeat: number; }

async function readActiveClaims(): Promise<TabClaim[]> {
  try {
    const raw = await fs.readFile(CLAIMS_FILE, 'utf-8');
    const all: TabClaim[] = JSON.parse(raw);
    const now = Date.now();
    return all.filter(c => (now - c.heartbeat) < CLAIM_TTL_MS);
  } catch {
    return [];
  }
}

async function checkNavigationConflict(): Promise<{ conflict: false } | { conflict: true; blocker: TabClaim }> {
  const claims = await readActiveClaims();
  const myClaim = claims.find(c => c.service === MY_SERVICE);
  const myTab = myClaim ? `${myClaim.windowIndex}:${myClaim.tabIndex}` : null;
  const blocker = claims.find(c => c.service !== MY_SERVICE && myTab && `${c.windowIndex}:${c.tabIndex}` === myTab);
  return blocker ? { conflict: true, blocker } : { conflict: false };
}

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_NAME = 'instagram-comments-mcp';
const SERVER_VERSION = '1.0.0';
const COMMENTS_BASE = process.env.INSTAGRAM_COMMENTS_URL || 'http://localhost:3005';
const API_TOKEN = process.env.INSTAGRAM_API_TOKEN || 'test-token';
const TIMEOUT_MS = 30_000;

// ─── Error Helpers ────────────────────────────────────────────────────────────

function structuredError(status: number, body: string, platform: string): never {
  if (status === 429) throw { code: 'RATE_LIMITED', message: 'Rate limit hit — wait before retrying', retryAfter: 60, platform };
  if (status === 401 || status === 403) throw { code: 'SESSION_EXPIRED', message: 'Safari session expired or API token invalid', action: 'check INSTAGRAM_API_TOKEN env var', platform };
  if (status === 404) throw { code: 'NOT_FOUND', message: body.slice(0, 100), platform };
  if (status === 503) throw { code: 'SERVICE_DOWN', message: `Service unavailable: ${body.slice(0, 150)}`, platform };
  throw { code: 'API_ERROR', message: `HTTP ${status}: ${body.slice(0, 200)}`, platform };
}

function formatMcpError(e: unknown, platform = 'instagram'): string {
  const msg = e instanceof Error ? e.message : String(e);
  const lowerMsg = msg.toLowerCase();

  if (lowerMsg.includes('429') || lowerMsg.includes('rate limit')) {
    return JSON.stringify({ code: 'RATE_LIMITED', retryAfter: 60, platform, action: 'wait retryAfter seconds then retry' });
  }
  if (lowerMsg.includes('401') || lowerMsg.includes('403') || lowerMsg.includes('unauthorized')) {
    return JSON.stringify({ code: 'SESSION_EXPIRED', platform, action: 'check INSTAGRAM_API_TOKEN env var' });
  }
  if (lowerMsg.includes('404') || lowerMsg.includes('not found')) {
    return JSON.stringify({ code: 'NOT_FOUND', platform });
  }
  if (lowerMsg.includes('503') || lowerMsg.includes('service unavailable') || lowerMsg.includes('safari')) {
    return JSON.stringify({ code: 'SAFARI_UNAVAILABLE', platform, action: 'ensure Safari is open with Instagram loaded' });
  }
  if (typeof e === 'object' && e !== null && 'code' in e) {
    return JSON.stringify(e);
  }
  return JSON.stringify({ code: 'ERROR', message: msg, platform });
}

// ─── HTTP Helper ──────────────────────────────────────────────────────────────

async function api(
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  body?: Record<string, unknown>,
  queryParams?: Record<string, string | number>
): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    let url = `${COMMENTS_BASE}${path}`;
    if (queryParams && Object.keys(queryParams).length > 0) {
      const qs = new URLSearchParams(
        Object.fromEntries(Object.entries(queryParams).map(([k, v]) => [k, String(v)]))
      ).toString();
      url += `?${qs}`;
    }
    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_TOKEN}`,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (!res.ok) structuredError(res.status, text, 'instagram');
    return JSON.parse(text);
  } catch (err) {
    const e = err as { name?: string; cause?: { code?: string }; code?: string };
    if (e.name === 'AbortError') throw { code: 'SERVICE_DOWN', message: `${COMMENTS_BASE} did not respond within ${TIMEOUT_MS / 1000}s — is the instagram-comments service running?`, base: COMMENTS_BASE };
    if (e.code === 'ECONNREFUSED' || e.cause?.code === 'ECONNREFUSED') throw { code: 'SERVICE_DOWN', message: `${COMMENTS_BASE} is not running — start it with: npm run --prefix packages/instagram-comments start:server`, base: COMMENTS_BASE };
    throw err;
  } finally { clearTimeout(t); }
}

// ─── Tool Definitions ─────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'igc_health',
    description: 'Check instagram-comments service (:3005) health and uptime. Call this first each session to confirm the service is running.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'igc_navigate',
    description: 'Navigate Safari to an Instagram URL or profile. Use before reading post metrics or profile posts.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Full Instagram URL (e.g. https://www.instagram.com/reel/ABC123/)' },
        username: { type: 'string', description: 'Profile username (alternative to url — navigates to https://www.instagram.com/{username}/)' },
      },
    },
  },
  {
    name: 'igc_get_status',
    description: 'Get instagram-comments service status, current Safari tab URL, and rate limit counters.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'igc_get_profile',
    description: 'Get profile data (handle, follower_count, following_count, bio) from the currently loaded Instagram page. Navigate to a profile first with igc_navigate.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'igc_get_profile_posts',
    description: 'List posts and reels from the currently loaded Instagram profile page. Navigate to a profile first with igc_navigate.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max posts to return (default 12)', default: 12 },
      },
    },
  },
  {
    name: 'igc_get_post_details',
    description: 'Get post details (caption, username, likes, timestamp) from the currently loaded Instagram post page.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'igc_get_post_metrics',
    description: 'Get engagement metrics (likes, comments, views, saves) from the currently loaded Instagram post page. Navigate to a post first with igc_navigate.',
    inputSchema: { type: 'object', properties: {} },
    outputSchema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        url: { type: 'string' },
        likes: { type: 'number' },
        comments: { type: 'number' },
        views: { type: 'number' },
        saves: { type: 'number' },
      },
    },
  },
  {
    name: 'igc_get_comments',
    description: 'Get comments from the currently loaded Instagram post, or navigate to postUrl first if provided.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max comments (default 50)', default: 50 },
        postUrl: { type: 'string', description: 'Optional: navigate to this post URL before reading comments' },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        comments: { type: 'array' },
        count: { type: 'number' },
      },
    },
  },
  {
    name: 'igc_post_comment',
    description: 'Post a comment on an Instagram post. Navigates to postUrl if provided, otherwise comments on the currently loaded post. Set dryRun=true to preview without posting.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Comment text (max 10,000 chars)' },
        postUrl: { type: 'string', description: 'Optional: navigate to this URL first' },
        dryRun: { type: 'boolean', description: 'Return preview without actually posting', default: false },
      },
      required: ['text'],
    },
  },
  {
    name: 'igc_ai_generate_message',
    description: 'Generate an AI-written message or comment for Instagram using context or niche keywords.',
    inputSchema: {
      type: 'object',
      properties: {
        context: { type: 'string', description: 'Post text or context to generate a reply for' },
        niche: { type: 'string', description: 'Content niche (e.g. "ai_automation", "saas_growth")' },
        recipient_username: { type: 'string', description: 'Target username (for personalization)' },
      },
    },
  },
  {
    name: 'igc_ai_score',
    description: 'Score content quality for Instagram engagement (0–100). Useful for ranking auto-generated comments before posting.',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'Content text to score' },
        username: { type: 'string', description: 'Author username for context' },
        niche: { type: 'string', description: 'Content niche for relevance scoring' },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        score: { type: 'number', description: '0–100 quality score' },
        reasoning: { type: 'string' },
        signals: { type: 'array', items: { type: 'string' } },
        model_used: { type: 'string' },
      },
    },
  },
  {
    name: 'igc_analyze_post',
    description: 'Analyze the currently loaded Instagram post (sentiment, topics, tone) and generate a suggested comment.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'igc_get_rate_limits',
    description: 'Get current comment rate limits (daily/hourly sent vs limit, reset time).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'igc_session_ensure',
    description: 'Ensure the instagram-comments service has an active Safari tab claim. Call this before any navigation tool to avoid hijacking the user\'s active browsing tab. Returns the current session window/tab info.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'igc_claim_status',
    description: 'Read the current tab claims from /tmp/safari-tab-claims.json. Shows which services have claimed which Safari tabs and whether any conflicts exist.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'igc_release_session',
    description: 'Release the instagram-comments tab claim so the Safari tab is freed for user browsing or other services.',
    inputSchema: { type: 'object', properties: {} },
  },
];

// ─── Tool Execution ───────────────────────────────────────────────────────────

async function executeTool(name: string, args: Record<string, unknown>): Promise<{ content: Array<{ type: string; text: string }> }> {
  let result: unknown;

  switch (name) {
    case 'igc_health': {
      try {
        const res = await fetch(`${COMMENTS_BASE}/health`, { signal: AbortSignal.timeout(5000) });
        result = res.ok ? await res.json() : { status: 'error', httpStatus: res.status };
      } catch {
        result = { status: 'down', message: `${COMMENTS_BASE} is not reachable — run: npm run --prefix packages/instagram-comments start:server` };
      }
      break;
    }

    case 'igc_navigate': {
      const url = args.url as string | undefined;
      const username = args.username as string | undefined;
      if (!url && !username) throw { code: -32602, message: 'url or username is required' };
      const navConflict = await checkNavigationConflict();
      if (navConflict.conflict) {
        throw { code: 'TAB_CONFLICT', message: `Safari tab is claimed by '${navConflict.blocker.service}' (port ${navConflict.blocker.port}). Call igc_session_ensure first to get a dedicated tab, or wait for the other service to release.`, blocker: navConflict.blocker };
      }
      result = await api('POST', '/api/instagram/navigate', {
        ...(url ? { url } : {}),
        ...(username ? { username } : {}),
      });
      break;
    }

    case 'igc_get_status':
      result = await api('GET', '/api/instagram/status');
      break;

    case 'igc_get_profile':
      result = await api('GET', '/api/instagram/profile');
      break;

    case 'igc_get_profile_posts': {
      const limit = (args.limit as number) ?? 12;
      result = await api('GET', '/api/instagram/profile/posts', undefined, { limit });
      break;
    }

    case 'igc_get_post_details':
      result = await api('GET', '/api/instagram/post');
      break;

    case 'igc_get_post_metrics':
      result = await api('GET', '/api/instagram/post/metrics');
      break;

    case 'igc_get_comments': {
      const limit = (args.limit as number) ?? 50;
      const postUrl = args.postUrl as string | undefined;
      const params: Record<string, string | number> = { limit };
      if (postUrl) params.postUrl = postUrl;
      result = await api('GET', '/api/instagram/comments', undefined, params);
      break;
    }

    case 'igc_post_comment': {
      const text = args.text as string;
      const postUrl = args.postUrl as string | undefined;
      if (args.dryRun) {
        result = { dryRun: true, wouldPost: { platform: 'instagram', text, postUrl: postUrl ?? '(current page)' } };
        break;
      }
      const commentConflict = await checkNavigationConflict();
      if (commentConflict.conflict) {
        throw { code: 'TAB_CONFLICT', message: `Safari tab is claimed by '${commentConflict.blocker.service}' (port ${commentConflict.blocker.port}). Cannot post comment while another service owns the tab.`, blocker: commentConflict.blocker };
      }
      result = await api('POST', '/api/instagram/comments/post', {
        text,
        ...(postUrl ? { postUrl } : {}),
      });
      break;
    }

    case 'igc_ai_generate_message': {
      const context = args.context as string | undefined;
      const niche = args.niche as string | undefined;
      const recipient_username = args.recipient_username as string | undefined;
      if (!context && !niche) throw { code: -32602, message: 'context or niche is required' };
      result = await api('POST', '/api/instagram/ai-message', {
        ...(context ? { context } : {}),
        ...(niche ? { niche } : {}),
        ...(recipient_username ? { recipient_username } : {}),
      });
      break;
    }

    case 'igc_ai_score': {
      const content = args.content as string | undefined;
      const username = args.username as string | undefined;
      const niche = args.niche as string | undefined;
      if (!content && !username) throw { code: -32602, message: 'content or username is required' };
      result = await api('POST', '/api/instagram/ai-score', {
        ...(content ? { content } : {}),
        ...(username ? { username } : {}),
        ...(niche ? { niche } : {}),
      });
      break;
    }

    case 'igc_analyze_post':
      result = await api('POST', '/api/instagram/analyze', {});
      break;

    case 'igc_get_rate_limits':
      result = await api('GET', '/api/instagram/comments/rate-limits');
      break;

    case 'igc_session_ensure':
      result = await api('POST', '/api/session/ensure', {});
      break;

    case 'igc_claim_status': {
      const claims = await readActiveClaims();
      const myClaim = claims.find(c => c.service === MY_SERVICE);
      const otherClaims = claims.filter(c => c.service !== MY_SERVICE);
      const myTab = myClaim ? `${myClaim.windowIndex}:${myClaim.tabIndex}` : null;
      const conflicts = otherClaims.filter(c => myTab && `${c.windowIndex}:${c.tabIndex}` === myTab);
      result = { my_claim: myClaim ?? null, other_services: otherClaims, conflicts, has_conflict: conflicts.length > 0 };
      break;
    }

    case 'igc_release_session':
      result = await api('POST', '/api/session/clear', {});
      break;

    default:
      throw { code: -32601, message: `Unknown tool: ${name}` };
  }

  return { content: [{ type: 'text', text: JSON.stringify(result) }] };
}

// ─── JSON-RPC 2.0 Handler ─────────────────────────────────────────────────────

interface JsonRpcRequest { jsonrpc: '2.0'; id?: number | string | null; method: string; params?: Record<string, unknown>; }
interface JsonRpcResponse { jsonrpc: '2.0'; id: number | string | null; result?: unknown; error?: { code: number; message: string }; }

async function handleRequest(req: JsonRpcRequest): Promise<JsonRpcResponse | null> {
  const id = req.id ?? null;
  if (req.id === undefined && req.method !== 'initialize') return null;

  switch (req.method) {
    case 'initialize':
      return { jsonrpc: '2.0', id, result: { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: { name: SERVER_NAME, version: SERVER_VERSION } } };

    case 'notifications/initialized':
      return null;

    case 'tools/list':
      return { jsonrpc: '2.0', id, result: { tools: TOOLS } };

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

    default:
      return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${req.method}` } };
  }
}

// ─── Stdio Loop ───────────────────────────────────────────────────────────────

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
  process.stderr.write(`[MCP] ${SERVER_NAME} v${SERVER_VERSION} started — ${COMMENTS_BASE}\n`);
}

if (process.argv[1]?.includes('mcp-server')) startMCPServer();
