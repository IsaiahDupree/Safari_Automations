/**
 * Post Discovery Service
 * 
 * Discovers trending posts across platforms for commenting.
 */

import type { CommentPlatform, PostTarget } from '../comment-engine/types';
import type { 
  DiscoveryConfig, 
  DiscoveredPost, 
  DiscoverySource, 
  DiscoveryFilter 
} from './types';
import { DEFAULT_DISCOVERY_CONFIG } from './types';

// JavaScript snippets for scraping posts from each platform
const SCRAPE_JS = {
  instagram: {
    feed: `
      (function() {
        var posts = [];
        var articles = document.querySelectorAll('article');
        
        articles.forEach(function(article, i) {
          if (i < 10) {
            var userLink = article.querySelector('a[href^="/"][href$="/"]');
            var username = '';
            if (userLink) {
              var match = userLink.href.match(/instagram\\.com\\/([^\\/\\?]+)/);
              username = match ? match[1] : '';
            }
            
            var postLink = article.querySelector('a[href*="/p/"], a[href*="/reel/"]');
            var postUrl = postLink ? postLink.href : '';
            
            var captionEl = article.querySelector('span[dir="auto"]');
            var caption = captionEl ? captionEl.innerText.substring(0, 200) : '';
            
            if (postUrl && username) {
              posts.push({
                postId: postUrl.split('/p/')[1]?.split('/')[0] || postUrl.split('/reel/')[1]?.split('/')[0],
                postUrl: postUrl,
                username: username,
                caption: caption
              });
            }
          }
        });
        
        return JSON.stringify(posts);
      })();
    `,
    explore: `
      (function() {
        var posts = [];
        var links = document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]');
        
        links.forEach(function(link, i) {
          if (i < 20) {
            var postUrl = link.href;
            var postId = postUrl.split('/p/')[1]?.split('/')[0] || postUrl.split('/reel/')[1]?.split('/')[0];
            
            if (postId && !posts.find(p => p.postId === postId)) {
              posts.push({
                postId: postId,
                postUrl: postUrl,
                username: '',
                caption: ''
              });
            }
          }
        });
        
        return JSON.stringify(posts);
      })();
    `,
  },
  
  twitter: {
    feed: `
      (function() {
        var posts = [];
        var tweets = document.querySelectorAll('article[data-testid="tweet"]');
        
        tweets.forEach(function(tweet, i) {
          if (i < 10) {
            var link = tweet.querySelector('a[href*="/status/"]');
            var postUrl = link ? link.href : '';
            
            var userLink = tweet.querySelector('a[href^="/"][role="link"]');
            var username = userLink ? userLink.href.split('/').pop() : '';
            
            var textEl = tweet.querySelector('[data-testid="tweetText"]');
            var caption = textEl ? textEl.innerText.substring(0, 200) : '';
            
            if (postUrl) {
              var postId = postUrl.split('/status/')[1]?.split('?')[0];
              posts.push({
                postId: postId,
                postUrl: postUrl,
                username: username,
                caption: caption
              });
            }
          }
        });
        
        return JSON.stringify(posts);
      })();
    `,
  },
  
  tiktok: {
    feed: `
      (function() {
        var posts = [];
        var videos = document.querySelectorAll('[data-e2e="recommend-list-item-container"]');
        
        videos.forEach(function(video, i) {
          if (i < 10) {
            var link = video.querySelector('a[href*="/@"]');
            if (link) {
              var postUrl = link.href;
              var match = postUrl.match(/\\/@([^\\/]+)\\/video\\/(\\d+)/);
              
              if (match) {
                var descEl = video.querySelector('[data-e2e="video-desc"]');
                posts.push({
                  postId: match[2],
                  postUrl: postUrl,
                  username: match[1],
                  caption: descEl ? descEl.innerText.substring(0, 200) : ''
                });
              }
            }
          }
        });
        
        return JSON.stringify(posts);
      })();
    `,
  },
  
  threads: {
    feed: `
      (function() {
        var posts = [];
        var containers = document.querySelectorAll('[data-pressable-container="true"]');
        
        containers.forEach(function(container, i) {
          if (i < 10) {
            var userLink = container.querySelector('a[href*="/@"]');
            var username = userLink ? userLink.href.split('/@').pop().split('/')[0] : '';
            
            var postLink = container.querySelector('a[href*="/post/"]');
            var postUrl = postLink ? postLink.href : '';
            
            var textEl = container.querySelector('[dir="auto"] span');
            var caption = textEl ? textEl.innerText.substring(0, 200) : '';
            
            if (postUrl && username) {
              var match = postUrl.match(/\\/post\\/([A-Za-z0-9_-]+)/);
              posts.push({
                postId: match ? match[1] : '',
                postUrl: postUrl,
                username: username,
                caption: caption
              });
            }
          }
        });
        
        return JSON.stringify(posts);
      })();
    `,
  },
};

const PLATFORM_URLS: Record<CommentPlatform, Record<DiscoverySource, string>> = {
  instagram: {
    feed: 'https://www.instagram.com/',
    explore: 'https://www.instagram.com/explore/',
    hashtag: 'https://www.instagram.com/explore/tags/',
    profile: 'https://www.instagram.com/',
    trending: 'https://www.instagram.com/explore/',
  },
  twitter: {
    feed: 'https://x.com/home',
    explore: 'https://x.com/explore',
    hashtag: 'https://x.com/search?q=',
    profile: 'https://x.com/',
    trending: 'https://x.com/explore/tabs/trending',
  },
  tiktok: {
    feed: 'https://www.tiktok.com/foryou',
    explore: 'https://www.tiktok.com/explore',
    hashtag: 'https://www.tiktok.com/tag/',
    profile: 'https://www.tiktok.com/@',
    trending: 'https://www.tiktok.com/explore',
  },
  threads: {
    feed: 'https://www.threads.net/',
    explore: 'https://www.threads.net/search',
    hashtag: 'https://www.threads.net/search?q=',
    profile: 'https://www.threads.net/@',
    trending: 'https://www.threads.net/',
  },
};

export class PostDiscoveryService {
  private config: DiscoveryConfig;
  private seenPosts: Map<string, Date> = new Map();
  private lastDiscovery: Map<CommentPlatform, Date> = new Map();

  // Callback for executing JS in Safari
  private executeJS?: (code: string) => Promise<string | null>;
  private navigateTo?: (url: string) => Promise<boolean>;

  constructor(config: Partial<DiscoveryConfig> = {}) {
    this.config = { ...DEFAULT_DISCOVERY_CONFIG, ...config };
  }

  /**
   * Set Safari executor callbacks
   */
  setExecutor(
    executeJS: (code: string) => Promise<string | null>,
    navigateTo: (url: string) => Promise<boolean>
  ): void {
    this.executeJS = executeJS;
    this.navigateTo = navigateTo;
  }

  /**
   * Discover posts from a platform
   */
  async discoverPosts(
    platform: CommentPlatform,
    source: DiscoverySource = 'feed'
  ): Promise<DiscoveredPost[]> {
    if (!this.executeJS || !this.navigateTo) {
      throw new Error('Safari executor not set. Call setExecutor first.');
    }

    // Check cooldown
    const lastRun = this.lastDiscovery.get(platform);
    if (lastRun) {
      const cooldownMs = this.config.cooldownMinutes * 60 * 1000;
      if (Date.now() - lastRun.getTime() < cooldownMs) {
        console.log(`Cooldown active for ${platform}, skipping discovery`);
        return [];
      }
    }

    const url = PLATFORM_URLS[platform]?.[source];
    if (!url) {
      console.warn(`No URL for ${platform}/${source}`);
      return [];
    }

    // Navigate to platform
    const navSuccess = await this.navigateTo(url);
    if (!navSuccess) {
      console.error(`Failed to navigate to ${url}`);
      return [];
    }

    // Wait for page load
    await this.wait(3000);

    // Scroll to load more content
    await this.executeJS('window.scrollBy(0, window.innerHeight)');
    await this.wait(1500);

    // Get scrape script
    const scrapeScript = (SCRAPE_JS as Record<string, Record<string, string>>)[platform]?.[source];
    if (!scrapeScript) {
      console.warn(`No scrape script for ${platform}/${source}`);
      return [];
    }

    // Execute scrape
    const result = await this.executeJS(scrapeScript);
    if (!result) {
      console.error(`Scrape failed for ${platform}`);
      return [];
    }

    // Parse results
    let rawPosts: Array<{
      postId: string;
      postUrl: string;
      username: string;
      caption: string;
    }>;

    try {
      rawPosts = JSON.parse(result);
    } catch {
      console.error(`Failed to parse scrape result for ${platform}`);
      return [];
    }

    // Convert to DiscoveredPost and filter
    const posts: DiscoveredPost[] = [];
    
    for (const raw of rawPosts) {
      // Skip if already seen
      const dedupeKey = `${platform}:${raw.postId}`;
      if (this.seenPosts.has(dedupeKey)) {
        continue;
      }

      // Apply filters
      if (this.config.filter.excludeUsernames?.includes(raw.username)) {
        continue;
      }

      const post: DiscoveredPost = {
        platform,
        postId: raw.postId,
        postUrl: raw.postUrl,
        authorUsername: raw.username,
        caption: raw.caption,
        discoveredAt: new Date(),
        source,
        score: this.calculateScore(raw),
        alreadyCommented: false,
      };

      posts.push(post);
      this.seenPosts.set(dedupeKey, new Date());

      if (posts.length >= this.config.maxPostsPerRun) {
        break;
      }
    }

    this.lastDiscovery.set(platform, new Date());
    this.cleanupSeenPosts();

    console.log(`Discovered ${posts.length} posts from ${platform}/${source}`);
    return posts;
  }

  /**
   * Discover posts from all configured platforms
   */
  async discoverAll(): Promise<DiscoveredPost[]> {
    const allPosts: DiscoveredPost[] = [];

    for (const platform of this.config.platforms) {
      for (const source of this.config.sources) {
        try {
          const posts = await this.discoverPosts(platform, source);
          allPosts.push(...posts);
        } catch (error) {
          console.error(`Discovery error for ${platform}/${source}:`, error);
        }
      }
    }

    // Sort by score
    allPosts.sort((a, b) => b.score - a.score);

    return allPosts;
  }

  /**
   * Calculate engagement potential score
   */
  private calculateScore(post: { username: string; caption: string }): number {
    let score = 50; // Base score

    // Longer captions might indicate more engagement-worthy content
    if (post.caption.length > 50) score += 10;
    if (post.caption.length > 100) score += 10;

    // Questions in caption
    if (post.caption.includes('?')) score += 15;

    // Hashtags
    const hashtagCount = (post.caption.match(/#/g) || []).length;
    score += Math.min(hashtagCount * 2, 10);

    // Emoji presence (engagement indicator)
    if (/[\u{1F300}-\u{1F9FF}]/u.test(post.caption)) score += 5;

    return score;
  }

  /**
   * Clean up old entries from seen posts
   */
  private cleanupSeenPosts(): void {
    const cutoff = Date.now() - this.config.dedupeWindow * 60 * 60 * 1000;
    
    for (const [key, date] of this.seenPosts) {
      if (date.getTime() < cutoff) {
        this.seenPosts.delete(key);
      }
    }
  }

  /**
   * Mark a post as commented
   */
  markCommented(platform: CommentPlatform, postId: string): void {
    const key = `${platform}:${postId}`;
    this.seenPosts.set(key, new Date());
  }

  /**
   * Get seen posts count
   */
  getSeenCount(): number {
    return this.seenPosts.size;
  }

  /**
   * Get last discovery time for a platform
   */
  getLastDiscovery(platform: CommentPlatform): Date | null {
    return this.lastDiscovery.get(platform) ?? null;
  }

  private wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
