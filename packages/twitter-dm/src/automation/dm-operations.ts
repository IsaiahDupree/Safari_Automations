/**
 * Twitter/X DM Operations
 * High-level functions for DM interactions.
 */

import { SafariDriver, getDefaultDriver } from './safari-driver.js';
import type {
  DMConversation,
  DMMessage,
  DMTab,
  SendMessageResult,
  NavigationResult,
  ProfileDMResult,
} from './types.js';
import { TWITTER_SELECTORS } from './types.js';

const TWITTER_DM_URL = 'https://x.com/messages';

/**
 * Navigate to Twitter/X DM inbox.
 */
export async function navigateToInbox(driver?: SafariDriver): Promise<NavigationResult> {
  const d = driver || getDefaultDriver();
  
  const success = await d.navigateTo(TWITTER_DM_URL);
  if (!success) {
    return { success: false, error: 'Failed to navigate to inbox' };
  }
  
  await d.wait(2000);
  
  const isLoggedIn = await d.isLoggedIn();
  if (!isLoggedIn) {
    return { success: false, error: 'Not logged in to Twitter/X' };
  }
  
  const currentUrl = await d.getCurrentUrl();
  return { success: true, currentUrl };
}

/**
 * List conversations from current inbox view.
 */
export async function listConversations(driver?: SafariDriver): Promise<DMConversation[]> {
  const d = driver || getDefaultDriver();
  
  const result = await d.executeJS(`
    (function() {
      var conversations = [];
      var items = document.querySelectorAll('[data-testid="conversation"]');
      
      items.forEach(function(item) {
        var nameEl = item.querySelector('[data-testid="conversation-name"]') ||
                     item.querySelector('span[dir="ltr"]');
        var username = nameEl ? nameEl.innerText : '';
        
        var textEls = item.querySelectorAll('span');
        var lastMsg = '';
        for (var i = 0; i < textEls.length; i++) {
          var text = textEls[i].innerText || '';
          if (text.length > 10 && text !== username) {
            lastMsg = text;
            break;
          }
        }
        
        if (username) {
          conversations.push(JSON.stringify({
            username: username,
            lastMessage: lastMsg.substring(0, 100)
          }));
        }
      });
      
      return '[' + conversations.slice(0, 30).join(',') + ']';
    })()
  `);
  
  try {
    const parsed = JSON.parse(result || '[]');
    return parsed as DMConversation[];
  } catch {
    return [];
  }
}

/**
 * Switch to DM requests tab.
 */
export async function switchTab(tab: DMTab, driver?: SafariDriver): Promise<boolean> {
  const d = driver || getDefaultDriver();
  
  if (tab === 'requests') {
    const result = await d.executeJS(`
      (function() {
        var reqTab = document.querySelector('[data-testid="dm-inbox-requests"]') ||
                     document.querySelector('a[href*="requests"]');
        if (reqTab) {
          reqTab.click();
          return 'clicked';
        }
        return 'not_found';
      })()
    `);
    await d.wait(2000);
    return result === 'clicked';
  }
  
  // Navigate back to main inbox
  await navigateToInbox(d);
  return true;
}

/**
 * Click on a conversation by username.
 */
export async function openConversation(username: string, driver?: SafariDriver): Promise<boolean> {
  const d = driver || getDefaultDriver();
  
  const result = await d.executeJS(`
    (function() {
      var items = document.querySelectorAll('[data-testid="conversation"]');
      for (var i = 0; i < items.length; i++) {
        var text = items[i].innerText || '';
        if (text.toLowerCase().includes('${username.toLowerCase()}')) {
          items[i].click();
          return 'clicked';
        }
      }
      
      // Fallback: search by span text
      var spans = document.querySelectorAll('span');
      for (var j = 0; j < spans.length; j++) {
        if ((spans[j].innerText || '').toLowerCase() === '${username.toLowerCase()}') {
          var parent = spans[j].closest('[data-testid="conversation"]') || 
                       spans[j].closest('div[role="button"]');
          if (parent) {
            parent.click();
            return 'clicked';
          }
        }
      }
      
      return 'not_found';
    })()
  `);
  
  await d.wait(2000);
  return result === 'clicked';
}

/**
 * Read messages from current conversation.
 */
export async function readMessages(limit: number = 20, driver?: SafariDriver): Promise<DMMessage[]> {
  const d = driver || getDefaultDriver();
  
  const result = await d.executeJS(`
    (function() {
      var messages = [];
      var msgEls = document.querySelectorAll('[data-testid="messageEntry"]');
      
      msgEls.forEach(function(el) {
        var textEl = el.querySelector('[data-testid="tweetText"]') || 
                     el.querySelector('span[dir="auto"]');
        var text = textEl ? textEl.innerText : '';
        
        if (text.length > 0) {
          // Determine if outbound by checking for specific styling or position
          var style = window.getComputedStyle(el);
          var rect = el.getBoundingClientRect();
          var isRight = rect.left > (window.innerWidth / 3);
          
          messages.push(JSON.stringify({
            text: text.substring(0, 500),
            isOutbound: isRight,
            messageType: 'text'
          }));
        }
      });
      
      return '[' + messages.slice(-${limit}).join(',') + ']';
    })()
  `);
  
  try {
    const parsed = JSON.parse(result || '[]');
    return parsed as DMMessage[];
  } catch {
    return [];
  }
}

/**
 * Send a DM to the current open conversation.
 */
export async function sendMessage(text: string, driver?: SafariDriver): Promise<SendMessageResult> {
  const d = driver || getDefaultDriver();
  
  // Find message input (Twitter uses Draft.js - requires execCommand)
  const inputFound = await d.executeJS(`
    (function() {
      var input = document.querySelector('[data-testid="dm-composer-textarea"]') ||
                  document.querySelector('[role="textbox"]') ||
                  document.querySelector('[contenteditable="true"]');
      if (input) {
        input.focus();
        return 'found';
      }
      return 'not_found';
    })()
  `);
  
  if (inputFound !== 'found') {
    return { success: false, error: 'Message input not found' };
  }
  
  await d.wait(500);
  
  // Type message using execCommand for Draft.js compatibility
  const escaped = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
  
  await d.executeJS(`
    (function() {
      var input = document.querySelector('[data-testid="dm-composer-textarea"]') ||
                  document.querySelector('[role="textbox"]');
      if (input) {
        input.focus();
        document.execCommand('insertText', false, "${escaped}");
        return 'typed';
      }
      return 'failed';
    })()
  `);
  
  await d.wait(500);
  
  // Click send button
  const sendResult = await d.executeJS(`
    (function() {
      var btn = document.querySelector('[data-testid="dm-composer-send-button"]');
      if (!btn) btn = document.querySelector('[aria-label="Send"]');
      if (btn) {
        btn.click();
        return 'sent';
      }
      return 'no_send_button';
    })()
  `);
  
  if (sendResult === 'sent') {
    await d.wait(1000);
    return { success: true };
  }
  
  return { success: false, error: 'Could not send message' };
}

/**
 * Start a new conversation with a user.
 */
export async function startNewConversation(username: string, driver?: SafariDriver): Promise<boolean> {
  const d = driver || getDefaultDriver();
  
  // Click new message button
  const newMsgResult = await d.executeJS(`
    (function() {
      var btn = document.querySelector('[data-testid="NewDM_Button"]') ||
                document.querySelector('[aria-label*="New message"]');
      if (btn) {
        btn.click();
        return 'clicked';
      }
      return 'not_found';
    })()
  `);
  
  if (newMsgResult !== 'clicked') {
    return false;
  }
  
  await d.wait(1500);
  
  // Type username in search
  await d.executeJS(`
    (function() {
      var input = document.querySelector('[data-testid="SearchBox_Search_Input"]') ||
                  document.querySelector('input[placeholder*="Search"]');
      if (input) {
        input.focus();
        input.value = '${username}';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return 'typed';
      }
      return 'not_found';
    })()
  `);
  
  await d.wait(2000);
  
  // Click on first result
  const selectResult = await d.executeJS(`
    (function() {
      var results = document.querySelectorAll('[data-testid="TypeaheadUser"]');
      if (results.length > 0) {
        results[0].click();
        return 'selected';
      }
      
      // Fallback
      var divs = document.querySelectorAll('div[role="button"]');
      for (var i = 0; i < divs.length; i++) {
        if ((divs[i].innerText || '').toLowerCase().includes('${username.toLowerCase()}')) {
          divs[i].click();
          return 'selected';
        }
      }
      return 'not_found';
    })()
  `);
  
  if (selectResult !== 'selected') {
    return false;
  }
  
  await d.wait(1000);
  
  // Click Next button
  await d.executeJS(`
    (function() {
      var btns = document.querySelectorAll('button, div[role="button"]');
      for (var i = 0; i < btns.length; i++) {
        var text = (btns[i].innerText || '').toLowerCase();
        if (text === 'next') {
          btns[i].click();
          return 'clicked';
        }
      }
      return 'not_found';
    })()
  `);
  
  await d.wait(1500);
  return true;
}

/**
 * Send DM by navigating to user's profile first.
 */
export async function sendDMByUsername(
  username: string, 
  message: string, 
  driver?: SafariDriver
): Promise<ProfileDMResult> {
  const d = driver || getDefaultDriver();
  
  console.log(`📤 Sending DM to @${username}`);
  
  // Navigate to user's profile
  console.log(`   📍 Navigating to profile...`);
  await d.navigateTo(`https://x.com/${username}`);
  await d.wait(2000);
  
  // Wait for profile to load with retry
  let profileReady = false;
  for (let attempt = 0; attempt < 5; attempt++) {
    const profileCheck = await d.executeJS(`(function(){
      var primary = document.querySelector('[data-testid="primaryColumn"]');
      if(primary && primary.innerText.includes('This account doesn')) return 'not_found';
      if(primary && primary.innerText.includes('Account suspended')) return 'suspended';
      if(primary && primary.innerText.includes('protected')) return 'protected';
      var dmBtn = document.querySelector('[data-testid="sendDMFromProfile"]');
      return dmBtn ? 'profile_ready' : 'loading';
    })()`);
    
    if (profileCheck.includes('not_found')) {
      return { success: false, error: 'User not found', username };
    }
    if (profileCheck.includes('suspended')) {
      return { success: false, error: 'Account suspended', username };
    }
    if (profileCheck.includes('protected')) {
      return { success: false, error: 'Account is protected', username };
    }
    if (profileCheck.includes('profile_ready')) {
      profileReady = true;
      break;
    }
    
    await d.wait(1000);
  }
  
  if (!profileReady) {
    console.log(`   ⏳ Profile loading slowly, continuing anyway...`);
  }
  
  // Click the Message button
  console.log(`   💬 Clicking Message button...`);
  const clickResult = await d.executeJS(`(function(){
    var btn = document.querySelector('[data-testid="sendDMFromProfile"]');
    if(btn) {
      btn.click();
      return 'clicked';
    }
    var msgBtn = document.querySelector('[aria-label="Message"]');
    if(msgBtn) {
      msgBtn.click();
      return 'clicked_aria';
    }
    return 'not found';
  })()`);
  
  if (!clickResult.includes('clicked')) {
    return { success: false, error: 'Could not find Message button on profile', username };
  }
  
  await d.wait(2000);
  
  // Wait for composer
  let composerReady = false;
  for (let attempt = 0; attempt < 5; attempt++) {
    const check = await d.executeJS(`(function(){
      var tb = document.querySelector('[data-testid="dm-composer-textarea"]');
      if(!tb) tb = document.querySelector('[role="textbox"]');
      return tb ? 'ready' : 'loading';
    })()`);
    
    if (check === 'ready') {
      composerReady = true;
      break;
    }
    await d.wait(800);
  }
  
  if (!composerReady) {
    return { success: false, error: 'DM composer did not open', username };
  }
  
  // Type message using Draft.js compatible method
  console.log(`   ⌨️ Typing message...`);
  const escapedMessage = message.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
  const typeResult = await d.executeJS(`(function(){
    var tb = document.querySelector('[data-testid="dm-composer-textarea"]');
    if(!tb) tb = document.querySelector('[role="textbox"]');
    if(!tb) tb = document.querySelector('[contenteditable="true"]');
    if(!tb) return 'no textbox';
    tb.focus();
    document.execCommand('insertText', false, "${escapedMessage}");
    return 'typed';
  })()`);
  
  if (!typeResult.includes('typed')) {
    return { success: false, error: 'Could not type message', username };
  }
  
  await d.wait(500);
  
  // Send message
  const sendResult = await d.executeJS(`(function(){
    var btn = document.querySelector('[data-testid="dm-composer-send-button"]');
    if(!btn) btn = document.querySelector('[aria-label="Send"]');
    if(btn) {
      btn.click();
      return 'sent';
    }
    return 'no send button';
  })()`);
  
  if (sendResult.includes('sent')) {
    console.log('   ✅ Message sent!');
    return { success: true, username };
  }
  
  return { success: false, error: 'Could not find Send button', username };
}

/**
 * Send DM from a profile URL.
 */
export async function sendDMFromProfileUrl(
  profileUrl: string, 
  message: string, 
  driver?: SafariDriver
): Promise<ProfileDMResult> {
  // Extract username from URL
  const urlMatch = profileUrl.match(/(?:x\.com|twitter\.com)\/([a-zA-Z0-9_]+)/);
  if (!urlMatch) {
    return { success: false, error: 'Invalid profile URL' };
  }
  const username = urlMatch[1];
  
  return sendDMByUsername(username, message, driver);
}

/**
 * Get unread conversations.
 */
export async function getUnreadConversations(driver?: SafariDriver): Promise<DMConversation[]> {
  const d = driver || getDefaultDriver();
  
  await navigateToInbox(d);
  await d.wait(1500);
  
  const result = await d.executeJS(`
    (function() {
      var unread = [];
      var items = document.querySelectorAll('[data-testid="conversation"]');
      
      items.forEach(function(item) {
        // Check for unread indicator (blue dot or bold text)
        var hasUnread = item.querySelector('[aria-label*="unread"]') ||
                        item.querySelector('div[style*="background-color: rgb(29, 155, 240)"]');
        
        if (hasUnread) {
          var nameEl = item.querySelector('[data-testid="conversation-name"]') ||
                       item.querySelector('span[dir="ltr"]');
          var username = nameEl ? nameEl.innerText : '';
          
          if (username) {
            unread.push(JSON.stringify({ username: username }));
          }
        }
      });
      
      return '[' + unread.join(',') + ']';
    })()
  `);
  
  try {
    const parsed = JSON.parse(result || '[]');
    return parsed as DMConversation[];
  } catch {
    return [];
  }
}

/**
 * Scroll conversation to load older messages.
 */
export async function scrollConversation(scrollCount: number = 3, driver?: SafariDriver): Promise<number> {
  const d = driver || getDefaultDriver();
  let totalMessages = 0;
  
  for (let i = 0; i < scrollCount; i++) {
    await d.executeJS(`
      (function() {
        var timeline = document.querySelector('[data-testid="DM_timeline"]') ||
                       document.querySelector('[data-testid="dm-conversation-panel"]');
        if (timeline) {
          timeline.scrollTop = 0;
        }
      })()
    `);
    await d.wait(1500);
    
    const countResult = await d.executeJS(`
      document.querySelectorAll('[data-testid="messageEntry"]').length
    `);
    totalMessages = parseInt(countResult) || 0;
  }
  
  return totalMessages;
}

/**
 * Get all conversations from all tabs.
 */
export async function getAllConversations(driver?: SafariDriver): Promise<Record<DMTab, DMConversation[]>> {
  const d = driver || getDefaultDriver();
  
  await navigateToInbox(d);
  
  const results: Record<DMTab, DMConversation[]> = {
    inbox: [],
    requests: [],
  };
  
  // Get inbox conversations
  results.inbox = await listConversations(d);
  
  // Try requests tab
  await switchTab('requests', d);
  results.requests = await listConversations(d);
  
  return results;
}
