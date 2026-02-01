/**
 * Instagram Comment Driver
 * 
 * Safari automation driver for posting comments on Instagram.
 * Reuses pattern from ThreadsDriver.
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Instagram selectors
export const SELECTORS = {
  // Navigation
  NAV_HOME: 'svg[aria-label="Home"]',
  NAV_SEARCH: 'svg[aria-label="Search"]',
  NAV_EXPLORE: 'svg[aria-label="Explore"]',
  NAV_REELS: 'svg[aria-label="Reels"]',
  NAV_MESSAGES: 'svg[aria-label="Messenger"]',
  NAV_NOTIFICATIONS: 'svg[aria-label="Notifications"]',
  NAV_CREATE: 'svg[aria-label="New post"]',
  NAV_PROFILE: 'svg[aria-label="Profile"]',
  
  // Post actions
  ACTION_LIKE: 'svg[aria-label="Like"]',
  ACTION_UNLIKE: 'svg[aria-label="Unlike"]',
  ACTION_COMMENT: 'svg[aria-label="Comment"]',
  ACTION_SHARE: 'svg[aria-label="Share Post"]',
  ACTION_SAVE: 'svg[aria-label="Save"]',
  
  // Comment input
  COMMENT_INPUT: 'textarea[aria-label="Add a comment…"]',
  COMMENT_INPUT_ALT: 'textarea[placeholder="Add a comment…"]',
  COMMENT_SUBMIT: 'button[type="submit"]',
  COMMENT_POST_BTN: 'div[role="button"]:has-text("Post")',
  
  // Content
  POST_CONTAINER: 'article',
  USERNAME_LINK: 'a[href^="/"]',
  CAPTION_TEXT: 'span._ap3a',
  COMMENT_CONTAINER: 'ul li',
};

export interface InstagramConfig {
  timeout: number;
  minDelayMs: number;
  maxDelayMs: number;
  commentsPerHour: number;
  commentsPerDay: number;
}

export const DEFAULT_CONFIG: InstagramConfig = {
  timeout: 30000,
  minDelayMs: 120000,
  maxDelayMs: 300000,
  commentsPerHour: 5,
  commentsPerDay: 15,
};

export interface CommentResult {
  success: boolean;
  commentId?: string;
  error?: string;
}

export interface InstagramStatus {
  isOnInstagram: boolean;
  isLoggedIn: boolean;
  currentUrl: string;
}

export class InstagramDriver {
  private config: InstagramConfig;
  private commentLog: { timestamp: Date }[] = [];

  constructor(config: Partial<InstagramConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  private async executeJS(script: string): Promise<string> {
    // Use temp file approach to avoid shell escaping issues (same as ThreadsDriver)
    const fs = await import('fs');
    const os = await import('os');
    const path = await import('path');
    
    const tmpFile = path.join(os.tmpdir(), `safari_js_${Date.now()}.scpt`);
    const jsCode = script.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
    const appleScript = `tell application "Safari" to do JavaScript "${jsCode}" in current tab of front window`;
    
    fs.writeFileSync(tmpFile, appleScript);
    try {
      const { stdout } = await execAsync(`osascript "${tmpFile}"`);
      return stdout.trim();
    } finally {
      fs.unlinkSync(tmpFile);
    }
  }

  private async navigate(url: string): Promise<boolean> {
    try {
      await execAsync(
        `osascript -e 'tell application "Safari" to set URL of current tab of front window to "${url}"'`
      );
      await this.wait(3000);
      return true;
    } catch {
      return false;
    }
  }

  private wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async getStatus(): Promise<InstagramStatus> {
    try {
      const { stdout: urlOut } = await execAsync(
        `osascript -e 'tell application "Safari" to get URL of current tab of front window'`
      );
      const currentUrl = urlOut.trim();
      const isOnInstagram = currentUrl.includes('instagram.com');

      const loginCheck = await this.executeJS(`
        (function() {
          var profileBtn = document.querySelector('svg[aria-label="Profile"]');
          if (profileBtn) return 'logged_in';
          var createBtn = document.querySelector('svg[aria-label="New post"]');
          if (createBtn) return 'logged_in';
          var loginBtn = document.querySelector('button:contains("Log In")');
          if (loginBtn) return 'not_logged_in';
          return 'unknown';
        })();
      `);

      return {
        isOnInstagram,
        isLoggedIn: loginCheck === 'logged_in',
        currentUrl,
      };
    } catch {
      return {
        isOnInstagram: false,
        isLoggedIn: false,
        currentUrl: '',
      };
    }
  }

  async navigateToPost(postUrl: string): Promise<boolean> {
    console.log(`[Instagram] Navigating to ${postUrl}`);
    return this.navigate(postUrl);
  }

  async getPostDetails(): Promise<Record<string, string>> {
    const result = await this.executeJS(`
      (function() {
        var article = document.querySelector('article');
        if (!article) return JSON.stringify({error: 'no_article'});
        
        var userLink = article.querySelector('a[href^="/"]');
        var username = userLink ? userLink.href.split('/').filter(Boolean).pop() : '';
        
        var caption = article.querySelector('span');
        var text = caption ? caption.innerText : '';
        
        var timeEl = article.querySelector('time');
        var timestamp = timeEl ? timeEl.getAttribute('datetime') : '';
        
        return JSON.stringify({
          username: username,
          text: text.substring(0, 500),
          timestamp: timestamp,
          url: window.location.href
        });
      })();
    `);
    
    try {
      return JSON.parse(result);
    } catch {
      return { error: 'parse_failed' };
    }
  }

  async getComments(limit = 50): Promise<Array<{ username: string; text: string; timestamp: string }>> {
    const result = await this.executeJS(`
      (function() {
        var comments = [];
        var commentEls = document.querySelectorAll('ul li');
        
        for (var i = 0; i < Math.min(commentEls.length, ${limit}); i++) {
          var el = commentEls[i];
          
          var userLink = el.querySelector('a[href^="/"]');
          var username = userLink ? userLink.href.split('/').filter(Boolean).pop() : '';
          
          var textEl = el.querySelector('span');
          var text = textEl ? textEl.innerText : '';
          
          var timeEl = el.querySelector('time');
          var timestamp = timeEl ? timeEl.getAttribute('datetime') : '';
          
          if (username && text && text.length > 0) {
            comments.push({
              username: username,
              text: text.substring(0, 500),
              timestamp: timestamp
            });
          }
        }
        
        return JSON.stringify(comments);
      })();
    `);

    try {
      return JSON.parse(result);
    } catch {
      return [];
    }
  }

  /**
   * Type text using clipboard paste (supports emojis)
   * Reused from packages/services/src/safari/safari-executor.ts
   */
  private async typeViaClipboard(text: string): Promise<boolean> {
    const escaped = text.replace(/"/g, '\\"').replace(/`/g, '\\`').replace(/\$/g, '\\$');
    // Use printf instead of echo -n to avoid -n appearing in output on some shells
    await execAsync(`printf '%s' "${escaped}" | pbcopy`).catch(() => null);
    await this.wait(200);
    
    const script = `
tell application "Safari" to activate
delay 0.2
tell application "System Events"
    keystroke "v" using command down
end tell`;
    
    try {
      await execAsync(`osascript -e '${script.replace(/'/g, "'\"'\"'")}'`);
      return true;
    } catch {
      return false;
    }
  }

  async postComment(text: string): Promise<CommentResult> {
    try {
      console.log(`[Instagram] Posting comment: "${text.substring(0, 50)}..."`);

      // Check rate limits
      const rateCheck = this.checkRateLimit();
      if (!rateCheck.allowed) {
        return { success: false, error: rateCheck.reason };
      }

      // Step 1: Try clicking comment icon first to reveal input
      console.log(`[Instagram] Step 1: Clicking comment icon...`);
      const clickCommentIcon = await this.executeJS(`
        (function() {
          var commentBtn = document.querySelector('svg[aria-label="Comment"]');
          if (commentBtn) {
            var btn = commentBtn.closest('button') || commentBtn.parentElement;
            if (btn) { btn.click(); return 'clicked'; }
          }
          return 'not_found';
        })();
      `);
      console.log(`[Instagram]   Result: ${clickCommentIcon}`);
      await this.wait(1000);

      // Step 2: Find and focus comment input
      console.log(`[Instagram] Step 2: Focusing comment input...`);
      const focusResult = await this.executeJS(`
        (function() {
          var selectors = [
            'textarea[aria-label="Add a comment…"]',
            'textarea[placeholder="Add a comment…"]',
            'textarea[aria-label*="comment" i]',
            'textarea[placeholder*="comment" i]'
          ];
          for (var s of selectors) {
            var input = document.querySelector(s);
            if (input && input.offsetParent !== null) {
              input.focus();
              input.click();
              return 'focused';
            }
          }
          return 'not_found';
        })();
      `);
      console.log(`[Instagram]   Result: ${focusResult}`);

      if (focusResult !== 'focused') {
        return { success: false, error: 'Comment input not found' };
      }

      await this.wait(500);

      // Step 3: Type via clipboard (supports emojis)
      console.log(`[Instagram] Step 3: Typing via clipboard...`);
      const typed = await this.typeViaClipboard(text);
      console.log(`[Instagram]   Result: ${typed ? 'typed' : 'failed'}`);
      
      if (!typed) {
        return { success: false, error: 'Failed to type comment' };
      }

      await this.wait(500);

      // Step 4: Submit the comment
      console.log(`[Instagram] Step 4: Submitting...`);
      const submitResult = await this.executeJS(`
        (function() {
          // Try submit button
          var postBtn = document.querySelector('button[type="submit"]');
          if (postBtn && !postBtn.disabled) {
            postBtn.click();
            return 'clicked_submit';
          }
          // Try role="button" with Post text
          var buttons = document.querySelectorAll('div[role="button"]');
          for (var i = 0; i < buttons.length; i++) {
            var text = (buttons[i].innerText || '').trim().toLowerCase();
            if (text === 'post' && !buttons[i].hasAttribute('aria-disabled')) {
              buttons[i].click();
              return 'clicked_post';
            }
          }
          return 'submit_not_found';
        })();
      `);
      console.log(`[Instagram]   Result: ${submitResult}`);

      if (!submitResult.includes('clicked')) {
        return { success: false, error: 'Submit button not found or disabled' };
      }

      await this.wait(2000);

      // Log the comment
      this.commentLog.push({ timestamp: new Date() });

      const commentId = `ig_${Date.now()}`;
      console.log(`[Instagram] ✅ Comment posted: ${commentId}`);

      return { success: true, commentId };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  checkRateLimit(): { allowed: boolean; reason?: string } {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const commentsLastHour = this.commentLog.filter(c => c.timestamp > oneHourAgo).length;
    const commentsToday = this.commentLog.filter(c => c.timestamp > oneDayAgo).length;

    if (commentsLastHour >= this.config.commentsPerHour) {
      return { allowed: false, reason: `Rate limit: ${this.config.commentsPerHour} comments per hour` };
    }

    if (commentsToday >= this.config.commentsPerDay) {
      return { allowed: false, reason: `Rate limit: ${this.config.commentsPerDay} comments per day` };
    }

    return { allowed: true };
  }

  getRateLimits(): { commentsThisHour: number; commentsToday: number; limits: InstagramConfig } {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    return {
      commentsThisHour: this.commentLog.filter(c => c.timestamp > oneHourAgo).length,
      commentsToday: this.commentLog.filter(c => c.timestamp > oneDayAgo).length,
      limits: this.config,
    };
  }

  setConfig(updates: Partial<InstagramConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  getConfig(): InstagramConfig {
    return { ...this.config };
  }

  /**
   * Find posts on Instagram feed
   */
  async findPosts(limit: number = 10): Promise<Array<{ username: string; url?: string }>> {
    const result = await this.executeJS(`
      (function() {
        var posts = [];
        // Try multiple selectors for Instagram posts
        var postLinks = document.querySelectorAll('a[href*="/p/"]');
        var seen = new Set();
        for (var i = 0; i < postLinks.length && posts.length < ${limit}; i++) {
          var link = postLinks[i];
          var href = link.getAttribute('href');
          if (href && !seen.has(href)) {
            seen.add(href);
            var url = href.startsWith('http') ? href : 'https://www.instagram.com' + href;
            // Try to find username from nearby elements
            var container = link.closest('article') || link.closest('div[role="presentation"]') || link.parentElement;
            var userLink = container ? container.querySelector('a[href^="/"]:not([href*="/p/"])') : null;
            var username = userLink ? userLink.getAttribute('href').replace(/\\//g, '') : '';
            posts.push({ username: username, url: url });
          }
        }
        return JSON.stringify(posts);
      })();
    `);
    try {
      return JSON.parse(result);
    } catch {
      return [];
    }
  }

  /**
   * Click on a post to open it
   */
  async clickPost(index: number = 0): Promise<boolean> {
    // First try navigating directly to post URL
    const posts = await this.findPosts(10);
    if (posts.length > index && posts[index].url) {
      console.log(`[Instagram] Navigating to post: ${posts[index].url}`);
      await this.navigate(posts[index].url);
      await this.wait(2000);
      return true;
    }
    
    // Fallback: click on post image
    const result = await this.executeJS(`
      (function() {
        var postLinks = document.querySelectorAll('a[href*="/p/"]');
        if (postLinks.length <= ${index}) return 'no_posts';
        var link = postLinks[${index}];
        var img = link.querySelector('img');
        if (img) {
          img.click();
          return 'clicked_img';
        }
        link.click();
        return 'clicked_link';
      })();
    `);
    await this.wait(2000);
    return result.includes('clicked');
  }

  /**
   * Click back/close button to return to feed
   */
  async clickBack(): Promise<boolean> {
    const result = await this.executeJS(`
      (function() {
        // Try close button on modal
        var closeBtn = document.querySelector('svg[aria-label="Close"]');
        if (closeBtn) {
          var btn = closeBtn.closest('button') || closeBtn.parentElement;
          if (btn) { btn.click(); return 'closed'; }
        }
        // Try back button
        var backBtn = document.querySelector('svg[aria-label="Back"]');
        if (backBtn) {
          var btn = backBtn.closest('button') || backBtn.parentElement;
          if (btn) { btn.click(); return 'back'; }
        }
        // Fallback: press Escape
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27 }));
        return 'escape';
      })();
    `);
    await this.wait(1500);
    return result === 'closed' || result === 'back' || result === 'escape';
  }

  /**
   * Scroll down to load more posts
   */
  async scroll(): Promise<void> {
    await this.executeJS(`window.scrollBy(0, 800);`);
    await this.wait(1000);
  }

  /**
   * Like the current post
   */
  async likePost(): Promise<boolean> {
    const result = await this.executeJS(`
      (function() {
        // Try heart icon with "Like" aria-label (not already liked)
        var likeBtn = document.querySelector('svg[aria-label="Like"]');
        if (likeBtn) {
          var btn = likeBtn.closest('button') || likeBtn.parentElement;
          if (btn) { btn.click(); return 'liked'; }
        }
        // Check if already liked
        var unlikeBtn = document.querySelector('svg[aria-label="Unlike"]');
        if (unlikeBtn) {
          return 'already_liked';
        }
        return 'not_found';
      })();
    `);
    console.log(`[Instagram] Like result: ${result}`);
    return result === 'liked' || result === 'already_liked';
  }

  /**
   * Search Instagram by keyword/hashtag
   * Note: Explore pages have React rendering issues, so we use feed-based collection
   */
  async searchByKeyword(keyword: string): Promise<Array<{ username: string; url?: string }>> {
    console.log(`[Instagram] Collecting posts for keyword: "${keyword}"`);
    
    // Go to main feed (which works reliably)
    await this.navigate('https://www.instagram.com/');
    await this.wait(4000);
    
    // Collect posts by scrolling through feed
    const allPosts: Array<{ username: string; url?: string }> = [];
    const seenUrls = new Set<string>();
    
    for (let scroll = 0; scroll < 3; scroll++) {
      const posts = await this.findPosts(20);
      for (const post of posts) {
        if (post.url && !seenUrls.has(post.url)) {
          seenUrls.add(post.url);
          allPosts.push(post);
        }
      }
      await this.scroll();
      await this.wait(1500);
    }
    
    console.log(`[Instagram] Found ${allPosts.length} posts from feed`);
    
    // Store keyword context for comment generation
    (this as any).currentKeyword = keyword;
    
    return allPosts;
  }

  /**
   * Get comments with better selectors
   */
  async getCommentsDetailed(limit: number = 20): Promise<Array<{ username: string; text: string; timestamp?: string }>> {
    const result = await this.executeJS(`
      (function() {
        var comments = [];
        
        // Try multiple selectors for Instagram comments
        var selectors = [
          'ul ul li',                           // Nested comment list
          'div[role="button"] + ul li',         // Comments under expand button
          'article ul li',                      // Article comment list
          'ul[class*="Comment"] li',            // Class-based
          'div[class*="comment" i] li'          // Case-insensitive class
        ];
        
        for (var selector of selectors) {
          var items = document.querySelectorAll(selector);
          for (var i = 0; i < Math.min(items.length, ${limit}); i++) {
            var item = items[i];
            
            // Find username
            var userLink = item.querySelector('a[href^="/"]:not([href*="/p/"])');
            var username = userLink ? userLink.textContent.trim() : '';
            
            // Find comment text - try multiple approaches
            var textEl = item.querySelector('span:not(:has(a))');
            if (!textEl) textEl = item.querySelector('span > span');
            if (!textEl) textEl = item.querySelector('div > span');
            var text = textEl ? textEl.textContent.trim() : '';
            
            // Find timestamp
            var timeEl = item.querySelector('time');
            var timestamp = timeEl ? timeEl.getAttribute('datetime') : '';
            
            if (username && text && text.length > 2) {
              // Avoid duplicates
              var isDupe = comments.some(c => c.username === username && c.text === text);
              if (!isDupe) {
                comments.push({ username: username, text: text.substring(0, 300), timestamp: timestamp });
              }
            }
          }
          
          if (comments.length > 0) break; // Found comments with this selector
        }
        
        return JSON.stringify(comments);
      })();
    `);

    try {
      return JSON.parse(result);
    } catch {
      return [];
    }
  }

  /**
   * Get post caption with better extraction
   */
  async getCaptionDetailed(): Promise<{ caption: string; hashtags: string[]; mentions: string[] }> {
    const result = await this.executeJS(`
      (function() {
        var caption = '';
        var hashtags = [];
        var mentions = [];
        
        // Try multiple selectors for caption
        var captionSelectors = [
          'article h1',
          'article span[class*="Caption"]',
          'article div[class*="Caption"] span',
          'div[role="button"] + span',
          'article ul li:first-child span'
        ];
        
        for (var selector of captionSelectors) {
          var el = document.querySelector(selector);
          if (el && el.textContent.trim().length > 10) {
            caption = el.textContent.trim();
            break;
          }
        }
        
        // Extract hashtags
        var hashtagLinks = document.querySelectorAll('a[href*="/explore/tags/"]');
        hashtagLinks.forEach(function(link) {
          var tag = link.textContent.trim();
          if (tag.startsWith('#')) hashtags.push(tag);
        });
        
        // Extract mentions
        var mentionLinks = document.querySelectorAll('a[href^="/"]:not([href*="/p/"]):not([href*="/explore/"])');
        mentionLinks.forEach(function(link) {
          var mention = link.textContent.trim();
          if (mention.startsWith('@')) mentions.push(mention);
        });
        
        return JSON.stringify({ caption: caption.substring(0, 1000), hashtags: hashtags, mentions: mentions });
      })();
    `);

    try {
      return JSON.parse(result);
    } catch {
      return { caption: '', hashtags: [], mentions: [] };
    }
  }
}
