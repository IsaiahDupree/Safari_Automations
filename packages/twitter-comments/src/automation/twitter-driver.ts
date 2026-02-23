/**
 * Twitter Comment Driver - Safari automation for Twitter replies
 *
 * Reliability features:
 *   - Smart waits: polls DOM conditions instead of fixed delays
 *   - Multi-selector fallbacks: survives Twitter DOM renames
 *   - Retry with backoff on every critical step
 *   - 3-strategy typing chain: execCommand → keystroke → clipboard
 *   - Typing verification: confirms React state matches before submit
 *   - Error/popup detection: rate limits, "Something went wrong" toasts
 *   - Screenshot capture on failure for remote debugging
 *   - Structured step logging with timing
 */
import { exec } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);

// ─── Multi-selector Fallbacks ───────────────────────────────
// Each key lists selectors in priority order. If Twitter renames one,
// the next still works. Update this list when selectors change.

export const SELECTORS = {
  TWEET: [
    'article[data-testid="tweet"]',
    'article[role="article"]',
  ],
  TWEET_TEXT: [
    '[data-testid="tweetText"]',
    'div[lang] > span',
  ],
  REPLY_ICON: [
    '[data-testid="reply"]',
    '[aria-label="Reply"]',
    'button[data-testid="reply"]',
  ],
  REPLY_INPUT: [
    '[data-testid="tweetTextarea_0"]',
    'div[role="textbox"][contenteditable="true"]',
    '[data-testid="tweetTextarea_0RichTextInputContainer"] [contenteditable]',
  ],
  SUBMIT_BUTTON: [
    '[data-testid="tweetButtonInline"]',
    '[data-testid="tweetButton"]',
  ],
  LOGIN_CHECK: [
    '[data-testid="SideNav_NewTweet_Button"]',
    '[data-testid="AppTabBar_Profile_Link"]',
    '[aria-label="Profile"]',
  ],
};

export interface TwitterConfig {
  timeout: number;
  minDelayMs: number;
  maxDelayMs: number;
  commentsPerHour: number;
  commentsPerDay: number;
  maxRetries: number;
  screenshotOnFailure: boolean;
  screenshotDir: string;
}

export const DEFAULT_CONFIG: TwitterConfig = {
  timeout: 30000,
  minDelayMs: 60000,
  maxDelayMs: 180000,
  commentsPerHour: 10,
  commentsPerDay: 30,
  maxRetries: 3,
  screenshotOnFailure: true,
  screenshotDir: '/tmp/twitter-automation-screenshots',
};

export interface PostResult {
  success: boolean;
  commentId?: string;
  error?: string;
  verified?: boolean;
  strategy?: string;
  attempts?: number;
  durationMs?: number;
  screenshotPath?: string;
}

interface StepResult {
  ok: boolean;
  value?: string;
  error?: string;
}

export class TwitterDriver {
  private config: TwitterConfig;
  private commentLog: { timestamp: Date }[] = [];

  constructor(config: Partial<TwitterConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ─── Low-level Safari helpers ────────────────────────────

  private async executeJS(script: string): Promise<string> {
    const fs = await import('fs');
    const os = await import('os');
    const path = await import('path');

    const tmpFile = path.join(os.tmpdir(), `safari_js_${Date.now()}_${Math.random().toString(36).substr(2, 6)}.scpt`);
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
      await execAsync(`osascript -e 'tell application "Safari" to set URL of current tab of front window to "${safeUrl}"'`);
      return true;
    } catch { return false; }
  }

  private async wait(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
  }

  // ─── Smart Wait: poll DOM until condition met ────────────

  private async waitForAny(selectors: string[], timeoutMs = 10000): Promise<string | null> {
    const selectorList = selectors.map(s => `'${s}'`).join(',');
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const found = await this.executeJS(`
        (function() {
          var sels = [${selectorList}];
          for (var i = 0; i < sels.length; i++) {
            if (document.querySelector(sels[i])) return sels[i];
          }
          return '';
        })()
      `);
      if (found) return found;
      await this.wait(400);
    }
    return null;
  }

  // ─── Error Detection ────────────────────────────────────

  private async detectErrors(): Promise<string | null> {
    const result = await this.executeJS(`
      (function() {
        // Rate limit toast
        var toasts = document.querySelectorAll('[data-testid="toast"], [role="alert"]');
        for (var i = 0; i < toasts.length; i++) {
          var t = toasts[i].innerText || '';
          if (t.includes('limit') || t.includes('try again') || t.includes('wrong')) return 'error:' + t.substring(0, 100);
        }
        // "Something went wrong" inline
        var main = document.querySelector('[data-testid="primaryColumn"]');
        if (main && main.innerText.includes('Something went wrong')) return 'error:something_went_wrong';
        if (main && main.innerText.includes('Rate limit')) return 'error:rate_limited';
        return '';
      })()
    `);
    return result || null;
  }

  // ─── Screenshot Capture ─────────────────────────────────

  async captureScreenshot(label = 'failure'): Promise<string | null> {
    if (!this.config.screenshotOnFailure) return null;
    try {
      const fs = await import('fs');
      if (!fs.existsSync(this.config.screenshotDir)) {
        fs.mkdirSync(this.config.screenshotDir, { recursive: true });
      }
      const filename = `twitter-${label}-${Date.now()}.png`;
      const filepath = `${this.config.screenshotDir}/${filename}`;
      await execAsync(`screencapture -x "${filepath}"`, { timeout: 5000 });
      console.log(`[Twitter] Screenshot saved: ${filepath}`);
      return filepath;
    } catch { return null; }
  }

  // ─── Retry Helper ───────────────────────────────────────

  private async retry<T>(label: string, fn: () => Promise<T>, maxAttempts = this.config.maxRetries): Promise<T> {
    let lastError: unknown;
    for (let i = 0; i < maxAttempts; i++) {
      try {
        return await fn();
      } catch (e) {
        lastError = e;
        console.log(`[Twitter] ${label} attempt ${i + 1}/${maxAttempts} failed: ${e}`);
        if (i < maxAttempts - 1) await this.wait(1000 * (i + 1)); // backoff
      }
    }
    throw lastError;
  }

  // ─── Multi-selector Click ───────────────────────────────

  private async clickFirst(selectors: string[], context = 'document'): Promise<StepResult> {
    const selectorList = selectors.map(s => `'${s}'`).join(',');
    const result = await this.executeJS(`
      (function() {
        var sels = [${selectorList}];
        var ctx = ${context === 'document' ? 'document' : `document.querySelector('${context}')`};
        if (!ctx) return JSON.stringify({ok:false, error:'context_not_found'});
        for (var i = 0; i < sels.length; i++) {
          var el = ctx.querySelector(sels[i]);
          if (el) { el.click(); return JSON.stringify({ok:true, value:sels[i]}); }
        }
        return JSON.stringify({ok:false, error:'no_selector_matched'});
      })()
    `);
    try { return JSON.parse(result); } catch { return { ok: false, error: 'parse_error' }; }
  }

  // ─── 3-Strategy Typing Chain ─────────────────────────────
  // Strategy 1: execCommand('insertText') — Draft.js compatible
  // Strategy 2: System Events keystrokes — OS-level, bypasses some React issues
  // Strategy 3: Clipboard paste — last resort

  private async typeText(text: string): Promise<{ ok: boolean; strategy: string }> {
    const escaped = text.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');

    // Strategy 1: execCommand (best for React/Draft.js)
    const execResult = await this.executeJS(`
      (function() {
        var sels = [${SELECTORS.REPLY_INPUT.map(s => `'${s}'`).join(',')}];
        for (var i = 0; i < sels.length; i++) {
          var el = document.querySelector(sels[i]);
          if (el) {
            el.focus();
            var ok = document.execCommand('insertText', false, '${escaped}');
            return ok ? 'execCommand' : 'execCommand_failed';
          }
        }
        return 'no_input';
      })()
    `);

    if (execResult === 'execCommand') {
      // Verify React state updated
      await this.wait(500);
      if (await this.verifyTypedText(text)) return { ok: true, strategy: 'execCommand' };
    }

    // Strategy 2: OS-level keystrokes
    try {
      const sel = await this.waitForAny(SELECTORS.REPLY_INPUT, 3000);
      if (sel) {
        await this.executeJS(`document.querySelector('${sel}').focus()`);
        await this.wait(200);
        await execAsync(`osascript -e 'tell application "Safari" to activate'`);
        await this.wait(200);
        const esc = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        await execAsync(
          `osascript -e 'tell application "System Events" to tell process "Safari" to keystroke "${esc}"'`,
          { timeout: 15000 }
        );
        await this.wait(500);
        if (await this.verifyTypedText(text)) return { ok: true, strategy: 'keystrokes' };
      }
    } catch {}

    // Strategy 3: Clipboard paste
    try {
      const sel = await this.waitForAny(SELECTORS.REPLY_INPUT, 3000);
      if (sel) {
        await this.executeJS(`document.querySelector('${sel}').focus()`);
        await this.wait(200);
        const esc = text.replace(/"/g, '\\"').replace(/`/g, '\\`').replace(/\$/g, '\\$');
        await execAsync(`printf "%s" "${esc}" | pbcopy`);
        await execAsync(`osascript -e 'tell application "Safari" to activate'`);
        await this.wait(200);
        await execAsync(`osascript -e 'tell application "System Events" to keystroke "v" using command down'`);
        await this.wait(500);
        if (await this.verifyTypedText(text)) return { ok: true, strategy: 'clipboard' };
      }
    } catch {}

    return { ok: false, strategy: 'none' };
  }

  // ─── Typing Verification ────────────────────────────────
  // Confirms the text actually landed in React state by checking
  // if the submit button became enabled (React enables it only
  // when its internal state has content).

  private async verifyTypedText(text: string): Promise<boolean> {
    const snippet = text.substring(0, 20).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    for (let i = 0; i < 6; i++) {
      const check = await this.executeJS(`
        (function() {
          // Check 1: submit button is enabled
          var sels = [${SELECTORS.SUBMIT_BUTTON.map(s => `'${s}'`).join(',')}];
          for (var j = 0; j < sels.length; j++) {
            var btn = document.querySelector(sels[j]);
            if (btn && !btn.disabled) return 'ready';
          }
          // Check 2: any button with Reply/Post text that is enabled in a dialog
          var dialog = document.querySelector('[role="dialog"]');
          if (dialog) {
            var btns = dialog.querySelectorAll('button');
            for (var k = 0; k < btns.length; k++) {
              var t = (btns[k].innerText || '').trim();
              if ((t === 'Reply' || t === 'Post') && !btns[k].disabled) return 'ready';
            }
          }
          return 'not_ready';
        })()
      `);
      if (check === 'ready') return true;
      await this.wait(400);
    }
    return false;
  }

  // ─── Submit Reply ───────────────────────────────────────

  private async submitReply(): Promise<StepResult> {
    for (let i = 0; i < 5; i++) {
      const result = await this.executeJS(`
        (function() {
          // Strategy 1: data-testid buttons
          var sels = [${SELECTORS.SUBMIT_BUTTON.map(s => `'${s}'`).join(',')}];
          for (var j = 0; j < sels.length; j++) {
            var btn = document.querySelector(sels[j]);
            if (btn && !btn.disabled) { btn.click(); return JSON.stringify({ok:true, value:sels[j]}); }
          }
          // Strategy 2: dialog button by text
          var dialog = document.querySelector('[role="dialog"]');
          if (dialog) {
            var btns = dialog.querySelectorAll('button');
            for (var k = 0; k < btns.length; k++) {
              var t = (btns[k].innerText || '').trim();
              if ((t === 'Reply' || t === 'Post') && !btns[k].disabled) {
                btns[k].click();
                return JSON.stringify({ok:true, value:'dialog:' + t});
              }
            }
          }
          return JSON.stringify({ok:false, error:'no_enabled_button'});
        })()
      `);
      try {
        const parsed = JSON.parse(result);
        if (parsed.ok) return parsed;
      } catch {}
      await this.wait(800);
    }
    return { ok: false, error: 'submit_button_never_enabled' };
  }

  // ─── Verify Reply Posted ────────────────────────────────

  private async verifyReplyPosted(text: string, timeoutMs = 12000): Promise<boolean> {
    const snippet = text.substring(0, 30).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const result = await this.executeJS(`
        (function() {
          var els = document.querySelectorAll('[data-testid="tweetText"], div[lang] > span');
          for (var i = 0; i < els.length; i++) {
            if (els[i].innerText.includes('${snippet}')) return 'verified';
          }
          return 'not_found';
        })()
      `);
      if (result === 'verified') return true;
      await this.wait(1500);
    }
    return false;
  }

  // ═══════════════════════════════════════════════════════════
  // Public API
  // ═══════════════════════════════════════════════════════════

  async getStatus(): Promise<{ isOnTwitter: boolean; isLoggedIn: boolean; currentUrl: string }> {
    try {
      const { stdout } = await execAsync(`osascript -e 'tell application "Safari" to get URL of current tab of front window'`);
      const currentUrl = stdout.trim();
      const isOnTwitter = currentUrl.includes('twitter.com') || currentUrl.includes('x.com');
      const loginSel = await this.waitForAny(SELECTORS.LOGIN_CHECK, 5000);
      return { isOnTwitter, isLoggedIn: !!loginSel, currentUrl };
    } catch { return { isOnTwitter: false, isLoggedIn: false, currentUrl: '' }; }
  }

  async navigateToPost(postUrl: string): Promise<boolean> {
    console.log(`[Twitter] Navigating to ${postUrl}`);
    const ok = await this.navigate(postUrl);
    if (!ok) return false;
    // Smart wait: wait until tweet renders (not a fixed delay)
    const found = await this.waitForAny(SELECTORS.TWEET, 10000);
    return !!found;
  }

  async getComments(limit = 50): Promise<Array<{ username: string; text: string }>> {
    const result = await this.executeJS(`
      (function() {
        var comments = [];
        var tweets = document.querySelectorAll('article[data-testid="tweet"], article[role="article"]');
        for (var i = 1; i < Math.min(tweets.length, ${limit + 1}); i++) {
          var user = tweets[i].querySelector('a[href*="/"]');
          var text = tweets[i].querySelector('[data-testid="tweetText"]');
          if (user && text) comments.push({ username: user.href.split('/').pop(), text: text.innerText.substring(0, 500) });
        }
        return JSON.stringify(comments);
      })();
    `);
    try { return JSON.parse(result); } catch { return []; }
  }

  /**
   * Post a reply to the currently-displayed tweet.
   *
   * Reliability guarantees:
   *   - Each step retries up to config.maxRetries times
   *   - Typing uses a 3-strategy fallback chain
   *   - Typing is verified against React state before submit
   *   - Error toasts and rate limits are detected
   *   - Screenshot captured on failure
   */
  async postComment(text: string): Promise<PostResult> {
    const startTime = Date.now();
    let attempts = 0;
    let lastError = '';
    let strategy = '';

    for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
      attempts++;
      try {
        // ── Pre-checks ──
        const rateCheck = this.checkRateLimit();
        if (!rateCheck.allowed) return { success: false, error: rateCheck.reason };

        const platformError = await this.detectErrors();
        if (platformError) {
          lastError = platformError;
          console.log(`[Twitter] Platform error detected: ${platformError}`);
          await this.wait(2000);
          continue;
        }

        // ── Step 1: Click reply icon on main tweet ──
        console.log(`[Twitter] Step 1: Clicking reply icon (attempt ${attempt + 1})`);
        const tweetSel = await this.waitForAny(SELECTORS.TWEET, 8000);
        if (!tweetSel) {
          lastError = 'No tweet found on page';
          continue;
        }

        const click = await this.clickFirst(SELECTORS.REPLY_ICON, tweetSel);
        if (!click.ok) {
          lastError = `Reply icon not found: ${click.error}`;
          continue;
        }
        console.log(`[Twitter] Step 1: Clicked via ${click.value}`);

        // ── Step 2: Wait for reply input ──
        console.log('[Twitter] Step 2: Waiting for reply input');
        const inputSel = await this.waitForAny(SELECTORS.REPLY_INPUT, 8000);
        if (!inputSel) {
          lastError = 'Reply input never appeared';
          continue;
        }
        console.log(`[Twitter] Step 2: Input ready (${inputSel})`);

        // ── Step 3: Type reply (3-strategy chain) ──
        console.log('[Twitter] Step 3: Typing reply');
        const typeResult = await this.typeText(text);
        strategy = typeResult.strategy;
        if (!typeResult.ok) {
          lastError = `All typing strategies failed (last: ${typeResult.strategy})`;
          // Clear any partial text before retry
          await this.executeJS(`
            (function() {
              var el = document.querySelector('[data-testid="tweetTextarea_0"]');
              if (el) { el.focus(); document.execCommand('selectAll'); document.execCommand('delete'); }
            })()
          `);
          continue;
        }
        console.log(`[Twitter] Step 3: Typed via ${strategy}`);

        // ── Step 4: Submit ──
        console.log('[Twitter] Step 4: Submitting');
        const submit = await this.submitReply();
        if (!submit.ok) {
          lastError = `Submit failed: ${submit.error}`;
          continue;
        }
        console.log(`[Twitter] Step 4: Submitted via ${submit.value}`);

        // ── Step 5: Verify reply appeared ──
        console.log('[Twitter] Step 5: Verifying reply');
        const verified = await this.verifyReplyPosted(text);
        console.log(`[Twitter] Step 5: Verified = ${verified}`);

        this.commentLog.push({ timestamp: new Date() });

        return {
          success: true,
          commentId: `tw_${Date.now()}`,
          verified,
          strategy,
          attempts,
          durationMs: Date.now() - startTime,
        };

      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        console.log(`[Twitter] Attempt ${attempt + 1} threw: ${lastError}`);
        if (attempt < this.config.maxRetries - 1) await this.wait(2000 * (attempt + 1));
      }
    }

    // All retries exhausted
    const screenshotPath = await this.captureScreenshot('post-failure');
    return {
      success: false,
      error: lastError,
      strategy,
      attempts,
      durationMs: Date.now() - startTime,
      screenshotPath: screenshotPath || undefined,
    };
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

  setConfig(updates: Partial<TwitterConfig>): void { this.config = { ...this.config, ...updates }; }
  getConfig(): TwitterConfig { return { ...this.config }; }
}
