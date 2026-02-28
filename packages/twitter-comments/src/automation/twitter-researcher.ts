/**
 * Twitter Market Research — Safari Automation
 *
 * Searches Twitter/X by niche, extracts top tweets with engagement
 * metrics, identifies top creators, and saves structured results.
 *
 * Capabilities:
 *   - Search any niche query via Twitter's search (Top / Latest)
 *   - Extract tweets: text, author, engagement (likes, retweets, replies, views)
 *   - Scroll & paginate to collect hundreds/thousands of tweets per search
 *   - Deduplicate tweets by URL
 *   - Rank creators by total engagement across collected tweets
 *   - Orchestrate multi-niche research (e.g. 5 niches × 1000 tweets)
 *   - Persist results to timestamped JSON
 *
 * Uses the same reliability patterns as TwitterDriver:
 *   smart waits, multi-selector fallbacks, retry with backoff.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const execAsync = promisify(exec);

const GATEWAY_URL = process.env.SAFARI_GATEWAY_URL || 'http://localhost:3000';
const RESEARCH_HOLDER = 'twitter-researcher';

async function acquireGatewayLock(task: string, timeoutMs = 300000): Promise<boolean> {
  try {
    const res = await fetch(`${GATEWAY_URL}/gateway/lock/acquire`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ holder: RESEARCH_HOLDER, platform: 'twitter', task, timeoutMs }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return false;
    const data = await res.json() as { acquired?: boolean };
    return data.acquired === true;
  } catch {
    return false;
  }
}

async function releaseGatewayLock(): Promise<void> {
  try {
    await fetch(`${GATEWAY_URL}/gateway/lock/release`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ holder: RESEARCH_HOLDER }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {}
}

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export interface ResearchTweet {
  id: string;                   // tweet ID from URL
  url: string;                  // full tweet URL
  text: string;                 // tweet body (up to 500 chars)
  author: string;               // @handle
  authorDisplayName: string;    // display name
  isVerified: boolean;
  likes: number;
  retweets: number;
  replies: number;
  views: number;
  engagementScore: number;      // likes + retweets*2 + replies
  hasMedia: boolean;
  timestamp: string;            // relative time string from Twitter
  niche: string;                // which niche search found this
  collectedAt: string;          // ISO timestamp of collection
}

export interface Creator {
  handle: string;
  displayName: string;
  isVerified: boolean;
  followers: number;            // scraped from profile page
  following: number;            // scraped from profile page
  bio: string;                  // scraped from profile page
  tweetCount: number;           // how many tweets we found from them
  totalLikes: number;
  totalRetweets: number;
  totalReplies: number;
  totalViews: number;
  totalEngagement: number;      // sum of engagementScore across tweets
  avgEngagement: number;        // totalEngagement / tweetCount
  topTweetUrl: string;          // their highest-engagement tweet
  topTweetEngagement: number;
  topTweets: Array<{ url: string; text: string; likes: number; retweets: number; views: number; engagement: number }>;
  niche: string;
}

export interface NicheResult {
  niche: string;
  query: string;
  tweets: ResearchTweet[];
  creators: Creator[];
  totalCollected: number;
  uniqueTweets: number;
  collectionStarted: string;
  collectionFinished: string;
  durationMs: number;
}

export interface ResearchConfig {
  tweetsPerNiche: number;       // target tweets to collect per niche (default 1000)
  creatorsPerNiche: number;     // top N creators to return (default 100)
  enrichTopCreators: number;    // how many top creators to enrich with profile visit (default 10)
  scrollPauseMs: number;        // pause between scrolls (default 1500)
  maxScrollsPerSearch: number;  // safety limit on scrolls (default 200)
  searchTab: 'top' | 'latest';  // which search tab to use
  timeout: number;              // JS execution timeout
  outputDir: string;            // where to save results
  maxRetries: number;           // retries per operation
}

export const DEFAULT_RESEARCH_CONFIG: ResearchConfig = {
  tweetsPerNiche: 1000,
  creatorsPerNiche: 100,
  enrichTopCreators: 10,
  scrollPauseMs: 1500,
  maxScrollsPerSearch: 200,
  searchTab: 'top',
  timeout: 30000,
  outputDir: path.join(os.homedir(), 'Documents/twitter-research'),
  maxRetries: 3,
};

// ═══════════════════════════════════════════════════════════════
// TwitterResearcher
// ═══════════════════════════════════════════════════════════════

export class TwitterResearcher {
  private config: ResearchConfig;

  constructor(config: Partial<ResearchConfig> = {}) {
    this.config = { ...DEFAULT_RESEARCH_CONFIG, ...config };
  }

  // ─── Low-level Safari helpers ──────────────────────────────

  private async executeJS(script: string): Promise<string> {
    const tmpFile = path.join(os.tmpdir(), `safari_research_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.scpt`);
    const jsCode = script.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
    const appleScript = `tell application "Safari" to do JavaScript "${jsCode}" in current tab of front window`;
    fs.writeFileSync(tmpFile, appleScript);
    try {
      const { stdout } = await execAsync(`osascript "${tmpFile}"`, { timeout: this.config.timeout });
      return stdout.trim();
    } finally {
      try { fs.unlinkSync(tmpFile); } catch {}
    }
  }

  private async navigate(url: string): Promise<boolean> {
    try {
      const safeUrl = url.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      await execAsync(`osascript -e 'tell application "Safari" to set URL of current tab of front window to "${safeUrl}"'`);
      return true;
    } catch { return false; }
  }

  private async wait(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
  }

  private async waitForSelector(selector: string, timeoutMs = 10000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const found = await this.executeJS(`(function(){ return document.querySelector('${selector}') ? 'found' : ''; })()`);
      if (found === 'found') return true;
      await this.wait(400);
    }
    return false;
  }

  // ─── Profile Enrichment ────────────────────────────────────

  /**
   * Visit a Twitter profile page and extract followers, following, and bio.
   * Returns null on failure so callers can gracefully skip.
   */
  async getCreatorProfile(handle: string): Promise<{ followers: number; following: number; bio: string } | null> {
    const url = `https://x.com/${handle}`;
    const ok = await this.navigate(url);
    if (!ok) return null;

    // Wait for profile to load — UserDescription or UserName testid
    const loaded = await this.waitForSelector('[data-testid="UserName"]', 12000);
    if (!loaded) return null;

    const raw = await this.executeJS(`(function() {
      function parseCount(s) {
        if (!s) return 0;
        s = s.trim().replace(/,/g, '');
        if (s.includes('M')) return Math.round(parseFloat(s) * 1000000);
        if (s.includes('K') || s.includes('k')) return Math.round(parseFloat(s) * 1000);
        return parseInt(s) || 0;
      }
      var result = { followers: 0, following: 0, bio: '' };
      var links = document.querySelectorAll('a[href$="/followers"], a[href$="/verified_followers"]');
      if (links.length > 0) {
        var spans = links[0].querySelectorAll('span');
        for (var i = 0; i < spans.length; i++) {
          var t = (spans[i].innerText || '').trim();
          if (/^[\\d.,]+[KkMm]?$/.test(t)) { result.followers = parseCount(t); break; }
        }
      }
      var flLinks = document.querySelectorAll('a[href$="/following"]');
      if (flLinks.length > 0) {
        var spans2 = flLinks[0].querySelectorAll('span');
        for (var j = 0; j < spans2.length; j++) {
          var t2 = (spans2[j].innerText || '').trim();
          if (/^[\\d.,]+[KkMm]?$/.test(t2)) { result.following = parseCount(t2); break; }
        }
      }
      var bioEl = document.querySelector('[data-testid="UserDescription"]');
      if (bioEl) result.bio = (bioEl.innerText || '').trim().substring(0, 300);
      return JSON.stringify(result);
    })()`);

    try {
      return JSON.parse(raw || 'null');
    } catch {
      return null;
    }
  }

  // ─── Search Navigation ─────────────────────────────────────

  /**
   * Navigate to Twitter search for a query.
   * Builds the search URL with proper encoding and tab selection.
   */
  async search(query: string, tab: 'top' | 'latest' = this.config.searchTab): Promise<boolean> {
    const encoded = encodeURIComponent(query);
    const tabParam = tab === 'latest' ? '&f=live' : '';
    const url = `https://x.com/search?q=${encoded}${tabParam}&src=typed_query`;

    console.log(`[Research] Searching: "${query}" (${tab} tab)`);
    const ok = await this.navigate(url);
    if (!ok) return false;

    // Wait for search results to render
    const loaded = await this.waitForSelector('[data-testid="tweet"]', 12000);
    if (!loaded) {
      // Check if "No results" page
      const noResults = await this.executeJS(`
        (function() {
          var pc = document.querySelector('[data-testid="primaryColumn"]');
          if (pc && pc.innerText.includes('No results')) return 'no_results';
          return '';
        })()
      `);
      if (noResults === 'no_results') {
        console.log(`[Research] No results for "${query}"`);
        return false;
      }
    }

    return loaded;
  }

  // ─── Tweet Extraction ──────────────────────────────────────

  /**
   * Extract all visible tweets from the current page.
   * Returns structured data with engagement metrics.
   */
  async extractVisibleTweets(niche: string): Promise<ResearchTweet[]> {
    const raw = await this.executeJS(`
      (function() {
        var tweets = document.querySelectorAll('article[data-testid="tweet"]');
        var results = [];

        for (var i = 0; i < tweets.length; i++) {
          try {
            var tweet = tweets[i];

            // Author
            var authorLink = tweet.querySelector('a[href*="/"][role="link"]');
            var handle = '';
            var displayName = '';
            if (authorLink) {
              var href = authorLink.getAttribute('href') || '';
              handle = href.replace('/', '');
              displayName = (authorLink.querySelector('span') || {}).innerText || '';
            }
            // Better handle extraction: find the @handle span
            var spans = tweet.querySelectorAll('span');
            for (var s = 0; s < spans.length; s++) {
              var st = (spans[s].innerText || '').trim();
              if (st.startsWith('@') && st.length > 2 && st.length < 30) {
                handle = st.substring(1);
                break;
              }
            }

            // Tweet text
            var textEl = tweet.querySelector('[data-testid="tweetText"]');
            var text = textEl ? textEl.innerText.substring(0, 500) : '';

            // Tweet URL (status link)
            var statusLink = '';
            var tweetId = '';
            var links = tweet.querySelectorAll('a[href*="/status/"]');
            for (var l = 0; l < links.length; l++) {
              var lhref = links[l].getAttribute('href') || '';
              var m = lhref.match(/\\/status\\/(\\d+)/);
              if (m) {
                tweetId = m[1];
                statusLink = 'https://x.com' + lhref.split('?')[0];
                break;
              }
            }

            // Engagement metrics
            var likes = 0, retweets = 0, replies = 0, views = 0;

            var likeBtn = tweet.querySelector('[data-testid="like"], [data-testid="unlike"]');
            if (likeBtn) {
              var lc = likeBtn.querySelector('[data-testid="app-text-transition-container"]');
              likes = lc ? (parseInt(lc.innerText.replace(/[^0-9.KkMm]/g, '')) || 0) : 0;
              var lt = lc ? (lc.innerText || '') : '';
              if (lt.includes('K') || lt.includes('k')) likes = Math.round(parseFloat(lt) * 1000);
              if (lt.includes('M') || lt.includes('m')) likes = Math.round(parseFloat(lt) * 1000000);
            }

            var rtBtn = tweet.querySelector('[data-testid="retweet"], [data-testid="unretweet"]');
            if (rtBtn) {
              var rc = rtBtn.querySelector('[data-testid="app-text-transition-container"]');
              var rt = rc ? (rc.innerText || '') : '';
              retweets = parseInt(rt.replace(/[^0-9]/g, '')) || 0;
              if (rt.includes('K') || rt.includes('k')) retweets = Math.round(parseFloat(rt) * 1000);
              if (rt.includes('M') || rt.includes('m')) retweets = Math.round(parseFloat(rt) * 1000000);
            }

            var rpBtn = tweet.querySelector('[data-testid="reply"]');
            if (rpBtn) {
              var rpc = rpBtn.querySelector('[data-testid="app-text-transition-container"]');
              var rpt = rpc ? (rpc.innerText || '') : '';
              replies = parseInt(rpt.replace(/[^0-9]/g, '')) || 0;
              if (rpt.includes('K') || rpt.includes('k')) replies = Math.round(parseFloat(rpt) * 1000);
              if (rpt.includes('M') || rpt.includes('m')) replies = Math.round(parseFloat(rpt) * 1000000);
            }

            // Views (analytics link)
            var viewEl = tweet.querySelector('a[href*="/analytics"]');
            if (viewEl) {
              var vt = (viewEl.innerText || '').trim();
              views = parseInt(vt.replace(/[^0-9]/g, '')) || 0;
              if (vt.includes('K') || vt.includes('k')) views = Math.round(parseFloat(vt) * 1000);
              if (vt.includes('M') || vt.includes('m')) views = Math.round(parseFloat(vt) * 1000000);
            }

            // Verified badge
            var isVerified = !!tweet.querySelector('[data-testid="icon-verified"]') ||
                             !!tweet.querySelector('svg[aria-label="Verified account"]');

            // Media
            var hasMedia = !!tweet.querySelector('[data-testid="tweetPhoto"]') ||
                           !!tweet.querySelector('video') ||
                           !!tweet.querySelector('[data-testid="card.wrapper"]');

            // Timestamp
            var timeEl = tweet.querySelector('time');
            var timestamp = timeEl ? (timeEl.getAttribute('datetime') || timeEl.innerText || '') : '';

            if (tweetId && handle) {
              results.push({
                id: tweetId,
                url: statusLink,
                text: text,
                author: handle,
                authorDisplayName: displayName,
                isVerified: isVerified,
                likes: likes,
                retweets: retweets,
                replies: replies,
                views: views,
                hasMedia: hasMedia,
                timestamp: timestamp
              });
            }
          } catch(e) {}
        }

        return JSON.stringify(results);
      })()
    `);

    try {
      const parsed = JSON.parse(raw || '[]') as Array<any>;
      const now = new Date().toISOString();
      return parsed.map(t => ({
        ...t,
        engagementScore: (t.likes || 0) + (t.retweets || 0) * 2 + (t.replies || 0),
        niche,
        collectedAt: now,
      }));
    } catch {
      return [];
    }
  }

  // ─── Scroll & Collect ──────────────────────────────────────

  /**
   * Scroll through search results collecting tweets until we reach
   * the target count or run out of content.
   */
  async scrollAndCollect(niche: string, targetCount: number): Promise<ResearchTweet[]> {
    const seen = new Map<string, ResearchTweet>(); // dedup by tweet ID
    let noNewCount = 0;
    let scrollCount = 0;

    console.log(`[Research] Collecting up to ${targetCount} tweets for "${niche}"`);

    while (seen.size < targetCount && scrollCount < this.config.maxScrollsPerSearch) {
      // Extract visible tweets
      const batch = await this.extractVisibleTweets(niche);
      let newCount = 0;
      for (const tweet of batch) {
        if (!seen.has(tweet.id)) {
          seen.set(tweet.id, tweet);
          newCount++;
        }
      }

      if (newCount === 0) {
        noNewCount++;
        if (noNewCount >= 5) {
          console.log(`[Research] No new tweets after 5 scrolls, stopping at ${seen.size}`);
          break;
        }
      } else {
        noNewCount = 0;
      }

      // Progress logging every 10 scrolls
      if (scrollCount % 10 === 0) {
        console.log(`[Research] Scroll ${scrollCount}: ${seen.size}/${targetCount} tweets collected`);
      }

      // Scroll down
      await this.executeJS(`window.scrollBy(0, window.innerHeight * 2)`);
      await this.wait(this.config.scrollPauseMs);

      // Check for "Rate limit" or "Something went wrong"
      const error = await this.executeJS(`
        (function() {
          var body = document.body.innerText;
          if (body.includes('Something went wrong')) return 'error';
          if (body.includes('Rate limit')) return 'rate_limit';
          return '';
        })()
      `);
      if (error === 'rate_limit') {
        console.log('[Research] Rate limited, waiting 60s...');
        await this.wait(60000);
      } else if (error === 'error') {
        console.log('[Research] "Something went wrong", refreshing...');
        await this.executeJS(`window.location.reload()`);
        await this.wait(5000);
      }

      scrollCount++;
    }

    console.log(`[Research] Finished: ${seen.size} unique tweets in ${scrollCount} scrolls`);
    return Array.from(seen.values());
  }

  // ─── Creator Ranking ───────────────────────────────────────

  /**
   * Aggregate tweets by author and rank creators by total engagement.
   */
  rankCreators(tweets: ResearchTweet[], niche: string, topN: number = this.config.creatorsPerNiche): Creator[] {
    const creatorMap = new Map<string, Creator>();
    // track all tweets per creator for topTweets selection
    const creatorTweets = new Map<string, ResearchTweet[]>();

    for (const tweet of tweets) {
      const existing = creatorMap.get(tweet.author);
      if (existing) {
        existing.tweetCount++;
        existing.totalLikes += tweet.likes;
        existing.totalRetweets += tweet.retweets;
        existing.totalReplies += tweet.replies;
        existing.totalViews += tweet.views;
        existing.totalEngagement += tweet.engagementScore;
        existing.avgEngagement = existing.totalEngagement / existing.tweetCount;
        if (tweet.engagementScore > existing.topTweetEngagement) {
          existing.topTweetUrl = tweet.url;
          existing.topTweetEngagement = tweet.engagementScore;
        }
        if (tweet.isVerified) existing.isVerified = true;
        creatorTweets.get(tweet.author)!.push(tweet);
      } else {
        creatorMap.set(tweet.author, {
          handle: tweet.author,
          displayName: tweet.authorDisplayName,
          isVerified: tweet.isVerified,
          followers: 0,
          following: 0,
          bio: '',
          tweetCount: 1,
          totalLikes: tweet.likes,
          totalRetweets: tweet.retweets,
          totalReplies: tweet.replies,
          totalViews: tweet.views,
          totalEngagement: tweet.engagementScore,
          avgEngagement: tweet.engagementScore,
          topTweetUrl: tweet.url,
          topTweetEngagement: tweet.engagementScore,
          topTweets: [],
          niche,
        });
        creatorTweets.set(tweet.author, [tweet]);
      }
    }

    // Populate topTweets (top 3 by engagement) for each creator
    for (const [handle, creator] of creatorMap) {
      const sorted = (creatorTweets.get(handle) || [])
        .sort((a, b) => b.engagementScore - a.engagementScore)
        .slice(0, 3);
      creator.topTweets = sorted.map(t => ({
        url: t.url,
        text: t.text,
        likes: t.likes,
        retweets: t.retweets,
        views: t.views,
        engagement: t.engagementScore,
      }));
    }

    // Sort by totalEngagement descending, then by avgEngagement
    return Array.from(creatorMap.values())
      .sort((a, b) => b.totalEngagement - a.totalEngagement || b.avgEngagement - a.avgEngagement)
      .slice(0, topN);
  }

  // ─── Multi-search per niche ────────────────────────────────

  /**
   * Run multiple search queries for a single niche to maximise coverage.
   * Generates variant queries: exact phrase, hashtag, "niche tips", "niche strategy".
   */
  buildSearchQueries(niche: string): string[] {
    const base = niche.trim();
    const queries = [
      base,                              // plain search
      `"${base}"`,                       // exact phrase
      `#${base.replace(/\s+/g, '')}`,    // hashtag variant
      `${base} tips`,                    // tips variant
      `${base} strategy`,               // strategy variant
    ];
    return queries;
  }

  // ─── Full Niche Research ───────────────────────────────────

  /**
   * Research a single niche: search with multiple queries, collect tweets,
   * rank creators, return structured result.
   */
  async researchNiche(niche: string): Promise<NicheResult> {
    // Guard: only run if explicitly enabled — prevents unsolicited Safari browser takeover
    if (process.env.SAFARI_RESEARCH_ENABLED !== 'true') {
      throw new Error('Twitter research is disabled. Set SAFARI_RESEARCH_ENABLED=true to enable.');
    }

    const lockAcquired = await acquireGatewayLock(`research niche: ${niche}`);
    if (!lockAcquired) {
      console.log(`[Research] Warning: Safari Gateway lock not acquired (port 3000 may be down) — continuing without lock`);
    }

    const startTime = Date.now();
    const startISO = new Date().toISOString();
    const allTweets = new Map<string, ResearchTweet>();
    const queries = this.buildSearchQueries(niche);
    const targetPerQuery = Math.ceil(this.config.tweetsPerNiche / queries.length);

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`[Research] NICHE: "${niche}" — target ${this.config.tweetsPerNiche} tweets`);
    console.log(`[Research] Running ${queries.length} search queries (${targetPerQuery} each)`);
    console.log(`${'═'.repeat(60)}`);

    try {
    for (const query of queries) {
      if (allTweets.size >= this.config.tweetsPerNiche) {
        console.log(`[Research] Already at ${allTweets.size} tweets, skipping remaining queries`);
        break;
      }

      const remaining = this.config.tweetsPerNiche - allTweets.size;
      const target = Math.min(targetPerQuery, remaining);

      const searched = await this.search(query);
      if (!searched) {
        console.log(`[Research] Search failed for "${query}", skipping`);
        continue;
      }

      const tweets = await this.scrollAndCollect(niche, target);
      let newCount = 0;
      for (const tweet of tweets) {
        if (!allTweets.has(tweet.id)) {
          allTweets.set(tweet.id, tweet);
          newCount++;
        }
      }
      console.log(`[Research] Query "${query}": ${tweets.length} collected, ${newCount} new (total: ${allTweets.size})`);

      // Brief pause between queries to avoid rate limits
      await this.wait(3000);
    }

    const tweetArray = Array.from(allTweets.values())
      .sort((a, b) => b.engagementScore - a.engagementScore);

    const creators = this.rankCreators(tweetArray, niche);

    // Enrich top creators with profile data (followers/following/bio)
    const enrichCount = Math.min(this.config.enrichTopCreators, creators.length);
    if (enrichCount > 0) {
      console.log(`[Research] Enriching top ${enrichCount} creators with profile data...`);
      for (let i = 0; i < enrichCount; i++) {
        const c = creators[i];
        console.log(`[Research] Profile: @${c.handle} (${i + 1}/${enrichCount})`);
        const profile = await this.getCreatorProfile(c.handle);
        if (profile) {
          c.followers = profile.followers;
          c.following = profile.following;
          c.bio = profile.bio;
        }
        if (i < enrichCount - 1) await this.wait(1500);
      }
    }

    const result: NicheResult = {
      niche,
      query: queries[0],
      tweets: tweetArray,
      creators,
      totalCollected: tweetArray.length,
      uniqueTweets: tweetArray.length,
      collectionStarted: startISO,
      collectionFinished: new Date().toISOString(),
      durationMs: Date.now() - startTime,
    };

    console.log(`[Research] NICHE "${niche}" complete: ${tweetArray.length} tweets, ${creators.length} creators in ${result.durationMs}ms`);
    return result;
    } finally {
      await releaseGatewayLock();
    }
  }

  // ─── Multi-Niche Orchestrator ──────────────────────────────

  /**
   * Run research across multiple niches.
   * Default: 1000 tweets per niche, 50-100 top creators per niche.
   */
  async runFullResearch(niches: string[]): Promise<{ // SAFARI_RESEARCH_ENABLED guard checked per-niche inside researchNiche()
    results: NicheResult[];
    summary: {
      totalTweets: number;
      totalCreators: number;
      totalDurationMs: number;
      niches: string[];
    };
  }> {
    const startTime = Date.now();
    const results: NicheResult[] = [];

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`[Research] FULL RESEARCH — ${niches.length} niches`);
    console.log(`[Research] Target: ${this.config.tweetsPerNiche} tweets × ${niches.length} niches = ${this.config.tweetsPerNiche * niches.length} total`);
    console.log(`[Research] Top ${this.config.creatorsPerNiche} creators per niche`);
    console.log(`${'═'.repeat(60)}\n`);

    for (let i = 0; i < niches.length; i++) {
      console.log(`\n[Research] ── Niche ${i + 1}/${niches.length}: "${niches[i]}" ──`);
      const result = await this.researchNiche(niches[i]);
      results.push(result);

      // Save intermediate results
      await this.saveResults(results, 'intermediate');

      // Pause between niches
      if (i < niches.length - 1) {
        console.log('[Research] Pausing 5s between niches...');
        await this.wait(5000);
      }
    }

    const summary = {
      totalTweets: results.reduce((s, r) => s + r.totalCollected, 0),
      totalCreators: results.reduce((s, r) => s + r.creators.length, 0),
      totalDurationMs: Date.now() - startTime,
      niches,
    };

    // Save final results
    await this.saveResults(results, 'final');

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`[Research] COMPLETE`);
    console.log(`[Research] ${summary.totalTweets} tweets, ${summary.totalCreators} creators`);
    console.log(`[Research] Duration: ${Math.round(summary.totalDurationMs / 1000)}s`);
    console.log(`${'═'.repeat(60)}\n`);

    return { results, summary };
  }

  // ─── Persistence ───────────────────────────────────────────

  /**
   * Save research results to timestamped JSON files.
   */
  async saveResults(results: NicheResult[], label: string = 'research'): Promise<string> {
    if (!fs.existsSync(this.config.outputDir)) {
      fs.mkdirSync(this.config.outputDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `twitter-research-${label}-${timestamp}.json`;
    const filepath = path.join(this.config.outputDir, filename);

    const output = {
      metadata: {
        generatedAt: new Date().toISOString(),
        label,
        config: this.config,
      },
      results,
      allCreators: this.mergeCreators(results),
    };

    fs.writeFileSync(filepath, JSON.stringify(output, null, 2));
    console.log(`[Research] Saved: ${filepath}`);
    return filepath;
  }

  /**
   * Merge creators across all niches, deduplicating by handle.
   */
  private mergeCreators(results: NicheResult[]): Creator[] {
    const merged = new Map<string, Creator & { niches: string[] }>();

    for (const result of results) {
      for (const creator of result.creators) {
        const existing = merged.get(creator.handle);
        if (existing) {
          existing.tweetCount += creator.tweetCount;
          existing.totalLikes += creator.totalLikes;
          existing.totalRetweets += creator.totalRetweets;
          existing.totalReplies += creator.totalReplies;
          existing.totalViews += creator.totalViews;
          existing.totalEngagement += creator.totalEngagement;
          existing.avgEngagement = existing.totalEngagement / existing.tweetCount;
          if (creator.topTweetEngagement > existing.topTweetEngagement) {
            existing.topTweetUrl = creator.topTweetUrl;
            existing.topTweetEngagement = creator.topTweetEngagement;
          }
          if (!existing.niches.includes(creator.niche)) {
            existing.niches.push(creator.niche);
          }
        } else {
          merged.set(creator.handle, { ...creator, niches: [creator.niche] });
        }
      }
    }

    return Array.from(merged.values())
      .sort((a, b) => b.totalEngagement - a.totalEngagement);
  }

  // ─── Quick Stats ───────────────────────────────────────────

  /**
   * Print a summary table of collected data.
   */
  printSummary(results: NicheResult[]): void {
    console.log('\n┌─────────────────────────────────────────────────────────────┐');
    console.log('│                 TWITTER RESEARCH SUMMARY                    │');
    console.log('├──────────────────┬──────────┬──────────┬───────────────────┤');
    console.log('│ Niche            │ Tweets   │ Creators │ Top Creator       │');
    console.log('├──────────────────┼──────────┼──────────┼───────────────────┤');
    for (const r of results) {
      const niche = r.niche.substring(0, 16).padEnd(16);
      const tweets = String(r.totalCollected).padStart(8);
      const creators = String(r.creators.length).padStart(8);
      const top = r.creators[0] ? `@${r.creators[0].handle}`.substring(0, 17).padEnd(17) : 'N/A'.padEnd(17);
      console.log(`│ ${niche} │ ${tweets} │ ${creators} │ ${top} │`);
    }
    console.log('└──────────────────┴──────────┴──────────┴───────────────────┘');

    const total = results.reduce((s, r) => s + r.totalCollected, 0);
    console.log(`\nTotal: ${total} tweets across ${results.length} niches`);
  }
}
