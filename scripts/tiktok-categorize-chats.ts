#!/usr/bin/env npx tsx
/**
 * TikTok Chat Categorization Tool
 * Scans and categorizes all chats as REGULAR_DM or MESSAGE_REQUEST
 * 
 * Usage: npx tsx scripts/tiktok-categorize-chats.ts [limit]
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

async function post(endpoint: string): Promise<any> {
  const res = await fetch(`${API}${endpoint}`, { method: 'POST' });
  return res.json();
}

async function wait(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// Get conversation list
async function getConversationList(): Promise<any[]> {
  const result = await exec(`(function(){
    var items = document.querySelectorAll('[data-e2e="chat-list-item"]');
    var convos = [];
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var nickname = item.querySelector('[class*="PInfoNickname"]');
      var extract = item.querySelector('[class*="SpanInfoExtract"]');
      convos.push({
        index: i,
        name: nickname ? nickname.innerText.trim() : 'Unknown',
        lastMsg: extract ? extract.innerText.trim().substring(0, 60) : ''
      });
    }
    return JSON.stringify(convos);
  })()`);
  return JSON.parse(result || '[]');
}

// Click on conversation by index
async function clickConversation(index: number): Promise<boolean> {
  const result = await exec(`(function(){
    var items = document.querySelectorAll('[data-e2e="chat-list-item"]');
    if (items[${index}]) {
      items[${index}].click();
      return 'clicked';
    }
    return 'not_found';
  })()`);
  return result === 'clicked';
}

// Detect chat type
async function detectChatType(): Promise<{type: string, name: string, username: string}> {
  const result = await exec(`(function(){
    var strangerBox = document.querySelector('[class*="StrangerBox"]');
    var input = document.querySelector('[data-e2e="message-input-area"]');
    var header = document.querySelector('[data-e2e="chat-nickname"]');
    var username = document.querySelector('[data-e2e="chat-uniqueid"]');
    
    var type = strangerBox ? 'MESSAGE_REQUEST' : input ? 'REGULAR_DM' : 'UNKNOWN';
    
    return JSON.stringify({
      type: type,
      name: header ? header.innerText : null,
      username: username ? username.innerText : null
    });
  })()`);
  return JSON.parse(result || '{}');
}

// Main categorization
async function categorizeChats(limit: number = 20): Promise<void> {
  console.log('\n📊 TikTok Chat Categorization\n');
  console.log('Navigating to inbox...');
  
  await post('/api/tiktok/inbox/navigate');
  await wait(1500);
  
  const convos = await getConversationList();
  console.log(`Found ${convos.length} conversations\n`);
  
  const regularDMs: any[] = [];
  const messageRequests: any[] = [];
  const unknown: any[] = [];
  
  const scanLimit = Math.min(limit, convos.length);
  console.log(`Scanning first ${scanLimit} conversations...\n`);
  
  for (let i = 0; i < scanLimit; i++) {
    const convo = convos[i];
    process.stdout.write(`  ${i + 1}/${scanLimit} ${convo.name.substring(0, 25).padEnd(25)} `);
    
    await clickConversation(i);
    await wait(800);
    
    const info = await detectChatType();
    
    const entry = {
      index: i,
      name: info.name || convo.name,
      username: info.username,
      lastMessage: convo.lastMsg
    };
    
    if (info.type === 'REGULAR_DM') {
      regularDMs.push(entry);
      console.log('✅ REGULAR_DM');
    } else if (info.type === 'MESSAGE_REQUEST') {
      messageRequests.push(entry);
      console.log('📨 MESSAGE_REQUEST');
    } else {
      unknown.push(entry);
      console.log('❓ UNKNOWN');
    }
  }
  
  // Summary
  console.log('\n' + '═'.repeat(50));
  console.log('\n📋 SUMMARY\n');
  
  console.log(`✅ REGULAR DMs (${regularDMs.length}):`);
  regularDMs.forEach((d, i) => {
    console.log(`   ${i + 1}. ${d.name} ${d.username || ''}`);
  });
  
  console.log(`\n📨 MESSAGE REQUESTS (${messageRequests.length}):`);
  messageRequests.forEach((r, i) => {
    console.log(`   ${i + 1}. ${r.name} ${r.username || ''}`);
  });
  
  if (unknown.length > 0) {
    console.log(`\n❓ UNKNOWN (${unknown.length}):`);
    unknown.forEach((u, i) => {
      console.log(`   ${i + 1}. ${u.name}`);
    });
  }
  
  console.log('\n' + '═'.repeat(50));
  console.log(`\nTotal: ${regularDMs.length} DMs, ${messageRequests.length} Requests, ${unknown.length} Unknown\n`);
}

// CLI
const limit = parseInt(process.argv[2] || '20');
categorizeChats(limit).catch(console.error);
