/**
 * Safari W2 MCP Server — "Local to Cloud" profile control plane
 *
 * Exposes MCP tools that ONLY interact with Safari Window 2,
 * the designated "Local to Cloud" automation profile.
 *
 * Tools:
 *   safari_w2_list_tabs        — list all W2 tabs (index, url, title)
 *   safari_w2_navigate         — navigate a W2 tab to a URL
 *   safari_w2_eval             — run JS in a W2 tab, return result
 *   safari_w2_open_tab         — open a new tab in W2
 *   safari_w2_close_tab        — close a W2 tab by index
 *   safari_w2_activate_tab     — bring a W2 tab to foreground
 *   safari_w2_get_url          — get current URL of a W2 tab
 *   safari_w2_claims           — read /tmp/safari-tab-claims.json (W2 only)
 *   safari_w2_service_health   — health check all automation services
 *   safari_w2_setup_tabs       — open all missing platform tabs + trigger claims
 *   safari_w2_claim_tab        — POST /api/session/ensure on a service
 *   safari_w2_login_status     — detect logged-in vs login-page for each tab
 *   safari_w2_clear_stale      — remove expired claims from the registry
 *
 * Start: npx tsx packages/safari-w2-mcp/src/mcp-server.ts
 */

import * as readline from 'readline';
import * as fs from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_NAME     = 'safari-w2';
const SERVER_VERSION  = '1.0.0';
const CLAIMS_FILE     = '/tmp/safari-tab-claims.json';
const CLAIM_TTL_MS    = 60_000;
const SETUP_SCRIPT    = '/Users/isaiahdupree/Documents/Software/Safari Automation/scripts/open-local-to-cloud-tabs.sh';

function getW2(): number {
  return parseInt(process.env.SAFARI_AUTOMATION_WINDOW || '2', 10);
}

// ─── AppleScript helpers ─────────────────────────────────────────────────────

async function runAS(script: string): Promise<string> {
  const { stdout } = await execAsync(`osascript << 'ASEOF'\n${script}\nASEOF`, { timeout: 15_000 });
  return stdout.trim();
}

async function runASJson(script: string): Promise<unknown> {
  const out = await runAS(script);
  try { return JSON.parse(out); } catch { return out; }
}

// ─── Tab claim helpers ────────────────────────────────────────────────────────

interface TabClaim {
  agentId: string; service: string; port: number;
  urlPattern: string; windowIndex: number; tabIndex: number;
  tabUrl: string; pid: number; claimedAt: number; heartbeat: number;
}

async function readClaims(): Promise<TabClaim[]> {
  try {
    const raw = await fs.readFile(CLAIMS_FILE, 'utf-8');
    const all: TabClaim[] = JSON.parse(raw);
    const now = Date.now();
    return all.filter(c => (now - c.heartbeat) < CLAIM_TTL_MS);
  } catch { return []; }
}

// ─── Service registry ─────────────────────────────────────────────────────────

const SERVICES: { port: number; name: string; label: string }[] = [
  { port: 3100, name: 'instagram-dm',       label: 'Instagram DM' },
  { port: 3003, name: 'twitter-dm',         label: 'Twitter DM' },
  { port: 3102, name: 'tiktok-dm',          label: 'TikTok DM' },
  { port: 3105, name: 'linkedin-chrome',    label: 'LinkedIn (Chrome)' },
  { port: 3005, name: 'instagram-comments', label: 'Instagram Comments' },
  { port: 3006, name: 'tiktok-comments',    label: 'TikTok Comments' },
  { port: 3007, name: 'twitter-comments',   label: 'Twitter Comments' },
  { port: 3004, name: 'threads-comments',   label: 'Threads Comments' },
  { port: 3106, name: 'market-research',    label: 'Market Research' },
  { port: 3107, name: 'upwork-hunter',      label: 'Upwork Hunter' },
  { port: 3104, name: 'upwork-automation',  label: 'Upwork Automation' },
  { port: 7070, name: 'sora-automation',    label: 'Sora' },
  { port: 3108, name: 'medium-automation',  label: 'Medium' },
  { port: 3008, name: 'facebook-comments',  label: 'Facebook Comments' },
  { port: 8090, name: 'actp-worker',        label: 'ACTP Worker' },
  { port: 3200, name: 'cloud-sync',         label: 'Cloud Sync' },
  { port: 3302, name: 'cron-manager',       label: 'Cron Manager' },
];

// Login-page detection patterns per platform
const LOGIN_PATTERNS: Record<string, string[]> = {
  'instagram.com': ['accounts/login', 'challenge'],
  'x.com':        ['flow/login', 'i/flow'],
  'tiktok.com':   ['login'],
  'threads.com':  ['login'],
  'facebook.com': ['login', 'two_step_verification'],
  'upwork.com':   ['login', 'signup', 'ab.testing'],
  'medium.com':   ['creators/overview'],  // medium homepage is ok
  'sora':         ['login'],
};

// ─── HTTP helper ──────────────────────────────────────────────────────────────

async function httpGet(url: string, timeoutMs = 5000): Promise<{ ok: boolean; status: number; body: string }> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    const body = await res.text();
    return { ok: res.ok, status: res.status, body };
  } catch {
    return { ok: false, status: 0, body: '' };
  }
}

async function httpPost(url: string, data: unknown, timeoutMs = 8000): Promise<{ ok: boolean; status: number; body: string }> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = await res.text();
    return { ok: res.ok, status: res.status, body };
  } catch {
    return { ok: false, status: 0, body: '' };
  }
}

// ─── Tools ───────────────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'safari_w2_list_tabs',
    description: 'List all tabs open in Safari Window 2 ("Local to Cloud" profile). Returns index, URL, and title for each tab.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'safari_w2_navigate',
    description: 'Navigate a specific tab in Safari Window 2 to a URL. Specify tab by index (1-based).',
    inputSchema: { type: 'object', properties: {
      tabIndex: { type: 'number', description: 'Tab index in Window 2 (1-based)' },
      url: { type: 'string', description: 'URL to navigate to' },
    }, required: ['tabIndex', 'url'] },
  },
  {
    name: 'safari_w2_eval',
    description: 'Run JavaScript in a specific Window 2 tab and return the result. Use for reading page state, checking login, extracting data.',
    inputSchema: { type: 'object', properties: {
      tabIndex: { type: 'number', description: 'Tab index in Window 2 (1-based)' },
      script: { type: 'string', description: 'JavaScript to execute. Return value becomes the result.' },
    }, required: ['tabIndex', 'script'] },
  },
  {
    name: 'safari_w2_open_tab',
    description: 'Open a new tab in Safari Window 2 navigated to a URL. Returns the new tab index.',
    inputSchema: { type: 'object', properties: {
      url: { type: 'string', description: 'URL to open in the new tab' },
    }, required: ['url'] },
  },
  {
    name: 'safari_w2_close_tab',
    description: 'Close a tab in Safari Window 2 by index. Use carefully — this cannot be undone.',
    inputSchema: { type: 'object', properties: {
      tabIndex: { type: 'number', description: 'Tab index to close (1-based)' },
    }, required: ['tabIndex'] },
  },
  {
    name: 'safari_w2_activate_tab',
    description: 'Bring a Window 2 tab to the foreground (make it the active visible tab).',
    inputSchema: { type: 'object', properties: {
      tabIndex: { type: 'number', description: 'Tab index to activate (1-based)' },
    }, required: ['tabIndex'] },
  },
  {
    name: 'safari_w2_get_url',
    description: 'Get the current URL of a specific Window 2 tab.',
    inputSchema: { type: 'object', properties: {
      tabIndex: { type: 'number', description: 'Tab index (1-based)' },
    }, required: ['tabIndex'] },
  },
  {
    name: 'safari_w2_claims',
    description: 'Read the tab claim registry filtered to Window 2 only. Shows which automation service owns which tab, and any conflicts.',
    inputSchema: { type: 'object', properties: {
      includeExpired: { type: 'boolean', description: 'Include expired claims (older than 60s)', default: false },
    } },
  },
  {
    name: 'safari_w2_service_health',
    description: 'Health check all Safari automation services. Returns status (up/down), tab claim, and login state for each platform service.',
    inputSchema: { type: 'object', properties: {
      filter: { type: 'string', enum: ['all', 'up', 'down', 'unclaimed'], description: 'Filter results (default: all)', default: 'all' },
    } },
  },
  {
    name: 'safari_w2_setup_tabs',
    description: 'Open all missing platform tabs in Window 2 and trigger tab claims on all services. Equivalent to running open-local-to-cloud-tabs.sh.',
    inputSchema: { type: 'object', properties: {
      mode: { type: 'string', enum: ['full', 'claim-only', 'reset'], description: '"full" opens missing tabs then claims, "claim-only" only triggers claims, "reset" closes all W2 tabs and reopens fresh', default: 'full' },
    } },
  },
  {
    name: 'safari_w2_claim_tab',
    description: 'Trigger /api/session/ensure on a specific service to make it claim its Window 2 tab.',
    inputSchema: { type: 'object', properties: {
      service: { type: 'string', description: 'Service name (e.g. "instagram-dm", "twitter-dm", "tiktok-dm", "threads-comments", "facebook-comments", "upwork-automation", "sora-automation")' },
    }, required: ['service'] },
  },
  {
    name: 'safari_w2_login_status',
    description: 'Check whether each platform tab in Window 2 is logged in or showing a login/auth page.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'safari_w2_clear_stale',
    description: 'Remove expired tab claims (older than 60s TTL) from /tmp/safari-tab-claims.json.',
    inputSchema: { type: 'object', properties: {} },
  },
];

// ─── Tool execution ───────────────────────────────────────────────────────────

async function executeTool(name: string, args: Record<string, unknown>): Promise<{ content: Array<{ type: string; text: string }> }> {
  const W2 = getW2();
  let result: unknown;

  switch (name) {

    case 'safari_w2_list_tabs': {
      const script = `
tell application "Safari"
  if (count of windows) < ${W2} then return "[]"
  set tabCount to count of tabs of window ${W2}
  set jsonOut to "["
  repeat with t from 1 to tabCount
    set u to URL of tab t of window ${W2}
    set nm to name of tab t of window ${W2}
    -- escape double quotes
    set nm to do shell script "echo " & quoted form of nm & " | sed 's/\"/\\\\\"/g'"
    set u  to do shell script "echo " & quoted form of u  & " | sed 's/\"/\\\\\"/g'"
    set jsonOut to jsonOut & "{\"index\":" & t & ",\"url\":\"" & u & "\",\"title\":\"" & nm & "\"}"
    if t < tabCount then set jsonOut to jsonOut & ","
  end repeat
  set jsonOut to jsonOut & "]"
  return jsonOut
end tell`;
      try {
        result = await runASJson(script);
      } catch (e) {
        // Fallback: simpler approach
        const lines: string[] = [];
        let t = 1;
        while (true) {
          try {
            const url = await runAS(`tell application "Safari" to return URL of tab ${t} of window ${W2}`);
            lines.push({ index: t, url } as unknown as string);
            t++;
          } catch { break; }
        }
        result = lines;
      }
      break;
    }

    case 'safari_w2_navigate': {
      const { tabIndex, url } = args as { tabIndex: number; url: string };
      const safeUrl = String(url).replace(/"/g, '\\"');
      await runAS(`tell application "Safari" to set URL of tab ${tabIndex} of window ${W2} to "${safeUrl}"`);
      result = { ok: true, tabIndex, url, window: W2 };
      break;
    }

    case 'safari_w2_eval': {
      const { tabIndex, script } = args as { tabIndex: number; script: string };
      const safeScript = String(script).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
      const out = await runAS(`tell application "Safari" to return do JavaScript "${safeScript}" in tab ${tabIndex} of window ${W2}`);
      result = { ok: true, tabIndex, output: out };
      break;
    }

    case 'safari_w2_open_tab': {
      const { url } = args as { url: string };
      const safeUrl = String(url).replace(/"/g, '\\"');
      const out = await runAS(`
tell application "Safari"
  if (count of windows) < ${W2} then error "Window ${W2} not open"
  tell window ${W2}
    make new tab with properties {URL:"${safeUrl}"}
    activate
  end tell
  return count of tabs of window ${W2}
end tell`);
      result = { ok: true, url, newTabIndex: parseInt(out, 10), window: W2 };
      break;
    }

    case 'safari_w2_close_tab': {
      const { tabIndex } = args as { tabIndex: number };
      await runAS(`tell application "Safari" to close tab ${tabIndex} of window ${W2}`);
      result = { ok: true, closed: tabIndex, window: W2 };
      break;
    }

    case 'safari_w2_activate_tab': {
      const { tabIndex } = args as { tabIndex: number };
      await runAS(`
tell application "Safari"
  set current tab of window ${W2} to tab ${tabIndex} of window ${W2}
  activate
end tell`);
      result = { ok: true, activeTab: tabIndex, window: W2 };
      break;
    }

    case 'safari_w2_get_url': {
      const { tabIndex } = args as { tabIndex: number };
      const url = await runAS(`tell application "Safari" to return URL of tab ${tabIndex} of window ${W2}`);
      result = { tabIndex, url, window: W2 };
      break;
    }

    case 'safari_w2_claims': {
      const { includeExpired = false } = args as { includeExpired?: boolean };
      let claims: TabClaim[];
      if (includeExpired) {
        try {
          const raw = await fs.readFile(CLAIMS_FILE, 'utf-8');
          claims = JSON.parse(raw);
        } catch { claims = []; }
      } else {
        claims = await readClaims();
      }
      const w2Claims = claims.filter(c => c.windowIndex === W2);
      const w1Claims = claims.filter(c => c.windowIndex !== W2);
      // Detect conflicts (two services on same tab)
      const tabMap = new Map<string, TabClaim[]>();
      for (const c of w2Claims) {
        const key = `${c.windowIndex}:${c.tabIndex}`;
        if (!tabMap.has(key)) tabMap.set(key, []);
        tabMap.get(key)!.push(c);
      }
      const conflicts = [...tabMap.entries()]
        .filter(([, svcs]) => svcs.length > 1)
        .map(([tab, svcs]) => ({ tab, services: svcs.map(s => s.service) }));
      result = {
        window: W2,
        w2_claims: w2Claims,
        other_window_claims: w1Claims,
        conflicts,
        total: claims.length,
      };
      break;
    }

    case 'safari_w2_service_health': {
      const { filter = 'all' } = args as { filter?: string };
      const claims = await readClaims();
      const checks = await Promise.all(SERVICES.map(async svc => {
        const h = await httpGet(`http://localhost:${svc.port}/health`, 3000);
        const claim = claims.find(c => c.service === svc.name && c.windowIndex === W2);
        return {
          service: svc.name,
          label: svc.label,
          port: svc.port,
          up: h.ok,
          w2_claim: claim ? `W${claim.windowIndex}:T${claim.tabIndex}` : null,
          tab_url: claim?.tabUrl ?? null,
        };
      }));
      const filtered = filter === 'up' ? checks.filter(c => c.up)
        : filter === 'down' ? checks.filter(c => !c.up)
        : filter === 'unclaimed' ? checks.filter(c => c.up && !c.w2_claim)
        : checks;
      const upCount = checks.filter(c => c.up).length;
      const claimedCount = checks.filter(c => c.w2_claim).length;
      result = { services: filtered, summary: { total: SERVICES.length, up: upCount, down: SERVICES.length - upCount, w2_claimed: claimedCount } };
      break;
    }

    case 'safari_w2_setup_tabs': {
      const { mode = 'full' } = args as { mode?: string };
      const flag = mode === 'claim-only' ? '--claim' : mode === 'reset' ? '--reset' : '';
      try {
        const { stdout, stderr } = await execAsync(
          `/bin/zsh -l "${SETUP_SCRIPT}" ${flag}`,
          { timeout: 60_000 }
        );
        result = { ok: true, mode, output: (stdout + stderr).split('\n').filter(Boolean) };
      } catch (e: unknown) {
        const err = e as { stdout?: string; stderr?: string; message?: string };
        result = { ok: false, mode, output: ((err.stdout ?? '') + (err.stderr ?? '')).split('\n').filter(Boolean), error: err.message };
      }
      break;
    }

    case 'safari_w2_claim_tab': {
      const { service } = args as { service: string };
      const svc = SERVICES.find(s => s.name === service);
      if (!svc) {
        result = { ok: false, error: `Unknown service: ${service}`, known: SERVICES.map(s => s.name) };
        break;
      }
      // Sora uses command trigger, others use session/ensure
      if (service === 'sora-automation') {
        const r = await httpPost(`http://localhost:${svc.port}/v1/commands`,
          { type: 'sora.generate', payload: { prompt: 'tab-claim-ping' } }, 5000);
        if (!r.ok) { result = { ok: false, service, error: `HTTP ${r.status}: ${r.body.slice(0, 100)}` }; break; }
        // Wait for claim
        await new Promise(res => setTimeout(res, 4000));
        const h = await httpGet(`http://localhost:${svc.port}/health`, 3000);
        const health = h.ok ? JSON.parse(h.body) : {};
        result = { ok: h.ok, service, claimed: health.tabClaimed ?? false };
      } else {
        const r = await httpPost(`http://localhost:${svc.port}/api/session/ensure`, {}, 8000);
        if (!r.ok) { result = { ok: false, service, port: svc.port, error: `HTTP ${r.status}: ${r.body.slice(0, 200)}` }; break; }
        try { result = { ok: true, service, ...JSON.parse(r.body) }; }
        catch { result = { ok: true, service, raw: r.body.slice(0, 200) }; }
      }
      break;
    }

    case 'safari_w2_login_status': {
      // Read all W2 tabs and determine login state
      const tabs: Array<{ index: number; url: string; platform: string; loggedIn: boolean; loginPage: boolean }> = [];
      let t = 1;
      while (true) {
        let url: string;
        try {
          url = await runAS(`tell application "Safari" to return URL of tab ${t} of window ${W2}`);
        } catch { break; }

        let platform = 'unknown';
        let loggedIn = true;
        let loginPage = false;

        for (const [domain, loginPatterns] of Object.entries(LOGIN_PATTERNS)) {
          if (url.includes(domain)) {
            platform = domain.replace('.com', '').replace('.net', '');
            for (const pattern of loginPatterns) {
              if (url.includes(pattern)) {
                loginPage = true;
                loggedIn = false;
                break;
              }
            }
            break;
          }
        }
        // Blank/error pages
        if (url === 'favorites://' || url.startsWith('about:') || url === '') {
          platform = 'blank';
          loggedIn = false;
        }

        tabs.push({ index: t, url, platform, loggedIn, loginPage });
        t++;
        if (t > 20) break; // safety cap
      }

      const loggedInCount = tabs.filter(t => t.loggedIn && t.platform !== 'unknown' && t.platform !== 'blank').length;
      const needsLogin = tabs.filter(t => t.loginPage);
      result = { window: W2, tabs, loggedIn: loggedInCount, needsLogin: needsLogin.map(t => ({ index: t.index, platform: t.platform, url: t.url })) };
      break;
    }

    case 'safari_w2_clear_stale': {
      let all: TabClaim[] = [];
      try {
        const raw = await fs.readFile(CLAIMS_FILE, 'utf-8');
        all = JSON.parse(raw);
      } catch { /* empty file */ }
      const now = Date.now();
      const active = all.filter(c => (now - c.heartbeat) < CLAIM_TTL_MS);
      const staleCount = all.length - active.length;
      const tmp = `${CLAIMS_FILE}.tmp.${process.pid}`;
      await fs.writeFile(tmp, JSON.stringify(active, null, 2));
      await fs.rename(tmp, CLAIMS_FILE);
      result = { ok: true, removed: staleCount, remaining: active.length };
      break;
    }

    default:
      throw { code: -32601, message: `Unknown tool: ${name}` };
  }

  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}

// ─── JSON-RPC dispatch ────────────────────────────────────────────────────────

interface JsonRpcRequest  { jsonrpc: '2.0'; id?: number | string | null; method: string; params?: Record<string, unknown>; }
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
      const toolName  = p.name as string;
      const toolArgs  = (p.arguments || {}) as Record<string, unknown>;
      if (!toolName) return { jsonrpc: '2.0', id, error: { code: -32602, message: 'Missing tool name' } };
      if (!TOOLS.some(t => t.name === toolName)) return { jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown tool: ${toolName}` } };
      try {
        return { jsonrpc: '2.0', id, result: await executeTool(toolName, toolArgs) };
      } catch (err) {
        const e = err as { code?: number; message?: string };
        if (typeof e.code === 'number') return { jsonrpc: '2.0', id, error: { code: e.code, message: e.message || 'Tool error' } };
        const msg = e.message || String(err);
        return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify({ code: 'ERROR', message: msg }) }], isError: true } };
      }
    }
    default:
      return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${req.method}` } };
  }
}

// ─── Stdio loop ───────────────────────────────────────────────────────────────

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
process.stderr.write(`[MCP] ${SERVER_NAME} v${SERVER_VERSION} started — Window ${getW2()} ("Local to Cloud")\n`);
