#!/usr/bin/env npx tsx
/**
 * Instagram DM CLI - Reproducible Commands
 * 
 * Tested and working commands for Instagram DM automation via Safari.
 * 
 * Usage:
 *   npx tsx scripts/instagram-dm-cli.ts <command> [args]
 * 
 * Commands:
 *   check-login          - Check if logged into Instagram
 *   go-inbox             - Navigate to DM inbox
 *   get-tabs             - List available tabs (Primary, General, Requests)
 *   click-tab <name>     - Click on a tab
 *   list-convos          - List conversations with usernames
 *   click-user <name>    - Open a user's conversation
 *   get-messages         - Get messages in current conversation
 *   focus-input          - Focus message input
 *   type-msg <text>      - Type a message
 *   send                 - Send the typed message
 *   dm <user> <msg>      - Full workflow: find user, type, send
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// === CORE SAFARI EXECUTOR ===

async function safari(js: string): Promise<string> {
  // Escape for AppleScript
  const escaped = js
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  
  const script = `tell application "Safari" to do JavaScript "${escaped}" in front document`;
  
  try {
    const { stdout } = await execAsync(`osascript -e '${script.replace(/'/g, "'\"'\"'")}'`);
    return stdout.trim();
  } catch (error: any) {
    // Try alternate method with temp file for complex JS
    const fs = await import('fs/promises');
    const os = await import('os');
    const path = await import('path');
    
    const cleanJS = js.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
    const tempFile = path.join(os.tmpdir(), `safari-${Date.now()}.js`);
    await fs.writeFile(tempFile, cleanJS);
    
    const altScript = `
      set jsCode to read POSIX file "${tempFile}" as «class utf8»
      tell application "Safari" to do JavaScript jsCode in front document
    `;
    
    try {
      const { stdout } = await execAsync(`osascript -e '${altScript.replace(/'/g, "'\"'\"'")}'`);
      await fs.unlink(tempFile).catch(() => {});
      return stdout.trim();
    } catch (e) {
      await fs.unlink(tempFile).catch(() => {});
      return '';
    }
  }
}

async function wait(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

// === COMMANDS ===

const commands = {
  'check-login': async () => {
    const result = await safari(`
      (function() {
        if (document.querySelector('svg[aria-label="Home"]')) return 'logged_in';
        if (document.querySelector('img[alt*="profile picture"]')) return 'logged_in';
        if (document.querySelector('a[href*="/direct/"]')) return 'logged_in';
        if (document.querySelector('input[name="username"]')) return 'login_page';
        return 'unknown';
      })()
    `);
    console.log('Login status:', result);
    return result;
  },

  'go-inbox': async () => {
    await execAsync(`osascript -e 'tell application "Safari" to set URL of front document to "https://www.instagram.com/direct/inbox/"'`);
    console.log('Navigating to inbox...');
    await wait(3000);
    console.log('Done');
  },

  'get-tabs': async () => {
    const result = await safari(`
      (function() {
        var tabs = [];
        document.querySelectorAll('[role="tab"]').forEach(function(tab) {
          var text = tab.innerText.trim();
          var selected = tab.getAttribute('aria-selected') === 'true';
          if (text) tabs.push((selected ? '→ ' : '  ') + text);
        });
        return tabs.join('\\n');
      })()
    `);
    console.log('DM Tabs:');
    console.log(result);
  },

  'click-tab': async (tabName: string) => {
    if (!tabName) {
      console.log('Usage: click-tab <Primary|General|Requests>');
      return;
    }
    const result = await safari(`
      (function() {
        var tabs = document.querySelectorAll('[role="tab"]');
        for (var i = 0; i < tabs.length; i++) {
          if (tabs[i].innerText.includes('${tabName}')) {
            tabs[i].click();
            return 'clicked';
          }
        }
        return 'not found';
      })()
    `);
    console.log(`Click ${tabName}:`, result);
    await wait(1500);
  },

  'list-convos': async () => {
    const result = await safari(`
      (function() {
        var convos = [];
        var imgs = document.querySelectorAll('img[alt*="profile picture"]');
        
        imgs.forEach(function(img) {
          var alt = img.getAttribute('alt') || '';
          var username = alt.replace("'s profile picture", '').trim();
          if (username && username.length > 1) {
            convos.push(username);
          }
        });
        
        return convos.slice(0, 20).join('\\n');
      })()
    `);
    console.log('Conversations (from profile pics):');
    console.log(result || '(none found)');
    
    // Also show raw page text for reference
    const pageText = await safari(`document.body.innerText.substring(0, 1500)`);
    console.log('\nPage preview:');
    console.log(pageText.split('\\n').slice(0, 30).join('\\n'));
  },

  'click-user': async (username: string) => {
    if (!username) {
      console.log('Usage: click-user <username>');
      return;
    }
    const result = await safari(`
      (function() {
        var spans = document.querySelectorAll('span');
        for (var i = 0; i < spans.length; i++) {
          if (spans[i].textContent === '${username}') {
            var parent = spans[i].parentElement.parentElement.parentElement;
            parent.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
            return 'clicked';
          }
        }
        return 'not found';
      })()
    `);
    console.log(`Click ${username}:`, result);
    await wait(2000);
  },

  'get-messages': async () => {
    const result = await safari(`
      (function() {
        var messages = [];
        var container = document.querySelector('[role="main"]') || document.body;
        
        container.querySelectorAll('div[dir="auto"], span[dir="auto"]').forEach(function(el) {
          var text = (el.innerText || '').trim();
          if (text && text.length > 0 && text.length < 500) {
            messages.push(text);
          }
        });
        
        // Dedupe
        return [...new Set(messages)].slice(-15).join('\\n---\\n');
      })()
    `);
    console.log('Messages:');
    console.log(result || '(none)');
  },

  'focus-input': async () => {
    const result = await safari(`
      (function() {
        var input = document.querySelector('textarea[placeholder*="Message"]') ||
                   document.querySelector('div[contenteditable="true"]') ||
                   document.querySelector('[aria-label*="Message"]');
        if (input) {
          input.focus();
          input.click();
          return 'focused: ' + input.tagName;
        }
        return 'not found';
      })()
    `);
    console.log('Focus:', result);
  },

  'type-msg': async (message: string) => {
    if (!message) {
      console.log('Usage: type-msg <message>');
      return;
    }
    
    // First focus
    await commands['focus-input']();
    await wait(300);
    
    const result = await safari(`
      (function() {
        var input = document.activeElement;
        var msg = '${message.replace(/'/g, "\\'")}';
        
        if (input.contentEditable === 'true') {
          input.textContent = msg;
          input.innerHTML = msg;
          input.dispatchEvent(new InputEvent('input', { bubbles: true, data: msg }));
          return 'typed';
        } else if (input.tagName === 'TEXTAREA') {
          input.value = msg;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          return 'typed';
        }
        return 'failed: ' + input.tagName;
      })()
    `);
    console.log('Type:', result);
  },

  'send': async () => {
    const result = await safari(`
      (function() {
        var input = document.activeElement;
        
        input.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
          bubbles: true, cancelable: true
        }));
        
        setTimeout(function() {
          var btns = document.querySelectorAll('button, div[role="button"]');
          for (var i = 0; i < btns.length; i++) {
            var text = (btns[i].textContent || '').toLowerCase();
            if (text === 'send') { btns[i].click(); break; }
          }
        }, 100);
        
        return 'sent';
      })()
    `);
    console.log('Send:', result);
  },

  'dm': async (username: string, message: string) => {
    if (!username || !message) {
      console.log('Usage: dm <username> <message>');
      return;
    }
    
    console.log(`\n📨 Sending DM to ${username}...`);
    
    // Click on user
    await commands['click-user'](username);
    await wait(1500);
    
    // Type message
    await commands['type-msg'](message);
    await wait(500);
    
    // Send
    await commands['send']();
    
    console.log('✅ Done');
  },

  'read-all-tabs': async () => {
    console.log('\n📬 Reading all Instagram DM tabs...\n');
    
    // Navigate to inbox first
    await execAsync(`osascript -e 'tell application "Safari" to set URL of front document to "https://www.instagram.com/direct/inbox/"'`);
    await wait(3000);
    
    const tabs = ['Primary', 'General', 'Requests'];
    const results: Record<string, string> = {};
    
    for (const tab of tabs) {
      console.log(`\n=== ${tab.toUpperCase()} ===`);
      
      // Click tab
      await safari(`
        (function() {
          var tabs = document.querySelectorAll('[role="tab"]');
          for (var i = 0; i < tabs.length; i++) {
            if (tabs[i].innerText.includes('${tab}')) {
              tabs[i].click();
              return 'clicked';
            }
          }
          return 'not found';
        })()
      `);
      await wait(2000);
      
      // Get content
      const content = await safari(`document.body.innerText.substring(0, 2000)`);
      results[tab] = content;
      console.log(content.split('\n').slice(10, 35).join('\n'));
    }
    
    // Try Hidden Requests
    console.log('\n=== HIDDEN REQUESTS ===');
    await safari(`
      (function() {
        var els = document.querySelectorAll('a, div[role="button"], span');
        for (var i = 0; i < els.length; i++) {
          if ((els[i].innerText || '').includes('Hidden Requests')) {
            els[i].click();
            return 'clicked';
          }
        }
        return 'not found';
      })()
    `);
    await wait(2000);
    
    const hiddenContent = await safari(`document.body.innerText.substring(0, 1500)`);
    results['Hidden Requests'] = hiddenContent;
    console.log(hiddenContent.split('\n').slice(5, 20).join('\n'));
    
    console.log('\n✅ Done reading all tabs');
  },

  'help': async () => {
    console.log(`
Instagram DM CLI - Reproducible Commands

Usage: npx tsx scripts/instagram-dm-cli.ts <command> [args]

Commands:
  check-login          Check if logged into Instagram
  go-inbox             Navigate to DM inbox
  get-tabs             List tabs (Primary, General, Requests)
  click-tab <name>     Click on a tab
  list-convos          List conversations
  click-user <name>    Open user's conversation
  get-messages         Get messages in current conversation
  focus-input          Focus message input
  type-msg <text>      Type a message
  send                 Send the typed message
  dm <user> <msg>      Full workflow: open, type, send
  read-all-tabs        Read all tabs (Primary, General, Requests, Hidden)

Examples:
  npx tsx scripts/instagram-dm-cli.ts go-inbox
  npx tsx scripts/instagram-dm-cli.ts click-tab Requests
  npx tsx scripts/instagram-dm-cli.ts click-user "Sarah Ashley"
  npx tsx scripts/instagram-dm-cli.ts dm "Sarah Ashley" "Hey!"
`);
  }
};

// === MAIN ===

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  
  if (!cmd || !commands[cmd as keyof typeof commands]) {
    await commands.help();
    return;
  }
  
  await commands[cmd as keyof typeof commands](args[0], args[1]);
}

main().catch(console.error);
