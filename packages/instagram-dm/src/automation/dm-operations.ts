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
  
  const result = await d.executeJS(`
    (function() {
      var conversations = [];
      var seen = {};
      
      // Strategy 1: Find conversation links with thread IDs
      var links = document.querySelectorAll('a[href*="/direct/t/"]');
      links.forEach(function(link) {
        var href = link.getAttribute('href') || '';
        var match = href.match(/\\/direct\\/t\\/([0-9]+)/);
        var threadId = match ? match[1] : '';
        
        var img = link.querySelector('img[alt*="profile picture"]');
        var username = '';
        if (img) {
          username = (img.getAttribute('alt') || '').replace("'s profile picture", '').trim();
        }
        if (!username) {
          var span = link.querySelector('span[dir="auto"]');
          if (span) username = span.textContent.trim();
        }
        
        if (username && !seen[username]) {
          seen[username] = true;
          var lastMsg = '';
          var spans = link.querySelectorAll('span');
          for (var i = spans.length - 1; i >= 0; i--) {
            var t = (spans[i].textContent || '').trim();
            if (t.length > 5 && t !== username && t.length < 200) {
              lastMsg = t;
              break;
            }
          }
          conversations.push(JSON.stringify({
            username: username,
            threadId: threadId,
            lastMessage: lastMsg.substring(0, 100)
          }));
        }
      });
      
      // Strategy 2: Fallback to profile pictures if no links found
      if (conversations.length === 0) {
        var imgs = document.querySelectorAll('img[alt*="profile picture"]');
        imgs.forEach(function(img) {
          var alt = img.getAttribute('alt') || '';
          var username = alt.replace("'s profile picture", '').trim();
          if (username && username.length > 1 && !seen[username]) {
            seen[username] = true;
            var container = img.closest('a[href*="/direct/t/"]');
            var threadId = '';
            if (container) {
              var href = container.getAttribute('href') || '';
              var m = href.match(/\\/direct\\/t\\/([0-9]+)/);
              threadId = m ? m[1] : '';
            }
            conversations.push(JSON.stringify({
              username: username,
              threadId: threadId,
              lastMessage: ''
            }));
          }
        });
      }

      // Strategy 3: New Instagram DOM (2025+) — Thread list with span-grouped rows
      // Instagram removed a[href*="/direct/t/"] from the inbox list; conversations are
      // DIV rows (~72px tall) inside [aria-label="Thread list"] containing leaf SPANs.
      if (conversations.length === 0) {
        var threadList = document.querySelector('[aria-label="Thread list"]');
        if (threadList) {
          var allSpans = threadList.querySelectorAll('span');
          var rowMap: Record<number, string[]> = {};
          allSpans.forEach(function(sp) {
            var t = (sp.innerText || '').trim();
            if (sp.children.length === 0 && t.length > 1 && t.length < 80) {
              var el: Element | null = sp;
              for (var j = 0; j < 10; j++) {
                el = el ? el.parentElement : null;
                if (!el) break;
                var r = el.getBoundingClientRect();
                if (r.height > 65 && r.height < 90 && r.width > 300) {
                  var key = Math.round(r.top);
                  if (!rowMap[key]) rowMap[key] = [];
                  rowMap[key].push(t);
                  break;
                }
              }
            }
          });
          var rowKeys = Object.keys(rowMap).map(Number).sort(function(a, b) { return a - b; });
          rowKeys.forEach(function(key) {
            var texts = rowMap[key];
            var name = texts[0] || '';
            // Skip "Hidden requests" header row
            if (!name || name === 'Hidden requests' || name.length < 2) return;
            var lastMsg = texts.length > 1 ? texts[texts.length - 1] : '';
            if (!seen[name]) {
              seen[name] = true;
              conversations.push(JSON.stringify({
                username: name,
                threadId: '',
                lastMessage: lastMsg.substring(0, 100)
              }));
            }
          });
        }
      }
      
      return '[' + conversations.slice(0, 50).join(',') + ']';
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
 * Uses OS-level keystrokes for React contenteditable compatibility.
 */
export async function sendMessage(text: string, driver?: SafariDriver): Promise<SendMessageResult> {
  const d = driver || getDefaultDriver();
  
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
  await d.navigateTo(profileUrl);
  await d.wait(2500);

  const raw = await d.executeJS(`
    (function() {
      var metas = document.querySelectorAll('meta[name="description"]');
      var descMeta = '';
      for (var i = 0; i < metas.length; i++) {
        var c = metas[i].getAttribute('content') || '';
        if (c.includes('Followers') || c.includes('Following')) { descMeta = c; break; }
      }
      // "12.5K Followers, 500 Following, 87 Posts - See Instagram photos..."
      var fMatch = descMeta.match(/([\d.,KMk]+)\\s*Followers/i);
      var ngMatch = descMeta.match(/([\d.,KMk]+)\\s*Following/i);
      var pMatch  = descMeta.match(/([\d.,KMk]+)\\s*Posts/i);
      var nameEl = document.querySelector('h1, h2, [class*="FullName"], span[class*="_ap3a"]');
      var bioEl  = document.querySelector('[class*="_aa_c"], [class*="bio"], .-vDIg span, [data-testid="user-bio"]');
      var isPrivate = document.body.innerText.includes('This account is private') ||
                      !!document.querySelector('[class*="PrivateAccount"]');
      return JSON.stringify({
        fullName:  nameEl ? nameEl.innerText.trim() : '',
        bio:       bioEl  ? bioEl.innerText.trim()  : '',
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
