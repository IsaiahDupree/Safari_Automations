/**
 * Safari Executor
 * 
 * Low-level Safari automation using AppleScript.
 * Based on the Python safari_controller.py from MediaPoster.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import type { SafariConfig, JSExecutionResult, NavigationResult, PageState } from './types';
import { DEFAULT_CONFIG } from './types';

const execAsync = promisify(exec);

export class SafariExecutor {
  private config: SafariConfig;

  constructor(config: Partial<SafariConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Execute AppleScript and return result
   */
  async runAppleScript(script: string): Promise<{ success: boolean; output: string; error?: string }> {
    try {
      const escapedScript = script.replace(/'/g, "'\"'\"'");
      const { stdout, stderr } = await execAsync(`osascript -e '${escapedScript}'`, {
        timeout: this.config.timeout,
      });

      if (stderr && !stderr.includes('missing value')) {
        console.debug('AppleScript stderr:', stderr);
      }

      return { success: true, output: stdout.trim() };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, output: '', error: message };
    }
  }

  /**
   * Ensure Safari is running and has a window
   */
  async ensureSafariReady(): Promise<boolean> {
    const script = `
tell application "Safari"
    activate
    if (count of windows) = 0 then
        make new document
        delay 1
    end if
    return "ready"
end tell`;

    const result = await this.runAppleScript(script);
    return result.success;
  }

  /**
   * Navigate Safari to a URL
   */
  async navigateTo(url: string, waitMs: number = 3000): Promise<NavigationResult> {
    const startTime = Date.now();
    
    await this.ensureSafariReady();

    const script = `
tell application "Safari"
    activate
    set URL of front document to "${url}"
end tell`;

    const result = await this.runAppleScript(script);

    if (!result.success) {
      return {
        success: false,
        url: '',
        error: result.error,
        loadTime: Date.now() - startTime,
      };
    }

    // Wait for page load
    await this.wait(waitMs);

    const currentUrl = await this.getCurrentUrl();
    const title = await this.getPageTitle();

    return {
      success: true,
      url: currentUrl,
      title,
      loadTime: Date.now() - startTime,
    };
  }

  /**
   * Navigate with domain verification and retry
   */
  async navigateWithVerification(
    url: string,
    domain: string,
    maxAttempts: number = 3
  ): Promise<NavigationResult> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0) {
        await this.navigateTo('about:blank', 1000);
      }

      const result = await this.navigateTo(url, 2000);

      if (await this.waitForUrlContains(domain, 8000)) {
        const currentUrl = await this.getCurrentUrl();
        return {
          success: true,
          url: currentUrl,
          loadTime: result.loadTime,
        };
      }

      console.log(`Navigation retry ${attempt + 1}/${maxAttempts}...`);
    }

    return {
      success: false,
      url: '',
      error: `Failed to verify domain: ${domain}`,
      loadTime: 0,
    };
  }

  /**
   * Get current Safari URL
   */
  async getCurrentUrl(): Promise<string> {
    const script = 'tell application "Safari" to return URL of front document';
    const result = await this.runAppleScript(script);
    return result.success ? result.output : '';
  }

  /**
   * Get page title
   */
  async getPageTitle(): Promise<string> {
    const script = 'tell application "Safari" to return name of front document';
    const result = await this.runAppleScript(script);
    return result.success ? result.output : '';
  }

  /**
   * Wait until URL contains expected string
   */
  async waitForUrlContains(expected: string, timeoutMs: number = 10000): Promise<boolean> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeoutMs) {
      const url = await this.getCurrentUrl();
      if (url.includes(expected)) {
        return true;
      }
      await this.wait(1000);
    }
    
    return false;
  }

  /**
   * Execute JavaScript in Safari
   */
  async executeJS(code: string): Promise<JSExecutionResult> {
    // Escape JavaScript for AppleScript
    const escapedJS = code
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n');

    const script = `
tell application "Safari"
    tell front window
        tell current tab
            do JavaScript "${escapedJS}"
        end tell
    end tell
end tell`;

    const result = await this.runAppleScript(script);
    
    return {
      success: result.success,
      result: result.success ? result.output : null,
      error: result.error,
    };
  }

  /**
   * Execute JavaScript from a file (for longer scripts)
   */
  async executeJSFile(jsCode: string): Promise<JSExecutionResult> {
    const tempFile = path.join('/tmp', `safari_js_${Date.now()}.js`);
    
    try {
      fs.writeFileSync(tempFile, jsCode);

      const script = `
tell application "Safari"
    tell front document
        set jsCode to read POSIX file "${tempFile}"
        do JavaScript jsCode
    end tell
end tell`;

      const result = await this.runAppleScript(script);
      
      return {
        success: result.success,
        result: result.success ? result.output : null,
        error: result.error,
      };
    } finally {
      try {
        fs.unlinkSync(tempFile);
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Get page state
   */
  async getPageState(): Promise<PageState> {
    const jsCode = `
(function() {
    return JSON.stringify({
        url: window.location.href,
        title: document.title,
        isLoaded: document.readyState === 'complete',
        hasErrors: !!document.querySelector('.error, [class*="error"]')
    });
})();`;

    const result = await this.executeJS(jsCode);
    
    if (result.success && result.result) {
      try {
        return JSON.parse(result.result);
      } catch {
        // Fall back to basic info
      }
    }

    return {
      url: await this.getCurrentUrl(),
      title: await this.getPageTitle(),
      isLoaded: true,
      hasErrors: false,
    };
  }

  /**
   * Take screenshot of Safari window
   */
  async takeScreenshot(filepath: string): Promise<boolean> {
    const script = `
tell application "Safari" to activate
delay 0.3
tell application "System Events"
    tell process "Safari"
        set frontWindow to front window
        set winPos to position of frontWindow
        set winSize to size of frontWindow
    end tell
end tell
set x to item 1 of winPos
set y to item 2 of winPos
set w to item 1 of winSize
set h to item 2 of winSize
do shell script "screencapture -R" & x & "," & y & "," & w & "," & h & " ${filepath}"`;

    const result = await this.runAppleScript(script);
    return result.success;
  }

  /**
   * Type text using clipboard paste (supports emojis)
   */
  async typeViaClipboard(text: string): Promise<boolean> {
    // Copy to clipboard using echo and pipe
    const escaped = text.replace(/"/g, '\\"').replace(/`/g, '\\`').replace(/\$/g, '\\$');
    await execAsync(`echo -n "${escaped}" | pbcopy`).catch(() => null);

    await this.wait(200);

    // Paste
    const script = `
tell application "Safari" to activate
delay 0.2
tell application "System Events"
    keystroke "v" using command down
end tell`;

    const result = await this.runAppleScript(script);
    return result.success;
  }

  /**
   * Press Enter key
   */
  async pressEnter(): Promise<boolean> {
    const script = `
tell application "Safari" to activate
delay 0.1
tell application "System Events"
    keystroke return
end tell`;

    const result = await this.runAppleScript(script);
    return result.success;
  }

  /**
   * Press Escape key
   */
  async pressEscape(): Promise<boolean> {
    const script = `
tell application "Safari" to activate
delay 0.1
tell application "System Events"
    key code 53
end tell`;

    const result = await this.runAppleScript(script);
    return result.success;
  }

  /**
   * Click at coordinates
   */
  async clickAt(x: number, y: number): Promise<boolean> {
    const script = `
tell application "Safari" to activate
delay 0.1
tell application "System Events"
    click at {${x}, ${y}}
end tell`;

    const result = await this.runAppleScript(script);
    return result.success;
  }

  /**
   * Scroll page
   */
  async scroll(pixels: number): Promise<boolean> {
    const result = await this.executeJS(`window.scrollBy(0, ${pixels})`);
    return result.success;
  }

  /**
   * Refresh page
   */
  async refresh(): Promise<boolean> {
    const result = await this.executeJS('location.reload()');
    await this.wait(2000);
    return result.success;
  }

  /**
   * Wait helper
   */
  private wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
