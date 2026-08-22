import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const COMMON_PACKAGES = [
  'facebook-comments',
  'instagram-comments',
  'instagram-dm',
  'linkedin-automation',
  'medium-automation',
  'sora-automation',
  'threads-comments',
  'tiktok-comments',
  'tiktok-dm',
  'twitter-comments',
  'twitter-dm',
  'upwork-automation',
] as const;
const ALL_PACKAGES = [...COMMON_PACKAGES, 'market-research'] as const;
const RESPONSE_SCOPED_SERVERS = [
  'facebook-comments',
  'instagram-comments',
  'instagram-dm',
  'linkedin-automation',
  'market-research',
  'medium-automation',
  'threads-comments',
  'tiktok-comments',
  'tiktok-dm',
  'twitter-comments',
  'twitter-dm',
  'upwork-automation',
] as const;
const BROWSER_STATUS_SERVERS = [
  ['facebook-comments', '/api/facebook/status'],
  ['instagram-comments', '/api/instagram/status'],
  ['linkedin-automation', '/api/linkedin/status'],
  ['medium-automation', '/api/medium/status'],
  ['threads-comments', '/api/threads/status'],
  ['tiktok-comments', '/api/tiktok/status'],
  ['tiktok-dm', '/api/tiktok/status'],
  ['twitter-comments', '/api/twitter/status'],
  ['twitter-dm', '/api/twitter/status'],
  ['upwork-automation', '/api/upwork/status'],
] as const;
const MANUAL_HEARTBEAT_SERVERS = [
  'instagram-comments',
  'instagram-dm',
  'linkedin-automation',
  'market-research',
  'threads-comments',
  'tiktok-comments',
  'tiktok-dm',
  'twitter-comments',
  'twitter-dm',
  'upwork-automation',
] as const;

async function coordinatorSource(packageName: string): Promise<string> {
  return readFile(
    join(REPO_ROOT, 'packages', packageName, 'src', 'automation', 'tab-coordinator.ts'),
    'utf8',
  );
}

describe('Safari coordinator lane policy', () => {
  it('is installed in all 13 Safari tab coordinators', async () => {
    const sources = await Promise.all(ALL_PACKAGES.map(coordinatorSource));
    expect(sources).toHaveLength(13);
    for (const source of sources) {
      expect(source).toContain('MAX_AGENT_OWNED_TABS = 4');
      expect(source).toContain("requireSafariLanePermit('interactive')");
      expect(source).toContain('agentOwned: true');
      expect(source).toContain('AGENT_TAB_MARKER_PREFIX');
      expect(source).toContain('Human tabs are never adopted implicitly');
      expect(source).toContain('return 2;');
      expect(source).toContain('findReusableOwnedTab');
      expect(source).toContain('heartbeat cannot recreate it');
      expect(source).toContain('Safari window cap exceeded (2)');
      expect(source).toContain("'/tmp/safari-tab-claims.lock'");
      expect(source).toContain("'/tmp/safari-tab-ownership.json'");
      expect(source).toContain('ownershipMarker: string');
      expect(source).toContain('beginRequestOperation');
      expect(source).toContain('reconcileOwnership');
      expect(source).not.toMatch(/\bactivate\b/);
      expect(source).not.toContain('make new window');
    }
  });

  it('keeps the 12 common coordinators byte-identical', async () => {
    const sources = await Promise.all(COMMON_PACKAGES.map(coordinatorSource));
    for (const source of sources.slice(1)) expect(source).toBe(sources[0]);
  });

  it('recycles only an unlocked stable-id tab whose ownership marker is verified under the claim lock', async () => {
    for (const packageName of ALL_PACKAGES) {
      const value = await coordinatorSource(packageName);
      const allocation = value.slice(value.indexOf('async openNewTab'), value.indexOf('private async findReusableOwnedTab'));
      const reuse = value.slice(value.indexOf('private async findReusableOwnedTab'), value.indexOf('private buildClaim'));
      expect(allocation, packageName).toContain('this.withClaimsLock(async () =>');
      expect(allocation, packageName).toContain('const claims = await TabCoordinator.readClaimsStrict()');
      expect(allocation, packageName).toContain('this.findReusableOwnedTab(claims, ownership)');
      expect(allocation, packageName).toContain('this.reconcileOwnership(ownership, claims)');
      expect(allocation, packageName).toMatch(
        /live HID immediately before that operation[\s\S]{0,180}await requireInteractiveLanePermit\(\);[\s\S]{0,80}try \{/,
      );
      expect(reuse, packageName).toContain('existing.windowId === candidate.windowId');
      expect(reuse, packageName).toContain('!claimed(candidate)');
      expect(reuse, packageName).toContain('first window whose id is ${windowId}');
      expect(reuse, packageName).toContain('window.name');
      expect(reuse, packageName).toContain('Refusing to recycle an unowned Safari tab');
      expect(reuse, packageName).toContain('entry?.windowId === candidate.windowId');
      expect(reuse, packageName).toContain('Live Safari operation marker disappeared or moved');
      expect(reuse.indexOf('Refusing to recycle an unowned Safari tab')).toBeLessThan(reuse.indexOf('set URL of candidateTab'));
    }
  });

  it('preserves market-research URL validation differences', async () => {
    const market = await coordinatorSource('market-research');
    expect(market).toContain('export function urlMatchesPattern');
    expect(market).toContain('url = await this.readTabUrl(windowIndex, tabIndex, windowId)');
    expect(market).toContain('private async readTabUrl');
  });

  it('binds production Safari requests and post-response jobs to real operation leases', async () => {
    for (const packageName of RESPONSE_SCOPED_SERVERS) {
      const source = await readFile(
        join(REPO_ROOT, 'packages', packageName, 'src', 'api', 'server.ts'),
        'utf8',
      );
      expect(source, packageName).toContain('beginRequestOperation(res)');
      expect(source, packageName).toContain('ensureOwnedTab');
      expect(source, packageName).toContain('operationLease: false');
    }

    const market = await readFile(
      join(REPO_ROOT, 'packages/market-research/src/api/server.ts'),
      'utf8',
    );
    expect(market.match(/beginBackgroundSafariOperation\(`/g)).toHaveLength(3);
    expect(market.match(/await backgroundOperation\.finish\(\)/g)).toHaveLength(3);
    expect(market).toContain('await coordinator.beginOperation()');
    expect(market).toContain('await coordinator.endOperation()');
    expect(market).toContain('}, 15_000)');

    const linkedIn = await readFile(
      join(REPO_ROOT, 'packages/linkedin-automation/src/api/server.ts'),
      'utf8',
    );
    const startupCheck = linkedIn.slice(linkedIn.indexOf('// Startup selector configuration check'));
    expect(startupCheck).not.toContain('executeJS');
    expect(startupCheck).not.toContain('getDefaultDriver');

    const sora = await readFile(
      join(REPO_ROOT, 'packages/sora-automation/src/api/server.ts'),
      'utf8',
    );
    const executeCommand = sora.slice(sora.indexOf('async function executeCommand'), sora.indexOf('// ─── Routes'));
    expect(executeCommand).toContain('await operationCoord.beginOperation()');
    expect(executeCommand).toContain('operationCoord?.heartbeat()');
    expect(executeCommand).toContain('await operationCoord.endOperation()');
  });

  it('never exempts browser-touching status routes or extends retired manual leases', async () => {
    for (const [packageName, statusPath] of BROWSER_STATUS_SERVERS) {
      const value = await readFile(
        join(REPO_ROOT, 'packages', packageName, 'src', 'api', 'server.ts'),
        'utf8',
      );
      const exempt = value.match(/const CLAIM_EXEMPT = ([^;]+);/)?.[1] ?? '';
      const pattern = new RegExp(exempt.slice(1, exempt.lastIndexOf('/')));
      expect(pattern.test(statusPath), `${packageName} status must acquire a claim`).toBe(false);
    }
    for (const packageName of MANUAL_HEARTBEAT_SERVERS) {
      const value = await readFile(
        join(REPO_ROOT, 'packages', packageName, 'src', 'api', 'server.ts'),
        'utf8',
      );
      const heartbeatStart = value.indexOf("app.post('/api/tabs/heartbeat'");
      const heartbeat = value.slice(
        heartbeatStart,
        value.indexOf('\n});', heartbeatStart) + 4,
      );
      expect(heartbeatStart, packageName).toBeGreaterThanOrEqual(0);
      expect(heartbeat, packageName).toContain('status(410)');
      expect(heartbeat, packageName).toContain('operationLease: false');
      expect(heartbeat, packageName).not.toContain('coord.heartbeat()');
    }
  });
});
