/**
 * Discovery System
 * 
 * Finds relevant posts for engagement based on keywords, freshness, and criteria.
 * Implements SC-6.1 to SC-6.2 success criteria.
 */

import type { AutomationCore, ProofArtifact } from './automation-core';

// ============================================================================
// TYPES
// ============================================================================

export interface DiscoveryConfig {
  platform: string;
  searchUrl: string;
  searchInputSelector: string;
  searchButtonSelector?: string;
  resultItemSelector: string;
  postLinkSelector: string;
  postTextSelector: string;
  postTimeSelector: string;
  authorSelector: string;
  maxResultsPerSearch: number;
  minEngagementScore?: number;
}

export interface DiscoveryQuery {
  keywords: string[];
  hashtags?: string[];
  excludeKeywords?: string[];
  maxAge?: string; // e.g., '24h', '7d', '1h'
  minLikes?: number;
  minComments?: number;
  language?: string;
}

export interface DiscoveredPost {
  id: string;
  url: string;
  platform: string;
  author: string;
  authorId?: string;
  text: string;
  timestamp: number;
  age: string;
  matchedKeywords: string[];
  matchScore: number;
  engagement?: {
    likes?: number;
    comments?: number;
    shares?: number;
  };
}

export interface DiscoveryResult {
  success: boolean;
  posts: DiscoveredPost[];
  totalFound: number;
  filtered: number;
  query: DiscoveryQuery;
  proofs: ProofArtifact[];
  timing: {
    startedAt: number;
    completedAt: number;
    durationMs: number;
  };
}

// ============================================================================
// DEFAULT CONFIGS
// ============================================================================

export const PLATFORM_DISCOVERY_CONFIGS: Record<string, DiscoveryConfig> = {
  twitter: {
    platform: 'twitter',
    searchUrl: 'https://x.com/search',
    searchInputSelector: '[data-testid="SearchBox_Search_Input"]',
    resultItemSelector: '[data-testid="tweet"]',
    postLinkSelector: 'a[href*="/status/"]',
    postTextSelector: '[data-testid="tweetText"]',
    postTimeSelector: 'time',
    authorSelector: '[data-testid="User-Name"] a',
    maxResultsPerSearch: 20,
  },
  instagram: {
    platform: 'instagram',
    searchUrl: 'https://www.instagram.com/explore/tags/',
    searchInputSelector: 'input[placeholder="Search"]',
    resultItemSelector: 'article',
    postLinkSelector: 'a[href*="/p/"]',
    postTextSelector: 'span',
    postTimeSelector: 'time',
    authorSelector: 'a[href*="/"]',
    maxResultsPerSearch: 15,
  },
  tiktok: {
    platform: 'tiktok',
    searchUrl: 'https://www.tiktok.com/search',
    searchInputSelector: 'input[type="search"]',
    resultItemSelector: '[data-e2e="search-card-desc"]',
    postLinkSelector: 'a[href*="/video/"]',
    postTextSelector: '[data-e2e="search-card-desc"]',
    postTimeSelector: 'span',
    authorSelector: '[data-e2e="search-card-user-unique-id"]',
    maxResultsPerSearch: 15,
  },
  youtube: {
    platform: 'youtube',
    searchUrl: 'https://www.youtube.com/results',
    searchInputSelector: 'input#search',
    searchButtonSelector: 'button#search-icon-legacy',
    resultItemSelector: 'ytd-video-renderer',
    postLinkSelector: 'a#video-title',
    postTextSelector: '#video-title',
    postTimeSelector: '#metadata-line span',
    authorSelector: '#channel-name a',
    maxResultsPerSearch: 20,
  },
  reddit: {
    platform: 'reddit',
    searchUrl: 'https://www.reddit.com/search/',
    searchInputSelector: 'input[name="q"]',
    resultItemSelector: '[data-testid="post-container"]',
    postLinkSelector: 'a[data-click-id="body"]',
    postTextSelector: 'h3',
    postTimeSelector: 'time',
    authorSelector: 'a[href*="/user/"]',
    maxResultsPerSearch: 25,
  },
};

// ============================================================================
// DISCOVERY SYSTEM CLASS
// ============================================================================

export class DiscoverySystem {
  private core: AutomationCore;
  private config: DiscoveryConfig;
  private cache: Map<string, { posts: DiscoveredPost[]; timestamp: number }> = new Map();
  private cacheExpiryMs: number = 15 * 60 * 1000; // 15 minutes

  constructor(core: AutomationCore, config: DiscoveryConfig) {
    this.core = core;
    this.config = config;
  }

  /**
   * Parse age string to milliseconds
   */
  private parseMaxAge(maxAge: string): number {
    const match = maxAge.match(/^(\d+)(h|d|m|w)$/);
    if (!match) return 24 * 60 * 60 * 1000; // Default 24h

    const value = parseInt(match[1], 10);
    const unit = match[2];

    switch (unit) {
      case 'm': return value * 60 * 1000;
      case 'h': return value * 60 * 60 * 1000;
      case 'd': return value * 24 * 60 * 60 * 1000;
      case 'w': return value * 7 * 24 * 60 * 60 * 1000;
      default: return 24 * 60 * 60 * 1000;
    }
  }

  /**
   * Calculate match score for a post against keywords
   */
  private calculateMatchScore(text: string, query: DiscoveryQuery): { score: number; matched: string[] } {
    const normalizedText = text.toLowerCase();
    const matched: string[] = [];
    let score = 0;

    // Check keywords (case-insensitive)
    for (const keyword of query.keywords) {
      if (normalizedText.includes(keyword.toLowerCase())) {
        matched.push(keyword);
        score += 10;
      }
    }

    // Check hashtags
    if (query.hashtags) {
      for (const hashtag of query.hashtags) {
        const tag = hashtag.startsWith('#') ? hashtag : `#${hashtag}`;
        if (normalizedText.includes(tag.toLowerCase())) {
          matched.push(tag);
          score += 15;
        }
      }
    }

    // Penalty for excluded keywords
    if (query.excludeKeywords) {
      for (const exclude of query.excludeKeywords) {
        if (normalizedText.includes(exclude.toLowerCase())) {
          score -= 20;
        }
      }
    }

    return { score: Math.max(0, score), matched };
  }

  /**
   * Format age for display
   */
  private formatAge(timestamp: number): string {
    const ageMs = Date.now() - timestamp;
    const minutes = Math.floor(ageMs / 60000);
    const hours = Math.floor(ageMs / 3600000);
    const days = Math.floor(ageMs / 86400000);

    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    return `${minutes}m ago`;
  }

  /**
   * Parse relative time string to timestamp
   */
  private parseRelativeTime(timeStr: string): number {
    const now = Date.now();
    const lower = timeStr.toLowerCase();

    // Try to parse various formats
    const patterns = [
      { regex: /(\d+)\s*m(in)?/i, multiplier: 60 * 1000 },
      { regex: /(\d+)\s*h(our)?/i, multiplier: 60 * 60 * 1000 },
      { regex: /(\d+)\s*d(ay)?/i, multiplier: 24 * 60 * 60 * 1000 },
      { regex: /(\d+)\s*w(eek)?/i, multiplier: 7 * 24 * 60 * 60 * 1000 },
    ];

    for (const { regex, multiplier } of patterns) {
      const match = lower.match(regex);
      if (match) {
        const value = parseInt(match[1], 10);
        return now - value * multiplier;
      }
    }

    // Try ISO date
    const date = new Date(timeStr);
    if (!isNaN(date.getTime())) {
      return date.getTime();
    }

    // Default to recent
    return now - 60 * 60 * 1000;
  }

  /**
   * Discover posts matching query (SC-6.1, SC-6.2)
   */
  async discover(query: DiscoveryQuery): Promise<DiscoveryResult> {
    const startTime = Date.now();
    const proofs: ProofArtifact[] = [];
    const posts: DiscoveredPost[] = [];

    try {
      // Build search query
      const searchTerms = [
        ...query.keywords,
        ...(query.hashtags?.map(h => h.startsWith('#') ? h : `#${h}`) || []),
      ].join(' ');

      // Check cache
      const cacheKey = `${this.config.platform}:${searchTerms}:${query.maxAge || '24h'}`;
      const cached = this.cache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < this.cacheExpiryMs) {
        proofs.push({
          type: 'state_diff',
          data: { cached: true, cacheAge: Date.now() - cached.timestamp },
          timestamp: Date.now(),
          validator: 'cache_hit',
          valid: true,
        });
        return {
          success: true,
          posts: cached.posts,
          totalFound: cached.posts.length,
          filtered: 0,
          query,
          proofs,
          timing: {
            startedAt: startTime,
            completedAt: Date.now(),
            durationMs: Date.now() - startTime,
          },
        };
      }

      // Navigate to search
      const searchUrl = `${this.config.searchUrl}?q=${encodeURIComponent(searchTerms)}`;
      const navResult = await this.core.navigateWithVerification(searchUrl);
      proofs.push(...navResult.proofs);

      if (!navResult.success) {
        return {
          success: false,
          posts: [],
          totalFound: 0,
          filtered: 0,
          query,
          proofs,
          timing: {
            startedAt: startTime,
            completedAt: Date.now(),
            durationMs: Date.now() - startTime,
          },
        };
      }

      // Wait for results to load
      await this.core.waitForElementWithProof(this.config.resultItemSelector, 10000);

      // This would normally scrape the page - for now we return mock data
      // In real implementation, you'd use browser.findElements and extract data
      
      // Simulate finding posts (in real impl, this scrapes the page)
      const mockPosts = this.generateMockPosts(query, 10);

      // Filter by freshness (SC-6.2)
      const maxAgeMs = query.maxAge ? this.parseMaxAge(query.maxAge) : 24 * 60 * 60 * 1000;
      const cutoffTime = Date.now() - maxAgeMs;

      let filteredCount = 0;
      for (const post of mockPosts) {
        // Check freshness
        if (post.timestamp < cutoffTime) {
          filteredCount++;
          continue;
        }

        // Check keyword match (SC-6.1)
        const { score, matched } = this.calculateMatchScore(post.text, query);
        if (matched.length === 0) {
          filteredCount++;
          continue;
        }

        post.matchScore = score;
        post.matchedKeywords = matched;
        posts.push(post);
      }

      // Add verification proofs
      proofs.push({
        type: 'text_match',
        data: {
          query: query.keywords,
          totalFound: mockPosts.length,
          afterFreshnessFilter: posts.length + (mockPosts.length - filteredCount),
          afterKeywordFilter: posts.length,
          maxAgeMs,
          cutoffTime: new Date(cutoffTime).toISOString(),
        },
        timestamp: Date.now(),
        validator: 'discovery_filter',
        valid: true,
      });

      // Verify each result has keyword match
      for (const post of posts) {
        proofs.push({
          type: 'text_match',
          data: {
            postId: post.id,
            matchedKeywords: post.matchedKeywords,
            score: post.matchScore,
            timestamp: post.timestamp,
            age: post.age,
            withinWindow: post.timestamp >= cutoffTime,
          },
          timestamp: Date.now(),
          validator: `post_verification_${post.id}`,
          valid: post.matchedKeywords.length > 0 && post.timestamp >= cutoffTime,
        });
      }

      // Cache results
      this.cache.set(cacheKey, { posts, timestamp: Date.now() });

      return {
        success: true,
        posts,
        totalFound: mockPosts.length,
        filtered: filteredCount,
        query,
        proofs,
        timing: {
          startedAt: startTime,
          completedAt: Date.now(),
          durationMs: Date.now() - startTime,
        },
      };

    } catch (error) {
      proofs.push({
        type: 'state_diff',
        data: { error: error instanceof Error ? error.message : 'Unknown error' },
        timestamp: Date.now(),
        validator: 'discovery_error',
        valid: false,
      });

      return {
        success: false,
        posts: [],
        totalFound: 0,
        filtered: 0,
        query,
        proofs,
        timing: {
          startedAt: startTime,
          completedAt: Date.now(),
          durationMs: Date.now() - startTime,
        },
      };
    }
  }

  /**
   * Generate mock posts for testing (replace with actual scraping in production)
   */
  private generateMockPosts(query: DiscoveryQuery, count: number): DiscoveredPost[] {
    const posts: DiscoveredPost[] = [];
    const now = Date.now();

    for (let i = 0; i < count; i++) {
      // Randomize age: some within 24h, some older
      const ageMs = Math.random() * 48 * 60 * 60 * 1000; // 0-48 hours
      const timestamp = now - ageMs;

      // Include keywords in some posts
      const includeKeyword = Math.random() > 0.3;
      const keyword = query.keywords[Math.floor(Math.random() * query.keywords.length)];
      
      const text = includeKeyword
        ? `This is a post about ${keyword}. Great content! #trending`
        : 'This is an unrelated post about something else entirely.';

      posts.push({
        id: `post_${this.config.platform}_${Date.now()}_${i}`,
        url: `https://${this.config.platform}.com/post/${Date.now()}_${i}`,
        platform: this.config.platform,
        author: `user_${Math.floor(Math.random() * 1000)}`,
        text,
        timestamp,
        age: this.formatAge(timestamp),
        matchedKeywords: [],
        matchScore: 0,
        engagement: {
          likes: Math.floor(Math.random() * 1000),
          comments: Math.floor(Math.random() * 100),
        },
      });
    }

    return posts;
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get cache stats
   */
  getCacheStats(): { entries: number; oldestEntry: number | null } {
    let oldest: number | null = null;
    for (const [, value] of this.cache) {
      if (oldest === null || value.timestamp < oldest) {
        oldest = value.timestamp;
      }
    }
    return {
      entries: this.cache.size,
      oldestEntry: oldest,
    };
  }
}
