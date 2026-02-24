/**
 * Medium Safari Driver
 *
 * Core browser automation for Medium via macOS Safari + AppleScript.
 * Handles navigation, JS injection, smart waits, typing, and screenshots.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const execAsync = promisify(exec);

// ═══════════════════════════════════════════════════════════════
// Selectors — all from Medium's data-testid attributes
// ═══════════════════════════════════════════════════════════════

export const SELECTORS = {
  // Header / Navigation
  HEADER_LOGO: '[data-testid="headerMediumLogo"]',
  HEADER_WRITE: '[data-testid="headerWriteButton"]',
  HEADER_SEARCH_INPUT: '[data-testid="headerSearchInput"]',
  HEADER_SEARCH_BUTTON: '[data-testid="headerSearchButton"]',
  HEADER_NOTIFICATIONS: '[data-testid="headerNotificationButton"]',
  HEADER_NOTIFICATION_COUNT: '[data-testid="headerNotificationCount"]',
  HEADER_USER_ICON: '[data-testid="headerUserIcon"]',

  // Article Page — Top Bar
  HEADER_CLAP: '[data-testid="headerClapButton"]',
  HEADER_BOOKMARK: '[data-testid="headerBookmarkButton"]',
  HEADER_SHARE: '[data-testid="headerSocialShareButton"]',
  HEADER_OPTIONS: '[data-testid="headerStoryOptionsButton"]',
  AUDIO_PLAY: '[data-testid="audioPlayButton"]',

  // Article Page — Footer Bar
  FOOTER_CLAP: '[data-testid="footerClapButton"]',
  FOOTER_BOOKMARK: '[data-testid="footerBookmarkButton"]',
  FOOTER_SHARE: '[data-testid="footerSocialShareButton"]',
  FOOTER_OPTIONS: '[data-testid="footerStoryOptionsButton"]',

  // Article Content
  STORY_TITLE: '[data-testid="storyTitle"]',
  AUTHOR_NAME: '[data-testid="authorName"]',
  AUTHOR_PHOTO: '[data-testid="authorPhoto"]',
  READ_TIME: '[data-testid="storyReadTime"]',

  // Response (Comment) Area
  RESPONSE_TEXTBOX: 'div[role="textbox"][data-slate-editor="true"]',
  RESPONSE_RESPOND_BTN: '[data-testid="ResponseRespondButton"]',
  RESPONSE_CANCEL_BTN: '[data-testid="CancelResponseButton"]',

  // Feed
  POST_PREVIEW: 'article[data-testid="post-preview"]',

  // New Story Editor
  EDITOR_TITLE: '[data-testid="editorTitleParagraph"]',
  EDITOR_BODY: '[data-testid="editorParagraphText"]',
  EDITOR_CONTENT: '.postArticle-content.js-postField',
  EDITOR_ADD_BTN: '[data-testid="editorAddButton"]',

  // Follow
  FOLLOW_BUTTON: 'button',  // Matched by text content "Follow"
};

// ═══════════════════════════════════════════════════════════════
// SafariDriver
// ═══════════════════════════════════════════════════════════════

export class MediumSafariDriver {
  private screenshotDir: string;

  constructor() {
    this.screenshotDir = path.join(os.homedir(), '.medium-automation', 'screenshots');
    if (!fs.existsSync(this.screenshotDir)) fs.mkdirSync(this.screenshotDir, { recursive: true });
  }

  // ─── Execute JavaScript in Safari ──────────────────────────

  async executeJS(script: string, timeout = 15000): Promise<string> {
    const tmpFile = path.join(os.tmpdir(), `medium_js_${Date.now()}.scpt`);
    const escaped = script.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
    fs.writeFileSync(tmpFile, `tell application "Safari" to do JavaScript "${escaped}" in current tab of front window`);
    try {
      const { stdout } = await execAsync(`osascript "${tmpFile}"`, { timeout });
      return stdout.trim();
    } finally {
      try { fs.unlinkSync(tmpFile); } catch {}
    }
  }

  // ─── Navigate to URL ──────────────────────────────────────

  async navigate(url: string): Promise<boolean> {
    try {
      await execAsync(`osascript -e 'tell application "Safari" to set URL of current tab of front window to "${url}"'`, { timeout: 10000 });
      await this.waitForPageLoad(10000);
      return true;
    } catch (e) {
      console.error(`[Medium] Navigate failed: ${e}`);
      return false;
    }
  }

  // ─── Wait for page load ────────────────────────────────────

  async waitForPageLoad(maxWait = 10000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < maxWait) {
      await this.sleep(500);
      try {
        const state = await this.executeJS('document.readyState', 3000);
        if (state === 'complete' || state === 'interactive') return true;
      } catch {}
    }
    return false;
  }

  // ─── Wait for selector to appear ──────────────────────────

  async waitForSelector(selector: string, maxWait = 10000): Promise<boolean> {
    const escaped = selector.replace(/'/g, "\\'");
    const start = Date.now();
    while (Date.now() - start < maxWait) {
      try {
        const result = await this.executeJS(`document.querySelector('${escaped}') ? 'found' : 'waiting'`, 3000);
        if (result === 'found') return true;
      } catch {}
      await this.sleep(500);
    }
    return false;
  }

  // ─── Type text into focused element ────────────────────────

  async typeText(text: string): Promise<boolean> {
    // Strategy 1: execCommand insertText (works with most React/contenteditable)
    try {
      const escaped = text.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
      const result = await this.executeJS(`
        (function() {
          var el = document.activeElement;
          if (!el) return 'no_focus';
          document.execCommand('insertText', false, '${escaped}');
          return 'typed';
        })()
      `);
      if (result === 'typed') return true;
    } catch {}

    // Strategy 2: OS-level keystrokes
    try {
      await execAsync(`osascript -e 'tell application "System Events" to keystroke "${text.replace(/"/g, '\\"')}"'`, { timeout: 10000 });
      return true;
    } catch {}

    // Strategy 3: Clipboard paste
    try {
      await execAsync(`echo "${text.replace(/"/g, '\\"')}" | pbcopy`);
      await execAsync(`osascript -e 'tell application "System Events" to keystroke "v" using command down'`);
      await this.sleep(300);
      return true;
    } catch {}

    return false;
  }

  // ─── Type into Slate.js editor (for responses) ────────────

  async typeIntoSlateEditor(selector: string, text: string): Promise<boolean> {
    const escaped = text.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
    const selEsc = selector.replace(/'/g, "\\'");

    // Focus the Slate editor
    const focusResult = await this.executeJS(`
      (function() {
        var el = document.querySelector('${selEsc}');
        if (!el) return 'not_found';
        el.focus();
        return 'focused';
      })()
    `);
    if (focusResult !== 'focused') return false;
    await this.sleep(300);

    // Clear existing content + type
    const typed = await this.executeJS(`
      (function() {
        var el = document.querySelector('${selEsc}');
        if (!el) return 'not_found';
        el.focus();
        // Select all and delete
        document.execCommand('selectAll');
        document.execCommand('delete');
        // Insert text
        document.execCommand('insertText', false, '${escaped}');
        // Trigger input event
        el.dispatchEvent(new Event('input', {bubbles: true}));
        return 'typed';
      })()
    `);

    return typed === 'typed';
  }

  // ─── Type into Medium's classic editor (graf-based) ────────

  async typeIntoGrafEditor(text: string, isTitle = false): Promise<boolean> {
    const selector = isTitle ? SELECTORS.EDITOR_TITLE : SELECTORS.EDITOR_BODY;
    const selEsc = selector.replace(/'/g, "\\'");
    const escaped = text.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');

    // Click the element to focus it
    const clicked = await this.executeJS(`
      (function() {
        var el = document.querySelector('${selEsc}');
        if (!el) return 'not_found';
        el.click();
        el.focus();
        return 'focused';
      })()
    `);
    if (clicked !== 'focused') return false;
    await this.sleep(300);

    // Select all and replace
    const result = await this.executeJS(`
      (function() {
        document.execCommand('selectAll');
        document.execCommand('delete');
        document.execCommand('insertText', false, '${escaped}');
        return 'typed';
      })()
    `);
    return result === 'typed';
  }

  // ─── Click element ─────────────────────────────────────────

  async clickElement(selector: string): Promise<boolean> {
    const selEsc = selector.replace(/'/g, "\\'");
    const result = await this.executeJS(`
      (function() {
        var el = document.querySelector('${selEsc}');
        if (!el) return 'not_found';
        el.click();
        return 'clicked';
      })()
    `);
    return result === 'clicked';
  }

  // ─── Click button by text content ──────────────────────────

  async clickButtonByText(text: string): Promise<boolean> {
    const escaped = text.replace(/'/g, "\\'");
    const result = await this.executeJS(`
      (function() {
        var buttons = document.querySelectorAll('button, div[role="button"], a[role="button"]');
        for (var i = 0; i < buttons.length; i++) {
          var btnText = buttons[i].textContent.trim();
          if (btnText === '${escaped}' && buttons[i].offsetParent !== null) {
            buttons[i].click();
            return 'clicked';
          }
        }
        return 'not_found';
      })()
    `);
    return result === 'clicked';
  }

  // ─── Get text content of an element ────────────────────────

  async getTextContent(selector: string): Promise<string | null> {
    const selEsc = selector.replace(/'/g, "\\'");
    const result = await this.executeJS(`
      (function() {
        var el = document.querySelector('${selEsc}');
        return el ? el.textContent.trim() : '';
      })()
    `);
    return result || null;
  }

  // ─── Get current URL ───────────────────────────────────────

  async getCurrentURL(): Promise<string> {
    return this.executeJS('document.URL');
  }

  // ─── Screenshot ────────────────────────────────────────────

  async captureScreenshot(label: string): Promise<string> {
    const filename = `medium_${label}_${Date.now()}.png`;
    const filepath = path.join(this.screenshotDir, filename);
    try {
      await execAsync(`screencapture -x "${filepath}"`);
      return filepath;
    } catch {
      return '';
    }
  }

  // ─── Check login status ────────────────────────────────────

  async checkLoginStatus(): Promise<'logged_in' | 'not_logged_in' | 'unknown'> {
    try {
      const result = await this.executeJS(`
        (function() {
          if (document.querySelector('[data-testid="headerUserIcon"]')) return 'logged_in';
          if (document.querySelector('[data-testid="headerNotificationButton"]')) return 'logged_in';
          if (document.querySelector('[data-testid="headerWriteButton"]')) return 'logged_in';
          if (document.querySelector('a[href*="signin"]') || document.querySelector('a[href*="login"]')) return 'not_logged_in';
          return 'unknown';
        })()
      `);
      return result as 'logged_in' | 'not_logged_in' | 'unknown';
    } catch {
      return 'unknown';
    }
  }

  // ─── Helpers ───────────────────────────────────────────────

  async sleep(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
  }

  async activateSafari(): Promise<void> {
    await execAsync('osascript -e \'tell application "Safari" to activate\'');
  }
}
