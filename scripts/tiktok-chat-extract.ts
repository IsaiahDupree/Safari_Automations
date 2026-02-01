#!/usr/bin/env npx tsx
/**
 * TikTok Chat Extraction Tool
 * Click into conversations and extract all messages with full details
 * 
 * Usage:
 *   npx tsx scripts/tiktok-chat-extract.ts                    # Extract current chat
 *   npx tsx scripts/tiktok-chat-extract.ts sarah              # Open & extract sarah's chat
 *   npx tsx scripts/tiktok-chat-extract.ts --list             # List all conversations
 *   npx tsx scripts/tiktok-chat-extract.ts --discover         # Discover all selectors
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

async function get(endpoint: string): Promise<any> {
  const res = await fetch(`${API}${endpoint}`);
  return res.json();
}

// Navigate to inbox
async function navigateToInbox(): Promise<void> {
  await post('/api/tiktok/inbox/navigate');
  await new Promise(r => setTimeout(r, 1500));
}

// List all conversations
async function listConversations(): Promise<any[]> {
  const result = await exec(`(function(){
    var items = document.querySelectorAll('[data-e2e="chat-list-item"]');
    var convos = [];
    for(var i=0; i<items.length; i++){
      var item = items[i];
      var nickname = item.querySelector('[class*="PInfoNickname"]');
      var extract = item.querySelector('[class*="SpanInfoExtract"]');
      var time = item.querySelector('[class*="SpanInfoTime"]');
      convos.push({
        index: i,
        displayName: nickname ? nickname.innerText.trim() : 'Unknown',
        lastMessage: extract ? extract.innerText.trim().substring(0,50) : '',
        timestamp: time ? time.innerText.trim() : ''
      });
    }
    return JSON.stringify(convos);
  })()`);
  return JSON.parse(result || '[]');
}

// Click into a conversation by name/index
async function openConversation(identifier: string | number): Promise<boolean> {
  const script = typeof identifier === 'number' 
    ? `(function(){
        var items = document.querySelectorAll('[data-e2e="chat-list-item"]');
        if(items[${identifier}]){ items[${identifier}].click(); return 'clicked'; }
        return 'not found';
      })()`
    : `(function(){
        var items = document.querySelectorAll('[data-e2e="chat-list-item"]');
        for(var i=0; i<items.length; i++){
          if(items[i].innerText.toLowerCase().includes('${identifier.toLowerCase()}')){
            items[i].click();
            return 'clicked';
          }
        }
        return 'not found';
      })()`;
  
  const result = await exec(script);
  if (result === 'clicked') {
    await new Promise(r => setTimeout(r, 1500));
    return true;
  }
  return false;
}

// Get current chat header info with type detection
async function getChatHeader(): Promise<any> {
  const result = await exec(`(function(){
    var strangerBox = document.querySelector('[class*="StrangerBox"]');
    var input = document.querySelector('[data-e2e="message-input-area"]');
    var type = strangerBox ? 'MESSAGE_REQUEST' : input ? 'REGULAR_DM' : 'UNKNOWN';
    
    return JSON.stringify({
      nickname: document.querySelector('[data-e2e="chat-nickname"]')?.innerText || null,
      username: document.querySelector('[data-e2e="chat-uniqueid"]')?.innerText || null,
      avatarSrc: document.querySelector('[data-e2e="top-chat-avatar"] img')?.src || null,
      type: type,
      isRequest: strangerBox ? true : false,
      hasInput: input ? true : false
    });
  })()`);
  return JSON.parse(result || '{}');
}

// Extract all messages from current chat
async function extractMessages(): Promise<any[]> {
  const result = await exec(`(function(){
    var msgs = document.querySelectorAll('[data-e2e="chat-item"]');
    var times = document.querySelectorAll('[class*="TimeContainer"]');
    var timeMap = {};
    for(var t=0; t<times.length; t++){
      timeMap[t] = times[t].innerText.trim();
    }
    var results = [];
    for(var i=0; i<msgs.length; i++){
      var m = msgs[i];
      var link = m.querySelector('a[href*="@"]');
      var sender = link ? link.href.match(/@([^/]+)/)?.[1] : 'unknown';
      var textEl = m.querySelector('[class*="TextContainer"]');
      var videoEl = m.querySelector('[class*="VideoContainer"]');
      var authorEl = m.querySelector('[class*="AuthorInnerContainer"]');
      var avatarEl = m.querySelector('[data-e2e="chat-avatar"] img');
      var warningEl = m.querySelector('[data-e2e="dm-warning"]');
      
      results.push({
        index: i,
        sender: sender,
        type: textEl ? 'text' : videoEl ? 'video' : 'other',
        content: textEl ? textEl.innerText.trim() : 
                 authorEl ? authorEl.innerText.trim() : 
                 m.innerText.trim().substring(0,100).replace(/\\n/g,' '),
        timestamp: timeMap[i] || null,
        avatarUrl: avatarEl ? avatarEl.src : null,
        hasWarning: warningEl ? true : false
      });
    }
    return JSON.stringify(results);
  })()`);
  return JSON.parse(result || '[]');
}

// Discover all selectors in current view
async function discoverSelectors(): Promise<any> {
  const e2eResult = await exec(`(function(){
    var e2e = {};
    document.querySelectorAll('[data-e2e]').forEach(function(el){
      var attr = el.getAttribute('data-e2e');
      if(attr){ if(!e2e[attr]) e2e[attr] = 0; e2e[attr]++; }
    });
    return JSON.stringify(e2e);
  })()`);
  
  const classResult = await exec(`(function(){
    var p = {};
    document.querySelectorAll('div[class]').forEach(function(d){
      var m = d.className.match(/--([A-Z][a-zA-Z]+)/g);
      if(m) m.forEach(function(x){
        var n = x.replace('--','');
        if(!p[n]) p[n] = 0; p[n]++;
      });
    });
    return JSON.stringify(p);
  })()`);
  
  return {
    e2eSelectors: JSON.parse(e2eResult || '{}'),
    classPatterns: JSON.parse(classResult || '{}')
  };
}

// Scroll chat to load more messages
async function scrollChat(): Promise<{before: number, after: number}> {
  const before = await exec(`document.querySelectorAll('[data-e2e="chat-item"]').length`);
  await exec(`(function(){
    var chat = document.querySelector('[class*="DivChatMain"]');
    if(chat) chat.scrollTop = 0;
  })()`);
  await new Promise(r => setTimeout(r, 1500));
  const after = await exec(`document.querySelectorAll('[data-e2e="chat-item"]').length`);
  return { before: parseInt(before), after: parseInt(after) };
}

// Main CLI
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || '';
  
  console.log('\n📱 TikTok Chat Extraction Tool\n');
  
  try {
    // Check if API is running
    const health = await get('/health');
    if (health.status !== 'ok') {
      console.log('❌ API not running. Start with: npx tsx packages/tiktok-dm/src/api/server.ts');
      return;
    }
    
    if (command === '--list' || command === '-l') {
      // List all conversations
      console.log('📋 Listing conversations...\n');
      await navigateToInbox();
      const convos = await listConversations();
      console.log(`Found ${convos.length} conversations:\n`);
      convos.slice(0, 20).forEach((c: any, i: number) => {
        console.log(`  ${i}. ${c.displayName} - "${c.lastMessage}" (${c.timestamp})`);
      });
      
    } else if (command === '--discover' || command === '-d') {
      // Discover selectors
      console.log('🔍 Discovering selectors...\n');
      const selectors = await discoverSelectors();
      console.log('data-e2e selectors:', Object.keys(selectors.e2eSelectors).length);
      console.log('Class patterns:', Object.keys(selectors.classPatterns).length);
      console.log('\nKey selectors:');
      Object.entries(selectors.e2eSelectors).forEach(([k, v]) => {
        if (k.includes('chat') || k.includes('message')) {
          console.log(`  [data-e2e="${k}"]: ${v}`);
        }
      });
      
    } else if (command === '--scroll' || command === '-s') {
      // Scroll current chat
      console.log('📜 Scrolling chat to load more...\n');
      const result = await scrollChat();
      console.log(`Messages: ${result.before} → ${result.after}`);
      
    } else if (command) {
      // Open specific conversation and extract
      console.log(`💬 Opening conversation: ${command}\n`);
      await navigateToInbox();
      const opened = await openConversation(command);
      
      if (!opened) {
        console.log(`❌ Could not find conversation matching: ${command}`);
        return;
      }
      
      const header = await getChatHeader();
      console.log(`✅ Opened: ${header.nickname} (${header.username})\n`);
      
      const messages = await extractMessages();
      console.log(`📨 Found ${messages.length} messages:\n`);
      
      messages.forEach((m: any) => {
        const arrow = m.sender === 'isaiah_dupree' ? '→' : '←';
        const type = m.type === 'video' ? '🎬' : m.type === 'text' ? '💬' : '📎';
        console.log(`  ${arrow} ${type} [${m.sender}] ${m.content.substring(0, 50)}`);
      });
      
    } else {
      // Extract current chat
      console.log('📨 Extracting current chat...\n');
      
      const header = await getChatHeader();
      if (!header.nickname) {
        console.log('No chat open. Use: npx tsx scripts/tiktok-chat-extract.ts <username>');
        return;
      }
      
      console.log(`Chat with: ${header.nickname} (${header.username})\n`);
      
      const messages = await extractMessages();
      console.log(`Found ${messages.length} messages:\n`);
      
      messages.forEach((m: any) => {
        const arrow = m.sender === 'isaiah_dupree' ? '→' : '←';
        const type = m.type === 'video' ? '🎬' : m.type === 'text' ? '💬' : '📎';
        console.log(`  ${arrow} ${type} [${m.sender}] ${m.content.substring(0, 50)}`);
      });
    }
    
    console.log('\n✅ Done!\n');
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

main();
