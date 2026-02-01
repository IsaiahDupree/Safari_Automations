/**
 * Source Verification Tests
 * 
 * Verifies that:
 * 1. Media poster scripts are archived and ignored
 * 2. Original TypeScript scripts are being used
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');

describe('Media Poster Scripts (ARCHIVED)', () => {
  const archivedDir = path.join(ROOT, 'python/_archived_media_poster');

  it('should have archived media poster directory', () => {
    expect(fs.existsSync(archivedDir)).toBe(true);
  });

  it('should have .gitignore in archived directory', () => {
    const gitignore = path.join(archivedDir, '.gitignore');
    expect(fs.existsSync(gitignore)).toBe(true);
  });

  it('should contain archived Python poster scripts', () => {
    const expectedFiles = [
      'safari_instagram_poster.py',
      'safari_reddit_poster.py',
      'safari_threads_poster.py',
      'safari_twitter_poster.py',
    ];

    for (const file of expectedFiles) {
      const filePath = path.join(archivedDir, file);
      expect(fs.existsSync(filePath)).toBe(true);
    }
  });

  it('should NOT have poster scripts in active python/automation/', () => {
    const automationDir = path.join(ROOT, 'python/automation');
    const posterScripts = [
      'safari_instagram_poster.py',
      'safari_reddit_poster.py',
      'safari_threads_poster.py',
      'safari_twitter_poster.py',
    ];

    for (const file of posterScripts) {
      const filePath = path.join(automationDir, file);
      expect(fs.existsSync(filePath)).toBe(false);
    }
  });
});

describe('Original TypeScript Scripts (IN USE)', () => {
  const servicesDir = path.join(ROOT, 'packages/services/src');

  it('should have safari-executor.ts', () => {
    const file = path.join(servicesDir, 'safari/safari-executor.ts');
    expect(fs.existsSync(file)).toBe(true);
  });

  it('should have comment-automation.ts', () => {
    const file = path.join(servicesDir, 'automation/comment-automation.ts');
    expect(fs.existsSync(file)).toBe(true);
  });

  it('should have threads adapter', () => {
    const file = path.join(servicesDir, 'comment-engine/adapters/threads.ts');
    expect(fs.existsSync(file)).toBe(true);
  });

  it('should have instagram adapter', () => {
    const file = path.join(servicesDir, 'comment-engine/adapters/instagram.ts');
    expect(fs.existsSync(file)).toBe(true);
  });

  it('should have tiktok adapter', () => {
    const file = path.join(servicesDir, 'comment-engine/adapters/tiktok.ts');
    expect(fs.existsSync(file)).toBe(true);
  });

  it('should have twitter adapter', () => {
    const file = path.join(servicesDir, 'comment-engine/adapters/twitter.ts');
    expect(fs.existsSync(file)).toBe(true);
  });
});

describe('ThreadsDriver References Original TS', () => {
  it('should reference original TypeScript sources in header', () => {
    const driverPath = path.join(
      ROOT,
      'packages/threads-comments/src/automation/threads-driver.ts'
    );
    const content = fs.readFileSync(driverPath, 'utf-8');

    // Should reference original TS sources
    expect(content).toContain('packages/services/src/safari/safari-executor.ts');
    expect(content).toContain('packages/services/src/comment-engine/adapters/threads.ts');

    // Should note archived files are NOT used
    expect(content).toContain('ARCHIVED (NOT USED)');
    expect(content).toContain('python/_archived_media_poster');
  });

  it('should use selectors from original TS adapters', () => {
    // Read original adapters/threads.ts
    const originalPath = path.join(
      ROOT,
      'packages/services/src/comment-engine/adapters/threads.ts'
    );
    const originalContent = fs.readFileSync(originalPath, 'utf-8');

    // Read threads-driver.ts
    const driverPath = path.join(
      ROOT,
      'packages/threads-comments/src/automation/threads-driver.ts'
    );
    const driverContent = fs.readFileSync(driverPath, 'utf-8');

    // Both should have the same key selectors
    const keySelectors = [
      'svg[aria-label="Reply"]',
      '[data-pressable-container="true"]',
      '[contenteditable="true"]',
    ];

    for (const selector of keySelectors) {
      expect(originalContent).toContain(selector);
      expect(driverContent).toContain(selector);
    }
  });
});
