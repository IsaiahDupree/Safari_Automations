/**
 * Safari W2 MCP Server — "Local to Cloud" profile control plane
 *
 * Exposes compatibility tools that interact with a selected Safari window.
 * This service does not reserve that window or gate other browser automation.
 *
 * Tools:
 *   safari_w2_list_tabs        — list all W2 tabs (index, url, title)
 *   safari_w2_navigate         — navigate a W2 tab to a URL
 *   safari_w2_eval             — run JS in a W2 tab, return result
 *   safari_w2_open_tab         — open a new tab in W2
 *   safari_w2_close_tab        — close a W2 tab by index
 *   safari_w2_activate_tab     — bring a W2 tab to foreground
 *   safari_w2_get_url          — get current URL of a W2 tab
 *   safari_w2_claims           — compatibility status (global claims retired)
 *   safari_w2_service_health   — health check all automation services
 *   safari_w2_setup_tabs       — open missing platform tabs + resolve service targets
 *   safari_w2_claim_tab        — compatibility alias for service target resolution
 *   safari_w2_login_status     — detect logged-in vs login-page for each tab
 *   safari_w2_clear_stale      — compatibility no-op
 *
 * Start: npx tsx packages/safari-w2-mcp/src/mcp-server.ts
 */

import * as readline from 'readline';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_NAME     = 'safari-w2';
const SERVER_VERSION  = '1.0.0';
const SETUP_SCRIPT    = '/Users/isaiahdupree/Documents/Software/Safari Automation/scripts/open-local-to-cloud-tabs.sh';

function getW2(): number {
  // Safari indexes the front window as 1. No window is reserved globally.
  return 1;
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
    description: 'List all tabs in Safari\'s current front window. Returns index, URL, and title for each tab.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'safari_w2_navigate',
    description: 'Navigate a tab in Safari\'s current front window to a URL. Specify tab by index (1-based).',
    inputSchema: { type: 'object', properties: {
      tabIndex: { type: 'number', description: 'Tab index in the current front window (1-based)' },
      url: { type: 'string', description: 'URL to navigate to' },
    }, required: ['tabIndex', 'url'] },
  },
  {
    name: 'safari_w2_eval',
    description: 'Run JavaScript in a tab of Safari\'s current front window and return the result.',
    inputSchema: { type: 'object', properties: {
      tabIndex: { type: 'number', description: 'Tab index in the current front window (1-based)' },
      script: { type: 'string', description: 'JavaScript to execute. Return value becomes the result.' },
    }, required: ['tabIndex', 'script'] },
  },
  {
    name: 'safari_w2_open_tab',
    description: 'Open a new tab in Safari\'s current front window. Returns the new tab index.',
    inputSchema: { type: 'object', properties: {
      url: { type: 'string', description: 'URL to open in the new tab' },
    }, required: ['url'] },
  },
  {
    name: 'safari_w2_close_tab',
    description: 'Close a tab in Safari\'s current front window by index.',
    inputSchema: { type: 'object', properties: {
      tabIndex: { type: 'number', description: 'Tab index to close (1-based)' },
    }, required: ['tabIndex'] },
  },
  {
    name: 'safari_w2_activate_tab',
    description: 'Bring a tab in Safari\'s current front window to the foreground.',
    inputSchema: { type: 'object', properties: {
      tabIndex: { type: 'number', description: 'Tab index to activate (1-based)' },
    }, required: ['tabIndex'] },
  },
  {
    name: 'safari_w2_get_url',
    description: 'Get the current URL of a tab in Safari\'s current front window.',
    inputSchema: { type: 'object', properties: {
      tabIndex: { type: 'number', description: 'Tab index (1-based)' },
    }, required: ['tabIndex'] },
  },
  {
    name: 'safari_w2_claims',
    description: 'Compatibility status: global Safari tab claims are retired and admission is open.',
    inputSchema: { type: 'object', properties: {
      includeExpired: { type: 'boolean', description: 'Ignored compatibility argument', default: false },
    } },
  },
  {
    name: 'safari_w2_service_health',
    description: 'Health check Safari automation services without taking or requiring a browser claim.',
    inputSchema: { type: 'object', properties: {
      filter: { type: 'string', enum: ['all', 'up', 'down'], description: 'Filter results (default: all)', default: 'all' },
    } },
  },
  {
    name: 'safari_w2_setup_tabs',
    description: 'Open missing platform tabs in Safari and ask each service to resolve an independent target.',
    inputSchema: { type: 'object', properties: {
      mode: { type: 'string', enum: ['full', 'ensure-only'], description: '"full" opens missing tabs; "ensure-only" only resolves service targets', default: 'full' },
    } },
  },
  {
    name: 'safari_w2_claim_tab',
    description: 'Compatibility alias that asks a service to discover or open its independent browser target.',
    inputSchema: { type: 'object', properties: {
      service: { type: 'string', description: 'Service name (e.g. "instagram-dm", "twitter-dm", "tiktok-dm", "threads-comments", "facebook-comments", "upwork-automation", "sora-automation")' },
    }, required: ['service'] },
  },
  {
    name: 'safari_w2_login_status',
    description: 'Check whether platform tabs in Safari\'s current front window are logged in.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'safari_w2_clear_stale',
    description: 'Compatibility no-op: global Safari tab claims are retired.',
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
      void includeExpired;
      result = {
        admission: 'open',
        global_claims: false,
        presence_gate: false,
        screen_lock_gate: false,
        conflicts: [],
      };
      break;
    }

    case 'safari_w2_service_health': {
      const { filter = 'all' } = args as { filter?: string };
      const checks = await Promise.all(SERVICES.map(async svc => {
        const h = await httpGet(`http://localhost:${svc.port}/health`, 3000);
        return {
          service: svc.name,
          label: svc.label,
          port: svc.port,
          up: h.ok,
          admission: 'open',
        };
      }));
      const filtered = filter === 'up' ? checks.filter(c => c.up)
        : filter === 'down' ? checks.filter(c => !c.up)
        : checks;
      const upCount = checks.filter(c => c.up).length;
      result = { services: filtered, summary: { total: SERVICES.length, up: upCount, down: SERVICES.length - upCount, admission: 'open' } };
      break;
    }

    case 'safari_w2_setup_tabs': {
      const { mode = 'full' } = args as { mode?: string };
      const flag = mode === 'ensure-only' ? '--ensure' : '';
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
      if (service === 'sora-automation') {
        const h = await httpGet(`http://localhost:${svc.port}/ready`, 3000);
        result = { ok: h.ok, service, admission: 'open', targetResolution: 'service-managed' };
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
      result = { ok: true, removed: 0, remaining: 0, admission: 'open' };
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
process.stderr.write(`[MCP] ${SERVER_NAME} v${SERVER_VERSION} started — Safari front-window compatibility tools; admission open\n`);
