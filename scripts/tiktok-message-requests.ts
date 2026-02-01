#!/usr/bin/env npx tsx
/**
 * TikTok Message Requests API Scripts
 * Repeatable commands for managing message requests
 * 
 * Usage:
 *   npx tsx scripts/tiktok-message-requests.ts list          # List all requests
 *   npx tsx scripts/tiktok-message-requests.ts open <name>   # Open a request
 *   npx tsx scripts/tiktok-message-requests.ts accept        # Accept current request
 *   npx tsx scripts/tiktok-message-requests.ts delete        # Delete current request
 *   npx tsx scripts/tiktok-message-requests.ts read          # Read current request message
 *   npx tsx scripts/tiktok-message-requests.ts extract-all   # Extract all request info
 */

export {};

const API = 'http://localhost:3102';

async function exec(script: string): Promise<string> {
  const res = await fetch(`${API}/api/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ script })
  });
  const data = await res.json() as { output?: string };
  return data.output || '';
}

async function post(endpoint: string, body?: any): Promise<any> {
  const res = await fetch(`${API}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  return res.json();
}

// Navigate to message requests section
async function navigateToRequests(): Promise<boolean> {
  await post('/api/tiktok/inbox/navigate');
  await new Promise(r => setTimeout(r, 1000));
  
  const result = await exec(`(function(){
    var requestGroup = document.querySelector('[class*="RequestGroup"]');
    if (requestGroup) {
      requestGroup.click();
      return 'clicked';
    }
    return 'not_found';
  })()`);
  
  if (result === 'clicked') {
    await new Promise(r => setTimeout(r, 1000));
    return true;
  }
  return false;
}

// List all message requests
async function listRequests(): Promise<any[]> {
  const result = await exec(`(function(){
    var text = document.body.innerText;
    var idx = text.indexOf('Message requests');
    if (idx === -1) return JSON.stringify([]);
    
    var requestsText = text.substring(idx + 17, idx + 3000);
    var lines = requestsText.split('\\n').filter(l => l.trim());
    
    var requests = [];
    var current = null;
    
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      
      // Date pattern
      if (line.match(/^\\d{1,2}\\/\\d{1,2}\\/\\d{4}$/) || line.match(/^\\d{1,2}:\\d{2}$/)) {
        if (current) {
          current.timestamp = line;
          requests.push(current);
          current = null;
        }
        continue;
      }
      
      // Skip navigation items
      if (['Delete', 'Accept', 'Report this user'].includes(line)) continue;
      if (line.startsWith('@')) continue;
      if (line.includes('wants to send you a message')) continue;
      if (line.includes('If you accept')) continue;
      
      // New request starts
      if (!current && line.length > 0 && !line.includes('USDT') && line.length < 50) {
        current = { displayName: line, message: '', timestamp: '' };
      } else if (current && !current.message) {
        current.message = line.substring(0, 100);
      }
    }
    
    return JSON.stringify(requests.slice(0, 20));
  })()`);
  
  return JSON.parse(result || '[]');
}

// Open a specific message request
async function openRequest(name: string): Promise<boolean> {
  const result = await exec(`(function(){
    var items = document.querySelectorAll('[data-e2e="chat-list-item"]');
    for (var i = 0; i < items.length; i++) {
      if (items[i].innerText.toLowerCase().includes('${name.toLowerCase()}')) {
        items[i].click();
        return JSON.stringify({success: true, index: i});
      }
    }
    return JSON.stringify({success: false});
  })()`);
  
  const data = JSON.parse(result || '{}');
  if (data.success) {
    await new Promise(r => setTimeout(r, 1500));
    return true;
  }
  return false;
}

// Get current request info
async function getCurrentRequestInfo(): Promise<any> {
  const result = await exec(`(function(){
    var header = document.querySelector('[data-e2e="chat-nickname"]');
    var username = document.querySelector('[data-e2e="chat-uniqueid"]');
    var strangerBox = document.querySelector('[class*="StrangerBox"]');
    var chatMain = document.querySelector('[class*="DivChatMain"]');
    var messages = document.querySelectorAll('[data-e2e="chat-item"]');
    
    return JSON.stringify({
      displayName: header ? header.innerText : null,
      username: username ? username.innerText : null,
      isRequest: strangerBox ? true : false,
      messageCount: messages.length,
      chatContent: chatMain ? chatMain.innerText.substring(0, 500) : null
    });
  })()`);
  
  return JSON.parse(result || '{}');
}

// Accept current message request
async function acceptRequest(): Promise<boolean> {
  const result = await exec(`(function(){
    var strangerBox = document.querySelector('[class*="StrangerBox"]');
    if (!strangerBox) return JSON.stringify({success: false, error: 'not a message request'});
    
    var buttons = strangerBox.querySelectorAll('div[role="button"]');
    var acceptBtn = buttons[1];
    
    if (acceptBtn && acceptBtn.innerText === 'Accept') {
      acceptBtn.click();
      return JSON.stringify({success: true, action: 'accepted'});
    }
    return JSON.stringify({success: false, error: 'accept button not found'});
  })()`);
  
  const data = JSON.parse(result || '{}');
  return data.success === true;
}

// Delete current message request
async function deleteRequest(): Promise<boolean> {
  const result = await exec(`(function(){
    var strangerBox = document.querySelector('[class*="StrangerBox"]');
    if (!strangerBox) return JSON.stringify({success: false, error: 'not a message request'});
    
    var buttons = strangerBox.querySelectorAll('div[role="button"]');
    var deleteBtn = buttons[0];
    
    if (deleteBtn && deleteBtn.innerText === 'Delete') {
      deleteBtn.click();
      return JSON.stringify({success: true, action: 'deleted'});
    }
    return JSON.stringify({success: false, error: 'delete button not found'});
  })()`);
  
  const data = JSON.parse(result || '{}');
  return data.success === true;
}

// Extract all messages from current request
async function extractMessages(): Promise<any[]> {
  const result = await exec(`(function(){
    var messages = [];
    var chatMain = document.querySelector('[class*="DivChatMain"]');
    if (!chatMain) return JSON.stringify([]);
    
    var items = document.querySelectorAll('[data-e2e="chat-item"]');
    items.forEach(function(item) {
      var link = item.querySelector('a[href*="@"]');
      var sender = link ? link.href.match(/@([^/]+)/)?.[1] : 'unknown';
      var textEl = item.querySelector('[class*="TextContainer"]');
      var content = textEl ? textEl.innerText : item.innerText.substring(0, 200);
      
      messages.push({
        sender: sender,
        content: content.trim()
      });
    });
    
    return JSON.stringify(messages);
  })()`);
  
  return JSON.parse(result || '[]');
}

// Extract all request info (for bulk processing)
async function extractAllRequestInfo(): Promise<any[]> {
  const result = await exec(`(function(){
    var text = document.body.innerText;
    var idx = text.indexOf('Message requests');
    if (idx === -1) return JSON.stringify({error: 'not on requests page'});
    return text.substring(idx, idx + 5000);
  })()`);
  
  console.log('Raw request data:');
  console.log(result);
  return [];
}

// Main CLI
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'list';
  const param = args[1] || '';
  
  console.log('\n📨 TikTok Message Requests\n');
  
  try {
    switch (command) {
      case 'nav':
      case 'navigate':
        console.log('Navigating to message requests...');
        const navResult = await navigateToRequests();
        console.log(navResult ? '✅ Navigated to requests' : '❌ Failed to navigate');
        break;
        
      case 'list':
        console.log('Navigating and listing requests...\n');
        await navigateToRequests();
        const requests = await listRequests();
        if (requests.length === 0) {
          console.log('No message requests found');
        } else {
          requests.forEach((r: any, i: number) => {
            console.log(`${i + 1}. ${r.displayName}`);
            console.log(`   "${r.message?.substring(0, 60)}..."`);
            console.log(`   ${r.timestamp}\n`);
          });
        }
        break;
        
      case 'open':
        if (!param) {
          console.log('Usage: npx tsx scripts/tiktok-message-requests.ts open <name>');
          break;
        }
        console.log(`Opening request: ${param}...`);
        await navigateToRequests();
        const opened = await openRequest(param);
        if (opened) {
          const info = await getCurrentRequestInfo();
          console.log(`✅ Opened: ${info.displayName} (${info.username})`);
          console.log(`   Messages: ${info.messageCount}`);
          console.log(`   Is request: ${info.isRequest}`);
        } else {
          console.log(`❌ Could not find request matching: ${param}`);
        }
        break;
        
      case 'read':
        console.log('Reading current request...\n');
        const info = await getCurrentRequestInfo();
        if (!info.displayName) {
          console.log('No request open');
          break;
        }
        console.log(`From: ${info.displayName} (${info.username})`);
        console.log(`Is request: ${info.isRequest}\n`);
        console.log('Content:');
        console.log(info.chatContent);
        break;
        
      case 'accept':
        console.log('Accepting current request...');
        const accepted = await acceptRequest();
        console.log(accepted ? '✅ Request accepted!' : '❌ Failed to accept');
        break;
        
      case 'delete':
        console.log('Deleting current request...');
        const deleted = await deleteRequest();
        console.log(deleted ? '✅ Request deleted!' : '❌ Failed to delete');
        break;
        
      case 'messages':
        console.log('Extracting messages...\n');
        const messages = await extractMessages();
        messages.forEach((m: any, i: number) => {
          console.log(`${i + 1}. [${m.sender}] ${m.content.substring(0, 80)}`);
        });
        break;
        
      case 'extract-all':
        console.log('Extracting all request data...\n');
        await navigateToRequests();
        await extractAllRequestInfo();
        break;
        
      default:
        console.log(`
Usage: npx tsx scripts/tiktok-message-requests.ts <command> [param]

Commands:
  list              List all message requests
  open <name>       Open a specific request by name
  read              Read current request content
  accept            Accept current request
  delete            Delete current request
  messages          Extract messages from current request
  extract-all       Extract all request data
  navigate          Navigate to requests section
        `);
    }
    
    console.log('\n✅ Done!\n');
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

main();
