/**
 * Threads Comment Driver
 * 
 * Safari automation for Threads comment posting.
 * 
 * ORIGINAL TYPESCRIPT SOURCE:
 * - packages/services/src/safari/safari-executor.ts
 * - packages/services/src/comment-engine/adapters/threads.ts
 * 
 * ARCHIVED (NOT USED):
 * - python/_archived_media_poster/safari_threads_poster.py
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Selectors from packages/services/src/comment-engine/adapters/threads.ts
export const SELECTORS = {
  // Navigation
  NAV_HOME: 'svg[aria-label="Home"]',
  NAV_SEARCH: 'svg[aria-label="Search"]',
  NAV_CREATE: 'svg[aria-label="Create"]',
  NAV_NOTIFICATIONS: 'svg[aria-label="Notifications"]',
  NAV_PROFILE: 'svg[aria-label="Profile"]',
  NAV_MORE: 'svg[aria-label="More"]',
  NAV_BACK: 'svg[aria-label="Back"]',
  // Post Actions
  ACTION_LIKE: 'svg[aria-label="Like"]',
  ACTION_UNLIKE: 'svg[aria-label="Unlike"]',
  ACTION_REPLY: 'svg[aria-label="Reply"]',
  ACTION_REPOST: 'svg[aria-label="Repost"]',
  ACTION_SHARE: 'svg[aria-label="Share"]',
  ACTION_MORE: 'svg[aria-label="More"]',
  // Composer
  COMPOSER_INPUT: '[role="textbox"][contenteditable="true"]',
  COMPOSER_INPUT_ALT: '[contenteditable="true"]',
  COMPOSER_INPUT_ARIA: '[aria-label*="Empty text field"]',
  COMPOSER_EXPAND: 'svg[aria-label="Expand composer"]',
  COMPOSER_SUBMIT_REPLY: 'svg[aria-label="Reply"]',
  COMPOSER_SUBMIT_CREATE: 'svg[aria-label="Create"]',
  // Content Containers
  POST_CONTAINER: '[data-pressable-container="true"]',
  USER_LINK: 'a[href*="/@"]',
  POST_LINK: 'a[href*="/post/"]',
  TIMESTAMP: 'time',
  TEXT_CONTENT: '[dir="auto"] span',
  TEXT_CONTENT_ALT: '[dir="ltr"] span',
  // Modal/Dialog
  DIALOG: '[role="dialog"]',
  DIALOG_CLOSE: 'svg[aria-label="Close"]',
  // Generic
  ROLE_BUTTON: '[role="button"]',
  BUTTON_DISABLED: '[aria-disabled="true"]',
};

// JavaScript templates from python/selectors/threads_selectors.py (ThreadsJS class)
export const JS_TEMPLATES = {
  clickReplyButton: `
    (function() {
      var replyBtns = document.querySelectorAll('svg[aria-label="Reply"]');
      if (replyBtns.length > 0) {
        var btn = replyBtns[0].closest('[role="button"]') || replyBtns[0].parentElement;
        if (btn) { btn.click(); return 'clicked'; }
      }
      return 'not_found';
    })();
  `,
  submitReply: `
    (function() {
      // Strategy 1: Find "Post" button in the reply modal (visible at bottom right)
      var dialog = document.querySelector('[role="dialog"]');
      if (dialog) {
        var postBtns = dialog.querySelectorAll('div[role="button"]');
        for (var i = 0; i < postBtns.length; i++) {
          var text = postBtns[i].innerText.trim();
          if (text === 'Post') {
            postBtns[i].click();
            return 'clicked_dialog_post';
          }
        }
      }
      
      // Strategy 2: Find any visible "Post" button
      var allBtns = document.querySelectorAll('div[role="button"]');
      for (var i = 0; i < allBtns.length; i++) {
        var text = allBtns[i].innerText.trim();
        if (text === 'Post' && allBtns[i].offsetParent !== null) {
          allBtns[i].click();
          return 'clicked_post';
        }
      }
      
      // Strategy 3: Click by finding Post text and its clickable parent
      var elements = document.querySelectorAll('*');
      for (var i = 0; i < elements.length; i++) {
        if (elements[i].innerText === 'Post' && elements[i].children.length === 0) {
          var parent = elements[i].closest('[role="button"]');
          if (parent) { parent.click(); return 'clicked_post_parent'; }
        }
      }
      
      return 'submit_not_found';
    })();
  `,
  checkLoginStatus: `
    (function() {
      var createBtn = document.querySelector('svg[aria-label="Create"]');
      if (createBtn) return 'logged_in';
      var profileBtn = document.querySelector('svg[aria-label="Profile"]');
      if (profileBtn) return 'logged_in';
      var loginBtn = document.querySelector('a[href*="/login"]');
      if (loginBtn) return 'not_logged_in';
      return 'unknown';
    })();
  `,
  getPostDetails: `
    (function() {
      var container = document.querySelector('[data-pressable-container="true"]');
      if (!container) return JSON.stringify({error: 'no_container'});
      var userLink = container.querySelector('a[href*="/@"]');
      var username = userLink ? userLink.href.split('/@').pop().split('/')[0] : '';
      var textEl = container.querySelector('[dir="auto"] span');
      var text = textEl ? textEl.innerText : '';
      var timeEl = container.querySelector('time');
      var timestamp = timeEl ? timeEl.getAttribute('datetime') : '';
      var postLink = container.querySelector('a[href*="/post/"]');
      var postId = '';
      if (postLink) { var match = postLink.href.match(/\\/post\\/([A-Za-z0-9_-]+)/); postId = match ? match[1] : ''; }
      return JSON.stringify({ username, text: text.substring(0, 500), timestamp, post_id: postId, url: window.location.href });
    })();
  `,
  typeInComposer: (text: string) => {
    const escaped = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/'/g, "\\'").replace(/\n/g, '\\n');
    return `
      (function() {
        var input = document.querySelector('[role="textbox"][contenteditable="true"]');
        if (!input) { input = document.querySelector('[contenteditable="true"]'); }
        if (input) { input.focus(); input.innerText = '${escaped}'; input.dispatchEvent(new InputEvent('input', { bubbles: true })); return 'typed'; }
        return 'input_not_found';
      })();
    `;
  },
  extractComments: (limit: number) => `
    (function() {
      var comments = [];
      var containers = document.querySelectorAll('[data-pressable-container="true"]');
      for (var i = 1; i < Math.min(containers.length, ${limit + 1}); i++) {
        var el = containers[i];
        var userLink = el.querySelector('a[href*="/@"]');
        var username = userLink ? userLink.href.split('/@').pop().split('/')[0].split('?')[0] : '';
        var textEl = el.querySelector('[dir="auto"] span');
        var text = textEl ? textEl.innerText : '';
        var timeEl = el.querySelector('time');
        var timestamp = timeEl ? timeEl.getAttribute('datetime') : '';
        if (username && text) { comments.push({ username, text: text.substring(0, 500), timestamp }); }
      }
      return JSON.stringify(comments);
    })();
  `,
  // From python/engagement/threads_engagement.py - find posts to engage with
  findAllPosts: (limit: number) => `
    (function() {
      var posts = document.querySelectorAll('div[data-pressable-container="true"]');
      var results = [];
      for (var i = 0; i < Math.min(posts.length, ${limit}); i++) {
        var post = posts[i];
        var userLink = post.querySelector('a[href^="/@"]');
        var postLink = post.querySelector('a[href*="/post/"]');
        var content = '';
        post.querySelectorAll('span[dir="auto"]').forEach(function(el) { content += el.innerText + ' '; });
        if (userLink && postLink && content.length > 20) {
          results.push({
            username: userLink.getAttribute('href').replace('/@', '').split('/')[0],
            url: postLink.href,
            content: content.substring(0, 300),
            index: i
          });
        }
      }
      return JSON.stringify(results);
    })();
  `,
  // From python/engagement/threads_engagement.py - extract full context for AI
  extractContext: `
    (function() {
      var data = { mainPost: '', username: '', replies: [], likeCount: '', replyCount: '' };
      var posts = document.querySelectorAll('div[data-pressable-container="true"]');
      if (posts[0]) {
        var mainPost = posts[0];
        var userEl = mainPost.querySelector('a[href^="/@"]');
        if (userEl) { data.username = userEl.getAttribute('href').replace('/@', '').split('/')[0]; }
        mainPost.querySelectorAll('span[dir="auto"]').forEach(function(el) {
          var text = el.innerText.trim();
          if (text.length > 10 && !text.match(/^\\d+[hmd]$/) && text !== data.username) { data.mainPost += text + ' '; }
        });
        var statsText = mainPost.innerText;
        var likeMatch = statsText.match(/(\\d+[KkMm]?)\\s*like/i);
        var replyMatch = statsText.match(/(\\d+[KkMm]?)\\s*repl/i);
        if (likeMatch) data.likeCount = likeMatch[1];
        if (replyMatch) data.replyCount = replyMatch[1];
      }
      for (var i = 1; i < Math.min(posts.length, 10); i++) {
        var reply = posts[i];
        var replyUser = '';
        var replyText = '';
        var userEl = reply.querySelector('a[href^="/@"]');
        if (userEl) { replyUser = userEl.getAttribute('href').replace('/@', '').split('/')[0]; }
        reply.querySelectorAll('span[dir="auto"]').forEach(function(el) {
          var text = el.innerText.trim();
          if (text.length > 5 && !text.match(/^\\d+[hmd]$/) && text !== replyUser) { replyText += text + ' '; }
        });
        if (replyUser && replyText.length > 5) { data.replies.push('@' + replyUser + ': ' + replyText.substring(0, 120)); }
      }
      return JSON.stringify(data);
    })();
  `,
  // Scroll to load more posts
  scrollDown: `
    (function() { window.scrollBy(0, 800); return 'scrolled'; })();
  `,
  // Click into a post to see full thread
  clickPost: (index: number) => `
    (function() {
      var posts = document.querySelectorAll('div[data-pressable-container="true"]');
      if (posts[${index}]) {
        var postLink = posts[${index}].querySelector('a[href*="/post/"]');
        if (postLink) { postLink.click(); return 'clicked'; }
      }
      return 'not_found';
    })();
  `,
  // From python/engagement/threads_engagement.py JS_FOCUS_INPUT
  focusInput: `
    (function() {
      var els = document.querySelectorAll('[contenteditable="true"]');
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        if (el.offsetParent !== null && el.offsetHeight > 10) {
          el.scrollIntoView({block: 'center'});
          el.click();
          el.focus();
          if (el.innerText.trim() === '' || el.innerText.includes('reply') || el.innerText.includes('Reply')) {
            el.innerText = '';
          }
          el.click();
          el.focus();
          return 'focused';
        }
      }
      return 'not_found';
    })();
  `,
  // From python/engagement/threads_engagement.py JS_CLICK_EXPAND
  clickExpand: `
    (function() {
      var svgs = document.querySelectorAll('svg');
      for (var i = 0; i < svgs.length; i++) {
        var svg = svgs[i];
        var label = svg.getAttribute('aria-label') || '';
        if (label.toLowerCase().includes('expand') || label.toLowerCase().includes('full')) {
          var btn = svg.closest('div[role="button"]') || svg.parentElement;
          if (btn) { btn.click(); return 'clicked_expand'; }
        }
      }
      return 'no_expand_found';
    })();
  `,
  // Click back button to return to feed
  clickBack: `
    (function() {
      var backBtn = document.querySelector('svg[aria-label="Back"]');
      if (backBtn) {
        var btn = backBtn.closest('[role="button"]') || backBtn.parentElement;
        if (btn) { btn.click(); return 'clicked_back'; }
      }
      // Fallback: use browser back
      window.history.back();
      return 'history_back';
    })();
  `,
};

export interface ThreadsConfig {
  timeout: number;
  minDelayMs: number;
  maxDelayMs: number;
  commentsPerHour: number;
  commentsPerDay: number;
}

export const DEFAULT_CONFIG: ThreadsConfig = {
  timeout: 30000,
  minDelayMs: 60000,
  maxDelayMs: 180000,
  commentsPerHour: 5,
  commentsPerDay: 20,
};

export interface CommentResult {
  success: boolean;
  commentId?: string;
  error?: string;
}

export interface ThreadsStatus {
  isOnThreads: boolean;
  isLoggedIn: boolean;
  currentUrl: string;
}

export class ThreadsDriver {
  private config: ThreadsConfig;
  private commentLog: { timestamp: Date }[] = [];

  constructor(config: Partial<ThreadsConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  private async executeJS(script: string): Promise<string> {
    // Use temp file approach from python/controllers/safari_controller.py
    const fs = await import('fs');
    const os = await import('os');
    const path = await import('path');
    
    // Write JS to temp file (like Python's execute_js method)
    const jsFile = path.join(os.tmpdir(), `safari_js_${Date.now()}.js`);
    fs.writeFileSync(jsFile, script);
    
    const appleScript = `
tell application "Safari"
  tell front document
    set jsCode to read POSIX file "${jsFile}"
    do JavaScript jsCode
  end tell
end tell`;
    
    const scptFile = path.join(os.tmpdir(), `safari_cmd_${Date.now()}.scpt`);
    fs.writeFileSync(scptFile, appleScript);
    
    try {
      const { stdout } = await execAsync(`osascript "${scptFile}"`, { timeout: 15000 });
      return stdout.trim();
    } finally {
      fs.unlinkSync(jsFile);
      fs.unlinkSync(scptFile);
    }
  }

  private async typeViaClipboard(text: string): Promise<boolean> {
    // From python/controllers/safari_controller.py type_via_clipboard
    // This is the working method that supports emojis
    try {
      // Copy text to clipboard
      const { spawn } = await import('child_process');
      await new Promise<void>((resolve, reject) => {
        const pbcopy = spawn('pbcopy');
        pbcopy.stdin.write(text);
        pbcopy.stdin.end();
        pbcopy.on('close', () => resolve());
        pbcopy.on('error', reject);
      });
      
      await this.wait(200);
      
      // Paste using Cmd+V
      const appleScript = `
tell application "Safari" to activate
delay 0.2
tell application "System Events"
  keystroke "v" using command down
end tell`;
      
      await execAsync(`osascript -e '${appleScript}'`);
      return true;
    } catch {
      return false;
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

  private randomDelay(): number {
    return this.config.minDelayMs + Math.random() * (this.config.maxDelayMs - this.config.minDelayMs);
  }

  async getStatus(): Promise<ThreadsStatus> {
    try {
      const { stdout: urlOut } = await execAsync(
        `osascript -e 'tell application "Safari" to get URL of current tab of front window'`
      );
      const currentUrl = urlOut.trim();
      const isOnThreads = currentUrl.includes('threads.net') || currentUrl.includes('threads.com');

      // Use JS_TEMPLATES.checkLoginStatus from existing code
      const loginCheck = await this.executeJS(JS_TEMPLATES.checkLoginStatus);

      return {
        isOnThreads,
        isLoggedIn: loginCheck === 'logged_in',
        currentUrl,
      };
    } catch {
      return {
        isOnThreads: false,
        isLoggedIn: false,
        currentUrl: '',
      };
    }
  }

  async navigateToPost(postUrl: string): Promise<boolean> {
    console.log(`[Threads] Navigating to ${postUrl}`);
    return this.navigate(postUrl);
  }

  async getPostDetails(): Promise<Record<string, string>> {
    // Use JS_TEMPLATES.getPostDetails from existing code
    const result = await this.executeJS(JS_TEMPLATES.getPostDetails);
    try {
      return JSON.parse(result);
    } catch {
      return { error: 'parse_failed' };
    }
  }

  async getComments(limit = 50): Promise<Array<{ username: string; text: string; timestamp: string }>> {
    // Use JS_TEMPLATES.extractComments from existing code
    const result = await this.executeJS(JS_TEMPLATES.extractComments(limit));
    try {
      return JSON.parse(result);
    } catch {
      return [];
    }
  }

  async findPosts(limit = 10): Promise<Array<{ username: string; url: string; content: string; index: number }>> {
    // Find posts on feed to engage with (from python/engagement/threads_engagement.py)
    const result = await this.executeJS(JS_TEMPLATES.findAllPosts(limit));
    try {
      return JSON.parse(result);
    } catch {
      return [];
    }
  }

  async getContext(): Promise<{ mainPost: string; username: string; replies: string[]; likeCount: string; replyCount: string }> {
    // Extract full context for AI comment generation (from python/engagement/threads_engagement.py)
    const result = await this.executeJS(JS_TEMPLATES.extractContext);
    try {
      return JSON.parse(result);
    } catch {
      return { mainPost: '', username: '', replies: [], likeCount: '', replyCount: '' };
    }
  }

  async scroll(): Promise<boolean> {
    const result = await this.executeJS(JS_TEMPLATES.scrollDown);
    return result === 'scrolled';
  }

  async clickPost(index: number): Promise<boolean> {
    const result = await this.executeJS(JS_TEMPLATES.clickPost(index));
    return result === 'clicked';
  }

  async clickBack(): Promise<boolean> {
    const result = await this.executeJS(JS_TEMPLATES.clickBack);
    await this.wait(2000);
    return result.includes('clicked') || result === 'history_back';
  }

  async commentOnMultiplePosts(
    count: number = 5,
    commentGenerator: (context: { mainPost: string; username: string; replies?: string[] }) => string | Promise<string>,
    delayBetweenMs: number = 30000
  ): Promise<Array<{ success: boolean; username: string; comment: string; error?: string }>> {
    const results: Array<{ success: boolean; username: string; comment: string; error?: string }> = [];
    
    console.log(`[Threads] Starting multi-post commenting (${count} posts)...`);
    
    // Navigate to feed first
    await this.navigateToPost('https://www.threads.com');
    await this.wait(3000);
    
    for (let i = 0; i < count; i++) {
      console.log(`\n[Threads] === Post ${i + 1}/${count} ===`);
      
      try {
        // Find posts
        const posts = await this.findPosts(10);
        if (posts.length <= i) {
          // Scroll to load more
          await this.scroll();
          await this.wait(2000);
        }
        
        // Click into post
        const clickedIndex = i % Math.max(posts.length, 1);
        console.log(`[Threads] Clicking post ${clickedIndex}: @${posts[clickedIndex]?.username || 'unknown'}`);
        const clicked = await this.clickPost(clickedIndex);
        if (!clicked) {
          results.push({ success: false, username: '', comment: '', error: 'Failed to click post' });
          continue;
        }
        
        await this.wait(3000);
        
        // Get context
        const context = await this.getContext();
        console.log(`[Threads] Post: "${context.mainPost.substring(0, 50)}..."`);
        
        // Generate comment (may be async)
        const comment = await Promise.resolve(commentGenerator(context));
        console.log(`[Threads] Comment: "${comment}"`);
        
        // Post comment
        const result = await this.postComment(comment);
        
        results.push({
          success: result.success,
          username: context.username,
          comment: comment,
          error: result.error,
        });
        
        // Click back to feed
        console.log(`[Threads] Clicking back...`);
        await this.clickBack();
        await this.wait(2000);
        
        // Scroll down to get fresh posts
        await this.scroll();
        await this.wait(1000);
        
        // Delay between posts (except last one)
        if (i < count - 1) {
          console.log(`[Threads] Waiting ${delayBetweenMs / 1000}s before next post...`);
          await this.wait(delayBetweenMs);
        }
        
      } catch (error) {
        results.push({
          success: false,
          username: '',
          comment: '',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    
    console.log(`\n[Threads] Multi-post commenting complete: ${results.filter(r => r.success).length}/${count} successful`);
    return results;
  }

  async postComment(text: string): Promise<CommentResult> {
    // Flow from python/engagement/threads_engagement.py engage_with_post()
    try {
      console.log(`[Threads] Posting comment: "${text.substring(0, 50)}..."`);

      // Check rate limits
      const rateCheck = this.checkRateLimit();
      if (!rateCheck.allowed) {
        return { success: false, error: rateCheck.reason };
      }

      // Step 1: Click reply button (from JS_CLICK_REPLY)
      console.log(`[Threads] Step 1: Clicking reply button...`);
      const clickResult = await this.executeJS(JS_TEMPLATES.clickReplyButton);
      console.log(`[Threads]   Result: ${clickResult}`);
      if (clickResult !== 'clicked') {
        return { success: false, error: 'Reply button not found' };
      }

      await this.wait(2000); // Wait for composer to open

      // Step 2: Focus the input (from JS_FOCUS_INPUT)
      console.log(`[Threads] Step 2: Focusing input...`);
      const focusResult = await this.executeJS(JS_TEMPLATES.focusInput);
      console.log(`[Threads]   Result: ${focusResult}`);
      if (focusResult !== 'focused') {
        return { success: false, error: 'Could not focus reply input' };
      }

      await this.wait(500);

      // Step 3: Type via clipboard (from safari_controller.py type_via_clipboard)
      console.log(`[Threads] Step 3: Typing via clipboard...`);
      const typeSuccess = await this.typeViaClipboard(text);
      console.log(`[Threads]   Result: ${typeSuccess ? 'typed' : 'failed'}`);
      if (!typeSuccess) {
        return { success: false, error: 'Failed to type comment' };
      }

      await this.wait(1000);

      // Step 4: Click expand button (from JS_CLICK_EXPAND)
      console.log(`[Threads] Step 4: Expanding composer...`);
      const expandResult = await this.executeJS(JS_TEMPLATES.clickExpand);
      console.log(`[Threads]   Result: ${expandResult}`);

      await this.wait(1000);

      // Step 5: Submit (from JS_SUBMIT with multiple strategies)
      console.log(`[Threads] Step 5: Submitting...`);
      const submitResult = await this.executeJS(JS_TEMPLATES.submitReply);
      console.log(`[Threads]   Result: ${submitResult}`);

      const posted = submitResult.includes('clicked');
      if (!posted) {
        return { success: false, error: 'Submit button not found' };
      }

      // Wait for comment to post
      await this.wait(3000);

      // Log the comment
      this.commentLog.push({ timestamp: new Date() });

      const commentId = `th_${Date.now()}`;
      console.log(`[Threads] ✅ Comment posted: ${commentId}`);

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

  getRateLimits(): { commentsThisHour: number; commentsToday: number; limits: ThreadsConfig } {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    return {
      commentsThisHour: this.commentLog.filter(c => c.timestamp > oneHourAgo).length,
      commentsToday: this.commentLog.filter(c => c.timestamp > oneDayAgo).length,
      limits: this.config,
    };
  }

  setConfig(updates: Partial<ThreadsConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  getConfig(): ThreadsConfig {
    return { ...this.config };
  }
}
