/**
 * Medium Researcher
 *
 * Market research on Medium: discover top authors in niches,
 * aggregate trending news/articles, and forward results to external servers.
 *
 * Capabilities:
 *   - Research niches via tag pages (/tag/{topic})
 *   - Discover top authors with follower counts, bios, niches
 *   - Extract trending/recommended articles with engagement metrics
 *   - Extract latest articles per niche
 *   - Aggregate news summaries across multiple niches
 *   - Forward results to external servers via webhook
 *   - Persistent storage of research data
 */

import { MediumSafariDriver } from './safari-driver.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export interface TopAuthor {
  name: string;
  profileUrl: string;
  followers: string;
  bio: string;
  isPublication: boolean;
  discoveredIn: string;  // niche/tag
}

export interface TrendingArticle {
  title: string;
  url: string;
  author: string;
  authorUrl: string;
  publication?: string;
  snippet: string;
  claps: number;
  responses: number;
  age: string;           // "2d ago", "5h ago", etc.
  niche: string;
}

export interface NicheResearchResult {
  niche: string;
  tagUrl: string;
  topicStats: {
    followers: string;
    stories: string;
  };
  relatedTopics: string[];
  topAuthors: TopAuthor[];
  recommendedArticles: TrendingArticle[];
  latestArticles: TrendingArticle[];
  researchedAt: string;
}

export interface MultiNicheReport {
  niches: NicheResearchResult[];
  allTopAuthors: TopAuthor[];
  allTrendingArticles: TrendingArticle[];
  newsSummary: NicheSummary[];
  generatedAt: string;
}

export interface NicheSummary {
  niche: string;
  topStories: Array<{ title: string; author: string; claps: number; snippet: string }>;
  topAuthors: Array<{ name: string; followers: string }>;
  themes: string[];
}

export interface WebhookConfig {
  url: string;
  headers?: Record<string, string>;
  method?: 'POST' | 'PUT';
}

// ═══════════════════════════════════════════════════════════════
// MediumResearcher
// ═══════════════════════════════════════════════════════════════

export class MediumResearcher {
  private driver: MediumSafariDriver;
  private dataDir: string;

  constructor() {
    this.driver = new MediumSafariDriver();
    this.dataDir = path.join(os.homedir(), '.medium-automation', 'research');
    if (!fs.existsSync(this.dataDir)) fs.mkdirSync(this.dataDir, { recursive: true });
  }

  // ═══════════════════════════════════════════════════════════════
  // SINGLE NICHE RESEARCH
  // ═══════════════════════════════════════════════════════════════

  async researchNiche(niche: string): Promise<NicheResearchResult> {
    const tag = niche.toLowerCase().replace(/\s+/g, '-');
    const tagUrl = `https://medium.com/tag/${tag}`;

    console.log(`[Research] Researching niche: ${niche} → ${tagUrl}`);

    await this.driver.navigate(tagUrl);
    await this.driver.sleep(4000);

    // Extract topic stats + related topics
    const metaData = await this.driver.executeJS(`
      (function() {
        var r = {};
        var text = document.body.innerText;

        // Topic stats: "8.5M followers · 414K stories"
        var statsMatch = text.match(/([\\d.]+[KkMm]?)\\s*followers\\s*·\\s*([\\d.]+[KkMm]?)\\s*stories/);
        r.followers = statsMatch ? statsMatch[1] : '';
        r.stories = statsMatch ? statsMatch[2] : '';

        // Related topics (at top of page)
        var topicLinks = document.querySelectorAll('a[href*="/tag/"]');
        var topics = [];
        var seen = {};
        for (var i = 0; i < topicLinks.length; i++) {
          var t = topicLinks[i].textContent.trim();
          if (t.length > 1 && t.length < 40 && !seen[t] && t.toLowerCase() !== '${tag}') {
            topics.push(t);
            seen[t] = true;
          }
        }
        r.relatedTopics = topics.slice(0, 10);

        return JSON.stringify(r);
      })()
    `);
    const meta = JSON.parse(metaData);

    // Extract "Who to follow" section
    const authorsData = await this.driver.executeJS(`
      (function() {
        var results = [];
        var text = document.body.innerText;

        // Find "Who to follow" section
        var whoIdx = text.indexOf('Who to follow');
        if (whoIdx === -1) return JSON.stringify(results);

        var section = text.substring(whoIdx, whoIdx + 3000);
        var lines = section.split('\\n').filter(function(l){ return l.trim().length > 0 });

        // Pattern: Name\\nfollower count\\nbio\\nFollow
        var i = 1; // skip "Who to follow"
        while (i < lines.length) {
          var line = lines[i].trim();

          // Check if this looks like a name (not "Follow", not a number, not "See more")
          if (line === 'Follow' || line === 'See more' || line === 'Following' ||
              line.match(/^\\d/) || line.length < 2 || line.length > 80) {
            i++; continue;
          }

          // Check if next line has follower count
          var nextLine = (i + 1 < lines.length) ? lines[i + 1].trim() : '';
          var isPublication = false;

          if (nextLine.match(/Publication/)) {
            isPublication = true;
            nextLine = nextLine.replace('Publication·', '').replace('Publication', '').trim();
          }

          if (nextLine.match(/[\\d.]+[KkMm]?\\s*followers/)) {
            var name = line;
            var followers = nextLine;
            var bio = '';

            // Bio is the line after followers, before "Follow"
            if (i + 2 < lines.length && lines[i + 2].trim() !== 'Follow') {
              bio = lines[i + 2].trim();
            }

            results.push({
              name: name,
              followers: followers.replace(/followers$/, '').trim(),
              bio: bio.substring(0, 300),
              isPublication: isPublication
            });
            i += 4; // skip past Follow button
          } else {
            i++;
          }
        }

        return JSON.stringify(results);
      })()
    `);
    const authorsParsed = JSON.parse(authorsData);

    // Get profile URLs for authors
    const authorLinks = await this.driver.executeJS(`
      (function() {
        var links = document.querySelectorAll('a[href*="/@"], a[href*="medium.com/"]');
        var map = {};
        for (var i = 0; i < links.length; i++) {
          var name = links[i].textContent.trim();
          var href = links[i].href.split('?')[0];
          if (name.length > 1 && name.length < 60 && !map[name] && (href.includes('/@') || href.match(/medium\\.com\\/[a-z]/))) {
            map[name] = href;
          }
        }
        return JSON.stringify(map);
      })()
    `);
    const linkMap = JSON.parse(authorLinks);

    const topAuthors: TopAuthor[] = authorsParsed.map((a: any) => ({
      name: a.name,
      profileUrl: linkMap[a.name] || '',
      followers: a.followers,
      bio: a.bio,
      isPublication: a.isPublication,
      discoveredIn: niche,
    }));

    // Extract recommended articles
    const recommendedData = await this.driver.executeJS(`
      (function() {
        var results = [];
        var articles = document.querySelectorAll('article[data-testid="post-preview"]');
        for (var i = 0; i < Math.min(articles.length, 15); i++) {
          var art = articles[i];
          var r = {};

          // Title + URL
          var links = art.querySelectorAll('a');
          for (var j = 0; j < links.length; j++) {
            var href = links[j].href || '';
            var txt = links[j].textContent.trim();
            if (txt.length > 15 && !href.includes('/tag/') && !href.includes('/@')) {
              r.title = txt.substring(0, 200);
              r.url = href.split('?')[0];
              break;
            }
          }

          // Author
          var authorLink = art.querySelector('a[href*="/@"]');
          if (authorLink) {
            r.author = authorLink.textContent.trim();
            r.authorUrl = authorLink.href.split('?')[0];
          }

          // Publication
          var pubLinks = art.querySelectorAll('a');
          for (var j = 0; j < pubLinks.length; j++) {
            var ph = pubLinks[j].href || '';
            if (ph.match(/medium\\.com\\/[a-z]/) && !ph.includes('/@') && !ph.includes('/tag/')) {
              var pt = pubLinks[j].textContent.trim();
              if (pt.length > 2 && pt.length < 50 && pt !== r.author) {
                r.publication = pt;
                break;
              }
            }
          }

          // Snippet
          var ps = art.querySelectorAll('p, h3, h2');
          for (var j = 0; j < ps.length; j++) {
            var t = ps[j].textContent.trim();
            if (t.length > 30 && t !== r.title) { r.snippet = t.substring(0, 300); break; }
          }

          // Engagement: look for numbers (claps, responses) and time
          var artText = art.innerText;
          var clapsMatch = artText.match(/(\\d[\\d,.]*)\\n/);
          r.claps = clapsMatch ? parseInt(clapsMatch[1].replace(/[,.]/g, '')) : 0;

          // Responses count (second number)
          var nums = artText.match(/(\\d+)\\n(\\d+)\\s*$/m);
          if (nums) {
            r.claps = parseInt(nums[1]) || 0;
            r.responses = parseInt(nums[2]) || 0;
          }

          // Age
          var ageMatch = artText.match(/(\\d+[dhm]\\s*ago|just now|yesterday)/i);
          r.age = ageMatch ? ageMatch[1] : '';

          if (r.url) results.push(r);
        }
        return JSON.stringify(results);
      })()
    `);
    const recommendedArticles: TrendingArticle[] = JSON.parse(recommendedData).map((a: any) => ({
      ...a,
      claps: a.claps || 0,
      responses: a.responses || 0,
      snippet: a.snippet || '',
      niche,
    }));

    // Scroll down to get latest articles
    await this.driver.executeJS(`window.scrollTo(0, document.body.scrollHeight)`);
    await this.driver.sleep(2000);

    const latestData = await this.driver.executeJS(`
      (function() {
        var text = document.body.innerText;
        var latestIdx = text.indexOf('Latest stories');
        if (latestIdx === -1) return JSON.stringify([]);

        var section = text.substring(latestIdx, latestIdx + 3000);
        var results = [];

        // Articles after "Latest stories" use same post-preview format
        var articles = document.querySelectorAll('article[data-testid="post-preview"]');
        // Take the last few (these tend to be the "latest" ones)
        for (var i = Math.max(0, articles.length - 10); i < articles.length; i++) {
          var art = articles[i];
          var r = {};
          var links = art.querySelectorAll('a');
          for (var j = 0; j < links.length; j++) {
            var txt = links[j].textContent.trim();
            if (txt.length > 15 && !links[j].href.includes('/tag/') && !links[j].href.includes('/@')) {
              r.title = txt.substring(0, 200);
              r.url = (links[j].href || '').split('?')[0];
              break;
            }
          }
          var authorLink = art.querySelector('a[href*="/@"]');
          if (authorLink) {
            r.author = authorLink.textContent.trim();
            r.authorUrl = authorLink.href.split('?')[0];
          }
          if (r.url) results.push(r);
        }
        return JSON.stringify(results);
      })()
    `);
    const latestArticles: TrendingArticle[] = JSON.parse(latestData).map((a: any) => ({
      ...a,
      claps: a.claps || 0,
      responses: a.responses || 0,
      snippet: a.snippet || '',
      niche,
    }));

    const result: NicheResearchResult = {
      niche,
      tagUrl,
      topicStats: { followers: meta.followers, stories: meta.stories },
      relatedTopics: meta.relatedTopics || [],
      topAuthors,
      recommendedArticles,
      latestArticles,
      researchedAt: new Date().toISOString(),
    };

    // Persist
    this.saveJSON(`niche-${tag}-${new Date().toISOString().split('T')[0]}.json`, result);
    console.log(`[Research] ${niche}: ${topAuthors.length} authors, ${recommendedArticles.length} recommended, ${latestArticles.length} latest`);

    return result;
  }

  // ═══════════════════════════════════════════════════════════════
  // MULTI-NICHE RESEARCH
  // ═══════════════════════════════════════════════════════════════

  async researchMultipleNiches(niches: string[]): Promise<MultiNicheReport> {
    console.log(`[Research] Researching ${niches.length} niches: ${niches.join(', ')}`);

    const nicheResults: NicheResearchResult[] = [];

    for (const niche of niches) {
      const result = await this.researchNiche(niche);
      nicheResults.push(result);
      await this.driver.sleep(2000); // Rate limit between niches
    }

    // Aggregate top authors (deduplicated, sorted by followers)
    const authorMap = new Map<string, TopAuthor>();
    for (const r of nicheResults) {
      for (const a of r.topAuthors) {
        const existing = authorMap.get(a.name);
        if (!existing || this.parseFollowers(a.followers) > this.parseFollowers(existing.followers)) {
          authorMap.set(a.name, a);
        }
      }
    }
    const allTopAuthors = Array.from(authorMap.values())
      .sort((a, b) => this.parseFollowers(b.followers) - this.parseFollowers(a.followers));

    // Aggregate trending articles (deduplicated, sorted by claps)
    const articleMap = new Map<string, TrendingArticle>();
    for (const r of nicheResults) {
      for (const a of [...r.recommendedArticles, ...r.latestArticles]) {
        if (a.url && !articleMap.has(a.url)) {
          articleMap.set(a.url, a);
        }
      }
    }
    const allTrendingArticles = Array.from(articleMap.values())
      .sort((a, b) => b.claps - a.claps);

    // Generate news summaries per niche
    const newsSummary: NicheSummary[] = nicheResults.map(r => {
      const topStories = r.recommendedArticles
        .sort((a, b) => b.claps - a.claps)
        .slice(0, 5)
        .map(a => ({ title: a.title, author: a.author, claps: a.claps, snippet: a.snippet }));

      const topAuthorsInNiche = r.topAuthors
        .sort((a, b) => this.parseFollowers(b.followers) - this.parseFollowers(a.followers))
        .slice(0, 5)
        .map(a => ({ name: a.name, followers: a.followers }));

      // Extract themes from titles
      const themes = this.extractThemes(r.recommendedArticles.map(a => a.title));

      return {
        niche: r.niche,
        topStories,
        topAuthors: topAuthorsInNiche,
        themes,
      };
    });

    const report: MultiNicheReport = {
      niches: nicheResults,
      allTopAuthors,
      allTrendingArticles,
      newsSummary,
      generatedAt: new Date().toISOString(),
    };

    // Persist
    const dateKey = new Date().toISOString().split('T')[0];
    this.saveJSON(`multi-niche-${dateKey}.json`, report);
    console.log(`[Research] Multi-niche complete: ${allTopAuthors.length} authors, ${allTrendingArticles.length} articles across ${niches.length} niches`);

    return report;
  }

  // ═══════════════════════════════════════════════════════════════
  // NEWS AGGREGATION
  // ═══════════════════════════════════════════════════════════════

  async getNewsSummary(niches: string[]): Promise<NicheSummary[]> {
    const report = await this.researchMultipleNiches(niches);
    return report.newsSummary;
  }

  // ═══════════════════════════════════════════════════════════════
  // WEBHOOK / FORWARD TO EXTERNAL SERVER
  // ═══════════════════════════════════════════════════════════════

  async forwardToServer(data: any, webhook: WebhookConfig): Promise<{ success: boolean; statusCode?: number; error?: string }> {
    try {
      console.log(`[Research] Forwarding results to ${webhook.url}`);

      const response = await fetch(webhook.url, {
        method: webhook.method || 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(webhook.headers || {}),
        },
        body: JSON.stringify(data),
      });

      const statusCode = response.status;
      if (statusCode >= 200 && statusCode < 300) {
        console.log(`[Research] ✅ Forwarded successfully (${statusCode})`);
        return { success: true, statusCode };
      } else {
        const body = await response.text();
        console.error(`[Research] Forward failed: ${statusCode} — ${body.substring(0, 200)}`);
        return { success: false, statusCode, error: body.substring(0, 500) };
      }

    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      console.error(`[Research] Forward error: ${error}`);
      return { success: false, error };
    }
  }

  async researchAndForward(niches: string[], webhook: WebhookConfig): Promise<{
    research: MultiNicheReport;
    forwarded: { success: boolean; statusCode?: number; error?: string };
  }> {
    const research = await this.researchMultipleNiches(niches);
    const forwarded = await this.forwardToServer(research, webhook);
    return { research, forwarded };
  }

  // ═══════════════════════════════════════════════════════════════
  // DISCOVER TOP AUTHORS (deep search across multiple niches)
  // ═══════════════════════════════════════════════════════════════

  async discoverTopAuthors(niches: string[], minFollowers = 1000): Promise<TopAuthor[]> {
    console.log(`[Research] Discovering top authors across ${niches.length} niches (min ${minFollowers} followers)`);

    const allAuthors = new Map<string, TopAuthor>();

    for (const niche of niches) {
      const result = await this.researchNiche(niche);
      for (const author of result.topAuthors) {
        const count = this.parseFollowers(author.followers);
        if (count >= minFollowers) {
          const existing = allAuthors.get(author.name);
          if (!existing || count > this.parseFollowers(existing.followers)) {
            allAuthors.set(author.name, author);
          }
        }
      }
      await this.driver.sleep(2000);
    }

    const sorted = Array.from(allAuthors.values())
      .sort((a, b) => this.parseFollowers(b.followers) - this.parseFollowers(a.followers));

    console.log(`[Research] Found ${sorted.length} top authors with ${minFollowers}+ followers`);
    return sorted;
  }

  // ═══════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════

  private parseFollowers(str: string): number {
    if (!str) return 0;
    const cleaned = str.replace(/followers/i, '').trim();
    const match = cleaned.match(/([\d.]+)\s*([KkMm]?)/);
    if (!match) return 0;
    let num = parseFloat(match[1]);
    if (match[2] === 'K' || match[2] === 'k') num *= 1000;
    if (match[2] === 'M' || match[2] === 'm') num *= 1000000;
    return Math.round(num);
  }

  private extractThemes(titles: string[]): string[] {
    const wordFreq: Record<string, number> = {};
    const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
      'of', 'with', 'by', 'from', 'is', 'it', 'that', 'this', 'was', 'are', 'be', 'has', 'had',
      'not', 'you', 'your', 'my', 'i', 'we', 'they', 'how', 'why', 'what', 'when', 'where',
      'will', 'can', 'do', 'does', 'did', 'its', 'about', 'more', 'than', 'just', 'new', 'into']);

    for (const title of titles) {
      const words = title.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/);
      for (const word of words) {
        if (word.length > 2 && !stopWords.has(word)) {
          wordFreq[word] = (wordFreq[word] || 0) + 1;
        }
      }
    }

    return Object.entries(wordFreq)
      .filter(([_, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([word]) => word);
  }

  private saveJSON(filename: string, data: any): void {
    const filePath = path.join(this.dataDir, filename);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  }

  loadJSON(filename: string): any | null {
    const filePath = path.join(this.dataDir, filename);
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  }

  listSavedResearch(): string[] {
    if (!fs.existsSync(this.dataDir)) return [];
    return fs.readdirSync(this.dataDir).filter(f => f.endsWith('.json'));
  }
}
