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
        var navMsg = document.querySelector('${TIKTOK_SELECTORS.navMessages}');
        var navMsgAlt = document.querySelector('${TIKTOK_SELECTORS.navMessagesAlt}');
        var loginButton = document.querySelector('${TIKTOK_SELECTORS.loginButton}');
        if (loginButton && !navMsg && !navMsgAlt) return 'not_logged_in';
        return (navMsg || navMsgAlt) ? 'logged_in' : 'unknown';
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
   * Type text using OS-level keystrokes (works with React contenteditable).
   */
  async typeViaKeystrokes(text: string): Promise<boolean> {
    try {
      await this.activateSafari();
      await this.wait(300);
      const escaped = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      await execPromise(
        `osascript -e 'tell application "System Events" to tell process "Safari" to keystroke "${escaped}"'`
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Press Enter key via OS-level event.
   */
  async pressEnter(): Promise<boolean> {
    try {
      await execPromise(
        `osascript -e 'tell application "System Events" to tell process "Safari" to keystroke return'`
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Bring Safari to the foreground.
   */
  async activateSafari(): Promise<boolean> {
    try {
      await execPromise(`osascript -e '
tell application "Safari" to activate
delay 0.2
tell application "System Events"
    set frontmost of process "Safari" to true
    try
        perform action "AXRaise" of front window of process "Safari"
    end try
end tell'`);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Click at a specific viewport position using OS-level mouse events.
   * Converts viewport coordinates to screen coordinates and performs a real click.
   * Essential for TikTok's virtual-rendered conversation list items.
   */
  async clickAtViewportPosition(viewportX: number, viewportY: number): Promise<boolean> {
    try {
      await this.activateSafari();
      await this.wait(300);
      
      // Get Safari window position
      const boundsStr = await execPromise(
        `osascript -e 'tell application "Safari" to get bounds of front window'`
      );
      const parts = boundsStr.stdout.trim().split(', ');
      const winX = parseInt(parts[0]);
      const winY = parseInt(parts[1]);
      
      // Safari toolbar height is ~75px (title bar + tab bar + address bar)
      const toolbarHeight = 75;
      const screenX = winX + viewportX;
      const screenY = winY + toolbarHeight + viewportY;
      
      // Write a temp Python script for Quartz mouse click
      const fs = await import('fs');
      const tmpFile = '/tmp/_safari_click.py';
      fs.writeFileSync(tmpFile, [
        'import Quartz, time',
        `x, y = ${screenX}, ${screenY}`,
        'move = Quartz.CGEventCreateMouseEvent(None, Quartz.kCGEventMouseMoved, (x, y), Quartz.kCGMouseButtonLeft)',
        'Quartz.CGEventPost(Quartz.kCGHIDEventTap, move)',
        'time.sleep(0.15)',
        'down = Quartz.CGEventCreateMouseEvent(None, Quartz.kCGEventLeftMouseDown, (x, y), Quartz.kCGMouseButtonLeft)',
        'Quartz.CGEventPost(Quartz.kCGHIDEventTap, down)',
        'time.sleep(0.05)',
        'up = Quartz.CGEventCreateMouseEvent(None, Quartz.kCGEventLeftMouseUp, (x, y), Quartz.kCGMouseButtonLeft)',
        'Quartz.CGEventPost(Quartz.kCGHIDEventTap, up)',
        'print("clicked")',
      ].join('\n'));
      
      const result = await execPromise(`python3 ${tmpFile}`);
      return result.stdout.includes('clicked');
    } catch (error) {
      console.error('clickAtViewportPosition error:', error);
      return false;
    }
  }

  /**
   * Find an element by text content and click at its position using OS-level click.
   * Useful for TikTok's virtual-rendered list items.
   */
  async clickElementByText(searchText: string): Promise<boolean> {
    // First try to find the element position via JS
    const posResult = await this.executeScript(`
      (function() {
        var all = document.querySelectorAll('li, div[class*="Item"], div[class*="conversation"], a');
        for (var i = 0; i < all.length; i++) {
          var t = (all[i].textContent || '').trim();
          if (t.includes('${searchText.replace(/'/g, "\\'")}')) {
            var r = all[i].getBoundingClientRect();
            if (r.width > 0 && r.height > 0) {
              return JSON.stringify({x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2), w: r.width, h: r.height});
            }
            // Try parent element
            var parent = all[i].parentElement;
            if (parent) {
              r = parent.getBoundingClientRect();
              if (r.width > 0 && r.height > 0) {
                return JSON.stringify({x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2), w: r.width, h: r.height});
              }
            }
          }
        }
        return 'not_found';
      })()
    `);
    
    if (posResult !== 'not_found') {
      try {
        const pos = JSON.parse(posResult);
        return this.clickAtViewportPosition(pos.x, pos.y);
      } catch {}
    }
    
    return false;
  }

  /**
   * Focus an element matched by CSS selector.
   */
  async focusElement(selector: string): Promise<boolean> {
    const result = await this.executeScript(`
      (function() {
        var el = document.querySelector('${selector.replace(/'/g, "\\'")}');
        if (el) { el.focus(); el.click(); return 'focused'; }
        return 'not_found';
      })()
    `);
    return result === 'focused';
  }

  /**
   * Type text into an element (for contenteditable divs) — JS fallback
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
