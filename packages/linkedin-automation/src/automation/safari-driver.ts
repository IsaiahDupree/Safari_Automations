/**
 * Safari Automation Driver for LinkedIn
 * Handles low-level Safari/AppleScript interactions.
 * Extra-conservative rate limiting due to LinkedIn's anti-automation detection.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { AutomationConfig } from './types.js';

const execAsync = promisify(exec);

export class SafariDriver {
  private config: AutomationConfig;

  constructor(config: Partial<AutomationConfig> = {}) {
    this.config = {
      instanceType: config.instanceType || 'local',
      remoteUrl: config.remoteUrl,
      timeout: config.timeout || 30000,
      actionDelay: config.actionDelay || 2000,
      verbose: config.verbose || false,
    };
  }

  async executeJS(js: string): Promise<string> {
    if (this.config.instanceType === 'remote' && this.config.remoteUrl) {
      return this.executeRemoteJS(js);
    }
    return this.executeLocalJS(js);
  }

  private async executeLocalJS(js: string): Promise<string> {
    const cleanJS = js.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
    const tempFile = path.join(os.tmpdir(), `safari-js-${Date.now()}-${Math.random().toString(36).substr(2, 6)}.js`);

    await fs.writeFile(tempFile, cleanJS);

    const script = `
      set jsCode to read POSIX file "${tempFile}" as «class utf8»
      tell application "Safari" to do JavaScript jsCode in front document
    `;

    try {
      const { stdout } = await execAsync(
        `osascript -e '${script.replace(/'/g, "'\"'\"'")}'`,
        { timeout: this.config.timeout }
      );
      await fs.unlink(tempFile).catch(() => {});

      if (this.config.verbose) {
        console.log('[SafariDriver:LinkedIn] JS result:', stdout.trim().substring(0, 100));
      }

      return stdout.trim();
    } catch (error) {
      await fs.unlink(tempFile).catch(() => {});
      if (this.config.verbose) {
        console.error('[SafariDriver:LinkedIn] JS error:', error);
      }
      throw error;
    }
  }

  private async executeRemoteJS(js: string): Promise<string> {
    if (!this.config.remoteUrl) throw new Error('Remote URL not configured');

    const response = await fetch(`${this.config.remoteUrl}/api/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ script: js }),
    });

    if (!response.ok) throw new Error(`Remote execution failed: ${response.statusText}`);
    const result = await response.json() as { output?: string };
    return result.output || '';
  }

  async navigateTo(url: string): Promise<boolean> {
    try {
      if (this.config.instanceType === 'local') {
        const safeUrl = url.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        await execAsync(
          `osascript -e 'tell application "Safari" to set URL of front document to "${safeUrl}"'`,
          { timeout: this.config.timeout }
        );
      } else {
        await this.executeRemoteJS(`window.location.href = "${url}"`);
      }
      // LinkedIn loads slower — extra wait
      await this.wait(4000);
      return true;
    } catch (error) {
      if (this.config.verbose) console.error('[SafariDriver:LinkedIn] Navigation error:', error);
      return false;
    }
  }

  async getCurrentUrl(): Promise<string> {
    try {
      if (this.config.instanceType === 'local') {
        const { stdout } = await execAsync(
          `osascript -e 'tell application "Safari" to get URL of front document'`
        );
        return stdout.trim();
      } else {
        return await this.executeJS('window.location.href');
      }
    } catch {
      return '';
    }
  }

  async isOnLinkedIn(): Promise<boolean> {
    const url = await this.getCurrentUrl();
    return url.includes('linkedin.com');
  }

  async isLoggedIn(): Promise<boolean> {
    const result = await this.executeJS(`
      (function() {
        var nav = document.querySelector('.global-nav__me') ||
                  document.querySelector('[data-test-id="feed-container"]') ||
                  document.querySelector('.feed-identity-module') ||
                  document.querySelector('img.global-nav__me-photo');
        var loginForm = document.querySelector('.login__form') ||
                        document.querySelector('input#username');
        if (nav) return 'logged_in';
        if (loginForm) return 'not_logged_in';
        return 'unknown';
      })()
    `);
    return result === 'logged_in';
  }

  async wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /** Human-like random delay between min and max ms */
  async humanDelay(minMs: number = 2000, maxMs: number = 5000): Promise<void> {
    const delay = minMs + Math.random() * (maxMs - minMs);
    return this.wait(delay);
  }

  async waitForElement(selector: string, maxWaitMs: number = 10000): Promise<boolean> {
    const startTime = Date.now();
    while (Date.now() - startTime < maxWaitMs) {
      const found = await this.executeJS(
        `document.querySelector('${selector}') ? 'found' : 'not_found'`
      );
      if (found === 'found') return true;
      await this.wait(500);
    }
    return false;
  }

  async typeViaKeystrokes(text: string): Promise<boolean> {
    if (this.config.instanceType !== 'local') return false;
    try {
      await this.activateSafari();
      await this.wait(300);
      const escaped = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      await execAsync(
        `osascript -e 'tell application "System Events" to tell process "Safari" to keystroke "${escaped}"'`,
        { timeout: this.config.timeout }
      );
      return true;
    } catch {
      return false;
    }
  }

  async typeViaClipboard(text: string): Promise<boolean> {
    if (this.config.instanceType !== 'local') return false;
    try {
      const escaped = text.replace(/"/g, '\\"').replace(/`/g, '\\`').replace(/\$/g, '\\$').replace(/%/g, '%%');
      await execAsync(`printf "%s" "${escaped}" | pbcopy`);
      await this.wait(200);
      await this.activateSafari();
      await this.wait(200);
      await execAsync(
        `osascript -e 'tell application "System Events" to keystroke "v" using command down'`
      );
      return true;
    } catch {
      return false;
    }
  }

  async pressEnter(): Promise<boolean> {
    if (this.config.instanceType !== 'local') return false;
    try {
      await execAsync(
        `osascript -e 'tell application "System Events" to tell process "Safari" to keystroke return'`,
        { timeout: this.config.timeout }
      );
      return true;
    } catch {
      return false;
    }
  }

  async pressEscape(): Promise<boolean> {
    if (this.config.instanceType !== 'local') return false;
    try {
      await execAsync(
        `osascript -e 'tell application "System Events" to tell process "Safari" to key code 53'`,
        { timeout: this.config.timeout }
      );
      return true;
    } catch {
      return false;
    }
  }

  async activateSafari(): Promise<boolean> {
    try {
      await execAsync(`osascript -e '
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

  async clickElement(selector: string): Promise<boolean> {
    const result = await this.executeJS(`
      (function() {
        var el = document.querySelector('${selector.replace(/'/g, "\\'")}');
        if (el) { el.click(); return 'clicked'; }
        return 'not_found';
      })()
    `);
    return result === 'clicked';
  }

  /**
   * OS-level click at viewport coordinates using Quartz mouse events.
   * Required for Ember.js UIs (like LinkedIn messaging) that ignore JS .click().
   */
  async clickAtViewportPosition(viewportX: number, viewportY: number): Promise<boolean> {
    try {
      await this.activateSafari();
      await this.wait(300);
      const boundsStr = await execAsync(
        `osascript -e 'tell application "Safari" to get bounds of front window'`
      );
      const parts = boundsStr.stdout.trim().split(', ');
      const winX = parseInt(parts[0]);
      const winY = parseInt(parts[1]);
      const winBottom = parseInt(parts[3]);
      const winHeight = winBottom - winY;
      // Dynamically calculate toolbar offset from window height vs viewport height
      const vpHeightStr = await this.executeJS('window.innerHeight.toString()');
      const vpHeight = parseInt(vpHeightStr) || 800;
      const toolbarHeight = Math.max(winHeight - vpHeight, 50);
      console.log(`[SafariDriver] Click: win(${winX},${winY}) toolbar=${toolbarHeight}px vp=(${viewportX},${viewportY})`);
      const screenX = winX + viewportX;
      const screenY = winY + toolbarHeight + viewportY;
      const fs = await import('fs');
      const tmpFile = '/tmp/_linkedin_click.py';
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
      const result = await execAsync(`python3 ${tmpFile}`);
      return result.stdout.includes('clicked');
    } catch (error) {
      console.error('clickAtViewportPosition error:', error);
      return false;
    }
  }

  /**
   * Find an element by CSS selector and click at its center using OS-level click.
   */
  async nativeClickSelector(selector: string): Promise<boolean> {
    const posResult = await this.executeJS(`
      (function() {
        var el = document.querySelector('${selector.replace(/'/g, "\\'")}');
        if (el) {
          var r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) {
            return JSON.stringify({x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2)});
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
   * Find an element containing text and click at its center using OS-level click.
   */
  async nativeClickByText(searchText: string, scope?: string): Promise<boolean> {
    const scopeSel = scope ? `'${scope.replace(/'/g, "\\'")}'` : 'null';
    const posResult = await this.executeJS(`
      (function() {
        var root = ${scopeSel} ? document.querySelector(${scopeSel}) : document;
        if (!root) return 'not_found';
        var all = root.querySelectorAll('li, div, a, span');
        for (var i = 0; i < all.length; i++) {
          var nameEls = all[i].querySelectorAll('.msg-conversation-listitem__participant-names, .msg-conversation-card__participant-names');
          for (var j = 0; j < nameEls.length; j++) {
            if (nameEls[j].innerText.trim().toLowerCase().includes('${searchText.toLowerCase().replace(/'/g, "\\'")}')) {
              var r = all[i].getBoundingClientRect();
              if (r.width > 0 && r.height > 0) {
                return JSON.stringify({x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2)});
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

  async focusElement(selector: string): Promise<boolean> {
    const result = await this.executeJS(`
      (function() {
        var el = document.querySelector('${selector.replace(/'/g, "\\'")}');
        if (el) { el.focus(); el.click(); return 'focused'; }
        return 'not_found';
      })()
    `);
    return result === 'focused';
  }

  async scroll(pixels: number): Promise<boolean> {
    try {
      await this.executeJS(`window.scrollBy(0, ${pixels})`);
      return true;
    } catch {
      return false;
    }
  }

  async takeScreenshot(outputPath: string): Promise<boolean> {
    if (this.config.instanceType !== 'local') return false;
    try {
      await execAsync(`screencapture -x "${outputPath}"`);
      return true;
    } catch {
      return false;
    }
  }

  getConfig(): AutomationConfig { return { ...this.config }; }
  setConfig(config: Partial<AutomationConfig>): void { this.config = { ...this.config, ...config }; }
}

let defaultDriver: SafariDriver | null = null;
export function getDefaultDriver(): SafariDriver {
  if (!defaultDriver) defaultDriver = new SafariDriver();
  return defaultDriver;
}
export function setDefaultDriver(driver: SafariDriver): void { defaultDriver = driver; }
