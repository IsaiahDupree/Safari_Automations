/**
 * Upwork MCP Server — JSON-RPC 2.0 over stdio
 * Service: http://localhost:3104
 * Start: npx tsx packages/upwork-automation/src/api/mcp-server.ts
 */

import * as readline from 'readline';
import * as fs from 'fs/promises';

// ─── Tab Claim Guard ─────────────────────────────────────────────────────────

const CLAIMS_FILE = '/tmp/safari-tab-claims.json';
const CLAIM_TTL_MS = 60_000;
const MY_SERVICE = 'upwork-automation';

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
const SERVER_NAME = 'upwork-safari-automation';
const SERVER_VERSION = '1.0.0';
const BASE = 'http://localhost:3104';
const TIMEOUT_MS = 60_000;

function structuredError(status: number, body: string, platform: string): never {
  if (status === 429) throw { code: 'RATE_LIMITED', message: 'Rate limit hit — wait before retrying', retryAfter: 60, platform };
  if (status === 401 || status === 403) throw { code: 'SESSION_EXPIRED', message: 'Safari session expired or unauthorized', action: 'navigate to Upwork and log in', platform };
  if (status === 404) throw { code: 'NOT_FOUND', message: body.slice(0, 100), platform };
  throw { code: 'API_ERROR', message: `HTTP ${status}: ${body.slice(0, 200)}`, platform };
}

async function api(method: 'GET' | 'POST' | 'DELETE' | 'PATCH', path: string, body?: Record<string, unknown>): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: ctrl.signal });
    const text = await res.text();
    if (!res.ok) structuredError(res.status, text, 'upwork');
    return JSON.parse(text);
  } catch (err) {
    const e = err as { name?: string; cause?: { code?: string } };
    if (e.name === 'AbortError') throw { code: 'SERVICE_DOWN', message: `${BASE} did not respond within ${TIMEOUT_MS / 1000}s — is the service running?`, base: BASE };
    if ((e as { code?: string }).code === 'ECONNREFUSED' || e.cause?.code === 'ECONNREFUSED') throw { code: 'SERVICE_DOWN', message: `${BASE} is not running`, base: BASE };
    throw err;
  } finally { clearTimeout(t); }
}

const TOOLS = [
  { name: 'upwork_get_status', description: 'Get Upwork service health, login status (logged_in/login_page/captcha/unknown), and current page URL.', inputSchema: { type: 'object', properties: {} } },
  { name: 'upwork_signin', description: 'Sign in to Upwork using stored credentials (UPWORK_EMAIL/UPWORK_PASSWORD). Returns result: success|already_logged_in|captcha|two_fa|failed.', inputSchema: { type: 'object', properties: {} } },
  { name: 'upwork_ensure_login', description: 'Check login state and auto-signin if not logged in. Safe to call before any scraping operation.', inputSchema: { type: 'object', properties: {} } },
  { name: 'upwork_search_jobs', description: 'Search Upwork for jobs matching filters. Returns scored job listings with skills, budget, proposals, and client info.', inputSchema: { type: 'object', properties: { keywords: { type: 'string', description: 'Search keywords' }, jobType: { type: 'string', enum: ['hourly', 'fixed', 'both'], description: 'Job type filter', default: 'both' }, experienceLevel: { type: 'string', description: 'entry, intermediate, or expert' }, postedWithin: { type: 'string', description: 'Time filter e.g. "last_24_hours", "last_week"' }, maxResults: { type: 'number', description: 'Max jobs to return (default 30)', default: 30 } }, required: ['keywords'] } },
  { name: 'upwork_get_job_detail', description: 'Get full details for a specific job posting by URL — title, description, skills, client history, budget, proposals, connects cost.', inputSchema: { type: 'object', properties: { url: { type: 'string', description: 'Upwork job URL' } }, required: ['url'] } },
  { name: 'upwork_score_jobs', description: 'Score multiple jobs against your skill/budget preferences. Returns sorted list with apply/maybe/skip recommendations and connects advice.', inputSchema: { type: 'object', properties: { jobs: { type: 'array', description: 'Array of job objects from upwork_search_jobs', items: { type: 'object' } }, preferredSkills: { type: 'array', description: 'Your skills to match against job requirements', items: { type: 'string' } }, minBudget: { type: 'number', description: 'Minimum budget threshold' }, availableConnects: { type: 'number', description: 'Your current connects balance' } }, required: ['jobs'] } },
  { name: 'upwork_generate_proposal', description: 'Generate an AI-written cover letter for a job using GPT-4o. Returns full proposal text tailored to the job.', inputSchema: { type: 'object', properties: { job: { type: 'object', description: 'Job object from upwork_get_job_detail' }, customInstructions: { type: 'string', description: 'Extra instructions for tone, highlights, or focus areas' }, highlightSkills: { type: 'array', description: 'Skills to emphasize', items: { type: 'string' } } }, required: ['job'] } },
  { name: 'upwork_submit_proposal', description: 'Submit a proposal for a job. Fills cover letter, sets hourly rate or milestone, and submits. Respects daily application rate limits.', inputSchema: { type: 'object', properties: { jobUrl: { type: 'string', description: 'Upwork job URL' }, coverLetter: { type: 'string', description: 'Cover letter text' }, hourlyRate: { type: 'number', description: 'Your bid rate (hourly jobs)' }, fixedBid: { type: 'number', description: 'Your bid amount (fixed-price jobs)' }, dryRun: { type: 'boolean', description: 'Fill form but do NOT click Submit (for preview/testing)', default: false } }, required: ['jobUrl', 'coverLetter'] } },
  { name: 'upwork_get_conversations', description: 'List message conversations in the Upwork inbox.', inputSchema: { type: 'object', properties: {} } },
  { name: 'upwork_get_messages', description: 'Read recent messages from the Upwork inbox.', inputSchema: { type: 'object', properties: { limit: { type: 'number', description: 'Max messages (default 20)', default: 20 } } } },
  { name: 'upwork_open_message', description: 'Open a specific message thread by client name.', inputSchema: { type: 'object', properties: { clientName: { type: 'string', description: 'Client name to open thread for' } }, required: ['clientName'] } },
  { name: 'upwork_send_message', description: 'Send a message in the currently open Upwork conversation.', inputSchema: { type: 'object', properties: { text: { type: 'string', description: 'Message text to send' } }, required: ['text'] } },
  { name: 'upwork_get_applications', description: 'List all submitted Upwork applications with their current status.', inputSchema: { type: 'object', properties: {} } },
  { name: 'upwork_monitor_scan', description: 'Scan for new Upwork jobs matching your saved watch criteria.', inputSchema: { type: 'object', properties: {} } },
  { name: 'upwork_list_watches', description: 'List all active Upwork job watches (saved search criteria for monitoring).', inputSchema: { type: 'object', properties: {} } },
  { name: 'upwork_get_rate_limits', description: 'Get current Upwork rate limit state (searches this hour, applications today).', inputSchema: { type: 'object', properties: {} } },
  { name: 'upwork_navigate', description: 'Navigate Safari to a specific Upwork URL or section.', inputSchema: { type: 'object', properties: { section: { type: 'string', enum: ['find-work', 'my-jobs', 'messages'], description: 'Section to navigate to' } }, required: ['section'] } },
  { name: 'upwork_is_ready', description: 'Check if the Upwork service (:3104) is reachable and you are logged in before attempting any action. Call this first each session.', inputSchema: { type: 'object', properties: {} } },
  { name: 'upwork_list_templates', description: 'List all saved proposal templates.', inputSchema: { type: 'object', properties: {} } },
  { name: 'upwork_create_template', description: 'Create a new proposal template for reuse.', inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'Template name' }, category: { type: 'string', description: 'Template category' }, template: { type: 'string', description: 'Template text with optional placeholders' }, tone: { type: 'string', enum: ['professional', 'friendly', 'technical'], description: 'Template tone' } }, required: ['name', 'category', 'template', 'tone'] } },
  { name: 'upwork_save_job', description: 'Save an Upwork job for later (adds to Saved Jobs list).', inputSchema: { type: 'object', properties: { jobUrl: { type: 'string', description: 'Upwork job URL' } }, required: ['jobUrl'] } },
  { name: 'upwork_get_saved_jobs', description: 'Get list of all saved Upwork jobs.', inputSchema: { type: 'object', properties: {} } },
  { name: 'upwork_get_connects', description: 'Get current Upwork connects balance.', inputSchema: { type: 'object', properties: {} } },
  { name: 'upwork_create_watch', description: 'Create a job monitoring watch with specific criteria (keywords, job type, experience level, budget).', inputSchema: { type: 'object', properties: { keywords: { type: 'array', items: { type: 'string' }, description: 'Keywords to monitor' }, jobType: { type: 'string', enum: ['hourly', 'fixed', 'both'], description: 'Job type filter' }, experienceLevel: { type: 'string', description: 'Experience level filter' }, minBudget: { type: 'number', description: 'Minimum budget filter' } }, required: ['keywords'] } },
  { name: 'upwork_delete_watch', description: 'Delete a job monitoring watch by ID.', inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'Watch ID to delete' } }, required: ['id'] } },
  { name: 'upwork_get_unread_messages', description: 'Get count and list of conversations with unread messages.', inputSchema: { type: 'object', properties: {} } },
  { name: 'upwork_get_analytics', description: 'Get analytics summary (total applications, view rate, response rate, top keywords).', inputSchema: { type: 'object', properties: {} } },
  { name: 'upwork_get_rate_status', description: 'Detect if Upwork is showing rate limit warnings or CAPTCHA challenges.', inputSchema: { type: 'object', properties: {} } },
  { name: 'upwork_improve_proposal', description: 'Use AI to improve an existing proposal cover letter (makes it more concise, professional, and compelling).', inputSchema: { type: 'object', properties: { existingProposal: { type: 'string', description: 'Current proposal text to improve' }, jobDescription: { type: 'string', description: 'Job description for context' }, feedback: { type: 'string', description: 'Optional specific feedback or improvement instructions' } }, required: ['existingProposal'] } },
  { name: 'upwork_session_ensure', description: 'Ensure the upwork-automation service has an active Safari tab claim before navigating. Call this at the start of any session to get a dedicated Upwork tab instead of hijacking the active one.', inputSchema: { type: 'object', properties: {} } },
  { name: 'upwork_claim_status', description: 'Read /tmp/safari-tab-claims.json — shows all active Safari tab claims across services and any conflicts with the Upwork tab.', inputSchema: { type: 'object', properties: {} } },
  { name: 'upwork_release_session', description: 'Release the upwork-automation tab claim so the Safari tab is freed for user browsing or other services.', inputSchema: { type: 'object', properties: {} } },
];

async function executeTool(name: string, args: Record<string, unknown>): Promise<{ content: Array<{ type: string; text: string }> }> {
  let result: unknown;
  switch (name) {
    case 'upwork_get_status':        result = await api('GET',  '/api/upwork/status'); break;
    case 'upwork_signin':            result = await api('POST', '/api/upwork/signin'); break;
    case 'upwork_ensure_login':      result = await api('POST', '/api/upwork/ensure-login'); break;
    case 'upwork_search_jobs':       result = await api('POST', '/api/upwork/jobs/search', { keywords: args.keywords, jobType: args.jobType, experienceLevel: args.experienceLevel, postedWithin: args.postedWithin }); break;
    case 'upwork_get_job_detail':    result = await api('GET',  `/api/upwork/jobs/detail?url=${encodeURIComponent(args.url as string)}`); break;
    case 'upwork_score_jobs':        result = await api('POST', '/api/upwork/jobs/score-batch', { jobs: args.jobs, preferredSkills: args.preferredSkills, minBudget: args.minBudget, availableConnects: args.availableConnects }); break;
    case 'upwork_generate_proposal': result = await api('POST', '/api/upwork/proposals/generate', { job: args.job, customInstructions: args.customInstructions, highlightSkills: args.highlightSkills }); break;
    case 'upwork_submit_proposal': {
      if (!(args.dryRun ?? false)) {
        const submitConflict = await checkNavigationConflict();
        if (submitConflict.conflict) throw { code: 'TAB_CONFLICT', message: `Safari tab is claimed by '${submitConflict.blocker.service}' (port ${submitConflict.blocker.port}). Cannot submit proposal while another service owns the tab.`, blocker: submitConflict.blocker };
      }
      result = await api('POST', '/api/upwork/proposals/submit', { jobUrl: args.jobUrl, coverLetter: args.coverLetter, hourlyRate: args.hourlyRate, fixedBid: args.fixedBid, dryRun: args.dryRun ?? false }); break;
    }
    case 'upwork_get_conversations': result = await api('GET',  '/api/upwork/conversations'); break;
    case 'upwork_get_messages':      result = await api('GET',  `/api/upwork/messages?limit=${args.limit ?? 20}`); break;
    case 'upwork_open_message':      result = await api('POST', '/api/upwork/messages/open', { clientName: args.clientName }); break;
    case 'upwork_send_message': {
      const msgConflict = await checkNavigationConflict();
      if (msgConflict.conflict) throw { code: 'TAB_CONFLICT', message: `Safari tab is claimed by '${msgConflict.blocker.service}' (port ${msgConflict.blocker.port}). Cannot send message while another service owns the tab.`, blocker: msgConflict.blocker };
      result = await api('POST', '/api/upwork/messages/send', { text: args.text }); break;
    }
    case 'upwork_get_applications':  result = await api('GET',  '/api/upwork/applications'); break;
    case 'upwork_monitor_scan':      result = await api('POST', '/api/upwork/monitor/scan'); break;
    case 'upwork_list_watches':      result = await api('GET',  '/api/upwork/monitor/watches'); break;
    case 'upwork_get_rate_limits':   result = await api('GET',  '/api/upwork/rate-limits'); break;
    case 'upwork_navigate': {
      const navConflict = await checkNavigationConflict();
      if (navConflict.conflict) throw { code: 'TAB_CONFLICT', message: `Safari tab is claimed by '${navConflict.blocker.service}' (port ${navConflict.blocker.port}). Call upwork_session_ensure first to get a dedicated tab.`, blocker: navConflict.blocker };
      const sectionMap: Record<string, string> = { 'find-work': '/api/upwork/navigate/find-work', 'my-jobs': '/api/upwork/navigate/my-jobs', 'messages': '/api/upwork/navigate/messages' };
      result = await api('POST', sectionMap[args.section as string] || '/api/upwork/navigate/find-work');
      break;
    }
    case 'upwork_is_ready': {
      const check = async () => { try { const r = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(5000) }); return r.ok; } catch { return false; } };
      const up = await check();
      result = { service: up, ready: up, serviceUrl: BASE };
      break;
    }
    case 'upwork_list_templates':    result = await api('GET',  '/api/upwork/templates'); break;
    case 'upwork_create_template':   result = await api('POST', '/api/upwork/templates', { name: args.name, category: args.category, template: args.template, tone: args.tone }); break;
    case 'upwork_save_job':          result = await api('POST', '/api/upwork/jobs/save', { jobUrl: args.jobUrl }); break;
    case 'upwork_get_saved_jobs':    result = await api('GET',  '/api/upwork/jobs/saved'); break;
    case 'upwork_get_connects':      result = await api('GET',  '/api/upwork/connects'); break;
    case 'upwork_create_watch':      result = await api('POST', '/api/upwork/monitor/watches', { keywords: args.keywords, jobType: args.jobType, experienceLevel: args.experienceLevel, minBudget: args.minBudget }); break;
    case 'upwork_delete_watch':      result = await api('DELETE', `/api/upwork/monitor/watches/${args.id}`); break;
    case 'upwork_get_unread_messages': result = await api('GET', '/api/upwork/messages/unread'); break;
    case 'upwork_get_analytics':     result = await api('GET', '/api/upwork/analytics'); break;
    case 'upwork_get_rate_status':   result = await api('GET', '/api/upwork/rate-status'); break;
    case 'upwork_improve_proposal':  result = await api('POST', '/api/upwork/proposals/improve', { existingProposal: args.existingProposal, jobDescription: args.jobDescription, feedback: args.feedback }); break;
    case 'upwork_session_ensure':
      result = await api('POST', '/api/session/ensure', {});
      break;
    case 'upwork_claim_status': {
      const claims = await readActiveClaims();
      const myClaim = claims.find(c => c.service === MY_SERVICE);
      const otherClaims = claims.filter(c => c.service !== MY_SERVICE);
      const myTab = myClaim ? `${myClaim.windowIndex}:${myClaim.tabIndex}` : null;
      const conflicts = otherClaims.filter(c => myTab && `${c.windowIndex}:${c.tabIndex}` === myTab);
      result = { my_claim: myClaim ?? null, other_services: otherClaims, conflicts, has_conflict: conflicts.length > 0 };
      break;
    }
    case 'upwork_release_session':   result = await api('POST', '/api/session/clear', {}); break;
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
        if (e.code) return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(err) }], isError: true } };
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