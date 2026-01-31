/**
 * Instagram DM Operations
 * High-level functions for DM interactions.
 */

import { SafariDriver, getDefaultDriver } from './safari-driver.js';
import type {
  DMConversation,
  DMMessage,
  DMThread,
  DMTab,
  SendMessageResult,
  NavigationResult,
} from './types.js';

const INSTAGRAM_DM_URL = 'https://www.instagram.com/direct/inbox/';

/**
 * Navigate to Instagram DM inbox.
 */
export async function navigateToInbox(driver?: SafariDriver): Promise<NavigationResult> {
  const d = driver || getDefaultDriver();
  
  const success = await d.navigateTo(INSTAGRAM_DM_URL);
  if (!success) {
    return { success: false, error: 'Failed to navigate to inbox' };
  }
  
  await d.wait(2000);
  
  const isLoggedIn = await d.isLoggedIn();
  if (!isLoggedIn) {
    return { success: false, error: 'Not logged in to Instagram' };
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
      var imgs = document.querySelectorAll('img[alt*="profile picture"]');
      
      imgs.forEach(function(img) {
        var alt = img.getAttribute('alt') || '';
        var username = alt.replace("'s profile picture", '').trim();
        if (username && username.length > 1) {
          var container = img.closest('div[role="button"]') || img.closest('a');
          var textEl = container ? container.querySelector('span') : null;
          var lastMsg = '';
          if (textEl) {
            var spans = container.querySelectorAll('span');
            for (var i = 0; i < spans.length; i++) {
              var text = spans[i].innerText || '';
              if (text.length > 10 && text !== username) {
                lastMsg = text;
                break;
              }
            }
          }
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
 * Switch to a specific DM tab.
 */
export async function switchTab(tab: DMTab, driver?: SafariDriver): Promise<boolean> {
  const d = driver || getDefaultDriver();
  
  const tabNames: Record<DMTab, string> = {
    primary: 'Primary',
    general: 'General',
    requests: 'Requests',
    hidden_requests: 'Hidden Requests',
  };
  
  const tabName = tabNames[tab];
  
  if (tab === 'hidden_requests') {
    // Hidden requests requires special navigation
    const result = await d.executeJS(`
      (function() {
        var els = document.querySelectorAll('a, div[role="button"], span');
        for (var i = 0; i < els.length; i++) {
          if ((els[i].innerText || '').includes('Hidden Requests')) {
            els[i].click();
            return 'clicked';
          }
        }
        return 'not_found';
      })()
    `);
    await d.wait(2000);
    return result === 'clicked';
  }
  
  const result = await d.executeJS(`
    (function() {
      var tabs = document.querySelectorAll('[role="tab"]');
      for (var i = 0; i < tabs.length; i++) {
        if (tabs[i].innerText.includes('${tabName}')) {
          tabs[i].click();
          return 'clicked';
        }
      }
      return 'not_found';
    })()
  `);
  
  await d.wait(2000);
  return result === 'clicked';
}

/**
 * Click on a conversation by username.
 */
export async function openConversation(username: string, driver?: SafariDriver): Promise<boolean> {
  const d = driver || getDefaultDriver();
  
  const result = await d.executeJS(`
    (function() {
      var imgs = document.querySelectorAll('img[alt*="profile picture"]');
      for (var i = 0; i < imgs.length; i++) {
        var alt = imgs[i].getAttribute('alt') || '';
        if (alt.toLowerCase().includes('${username.toLowerCase()}')) {
          var container = imgs[i].closest('div[role="button"]') || 
                          imgs[i].closest('a') || 
                          imgs[i].parentElement.parentElement;
          if (container) {
            container.click();
            return 'clicked';
          }
        }
      }
      
      // Fallback: search by username text
      var spans = document.querySelectorAll('span');
      for (var j = 0; j < spans.length; j++) {
        if ((spans[j].innerText || '').toLowerCase() === '${username.toLowerCase()}') {
          var parent = spans[j].closest('div[role="button"]') || spans[j].closest('a');
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
      var msgEls = document.querySelectorAll('div[role="row"], div[class*="message"]');
      
      msgEls.forEach(function(el) {
        var text = el.innerText || '';
        if (text.length > 0 && text.length < 2000) {
          // Determine if outbound by position/styling
          var rect = el.getBoundingClientRect();
          var isRight = rect.left > (window.innerWidth / 2);
          
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
  
  // Find message input
  const inputFound = await d.executeJS(`
    (function() {
      var input = document.querySelector('textarea[placeholder*="Message"]') ||
                  document.querySelector('div[contenteditable="true"][role="textbox"]') ||
                  document.querySelector('[aria-label*="Message"]');
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
  
  // Type message
  const escaped = text.replace(/'/g, "\\'").replace(/"/g, '\\"').replace(/\n/g, '\\n');
  
  await d.executeJS(`
    (function() {
      var input = document.querySelector('textarea[placeholder*="Message"]') ||
                  document.querySelector('div[contenteditable="true"][role="textbox"]');
      if (input) {
        if (input.tagName === 'TEXTAREA') {
          input.value = '${escaped}';
          input.dispatchEvent(new Event('input', { bubbles: true }));
        } else {
          input.innerText = '${escaped}';
          input.dispatchEvent(new InputEvent('input', { bubbles: true }));
        }
        return 'typed';
      }
      return 'failed';
    })()
  `);
  
  await d.wait(500);
  
  // Click send button
  const sendResult = await d.executeJS(`
    (function() {
      // Look for send button
      var btns = document.querySelectorAll('button, div[role="button"]');
      for (var i = 0; i < btns.length; i++) {
        var text = (btns[i].innerText || '').toLowerCase();
        var label = (btns[i].getAttribute('aria-label') || '').toLowerCase();
        if (text === 'send' || label.includes('send')) {
          btns[i].click();
          return 'sent';
        }
      }
      
      // Fallback: press Enter
      var input = document.querySelector('textarea[placeholder*="Message"]') ||
                  document.querySelector('div[contenteditable="true"][role="textbox"]');
      if (input) {
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
        return 'sent_enter';
      }
      
      return 'no_send_button';
    })()
  `);
  
  if (sendResult === 'sent' || sendResult === 'sent_enter') {
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
      var btn = document.querySelector('[aria-label*="New message"]') ||
                document.querySelector('svg[aria-label*="New message"]')?.closest('div[role="button"]');
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
      var input = document.querySelector('input[placeholder*="Search"]') ||
                  document.querySelector('input[name="queryBox"]');
      if (input) {
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
      var results = document.querySelectorAll('div[role="button"]');
      for (var i = 0; i < results.length; i++) {
        if ((results[i].innerText || '').toLowerCase().includes('${username.toLowerCase()}')) {
          results[i].click();
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
  
  // Click Next/Chat button
  await d.executeJS(`
    (function() {
      var btns = document.querySelectorAll('button, div[role="button"]');
      for (var i = 0; i < btns.length; i++) {
        var text = (btns[i].innerText || '').toLowerCase();
        if (text === 'next' || text === 'chat') {
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
 * Get all conversations from all tabs.
 */
export async function getAllConversations(driver?: SafariDriver): Promise<Record<DMTab, DMConversation[]>> {
  const d = driver || getDefaultDriver();
  
  await navigateToInbox(d);
  
  const results: Record<DMTab, DMConversation[]> = {
    primary: [],
    general: [],
    requests: [],
    hidden_requests: [],
  };
  
  const tabs: DMTab[] = ['primary', 'general', 'requests'];
  
  for (const tab of tabs) {
    await switchTab(tab, d);
    results[tab] = await listConversations(d);
  }
  
  // Try hidden requests
  await switchTab('hidden_requests', d);
  results.hidden_requests = await listConversations(d);
  
  return results;
}
