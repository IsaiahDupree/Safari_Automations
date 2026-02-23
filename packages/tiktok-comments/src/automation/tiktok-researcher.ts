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

import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const execAsync = promisify(exec);

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
  videoCount: number;
  totalViews: number;
  totalLikes: number;
  totalComments: number;
  totalShares: number;
  totalEngagement: number;
  avgEngagement: number;
  topVideoUrl: string;
  topVideoEngagement: number;
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
  scrollPauseMs: number;
  maxScrollsPerSearch: number;
  timeout: number;
  outputDir: string;
  maxRetries: number;
}

export const DEFAULT_TT_RESEARCH_CONFIG: TikTokResearchConfig = {
  videosPerNiche: 1000,
  creatorsPerNiche: 100,
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

  private async executeJS(script: string): Promise<string> {
    const tmpFile = path.join(os.tmpdir(), `safari_tt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.scpt`);
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

  // ─── Search ────────────────────────────────────────────────

  /**
   * Search TikTok videos by keyword.
   * Navigates to the "Videos" tab of search results.
   */
  async search(query: string): Promise<boolean> {
    const url = `https://www.tiktok.com/search/video?q=${encodeURIComponent(query)}`;
    console.log(`[TT Research] Searching: "${query}"`);
    const ok = await this.navigate(url);
    if (!ok) return false;

    // Wait for video cards to appear
    const loaded = await this.waitForSelector(
      'div[data-e2e="search_video-item"], div[data-e2e="search-card-desc"], a[href*="/video/"]',
      15000
    );
    if (!loaded) {
      const error = await this.executeJS(`
        (function() {
          var body = document.body.innerText || '';
          if (body.includes('No results found')) return 'no_results';
          if (body.includes('Log in')) return 'login_wall';
          return '';
        })()
      `);
      if (error) {
        console.log(`[TT Research] Search issue: ${error}`);
        return false;
      }
    }
    return loaded;
  }

  // ─── Extract visible videos ────────────────────────────────

  async extractVisibleVideos(niche: string): Promise<TikTokVideo[]> {
    const raw = await this.executeJS(`
      (function() {
        var results = [];
        var seen = {};

        // TikTok search results: look for video links
        var videoLinks = document.querySelectorAll('a[href*="/video/"]');

        for (var i = 0; i < videoLinks.length; i++) {
          var link = videoLinks[i];
          var href = link.getAttribute('href') || '';

          // Extract video ID from URL
          var idMatch = href.match(/\\/video\\/(\\d+)/);
          if (!idMatch) continue;
          var videoId = idMatch[1];
          if (seen[videoId]) continue;
          seen[videoId] = true;

          var url = href.startsWith('http') ? href : 'https://www.tiktok.com' + href;

          // Extract username from URL pattern /@username/video/ID
          var userMatch = href.match(/@([^/]+)\\/video/);
          var author = userMatch ? userMatch[1] : '';
          var authorUrl = author ? 'https://www.tiktok.com/@' + author : '';

          // Try to find the card container
          var card = link.closest('[data-e2e="search_video-item"]')
                  || link.closest('[data-e2e="search-card"]')
                  || link.closest('div[class*="DivVideoCard"]')
                  || link.closest('div[class*="video-card"]')
                  || link.parentElement;

          // Description
          var desc = '';
          if (card) {
            var descEl = card.querySelector('[data-e2e="search-card-desc"], [data-e2e="video-desc"], span[class*="SpanText"]');
            if (descEl) desc = descEl.textContent.trim().substring(0, 500);
            if (!desc) {
              var spans = card.querySelectorAll('span, p');
              for (var s = 0; s < spans.length; s++) {
                var t = spans[s].textContent.trim();
                if (t.length > 15 && !t.match(/^[\\d.]+[KkMm]?$/)) { desc = t.substring(0, 500); break; }
              }
            }
          }

          // Hashtags from description
          var hashtags = [];
          var hashMatches = desc.match(/#[\\w]+/g);
          if (hashMatches) hashtags = hashMatches;

          // Display name
          var displayName = '';
          if (card) {
            var nameEl = card.querySelector('[data-e2e="search-card-user-name"], [data-e2e="video-author-uniqueid"]');
            if (nameEl) displayName = nameEl.textContent.trim();
          }

          // Verified badge
          var isVerified = false;
          if (card) {
            isVerified = !!card.querySelector('svg[data-e2e="verify-badge"], svg[class*="Verify"]');
          }

          // Engagement metrics — look for strong/span elements with numbers
          var views = 0, likes = 0, comments = 0, shares = 0;
          if (card) {
            var strongEls = card.querySelectorAll('strong, span[data-e2e]');
            for (var e = 0; e < strongEls.length; e++) {
              var txt = (strongEls[e].textContent || '').trim();
              var numMatch = txt.match(/^([\\d.]+)\\s*([KkMm]?)$/);
              if (!numMatch) continue;
              var val = parseFloat(numMatch[1]) || 0;
              if (numMatch[2].toLowerCase() === 'k') val *= 1000;
              if (numMatch[2].toLowerCase() === 'm') val *= 1000000;
              val = Math.round(val);

              // Determine which metric by nearby icon or data-e2e attr
              var parent = strongEls[e].parentElement;
              var parentAttr = parent ? (parent.getAttribute('data-e2e') || '') : '';
              var parentHtml = parent ? (parent.innerHTML || '') : '';

              if (parentAttr.includes('like') || parentHtml.includes('Like')) { likes = val; }
              else if (parentAttr.includes('comment') || parentHtml.includes('Comment')) { comments = val; }
              else if (parentAttr.includes('share') || parentHtml.includes('Share')) { shares = val; }
              else if (parentAttr.includes('view') || parentHtml.includes('View') || val > 10000) { views = val; }
              else if (likes === 0) { likes = val; }
            }
          }

          // Fallback: look for view count text like "1.2M views"
          if (views === 0 && card) {
            var allText = card.innerText || '';
            var viewMatch = allText.match(/([\\d.]+[KkMm]?)\\s*views?/i);
            if (viewMatch) {
              var vv = viewMatch[1];
              views = parseFloat(vv) || 0;
              if (vv.includes('K') || vv.includes('k')) views *= 1000;
              if (vv.includes('M') || vv.includes('m')) views *= 1000000;
              views = Math.round(views);
            }
          }

          results.push({
            id: videoId,
            url: url,
            description: desc,
            author: author,
            authorUrl: authorUrl,
            authorDisplayName: displayName || author,
            isVerified: isVerified,
            views: views,
            likes: likes,
            comments: comments,
            shares: shares,
            hashtags: hashtags,
            sound: '',
            timestamp: ''
          });
        }

        return JSON.stringify(results);
      })()
    `);

    try {
      const parsed = JSON.parse(raw || '[]') as Array<any>;
      const now = new Date().toISOString();
      return parsed.map((v: any) => ({
        id: v.id,
        url: v.url,
        description: v.description || '',
        author: v.author || '',
        authorUrl: v.authorUrl || '',
        authorDisplayName: v.authorDisplayName || '',
        isVerified: v.isVerified || false,
        views: v.views || 0,
        likes: v.likes || 0,
        comments: v.comments || 0,
        shares: v.shares || 0,
        engagementScore: (v.likes || 0) + (v.comments || 0) * 2 + (v.shares || 0) * 3,
        hashtags: v.hashtags || [],
        sound: v.sound || '',
        timestamp: v.timestamp || '',
        niche,
        collectedAt: now,
      }));
    } catch {
      return [];
    }
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

      await this.executeJS(`window.scrollBy(0, window.innerHeight * 2)`);
      await this.wait(this.config.scrollPauseMs);

      // Error detection
      const error = await this.executeJS(`
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
