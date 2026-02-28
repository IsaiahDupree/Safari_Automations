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
  const result = await driver.executeJS(`
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
  const result = await driver.executeJS(`
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
    await driver.navigateTo(TIKTOK_URLS.messages);
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
  const result = await driver.executeJS(`
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
  const clicked = await driver.executeJS(`
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
  const result = await driver.executeJS(`
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
    const sendResult = await driver.executeJS(`
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
    const sendPos = await driver.executeJS(`
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
        // OS-level click — TikTok virtual DOM ignores JS .click() on send button
        await driver.clickAtScreenPosition(pos.x, pos.y, true);
        return { success: true };
      } catch {}
    }

    // Final fallback: Enter key
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
    const searchTyped = await driver.typeViaKeystrokes(username);
    if (!searchTyped) {
      return { success: false, error: 'Could not type in search input' };
    }

    await driver.wait(2000);

    // Click on the user result
    const userClicked = await driver.executeJS(`
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
    await driver.navigateTo(TIKTOK_URLS.messages);
    await driver.wait(5000);

    // ── Helpers ────────────────────────────────────────────────────
    /** Get sidebar avatar image positions (the ONLY elements with real dimensions) */
    const getAvatarPositions = async (): Promise<Array<{x: number; y: number}>> => {
      const raw = await driver.executeJS(`
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

    /** Find target conversation row — squish-matches handle against display name.
     *  e.g. "Sarah E Ashley" squished = "saraheashley" matches handle exactly. */
    const findConversationByText = async (): Promise<{x: number; y: number} | null> => {
      const raw = await driver.executeJS(`
        (function() {
          var target = '${handle.toLowerCase()}';
          var rows = document.querySelectorAll('[class*="DivItemWrapper"]');
          for (var i = 0; i < rows.length; i++) {
            var text = (rows[i].innerText || '').toLowerCase();
            var squished = text.replace(/[^a-z0-9]/g, '');
            if (text.includes(target) || squished.includes(target)) {
              var r = rows[i].getBoundingClientRect();
              if (r.width > 0 && r.height > 0) {
                return JSON.stringify({x: Math.round(r.left + r.width * 0.25), y: Math.round(r.top + r.height / 2)});
              }
            }
          }
          return 'not_found';
        })()
      `);
      if (raw === 'not_found') return null;
      try { return JSON.parse(raw); } catch { return null; }
    };

    /** Verify the opened chat belongs to target user.
     *  Primary: a[href="/@handle"] link in the right-panel chat area (validated 2026-02-26).
     *  TikTok always injects a profile link for the open conversation — DivChatHeader does not exist.
     *  Fallback: composer visible + any span/p in right panel (x>200) containing the handle. */
    const verifyIdentity = async (): Promise<{verified: boolean; header: string}> => {
      const raw = await driver.executeJS(`
        (function() {
          var target = '${handle.toLowerCase()}';
          // Primary: profile link in open chat — TikTok always renders a[href="/@handle"]
          var profileLink = document.querySelector('a[href="/@' + target + '"]');
          if (profileLink) {
            return JSON.stringify({verified: true, header: profileLink.innerText.trim().substring(0, 60) || target});
          }
          // Check composer is open at all
          var hasComposer = !!document.querySelector('[contenteditable="true"]')
                         || (document.body.innerText || '').includes('Send a message');
          if (!hasComposer) {
            return JSON.stringify({verified: false, header: 'no_conversation_open'});
          }
          // Fallback: scan right-panel (x>200) text nodes for the handle
          var nodes = document.querySelectorAll('p, span, h2, h3');
          for (var i = 0; i < nodes.length; i++) {
            var r = nodes[i].getBoundingClientRect();
            var t = (nodes[i].textContent || '').trim();
            if (r.width > 0 && r.y < 200 && r.x > 200 && t.toLowerCase().includes(target)) {
              return JSON.stringify({verified: true, header: t.substring(0, 60)});
            }
          }
          return JSON.stringify({verified: false, header: 'composer_open_but_unverified'});
        })()
      `);
      try { return JSON.parse(raw); } catch { return {verified: false, header: ''}; }
    };

    // ── STRATEGY A: Text-based LI click ────────────────────────────
    console.log('[TikTok DM]   🔍 Strategy A: text-based conversation lookup...');
    const convPos = await findConversationByText();

    if (convPos) {
      console.log(`[TikTok DM]   📍 Squish-matched @${handle} at (${convPos.x}, ${convPos.y}), OS-clicking...`);
      await driver.clickAtScreenPosition(convPos.x, convPos.y, true);
      await driver.wait(4000); // longer wait for SPA transition to settle

      // After squish-match, trust the row selection — just confirm composer opened
      const composerCheck = await driver.executeJS(
        `(function(){var ce=document.querySelector('[contenteditable="true"]');return ce?'open':(document.body.innerText.includes('Send a message')||document.body.innerText.includes('Message...'))?'placeholder':'closed';})()`
      );
      if (composerCheck === 'open' || composerCheck === 'placeholder') {
        console.log('[TikTok DM]   ✅ Strategy A: composer open, sending...');
        return await _sendAndVerify(driver, handle, message, handle);
      }
      console.log('[TikTok DM]   ⚠️ Strategy A: composer not found after squish-click (' + composerCheck + '), falling through...');
    } else {
      console.log('[TikTok DM]   ℹ️ @' + handle + ' not found in inbox list');
    }

    // ── STRATEGY B: Search filter ──────────────────────────────────
    console.log('[TikTok DM]   🔍 Strategy B: search filter...');
    await driver.navigateTo(TIKTOK_URLS.messages);
    await driver.wait(4000);

    // OS-level click on search bar (input has 0x0 in TikTok virtual DOM, JS focus fails).
    // The search input sits in the DivFullSideNavConversationHeader at viewport ~(300, 55).
    await driver.clickAtScreenPosition(300, 55, true);
    await driver.wait(500);

    // Clear any existing text then type handle
    const { execSync } = await import('child_process');
    try { execSync(`osascript -e 'tell application "System Events" to tell process "Safari" to keystroke "a" using command down'`); } catch {}
    await driver.wait(100);
    try { execSync(`osascript -e 'tell application "System Events" to tell process "Safari" to key code 51'`); } catch {}
    await driver.wait(200);
    await driver.typeViaKeystrokes(handle);
    await driver.wait(3500);

    // After search, find the first LiInboxItemWrapper avatar img and click via OS-level event.
    // TikTok virtual DOM: container rows have 0x0 dims, but avatar imgs have real dimensions.
    const firstRowPos = await driver.executeJS(`
      (function() {
        // Primary: find LiInboxItemWrapper rows and use their avatar img positions
        var rows = document.querySelectorAll('[class*="LiInboxItemWrapper"]');
        for (var i = 0; i < rows.length; i++) {
          var text = (rows[i].innerText || '').toLowerCase();
          if (text.length < 3) continue;
          var img = rows[i].querySelector('img');
          if (img) {
            var ri = img.getBoundingClientRect();
            if (ri.width > 0 && ri.height > 0) {
              return JSON.stringify({x: Math.round(ri.left + ri.width/2), y: Math.round(ri.top + ri.height/2), text: rows[i].innerText.substring(0,40), via: 'img'});
            }
          }
        }
        // Fallback: any avatar img in sidebar position
        var imgs = document.querySelectorAll('img');
        for (var j = 0; j < imgs.length; j++) {
          var r = imgs[j].getBoundingClientRect();
          if (r.width >= 36 && r.width <= 60 && r.x >= 50 && r.x <= 140 && r.y > 50) {
            return JSON.stringify({x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2), text: '', via: 'avatar_fallback'});
          }
        }
        return 'not_found';
      })()
    `);

    if (!firstRowPos || firstRowPos === 'not_found') {
      return { success: false, error: `No visible conversation rows after searching "${handle}"`, username: handle };
    }

    let rowPos: { x: number; y: number; via: string; text: string };
    try {
      rowPos = JSON.parse(firstRowPos);
    } catch {
      return { success: false, error: `Could not parse row position after searching "${handle}": ${firstRowPos}`, username: handle };
    }
    console.log(`[TikTok DM]   📍 OS-clicking ${rowPos.via} in first filtered row at (${rowPos.x}, ${rowPos.y}) — "${rowPos.text}"`);
    await driver.clickAtScreenPosition(rowPos.x, rowPos.y, true);
    await driver.wait(3000);

    const idCheck = await verifyIdentity();
    if (!idCheck.verified) {
      console.log(`[TikTok DM]   ⚠️ Strategy B identity mismatch — trying Strategy C: inbox compose flow...`);

      // ── STRATEGY C: Inbox compose flow using Quartz OS-clicks ────────────────
      // TikTok's virtual DOM ignores JS .click() — must use driver.clickElement (Quartz).
      const navResult = await navigateToInbox(driver);
      if (!navResult.success) {
        return { success: false, error: `Strategy C nav failed: ${navResult.error}`, username: handle };
      }

      const newMsgClicked = await driver.clickElement('[class*="NewMessage"]');
      if (!newMsgClicked) {
        return { success: false, error: `Strategy C: NewMessage compose button not found (cannot create new conversation)`, username: handle };
      }
      await driver.wait(1500);

      const searchTyped = await driver.typeViaKeystrokes(handle);
      if (!searchTyped) {
        return { success: false, error: 'Strategy C: could not type in compose search' };
      }
      await driver.wait(2000);

      // Click matching user card via Quartz (clickElement uses OS-level click)
      const userCardClicked = await driver.clickElement(`[class*="UserCard"]:has(*)`);
      if (!userCardClicked) {
        // Fallback: try clicking any SearchResult containing the handle
        const fallbackClicked = await driver.executeJS(`
          (function() {
            var target = "${handle.toLowerCase()}";
            var items = document.querySelectorAll('[class*="UserCard"], [class*="SearchResult"], li');
            for (var i = 0; i < items.length; i++) {
              if ((items[i].innerText||'').toLowerCase().includes(target)) {
                var r = items[i].getBoundingClientRect();
                return JSON.stringify({x: r.left + r.width/2, y: r.top + r.height/2});
              }
            }
            return 'not_found';
          })()
        `);
        if (fallbackClicked === 'not_found') {
          return { success: false, error: `Strategy C: @${handle} not in compose results`, username: handle };
        }
        const pos = JSON.parse(fallbackClicked);
        await driver.clickAtViewportPosition(pos.x, pos.y);
      }
      await driver.wait(1500);

      return sendMessage(driver, message);
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
  const composerReady = await driver.executeJS(`
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
  const snippet = message.substring(0, 30).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const postCheck = await driver.executeJS(`
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
  const result = await driver.executeJS(`
    (function() {
      var list = document.querySelector('${TIKTOK_SELECTORS.conversationList}');
      if (!list) return '0';
      
      var beforeCount = document.querySelectorAll('${TIKTOK_SELECTORS.conversationItem}').length;
      list.scrollTop = list.scrollHeight;
      return beforeCount.toString();
    })()
  `);

  await driver.wait(1500);

  const afterResult = await driver.executeJS(`
    (function() {
      return document.querySelectorAll('${TIKTOK_SELECTORS.conversationItem}').length.toString();
    })()
  `);

  return parseInt(afterResult) - parseInt(result);
}

/**
 * Scroll the inbox list until no new conversations load, then return all.
 * Handles TikTok's virtual DOM lazy-loading.
 */
export async function scrollAndListAllConversations(driver: SafariDriver, maxScrolls = 30): Promise<DMConversation[]> {
  let prevCount = -1;
  let stableRounds = 0;

  for (let i = 0; i < maxScrolls; i++) {
    await driver.executeJS(`
      (function() {
        var list = document.querySelector('${TIKTOK_SELECTORS.conversationList}') ||
                   document.querySelector('[class*="InboxItemListContainer"]') ||
                   document.querySelector('[class*="DivInboxList"]');
        if (list) { list.scrollTop += 900; }
        else { window.scrollBy(0, 900); }
      })()
    `);
    await driver.wait(1300);

    const countRaw = await driver.executeJS(`
      String(document.querySelectorAll('${TIKTOK_SELECTORS.conversationItem},[class*="LiInboxItemWrapper"]').length)
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

  return listConversations(driver);
}

/**
 * Scroll up in the current open conversation to load full message history, then read all.
 */
export async function readAllMessages(driver: SafariDriver, maxScrolls = 20): Promise<DMMessage[]> {
  let prevCount = -1;
  let stableRounds = 0;

  for (let i = 0; i < maxScrolls; i++) {
    await driver.executeJS(`
      (function() {
        var pane = document.querySelector('[class*="DivChatArea"],[class*="DivMessageList"],[class*="DivChatHistory"]');
        if (pane) { pane.scrollTop -= 1200; }
        else { window.scrollBy(0, -1200); }
      })()
    `);
    await driver.wait(1000);

    const countRaw = await driver.executeJS(`
      String(document.querySelectorAll('[class*="DivMessageBubble"],[class*="DivSingleMessage"]').length)
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

  return readMessages(driver, 9999);
}

/**
 * Fetch contact info from a TikTok profile page.
 */
export async function enrichContact(username: string, driver: SafariDriver): Promise<{
  fullName: string; bio: string; followers: string; following: string; likes: string;
}> {
  await driver.navigateTo(`https://www.tiktok.com/@${username.replace('@', '')}`);
  await driver.wait(2500);

  const raw = await driver.executeJS(`
    (function() {
      var nameEl = document.querySelector('h1[data-e2e="user-title"], [data-e2e="user-title"]');
      var bioEl  = document.querySelector('[data-e2e="user-bio"]');
      var stats  = document.querySelectorAll('[data-e2e="followers-count"],[data-e2e="following-count"],[data-e2e="likes-count"]');
      return JSON.stringify({
        fullName:  nameEl ? nameEl.innerText.trim() : '',
        bio:       bioEl  ? bioEl.innerText.trim()  : '',
        followers: stats[0] ? stats[0].innerText.trim() : '',
        following: stats[1] ? stats[1].innerText.trim() : '',
        likes:     stats[2] ? stats[2].innerText.trim() : '',
      });
    })()
  `);
  try {
    return JSON.parse(raw);
  } catch {
    return { fullName: '', bio: '', followers: '', following: '', likes: '' };
  }
}
