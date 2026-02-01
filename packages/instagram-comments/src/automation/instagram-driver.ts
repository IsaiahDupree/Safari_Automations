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

  async postComment(text: string): Promise<CommentResult> {
    try {
      console.log(`[Instagram] Posting comment: "${text.substring(0, 50)}..."`);

      // Check rate limits
      const rateCheck = this.checkRateLimit();
      if (!rateCheck.allowed) {
        return { success: false, error: rateCheck.reason };
      }

      // Find and focus comment input
      const focusResult = await this.executeJS(`
        (function() {
          var input = document.querySelector('textarea[aria-label="Add a comment…"]');
          if (!input) {
            input = document.querySelector('textarea[placeholder="Add a comment…"]');
          }
          if (input) {
            input.focus();
            input.click();
            return 'focused';
          }
          return 'not_found';
        })();
      `);

      if (focusResult !== 'focused') {
        return { success: false, error: 'Comment input not found' };
      }

      await this.wait(500);

      // Type the comment
      const escaped = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/'/g, "\\'").replace(/\n/g, '\\n');
      const typeResult = await this.executeJS(`
        (function() {
          var input = document.querySelector('textarea[aria-label="Add a comment…"]');
          if (!input) {
            input = document.querySelector('textarea[placeholder="Add a comment…"]');
          }
          if (input) {
            input.value = '${escaped}';
            input.dispatchEvent(new InputEvent('input', { bubbles: true }));
            return 'typed';
          }
          return 'input_not_found';
        })();
      `);

      if (typeResult !== 'typed') {
        return { success: false, error: 'Failed to type comment' };
      }

      await this.wait(500);

      // Submit the comment
      const submitResult = await this.executeJS(`
        (function() {
          var postBtn = document.querySelector('button[type="submit"]');
          if (!postBtn) {
            var buttons = document.querySelectorAll('div[role="button"]');
            for (var i = 0; i < buttons.length; i++) {
              if (buttons[i].innerText.toLowerCase() === 'post') {
                postBtn = buttons[i];
                break;
              }
            }
          }
          if (postBtn && !postBtn.disabled) {
            postBtn.click();
            return 'clicked';
          }
          return 'submit_not_found';
        })();
      `);

      if (submitResult !== 'clicked') {
        return { success: false, error: 'Submit button not found' };
      }

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
}
