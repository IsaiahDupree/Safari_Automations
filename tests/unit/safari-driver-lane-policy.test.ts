import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DRIVER_FILES = [
  'packages/instagram-dm/src/automation/safari-driver.ts',
  'packages/twitter-dm/src/automation/safari-driver.ts',
  'packages/tiktok-dm/src/automation/safari-driver.ts',
  'packages/linkedin-automation/src/automation/safari-driver.ts',
  'packages/instagram-comments/src/automation/safari-driver.ts',
  'packages/instagram-comments/src/automation/instagram-driver.ts',
  'packages/tiktok-comments/src/automation/safari-driver.ts',
  'packages/tiktok-comments/src/automation/tiktok-driver.ts',
  'packages/twitter-comments/src/automation/safari-driver.ts',
  'packages/twitter-comments/src/automation/twitter-driver.ts',
  'packages/threads-comments/src/automation/safari-driver.ts',
  'packages/threads-comments/src/automation/threads-driver.ts',
  'packages/upwork-automation/src/automation/safari-driver.ts',
  'packages/medium-automation/src/automation/safari-driver.ts',
  'packages/facebook-comments/src/automation/facebook-driver.ts',
  'packages/facebook-comments/src/automation/facebook-researcher.ts',
] as const;

const STABLE_CLAIM_DRIVERS = [
  ['packages/instagram-dm/src/automation/safari-driver.ts', 'packages/instagram-dm/src/api/server.ts'],
  ['packages/tiktok-dm/src/automation/safari-driver.ts', 'packages/tiktok-dm/src/api/server.ts'],
  ['packages/twitter-dm/src/automation/safari-driver.ts', 'packages/twitter-dm/src/api/server.ts'],
  ['packages/instagram-comments/src/automation/instagram-driver.ts', 'packages/instagram-comments/src/api/server.ts'],
  ['packages/instagram-comments/src/automation/safari-driver.ts', 'packages/instagram-comments/src/api/server.ts'],
  ['packages/tiktok-comments/src/automation/tiktok-driver.ts', 'packages/tiktok-comments/src/api/server.ts'],
  ['packages/twitter-comments/src/automation/twitter-driver.ts', 'packages/twitter-comments/src/api/server.ts'],
  ['packages/twitter-comments/src/automation/safari-driver.ts', 'packages/twitter-comments/src/api/server.ts'],
  ['packages/threads-comments/src/automation/threads-driver.ts', 'packages/threads-comments/src/api/server.ts'],
  ['packages/threads-comments/src/automation/safari-driver.ts', 'packages/threads-comments/src/api/server.ts'],
  ['packages/linkedin-automation/src/automation/safari-driver.ts', 'packages/linkedin-automation/src/api/server.ts'],
  ['packages/upwork-automation/src/automation/safari-driver.ts', 'packages/upwork-automation/src/api/server.ts'],
  ['packages/facebook-comments/src/automation/facebook-driver.ts', 'packages/facebook-comments/src/api/server.ts'],
] as const;

const TRANSACTIONAL_DRIVERS = [
  'packages/instagram-dm/src/automation/safari-driver.ts',
  'packages/twitter-dm/src/automation/safari-driver.ts',
  'packages/tiktok-dm/src/automation/safari-driver.ts',
  'packages/instagram-comments/src/automation/safari-driver.ts',
  'packages/instagram-comments/src/automation/instagram-driver.ts',
  'packages/tiktok-comments/src/automation/tiktok-driver.ts',
  'packages/twitter-comments/src/automation/safari-driver.ts',
  'packages/twitter-comments/src/automation/twitter-driver.ts',
  'packages/threads-comments/src/automation/safari-driver.ts',
  'packages/threads-comments/src/automation/threads-driver.ts',
  'packages/upwork-automation/src/automation/safari-driver.ts',
  'packages/facebook-comments/src/automation/facebook-driver.ts',
  'packages/facebook-comments/src/automation/facebook-researcher.ts',
  'packages/sora-automation/src/automation/safari-driver.ts',
] as const;

function asyncMethodBodies(source: string): string[] {
  const starts = [...source.matchAll(/^  (?:private\s+)?async\s+[A-Za-z_$][\w$]*[^\n]*\{/gm)]
    .map(match => match.index ?? 0);
  return starts.map((start, index) => source.slice(start, starts[index + 1] ?? source.length));
}

describe('Safari production driver lane policy', () => {
  it('guards every foreground/tab-focus/native-input method in the nine-service hot path', async () => {
    for (const relativePath of DRIVER_FILES) {
      const source = await readFile(join(REPO_ROOT, relativePath), 'utf8');
      expect(source, relativePath).toContain('safari-lane-client.js');
      for (const body of asyncMethodBodies(source)) {
        const performsForegroundOrInput =
          /tell application "Safari" to activate/.test(body) ||
          /set frontmost of process "Safari"/.test(body) ||
          /set current tab of/.test(body) ||
          /tell application "System Events"[\s\S]{0,300}\bkeystroke\b/.test(body) ||
          /^\s*key code \d+/m.test(body) ||
          /^\s*click at \{/m.test(body) ||
          /Quartz\.CGEventPost/.test(body) ||
          /\bcliclick\b/.test(body);
        if (!performsForegroundOrInput) continue;
        expect(
          /withSafariForegroundInput\s*\(|withClaimedSafariInput\s*\(|guardedOsInput\s*\(|requireSafariPermit\('interactive'\)|runClaimedSafariAppleScript\([^;]+['"]interactive['"]/.test(body),
          `${relativePath} contains an unguarded foreground/input method:\n${body.slice(0, 500)}`,
        ).toBe(true);
      }
    }
  });

  it('revalidates the exact live ownership marker before every direct Safari action', async () => {
    for (const relativePath of DRIVER_FILES) {
      const source = await readFile(join(REPO_ROOT, relativePath), 'utf8');
      for (const body of asyncMethodBodies(source)) {
        const directSafariAction = /tell application "Safari"|tell application \\"Safari\\"/.test(body) &&
          /do JavaScript|set URL of|get URL of|current tab|activate/.test(body) &&
          /execAsync|execFileAsync|runAppleScript|runAS/.test(body);
        if (!directSafariAction) continue;
        expect(
          /requireSafariPermit\('(background|interactive)'\)|requireSafariBackgroundPermit\(\)|withSafariForegroundInput\(|withClaimedSafariInput\(|guardedOsInput\(/.test(body),
          `${relativePath} contains a direct Safari action without the shared claim-binding gate:\n${body.slice(0, 600)}`,
        ).toBe(true);
      }
    }
    const laneClient = await readFile(join(REPO_ROOT, 'packages/shared/safari-lane-client.ts'), 'utf8');
    expect(laneClient).toContain('validateLiveProcessClaimBindings(false)');
    expect(laneClient).toContain('claim_binding_invalid');
    expect(laneClient).toContain('actual.tabIndex !== tabIndex');
    expect(laneClient).toContain('liveOwnershipMarker is not "${target.ownershipMarker}"');
    expect(laneClient.indexOf('liveOwnershipMarker is not')).toBeLessThan(laneClient.indexOf('${actionBody}'));
  });

  it('runs converted driver actions through one marker-bound AppleScript transaction', async () => {
    for (const relativePath of TRANSACTIONAL_DRIVERS) {
      const source = await readFile(join(REPO_ROOT, relativePath), 'utf8');
      expect(source, relativePath).toContain('runClaimedSafariAppleScript');
      expect(source, relativePath).not.toMatch(/tell application "Safari"|tell application \\"Safari\\"/);
    }
  });

  it('never falls back from an owned tab to the human front document', async () => {
    for (const relativePath of DRIVER_FILES) {
      const source = await readFile(join(REPO_ROOT, relativePath), 'utf8');
      expect(source, relativePath).not.toMatch(/:\s*['`]front document['`]/);
      expect(source, relativePath).not.toContain('to get URL of front document');
      expect(source, relativePath).not.toMatch(/:\s*['`]current tab of front window['`]/);
      expect(source, relativePath).toMatch(/Window 2|window 2/);
      expect(source, relativePath).toMatch(/requireSafariPermit\('background'\)|runClaimedSafariAppleScript/);
    }
  });

  it('pins every reachable foreground driver to the claim stable window ID', async () => {
    for (const [driverPath, serverPath] of STABLE_CLAIM_DRIVERS) {
      const driver = await readFile(join(REPO_ROOT, driverPath), 'utf8');
      const server = await readFile(join(REPO_ROOT, serverPath), 'utf8');
      expect(driver, driverPath).toMatch(/trackedWindowId/);
      expect(driver, driverPath).toContain('runClaimedSafariAppleScript');
      expect(driver, driverPath).toMatch(/Number\.isInteger\(windowId\)/);
      expect(server, serverPath).toMatch(/setTrackedTab\([^\n]+\.windowId\)/);
    }
  });

  it('resolves stable windows and exact markers only in the shared transaction primitive', async () => {
    const shared = await readFile(join(REPO_ROOT, 'packages/shared/safari-lane-client.ts'), 'utf8');
    expect(shared).toContain('set agentWindow to first window whose id is ${target.windowId}');
    expect(shared).toContain('set agentTab to tab ${target.tabIndex} of agentWindow');
    expect(shared).toContain('Safari ownership changed before action');
  });

  it('never targets Window 2 by mutable z-order in live platform drivers', async () => {
    for (const [driverPath] of STABLE_CLAIM_DRIVERS) {
      const driver = await readFile(join(REPO_ROOT, driverPath), 'utf8');
      expect(driver, driverPath).not.toMatch(/tab \$\{(?:this\.)?_?trackedTab\} of window 2/);
      expect(driver, driverPath).not.toMatch(/set agentWindow to window 2/);
    }
  });

  it('gates Sora explicit focus and restores the human lane', async () => {
    const source = await readFile(join(REPO_ROOT, 'packages/sora-automation/src/api/server.ts'), 'utf8');
    const focusBody = source.slice(
      source.indexOf('async function focusManagedSafari'),
      source.indexOf('async function ensureTabClaim'),
    );
    expect(focusBody).toContain('await requireSafariInteractivePermit()');
    expect(focusBody).toContain('await withSafariForegroundInput(');
    expect(focusBody).toContain('claim.windowIndex !== 2');
  });

  it('keeps Medium background-only and fails closed on every focus API', async () => {
    const value = await readFile(join(REPO_ROOT, 'packages/medium-automation/src/automation/safari-driver.ts'), 'utf8');
    expect(value).not.toContain('URL of front document');
    expect(value).not.toContain('current tab of front window');
    for (const method of ['_switchToTab', 'activateTab', 'activateSafari']) {
      const start = value.indexOf(`async ${method}`);
      const end = value.indexOf('\n  }', start) + 4;
      const body = value.slice(start, end);
      expect(body, method).toContain('return false');
      expect(body, method).not.toMatch(/\bactivate\b|frontmost|set current tab/);
    }
  });
});
