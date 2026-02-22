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
    const tempFile = path.join(os.tmpdir(), `safari-js-${Date.now()}.js`);

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
        await execAsync(
          `osascript -e 'tell application "Safari" to set URL of front document to "${url}"'`,
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
      const escaped = text.replace(/"/g, '\\"').replace(/`/g, '\\`').replace(/\$/g, '\\$');
      await execAsync(`echo -n "${escaped}" | pbcopy`);
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
      await execAsync(`osascript -e 'tell application "Safari" to activate'`);
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
