/**
 * LinkedIn Chrome MCP — Full tool test suite
 * Spawns the MCP server, sends JSON-RPC tool calls, reports pass/fail.
 * Usage: npx tsx test-all.ts
 */

import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname2 = typeof __dirname !== 'undefined' ? __dirname : dirname(fileURLToPath(import.meta.url));
const SERVER = join(__dirname2, 'src/api/mcp-server.ts');
const TIMEOUT_MS = 60_000;

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

interface RpcResponse { jsonrpc: string; id: number; result?: unknown; error?: { code: number; message: string } }

// ─── Test cases ────────────────────────────────────────────────────────────
// Tests are ordered from safe read-only → writes w/ dryRun=true
const TESTS: Array<{ name: string; tool: string; args: Record<string, unknown>; expectField?: string; skipIf?: string }> = [
  // Preflight
  { name: 'linkedin_is_ready', tool: 'linkedin_is_ready', args: {}, expectField: 'ready' },
  { name: 'linkedin_get_status', tool: 'linkedin_get_status', args: {}, expectField: 'currentUrl' },

  // Navigation
  { name: 'linkedin_navigate (feed)', tool: 'linkedin_navigate', args: { url: 'https://www.linkedin.com/feed/' } },

  // Screenshot & JS eval
  { name: 'linkedin_take_screenshot', tool: 'linkedin_take_screenshot', args: {}, expectField: 'screenshot' },
  { name: 'linkedin_evaluate_js', tool: 'linkedin_evaluate_js', args: { script: 'window.location.hostname' }, expectField: 'result' },

  // Wait for selector
  { name: 'linkedin_wait_for', tool: 'linkedin_wait_for', args: { selector: 'body', timeoutMs: 5000 }, expectField: 'found' },

  // Feed
  { name: 'linkedin_get_feed', tool: 'linkedin_get_feed', args: { limit: 3 } },

  // My profile
  { name: 'linkedin_get_my_profile', tool: 'linkedin_get_my_profile', args: {}, expectField: 'name' },

  // Notifications
  { name: 'linkedin_get_notifications', tool: 'linkedin_get_notifications', args: { limit: 5 } },

  // Search
  { name: 'linkedin_search_people', tool: 'linkedin_search_people', args: { query: 'founder startup', maxResults: 5 }, expectField: 'profiles' },

  // Get profile
  { name: 'linkedin_get_profile', tool: 'linkedin_get_profile', args: { profileUrl: 'https://www.linkedin.com/in/williamhgates/' }, expectField: 'name' },

  // Score profile
  { name: 'linkedin_score_profile', tool: 'linkedin_score_profile', args: { profileUrl: 'https://www.linkedin.com/in/williamhgates/', icp: { targetTitle: 'CEO', targetLocation: 'Seattle' } }, expectField: 'score' },

  // Company
  { name: 'linkedin_get_company', tool: 'linkedin_get_company', args: { companyUrl: 'https://www.linkedin.com/company/microsoft/' }, expectField: 'name' },

  // Conversations
  { name: 'linkedin_list_conversations', tool: 'linkedin_list_conversations', args: { limit: 5 }, expectField: 'conversations' },

  // Network requests
  { name: 'linkedin_get_network_requests (start capture)', tool: 'linkedin_get_network_requests', args: { startCapture: true, filter: 'linkedin.com' }, expectField: 'requests' },

  // CRM lookup
  { name: 'linkedin_crm_get_contact', tool: 'linkedin_crm_get_contact', args: { username: 'williamhgates' }, expectField: 'found' },

  // Post comments (public post)
  { name: 'linkedin_get_post_comments', tool: 'linkedin_get_post_comments', args: { postUrl: 'https://www.linkedin.com/feed/', limit: 3 } },

  // Debug click (safe — click somewhere harmless on current page)
  { name: 'linkedin_debug_click', tool: 'linkedin_debug_click', args: { x: 100, y: 100 }, expectField: 'clicked' },

  // Accept connections (read-only if 0 pending)
  { name: 'linkedin_accept_connections (maxAccept=0)', tool: 'linkedin_accept_connections', args: { maxAccept: 0 }, expectField: 'accepted' },

  // Pipeline (dryRun)
  { name: 'linkedin_run_pipeline (dryRun)', tool: 'linkedin_run_pipeline', args: { searchQuery: 'founder saas', niche: 'SaaS founder', maxProspects: 3, dryRun: true }, expectField: 'dryRun' },

  // Write tools — all dryRun=true
  { name: 'linkedin_send_connection (dryRun)', tool: 'linkedin_send_connection', args: { profileUrl: 'https://www.linkedin.com/in/williamhgates/', dryRun: true }, expectField: 'dryRun' },
  { name: 'linkedin_send_message (dryRun)', tool: 'linkedin_send_message', args: { profileUrl: 'https://www.linkedin.com/in/williamhgates/', text: 'Hello from MCP test', dryRun: true }, expectField: 'dryRun' },
  { name: 'linkedin_like_post (dryRun)', tool: 'linkedin_like_post', args: { postUrl: 'https://www.linkedin.com/feed/', dryRun: true }, expectField: 'dryRun' },
  { name: 'linkedin_comment_post (dryRun)', tool: 'linkedin_comment_post', args: { postUrl: 'https://www.linkedin.com/feed/', text: 'Test comment', dryRun: true }, expectField: 'dryRun' },
];

// ─── Runner ────────────────────────────────────────────────────────────────

async function runTests() {
  console.log(`\n${BOLD}${CYAN}═══ LinkedIn Chrome MCP — Tool Test Suite ═══${RESET}\n`);
  console.log(`Server: ${SERVER}`);
  console.log(`Tools to test: ${TESTS.length}\n`);

  // Spawn MCP server
  const proc = spawn('npx', ['tsx', SERVER], { stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '';
  proc.stderr.on('data', d => { stderr += d.toString(); });

  // Wait for startup
  await new Promise(r => setTimeout(r, 2_000));
  if (!proc.pid) { console.error(`${RED}Failed to start MCP server${RESET}`); process.exit(1); }
  console.log(`${GREEN}✓ Server PID ${proc.pid} started${RESET}\n`);

  let id = 1;
  const results: Array<{ name: string; pass: boolean; msg: string; durationMs: number }> = [];

  const send = (method: string, params: unknown): Promise<RpcResponse> => new Promise((resolve, reject) => {
    const msg = JSON.stringify({ jsonrpc: '2.0', id: id++, method, params }) + '\n';
    proc.stdin.write(msg);
    let buf = '';
    const onData = (d: Buffer) => {
      buf += d.toString();
      if (buf.includes('\n')) {
        proc.stdout.off('data', onData);
        try { resolve(JSON.parse(buf.trim())); } catch { reject(new Error('Bad JSON: ' + buf)); }
      }
    };
    proc.stdout.on('data', onData);
    setTimeout(() => { proc.stdout.off('data', onData); reject(new Error('Timeout')); }, TIMEOUT_MS);
  });

  // Initialize
  await send('initialize', { protocolVersion: '2024-11-05', clientInfo: { name: 'test', version: '1.0' } });
  // notifications/initialized is a one-way notification — no response expected
  proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) + '\n');

  // Run each test
  for (const test of TESTS) {
    const start = Date.now();
    let pass = false;
    let msg = '';
    try {
      const res = await send('tools/call', { name: test.tool, arguments: test.args });
      const durationMs = Date.now() - start;
      if (res.error) {
        pass = false;
        msg = `RPC error ${res.error.code}: ${res.error.message}`;
      } else {
        const content = (res.result as { content?: Array<{ text: string }>; isError?: boolean }) || {};
        const isError = content.isError;
        const text = content.content?.[0]?.text || '';
        let parsed: Record<string, unknown> = {};
        try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
        if (isError) {
          pass = false;
          msg = `Tool error: ${text.slice(0, 120)}`;
        } else if (test.expectField && !(test.expectField in parsed)) {
          pass = false;
          msg = `Missing field "${test.expectField}" in: ${text.slice(0, 120)}`;
        } else {
          pass = true;
          msg = test.expectField ? `${test.expectField}=${JSON.stringify(parsed[test.expectField])?.slice(0, 80)}` : 'OK';
        }
      }
      results.push({ name: test.name, pass, msg, durationMs });
      const icon = pass ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
      const timeStr = `${YELLOW}${durationMs}ms${RESET}`;
      console.log(`${icon} ${test.name.padEnd(45)} ${timeStr.padEnd(15)} ${pass ? '' : RED}${msg}${RESET}`);
    } catch (e) {
      const durationMs = Date.now() - start;
      msg = (e as Error).message;
      results.push({ name: test.name, pass: false, msg, durationMs });
      console.log(`${RED}✗${RESET} ${test.name.padEnd(45)} ${YELLOW}${durationMs}ms${RESET}  ${RED}${msg}${RESET}`);
    }
  }

  // Summary
  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass).length;
  const totalMs = results.reduce((a, r) => a + r.durationMs, 0);
  console.log(`\n${BOLD}─────────────────────────────────────────────${RESET}`);
  console.log(`${BOLD}Results: ${GREEN}${passed} passed${RESET} / ${RED}${failed} failed${RESET} / ${results.length} total — ${YELLOW}${totalMs}ms${RESET}`);
  if (failed > 0) {
    console.log(`\n${RED}${BOLD}Failed:${RESET}`);
    results.filter(r => !r.pass).forEach(r => console.log(`  ${RED}✗ ${r.name}: ${r.msg}${RESET}`));
  }
  if (stderr.trim()) {
    console.log(`\n${YELLOW}Server stderr:${RESET}\n${stderr.trim()}`);
  }

  proc.kill();
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(e => { console.error(RED + 'Fatal: ' + e.message + RESET); process.exit(1); });
