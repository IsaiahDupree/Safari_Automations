/**
 * Safari Automation Driver
 * Handles low-level Safari/AppleScript interactions.
 * Works with both local and remote Safari instances.
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
      actionDelay: config.actionDelay || 1000,
      verbose: config.verbose || false,
    };
  }

  /**
   * Execute JavaScript in Safari and return the result.
   */
  async executeJS(js: string): Promise<string> {
    if (this.config.instanceType === 'remote' && this.config.remoteUrl) {
      return this.executeRemoteJS(js);
    }
    return this.executeLocalJS(js);
  }

  /**
   * Execute JavaScript in local Safari via AppleScript.
   */
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
        console.log('[SafariDriver] JS result:', stdout.trim().substring(0, 100));
      }
      
      return stdout.trim();
    } catch (error) {
      await fs.unlink(tempFile).catch(() => {});
      if (this.config.verbose) {
        console.error('[SafariDriver] JS error:', error);
      }
      throw error;
    }
  }

  /**
   * Execute JavaScript on remote Safari via HTTP endpoint.
   */
  private async executeRemoteJS(js: string): Promise<string> {
    if (!this.config.remoteUrl) {
      throw new Error('Remote URL not configured');
    }
    
    const response = await fetch(`${this.config.remoteUrl}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ script: js }),
    });
    
    if (!response.ok) {
      throw new Error(`Remote execution failed: ${response.statusText}`);
    }
    
    const result = await response.json() as { output?: string };
    return result.output || '';
  }

  /**
   * Navigate Safari to a URL.
   */
  async navigateTo(url: string): Promise<boolean> {
    try {
      const safeUrl = url.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      if (this.config.instanceType === 'local') {
        await execAsync(
          `osascript -e 'tell application "Safari" to set URL of front document to "${safeUrl}"'`,
          { timeout: this.config.timeout }
        );
      } else {
        await this.executeRemoteJS(`window.location.href = "${safeUrl}"`);
      }
      await this.wait(2000);
      return true;
    } catch (error) {
      if (this.config.verbose) {
        console.error('[SafariDriver] Navigation error:', error);
      }
      return false;
    }
  }

  /**
   * Get current URL from Safari.
   */
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

  /**
   * Check if Safari is on Instagram.
   */
  async isOnInstagram(): Promise<boolean> {
    const url = await this.getCurrentUrl();
    return url.includes('instagram.com');
  }

  /**
   * Check if logged in to Instagram.
   */
  async isLoggedIn(): Promise<boolean> {
    const result = await this.executeJS(`
      (function() {
        var notLoggedIn = document.querySelector('input[name="username"]') ||
                          document.querySelector('button[type="submit"]')?.innerText?.includes('Log in');
        return notLoggedIn ? 'false' : 'true';
      })()
    `);
    return result === 'true';
  }

  /**
   * Wait for specified milliseconds.
   */
  async wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Wait for an element to appear.
   */
  async waitForElement(selector: string, maxWaitMs: number = 10000): Promise<boolean> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWaitMs) {
      const found = await this.executeJS(`
        document.querySelector('${selector}') ? 'found' : 'not_found'
      `);
      
      if (found === 'found') return true;
      await this.wait(500);
    }
    
    return false;
  }

  /**
   * Type text using OS-level keystrokes (works with React contenteditable).
   * This bypasses JavaScript event injection issues.
   */
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
    } catch (error) {
      if (this.config.verbose) console.error('[SafariDriver] Keystroke error:', error);
      return false;
    }
  }

  /**
   * Press Enter key via OS-level event.
   */
  async pressEnter(): Promise<boolean> {
    if (this.config.instanceType !== 'local') return false;
    try {
      await execAsync(
        `osascript -e 'tell application "System Events" to tell process "Safari" to keystroke return'`,
        { timeout: this.config.timeout }
      );
      return true;
    } catch (error) {
      if (this.config.verbose) console.error('[SafariDriver] Enter key error:', error);
      return false;
    }
  }

  /**
   * Bring Safari to the foreground.
   */
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

  /**
   * Click an element matched by CSS selector.
   */
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
   * Focus an element matched by CSS selector.
   */
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

  /**
   * Take a screenshot (local only).
   */
  async takeScreenshot(outputPath: string): Promise<boolean> {
    if (this.config.instanceType !== 'local') {
      return false;
    }
    
    try {
      await execAsync(`screencapture -x "${outputPath}"`);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the current configuration.
   */
  getConfig(): AutomationConfig {
    return { ...this.config };
  }

  /**
   * Update configuration.
   */
  setConfig(config: Partial<AutomationConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

// Singleton instance for convenience
let defaultDriver: SafariDriver | null = null;

export function getDefaultDriver(): SafariDriver {
  if (!defaultDriver) {
    defaultDriver = new SafariDriver();
  }
  return defaultDriver;
}

export function setDefaultDriver(driver: SafariDriver): void {
  defaultDriver = driver;
}
