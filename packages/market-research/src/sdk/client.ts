/**
 * Market Research SDK Client
 *
 * TypeScript client for the Market Research API (port 3106).
 * Import this into any Node.js server to consume research + feedback loop.
 *
 * Usage:
 *   import { ResearchClient } from '@safari-automation/market-research/sdk';
 *
 *   const client = new ResearchClient({ baseUrl: 'http://localhost:3106', apiKey: 'your-key' });
 *
 *   // Search
 *   const results = await client.search('tiktok', 'AI automation');
 *
 *   // Feedback loop
 *   await client.registerTweet('https://x.com/you/status/123', 'My tweet text', 'indie hacking');
 *   const strategy = await client.getStrategy();
 *   const prompt = await client.generatePrompt('indie hacking', 'educational');
 *
 *   // Webhooks
 *   await client.registerWebhook('https://myserver.com/webhook', ['strategy.updated']);
 */

// ─── Types ───────────────────────────────────────────────────────

export interface ClientConfig {
  baseUrl: string;
  apiKey?: string;
  timeout?: number;
}

export interface TweetMetrics {
  likes: number;
  retweets: number;
  replies: number;
  quotes: number;
  bookmarks: number;
  views: number;
  engagementRate: number;
  collectedAt: string;
}

export interface TrackedTweet {
  id: string;
  tweetUrl: string;
  text: string;
  postedAt: string;
  niche: string;
  offer: string;
  hooks: string[];
  cta: string;
  format: string;
  hashtags: string[];
  metrics1hr?: TweetMetrics;
  metrics4hr?: TweetMetrics;
  metrics24hr?: TweetMetrics;
  metricsFinal?: TweetMetrics;
  classification?: string;
  engagementScore?: number;
  velocityScore?: number;
  nextCheckAt?: string;
  checksCompleted: number;
  fullyTracked: boolean;
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

export interface WebhookInfo {
  id: string;
  url: string;
  events: string[];
  createdAt: string;
  lastDelivery?: string;
  failCount: number;
}

export interface ResearchJob {
  jobId: string;
  status: string;
  platform: string;
}

// ─── Client ──────────────────────────────────────────────────────

export class ResearchClient {
  private baseUrl: string;
  private apiKey: string;
  private timeout: number;

  constructor(config: ClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.apiKey = config.apiKey || '';
    this.timeout = config.timeout || 30000;
  }

  private async request<T = any>(method: string, path: string, body?: any): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers['X-API-Key'] = this.apiKey;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const res = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      return data as T;
    } finally {
      clearTimeout(timer);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Health
  // ═══════════════════════════════════════════════════════════════

  async health(): Promise<any> {
    return this.request('GET', '/health');
  }

  // ═══════════════════════════════════════════════════════════════
  // Research
  // ═══════════════════════════════════════════════════════════════

  async platforms(): Promise<any> {
    return this.request('GET', '/api/research/platforms');
  }

  async search(platform: string, query: string, config?: any): Promise<any> {
    return this.request('POST', `/api/research/${platform}/search`, { query, config });
  }

  async researchNiche(platform: string, niche: string, config?: any): Promise<ResearchJob> {
    return this.request('POST', `/api/research/${platform}/niche`, { niche, config });
  }

  async researchFull(platform: string, niches: string[], config?: any): Promise<ResearchJob> {
    return this.request('POST', `/api/research/${platform}/full`, { niches, config });
  }

  async researchAllPlatforms(niches: string[], platforms?: string[], config?: any): Promise<ResearchJob> {
    return this.request('POST', '/api/research/all/full', { niches, platforms, config });
  }

  async jobStatus(jobId?: string): Promise<any> {
    return this.request('GET', jobId ? `/api/research/status/${jobId}` : '/api/research/status');
  }

  async results(platform?: string): Promise<any> {
    return this.request('GET', `/api/research/results${platform ? `?platform=${platform}` : ''}`);
  }

  async latestResults(platform: string): Promise<any> {
    return this.request('GET', `/api/research/results/latest/${platform}`);
  }

  // ═══════════════════════════════════════════════════════════════
  // Feedback Loop
  // ═══════════════════════════════════════════════════════════════

  async feedbackStatus(): Promise<any> {
    return this.request('GET', '/api/feedback/status');
  }

  async registerTweet(tweetUrl: string, text: string, niche = 'general', offer = ''): Promise<{ success: boolean; tweet: TrackedTweet }> {
    return this.request('POST', '/api/feedback/register', { tweetUrl, text, niche, offer });
  }

  async registerTweetBatch(tweets: Array<{ tweetUrl: string; text: string; niche?: string; offer?: string }>): Promise<any> {
    return this.request('POST', '/api/feedback/register/batch', { tweets });
  }

  async runCheckBacks(): Promise<{ checked: number; results: TrackedTweet[] }> {
    return this.request('POST', '/api/feedback/check-backs');
  }

  async extractMetrics(tweetUrl: string): Promise<{ success: boolean; metrics: TweetMetrics | null }> {
    return this.request('POST', '/api/feedback/metrics', { tweetUrl });
  }

  async analyze(): Promise<{ success: boolean; strategy: StrategyContext }> {
    return this.request('POST', '/api/feedback/analyze');
  }

  async getStrategy(): Promise<StrategyContext> {
    return this.request('GET', '/api/feedback/strategy');
  }

  async generatePrompt(niche: string, style?: string, offer?: OfferContext): Promise<{ prompt: string }> {
    return this.request('POST', '/api/feedback/generate-prompt', { niche, style, offer });
  }

  async runCycle(niche: string, style?: string, offer?: OfferContext): Promise<{
    checkBackResults: { checked: number };
    strategy: StrategyContext;
    nextTweetPrompt: string;
  }> {
    return this.request('POST', '/api/feedback/cycle', { niche, style, offer });
  }

  async setOffers(offers: OfferContext[]): Promise<{ success: boolean; count: number }> {
    return this.request('POST', '/api/feedback/offers', { offers });
  }

  async getOffers(): Promise<{ offers: OfferContext[] }> {
    return this.request('GET', '/api/feedback/offers');
  }

  async setNiches(niches: NicheContext[]): Promise<{ success: boolean; count: number }> {
    return this.request('POST', '/api/feedback/niches', { niches });
  }

  async getNiches(): Promise<{ niches: NicheContext[] }> {
    return this.request('GET', '/api/feedback/niches');
  }

  async listTweets(filters?: { classification?: string; status?: string }): Promise<{ tweets: TrackedTweet[]; count: number }> {
    const params = new URLSearchParams();
    if (filters?.classification) params.set('classification', filters.classification);
    if (filters?.status) params.set('status', filters.status);
    const qs = params.toString();
    return this.request('GET', `/api/feedback/tweets${qs ? '?' + qs : ''}`);
  }

  async getDueTweets(): Promise<{ due: TrackedTweet[]; count: number }> {
    return this.request('GET', '/api/feedback/due');
  }

  // ═══════════════════════════════════════════════════════════════
  // Webhooks
  // ═══════════════════════════════════════════════════════════════

  async listWebhooks(): Promise<{ webhooks: WebhookInfo[] }> {
    return this.request('GET', '/api/webhooks');
  }

  async registerWebhook(url: string, events: string[] = ['*'], secret?: string): Promise<{ success: boolean; webhook: WebhookInfo }> {
    return this.request('POST', '/api/webhooks', { url, events, secret });
  }

  async deleteWebhook(id: string): Promise<{ success: boolean }> {
    return this.request('DELETE', `/api/webhooks/${id}`);
  }

  async testWebhook(url: string): Promise<{ success: boolean }> {
    return this.request('POST', '/api/webhooks/test', { url });
  }

  // ═══════════════════════════════════════════════════════════════
  // Auto-Scheduler
  // ═══════════════════════════════════════════════════════════════

  async schedulerStatus(): Promise<any> {
    return this.request('GET', '/api/scheduler/status');
  }

  async startScheduler(): Promise<any> {
    return this.request('POST', '/api/scheduler/start');
  }

  async stopScheduler(): Promise<any> {
    return this.request('POST', '/api/scheduler/stop');
  }

  async triggerScheduler(): Promise<any> {
    return this.request('POST', '/api/scheduler/trigger');
  }
}
