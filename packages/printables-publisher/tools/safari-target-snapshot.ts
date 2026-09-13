#!/usr/bin/env npx tsx
/** Read one site in any available Safari target. */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

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
  const safePattern = appleScriptString(pattern);
  const safeOpenUrl = appleScriptString(openUrl);
  const targetText = await runAppleScript(`
tell application "Safari"
  repeat with candidateWindow in windows
    repeat with t from 1 to count of tabs of candidateWindow
      if URL of tab t of candidateWindow contains "${safePattern}" then
        return (id of candidateWindow as text) & "||" & (t as text)
      end if
    end repeat
  end repeat

  if (count of windows) is 0 then
    make new document with properties {URL:"${safeOpenUrl}"}
    set agentWindow to front window
    set targetTab to 1
  else
    set agentWindow to front window
    tell agentWindow to make new tab with properties {URL:"${safeOpenUrl}"}
    set targetTab to count of tabs of agentWindow
  end if
  return (id of agentWindow as text) & "||" & (targetTab as text)
end tell`);
  const [windowIdText, tabIndexText] = targetText.split('||');
  const windowId = Number.parseInt(windowIdText, 10);
  const tabIndex = Number.parseInt(tabIndexText, 10);
  if (!Number.isInteger(windowId) || !Number.isInteger(tabIndex)) {
    throw new Error(`Safari returned an invalid target: ${targetText}`);
  }
  {
    const currentUrl = await runAppleScript(`
tell application "Safari"
  set agentWindow to first window whose id is ${windowId}
  return URL of tab ${tabIndex} of agentWindow
end tell`);
    if (currentUrl !== openUrl) {
      await runAppleScript(`
tell application "Safari"
  set agentWindow to first window whose id is ${windowId}
  set URL of tab ${tabIndex} of agentWindow to "${appleScriptString(openUrl)}"
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
  set agentTab to tab ${tabIndex} of agentWindow
  return do JavaScript "${appleScriptString(js)}" in agentTab
end tell`);
    console.log(output);
  }
}

main().catch(error => {
  console.error(String(error));
  process.exitCode = 1;
});
