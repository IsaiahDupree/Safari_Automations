#!/usr/bin/env npx tsx
/** Read one site in an independent Safari target. */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { TabCoordinator } from '../../medium-automation/src/automation/tab-coordinator.js';

const execFileAsync = promisify(execFile);

function value(name: string): string {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`missing ${name}`);
  return process.argv[index + 1];
}

function appleScriptString(input: string): string {
  return input.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n');
}

async function runAppleScript(script: string): Promise<string> {
  const { stdout } = await execFileAsync('/usr/bin/osascript', ['-e', script], {
    timeout: 30_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  return stdout.trim();
}

async function main(): Promise<void> {
  const pattern = value('--pattern');
  const openUrl = value('--url');
  process.env.SAFARI_CONTROLLER_URL = 'http://127.0.0.1:1';
  const coordinator = new TabCoordinator(
    `claimed-snapshot-${process.pid}`,
    'claimed-snapshot',
    3113,
    pattern,
  );
  const safePattern = appleScriptString(pattern);
  const safeOpenUrl = appleScriptString(openUrl);
  const tabIndex = Number.parseInt(await runAppleScript(`
tell application "Safari"
  if (count of windows) < 2 then error "Safari Window 2 is unavailable"
  repeat with t from 1 to count of tabs of window 2
    if URL of tab t of window 2 contains "${safePattern}" then return t
  end repeat
  tell window 2 to make new tab with properties {URL:"${safeOpenUrl}"}
  return count of tabs of window 2
end tell`), 10);
  const claim = await coordinator.claim(2, tabIndex);
  try {
    const windowId = Number.parseInt(
      await runAppleScript(`tell application "Safari" to return id of window ${claim.windowIndex}`),
      10,
    );
    const currentUrl = await runAppleScript(`
tell application "Safari"
  set agentWindow to first window whose id is ${windowId}
  return URL of tab ${claim.tabIndex} of agentWindow
end tell`);
    if (currentUrl !== openUrl) {
      await runAppleScript(`
tell application "Safari"
  set agentWindow to first window whose id is ${windowId}
  set URL of tab ${claim.tabIndex} of agentWindow to "${appleScriptString(openUrl)}"
end tell`);
    }
    await new Promise(resolve => setTimeout(resolve, 7_000));
    const js = `JSON.stringify({
      url: location.href,
      title: document.title,
      readyState: document.readyState,
      bodyText: (document.body?.innerText || '').slice(0, 30000),
      controls: [...document.querySelectorAll('input,textarea,select,button,[role="button"],[contenteditable="true"]')].slice(0, 500).map((el, index) => ({
        index,
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute('type'),
        name: el.getAttribute('name'),
        id: el.id || null,
        role: el.getAttribute('role'),
        ariaLabel: el.getAttribute('aria-label'),
        title: el.getAttribute('title'),
        text: (el.innerText || '').trim().slice(0, 160)
      })),
      links: [...document.querySelectorAll('a[href]')].slice(0, 500).map((el, index) => ({
        index,
        href: el.href,
        ariaLabel: el.getAttribute('aria-label'),
        title: el.getAttribute('title'),
        text: (el.innerText || '').trim().slice(0, 160)
      }))
    })`;
    const output = await runAppleScript(`
tell application "Safari"
  set agentWindow to first window whose id is ${windowId}
  set agentTab to tab ${claim.tabIndex} of agentWindow
  return do JavaScript "${appleScriptString(js)}" in agentTab
end tell`);
    console.log(output);
  } finally {
    await coordinator.release();
  }
}

main().catch(error => {
  console.error(String(error));
  process.exitCode = 1;
});
