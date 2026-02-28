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
  await d.wait(3000);
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
    await d.wait(3000);

    // Verify the thread switched
    const threadPerson = await d.executeJS(`
      (function() {
        var el = document.querySelector('.msg-entity-lockup__entity-title');
        return el ? el.innerText.trim() : '';
      })()
    `);
    console.log(`[DM] Thread person after click: ${threadPerson}`);
    if (threadPerson.toLowerCase().includes(participantName.toLowerCase())) {
      return true;
    }
    // Retry once — click slightly left (name area)
    console.log(`[DM] Retrying with offset click...`);
    const retryClicked = await d.clickAtViewportPosition(pos.x - 50, pos.y);
    if (retryClicked) {
      await d.wait(3000);
      const retryPerson = await d.executeJS(`
        (function() {
          var el = document.querySelector('.msg-entity-lockup__entity-title');
          return el ? el.innerText.trim() : '';
        })()
      `);
      if (retryPerson.toLowerCase().includes(participantName.toLowerCase())) {
        return true;
      }
    }
    console.log(`[DM] Thread did not switch (showing: ${threadPerson})`);
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
  const typed = await d.typeViaClipboard(text);
  if (!typed) return { success: false, error: 'Failed to type message' };

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
    await d.wait(1000);
  } else {
    await d.wait(2000);
  }

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
// LinkedIn Feb 2026: The Message button is an <a> linking to /messaging/compose/.
// JS .click() on this anchor tries to open an overlay that often fails to render.
// Fix: Extract the compose URL from the anchor href and navigate directly to it.

export async function sendMessageToProfile(
  profileUrl: string,
  text: string,
  driver?: SafariDriver
): Promise<SendMessageResult> {
  const d = driver || getDefaultDriver();
  const log = (msg: string) => console.log(`[DM] ${msg}`);

  // ── Step 1: Navigate to profile and extract compose URL ──
  const url = profileUrl.startsWith('http') ? profileUrl : `https://www.linkedin.com/in/${profileUrl}/`;
  await d.navigateTo(url);
  await d.wait(3000);

  // Wait for profile action buttons to render
  const pageReady = await d.waitForCondition(
    `(function(){var m=document.querySelector('main');if(!m)return '';var s=m.querySelector('section');if(!s)return '';var has=s.querySelector('a[href*="/messaging/compose"],button[aria-label*="Message" i]');return has?'ready':'';})()`,
    10000
  );

  if (!pageReady) {
    log('Profile buttons did not load — checking if we can message');
  }

  // Extract compose URL from Message anchor
  const composeInfo = await d.executeJS(`
    (function() {
      var m = document.querySelector('main');
      if (!m) return JSON.stringify({error: 'no_main'});
      var s = m.querySelector('section');
      var scope = s || m;
      // Try anchor first (LinkedIn Feb 2026)
      var anchors = scope.querySelectorAll('a');
      for (var j = 0; j < anchors.length; j++) {
        var href = (anchors[j].href || '');
        if (href.includes('/messaging/compose')) {
          // Strip interop=msgOverlay to get full-page compose
          var cleanUrl = href.replace(/&interop=[^&]*/g, '').replace(/&screenContext=[^&]*/g, '');
          return JSON.stringify({composeUrl: cleanUrl, method: 'anchor'});
        }
      }
      // Try button
      var btns = scope.querySelectorAll('button');
      for (var i = 0; i < btns.length; i++) {
        var a = (btns[i].getAttribute('aria-label') || '').toLowerCase();
        if (a.includes('message')) {
          return JSON.stringify({composeUrl: '', method: 'button', label: a});
        }
      }
      return JSON.stringify({error: 'not_found'});
    })()
  `);

  let compose: any;
  try { compose = JSON.parse(composeInfo); } catch {
    return { success: false, error: 'Failed to parse compose info' };
  }

  if (compose.error) {
    log(`Message button not found: ${compose.error}`);
    return { success: false, error: 'Message button not found — may not be connected' };
  }

  // ── Step 2: Navigate to compose page (or click button) ──
  if (compose.composeUrl) {
    log(`Navigating to compose: ${compose.composeUrl.substring(0, 80)}`);
    await d.navigateTo(compose.composeUrl);
    await d.wait(3000);
  } else if (compose.method === 'button') {
    // Legacy button fallback — click and hope overlay opens
    log('Using legacy button click for message');
    await d.executeJS(`
      (function(){var m=document.querySelector('main');var s=m.querySelector('section');var scope=s||m;var btns=scope.querySelectorAll('button');for(var i=0;i<btns.length;i++){var a=(btns[i].getAttribute('aria-label')||'').toLowerCase();if(a.includes('message')){btns[i].click();return;}}})()
    `);
    await d.wait(3000);
  }

  // ── Step 3: Wait for message input ──
  const inputReady = await d.waitForCondition(
    `(function(){var el=document.querySelector('.msg-form__contenteditable,[role="textbox"][contenteditable="true"]');return(el&&el.offsetParent!==null)?'ready':'';})()`,
    10000
  );

  if (!inputReady) {
    return { success: false, error: 'Message input did not appear on compose page' };
  }

  // Focus the input
  await d.executeJS(`
    (function(){var el=document.querySelector('.msg-form__contenteditable');if(!el)el=document.querySelector('[role="textbox"][contenteditable="true"]');if(el){el.focus();el.click();}})()
  `);
  await d.wait(300);

  // ── Step 4: Type message via clipboard ──
  const typed = await d.typeViaClipboard(text);
  if (!typed) return { success: false, error: 'Failed to type message' };
  await d.wait(1000);

  // ── Step 5: Wait for Send to enable and click ──
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

  // ── Step 6: Verify message appeared ──
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
