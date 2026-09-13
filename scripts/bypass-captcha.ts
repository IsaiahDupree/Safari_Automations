#!/usr/bin/env npx tsx
/**
 * Cloudflare Turnstile CAPTCHA Bypass for Safari
 * 
 * Usage:
 *   npx tsx scripts/bypass-captcha.ts
 *   npx tsx scripts/bypass-captcha.ts --retries 5
 *   npx tsx scripts/bypass-captcha.ts --wait 60
 * 
 * How it works:
 *   1. Checks if Safari's current page has a Cloudflare "Just a moment..." challenge
 *   2. Locates the Turnstile widget (div.main-wrapper) via JS injection
 *   3. Calculates screen coordinates using Safari window bounds + 92px toolbar offset
 *   4. Performs human-like mouse movement toward the checkbox
 *   5. Clicks using OS-level Quartz events (bypasses iframe cross-origin restrictions)
 *   6. Verifies the page title changed (challenge resolved)
 *   7. Retries with slightly different offsets if first attempt fails
 */

import { execSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';

const TOOLBAR_OFFSET = 92; // Safari URL bar + tab bar height
const MAX_RETRIES = parseInt(process.argv.find(a => a === '--retries')
  ? process.argv[process.argv.indexOf('--retries') + 1] : '4');
const MAX_WAIT = parseInt(process.argv.find(a => a === '--wait')
  ? process.argv[process.argv.indexOf('--wait') + 1] : '30');

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function runAS(script: string): string {
  try {
    return execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, { encoding: 'utf-8' }).trim();
  } catch { return ''; }
}

function safariJS(js: string): string {
  try {
    const escaped = js.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
    return execSync(
      `osascript -e 'tell application "Safari" to do JavaScript "${escaped}" in front document'`,
      { encoding: 'utf-8' }
    ).trim();
  } catch { return ''; }
}

function isCaptchaPage(): boolean {
  const title = safariJS('document.title');
  return title.toLowerCase().includes('just a moment') || title.toLowerCase().includes('attention');
}

function getWidgetPosition(): { x: number; y: number; w: number; h: number } | null {
  const json = safariJS(`
    (function() {
      var el = document.querySelector('iframe[src*="turnstile"]') ||
               document.querySelector('iframe[src*="challenge"]') ||
               document.querySelector('.cf-turnstile iframe') ||
               document.querySelector('iframe[title*="challenge"]');
      if (el) {
        var r = el.getBoundingClientRect();
        return JSON.stringify({ x: r.left + 17, y: r.top + r.height/2, w: r.width, h: r.height });
      }
      el = document.querySelector('div.main-wrapper');
      if (el) {
        var r = el.getBoundingClientRect();
        if (r.width > 200 && r.width < 400 && r.height > 40) {
          return JSON.stringify({ x: r.left + 17, y: r.top + r.height/2, w: r.width, h: r.height });
        }
      }
      return 'none';
    })()
  `);
  if (!json || json === 'none') return null;
  try { return JSON.parse(json); } catch { return null; }
}

function getSafariWindowOrigin(): { x: number; y: number } {
  const result = runAS(
    'tell application "Safari" to set b to bounds of front window \n' +
    'return ((item 1 of b) as text) & "," & ((item 2 of b) as text)'
  );
  const [x, y] = result.split(',').map(s => parseInt(s.trim()));
  return { x: x || 0, y: y || 0 };
}

function clickWithQuartz(screenX: number, screenY: number) {
  const pyScript = `
import Quartz, time
target = (${Math.round(screenX)}, ${Math.round(screenY)})
# Human-like mouse movement
for step in range(8):
    mx = target[0] - 200 + step * 28
    my = target[1] - 70 + step * 10
    ev = Quartz.CGEventCreateMouseEvent(None, Quartz.kCGEventMouseMoved, (mx, my), Quartz.kCGMouseButtonLeft)
    Quartz.CGEventPost(Quartz.kCGHIDEventTap, ev)
    time.sleep(0.04)
time.sleep(0.15)
down = Quartz.CGEventCreateMouseEvent(None, Quartz.kCGEventLeftMouseDown, target, Quartz.kCGMouseButtonLeft)
Quartz.CGEventPost(Quartz.kCGHIDEventTap, down)
time.sleep(0.07)
up = Quartz.CGEventCreateMouseEvent(None, Quartz.kCGEventLeftMouseUp, target, Quartz.kCGMouseButtonLeft)
Quartz.CGEventPost(Quartz.kCGHIDEventTap, up)
`;
  const tmpFile = `/tmp/captcha_click_${Date.now()}.py`;
  writeFileSync(tmpFile, pyScript);
  try {
    execSync(`python3 ${tmpFile}`, { encoding: 'utf-8' });
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}

async function bypassCaptcha(): Promise<boolean> {
  console.log('🔍 Checking Safari for Cloudflare CAPTCHA...');
  
  const url = safariJS('window.location.href');
  const title = safariJS('document.title');
  console.log(`   Page: ${title}`);
  console.log(`   URL:  ${url}`);

  if (!isCaptchaPage()) {
    console.log('✅ No CAPTCHA detected — page is clear.');
    return true;
  }

  console.log('🛡️  Cloudflare Turnstile CAPTCHA detected. Attempting bypass...\n');

  // Activate Safari
  runAS('tell application "Safari" to activate');
  await sleep(500);

  const win = getSafariWindowOrigin();
  console.log(`   Safari window origin: (${win.x}, ${win.y})`);

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    console.log(`\n🔄 Attempt ${attempt}/${MAX_RETRIES}...`);

    const widget = getWidgetPosition();
    if (!widget) {
      console.log('   ⚠️  Could not locate Turnstile widget. Waiting 2s...');
      await sleep(2000);
      continue;
    }

    console.log(`   Widget at viewport (${Math.round(widget.x)}, ${Math.round(widget.y)}) ${widget.w}x${widget.h}`);

    // Apply small random offset per attempt to find the checkbox
    const jitterX = (attempt - 1) * 3;
    const jitterY = (attempt - 1) * 4;
    const screenX = win.x + widget.x + jitterX;
    const screenY = win.y + TOOLBAR_OFFSET + widget.y + jitterY;

    console.log(`   Clicking screen (${Math.round(screenX)}, ${Math.round(screenY)}) [toolbar=${TOOLBAR_OFFSET}px]`);
    clickWithQuartz(screenX, screenY);

    // Wait for resolution
    console.log('   Waiting for page to resolve...');
    await sleep(3000);

    if (!isCaptchaPage()) {
      const newTitle = safariJS('document.title');
      console.log(`\n✅ CAPTCHA bypassed! Page: ${newTitle}`);
      return true;
    }
    console.log('   Still blocked, retrying...');
  }

  // Fall back to waiting for human
  console.log(`\n⏳ Auto-click failed. Waiting up to ${MAX_WAIT}s for manual resolution...`);
  const startTime = Date.now();
  while (Date.now() - startTime < MAX_WAIT * 1000) {
    await sleep(3000);
    if (!isCaptchaPage()) {
      console.log('✅ CAPTCHA resolved (manual).');
      return true;
    }
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    process.stdout.write(`\r   Waiting... ${elapsed}s/${MAX_WAIT}s`);
  }

  console.log('\n❌ CAPTCHA was not resolved within timeout.');
  return false;
}

// Run
bypassCaptcha().then(success => {
  process.exit(success ? 0 : 1);
});
