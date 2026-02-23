/**
 * Twitter Researcher Integration Test (REAL — no mocks)
 *
 * Exercises the TwitterResearcher against live Safari + Twitter/X:
 *   1. Verify logged in
 *   2. Search a niche query
 *   3. Extract tweets with engagement metrics
 *   4. Scroll and collect more tweets
 *   5. Rank creators by engagement
 *   6. Save results to JSON
 *
 * Run:  npx vitest run src/__tests__/twitter-researcher.integration.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TwitterResearcher, type ResearchTweet, type Creator } from '../automation/twitter-researcher.js';

const execAsync = promisify(exec);

async function wait(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

describe('TwitterResearcher (real Safari)', () => {
  let researcher: TwitterResearcher;
  const outputDir = path.join(os.tmpdir(), 'twitter-research-test');

  beforeAll(async () => {
    researcher = new TwitterResearcher({
      tweetsPerNiche: 30,          // small target for test speed
      creatorsPerNiche: 10,
      scrollPauseMs: 1200,
      maxScrollsPerSearch: 8,
      searchTab: 'top',
      outputDir,
    });
    await execAsync(`osascript -e 'tell application "Safari" to activate'`).catch(() => null);
    await wait(500);
  }, 10000);

  // ─── Pre-flight ──────────────────────────────────────────

  it('Safari is running and logged into Twitter/X', async () => {
    await execAsync(`osascript -e 'tell application "Safari" to set URL of current tab of front window to "https://x.com/home"'`);
    await wait(4000);

    const tmpFile = path.join(os.tmpdir(), `safari_check_${Date.now()}.scpt`);
    const script = `tell application "Safari" to do JavaScript "(function(){ return document.querySelector('[data-testid=\\"SideNav_NewTweet_Button\\"]') || document.querySelector('[data-testid=\\"AppTabBar_Profile_Link\\"]') ? 'logged_in' : 'not_logged_in'; })()" in current tab of front window`;
    fs.writeFileSync(tmpFile, script);
    try {
      const { stdout } = await execAsync(`osascript "${tmpFile}"`, { timeout: 15000 });
      expect(stdout.trim()).toBe('logged_in');
      console.log('   ✅ Logged in to Twitter/X');
    } finally {
      try { fs.unlinkSync(tmpFile); } catch {}
    }
  }, 20000);

  // ─── Search ──────────────────────────────────────────────

  it('searches Twitter for a niche query', async () => {
    const ok = await researcher.search('AI automation');
    expect(ok).toBe(true);
    console.log('   ✅ Search loaded results');
  }, 20000);

  // ─── Extract tweets ──────────────────────────────────────

  let extractedTweets: ResearchTweet[] = [];

  it('extracts visible tweets with engagement metrics', async () => {
    extractedTweets = await researcher.extractVisibleTweets('AI automation');

    console.log(`   Extracted: ${extractedTweets.length} tweets`);
    expect(extractedTweets.length).toBeGreaterThan(0);

    // Verify tweet structure
    const first = extractedTweets[0];
    expect(first.id).toBeTruthy();
    expect(first.url).toMatch(/x\.com.*\/status\/\d+/);
    expect(first.author).toBeTruthy();
    expect(first.text).toBeTruthy();
    expect(first.niche).toBe('AI automation');
    expect(first.collectedAt).toBeTruthy();
    expect(typeof first.likes).toBe('number');
    expect(typeof first.retweets).toBe('number');
    expect(typeof first.replies).toBe('number');
    expect(typeof first.engagementScore).toBe('number');

    // Log a sample
    console.log(`   Sample tweet:`);
    console.log(`     Author: @${first.author}`);
    console.log(`     Text: "${first.text.substring(0, 80)}..."`);
    console.log(`     Engagement: ${first.likes} likes, ${first.retweets} RTs, ${first.replies} replies`);
    console.log(`     Score: ${first.engagementScore}`);
  }, 15000);

  // ─── Scroll & collect ────────────────────────────────────

  let collectedTweets: ResearchTweet[] = [];

  it('scrolls and collects tweets (target: 30)', async () => {
    // Start a fresh search so scroll position is at top
    await researcher.search('AI automation');
    collectedTweets = await researcher.scrollAndCollect('AI automation', 30);

    console.log(`   Collected: ${collectedTweets.length} unique tweets`);
    expect(collectedTweets.length).toBeGreaterThan(5);

    // Verify deduplication (all IDs unique)
    const ids = collectedTweets.map(t => t.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
    console.log(`   ✅ All ${ids.length} tweet IDs are unique (deduplication works)`);
  }, 60000);

  // ─── Creator ranking ─────────────────────────────────────

  it('ranks creators by engagement', () => {
    const creators = researcher.rankCreators(collectedTweets, 'AI automation', 10);

    console.log(`   Top creators: ${creators.length}`);
    expect(creators.length).toBeGreaterThan(0);

    // Verify creator structure
    const top = creators[0];
    expect(top.handle).toBeTruthy();
    expect(top.tweetCount).toBeGreaterThan(0);
    expect(typeof top.totalEngagement).toBe('number');
    expect(typeof top.avgEngagement).toBe('number');
    expect(top.topTweetUrl).toMatch(/x\.com/);
    expect(top.niche).toBe('AI automation');

    // Verify sorted by engagement (descending)
    for (let i = 1; i < creators.length; i++) {
      expect(creators[i - 1].totalEngagement).toBeGreaterThanOrEqual(creators[i].totalEngagement);
    }

    // Log top 3
    console.log('   Top 3 creators:');
    for (const c of creators.slice(0, 3)) {
      console.log(`     @${c.handle}: ${c.totalEngagement} engagement (${c.tweetCount} tweets, avg ${Math.round(c.avgEngagement)})`);
    }
  });

  // ─── Save results ────────────────────────────────────────

  it('saves results to JSON', async () => {
    const nicheResult = {
      niche: 'AI automation',
      query: 'AI automation',
      tweets: collectedTweets,
      creators: researcher.rankCreators(collectedTweets, 'AI automation', 10),
      totalCollected: collectedTweets.length,
      uniqueTweets: collectedTweets.length,
      collectionStarted: new Date().toISOString(),
      collectionFinished: new Date().toISOString(),
      durationMs: 0,
    };

    const filepath = await researcher.saveResults([nicheResult], 'test');

    expect(fs.existsSync(filepath)).toBe(true);
    const content = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
    expect(content.results).toHaveLength(1);
    expect(content.results[0].tweets.length).toBe(collectedTweets.length);
    expect(content.allCreators.length).toBeGreaterThan(0);

    console.log(`   ✅ Saved to: ${filepath}`);
    console.log(`   File size: ${Math.round(fs.statSync(filepath).size / 1024)}KB`);

    // Cleanup
    try { fs.unlinkSync(filepath); } catch {}
  });

  // ─── Search query builder ────────────────────────────────

  it('builds multiple search queries per niche', () => {
    const queries = researcher.buildSearchQueries('content marketing');
    console.log(`   Queries: ${JSON.stringify(queries)}`);

    expect(queries.length).toBeGreaterThanOrEqual(3);
    expect(queries).toContain('content marketing');
    expect(queries).toContain('"content marketing"');
    expect(queries.some(q => q.startsWith('#'))).toBe(true);
  });
});
