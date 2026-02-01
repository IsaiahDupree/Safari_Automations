#!/usr/bin/env npx tsx
/**
 * TikTok DM Selector Discovery CLI
 * Quick discovery and documentation of all TikTok DM selectors
 * 
 * Usage: npx tsx scripts/tiktok-discover.ts [command]
 * Commands: all, e2e, classes, convos, messages, scroll, export
 */

const API_URL = 'http://localhost:3102';

async function exec(script: string): Promise<string> {
  const res = await fetch(`${API_URL}/api/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ script })
  });
  const data = await res.json() as { output?: string };
  return data.output || '';
}

// Discover all data-e2e selectors
async function discoverE2e(): Promise<Record<string, number>> {
  const result = await exec(`(function(){
    var e2e={};
    document.querySelectorAll("[data-e2e]").forEach(function(el){
      var a=el.getAttribute("data-e2e");
      if(a){if(!e2e[a])e2e[a]=0;e2e[a]++;}
    });
    return JSON.stringify(e2e);
  })()`);
  return JSON.parse(result);
}

// Discover all class patterns
async function discoverClasses(): Promise<Record<string, number>> {
  const result = await exec(`(function(){
    var p={};
    document.querySelectorAll("div[class]").forEach(function(d){
      var m=d.className.match(/--([A-Z][a-zA-Z]+)/g);
      if(m)m.forEach(function(x){
        var n=x.replace("--","");
        if(!p[n])p[n]=0;p[n]++;
      });
    });
    return JSON.stringify(p);
  })()`);
  return JSON.parse(result);
}

// Extract conversations with full details
async function extractConversations(limit = 20): Promise<{total: number, conversations: any[]}> {
  const result = await exec(`(function(){
    var items=document.querySelectorAll('[data-e2e="chat-list-item"]');
    var convos=[];
    for(var i=0;i<Math.min(items.length,${limit});i++){
      var item=items[i];
      var nickname=item.querySelector('[class*="PInfoNickname"]');
      var extract=item.querySelector('[class*="SpanInfoExtract"]');
      var time=item.querySelector('[class*="SpanInfoTime"]');
      var avatar=item.querySelector('[class*="ImgAvatar"]');
      convos.push({
        displayName:nickname?nickname.innerText.trim():null,
        lastMessage:extract?extract.innerText.trim():null,
        timestamp:time?time.innerText.trim():null,
        avatarUrl:avatar?avatar.src:null
      });
    }
    return JSON.stringify({total:items.length,conversations:convos});
  })()`);
  return JSON.parse(result);
}

// Extract messages with full details
async function extractMessages(limit = 50): Promise<any> {
  const result = await exec(`(function(){
    var items=document.querySelectorAll('[data-e2e="chat-item"]');
    var msgs=[];
    for(var i=0;i<Math.min(items.length,${limit});i++){
      var item=items[i];
      var link=item.querySelector('a[href*="@"]');
      var sender=link?link.href.match(/@([^/]+)/)?.[1]:null;
      var textEl=item.querySelector('[class*="TextContainer"]');
      var videoEl=item.querySelector('[class*="VideoContainer"]');
      var authorEl=item.querySelector('[class*="AuthorInnerContainer"]');
      msgs.push({
        sender:sender,
        type:textEl?'text':videoEl?'video':'other',
        content:textEl?textEl.innerText.trim():authorEl?authorEl.innerText.trim():item.innerText.trim().substring(0,100)
      });
    }
    return JSON.stringify({total:items.length,messages:msgs});
  })()`);
  return JSON.parse(result);
}

// Get chat header info
async function getChatHeader(): Promise<any> {
  const result = await exec(`(function(){
    return JSON.stringify({
      nickname:document.querySelector('[data-e2e="chat-nickname"]')?.innerText||null,
      uniqueId:document.querySelector('[data-e2e="chat-uniqueid"]')?.innerText||null,
      avatarSrc:document.querySelector('[data-e2e="top-chat-avatar"] img')?.src||null
    });
  })()`);
  return JSON.parse(result);
}

// Scroll conversation list
async function scrollConvoList(): Promise<{before: number, after: number}> {
  const before = await exec(`document.querySelectorAll('[data-e2e="chat-list-item"]').length`);
  await exec(`(function(){
    var list=document.querySelector('[class*="DivConversationListContainer"]');
    if(list)list.scrollTop=list.scrollHeight;
  })()`);
  await new Promise(r => setTimeout(r, 1000));
  const after = await exec(`document.querySelectorAll('[data-e2e="chat-list-item"]').length`);
  return { before: parseInt(before), after: parseInt(after) };
}

// Scroll chat messages (up to load older)
async function scrollChatUp(): Promise<{before: number, after: number}> {
  const before = await exec(`document.querySelectorAll('[data-e2e="chat-item"]').length`);
  await exec(`(function(){
    var chat=document.querySelector('[class*="DivChatMain"]');
    if(chat)chat.scrollTop=0;
  })()`);
  await new Promise(r => setTimeout(r, 1000));
  const after = await exec(`document.querySelectorAll('[data-e2e="chat-item"]').length`);
  return { before: parseInt(before), after: parseInt(after) };
}

// Full discovery - export all selectors
async function fullDiscovery(): Promise<any> {
  console.log('🔍 Running full TikTok DM selector discovery...\n');
  
  const e2e = await discoverE2e();
  console.log(`✅ Found ${Object.keys(e2e).length} data-e2e selectors`);
  
  const classes = await discoverClasses();
  console.log(`✅ Found ${Object.keys(classes).length} class patterns`);
  
  const header = await getChatHeader();
  console.log(`✅ Chat header: ${header.nickname || 'N/A'}`);
  
  const convos = await extractConversations(5);
  console.log(`✅ Conversations: ${convos.total} total`);
  
  const msgs = await extractMessages(5);
  console.log(`✅ Messages: ${msgs.total} total`);
  
  return {
    timestamp: new Date().toISOString(),
    e2eSelectors: e2e,
    classPatterns: classes,
    chatHeader: header,
    conversationsSample: convos,
    messagesSample: msgs
  };
}

// Check for error state and retry
async function checkError(): Promise<{hasError: boolean, retried?: boolean}> {
  const result = await exec(`(function(){
    var bodyText = document.body.innerText || '';
    var hasError = bodyText.includes('Page not available') || 
                   bodyText.includes('Sorry about that') ||
                   bodyText.includes('Something went wrong');
    
    if (hasError) {
      var buttons = document.querySelectorAll('button');
      for (var i = 0; i < buttons.length; i++) {
        var text = buttons[i].innerText.toLowerCase();
        if (text.includes('try again') || text.includes('retry')) {
          buttons[i].click();
          return JSON.stringify({hasError: true, retried: true});
        }
      }
      return JSON.stringify({hasError: true, retried: false});
    }
    return JSON.stringify({hasError: false});
  })()`);
  return JSON.parse(result);
}

// CLI
const command = process.argv[2] || 'all';

(async () => {
  try {
    switch (command) {
      case 'e2e':
        console.log(JSON.stringify(await discoverE2e(), null, 2));
        break;
      case 'classes':
        console.log(JSON.stringify(await discoverClasses(), null, 2));
        break;
      case 'convos':
        console.log(JSON.stringify(await extractConversations(20), null, 2));
        break;
      case 'messages':
        console.log(JSON.stringify(await extractMessages(30), null, 2));
        break;
      case 'header':
        console.log(JSON.stringify(await getChatHeader(), null, 2));
        break;
      case 'scroll-convos':
        console.log(JSON.stringify(await scrollConvoList(), null, 2));
        break;
      case 'scroll-chat':
        console.log(JSON.stringify(await scrollChatUp(), null, 2));
        break;
      case 'error':
      case 'check-error':
        const errorResult = await checkError();
        if (errorResult.hasError) {
          console.log(`⚠️ Error detected! Retried: ${errorResult.retried}`);
        } else {
          console.log('✅ No error detected');
        }
        console.log(JSON.stringify(errorResult, null, 2));
        break;
      case 'all':
      case 'export':
        const data = await fullDiscovery();
        console.log('\n📋 Full Discovery Results:\n');
        console.log(JSON.stringify(data, null, 2));
        break;
      default:
        console.log(`
TikTok DM Selector Discovery

Usage: npx tsx scripts/tiktok-discover.ts [command]

Commands:
  all          Full discovery (default)
  e2e          List all data-e2e selectors
  classes      List all class patterns
  convos       Extract conversation list data
  messages     Extract chat messages data
  header       Get current chat header info
  scroll-convos  Scroll conversation list to load more
  scroll-chat    Scroll chat to load older messages
  error        Check for error page and auto-retry
  export       Full discovery with JSON export
        `);
    }
  } catch (error) {
    console.error('Error:', error);
  }
})();
