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

  async executeJS(script: string): Promise<string> {
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

  async getVideoMetrics(): Promise<{ views: number; likes: number; comments: number; shares: number; currentUrl: string }> {
    const raw = await this.executeJS(`
      (function() {
        function parse(el) {
          if (!el) return 0;
          var t = (el.textContent || el.innerText || '').trim().replace(/,/g,'');
          if (!t) return 0;
          var m = parseFloat(t);
          if (isNaN(m)) return 0;
          if (t.match(/[Kk]$/)) return Math.round(m * 1000);
          if (t.match(/[Mm]$/)) return Math.round(m * 1000000);
          return Math.round(m);
        }
        var lk = document.querySelector('[data-e2e="like-count"]');
        var cm = document.querySelector('[data-e2e="comment-count"]');
        var sh = document.querySelector('[data-e2e="share-count"]');
        var vw = document.querySelector('[data-e2e="video-views"]') || document.querySelector('[data-e2e="play-count"]') || document.querySelector('[data-e2e="browse-video-count"]') || document.querySelector('[data-e2e="video-play-count"]');
        var viewCount = parse(vw);
        if (!viewCount) {
          var spans = document.querySelectorAll('strong[data-e2e], span[data-e2e]');
          for (var i = 0; i < spans.length; i++) {
            var attr = spans[i].getAttribute('data-e2e') || '';
            if (attr.match(/view|play|watch/i)) { viewCount = parse(spans[i]); break; }
          }
        }
        return JSON.stringify({ views: viewCount, likes: parse(lk), comments: parse(cm), shares: parse(sh), currentUrl: window.location.href.substring(0, 100) });
      })()
    `);
    try {
      const m = JSON.parse(raw || 'null');
      return m ?? { views: 0, likes: 0, comments: 0, shares: 0, currentUrl: '' };
    } catch { return { views: 0, likes: 0, comments: 0, shares: 0, currentUrl: '' }; }
  }

  async getComments(limit = 50): Promise<Array<{ username: string; text: string }>> {
    // Click comment icon if comments panel is not yet open
    const hasItems = await this.executeJS(`
      (function() {
        if (document.querySelectorAll('[data-e2e="comment-item"]').length > 0) return 'open';
        var btn = document.querySelector('[data-e2e="comment-icon"]');
        if (btn) { btn.click(); return 'clicked'; }
        return 'none';
      })()
    `).catch(() => 'none');
    if (hasItems === 'clicked') {
      await new Promise(r => setTimeout(r, 3000));
    }
    const result = await this.executeJS(`
      (function() {
        var comments = [];
        // Primary: data-e2e attribute selector
        var items = document.querySelectorAll('[data-e2e="comment-item"]');
        // Fallback: class-based selectors used by TikTok video pages
        if (items.length === 0) {
          items = document.querySelectorAll('[class*="DivCommentObjectWrapper"], [class*="DivCommentItemWrapper"]');
        }
        var seen = {};
        for (var i = 0; i < Math.min(items.length, ${limit}); i++) {
          var item = items[i];
          var userEl = item.querySelector('a[href*="/@"]');
          var headerEl = item.querySelector('[class*="DivCommentHeaderWrapper"]');
          var contentEl = item.querySelector('[class*="DivCommentContentWrapper"]');
          var textEl = contentEl || item.querySelector('p') || item.querySelector('span[class*="text"]');
          var username = '';
          if (userEl) { username = userEl.href.split('/@').pop() || ''; }
          else if (headerEl) { username = (headerEl.innerText || '').split('\\n')[0].trim().substring(0, 40); }
          var text = '';
          if (contentEl) {
            var spans = contentEl.querySelectorAll('span:not([class*="Sub"]):not([class*="Footer"]):not([class*="ReplyAction"]):not([class*="Time"])');
            if (spans.length) {
              // Use only unique span texts to avoid TikTok DOM duplication
              var seen2 = {}; var parts = [];
              for (var si = 0; si < spans.length; si++) {
                var st = (spans[si].innerText || '').trim();
                // Skip empty, timestamps (YYYY-MM-DD), pure numbers (like counts), and "Reply"
                if (!st || st.match(/^\\d{4}-\\d{1,2}-\\d{1,2}$/) || st.match(/^\\d{1,6}$/) || st === 'Reply') continue;
                if (seen2[st]) continue; seen2[st] = true;
                parts.push(st);
              }
              text = parts.join(' ').trim();
            }
            if (!text) { text = (contentEl.innerText || '').split('\\n').filter(function(l) { return l.trim() && !l.match(/^\\d{4}-\\d|Reply|^\\d+ /); }).join(' ').trim(); }
            // Strip trailing timestamp + like count patterns: "2025-12-12 0" or "2025-11-26 3"
            text = text.replace(/\\s+\\d{4}-\\d{1,2}-\\d{1,2}\\s*\\d*\\s*$/, '').trim();
          } else if (textEl) { text = (textEl.innerText || '').substring(0, 500); }
          if (!username && !text) continue;
          var key = username + '|' + text.substring(0, 30);
          if (seen[key]) continue; seen[key] = true;
          comments.push({ username: username, text: text.substring(0, 500) });
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

  // ─── Creator Analytics ──────────────────────────────────
  // Navigates to tiktok.com/analytics/content and extracts per-video metrics
  // including avg watch time, completion rate, reach, and traffic sources.
  // Requires being logged in as the creator.
  async getAnalyticsContent(maxVideos = 10): Promise<{
    success: boolean;
    videos: Array<{
      videoId: string;
      thumbnail: string;
      caption: string;
      views: number;
      avgWatchTimeSeconds: number;
      completionRate: number;
      reach: number;
      trafficSource: Record<string, number>;
    }>;
    error?: string;
  }> {
    try {
      // Navigate to analytics content page
      console.log('[TikTok] Navigating to analytics/content...');
      await this.navigate('https://www.tiktok.com/analytics/content');
      await new Promise(r => setTimeout(r, 5000)); // analytics pages load slowly

      // Check if we're on the analytics page and logged in
      const pageCheck = await this.executeJS(
        `(function(){var u=window.location.href;var isAnalytics=u.indexOf('analytics')>=0;var isLogin=u.indexOf('login')>=0;return JSON.stringify({url:u.substring(0,120),isAnalytics:isAnalytics,isLogin:isLogin});})()`
      );
      const check = JSON.parse(pageCheck || '{}');
      if (check.isLogin) {
        return { success: false, videos: [], error: 'Not logged in — redirected to login page' };
      }
      if (!check.isAnalytics) {
        return { success: false, videos: [], error: `Not on analytics page: ${check.url}` };
      }

      // Scroll to load more content
      for (let i = 0; i < 3; i++) {
        await this.executeJS(`window.scrollBy(0, 600)`);
        await new Promise(r => setTimeout(r, 1000));
      }

      // Extract video analytics data from the content tab
      // TikTok analytics content page shows a table/list of videos with metrics
      const raw = await this.executeJS(
        `(function(){` +
        `var results=[];` +
        `function parseNum(t){if(!t)return 0;t=t.replace(/,/g,'').trim();var n=parseFloat(t);if(isNaN(n))return 0;if(t.match(/[Kk]$/))return Math.round(n*1000);if(t.match(/[Mm]$/))return Math.round(n*1000000);return Math.round(n);}` +
        `function parseDuration(t){if(!t)return 0;t=t.trim();var m=t.match(/(\\d+):(\\d+)/);if(m)return parseInt(m[1])*60+parseInt(m[2]);var s=t.match(/(\\d+\\.?\\d*)\\s*s/i);if(s)return parseFloat(s[1]);var mn=t.match(/(\\d+\\.?\\d*)\\s*m/i);if(mn)return parseFloat(mn[1])*60;return parseFloat(t)||0;}` +
        `function parsePct(t){if(!t)return 0;t=t.trim().replace('%','');return parseFloat(t)||0;}` +
        // Strategy 1: Look for video cards/rows in analytics content page
        `var rows=document.querySelectorAll('[class*="VideoItem"], [class*="video-item"], [class*="ContentCard"], tr[class*="video"], [class*="PostItem"]');` +
        `if(rows.length===0){` +
          // Strategy 2: try table rows
          `rows=document.querySelectorAll('table tbody tr');` +
        `}` +
        `if(rows.length===0){` +
          // Strategy 3: look for any container with video links
          `var links=document.querySelectorAll('a[href*="/video/"]');` +
          `for(var i=0;i<Math.min(links.length,${maxVideos});i++){` +
            `var a=links[i];var href=a.getAttribute('href')||'';var idM=href.match(/video\\/(\\d+)/);` +
            `if(idM){results.push({videoId:idM[1],caption:'',views:0,avgWatchTimeSeconds:0,completionRate:0,reach:0,trafficSource:{}});}` +
          `}` +
        `}else{` +
          `for(var i=0;i<Math.min(rows.length,${maxVideos});i++){` +
            `var row=rows[i];var text=row.innerText||'';` +
            `var link=row.querySelector('a[href*="/video/"]');` +
            `var href=link?(link.getAttribute('href')||''):'';` +
            `var idM=href.match(/video\\/(\\d+)/);` +
            `var videoId=idM?idM[1]:'';` +
            `var img=row.querySelector('img');` +
            `var thumb=img?(img.getAttribute('src')||''):'';` +
            // Extract all numbers from the row text
            `var nums=text.match(/[\\d,.]+[KkMm%]?/g)||[];` +
            // Try to find duration pattern (e.g. "0:15" or "15s")
            `var durM=text.match(/(\\d+:\\d+|\\d+\\.?\\d*\\s*s)/i);` +
            `var dur=durM?parseDuration(durM[0]):0;` +
            // Try to find percentage
            `var pctM=text.match(/(\\d+\\.?\\d*)\\s*%/);` +
            `var pct=pctM?parsePct(pctM[0]):0;` +
            `var caption=row.querySelector('[class*="caption"], [class*="desc"], [class*="title"]');` +
            `var capText=caption?caption.textContent.trim().substring(0,200):'';` +
            `results.push({videoId:videoId,thumbnail:thumb,caption:capText,views:nums.length>0?parseNum(nums[0]):0,avgWatchTimeSeconds:dur,completionRate:pct,reach:nums.length>1?parseNum(nums[1]):0,trafficSource:{}});` +
          `}` +
        `}` +
        // Also capture raw page text for debugging
        `var bodyText=(document.querySelector('main')||document.body).innerText.substring(0,2000);` +
        `return JSON.stringify({videos:results,pageText:bodyText,rowCount:rows.length});` +
        `})()`
      );

      const data = JSON.parse(raw || '{"videos":[],"pageText":"","rowCount":0}');
      console.log(`[TikTok] Analytics: found ${data.videos.length} videos (${data.rowCount} rows on page)`);

      // Log first 200 chars of page text for debugging
      if (data.videos.length === 0 && data.pageText) {
        console.log(`[TikTok] Analytics page text (first 200): ${data.pageText.substring(0, 200)}`);
      }

      return {
        success: true,
        videos: data.videos.filter((v: any) => v.videoId), // only return videos with IDs
      };
    } catch (e) {
      console.error('[TikTok] Analytics scrape error:', (e as Error).message);
      return { success: false, videos: [], error: (e as Error).message };
    }
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

  // ─── DM Operations ──────────────────────────────────────────

  async sendDM(username: string, message: string): Promise<{ success: boolean; error?: string }> {
    try {
      console.log(`[TikTok] Sending DM to @${username}: "${message.substring(0, 50)}..."`);

      // Navigate to messages page
      await this.navigate('https://www.tiktok.com/messages');
      await this.wait(3000);

      // Click new message button
      const clickedNew = await this.executeJS(`
        (function() {
          var btns = document.querySelectorAll('button, div[role="button"]');
          for (var i = 0; i < btns.length; i++) {
            var text = (btns[i].textContent || '').trim();
            if (text.includes('New message') || text.includes('New chat') || text.includes('Send message')) {
              btns[i].click();
              return 'clicked';
            }
          }
          return 'not_found';
        })()
      `);

      if (clickedNew !== 'clicked') {
        return { success: false, error: 'Could not find new message button' };
      }

      await this.wait(2000);

      // Type username in search
      const searchInput = await this.executeJS(`
        (function() {
          var inputs = document.querySelectorAll('input[type="text"], input[placeholder*="search"], input[placeholder*="name"]');
          for (var i = 0; i < inputs.length; i++) {
            if (inputs[i].offsetParent !== null) {
              inputs[i].focus();
              inputs[i].value = '${username.replace(/'/g, "\\'")}';
              inputs[i].dispatchEvent(new Event('input', {bubbles: true}));
              return 'typed';
            }
          }
          return 'not_found';
        })()
      `);

      if (searchInput !== 'typed') {
        return { success: false, error: 'Could not find search input' };
      }

      await this.wait(2000);

      // Click on the user
      const clickedUser = await this.executeJS(`
        (function() {
          var users = document.querySelectorAll('[role="option"], div[class*="user"], div[class*="User"]');
          for (var i = 0; i < users.length; i++) {
            if ((users[i].textContent || '').includes('${username.replace(/'/g, "\\'")}')) {
              users[i].click();
              return 'clicked';
            }
          }
          return 'not_found';
        })()
      `);

      if (clickedUser !== 'clicked') {
        return { success: false, error: 'Could not find user in search results' };
      }

      await this.wait(1500);

      // Type message
      const escaped = message.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
      const typedMessage = await this.executeJS(`
        (function() {
          var inputs = document.querySelectorAll('div[contenteditable="true"], textarea, input[type="text"]');
          for (var i = 0; i < inputs.length; i++) {
            if (inputs[i].offsetParent !== null) {
              inputs[i].focus();
              inputs[i].innerText = '${escaped}';
              inputs[i].dispatchEvent(new InputEvent('input', {bubbles: true}));
              return 'typed';
            }
          }
          return 'not_found';
        })()
      `);

      if (typedMessage !== 'typed') {
        return { success: false, error: 'Could not find message input' };
      }

      await this.wait(1000);

      // Click send button
      const sent = await this.executeJS(`
        (function() {
          var btns = document.querySelectorAll('button, div[role="button"]');
          for (var i = 0; i < btns.length; i++) {
            var text = (btns[i].textContent || '').trim().toLowerCase();
            if (text === 'send' && !btns[i].disabled) {
              btns[i].click();
              return 'sent';
            }
          }
          return 'not_found';
        })()
      `);

      if (sent !== 'sent') {
        return { success: false, error: 'Could not find send button' };
      }

      console.log(`[TikTok] ✅ DM sent to @${username}`);
      return { success: true };

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[TikTok] DM send error:`, errorMsg);
      return { success: false, error: errorMsg };
    }
  }

  async getDMConversations(): Promise<Array<{ username: string; lastMessage: string; timestamp: string; unread: boolean }>> {
    try {
      await this.navigate('https://www.tiktok.com/messages');
      await this.wait(3000);

      const raw = await this.executeJS(`
        (function() {
          var convos = [];
          var items = document.querySelectorAll('[data-e2e="chat-item"], div[class*="ChatItem"], div[class*="conversation"], li[role="button"]');
          for (var i = 0; i < Math.min(items.length, 50); i++) {
            var item = items[i];
            var userEl = item.querySelector('[data-e2e="chat-username"], a[href*="/@"], span[class*="username"], span[class*="Username"]');
            var username = userEl ? (userEl.textContent || '').trim() : '';
            var msgEl = item.querySelector('[data-e2e="chat-message"], div[class*="message"], span[class*="message"]');
            var lastMsg = msgEl ? (msgEl.textContent || '').trim().substring(0, 100) : '';
            var timeEl = item.querySelector('time, span[class*="time"], span[class*="Time"]');
            var timestamp = timeEl ? (timeEl.textContent || '').trim() : '';
            var unread = !!item.querySelector('[class*="unread"], [class*="Unread"], [data-e2e="unread"]');
            if (username) {
              convos.push({ username: username, lastMessage: lastMsg, timestamp: timestamp, unread: unread });
            }
          }
          return JSON.stringify(convos);
        })()
      `);

      return JSON.parse(raw || '[]');
    } catch {
      return [];
    }
  }

  async getDMMessages(conversationId: string): Promise<Array<{ from: string; text: string; timestamp: string; isOwn: boolean }>> {
    try {
      // Navigate to conversation
      await this.navigate(`https://www.tiktok.com/messages?conversation=${conversationId}`);
      await this.wait(3000);

      const raw = await this.executeJS(`
        (function() {
          var messages = [];
          var items = document.querySelectorAll('[data-e2e="message-item"], div[class*="Message"], div[class*="message"]');
          for (var i = 0; i < Math.min(items.length, 100); i++) {
            var item = items[i];
            var textEl = item.querySelector('[data-e2e="message-text"], span[class*="text"], p');
            var text = textEl ? (textEl.textContent || '').trim() : '';
            var isOwn = !!item.closest('[class*="own"], [class*="Own"], [data-e2e="own-message"]');
            var timeEl = item.querySelector('time, span[class*="time"]');
            var timestamp = timeEl ? (timeEl.getAttribute('datetime') || timeEl.textContent || '').trim() : '';
            var from = isOwn ? 'me' : 'them';
            if (text) {
              messages.push({ from: from, text: text.substring(0, 500), timestamp: timestamp, isOwn: isOwn });
            }
          }
          return JSON.stringify(messages);
        })()
      `);

      return JSON.parse(raw || '[]');
    } catch {
      return [];
    }
  }

  async searchDMConversation(username: string): Promise<{ found: boolean; conversationId?: string }> {
    try {
      await this.navigate('https://www.tiktok.com/messages');
      await this.wait(3000);

      const result = await this.executeJS(`
        (function() {
          var searchQuery = '${username.replace(/'/g, "\\'")}';
          var items = document.querySelectorAll('[data-e2e="chat-item"], div[class*="ChatItem"]');
          for (var i = 0; i < items.length; i++) {
            var item = items[i];
            if ((item.textContent || '').toLowerCase().includes(searchQuery.toLowerCase())) {
              var link = item.querySelector('a[href]');
              if (link) {
                var href = link.getAttribute('href') || '';
                var match = href.match(/conversation=([^&]+)/);
                return JSON.stringify({ found: true, conversationId: match ? match[1] : '' });
              }
              return JSON.stringify({ found: true, conversationId: '' });
            }
          }
          return JSON.stringify({ found: false });
        })()
      `);

      return JSON.parse(result || '{"found":false}');
    } catch {
      return { found: false };
    }
  }

  // ─── Profile Operations ─────────────────────────────────────

  async getOwnProfile(): Promise<{ username: string; followerCount: number; followingCount: number; videoCount: number; likesCount: number; bio: string }> {
    try {
      // Navigate to profile page
      await this.navigate('https://www.tiktok.com/@me');
      await this.wait(3000);

      const raw = await this.executeJS(`
        (function() {
          function parseNum(el) {
            if (!el) return 0;
            var t = (el.textContent || '').trim().replace(/,/g, '');
            var n = parseFloat(t);
            if (isNaN(n)) return 0;
            if (t.match(/[Kk]$/)) return Math.round(n * 1000);
            if (t.match(/[Mm]$/)) return Math.round(n * 1000000);
            return Math.round(n);
          }
          var username = '';
          var userEl = document.querySelector('[data-e2e="user-title"], h1, h2');
          if (userEl) username = (userEl.textContent || '').trim();
          var followers = parseNum(document.querySelector('[data-e2e="followers-count"]'));
          var following = parseNum(document.querySelector('[data-e2e="following-count"]'));
          var likes = parseNum(document.querySelector('[data-e2e="likes-count"]'));
          var bioEl = document.querySelector('[data-e2e="user-bio"]');
          var bio = bioEl ? (bioEl.textContent || '').trim() : '';
          var videoEls = document.querySelectorAll('[data-e2e="user-post-item"], div[class*="DivItemContainer"]');
          var videoCount = videoEls.length;
          return JSON.stringify({ username, followerCount: followers, followingCount: following, videoCount, likesCount: likes, bio });
        })()
      `);

      return JSON.parse(raw || '{"username":"","followerCount":0,"followingCount":0,"videoCount":0,"likesCount":0,"bio":""}');
    } catch {
      return { username: '', followerCount: 0, followingCount: 0, videoCount: 0, likesCount: 0, bio: '' };
    }
  }

  // ─── Search Operations ──────────────────────────────────────

  async searchVideos(query: string, limit = 20): Promise<Array<{ id: string; url: string; author: string; description: string; views: number }>> {
    try {
      const searchUrl = `https://www.tiktok.com/search/video?q=${encodeURIComponent(query)}`;
      await this.navigate(searchUrl);
      await this.wait(4000);

      const raw = await this.executeJS(`
        (function() {
          function parseNum(t) {
            if (!t) return 0;
            t = t.replace(/,/g, '').trim();
            var n = parseFloat(t);
            if (isNaN(n)) return 0;
            if (t.match(/[Kk]$/)) return Math.round(n * 1000);
            if (t.match(/[Mm]$/)) return Math.round(n * 1000000);
            return Math.round(n);
          }
          var results = [];
          var cards = document.querySelectorAll('[data-e2e="search_video-item"]');
          for (var i = 0; i < Math.min(cards.length, ${limit}); i++) {
            var card = cards[i];
            var link = card.querySelector('a[href*="/video/"]');
            if (!link) continue;
            var href = link.getAttribute('href') || '';
            var idMatch = href.match(/\\/video\\/(\\d+)/);
            var id = idMatch ? idMatch[1] : '';
            var url = href.startsWith('http') ? href : 'https://www.tiktok.com' + href;
            var userMatch = href.match(/@([^\\/]+)\\/video/);
            var author = userMatch ? userMatch[1] : '';
            var descEl = card.querySelector('[data-e2e="search-card-video-caption"]');
            var desc = descEl ? descEl.textContent.trim().substring(0, 200) : '';
            var viewsEl = card.querySelector('[data-e2e="video-views"]');
            var views = viewsEl ? parseNum(viewsEl.textContent) : 0;
            if (id) results.push({ id, url, author, description: desc, views });
          }
          return JSON.stringify(results);
        })()
      `);

      return JSON.parse(raw || '[]');
    } catch {
      return [];
    }
  }

  // ─── Trending Operations ────────────────────────────────────

  async getTrendingSounds(): Promise<Array<{ title: string; author: string; useCount: number }>> {
    try {
      await this.navigate('https://www.tiktok.com/music');
      await this.wait(4000);

      const raw = await this.executeJS(`
        (function() {
          function parseNum(t) {
            if (!t) return 0;
            t = t.replace(/,/g, '').trim();
            var n = parseFloat(t);
            if (isNaN(n)) return 0;
            if (t.match(/[Kk]$/)) return Math.round(n * 1000);
            if (t.match(/[Mm]$/)) return Math.round(n * 1000000);
            return Math.round(n);
          }
          var sounds = [];
          var items = document.querySelectorAll('[class*="MusicItem"], [class*="SoundItem"], div[class*="music"]');
          for (var i = 0; i < Math.min(items.length, 30); i++) {
            var item = items[i];
            var titleEl = item.querySelector('[class*="title"], [class*="Title"], h3, h4');
            var title = titleEl ? titleEl.textContent.trim() : '';
            var authorEl = item.querySelector('[class*="author"], [class*="Author"]');
            var author = authorEl ? authorEl.textContent.trim() : '';
            var useEl = item.querySelector('[class*="use"], [class*="Use"], [class*="count"]');
            var useCount = useEl ? parseNum(useEl.textContent) : 0;
            if (title) sounds.push({ title, author, useCount });
          }
          return JSON.stringify(sounds);
        })()
      `);

      return JSON.parse(raw || '[]');
    } catch {
      return [];
    }
  }

  // ─── Comment Operations ─────────────────────────────────────

  async replyToComment(commentId: string, text: string): Promise<{ success: boolean; error?: string }> {
    try {
      // Click reply button
      const clickedReply = await this.executeJS(`
        (function() {
          var items = document.querySelectorAll('[data-e2e="comment-item"]');
          for (var i = 0; i < items.length; i++) {
            var item = items[i];
            if (item.getAttribute('data-comment-id') === '${commentId}' || item.innerText.includes('${commentId}')) {
              var replyBtn = item.querySelector('[data-e2e="comment-reply"], button[class*="reply"], button');
              if (replyBtn && replyBtn.textContent.toLowerCase().includes('reply')) {
                replyBtn.click();
                return 'clicked';
              }
            }
          }
          return 'not_found';
        })()
      `);

      if (clickedReply !== 'clicked') {
        return { success: false, error: 'Could not find reply button' };
      }

      await this.wait(1000);

      // Type reply
      const result = await this.postComment(text);
      return result;
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  async likeComment(commentId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const clicked = await this.executeJS(`
        (function() {
          var items = document.querySelectorAll('[data-e2e="comment-item"]');
          for (var i = 0; i < items.length; i++) {
            var item = items[i];
            if (item.getAttribute('data-comment-id') === '${commentId}' || item.innerText.includes('${commentId}')) {
              var likeBtn = item.querySelector('[data-e2e="comment-like"], button[class*="like"], svg[class*="heart"]');
              if (likeBtn) {
                var btn = likeBtn.closest('button');
                if (btn) {
                  btn.click();
                  return 'clicked';
                }
              }
            }
          }
          return 'not_found';
        })()
      `);

      if (clicked === 'clicked') {
        return { success: true };
      } else {
        return { success: false, error: 'Could not find like button' };
      }
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }
}
