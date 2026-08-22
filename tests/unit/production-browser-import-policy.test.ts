import { describe, expect, it } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RAW_ENGINE = [
  /(?:from\s+|import\s*\(\s*)['"]puppeteer(?:-core|-extra)?['"]/,
  /\bpuppeteer(?:\.default)?\.connect\s*\(/,
  /\b(?:browser|b)\.pages\s*\(/,
  /\b(?:browser|b)\.newPage\s*\(/,
  /browserURL\s*:\s*['"]http:\/\/(?:localhost|127\.0\.0\.1):9222/,
  /fetch\s*\([^)]*(?:localhost|127\.0\.0\.1):9222/,
] as const;

const SOCIAL_SERVICES = [
  'instagram-dm', 'tiktok-dm', 'twitter-dm',
  'instagram-comments', 'tiktok-comments', 'twitter-comments', 'threads-comments',
] as const;

const GUARDED_LEGACY = new Set([
  'apps/api/src/routes/commands.ts',
  'apps/safari-client/src/BrowserAdapter.ts',
  'apps/safari-client/src/InstagramDMSafari.ts',
  'packages/linkedin-automation/src/automation/chrome-tab-coordinator.ts',
  'packages/linkedin-chrome/src/automation/browser.ts',
  'packages/shared/chrome-driver.ts',
]);

async function source(path: string): Promise<string> {
  return readFile(join(ROOT, path), 'utf8');
}

async function walk(path: string): Promise<string[]> {
  const absolute = join(ROOT, path);
  const entries = await readdir(absolute, { withFileTypes: true });
  const output: string[] = [];
  for (const entry of entries) {
    if (['node_modules', 'dist', 'coverage', '__tests__'].includes(entry.name)) continue;
    const child = join(absolute, entry.name);
    if (entry.isDirectory()) output.push(...await walk(relative(ROOT, child)));
    else if (/\.(?:ts|tsx|js|mjs|cjs)$/.test(entry.name) && !/\.(?:test|spec)\./.test(entry.name)) {
      output.push(relative(ROOT, child));
    }
  }
  return output;
}

function rawMatches(value: string): string[] {
  return RAW_ENGINE.filter(pattern => pattern.test(value)).map(pattern => String(pattern));
}

describe('production browser import policy', () => {
  it('keeps every live DM/comment service free of direct Puppeteer/CDP control', async () => {
    for (const service of SOCIAL_SERVICES) {
      for (const file of await walk(`packages/${service}/src`)) {
        expect(rawMatches(await source(file)), file).toEqual([]);
      }
    }
  });

  it('requires an explicit fail-closed gate on every remaining legacy raw engine module', async () => {
    const candidates = [...await walk('packages'), ...await walk('apps')]
      .filter(file => !file.endsWith('setup-profile.ts'));
    const offenders: string[] = [];
    for (const file of candidates) {
      const value = await source(file);
      if (rawMatches(value).length === 0) continue;
      if (!GUARDED_LEGACY.has(file) || !value.includes('RAW_BROWSER_AUTOMATION_DISABLED')) {
        offenders.push(file);
      }
    }
    expect(offenders, `unguarded raw browser modules: ${offenders.join(', ')}`).toEqual([]);
  });

  it('routes all three DM servers through stable Safari claims', async () => {
    for (const service of ['instagram-dm', 'tiktok-dm', 'twitter-dm']) {
      const value = await source(`packages/${service}/src/api/server.ts`);
      expect(value, service).toContain("from '../automation/tab-coordinator.js'");
      expect(value, service).toContain('STABLE_AGENT_ID');
      expect(value, service).toContain('OPEN_URL');
      expect(value, service).toContain('TabCoordinator.listClaims()');
      expect(value, service).toContain('Safari agent lane unavailable');
    }
  });
});
