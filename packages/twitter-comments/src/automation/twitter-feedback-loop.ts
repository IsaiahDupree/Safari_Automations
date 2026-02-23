/**
 * Twitter Closed-Loop Feedback System
 *
 * Full cycle: Post → Track → Analyze → Refine → Post
 *
 * Components:
 *   1. TweetPerformanceTracker — stores tweets, checks back at 1hr/4hr/24hr,
 *      extracts engagement metrics from live Twitter via Safari
 *   2. EngagementAnalyzer — classifies performance (viral → flop),
 *      finds winning patterns (hooks, topics, formats, times)
 *   3. PromptRefiner — uses performance history + market research + offer data
 *      to generate optimized tweet creation prompts
 *   4. TwitterFeedbackLoop — orchestrates the closed loop
 *
 * Persistence: all state lives in ~/.twitter-feedback/ as JSON files
 *
 * Check-back schedule:
 *   - 1 hour: early signal (is this going anywhere?)
 *   - 4 hours: mid signal (engagement velocity)
 *   - 24 hours: final score (mature metrics)
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

export interface TweetMetrics {
  likes: number;
  retweets: number;
  replies: number;
  quotes: number;
  bookmarks: number;
  views: number;
  engagementRate: number;     // (likes+retweets+replies+quotes+bookmarks) / views
  collectedAt: string;
}

export interface TrackedTweet {
  id: string;
  tweetUrl: string;
  text: string;
  postedAt: string;
  niche: string;
  offer: string;
  hooks: string[];             // extracted hook patterns
  cta: string;
  format: 'text' | 'thread' | 'poll' | 'media';
  hashtags: string[];

  // Check-back metrics snapshots
  metrics1hr?: TweetMetrics;
  metrics4hr?: TweetMetrics;
  metrics24hr?: TweetMetrics;
  metricsFinal?: TweetMetrics;

  // Classification (set after 24hr check)
  classification?: 'viral' | 'strong' | 'average' | 'weak' | 'flop';
  engagementScore?: number;
  velocityScore?: number;      // how fast engagement grew

  // Scheduling
  nextCheckAt?: string;
  checksCompleted: number;
  fullyTracked: boolean;
}

export interface OfferContext {
  name: string;
  description: string;
  targetAudience: string;
  keyBenefits: string[];
  url?: string;
  hashtags?: string[];
}

export interface NicheContext {
  niche: string;
  topPerformingHooks: string[];
  topPerformingTopics: string[];
  avoidPatterns: string[];
  bestPostingTimes: string[];
  competitorInsights: string[];
}

export interface StrategyContext {
  generatedAt: string;
  totalTweetsAnalyzed: number;
  avgEngagementRate: number;
  bestPerformingTweets: Array<{ text: string; engagementRate: number; classification: string }>;
  worstPerformingTweets: Array<{ text: string; engagementRate: number; classification: string }>;
  winningPatterns: {
    hooks: Array<{ pattern: string; avgEngagement: number; count: number }>;
    topics: Array<{ topic: string; avgEngagement: number; count: number }>;
    formats: Array<{ format: string; avgEngagement: number; count: number }>;
    times: Array<{ hour: number; avgEngagement: number; count: number }>;
    lengths: Array<{ range: string; avgEngagement: number; count: number }>;
  };
  avoidPatterns: string[];
  trendingInNiche: string[];
  promptGuidelines: string;
}

export interface FeedbackLoopConfig {
  dataDir: string;
  checkBackPeriods: number[];   // ms — default [3600000, 14400000, 86400000]
  classificationThresholds: {
    viral: number;     // top X percentile
    strong: number;
    average: number;
    weak: number;
    // below weak = flop
  };
  maxHistorySize: number;
  twitterProfileUrl: string;
}

export const DEFAULT_FEEDBACK_CONFIG: FeedbackLoopConfig = {
  dataDir: path.join(os.homedir(), '.twitter-feedback'),
  checkBackPeriods: [
    1 * 60 * 60 * 1000,      // 1 hour
    4 * 60 * 60 * 1000,      // 4 hours
    24 * 60 * 60 * 1000,     // 24 hours
  ],
  classificationThresholds: {
    viral: 95,    // top 5%
    strong: 80,   // top 20%
    average: 50,  // top 50%
    weak: 20,     // top 80%
  },
  maxHistorySize: 500,
  twitterProfileUrl: 'https://x.com/IsaiahDupree7',
};

// ═══════════════════════════════════════════════════════════════
// TweetPerformanceTracker
// ═══════════════════════════════════════════════════════════════

export class TweetPerformanceTracker {
  private config: FeedbackLoopConfig;
  private tweets: TrackedTweet[] = [];
  private dataFile: string;

  constructor(config: Partial<FeedbackLoopConfig> = {}) {
    this.config = { ...DEFAULT_FEEDBACK_CONFIG, ...config };
    this.dataFile = path.join(this.config.dataDir, 'tracked-tweets.json');
    this.ensureDir();
    this.load();
  }

  private ensureDir(): void {
    if (!fs.existsSync(this.config.dataDir)) {
      fs.mkdirSync(this.config.dataDir, { recursive: true });
    }
  }

  private load(): void {
    if (fs.existsSync(this.dataFile)) {
      try { this.tweets = JSON.parse(fs.readFileSync(this.dataFile, 'utf-8')); }
      catch { this.tweets = []; }
    }
  }

  private save(): void {
    fs.writeFileSync(this.dataFile, JSON.stringify(this.tweets, null, 2));
  }

  // ─── Register a new tweet for tracking ─────────────────────

  registerTweet(tweet: Omit<TrackedTweet, 'checksCompleted' | 'fullyTracked'>): TrackedTweet {
    const tracked: TrackedTweet = {
      ...tweet,
      checksCompleted: 0,
      fullyTracked: false,
      nextCheckAt: new Date(Date.now() + this.config.checkBackPeriods[0]).toISOString(),
    };
    this.tweets.unshift(tracked);

    // Trim history
    if (this.tweets.length > this.config.maxHistorySize) {
      this.tweets = this.tweets.slice(0, this.config.maxHistorySize);
    }

    this.save();
    console.log(`[Tracker] Registered tweet ${tweet.id} — first check at ${tracked.nextCheckAt}`);
    return tracked;
  }

  // ─── Get tweets due for check-back ─────────────────────────

  getDueForCheckBack(): TrackedTweet[] {
    const now = new Date().toISOString();
    return this.tweets.filter(t => !t.fullyTracked && t.nextCheckAt && t.nextCheckAt <= now);
  }

  // ─── Extract metrics from a tweet URL via Safari ───────────

  async extractMetrics(tweetUrl: string): Promise<TweetMetrics | null> {
    try {
      // Navigate to the tweet
      const safeUrl = tweetUrl.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      await execAsync(`osascript -e 'tell application "Safari" to set URL of current tab of front window to "${safeUrl}"'`);

      // Smart wait: poll for tweet article to render (X is slow)
      let articleFound = false;
      for (let i = 0; i < 15; i++) {
        await new Promise(r => setTimeout(r, 1000));
        try {
          const checkTmp = path.join(os.tmpdir(), `safari_check_${Date.now()}.scpt`);
          const checkJs = `(function(){ return document.querySelector('article[data-testid="tweet"]') ? 'found' : 'waiting'; })()`;
          const checkEsc = checkJs.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
          fs.writeFileSync(checkTmp, `tell application "Safari" to do JavaScript "${checkEsc}" in current tab of front window`);
          const { stdout } = await execAsync(`osascript "${checkTmp}"`, { timeout: 5000 });
          try { fs.unlinkSync(checkTmp); } catch {}
          if (stdout.trim() === 'found') { articleFound = true; break; }
        } catch {}
      }

      if (!articleFound) {
        console.log(`[Tracker] Tweet article never rendered for ${tweetUrl} (waited 15s)`);
        return null;
      }

      // Extra settle time for engagement counters to populate
      await new Promise(r => setTimeout(r, 1500));

      const tmpFile = path.join(os.tmpdir(), `safari_metrics_${Date.now()}.scpt`);
      const jsCode = `
        (function() {
          var article = document.querySelector('article[data-testid="tweet"]');
          if (!article) return JSON.stringify({error: 'no_tweet'});

          var metrics = {likes:0, retweets:0, replies:0, quotes:0, bookmarks:0, views:0};

          // Method 1: aria-label on action buttons
          var groups = article.querySelectorAll('[role="group"] button, [role="group"] a');
          for (var i = 0; i < groups.length; i++) {
            var label = (groups[i].getAttribute('aria-label') || '').toLowerCase();
            var numMatch = label.match(/(\\d[\\d,]*)/);
            if (!numMatch) continue;
            var num = parseInt(numMatch[1].replace(/,/g, ''));

            if (label.includes('repl')) metrics.replies = num;
            else if (label.includes('repost') || label.includes('retweet')) metrics.retweets = num;
            else if (label.includes('like')) metrics.likes = num;
            else if (label.includes('bookmark')) metrics.bookmarks = num;
            else if (label.includes('view')) metrics.views = num;
          }

          // Method 2: analytics link for views
          if (metrics.views === 0) {
            var viewLinks = article.querySelectorAll('a[href*="/analytics"]');
            for (var v = 0; v < viewLinks.length; v++) {
              var vText = (viewLinks[v].textContent || '').trim();
              var vMatch = vText.match(/([\\d,.]+[KkMm]?)/);
              if (vMatch) {
                var val = vMatch[1].replace(/,/g, '');
                metrics.views = parseFloat(val) || 0;
                if (val.includes('K') || val.includes('k')) metrics.views *= 1000;
                if (val.includes('M') || val.includes('m')) metrics.views *= 1000000;
                metrics.views = Math.round(metrics.views);
              }
            }
          }

          // Method 3: spans with numbers near icons
          if (metrics.likes === 0 && metrics.retweets === 0) {
            var spans = article.querySelectorAll('[role="group"] span');
            var nums = [];
            for (var s = 0; s < spans.length; s++) {
              var txt = (spans[s].textContent || '').trim();
              if (txt.match(/^[\\d,.]+[KkMm]?$/) && txt !== '0') {
                var n = parseFloat(txt.replace(/,/g, ''));
                if (txt.includes('K') || txt.includes('k')) n *= 1000;
                if (txt.includes('M') || txt.includes('m')) n *= 1000000;
                nums.push(Math.round(n));
              }
            }
            // Twitter order: replies, retweets, likes, bookmarks, views
            if (nums.length >= 1) metrics.replies = metrics.replies || nums[0];
            if (nums.length >= 2) metrics.retweets = metrics.retweets || nums[1];
            if (nums.length >= 3) metrics.likes = metrics.likes || nums[2];
            if (nums.length >= 4) metrics.bookmarks = metrics.bookmarks || nums[3];
            if (nums.length >= 5) metrics.views = metrics.views || nums[4];
          }

          return JSON.stringify(metrics);
        })()
      `.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');

      const appleScript = `tell application "Safari" to do JavaScript "${jsCode}" in current tab of front window`;
      fs.writeFileSync(tmpFile, appleScript);

      try {
        const { stdout } = await execAsync(`osascript "${tmpFile}"`, { timeout: 15000 });
        const raw = JSON.parse(stdout.trim());
        if (raw.error) return null;

        const totalEngagement = raw.likes + raw.retweets + raw.replies + (raw.quotes || 0) + (raw.bookmarks || 0);
        const engagementRate = raw.views > 0 ? totalEngagement / raw.views : 0;

        return {
          likes: raw.likes || 0,
          retweets: raw.retweets || 0,
          replies: raw.replies || 0,
          quotes: raw.quotes || 0,
          bookmarks: raw.bookmarks || 0,
          views: raw.views || 0,
          engagementRate: Math.round(engagementRate * 10000) / 10000,
          collectedAt: new Date().toISOString(),
        };
      } finally {
        try { fs.unlinkSync(tmpFile); } catch {}
      }
    } catch (e) {
      console.log(`[Tracker] Failed to extract metrics: ${e}`);
      return null;
    }
  }

  // ─── Run check-back for a single tweet ─────────────────────

  async checkBack(tweet: TrackedTweet): Promise<TrackedTweet> {
    console.log(`[Tracker] Checking back on tweet ${tweet.id} (check #${tweet.checksCompleted + 1})`);

    const metrics = await this.extractMetrics(tweet.tweetUrl);
    if (!metrics) {
      console.log(`[Tracker] Could not extract metrics for ${tweet.id}`);
      return tweet;
    }

    const checkIndex = tweet.checksCompleted;
    if (checkIndex === 0) tweet.metrics1hr = metrics;
    else if (checkIndex === 1) tweet.metrics4hr = metrics;
    else if (checkIndex >= 2) tweet.metrics24hr = metrics;

    tweet.checksCompleted++;

    // Schedule next check or mark as fully tracked
    if (tweet.checksCompleted < this.config.checkBackPeriods.length) {
      tweet.nextCheckAt = new Date(
        new Date(tweet.postedAt).getTime() + this.config.checkBackPeriods[tweet.checksCompleted]
      ).toISOString();
    } else {
      tweet.fullyTracked = true;
      tweet.metricsFinal = metrics;
      tweet.nextCheckAt = undefined;

      // Calculate velocity
      if (tweet.metrics1hr && tweet.metrics24hr) {
        const early = tweet.metrics1hr.likes + tweet.metrics1hr.retweets;
        const final = tweet.metrics24hr.likes + tweet.metrics24hr.retweets;
        tweet.velocityScore = early > 0 ? final / early : 0;
      }
    }

    // Update engagement score
    const latest = tweet.metrics24hr || tweet.metrics4hr || tweet.metrics1hr;
    if (latest) {
      tweet.engagementScore = latest.likes + latest.retweets * 2 + latest.replies * 1.5 +
                              latest.bookmarks * 2 + latest.quotes * 3;
    }

    this.save();

    const m = metrics;
    console.log(`[Tracker] ${tweet.id}: ${m.likes}❤ ${m.retweets}🔁 ${m.replies}💬 ${m.views}👁 (ER: ${(m.engagementRate * 100).toFixed(2)}%)`);
    return tweet;
  }

  // ─── Run all due check-backs ───────────────────────────────

  async runAllCheckBacks(): Promise<{ checked: number; results: TrackedTweet[] }> {
    const due = this.getDueForCheckBack();
    if (due.length === 0) {
      console.log('[Tracker] No tweets due for check-back');
      return { checked: 0, results: [] };
    }

    console.log(`[Tracker] ${due.length} tweets due for check-back`);
    const results: TrackedTweet[] = [];
    for (const tweet of due) {
      const updated = await this.checkBack(tweet);
      results.push(updated);
      await new Promise(r => setTimeout(r, 2000)); // don't hammer Safari
    }

    return { checked: results.length, results };
  }

  // ─── Getters ───────────────────────────────────────────────

  getAllTweets(): TrackedTweet[] { return [...this.tweets]; }

  getFullyTracked(): TrackedTweet[] { return this.tweets.filter(t => t.fullyTracked); }

  getPending(): TrackedTweet[] { return this.tweets.filter(t => !t.fullyTracked); }

  getByClassification(cls: string): TrackedTweet[] {
    return this.tweets.filter(t => t.classification === cls);
  }

  getStats(): Record<string, any> {
    const tracked = this.getFullyTracked();
    return {
      totalTracked: this.tweets.length,
      fullyTracked: tracked.length,
      pending: this.tweets.length - tracked.length,
      dueNow: this.getDueForCheckBack().length,
      classifications: {
        viral: tracked.filter(t => t.classification === 'viral').length,
        strong: tracked.filter(t => t.classification === 'strong').length,
        average: tracked.filter(t => t.classification === 'average').length,
        weak: tracked.filter(t => t.classification === 'weak').length,
        flop: tracked.filter(t => t.classification === 'flop').length,
      },
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// EngagementAnalyzer
// ═══════════════════════════════════════════════════════════════

export class EngagementAnalyzer {
  private config: FeedbackLoopConfig;

  constructor(config: Partial<FeedbackLoopConfig> = {}) {
    this.config = { ...DEFAULT_FEEDBACK_CONFIG, ...config };
  }

  // ─── Classify all fully-tracked tweets by percentile ───────

  classifyAll(tweets: TrackedTweet[]): TrackedTweet[] {
    const tracked = tweets.filter(t => t.fullyTracked && t.engagementScore !== undefined);
    if (tracked.length === 0) return tweets;

    // Sort by engagement score
    const sorted = [...tracked].sort((a, b) => (b.engagementScore || 0) - (a.engagementScore || 0));

    for (let i = 0; i < sorted.length; i++) {
      const percentile = ((sorted.length - i) / sorted.length) * 100;
      if (percentile >= this.config.classificationThresholds.viral) {
        sorted[i].classification = 'viral';
      } else if (percentile >= this.config.classificationThresholds.strong) {
        sorted[i].classification = 'strong';
      } else if (percentile >= this.config.classificationThresholds.average) {
        sorted[i].classification = 'average';
      } else if (percentile >= this.config.classificationThresholds.weak) {
        sorted[i].classification = 'weak';
      } else {
        sorted[i].classification = 'flop';
      }
    }

    return tweets;
  }

  // ─── Extract hook from tweet text ──────────────────────────

  extractHook(text: string): string {
    // Hook = first sentence or first line
    const firstLine = text.split('\n')[0].trim();
    const firstSentence = text.split(/[.!?]/)[0].trim();
    return firstLine.length < firstSentence.length ? firstLine : firstSentence;
  }

  // ─── Extract CTA from tweet text ───────────────────────────

  extractCTA(text: string): string {
    const lines = text.split('\n').filter(l => l.trim());
    const lastLine = lines[lines.length - 1]?.trim() || '';
    // Common CTA patterns
    if (lastLine.match(/follow|like|retweet|share|check|link|comment|reply|thread|bookmark|save/i)) {
      return lastLine;
    }
    return '';
  }

  // ─── Find winning patterns ─────────────────────────────────

  analyzePatterns(tweets: TrackedTweet[]): StrategyContext['winningPatterns'] {
    const tracked = tweets.filter(t => t.fullyTracked && t.engagementScore !== undefined);

    // Hooks
    const hookMap = new Map<string, { total: number; count: number }>();
    for (const t of tracked) {
      const hook = this.extractHook(t.text);
      const hookType = this.categorizeHook(hook);
      const existing = hookMap.get(hookType) || { total: 0, count: 0 };
      existing.total += t.engagementScore || 0;
      existing.count++;
      hookMap.set(hookType, existing);
    }

    // Topics (niche)
    const topicMap = new Map<string, { total: number; count: number }>();
    for (const t of tracked) {
      const topic = t.niche || 'general';
      const existing = topicMap.get(topic) || { total: 0, count: 0 };
      existing.total += t.engagementScore || 0;
      existing.count++;
      topicMap.set(topic, existing);
    }

    // Formats
    const formatMap = new Map<string, { total: number; count: number }>();
    for (const t of tracked) {
      const existing = formatMap.get(t.format) || { total: 0, count: 0 };
      existing.total += t.engagementScore || 0;
      existing.count++;
      formatMap.set(t.format, existing);
    }

    // Times (hour of day)
    const timeMap = new Map<number, { total: number; count: number }>();
    for (const t of tracked) {
      const hour = new Date(t.postedAt).getHours();
      const existing = timeMap.get(hour) || { total: 0, count: 0 };
      existing.total += t.engagementScore || 0;
      existing.count++;
      timeMap.set(hour, existing);
    }

    // Lengths
    const lengthMap = new Map<string, { total: number; count: number }>();
    for (const t of tracked) {
      const len = t.text.length;
      const range = len < 80 ? 'short (<80)' : len < 160 ? 'medium (80-160)' : len < 240 ? 'long (160-240)' : 'max (240+)';
      const existing = lengthMap.get(range) || { total: 0, count: 0 };
      existing.total += t.engagementScore || 0;
      existing.count++;
      lengthMap.set(range, existing);
    }

    const toSorted = (map: Map<string, { total: number; count: number }>, keyName: string) =>
      Array.from(map.entries())
        .map(([key, v]) => ({ [keyName]: key, avgEngagement: Math.round(v.total / v.count), count: v.count }))
        .sort((a, b) => b.avgEngagement - a.avgEngagement) as any[];

    const timeSorted = Array.from(timeMap.entries())
      .map(([hour, v]) => ({ hour, avgEngagement: Math.round(v.total / v.count), count: v.count }))
      .sort((a, b) => b.avgEngagement - a.avgEngagement);

    return {
      hooks: toSorted(hookMap, 'pattern'),
      topics: toSorted(topicMap, 'topic'),
      formats: toSorted(formatMap, 'format'),
      times: timeSorted,
      lengths: toSorted(lengthMap, 'range'),
    };
  }

  // ─── Categorize hook type ──────────────────────────────────

  private categorizeHook(hook: string): string {
    const lower = hook.toLowerCase();
    if (lower.match(/^(stop|don't|never|avoid|warning)/)) return 'negative_command';
    if (lower.match(/^(how to|here's how|the way)/)) return 'how_to';
    if (lower.match(/^(i |my |we )/)) return 'personal_story';
    if (lower.match(/^\d+ /)) return 'numbered_list';
    if (lower.match(/\?$/)) return 'question';
    if (lower.match(/^(this|these|that|the secret|the problem)/)) return 'curiosity_gap';
    if (lower.match(/^(just|breaking|update|new)/)) return 'news_update';
    if (lower.match(/^(unpopular|hot take|controversial)/)) return 'hot_take';
    if (lower.match(/thread|🧵/i)) return 'thread_hook';
    return 'other';
  }

  // ─── Build full strategy context ───────────────────────────

  buildStrategyContext(tweets: TrackedTweet[], offers: OfferContext[] = [], niches: NicheContext[] = []): StrategyContext {
    const classified = this.classifyAll(tweets);
    const tracked = classified.filter(t => t.fullyTracked);
    const patterns = this.analyzePatterns(tracked);

    const avgER = tracked.length > 0
      ? tracked.reduce((sum, t) => sum + (t.metricsFinal?.engagementRate || 0), 0) / tracked.length
      : 0;

    const best = tracked
      .filter(t => t.classification === 'viral' || t.classification === 'strong')
      .sort((a, b) => (b.engagementScore || 0) - (a.engagementScore || 0))
      .slice(0, 5)
      .map(t => ({
        text: t.text,
        engagementRate: t.metricsFinal?.engagementRate || 0,
        classification: t.classification || 'unknown',
      }));

    const worst = tracked
      .filter(t => t.classification === 'weak' || t.classification === 'flop')
      .sort((a, b) => (a.engagementScore || 0) - (b.engagementScore || 0))
      .slice(0, 5)
      .map(t => ({
        text: t.text,
        engagementRate: t.metricsFinal?.engagementRate || 0,
        classification: t.classification || 'unknown',
      }));

    // Build avoid patterns from flops
    const flops = tracked.filter(t => t.classification === 'flop');
    const avoidPatterns: string[] = [];
    const flopHooks = new Set(flops.map(f => this.categorizeHook(this.extractHook(f.text))));
    if (flopHooks.size > 0) avoidPatterns.push(`Avoid hook styles: ${[...flopHooks].join(', ')}`);

    const flopFormats = new Set(flops.map(f => f.format));
    const strongFormats = new Set(tracked.filter(t => t.classification === 'viral' || t.classification === 'strong').map(t => t.format));
    for (const ff of flopFormats) {
      if (!strongFormats.has(ff)) avoidPatterns.push(`Format "${ff}" has only produced flops`);
    }

    // Trending topics from niches
    const trending = niches.flatMap(n => n.topPerformingTopics.slice(0, 3));

    // Build prompt guidelines from everything
    const topHooks = patterns.hooks.slice(0, 3).map(h => h.pattern).join(', ');
    const topTimes = patterns.times.slice(0, 3).map(t => `${t.hour}:00`).join(', ');
    const topFormats = patterns.formats.slice(0, 2).map(f => f.format).join(', ');
    const topLengths = patterns.lengths.slice(0, 2).map(l => l.range).join(', ');

    const offerContext = offers.map(o => `${o.name}: ${o.description} (audience: ${o.targetAudience})`).join('\n');

    const promptGuidelines = [
      `Based on ${tracked.length} tracked tweets (avg ER: ${(avgER * 100).toFixed(2)}%):`,
      topHooks ? `BEST HOOKS: ${topHooks}` : '',
      topFormats ? `BEST FORMATS: ${topFormats}` : '',
      topLengths ? `BEST LENGTHS: ${topLengths}` : '',
      topTimes ? `BEST TIMES TO POST: ${topTimes}` : '',
      best.length > 0 ? `TOP TWEET EXAMPLE: "${best[0].text.substring(0, 100)}..." (ER: ${(best[0].engagementRate * 100).toFixed(2)}%)` : '',
      worst.length > 0 ? `AVOID LIKE: "${worst[0].text.substring(0, 80)}..." (flopped)` : '',
      avoidPatterns.length > 0 ? `ANTI-PATTERNS: ${avoidPatterns.join('; ')}` : '',
      offerContext ? `\nOFFERS TO PROMOTE:\n${offerContext}` : '',
      trending.length > 0 ? `TRENDING TOPICS: ${trending.join(', ')}` : '',
    ].filter(Boolean).join('\n');

    return {
      generatedAt: new Date().toISOString(),
      totalTweetsAnalyzed: tracked.length,
      avgEngagementRate: avgER,
      bestPerformingTweets: best,
      worstPerformingTweets: worst,
      winningPatterns: patterns,
      avoidPatterns,
      trendingInNiche: trending,
      promptGuidelines,
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// PromptRefiner
// ═══════════════════════════════════════════════════════════════

export class PromptRefiner {
  private config: FeedbackLoopConfig;
  private strategyFile: string;

  constructor(config: Partial<FeedbackLoopConfig> = {}) {
    this.config = { ...DEFAULT_FEEDBACK_CONFIG, ...config };
    this.strategyFile = path.join(this.config.dataDir, 'strategy-context.json');
  }

  // ─── Save strategy context ─────────────────────────────────

  saveStrategy(strategy: StrategyContext): void {
    fs.writeFileSync(this.strategyFile, JSON.stringify(strategy, null, 2));
    console.log(`[Refiner] Strategy saved (${strategy.totalTweetsAnalyzed} tweets analyzed)`);
  }

  loadStrategy(): StrategyContext | null {
    if (!fs.existsSync(this.strategyFile)) return null;
    try { return JSON.parse(fs.readFileSync(this.strategyFile, 'utf-8')); }
    catch { return null; }
  }

  // ─── Generate a tweet creation prompt ──────────────────────

  generateTweetPrompt(options: {
    niche: string;
    offer?: OfferContext;
    style?: 'educational' | 'controversial' | 'personal' | 'promotional' | 'engagement';
    strategy?: StrategyContext;
  }): string {
    const { niche, offer, style = 'educational', strategy } = options;

    let prompt = `Write a high-engagement tweet for the niche: "${niche}".\n\n`;
    prompt += `Style: ${style}\n`;
    prompt += `Character limit: 280\n\n`;

    if (strategy) {
      prompt += `=== PERFORMANCE DATA (from ${strategy.totalTweetsAnalyzed} past tweets) ===\n`;
      prompt += strategy.promptGuidelines + '\n\n';

      if (strategy.bestPerformingTweets.length > 0) {
        prompt += `=== EXAMPLES OF WINNING TWEETS ===\n`;
        for (const t of strategy.bestPerformingTweets.slice(0, 3)) {
          prompt += `"${t.text}" (ER: ${(t.engagementRate * 100).toFixed(2)}%)\n`;
        }
        prompt += '\n';
      }
    }

    if (offer) {
      prompt += `=== OFFER TO PROMOTE ===\n`;
      prompt += `Product: ${offer.name}\n`;
      prompt += `Description: ${offer.description}\n`;
      prompt += `Target audience: ${offer.targetAudience}\n`;
      prompt += `Key benefits: ${offer.keyBenefits.join(', ')}\n`;
      if (offer.url) prompt += `Link: ${offer.url}\n`;
      if (offer.hashtags) prompt += `Hashtags: ${offer.hashtags.join(' ')}\n`;
      prompt += '\n';
    }

    prompt += `=== REQUIREMENTS ===\n`;
    prompt += `- Start with a strong hook (first 5 words must grab attention)\n`;
    prompt += `- Be specific and concrete (no vague platitudes)\n`;
    prompt += `- Include a clear CTA at the end\n`;
    prompt += `- Sound natural, not like a bot\n`;
    prompt += `- Optimize for engagement (replies > likes > retweets)\n`;

    if (strategy?.avoidPatterns.length) {
      prompt += `\n=== AVOID ===\n`;
      for (const ap of strategy.avoidPatterns) {
        prompt += `- ${ap}\n`;
      }
    }

    return prompt;
  }
}

// ═══════════════════════════════════════════════════════════════
// TwitterFeedbackLoop — Full Closed Loop Orchestrator
// ═══════════════════════════════════════════════════════════════

export class TwitterFeedbackLoop {
  public tracker: TweetPerformanceTracker;
  public analyzer: EngagementAnalyzer;
  public refiner: PromptRefiner;
  private config: FeedbackLoopConfig;
  private offers: OfferContext[] = [];
  private niches: NicheContext[] = [];
  private offersFile: string;
  private nichesFile: string;

  constructor(config: Partial<FeedbackLoopConfig> = {}) {
    this.config = { ...DEFAULT_FEEDBACK_CONFIG, ...config };
    this.tracker = new TweetPerformanceTracker(config);
    this.analyzer = new EngagementAnalyzer(config);
    this.refiner = new PromptRefiner(config);

    this.offersFile = path.join(this.config.dataDir, 'offers.json');
    this.nichesFile = path.join(this.config.dataDir, 'niches.json');

    this.loadOffers();
    this.loadNiches();
  }

  // ─── Offer & niche management ──────────────────────────────

  private loadOffers(): void {
    if (fs.existsSync(this.offersFile)) {
      try { this.offers = JSON.parse(fs.readFileSync(this.offersFile, 'utf-8')); } catch {}
    }
  }

  private loadNiches(): void {
    if (fs.existsSync(this.nichesFile)) {
      try { this.niches = JSON.parse(fs.readFileSync(this.nichesFile, 'utf-8')); } catch {}
    }
  }

  setOffers(offers: OfferContext[]): void {
    this.offers = offers;
    fs.writeFileSync(this.offersFile, JSON.stringify(offers, null, 2));
  }

  setNiches(niches: NicheContext[]): void {
    this.niches = niches;
    fs.writeFileSync(this.nichesFile, JSON.stringify(niches, null, 2));
  }

  getOffers(): OfferContext[] { return [...this.offers]; }
  getNiches(): NicheContext[] { return [...this.niches]; }

  // ─── Step 1: Register a posted tweet ───────────────────────

  registerPostedTweet(tweetUrl: string, text: string, niche: string, offer = ''): TrackedTweet {
    const hook = this.analyzer.extractHook(text);
    const cta = this.analyzer.extractCTA(text);
    const hashtags = (text.match(/#\w+/g) || []);
    const format: TrackedTweet['format'] = text.includes('🧵') ? 'thread' : 'text';

    return this.tracker.registerTweet({
      id: `tw_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      tweetUrl,
      text,
      postedAt: new Date().toISOString(),
      niche,
      offer,
      hooks: [hook],
      cta,
      format,
      hashtags,
    });
  }

  // ─── Step 2: Run scheduled check-backs ─────────────────────

  async runCheckBacks(): Promise<{ checked: number; results: TrackedTweet[] }> {
    return this.tracker.runAllCheckBacks();
  }

  // ─── Step 3: Analyze & classify ────────────────────────────

  analyze(): StrategyContext {
    const tweets = this.tracker.getAllTweets();
    const strategy = this.analyzer.buildStrategyContext(tweets, this.offers, this.niches);

    // Classify tweets
    this.analyzer.classifyAll(tweets);

    // Save strategy
    this.refiner.saveStrategy(strategy);

    console.log(`[Loop] Strategy updated: ${strategy.totalTweetsAnalyzed} tweets, avg ER: ${(strategy.avgEngagementRate * 100).toFixed(2)}%`);
    return strategy;
  }

  // ─── Step 4: Generate optimized tweet prompt ───────────────

  generateTweetPrompt(niche: string, options: {
    offer?: OfferContext;
    style?: 'educational' | 'controversial' | 'personal' | 'promotional' | 'engagement';
  } = {}): string {
    const strategy = this.refiner.loadStrategy() || undefined;
    const offer = options.offer || this.offers.find(o =>
      o.name.toLowerCase().includes(niche.toLowerCase()) ||
      o.targetAudience.toLowerCase().includes(niche.toLowerCase())
    );

    return this.refiner.generateTweetPrompt({
      niche,
      offer,
      style: options.style,
      strategy,
    });
  }

  // ─── Full cycle: check → analyze → generate ───────────────

  async runCycle(niche: string, options: {
    offer?: OfferContext;
    style?: 'educational' | 'controversial' | 'personal' | 'promotional' | 'engagement';
  } = {}): Promise<{
    checkBackResults: { checked: number };
    strategy: StrategyContext;
    nextTweetPrompt: string;
  }> {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`[Loop] Running feedback cycle for niche: "${niche}"`);
    console.log(`${'═'.repeat(60)}\n`);

    // Step 1: Run any due check-backs
    console.log('[Loop] Step 1: Running check-backs...');
    const checkBackResults = await this.runCheckBacks();
    console.log(`[Loop] Step 1 complete: ${checkBackResults.checked} tweets checked\n`);

    // Step 2: Analyze and classify
    console.log('[Loop] Step 2: Analyzing performance...');
    const strategy = this.analyze();
    console.log(`[Loop] Step 2 complete: strategy updated\n`);

    // Step 3: Generate next tweet prompt
    console.log('[Loop] Step 3: Generating optimized prompt...');
    const nextTweetPrompt = this.generateTweetPrompt(niche, options);
    console.log(`[Loop] Step 3 complete: prompt generated\n`);

    console.log(`${'═'.repeat(60)}`);
    console.log(`[Loop] Cycle complete`);
    console.log(`${'═'.repeat(60)}\n`);

    return { checkBackResults: { checked: checkBackResults.checked }, strategy, nextTweetPrompt };
  }

  // ─── Get complete system status ────────────────────────────

  getStatus(): Record<string, any> {
    const strategy = this.refiner.loadStrategy();
    return {
      tracker: this.tracker.getStats(),
      strategy: strategy ? {
        generatedAt: strategy.generatedAt,
        totalTweetsAnalyzed: strategy.totalTweetsAnalyzed,
        avgEngagementRate: strategy.avgEngagementRate,
        topHook: strategy.winningPatterns.hooks[0] || null,
        topFormat: strategy.winningPatterns.formats[0] || null,
        topTime: strategy.winningPatterns.times[0] || null,
      } : null,
      offers: this.offers.length,
      niches: this.niches.length,
      config: {
        checkBackPeriods: this.config.checkBackPeriods.map(p => `${p / 3600000}hr`),
        maxHistory: this.config.maxHistorySize,
      },
    };
  }
}
