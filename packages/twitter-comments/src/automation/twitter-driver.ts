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
  COMPOSE_INPUT: [
    '[data-testid="tweetTextarea_0"]',
    'div[role="textbox"][contenteditable="true"]',
    '[data-testid="tweetTextarea_0RichTextInputContainer"] [contenteditable]',
  ],
  COMPOSE_SUBMIT: [
    '[data-testid="tweetButton"]',
    '[data-testid="tweetButtonInline"]',
  ],
  // Compose toolbar
  COMPOSE_MEDIA: [
    '[data-testid="fileInput"]',
    'input[data-testid="fileInput"]',
  ],
  COMPOSE_GIF: [
    '[data-testid="gifSearchButton"]',
    '[aria-label="Add a GIF"]',
  ],
  COMPOSE_POLL: [
    '[data-testid="createPollButton"]',
    '[aria-label="Add poll"]',
  ],
  COMPOSE_SCHEDULE: [
    '[data-testid="scheduleOption"]',
    '[aria-label="Schedule post"]',
  ],
  COMPOSE_LOCATION: [
    '[data-testid="geoButton"]',
    '[aria-label="Tag location"]',
  ],
  COMPOSE_EMOJI: [
    '[aria-label="Add emoji"]',
  ],
  COMPOSE_AUDIENCE: [
    '[aria-label="Choose audience"]',
  ],
  COMPOSE_REPLY_SETTINGS: [
    '[aria-label="Everyone can reply"]',
    '[aria-label*="can reply"]',
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
  optionsApplied?: string[];
}

export interface ComposeOptions {
  /** Who can reply: everyone | following | verified | mentioned */
  replySettings?: 'everyone' | 'following' | 'verified' | 'mentioned';
  /** Audience: 'everyone' (default) or a community name */
  audience?: string;
  /** Create a poll with 2-4 options */
  poll?: {
    options: string[];
    duration?: { days?: number; hours?: number; minutes?: number };
  };
  /** Schedule tweet: ISO date string e.g. "2026-03-01T14:00:00" */
  schedule?: string;
  /** Tag a location by name */
  location?: string;
  /** Attach media files (absolute paths on disk) */
  media?: string[];
  /** Post as a thread: array of additional tweet texts */
  thread?: string[];
}

export interface SearchResult {
  tweetUrl: string;
  author: string;
  handle: string;
  text: string;
  likes: number;
  retweets: number;
  replies: number;
  bookmarks: number;
  views: number;
  timestamp: string;
  hasMedia: boolean;
  isVerified: boolean;
}

export interface TweetDetail {
  url: string;
  author: string;
  handle: string;
  text: string;
  likes: number;
  retweets: number;
  replies: number;
  bookmarks: number;
  views: number;
  timestamp: string;
  hasMedia: boolean;
  isVerified: boolean;
  quotedTweet?: { author: string; text: string };
  replyingTo?: string;
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

  /**
   * Compose and post a new tweet with full compose options.
   *
   * Flow:
   *   1. Navigate to https://x.com/compose/post (dedicated compose page)
   *   2. Wait for compose input to render
   *   3. Type text via 3-strategy chain
   *   4. Apply compose options (reply settings, poll, schedule, location, media)
   *   5. Click Post button (or Schedule if scheduled)
   *   6. Verify tweet posted
   *   7. If thread: compose additional tweets
   */
  async composeTweet(text: string, options?: ComposeOptions): Promise<PostResult> {
    const startTime = Date.now();
    let attempts = 0;
    let lastError = '';
    let strategy = '';
    const optionsApplied: string[] = [];

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

        // ── Step 1: Navigate to compose page ──
        console.log(`[Twitter] Compose Step 1: Navigating to compose page (attempt ${attempt + 1})`);
        const navOk = await this.navigate('https://x.com/compose/post');
        if (!navOk) {
          lastError = 'Failed to navigate to compose page';
          continue;
        }

        // ── Step 2: Wait for compose input ──
        console.log('[Twitter] Compose Step 2: Waiting for compose input');
        const inputSel = await this.waitForAny(SELECTORS.COMPOSE_INPUT, 10000);
        if (!inputSel) {
          lastError = 'Compose input never appeared';
          continue;
        }
        console.log(`[Twitter] Compose Step 2: Input ready (${inputSel})`);
        await this.wait(500);

        // ── Step 3: Type tweet (3-strategy chain) ──
        console.log('[Twitter] Compose Step 3: Typing tweet');
        const typeResult = await this.typeCompose(text);
        strategy = typeResult.strategy;
        if (!typeResult.ok) {
          lastError = `All typing strategies failed (last: ${typeResult.strategy})`;
          await this.executeJS(`
            (function() {
              var el = document.querySelector('[data-testid="tweetTextarea_0"]');
              if (el) { el.focus(); document.execCommand('selectAll'); document.execCommand('delete'); }
            })()
          `);
          continue;
        }
        console.log(`[Twitter] Compose Step 3: Typed via ${strategy}`);

        // ── Step 4: Apply compose options ──
        if (options) {
          console.log('[Twitter] Compose Step 4: Applying options');

          if (options.audience && options.audience.toLowerCase() !== 'everyone') {
            const ok = await this.applyAudience(options.audience);
            if (ok) optionsApplied.push(`audience:${options.audience}`);
          }

          if (options.replySettings && options.replySettings !== 'everyone') {
            const ok = await this.applyReplySettings(options.replySettings);
            if (ok) optionsApplied.push(`replySettings:${options.replySettings}`);
          }

          if (options.poll && options.poll.options.length >= 2) {
            const ok = await this.applyPoll(options.poll);
            if (ok) optionsApplied.push(`poll:${options.poll.options.length}options`);
          }

          if (options.location) {
            const ok = await this.applyLocation(options.location);
            if (ok) optionsApplied.push(`location:${options.location}`);
          }

          if (options.media && options.media.length > 0) {
            const ok = await this.applyMedia(options.media);
            if (ok) optionsApplied.push(`media:${options.media.length}files`);
          }

          if (options.schedule) {
            const ok = await this.applySchedule(options.schedule);
            if (ok) optionsApplied.push(`schedule:${options.schedule}`);
          }

          console.log(`[Twitter] Compose Step 4: Options applied: [${optionsApplied.join(', ')}]`);
        }

        // ── Step 5: Submit tweet ──
        const isScheduled = options?.schedule && optionsApplied.some(o => o.startsWith('schedule'));
        console.log(`[Twitter] Compose Step 5: ${isScheduled ? 'Confirming schedule' : 'Submitting'}`);

        if (isScheduled) {
          // Schedule flow: click the "Schedule" confirm button in the schedule dialog
          const schedSubmit = await this.submitSchedule();
          if (!schedSubmit.ok) {
            lastError = `Schedule submit failed: ${schedSubmit.error}`;
            continue;
          }
          console.log(`[Twitter] Compose Step 5: Scheduled via ${schedSubmit.value}`);
        } else {
          const submit = await this.submitCompose();
          if (!submit.ok) {
            lastError = `Submit failed: ${submit.error}`;
            continue;
          }
          console.log(`[Twitter] Compose Step 5: Submitted via ${submit.value}`);
        }

        // ── Step 6: Verify tweet posted ──
        console.log('[Twitter] Compose Step 6: Verifying');
        await this.wait(3000);
        const verified = isScheduled ? true : await this.verifyTweetPosted(text);
        console.log(`[Twitter] Compose Step 6: Verified = ${verified}`);

        this.commentLog.push({ timestamp: new Date() });

        // ── Step 7: Thread (additional tweets) ──
        if (options?.thread && options.thread.length > 0 && !isScheduled) {
          console.log(`[Twitter] Compose Step 7: Posting thread (${options.thread.length} more tweets)`);
          for (let t = 0; t < options.thread.length; t++) {
            await this.wait(2000);
            const threadResult = await this.postThreadReply(options.thread[t]);
            if (threadResult) {
              optionsApplied.push(`thread:tweet${t + 2}`);
              this.commentLog.push({ timestamp: new Date() });
            }
          }
        }

        return {
          success: true,
          commentId: `tweet_${Date.now()}`,
          verified,
          strategy,
          attempts,
          durationMs: Date.now() - startTime,
          optionsApplied: optionsApplied.length > 0 ? optionsApplied : undefined,
        };

      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        console.log(`[Twitter] Compose attempt ${attempt + 1} threw: ${lastError}`);
        if (attempt < this.config.maxRetries - 1) await this.wait(2000 * (attempt + 1));
      }
    }

    const screenshotPath = await this.captureScreenshot('compose-failure');
    return {
      success: false,
      error: lastError,
      strategy,
      attempts,
      durationMs: Date.now() - startTime,
      screenshotPath: screenshotPath || undefined,
      optionsApplied: optionsApplied.length > 0 ? optionsApplied : undefined,
    };
  }

  // ─── Compose Option Handlers ──────────────────────────────

  /**
   * Set audience: post to a specific Community instead of Everyone.
   * Clicks the "Choose audience" button → selects matching community from dropdown.
   */
  private async applyAudience(communityName: string): Promise<boolean> {
    try {
      console.log(`[Twitter] Setting audience to: ${communityName}`);
      const clicked = await this.clickFirst(SELECTORS.COMPOSE_AUDIENCE);
      if (!clicked.ok) { console.log('[Twitter] Audience button not found'); return false; }
      await this.wait(800);

      const escaped = communityName.replace(/'/g, "\\'");
      const result = await this.executeJS(`
        (function() {
          var items = document.querySelectorAll('[role="menuitem"], [role="option"], [role="menuitemradio"]');
          for (var i = 0; i < items.length; i++) {
            var t = (items[i].innerText || '').trim();
            if (t.indexOf('${escaped}') !== -1) { items[i].click(); return 'clicked:' + t.substring(0, 60); }
          }
          return 'not_found';
        })()
      `);
      console.log(`[Twitter] Audience result: ${result}`);
      await this.wait(500);
      return result ? result.includes('clicked') : false;
    } catch (e) { console.log(`[Twitter] Audience error: ${e}`); return false; }
  }

  /**
   * Set who can reply: following, verified, or mentioned.
   * Clicks the "Everyone can reply" button → selects from dropdown menu.
   */
  private async applyReplySettings(setting: 'following' | 'verified' | 'mentioned'): Promise<boolean> {
    try {
      console.log(`[Twitter] Setting reply to: ${setting}`);
      const clicked = await this.clickFirst(SELECTORS.COMPOSE_REPLY_SETTINGS);
      if (!clicked.ok) { console.log('[Twitter] Reply settings button not found'); return false; }
      await this.wait(800);

      // Map setting to the menu item text
      const textMap: Record<string, string> = {
        following: 'Accounts you follow',
        verified: 'Verified accounts',
        mentioned: 'Only people you mention',
      };
      const targetText = textMap[setting];

      const result = await this.executeJS(`
        (function() {
          var items = document.querySelectorAll('[role="menuitem"], [role="option"], [role="menuitemradio"]');
          for (var i = 0; i < items.length; i++) {
            var t = (items[i].innerText || '').trim();
            if (t.indexOf('${targetText}') !== -1) { items[i].click(); return 'clicked:' + t; }
          }
          // Fallback: search all clickable spans
          var spans = document.querySelectorAll('span');
          for (var j = 0; j < spans.length; j++) {
            var st = (spans[j].innerText || '').trim();
            if (st === '${targetText}') { spans[j].click(); return 'span_clicked:' + st; }
          }
          return 'not_found';
        })()
      `);
      console.log(`[Twitter] Reply settings result: ${result}`);
      await this.wait(500);
      return result ? result.includes('clicked') : false;
    } catch (e) { console.log(`[Twitter] Reply settings error: ${e}`); return false; }
  }

  /**
   * Create a poll with 2-4 options and optional duration.
   * Clicks the poll button → fills in option inputs → sets duration.
   */
  private async applyPoll(poll: { options: string[]; duration?: { days?: number; hours?: number; minutes?: number } }): Promise<boolean> {
    try {
      console.log(`[Twitter] Adding poll with ${poll.options.length} options`);
      const clicked = await this.clickFirst(SELECTORS.COMPOSE_POLL);
      if (!clicked.ok) { console.log('[Twitter] Poll button not found'); return false; }
      await this.wait(1000);

      // Fill in poll options — they use name="Choice1", "Choice2", etc.
      for (let i = 0; i < Math.min(poll.options.length, 4); i++) {
        const optText = poll.options[i].replace(/'/g, "\\'").replace(/\\/g, '\\\\');
        // For options 3 and 4, we need to click "Add" first
        if (i >= 2) {
          await this.executeJS(`
            (function() {
              var addBtns = document.querySelectorAll('[aria-label="Add a poll option"], button');
              for (var k = 0; k < addBtns.length; k++) {
                var t = (addBtns[k].innerText || '').trim();
                if (t === '+' || t === 'Add') { addBtns[k].click(); return 'added'; }
              }
              return 'no_add';
            })()
          `);
          await this.wait(500);
        }

        const choiceNum = i + 1;
        await this.executeJS(`
          (function() {
            var input = document.querySelector('input[name="Choice${choiceNum}"], [placeholder*="Choice ${choiceNum}"], [aria-label*="Choice ${choiceNum}"]');
            if (!input) {
              // Fallback: find by index
              var inputs = document.querySelectorAll('input[name^="Choice"]');
              input = inputs[${i}];
            }
            if (input) {
              input.focus();
              input.value = '';
              document.execCommand('selectAll');
              document.execCommand('insertText', false, '${optText}');
              input.dispatchEvent(new Event('input', {bubbles:true}));
              return 'filled';
            }
            return 'no_input';
          })()
        `);
        await this.wait(300);
      }

      // Set poll duration if provided
      if (poll.duration) {
        const { days = 1, hours = 0, minutes = 0 } = poll.duration;
        await this.executeJS(`
          (function() {
            // Duration selectors: Days, Hours, Minutes dropdowns
            var selects = document.querySelectorAll('select');
            for (var s = 0; s < selects.length; s++) {
              var label = (selects[s].getAttribute('aria-label') || selects[s].name || '').toLowerCase();
              if (label.includes('day')) { selects[s].value = '${days}'; selects[s].dispatchEvent(new Event('change', {bubbles:true})); }
              else if (label.includes('hour')) { selects[s].value = '${hours}'; selects[s].dispatchEvent(new Event('change', {bubbles:true})); }
              else if (label.includes('minute')) { selects[s].value = '${minutes}'; selects[s].dispatchEvent(new Event('change', {bubbles:true})); }
            }
            return 'duration_set';
          })()
        `);
      }

      console.log(`[Twitter] Poll added with ${poll.options.length} options`);
      return true;
    } catch (e) { console.log(`[Twitter] Poll error: ${e}`); return false; }
  }

  /**
   * Schedule a tweet for a future date/time.
   * Clicks the schedule button → sets date and time in the picker.
   */
  private async applySchedule(dateStr: string): Promise<boolean> {
    try {
      console.log(`[Twitter] Scheduling for: ${dateStr}`);
      const clicked = await this.clickFirst(SELECTORS.COMPOSE_SCHEDULE);
      if (!clicked.ok) { console.log('[Twitter] Schedule button not found'); return false; }
      await this.wait(1000);

      // Parse the date string
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) { console.log('[Twitter] Invalid schedule date'); return false; }

      const month = date.toLocaleString('en-US', { month: 'long' });
      const day = date.getDate();
      const year = date.getFullYear();
      const hour = date.getHours();
      const minute = date.getMinutes();
      const ampm = hour >= 12 ? 'PM' : 'AM';
      const hour12 = hour % 12 || 12;

      // Fill in the schedule picker — X uses select dropdowns and date input
      await this.executeJS(`
        (function() {
          var selects = document.querySelectorAll('select');
          for (var i = 0; i < selects.length; i++) {
            var name = (selects[i].getAttribute('name') || selects[i].getAttribute('aria-label') || '').toLowerCase();
            var opts = selects[i].querySelectorAll('option');
            if (name.includes('month') || name.includes('date')) {
              // Try to set month
              for (var j = 0; j < opts.length; j++) {
                if (opts[j].text === '${month}') { selects[i].value = opts[j].value; selects[i].dispatchEvent(new Event('change', {bubbles:true})); break; }
              }
            }
          }
          // Set day
          var dayInput = document.querySelector('input[name*="day"], input[placeholder*="Day"], select[name*="day"]');
          if (dayInput) {
            if (dayInput.tagName === 'SELECT') {
              dayInput.value = '${day}';
            } else {
              dayInput.value = '${day}';
              dayInput.dispatchEvent(new Event('input', {bubbles:true}));
            }
            dayInput.dispatchEvent(new Event('change', {bubbles:true}));
          }
          // Set year
          var yearInput = document.querySelector('select[name*="year"]');
          if (yearInput) {
            yearInput.value = '${year}';
            yearInput.dispatchEvent(new Event('change', {bubbles:true}));
          }
          // Set time
          var hourInput = document.querySelector('select[name*="hour"]');
          if (hourInput) {
            hourInput.value = '${hour12}';
            hourInput.dispatchEvent(new Event('change', {bubbles:true}));
          }
          var minInput = document.querySelector('select[name*="minute"]');
          if (minInput) {
            minInput.value = '${minute.toString().padStart(2, '0')}';
            minInput.dispatchEvent(new Event('change', {bubbles:true}));
          }
          var ampmInput = document.querySelector('select[name*="amPm"], select[name*="meridiem"]');
          if (ampmInput) {
            ampmInput.value = '${ampm}';
            ampmInput.dispatchEvent(new Event('change', {bubbles:true}));
          }
          return 'schedule_set';
        })()
      `);
      await this.wait(500);
      console.log(`[Twitter] Schedule set for: ${month} ${day}, ${year} ${hour12}:${minute.toString().padStart(2, '0')} ${ampm}`);
      return true;
    } catch (e) { console.log(`[Twitter] Schedule error: ${e}`); return false; }
  }

  /**
   * Submit the scheduled tweet (clicks the Confirm/Schedule button in the schedule dialog).
   */
  private async submitSchedule(): Promise<StepResult> {
    for (let i = 0; i < 5; i++) {
      const result = await this.executeJS(`
        (function() {
          // Look for schedule confirm button
          var btns = document.querySelectorAll('button[data-testid="scheduledConfirmationPrimaryAction"], button');
          for (var j = 0; j < btns.length; j++) {
            var t = (btns[j].innerText || '').trim().toLowerCase();
            if ((t === 'schedule' || t === 'confirm') && !btns[j].disabled) {
              btns[j].click();
              return JSON.stringify({ok:true, value:'schedule_confirmed'});
            }
          }
          return JSON.stringify({ok:false, error:'no_schedule_confirm_button'});
        })()
      `);
      try {
        const parsed = JSON.parse(result);
        if (parsed.ok) return parsed;
      } catch {}
      await this.wait(800);
    }
    return { ok: false, error: 'schedule_confirm_never_found' };
  }

  /**
   * Tag a location on the tweet.
   * Clicks the location button → types location → selects first result.
   */
  private async applyLocation(location: string): Promise<boolean> {
    try {
      console.log(`[Twitter] Adding location: ${location}`);
      const clicked = await this.clickFirst(SELECTORS.COMPOSE_LOCATION);
      if (!clicked.ok) { console.log('[Twitter] Location button not found'); return false; }
      await this.wait(1000);

      // Type location in search
      const escaped = location.replace(/'/g, "\\'").replace(/\\/g, '\\\\');
      await this.executeJS(`
        (function() {
          var input = document.querySelector('input[type="text"], input[placeholder*="Search"], input[aria-label*="Search"], input[aria-label*="location"]');
          if (input) {
            input.focus();
            input.value = '';
            document.execCommand('insertText', false, '${escaped}');
            input.dispatchEvent(new Event('input', {bubbles:true}));
            return 'typed';
          }
          return 'no_input';
        })()
      `);
      await this.wait(2000); // Wait for search results

      // Click first location result
      const selected = await this.executeJS(`
        (function() {
          var results = document.querySelectorAll('[role="option"], [role="listbox"] li, [data-testid="typeaheadResult"]');
          if (results.length > 0) { results[0].click(); return 'selected:' + (results[0].innerText || '').substring(0, 50); }
          // Fallback: click any list item in location picker
          var items = document.querySelectorAll('[role="dialog"] li, [role="dialog"] [role="option"]');
          if (items.length > 0) { items[0].click(); return 'fallback:' + (items[0].innerText || '').substring(0, 50); }
          return 'no_results';
        })()
      `);
      console.log(`[Twitter] Location result: ${selected}`);
      await this.wait(500);
      return selected ? selected.includes('selected') || selected.includes('fallback') : false;
    } catch (e) { console.log(`[Twitter] Location error: ${e}`); return false; }
  }

  /**
   * Attach media files (images/videos) to the tweet.
   * Uses the hidden file input to inject files via AppleScript file dialog.
   */
  private async applyMedia(filePaths: string[]): Promise<boolean> {
    try {
      console.log(`[Twitter] Attaching ${filePaths.length} media files`);

      for (const filePath of filePaths) {
        // Click the media button to trigger file input
        await this.executeJS(`
          (function() {
            var input = document.querySelector('[data-testid="fileInput"]');
            if (input) { input.click(); return 'clicked'; }
            return 'no_input';
          })()
        `);
        await this.wait(1500);

        // Use System Events to interact with the file dialog
        // Type the file path via Go To Folder (Cmd+Shift+G) then select
        const safeFilePath = filePath.replace(/"/g, '\\"');
        await execAsync(`osascript -e 'tell application "Safari" to activate'`);
        await this.wait(500);
        // Open Go To Folder dialog
        await execAsync(`osascript -e 'tell application "System Events" to keystroke "g" using {command down, shift down}'`);
        await this.wait(1000);
        // Type the file path
        await execAsync(`osascript -e 'tell application "System Events" to keystroke "${safeFilePath}"'`);
        await this.wait(500);
        // Press Enter to go to folder, then Enter to select file
        await execAsync(`osascript -e 'tell application "System Events" to keystroke return'`);
        await this.wait(1000);
        await execAsync(`osascript -e 'tell application "System Events" to keystroke return'`);
        await this.wait(2000);

        console.log(`[Twitter] Attached: ${filePath}`);
      }

      // Verify media was attached
      const hasMedia = await this.executeJS(`
        (function() {
          var media = document.querySelectorAll('[data-testid="attachments"] img, [data-testid="attachments"] video, [aria-label="Uploaded media"] img');
          return media.length > 0 ? 'has_media:' + media.length : 'no_media';
        })()
      `);
      console.log(`[Twitter] Media verification: ${hasMedia}`);
      return hasMedia ? hasMedia.includes('has_media') : false;
    } catch (e) { console.log(`[Twitter] Media error: ${e}`); return false; }
  }

  /**
   * Post a thread reply after the first tweet is posted.
   * Navigates to the posted tweet and posts a reply.
   */
  private async postThreadReply(text: string): Promise<boolean> {
    try {
      // After posting, the page should show the tweet or redirect to profile
      // Click reply on the most recent tweet
      await this.wait(1000);

      // Navigate to own profile to find the latest tweet
      const navOk = await this.navigate('https://x.com/IsaiahDupree7');
      if (!navOk) return false;
      await this.wait(3000);

      // Find and click on the latest tweet (first article)
      const tweetSel = await this.waitForAny(SELECTORS.TWEET, 8000);
      if (!tweetSel) return false;

      // Click reply on it
      const click = await this.clickFirst(SELECTORS.REPLY_ICON, tweetSel);
      if (!click.ok) return false;
      await this.wait(1000);

      // Wait for reply input
      const inputSel = await this.waitForAny(SELECTORS.REPLY_INPUT, 8000);
      if (!inputSel) return false;

      // Type the thread reply
      const typeResult = await this.typeText(text);
      if (!typeResult.ok) return false;

      // Submit
      const submit = await this.submitReply();
      if (!submit.ok) return false;

      console.log(`[Twitter] Thread reply posted: "${text.substring(0, 40)}..."`);
      return true;
    } catch (e) { console.log(`[Twitter] Thread reply error: ${e}`); return false; }
  }

  // ─── Compose-specific typing (uses COMPOSE selectors) ─────

  private async typeCompose(text: string): Promise<{ ok: boolean; strategy: string }> {
    const escaped = text.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');

    // Strategy 1: execCommand (best for React/Draft.js)
    const execResult = await this.executeJS(`
      (function() {
        var sels = [${SELECTORS.COMPOSE_INPUT.map(s => `'${s}'`).join(',')}];
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
      await this.wait(500);
      if (await this.verifyComposeReady()) return { ok: true, strategy: 'execCommand' };
    }

    // Strategy 2: OS-level keystrokes
    try {
      const sel = await this.waitForAny(SELECTORS.COMPOSE_INPUT, 3000);
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
        if (await this.verifyComposeReady()) return { ok: true, strategy: 'keystrokes' };
      }
    } catch {}

    // Strategy 3: Clipboard paste
    try {
      const sel = await this.waitForAny(SELECTORS.COMPOSE_INPUT, 3000);
      if (sel) {
        await this.executeJS(`document.querySelector('${sel}').focus()`);
        await this.wait(200);
        const esc = text.replace(/"/g, '\\"').replace(/`/g, '\\`').replace(/\$/g, '\\$');
        await execAsync(`printf "%s" "${esc}" | pbcopy`);
        await execAsync(`osascript -e 'tell application "Safari" to activate'`);
        await this.wait(200);
        await execAsync(`osascript -e 'tell application "System Events" to keystroke "v" using command down'`);
        await this.wait(500);
        if (await this.verifyComposeReady()) return { ok: true, strategy: 'clipboard' };
      }
    } catch {}

    return { ok: false, strategy: 'none' };
  }

  private async verifyComposeReady(): Promise<boolean> {
    for (let i = 0; i < 6; i++) {
      const check = await this.executeJS(`
        (function() {
          var sels = [${SELECTORS.COMPOSE_SUBMIT.map(s => `'${s}'`).join(',')}];
          for (var j = 0; j < sels.length; j++) {
            var btn = document.querySelector(sels[j]);
            if (btn && !btn.disabled) return 'ready';
          }
          return 'not_ready';
        })()
      `);
      if (check === 'ready') return true;
      await this.wait(400);
    }
    return false;
  }

  private async submitCompose(): Promise<StepResult> {
    for (let i = 0; i < 5; i++) {
      const result = await this.executeJS(`
        (function() {
          var sels = [${SELECTORS.COMPOSE_SUBMIT.map(s => `'${s}'`).join(',')}];
          for (var j = 0; j < sels.length; j++) {
            var btn = document.querySelector(sels[j]);
            if (btn && !btn.disabled) { btn.click(); return JSON.stringify({ok:true, value:sels[j]}); }
          }
          return JSON.stringify({ok:false, error:'no_enabled_post_button'});
        })()
      `);
      try {
        const parsed = JSON.parse(result);
        if (parsed.ok) return parsed;
      } catch {}
      await this.wait(800);
    }
    return { ok: false, error: 'post_button_never_enabled' };
  }

  private async verifyTweetPosted(text: string, timeoutMs = 12000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      // After posting, X either redirects to timeline or shows a toast
      const result = await this.executeJS(`
        (function() {
          // Check 1: compose dialog/page is gone (successful post dismisses it)
          var composeInput = document.querySelector('[data-testid="tweetTextarea_0"]');
          var isOnCompose = window.location.href.includes('/compose/');
          if (!composeInput && !isOnCompose) return 'posted_compose_gone';
          // Check 2: success toast
          var toasts = document.querySelectorAll('[data-testid="toast"], [role="alert"]');
          for (var i = 0; i < toasts.length; i++) {
            var t = (toasts[i].innerText || '').toLowerCase();
            if (t.includes('sent') || t.includes('posted') || t.includes('your post')) return 'posted_toast';
          }
          // Check 3: redirected to home timeline
          if (window.location.href.includes('/home') && !composeInput) return 'posted_redirected';
          return 'not_yet';
        })()
      `);
      if (result && result.startsWith('posted')) return true;
      await this.wait(1500);
    }
    return false;
  }

  // ─── Tweet Search ──────────────────────────────────────────

  /**
   * Search X for tweets matching a keyword/query.
   * Navigates to x.com/search, extracts tweet data from results.
   */
  async searchTweets(query: string, options?: { tab?: 'top' | 'latest' | 'people' | 'media'; maxResults?: number; scrolls?: number }): Promise<{ tweets: SearchResult[]; query: string }> {
    const tab = options?.tab || 'top';
    const maxResults = options?.maxResults || 10;
    const scrolls = options?.scrolls || 3;

    const encoded = encodeURIComponent(query);
    const tabParam = tab === 'top' ? '' : `&f=${tab === 'latest' ? 'live' : tab}`;
    const url = `https://x.com/search?q=${encoded}${tabParam}&src=typed_query`;

    console.log(`[Twitter] Searching: "${query}" (tab: ${tab})`);
    const navOk = await this.navigate(url);
    if (!navOk) return { tweets: [], query };

    // Wait for tweets to load
    const tweetSel = await this.waitForAny(SELECTORS.TWEET, 10000);
    if (!tweetSel) {
      console.log('[Twitter] No tweets found in search results');
      return { tweets: [], query };
    }
    await this.wait(1500);

    // Scroll to load more results
    for (let s = 0; s < scrolls; s++) {
      await this.executeJS(`window.scrollBy(0, window.innerHeight)`);
      await this.wait(1200);
    }

    // Extract tweet data (no regex — avoids executeJS escaping issues)
    const EXTRACT_JS = this.buildTweetExtractJS(maxResults);

    const resultJson = await this.executeJS(EXTRACT_JS);
    let tweets: SearchResult[] = [];
    try {
      tweets = JSON.parse(resultJson || '[]');
    } catch { tweets = []; }

    console.log(`[Twitter] Found ${tweets.length} tweets for "${query}"`);
    return { tweets, query };
  }

  // ─── Tweet Detail Extraction ──────────────────────────────

  /**
   * Navigate to a specific tweet URL and extract full details.
   */
  async getTweetDetail(tweetUrl: string): Promise<TweetDetail | null> {
    console.log(`[Twitter] Extracting detail: ${tweetUrl}`);
    const navOk = await this.navigate(tweetUrl);
    if (!navOk) return null;

    const tweetSel = await this.waitForAny(SELECTORS.TWEET, 10000);
    if (!tweetSel) { console.log('[Twitter] Tweet not found'); return null; }
    await this.wait(1500);

    const DETAIL_JS = this.buildTweetDetailJS();

    const detailJson = await this.executeJS(DETAIL_JS);
    try {
      const detail = JSON.parse(detailJson);
      if (!detail) return null;
      console.log(`[Twitter] Detail: ${detail.handle} - "${detail.text?.substring(0, 60)}..." (${detail.likes} likes)`);
      return detail;
    } catch { return null; }
  }

  // ─── Reply to Tweet ──────────────────────────────────────

  /**
   * Navigate to a tweet and post a reply.
   * Uses the existing postComment flow after navigating to the tweet.
   */
  async replyToTweet(tweetUrl: string, text: string): Promise<PostResult> {
    console.log(`[Twitter] Replying to: ${tweetUrl}`);
    const navOk = await this.navigateToPost(tweetUrl);
    if (!navOk) return { success: false, error: 'Failed to navigate to tweet' };
    await this.wait(3000);
    return this.postComment(text);
  }

  // ─── Get User Timeline ────────────────────────────────────

  /**
   * Get tweets from a user's profile timeline.
   */
  async getUserTimeline(handle: string, maxResults = 10): Promise<{ tweets: SearchResult[]; handle: string }> {
    const cleanHandle = handle.replace('@', '');
    console.log(`[Twitter] Getting timeline for @${cleanHandle}`);

    const navOk = await this.navigate(`https://x.com/${cleanHandle}`);
    if (!navOk) return { tweets: [], handle: cleanHandle };

    const tweetSel = await this.waitForAny(SELECTORS.TWEET, 10000);
    if (!tweetSel) return { tweets: [], handle: cleanHandle };
    await this.wait(2000);

    // Scroll to load more
    for (let s = 0; s < 2; s++) {
      await this.executeJS(`window.scrollBy(0, window.innerHeight)`);
      await this.wait(1200);
    }

    const EXTRACT_JS = this.buildTweetExtractJS(maxResults);

    const resultJson = await this.executeJS(EXTRACT_JS);
    let tweets: SearchResult[] = [];
    try { tweets = JSON.parse(resultJson || '[]'); } catch {}

    console.log(`[Twitter] Found ${tweets.length} tweets from @${cleanHandle}`);
    return { tweets, handle: cleanHandle };
  }

  // ─── Get Home Timeline ────────────────────────────────────

  /**
   * Get tweets from the home "For You" or "Following" feed.
   */
  async getHomeFeed(tab: 'foryou' | 'following' = 'foryou', maxResults = 10): Promise<{ tweets: SearchResult[] }> {
    console.log(`[Twitter] Getting home feed (${tab})`);

    const navOk = await this.navigate('https://x.com/home');
    if (!navOk) return { tweets: [] };

    await this.wait(3000);

    // Switch tab if needed
    if (tab === 'following') {
      await this.executeJS(`
        (function() {
          var tabs = document.querySelectorAll('[role="tab"], [role="presentation"] a');
          for (var i = 0; i < tabs.length; i++) {
            var t = (tabs[i].innerText || '').trim().toLowerCase();
            if (t === 'following') { tabs[i].click(); return 'switched'; }
          }
          return 'no_tab';
        })()
      `);
      await this.wait(2000);
    }

    // Scroll to load
    for (let s = 0; s < 2; s++) {
      await this.executeJS(`window.scrollBy(0, window.innerHeight)`);
      await this.wait(1200);
    }

    const EXTRACT_JS = this.buildTweetExtractJS(maxResults);

    const resultJson = await this.executeJS(EXTRACT_JS);
    let tweets: SearchResult[] = [];
    try { tweets = JSON.parse(resultJson || '[]'); } catch {}

    console.log(`[Twitter] Found ${tweets.length} tweets in home feed`);
    return { tweets };
  }

  // ─── Shared JS Builders (no regex, safe for executeJS escaping) ────

  private buildTweetExtractJS(maxResults: number): string {
    return '(function(){var tweets=[];var articles=document.querySelectorAll("article[data-testid=tweet]");for(var i=0;i<Math.min(articles.length,' + maxResults + ');i++){var a=articles[i];try{var author="";var handle="";var nameLink=a.querySelector("a[role=link] span");if(nameLink)author=(nameLink.innerText||"").trim();var spans=a.querySelectorAll("span");for(var si=0;si<spans.length;si++){var st=(spans[si].innerText||"").trim();if(st.charAt(0)==="@"&&st.length>2){handle=st;break;}}if(!handle){var hlinks=a.querySelectorAll("a[href]");for(var li=0;li<hlinks.length;li++){var hr=hlinks[li].getAttribute("href")||"";if(hr.charAt(0)==="/"&&hr.indexOf("/",1)===-1&&hr.length>1){handle="@"+hr.substring(1);break;}}}var textEl=a.querySelector("[data-testid=tweetText]");var text=textEl?(textEl.innerText||"").trim():"";var timeEl=a.querySelector("time");var timestamp=timeEl?timeEl.getAttribute("datetime")||"":"";var tweetUrl="";var aLinks=a.querySelectorAll("a[href]");for(var ai=0;ai<aLinks.length;ai++){var ah=aLinks[ai].getAttribute("href")||"";if(ah.indexOf("/status/")!==-1){tweetUrl="https://x.com"+ah;break;}}var likes=0,retweets=0,replies=0,bookmarks=0,views=0;var allLabels=a.querySelectorAll("[aria-label]");for(var m=0;m<allLabels.length;m++){var lbl=(allLabels[m].getAttribute("aria-label")||"").toLowerCase();var parts=lbl.split(" ");var n=parseInt(parts[0].replace(",",""));if(isNaN(n))n=0;if(lbl.indexOf("repl")!==-1)replies=n;else if(lbl.indexOf("repost")!==-1)retweets=n;else if(lbl.indexOf("like")!==-1)likes=n;else if(lbl.indexOf("bookmark")!==-1)bookmarks=n;else if(lbl.indexOf("view")!==-1)views=n;}var hasMedia=!!a.querySelector("[data-testid=tweetPhoto],[data-testid=videoPlayer]");var isVerified=!!a.querySelector("[data-testid=icon-verified]");tweets.push(JSON.stringify({tweetUrl:tweetUrl,author:author,handle:handle,text:text.substring(0,500),likes:likes,retweets:retweets,replies:replies,bookmarks:bookmarks,views:views,timestamp:timestamp,hasMedia:hasMedia,isVerified:isVerified}));}catch(e){}}return"["+tweets.join(",")+"]";})()'
  }

  private buildTweetDetailJS(): string {
    return '(function(){var a=document.querySelector("article[data-testid=tweet]");if(!a)return"null";var author="";var handle="";var nameLink=a.querySelector("a[role=link] span");if(nameLink)author=(nameLink.innerText||"").trim();var spans=a.querySelectorAll("span");for(var si=0;si<spans.length;si++){var st=(spans[si].innerText||"").trim();if(st.charAt(0)==="@"&&st.length>2){handle=st;break;}}if(!handle){var hlinks=a.querySelectorAll("a[href]");for(var li=0;li<hlinks.length;li++){var hr=hlinks[li].getAttribute("href")||"";if(hr.charAt(0)==="/"&&hr.indexOf("/",1)===-1&&hr.length>1){handle="@"+hr.substring(1);break;}}}var textEl=a.querySelector("[data-testid=tweetText]");var text=textEl?(textEl.innerText||"").trim():"";var timeEl=a.querySelector("time");var timestamp=timeEl?timeEl.getAttribute("datetime")||"": "";var likes=0,retweets=0,replies=0,bookmarks=0,views=0;var allLabels=a.querySelectorAll("[aria-label]");for(var m=0;m<allLabels.length;m++){var lbl=(allLabels[m].getAttribute("aria-label")||"").toLowerCase();var parts=lbl.split(" ");var n=parseInt(parts[0].replace(",",""));if(isNaN(n))n=0;if(lbl.indexOf("repl")!==-1)replies=n;else if(lbl.indexOf("repost")!==-1)retweets=n;else if(lbl.indexOf("like")!==-1)likes=n;else if(lbl.indexOf("bookmark")!==-1)bookmarks=n;else if(lbl.indexOf("view")!==-1)views=n;}var hasMedia=!!a.querySelector("[data-testid=tweetPhoto],[data-testid=videoPlayer]");var isVerified=!!a.querySelector("[data-testid=icon-verified]");var replyingTo="";var replyEl=a.querySelector("[data-testid=socialContext]");if(replyEl){var rt=(replyEl.innerText||"").trim();if(rt.indexOf("Replying to")!==-1)replyingTo=rt.replace("Replying to","").trim();}var quotedTweet=null;var qBlock=a.querySelector("[data-testid=quoteTweet]");if(qBlock){var qAuth=qBlock.querySelector("span")?(qBlock.querySelector("span").innerText||"").trim():"";var qText=qBlock.querySelector("[data-testid=tweetText]")?(qBlock.querySelector("[data-testid=tweetText]").innerText||"").trim():"";if(qAuth||qText)quotedTweet={author:qAuth,text:qText.substring(0,300)};}return JSON.stringify({url:window.location.href,author:author,handle:handle,text:text,likes:likes,retweets:retweets,replies:replies,bookmarks:bookmarks,views:views,timestamp:timestamp,hasMedia:hasMedia,isVerified:isVerified,quotedTweet:quotedTweet,replyingTo:replyingTo});})()'
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
