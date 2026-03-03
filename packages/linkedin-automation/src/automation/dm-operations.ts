/**
 * LinkedIn DM Operations
 * Safari automation for reading/sending LinkedIn messages.
 */

import { SafariDriver, getDefaultDriver } from './safari-driver.js';
import type {
  LinkedInConversation,
  LinkedInMessage,
  SendMessageResult,
  NavigationResult,
} from './types.js';
import { LINKEDIN_SELECTORS as SEL } from './types.js';

const LINKEDIN_MESSAGING = 'https://www.linkedin.com/messaging/';

// ─── Navigation ──────────────────────────────────────────────

export async function navigateToMessaging(driver?: SafariDriver): Promise<NavigationResult> {
  const d = driver || getDefaultDriver();
  const success = await d.navigateTo(LINKEDIN_MESSAGING);
  if (!success) return { success: false, error: 'Failed to navigate to messaging' };

  // Wait for messaging UI to load
  const ready = await d.waitForCondition(
    `(function(){return document.querySelector('.msg-overlay-list-bubble, .messaging-inbox')?'ready':'';})()`,
    10000
  );
  if (!ready) return { success: false, error: 'Messaging page did not load' };

  const isLoggedIn = await d.isLoggedIn();
  if (!isLoggedIn) return { success: false, error: 'Not logged in to LinkedIn' };
  return { success: true, currentUrl: await d.getCurrentUrl() };
}

// ─── List Conversations ──────────────────────────────────────

export async function listConversations(driver?: SafariDriver): Promise<LinkedInConversation[]> {
  const d = driver || getDefaultDriver();

  const convoJson = await d.executeJS(`
    (function() {
      var conversations = [];
      var items = document.querySelectorAll('.msg-conversation-listitem, li.msg-conversation-listitem__link');
      if (items.length === 0) {
        items = document.querySelectorAll('.msg-conversations-container__conversations-list li');
      }

      items.forEach(function(item) {
        try {
          var nameEl = item.querySelector('.msg-conversation-listitem__participant-names, .msg-conversation-card__participant-names');
          var name = nameEl ? nameEl.innerText.trim() : '';

          var headlineEl = item.querySelector('.msg-conversation-listitem__headline');
          var headline = headlineEl ? headlineEl.innerText.trim() : '';

          var msgEl = item.querySelector('.msg-conversation-listitem__message-snippet, .msg-conversation-card__message-snippet');
          var lastMsg = msgEl ? msgEl.innerText.trim().substring(0, 100) : '';

          var timeEl = item.querySelector('.msg-conversation-listitem__time-stamp, time');
          var time = timeEl ? timeEl.innerText.trim() : '';

          var unread = item.classList.contains('msg-conversation-listitem--unread') ||
                       !!item.querySelector('.notification-badge, .msg-conversation-card__unread-count');

          var idAttr = item.getAttribute('data-control-id') || item.querySelector('a')?.href || '';

          if (name) {
            conversations.push(JSON.stringify({
              conversationId: idAttr,
              participantName: name,
              participantHeadline: headline,
              lastMessage: lastMsg,
              lastMessageAt: time,
              unread: unread,
              isGroup: name.includes(','),
            }));
          }
        } catch(e) {}
      });

      return '[' + conversations.slice(0, 30).join(',') + ']';
    })()
  `);

  try {
    return JSON.parse(convoJson || '[]') as LinkedInConversation[];
  } catch {
    return [];
  }
}

// ─── Read Messages ───────────────────────────────────────────

export async function readMessages(limit: number = 20, driver?: SafariDriver): Promise<LinkedInMessage[]> {
  const d = driver || getDefaultDriver();

  const msgsJson = await d.executeJS(`
    (function() {
      var messages = [];
      var msgEls = document.querySelectorAll('.msg-s-message-list__event');

      var count = 0;
      msgEls.forEach(function(msg) {
        if (count >= ${limit}) return;
        try {
          var textEl = msg.querySelector('.msg-s-event-listitem__body, .msg-s-message-group__text');
          var text = textEl ? textEl.innerText.trim() : '';

          var senderEl = msg.querySelector('.msg-s-message-group__name, .msg-s-event-listitem__name');
          var sender = senderEl ? senderEl.innerText.trim() : '';

          var timeEl = msg.querySelector('time, .msg-s-message-group__timestamp');
          var time = timeEl ? (timeEl.getAttribute('datetime') || timeEl.innerText.trim()) : '';

          var isOutbound = msg.classList.contains('msg-s-message-list__event--outbound') ||
                           !!msg.querySelector('.msg-s-event-listitem--outbound');

          if (text) {
            messages.push(JSON.stringify({
              id: 'msg_' + count,
              sender: sender,
              content: text.substring(0, 500),
              timestamp: time,
              isOutbound: isOutbound,
            }));
            count++;
          }
        } catch(e) {}
      });

      return '[' + messages.join(',') + ']';
    })()
  `);

  try {
    return JSON.parse(msgsJson || '[]') as LinkedInMessage[];
  } catch {
    return [];
  }
}

// ─── Open Conversation ───────────────────────────────────────

export async function openConversation(participantName: string, driver?: SafariDriver): Promise<boolean> {
  const d = driver || getDefaultDriver();
  const searchName = participantName.toLowerCase().replace(/\\/g, '\\\\').replace(/'/g, "\\'");

  console.log(`[DM] Opening conversation with: ${participantName}`);

  // Step 1: Find and scroll the conversation into view
  const scrollResult = await d.executeJS(`
    (function() {
      var items = document.querySelectorAll('.msg-conversation-listitem, li.msg-conversation-listitem__link');
      if (!items.length) items = document.querySelectorAll('.msg-conversations-container__conversations-list li');
      for (var i = 0; i < items.length; i++) {
        var nameEl = items[i].querySelector('.msg-conversation-listitem__participant-names, .msg-conversation-card__participant-names');
        var nameText = nameEl ? nameEl.innerText.trim().toLowerCase() : items[i].innerText.trim().toLowerCase();
        if (nameText.includes('${searchName}')) {
          items[i].scrollIntoView({block: 'center'});
          return '' + i;
        }
      }
      return 'not_found';
    })()
  `);

  if (scrollResult === 'not_found') {
    console.log(`[DM] Conversation not found for: ${participantName}`);
    return false;
  }

  // Wait for scroll reflow before reading bounding rect
  await d.wait(200);

  // Step 2: Read bounding rect of the scrolled item
  const posResult = await d.executeJS(`
    (function() {
      var items = document.querySelectorAll('.msg-conversation-listitem, li.msg-conversation-listitem__link');
      if (!items.length) items = document.querySelectorAll('.msg-conversations-container__conversations-list li');
      var idx = ${scrollResult};
      if (idx >= 0 && idx < items.length) {
        var r = items[idx].getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          return JSON.stringify({x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2), idx: idx});
        }
      }
      return 'not_found';
    })()
  `);

  if (posResult === 'not_found') {
    console.log(`[DM] Conversation not found for: ${participantName}`);
    return false;
  }

  try {
    const pos = JSON.parse(posResult);
    console.log(`[DM] Found at index ${pos.idx}, viewport (${pos.x}, ${pos.y})`);
    const clicked = await d.clickAtViewportPosition(pos.x, pos.y);
    if (!clicked) {
      console.log(`[DM] Native click failed`);
      return false;
    }

    // Wait for thread to switch (entity title to appear with participant name)
    const threadReady = await d.waitForCondition(
      `(function(){var el=document.querySelector('.msg-entity-lockup__entity-title');return el?el.innerText.trim():'';})()`,
      5000
    );

    if (threadReady && threadReady.toLowerCase().includes(participantName.toLowerCase())) {
      console.log(`[DM] Thread switched to: ${threadReady}`);
      return true;
    }

    // Retry once — click slightly left (name area)
    console.log(`[DM] First click didn't switch thread, retrying with offset...`);
    const retryClicked = await d.clickAtViewportPosition(pos.x - 50, pos.y);
    if (retryClicked) {
      const retryReady = await d.waitForCondition(
        `(function(){var el=document.querySelector('.msg-entity-lockup__entity-title');return el?el.innerText.trim():'';})()`,
        5000
      );
      if (retryReady && retryReady.toLowerCase().includes(participantName.toLowerCase())) {
        console.log(`[DM] Thread switched after retry: ${retryReady}`);
        return true;
      }
    }
    console.log(`[DM] Thread did not switch (showing: ${threadReady})`);
  } catch (e: any) {
    console.log(`[DM] Error: ${e.message}`);
  }
  return false;
}

// ─── Send Message in Current Conversation ────────────────────

export async function sendMessage(text: string, driver?: SafariDriver): Promise<SendMessageResult> {
  const d = driver || getDefaultDriver();

  // Focus message input
  const focused = await d.executeJS(`
    (function() {
      var selectors = [
        '.msg-form__contenteditable',
        '[role="textbox"][contenteditable="true"]',
        '.msg-form__msg-content-container [contenteditable="true"]',
      ];
      for (var sel of selectors) {
        var el = document.querySelector(sel);
        if (el && el.offsetParent !== null) {
          el.focus();
          el.click();
          return 'focused';
        }
      }
      return 'not_found';
    })()
  `);

  if (focused !== 'focused') {
    return { success: false, error: 'Could not find message input' };
  }

  await d.wait(500);
  const typeResult = await d.typeViaClipboard(text);
  if (!typeResult.success) return { success: false, error: 'Failed to type message' };

  console.log(`[DM] Typed message using method: ${typeResult.method}`);
  await d.wait(500);

  // Click send
  const sent = await d.executeJS(`
    (function() {
      var btn = document.querySelector('.msg-form__send-button, button[type="submit"].msg-form__send-button');
      if (btn && !btn.disabled) { btn.click(); return 'sent'; }
      return 'not_found';
    })()
  `);

  if (sent !== 'sent') {
    // Fallback: press Enter
    await d.pressEnter();
  }

  // Wait for message to appear in thread
  await d.wait(1500);

  // Verify
  const verified = await d.executeJS(`
    (function() {
      var msgs = document.querySelectorAll('.msg-s-event-listitem__body, .msg-s-message-group__text');
      var last = msgs[msgs.length - 1];
      var check = '${text.substring(0, 30).replace(/\\/g, '\\\\').replace(/'/g, "\\\'")}';      if (last && last.innerText.trim().includes(check)) return 'verified';
      return 'unverified';
    })()
  `);

  // Get recipient
  const recipient = await d.executeJS(`
    (function() {
      var nameEl = document.querySelector('.msg-thread__link-to-profile, .msg-entity-lockup__entity-title');
      return nameEl ? nameEl.innerText.trim() : '';
    })()
  `);

  return {
    success: true,
    verified: verified === 'verified',
    verifiedRecipient: recipient || undefined,
  };
}

// ─── Send Message to Profile (New Conversation) ─────────────
//
// LinkedIn Feb 2026 FIX: The Message button is an <a> linking to /messaging/compose/?interop=msgOverlay
// KEEP interop=msgOverlay — stripping it causes redirects to home.
// Use NATIVE clickAtViewportPosition() instead of JS .click() to trigger SPA routing.

export async function sendMessageToProfile(
  profileUrl: string,
  text: string,
  driver?: SafariDriver
): Promise<SendMessageResult> {
  const d = driver || getDefaultDriver();
  const log = (msg: string) => console.log(`[DM] ${msg}`);

  // ── Step 1: Navigate to profile page ──
  const url = profileUrl.startsWith('http') ? profileUrl : `https://www.linkedin.com/in/${profileUrl}/`;
  log(`Navigating to profile: ${url}`);
  await d.navigateTo(url);

  // Wait for main element to load
  const mainReady = await d.waitForSelector('main', 10000);

  if (!mainReady) {
    return { success: false, error: 'Profile page did not load (no main element)' };
  }

  // ── Step 2: Find Message anchor with interop=msgOverlay ──
  const messageAnchorInfo = await d.executeJS(`
    (function() {
      var anchors = document.querySelectorAll('a[href*="interop=msgOverlay"], button[aria-label*="Message"], a[data-control-name*="message"]');
      for (var i = 0; i < anchors.length; i++) {
        var href = anchors[i].href || '';
        var ariaLabel = (anchors[i].getAttribute('aria-label') || '').toLowerCase();
        if (href.includes('interop=msgOverlay') || ariaLabel.includes('message')) {
          var rect = anchors[i].getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            return JSON.stringify({
              found: true,
              x: Math.round(rect.x + rect.width / 2),
              y: Math.round(rect.y + rect.height / 2),
              href: href
            });
          }
        }
      }
      return JSON.stringify({found: false, error: 'Message button not found or not visible'});
    })()
  `);

  let anchorInfo: any;
  try { anchorInfo = JSON.parse(messageAnchorInfo); } catch {
    return { success: false, error: 'Failed to parse message anchor info' };
  }

  if (!anchorInfo.found) {
    log(`Message button not found: ${anchorInfo.error}`);
    return { success: false, error: 'Message button not found — may not be connected' };
  }

  log(`Found Message button at viewport (${anchorInfo.x}, ${anchorInfo.y})`);

  // ── Step 3: Native click on Message button ──
  const clicked = await d.clickAtViewportPosition(anchorInfo.x, anchorInfo.y);
  if (!clicked) {
    return { success: false, error: 'Failed to click Message button' };
  }

  log('Clicked Message button with native click');

  // ── Step 4: Wait for message input overlay ──
  const inputReady = await d.waitForCondition(
    `(function(){var el=document.querySelector('.msg-form__contenteditable,[role="textbox"][contenteditable="true"]');return(el&&el.offsetParent!==null)?'ready':'';})()`,
    8000
  );

  if (!inputReady) {
    return { success: false, error: 'Message input did not appear after clicking Message button' };
  }

  // Focus the input
  await d.executeJS(`
    (function(){var el=document.querySelector('.msg-form__contenteditable');if(!el)el=document.querySelector('[role="textbox"][contenteditable="true"]');if(el){el.focus();el.click();}})()
  `);
  await d.wait(300);

  // ── Step 5: Type message via clipboard ──
  const typeResult = await d.typeViaClipboard(text);
  if (!typeResult.success) return { success: false, error: 'Failed to type message' };
  log(`Typed message using method: ${typeResult.method}`);
  await d.wait(1000);

  // ── Step 6: Wait for Send to enable and click ──
  const sendReady = await d.waitForCondition(
    `(function(){var btns=document.querySelectorAll('button');for(var i=0;i<btns.length;i++){if(btns[i].innerText.trim()==='Send'&&!btns[i].disabled)return 'ready';}return '';})()`,
    5000
  );

  if (!sendReady) {
    // Fallback: try the class-based selector
    const fallbackSent = await d.executeJS(`
      (function(){var btn=document.querySelector('.msg-form__send-button');if(btn&&!btn.disabled){btn.click();return 'sent';}return 'not_found';})()
    `);
    if (fallbackSent !== 'sent') {
      await d.pressEnter();
      log('Send button not found — pressed Enter as fallback');
    }
  } else {
    await d.executeJS(`
      (function(){var btns=document.querySelectorAll('button');for(var i=0;i<btns.length;i++){if(btns[i].innerText.trim()==='Send'&&!btns[i].disabled){btns[i].click();return 'sent';}}return 'miss';})()
    `);
    log('Clicked Send');
  }

  await d.wait(2000);

  // ── Step 7: Verify message appeared ──
  const checkText = text.substring(0, 30).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const verification = await d.executeJS(`
    (function() {
      var msgs = document.querySelectorAll('.msg-s-event-listitem__body, .msg-s-message-group__text');
      var last = msgs.length > 0 ? msgs[msgs.length - 1].innerText.trim() : '';
      var verified = last.includes('${checkText}');
      var recipient = '';
      var nameEl = document.querySelector('.msg-thread__link-to-profile, .msg-entity-lockup__entity-title, h2.msg-overlay-bubble-header__title');
      if (nameEl) recipient = nameEl.innerText.trim();
      return JSON.stringify({verified: verified, recipient: recipient, lastMsg: last.substring(0, 60)});
    })()
  `);

  let result: any = {};
  try { result = JSON.parse(verification); } catch {}

  log(`Verified: ${result.verified}, Recipient: ${result.recipient || 'unknown'}, Last: ${result.lastMsg || ''}`);

  return {
    success: true,
    verified: result.verified === true,
    verifiedRecipient: result.recipient || undefined,
  };
}

// ─── Open New Compose (First-Contact DMs) ───────────────────
//
// Use this for sending DMs to people NOT yet in your message history.
// Opens the compose modal, types recipient name, selects from dropdown, sends message.

export async function openNewCompose(
  recipientName: string,
  message: string,
  driver?: SafariDriver
): Promise<SendMessageResult> {
  const d = driver || getDefaultDriver();
  const log = (msg: string) => console.log(`[NewCompose] ${msg}`);

  // ── Step 1: Navigate to messaging page ──
  log(`Navigating to messaging...`);
  await d.navigateTo('https://www.linkedin.com/messaging/');

  const messagingReady = await d.waitForCondition(
    `(function(){var el=document.querySelector('.msg-overlay-list-bubble, .scaffold-layout__aside');return el?'ready':'';})()`,
    10000
  );

  if (!messagingReady) {
    return { success: false, error: 'Messaging page did not load' };
  }

  // ── Step 2: Find and click compose button ──
  const composeButtonInfo = await d.executeJS(`
    (function() {
      var btns = document.querySelectorAll('[data-control-name=compose], button[aria-label*="Compose"]');
      for (var i = 0; i < btns.length; i++) {
        var rect = btns[i].getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          return JSON.stringify({
            found: true,
            x: Math.round(rect.x + rect.width / 2),
            y: Math.round(rect.y + rect.height / 2)
          });
        }
      }
      return JSON.stringify({found: false});
    })()
  `);

  let composeBtnInfo: any;
  try { composeBtnInfo = JSON.parse(composeButtonInfo); } catch {
    return { success: false, error: 'Failed to parse compose button info' };
  }

  if (!composeBtnInfo.found) {
    return { success: false, error: 'Compose button not found' };
  }

  log(`Clicking compose button at (${composeBtnInfo.x}, ${composeBtnInfo.y})`);
  const composeClicked = await d.clickAtViewportPosition(composeBtnInfo.x, composeBtnInfo.y);
  if (!composeClicked) {
    return { success: false, error: 'Failed to click compose button' };
  }

  // ── Step 3: Wait for recipient search field ──
  const searchReady = await d.waitForCondition(
    `(function(){var el=document.querySelector('.msg-connections-typeahead__search-field');return el?'ready':'';})()`,
    8000
  );

  if (!searchReady) {
    return { success: false, error: 'Recipient search field did not appear' };
  }

  // Focus the search field
  await d.executeJS(`
    (function(){var el=document.querySelector('.msg-connections-typeahead__search-field');if(el){el.focus();el.click();}})()
  `);
  await d.wait(300);

  // ── Step 4: Type recipient name character by character ──
  log(`Typing recipient name: ${recipientName}`);
  const typed = await d.typeViaClipboard(recipientName);
  if (!typed) return { success: false, error: 'Failed to type recipient name' };
  await d.wait(1500);

  // ── Step 5: Wait for dropdown suggestions ──
  const suggestionsReady = await d.waitForCondition(
    `(function(){var el=document.querySelector('.msg-connections-typeahead__result-item');return el?'ready':'';})()`,
    5000
  );

  if (!suggestionsReady) {
    return { success: false, error: 'No recipient suggestions appeared' };
  }

  // ── Step 6: Click first matching suggestion ──
  const suggestionInfo = await d.executeJS(`
    (function() {
      var suggestions = document.querySelectorAll('.msg-connections-typeahead__result-item');
      if (suggestions.length > 0) {
        var rect = suggestions[0].getBoundingClientRect();
        return JSON.stringify({
          found: true,
          x: Math.round(rect.x + rect.width / 2),
          y: Math.round(rect.y + rect.height / 2),
          text: suggestions[0].innerText.trim().substring(0, 50)
        });
      }
      return JSON.stringify({found: false});
    })()
  `);

  let suggInfo: any;
  try { suggInfo = JSON.parse(suggestionInfo); } catch {
    return { success: false, error: 'Failed to parse suggestion info' };
  }

  if (!suggInfo.found) {
    return { success: false, error: 'No suggestion to click' };
  }

  log(`Clicking suggestion: ${suggInfo.text}`);
  const suggClicked = await d.clickAtViewportPosition(suggInfo.x, suggInfo.y);
  if (!suggClicked) {
    return { success: false, error: 'Failed to click suggestion' };
  }

  await d.wait(1000);

  // ── Step 7: Wait for message input ──
  const inputReady = await d.waitForCondition(
    `(function(){var el=document.querySelector('.msg-form__contenteditable');return(el&&el.offsetParent!==null)?'ready':'';})()`,
    8000
  );

  if (!inputReady) {
    return { success: false, error: 'Message input did not appear' };
  }

  // Focus the input
  await d.executeJS(`
    (function(){var el=document.querySelector('.msg-form__contenteditable');if(el){el.focus();el.click();}})()
  `);
  await d.wait(300);

  // ── Step 8: Type message ──
  log(`Typing message...`);
  const msgTyped = await d.typeViaClipboard(message);
  if (!msgTyped) return { success: false, error: 'Failed to type message' };
  await d.wait(1000);

  // ── Step 9: Click Send ──
  const sendReady = await d.waitForCondition(
    `(function(){var btns=document.querySelectorAll('button');for(var i=0;i<btns.length;i++){if(btns[i].innerText.trim()==='Send'&&!btns[i].disabled)return 'ready';}return '';})()`,
    5000
  );

  if (!sendReady) {
    await d.pressEnter();
    log('Send button not ready — pressed Enter as fallback');
  } else {
    await d.executeJS(`
      (function(){var btns=document.querySelectorAll('button');for(var i=0;i<btns.length;i++){if(btns[i].innerText.trim()==='Send'&&!btns[i].disabled){btns[i].click();return;}}})()
    `);
    log('Clicked Send');
  }

  await d.wait(2000);

  // ── Step 10: Verify ──
  const checkText = message.substring(0, 30).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const verification = await d.executeJS(`
    (function() {
      var msgs = document.querySelectorAll('.msg-s-event-listitem__body, .msg-s-message-group__text');
      var last = msgs.length > 0 ? msgs[msgs.length - 1].innerText.trim() : '';
      var verified = last.includes('${checkText}');
      var recipient = '';
      var nameEl = document.querySelector('.msg-entity-lockup__entity-title, h2.msg-overlay-bubble-header__title');
      if (nameEl) recipient = nameEl.innerText.trim();
      return JSON.stringify({verified: verified, recipient: recipient});
    })()
  `);

  let result: any = {};
  try { result = JSON.parse(verification); } catch {}

  log(`Verified: ${result.verified}, Recipient: ${result.recipient || 'unknown'}`);

  return {
    success: true,
    verified: result.verified === true,
    verifiedRecipient: result.recipient || undefined,
  };
}

// ─── Get Unread Count ────────────────────────────────────────

export async function getUnreadCount(driver?: SafariDriver): Promise<number> {
  const d = driver || getDefaultDriver();

  const countStr = await d.executeJS(`
    (function() {
      var badge = document.querySelector('.msg-overlay-bubble-header__badge, .notification-badge__count, [class*="msg-overlay"] .notification-badge');
      if (badge) return badge.innerText.trim();
      var navBadge = document.querySelector('a[href*="/messaging/"] .notification-badge__count');
      if (navBadge) return navBadge.innerText.trim();
      return '0';
    })()
  `);

  return parseInt(countStr) || 0;
}
