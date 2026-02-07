/**
 * TikTok DM Operations
 * High-level DM automation functions
 */

import { SafariDriver } from './safari-driver.js';
import {
  DMConversation,
  DMMessage,
  SendMessageResult,
  NavigationResult,
  TIKTOK_SELECTORS,
  TIKTOK_URLS,
} from './types.js';

/**
 * Check if TikTok is showing an error page and click retry if found
 * Returns true if error was detected and retry was attempted
 */
export async function checkAndRetryError(driver: SafariDriver): Promise<boolean> {
  const result = await driver.executeScript(`
    (function() {
      var bodyText = document.body.innerText || '';
      var hasError = bodyText.includes('Page not available') || 
                     bodyText.includes('Sorry about that') ||
                     bodyText.includes('Something went wrong');
      
      if (hasError) {
        // Look for retry/try again button
        var buttons = document.querySelectorAll('button');
        for (var i = 0; i < buttons.length; i++) {
          var text = buttons[i].innerText.toLowerCase();
          if (text.includes('try again') || text.includes('retry') || text.includes('refresh')) {
            buttons[i].click();
            return 'retry_clicked';
          }
        }
        // Also check for div buttons
        var divBtns = document.querySelectorAll('div[role="button"]');
        for (var j = 0; j < divBtns.length; j++) {
          var divText = divBtns[j].innerText.toLowerCase();
          if (divText.includes('try again') || divText.includes('retry')) {
            divBtns[j].click();
            return 'retry_clicked';
          }
        }
        return 'error_no_button';
      }
      return 'no_error';
    })()
  `);
  
  if (result === 'retry_clicked') {
    await driver.wait(2000); // Wait for page to reload
    return true;
  }
  return result !== 'no_error';
}

/**
 * Detect if page has error state
 */
export async function hasErrorState(driver: SafariDriver): Promise<boolean> {
  const result = await driver.executeScript(`
    (function() {
      var bodyText = document.body.innerText || '';
      return bodyText.includes('Page not available') || 
             bodyText.includes('Sorry about that') ||
             bodyText.includes('Something went wrong') ||
             bodyText.includes('Page isn\\'t available');
    })()
  `);
  return result === 'true';
}

/**
 * Navigate to TikTok messages inbox
 */
export async function navigateToInbox(driver: SafariDriver): Promise<NavigationResult> {
  try {
    await driver.navigate(TIKTOK_URLS.messages);
    await driver.wait(2000);

    // Check for error page and retry if needed
    const hadError = await checkAndRetryError(driver);
    if (hadError) {
      await driver.wait(2000);
    }

    // Wait for conversation list to load
    const loaded = await driver.waitForElement(TIKTOK_SELECTORS.conversationList, 10000);
    
    if (!loaded) {
      // Check again for error state
      if (await hasErrorState(driver)) {
        await checkAndRetryError(driver);
        await driver.wait(2000);
      }
      
      // Try alternate check - maybe we're on messages but layout is different
      const isOnMessages = (await driver.getCurrentUrl()).includes('/messages');
      if (!isOnMessages) {
        return { success: false, error: 'Failed to load messages inbox' };
      }
    }

    return { 
      success: true, 
      currentUrl: await driver.getCurrentUrl() 
    };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

/**
 * List conversations in the inbox
 */
export async function listConversations(driver: SafariDriver): Promise<DMConversation[]> {
  const result = await driver.executeScript(`
    (function() {
      var conversations = [];
      var items = document.querySelectorAll('[data-e2e="chat-list-item"]');
      
      items.forEach(function(item) {
        var text = item.innerText.trim().split("\\n");
        var displayName = text[0] || 'Unknown';
        var lastMessage = text[1] ? text[1].substring(0, 100) : '';
        var timestamp = text[2] || '';
        
        // Check for unread indicator (badge or bold text)
        var unread = item.querySelector('[class*="Unread"], [class*="Badge"]') !== null;
        
        conversations.push({
          username: displayName,
          displayName: displayName,
          lastMessage: lastMessage,
          timestamp: timestamp,
          unread: unread
        });
      });
      
      return JSON.stringify(conversations);
    })()
  `);

  try {
    return JSON.parse(result) as DMConversation[];
  } catch {
    return [];
  }
}

/**
 * Open a specific conversation by username
 */
export async function openConversation(
  driver: SafariDriver,
  username: string
): Promise<NavigationResult> {
  // First, make sure we're in the inbox
  const url = await driver.getCurrentUrl();
  if (!url.includes('/messages')) {
    const navResult = await navigateToInbox(driver);
    if (!navResult.success) return navResult;
  }

  const escapedUsername = username.toLowerCase().replace(/"/g, '\\"');

  // Find and click the conversation using validated selector
  const clicked = await driver.executeScript(`
    (function() {
      var items = document.querySelectorAll('[data-e2e="chat-list-item"]');
      var targetUsername = "${escapedUsername}";
      
      for (var i = 0; i < items.length; i++) {
        var text = items[i].innerText.toLowerCase();
        if (text.includes(targetUsername)) {
          items[i].click();
          return 'clicked';
        }
      }
      return 'not_found';
    })()
  `);

  if (clicked !== 'clicked') {
    return { success: false, error: `Conversation with ${username} not found` };
  }

  await driver.wait(1500);
  return { success: true, currentUrl: await driver.getCurrentUrl() };
}

/**
 * Read messages from current conversation
 */
export async function readMessages(
  driver: SafariDriver,
  limit: number = 50
): Promise<DMMessage[]> {
  const result = await driver.executeScript(`
    (function() {
      var messages = [];
      var items = document.querySelectorAll('[data-e2e="chat-item"]');
      var limit = ${limit};
      
      for (var i = 0; i < Math.min(items.length, limit); i++) {
        var item = items[i];
        var content = item.innerText.trim();
        // Check for outgoing message indicators in class names
        var isMine = item.className.includes('Right') || 
                     item.className.includes('self') || 
                     item.className.includes('Self') ||
                     item.className.includes('outgoing');
        
        if (content) {
          messages.push({
            content: content.substring(0, 500),
            sender: isMine ? 'me' : 'them',
            type: 'text'
          });
        }
      }
      
      return JSON.stringify(messages);
    })()
  `);

  try {
    return JSON.parse(result) as DMMessage[];
  } catch {
    return [];
  }
}

/**
 * Send a message in the current conversation.
 * Uses OS-level keystrokes for React contenteditable compatibility.
 */
export async function sendMessage(
  driver: SafariDriver,
  message: string
): Promise<SendMessageResult> {
  try {
    // Focus message input — try selectors one at a time
    const selectors = [
      TIKTOK_SELECTORS.messageInputDraft,
      TIKTOK_SELECTORS.messageInputFallback,
      TIKTOK_SELECTORS.messageInputCE,
    ];
    let focusResult = false;
    for (const sel of selectors) {
      focusResult = await driver.focusElement(sel);
      if (focusResult) break;
    }

    if (!focusResult) {
      return { success: false, error: 'Could not find message input' };
    }

    await driver.wait(500);

    // Type via OS-level keystrokes (works with React)
    const typed = await driver.typeViaKeystrokes(message);
    if (!typed) {
      return { success: false, error: 'Failed to type message via keystrokes' };
    }

    await driver.wait(500);

    // Click the send button — validated selector: data-e2e="message-send" (SVG icon)
    const sendResult = await driver.executeScript(`
      (function() {
        // Primary: validated data-e2e="message-send" (SVG element)
        var btn = document.querySelector('[data-e2e="message-send"]');
        if (btn) {
          // SVG needs click on itself or nearest clickable parent
          var clickTarget = btn.closest('div') || btn.parentElement || btn;
          clickTarget.click();
          return 'sent_e2e';
        }
        // Fallback selectors
        var selectors = ['[data-e2e="send-message-btn"]', '[class*="SendButton"]', '[aria-label*="Send"]'];
        for (var i = 0; i < selectors.length; i++) {
          var el = document.querySelector(selectors[i]);
          if (el) { el.click(); return 'sent_fallback'; }
        }
        return 'no_button';
      })()
    `);

    if (sendResult.includes('sent')) {
      return { success: true };
    }

    // OS-level click on send button position as last resort
    const sendPos = await driver.executeScript(`
      (function() {
        var btn = document.querySelector('[data-e2e="message-send"]');
        if (btn) {
          var r = btn.getBoundingClientRect();
          if (r.width > 0) return JSON.stringify({x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2)});
        }
        return 'none';
      })()
    `);

    if (sendPos !== 'none') {
      try {
        const pos = JSON.parse(sendPos);
        await driver.clickAtViewportPosition(pos.x, pos.y);
        return { success: true };
      } catch {}
    }

    // Final fallback: press Enter via OS-level
    const sent = await driver.pressEnter();
    if (!sent) {
      return { success: false, error: 'Could not send message — no send button found and Enter failed' };
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

/**
 * Start a new conversation with a user
 */
export async function startNewConversation(
  driver: SafariDriver,
  username: string,
  message: string
): Promise<SendMessageResult> {
  try {
    // Navigate to inbox first
    const navResult = await navigateToInbox(driver);
    if (!navResult.success) {
      return { success: false, error: navResult.error };
    }

    // Click new message button
    const newMsgClicked = await driver.clickElement('[class*="NewMessage"]');
    if (!newMsgClicked) {
      // Try profile-to-DM flow instead
      return sendDMByUsername(username, message, driver);
    }

    await driver.wait(1500);

    // Search for the user
    const searchTyped = await driver.typeText(TIKTOK_SELECTORS.searchInput, username);
    if (!searchTyped) {
      return { success: false, error: 'Could not type in search input' };
    }

    await driver.wait(2000);

    // Click on the user result
    const userClicked = await driver.executeScript(`
      (function() {
        var targetUsername = "${username.toLowerCase()}";
        var cards = document.querySelectorAll('[class*="UserCard"], [class*="SearchResult"]');
        
        for (var i = 0; i < cards.length; i++) {
          var text = cards[i].innerText.toLowerCase();
          if (text.includes(targetUsername)) {
            cards[i].click();
            return 'clicked';
          }
        }
        return 'not_found';
      })()
    `);

    if (userClicked !== 'clicked') {
      return { success: false, error: `User ${username} not found in search` };
    }

    await driver.wait(1500);

    // Send the message
    return sendMessage(driver, message);
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

/**
 * Send DM via robust multi-strategy contact selection.
 * TikTok's virtual DOM doesn't respond to JS .click() — we use Quartz mouse events.
 *
 * Strategy chain (tries each until one works):
 *   A) Direct index: find target by href="/@handle" → get LI index → map to avatar → OS-click
 *   B) Search filter: type handle in search → first filtered avatar → OS-click
 *
 * Safety gates:
 *   - PRE-SEND: verify a[href="/@handle"] exists in chat panel header
 *   - POST-SEND: verify message snippet appears in DOM
 */
export async function sendDMByUsername(
  username: string,
  message: string,
  driver: SafariDriver
): Promise<SendMessageResult> {
  try {
    const handle = username.replace('@', '').toLowerCase();
    console.log(`[TikTok DM] 📤 Sending to @${handle}`);

    // ── Navigate to /messages ──────────────────────────────────────
    await driver.navigate(TIKTOK_URLS.messages);
    await driver.wait(5000);

    // ── Helpers ────────────────────────────────────────────────────
    /** Get sidebar avatar image positions (the ONLY elements with real dimensions) */
    const getAvatarPositions = async (): Promise<Array<{x: number; y: number}>> => {
      const raw = await driver.executeScript(`
        (function() {
          var imgs = document.querySelectorAll('img');
          var out = [];
          for (var i = 0; i < imgs.length; i++) {
            var r = imgs[i].getBoundingClientRect();
            if (r.width >= 36 && r.width <= 60 && r.x >= 50 && r.x <= 140 && r.y > 50) {
              out.push({x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2)});
            }
          }
          out.sort(function(a,b){ return a.y - b.y; });
          return JSON.stringify(out);
        })()
      `);
      try { return JSON.parse(raw); } catch { return []; }
    };

    /** Find target's LI index using href="/@handle" — the most reliable selector */
    const findConversationIndex = async (): Promise<number> => {
      const raw = await driver.executeScript(`
        (function() {
          var lis = document.querySelectorAll('li[class*="InboxItemWrapper"]');
          for (var i = 0; i < lis.length; i++) {
            var link = lis[i].querySelector('a[href="/@${handle}"]');
            if (link) return String(i);
            // Fallback: aria-label contains handle
            var ariaLink = lis[i].querySelector('a[aria-label]');
            if (ariaLink) {
              var href = ariaLink.getAttribute('href') || '';
              if (href.replace('/@','').toLowerCase() === '${handle}') return String(i);
            }
          }
          return '-1';
        })()
      `);
      return parseInt(raw, 10);
    };

    /** Verify the opened chat belongs to target user.
     *  Gate: conversation must actually be open (composer or 'Send a message' visible).
     *  Then verify identity via href count, aria-label, or visible header text. */
    const verifyIdentity = async (): Promise<{verified: boolean; header: string}> => {
      const raw = await driver.executeScript(`
        (function() {
          // Gate: is a conversation actually open?
          var hasComposer = !!document.querySelector('.public-DraftEditor-content[contenteditable="true"]')
                        || !!document.querySelector('[contenteditable="true"]');
          var hasSendText = document.body.innerText.includes('Send a message');
          if (!hasComposer && !hasSendText) {
            return JSON.stringify({verified: false, header: 'no_conversation_open'});
          }

          // Strategy 1: count href="/@handle" links.
          // 1 link = sidebar only. 2+ links = sidebar + chat header = conversation is open.
          var links = document.querySelectorAll('a[href="/@${handle}"]');
          if (links.length >= 2) {
            var label = links[1].getAttribute('aria-label') || '';
            return JSON.stringify({verified: true, header: label.replace("'s profile","").trim() || '@${handle}'});
          }

          // Strategy 2: visible header text containing handle (right panel, y < 120)
          var spans = document.querySelectorAll('p, span, h2');
          for (var i = 0; i < spans.length; i++) {
            var r = spans[i].getBoundingClientRect();
            var t = (spans[i].textContent || '').trim();
            if (r.width > 0 && r.y < 120 && r.x > 150 && t.toLowerCase().includes('${handle}')) {
              return JSON.stringify({verified: true, header: t.substring(0, 60)});
            }
          }

          // Strategy 3: aria-label visible in chat panel area
          var ariaLinks = document.querySelectorAll('a[aria-label*="${handle}"]');
          for (var j = 0; j < ariaLinks.length; j++) {
            var r2 = ariaLinks[j].getBoundingClientRect();
            if (r2.x > 150 && r2.width > 0) {
              return JSON.stringify({verified: true, header: ariaLinks[j].getAttribute('aria-label').replace("'s profile","").trim()});
            }
          }

          // Composer is open but we can't confirm WHO — fail safe
          return JSON.stringify({verified: false, header: 'composer_open_but_unverified'});
        })()
      `);
      try { return JSON.parse(raw); } catch { return {verified: false, header: ''}; }
    };

    // ── STRATEGY A: Direct index lookup ────────────────────────────
    console.log('[TikTok DM]   🔍 Strategy A: href index lookup...');
    const targetIdx = await findConversationIndex();
    const avatars = await getAvatarPositions();

    if (targetIdx >= 0 && targetIdx < avatars.length) {
      // Target is visible — click their avatar directly
      console.log(`[TikTok DM]   📍 Found at index ${targetIdx}, clicking avatar...`);
      const pos = avatars[targetIdx];
      await driver.clickAtViewportPosition(pos.x + 30, pos.y);
      await driver.wait(2500);

      const idCheck = await verifyIdentity();
      if (idCheck.verified) {
        console.log('[TikTok DM]   ✅ Identity verified: ' + idCheck.header);
        return await _sendAndVerify(driver, handle, message, idCheck.header);
      }
      console.log('[TikTok DM]   ⚠️ Strategy A: header mismatch, falling through...');
    } else if (targetIdx >= 0) {
      console.log(`[TikTok DM]   📍 Found at index ${targetIdx} but only ${avatars.length} avatars visible — need search`);
    } else {
      console.log('[TikTok DM]   ℹ️ Handle not found in conversation list');
    }

    // ── STRATEGY B: Search filter ──────────────────────────────────
    console.log('[TikTok DM]   🔍 Strategy B: search filter...');
    await driver.navigate(TIKTOK_URLS.messages);
    await driver.wait(4000);

    // Focus search input
    const searchOk = await driver.focusElement('input[data-e2e="search-user-input"]')
                  || await driver.focusElement('input[placeholder*="Search"]');
    if (!searchOk) {
      return { success: false, error: 'Could not find messages search input', username: handle };
    }
    await driver.wait(300);

    // Clear + type
    await driver.activateSafari();
    await driver.wait(200);
    const { execSync } = await import('child_process');
    try { execSync(`osascript -e 'tell application "System Events" to tell process "Safari" to keystroke "a" using command down'`); } catch {}
    await driver.wait(100);
    try { execSync(`osascript -e 'tell application "System Events" to tell process "Safari" to key code 51'`); } catch {}
    await driver.wait(200);
    await driver.typeViaKeystrokes(handle);
    await driver.wait(3000);

    // After search, TikTok visually filters but doesn't remove DOM elements.
    // So we click the FIRST VISIBLE avatar — the filtered result.
    const filteredAvatars = await getAvatarPositions();
    // Only consider avatars in the visible viewport (y < 800)
    const visibleAvatars = filteredAvatars.filter(a => a.y < 800);

    if (visibleAvatars.length === 0) {
      return { success: false, error: `No visible conversations after searching "${handle}"`, username: handle };
    }

    const clickPos = visibleAvatars[0]; // First visible = the search match
    console.log(`[TikTok DM]   📍 Clicking first visible filtered avatar at y=${clickPos.y}`);
    await driver.clickAtViewportPosition(clickPos.x + 30, clickPos.y);
    await driver.wait(3000);

    const idCheck = await verifyIdentity();
    if (!idCheck.verified) {
      return { success: false, error: `Identity verification failed — chat header does not match @${handle}`, username: handle };
    }
    console.log('[TikTok DM]   ✅ Identity verified: ' + idCheck.header);
    return await _sendAndVerify(driver, handle, message, idCheck.header);

  } catch (error) {
    return { success: false, error: String(error), username };
  }
}

/** Internal: focus composer, type, send, verify */
async function _sendAndVerify(
  driver: SafariDriver,
  handle: string,
  message: string,
  verifiedHeader: string
): Promise<SendMessageResult> {
  // Check composer ready
  const composerReady = await driver.executeScript(`
    (function() {
      var ce = document.querySelector('${TIKTOK_SELECTORS.messageInputDraft}');
      if (ce) return 'draft';
      ce = document.querySelector('${TIKTOK_SELECTORS.messageInputCE}');
      if (ce) return 'ce';
      return document.body.innerText.includes('Send a message') ? 'placeholder' : 'not_found';
    })()
  `);
  if (composerReady === 'not_found') {
    return { success: false, error: 'Composer not found after identity verification', username: handle };
  }

  const sendResult = await sendMessage(driver, message);
  if (!sendResult.success) return { ...sendResult, username: handle };

  // Post-send verification
  await driver.wait(2000);
  const snippet = message.substring(0, 30).replace(/'/g, "\\'");
  const postCheck = await driver.executeScript(`
    (function() { return document.body.innerText.includes('${snippet}') ? 'yes' : 'no'; })()
  `);

  return {
    success: true,
    username: handle,
    verified: postCheck === 'yes',
    verifiedRecipient: verifiedHeader,
  };
}

/**
 * Send DM via profile URL
 */
export async function sendDMFromProfileUrl(
  profileUrl: string,
  message: string,
  driver: SafariDriver
): Promise<SendMessageResult> {
  // Extract username from URL
  const match = profileUrl.match(/tiktok\.com\/@([a-zA-Z0-9_.]+)/);
  if (!match) {
    return { success: false, error: 'Invalid TikTok profile URL' };
  }

  const username = match[1];
  return sendDMByUsername(username, message, driver);
}

/**
 * Scroll to load more conversations
 */
export async function scrollConversations(driver: SafariDriver): Promise<number> {
  const result = await driver.executeScript(`
    (function() {
      var list = document.querySelector('${TIKTOK_SELECTORS.conversationList}');
      if (!list) return '0';
      
      var beforeCount = document.querySelectorAll('${TIKTOK_SELECTORS.conversationItem}').length;
      list.scrollTop = list.scrollHeight;
      return beforeCount.toString();
    })()
  `);

  await driver.wait(1500);

  const afterResult = await driver.executeScript(`
    (function() {
      return document.querySelectorAll('${TIKTOK_SELECTORS.conversationItem}').length.toString();
    })()
  `);

  return parseInt(afterResult) - parseInt(result);
}
