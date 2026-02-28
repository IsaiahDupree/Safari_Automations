/**
 * Threads Market Research — Safari Automation
 *
 * Searches Threads by niche, extracts top posts with engagement
 * metrics, identifies top creators, and saves structured results.
 *
 * Capabilities:
 *   - Search any niche query via Threads search
 *   - Extract posts: text, author, engagement (likes, replies)
 *   - Scroll & paginate to collect hundreds/thousands of posts
 *   - Deduplicate posts by URL
 *   - Rank creators by total engagement across collected posts
 *   - Orchestrate multi-niche research (e.g. 5 niches × 1000 posts)
 *   - Persist results to timestamped JSON
 *
 * Uses the same reliability patterns as TwitterResearcher:
 *   smart waits, retry with backoff, error detection.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const execAsync = promisify(exec);

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export interface ThreadsPost {
  id: string;                   // post ID from URL
  url: string;                  // full post URL
  text: string;                 // post body (up to 500 chars)
  author: string;               // @handle
  authorDisplayName: string;    // display name
  isVerified: boolean;
  likes: number;
  replies: number;
  reposts: number;
  engagementScore: number;      // likes + reposts*2 + replies
  hasMedia: boolean;
  timestamp: string;            // datetime from <time> element
  niche: string;                // which niche search found this
  collectedAt: string;          // ISO timestamp of collection
}

export interface ThreadsCreator {
  handle: string;
  displayName: string;
  isVerified: boolean;
  followers: number;            // scraped from profile page
  following: number;            // scraped from profile page
  bio: string;                  // scraped from profile page
  postCount: number;            // how many posts we found from them
  totalLikes: number;
  totalReplies: number;
  totalReposts: number;
  totalEngagement: number;
  avgEngagement: number;
  topPostUrl: string;
  topPostEngagement: number;
  topPosts: Array<{ url: string; text: string; likes: number; replies: number; reposts: number; engagement: number }>;
  niche: string;
}

export interface ThreadsNicheResult {
  niche: string;
  query: string;
  posts: ThreadsPost[];
  creators: ThreadsCreator[];
  totalCollected: number;
  uniquePosts: number;
  collectionStarted: string;
  collectionFinished: string;
  durationMs: number;
}

export interface ThreadsResearchConfig {
  postsPerNiche: number;
  creatorsPerNiche: number;
  enrichTopCreators: number;    // how many top creators to enrich with profile visit (default 10)
  scrollPauseMs: number;
  maxScrollsPerSearch: number;
  timeout: number;
  outputDir: string;
  maxRetries: number;
}

export const DEFAULT_THREADS_RESEARCH_CONFIG: ThreadsResearchConfig = {
  postsPerNiche: 1000,
  creatorsPerNiche: 100,
  enrichTopCreators: 10,
  scrollPauseMs: 1500,
  maxScrollsPerSearch: 200,
  timeout: 30000,
  outputDir: path.join(os.homedir(), 'Documents/threads-research'),
  maxRetries: 3,
};

// ═══════════════════════════════════════════════════════════════
// ThreadsResearcher
// ═══════════════════════════════════════════════════════════════

export class ThreadsResearcher {
  private config: ThreadsResearchConfig;

  constructor(config: Partial<ThreadsResearchConfig> = {}) {
    this.config = { ...DEFAULT_THREADS_RESEARCH_CONFIG, ...config };
  }

  private log(msg: string): void {
    const ts = new Date().toTimeString().slice(0, 8);
    console.log(`[${ts}] [Threads] ${msg}`);
  }

  // ─── Low-level Safari helpers ──────────────────────────────

  private async executeJS(script: string): Promise<string> {
    const jsFile = path.join(os.tmpdir(), `safari_threads_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.js`);
    const scptFile = jsFile.replace('.js', '.scpt');
    fs.writeFileSync(jsFile, script);
    const appleScript = `tell application "Safari"\ntell front document\nset jsCode to read POSIX file "${jsFile}"\ndo JavaScript jsCode\nend tell\nend tell`;
    fs.writeFileSync(scptFile, appleScript);
    try {
      const { stdout } = await execAsync(`osascript "${scptFile}"`, { timeout: this.config.timeout });
      return stdout.trim();
    } finally {
      try { fs.unlinkSync(jsFile); } catch {}
      try { fs.unlinkSync(scptFile); } catch {}
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
      await this.wait(500);
    }
    return false;
  }

  // ─── Profile Enrichment ────────────────────────────────────

  /**
   * Visit a Threads profile page and extract followers, following, and bio.
   * Returns null on failure so callers can gracefully skip.
   */
  async getCreatorProfile(handle: string): Promise<{ followers: number; following: number; bio: string } | null> {
    const url = `https://www.threads.net/@${handle}`;
    const ok = await this.navigate(url);
    if (!ok) return null;

    // Wait for profile to load
    const loaded = await this.waitForSelector('[data-pressable-container="true"], h1, [role="main"]', 12000);
    if (!loaded) return null;

    await this.wait(1500);

    const raw = await this.executeJS(`(function() {
      function parseCount(s) {
        if (!s) return 0;
        s = s.trim().replace(/,/g, '');
        if (s.includes('M')) return Math.round(parseFloat(s) * 1000000);
        if (s.includes('K') || s.includes('k')) return Math.round(parseFloat(s) * 1000);
        return parseInt(s) || 0;
      }
      var result = { followers: 0, following: 0, bio: '' };
      var bodyText = document.body.innerText || '';
      var followerMatch = bodyText.match(/([\\d.,]+[KkMm]?)\\s*follower/i);
      if (followerMatch) result.followers = parseCount(followerMatch[1]);
      var followingMatch = bodyText.match(/([\\d.,]+[KkMm]?)\\s*following/i);
      if (followingMatch) result.following = parseCount(followingMatch[1]);
      var descEl = document.querySelector('[data-pressable-container] + div, [class*="description"], [class*="bio"]');
      if (!descEl) {
        var divs = document.querySelectorAll('div');
        for (var i = 0; i < divs.length; i++) {
          var t = (divs[i].innerText || '').trim();
          if (t.length > 20 && t.length < 300 && !t.includes('followers') && !t.includes('@')) {
            descEl = divs[i]; break;
          }
        }
      }
      if (descEl) result.bio = (descEl.innerText || '').trim().substring(0, 300);
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
   * Navigate to Threads search for a query.
   */
  async search(query: string): Promise<boolean> {
    const encoded = encodeURIComponent(query);
    // Threads search URL format
    const url = `https://www.threads.net/search?q=${encoded}&serp_type=default`;

    console.log(`[Threads Research] Searching: "${query}"`);
    const ok = await this.navigate(url);
    if (!ok) return false;

    // Wait for search results to render
    // Threads uses data-pressable-container for post containers
    const loaded = await this.waitForSelector('[data-pressable-container="true"]', 12000);
    if (!loaded) {
      // Fallback: check for any post-like content
      const altLoaded = await this.waitForSelector('a[href*="/post/"]', 8000);
      if (!altLoaded) {
        console.log(`[Threads Research] No results for "${query}"`);
        return false;
      }
    }

    return true;
  }

  // ─── Post Extraction ───────────────────────────────────────

  /**
   * Extract all visible posts from the current page.
   */
  async extractVisiblePosts(niche: string): Promise<ThreadsPost[]> {
    const raw = await this.executeJS(`
      (function() {
        var containers = document.querySelectorAll('[data-pressable-container="true"]');
        var results = [];

        for (var i = 0; i < containers.length; i++) {
          try {
            var post = containers[i];

            // Author handle
            var userLink = post.querySelector('a[href*="/@"]');
            var handle = '';
            var displayName = '';
            if (userLink) {
              var href = userLink.getAttribute('href') || '';
              handle = href.split('/@').pop().split('/')[0].split('?')[0];
              // Display name is usually the first span in the user link area
              var nameSpan = userLink.querySelector('span');
              displayName = nameSpan ? nameSpan.innerText.trim() : handle;
            }

            // Post text
            var textParts = [];
            post.querySelectorAll('span[dir="auto"], [dir="auto"] span').forEach(function(el) {
              var t = el.innerText.trim();
              // Filter out timestamps, handles, and navigation text
              if (t.length > 3 && !t.match(/^\\d+[hmd]$/) && !t.match(/^@/) &&
                  t !== handle && t !== displayName && !t.includes('Verified')) {
                textParts.push(t);
              }
            });
            var text = textParts.join(' ').substring(0, 500);

            // Post URL
            var postLink = post.querySelector('a[href*="/post/"]');
            var url = '';
            var postId = '';
            if (postLink) {
              var phref = postLink.getAttribute('href') || '';
              var m = phref.match(/\\/post\\/([A-Za-z0-9_-]+)/);
              if (m) {
                postId = m[1];
                url = phref.startsWith('http') ? phref : 'https://www.threads.net' + phref;
              }
            }

            // Engagement metrics from the post's stats area
            var likes = 0, replies = 0, reposts = 0;
            var statsText = post.innerText || '';

            // Look for engagement numbers near action buttons
            var svgs = post.querySelectorAll('svg');
            for (var s = 0; s < svgs.length; s++) {
              var label = svgs[s].getAttribute('aria-label') || '';
              var parent = svgs[s].parentElement;
              var nearText = parent ? (parent.innerText || '').trim() : '';

              if (label === 'Like' || label === 'Unlike') {
                var num = nearText.replace(/[^0-9.KkMm]/g, '');
                if (num) {
                  likes = parseInt(num) || 0;
                  if (num.includes('K') || num.includes('k')) likes = Math.round(parseFloat(num) * 1000);
                  if (num.includes('M') || num.includes('m')) likes = Math.round(parseFloat(num) * 1000000);
                }
              }
              if (label === 'Reply') {
                var num = nearText.replace(/[^0-9.KkMm]/g, '');
                if (num) {
                  replies = parseInt(num) || 0;
                  if (num.includes('K') || num.includes('k')) replies = Math.round(parseFloat(num) * 1000);
                  if (num.includes('M') || num.includes('m')) replies = Math.round(parseFloat(num) * 1000000);
                }
              }
              if (label === 'Repost') {
                var num = nearText.replace(/[^0-9.KkMm]/g, '');
                if (num) {
                  reposts = parseInt(num) || 0;
                  if (num.includes('K') || num.includes('k')) reposts = Math.round(parseFloat(num) * 1000);
                  if (num.includes('M') || num.includes('m')) reposts = Math.round(parseFloat(num) * 1000000);
                }
              }
            }

            // Fallback: extract numbers from stats text patterns like "42 likes"
            if (likes === 0) {
              var likeMatch = statsText.match(/(\\d+[KkMm]?)\\s*like/i);
              if (likeMatch) {
                var v = likeMatch[1];
                likes = parseInt(v) || 0;
                if (v.includes('K') || v.includes('k')) likes = Math.round(parseFloat(v) * 1000);
                if (v.includes('M') || v.includes('m')) likes = Math.round(parseFloat(v) * 1000000);
              }
            }
            if (replies === 0) {
              var replyMatch = statsText.match(/(\\d+[KkMm]?)\\s*repl/i);
              if (replyMatch) {
                var v = replyMatch[1];
                replies = parseInt(v) || 0;
                if (v.includes('K') || v.includes('k')) replies = Math.round(parseFloat(v) * 1000);
                if (v.includes('M') || v.includes('m')) replies = Math.round(parseFloat(v) * 1000000);
              }
            }

            // Verified badge
            var isVerified = !!post.querySelector('svg[aria-label="Verified"]') ||
                             !!post.querySelector('[title="Verified"]');

            // Media
            var hasMedia = !!post.querySelector('img[src*="scontent"]') ||
                           !!post.querySelector('video') ||
                           !!post.querySelector('[role="img"]');

            // Timestamp
            var timeEl = post.querySelector('time');
            var timestamp = timeEl ? (timeEl.getAttribute('datetime') || timeEl.innerText || '') : '';

            if (postId && handle && text.length > 5) {
              results.push({
                id: postId,
                url: url,
                text: text,
                author: handle,
                authorDisplayName: displayName,
                isVerified: isVerified,
                likes: likes,
                replies: replies,
                reposts: reposts,
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
      return parsed.map(p => ({
        ...p,
        engagementScore: (p.likes || 0) + (p.reposts || 0) * 2 + (p.replies || 0),
        niche,
        collectedAt: now,
      }));
    } catch {
      return [];
    }
  }

  // ─── Scroll & Collect ──────────────────────────────────────

  async scrollAndCollect(niche: string, targetCount: number): Promise<ThreadsPost[]> {
    const seen = new Map<string, ThreadsPost>();
    let noNewCount = 0;
    let scrollCount = 0;

    this.log(`scrollAndCollect: up to ${targetCount} posts for "${niche}"`);

    while (seen.size < targetCount && scrollCount < this.config.maxScrollsPerSearch) {
      const batch = await this.extractVisiblePosts(niche);
      let newCount = 0;
      for (const post of batch) {
        if (!seen.has(post.id)) {
          seen.set(post.id, post);
          newCount++;
        }
      }

      if (newCount === 0) {
        noNewCount++;
        if (noNewCount >= 5) {
          this.log(`No new posts after 5 scrolls — stopping at ${seen.size}`);
          break;
        }
      } else {
        noNewCount = 0;
      }

      if (scrollCount % 5 === 0) {
        this.log(`scroll ${scrollCount}: ${seen.size}/${targetCount} collected`);
      }

      await this.executeJS(`window.scrollBy(0, window.innerHeight * 2)`);
      await this.wait(this.config.scrollPauseMs);

      // Error detection
      const error = await this.executeJS(`
        (function() {
          var body = document.body.innerText;
          if (body.includes('Something went wrong')) return 'error';
          if (body.includes('rate') && body.includes('limit')) return 'rate_limit';
          return '';
        })()
      `);
      if (error === 'rate_limit') {
        this.log('⚠ Rate limited — waiting 60s...');
        await this.wait(60000);
      } else if (error === 'error') {
        this.log('⚠ Page error — refreshing...');
        await this.executeJS(`window.location.reload()`);
        await this.wait(5000);
      }

      scrollCount++;
    }

    this.log(`✓ Finished: ${seen.size} unique posts in ${scrollCount} scrolls`);
    return Array.from(seen.values());
  }

  // ─── Creator Ranking ───────────────────────────────────────

  rankCreators(posts: ThreadsPost[], niche: string, topN: number = this.config.creatorsPerNiche): ThreadsCreator[] {
    const creatorMap = new Map<string, ThreadsCreator>();
    const creatorPosts = new Map<string, ThreadsPost[]>();

    for (const post of posts) {
      const existing = creatorMap.get(post.author);
      if (existing) {
        existing.postCount++;
        existing.totalLikes += post.likes;
        existing.totalReplies += post.replies;
        existing.totalReposts += post.reposts;
        existing.totalEngagement += post.engagementScore;
        existing.avgEngagement = existing.totalEngagement / existing.postCount;
        if (post.engagementScore > existing.topPostEngagement) {
          existing.topPostUrl = post.url;
          existing.topPostEngagement = post.engagementScore;
        }
        if (post.isVerified) existing.isVerified = true;
        creatorPosts.get(post.author)!.push(post);
      } else {
        creatorMap.set(post.author, {
          handle: post.author,
          displayName: post.authorDisplayName,
          isVerified: post.isVerified,
          followers: 0,
          following: 0,
          bio: '',
          postCount: 1,
          totalLikes: post.likes,
          totalReplies: post.replies,
          totalReposts: post.reposts,
          totalEngagement: post.engagementScore,
          avgEngagement: post.engagementScore,
          topPostUrl: post.url,
          topPostEngagement: post.engagementScore,
          topPosts: [],
          niche,
        });
        creatorPosts.set(post.author, [post]);
      }
    }

    // Populate topPosts (top 3 by engagement)
    for (const [handle, creator] of creatorMap) {
      const sorted = (creatorPosts.get(handle) || [])
        .sort((a, b) => b.engagementScore - a.engagementScore)
        .slice(0, 3);
      creator.topPosts = sorted.map(p => ({
        url: p.url,
        text: p.text,
        likes: p.likes,
        replies: p.replies,
        reposts: p.reposts,
        engagement: p.engagementScore,
      }));
    }

    return Array.from(creatorMap.values())
      .sort((a, b) => b.totalEngagement - a.totalEngagement || b.avgEngagement - a.avgEngagement)
      .slice(0, topN);
  }

  // ─── Search Query Variants ─────────────────────────────────

  buildSearchQueries(niche: string): string[] {
    const base = niche.trim();
    return [
      base,
      `"${base}"`,
      `#${base.replace(/\s+/g, '')}`,
      `${base} tips`,
      `${base} growth`,
    ];
  }

  // ─── Full Niche Research ───────────────────────────────────

  async researchNiche(niche: string): Promise<ThreadsNicheResult> {
    const startTime = Date.now();
    const startISO = new Date().toISOString();
    const allPosts = new Map<string, ThreadsPost>();
    const queries = this.buildSearchQueries(niche);
    const targetPerQuery = Math.ceil(this.config.postsPerNiche / queries.length);

    this.log(`${'═'.repeat(55)}`);
    this.log(`NICHE: "${niche}" — target ${this.config.postsPerNiche} posts across ${queries.length} queries`);
    this.log(`${'═'.repeat(55)}`);

    for (const query of queries) {
      if (allPosts.size >= this.config.postsPerNiche) break;

      const remaining = this.config.postsPerNiche - allPosts.size;
      const target = Math.min(targetPerQuery, remaining);

      const searched = await this.search(query);
      if (!searched) {
        this.log(`✗ Search failed for "${query}", skipping`);
        continue;
      }

      const posts = await this.scrollAndCollect(niche, target);
      let newCount = 0;
      for (const post of posts) {
        if (!allPosts.has(post.id)) {
          allPosts.set(post.id, post);
          newCount++;
        }
      }
      this.log(`query "${query}": ${posts.length} collected, ${newCount} new → total ${allPosts.size}`);

      await this.wait(3000);
    }

    const postArray = Array.from(allPosts.values())
      .sort((a, b) => b.engagementScore - a.engagementScore);

    const creators = this.rankCreators(postArray, niche);

    // Enrich top creators with profile data (followers/following/bio)
    const enrichCount = Math.min(this.config.enrichTopCreators, creators.length);
    if (enrichCount > 0) {
      this.log(`→ Enriching top ${enrichCount} creators with profile data...`);
      for (let i = 0; i < enrichCount; i++) {
        const c = creators[i];
        this.log(`  profile [${i + 1}/${enrichCount}] @${c.handle}`);
        const profile = await this.getCreatorProfile(c.handle);
        if (profile) {
          c.followers = profile.followers;
          c.following = profile.following;
          c.bio = profile.bio;
        }
        if (i < enrichCount - 1) await this.wait(1500);
      }
    }

    const result: ThreadsNicheResult = {
      niche,
      query: queries[0],
      posts: postArray,
      creators,
      totalCollected: postArray.length,
      uniquePosts: postArray.length,
      collectionStarted: startISO,
      collectionFinished: new Date().toISOString(),
      durationMs: Date.now() - startTime,
    };

    this.log(`✓ NICHE "${niche}" complete: ${postArray.length} posts, ${creators.length} creators in ${(result.durationMs/1000).toFixed(1)}s`);
    return result;
  }

  // ─── Multi-Niche Orchestrator ──────────────────────────────

  async runFullResearch(niches: string[]): Promise<{
    results: ThreadsNicheResult[];
    summary: { totalPosts: number; totalCreators: number; totalDurationMs: number; niches: string[] };
  }> {
    const startTime = Date.now();
    const results: ThreadsNicheResult[] = [];

    this.log(`${'═'.repeat(55)}`);
    this.log(`FULL RESEARCH — ${niches.length} niches, target ${this.config.postsPerNiche * niches.length} posts total`);
    this.log(`${'═'.repeat(55)}`);

    for (let i = 0; i < niches.length; i++) {
      this.log(`── niche ${i + 1}/${niches.length}: "${niches[i]}" ──`);
      const result = await this.researchNiche(niches[i]);
      results.push(result);
      await this.saveResults(results, 'intermediate');
      if (i < niches.length - 1) {
        this.log('pausing 5s between niches...');
        await this.wait(5000);
      }
    }

    const summary = {
      totalPosts: results.reduce((s, r) => s + r.totalCollected, 0),
      totalCreators: results.reduce((s, r) => s + r.creators.length, 0),
      totalDurationMs: Date.now() - startTime,
      niches,
    };

    await this.saveResults(results, 'final');

    this.log(`${'═'.repeat(55)}`);
    this.log(`✓ COMPLETE: ${summary.totalPosts} posts, ${summary.totalCreators} creators in ${(summary.totalDurationMs/1000).toFixed(1)}s`);
    this.log(`${'═'.repeat(55)}`);

    return { results, summary };
  }

  // ─── Persistence ───────────────────────────────────────────

  async saveResults(results: ThreadsNicheResult[], label: string = 'research'): Promise<string> {
    if (!fs.existsSync(this.config.outputDir)) {
      fs.mkdirSync(this.config.outputDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `threads-research-${label}-${timestamp}.json`;
    const filepath = path.join(this.config.outputDir, filename);

    const output = {
      metadata: { generatedAt: new Date().toISOString(), label, config: this.config },
      results,
      allCreators: this.mergeCreators(results),
    };

    fs.writeFileSync(filepath, JSON.stringify(output, null, 2));
    this.log(`saved → ${filepath}`);
    return filepath;
  }

  private mergeCreators(results: ThreadsNicheResult[]): (ThreadsCreator & { niches: string[] })[] {
    const merged = new Map<string, ThreadsCreator & { niches: string[] }>();
    for (const result of results) {
      for (const creator of result.creators) {
        const existing = merged.get(creator.handle);
        if (existing) {
          existing.postCount += creator.postCount;
          existing.totalLikes += creator.totalLikes;
          existing.totalReplies += creator.totalReplies;
          existing.totalReposts += creator.totalReposts;
          existing.totalEngagement += creator.totalEngagement;
          existing.avgEngagement = existing.totalEngagement / existing.postCount;
          if (creator.topPostEngagement > existing.topPostEngagement) {
            existing.topPostUrl = creator.topPostUrl;
            existing.topPostEngagement = creator.topPostEngagement;
          }
          if (!existing.niches.includes(creator.niche)) existing.niches.push(creator.niche);
        } else {
          merged.set(creator.handle, { ...creator, niches: [creator.niche] });
        }
      }
    }
    return Array.from(merged.values()).sort((a, b) => b.totalEngagement - a.totalEngagement);
  }

  printSummary(results: ThreadsNicheResult[]): void {
    console.log('\n┌─────────────────────────────────────────────────────────────┐');
    console.log('│                THREADS RESEARCH SUMMARY                     │');
    console.log('├──────────────────┬──────────┬──────────┬───────────────────┤');
    console.log('│ Niche            │ Posts    │ Creators │ Top Creator       │');
    console.log('├──────────────────┼──────────┼──────────┼───────────────────┤');
    for (const r of results) {
      const niche = r.niche.substring(0, 16).padEnd(16);
      const posts = String(r.totalCollected).padStart(8);
      const creators = String(r.creators.length).padStart(8);
      const top = r.creators[0] ? `@${r.creators[0].handle}`.substring(0, 17).padEnd(17) : 'N/A'.padEnd(17);
      console.log(`│ ${niche} │ ${posts} │ ${creators} │ ${top} │`);
    }
    console.log('└──────────────────┴──────────┴──────────┴───────────────────┘');
  }
}
