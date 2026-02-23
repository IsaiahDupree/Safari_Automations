/**
 * Instagram Market Research — Safari Automation
 *
 * Searches Instagram by hashtag/explore, extracts top posts with engagement
 * metrics, identifies top creators, and saves structured results.
 *
 * Capabilities:
 *   - Navigate to hashtag explore pages (/explore/tags/{tag}/)
 *   - Extract posts: URL, author, engagement (likes, comments)
 *   - Open individual posts to scrape detailed metrics
 *   - Scroll & paginate to collect hundreds of posts per niche
 *   - Deduplicate posts by shortcode
 *   - Rank creators by total engagement
 *   - Orchestrate multi-niche research (e.g. 5 niches × 1000 posts)
 *   - Persist results to timestamped JSON
 *
 * Note: Instagram's web UI requires opening each post individually
 * to see full engagement metrics. The researcher uses a two-pass approach:
 *   Pass 1: Collect post URLs from grid/explore pages (fast)
 *   Pass 2: Open top posts to extract detailed engagement (slower, optional)
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

export interface InstagramPost {
  id: string;                   // shortcode from URL
  url: string;                  // full post URL
  text: string;                 // caption (up to 500 chars)
  author: string;               // username
  authorDisplayName: string;
  isVerified: boolean;
  likes: number;
  comments: number;
  engagementScore: number;      // likes + comments * 2
  hasVideo: boolean;
  hashtags: string[];
  mentions: string[];
  timestamp: string;
  niche: string;
  collectedAt: string;
}

export interface InstagramCreator {
  handle: string;
  displayName: string;
  isVerified: boolean;
  postCount: number;
  totalLikes: number;
  totalComments: number;
  totalEngagement: number;
  avgEngagement: number;
  topPostUrl: string;
  topPostEngagement: number;
  niche: string;
}

export interface InstagramNicheResult {
  niche: string;
  query: string;
  posts: InstagramPost[];
  creators: InstagramCreator[];
  totalCollected: number;
  uniquePosts: number;
  collectionStarted: string;
  collectionFinished: string;
  durationMs: number;
}

export interface InstagramResearchConfig {
  postsPerNiche: number;
  creatorsPerNiche: number;
  scrollPauseMs: number;
  maxScrollsPerSearch: number;
  detailedScrapeTop: number;    // how many top posts to open for detailed metrics
  timeout: number;
  outputDir: string;
  maxRetries: number;
}

export const DEFAULT_IG_RESEARCH_CONFIG: InstagramResearchConfig = {
  postsPerNiche: 1000,
  creatorsPerNiche: 100,
  scrollPauseMs: 1800,
  maxScrollsPerSearch: 200,
  detailedScrapeTop: 50,
  timeout: 30000,
  outputDir: path.join(os.homedir(), 'Documents/instagram-research'),
  maxRetries: 3,
};

// ═══════════════════════════════════════════════════════════════
// InstagramResearcher
// ═══════════════════════════════════════════════════════════════

export class InstagramResearcher {
  private config: InstagramResearchConfig;

  constructor(config: Partial<InstagramResearchConfig> = {}) {
    this.config = { ...DEFAULT_IG_RESEARCH_CONFIG, ...config };
  }

  // ─── Low-level Safari helpers ──────────────────────────────

  private async executeJS(script: string): Promise<string> {
    const tmpFile = path.join(os.tmpdir(), `safari_ig_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.scpt`);
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
      await this.wait(500);
    }
    return false;
  }

  // ─── Search Navigation ─────────────────────────────────────

  /**
   * Navigate to an Instagram hashtag explore page.
   * This is the primary way to discover posts by niche.
   */
  async searchHashtag(hashtag: string): Promise<boolean> {
    const tag = hashtag.replace(/^#/, '').replace(/\s+/g, '').toLowerCase();
    const url = `https://www.instagram.com/explore/tags/${encodeURIComponent(tag)}/`;

    console.log(`[IG Research] Searching hashtag: #${tag}`);
    const ok = await this.navigate(url);
    if (!ok) return false;

    // Wait for grid to render
    const loaded = await this.waitForSelector('article a[href*="/p/"], a[href*="/reel/"]', 12000);
    if (!loaded) {
      // Check for "Page not found" or restricted hashtag
      const error = await this.executeJS(`
        (function() {
          var body = document.body.innerText || '';
          if (body.includes('Page Not Found') || body.includes("Sorry, this page isn't available")) return 'not_found';
          if (body.includes('hidden') && body.includes('community guidelines')) return 'hidden';
          return '';
        })()
      `);
      if (error) {
        console.log(`[IG Research] Hashtag #${tag}: ${error}`);
        return false;
      }
    }

    return loaded;
  }

  /**
   * Navigate to Instagram search results page.
   */
  async searchExplore(query: string): Promise<boolean> {
    const url = `https://www.instagram.com/explore/search/keyword/?q=${encodeURIComponent(query)}`;

    console.log(`[IG Research] Searching explore: "${query}"`);
    const ok = await this.navigate(url);
    if (!ok) return false;

    const loaded = await this.waitForSelector('a[href*="/p/"], a[href*="/reel/"]', 12000);
    return loaded;
  }

  // ─── Post URL Collection (Pass 1: Grid scraping) ───────────

  /**
   * Extract all visible post URLs from the hashtag/explore grid.
   * This is fast — we collect shortcodes without opening each post.
   */
  async extractPostUrls(niche: string): Promise<InstagramPost[]> {
    const raw = await this.executeJS(`
      (function() {
        var results = [];
        var links = document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]');
        var seen = new Set();

        for (var i = 0; i < links.length; i++) {
          var href = links[i].getAttribute('href') || '';
          // Extract shortcode from /p/ABC123/ or /reel/ABC123/
          var m = href.match(/\\/(p|reel)\\/([A-Za-z0-9_-]+)/);
          if (!m) continue;
          var shortcode = m[2];
          if (seen.has(shortcode)) continue;
          seen.add(shortcode);

          var url = href.startsWith('http') ? href : 'https://www.instagram.com' + href;

          // Try to find username from nearby container
          var container = links[i].closest('article') || links[i].closest('div');
          var userLink = null;
          if (container) {
            var uLinks = container.querySelectorAll('a[href^="/"]');
            for (var u = 0; u < uLinks.length; u++) {
              var uhref = uLinks[u].getAttribute('href') || '';
              if (uhref.match(/^\\/[a-zA-Z0-9_.]+\\/$/) && !uhref.includes('/p/') && !uhref.includes('/reel/') && !uhref.includes('/explore/')) {
                userLink = uhref.replace(/\\//g, '');
                break;
              }
            }
          }

          // Check for video indicator
          var hasVideo = !!links[i].querySelector('svg[aria-label="Reel"], svg[aria-label="Video"], span[aria-label="Video"]');

          results.push({
            id: shortcode,
            url: url,
            author: userLink || '',
            hasVideo: hasVideo
          });
        }

        return JSON.stringify(results);
      })()
    `);

    try {
      const parsed = JSON.parse(raw || '[]') as Array<any>;
      const now = new Date().toISOString();
      return parsed.map(p => ({
        id: p.id,
        url: p.url,
        text: '',
        author: p.author || '',
        authorDisplayName: '',
        isVerified: false,
        likes: 0,
        comments: 0,
        engagementScore: 0,
        hasVideo: p.hasVideo || false,
        hashtags: [],
        mentions: [],
        timestamp: '',
        niche,
        collectedAt: now,
      }));
    } catch {
      return [];
    }
  }

  // ─── Detailed Post Scraping (Pass 2) ───────────────────────

  /**
   * Open an individual post and extract detailed metrics.
   * This is slower but gives us engagement data.
   */
  async scrapePostDetails(post: InstagramPost): Promise<InstagramPost> {
    try {
      await this.navigate(post.url);
      await this.wait(2500);

      const raw = await this.executeJS(`
        (function() {
          var data = {
            author: '', displayName: '', text: '', likes: 0, comments: 0,
            isVerified: false, hashtags: [], mentions: [], timestamp: ''
          };

          // Author — try multiple approaches since Instagram varies its DOM
          var article = document.querySelector('article');

          // Approach 1: header area with username link
          var header = article ? article.querySelector('header') : null;
          if (header) {
            var hLinks = header.querySelectorAll('a[href^="/"]');
            for (var i = 0; i < hLinks.length; i++) {
              var href = hLinks[i].getAttribute('href') || '';
              if (href.match(/^\\/[a-zA-Z0-9_.]+\\/$/) && !href.includes('/p/') && !href.includes('/explore/')) {
                data.author = href.replace(/\\//g, '');
                data.displayName = hLinks[i].textContent.trim();
                break;
              }
            }
          }

          // Approach 2: any link in article matching username pattern
          if (!data.author && article) {
            var aLinks = article.querySelectorAll('a[href^="/"]');
            for (var i = 0; i < aLinks.length; i++) {
              var href = aLinks[i].getAttribute('href') || '';
              if (href.match(/^\\/[a-zA-Z0-9_.]+\\/$/) && !href.includes('/p/') && !href.includes('/explore/') && !href.includes('/reel/')) {
                data.author = href.replace(/\\//g, '');
                data.displayName = aLinks[i].textContent.trim();
                break;
              }
            }
          }

          // Approach 3: meta tag og:description often has "X Likes, Y Comments - @username"
          if (!data.author) {
            var meta = document.querySelector('meta[property="og:description"]');
            if (meta) {
              var desc = meta.getAttribute('content') || '';
              var atMatch = desc.match(/@([a-zA-Z0-9_.]+)/);
              if (atMatch) data.author = atMatch[1];
            }
          }

          // Approach 4: extract from URL path like /username/p/shortcode/
          if (!data.author) {
            var urlMatch = window.location.pathname.match(/^\\/([a-zA-Z0-9_.]+)\\/(?:p|reel)\\//);
            if (urlMatch) data.author = urlMatch[1];
          }

          // Verified
          data.isVerified = !!document.querySelector('svg[aria-label="Verified"]');

          // Caption
          var captionSelectors = ['article h1', 'article span[class]', 'article ul li:first-child span'];
          for (var s = 0; s < captionSelectors.length; s++) {
            var el = document.querySelector(captionSelectors[s]);
            if (el && el.textContent.trim().length > 10) {
              data.text = el.textContent.trim().substring(0, 500);
              break;
            }
          }

          // Hashtags
          var hashLinks = document.querySelectorAll('a[href*="/explore/tags/"]');
          hashLinks.forEach(function(l) { var t = l.textContent.trim(); if (t.startsWith('#')) data.hashtags.push(t); });

          // Mentions
          var mentionLinks = document.querySelectorAll('a[href^="/"]:not([href*="/p/"]):not([href*="/explore/"])');
          mentionLinks.forEach(function(l) { var t = l.textContent.trim(); if (t.startsWith('@')) data.mentions.push(t); });

          // Likes — look for text like "X likes" or aria-labels
          var bodyText = (article || document.body).innerText || '';
          var likeMatch = bodyText.match(/([\\.\\d,]+[KkMm]?)\\s*like/i);
          if (likeMatch) {
            var v = likeMatch[1].replace(/,/g, '');
            data.likes = parseInt(v) || 0;
            if (v.includes('K') || v.includes('k')) data.likes = Math.round(parseFloat(v) * 1000);
            if (v.includes('M') || v.includes('m')) data.likes = Math.round(parseFloat(v) * 1000000);
          }

          // Comments count
          var commentMatch = bodyText.match(/([\\.\\d,]+[KkMm]?)\\s*comment/i);
          if (commentMatch) {
            var c = commentMatch[1].replace(/,/g, '');
            data.comments = parseInt(c) || 0;
            if (c.includes('K') || c.includes('k')) data.comments = Math.round(parseFloat(c) * 1000);
            if (c.includes('M') || c.includes('m')) data.comments = Math.round(parseFloat(c) * 1000000);
          }

          // Fallback: try to find likes from section with aria content
          if (data.likes === 0) {
            var sections = document.querySelectorAll('section');
            for (var i = 0; i < sections.length; i++) {
              var secText = sections[i].innerText || '';
              var secMatch = secText.match(/([\\.\\d,]+[KkMm]?)\\s*like/i);
              if (secMatch) {
                var sv = secMatch[1].replace(/,/g, '');
                data.likes = parseInt(sv) || 0;
                if (sv.includes('K') || sv.includes('k')) data.likes = Math.round(parseFloat(sv) * 1000);
                if (sv.includes('M') || sv.includes('m')) data.likes = Math.round(parseFloat(sv) * 1000000);
                break;
              }
            }
          }

          // Timestamp
          var timeEl = document.querySelector('time');
          data.timestamp = timeEl ? (timeEl.getAttribute('datetime') || timeEl.innerText || '') : '';

          return JSON.stringify(data);
        })()
      `);

      const details = JSON.parse(raw || '{}');
      return {
        ...post,
        author: details.author || post.author,
        authorDisplayName: details.displayName || '',
        text: details.text || '',
        isVerified: details.isVerified || false,
        likes: details.likes || 0,
        comments: details.comments || 0,
        engagementScore: (details.likes || 0) + (details.comments || 0) * 2,
        hashtags: details.hashtags || [],
        mentions: details.mentions || [],
        timestamp: details.timestamp || '',
      };
    } catch {
      return post;
    }
  }

  // ─── Scroll & Collect ──────────────────────────────────────

  async scrollAndCollect(niche: string, targetCount: number): Promise<InstagramPost[]> {
    const seen = new Map<string, InstagramPost>();
    let noNewCount = 0;
    let scrollCount = 0;

    console.log(`[IG Research] Collecting up to ${targetCount} post URLs for "${niche}"`);

    while (seen.size < targetCount && scrollCount < this.config.maxScrollsPerSearch) {
      const batch = await this.extractPostUrls(niche);
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
          console.log(`[IG Research] No new posts after 5 scrolls, stopping at ${seen.size}`);
          break;
        }
      } else {
        noNewCount = 0;
      }

      if (scrollCount % 10 === 0) {
        console.log(`[IG Research] Scroll ${scrollCount}: ${seen.size}/${targetCount} posts collected`);
      }

      await this.executeJS(`window.scrollBy(0, window.innerHeight * 2)`);
      await this.wait(this.config.scrollPauseMs);

      // Error detection
      const error = await this.executeJS(`
        (function() {
          var body = document.body.innerText || '';
          if (body.includes('Action Blocked')) return 'blocked';
          if (body.includes('Try Again Later')) return 'rate_limit';
          return '';
        })()
      `);
      if (error === 'rate_limit' || error === 'blocked') {
        console.log(`[IG Research] ${error}, waiting 60s...`);
        await this.wait(60000);
      }

      scrollCount++;
    }

    console.log(`[IG Research] Finished grid collection: ${seen.size} unique post URLs in ${scrollCount} scrolls`);
    return Array.from(seen.values());
  }

  // ─── Detailed Scrape for Top Posts ─────────────────────────

  /**
   * Open the top N posts individually to get detailed engagement data.
   * This is the slow pass — use for ranking purposes.
   */
  async scrapeTopPostDetails(posts: InstagramPost[], count: number = this.config.detailedScrapeTop): Promise<InstagramPost[]> {
    const toScrape = posts.slice(0, count);
    console.log(`[IG Research] Scraping details for ${toScrape.length} posts...`);

    const results: InstagramPost[] = [];
    for (let i = 0; i < toScrape.length; i++) {
      if (i % 10 === 0) {
        console.log(`[IG Research] Detail scrape: ${i}/${toScrape.length}`);
      }
      const detailed = await this.scrapePostDetails(toScrape[i]);
      results.push(detailed);
      await this.wait(800); // Brief pause between post loads
    }

    // Merge: detailed posts replace their grid-only versions
    const detailedMap = new Map(results.map(p => [p.id, p]));
    return posts.map(p => detailedMap.get(p.id) || p);
  }

  // ─── Creator Ranking ───────────────────────────────────────

  rankCreators(posts: InstagramPost[], niche: string, topN: number = this.config.creatorsPerNiche): InstagramCreator[] {
    const creatorMap = new Map<string, InstagramCreator>();

    for (const post of posts) {
      if (!post.author) continue;
      const existing = creatorMap.get(post.author);
      if (existing) {
        existing.postCount++;
        existing.totalLikes += post.likes;
        existing.totalComments += post.comments;
        existing.totalEngagement += post.engagementScore;
        existing.avgEngagement = existing.totalEngagement / existing.postCount;
        if (post.engagementScore > existing.topPostEngagement) {
          existing.topPostUrl = post.url;
          existing.topPostEngagement = post.engagementScore;
        }
        if (post.isVerified) existing.isVerified = true;
      } else {
        creatorMap.set(post.author, {
          handle: post.author,
          displayName: post.authorDisplayName,
          isVerified: post.isVerified,
          postCount: 1,
          totalLikes: post.likes,
          totalComments: post.comments,
          totalEngagement: post.engagementScore,
          avgEngagement: post.engagementScore,
          topPostUrl: post.url,
          topPostEngagement: post.engagementScore,
          niche,
        });
      }
    }

    return Array.from(creatorMap.values())
      .sort((a, b) => b.totalEngagement - a.totalEngagement || b.avgEngagement - a.avgEngagement)
      .slice(0, topN);
  }

  // ─── Search Query Variants ─────────────────────────────────

  buildSearchQueries(niche: string): string[] {
    const base = niche.trim().toLowerCase();
    const tag = base.replace(/\s+/g, '');
    return [
      tag,                                 // main hashtag
      `${tag}tips`,                        // tips variant
      `${tag}strategy`,                    // strategy variant
      base.split(' ')[0],                 // first word only
      `${tag}community`,                  // community variant
    ];
  }

  // ─── Full Niche Research ───────────────────────────────────

  async researchNiche(niche: string): Promise<InstagramNicheResult> {
    const startTime = Date.now();
    const startISO = new Date().toISOString();
    const allPosts = new Map<string, InstagramPost>();
    const queries = this.buildSearchQueries(niche);
    const targetPerQuery = Math.ceil(this.config.postsPerNiche / queries.length);

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`[IG Research] NICHE: "${niche}" — target ${this.config.postsPerNiche} posts`);
    console.log(`[IG Research] Running ${queries.length} hashtag searches`);
    console.log(`${'═'.repeat(60)}`);

    for (const query of queries) {
      if (allPosts.size >= this.config.postsPerNiche) break;

      const remaining = this.config.postsPerNiche - allPosts.size;
      const target = Math.min(targetPerQuery, remaining);

      const searched = await this.searchHashtag(query);
      if (!searched) {
        console.log(`[IG Research] Hashtag #${query} failed, skipping`);
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
      console.log(`[IG Research] #${query}: ${posts.length} collected, ${newCount} new (total: ${allPosts.size})`);

      await this.wait(3000);
    }

    let postArray = Array.from(allPosts.values());

    // Pass 2: Scrape detailed engagement for top posts
    if (this.config.detailedScrapeTop > 0 && postArray.length > 0) {
      console.log(`[IG Research] Starting detailed scrape (top ${this.config.detailedScrapeTop})...`);
      postArray = await this.scrapeTopPostDetails(postArray, this.config.detailedScrapeTop);
    }

    // Sort by engagement
    postArray.sort((a, b) => b.engagementScore - a.engagementScore);

    const creators = this.rankCreators(postArray, niche);

    const result: InstagramNicheResult = {
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

    console.log(`[IG Research] NICHE "${niche}" complete: ${postArray.length} posts, ${creators.length} creators in ${result.durationMs}ms`);
    return result;
  }

  // ─── Multi-Niche Orchestrator ──────────────────────────────

  async runFullResearch(niches: string[]): Promise<{
    results: InstagramNicheResult[];
    summary: { totalPosts: number; totalCreators: number; totalDurationMs: number; niches: string[] };
  }> {
    const startTime = Date.now();
    const results: InstagramNicheResult[] = [];

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`[IG Research] FULL RESEARCH — ${niches.length} niches`);
    console.log(`[IG Research] Target: ${this.config.postsPerNiche} posts × ${niches.length} niches = ${this.config.postsPerNiche * niches.length} total`);
    console.log(`${'═'.repeat(60)}\n`);

    for (let i = 0; i < niches.length; i++) {
      console.log(`\n[IG Research] ── Niche ${i + 1}/${niches.length}: "${niches[i]}" ──`);
      const result = await this.researchNiche(niches[i]);
      results.push(result);
      await this.saveResults(results, 'intermediate');
      if (i < niches.length - 1) {
        console.log('[IG Research] Pausing 5s between niches...');
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

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`[IG Research] COMPLETE: ${summary.totalPosts} posts, ${summary.totalCreators} creators`);
    console.log(`${'═'.repeat(60)}\n`);

    return { results, summary };
  }

  // ─── Persistence ───────────────────────────────────────────

  async saveResults(results: InstagramNicheResult[], label: string = 'research'): Promise<string> {
    if (!fs.existsSync(this.config.outputDir)) {
      fs.mkdirSync(this.config.outputDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `instagram-research-${label}-${timestamp}.json`;
    const filepath = path.join(this.config.outputDir, filename);

    const output = {
      metadata: { generatedAt: new Date().toISOString(), label, config: this.config },
      results,
      allCreators: this.mergeCreators(results),
    };

    fs.writeFileSync(filepath, JSON.stringify(output, null, 2));
    console.log(`[IG Research] Saved: ${filepath}`);
    return filepath;
  }

  private mergeCreators(results: InstagramNicheResult[]): (InstagramCreator & { niches: string[] })[] {
    const merged = new Map<string, InstagramCreator & { niches: string[] }>();
    for (const result of results) {
      for (const creator of result.creators) {
        const existing = merged.get(creator.handle);
        if (existing) {
          existing.postCount += creator.postCount;
          existing.totalLikes += creator.totalLikes;
          existing.totalComments += creator.totalComments;
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

  printSummary(results: InstagramNicheResult[]): void {
    console.log('\n┌─────────────────────────────────────────────────────────────┐');
    console.log('│               INSTAGRAM RESEARCH SUMMARY                    │');
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
