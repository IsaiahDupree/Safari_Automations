import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

async function source(relativePath: string): Promise<string> {
  return readFile(join(REPO_ROOT, relativePath), 'utf8');
}

const LEGACY_PYTHON_GATES = [
  ['python/market_research/instagram_scraper.py', 'def _run_applescript', 'Legacy direct Safari research', 'subprocess.run'],
  ['python/market_research/facebook_scraper.py', 'def _run_applescript', 'Legacy direct Safari research', 'subprocess.run'],
  ['python/market_research/meta_ad_library.py', 'def _run_applescript', 'Legacy direct Safari research', 'subprocess.run'],
  ['python/market_research/creative_radar.py', 'def _safari_extract_media', 'Legacy direct Safari media extraction', '_sp.run'],
  ['python/automation/safari_sora_scraper.py', 'def run_applescript', 'Legacy direct Safari Sora automation', 'subprocess.run'],
  ['python/automation/safari_instagram_scraper.py', 'def run_applescript', 'Legacy direct Safari Instagram automation', 'subprocess.run'],
  ['python/automation/safari_tiktok_login.py', 'def run_applescript', 'Legacy direct Safari TikTok automation', 'subprocess.run'],
  ['python/automation/safari_twitter_dm.py', 'def _run_applescript', 'Legacy direct Safari Twitter automation', 'subprocess.run'],
  ['python/controllers/safari_controller.py', 'def run_applescript', 'Legacy direct SafariController', 'subprocess.run'],
  ['python/controllers/safari_app_controller.py', 'def _run_applescript', 'Legacy direct Safari app control', 'subprocess.run'],
  ['python/automation/safari_app_controller.py', 'def _run_applescript', 'Legacy direct Safari app control', 'subprocess.run'],
  ['python/controllers/safari_session_manager.py', 'def _run_applescript', 'Legacy direct Safari session inspection', 'subprocess.run'],
  ['python/automation/safari_session_manager.py', 'def _run_applescript', 'Legacy direct Safari session inspection', 'subprocess.run'],
  ['python/automation/safari_extension_bridge.py', 'def _run_applescript', 'Legacy direct Safari extension control', 'subprocess.run'],
  ['python/automation/safari_extension/safari_extension_bridge.py', 'def send_to_extension', 'Legacy direct Safari extension control', 'subprocess.run'],
  ['python/engagement/tiktok_engagement.py', 'def _run_applescript', 'Legacy direct Safari TikTok activity control', 'subprocess.run'],
  ['python/automation/safari_tiktok_cli.py', 'def main', 'Legacy direct Safari TikTok CLI', 'subprocess.run'],
] as const;

describe('production Safari escape-path policy', () => {
  it('fails every legacy Python AppleScript primitive closed before process execution', async () => {
    for (const [relativePath, primitive, guard, processCall] of LEGACY_PYTHON_GATES) {
      const value = await source(relativePath);
      const start = value.indexOf(primitive);
      const guardAt = value.indexOf(guard, start);
      const processAt = value.indexOf(processCall, start);
      expect(start, relativePath).toBeGreaterThanOrEqual(0);
      expect(guardAt, `${relativePath} has no explicit fail-closed guard`).toBeGreaterThan(start);
      expect(processAt, `${relativePath} has no raw-process sentinel`).toBeGreaterThan(start);
      expect(guardAt, `${relativePath} reaches raw Safari before its guard`).toBeLessThan(processAt);
    }
  });

  it('keeps direct setup scripts claim-only and blocks standalone Ad Library control', async () => {
    const setup = await source('scripts/open-local-to-cloud-tabs.sh');
    expect(setup).toContain('if [[ "${1:-}" != "--claim" ]]');
    expect(setup).toContain('WIN=2');
    expect(setup.indexOf('exit 73')).toBeLessThan(setup.indexOf('win_count=$(osascript'));

    const adLibrary = await source('scripts/safari-facebook-ads.applescript');
    const run = adLibrary.indexOf('on run');
    expect(adLibrary.indexOf('error "Direct Safari Ad Library automation', run))
      .toBeLessThan(adLibrary.indexOf('tell application "Safari"', run));
  });

  it('resolves MCP and trending work by live claim, stable window ID, and ownership marker', async () => {
    const mcp = await source('packages/safari-w2-mcp/src/mcp-server.ts');
    const ownedOperation = mcp.slice(mcp.indexOf('async function withOwnedTabOperation'), mcp.indexOf('async function listOwnedTabs'));
    expect(ownedOperation).toContain('coordinator.claim(2, tabIndex)');
    expect(ownedOperation).toContain('coordinator.beginOperation()');
    expect(ownedOperation).toContain('coordinator.endOperation()');
    expect(ownedOperation).toContain('claim.ownershipMarker');
    for (const tool of ['safari_w2_navigate', 'safari_w2_eval', 'safari_w2_activate_tab', 'safari_w2_get_url']) {
      const start = mcp.indexOf(`case '${tool}'`);
      const end = mcp.indexOf('\n    case ', start + 1);
      const body = mcp.slice(start, end < 0 ? undefined : end);
      expect(body, tool).toContain('withOwnedTabOperation(tabIndex');
      expect(body, tool).toContain('claim.windowId');
      expect(body, tool).toContain('claim.ownershipMarker');
    }

    const trending = await source('packages/market-research/src/research-agent/trending-topic-scraper.js');
    expect(trending).toContain('Number.isInteger(item.windowId)');
    expect(trending).toContain('first window whose id is ${claim.windowId}');
    expect(trending).toContain('__ACTP_SAFARI_AGENT_TAB__:');
  });

  it('keeps retired generic services and physical Sora cursor input unreachable', async () => {
    const executor = await source('packages/services/src/safari/safari-executor.ts');
    const primitive = executor.slice(executor.indexOf('async runAppleScript'), executor.indexOf('async ensureSafariReady'));
    expect(primitive).toContain('Legacy SafariExecutor is disabled');
    expect(primitive).not.toContain('execAsync(');
    const clipboard = executor.slice(executor.indexOf('async typeViaClipboard'), executor.indexOf('async pressEnter'));
    expect(clipboard.indexOf('return false')).toBeLessThan(clipboard.indexOf('pbcopy'));

    const controller = await source('apps/safari-client/src/SafariController.ts');
    const controllerPrimitive = controller.slice(controller.indexOf('private async runAppleScript'), controller.indexOf('async executeJS'));
    expect(controllerPrimitive).toContain('Legacy SafariController is disabled');
    expect(controllerPrimitive).not.toContain('execAsync(');

    const sora = await source('packages/services/src/sora/sora-full-automation.ts');
    expect(sora).not.toMatch(/execAsync\(`cliclick/);

    const dormantTikTokDriver = await source('packages/tiktok-comments/src/automation/safari-driver.ts');
    const constructor = dormantTikTokDriver.slice(
      dormantTikTokDriver.indexOf('constructor('),
      dormantTikTokDriver.indexOf("this.config ="),
    );
    expect(constructor).toContain('dormantCompatibilityDriverDisabled()');
    expect(constructor).toContain('RAW_SAFARI_AUTOMATION_DISABLED');
  });
});
