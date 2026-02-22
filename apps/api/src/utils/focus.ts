/**
 * macOS App Focus Utility
 * 
 * Uses AppleScript to bring apps to the foreground, ensuring macOS
 * gives them full CPU/GPU priority for automation tasks.
 * 
 * Key behaviors:
 *   - Brings app to frontmost position
 *   - Activates the app (unminimizes if needed)
 *   - Optionally waits for the app to be ready
 *   - Can restore the previous frontmost app after automation
 */

import { execSync } from 'child_process';
import { logger } from './logger.js';

export type FocusableApp = 'Safari' | 'Google Chrome' | 'Chromium' | 'Firefox';

/**
 * Bring an app to the foreground using AppleScript.
 * Returns true if successful, false otherwise.
 */
export function focusApp(appName: FocusableApp | string): boolean {
  try {
    execSync(`osascript -e 'tell application "${appName}" to activate'`, {
      timeout: 5000,
      stdio: 'pipe',
    });
    logger.info(`[focus] Activated: ${appName}`);
    return true;
  } catch (err: any) {
    logger.warn(`[focus] Failed to activate ${appName}: ${err.message}`);
    return false;
  }
}

/**
 * Bring Safari to the foreground using robust multi-step activation.
 * Steps: activate → set frontmost → AXRaise → open -a fallback
 */
export function focusSafari(): boolean {
  try {
    execSync(`osascript -e '
tell application "Safari" to activate
delay 0.2
tell application "System Events"
    set frontmost of process "Safari" to true
    try
        perform action "AXRaise" of front window of process "Safari"
    end try
end tell'`, { timeout: 5000, stdio: 'pipe' });
    logger.info('[focus] Safari activated (robust multi-step)');
    return true;
  } catch {
    // Fallback: open -a Safari
    try {
      execSync('open -a Safari', { timeout: 5000, stdio: 'pipe' });
      logger.info('[focus] Safari activated via open -a fallback');
      return true;
    } catch (err: any) {
      logger.warn(`[focus] Failed to focus Safari: ${err.message}`);
      return false;
    }
  }
}

/**
 * Get Safari browser state: running, frontmost, window count, current URL, page title.
 */
export function getSafariState(): {
  running: boolean;
  frontmost: boolean;
  windowCount: number;
  currentUrl: string;
  pageTitle: string;
} {
  try {
    const result = execSync(`osascript -e '
tell application "System Events"
    set isFront to frontmost of process "Safari"
    set isRunning to exists process "Safari"
end tell
tell application "Safari"
    set wc to count of windows
    set u to ""
    set t to ""
    try
        set u to URL of front document
        set t to name of front document
    end try
end tell
return (isRunning as text) & "|" & (isFront as text) & "|" & (wc as text) & "|" & u & "|" & t'`,
      { timeout: 5000, stdio: 'pipe' }
    ).toString().trim();
    const parts = result.split('|');
    return {
      running: parts[0] === 'true',
      frontmost: parts[1] === 'true',
      windowCount: parseInt(parts[2]) || 0,
      currentUrl: parts[3] || '',
      pageTitle: parts[4] || '',
    };
  } catch {
    return { running: false, frontmost: false, windowCount: 0, currentUrl: '', pageTitle: '' };
  }
}

/**
 * Bring the Puppeteer/Chrome browser to the foreground.
 * Tries Chromium first (Puppeteer's default), then Chrome.
 */
export function focusChrome(): boolean {
  // Puppeteer on macOS typically uses Chromium
  if (focusApp('Chromium')) return true;
  return focusApp('Google Chrome');
}

/**
 * Get the name of the currently frontmost application.
 * Used to restore focus after automation completes.
 */
export function getFrontmostApp(): string | null {
  try {
    const result = execSync(
      `osascript -e 'tell application "System Events" to get name of first application process whose frontmost is true'`,
      { timeout: 3000, stdio: 'pipe' }
    );
    return result.toString().trim();
  } catch {
    return null;
  }
}

/**
 * Ensure a specific app is running and in the foreground.
 * If the app isn't running, this will launch it.
 */
export function ensureAppFocused(appName: string): boolean {
  try {
    // Check if app is running
    const checkScript = `
      tell application "System Events"
        set appRunning to (name of processes) contains "${appName}"
      end tell
      return appRunning
    `;
    const isRunning = execSync(`osascript -e '${checkScript}'`, {
      timeout: 3000,
      stdio: 'pipe',
    }).toString().trim() === 'true';

    if (!isRunning) {
      logger.info(`[focus] ${appName} not running, launching...`);
      execSync(`open -a "${appName}"`, { timeout: 10000, stdio: 'pipe' });
      // Wait a moment for the app to launch
      execSync('sleep 1', { stdio: 'pipe' });
    }

    return focusApp(appName);
  } catch (err: any) {
    logger.warn(`[focus] ensureAppFocused failed for ${appName}: ${err.message}`);
    return false;
  }
}

/**
 * Bring Safari to the front and make a specific window/tab active.
 * Useful when Safari has multiple windows.
 */
export function focusSafariWindow(windowIndex: number = 1): boolean {
  try {
    const script = `
      tell application "Safari"
        activate
        set index of window ${windowIndex} to 1
      end tell
    `;
    execSync(`osascript -e '${script}'`, { timeout: 5000, stdio: 'pipe' });
    logger.info(`[focus] Safari window ${windowIndex} focused`);
    return true;
  } catch (err: any) {
    logger.warn(`[focus] Failed to focus Safari window: ${err.message}`);
    return focusSafari(); // Fallback to just activating Safari
  }
}

/**
 * Minimize all other apps and bring target to focus.
 * Use sparingly — this is aggressive.
 */
export function exclusiveFocus(appName: string): boolean {
  try {
    execSync(
      `osascript -e 'tell application "System Events" to set visible of every process whose name is not "${appName}" to false'`,
      { timeout: 5000, stdio: 'pipe' }
    );
    return focusApp(appName);
  } catch (err: any) {
    logger.warn(`[focus] exclusiveFocus failed: ${err.message}`);
    return focusApp(appName);
  }
}
