/**
 * Safari W2 MCP Server — compatibility control plane for the shared window
 *
 * The historical safari_w2 tool names are retained for compatibility, but all
 * tools now target the sole managed Safari window (window 1).
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
import { randomUUID } from 'node:crypto';
import { promisify } from 'util';

const execAsync = promisify(exec);

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_NAME     = 'safari-w2';
const SERVER_VERSION  = '1.0.0';
const CLAIMS_FILE     = '/tmp/safari-tab-claims.json';
const CLAIM_TTL_MS    = 60_000;
const SETUP_SCRIPT    = '/Users/isaiahdupree/Documents/Software/Safari Automation/scripts/open-local-to-cloud-tabs.sh';

function getW2(): number {
  return 2;
}

async function requireSafariPermit(mode: 'background' | 'interactive'): Promise<void> {
  const clientPath: string = '../../shared/safari-lane-client.js';
  const client = await import(clientPath) as { requireSafariLanePermit(mode: 'background' | 'interactive'): Promise<unknown> };
  await client.requireSafariLanePermit(mode);
}

async function withSafariForegroundInput<T>(activateOwnedTab: () => Promise<void>, performInput: () => Promise<T>): Promise<T> {
  const clientPath: string = '../../shared/safari-lane-client.js';
  const client = await import(clientPath) as { runSafariForegroundInput<T>(activateOwnedTab: () => Promise<void>, performInput: () => Promise<T>): Promise<T> };
  return client.runSafariForegroundInput(activateOwnedTab, performInput);
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
  windowId?: number;
  tabUrl: string; pid: number; claimedAt: number; heartbeat: number;
  agentOwned: boolean;
  ownershipMarker?: string;
}

async function readClaims(): Promise<TabClaim[]> {
  try {
    const raw = await fs.readFile(CLAIMS_FILE, 'utf-8');
    const all: TabClaim[] = JSON.parse(raw);
    const now = Date.now();
    return all.filter(c => (now - c.heartbeat) < CLAIM_TTL_MS);
  } catch { return []; }
}

async function withOwnedTabOperation<T>(
  tabIndex: number,
  action: (claim: TabClaim) => Promise<T>,
): Promise<T> {
  if (!Number.isInteger(tabIndex) || tabIndex < 1) throw new Error('tabIndex must be a positive integer');
  const coordinatorPath: string = '../../instagram-dm/src/automation/tab-coordinator.js';
  const { TabCoordinator } = await import(coordinatorPath) as {
    TabCoordinator: new (
      agentId: string,
      service: string,
      port: number,
      urlPattern: string,
    ) => {
      claim(windowIndex?: number, tabIndex?: number): Promise<TabClaim>;
      beginOperation(): Promise<TabClaim>;
      endOperation(): Promise<void>;
      release(): Promise<void>;
    };
  };
  const coordinator = new TabCoordinator(
    `safari-w2-mcp-${process.pid}-${randomUUID()}`,
    'safari-w2-mcp',
    3000,
    '',
  );
  let operationStarted = false;
  try {
    await coordinator.claim(2, tabIndex);
    const claim = await coordinator.beginOperation();
    operationStarted = true;
    if (!Number.isInteger(claim.windowId) || Number(claim.windowId) <= 0 || !claim.ownershipMarker) {
      throw new Error(`Safari W2 tab ${tabIndex} has no exact durable ownership identity`);
    }
    return await action(claim);
  } finally {
    if (operationStarted) await coordinator.endOperation().catch(() => {});
    else await coordinator.release().catch(() => {});
  }
}

async function listOwnedTabs(): Promise<Array<{
  index: number;
  windowId: number;
  url: string;
  title: string;
  service: string;
  agentId: string;
}>> {
  const claims = (await readClaims())
    .filter(claim =>
      claim.windowIndex === 2 &&
      claim.agentOwned === true &&
      Number.isInteger(claim.windowId) &&
      typeof claim.ownershipMarker === 'string'
    )
    .sort((left, right) => left.tabIndex - right.tabIndex);
  return claims.map(claim => ({
      index: claim.tabIndex,
      windowId: Number(claim.windowId),
      url: claim.tabUrl,
      title: '',
      service: claim.service,
      agentId: claim.agentId,
    }));
}

// ─── Service registry ─────────────────────────────────────────────────────────

const SERVICES: { port: number; name: string; label: string }[] = [
  { port: 3100, name: 'instagram-dm',       label: 'Instagram DM' },
  { port: 3003, name: 'twitter-dm',         label: 'Twitter DM' },
  { port: 3102, name: 'tiktok-dm',          label: 'TikTok DM' },
  { port: 3105, name: 'linkedin-automation', label: 'LinkedIn' },
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
    description: 'List all tabs open in the sole shared Safari window. Returns index, URL, and title for each tab.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'safari_w2_navigate',
    description: 'Navigate a specific shared Safari tab to a URL. Specify tab by index (1-based).',
    inputSchema: { type: 'object', properties: {
      tabIndex: { type: 'number', description: 'Tab index in the shared window (1-based)' },
      url: { type: 'string', description: 'URL to navigate to' },
    }, required: ['tabIndex', 'url'] },
  },
  {
    name: 'safari_w2_eval',
    description: 'Run JavaScript in a specific shared Safari tab and return the result.',
    inputSchema: { type: 'object', properties: {
      tabIndex: { type: 'number', description: 'Tab index in the shared window (1-based)' },
      script: { type: 'string', description: 'JavaScript to execute. Return value becomes the result.' },
    }, required: ['tabIndex', 'script'] },
  },
  {
    name: 'safari_w2_open_tab',
    description: 'Open a new tab in the shared Safari window, subject to the global eight-tab cap.',
    inputSchema: { type: 'object', properties: {
      url: { type: 'string', description: 'URL to open in the new tab' },
    }, required: ['url'] },
  },
  {
    name: 'safari_w2_close_tab',
    description: 'Close a task-owned tab in the shared Safari window by index.',
    inputSchema: { type: 'object', properties: {
      tabIndex: { type: 'number', description: 'Tab index to close (1-based)' },
    }, required: ['tabIndex'] },
  },
  {
    name: 'safari_w2_activate_tab',
    description: 'Bring a shared Safari tab to the foreground.',
    inputSchema: { type: 'object', properties: {
      tabIndex: { type: 'number', description: 'Tab index to activate (1-based)' },
    }, required: ['tabIndex'] },
  },
  {
    name: 'safari_w2_get_url',
    description: 'Get the current URL of a specific shared Safari tab.',
    inputSchema: { type: 'object', properties: {
      tabIndex: { type: 'number', description: 'Tab index (1-based)' },
    }, required: ['tabIndex'] },
  },
  {
    name: 'safari_w2_claims',
    description: 'Read the tab claim registry for the sole shared Safari window.',
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
    description: 'Open missing platform tabs in the shared window and trigger service claims.',
    inputSchema: { type: 'object', properties: {
      mode: { type: 'string', enum: ['full', 'claim-only', 'reset'], description: '"full" opens missing tabs then claims, "claim-only" only triggers claims, "reset" closes all W2 tabs and reopens fresh', default: 'full' },
    } },
  },
  {
    name: 'safari_w2_claim_tab',
    description: 'Trigger /api/session/ensure on a service so it claims its shared-window tab.',
    inputSchema: { type: 'object', properties: {
      service: { type: 'string', description: 'Service name (e.g. "instagram-dm", "twitter-dm", "tiktok-dm", "threads-comments", "facebook-comments", "upwork-automation", "sora-automation")' },
    }, required: ['service'] },
  },
  {
    name: 'safari_w2_login_status',
    description: 'Check whether each platform tab in the shared window is logged in.',
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
      result = await listOwnedTabs();
      break;
    }

    case 'safari_w2_navigate': {
      const { tabIndex, url } = args as { tabIndex: number; url: string };
      const parsedUrl = new URL(String(url));
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('Safari navigation only accepts http(s) URLs');
      const safeUrl = parsedUrl.toString().replace(/"/g, '\\"');
      result = await withOwnedTabOperation(tabIndex, async claim => {
        await runAS(`
tell application "Safari"
  set agentWindow to first window whose id is ${claim.windowId}
  set candidateTab to tab ${claim.tabIndex} of agentWindow
  if (do JavaScript "window.name" in candidateTab) is not "${claim.ownershipMarker}" then error "ownership changed"
  set URL of candidateTab to "${safeUrl}"
end tell`);
        return { ok: true, tabIndex: claim.tabIndex, url, windowId: claim.windowId };
      });
      break;
    }

    case 'safari_w2_eval': {
      const { tabIndex, script } = args as { tabIndex: number; script: string };
      const safeScript = String(script).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
      result = await withOwnedTabOperation(tabIndex, async claim => {
        const out = await runAS(`
tell application "Safari"
  set agentWindow to first window whose id is ${claim.windowId}
  set candidateTab to tab ${claim.tabIndex} of agentWindow
  if (do JavaScript "window.name" in candidateTab) is not "${claim.ownershipMarker}" then error "ownership changed"
  return do JavaScript "${safeScript}" in candidateTab
end tell`);
        return { ok: true, tabIndex: claim.tabIndex, windowId: claim.windowId, output: out };
      });
      break;
    }

    case 'safari_w2_open_tab': {
      throw new Error('Direct MCP tab allocation is disabled; call safari_w2_claim_tab so a service TabCoordinator allocates under the shared claim lock');
    }

    case 'safari_w2_close_tab': {
      throw new Error('Direct MCP tab closing is disabled; only the owning service may release/recycle its agent tab');
    }

    case 'safari_w2_activate_tab': {
      const { tabIndex } = args as { tabIndex: number };
      result = await withOwnedTabOperation(tabIndex, async claim => {
        await withSafariForegroundInput(async () => {
          await runAS(`
tell application "Safari"
  set agentWindow to first window whose id is ${claim.windowId}
  set agentTab to tab ${claim.tabIndex} of agentWindow
  if (do JavaScript "window.name" in agentTab) is not "${claim.ownershipMarker}" then error "ownership changed"
  activate
  set current tab of agentWindow to agentTab
  set index of agentWindow to 1
end tell
tell application "System Events" to set frontmost of process "Safari" to true`);
        }, async () => undefined);
        return { ok: true, activeTab: claim.tabIndex, windowId: claim.windowId };
      });
      break;
    }

    case 'safari_w2_get_url': {
      const { tabIndex } = args as { tabIndex: number };
      result = await withOwnedTabOperation(tabIndex, async claim => {
        const url = await runAS(`
tell application "Safari"
  set agentWindow to first window whose id is ${claim.windowId}
  set candidateTab to tab ${claim.tabIndex} of agentWindow
  if (do JavaScript "window.name" in candidateTab) is not "${claim.ownershipMarker}" then error "ownership changed"
  return URL of candidateTab
end tell`);
        return { tabIndex: claim.tabIndex, url, windowId: claim.windowId };
      });
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
      if (mode !== 'claim-only') {
        throw new Error('Safari setup full/reset is disabled; use claim-only so service coordinators enforce ownership and tab caps');
      }
      const flag = '--claim';
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
      const tabs = (await listOwnedTabs()).map(ownedTab => {
        const { url } = ownedTab;
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
        return { ...ownedTab, platform, loggedIn, loginPage };
      });

      const loggedInCount = tabs.filter(t => t.loggedIn && t.platform !== 'unknown' && t.platform !== 'blank').length;
      const needsLogin = tabs.filter(t => t.loginPage);
      result = { tabs, loggedIn: loggedInCount, needsLogin: needsLogin.map(t => ({ index: t.index, windowId: t.windowId, platform: t.platform, url: t.url })) };
      break;
    }

    case 'safari_w2_clear_stale': {
      throw new Error('Direct claim-registry writes are disabled; TabCoordinator removes stale claims under the shared fcntl lock');
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
