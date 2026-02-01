/**
 * Safari WebDriver for TikTok DM Automation
 * Handles low-level Safari/AppleScript interactions
 */

import { exec as execCallback } from 'child_process';
import { promisify } from 'util';
import { AutomationConfig, DEFAULT_CONFIG, TIKTOK_SELECTORS } from './types.js';

const execPromise = promisify(execCallback);

export interface SafariDriverOptions extends Partial<AutomationConfig> {
  remoteUrl?: string;
}

export class SafariDriver {
  private config: AutomationConfig;
  private remoteUrl?: string;

  constructor(options: SafariDriverOptions = {}) {
    this.config = { ...DEFAULT_CONFIG, ...options };
    this.remoteUrl = options.remoteUrl;
  }

  private log(...args: unknown[]): void {
    if (this.config.verbose) {
      console.log('[TikTok SafariDriver]', ...args);
    }
  }

  /**
   * Execute JavaScript in Safari via AppleScript
   */
  async executeScript(script: string): Promise<string> {
    if (this.remoteUrl) {
      return this.executeRemote(script);
    }

    const escapedScript = script
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n');

    const appleScript = `
      tell application "Safari"
        if (count of windows) = 0 then
          make new document
        end if
        set currentTab to current tab of front window
        do JavaScript "${escapedScript}" in currentTab
      end tell
    `;

    try {
      const { stdout } = await execPromise(`osascript -e '${appleScript.replace(/'/g, "'\"'\"'")}'`);
      return stdout.trim();
    } catch (error) {
      this.log('Script execution error:', error);
      throw error;
    }
  }

  /**
   * Execute script via remote Safari API
   */
  private async executeRemote(script: string): Promise<string> {
    const response = await fetch(`${this.remoteUrl}/api/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ script }),
    });

    if (!response.ok) {
      throw new Error(`Remote execution failed: ${response.statusText}`);
    }

    const data = await response.json() as { output?: string };
    return data.output || '';
  }

  /**
   * Navigate to a URL
   */
  async navigate(url: string): Promise<void> {
    this.log('Navigating to:', url);
    await this.executeScript(`window.location.href = "${url}"`);
    await this.wait(2000);
  }

  /**
   * Get current URL
   */
  async getCurrentUrl(): Promise<string> {
    return this.executeScript('window.location.href');
  }

  /**
   * Check if on TikTok
   */
  async isOnTikTok(): Promise<boolean> {
    const url = await this.getCurrentUrl();
    return url.includes('tiktok.com');
  }

  /**
   * Check if logged in to TikTok
   */
  async isLoggedIn(): Promise<boolean> {
    const result = await this.executeScript(`
      (function() {
        var profileIcon = document.querySelector('${TIKTOK_SELECTORS.profileIcon}');
        var uploadIcon = document.querySelector('${TIKTOK_SELECTORS.uploadIcon}');
        var loginButton = document.querySelector('${TIKTOK_SELECTORS.loginButton}');
        if (loginButton && !profileIcon && !uploadIcon) return 'not_logged_in';
        return (profileIcon || uploadIcon) ? 'logged_in' : 'unknown';
      })()
    `);
    return result === 'logged_in';
  }

  /**
   * Wait for specified milliseconds
   */
  async wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Wait for an element to appear
   */
  async waitForElement(selector: string, timeoutMs: number = 10000): Promise<boolean> {
    const startTime = Date.now();
    const checkInterval = 500;

    while (Date.now() - startTime < timeoutMs) {
      const result = await this.executeScript(`
        (function() {
          var el = document.querySelector('${selector}');
          return el ? 'found' : 'not_found';
        })()
      `);

      if (result === 'found') {
        return true;
      }

      await this.wait(checkInterval);
    }

    return false;
  }

  /**
   * Click an element
   */
  async clickElement(selector: string): Promise<boolean> {
    const result = await this.executeScript(`
      (function() {
        var el = document.querySelector('${selector}');
        if (el) {
          el.click();
          return 'clicked';
        }
        return 'not_found';
      })()
    `);
    return result === 'clicked';
  }

  /**
   * Type text into an element (for contenteditable divs)
   */
  async typeText(selector: string, text: string): Promise<boolean> {
    const escapedText = text
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n');

    const result = await this.executeScript(`
      (function() {
        var el = document.querySelector('${selector}');
        if (!el) el = document.querySelector('[contenteditable="true"]');
        if (!el) return 'not_found';
        
        el.focus();
        el.click();
        
        // For contenteditable divs (TikTok uses these)
        if (el.contentEditable === 'true' || el.getAttribute('contenteditable') === 'true') {
          document.execCommand('insertText', false, "${escapedText}");
          return 'typed';
        }
        
        // For regular inputs
        el.value = "${escapedText}";
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return 'typed';
      })()
    `);
    return result === 'typed';
  }

  /**
   * Take a screenshot (returns base64)
   */
  async takeScreenshot(): Promise<string | null> {
    if (this.remoteUrl) {
      const response = await fetch(`${this.remoteUrl}/api/screenshot`);
      if (response.ok) {
        const data = await response.json() as { screenshot?: string };
        return data.screenshot || null;
      }
      return null;
    }

    // Local screenshot via screencapture
    try {
      const timestamp = Date.now();
      const path = `/tmp/tiktok_screenshot_${timestamp}.png`;
      await execPromise(`screencapture -x ${path}`);
      const { stdout } = await execPromise(`base64 -i ${path}`);
      await execPromise(`rm ${path}`);
      return stdout.trim();
    } catch {
      return null;
    }
  }

  /**
   * Scroll element into view
   */
  async scrollIntoView(selector: string): Promise<boolean> {
    const result = await this.executeScript(`
      (function() {
        var el = document.querySelector('${selector}');
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          return 'scrolled';
        }
        return 'not_found';
      })()
    `);
    return result === 'scrolled';
  }
}
