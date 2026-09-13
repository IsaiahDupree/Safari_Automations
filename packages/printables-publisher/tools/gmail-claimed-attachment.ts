#!/usr/bin/env npx tsx
/** Inspect or download one attachment from an exact Gmail subject in an independent Safari target. */

import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { TabCoordinator } from '../../medium-automation/src/automation/tab-coordinator.js';

const execFileAsync = promisify(execFile);

function value(name: string, fallback?: string): string {
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  if (fallback !== undefined) return fallback;
  throw new Error(`missing ${name}`);
}

function appleScriptString(input: string): string {
  return input.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n');
}

function jsString(input: string): string {
  return JSON.stringify(input);
}

async function runAppleScript(script: string): Promise<string> {
  const { stdout } = await execFileAsync('/usr/bin/osascript', ['-e', script], {
    timeout: 30_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  return stdout.trim();
}

async function claimedJavaScript(windowId: number, tabIndex: number, script: string): Promise<string> {
  return runAppleScript(`
tell application "Safari"
  set agentWindow to first window whose id is ${windowId}
  set agentTab to tab ${tabIndex} of agentWindow
  return do JavaScript "${appleScriptString(script)}" in agentTab
end tell`);
}

async function main(): Promise<void> {
  const subject = value('--subject');
  const action = value('--action', 'inspect');
  if (!['inspect', 'download', 'extract'].includes(action)) throw new Error('--action must be inspect, download, or extract');
  process.env.SAFARI_CONTROLLER_URL = 'http://127.0.0.1:1';
  const query = `subject:"${subject}" has:attachment`;
  const searchUrl = `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(query)}`;
  const coordinator = new TabCoordinator(
    `gmail-attachment-${process.pid}`,
    'gmail-attachment',
    3114,
    'mail.google.com',
  );
  const tabIndex = Number.parseInt(await runAppleScript(`
tell application "Safari"
  if (count of windows) < 2 then error "Safari Window 2 is unavailable"
  repeat with t from 1 to count of tabs of window 2
    if URL of tab t of window 2 contains "mail.google.com" then return t
  end repeat
  tell window 2 to make new tab with properties {URL:"${appleScriptString(searchUrl)}"}
  return count of tabs of window 2
end tell`), 10);
  const claim = await coordinator.claim(2, tabIndex);
  try {
    const windowId = Number.parseInt(
      await runAppleScript(`tell application "Safari" to return id of window ${claim.windowIndex}`),
      10,
    );
    await runAppleScript(`
tell application "Safari"
  set agentWindow to first window whose id is ${windowId}
  set URL of tab ${claim.tabIndex} of agentWindow to "${appleScriptString(searchUrl)}"
end tell`);
    await new Promise(resolve => setTimeout(resolve, 7_000));

    const openResult = await claimedJavaScript(windowId, claim.tabIndex, `
(() => {
  const subject = ${jsString(subject)};
  const subjectNodes = [...document.querySelectorAll('span,div')].filter(el =>
    (el.textContent || '').trim() === subject
  );
  const row = subjectNodes.map(el => el.closest('tr')).find(Boolean);
  if (!row) return JSON.stringify({ ok: false, stage: 'open', reason: 'exact subject row not found' });
  row.click();
  return JSON.stringify({ ok: true, stage: 'open', subject });
})()`);
    const opened = JSON.parse(openResult) as { ok: boolean; [key: string]: unknown };
    if (!opened.ok) throw new Error(JSON.stringify(opened));
    await new Promise(resolve => setTimeout(resolve, 6_000));

    const inspection = await claimedJavaScript(windowId, claim.tabIndex, `
(() => {
  const controls = [...document.querySelectorAll('a[href],button,[role="button"]')].map((el, index) => ({
    index,
    tag: el.tagName.toLowerCase(),
    href: el instanceof HTMLAnchorElement ? el.href : null,
    download: el instanceof HTMLAnchorElement ? el.getAttribute('download') : null,
    ariaLabel: el.getAttribute('aria-label'),
    title: el.getAttribute('title'),
    text: (el.textContent || '').trim().slice(0, 240),
    outerHTML: el.outerHTML.slice(0, 2000)
  })).filter(item =>
    /download|attachment|\.stl/i.test([item.href, item.download, item.ariaLabel, item.title, item.text].filter(Boolean).join(' '))
  );
  return JSON.stringify({
    ok: true,
    url: location.href,
    title: document.title,
    bodyText: (document.body?.innerText || '').slice(0, 20000),
    attachmentControls: controls
  });
})()`);
    const result = JSON.parse(inspection) as { attachmentControls?: Array<Record<string, unknown>> };

    if (action === 'download' || action === 'extract') {
      const previewLinks = (result.attachmentControls || [])
        .map(item => typeof item.href === 'string' ? item.href : '')
        .filter(href => href.includes('view=att'));
      if (previewLinks.length !== 1) {
        throw new Error(JSON.stringify({
          ok: false,
          stage: 'download',
          reason: 'expected exactly one attachment URL',
          count: previewLinks.length,
          inspection: result,
        }));
      }
      const downloadUrl = new URL(previewLinks[0]);
      downloadUrl.searchParams.set('disp', 'att');
      if (action === 'extract') {
        const outputPath = path.resolve(value('--output'));
        const extraction = await claimedJavaScript(windowId, claim.tabIndex, `
(() => {
  const xhr = new XMLHttpRequest();
  xhr.open('GET', ${jsString(downloadUrl.toString())}, false);
  xhr.overrideMimeType('text/plain; charset=x-user-defined');
  xhr.send(null);
  if (xhr.status < 200 || xhr.status >= 300) {
    return JSON.stringify({ ok: false, status: xhr.status, statusText: xhr.statusText });
  }
  const text = xhr.responseText;
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < text.length; offset += chunkSize) {
    const end = Math.min(text.length, offset + chunkSize);
    const codes = new Array(end - offset);
    for (let i = offset; i < end; i += 1) codes[i - offset] = text.charCodeAt(i) & 0xff;
    binary += String.fromCharCode(...codes);
  }
  return JSON.stringify({
    ok: true,
    status: xhr.status,
    contentType: xhr.getResponseHeader('content-type'),
    contentDisposition: xhr.getResponseHeader('content-disposition'),
    byteLength: text.length,
    base64: btoa(binary)
  });
})()`);
        const extracted = JSON.parse(extraction) as {
          ok: boolean;
          status?: number;
          contentType?: string | null;
          contentDisposition?: string | null;
          byteLength?: number;
          base64?: string;
        };
        if (!extracted.ok || !extracted.base64 || !extracted.byteLength) {
          throw new Error(JSON.stringify({ ...extracted, stage: 'extract' }));
        }
        const bytes = Buffer.from(extracted.base64, 'base64');
        if (bytes.length !== extracted.byteLength) {
          throw new Error(`attachment byte count mismatch: expected ${extracted.byteLength}, got ${bytes.length}`);
        }
        await mkdir(path.dirname(outputPath), { recursive: true });
        await writeFile(outputPath, bytes, { flag: 'wx' });
        console.log(JSON.stringify({
          ...result,
          extraction: {
            ok: true,
            stage: 'extract',
            outputPath,
            byteLength: bytes.length,
            contentType: extracted.contentType,
            contentDisposition: extracted.contentDisposition,
          },
        }));
        return;
      }
      await runAppleScript(`
tell application "Safari"
  set agentWindow to first window whose id is ${windowId}
  set URL of tab ${claim.tabIndex} of agentWindow to "${appleScriptString(downloadUrl.toString())}"
end tell`);
      console.log(JSON.stringify({ ...result, download: { ok: true, stage: 'download', method: 'attachment-url' } }));
    } else {
      console.log(JSON.stringify(result));
    }
  } finally {
    await coordinator.release();
  }
}

main().catch(error => {
  console.error(String(error));
  process.exitCode = 1;
});
