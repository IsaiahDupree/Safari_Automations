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

// Thread ID cache: username → threadId
// Once discovered, thread-based sending is the most reliable method.
const threadCache = new Map<string, string>();

/**
 * Register a known username → threadId mapping.
 */
export function registerThread(username: string, threadId: string): void {
  threadCache.set(username.toLowerCase(), threadId);
}

/**
 * Look up a cached threadId for a username.
 */
export function getThreadId(username: string): string | undefined {
  return threadCache.get(username.toLowerCase());
}

/**
 * Get all cached thread mappings.
 */
export function getAllThreads(): Record<string, string> {
  return Object.fromEntries(threadCache);
}

/**
 * Extract threadId from current Safari URL if on a /direct/t/ page.
 */
async function captureThreadId(driver: SafariDriver): Promise<string | undefined> {
  const url = await driver.getCurrentUrl();
  const match = url.match(/\/direct\/t\/(\d+)/);
  return match ? match[1] : undefined;
}

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
 * Captures threadId from /direct/t/{id} links for reliable DM sending.
 */
export async function listConversations(driver?: SafariDriver): Promise<DMConversation[]> {
  const d = driver || getDefaultDriver();

  // Wait for conversation list to render (Instagram SPA needs time after navigation)
  await d.wait(2000);

  const result = await d.executeJS(`
    (function() {
      var conversations = [];
      var seen = {};
      var SKIP = ['Hidden requests','Message requests','General','Primary','Requests','Notes'];

      // Strategy 1 (2025 Instagram): img[alt="user-profile-picture"] — generic alt, traverse up for spans
      // Confirmed via live DOM inspection: Instagram no longer puts username in img alt.
      // Conversations are rows identified by this exact alt text; spans above contain the name + preview.
      var imgs = document.querySelectorAll('img[alt="user-profile-picture"]');
      imgs.forEach(function(img) {
        var el = img;
        var texts = [];
        for (var j = 0; j < 12; j++) {
          el = el.parentElement;
          if (!el) break;
          var spans = el.querySelectorAll('span');
          for (var k = 0; k < spans.length; k++) {
            var t = (spans[k].innerText || '').trim();
            if (t.length > 1 && t.length < 100 && spans[k].children.length === 0) {
              if (texts.indexOf(t) === -1) texts.push(t);
            }
          }
          if (texts.length >= 2) break;
        }
        if (texts.length === 0) return;
        var username = texts[0];
        if (!username || username.length < 2 || seen[username]) return;
        if (SKIP.indexOf(username) !== -1) return;
        seen[username] = true;
        var lastMsg = texts.length > 1 ? texts[1] : '';
        // Strip "You: " prefix from outbound preview
        lastMsg = lastMsg.replace(/^You:\\s*/i, '');
        conversations.push(JSON.stringify({ username: username, threadId: '', lastMessage: lastMsg.substring(0, 100) }));
      });

      // Strategy 2: Legacy — a[href*="/direct/t/"] (still works in some Instagram versions)
      if (conversations.length === 0) {
        var links = document.querySelectorAll('a[href*="/direct/t/"]');
        links.forEach(function(link) {
          var href = link.getAttribute('href') || '';
          var match = href.match(/\\/direct\\/t\\/([0-9]+)/);
          var threadId = match ? match[1] : '';
          var spans = link.querySelectorAll('span');
          var texts2 = [];
          for (var i = 0; i < spans.length; i++) {
            var t = (spans[i].innerText || '').trim();
            if (t.length > 1 && t.length < 80 && spans[i].children.length === 0) texts2.push(t);
          }
          if (texts2.length === 0) return;
          var username = texts2[0];
          if (!username || seen[username]) return;
          seen[username] = true;
          conversations.push(JSON.stringify({ username: username, threadId: threadId, lastMessage: (texts2[1]||'').substring(0,100) }));
        });
      }

      // Strategy 3: aria-label on conversation containers
      if (conversations.length === 0) {
        var labeled = document.querySelectorAll('[aria-label*="Conversation with"]');
        labeled.forEach(function(el) {
          var username = (el.getAttribute('aria-label') || '').replace(/^Conversation with /i, '').trim();
          if (!username || username.length < 2 || seen[username]) return;
          seen[username] = true;
          conversations.push(JSON.stringify({ username: username, threadId: '', lastMessage: '' }));
        });
      }

      return '[' + conversations.slice(0, 50).join(',') + ']';
    })()
  `);

  try {
    const parsed = JSON.parse(result || '[]');
    return parsed as DMConversation[];
  } catch (e) {
    console.error('[listConversations] JSON parse error:', e, 'raw:', result?.substring(0, 200));
    return [];
  }
}

/**
 * Send a DM by navigating directly to a thread URL.
 * Most reliable Instagram DM method — no search or profile navigation needed.
 */
export async function sendDMToThread(
  threadId: string,
  message: string,
  driver?: SafariDriver
): Promise<SendMessageResult> {
  const d = driver || getDefaultDriver();
  
  const threadUrl = `https://www.instagram.com/direct/t/${threadId}`;
  const navOk = await d.navigateTo(threadUrl);
  if (!navOk) return { success: false, error: 'Failed to navigate to thread' };
  await d.wait(3000);
  
  // Verify we're in a DM thread
  const pageCheck = await d.executeJS(`
    (function() {
      if (location.href.includes('/direct/t/')) return 'thread';
      if (location.href.includes('/accounts/login')) return 'not_logged_in';
      return 'unknown_' + location.href;
    })()
  `);
  
  if (pageCheck === 'not_logged_in') {
    return { success: false, error: 'Not logged in to Instagram' };
  }
  if (pageCheck !== 'thread') {
    return { success: false, error: 'Did not reach thread page: ' + pageCheck };
  }
  
  // Wait for message input to appear
  const inputReady = await d.waitForElement(
    'div[contenteditable="true"][role="textbox"]',
    5000
  );
  if (!inputReady) {
    // Try alternate selector
    const altReady = await d.waitForElement('textarea[placeholder*="Message"]', 3000);
    if (!altReady) {
      return { success: false, error: 'Message input not found in thread' };
    }
  }
  
  // Verify recipient identity from thread header
  const recipientCheck = await d.executeJS(`
    (function() {
      // Strategy 1: Look for profile picture alt text in header
      var imgs = document.querySelectorAll('img[alt*="profile picture"]');
      for (var i = 0; i < imgs.length; i++) {
        var r = imgs[i].getBoundingClientRect();
        if (r.y < 80) {
          return (imgs[i].alt || '').replace("'s profile picture", '').trim();
        }
      }
      // Strategy 2: Look for username-like text in header area
      var spans = document.querySelectorAll('span, a');
      for (var j = 0; j < spans.length; j++) {
        var r2 = spans[j].getBoundingClientRect();
        var t = (spans[j].textContent || '').trim();
        if (r2.width > 0 && r2.y < 70 && r2.y > 10 && t.length > 2 && t.length < 40 && t !== 'Instagram' && !t.includes('Direct')) {
          return t;
        }
      }
      return '';
    })()
  `);
  
  // Send via the standard sendMessage (uses OS-level keystrokes)
  const result = await sendMessage(message, d);
  
  if (result.success) {
    // Post-send verification: check message text appeared in conversation
    await d.wait(2000);
    const snippet = message.substring(0, 30).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const verified = await d.executeJS(`
      (function() {
        return document.body.innerText.includes('${snippet}') ? 'yes' : 'no';
      })()
    `);
    return {
      ...result,
      verified: verified === 'yes',
      verifiedRecipient: recipientCheck || undefined,
    };
  }
  return result;
}

/**
 * Switch to a specific DM tab.
 */
export async function switchTab(tab: DMTab, driver?: SafariDriver): Promise<boolean> {
  const d = driver || getDefaultDriver();

  // Use direct URL navigation — most reliable across Instagram DOM versions
  const tabUrls: Record<DMTab, string> = {
    primary:         'https://www.instagram.com/direct/inbox/',
    general:         'https://www.instagram.com/direct/general/',
    requests:        'https://www.instagram.com/direct/requests/',
    hidden_requests: 'https://www.instagram.com/direct/requests/hidden/',
  };

  const ok = await d.navigateTo(tabUrls[tab]);
  if (ok) {
    await d.wait(2500);
    return true;
  }

  // Fallback: click the tab in the UI
  const tabLabels: Record<DMTab, string[]> = {
    primary:         ['Primary'],
    general:         ['General'],
    requests:        ['Requests', 'Message Requests'],
    hidden_requests: ['Hidden Requests', 'Hidden'],
  };
  const labels = tabLabels[tab];
  const result = await d.executeJS(`
    (function() {
      var labels = ${JSON.stringify(labels)};
      var els = document.querySelectorAll('[role="tab"], a, div[role="button"], span');
      for (var i = 0; i < els.length; i++) {
        var text = (els[i].innerText || '').trim();
        for (var j = 0; j < labels.length; j++) {
          if (text === labels[j] || text.includes(labels[j])) {
            els[i].click();
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
 * Click on a conversation by username.
 */
export async function openConversation(username: string, driver?: SafariDriver): Promise<boolean> {
  const d = driver || getDefaultDriver();

  // Primary: navigate directly to cached thread URL (most reliable)
  const cachedThreadId = getThreadId(username);
  if (cachedThreadId) {
    const ok = await d.navigateTo(`https://www.instagram.com/direct/t/${cachedThreadId}`);
    if (ok) {
      await d.wait(2000);
      return true;
    }
  }

  const cleanUser = username.toLowerCase().replace('@', '');
  const result = await d.executeJS(`
    (function() {
      var cleanUser = '${cleanUser}';

      // Strategy 1 (2025 Instagram): find img[alt="user-profile-picture"] whose sibling spans
      // contain the username, then click its containing row div.
      var imgs = document.querySelectorAll('img[alt="user-profile-picture"]');
      for (var i = 0; i < imgs.length; i++) {
        var el = imgs[i];
        var rowEl = null;
        for (var j = 0; j < 12; j++) {
          el = el.parentElement;
          if (!el) break;
          var spans = el.querySelectorAll('span');
          for (var k = 0; k < spans.length; k++) {
            var t = (spans[k].innerText || '').toLowerCase().trim();
            if (t === cleanUser && spans[k].children.length === 0) {
              rowEl = el;
              break;
            }
          }
          if (rowEl) break;
        }
        if (rowEl) {
          rowEl.click();
          return 'clicked';
        }
      }

      // Strategy 2: Legacy — a[href*="/direct/t/"] containing the username
      var links = document.querySelectorAll('a[href*="/direct/t/"]');
      for (var li = 0; li < links.length; li++) {
        if ((links[li].innerText || '').toLowerCase().includes(cleanUser)) {
          links[li].click();
          return 'clicked';
        }
      }

      // Strategy 3: any span with exact username text — click nearest interactive parent
      var spans = document.querySelectorAll('span');
      for (var s = 0; s < spans.length; s++) {
        if ((spans[s].innerText || '').toLowerCase().trim() === cleanUser && spans[s].children.length === 0) {
          var parent = spans[s].parentElement;
          for (var p = 0; p < 8; p++) {
            if (!parent) break;
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
      var seen = {};
      var W = window.innerWidth;

      // Find the message thread container — try common 2025 Instagram selectors
      var container = document.querySelector('[role="log"]') ||
                      document.querySelector('[aria-label*="Message thread"]') ||
                      document.querySelector('[aria-label*="Conversation"]') ||
                      document.querySelector('main') ||
                      document.body;

      // Collect all leaf text nodes in message bubbles
      // Messages in Instagram 2025 are in div[dir="auto"] inside the thread
      var bubbles = container.querySelectorAll('div[dir="auto"]');
      if (bubbles.length === 0) {
        // Fallback: any row/cell with short text content
        bubbles = container.querySelectorAll('[role="row"], [role="gridcell"]');
      }

      bubbles.forEach(function(el) {
        var text = (el.innerText || '').trim();
        if (!text || text.length === 0 || text.length > 2000) return;
        if (seen[text]) return;

        // Skip navigation/UI text — must look like a message (>3 chars, not all caps label)
        if (text.length <= 3) return;
        if (text === text.toUpperCase() && text.length < 20) return; // skip UI labels

        seen[text] = true;

        var rect = el.getBoundingClientRect();
        // outbound messages are on the right half of the screen
        var isRight = rect.width > 0 && (rect.left + rect.width / 2) > (W * 0.55);

        var timestamp = '';
        var timeEl = el.querySelector('time') || el.closest('[data-scope]')?.querySelector('time');
        if (timeEl) {
          timestamp = timeEl.getAttribute('datetime') || timeEl.innerText || '';
        }

        messages.push(JSON.stringify({
          text: text.substring(0, 500),
          isOutbound: isRight,
          messageType: 'text',
          timestamp: timestamp,
        }));
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
 * Accept a message request from a specific user.
 * Navigates to requests tab, finds the conversation, and clicks Accept.
 */
export async function acceptMessageRequest(username: string, driver?: SafariDriver): Promise<boolean> {
  const d = driver || getDefaultDriver();

  // Navigate to requests tab
  await d.navigateTo('https://www.instagram.com/direct/requests/');
  await d.wait(3000);

  // Find and open the conversation
  const opened = await openConversation(username, d);
  if (!opened) return false;

  await d.wait(2000);

  // Click Accept button
  const result = await d.executeJS(`
    (function() {
      var buttons = document.querySelectorAll('button, div[role="button"]');
      for (var i = 0; i < buttons.length; i++) {
        var text = (buttons[i].innerText || '').toLowerCase();
        if (text === 'accept' || text.includes('accept')) {
          buttons[i].click();
          return 'accepted';
        }
      }
      return 'not_found';
    })()
  `);

  await d.wait(1500);
  return result === 'accepted';
}

/**
 * Decline a message request from a specific user.
 * Navigates to requests tab, finds the conversation, and clicks Decline/Delete.
 */
export async function declineMessageRequest(username: string, driver?: SafariDriver): Promise<boolean> {
  const d = driver || getDefaultDriver();

  // Navigate to requests tab
  await d.navigateTo('https://www.instagram.com/direct/requests/');
  await d.wait(3000);

  // Find and open the conversation
  const opened = await openConversation(username, d);
  if (!opened) return false;

  await d.wait(2000);

  // Click Decline/Delete button
  const result = await d.executeJS(`
    (function() {
      var buttons = document.querySelectorAll('button, div[role="button"]');
      for (var i = 0; i < buttons.length; i++) {
        var text = (buttons[i].innerText || '').toLowerCase();
        if (text === 'decline' || text === 'delete' || text.includes('decline')) {
          buttons[i].click();
          return 'declined';
        }
      }
      return 'not_found';
    })()
  `);

  await d.wait(1500);
  return result === 'declined';
}

/**
 * Detect if Instagram is showing a rate limit or action blocked banner.
 * Returns true if rate limited, false otherwise.
 */
export async function detectRateLimitBanner(driver?: SafariDriver): Promise<boolean> {
  const d = driver || getDefaultDriver();

  const result = await d.executeJS(`
    (function() {
      var bodyText = document.body.innerText.toLowerCase();
      if (bodyText.includes('action blocked') ||
          bodyText.includes('try again later') ||
          bodyText.includes('temporarily blocked') ||
          bodyText.includes('slow down') ||
          bodyText.includes('too many requests')) {
        return 'rate_limited';
      }
      return 'ok';
    })()
  `);

  return result === 'rate_limited';
}

/**
 * Send a DM to the current open conversation.
 * Uses OS-level keystrokes for React contenteditable compatibility.
 */
export async function sendMessage(text: string, driver?: SafariDriver): Promise<SendMessageResult> {
  const d = driver || getDefaultDriver();

  // Check for rate limit banner before sending
  const isRateLimited = await detectRateLimitBanner(d);
  if (isRateLimited) {
    return { success: false, rateLimited: true, error: 'Instagram action blocked - rate limited' };
  }
  
  // Focus message input — try selectors one at a time (comma selectors break through AppleScript)
  const selectors = [
    'div[contenteditable="true"][role="textbox"]',
    'textarea[placeholder*="Message"]',
    '[aria-label*="Message"]',
  ];
  
  let inputFound = false;
  for (const sel of selectors) {
    inputFound = await d.focusElement(sel);
    if (inputFound) break;
  }
  
  if (!inputFound) {
    return { success: false, error: 'Message input not found' };
  }
  
  await d.wait(500);
  
  // Type via OS-level keystrokes (works with React)
  const typed = await d.typeViaKeystrokes(text);
  if (!typed) {
    return { success: false, error: 'Failed to type message via keystrokes' };
  }
  
  await d.wait(500);
  
  // Send via Enter key (OS-level)
  const sent = await d.pressEnter();
  if (!sent) {
    return { success: false, error: 'Failed to press Enter to send' };
  }
  
  await d.wait(1000);
  return { success: true };
}

/**
 * Start a new conversation with a user via the New Message dialog.
 * Uses OS-level keystrokes for search input.
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
  
  // Focus search input then type via OS keystrokes
  const searchFocused = await d.focusElement('input[placeholder*="Search"], input[name="queryBox"]');
  if (!searchFocused) return false;
  
  await d.wait(300);
  await d.typeViaKeystrokes(username);
  await d.wait(2000);
  
  // Click on first matching result
  const selectResult = await d.executeJS(`
    (function() {
      var results = document.querySelectorAll('div[role="button"], div[role="listitem"]');
      for (var i = 0; i < results.length; i++) {
        if ((results[i].innerText || '').toLowerCase().includes('${username.toLowerCase()}')) {
          results[i].click();
          return 'selected';
        }
      }
      return 'not_found';
    })()
  `);
  
  if (selectResult !== 'selected') return false;
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
 * Send a DM by navigating to a user's profile first (profile-to-DM flow).
 * Most reliable method — works even if user isn't in conversation list.
 */
export async function sendDMFromProfile(
  username: string,
  message: string,
  driver?: SafariDriver
): Promise<SendMessageResult> {
  const d = driver || getDefaultDriver();
  
  // Navigate to profile
  const profileUrl = `https://www.instagram.com/${username.replace('@', '')}/`;
  const navOk = await d.navigateTo(profileUrl);
  if (!navOk) return { success: false, error: 'Failed to navigate to profile' };
  await d.wait(3000);
  
  // Check profile loaded
  const profileStatus = await d.executeJS(`
    (function() {
      if (document.body.innerText.includes("Sorry, this page")) return 'not_found';
      var btns = document.querySelectorAll('div[role="button"], button');
      for (var i = 0; i < btns.length; i++) {
        if (btns[i].textContent.trim() === 'Message') return 'ready';
      }
      return 'no_message_btn';
    })()
  `);
  
  if (profileStatus === 'not_found') {
    return { success: false, error: `Profile @${username} not found` };
  }
  if (profileStatus === 'no_message_btn') {
    return { success: false, error: 'No Message button on profile (may need to follow first)' };
  }
  
  // Click Message button
  const clicked = await d.executeJS(`
    (function() {
      var btns = document.querySelectorAll('div[role="button"], button');
      for (var i = 0; i < btns.length; i++) {
        if (btns[i].textContent.trim() === 'Message') {
          btns[i].click();
          return 'clicked';
        }
      }
      return 'not_found';
    })()
  `);
  
  if (clicked !== 'clicked') {
    return { success: false, error: 'Could not click Message button' };
  }
  
  await d.wait(3000);
  
  // Wait for message input
  const inputReady = await d.waitForElement(
    'div[contenteditable="true"][role="textbox"], textarea[placeholder*="Message"]',
    5000
  );
  
  if (!inputReady) {
    return { success: false, error: 'DM composer did not open' };
  }
  
  // Capture threadId from URL for future use
  const threadId = await captureThreadId(d);
  if (threadId) {
    registerThread(username, threadId);
  }
  
  // Send via the standard sendMessage (which uses keystrokes)
  const result = await sendMessage(message, d);
  
  if (result.success) {
    await d.wait(2000);
    const snippet = message.substring(0, 30).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const verified = await d.executeJS(`
      (function() {
        return document.body.innerText.includes('${snippet}') ? 'yes' : 'no';
      })()
    `);
    return {
      ...result,
      verified: verified === 'yes',
      verifiedRecipient: username,
    };
  }
  return result;
}

/**
 * Smart DM send: tries thread URL first (if cached), then profile-to-DM.
 * This is the recommended single entry point for sending a DM by username.
 */
export async function smartSendDM(
  username: string,
  message: string,
  driver?: SafariDriver
): Promise<SendMessageResult & { method: string }> {
  const d = driver || getDefaultDriver();
  const cleanUsername = username.replace('@', '').toLowerCase();
  
  // Check thread cache first
  const cachedThreadId = getThreadId(cleanUsername);
  if (cachedThreadId) {
    const result = await sendDMToThread(cachedThreadId, message, d);
    if (result.success) {
      return { ...result, method: 'thread-url' };
    }
  }
  
  // Fall back to profile-to-DM
  const result = await sendDMFromProfile(cleanUsername, message, d);
  return { ...result, method: 'profile-to-dm' };
}

/**
 * Scroll the conversation list until no new conversations load, then list all.
 * Guarantees every visible chat is captured, not just the top ~30.
 */
export async function scrollAndListAllConversations(driver?: SafariDriver, maxScrolls = 30): Promise<DMConversation[]> {
  const d = driver || getDefaultDriver();
  let prevCount = -1;
  let stableRounds = 0;

  for (let i = 0; i < maxScrolls; i++) {
    // Scroll the Thread list container
    await d.executeJS(`
      (function() {
        var c = document.querySelector('[aria-label="Thread list"]') ||
                document.querySelector('div[role="list"]') ||
                document.querySelector('div[class*="inbox"]');
        if (c) { c.scrollTop += 800; }
        else { window.scrollBy(0, 800); }
      })()
    `);
    await d.wait(1200);

    const countRaw = await d.executeJS(`
      (function() {
        var links = document.querySelectorAll('a[href*="/direct/t/"]');
        var rows = document.querySelector('[aria-label="Thread list"]');
        return String(links.length || (rows ? rows.querySelectorAll('span').length : 0));
      })()
    `);
    const count = parseInt(countRaw) || 0;
    if (count === prevCount) {
      stableRounds++;
      if (stableRounds >= 2) break; // stable for 2 consecutive scrolls — we're at the bottom
    } else {
      stableRounds = 0;
    }
    prevCount = count;
  }

  return listConversations(d);
}

/**
 * Scroll up in the current open conversation to load full message history,
 * then read all messages.
 */
export async function readAllMessages(driver?: SafariDriver, maxScrolls = 20): Promise<DMMessage[]> {
  const d = driver || getDefaultDriver();
  let prevCount = -1;
  let stableRounds = 0;

  for (let i = 0; i < maxScrolls; i++) {
    await d.executeJS(`
      (function() {
        var pane = document.querySelector('[role="main"] [class*="messages"], div[class*="MessageList"]') ||
                   document.querySelector('[role="main"]');
        if (pane) { pane.scrollTop -= 1200; }
        else { window.scrollBy(0, -1200); }
      })()
    `);
    await d.wait(1000);

    const countRaw = await d.executeJS(`
      (function() {
        return String(document.querySelectorAll('div[role="row"], div[class*="message"]').length);
      })()
    `);
    const count = parseInt(countRaw) || 0;
    if (count === prevCount) {
      stableRounds++;
      if (stableRounds >= 2) break;
    } else {
      stableRounds = 0;
    }
    prevCount = count;
  }

  return readMessages(9999, d);
}

/**
 * Fetch contact info from a user's Instagram profile page.
 * Returns bio, follower count, following count, post count, full name.
 */
export async function enrichContact(username: string, driver?: SafariDriver): Promise<{
  fullName: string; bio: string; followers: string; following: string; posts: string; isPrivate: boolean;
}> {
  const d = driver || getDefaultDriver();
  const profileUrl = `https://www.instagram.com/${username.replace('@', '')}/`;
  const currentUrl = await d.getCurrentUrl();
  if (!currentUrl.includes(`/${username.replace('@', '')}/`)) {
    await d.navigateTo(profileUrl);
    await d.wait(6000); // full page reload — Instagram needs time to populate meta tags
  } else {
    await d.wait(1000); // already on profile, just wait for any async updates
  }

  const raw = await d.executeJS(`
    (function() {
      // --- Stats from meta description (most reliable across all login states) ---
      var descMeta = '';
      var metas = document.querySelectorAll('meta[name="description"], meta[property="og:description"]');
      for (var i = 0; i < metas.length; i++) {
        var c = metas[i].getAttribute('content') || '';
        if (c.match(/Followers/i)) { descMeta = c; break; }
      }
      var fMatch  = descMeta.match(/([\\d.,KkMm]+)\\s*Followers/i);
      var ngMatch = descMeta.match(/([\\d.,KkMm]+)\\s*Following/i);
      var pMatch  = descMeta.match(/([\\d.,KkMm]+)\\s*Posts/i);

      // --- Full name from page title: "Sarah Ashley (@saraheashley) • Instagram..." ---
      var fullName = '';
      var titleEl = document.querySelector('title');
      var titleText = titleEl ? titleEl.innerText : document.title;
      var titleMatch = titleText.match(/^(.+?)\\s*\\(@/);
      if (titleMatch) { fullName = titleMatch[1].trim(); }
      if (!fullName) {
        // Fallback: h1, h2, og:title meta
        var ogTitle = document.querySelector('meta[property="og:title"]');
        if (ogTitle) {
          var ogMatch = (ogTitle.getAttribute('content') || '').match(/^(.+?)\\s*\\(@/);
          if (ogMatch) fullName = ogMatch[1].trim();
        }
      }
      if (!fullName) {
        var h1 = document.querySelector('h1');
        if (h1 && h1.innerText && h1.innerText.length > 1) fullName = h1.innerText.trim();
      }

      // --- Bio: try multiple selectors ---
      var bio = '';
      // span._ap3a is a common Instagram bio span class
      var bioEl = document.querySelector('span._ap3a') ||
                  document.querySelector('h1 + div span') ||
                  document.querySelector('[data-testid="user-bio"]');
      if (bioEl) {
        bio = (bioEl.innerText || '').trim();
      }
      // Fallback: extract from meta description after the Instagram handle
      if (!bio && descMeta) {
        var bioMatch = descMeta.match(/on Instagram:\\s*"?(.+?)(?:"|$)/);
        if (bioMatch) bio = bioMatch[1].trim();
      }

      // --- Private account check ---
      var bodyText = document.body ? (document.body.innerText || '') : '';
      var isPrivate = bodyText.includes('This account is private') ||
                      !!document.querySelector('[class*="PrivateAccount"]');

      return JSON.stringify({
        fullName:  fullName,
        bio:       bio.substring(0, 300),
        followers: fMatch  ? fMatch[1]  : '',
        following: ngMatch ? ngMatch[1] : '',
        posts:     pMatch  ? pMatch[1]  : '',
        isPrivate: isPrivate,
      });
    })()
  `);
  try {
    return JSON.parse(raw);
  } catch {
    return { fullName: '', bio: '', followers: '', following: '', posts: '', isPrivate: false };
  }
}

/**
 * Get unread conversations by detecting visual unread indicators.
 * Returns count and list of conversations with unread messages.
 */
export async function getUnreadConversations(driver?: SafariDriver): Promise<{ count: number; conversations: DMConversation[] }> {
  const d = driver || getDefaultDriver();

  const result = await d.executeJS(`
    (function() {
      var unreadConvs = [];
      var seen = {};

      // Look for unread badges/indicators
      var badges = document.querySelectorAll('[class*="unread"], [class*="badge"], [class*="dot"]');
      var unreadCount = 0;

      badges.forEach(function(badge) {
        // Verify this is actually an unread indicator (small, circular, positioned)
        var rect = badge.getBoundingClientRect();
        if (rect.width > 0 && rect.width < 30 && rect.height > 0 && rect.height < 30) {
          unreadCount++;

          // Find the conversation row containing this badge
          var container = badge;
          for (var i = 0; i < 10; i++) {
            container = container.parentElement;
            if (!container) break;

            var link = container.querySelector('a[href*="/direct/t/"]');
            if (link) {
              var href = link.getAttribute('href') || '';
              var match = href.match(/\\/direct\\/t\\/([0-9]+)/);
              var threadId = match ? match[1] : '';

              var img = container.querySelector('img[alt*="profile picture"]');
              var username = '';
              if (img) {
                username = (img.getAttribute('alt') || '').replace("'s profile picture", '').trim();
              }
              if (!username) {
                var span = container.querySelector('span[dir="auto"]');
                if (span) username = span.textContent.trim();
              }

              if (username && !seen[username]) {
                seen[username] = true;
                var lastMsg = '';
                var spans = container.querySelectorAll('span');
                for (var j = spans.length - 1; j >= 0; j--) {
                  var t = (spans[j].textContent || '').trim();
                  if (t.length > 5 && t !== username && t.length < 200) {
                    lastMsg = t;
                    break;
                  }
                }
                unreadConvs.push(JSON.stringify({
                  username: username,
                  threadId: threadId,
                  lastMessage: lastMsg.substring(0, 100)
                }));
              }
              break;
            }
          }
        }
      });

      return JSON.stringify({
        count: unreadCount,
        conversations: '[' + unreadConvs.join(',') + ']'
      });
    })()
  `);

  try {
    const parsed = JSON.parse(result || '{"count":0,"conversations":"[]"}');
    const conversations = JSON.parse(parsed.conversations || '[]');
    return { count: parsed.count || 0, conversations };
  } catch {
    return { count: 0, conversations: [] };
  }
}

/**
 * Get all conversations from all tabs by navigating directly to each inbox URL.
 * 2025+ Instagram removed [role="tab"] elements — each section is a separate URL.
 * Scrolls each section until stable before scraping.
 */
export async function getAllConversations(driver?: SafariDriver): Promise<Record<DMTab, DMConversation[]>> {
  const d = driver || getDefaultDriver();

  const TAB_URLS: Record<DMTab, string> = {
    primary:         'https://www.instagram.com/direct/inbox/',
    general:         'https://www.instagram.com/direct/general/',
    requests:        'https://www.instagram.com/direct/requests/',
    hidden_requests: 'https://www.instagram.com/direct/requests/hidden/',
  };

  const results: Record<DMTab, DMConversation[]> = {
    primary: [],
    general: [],
    requests: [],
    hidden_requests: [],
  };

  for (const tab of (['primary', 'general', 'requests', 'hidden_requests'] as DMTab[])) {
    await d.navigateTo(TAB_URLS[tab]);
    await d.wait(3000);
    results[tab] = await scrollAndListAllConversations(d, 20);
  }

  return results;
}
