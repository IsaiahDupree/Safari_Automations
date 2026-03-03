/**
 * Upwork MCP Server — JSON-RPC 2.0 over stdio
 * Service: http://localhost:3104
 * Start: npx tsx packages/upwork-automation/src/api/mcp-server.ts
 */

import * as readline from 'readline';

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_NAME = 'upwork-safari-automation';
const SERVER_VERSION = '1.0.0';
const BASE = 'http://localhost:3104';
const TIMEOUT_MS = 60_000;

async function api(method: 'GET' | 'POST' | 'DELETE', path: string, body?: Record<string, unknown>): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: ctrl.signal });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    return JSON.parse(text);
  } finally { clearTimeout(t); }
}

const TOOLS = [
  { name: 'upwork_get_status', description: 'Get Upwork service health, login status, and current page URL.', inputSchema: { type: 'object', properties: {} } },
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
];

async function executeTool(name: string, args: Record<string, unknown>): Promise<{ content: Array<{ type: string; text: string }> }> {
  let result: unknown;
  switch (name) {
    case 'upwork_get_status':        result = await api('GET',  '/api/upwork/status'); break;
    case 'upwork_search_jobs':       result = await api('POST', '/api/upwork/jobs/search', { keywords: args.keywords, jobType: args.jobType, experienceLevel: args.experienceLevel, postedWithin: args.postedWithin }); break;
    case 'upwork_get_job_detail':    result = await api('GET',  `/api/upwork/jobs/detail?url=${encodeURIComponent(args.url as string)}`); break;
    case 'upwork_score_jobs':        result = await api('POST', '/api/upwork/jobs/score-batch', { jobs: args.jobs, preferredSkills: args.preferredSkills, minBudget: args.minBudget, availableConnects: args.availableConnects }); break;
    case 'upwork_generate_proposal': result = await api('POST', '/api/upwork/proposals/generate', { job: args.job, customInstructions: args.customInstructions, highlightSkills: args.highlightSkills }); break;
    case 'upwork_submit_proposal':   result = await api('POST', '/api/upwork/proposals/submit', { jobUrl: args.jobUrl, coverLetter: args.coverLetter, hourlyRate: args.hourlyRate, fixedBid: args.fixedBid, dryRun: args.dryRun ?? false }); break;
    case 'upwork_get_conversations': result = await api('GET',  '/api/upwork/conversations'); break;
    case 'upwork_get_messages':      result = await api('GET',  `/api/upwork/messages?limit=${args.limit ?? 20}`); break;
    case 'upwork_open_message':      result = await api('POST', '/api/upwork/messages/open', { clientName: args.clientName }); break;
    case 'upwork_send_message':      result = await api('POST', '/api/upwork/messages/send', { text: args.text }); break;
    case 'upwork_get_applications':  result = await api('GET',  '/api/upwork/applications'); break;
    case 'upwork_monitor_scan':      result = await api('POST', '/api/upwork/monitor/scan'); break;
    case 'upwork_list_watches':      result = await api('GET',  '/api/upwork/monitor/watches'); break;
    case 'upwork_get_rate_limits':   result = await api('GET',  '/api/upwork/rate-limits'); break;
    case 'upwork_navigate': {
      const sectionMap: Record<string, string> = { 'find-work': '/api/upwork/navigate/find-work', 'my-jobs': '/api/upwork/navigate/my-jobs', 'messages': '/api/upwork/navigate/messages' };
      result = await api('POST', sectionMap[args.section as string] || '/api/upwork/navigate/find-work');
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