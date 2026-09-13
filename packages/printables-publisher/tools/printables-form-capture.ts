#!/usr/bin/env npx tsx
/** Capture Printables create-model controls in any available Safari target. */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

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

async function targetedJavaScript(windowId: number, tabIndex: number, script: string): Promise<string> {
  return runAppleScript(`
tell application "Safari"
  set agentWindow to first window whose id is ${windowId}
  set agentTab to tab ${tabIndex} of agentWindow
  return do JavaScript "${appleScriptString(script)}" in agentTab
end tell`);
}

async function snapshot(windowId: number, tabIndex: number): Promise<Record<string, unknown>> {
  const output = await targetedJavaScript(windowId, tabIndex, `
JSON.stringify({
  url: location.href,
  title: document.title,
  bodyText: (document.body?.innerText || '').slice(0, 16000),
  controls: [...document.querySelectorAll('input,textarea,select,button,[role="button"],[contenteditable="true"]')].map((el, index) => ({
    index,
    tag: el.tagName.toLowerCase(),
    type: el.getAttribute('type'),
    name: el.getAttribute('name'),
    value: el.getAttribute('value'),
    id: el.id || null,
    role: el.getAttribute('role'),
    ariaLabel: el.getAttribute('aria-label'),
    placeholder: el.getAttribute('placeholder'),
    text: (el.textContent || '').trim().slice(0, 240),
    visible: Boolean(el.getClientRects().length),
    outerHTML: el.outerHTML.slice(0, 1600)
  })),
  links: [...document.querySelectorAll('a[href]')].map((el, index) => ({
    index,
    href: el.href,
    ariaLabel: el.getAttribute('aria-label'),
    text: (el.textContent || '').trim().slice(0, 240),
    visible: Boolean(el.getClientRects().length)
  }))
})`);
  return JSON.parse(output) as Record<string, unknown>;
}

async function main(): Promise<void> {
  const menuIndex = process.argv.indexOf('--open-menu');
  const openMenu = menuIndex >= 0 ? process.argv[menuIndex + 1] : '';
  if (openMenu && !['license', 'category'].includes(openMenu)) {
    throw new Error('--open-menu must be license or category');
  }
  const targetText = await runAppleScript(`
tell application "Safari"
  repeat with candidateWindow in windows
    repeat with t from 1 to count of tabs of candidateWindow
      if URL of tab t of candidateWindow contains "printables.com/model/create" then
        return (id of candidateWindow as text) & "||" & (t as text)
      end if
    end repeat
  end repeat

  if (count of windows) is 0 then
    make new document with properties {URL:"https://www.printables.com/model/create"}
    set agentWindow to front window
    set targetTab to 1
  else
    set agentWindow to front window
    tell agentWindow to make new tab with properties {URL:"https://www.printables.com/model/create"}
    set targetTab to count of tabs of agentWindow
  end if
  return (id of agentWindow as text) & "||" & (targetTab as text)
end tell`);
  const [windowIdText, tabIndexText] = targetText.split('||');
  const windowId = Number.parseInt(windowIdText, 10);
  const tabIndex = Number.parseInt(tabIndexText, 10);
  if (!Number.isInteger(windowId) || !Number.isInteger(tabIndex)) {
    throw new Error(`Safari returned an invalid Printables target: ${targetText}`);
  }
  {
    await new Promise(resolve => setTimeout(resolve, 3_000));
    let current = await snapshot(windowId, tabIndex);
    if (openMenu) {
      if (!String(current.url).includes('/model/create')) {
        await runAppleScript(`
tell application "Safari"
  set agentWindow to first window whose id is ${windowId}
  set URL of tab ${tabIndex} of agentWindow to "https://www.printables.com/model/create"
end tell`);
        await new Promise(resolve => setTimeout(resolve, 5_000));
        current = await snapshot(windowId, tabIndex);
      }
      const prefix = openMenu === 'license' ? 'f-license-' : 'f-category-';
      const menuResult = await targetedJavaScript(windowId, tabIndex, `
(() => {
  const button = document.querySelector('button[id^="${prefix}"]');
  if (!button || !button.getClientRects().length) return JSON.stringify({ ok: false });
  button.click();
  return JSON.stringify({ ok: true });
})()`);
      if (!(JSON.parse(menuResult) as { ok: boolean }).ok) throw new Error(`${openMenu} control not found`);
      await new Promise(resolve => setTimeout(resolve, 1_200));
      console.log(JSON.stringify({ stage: `${openMenu}-menu`, ...(await snapshot(windowId, tabIndex)) }));
      return;
    }
    if (String(current.url).includes('/create') || String(current.url).includes('/upload')) {
      console.log(JSON.stringify({ stage: 'create-form', ...current }));
      return;
    }
    const clickOutput = await targetedJavaScript(windowId, tabIndex, `
(() => {
  const candidates = [...document.querySelectorAll('button,[role="button"],a[href]')].filter(el =>
    (el.textContent || '').trim() === 'Create' && el.getClientRects().length > 0
  );
  if (candidates.length !== 1) return JSON.stringify({ ok: false, count: candidates.length });
  candidates[0].click();
  return JSON.stringify({ ok: true, tag: candidates[0].tagName.toLowerCase() });
})()`);
    const clickResult = JSON.parse(clickOutput) as { ok: boolean; count?: number };
    if (!clickResult.ok) throw new Error(`expected one visible Create control; found ${clickResult.count}`);
    await new Promise(resolve => setTimeout(resolve, 1_500));
    console.log(JSON.stringify({ stage: 'create-menu', ...(await snapshot(windowId, tabIndex)) }));
  }
}

main().catch(error => {
  console.error(String(error));
  process.exitCode = 1;
});
