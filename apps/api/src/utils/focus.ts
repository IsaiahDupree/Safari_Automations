/**
 * Browser focus helpers that obey the global singleton policy.
 *
 * This module never launches an arbitrary application. Safari startup is
 * delegated to browser-enforcer.py, while Chrome may only be focused when the
 * canonical CDP profile is already running. Chromium, Firefox, WebKit, and
 * caller-supplied application names are rejected.
 */

import { execFileSync } from 'child_process';
import { logger } from './logger.js';

export type FocusableApp = 'Safari' | 'Google Chrome';

const BROWSER_ENFORCER = '/Users/isaiahdupree/Documents/Software/Safari Automation/ops/browser-enforcer.py';
const ALLOWED_APPS = new Set<FocusableApp>(['Safari', 'Google Chrome']);

interface EnforcerStatus {
  chrome?: { canonical_pids?: number[] };
  safari?: { root_pids?: number[] };
  state?: { cool_until?: { chrome?: number; safari?: number } };
}

function readEnforcerStatus(): EnforcerStatus | null {
  try {
    const output = execFileSync('/usr/bin/python3', [BROWSER_ENFORCER, 'status'], {
      timeout: 10_000,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    });
    return JSON.parse(output) as EnforcerStatus;
  } catch (err: any) {
    logger.warn(`[focus] Browser enforcer status unavailable: ${err.message}`);
    return null;
  }
}

function coolingRemaining(status: EnforcerStatus, browser: 'chrome' | 'safari'): number {
  const coolUntil = Number(status.state?.cool_until?.[browser] || 0);
  return Math.max(0, Math.ceil(coolUntil - Date.now() / 1000));
}

function hasManagedRoot(status: EnforcerStatus, appName: FocusableApp): boolean {
  return appName === 'Safari'
    ? (status.safari?.root_pids?.length || 0) === 1
    : (status.chrome?.canonical_pids?.length || 0) === 1;
}

function validateApp(appName: string): appName is FocusableApp {
  if (ALLOWED_APPS.has(appName as FocusableApp)) return true;
  logger.warn(`[focus] Rejected non-policy application: ${appName}`);
  return false;
}

function focusExistingProcess(appName: FocusableApp): boolean {
  const status = readEnforcerStatus();
  if (!status) return false;

  const browser = appName === 'Safari' ? 'safari' : 'chrome';
  const remaining = coolingRemaining(status, browser);
  if (remaining > 0) {
    logger.warn(`[focus] ${appName} is cooling for ${remaining}s; focus denied`);
    return false;
  }
  if (!hasManagedRoot(status, appName)) {
    logger.warn(`[focus] Managed ${appName} is not running; focus will not launch it`);
    return false;
  }

  try {
    execFileSync('/usr/bin/osascript', [
      '-e',
      `tell application "System Events" to set frontmost of process "${appName}" to true`,
    ], { timeout: 5000, stdio: 'pipe' });
    logger.info(`[focus] Focused existing managed ${appName}`);
    return true;
  } catch (err: any) {
    logger.warn(`[focus] Failed to focus existing ${appName}: ${err.message}`);
    return false;
  }
}

/** Focus an allowlisted, already-running singleton without launching it. */
export function focusApp(appName: string): boolean {
  return validateApp(appName) && focusExistingProcess(appName);
}

/** Focus the existing Safari singleton; fail closed while absent or cooling. */
export function focusSafari(): boolean {
  return focusExistingProcess('Safari');
}

/** Focus the existing canonical Chrome singleton; never launch Chrome. */
export function focusChrome(): boolean {
  return focusExistingProcess('Google Chrome');
}

/**
 * Ensure Safari through the singleton enforcer and then focus it. Other apps,
 * including Chrome and alternate browser engines, are deliberately denied.
 */
export function ensureAppFocused(appName: string): boolean {
  if (appName !== 'Safari') {
    logger.warn(`[focus] Managed ensure denied for non-Safari app: ${appName}`);
    return false;
  }

  let status = readEnforcerStatus();
  if (!status) return false;
  const remaining = coolingRemaining(status, 'safari');
  if (remaining > 0) {
    logger.warn(`[focus] Safari is cooling for ${remaining}s; ensure denied`);
    return false;
  }

  if (!hasManagedRoot(status, 'Safari')) {
    try {
      execFileSync('/usr/bin/python3', [BROWSER_ENFORCER, 'ensure', 'safari'], {
        timeout: 30_000,
        stdio: 'pipe',
      });
    } catch (err: any) {
      logger.warn(`[focus] Browser enforcer could not ensure Safari: ${err.message}`);
      return false;
    }
    status = readEnforcerStatus();
    if (!status || coolingRemaining(status, 'safari') > 0 || !hasManagedRoot(status, 'Safari')) {
      logger.warn('[focus] Safari did not become available through the browser enforcer');
      return false;
    }
  }

  return focusExistingProcess('Safari');
}

/** Get Safari state without causing AppleScript to launch the application. */
export function getSafariState(): {
  running: boolean;
  frontmost: boolean;
  windowCount: number;
  currentUrl: string;
  pageTitle: string;
  cooling: boolean;
  cooldownRemainingSeconds: number;
} {
  const status = readEnforcerStatus();
  const cooldownRemainingSeconds = status ? coolingRemaining(status, 'safari') : 0;
  const running = status ? hasManagedRoot(status, 'Safari') : false;
  if (!status || !running || cooldownRemainingSeconds > 0) {
    return {
      running,
      frontmost: false,
      windowCount: 0,
      currentUrl: '',
      pageTitle: '',
      cooling: cooldownRemainingSeconds > 0,
      cooldownRemainingSeconds,
    };
  }

  try {
    const result = execFileSync('/usr/bin/osascript', ['-e', `
tell application "System Events"
    set isFront to frontmost of process "Safari"
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
return (isFront as text) & "|" & (wc as text) & "|" & u & "|" & t`], {
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    }).trim();
    const parts = result.split('|');
    return {
      running: true,
      frontmost: parts[0] === 'true',
      windowCount: parseInt(parts[1], 10) || 0,
      currentUrl: parts[2] || '',
      pageTitle: parts[3] || '',
      cooling: false,
      cooldownRemainingSeconds: 0,
    };
  } catch {
    return {
      running: true,
      frontmost: false,
      windowCount: 0,
      currentUrl: '',
      pageTitle: '',
      cooling: false,
      cooldownRemainingSeconds: 0,
    };
  }
}

/** Get the currently frontmost process without opening any application. */
export function getFrontmostApp(): string | null {
  try {
    return execFileSync('/usr/bin/osascript', [
      '-e',
      'tell application "System Events" to get name of first application process whose frontmost is true',
    ], { timeout: 3000, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

/** Focus the sole managed Safari window. */
export function focusSafariWindow(windowIndex: number = 1): boolean {
  if (windowIndex !== 1 || !focusSafari()) {
    return false;
  }
  const state = getSafariState();
  if (!state.running || state.cooling || windowIndex > state.windowCount) return false;

  try {
    execFileSync('/usr/bin/osascript', ['-e', `
tell application "Safari"
    set index of window ${windowIndex} to 1
end tell`], { timeout: 5000, stdio: 'pipe' });
    logger.info(`[focus] Safari window ${windowIndex} focused`);
    return true;
  } catch (err: any) {
    logger.warn(`[focus] Failed to focus Safari window: ${err.message}`);
    return false;
  }
}

/** Compatibility alias; global focus manipulation is intentionally disabled. */
export function exclusiveFocus(appName: string): boolean {
  if (appName !== 'Safari') {
    logger.warn(`[focus] Exclusive focus denied for non-Safari app: ${appName}`);
    return false;
  }
  return focusSafari();
}
