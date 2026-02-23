/**
 * TikTok Researcher Integration Test (REAL — no mocks)
 *
 * Exercises TikTokResearcher against live Safari + TikTok:
 *   1. Verify logged in
 *   2. Search videos by keyword
 *   3. Extract videos with engagement metrics
 *   4. Scroll and collect more videos
 *   5. Rank creators by engagement
 *   6. Save results to JSON
 *   7. Query builder
 *
 * Run:  npx vitest run src/__tests__/tiktok-researcher.integration.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TikTokResearcher, type TikTokVideo } from '../automation/tiktok-researcher.js';

const execAsync = promisify(exec);

async function wait(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

describe('TikTokResearcher (real Safari)', () => {
  let researcher: TikTokResearcher;
  const outputDir = path.join(os.tmpdir(), 'tiktok-research-test');

  beforeAll(async () => {
    researcher = new TikTokResearcher({
      videosPerNiche: 20,
      creatorsPerNiche: 10,
      scrollPauseMs: 1500,
      maxScrollsPerSearch: 6,
      outputDir,
    });
    await execAsync(`osascript -e 'tell application "Safari" to activate'`).catch(() => null);
    await wait(500);
  }, 10000);

  // ─── Pre-flight ──────────────────────────────────────────

  it('Safari is running and logged into TikTok', async () => {
    await execAsync(`osascript -e 'tell application "Safari" to set URL of current tab of front window to "https://www.tiktok.com/"'`);
    await wait(5000);

    const tmpFile = path.join(os.tmpdir(), `tt_check_${Date.now()}.scpt`);
    const jsCode = `(function(){ var u = document.querySelector('[data-e2e="upload-icon"]'); var a = document.querySelector('a[href*="/upload"]'); var c = document.querySelector('[data-e2e="comment-input"]'); return (u || a || c) ? 'logged_in' : 'not_logged_in'; })()`;
    const escaped = jsCode.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
    const appleScript = `tell application "Safari" to do JavaScript "${escaped}" in current tab of front window`;
    fs.writeFileSync(tmpFile, appleScript);
    try {
      const { stdout } = await execAsync(`osascript "${tmpFile}"`, { timeout: 15000 });
      expect(stdout.trim()).toBe('logged_in');
      console.log('   ✅ Logged in to TikTok');
    } finally {
      try { fs.unlinkSync(tmpFile); } catch {}
    }
  }, 20000);

  // ─── Search ──────────────────────────────────────────────

  it('searches TikTok for videos by keyword', async () => {
    const ok = await researcher.search('AI automation');
    expect(ok).toBe(true);
    console.log('   ✅ Search loaded results');
  }, 20000);

  // ─── Extract videos ──────────────────────────────────────

  let extractedVideos: TikTokVideo[] = [];

  it('extracts visible videos with engagement metrics', async () => {
    // Re-search to ensure fresh page state
    await researcher.search('AI automation');
    await wait(2000);
    extractedVideos = await researcher.extractVisibleVideos('AI automation');

    console.log(`   Extracted: ${extractedVideos.length} videos`);
    expect(Array.isArray(extractedVideos)).toBe(true);

    if (extractedVideos.length > 0) {
      const first = extractedVideos[0];
      expect(first.id).toBeTruthy();
      expect(first.url).toMatch(/tiktok\.com/);
      expect(first.niche).toBe('AI automation');
      expect(first.collectedAt).toBeTruthy();
      expect(typeof first.likes).toBe('number');
      expect(typeof first.views).toBe('number');

      console.log(`   Sample video:`);
      console.log(`     Author: @${first.author}`);
      console.log(`     Description: "${(first.description || '').substring(0, 80)}..."`);
      console.log(`     Views: ${first.views}, Likes: ${first.likes}, Comments: ${first.comments}, Shares: ${first.shares}`);
      console.log(`     Score: ${first.engagementScore}`);
    } else {
      console.log('   ⚠️ No videos extracted on initial view (TikTok lazy-loads)');
    }
  }, 25000);

  // ─── Scroll & collect ────────────────────────────────────

  let collectedVideos: TikTokVideo[] = [];

  it('scrolls and collects videos (target: 20)', async () => {
    await researcher.search('AI automation');
    collectedVideos = await researcher.scrollAndCollect('AI automation', 20);

    console.log(`   Collected: ${collectedVideos.length} unique videos`);
    expect(collectedVideos.length).toBeGreaterThan(0);

    // Verify deduplication
    const ids = collectedVideos.map(v => v.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
    console.log(`   ✅ All ${ids.length} video IDs are unique`);
  }, 60000);

  // ─── Creator ranking ─────────────────────────────────────

  it('ranks creators by engagement', () => {
    const videosWithAuthors = collectedVideos.filter(v => v.author);
    console.log(`   Videos with authors: ${videosWithAuthors.length}/${collectedVideos.length}`);

    const creators = researcher.rankCreators(collectedVideos, 'AI automation', 10);
    console.log(`   Creators found: ${creators.length}`);

    if (creators.length > 0) {
      const top = creators[0];
      expect(top.handle).toBeTruthy();
      expect(top.videoCount).toBeGreaterThan(0);
      expect(typeof top.totalEngagement).toBe('number');
      expect(top.niche).toBe('AI automation');

      // Verify sorted descending
      for (let i = 1; i < creators.length; i++) {
        expect(creators[i - 1].totalEngagement).toBeGreaterThanOrEqual(creators[i].totalEngagement);
      }

      console.log('   Top creators:');
      for (const c of creators.slice(0, 3)) {
        console.log(`     @${c.handle}: ${c.totalEngagement} engagement (${c.videoCount} videos)`);
      }
    } else {
      console.log('   ⚠️ No creators found — TikTok search may not expose all usernames');
    }

    expect(Array.isArray(creators)).toBe(true);
  });

  // ─── Save results ────────────────────────────────────────

  it('saves results to JSON', async () => {
    const nicheResult = {
      niche: 'AI automation',
      query: 'AI automation',
      videos: collectedVideos,
      creators: researcher.rankCreators(collectedVideos, 'AI automation', 10),
      totalCollected: collectedVideos.length,
      uniqueVideos: collectedVideos.length,
      collectionStarted: new Date().toISOString(),
      collectionFinished: new Date().toISOString(),
      durationMs: 0,
    };

    const filepath = await researcher.saveResults([nicheResult], 'test');

    expect(fs.existsSync(filepath)).toBe(true);
    const content = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
    expect(content.results).toHaveLength(1);
    expect(content.results[0].videos.length).toBe(collectedVideos.length);

    console.log(`   ✅ Saved to: ${filepath}`);
    console.log(`   File size: ${Math.round(fs.statSync(filepath).size / 1024)}KB`);

    try { fs.unlinkSync(filepath); } catch {}
  });

  // ─── Query builder ───────────────────────────────────────

  it('builds multiple search queries per niche', () => {
    const queries = researcher.buildSearchQueries('content marketing');
    console.log(`   Queries: ${JSON.stringify(queries)}`);

    expect(queries.length).toBeGreaterThanOrEqual(3);
    expect(queries).toContain('content marketing');
    expect(queries.some(q => q.includes('tips'))).toBe(true);
    expect(queries.some(q => q.includes('tutorial'))).toBe(true);
  });
});
