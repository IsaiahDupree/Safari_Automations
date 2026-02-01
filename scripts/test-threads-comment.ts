#!/usr/bin/env npx tsx
/**
 * Real test: Post a comment on Threads via Safari
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function executeJS(script: string): Promise<string> {
  // Write AppleScript to temp file to avoid shell escaping issues
  const fs = await import('fs');
  const os = await import('os');
  const path = await import('path');
  
  const tmpFile = path.join(os.tmpdir(), `safari_js_${Date.now()}.scpt`);
  const jsCode = script.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
  const appleScript = `tell application "Safari" to do JavaScript "${jsCode}" in current tab of front window`;
  
  fs.writeFileSync(tmpFile, appleScript);
  try {
    const { stdout } = await execAsync(`osascript "${tmpFile}"`);
    return stdout.trim();
  } finally {
    fs.unlinkSync(tmpFile);
  }
}

async function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testThreadsComment(): Promise<void> {
  console.log('\n🧪 THREADS COMMENT TEST\n');

  // Step 1: Check current page
  const { stdout: url } = await execAsync(
    `osascript -e 'tell application "Safari" to get URL of current tab of front window'`
  );
  console.log(`📍 Current URL: ${url.trim()}`);

  const isOnThreads = url.includes('threads.com') || url.includes('threads.net');
  if (!isOnThreads) {
    console.log('❌ Not on Threads. Please navigate to a Threads post first.');
    return;
  }

  // Step 2: Check login status
  const loginStatus = await executeJS(`
    (function() {
      var createBtn = document.querySelector('svg[aria-label="Create"]');
      if (createBtn) return 'logged_in';
      var profileBtn = document.querySelector('svg[aria-label="Profile"]');
      if (profileBtn) return 'logged_in';
      return 'not_logged_in';
    })();
  `);
  console.log(`🔐 Login status: ${loginStatus}`);

  if (loginStatus !== 'logged_in') {
    console.log('❌ Not logged in to Threads.');
    return;
  }

  // Step 3: Check if we're on a post page (has reply button)
  const hasReplyBtn = await executeJS(`
    (function() {
      var replyBtns = document.querySelectorAll('svg[aria-label="Reply"]');
      return replyBtns.length > 0 ? 'yes' : 'no';
    })();
  `);
  console.log(`💬 Reply button found: ${hasReplyBtn}`);

  if (hasReplyBtn !== 'yes') {
    console.log('⚠️  No reply button found. Navigate to a specific post to test commenting.');
    console.log('   Try: https://www.threads.com/@zuck (then click on a post)');
    return;
  }

  // Step 4: Click the reply button
  console.log('\n📝 Clicking reply button...');
  const clickResult = await executeJS(`
    (function() {
      var replyBtns = document.querySelectorAll('svg[aria-label="Reply"]');
      if (replyBtns.length > 0) {
        var btn = replyBtns[0].closest('[role="button"]') || replyBtns[0].parentElement;
        if (btn) {
          btn.click();
          return 'clicked';
        }
      }
      return 'not_found';
    })();
  `);
  console.log(`   Result: ${clickResult}`);

  if (clickResult !== 'clicked') {
    console.log('❌ Could not click reply button');
    return;
  }

  await wait(1500);

  // Step 5: Type in the comment box
  const testComment = `Test comment from Safari Automation 🦁 ${new Date().toISOString().slice(11, 19)}`;
  console.log(`\n✏️  Typing: "${testComment}"`);

  const escaped = testComment.replace(/'/g, "\\'");
  const typeResult = await executeJS(`
    (function() {
      var input = document.querySelector('[role="textbox"][contenteditable="true"]');
      if (!input) {
        input = document.querySelector('[contenteditable="true"]');
      }
      if (input) {
        input.focus();
        input.innerText = '${escaped}';
        input.dispatchEvent(new InputEvent('input', { bubbles: true }));
        return 'typed';
      }
      return 'input_not_found';
    })();
  `);
  console.log(`   Result: ${typeResult}`);

  if (typeResult !== 'typed') {
    console.log('❌ Could not type in comment box');
    return;
  }

  await wait(1000);

  // Step 6: Submit the comment
  console.log('\n🚀 Submitting comment...');
  const submitResult = await executeJS(`
    (function() {
      var replyBtns = document.querySelectorAll('svg[aria-label="Reply"]');
      if (replyBtns.length >= 2) {
        var btn = replyBtns[1].closest('[role="button"]') || replyBtns[1].parentElement;
        if (btn && !btn.getAttribute('aria-disabled')) {
          btn.click();
          return 'clicked_reply';
        }
      }
      
      var buttons = document.querySelectorAll('[role="button"]');
      for (var i = 0; i < buttons.length; i++) {
        var text = (buttons[i].innerText || '').trim();
        if (text === 'Post' && !buttons[i].getAttribute('aria-disabled')) {
          buttons[i].click();
          return 'clicked_post';
        }
      }
      
      return 'submit_not_found';
    })();
  `);
  console.log(`   Result: ${submitResult}`);

  if (submitResult.startsWith('clicked')) {
    console.log('\n✅ COMMENT POSTED SUCCESSFULLY!');
  } else {
    console.log('\n❌ Could not find submit button');
  }
}

testThreadsComment().catch(console.error);
