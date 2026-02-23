/**
 * Threads Researcher Integration Test (REAL — no mocks)
 *
 * Exercises ThreadsResearcher against live Safari + Threads:
 *   1. Verify logged in
 *   2. Search a niche query
 *   3. Extract posts with engagement metrics
 *   4. Scroll and collect more posts
 *   5. Rank creators by engagement
 *   6. Save results to JSON
 *
 * Run:  npx vitest run src/__tests__/threads-researcher.integration.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ThreadsResearcher, type ThreadsPost, type ThreadsCreator } from '../automation/threads-researcher.js';

const execAsync = promisify(exec);

async function wait(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

describe('ThreadsResearcher (real Safari)', () => {
  let researcher: ThreadsResearcher;
  const outputDir = path.join(os.tmpdir(), 'threads-research-test');

  beforeAll(async () => {
    researcher = new ThreadsResearcher({
      postsPerNiche: 25,
      creatorsPerNiche: 10,
      scrollPauseMs: 1200,
      maxScrollsPerSearch: 8,
      outputDir,
    });
    await execAsync(`osascript -e 'tell application "Safari" to activate'`).catch(() => null);
    await wait(500);
  }, 10000);

  // ─── Pre-flight ──────────────────────────────────────────

  it('Safari is running and logged into Threads', async () => {
    await execAsync(`osascript -e 'tell application "Safari" to set URL of current tab of front window to "https://www.threads.net"'`);
    await wait(5000);

    const jsFile = path.join(os.tmpdir(), `threads_check_${Date.now()}.js`);
    const scptFile = jsFile.replace('.js', '.scpt');
    const js = `(function(){ var c = document.querySelector('svg[aria-label="Create"]'); var p = document.querySelector('svg[aria-label="Profile"]'); return (c || p) ? 'logged_in' : 'not_logged_in'; })()`;
    fs.writeFileSync(jsFile, js);
    const appleScript = `tell application "Safari"\ntell front document\nset jsCode to read POSIX file "${jsFile}"\ndo JavaScript jsCode\nend tell\nend tell`;
    fs.writeFileSync(scptFile, appleScript);
    try {
      const { stdout } = await execAsync(`osascript "${scptFile}"`, { timeout: 15000 });
      expect(stdout.trim()).toBe('logged_in');
      console.log('   ✅ Logged in to Threads');
    } finally {
      try { fs.unlinkSync(jsFile); } catch {}
      try { fs.unlinkSync(scptFile); } catch {}
    }
  }, 20000);

  // ─── Search ──────────────────────────────────────────────

  it('searches Threads for a niche query', async () => {
    const ok = await researcher.search('AI automation');
    expect(ok).toBe(true);
    console.log('   ✅ Search loaded results');
  }, 20000);

  // ─── Extract posts ───────────────────────────────────────

  let extractedPosts: ThreadsPost[] = [];

  it('extracts visible posts with engagement metrics', async () => {
    extractedPosts = await researcher.extractVisiblePosts('AI automation');

    console.log(`   Extracted: ${extractedPosts.length} posts`);
    expect(extractedPosts.length).toBeGreaterThan(0);

    const first = extractedPosts[0];
    expect(first.id).toBeTruthy();
    expect(first.url).toBeTruthy();
    expect(first.author).toBeTruthy();
    expect(first.text.length).toBeGreaterThan(3);
    expect(first.niche).toBe('AI automation');
    expect(first.collectedAt).toBeTruthy();
    expect(typeof first.likes).toBe('number');
    expect(typeof first.replies).toBe('number');
    expect(typeof first.engagementScore).toBe('number');

    console.log(`   Sample post:`);
    console.log(`     Author: @${first.author}`);
    console.log(`     Text: "${first.text.substring(0, 80)}..."`);
    console.log(`     Engagement: ${first.likes} likes, ${first.replies} replies, ${first.reposts} reposts`);
    console.log(`     Score: ${first.engagementScore}`);
  }, 15000);

  // ─── Scroll & collect ────────────────────────────────────

  let collectedPosts: ThreadsPost[] = [];

  it('scrolls and collects posts (target: 25)', async () => {
    await researcher.search('AI automation');
    collectedPosts = await researcher.scrollAndCollect('AI automation', 25);

    console.log(`   Collected: ${collectedPosts.length} unique posts`);
    expect(collectedPosts.length).toBeGreaterThan(3);

    // Verify deduplication
    const ids = collectedPosts.map(p => p.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
    console.log(`   ✅ All ${ids.length} post IDs are unique`);
  }, 60000);

  // ─── Creator ranking ─────────────────────────────────────

  it('ranks creators by engagement', () => {
    const creators = researcher.rankCreators(collectedPosts, 'AI automation', 10);

    console.log(`   Top creators: ${creators.length}`);
    expect(creators.length).toBeGreaterThan(0);

    const top = creators[0];
    expect(top.handle).toBeTruthy();
    expect(top.postCount).toBeGreaterThan(0);
    expect(typeof top.totalEngagement).toBe('number');
    expect(top.niche).toBe('AI automation');

    // Verify sorted descending
    for (let i = 1; i < creators.length; i++) {
      expect(creators[i - 1].totalEngagement).toBeGreaterThanOrEqual(creators[i].totalEngagement);
    }

    console.log('   Top 3 creators:');
    for (const c of creators.slice(0, 3)) {
      console.log(`     @${c.handle}: ${c.totalEngagement} engagement (${c.postCount} posts, avg ${Math.round(c.avgEngagement)})`);
    }
  });

  // ─── Save results ────────────────────────────────────────

  it('saves results to JSON', async () => {
    const nicheResult = {
      niche: 'AI automation',
      query: 'AI automation',
      posts: collectedPosts,
      creators: researcher.rankCreators(collectedPosts, 'AI automation', 10),
      totalCollected: collectedPosts.length,
      uniquePosts: collectedPosts.length,
      collectionStarted: new Date().toISOString(),
      collectionFinished: new Date().toISOString(),
      durationMs: 0,
    };

    const filepath = await researcher.saveResults([nicheResult], 'test');

    expect(fs.existsSync(filepath)).toBe(true);
    const content = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
    expect(content.results).toHaveLength(1);
    expect(content.results[0].posts.length).toBe(collectedPosts.length);
    expect(content.allCreators.length).toBeGreaterThan(0);

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
    expect(queries).toContain('"content marketing"');
    expect(queries.some(q => q.startsWith('#'))).toBe(true);
  });
});
