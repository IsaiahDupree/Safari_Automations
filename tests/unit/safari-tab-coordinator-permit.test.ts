import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TabCoordinator } from '../../packages/linkedin-automation/src/automation/tab-coordinator.js';

describe('Safari coordinator human-presence gate', () => {
  let directory = '';
  let stateFile = '';
  let drainFile = '';
  let originalNodeEnv: string | undefined;
  let originalOverride: string | undefined;
  let originalDrainOverride: string | undefined;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'safari-coordinator-permit-test-'));
    stateFile = join(directory, 'human-presence.json');
    drainFile = join(directory, 'drain-state.json');
    const now = Date.now();
    await writeFile(stateFile, JSON.stringify({
      version: 1,
      updated_at: new Date(now).toISOString(),
      observed_at: now / 1000,
      source_available: true,
      frontmost_app: 'Safari',
      idle_seconds: 0,
      browser_foreground: { chrome: false, safari: true },
      human_recent: true,
      active: { chrome: false, safari: true },
      manual_hold_until: { chrome: 0, safari: 0 },
      restart_allowed: { chrome: false, safari: false },
      retry_after_seconds: { chrome: 5, safari: 5 },
    }));
    await writeFile(drainFile, JSON.stringify({
      version: 1,
      updated_at: new Date(now).toISOString(),
      draining: { chrome: false, safari: false },
      retry_after_seconds: { chrome: 0, safari: 0 },
    }));
    originalNodeEnv = process.env.NODE_ENV;
    originalOverride = process.env.SAFARI_HUMAN_PRESENCE_STATE_FILE;
    originalDrainOverride = process.env.SAFARI_BROWSER_DRAIN_STATE_FILE;
    process.env.NODE_ENV = 'test';
    process.env.SAFARI_HUMAN_PRESENCE_STATE_FILE = stateFile;
    process.env.SAFARI_BROWSER_DRAIN_STATE_FILE = drainFile;
  });

  afterAll(async () => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalOverride === undefined) delete process.env.SAFARI_HUMAN_PRESENCE_STATE_FILE;
    else process.env.SAFARI_HUMAN_PRESENCE_STATE_FILE = originalOverride;
    if (originalDrainOverride === undefined) delete process.env.SAFARI_BROWSER_DRAIN_STATE_FILE;
    else process.env.SAFARI_BROWSER_DRAIN_STATE_FILE = originalDrainOverride;
    await rm(directory, { recursive: true, force: true });
  });

  it('blocks a claim during a manual hold before querying or changing Safari', async () => {
    const now = Date.now();
    const value = JSON.parse(await import('node:fs/promises').then(fs => fs.readFile(stateFile, 'utf8')));
    value.updated_at = new Date(now).toISOString();
    value.observed_at = now / 1000;
    value.manual_hold_until.safari = now / 1000 + 60;
    await writeFile(stateFile, JSON.stringify(value));
    const coordinator = new TabCoordinator('permit-test', 'linkedin', 3105, 'linkedin.com');
    await expect(coordinator.claim()).rejects.toMatchObject({
      code: 'human_active',
      mode: 'background',
    });
    value.manual_hold_until.safari = 0;
    value.updated_at = new Date().toISOString();
    value.observed_at = Date.now() / 1000;
    await writeFile(stateFile, JSON.stringify(value));
  });

  it('blocks new-tab allocation before querying or changing Safari', async () => {
    const coordinator = new TabCoordinator('permit-test', 'linkedin', 3105, 'linkedin.com');
    await expect(coordinator.openNewTab('https://www.linkedin.com/')).rejects.toMatchObject({
      code: 'human_active',
      mode: 'interactive',
    });
  });
});
