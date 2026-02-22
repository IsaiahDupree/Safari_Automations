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

  async postComment(text: string): Promise<{ success: boolean; commentId?: string; error?: string; verified?: boolean }> {
    try {
      const rateCheck = this.checkRateLimit();
      if (!rateCheck.allowed) return { success: false, error: rateCheck.reason };

      // Focus the comment input
      const focusResult = await this.executeJS(`
        (function() {
          var input = document.querySelector('[data-e2e="comment-input"]');
          if (input) { input.focus(); input.click(); return 'focused'; }
          return 'not_found';
        })();
      `);
      if (focusResult !== 'focused') return { success: false, error: 'Comment input not found' };
      await new Promise(r => setTimeout(r, 300));

      // Type via clipboard (innerText doesn't trigger React state updates reliably)
      const typed = await this.typeViaClipboard(text);
      if (!typed) return { success: false, error: 'Failed to type comment via clipboard' };
      await new Promise(r => setTimeout(r, 800));

      // Submit
      const submitResult = await this.executeJS(`
        (function() {
          var btn = document.querySelector('[data-e2e="comment-post"]');
          if (btn && !btn.disabled) { btn.click(); return 'clicked'; }
          return 'not_found';
        })();
      `);
      if (submitResult !== 'clicked') return { success: false, error: 'Submit button not found or disabled' };

      // Verify comment was posted
      await new Promise(r => setTimeout(r, 3000));
      const snippet = text.substring(0, 25).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      const verified = await this.executeJS(`
        (function() {
          var items = document.querySelectorAll('[data-e2e="comment-item"]');
          for (var i = 0; i < items.length; i++) {
            if ((items[i].innerText || '').includes('${snippet}')) return 'verified';
          }
          return 'not_found';
        })();
      `);

      this.commentLog.push({ timestamp: new Date() });
      return { success: true, commentId: `tt_${Date.now()}`, verified: verified === 'verified' };
    } catch (error) { return { success: false, error: String(error) }; }
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
