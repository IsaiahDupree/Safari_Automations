/**
 * Facebook Market Research — Safari Automation
 *
 * Searches Facebook for public posts by keyword, extracts engagement
 * metrics (reactions, comments, shares), identifies top creators,
 * and saves structured results.
 *
 * Capabilities:
 *   - Search posts via facebook.com/search/posts/?q=
 *   - Extract posts: URL, author, text, reactions, comments, shares
 *   - Scroll & paginate to collect hundreds of posts per niche
 *   - Deduplicate by post ID / URL
 *   - Rank creators (pages/profiles) by total engagement
 *   - Orchestrate multi-niche research (e.g. 5 niches × 1000 posts)
 *   - Persist results to timestamped JSON
 *
 * Facebook DOM notes (2026):
 *   - Posts in search results are div[role="article"]
 *   - Author links are in h2/h3 or strong > a elements
 *   - Reaction counts in aria-labels like "X people reacted"
 *   - Comment/share counts as spans near the post actions
 *   - Post links contain /posts/, /permalink/, or /photo/
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

export interface FacebookPost {
  id: string;
  url: string;
  text: string;
  author: string;
  authorUrl: string;
  authorType: 'page' | 'profile' | 'group' | 'unknown';
  isVerified: boolean;
  reactions: number;
  comments: number;
  shares: number;
  engagementScore: number;      // reactions + comments*2 + shares*3
  hasImage: boolean;
  hasVideo: boolean;
  timestamp: string;
  niche: string;
  collectedAt: string;
}

export interface FacebookCreator {
  name: string;
  url: string;
  type: 'page' | 'profile' | 'group' | 'unknown';
  isVerified: boolean;
  postCount: number;
  totalReactions: number;
  totalComments: number;
  totalShares: number;
  totalEngagement: number;
  avgEngagement: number;
  topPostUrl: string;
  topPostEngagement: number;
  niche: string;
}

export interface FacebookNicheResult {
  niche: string;
  query: string;
  posts: FacebookPost[];
  creators: FacebookCreator[];
  totalCollected: number;
  uniquePosts: number;
  collectionStarted: string;
  collectionFinished: string;
  durationMs: number;
}

export interface FacebookResearchConfig {
  postsPerNiche: number;
  creatorsPerNiche: number;
  scrollPauseMs: number;
  maxScrollsPerSearch: number;
  timeout: number;
  outputDir: string;
  maxRetries: number;
}

export const DEFAULT_FB_RESEARCH_CONFIG: FacebookResearchConfig = {
  postsPerNiche: 1000,
  creatorsPerNiche: 100,
  scrollPauseMs: 2000,
  maxScrollsPerSearch: 200,
  timeout: 30000,
  outputDir: path.join(os.homedir(), 'Documents/facebook-research'),
  maxRetries: 3,
};

// ═══════════════════════════════════════════════════════════════
// FacebookResearcher
// ═══════════════════════════════════════════════════════════════

export class FacebookResearcher {
  private config: FacebookResearchConfig;

  constructor(config: Partial<FacebookResearchConfig> = {}) {
    this.config = { ...DEFAULT_FB_RESEARCH_CONFIG, ...config };
  }

  // ─── Low-level Safari helpers ──────────────────────────────

  private async executeJS(script: string): Promise<string> {
    const tmpFile = path.join(os.tmpdir(), `safari_fb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.scpt`);
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

  private async waitForSelector(selector: string, timeoutMs = 12000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const found = await this.executeJS(`(function(){ return document.querySelector('${selector}') ? 'found' : ''; })()`);
      if (found === 'found') return true;
      await this.wait(600);
    }
    return false;
  }

  // ─── Parse engagement numbers ──────────────────────────────

  private parseEngagement(text: string): number {
    if (!text) return 0;
    const cleaned = text.replace(/,/g, '').trim();
    const match = cleaned.match(/([\d.]+)\s*([KkMm]?)/);
    if (!match) return 0;
    let val = parseFloat(match[1]);
    const suffix = match[2].toLowerCase();
    if (suffix === 'k') val *= 1000;
    if (suffix === 'm') val *= 1000000;
    return Math.round(val);
  }

  // ─── Search ────────────────────────────────────────────────

  /**
   * Search Facebook posts by keyword.
   */
  async search(query: string): Promise<boolean> {
    const url = `https://www.facebook.com/search/posts/?q=${encodeURIComponent(query)}`;
    console.log(`[FB Research] Searching: "${query}"`);
    const ok = await this.navigate(url);
    if (!ok) return false;

    // Wait for articles to appear
    const loaded = await this.waitForSelector('div[role="article"], div[role="feed"]', 15000);
    if (!loaded) {
      // Check for login wall or error
      const error = await this.executeJS(`
        (function() {
          var body = document.body.innerText || '';
          if (body.includes('Log in') && body.includes('Create new account')) return 'login_required';
          if (body.includes('No results found')) return 'no_results';
          return '';
        })()
      `);
      if (error) {
        console.log(`[FB Research] Search issue: ${error}`);
        return false;
      }
    }
    return loaded;
  }

  // ─── Extract visible posts ─────────────────────────────────

  async extractVisiblePosts(niche: string): Promise<FacebookPost[]> {
    const raw = await this.executeJS(`
      (function() {
        var results = [];
        var articles = document.querySelectorAll('div[role="article"]');

        for (var i = 0; i < articles.length; i++) {
          var article = articles[i];

          // Extract post URL
          var postUrl = '';
          var postId = '';
          var links = article.querySelectorAll('a[href*="/posts/"], a[href*="/permalink/"], a[href*="/photo/"], a[href*="/videos/"]');
          if (links.length > 0) {
            postUrl = links[0].href || '';
            var idMatch = postUrl.match(/\\/(posts|permalink|photo|videos)\\/([^/?]+)/);
            if (idMatch) postId = idMatch[2];
          }
          // Fallback: use timestamp link
          if (!postUrl) {
            var timeLink = article.querySelector('a[href*="/groups/"] + span a, a[aria-label] span');
            if (timeLink && timeLink.closest('a')) {
              postUrl = timeLink.closest('a').href || '';
            }
          }

          if (!postId && postUrl) {
            postId = 'fb_' + postUrl.replace(/[^a-zA-Z0-9]/g, '').substring(0, 32);
          }
          if (!postId) postId = 'fb_pos_' + i + '_' + Date.now();

          // Author
          var authorName = '';
          var authorUrl = '';
          var authorType = 'unknown';
          var isVerified = false;

          var authorEl = article.querySelector('h2 a, h3 a, h4 a, strong a[role="link"]');
          if (authorEl) {
            authorName = authorEl.textContent.trim();
            authorUrl = authorEl.href || '';
            if (authorUrl.includes('/groups/')) authorType = 'group';
            else if (authorUrl.includes('/pages/') || authorUrl.includes('/page/')) authorType = 'page';
            else authorType = 'profile';
          }

          // Verified badge
          isVerified = !!article.querySelector('svg[aria-label="Verified account"], svg[aria-label="Verified"]');

          // Post text
          var textEl = article.querySelector('div[data-ad-comet-preview="message"], div[dir="auto"][style]');
          var text = '';
          if (textEl) text = textEl.textContent.trim().substring(0, 500);
          if (!text) {
            var spans = article.querySelectorAll('div[dir="auto"]');
            for (var s = 0; s < spans.length; s++) {
              var t = spans[s].textContent.trim();
              if (t.length > 20 && !t.includes('Comment') && !t.includes('Share') && !t.includes('Like')) {
                text = t.substring(0, 500);
                break;
              }
            }
          }

          // Reactions — look for aria-labels and text
          var reactions = 0;
          var reactionLabels = article.querySelectorAll('[aria-label*="reaction" i], [aria-label*="like" i], [aria-label*="people reacted" i]');
          for (var r = 0; r < reactionLabels.length; r++) {
            var label = reactionLabels[r].getAttribute('aria-label') || '';
            var numMatch = label.match(/([\\.\\d,]+[KkMm]?)/);
            if (numMatch) {
              var v = numMatch[1].replace(/,/g, '');
              var parsed = parseFloat(v) || 0;
              if (v.includes('K') || v.includes('k')) parsed *= 1000;
              if (v.includes('M') || v.includes('m')) parsed *= 1000000;
              if (parsed > reactions) reactions = Math.round(parsed);
            }
          }
          // Fallback: look for reaction count spans
          if (reactions === 0) {
            var spans2 = article.querySelectorAll('span[role="toolbar"] ~ span, span');
            for (var j = 0; j < spans2.length; j++) {
              var txt = (spans2[j].textContent || '').trim();
              if (txt.match(/^[\\d,.]+[KkMm]?$/) && !txt.includes(':')) {
                var pv = parseFloat(txt.replace(/,/g, ''));
                if (txt.includes('K') || txt.includes('k')) pv *= 1000;
                if (txt.includes('M') || txt.includes('m')) pv *= 1000000;
                if (pv > reactions) reactions = Math.round(pv);
                break;
              }
            }
          }

          // Comments and shares count
          var comments = 0;
          var shares = 0;
          var metaSpans = article.querySelectorAll('span');
          for (var m = 0; m < metaSpans.length; m++) {
            var mt = (metaSpans[m].textContent || '').trim().toLowerCase();
            var cMatch = mt.match(/([\\.\\d,]+[KkMm]?)\\s*comment/);
            if (cMatch) {
              var cv = cMatch[1].replace(/,/g, '');
              comments = parseInt(cv) || 0;
              if (cv.includes('K') || cv.includes('k')) comments = Math.round(parseFloat(cv) * 1000);
              if (cv.includes('M') || cv.includes('m')) comments = Math.round(parseFloat(cv) * 1000000);
            }
            var sMatch = mt.match(/([\\.\\d,]+[KkMm]?)\\s*share/);
            if (sMatch) {
              var sv = sMatch[1].replace(/,/g, '');
              shares = parseInt(sv) || 0;
              if (sv.includes('K') || sv.includes('k')) shares = Math.round(parseFloat(sv) * 1000);
              if (sv.includes('M') || sv.includes('m')) shares = Math.round(parseFloat(sv) * 1000000);
            }
          }

          // Media detection
          var hasImage = !!article.querySelector('img[src*="fbcdn"], img[src*="scontent"]');
          var hasVideo = !!article.querySelector('video, div[aria-label*="video" i]');

          // Timestamp
          var timeEl = article.querySelector('abbr[data-utime], span[id] a abbr, a[aria-label] span');
          var timestamp = '';
          if (timeEl) {
            timestamp = timeEl.getAttribute('title') || timeEl.getAttribute('data-utime') || timeEl.textContent.trim();
          }

          results.push({
            id: postId,
            url: postUrl,
            text: text,
            author: authorName,
            authorUrl: authorUrl,
            authorType: authorType,
            isVerified: isVerified,
            reactions: reactions,
            comments: comments,
            shares: shares,
            hasImage: hasImage,
            hasVideo: hasVideo,
            timestamp: timestamp
          });
        }

        return JSON.stringify(results);
      })()
    `);

    try {
      const parsed = JSON.parse(raw || '[]') as Array<any>;
      const now = new Date().toISOString();
      return parsed.map((p: any) => ({
        id: p.id,
        url: p.url,
        text: p.text || '',
        author: p.author || '',
        authorUrl: p.authorUrl || '',
        authorType: (p.authorType || 'unknown') as FacebookPost['authorType'],
        isVerified: p.isVerified || false,
        reactions: p.reactions || 0,
        comments: p.comments || 0,
        shares: p.shares || 0,
        engagementScore: (p.reactions || 0) + (p.comments || 0) * 2 + (p.shares || 0) * 3,
        hasImage: p.hasImage || false,
        hasVideo: p.hasVideo || false,
        timestamp: p.timestamp || '',
        niche,
        collectedAt: now,
      }));
    } catch {
      return [];
    }
  }

  // ─── Scroll & Collect ──────────────────────────────────────

  async scrollAndCollect(niche: string, targetCount: number): Promise<FacebookPost[]> {
    const seen = new Map<string, FacebookPost>();
    let noNewCount = 0;
    let scrollCount = 0;

    console.log(`[FB Research] Collecting up to ${targetCount} posts for "${niche}"`);

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
          console.log(`[FB Research] No new posts after 5 scrolls, stopping at ${seen.size}`);
          break;
        }
      } else {
        noNewCount = 0;
      }

      if (scrollCount % 5 === 0) {
        console.log(`[FB Research] Scroll ${scrollCount}: ${seen.size}/${targetCount} posts collected`);
      }

      // Scroll down
      await this.executeJS(`window.scrollBy(0, window.innerHeight * 2)`);
      await this.wait(this.config.scrollPauseMs);

      // Error detection
      const error = await this.executeJS(`
        (function() {
          var body = (document.body.innerText || '').toLowerCase();
          if (body.includes('you\\'re temporarily blocked')) return 'blocked';
          if (body.includes('try again later')) return 'rate_limit';
          return '';
        })()
      `);
      if (error === 'blocked') {
        console.log(`[FB Research] Blocked! Stopping collection.`);
        break;
      }
      if (error === 'rate_limit') {
        console.log(`[FB Research] Rate limited, waiting 60s...`);
        await this.wait(60000);
      }

      scrollCount++;
    }

    console.log(`[FB Research] Finished: ${seen.size} unique posts in ${scrollCount} scrolls`);
    return Array.from(seen.values());
  }

  // ─── Creator Ranking ───────────────────────────────────────

  rankCreators(posts: FacebookPost[], niche: string, topN: number = this.config.creatorsPerNiche): FacebookCreator[] {
    const creatorMap = new Map<string, FacebookCreator>();

    for (const post of posts) {
      if (!post.author) continue;
      const key = post.authorUrl || post.author;
      const existing = creatorMap.get(key);
      if (existing) {
        existing.postCount++;
        existing.totalReactions += post.reactions;
        existing.totalComments += post.comments;
        existing.totalShares += post.shares;
        existing.totalEngagement += post.engagementScore;
        existing.avgEngagement = existing.totalEngagement / existing.postCount;
        if (post.engagementScore > existing.topPostEngagement) {
          existing.topPostUrl = post.url;
          existing.topPostEngagement = post.engagementScore;
        }
        if (post.isVerified) existing.isVerified = true;
      } else {
        creatorMap.set(key, {
          name: post.author,
          url: post.authorUrl,
          type: post.authorType,
          isVerified: post.isVerified,
          postCount: 1,
          totalReactions: post.reactions,
          totalComments: post.comments,
          totalShares: post.shares,
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
    const base = niche.trim();
    return [
      base,
      `"${base}"`,
      `${base} tips`,
      `${base} strategy`,
      `${base} 2026`,
    ];
  }

  // ─── Full Niche Research ───────────────────────────────────

  async researchNiche(niche: string): Promise<FacebookNicheResult> {
    const startTime = Date.now();
    const startISO = new Date().toISOString();
    const allPosts = new Map<string, FacebookPost>();
    const queries = this.buildSearchQueries(niche);
    const targetPerQuery = Math.ceil(this.config.postsPerNiche / queries.length);

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`[FB Research] NICHE: "${niche}" — target ${this.config.postsPerNiche} posts`);
    console.log(`[FB Research] Running ${queries.length} search queries`);
    console.log(`${'═'.repeat(60)}`);

    for (const query of queries) {
      if (allPosts.size >= this.config.postsPerNiche) break;

      const remaining = this.config.postsPerNiche - allPosts.size;
      const target = Math.min(targetPerQuery, remaining);

      const searched = await this.search(query);
      if (!searched) {
        console.log(`[FB Research] Search "${query}" failed, skipping`);
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
      console.log(`[FB Research] "${query}": ${posts.length} collected, ${newCount} new (total: ${allPosts.size})`);

      await this.wait(3000);
    }

    const postArray = Array.from(allPosts.values())
      .sort((a, b) => b.engagementScore - a.engagementScore);

    const creators = this.rankCreators(postArray, niche);

    const result: FacebookNicheResult = {
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

    console.log(`[FB Research] NICHE "${niche}" complete: ${postArray.length} posts, ${creators.length} creators`);
    return result;
  }

  // ─── Multi-Niche Orchestrator ──────────────────────────────

  async runFullResearch(niches: string[]): Promise<{
    results: FacebookNicheResult[];
    summary: { totalPosts: number; totalCreators: number; totalDurationMs: number; niches: string[] };
  }> {
    const startTime = Date.now();
    const results: FacebookNicheResult[] = [];

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`[FB Research] FULL RESEARCH — ${niches.length} niches`);
    console.log(`[FB Research] Target: ${this.config.postsPerNiche} posts × ${niches.length} = ${this.config.postsPerNiche * niches.length} total`);
    console.log(`${'═'.repeat(60)}\n`);

    for (let i = 0; i < niches.length; i++) {
      console.log(`\n[FB Research] ── Niche ${i + 1}/${niches.length}: "${niches[i]}" ──`);
      const result = await this.researchNiche(niches[i]);
      results.push(result);
      await this.saveResults(results, 'intermediate');
      if (i < niches.length - 1) {
        console.log('[FB Research] Pausing 5s between niches...');
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
    console.log(`[FB Research] COMPLETE: ${summary.totalPosts} posts, ${summary.totalCreators} creators`);
    console.log(`${'═'.repeat(60)}\n`);

    return { results, summary };
  }

  // ─── Persistence ───────────────────────────────────────────

  async saveResults(results: FacebookNicheResult[], label: string = 'research'): Promise<string> {
    if (!fs.existsSync(this.config.outputDir)) {
      fs.mkdirSync(this.config.outputDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `facebook-research-${label}-${timestamp}.json`;
    const filepath = path.join(this.config.outputDir, filename);

    const output = {
      metadata: { generatedAt: new Date().toISOString(), label, config: this.config },
      results,
      allCreators: this.mergeCreators(results),
    };

    fs.writeFileSync(filepath, JSON.stringify(output, null, 2));
    console.log(`[FB Research] Saved: ${filepath}`);
    return filepath;
  }

  private mergeCreators(results: FacebookNicheResult[]): (FacebookCreator & { niches: string[] })[] {
    const merged = new Map<string, FacebookCreator & { niches: string[] }>();
    for (const result of results) {
      for (const creator of result.creators) {
        const key = creator.url || creator.name;
        const existing = merged.get(key);
        if (existing) {
          existing.postCount += creator.postCount;
          existing.totalReactions += creator.totalReactions;
          existing.totalComments += creator.totalComments;
          existing.totalShares += creator.totalShares;
          existing.totalEngagement += creator.totalEngagement;
          existing.avgEngagement = existing.totalEngagement / existing.postCount;
          if (creator.topPostEngagement > existing.topPostEngagement) {
            existing.topPostUrl = creator.topPostUrl;
            existing.topPostEngagement = creator.topPostEngagement;
          }
          if (!existing.niches.includes(creator.niche)) existing.niches.push(creator.niche);
        } else {
          merged.set(key, { ...creator, niches: [creator.niche] });
        }
      }
    }
    return Array.from(merged.values()).sort((a, b) => b.totalEngagement - a.totalEngagement);
  }

  printSummary(results: FacebookNicheResult[]): void {
    console.log('\n┌─────────────────────────────────────────────────────────────┐');
    console.log('│               FACEBOOK RESEARCH SUMMARY                     │');
    console.log('├──────────────────┬──────────┬──────────┬───────────────────┤');
    console.log('│ Niche            │ Posts    │ Creators │ Top Creator       │');
    console.log('├──────────────────┼──────────┼──────────┼───────────────────┤');
    for (const r of results) {
      const niche = r.niche.substring(0, 16).padEnd(16);
      const posts = String(r.totalCollected).padStart(8);
      const creators = String(r.creators.length).padStart(8);
      const top = r.creators[0] ? r.creators[0].name.substring(0, 17).padEnd(17) : 'N/A'.padEnd(17);
      console.log(`│ ${niche} │ ${posts} │ ${creators} │ ${top} │`);
    }
    console.log('└──────────────────┴──────────┴──────────┴───────────────────┘');
  }
}
