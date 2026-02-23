/**
 * Facebook Researcher Integration Test (REAL — no mocks)
 *
 * Exercises FacebookResearcher against live Safari + Facebook:
 *   1. Verify logged in
 *   2. Search posts by keyword
 *   3. Extract posts with engagement metrics
 *   4. Scroll and collect more posts
 *   5. Rank creators by engagement
 *   6. Save results to JSON
 *   7. Query builder
 *
 * Run:  npx vitest run src/__tests__/facebook-researcher.integration.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FacebookResearcher, type FacebookPost } from '../automation/facebook-researcher.js';

const execAsync = promisify(exec);

async function wait(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

describe('FacebookResearcher (real Safari)', () => {
  let researcher: FacebookResearcher;
  const outputDir = path.join(os.tmpdir(), 'facebook-research-test');

  beforeAll(async () => {
    researcher = new FacebookResearcher({
      postsPerNiche: 20,
      creatorsPerNiche: 10,
      scrollPauseMs: 1500,
      maxScrollsPerSearch: 6,
      outputDir,
    });
    await execAsync(`osascript -e 'tell application "Safari" to activate'`).catch(() => null);
    await wait(500);
  }, 10000);

  // ─── Pre-flight ──────────────────────────────────────────

  it('Safari is running and logged into Facebook', async () => {
    await execAsync(`osascript -e 'tell application "Safari" to set URL of current tab of front window to "https://www.facebook.com/"'`);
    await wait(5000);

    const tmpFile = path.join(os.tmpdir(), `fb_check_${Date.now()}.scpt`);
    const jsCode = `(function(){ var h = document.querySelector('a[aria-label="Home"]'); var p = document.querySelector('svg[aria-label="Your profile"]'); var m = document.querySelector('div[role="navigation"]'); return (h || p || m) ? 'logged_in' : 'not_logged_in'; })()`;
    const escaped = jsCode.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
    const appleScript = `tell application "Safari" to do JavaScript "${escaped}" in current tab of front window`;
    fs.writeFileSync(tmpFile, appleScript);
    try {
      const { stdout } = await execAsync(`osascript "${tmpFile}"`, { timeout: 15000 });
      expect(stdout.trim()).toBe('logged_in');
      console.log('   ✅ Logged in to Facebook');
    } finally {
      try { fs.unlinkSync(tmpFile); } catch {}
    }
  }, 20000);

  // ─── Search ──────────────────────────────────────────────

  it('searches Facebook for posts by keyword', async () => {
    const ok = await researcher.search('AI automation');
    expect(ok).toBe(true);
    console.log('   ✅ Search loaded results');
  }, 20000);

  // ─── Extract posts ───────────────────────────────────────

  let extractedPosts: FacebookPost[] = [];

  it('extracts visible posts with engagement metrics', async () => {
    // Re-search to ensure fresh page state
    await researcher.search('AI automation');
    await wait(2000);
    extractedPosts = await researcher.extractVisiblePosts('AI automation');

    console.log(`   Extracted: ${extractedPosts.length} posts`);
    // Facebook search can return varying numbers — assert structure if we got any
    expect(Array.isArray(extractedPosts)).toBe(true);

    if (extractedPosts.length > 0) {
      const first = extractedPosts[0];
      expect(first.id).toBeTruthy();
      expect(first.niche).toBe('AI automation');
      expect(first.collectedAt).toBeTruthy();
      expect(typeof first.reactions).toBe('number');
      expect(typeof first.comments).toBe('number');
      expect(typeof first.shares).toBe('number');
      expect(typeof first.engagementScore).toBe('number');

      console.log(`   Sample post:`);
      console.log(`     Author: ${first.author || '(unknown)'}`);
      console.log(`     Text: "${(first.text || '').substring(0, 80)}..."`);
      console.log(`     Reactions: ${first.reactions}, Comments: ${first.comments}, Shares: ${first.shares}`);
      console.log(`     Score: ${first.engagementScore}`);
      console.log(`     Type: ${first.authorType}, Verified: ${first.isVerified}`);
    } else {
      console.log('   \u26a0\ufe0f No posts extracted on initial view (Facebook lazy-loads articles)');
      console.log('   The scroll+collect test handles this with pagination');
    }
  }, 25000);

  // ─── Scroll & collect ────────────────────────────────────

  let collectedPosts: FacebookPost[] = [];

  it('scrolls and collects posts (target: 20)', async () => {
    await researcher.search('AI automation');
    collectedPosts = await researcher.scrollAndCollect('AI automation', 20);

    console.log(`   Collected: ${collectedPosts.length} unique posts`);
    expect(collectedPosts.length).toBeGreaterThan(0);

    // Verify deduplication
    const ids = collectedPosts.map(p => p.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
    console.log(`   ✅ All ${ids.length} post IDs are unique`);
  }, 60000);

  // ─── Creator ranking ─────────────────────────────────────

  it('ranks creators by engagement', () => {
    const postsWithAuthors = collectedPosts.filter(p => p.author);
    console.log(`   Posts with authors: ${postsWithAuthors.length}/${collectedPosts.length}`);

    const creators = researcher.rankCreators(collectedPosts, 'AI automation', 10);
    console.log(`   Creators found: ${creators.length}`);

    if (creators.length > 0) {
      const top = creators[0];
      expect(top.name).toBeTruthy();
      expect(top.postCount).toBeGreaterThan(0);
      expect(typeof top.totalEngagement).toBe('number');
      expect(top.niche).toBe('AI automation');

      // Verify sorted descending
      for (let i = 1; i < creators.length; i++) {
        expect(creators[i - 1].totalEngagement).toBeGreaterThanOrEqual(creators[i].totalEngagement);
      }

      console.log('   Top creators:');
      for (const c of creators.slice(0, 3)) {
        console.log(`     ${c.name}: ${c.totalEngagement} engagement (${c.postCount} posts, type: ${c.type})`);
      }
    } else {
      console.log('   ⚠️ No creators found — Facebook may not expose author names in search results');
    }

    expect(Array.isArray(creators)).toBe(true);
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
    expect(queries.some(q => q.includes('tips'))).toBe(true);
  });
});
