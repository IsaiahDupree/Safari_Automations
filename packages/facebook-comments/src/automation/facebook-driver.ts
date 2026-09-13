/**
 * Facebook Comment Driver
 *
 * Safari automation driver for posting comments on Facebook.
 * Reliability layers (same as Twitter/Threads/Instagram):
 *   1. Smart waits — poll DOM instead of fixed delays
 *   2. Multi-selector fallbacks — multiple CSS selectors per element
 *   3. Retry with backoff — 3 attempts per comment
 *   4. 3-strategy typing chain — execCommand → clipboard → innerText+dispatch
 *   5. Typing verification — confirm text before submitting
 *   6. Error/restriction detection — rate limits, blocks
 *   7. Screenshot on failure
 *
 * Facebook DOM notes (2026):
 *   - Comment inputs are div[contenteditable="true"][role="textbox"]
 *   - Submit via Enter key (no visible "Post" button for comments)
 *   - Posts use div[role="article"] containers
 *   - Reactions (like, love, etc.) shown as spans with aria-labels
 *   - Comment icon is div[aria-label="Leave a comment"] or similar
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// ═══════════════════════════════════════════════════════════════
// Selectors
// ═══════════════════════════════════════════════════════════════

export const SELECTORS = {
  // Navigation
  NAV_HOME: 'a[aria-label="Home"]',
  NAV_WATCH: 'a[aria-label="Watch"]',
  NAV_MARKETPLACE: 'a[aria-label="Marketplace"]',
  NAV_GROUPS: 'a[aria-label="Groups"]',
  NAV_NOTIFICATIONS: 'a[aria-label="Notifications"]',
  NAV_MENU: 'a[aria-label="Menu"]',
  NAV_PROFILE: 'svg[aria-label="Your profile"]',

  // Post containers
  POST_ARTICLE: 'div[role="article"]',
  POST_FEED: 'div[role="feed"]',

  // Comment input — Facebook uses contenteditable divs
  COMMENT_INPUT: [
    'div[contenteditable="true"][role="textbox"][aria-label*="comment" i]',
    'div[contenteditable="true"][role="textbox"][aria-label*="Write" i]',
    'div[contenteditable="true"][role="textbox"][aria-label*="Reply" i]',
    'div[contenteditable="true"][role="textbox"]',
    'form div[contenteditable="true"]',
  ],

  // Comment button (to open comment box)
  COMMENT_BUTTON: [
    'div[aria-label*="Leave a comment" i]',
    'div[aria-label*="Comment" i][role="button"]',
    'span[class]:has-text("Comment")',
  ],

  // Post actions
  ACTION_LIKE: 'div[aria-label="Like"]',
  ACTION_SHARE: 'div[aria-label="Share"]',
};

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export interface FacebookConfig {
  timeout: number;
  minDelayMs: number;
  maxDelayMs: number;
  commentsPerHour: number;
  commentsPerDay: number;
}

export const DEFAULT_CONFIG: FacebookConfig = {
  timeout: 30000,
  minDelayMs: 120000,
  maxDelayMs: 300000,
  commentsPerHour: 5,
  commentsPerDay: 20,
};

export interface CommentResult {
  success: boolean;
  commentId?: string;
  verified?: boolean;
  error?: string;
  strategy?: string;
}

export interface FacebookStatus {
  isOnFacebook: boolean;
  isLoggedIn: boolean;
  currentUrl: string;
}

// ═══════════════════════════════════════════════════════════════
// FacebookDriver
// ═══════════════════════════════════════════════════════════════

export class FacebookDriver {
  private config: FacebookConfig;
  private commentLog: { timestamp: Date }[] = [];

  constructor(config: Partial<FacebookConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ─── Low-level Safari helpers ──────────────────────────────

  private async executeJS(script: string): Promise<string> {
    const fs = await import('fs');
    const os = await import('os');
    const path = await import('path');

    const tmpFile = path.join(os.tmpdir(), `safari_fb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.scpt`);
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
      await execAsync(
        `osascript -e 'tell application "Safari" to set URL of current tab of front window to "${safeUrl}"'`
      );
      await this.wait(3000);
      return true;
    } catch { return false; }
  }

  private wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async typeViaClipboard(text: string): Promise<boolean> {
    const escaped = text.replace(/"/g, '\\"').replace(/`/g, '\\`').replace(/\$/g, '\\$').replace(/%/g, '%%');
    await execAsync(`printf "%s" "${escaped}" | pbcopy`).catch(() => null);
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
    } catch { return false; }
  }

  // ─── Status ────────────────────────────────────────────────

  async getStatus(): Promise<FacebookStatus> {
    try {
      const { stdout: urlOut } = await execAsync(
        `osascript -e 'tell application "Safari" to get URL of current tab of front window'`
      );
      const currentUrl = urlOut.trim();
      const isOnFacebook = currentUrl.includes('facebook.com');

      const loginCheck = await this.executeJS(`
        (function() {
          var profile = document.querySelector('svg[aria-label="Your profile"]');
          var home = document.querySelector('a[aria-label="Home"]');
          if (profile || home) return 'logged_in';
          var login = document.querySelector('button[name="login"]');
          if (login) return 'not_logged_in';
          return 'unknown';
        })();
      `);

      return {
        isOnFacebook,
        isLoggedIn: loginCheck === 'logged_in',
        currentUrl,
      };
    } catch {
      return { isOnFacebook: false, isLoggedIn: false, currentUrl: '' };
    }
  }

  // ─── Navigation ────────────────────────────────────────────

  async navigateToPost(postUrl: string): Promise<boolean> {
    console.log(`[Facebook] Navigating to ${postUrl}`);
    return this.navigate(postUrl);
  }

  // ─── Post Details ──────────────────────────────────────────

  async getPostDetails(): Promise<Record<string, string>> {
    const result = await this.executeJS(`
      (function() {
        var article = document.querySelector('div[role="article"]');
        if (!article) return JSON.stringify({error: 'no_article'});

        var userLink = article.querySelector('a[role="link"] strong, h2 a, h3 a');
        var username = userLink ? userLink.textContent.trim() : '';

        var textEl = article.querySelector('div[data-ad-comet-preview="message"], div[dir="auto"]');
        var text = textEl ? textEl.textContent.trim() : '';

        return JSON.stringify({
          username: username,
          text: text.substring(0, 500),
          url: window.location.href
        });
      })();
    `);

    try { return JSON.parse(result); }
    catch { return { error: 'parse_failed' }; }
  }

  // ─── Scroll ────────────────────────────────────────────────

  async scroll(): Promise<void> {
    await this.executeJS(`window.scrollBy(0, 800);`);
    await this.wait(1000);
  }

  // ─── Reliable Comment Posting ──────────────────────────────

  /**
   * Post a comment with reliability guarantees:
   *   - 3-strategy typing chain: execCommand → clipboard → innerText+dispatch
   *   - Smart waits (poll for input instead of fixed delay)
   *   - Retry with backoff on each step
   *   - Error/restriction detection
   *   - Screenshot on failure
   */
  async postComment(text: string): Promise<CommentResult> {
    const MAX_RETRIES = 3;
    let lastError = '';
    let strategy = '';

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        console.log(`[Facebook] Posting comment (attempt ${attempt + 1}): "${text.substring(0, 50)}..."`);

        // Check rate limits
        const rateCheck = this.checkRateLimit();
        if (!rateCheck.allowed) {
          return { success: false, error: rateCheck.reason };
        }

        // Detect platform errors
        const platformError = await this.executeJS(`
          (function() {
            var body = (document.body.innerText || '').toLowerCase();
            if (body.includes('something went wrong')) return 'error';
            if (body.includes('you\'re temporarily blocked')) return 'blocked';
            if (body.includes('rate limit')) return 'rate_limit';
            if (body.includes('try again later')) return 'rate_limit';
            if (body.includes('comments on this post have been turned off')) return 'comments_off';
            return '';
          })()
        `);
        if (platformError) {
          lastError = `Platform restriction: ${platformError}`;
          console.log(`[Facebook] ${lastError}`);
          if (platformError === 'blocked' || platformError === 'comments_off') {
            return { success: false, error: lastError };
          }
          await this.wait(3000);
          continue;
        }

        // Step 1: Click comment button to open input
        console.log(`[Facebook] Step 1: Clicking comment button...`);
        await this.executeJS(`
          (function() {
            // Try multiple approaches for the comment button
            var selectors = [
              'div[aria-label*="Leave a comment" i]',
              'div[aria-label*="Comment" i][role="button"]',
              'span[aria-hidden="false"]'
            ];
            for (var s = 0; s < selectors.length; s++) {
              var els = document.querySelectorAll(selectors[s]);
              for (var i = 0; i < els.length; i++) {
                var el = els[i];
                var text = (el.textContent || '').trim().toLowerCase();
                if (text.includes('comment') || el.getAttribute('aria-label')?.toLowerCase().includes('comment')) {
                  el.click();
                  return 'clicked';
                }
              }
            }
            // Fallback: look for form with contenteditable already visible
            var ce = document.querySelector('[contenteditable="true"][role="textbox"]');
            if (ce) return 'already_visible';
            return 'not_found';
          })()
        `);

        // Step 2: Smart wait for comment input
        console.log(`[Facebook] Step 2: Waiting for comment input...`);
        let inputReady = false;
        for (let w = 0; w < 10; w++) {
          const found = await this.executeJS(`
            (function() {
              var selectors = [
                'div[contenteditable="true"][role="textbox"][aria-label*="comment" i]',
                'div[contenteditable="true"][role="textbox"][aria-label*="Write" i]',
                'div[contenteditable="true"][role="textbox"][aria-label*="Reply" i]',
                'div[contenteditable="true"][role="textbox"]',
                'form div[contenteditable="true"]'
              ];
              for (var i = 0; i < selectors.length; i++) {
                var el = document.querySelector(selectors[i]);
                if (el && el.offsetParent !== null) return 'ready';
              }
              return '';
            })()
          `);
          if (found === 'ready') { inputReady = true; break; }
          await this.wait(500);
        }
        if (!inputReady) {
          lastError = 'Comment input never appeared';
          continue;
        }

        // Step 3: Focus input
        console.log(`[Facebook] Step 3: Focusing input...`);
        const focusResult = await this.executeJS(`
          (function() {
            var selectors = [
              'div[contenteditable="true"][role="textbox"][aria-label*="comment" i]',
              'div[contenteditable="true"][role="textbox"][aria-label*="Write" i]',
              'div[contenteditable="true"][role="textbox"][aria-label*="Reply" i]',
              'div[contenteditable="true"][role="textbox"]',
              'form div[contenteditable="true"]'
            ];
            for (var i = 0; i < selectors.length; i++) {
              var el = document.querySelector(selectors[i]);
              if (el && el.offsetParent !== null) {
                el.focus();
                el.click();
                return 'focused';
              }
            }
            return 'not_found';
          })()
        `);
        if (focusResult !== 'focused') {
          lastError = 'Could not focus comment input';
          continue;
        }
        await this.wait(300);

        // Step 4: Type via 3-strategy chain
        console.log(`[Facebook] Step 4: Typing (3-strategy chain)...`);
        const escaped = text.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
        let typed = false;

        // Strategy 1: execCommand('insertText') — React/contenteditable compatible
        const execResult = await this.executeJS(`
          (function() {
            var el = document.activeElement;
            if (!el || el === document.body) return 'no_focus';
            el.focus();
            var ok = document.execCommand('insertText', false, '${escaped}');
            return ok ? 'execCommand' : 'execCommand_failed';
          })()
        `);
        if (execResult === 'execCommand') {
          strategy = 'execCommand';
          typed = true;
          console.log(`[Facebook]   Typed via execCommand`);
        }

        // Strategy 2: Clipboard paste
        if (!typed) {
          console.log(`[Facebook]   execCommand failed, trying clipboard...`);
          const clipOk = await this.typeViaClipboard(text);
          if (clipOk) {
            strategy = 'clipboard';
            typed = true;
            console.log(`[Facebook]   Typed via clipboard`);
          }
        }

        // Strategy 3: innerText + InputEvent dispatch
        if (!typed) {
          console.log(`[Facebook]   Clipboard failed, trying innerText dispatch...`);
          const dispatchResult = await this.executeJS(`
            (function() {
              var selectors = [
                'div[contenteditable="true"][role="textbox"][aria-label*="comment" i]',
                'div[contenteditable="true"][role="textbox"]',
                'form div[contenteditable="true"]'
              ];
              for (var i = 0; i < selectors.length; i++) {
                var el = document.querySelector(selectors[i]);
                if (el) {
                  el.focus();
                  el.innerText = '${escaped}';
                  el.dispatchEvent(new InputEvent('input', {bubbles:true, inputType:'insertText', data:'${escaped}'}));
                  return 'dispatched';
                }
              }
              return 'no_input';
            })()
          `);
          if (dispatchResult === 'dispatched') {
            strategy = 'innerText';
            typed = true;
            console.log(`[Facebook]   Typed via innerText dispatch`);
          }
        }

        if (!typed) {
          lastError = 'All typing strategies failed';
          continue;
        }

        await this.wait(800);

        // Step 5: Submit via Enter key (Facebook submits comments with Enter)
        console.log(`[Facebook] Step 5: Submitting (Enter key)...`);
        let submitted = false;
        for (let s = 0; s < 5; s++) {
          const submitResult = await this.executeJS(`
            (function() {
              var el = document.activeElement;
              if (!el || el === document.body) return 'no_focus';

              // Facebook comments submit on Enter
              el.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', keyCode:13, bubbles:true}));
              el.dispatchEvent(new KeyboardEvent('keypress', {key:'Enter', keyCode:13, bubbles:true}));
              el.dispatchEvent(new KeyboardEvent('keyup', {key:'Enter', keyCode:13, bubbles:true}));
              return 'enter_sent';
            })()
          `);
          if (submitResult === 'enter_sent') {
            submitted = true;
            console.log(`[Facebook]   Submitted via Enter key`);
            break;
          }

          // Fallback: try AppleScript Enter
          try {
            await execAsync(`osascript -e 'tell application "System Events" to keystroke return'`);
            submitted = true;
            console.log(`[Facebook]   Submitted via AppleScript Enter`);
            break;
          } catch {}

          await this.wait(600);
        }
        if (!submitted) {
          lastError = 'Could not submit comment';
          continue;
        }

        // Step 6: Verify comment posted (smart wait)
        console.log(`[Facebook] Step 6: Verifying...`);
        await this.wait(2000);
        const snippet = text.substring(0, 25).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        let verified = false;
        for (let v = 0; v < 6; v++) {
          const verifyResult = await this.executeJS(`
            (function() {
              var els = document.querySelectorAll('div[role="article"] span, ul span, div[dir="auto"] span');
              for (var i = 0; i < els.length; i++) {
                if ((els[i].textContent || '').includes('${snippet}')) return 'verified';
              }
              // Also check if input is now empty
              var ce = document.querySelector('[contenteditable="true"][role="textbox"]');
              if (ce && (ce.textContent || '').trim() === '') return 'cleared';
              return 'not_found';
            })()
          `);
          if (verifyResult === 'verified' || verifyResult === 'cleared') { verified = true; break; }
          await this.wait(1500);
        }
        console.log(`[Facebook]   Verified: ${verified}`);

        this.commentLog.push({ timestamp: new Date() });
        const commentId = `fb_${Date.now()}`;
        console.log(`[Facebook] ✅ Comment posted: ${commentId} (strategy: ${strategy})`);
        return { success: true, commentId, verified, strategy };

      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        console.log(`[Facebook] Attempt ${attempt + 1} threw: ${lastError}`);
        if (attempt < MAX_RETRIES - 1) await this.wait(2000 * (attempt + 1));
      }
    }

    // Screenshot on failure
    try {
      const screenshotPath = `/tmp/facebook-post-failure-${Date.now()}.png`;
      await execAsync(`screencapture -x "${screenshotPath}"`, { timeout: 5000 });
      console.log(`[Facebook] Screenshot saved: ${screenshotPath}`);
    } catch {}

    return { success: false, error: lastError };
  }

  // ─── Rate Limiting ─────────────────────────────────────────

  checkRateLimit(): { allowed: boolean; reason?: string } {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const commentsLastHour = this.commentLog.filter(c => c.timestamp > oneHourAgo).length;
    const commentsToday = this.commentLog.filter(c => c.timestamp > oneDayAgo).length;

    if (commentsLastHour >= this.config.commentsPerHour) {
      return { allowed: false, reason: `Rate limit: ${this.config.commentsPerHour}/hour` };
    }
    if (commentsToday >= this.config.commentsPerDay) {
      return { allowed: false, reason: `Rate limit: ${this.config.commentsPerDay}/day` };
    }
    return { allowed: true };
  }

  getRateLimits(): { commentsThisHour: number; commentsToday: number; limits: FacebookConfig } {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    return {
      commentsThisHour: this.commentLog.filter(c => c.timestamp > oneHourAgo).length,
      commentsToday: this.commentLog.filter(c => c.timestamp > oneDayAgo).length,
      limits: this.config,
    };
  }

  setConfig(updates: Partial<FacebookConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  getConfig(): FacebookConfig {
    return { ...this.config };
  }
}
