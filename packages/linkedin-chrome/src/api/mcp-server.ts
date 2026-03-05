/**
 * LinkedIn Chrome MCP Server — JSON-RPC 2.0 over stdio
 *
 * 25 tools: all 11 from Safari LinkedIn + 14 Chrome-only extras.
 * Uses Puppeteer/CDP (system Chrome) — no Safari dependency.
 * Persistent user data dir at ~/.linkedin-chrome-profile keeps session alive.
 */

import * as readline from 'readline';
import {
  extractProfile, searchPeople, sendConnectionRequest, sendMessage,
  listConversations, scoreProfile, getFeed, getPostComments, likePost,
  commentOnPost, getCompany, getMyProfile, getNotifications,
  acceptConnectionRequests, getNetworkLog, startNetworkCapture, takeScreenshot,
} from '../automation/linkedin.js';
import { navigateTo, getPage, waitFor, evalJS, clickAtXY, currentUrl } from '../automation/browser.js';
import { logInfo, logWarn, logError } from '../automation/logger.js';

const MOD = 'mcp-server';

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_NAME = 'linkedin-chrome-automation';
const SERVER_VERSION = '1.0.0';
const TOOL_TIMEOUT_MS = 45_000;

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

function withTimeout<T>(p: Promise<T>): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej({ code: 'TIMEOUT', message: `Tool timed out after ${TOOL_TIMEOUT_MS / 1000}s` }), TOOL_TIMEOUT_MS))]);
}

function formatError(err: unknown): string {
  if (typeof err === 'object' && err !== null && 'code' in err) return JSON.stringify(err);
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  if (lower.includes('429') || lower.includes('rate limit')) return JSON.stringify({ code: 'RATE_LIMITED', retryAfter: 60, platform: 'linkedin' });
  if (lower.includes('login') || lower.includes('authwall') || lower.includes('session')) return JSON.stringify({ code: 'SESSION_EXPIRED', platform: 'linkedin', action: 'call linkedin_navigate then log in' });
  if (lower.includes('not found') || lower.includes('404')) return JSON.stringify({ code: 'NOT_FOUND', platform: 'linkedin', message: msg });
  return JSON.stringify({ code: 'ERROR', message: msg, platform: 'linkedin' });
}

// ─── Tool Definitions ──────────────────────────────────────────────────────

const TOOLS = [
  // ── Shared with Safari version ──
  { name: 'linkedin_search_people', description: 'Search LinkedIn for people matching a query. Supports title, company, and location filters. Returns name, headline, location, profileUrl, connectionDegree.', inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Search query' }, title: { type: 'string' }, company: { type: 'string' }, location: { type: 'string' }, maxResults: { type: 'number', default: 10 } }, required: ['query'] } },
  { name: 'linkedin_get_profile', description: 'Extract full profile info from a LinkedIn profile URL — name, headline, location, about, experience, education, skills, connections.', inputSchema: { type: 'object', properties: { profileUrl: { type: 'string', description: 'LinkedIn profile URL' } }, required: ['profileUrl'] } },
  { name: 'linkedin_send_connection', description: 'Send a connection request to a LinkedIn profile. Set dryRun=true to preview without sending. Uses /preload/custom-invite/ flow when note is provided.', inputSchema: { type: 'object', properties: { profileUrl: { type: 'string' }, note: { type: 'string', description: 'Optional note (max 300 chars)' }, dryRun: { type: 'boolean', default: false } }, required: ['profileUrl'] } },
  { name: 'linkedin_send_message', description: 'Send a DM to a LinkedIn profile. Uses /messaging/compose/?profileUrn= for first-contact messages (more reliable than clicking Message button). Set dryRun=true to preview.', inputSchema: { type: 'object', properties: { profileUrl: { type: 'string' }, text: { type: 'string' }, dryRun: { type: 'boolean', default: false } }, required: ['profileUrl', 'text'] } },
  { name: 'linkedin_list_conversations', description: 'Get recent LinkedIn DM conversations. Returns name, lastMessage, timestamp, unread, conversationUrl.', inputSchema: { type: 'object', properties: { limit: { type: 'number', default: 20 } } }, outputSchema: { type: 'object', properties: { conversations: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, lastMessage: { type: 'string' }, unread: { type: 'boolean' } } } }, count: { type: 'number' } } } },
  { name: 'linkedin_score_profile', description: 'Score a LinkedIn profile against ICP criteria (0–100). Pure logic — no page navigation needed if profile already extracted.', inputSchema: { type: 'object', properties: { profileUrl: { type: 'string' }, icp: { type: 'object', properties: { targetTitle: { type: 'string' }, targetCompany: { type: 'string' }, targetIndustry: { type: 'string' }, targetLocation: { type: 'string' } } } }, required: ['profileUrl'] } },
  { name: 'linkedin_navigate', description: 'Navigate Chrome to any LinkedIn URL and wait for page load.', inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } },
  { name: 'linkedin_run_pipeline', description: 'Full prospecting pipeline: search → score → optionally connect. Set dryRun=true to run without sending connections.', inputSchema: { type: 'object', properties: { searchQuery: { type: 'string' }, niche: { type: 'string' }, maxProspects: { type: 'number', default: 10 }, minScore: { type: 'number', default: 50 }, autoConnect: { type: 'boolean', default: false }, connectNote: { type: 'string' }, dryRun: { type: 'boolean', default: true } }, required: ['searchQuery', 'niche'] } },
  { name: 'linkedin_get_status', description: 'Get current Chrome tab URL, login status, and server version.', inputSchema: { type: 'object', properties: {} } },
  { name: 'linkedin_is_ready', description: 'Preflight check — verifies Chrome is running with an active LinkedIn session. Call this before any other tool.', inputSchema: { type: 'object', properties: {} } },
  { name: 'linkedin_crm_get_contact', description: 'Look up a contact in CRMLite by LinkedIn username. Returns interaction history, tags, pipeline stage across all platforms.', inputSchema: { type: 'object', properties: { username: { type: 'string' } }, required: ['username'] } },

  // ── Chrome-only extras ──
  { name: 'linkedin_take_screenshot', description: 'Take a JPEG screenshot of the current Chrome tab. Returns base64-encoded image. Useful for debugging or visual verification.', inputSchema: { type: 'object', properties: {} } },
  { name: 'linkedin_evaluate_js', description: 'Execute JavaScript in the current LinkedIn Chrome tab and return the result. Useful for extracting data or triggering interactions directly.', inputSchema: { type: 'object', properties: { script: { type: 'string', description: 'JavaScript expression or IIFE to run in page context' } }, required: ['script'] } },
  { name: 'linkedin_get_network_requests', description: 'Return captured network requests from the current page. Pass filter to narrow by URL substring (e.g. "voyager/api" for LinkedIn internal API calls).', inputSchema: { type: 'object', properties: { filter: { type: 'string', description: 'Optional URL substring filter (e.g. "voyager/api")' }, startCapture: { type: 'boolean', description: 'Start capturing new requests first (resets log)', default: false } } } },
  { name: 'linkedin_like_post', description: 'Like a LinkedIn post by URL. Set dryRun=true to preview without liking.', inputSchema: { type: 'object', properties: { postUrl: { type: 'string' }, dryRun: { type: 'boolean', default: false } }, required: ['postUrl'] } },
  { name: 'linkedin_comment_post', description: 'Post a comment on a LinkedIn post by URL. Set dryRun=true to preview without posting.', inputSchema: { type: 'object', properties: { postUrl: { type: 'string' }, text: { type: 'string' }, dryRun: { type: 'boolean', default: false } }, required: ['postUrl', 'text'] } },
  { name: 'linkedin_get_post_comments', description: 'Get comments from a LinkedIn post. Returns author, text, likes, timestamp, authorUrl.', inputSchema: { type: 'object', properties: { postUrl: { type: 'string' }, limit: { type: 'number', default: 20 } }, required: ['postUrl'] } },
  { name: 'linkedin_get_feed', description: 'Get recent posts from the LinkedIn home feed. Returns author, text, likes, comments, postUrl.', inputSchema: { type: 'object', properties: { limit: { type: 'number', default: 10 } } } },
  { name: 'linkedin_get_company', description: 'Get company profile info from a LinkedIn company URL — name, tagline, about, industry, size, followers.', inputSchema: { type: 'object', properties: { companyUrl: { type: 'string' } }, required: ['companyUrl'] } },
  { name: 'linkedin_get_my_profile', description: 'Get your own LinkedIn profile by navigating to /me/ and extracting data.', inputSchema: { type: 'object', properties: {} } },
  { name: 'linkedin_debug_click', description: 'Click at specific x,y viewport coordinates in Chrome. Useful for hitting elements that normal CSS selectors cannot reach.', inputSchema: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'] } },
  { name: 'linkedin_wait_for', description: 'Wait for a CSS selector to appear on the current page (up to timeoutMs ms). Use this instead of fixed delays to handle race conditions.', inputSchema: { type: 'object', properties: { selector: { type: 'string' }, timeoutMs: { type: 'number', default: 10000 } }, required: ['selector'] } },
  { name: 'linkedin_accept_connections', description: 'Accept pending connection requests from the invitation manager page. Set maxAccept to limit how many to accept.', inputSchema: { type: 'object', properties: { maxAccept: { type: 'number', default: 5 } } } },
  { name: 'linkedin_get_notifications', description: 'Get recent LinkedIn notifications — new connections, post reactions, comments, mentions.', inputSchema: { type: 'object', properties: { limit: { type: 'number', default: 10 } } } },
];

// ─── Tool Execution ────────────────────────────────────────────────────────

async function executeTool(name: string, args: Record<string, unknown>): Promise<{ content: Array<{ type: string; text: string }> }> {
  let result: unknown;

  switch (name) {
    case 'linkedin_search_people': {
      const results = await searchPeople(args.query as string, { title: args.title as string, company: args.company as string, location: args.location as string });
      result = { profiles: results.slice(0, (args.maxResults as number) || 10), count: results.length };
      break;
    }
    case 'linkedin_get_profile':
      result = await extractProfile(args.profileUrl as string);
      break;

    case 'linkedin_send_connection':
      if (args.dryRun) { result = { dryRun: true, wouldSend: { profileUrl: args.profileUrl, note: args.note } }; break; }
      result = await sendConnectionRequest({ profileUrl: args.profileUrl as string, note: args.note as string | undefined });
      break;

    case 'linkedin_send_message':
      if (args.dryRun) { result = { dryRun: true, wouldSend: { profileUrl: args.profileUrl, text: args.text } }; break; }
      result = await sendMessage(args.profileUrl as string, args.text as string);
      break;

    case 'linkedin_list_conversations':
      result = await listConversations((args.limit as number) || 20);
      break;

    case 'linkedin_score_profile': {
      const profile = await extractProfile(args.profileUrl as string);
      const icp = (args.icp as Record<string, string>) || {};
      result = { score: scoreProfile(profile, icp), profile };
      break;
    }

    case 'linkedin_navigate':
      await navigateTo(args.url as string, 'domcontentloaded');
      result = { success: true, url: args.url };
      break;

    case 'linkedin_run_pipeline': {
      const query = args.searchQuery as string;
      const minScore = (args.minScore as number) || 50;
      const maxProspects = (args.maxProspects as number) || 10;
      const dryRun = !!(args.dryRun ?? true);
      const profiles = await searchPeople(query);
      const icp = args.niche ? { targetTitle: args.niche as string } : {};
      const scored = profiles
        .map(p => ({ ...p, score: scoreProfile(p, icp) }))
        .filter(p => p.score.totalScore >= minScore)
        .slice(0, maxProspects);
      const connects: unknown[] = [];
      if (args.autoConnect && !dryRun) {
        for (const p of scored) {
          const r = await sendConnectionRequest({ profileUrl: p.profileUrl, note: args.connectNote as string });
          connects.push({ profileUrl: p.profileUrl, result: r });
          await sleep(2_000);
        }
      }
      result = { searched: profiles.length, qualified: scored.length, minScore, dryRun, prospects: scored, connects };
      break;
    }

    case 'linkedin_get_status': {
      const url = await currentUrl();
      result = { currentUrl: url, onLinkedIn: url.includes('linkedin.com'), serverVersion: SERVER_VERSION, engine: 'puppeteer/cdp' };
      break;
    }

    case 'linkedin_is_ready': {
      try {
        const url = await currentUrl();
        const onLinkedIn = url.includes('linkedin.com');
        if (!onLinkedIn) await navigateTo('https://www.linkedin.com/', 'domcontentloaded');
        const finalUrl = await currentUrl();
        const loggedIn = !finalUrl.includes('authwall') && !finalUrl.includes('login');
        result = { ready: loggedIn, engine: 'puppeteer/cdp', currentUrl: finalUrl, method: 'direct', automation: 'chrome-devtools-protocol' };
      } catch (e) {
        result = { ready: false, error: (e as Error).message, engine: 'puppeteer/cdp' };
      }
      break;
    }

    case 'linkedin_crm_get_contact': {
      const username = args.username as string;
      const url = `https://crmlite-h3k1s46jj-isaiahduprees-projects.vercel.app/api/contacts/by-username/linkedin/${encodeURIComponent(username)}`;
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
        if (res.status === 404) { result = { found: false, username }; break; }
        if (!res.ok) throw new Error(`CRMLite ${res.status}`);
        result = await res.json();
      } catch (e) {
        result = { found: false, username, error: (e as Error).message };
      }
      break;
    }

    // ── Chrome-only ──
    case 'linkedin_take_screenshot':
      result = { screenshot: await takeScreenshot(), format: 'jpeg/base64' };
      break;

    case 'linkedin_evaluate_js':
      result = { result: await evalJS(args.script as string) };
      break;

    case 'linkedin_get_network_requests':
      if (args.startCapture) await startNetworkCapture();
      result = { requests: getNetworkLog(args.filter as string | undefined) };
      break;

    case 'linkedin_like_post':
      if (args.dryRun) { result = { dryRun: true, wouldLike: args.postUrl }; break; }
      result = await likePost(args.postUrl as string);
      break;

    case 'linkedin_comment_post':
      if (args.dryRun) { result = { dryRun: true, wouldComment: { postUrl: args.postUrl, text: args.text } }; break; }
      result = await commentOnPost(args.postUrl as string, args.text as string);
      break;

    case 'linkedin_get_post_comments':
      result = await getPostComments(args.postUrl as string, (args.limit as number) || 20);
      break;

    case 'linkedin_get_feed':
      result = await getFeed((args.limit as number) || 10);
      break;

    case 'linkedin_get_company':
      result = await getCompany(args.companyUrl as string);
      break;

    case 'linkedin_get_my_profile':
      result = await getMyProfile();
      break;

    case 'linkedin_debug_click':
      await clickAtXY(args.x as number, args.y as number);
      result = { clicked: true, x: args.x, y: args.y };
      break;

    case 'linkedin_wait_for':
      await waitFor(args.selector as string, (args.timeoutMs as number) || 10_000);
      result = { found: true, selector: args.selector };
      break;

    case 'linkedin_accept_connections':
      result = await acceptConnectionRequests((args.maxAccept as number) || 5);
      break;

    case 'linkedin_get_notifications':
      result = await getNotifications((args.limit as number) || 10);
      break;

    default:
      throw { code: -32601, message: `Unknown tool: ${name}` };
  }

  return { content: [{ type: 'text', text: JSON.stringify(result) }] };
}

// ─── JSON-RPC 2.0 handler ──────────────────────────────────────────────────

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
      const t0 = Date.now();
      logInfo(MOD, `tool call → ${toolName}`, { args: JSON.stringify(toolArgs).slice(0, 120) });
      try {
        const toolResult = await withTimeout(executeTool(toolName, toolArgs));
        logInfo(MOD, `tool call ✓ ${toolName}`, { ms: Date.now() - t0 });
        return { jsonrpc: '2.0', id, result: toolResult };
      } catch (err) {
        logError(MOD, `tool call ✗ ${toolName}`, { ms: Date.now() - t0, error: (err as Error).message ?? String(err) });
        const e = err as { code?: number | string; message?: string };
        if (typeof e.code === 'number') return { jsonrpc: '2.0', id, error: { code: e.code, message: e.message || 'Tool error' } };
        if (e.code) return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(err) }], isError: true } };
        return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: formatError(err) }], isError: true } };
      }
    }
    default:
      return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${req.method}` } };
  }
}

// ─── stdio transport ───────────────────────────────────────────────────────

export function startMCPServer(): void {
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let request: JsonRpcRequest;
    try { request = JSON.parse(trimmed); } catch {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) + '\n');
      return;
    }
    const response = await handleRequest(request);
    if (response) process.stdout.write(JSON.stringify(response) + '\n');
  });
  rl.on('close', () => { logInfo(MOD, 'stdin closed — exiting'); process.exit(0); });
  logInfo(MOD, `${SERVER_NAME} v${SERVER_VERSION} started`, { engine: 'puppeteer/cdp', tools: TOOLS.length, timeout: `${TOOL_TIMEOUT_MS / 1000}s`, logLevel: process.env['LI_LOG_LEVEL'] ?? 'INFO' });
}

if (process.argv[1]?.includes('mcp-server')) startMCPServer();
