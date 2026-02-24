/**
 * Medium Monetization Engine
 *
 * Strategic paywall management, earnings tracking, and SEO optimization
 * across 1,200+ published Medium stories.
 *
 * Capabilities:
 *   - Earnings tracking (current month, lifetime, per-story)
 *   - Audience stats (followers, subscribers)
 *   - Story performance scoring for paywall decisions
 *   - Strategic paywall recommendations (auto-identify what to paywall)
 *   - Batch paywall execution
 *   - SEO audit (missing/poor titles & descriptions)
 *   - Batch SEO updates via settings page automation
 *   - Persistent storage of historical data
 */

import { MediumSafariDriver } from './safari-driver.js';
import { MediumOperations } from './medium-operations.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export interface EarningsSummary {
  period: string;
  storyEarnings: number;
  totalEarnings: number;
  rolloverBalance: number;
  payoutStatus: string;
  topEarners: StoryEarning[];
  scrapedAt: string;
}

export interface StoryEarning {
  title: string;
  readTime: string;
  publishedDate: string;
  thisMonth: number;
  lifetime: number;
}

export interface AudienceStats {
  followers: number;
  followersChange: string;
  emailSubscribers: number;
  subscribersChange: string;
  scrapedAt: string;
}

export interface StoryPerformance {
  title: string;
  storyId: string;
  readTime: string;
  publishedDate: string;
  presentations: number;
  views: number;
  reads: number;
  earnings: string;
  paywallScore: number;
  recommendation: 'paywall' | 'keep_free' | 'monitor';
  reason: string;
}

export interface PaywallRecommendation {
  toPaywall: StoryPerformance[];
  toKeepFree: StoryPerformance[];
  toMonitor: StoryPerformance[];
  summary: {
    totalAnalyzed: number;
    paywallCandidates: number;
    keepFree: number;
    monitor: number;
    estimatedRevenueIncrease: string;
  };
  generatedAt: string;
}

export interface SEOAuditItem {
  storyId: string;
  title: string;
  currentSEOTitle: string;
  currentSEODescription: string;
  issues: string[];
  severity: 'high' | 'medium' | 'low';
}

export interface SEOAuditResult {
  stories: SEOAuditItem[];
  summary: {
    totalAudited: number;
    highSeverity: number;
    mediumSeverity: number;
    lowSeverity: number;
  };
  generatedAt: string;
}

// ═══════════════════════════════════════════════════════════════
// MonetizationEngine
// ═══════════════════════════════════════════════════════════════

export class MonetizationEngine {
  private driver: MediumSafariDriver;
  private operations: MediumOperations;
  private dataDir: string;

  constructor(operations: MediumOperations) {
    this.driver = new MediumSafariDriver();
    this.operations = operations;
    this.dataDir = path.join(os.homedir(), '.medium-automation');
    this.ensureDirs();
  }

  private ensureDirs(): void {
    for (const sub of ['earnings', 'seo', 'paywall', 'analytics']) {
      const dir = path.join(this.dataDir, sub);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // EARNINGS TRACKING
  // ═══════════════════════════════════════════════════════════════

  async getEarnings(): Promise<EarningsSummary> {
    console.log(`[Monetization] Scraping Partner Program earnings...`);

    await this.driver.navigate('https://medium.com/me/partner/dashboard');
    await this.driver.sleep(4000);

    const data = await this.driver.executeJS(`
      (function() {
        var r = {};
        var text = document.body.innerText;

        // Current period
        var periodMatch = text.match(/((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)(?:ruary|uary|ch|il|e|y|ust|tember|ober|ember)?\\s+\\d{4})\\n\\$([\\d.]+)/);
        r.period = periodMatch ? periodMatch[1] : '';
        r.totalEarnings = periodMatch ? parseFloat(periodMatch[2]) : 0;

        // Story earnings
        var storyMatch = text.match(/Story earnings\\n\\$([\\d.]+)/);
        r.storyEarnings = storyMatch ? parseFloat(storyMatch[1]) : 0;

        // Rollover balance
        var rollover = text.match(/Rollover balance\\n\\$([\\d.]+)/);
        r.rolloverBalance = rollover ? parseFloat(rollover[1]) : 0;

        // Payout status
        var enrolled = text.match(/(Enrolled|Not enrolled)/);
        r.payoutStatus = enrolled ? enrolled[1] : '';

        // Per-story earnings
        r.stories = [];
        var storyBlocks = text.split('View story');
        // Skip first block (header), process earnings blocks
        for (var i = 1; i < storyBlocks.length; i++) {
          var block = storyBlocks[i];
          var prevBlock = storyBlocks[i-1];

          // Title is at end of previous block
          var lines = prevBlock.split('\\n').filter(function(l){ return l.trim().length > 0 });
          var title = '';
          for (var j = lines.length - 1; j >= 0; j--) {
            if (lines[j].match(/min read/) || lines[j].match(/^\\$/) || lines[j].match(/^\\d{4}$/) || lines[j].match(/^·$/)) continue;
            if (lines[j].match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/)) continue;
            if (lines[j].length > 10) { title = lines[j]; break; }
          }

          // Read time and date from previous block
          var rtMatch = prevBlock.match(/(\\d+\\s*min\\s*read)/);
          var dateMatch = prevBlock.match(/((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[^·\\n]*\\d{4})/);

          // This month and lifetime from current block
          var thisMonthMatch = block.match(/\\$([\\d.]+)\\nThis Month/);
          var lifetimeMatch = block.match(/\\$([\\d.]+)\\nLifetime/);

          if (title && (thisMonthMatch || lifetimeMatch)) {
            r.stories.push({
              title: title.substring(0, 200),
              readTime: rtMatch ? rtMatch[1] : '',
              publishedDate: dateMatch ? dateMatch[1].trim() : '',
              thisMonth: thisMonthMatch ? parseFloat(thisMonthMatch[1]) : 0,
              lifetime: lifetimeMatch ? parseFloat(lifetimeMatch[1]) : 0
            });
          }
        }

        return JSON.stringify(r);
      })()
    `);

    const parsed = JSON.parse(data);
    const result: EarningsSummary = {
      period: parsed.period,
      storyEarnings: parsed.storyEarnings,
      totalEarnings: parsed.totalEarnings,
      rolloverBalance: parsed.rolloverBalance,
      payoutStatus: parsed.payoutStatus,
      topEarners: parsed.stories || [],
      scrapedAt: new Date().toISOString(),
    };

    // Persist
    const dateKey = new Date().toISOString().split('T')[0];
    this.saveJSON(`earnings/daily-${dateKey}.json`, result);
    console.log(`[Monetization] Earnings: $${result.totalEarnings} this month, $${result.rolloverBalance} rollover, ${result.topEarners.length} earning stories`);

    return result;
  }

  // ═══════════════════════════════════════════════════════════════
  // AUDIENCE STATS
  // ═══════════════════════════════════════════════════════════════

  async getAudienceStats(): Promise<AudienceStats> {
    console.log(`[Monetization] Scraping audience stats...`);

    await this.driver.navigate('https://medium.com/me/audience');
    await this.driver.sleep(4000);

    const data = await this.driver.executeJS(`
      (function() {
        var r = {};
        var text = document.body.innerText;

        var followersMatch = text.match(/(\\d+)\\nFollowers/);
        r.followers = followersMatch ? parseInt(followersMatch[1]) : 0;

        var followersChange = text.match(/Followers\\n\\n([^\\n]+from last month)/);
        r.followersChange = followersChange ? followersChange[1] : '';

        var subsMatch = text.match(/(\\d+)\\nEmail Subscribers/);
        r.emailSubscribers = subsMatch ? parseInt(subsMatch[1]) : 0;

        var subsChange = text.match(/Email Subscribers\\n\\n([^\\n]+from last month)/);
        r.subscribersChange = subsChange ? subsChange[1] : '';

        return JSON.stringify(r);
      })()
    `);

    const parsed = JSON.parse(data);
    const result: AudienceStats = {
      ...parsed,
      scrapedAt: new Date().toISOString(),
    };

    const dateKey = new Date().toISOString().split('T')[0];
    this.saveJSON(`analytics/audience-${dateKey}.json`, result);

    console.log(`[Monetization] Audience: ${result.followers} followers, ${result.emailSubscribers} subscribers`);
    return result;
  }

  // ═══════════════════════════════════════════════════════════════
  // STRATEGIC PAYWALL ANALYZER
  // ═══════════════════════════════════════════════════════════════

  async analyzeForPaywall(opts: { maxStories?: number; scrollPages?: number } = {}): Promise<PaywallRecommendation> {
    const maxStories = opts.maxStories || 200;
    const scrollPages = opts.scrollPages || 15;

    console.log(`[Monetization] Analyzing stories for paywall strategy...`);

    // Navigate to stats page to get per-story performance
    await this.driver.navigate('https://medium.com/me/stats?publishedAt=DESC');
    await this.driver.sleep(4000);

    const allStories: StoryPerformance[] = [];
    const seenTitles = new Set<string>();
    let lastCount = 0;
    let noNewCount = 0;

    for (let page = 0; page < scrollPages; page++) {
      const data = await this.driver.executeJS(`
        (function() {
          var results = [];
          var text = document.body.innerText;

          // Find story rows in the stats table
          // Pattern: Title\\nread time\\n·\\ndate\\n·\\nView story\\npresentations\\nviews\\nreads\\nearnings
          var blocks = text.split('View story');
          for (var i = 0; i < blocks.length - 1; i++) {
            var before = blocks[i];
            var after = blocks[i+1];

            var lines = before.split('\\n').filter(function(l){ return l.trim().length > 0 });

            // Title: last line that's long enough and not metadata
            var title = '';
            var readTime = '';
            var pubDate = '';
            for (var j = lines.length - 1; j >= Math.max(0, lines.length - 8); j--) {
              var l = lines[j].trim();
              if (l.match(/^\\d+\\s*min\\s*read/)) { readTime = l; continue; }
              if (l.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/)) { pubDate = l; continue; }
              if (l === '·' || l.match(/^\\d+$/) || l === '-' || l === 'Latest' || l === 'Story' || l === 'Presentations') continue;
              if (l.length > 15 && !title) { title = l; break; }
            }

            // Stats from after block
            var afterLines = after.split('\\n').filter(function(l){ return l.trim().length > 0 });
            var presentations = 0, views = 0, reads = 0;
            var earnings = '-';
            var numIdx = 0;
            for (var k = 0; k < Math.min(afterLines.length, 6); k++) {
              var val = afterLines[k].trim();
              if (val.match(/^\\d+$/) || val.match(/^[\\d,]+$/)) {
                var num = parseInt(val.replace(/,/g, ''));
                if (numIdx === 0) presentations = num;
                else if (numIdx === 1) views = num;
                else if (numIdx === 2) reads = num;
                numIdx++;
              }
              if (val.match(/^\\$/) || val === '-') { earnings = val; break; }
            }

            if (title && title.length > 5) {
              results.push({
                title: title.substring(0, 200),
                readTime: readTime,
                publishedDate: pubDate,
                presentations: presentations,
                views: views,
                reads: reads,
                earnings: earnings
              });
            }
          }
          return JSON.stringify(results);
        })()
      `);

      const parsed = JSON.parse(data);
      for (const story of parsed) {
        if (seenTitles.has(story.title)) continue;
        seenTitles.add(story.title);

        const scored = this.scoreForPaywall(story);
        allStories.push(scored);
      }

      if (allStories.length >= maxStories) break;

      if (allStories.length === lastCount) {
        noNewCount++;
        if (noNewCount >= 3) break;
      } else {
        noNewCount = 0;
        lastCount = allStories.length;
      }

      // Scroll to load more stories
      await this.driver.executeJS(`window.scrollTo(0, document.body.scrollHeight)`);
      await this.driver.sleep(2000);

      if (page % 5 === 4) {
        console.log(`[Monetization] Analyzed ${allStories.length} stories (scroll ${page + 1})...`);
      }
    }

    // Sort and categorize
    const toPaywall = allStories.filter(s => s.recommendation === 'paywall').sort((a, b) => b.paywallScore - a.paywallScore);
    const toKeepFree = allStories.filter(s => s.recommendation === 'keep_free');
    const toMonitor = allStories.filter(s => s.recommendation === 'monitor').sort((a, b) => b.paywallScore - a.paywallScore);

    const result: PaywallRecommendation = {
      toPaywall,
      toKeepFree,
      toMonitor,
      summary: {
        totalAnalyzed: allStories.length,
        paywallCandidates: toPaywall.length,
        keepFree: toKeepFree.length,
        monitor: toMonitor.length,
        estimatedRevenueIncrease: `$${(toPaywall.length * 0.02).toFixed(2)}-${(toPaywall.length * 0.10).toFixed(2)}/month (est.)`,
      },
      generatedAt: new Date().toISOString(),
    };

    // Persist
    const dateKey = new Date().toISOString().split('T')[0];
    this.saveJSON(`paywall/recommendations-${dateKey}.json`, result);

    console.log(`[Monetization] Paywall analysis complete:`);
    console.log(`  ${toPaywall.length} should be paywalled`);
    console.log(`  ${toKeepFree.length} should stay free`);
    console.log(`  ${toMonitor.length} to monitor`);

    return result;
  }

  // ─── Score a story for paywall decision ────────────────────

  private scoreForPaywall(story: any): StoryPerformance {
    const { views, reads, presentations } = story;
    const readRatio = views > 0 ? reads / views : 0;

    // Calculate paywall score (0-100)
    let score = 0;

    // Views weight (40%): more views = more paywall value
    if (views >= 50) score += 40;
    else if (views >= 20) score += 30;
    else if (views >= 10) score += 15;
    else if (views >= 5) score += 5;

    // Read ratio weight (30%): high read ratio = engaging content worth paying for
    if (readRatio >= 0.5) score += 30;
    else if (readRatio >= 0.3) score += 20;
    else if (readRatio >= 0.1) score += 10;

    // Presentations weight (20%): high presentations = Medium is distributing it
    if (presentations >= 100) score += 20;
    else if (presentations >= 50) score += 15;
    else if (presentations >= 20) score += 10;
    else if (presentations >= 10) score += 5;

    // Already earning bonus (10%)
    if (story.earnings && story.earnings !== '-') score += 10;

    // Determine recommendation
    let recommendation: 'paywall' | 'keep_free' | 'monitor';
    let reason: string;

    if (score >= 50) {
      recommendation = 'paywall';
      reason = `High score (${score}): ${views} views, ${(readRatio * 100).toFixed(0)}% read ratio, ${presentations} presentations`;
    } else if (score >= 25) {
      recommendation = 'monitor';
      reason = `Moderate score (${score}): growing traction, monitor for paywall`;
    } else {
      recommendation = 'keep_free';
      reason = `Low score (${score}): needs more discovery before paywalling`;
    }

    return {
      title: story.title,
      storyId: '', // Will be matched later if needed
      readTime: story.readTime,
      publishedDate: story.publishedDate,
      presentations: presentations,
      views: views,
      reads: reads,
      earnings: story.earnings,
      paywallScore: score,
      recommendation,
      reason,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // SEO AUDIT & OPTIMIZATION
  // ═══════════════════════════════════════════════════════════════

  async auditSEO(storyIds: string[]): Promise<SEOAuditResult> {
    console.log(`[Monetization] Auditing SEO for ${storyIds.length} stories...`);

    const items: SEOAuditItem[] = [];

    for (let i = 0; i < storyIds.length; i++) {
      const storyId = storyIds[i];

      try {
        await this.driver.navigate(`https://medium.com/p/${storyId}/settings`);
        await this.driver.sleep(2500);

        const data = await this.driver.executeJS(`
          (function() {
            var text = document.body.innerText;
            var r = {};

            // Title
            var titleMatch = text.match(/^(.+?)\\nStory settings/m);
            r.title = titleMatch ? titleMatch[1].trim() : '';

            // SEO Title
            var seoTitleMatch = text.match(/Title preview \\((\\d+)\\):\\n(.+?)\\n/);
            r.seoTitleLen = seoTitleMatch ? parseInt(seoTitleMatch[1]) : 0;
            r.seoTitle = seoTitleMatch ? seoTitleMatch[2] : '';

            // SEO Description
            var descMatch = text.match(/Description \\((\\d+)\\):\\n(.+?)\\n/);
            r.seoDescLen = descMatch ? parseInt(descMatch[1]) : 0;
            r.seoDesc = descMatch ? descMatch[2] : '';

            // Check if missing description
            r.hasDesc = text.includes('Description (') && r.seoDescLen > 0;

            // Check member-only
            r.isMemberOnly = text.includes('member-only story');

            return JSON.stringify(r);
          })()
        `);

        const parsed = JSON.parse(data);
        const issues: string[] = [];
        let severity: 'high' | 'medium' | 'low' = 'low';

        // Check SEO title
        if (parsed.seoTitleLen > 60) {
          issues.push(`SEO title too long (${parsed.seoTitleLen} chars, max 60)`);
          severity = 'medium';
        }
        if (parsed.seoTitleLen < 30) {
          issues.push(`SEO title too short (${parsed.seoTitleLen} chars, ideal 40-50)`);
          severity = 'medium';
        }

        // Check SEO description
        if (!parsed.hasDesc || parsed.seoDescLen === 0) {
          issues.push('Missing SEO description');
          severity = 'high';
        } else if (parsed.seoDescLen > 156) {
          issues.push(`SEO description too long (${parsed.seoDescLen} chars, max 156)`);
          severity = 'medium';
        } else if (parsed.seoDescLen < 100) {
          issues.push(`SEO description too short (${parsed.seoDescLen} chars, ideal 140-156)`);
          severity = 'medium';
        }

        if (issues.length === 0) {
          issues.push('SEO looks good');
          severity = 'low';
        }

        items.push({
          storyId,
          title: parsed.title,
          currentSEOTitle: parsed.seoTitle,
          currentSEODescription: parsed.seoDesc,
          issues,
          severity,
        });

        if ((i + 1) % 10 === 0) {
          console.log(`[Monetization] Audited ${i + 1}/${storyIds.length} stories`);
        }

      } catch (e) {
        items.push({
          storyId,
          title: '',
          currentSEOTitle: '',
          currentSEODescription: '',
          issues: [`Error: ${e instanceof Error ? e.message : String(e)}`],
          severity: 'high',
        });
      }
    }

    const result: SEOAuditResult = {
      stories: items,
      summary: {
        totalAudited: items.length,
        highSeverity: items.filter(i => i.severity === 'high').length,
        mediumSeverity: items.filter(i => i.severity === 'medium').length,
        lowSeverity: items.filter(i => i.severity === 'low').length,
      },
      generatedAt: new Date().toISOString(),
    };

    const dateKey = new Date().toISOString().split('T')[0];
    this.saveJSON(`seo/audit-${dateKey}.json`, result);

    console.log(`[Monetization] SEO audit: ${result.summary.highSeverity} high, ${result.summary.mediumSeverity} medium, ${result.summary.lowSeverity} low severity`);
    return result;
  }

  // ─── Update SEO for a single story ─────────────────────────

  async updateSEO(storyId: string, seoTitle?: string, seoDescription?: string): Promise<{ success: boolean; storyId: string; error?: string }> {
    try {
      await this.driver.navigate(`https://medium.com/p/${storyId}/settings`);
      await this.driver.sleep(3000);

      if (seoTitle) {
        // Find and update SEO title input
        const titleResult = await this.driver.executeJS(`
          (function() {
            var inputs = document.querySelectorAll('input, textarea');
            for (var i = 0; i < inputs.length; i++) {
              var ph = (inputs[i].placeholder || '').toLowerCase();
              var label = (inputs[i].getAttribute('aria-label') || '').toLowerCase();
              // SEO title is usually near "SEO Title" text
              var prev = inputs[i].previousElementSibling || inputs[i].parentElement;
              var context = prev ? prev.textContent : '';
              if (context.includes('SEO Title') || ph.includes('seo') || label.includes('seo title')) {
                inputs[i].focus();
                inputs[i].value = '';
                inputs[i].value = '${seoTitle.replace(/'/g, "\\'")}';
                inputs[i].dispatchEvent(new Event('input', {bubbles: true}));
                inputs[i].dispatchEvent(new Event('change', {bubbles: true}));
                return 'updated';
              }
            }
            return 'not_found';
          })()
        `);

        if (titleResult === 'updated') {
          // Click Save
          await this.driver.sleep(500);
          await this.driver.clickButtonByText('Save');
          await this.driver.sleep(1000);
        }
      }

      if (seoDescription) {
        const descResult = await this.driver.executeJS(`
          (function() {
            var inputs = document.querySelectorAll('input, textarea');
            for (var i = 0; i < inputs.length; i++) {
              var prev = inputs[i].previousElementSibling || inputs[i].parentElement;
              var context = prev ? prev.textContent : '';
              if (context.includes('SEO Description') || context.includes('Description')) {
                inputs[i].focus();
                inputs[i].value = '';
                inputs[i].value = '${seoDescription.replace(/'/g, "\\'")}';
                inputs[i].dispatchEvent(new Event('input', {bubbles: true}));
                inputs[i].dispatchEvent(new Event('change', {bubbles: true}));
                return 'updated';
              }
            }
            return 'not_found';
          })()
        `);

        if (descResult === 'updated') {
          await this.driver.sleep(500);
          // Find the second Save button (for description)
          await this.driver.executeJS(`
            (function() {
              var btns = document.querySelectorAll('button');
              var saveCount = 0;
              for (var i = 0; i < btns.length; i++) {
                if (btns[i].textContent.trim() === 'Save') {
                  saveCount++;
                  if (saveCount === 2) { btns[i].click(); return 'clicked'; }
                }
              }
              // Fallback: click last Save
              for (var i = btns.length - 1; i >= 0; i--) {
                if (btns[i].textContent.trim() === 'Save') { btns[i].click(); return 'clicked_last'; }
              }
              return 'not_found';
            })()
          `);
          await this.driver.sleep(1000);
        }
      }

      return { success: true, storyId };

    } catch (e) {
      return { success: false, storyId, error: e instanceof Error ? e.message : String(e) };
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // FULL MONETIZATION REPORT
  // ═══════════════════════════════════════════════════════════════

  async generateFullReport(): Promise<{
    earnings: EarningsSummary;
    audience: AudienceStats;
    paywall: PaywallRecommendation;
  }> {
    console.log(`[Monetization] Generating full monetization report...`);

    const earnings = await this.getEarnings();
    const audience = await this.getAudienceStats();
    const paywall = await this.analyzeForPaywall({ maxStories: 100, scrollPages: 8 });

    const report = { earnings, audience, paywall };

    const dateKey = new Date().toISOString().split('T')[0];
    this.saveJSON(`analytics/full-report-${dateKey}.json`, report);

    console.log(`[Monetization] Full report saved`);
    return report;
  }

  // ═══════════════════════════════════════════════════════════════
  // PERSISTENCE
  // ═══════════════════════════════════════════════════════════════

  private saveJSON(relativePath: string, data: any): void {
    const filePath = path.join(this.dataDir, relativePath);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  }

  loadJSON(relativePath: string): any | null {
    const filePath = path.join(this.dataDir, relativePath);
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  }

  listSavedReports(): string[] {
    const analyticsDir = path.join(this.dataDir, 'analytics');
    if (!fs.existsSync(analyticsDir)) return [];
    return fs.readdirSync(analyticsDir).filter(f => f.endsWith('.json'));
  }
}
