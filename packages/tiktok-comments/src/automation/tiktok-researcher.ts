/**
 * TikTok Market Research — Safari Automation
 *
 * Searches TikTok for videos by keyword, extracts engagement metrics
 * (views, likes, comments, shares), identifies top creators,
 * and saves structured results.
 *
 * Capabilities:
 *   - Search videos via tiktok.com/search?q=
 *   - Extract videos: URL, author, description, views, likes, comments, shares
 *   - Scroll & paginate to collect hundreds of videos per niche
 *   - Deduplicate by video ID
 *   - Rank creators by total engagement
 *   - Orchestrate multi-niche research (e.g. 5 niches × 1000 videos)
 *   - Persist results to timestamped JSON
 *
 * TikTok DOM notes (2026):
 *   - Search results use data-e2e="search_video-item" or similar
 *   - Video cards contain data-e2e attributes for structured extraction
 *   - Author links are /@username
 *   - Engagement shown as abbreviated text (1.2K, 3.4M)
 *   - Video URLs: tiktok.com/@user/video/ID
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { TikTokDriver } from './tiktok-driver.js';

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export interface TikTokVideo {
  id: string;
  url: string;
  description: string;
  author: string;
  authorUrl: string;
  authorDisplayName: string;
  isVerified: boolean;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  engagementScore: number;      // likes + comments*2 + shares*3
  hashtags: string[];
  sound: string;
  timestamp: string;
  niche: string;
  collectedAt: string;
}

export interface TikTokCreator {
  handle: string;
  displayName: string;
  url: string;
  isVerified: boolean;
  followers: number;            // scraped from profile page
  following: number;            // scraped from profile page
  bio: string;                  // scraped from profile page
  videoCount: number;
  totalViews: number;
  totalLikes: number;
  totalComments: number;
  totalShares: number;
  totalEngagement: number;
  avgEngagement: number;
  topVideoUrl: string;
  topVideoEngagement: number;
  topVideos: Array<{ url: string; views: number; likes: number; comments: number; shares: number; engagement: number }>;
  niche: string;
}

export interface TikTokNicheResult {
  niche: string;
  query: string;
  videos: TikTokVideo[];
  creators: TikTokCreator[];
  totalCollected: number;
  uniqueVideos: number;
  collectionStarted: string;
  collectionFinished: string;
  durationMs: number;
}

export interface TikTokResearchConfig {
  videosPerNiche: number;
  creatorsPerNiche: number;
  enrichTopCreators: number;    // how many top creators to enrich with profile visit (default 10)
  scrollPauseMs: number;
  maxScrollsPerSearch: number;
  timeout: number;
  outputDir: string;
  maxRetries: number;
}

export const DEFAULT_TT_RESEARCH_CONFIG: TikTokResearchConfig = {
  videosPerNiche: 1000,
  creatorsPerNiche: 100,
  enrichTopCreators: 10,
  scrollPauseMs: 1800,
  maxScrollsPerSearch: 200,
  timeout: 30000,
  outputDir: path.join(os.homedir(), 'Documents/tiktok-research'),
  maxRetries: 3,
};

// ═══════════════════════════════════════════════════════════════
// TikTokResearcher
// ═══════════════════════════════════════════════════════════════

export class TikTokResearcher {
  private config: TikTokResearchConfig;

  constructor(config: Partial<TikTokResearchConfig> = {}) {
    this.config = { ...DEFAULT_TT_RESEARCH_CONFIG, ...config };
  }

  // ─── Low-level Safari helpers ──────────────────────────────
  // Uses TikTokDriver — the proven implementation from port 3006 (search-cards,
  // video-metrics, comments). JS passed to executeJS must use \\' for CSS
  // attribute values so they survive TikTokDriver's " → \" AppleScript embedding.

  private _driver = new TikTokDriver();

  private async navigate(url: string): Promise<boolean> {
    return this._driver.navigateToPost(url);
  }

  private async wait(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
  }

  private async waitForSelector(selector: string, timeoutMs = 12000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const found = await this._driver.executeJS(`(function(){ return document.querySelector('${selector}') ? 'found' : ''; })()`);
      if (found === 'found') return true;
      await this.wait(600);
    }
    return false;
  }

  // ─── Search ────────────────────────────────────────────────

  /**
   * Search TikTok videos by keyword.
   * Navigates to the "Videos" tab of search results.
   */
  async search(query: string): Promise<boolean> {
    const url = `https://www.tiktok.com/search/video?q=${encodeURIComponent(query)}`;
    console.log(`[TT Research] Searching: "${query}"`);
    const ok = await this.navigate(url);  // includes 3s internal wait
    if (!ok) { console.log('[TT Research] navigate failed'); return false; }
    // Fixed wait — waitForSelector via osascript polling is too slow (~1-2s/call)
    // and unreliable when concurrent platform researchers navigate Safari concurrently.
    await this.wait(7000);
    console.log('[TT Research] navigation wait complete, proceeding to extract');
    return true;
  }

  // ─── Extract visible videos ────────────────────────────────

  async extractVisibleVideos(niche: string): Promise<TikTokVideo[]> {
    // Use TikTokDriver.executeJS with \\' selectors (same as search-cards endpoint on port 3006).
    // \\' in TS template literal → \' in JS string → survives TikTokDriver's " → \" transform.
    // Diagnostic: check card count and URL right before extraction
    const preCheck = await this._driver.executeJS(
      `(function(){ var c=document.querySelectorAll('[data-e2e="search_video-item"]'); return 'cards:'+c.length+' url:'+window.location.href.substring(0,80); })()`
    ).catch(e => 'diag-error:' + e.message);
    console.log('[TT extractVideos] pre-extract:', preCheck);

    // Build single-line JS — TikTokDriver embeds JS in an AppleScript double-quoted string
    // using \\n for newlines which AppleScript interprets as line-breaks, breaking multi-
    // statement execution. Collapsing to one line before calling executeJS avoids this.
    const extractJS = `(function() { var results = []; var seen = {}; var cards = document.querySelectorAll('[data-e2e="search_video-item"]'); for (var i = 0; i < cards.length; i++) { var card = cards[i]; var link = card.querySelector('a[href*="/video/"]'); if (!link) continue; var href = link.getAttribute('href') || ''; var idMatch = href.match(/\\/video\\/(\\d+)/); if (!idMatch) continue; var videoId = idMatch[1]; if (seen[videoId]) continue; seen[videoId] = true; var url = href.startsWith('http') ? href : 'https://www.tiktok.com' + href; var userMatch = href.match(/@([^\\/]+)\\/video/); var author = userMatch ? userMatch[1] : ''; var descEl = card.querySelector('[data-e2e="search-card-video-caption"]') || card.querySelector('[data-e2e="search-card-desc"]'); var desc = descEl ? descEl.textContent.trim().substring(0, 300) : ''; var vwEl = card.querySelector('[data-e2e="video-views"]'); var viewsRaw = vwEl ? vwEl.textContent.trim() : '0'; results.push({ id: videoId, url: url, author: author, desc: desc, viewsRaw: viewsRaw }); } return JSON.stringify(results); })()`;

    let raw = '';
    try {
      raw = await this._driver.executeJS(extractJS);
    } catch (e: any) {
      console.log('[TT extractVideos] executeJS threw:', e.message?.substring(0, 200));
      return [];
    }

    try {
      const parsed = JSON.parse(raw || '[]') as Array<any>;
      console.log(`[TT extractVideos] raw length=${raw.length} parsed=${parsed.length} cards`);
      const now = new Date().toISOString();

      function parseAbbrev(s: string): number {
        if (!s) return 0;
        const t = s.trim().replace(/,/g, '');
        const m = t.match(/^([\d.]+)\s*([KkMmBb]?)$/);
        if (!m) return 0;
        let v = parseFloat(m[1]) || 0;
        const su = m[2].toUpperCase();
        if (su === 'K') v *= 1e3;
        else if (su === 'M') v *= 1e6;
        else if (su === 'B') v *= 1e9;
        return Math.round(v);
      }

      return parsed.map((v: any) => ({
        id: v.id,
        url: v.url,
        description: v.desc || '',
        author: v.author || '',
        authorUrl: v.author ? `https://www.tiktok.com/@${v.author}` : '',
        authorDisplayName: v.author || '',
        isVerified: false,
        views: parseAbbrev(v.viewsRaw || '0'),
        likes: 0,
        comments: 0,
        shares: 0,
        engagementScore: 0,
        hashtags: [],
        sound: '',
        timestamp: '',
        niche,
        collectedAt: now,
      }));
    } catch {
      return [];
    }
  }

  // ─── Deep scrape: navigate INTO video page for full metrics ──

  /**
   * Navigate to a single video URL and extract full engagement data.
   * Returns partial overrides — merges back onto the card-level video object.
   * Falls back gracefully if page doesn't load.
   */
  async deepScrapeVideo(videoUrl: string): Promise<{ views: number; likes: number; comments: number; shares: number } | null> {
    // Delegate to TikTokDriver.navigateToPost + getVideoMetrics — the same proven
    // code used by GET /api/tiktok/video-metrics on port 3006.
    try {
      await this._driver.navigateToPost(videoUrl);  // includes 3s internal wait
      await this.wait(3000);                         // extra wait for video page render
      const m = await this._driver.getVideoMetrics();
      console.log(`[TT deepScrape] ${m.currentUrl.substring(0, 80)} → likes=${m.likes} cmt=${m.comments} shares=${m.shares}`);
      return { views: m.views, likes: m.likes, comments: m.comments, shares: m.shares };
    } catch (e) {
      console.log('[TT deepScrape] error:', e);
      return null;
    }
  }

  /**
   * Search for a query, collect up to maxVideos from search page,
   * then deep-scrape each video URL for full engagement data.
   */
  async searchAndDeepScrape(query: string, niche: string, maxVideos = 8): Promise<TikTokVideo[]> {
    const ok = await this.search(query);
    if (!ok) return [];
    // Wait for cards to fully render after search (inbox panel can delay results)
    await this.wait(3000);


    let videos = await this.extractVisibleVideos(niche);
    // Retry once if first extraction caught the page mid-render
    if (videos.length === 0) {
      console.log('[TT Research] 0 cards on first pass — retrying in 2s...');
      await this.wait(2000);
      videos = await this.extractVisibleVideos(niche);
    }
    const limited = videos.slice(0, maxVideos);

    // Always deep-scrape: search cards only have view counts, not likes/comments/shares.
    // Engagement data requires navigating INTO each video post.
    console.log(`[TT Research] Deep-scraping ${limited.length} videos for full engagement...`);
    for (let i = 0; i < limited.length; i++) {
      const v = limited[i];
      if (!v.url) continue;
      const deep = await this.deepScrapeVideo(v.url);
      if (deep) {
        if (deep.views    > 0) v.views    = deep.views;
        if (deep.likes    > 0) v.likes    = deep.likes;
        if (deep.comments > 0) v.comments = deep.comments;
        if (deep.shares   > 0) v.shares   = deep.shares;
        v.engagementScore = v.views + v.likes + v.comments * 2 + v.shares * 3;
      }
    }
    return limited;
  }

  // ─── Scroll & Collect ──────────────────────────────────────

  async scrollAndCollect(niche: string, targetCount: number): Promise<TikTokVideo[]> {
    const seen = new Map<string, TikTokVideo>();
    let noNewCount = 0;
    let scrollCount = 0;

    console.log(`[TT Research] Collecting up to ${targetCount} videos for "${niche}"`);

    while (seen.size < targetCount && scrollCount < this.config.maxScrollsPerSearch) {
      const batch = await this.extractVisibleVideos(niche);
      let newCount = 0;
      for (const video of batch) {
        if (!seen.has(video.id)) {
          seen.set(video.id, video);
          newCount++;
        }
      }

      if (newCount === 0) {
        noNewCount++;
        if (noNewCount >= 5) {
          console.log(`[TT Research] No new videos after 5 scrolls, stopping at ${seen.size}`);
          break;
        }
      } else {
        noNewCount = 0;
      }

      if (scrollCount % 5 === 0) {
        console.log(`[TT Research] Scroll ${scrollCount}: ${seen.size}/${targetCount} videos collected`);
      }

      await this._driver.executeJS(`window.scrollBy(0, window.innerHeight * 2)`);
      await this.wait(this.config.scrollPauseMs);

      // Error detection
      const error = await this._driver.executeJS(`
        (function() {
          var body = (document.body.innerText || '').toLowerCase();
          if (body.includes('something went wrong')) return 'error';
          if (body.includes('rate limit') || body.includes('try again later')) return 'rate_limit';
          return '';
        })()
      `);
      if (error === 'rate_limit') {
        console.log(`[TT Research] Rate limited, waiting 60s...`);
        await this.wait(60000);
      }

      scrollCount++;
    }

    console.log(`[TT Research] Finished: ${seen.size} unique videos in ${scrollCount} scrolls`);
    return Array.from(seen.values());
  }

  // ─── Profile Enrichment ────────────────────────────────────

  async getCreatorProfile(handle: string): Promise<{ followers: number; following: number; bio: string } | null> {
    const url = `https://www.tiktok.com/@${handle}`;
    const ok = await this.navigate(url);
    if (!ok) return null;

    await this.wait(2000);

    const raw = await this.executeJS(`(function() {
      function parseCount(s) {
        if (!s) return 0;
        s = s.trim().replace(/,/g, '');
        if (s.includes('M')) return Math.round(parseFloat(s) * 1000000);
        if (s.includes('K') || s.includes('k')) return Math.round(parseFloat(s) * 1000);
        return parseInt(s) || 0;
      }
      var result = { followers: 0, following: 0, bio: '' };
      var stats = document.querySelectorAll('[data-e2e="followers-count"], [data-e2e="following-count"]');
      if (stats.length >= 2) { result.following = parseCount(stats[0].textContent); result.followers = parseCount(stats[1].textContent); }
      var bioEl = document.querySelector('[data-e2e="user-bio"], [class*="ShareDesc"]');
      if (bioEl) result.bio = bioEl.textContent.trim().slice(0, 300);
      return JSON.stringify(result);
    })()`);

    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  // ─── Creator Ranking ───────────────────────────────────────

  rankCreators(videos: TikTokVideo[], niche: string, topN: number = this.config.creatorsPerNiche): TikTokCreator[] {
    const creatorMap = new Map<string, TikTokCreator>();

    for (const video of videos) {
      if (!video.author) continue;
      const existing = creatorMap.get(video.author);
      if (existing) {
        existing.videoCount++;
        existing.totalViews += video.views;
        existing.totalLikes += video.likes;
        existing.totalComments += video.comments;
        existing.totalShares += video.shares;
        existing.totalEngagement += video.engagementScore;
        existing.avgEngagement = existing.totalEngagement / existing.videoCount;
        if (video.engagementScore > existing.topVideoEngagement) {
          existing.topVideoUrl = video.url;
          existing.topVideoEngagement = video.engagementScore;
        }
        if (video.isVerified) existing.isVerified = true;
      } else {
        creatorMap.set(video.author, {
          handle: video.author,
          displayName: video.authorDisplayName,
          url: video.authorUrl,
          isVerified: video.isVerified,
          videoCount: 1,
          totalViews: video.views,
          totalLikes: video.likes,
          totalComments: video.comments,
          totalShares: video.shares,
          totalEngagement: video.engagementScore,
          avgEngagement: video.engagementScore,
          topVideoUrl: video.url,
          topVideoEngagement: video.engagementScore,
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
      `${base} tips`,
      `${base} tutorial`,
      `${base} strategy`,
      `${base} 2026`,
    ];
  }

  // ─── Full Niche Research ───────────────────────────────────

  async researchNiche(niche: string): Promise<TikTokNicheResult> {
    const startTime = Date.now();
    const startISO = new Date().toISOString();
    const allVideos = new Map<string, TikTokVideo>();
    const queries = this.buildSearchQueries(niche);
    const targetPerQuery = Math.ceil(this.config.videosPerNiche / queries.length);

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`[TT Research] NICHE: "${niche}" — target ${this.config.videosPerNiche} videos`);
    console.log(`[TT Research] Running ${queries.length} search queries`);
    console.log(`${'═'.repeat(60)}`);

    for (const query of queries) {
      if (allVideos.size >= this.config.videosPerNiche) break;

      const remaining = this.config.videosPerNiche - allVideos.size;
      const target = Math.min(targetPerQuery, remaining);

      const searched = await this.search(query);
      if (!searched) {
        console.log(`[TT Research] Search "${query}" failed, skipping`);
        continue;
      }

      const videos = await this.scrollAndCollect(niche, target);
      let newCount = 0;
      for (const video of videos) {
        if (!allVideos.has(video.id)) {
          allVideos.set(video.id, video);
          newCount++;
        }
      }
      console.log(`[TT Research] "${query}": ${videos.length} collected, ${newCount} new (total: ${allVideos.size})`);

      await this.wait(3000);
    }

    const videoArray = Array.from(allVideos.values())
      .sort((a, b) => b.engagementScore - a.engagementScore);

    const creators = this.rankCreators(videoArray, niche);

    // Enrich top creators with profile data (followers/following/bio)
    const enrichCount = Math.min(this.config.enrichTopCreators, creators.length);
    if (enrichCount > 0) {
      console.log(`[TT Research] Enriching top ${enrichCount} creators with profile data...`);
      for (let i = 0; i < enrichCount; i++) {
        const c = creators[i];
        console.log(`[TT Research] Profile: @${c.handle} (${i + 1}/${enrichCount})`);
        const profile = await this.getCreatorProfile(c.handle);
        if (profile) {
          c.followers = profile.followers;
          c.following = profile.following;
          c.bio = profile.bio;
        }
        if (i < enrichCount - 1) await this.wait(1500);
      }
    }

    const result: TikTokNicheResult = {
      niche,
      query: queries[0],
      videos: videoArray,
      creators,
      totalCollected: videoArray.length,
      uniqueVideos: videoArray.length,
      collectionStarted: startISO,
      collectionFinished: new Date().toISOString(),
      durationMs: Date.now() - startTime,
    };

    console.log(`[TT Research] NICHE "${niche}" complete: ${videoArray.length} videos, ${creators.length} creators`);
    return result;
  }

  // ─── Multi-Niche Orchestrator ──────────────────────────────

  async runFullResearch(niches: string[]): Promise<{
    results: TikTokNicheResult[];
    summary: { totalVideos: number; totalCreators: number; totalDurationMs: number; niches: string[] };
  }> {
    const startTime = Date.now();
    const results: TikTokNicheResult[] = [];

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`[TT Research] FULL RESEARCH — ${niches.length} niches`);
    console.log(`[TT Research] Target: ${this.config.videosPerNiche} videos × ${niches.length} = ${this.config.videosPerNiche * niches.length} total`);
    console.log(`${'═'.repeat(60)}\n`);

    for (let i = 0; i < niches.length; i++) {
      console.log(`\n[TT Research] ── Niche ${i + 1}/${niches.length}: "${niches[i]}" ──`);
      const result = await this.researchNiche(niches[i]);
      results.push(result);
      await this.saveResults(results, 'intermediate');
      if (i < niches.length - 1) {
        console.log('[TT Research] Pausing 5s between niches...');
        await this.wait(5000);
      }
    }

    const summary = {
      totalVideos: results.reduce((s, r) => s + r.totalCollected, 0),
      totalCreators: results.reduce((s, r) => s + r.creators.length, 0),
      totalDurationMs: Date.now() - startTime,
      niches,
    };

    await this.saveResults(results, 'final');

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`[TT Research] COMPLETE: ${summary.totalVideos} videos, ${summary.totalCreators} creators`);
    console.log(`${'═'.repeat(60)}\n`);

    return { results, summary };
  }

  // ─── Persistence ───────────────────────────────────────────

  async saveResults(results: TikTokNicheResult[], label: string = 'research'): Promise<string> {
    if (!fs.existsSync(this.config.outputDir)) {
      fs.mkdirSync(this.config.outputDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `tiktok-research-${label}-${timestamp}.json`;
    const filepath = path.join(this.config.outputDir, filename);

    const output = {
      metadata: { generatedAt: new Date().toISOString(), label, config: this.config },
      results,
      allCreators: this.mergeCreators(results),
    };

    fs.writeFileSync(filepath, JSON.stringify(output, null, 2));
    console.log(`[TT Research] Saved: ${filepath}`);
    return filepath;
  }

  private mergeCreators(results: TikTokNicheResult[]): (TikTokCreator & { niches: string[] })[] {
    const merged = new Map<string, TikTokCreator & { niches: string[] }>();
    for (const result of results) {
      for (const creator of result.creators) {
        const existing = merged.get(creator.handle);
        if (existing) {
          existing.videoCount += creator.videoCount;
          existing.totalViews += creator.totalViews;
          existing.totalLikes += creator.totalLikes;
          existing.totalComments += creator.totalComments;
          existing.totalShares += creator.totalShares;
          existing.totalEngagement += creator.totalEngagement;
          existing.avgEngagement = existing.totalEngagement / existing.videoCount;
          if (creator.topVideoEngagement > existing.topVideoEngagement) {
            existing.topVideoUrl = creator.topVideoUrl;
            existing.topVideoEngagement = creator.topVideoEngagement;
          }
          if (!existing.niches.includes(creator.niche)) existing.niches.push(creator.niche);
        } else {
          merged.set(creator.handle, { ...creator, niches: [creator.niche] });
        }
      }
    }
    return Array.from(merged.values()).sort((a, b) => b.totalEngagement - a.totalEngagement);
  }

  printSummary(results: TikTokNicheResult[]): void {
    console.log('\n┌─────────────────────────────────────────────────────────────┐');
    console.log('│               TIKTOK RESEARCH SUMMARY                       │');
    console.log('├──────────────────┬──────────┬──────────┬───────────────────┤');
    console.log('│ Niche            │ Videos   │ Creators │ Top Creator       │');
    console.log('├──────────────────┼──────────┼──────────┼───────────────────┤');
    for (const r of results) {
      const niche = r.niche.substring(0, 16).padEnd(16);
      const videos = String(r.totalCollected).padStart(8);
      const creators = String(r.creators.length).padStart(8);
      const top = r.creators[0] ? `@${r.creators[0].handle}`.substring(0, 17).padEnd(17) : 'N/A'.padEnd(17);
      console.log(`│ ${niche} │ ${videos} │ ${creators} │ ${top} │`);
    }
    console.log('└──────────────────┴──────────┴──────────┴───────────────────┘');
  }
}
