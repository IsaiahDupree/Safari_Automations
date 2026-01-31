/**
 * Twitter/X DM Automation API
 * 
 * Unified system for Twitter DM operations:
 * - Navigate to DMs
 * - List conversations
 * - Extract messages
 * - Send DMs
 * 
 * Usage:
 *   npx tsx scripts/twitter-api.ts navigate
 *   npx tsx scripts/twitter-api.ts conversations
 *   npx tsx scripts/twitter-api.ts messages <conversation_id>
 *   npx tsx scripts/twitter-api.ts dm <username> <message>
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const SAFARI_URL = process.env.SAFARI_API_URL || 'http://localhost:3100';
const SUPABASE_URL = process.env.CRM_SUPABASE_URL || 'http://127.0.0.1:54321';
const SUPABASE_KEY = process.env.CRM_SUPABASE_KEY || '';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ============== Twitter/X Selectors ==============

const SELECTORS = {
  // Navigation
  dmNavLink: '[data-testid="AppTabBar_DirectMessage_Link"]',
  
  // DM Container
  dmContainer: '[data-testid="dm-container"]',
  dmInboxPanel: '[data-testid="dm-inbox-panel"]',
  dmConversationPanel: '[data-testid="dm-conversation-panel"]',
  
  // Inbox
  dmInboxTitle: '[data-testid="dm-inbox-title"]',
  dmNewChatButton: '[data-testid="dm-new-chat-button"]',
  dmSearchBar: '[data-testid="dm-search-bar"]',
  
  // Tabs
  dmTabAll: '[data-testid="dm-inbox-tab-all"]',
  dmTabRequests: '[data-testid="dm-inbox-tab-requests"]',
  
  // Conversations
  dmConversationItem: '[data-testid^="dm-conversation-item"]',
  
  // Message Composer
  dmComposerTextInput: '[data-testid="dmComposerTextInput"]',
  dmComposerSendButton: '[data-testid="dmComposerSendButton"]',
  sendDMFromProfile: '[data-testid="sendDMFromProfile"]',
  
  // Messages
  messageEntry: '[data-testid="messageEntry"]',
  dmScrollerContainer: '[data-testid="DmScrollerContainer"]',
  
  // Generic
  textbox: '[role="textbox"]',
  contentEditable: '[contenteditable="true"]',
};

// ============== Helper Functions ==============

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function exec(script: string): Promise<string> {
  try {
    const res = await fetch(`${SAFARI_URL}/api/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ script })
    });
    const data = await res.json() as { output?: string };
    return data.output || '';
  } catch (e) {
    console.error('Safari API error:', e);
    return '';
  }
}

async function getCurrentUrl(): Promise<string> {
  return await exec('window.location.href');
}

async function isOnTwitterDMs(): Promise<boolean> {
  const url = await getCurrentUrl();
  return url.includes('x.com/messages') || url.includes('twitter.com/messages') || url.includes('x.com/i/chat');
}

// ============== Navigation ==============

/**
 * Navigate to Twitter DMs inbox
 */
async function navigateToDMs(): Promise<boolean> {
  console.log('📬 Navigating to Twitter DMs...');
  
  await exec('window.location.href = "https://x.com/messages"');
  await wait(3000);
  
  const onDMs = await isOnTwitterDMs();
  if (onDMs) {
    console.log('   ✅ On Twitter DMs');
    return true;
  }
  
  console.log('   ❌ Failed to navigate to DMs');
  return false;
}

/**
 * Navigate to a specific conversation
 */
async function navigateToConversation(conversationId: string): Promise<boolean> {
  console.log(`📨 Opening conversation: ${conversationId}`);
  
  await exec(`window.location.href = "https://x.com/messages/${conversationId}"`);
  await wait(3000);
  
  const url = await getCurrentUrl();
  if (url.includes(conversationId)) {
    console.log('   ✅ Conversation opened');
    return true;
  }
  
  console.log('   ❌ Failed to open conversation');
  return false;
}

// ============== Conversation Operations ==============

interface TwitterConversation {
  id: string;
  displayName: string;
  lastMessage: string;
  timestamp: string;
}

/**
 * List all conversations in the inbox
 */
async function listConversations(): Promise<TwitterConversation[]> {
  // Make sure we're on DMs
  const onDMs = await isOnTwitterDMs();
  if (!onDMs) {
    await navigateToDMs();
    await wait(2000);
  }
  
  const result = await exec(`(function(){
    var convos = document.querySelectorAll('[data-testid^="dm-conversation-item"]');
    var list = [];
    for(var i = 0; i < convos.length; i++) {
      var c = convos[i];
      var testid = c.getAttribute('data-testid');
      var id = testid.replace('dm-conversation-item-', '');
      var text = c.innerText;
      var lines = text.split('\\n').filter(function(l) { return l.trim(); });
      list.push({
        id: id,
        displayName: lines[0] || '',
        lastMessage: lines[2] || lines[1] || '',
        timestamp: lines[1] || ''
      });
    }
    return JSON.stringify(list);
  })()`);
  
  try {
    return JSON.parse(result);
  } catch {
    return [];
  }
}

/**
 * Click on a conversation to open it
 */
async function openConversation(conversationId: string): Promise<boolean> {
  const result = await exec(`(function(){
    var conv = document.querySelector('[data-testid="dm-conversation-item-${conversationId}"]');
    if(conv) {
      conv.click();
      return 'clicked';
    }
    return 'not found';
  })()`);
  
  if (result === 'clicked') {
    await wait(2000);
    return true;
  }
  return false;
}

// ============== Message Operations ==============

interface TwitterMessage {
  text: string;
  isOutbound: boolean;
  timestamp?: string;
}

/**
 * Extract messages from current conversation
 */
async function extractMessages(): Promise<TwitterMessage[]> {
  const result = await exec(`(function(){
    // Try multiple selectors for messages
    var messages = [];
    
    // Look for message entries
    var entries = document.querySelectorAll('[data-testid="messageEntry"]');
    if(entries.length === 0) {
      // Try looking for message bubbles or other containers
      entries = document.querySelectorAll('[data-testid*="message"]');
    }
    
    // Also try the DM scroller container
    var container = document.querySelector('[data-testid="DmScrollerContainer"]');
    if(container) {
      var divs = container.querySelectorAll('div[dir="auto"]');
      for(var i = 0; i < divs.length; i++) {
        var text = divs[i].innerText.trim();
        if(text && text.length > 0 && text.length < 1000) {
          messages.push({
            text: text,
            isOutbound: false // Would need more logic to determine
          });
        }
      }
    }
    
    return JSON.stringify(messages);
  })()`);
  
  try {
    return JSON.parse(result);
  } catch {
    return [];
  }
}

/**
 * Send a DM to the current conversation
 */
async function sendMessage(message: string): Promise<boolean> {
  console.log(`💬 Sending message: "${message.substring(0, 50)}..."`);
  
  // Find textbox
  const textboxFound = await exec(`(function(){
    var tb = document.querySelector('[data-testid="dmComposerTextInput"]');
    if(!tb) tb = document.querySelector('[role="textbox"]');
    if(!tb) tb = document.querySelector('[contenteditable="true"]');
    if(tb) {
      tb.focus();
      return 'found';
    }
    return 'not found';
  })()`);
  
  if (!textboxFound.includes('found')) {
    console.log('   ❌ Could not find message input');
    return false;
  }
  
  await wait(500);
  
  // Type message
  const escapedMessage = message.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
  const typeResult = await exec(`(function(){
    var tb = document.querySelector('[data-testid="dmComposerTextInput"]');
    if(!tb) tb = document.querySelector('[role="textbox"]');
    if(!tb) tb = document.querySelector('[contenteditable="true"]');
    if(!tb) return 'no textbox';
    
    tb.focus();
    tb.innerText = "${escapedMessage}";
    tb.dispatchEvent(new InputEvent('input', {bubbles: true}));
    return 'typed';
  })()`);
  
  if (!typeResult.includes('typed')) {
    console.log('   ❌ Could not type message');
    return false;
  }
  
  await wait(500);
  
  // Click send button
  const sendResult = await exec(`(function(){
    var btn = document.querySelector('[data-testid="dmComposerSendButton"]');
    if(!btn) {
      // Try finding by aria-label
      var btns = document.querySelectorAll('button[aria-label*="Send"]');
      if(btns.length > 0) btn = btns[0];
    }
    if(!btn) {
      // Try finding by role
      var allBtns = document.querySelectorAll('[role="button"]');
      for(var i = 0; i < allBtns.length; i++) {
        if(allBtns[i].getAttribute('aria-label')?.includes('Send')) {
          btn = allBtns[i];
          break;
        }
      }
    }
    if(btn) {
      btn.click();
      return 'sent';
    }
    return 'no send button';
  })()`);
  
  if (sendResult.includes('sent')) {
    console.log('   ✅ Message sent!');
    return true;
  }
  
  console.log('   ❌ Could not find Send button');
  return false;
}

/**
 * Send a DM to a user by username
 */
async function sendDMByUsername(username: string, message: string): Promise<boolean> {
  console.log(`\n📤 Sending DM to @${username}`);
  
  // Navigate to user's profile
  await exec(`window.location.href = "https://x.com/${username}"`);
  await wait(3000);
  
  // Click the Message button
  const clickResult = await exec(`(function(){
    var btn = document.querySelector('[data-testid="sendDMFromProfile"]');
    if(btn) {
      btn.click();
      return 'clicked';
    }
    return 'not found';
  })()`);
  
  if (!clickResult.includes('clicked')) {
    console.log('   ❌ Could not find Message button on profile');
    return false;
  }
  
  await wait(2000);
  
  // Now send the message
  return await sendMessage(message);
}

// ============== Profile Operations ==============

interface TwitterProfile {
  username: string;
  displayName: string;
  bio: string;
  followers: string;
  following: string;
}

/**
 * Extract profile data from current page
 */
async function extractProfileData(): Promise<TwitterProfile | null> {
  const result = await exec(`(function(){
    var profile = {};
    
    // Username from URL
    var url = window.location.href;
    var match = url.match(/x\\.com\\/([^\\/?]+)/);
    profile.username = match ? match[1] : '';
    
    // Display name
    var nameEl = document.querySelector('[data-testid="UserName"]');
    if(nameEl) {
      var spans = nameEl.querySelectorAll('span');
      if(spans.length > 0) profile.displayName = spans[0].innerText;
    }
    
    // Bio
    var bioEl = document.querySelector('[data-testid="UserDescription"]');
    profile.bio = bioEl ? bioEl.innerText : '';
    
    // Followers/Following
    var links = document.querySelectorAll('a[href*="followers"], a[href*="following"]');
    for(var i = 0; i < links.length; i++) {
      var href = links[i].getAttribute('href');
      var text = links[i].innerText;
      if(href.includes('followers')) profile.followers = text;
      if(href.includes('following')) profile.following = text;
    }
    
    return JSON.stringify(profile);
  })()`);
  
  try {
    return JSON.parse(result);
  } catch {
    return null;
  }
}

// ============== Status & Diagnostics ==============

/**
 * Get Twitter DM status and diagnostics
 */
async function getStatus(): Promise<any> {
  const url = await getCurrentUrl();
  const onTwitter = url.includes('x.com') || url.includes('twitter.com');
  const onDMs = url.includes('messages') || url.includes('i/chat');
  
  const elementCheck = await exec(`(function(){
    return JSON.stringify({
      dmContainer: !!document.querySelector('[data-testid="dm-container"]'),
      dmInbox: !!document.querySelector('[data-testid="dm-inbox-panel"]'),
      conversations: document.querySelectorAll('[data-testid^="dm-conversation-item"]').length,
      textbox: !!document.querySelector('[role="textbox"]'),
      sendButton: !!document.querySelector('[data-testid="dmComposerSendButton"]')
    });
  })()`);
  
  let elements = {};
  try {
    elements = JSON.parse(elementCheck);
  } catch {}
  
  return {
    url,
    onTwitter,
    onDMs,
    elements
  };
}

// ============== CLI ==============

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  
  console.log('\n🐦 Twitter/X DM Automation API\n');
  
  if (!command || command === 'help') {
    console.log('Commands:');
    console.log('  status                       - Check Twitter DM status');
    console.log('  navigate                     - Navigate to DMs inbox');
    console.log('  conversations                - List all conversations');
    console.log('  open <conversation_id>       - Open a conversation');
    console.log('  messages                     - Extract messages from current conversation');
    console.log('  send <message>               - Send message to current conversation');
    console.log('  dm <username> <message>      - Send DM to user by username');
    console.log('  profile <username>           - Extract profile data');
    console.log('  explore                      - Explore current page DOM');
    console.log('\nExamples:');
    console.log('  npx tsx scripts/twitter-api.ts status');
    console.log('  npx tsx scripts/twitter-api.ts conversations');
    console.log('  npx tsx scripts/twitter-api.ts dm elonmusk "Hello!"');
    return;
  }
  
  switch (command) {
    case 'status': {
      const status = await getStatus();
      console.log('📊 Twitter DM Status:\n');
      console.log(`  URL: ${status.url}`);
      console.log(`  On Twitter: ${status.onTwitter}`);
      console.log(`  On DMs: ${status.onDMs}`);
      console.log(`  Elements:`, status.elements);
      break;
    }
    
    case 'navigate': {
      await navigateToDMs();
      break;
    }
    
    case 'conversations': {
      console.log('📬 Listing conversations...\n');
      const convos = await listConversations();
      if (convos.length === 0) {
        console.log('  No conversations found');
      } else {
        convos.forEach((c, i) => {
          console.log(`  ${i + 1}. ${c.displayName}`);
          console.log(`     ID: ${c.id}`);
          console.log(`     Last: ${c.lastMessage.substring(0, 50)}...`);
          console.log('');
        });
      }
      console.log(`  Total: ${convos.length} conversations`);
      break;
    }
    
    case 'open': {
      const convId = args[1];
      if (!convId) {
        console.log('Usage: open <conversation_id>');
        break;
      }
      await openConversation(convId);
      break;
    }
    
    case 'messages': {
      console.log('📨 Extracting messages...\n');
      const msgs = await extractMessages();
      if (msgs.length === 0) {
        console.log('  No messages found');
      } else {
        msgs.forEach((m, i) => {
          const dir = m.isOutbound ? '→' : '←';
          console.log(`  ${dir} ${m.text.substring(0, 80)}...`);
        });
      }
      console.log(`\n  Total: ${msgs.length} messages`);
      break;
    }
    
    case 'send': {
      const message = args.slice(1).join(' ');
      if (!message) {
        console.log('Usage: send <message>');
        break;
      }
      await sendMessage(message);
      break;
    }
    
    case 'dm': {
      const username = args[1];
      const message = args.slice(2).join(' ');
      if (!username || !message) {
        console.log('Usage: dm <username> <message>');
        break;
      }
      await sendDMByUsername(username, message);
      break;
    }
    
    case 'profile': {
      const username = args[1];
      if (username) {
        await exec(`window.location.href = "https://x.com/${username}"`);
        await wait(3000);
      }
      const profile = await extractProfileData();
      if (profile) {
        console.log('👤 Profile:\n');
        console.log(`  Username: @${profile.username}`);
        console.log(`  Name: ${profile.displayName}`);
        console.log(`  Bio: ${profile.bio}`);
        console.log(`  Followers: ${profile.followers}`);
        console.log(`  Following: ${profile.following}`);
      } else {
        console.log('  Could not extract profile');
      }
      break;
    }
    
    case 'explore': {
      console.log('🔍 Exploring current page...\n');
      const testIds = await exec(`(function(){
        var all = document.querySelectorAll('[data-testid]');
        var ids = [];
        for(var i = 0; i < all.length; i++) {
          ids.push(all[i].getAttribute('data-testid'));
        }
        return ids.join('\\n');
      })()`);
      console.log('  data-testid attributes found:\n');
      testIds.split('\n').forEach(id => console.log(`    ${id}`));
      break;
    }
    
    default:
      console.log(`Unknown command: ${command}`);
      console.log('Run with no arguments for help.');
  }
}

main();

export {
  navigateToDMs,
  navigateToConversation,
  listConversations,
  openConversation,
  extractMessages,
  sendMessage,
  sendDMByUsername,
  extractProfileData,
  getStatus,
  SELECTORS
};
