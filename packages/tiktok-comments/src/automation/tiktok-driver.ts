/**
 * TikTok Comment Driver - Safari automation for TikTok comments
 */
import { exec } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);

export const SELECTORS = {
  COMMENT_INPUT: '[data-e2e="comment-input"]',
  COMMENT_POST: '[data-e2e="comment-post"]',
  COMMENT_ITEM: '[data-e2e="comment-item"]',
  VIDEO_CONTAINER: '[data-e2e="browse-video"]',
};

export interface TikTokConfig {
  timeout: number;
  minDelayMs: number;
  maxDelayMs: number;
  commentsPerHour: number;
  commentsPerDay: number;
}

export const DEFAULT_CONFIG: TikTokConfig = {
  timeout: 30000,
  minDelayMs: 180000,
  maxDelayMs: 300000,
  commentsPerHour: 5,
  commentsPerDay: 15,
};

export class TikTokDriver {
  private config: TikTokConfig;
  private commentLog: { timestamp: Date }[] = [];

  constructor(config: Partial<TikTokConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  private async executeJS(script: string): Promise<string> {
    // Use temp file approach to avoid shell escaping issues (same as ThreadsDriver)
    const fs = await import('fs');
    const os = await import('os');
    const path = await import('path');
    
    const tmpFile = path.join(os.tmpdir(), `safari_js_${Date.now()}_${Math.random().toString(36).substr(2, 6)}.scpt`);
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
      const safeUrl = url.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      await execAsync(`osascript -e 'tell application "Safari" to set URL of current tab of front window to "${safeUrl}"'`);
      await new Promise(r => setTimeout(r, 3000));
      return true;
    } catch { return false; }
  }

  async getStatus(): Promise<{ isOnTikTok: boolean; isLoggedIn: boolean; currentUrl: string }> {
    try {
      const { stdout } = await execAsync(`osascript -e 'tell application "Safari" to get URL of current tab of front window'`);
      const currentUrl = stdout.trim();
      const isOnTikTok = currentUrl.includes('tiktok.com');
      // Check for login indicators that work on any TikTok page, not just video pages
      const loginCheck = await this.executeJS(`
        (function() {
          if (document.querySelector('[data-e2e="upload-icon"]')) return 'logged_in';
          if (document.querySelector('a[href*="/upload"]')) return 'logged_in';
          if (document.querySelector('[data-e2e="comment-input"]')) return 'logged_in';
          if (document.querySelector('button[id="header-login-button"]')) return 'not_logged_in';
          return 'unknown';
        })();
      `);
      return { isOnTikTok, isLoggedIn: loginCheck === 'logged_in', currentUrl };
    } catch { return { isOnTikTok: false, isLoggedIn: false, currentUrl: '' }; }
  }

  async navigateToPost(postUrl: string): Promise<boolean> {
    console.log(`[TikTok] Navigating to ${postUrl}`);
    return this.navigate(postUrl);
  }

  async getComments(limit = 50): Promise<Array<{ username: string; text: string }>> {
    const result = await this.executeJS(`
      (function() {
        var comments = [];
        var items = document.querySelectorAll('[data-e2e="comment-item"]');
        for (var i = 0; i < Math.min(items.length, ${limit}); i++) {
          var user = items[i].querySelector('a[href*="/@"]');
          var text = items[i].querySelector('p, span');
          if (user && text) comments.push({ username: user.href.split('/@').pop(), text: text.innerText.substring(0, 500) });
        }
        return JSON.stringify(comments);
      })();
    `);
    try { return JSON.parse(result); } catch { return []; }
  }

  private async typeViaClipboard(text: string): Promise<boolean> {
    const escaped = text.replace(/"/g, '\\"').replace(/`/g, '\\`').replace(/\$/g, '\\$').replace(/%/g, '%%');
    try {
      await execAsync(`printf "%s" "${escaped}" | pbcopy`);
      await new Promise(r => setTimeout(r, 200));
      await execAsync(`osascript -e 'tell application "Safari" to activate'`);
      await new Promise(r => setTimeout(r, 200));
      await execAsync(`osascript -e 'tell application "System Events" to keystroke "v" using command down'`);
      return true;
    } catch { return false; }
  }

  private wait(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
  }

  /**
   * Post a comment with reliability guarantees:
   *   - 3-strategy typing chain: execCommand → clipboard → innerText+dispatch
   *   - Smart waits (poll for input instead of fixed delay)
   *   - Retry with backoff on each step
   *   - Error/restriction detection
   *   - Screenshot on failure
   */
  async postComment(text: string): Promise<{ success: boolean; commentId?: string; error?: string; verified?: boolean; strategy?: string }> {
    const MAX_RETRIES = 3;
    let lastError = '';
    let strategy = '';

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        console.log(`[TikTok] Posting comment (attempt ${attempt + 1}): "${text.substring(0, 50)}..."`);

        const rateCheck = this.checkRateLimit();
        if (!rateCheck.allowed) return { success: false, error: rateCheck.reason };

        // Detect platform errors
        const platformError = await this.executeJS(`
          (function() {
            var body = (document.body.innerText || '').toLowerCase();
            if (body.includes('something went wrong')) return 'error';
            if (body.includes('too many comments')) return 'rate_limit';
            if (body.includes('comments are turned off')) return 'comments_off';
            if (body.includes('log in to comment')) return 'not_logged_in';
            return '';
          })()
        `);
        if (platformError) {
          lastError = `Platform restriction: ${platformError}`;
          console.log(`[TikTok] ${lastError}`);
          if (platformError === 'comments_off' || platformError === 'not_logged_in') {
            return { success: false, error: lastError };
          }
          await this.wait(3000);
          continue;
        }

        // Step 1: Smart wait for comment input
        console.log(`[TikTok] Step 1: Waiting for comment input...`);
        let inputReady = false;
        for (let w = 0; w < 10; w++) {
          const found = await this.executeJS(`
            (function() {
              var selectors = [
                '[data-e2e="comment-input"]',
                'div[contenteditable="true"][data-e2e]',
                'div[contenteditable="true"][role="textbox"]',
                'div[class*="comment"][contenteditable="true"]',
                'div[contenteditable="true"]'
              ];
              for (var i = 0; i < selectors.length; i++) {
                var el = document.querySelector(selectors[i]);
                if (el && el.offsetParent !== null) return 'ready';
              }
              return '';
            })()
          `);
          if (found === 'ready') { inputReady = true; break; }
          await this.wait(400);
        }
        if (!inputReady) {
          lastError = 'Comment input never appeared';
          continue;
        }

        // Step 2: Focus input
        console.log(`[TikTok] Step 2: Focusing input...`);
        const focusResult = await this.executeJS(`
          (function() {
            var selectors = [
              '[data-e2e="comment-input"]',
              'div[contenteditable="true"][data-e2e]',
              'div[contenteditable="true"][role="textbox"]',
              'div[class*="comment"][contenteditable="true"]',
              'div[contenteditable="true"]'
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

        // Step 3: Type via 3-strategy chain
        console.log(`[TikTok] Step 3: Typing (3-strategy chain)...`);
        const escaped = text.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
        let typed = false;

        // Strategy 1: execCommand('insertText')
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
          console.log(`[TikTok]   Typed via execCommand`);
        }

        // Strategy 2: Clipboard paste
        if (!typed) {
          console.log(`[TikTok]   execCommand failed, trying clipboard...`);
          const clipOk = await this.typeViaClipboard(text);
          if (clipOk) {
            strategy = 'clipboard';
            typed = true;
            console.log(`[TikTok]   Typed via clipboard`);
          }
        }

        // Strategy 3: innerText + InputEvent dispatch
        if (!typed) {
          console.log(`[TikTok]   Clipboard failed, trying innerText dispatch...`);
          const dispatchResult = await this.executeJS(`
            (function() {
              var selectors = [
                '[data-e2e="comment-input"]',
                'div[contenteditable="true"][data-e2e]',
                'div[contenteditable="true"]'
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
            console.log(`[TikTok]   Typed via innerText dispatch`);
          }
        }

        if (!typed) {
          lastError = 'All typing strategies failed';
          continue;
        }

        await this.wait(800);

        // Step 4: Submit with retry
        console.log(`[TikTok] Step 4: Submitting...`);
        let submitted = false;
        for (let s = 0; s < 5; s++) {
          const submitResult = await this.executeJS(`
            (function() {
              // Strategy 1: data-e2e post button
              var btn = document.querySelector('[data-e2e="comment-post"]');
              if (btn && !btn.disabled) { btn.click(); return 'clicked_post'; }
              // Strategy 2: any button near the comment input with "Post" text
              var buttons = document.querySelectorAll('button, div[role="button"]');
              for (var i = 0; i < buttons.length; i++) {
                var t = (buttons[i].textContent || '').trim().toLowerCase();
                if (t === 'post' && !buttons[i].disabled) { buttons[i].click(); return 'clicked_text'; }
              }
              // Strategy 3: Enter key (some TikTok comment forms accept Enter)
              var el = document.activeElement;
              if (el) {
                el.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', keyCode:13, bubbles:true}));
                return 'enter_sent';
              }
              return 'not_found';
            })()
          `);
          if (submitResult.includes('clicked') || submitResult === 'enter_sent') {
            submitted = true;
            console.log(`[TikTok]   Submitted via: ${submitResult}`);
            break;
          }
          await this.wait(600);
        }
        if (!submitted) {
          lastError = 'Submit button not found or disabled';
          continue;
        }

        // Step 5: Verify comment posted (smart wait)
        console.log(`[TikTok] Step 5: Verifying...`);
        await this.wait(2000);
        const snippet = text.substring(0, 25).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        let verified = false;
        for (let v = 0; v < 6; v++) {
          const verifyResult = await this.executeJS(`
            (function() {
              var items = document.querySelectorAll('[data-e2e="comment-item"], div[class*="CommentItem"], div[class*="comment-item"]');
              for (var i = 0; i < items.length; i++) {
                if ((items[i].innerText || '').includes('${snippet}')) return 'verified';
              }
              // Check if input is now empty
              var input = document.querySelector('[data-e2e="comment-input"], div[contenteditable="true"]');
              if (input && (input.textContent || '').trim() === '') return 'cleared';
              return 'not_found';
            })()
          `);
          if (verifyResult === 'verified' || verifyResult === 'cleared') { verified = true; break; }
          await this.wait(1500);
        }
        console.log(`[TikTok]   Verified: ${verified}`);

        this.commentLog.push({ timestamp: new Date() });
        const commentId = `tt_${Date.now()}`;
        console.log(`[TikTok] ✅ Comment posted: ${commentId} (strategy: ${strategy})`);
        return { success: true, commentId, verified, strategy };

      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        console.log(`[TikTok] Attempt ${attempt + 1} threw: ${lastError}`);
        if (attempt < MAX_RETRIES - 1) await this.wait(2000 * (attempt + 1));
      }
    }

    // Screenshot on failure
    try {
      const screenshotPath = `/tmp/tiktok-post-failure-${Date.now()}.png`;
      await execAsync(`screencapture -x "${screenshotPath}"`, { timeout: 5000 });
      console.log(`[TikTok] Screenshot saved: ${screenshotPath}`);
    } catch {}

    return { success: false, error: lastError };
  }

  checkRateLimit(): { allowed: boolean; reason?: string } {
    const now = new Date();
    const hourAgo = new Date(now.getTime() - 3600000);
    const dayAgo = new Date(now.getTime() - 86400000);
    if (this.commentLog.filter(c => c.timestamp > hourAgo).length >= this.config.commentsPerHour) return { allowed: false, reason: `${this.config.commentsPerHour}/hr limit` };
    if (this.commentLog.filter(c => c.timestamp > dayAgo).length >= this.config.commentsPerDay) return { allowed: false, reason: `${this.config.commentsPerDay}/day limit` };
    return { allowed: true };
  }

  getRateLimits() {
    const now = new Date();
    return {
      commentsThisHour: this.commentLog.filter(c => c.timestamp > new Date(now.getTime() - 3600000)).length,
      commentsToday: this.commentLog.filter(c => c.timestamp > new Date(now.getTime() - 86400000)).length,
      limits: this.config,
    };
  }

  setConfig(updates: Partial<TikTokConfig>): void { this.config = { ...this.config, ...updates }; }
  getConfig(): TikTokConfig { return { ...this.config }; }
}
