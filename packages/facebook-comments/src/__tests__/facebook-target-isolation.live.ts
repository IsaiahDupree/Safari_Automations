/** Real Safari regression: window reordering must not redirect another task. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { FacebookResearcher } from '../automation/facebook-researcher.js';

const run = promisify(execFile);
const apple = async (text: string) => (await run('osascript', ['-e', text], { timeout: 15000 })).stdout.trim();
type TargetAccess = { navigate(url: string): Promise<boolean>; executeJS(script: string): Promise<string>; targetWindowId: number | null };

const server = createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/html' });
  response.end('<title>Owned research-isolation witness</title><p>This local document must keep its address when research runs.</p>');
});
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert(address && typeof address !== 'string');
const witnessUrl = `http://127.0.0.1:${address.port}/research-isolation`;
let witnessId: number | null = null;
let targetId: number | null = null;
const checks: string[] = [];
try {
  // Keep both test windows behind the pre-existing front window. This also
  // permits unrelated foreground automation to continue during the regression.
  witnessId = Number(await apple(`tell application "Safari"
    set previousWindow to id of front window
    make new document with properties {URL:"${witnessUrl}"}
    set witnessWindow to id of front window
    set index of window id previousWindow to 1
    return witnessWindow
  end tell`));
  assert(Number.isSafeInteger(witnessId) && witnessId > 0);
  const researcher = new FacebookResearcher({ timeout: 15000 }) as unknown as TargetAccess;
  assert.equal(await researcher.navigate('https://www.facebook.com/'), true);
  targetId = researcher.targetWindowId;
  assert(targetId && targetId !== witnessId);
  // Exchange the background windows' z-order, the original drift trigger.
  await apple(`tell application "Safari" to set index of window id ${witnessId} to 2`);
  const url = 'https://www.facebook.com/search/posts/?q=software%20automation';
  assert.equal(await researcher.navigate(url), true);
  assert.equal(await apple(`tell application "Safari" to get URL of tab 1 of window id ${targetId}`), url);
  assert.equal(await apple(`tell application "Safari" to get URL of tab 1 of window id ${witnessId}`), witnessUrl);
  checks.push('navigation preserves the independent local HTTP document after z-order changes');
  // Wait only for real page loading; do not synthesize a provider response.
  const deadline = Date.now() + 15000;
  let observed = '';
  while (Date.now() < deadline) {
    observed = await researcher.executeJS('location.href');
    if (observed.startsWith('https://www.facebook.com/')) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert(observed.startsWith('https://www.facebook.com/'));
  checks.push('JavaScript reads the same bound research window');
  assert.equal(await researcher.navigate(witnessUrl), false);
  checks.push('non-Facebook navigation is rejected before changing any window');
  await apple(`tell application "Safari" to close window id ${targetId}`);
  targetId = null;
  assert.equal(await researcher.navigate(url), false);
  await assert.rejects(researcher.executeJS('document.title'));
  assert.equal(await apple(`tell application "Safari" to get URL of tab 1 of window id ${witnessId}`), witnessUrl);
  checks.push('a closed research target fails without adopting or redirecting another window');
  console.log(JSON.stringify({ status: 'passed', transport: 'real Safari and real loopback HTTP', checks }, null, 2));
} finally {
  // Close only the exact windows this test created, after verifying their URL.
  if (targetId) await apple(`tell application "Safari"
    if exists window id ${targetId} then
      set u to URL of tab 1 of window id ${targetId}
      if u starts with "https://www.facebook.com/" then close window id ${targetId}
    end if
  end tell`);
  if (witnessId) await apple(`tell application "Safari"
    if exists window id ${witnessId} then
      if (URL of tab 1 of window id ${witnessId}) is "${witnessUrl}" then close window id ${witnessId}
    end if
  end tell`);
  await new Promise<void>(resolve => server.close(() => resolve()));
}
