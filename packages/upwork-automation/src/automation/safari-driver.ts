/**
 * Safari Automation Driver for Upwork
 * Handles low-level Safari/AppleScript interactions.
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
      actionDelay: config.actionDelay || 1500,
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
    const cleanJS = js.trim();
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
        console.log('[SafariDriver:Upwork] JS result:', stdout.trim().substring(0, 100));
      }

      return stdout.trim();
    } catch (error) {
      await fs.unlink(tempFile).catch(() => {});
      if (this.config.verbose) {
        console.error('[SafariDriver:Upwork] JS error:', error);
      }
      throw error;
    }
  }

  private async executeRemoteJS(js: string): Promise<string> {
    if (!this.config.remoteUrl) {
      throw new Error('Remote URL not configured');
    }

    const response = await fetch(`${this.config.remoteUrl}/api/execute`, {
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
      await this.wait(3000);

      // Check for CAPTCHA / "Are you human?" challenge and handle it
      await this.handleCaptchaIfPresent();

      return true;
    } catch (error) {
      if (this.config.verbose) {
        console.error('[SafariDriver:Upwork] Navigation error:', error);
      }
      return false;
    }
  }

  /**
   * Detect and handle CAPTCHA / human verification challenges.
   * Upwork uses Cloudflare Turnstile and reCAPTCHA.
   * Strategy:
   *   1. Detect challenge page by title, body text, or iframe presence
   *   2. Try clicking the checkbox/button via JS
   *   3. If that fails, try OS-level click on the checkbox coordinates
   *   4. Wait and re-check — if still blocked, log and wait for human
   */
  async handleCaptchaIfPresent(maxWaitSec: number = 30): Promise<boolean> {
    const detection = await this.executeJS(`
      (function() {
        var title = document.title.toLowerCase();
        var body = (document.body ? document.body.innerText : '').toLowerCase().substring(0, 1000);

        var isCaptchaPage =
          title.includes('just a moment') ||
          title.includes('attention required') ||
          title.includes('security check') ||
          body.includes('verify you are human') ||
          body.includes('are you human') ||
          body.includes('checking your browser') ||
          body.includes('please wait') ||
          body.includes('one more step') ||
          !!document.querySelector('iframe[src*="turnstile"]') ||
          !!document.querySelector('iframe[src*="challenge"]') ||
          !!document.querySelector('#challenge-running') ||
          !!document.querySelector('.cf-turnstile') ||
          !!document.querySelector('[id*="captcha"]');

        if (!isCaptchaPage) return 'clear';

        // Try to find and click the checkbox/button
        var clicked = false;

        // Cloudflare Turnstile checkbox
        var turnstile = document.querySelector('.cf-turnstile input[type="checkbox"]') ||
                        document.querySelector('iframe[src*="turnstile"]');
        if (turnstile && turnstile.tagName === 'INPUT') {
          turnstile.click();
          clicked = true;
        }

        // Generic verify buttons
        var buttons = document.querySelectorAll('button, input[type="submit"], [role="button"]');
        for (var btn of buttons) {
          var text = (btn.innerText || btn.value || '').toLowerCase();
          if (text.includes('verify') || text.includes('human') || text.includes('continue') || text.includes('confirm')) {
            btn.click();
            clicked = true;
            break;
          }
        }

        // reCAPTCHA checkbox
        var recaptcha = document.querySelector('.recaptcha-checkbox, #recaptcha-anchor');
        if (recaptcha) {
          recaptcha.click();
          clicked = true;
        }

        return clicked ? 'clicked' : 'captcha_present';
      })()
    `);

    if (detection === 'clear') {
      return true; // No CAPTCHA
    }

    if (this.config.verbose) {
      console.log('[SafariDriver:Upwork] CAPTCHA detected, status:', detection);
    }

    if (detection === 'clicked') {
      // Clicked something, wait and see if it resolves
      await this.wait(3000);

      // Re-check
      const recheck = await this.executeJS(`
        (function() {
          var title = document.title.toLowerCase();
          var body = (document.body ? document.body.innerText : '').toLowerCase().substring(0, 500);
          var still = title.includes('just a moment') || title.includes('attention') ||
                      body.includes('verify you are human') || body.includes('checking your browser');
          return still ? 'still_blocked' : 'resolved';
        })()
      `);

      if (recheck === 'resolved') {
        if (this.config.verbose) console.log('[SafariDriver:Upwork] CAPTCHA resolved after click');
        await this.wait(2000);
        return true;
      }
    }

    // Try OS-level click on Turnstile widget
    if (this.config.instanceType === 'local') {
      if (this.config.verbose) console.log('[SafariDriver:Upwork] Trying OS-level click on CAPTCHA...');

      // Get widget position — try iframe first, then div.main-wrapper (Cloudflare Turnstile)
      const posJson = await this.executeJS(`
        (function() {
          var el = document.querySelector('iframe[src*="turnstile"]') ||
                   document.querySelector('iframe[src*="challenge"]') ||
                   document.querySelector('.cf-turnstile iframe') ||
                   document.querySelector('iframe[title*="challenge"]');
          if (el) {
            var rect = el.getBoundingClientRect();
            return JSON.stringify({ x: rect.left + 25, y: rect.top + 25, w: rect.width, h: rect.height });
          }
          // Fallback: Cloudflare renders inside div.main-wrapper when iframe isn't queryable
          el = document.querySelector('div.main-wrapper');
          if (el) {
            var rect = el.getBoundingClientRect();
            if (rect.width > 200 && rect.width < 400 && rect.height > 40) {
              // Checkbox is ~17px from left edge, vertically centered
              return JSON.stringify({ x: rect.left + 17, y: rect.top + (rect.height / 2), w: rect.width, h: rect.height });
            }
          }
          return 'none';
        })()
      `);

      if (posJson !== 'none') {
        try {
          const pos = JSON.parse(posJson);
          if (pos.w > 0 && pos.h > 0) {
            await this.activateSafari();
            await this.wait(500);
            await this.clickAtViewportPosition(pos.x, pos.y);
            await this.wait(4000);

            const afterClick = await this.executeJS(`
              document.title.toLowerCase().includes('just a moment') ||
              (document.body.innerText || '').toLowerCase().includes('verify you are human') ? 'blocked' : 'clear'
            `);
            if (afterClick === 'clear') {
              if (this.config.verbose) console.log('[SafariDriver:Upwork] CAPTCHA resolved after OS click');
              await this.wait(2000);
              return true;
            }
          }
        } catch {}
      }
    }

    // Wait for human intervention
    if (this.config.verbose) {
      console.log(`[SafariDriver:Upwork] ⚠️ CAPTCHA requires human intervention. Waiting up to ${maxWaitSec}s...`);
    }

    const startTime = Date.now();
    while (Date.now() - startTime < maxWaitSec * 1000) {
      await this.wait(3000);
      const check = await this.executeJS(`
        (function() {
          var title = document.title.toLowerCase();
          var body = (document.body ? document.body.innerText : '').toLowerCase().substring(0, 500);
          var blocked = title.includes('just a moment') || title.includes('attention') ||
                        body.includes('verify you are human') || body.includes('checking your browser');
          return blocked ? 'blocked' : 'clear';
        })()
      `);
      if (check === 'clear') {
        if (this.config.verbose) console.log('[SafariDriver:Upwork] CAPTCHA resolved by human');
        await this.wait(2000);
        return true;
      }
    }

    console.warn('[SafariDriver:Upwork] ⚠️ CAPTCHA not resolved within timeout');
    return false;
  }

  /**
   * Click at a viewport position using OS-level mouse event.
   * Gets Safari window bounds and adds toolbar offset.
   */
  async clickAtViewportPosition(vpX: number, vpY: number): Promise<boolean> {
    if (this.config.instanceType !== 'local') return false;
    try {
      // Get Safari window position
      const { stdout } = await execAsync(
        `osascript -e 'tell application "Safari" to get bounds of front window'`
      );
      const parts = stdout.trim().split(',').map((s: string) => parseInt(s.trim()));
      const winX = parts[0] || 0;
      const winY = parts[1] || 0;
      const toolbarOffset = 92; // Safari toolbar height (URL bar + tab bar)

      const absX = winX + vpX;
      const absY = winY + toolbarOffset + vpY;

      // Use cliclick if available, otherwise Python Quartz with human-like movement
      try {
        await execAsync(`cliclick c:${Math.round(absX)},${Math.round(absY)}`);
      } catch {
        // Fallback: Python Quartz click with human-like mouse movement
        const pyScript = `
import Quartz, time
target = (${Math.round(absX)}, ${Math.round(absY)})
# Human-like mouse movement toward target
for step in range(6):
    mx = target[0] - 150 + step * 30
    my = target[1] - 60 + step * 12
    ev = Quartz.CGEventCreateMouseEvent(None, Quartz.kCGEventMouseMoved, (mx, my), Quartz.kCGMouseButtonLeft)
    Quartz.CGEventPost(Quartz.kCGHIDEventTap, ev)
    time.sleep(0.04)
time.sleep(0.15)
event = Quartz.CGEventCreateMouseEvent(None, Quartz.kCGEventLeftMouseDown, target, Quartz.kCGMouseButtonLeft)
Quartz.CGEventPost(Quartz.kCGHIDEventTap, event)
time.sleep(0.07)
event = Quartz.CGEventCreateMouseEvent(None, Quartz.kCGEventLeftMouseUp, target, Quartz.kCGMouseButtonLeft)
Quartz.CGEventPost(Quartz.kCGHIDEventTap, event)
`;
        const tmpPy = `/tmp/safari_click_${Date.now()}.py`;
        await fs.writeFile(tmpPy, pyScript);
        await execAsync(`python3 ${tmpPy}`);
        await fs.unlink(tmpPy).catch(() => {});
      }
      return true;
    } catch (error) {
      if (this.config.verbose) console.error('[SafariDriver:Upwork] OS click error:', error);
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

  async isOnUpwork(): Promise<boolean> {
    const url = await this.getCurrentUrl();
    return url.includes('upwork.com');
  }

  async isLoggedIn(): Promise<boolean> {
    const result = await this.executeJS(`
      (function() {
        var avatar = document.querySelector('[data-test="user-avatar"]') ||
                     document.querySelector('.nav-avatar') ||
                     document.querySelector('[data-cy="nav-user-avatar"]') ||
                     document.querySelector('img.nav-avatar');
        var loginForm = document.querySelector('input#login_username') ||
                        document.querySelector('input[name="login[username]"]');
        if (avatar) return 'logged_in';
        if (loginForm) return 'not_logged_in';
        return 'unknown';
      })()
    `);
    return result === 'logged_in';
  }

  async wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

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

  async pressTab(): Promise<boolean> {
    if (this.config.instanceType !== 'local') return false;
    try {
      await execAsync(
        `osascript -e 'tell application "System Events" to tell process "Safari" to keystroke tab'`,
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

  getConfig(): AutomationConfig {
    return { ...this.config };
  }

  setConfig(config: Partial<AutomationConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

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
