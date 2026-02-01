/**
 * Twitter Comment Driver - Safari automation for Twitter replies
 */
import { exec } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);

export const SELECTORS = {
  REPLY_INPUT: '[data-testid="tweetTextarea_0"]',
  REPLY_BUTTON: '[data-testid="tweetButtonInline"]',
  TWEET: '[data-testid="tweet"]',
  REPLY_ICON: '[data-testid="reply"]',
};

export interface TwitterConfig {
  timeout: number;
  minDelayMs: number;
  maxDelayMs: number;
  commentsPerHour: number;
  commentsPerDay: number;
}

export const DEFAULT_CONFIG: TwitterConfig = {
  timeout: 30000,
  minDelayMs: 60000,
  maxDelayMs: 180000,
  commentsPerHour: 10,
  commentsPerDay: 30,
};

export class TwitterDriver {
  private config: TwitterConfig;
  private commentLog: { timestamp: Date }[] = [];

  constructor(config: Partial<TwitterConfig> = {}) {
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
      await execAsync(`osascript -e 'tell application "Safari" to set URL of current tab of front window to "${url}"'`);
      await new Promise(r => setTimeout(r, 3000));
      return true;
    } catch { return false; }
  }

  async getStatus(): Promise<{ isOnTwitter: boolean; isLoggedIn: boolean; currentUrl: string }> {
    try {
      const { stdout } = await execAsync(`osascript -e 'tell application "Safari" to get URL of current tab of front window'`);
      const currentUrl = stdout.trim();
      const isOnTwitter = currentUrl.includes('twitter.com') || currentUrl.includes('x.com');
      const loginCheck = await this.executeJS(`(function() { return document.querySelector('[data-testid="SideNav_NewTweet_Button"]') ? 'logged_in' : 'unknown'; })();`);
      return { isOnTwitter, isLoggedIn: loginCheck === 'logged_in', currentUrl };
    } catch { return { isOnTwitter: false, isLoggedIn: false, currentUrl: '' }; }
  }

  async navigateToPost(postUrl: string): Promise<boolean> {
    console.log(`[Twitter] Navigating to ${postUrl}`);
    return this.navigate(postUrl);
  }

  async getComments(limit = 50): Promise<Array<{ username: string; text: string }>> {
    const result = await this.executeJS(`
      (function() {
        var comments = [];
        var tweets = document.querySelectorAll('[data-testid="tweet"]');
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

  async postComment(text: string): Promise<{ success: boolean; commentId?: string; error?: string }> {
    try {
      const rateCheck = this.checkRateLimit();
      if (!rateCheck.allowed) return { success: false, error: rateCheck.reason };

      // Click reply button first
      await this.executeJS(`(function() { var btn = document.querySelector('[data-testid="reply"]'); if (btn) btn.click(); })();`);
      await new Promise(r => setTimeout(r, 1000));

      const escaped = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/'/g, "\\'");
      const typeResult = await this.executeJS(`
        (function() {
          var input = document.querySelector('[data-testid="tweetTextarea_0"]');
          if (input) { input.focus(); document.execCommand('insertText', false, '${escaped}'); return 'typed'; }
          return 'not_found';
        })();
      `);
      if (typeResult !== 'typed') return { success: false, error: 'Reply input not found' };

      await new Promise(r => setTimeout(r, 500));
      const submitResult = await this.executeJS(`
        (function() {
          var btn = document.querySelector('[data-testid="tweetButtonInline"]');
          if (btn && !btn.disabled) { btn.click(); return 'clicked'; }
          return 'not_found';
        })();
      `);
      if (submitResult !== 'clicked') return { success: false, error: 'Reply button not found' };

      this.commentLog.push({ timestamp: new Date() });
      return { success: true, commentId: `tw_${Date.now()}` };
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

  setConfig(updates: Partial<TwitterConfig>): void { this.config = { ...this.config, ...updates }; }
  getConfig(): TwitterConfig { return { ...this.config }; }
}
