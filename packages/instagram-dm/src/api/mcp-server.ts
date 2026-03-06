/**
 * Instagram MCP Server — JSON-RPC 2.0 over stdio
 * DM service: http://localhost:3100
 * Comments service: http://localhost:3005
 * Start: npx tsx packages/instagram-dm/src/api/mcp-server.ts
 */

import * as readline from 'readline';
import * as fs from 'fs/promises';

// ─── Tab Claim Guard ─────────────────────────────────────────────────────────
const CLAIMS_FILE = '/tmp/safari-tab-claims.json';
const CLAIM_TTL_MS = 60_000;
const MY_SERVICE = 'instagram-dm';
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
  { name: 'instagram_discover_prospects', description: 'Discover and score ICP-matching Instagram accounts from hashtag search or recent followers. Returns ranked candidates with bio, follower count, and ICP score. Never auto-sends DMs — only surfaces candidates for human review. Uses targetCount + maxRounds to keep searching until enough candidates are found.', inputSchema: { type: 'object', properties: { keywords: { type: 'array', items: { type: 'string' }, description: 'Hashtags/keywords to search (e.g. ["buildinpublic","saasfounder"])', default: ['buildinpublic', 'saasfounder', 'aiautomation'] }, sources: { type: 'array', items: { type: 'string' }, description: 'Discovery sources: "hashtag" and/or "followers"', default: ['hashtag', 'followers'] }, targetCount: { type: 'number', description: 'Target number of qualifying candidates to collect. Runs multiple rounds until met (max 20).', default: 10 }, maxCandidates: { type: 'number', description: 'Alias for targetCount (legacy, use targetCount)', default: 15 }, maxRounds: { type: 'number', description: 'Max keyword expansion rounds before stopping (default 3)', default: 3 }, niches: { type: 'object', description: 'Per-niche quotas e.g. {"buildinpublic":5,"saasfounder":3}. Stops collecting a niche when quota is met.' }, minScore: { type: 'number', description: 'Min ICP score to include (0-100)', default: 30 }, dryRun: { type: 'boolean', description: 'Return empty results without navigating Safari', default: false } } } },
  { name: 'instagram_score_prospect', description: 'Enrich an Instagram profile and score it against the ICP (software founders, SaaS, AI automation). Returns profile data + icpScore 0-100 + matched signals.', inputSchema: { type: 'object', properties: { username: { type: 'string', description: 'Instagram username without @' } }, required: ['username'] } },
  { name: 'instagram_queue_prospect', description: 'Add a scored prospect to the outreach queue (suggested_actions table) for later DM. Does NOT send a DM — only queues for human review.', inputSchema: { type: 'object', properties: { username: { type: 'string', description: 'Instagram username without @' }, message: { type: 'string', description: 'Draft DM message to queue' }, priority: { type: 'number', description: 'Priority 1-10 (default 5)', default: 5 } }, required: ['username', 'message'] } },
  { name: 'instagram_discover_from_top_posts', description: 'Full 3-step pipeline: (1) navigate to hashtag pages and rank posts by engagement, (2) rank the creators of those posts by their total engagement, (3) scrape followers of top creators and enrich as ICP prospects. Returns topPosts, topCreators, and enriched candidates in one call. Use this when you want prospects sourced from followers of proven high-engagement creators.', inputSchema: { type: 'object', properties: { keywords: { type: 'array', items: { type: 'string' }, description: 'Hashtags to find top posts from (e.g. ["buildinpublic","saasfounder"]). Uses defaults if omitted.' }, maxPostsPerKeyword: { type: 'number', description: 'Posts to visit per keyword to find creators (default 6)', default: 6 }, maxTopCreators: { type: 'number', description: 'How many top-ranked creators to scrape followers from (default 5)', default: 5 }, minScore: { type: 'number', description: 'Min ICP score to store', default: 20 }, dryRun: { type: 'boolean', default: false } } } },
  { name: 'instagram_scale_discover', description: 'Accumulate prospects in the DB across multiple calls. Each call runs one discovery batch and persists new candidates to suggested_actions (status=suggested). Call repeatedly until done=true or looping=true. When looping=true, add topAccounts or topPostKeywords to break out. topPostKeywords automatically finds top post creators then scrapes their followers.', inputSchema: { type: 'object', properties: { targetTotal: { type: 'number', description: 'Total prospect count to reach across all calls', default: 500 }, keywords: { type: 'array', items: { type: 'string' }, description: 'Search keywords (uses defaults if omitted)' }, topAccounts: { type: 'array', items: { type: 'string' }, description: 'Instagram accounts whose followers to scrape. e.g. ["levelsio", "marc_louvion"]' }, topPostKeywords: { type: 'array', items: { type: 'string' }, description: 'Keywords to find top posts from, then scrape followers of those post creators. Highest quality source.' }, minScore: { type: 'number', description: 'Min ICP score to store', default: 30 }, maxRounds: { type: 'number', description: 'Discovery rounds per call (default 2)', default: 2 }, dryRun: { type: 'boolean', default: false } } } },
  { name: 'instagram_dm_top_n', description: 'Promote the top N highest-ICP-score prospects from suggested_actions to the outreach queue (status=pending). Applies a message template. Call AFTER scale_discover has accumulated enough prospects. Always use dryRun=true first to preview.', inputSchema: { type: 'object', properties: { n: { type: 'number', description: 'Number of prospects to promote to DM queue', default: 100 }, messageTemplate: { type: 'string', description: 'Message template, use {username} as placeholder', default: 'Hey {username}! Your work caught my eye — would love to connect about AI automation.' }, dryRun: { type: 'boolean', description: 'Preview without queueing', default: true } }, required: [] } },
  { name: 'instagram_send_queued', description: 'Send pending prospect DMs from the outreach queue. Navigates to each profile, clicks Message, sends the queued message. Use batchSize≤5 and sendDelay≥45000ms (45s) to stay safe. Always dryRun:true first to preview. Returns {sent, failed, remaining, rateLimits}.', inputSchema: { type: 'object', properties: { batchSize: { type: 'number', description: 'Max DMs to send per call (max 10, default 5)', default: 5 }, sendDelay: { type: 'number', description: 'Ms to wait between DMs (default 45000 = 45s)', default: 45000 }, dryRun: { type: 'boolean', description: 'Preview queue without sending', default: true } } } },
  { name: 'instagram_claim_status', description: 'Read current Safari tab claims from /tmp/safari-tab-claims.json. Shows which services own which tabs and any conflicts with instagram-dm\'s tab.', inputSchema: { type: 'object', properties: {} } },
];

async function executeTool(name: string, args: Record<string, unknown>): Promise<{ content: Array<{ type: string; text: string }> }> {
  let result: unknown;
  switch (name) {
    case 'instagram_send_dm': {
      if (args.dryRun) { result = { dryRun: true, wouldSend: { platform: 'instagram', to: args.username, text: args.text } }; break; }
      const _igDmConflict = await checkNavigationConflict(); if (_igDmConflict.conflict) throw { code: 'TAB_CONFLICT', message: `Safari tab claimed by '${_igDmConflict.blocker.service}' (:${_igDmConflict.blocker.port}). Call instagram_session_ensure first.`, blocker: _igDmConflict.blocker };
      result = await api(DM_BASE, 'POST', '/api/messages/send-to', { username: args.username, text: args.text }); break;
    }
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
    case 'instagram_post_comment': {
      if (args.dryRun) { result = { dryRun: true, wouldPost: { platform: 'instagram', postUrl: args.postUrl, text: args.text } }; break; }
      const _igPostConflict = await checkNavigationConflict(); if (_igPostConflict.conflict) throw { code: 'TAB_CONFLICT', message: `Safari tab claimed by '${_igPostConflict.blocker.service}' (:${_igPostConflict.blocker.port}). Cannot post comment while another service owns the tab.`, blocker: _igPostConflict.blocker };
      result = await api(COMMENTS_BASE, 'POST', '/api/instagram/comments/post', { postUrl: args.postUrl, text: args.text }); break;
    }
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
    case 'instagram_discover_prospects':
      result = await api(DM_BASE, 'POST', '/api/prospect/discover', {
        keywords: args.keywords,
        sources: args.sources,
        targetCount: args.targetCount ?? args.maxCandidates,
        maxRounds: args.maxRounds,
        niches: args.niches,
        minScore: args.minScore,
        dryRun: args.dryRun,
      });
      break;
    case 'instagram_score_prospect':
      result = await api(DM_BASE, 'GET', `/api/prospect/score/${encodeURIComponent(args.username as string)}`);
      break;
    case 'instagram_queue_prospect': {
      const u = args.username as string;
      const msg = args.message as string;
      result = await api(DM_BASE, 'POST', '/api/outreach/queue', {
        contact_id: u,
        message: msg,
        personalized_message: msg,
        template_id: 'prospect_discovery',
        lane: 'cold_outreach',
        phase: 'awareness',
        priority: (args.priority as number) ?? 5,
        status: 'pending',
      });
      break;
    }
    case 'instagram_discover_from_top_posts':
      result = await api(DM_BASE, 'POST', '/api/prospect/discover-from-top-posts', {
        keywords: args.keywords,
        maxPostsPerKeyword: args.maxPostsPerKeyword,
        maxTopCreators: args.maxTopCreators,
        minScore: args.minScore,
        dryRun: args.dryRun,
      });
      break;
    case 'instagram_scale_discover':
      result = await api(DM_BASE, 'POST', '/api/prospect/scale-discover', {
        targetTotal: args.targetTotal,
        keywords: args.keywords,
        topAccounts: args.topAccounts,
        topPostKeywords: args.topPostKeywords,
        minScore: args.minScore,
        maxRounds: args.maxRounds,
        dryRun: args.dryRun,
      });
      break;
    case 'instagram_dm_top_n':
      result = await api(DM_BASE, 'POST', '/api/prospect/dm-top-n', {
        n: args.n,
        messageTemplate: args.messageTemplate,
        dryRun: args.dryRun,
      });
      break;
    case 'instagram_send_queued':
      result = await api(DM_BASE, 'POST', '/api/prospect/send-queued', {
        batchSize: args.batchSize,
        sendDelay: args.sendDelay,
        dryRun: args.dryRun,
      });
      break;
    case 'instagram_claim_status': {
      const claims = await readActiveClaims();
      const myClaim = claims.find(c => c.service === MY_SERVICE);
      const otherClaims = claims.filter(c => c.service !== MY_SERVICE);
      const myTab = myClaim ? `${myClaim.windowIndex}:${myClaim.tabIndex}` : null;
      const conflicts = otherClaims.filter(c => myTab && `${c.windowIndex}:${c.tabIndex}` === myTab);
      result = { my_claim: myClaim ?? null, other_services: otherClaims, conflicts, has_conflict: conflicts.length > 0 }; break;
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