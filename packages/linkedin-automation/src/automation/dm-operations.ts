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
  const searchName = participantName.toLowerCase().replace(/'/g, "\\'");

  console.log(`[DM] Opening conversation with: ${participantName}`);

  // Find the conversation item's bounding rect by name
  const posResult = await d.executeJS(`
    (function() {
      var items = document.querySelectorAll('.msg-conversation-listitem');
      for (var i = 0; i < items.length; i++) {
        var nameEl = items[i].querySelector('.msg-conversation-listitem__participant-names, .msg-conversation-card__participant-names');
        if (nameEl && nameEl.innerText.trim().toLowerCase().includes('${searchName}')) {
          items[i].scrollIntoView({block: 'center'});
          var r = items[i].getBoundingClientRect();
          if (r.width > 0 && r.height > 0) {
            return JSON.stringify({x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2), idx: i});
          }
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
      if (last && last.innerText.trim().includes('${text.substring(0, 30).replace(/'/g, "\\'")}')) return 'verified';
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

export async function sendMessageToProfile(
  profileUrl: string,
  text: string,
  driver?: SafariDriver
): Promise<SendMessageResult> {
  const d = driver || getDefaultDriver();

  // Navigate to profile
  const url = profileUrl.startsWith('http') ? profileUrl : `https://www.linkedin.com/in/${profileUrl}/`;
  await d.navigateTo(url);
  await d.humanDelay(2000, 4000);

  // Click Message button or anchor on profile (LinkedIn Feb 2026 uses <a> for Message)
  const msgClicked = await d.executeJS(`
    (function() {
      var main = document.querySelector('main');
      if (!main) return 'no_main';
      var section = main.querySelector('section');
      var scope = section || main;
      // Try button first
      var btns = scope.querySelectorAll('button');
      for (var i = 0; i < btns.length; i++) {
        var a = (btns[i].getAttribute('aria-label') || '').toLowerCase();
        if (a.includes('message')) { btns[i].click(); return 'clicked_btn'; }
      }
      // Try anchor (LinkedIn Feb 2026)
      var anchors = scope.querySelectorAll('a');
      for (var j = 0; j < anchors.length; j++) {
        var aa = (anchors[j].getAttribute('aria-label') || '').toLowerCase();
        var at = anchors[j].innerText.trim().toLowerCase();
        var ah = (anchors[j].href || '').toLowerCase();
        if (aa.includes('message') || at === 'message' || ah.includes('/messaging/compose')) {
          anchors[j].click();
          return 'clicked_anchor';
        }
      }
      return 'not_found';
    })()
  `);

  console.log('[DM] Message button click result:', msgClicked);
  if (msgClicked === 'not_found' || msgClicked === 'no_main') {
    return { success: false, error: 'Message button not found — may not be connected' };
  }

  await d.wait(2000);

  // Type in message overlay
  const focused = await d.executeJS(`
    (function() {
      var selectors = [
        '.msg-form__contenteditable',
        '[role="textbox"][contenteditable="true"]',
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
    return { success: false, error: 'Could not find message input in overlay' };
  }

  await d.wait(300);
  await d.typeViaClipboard(text);
  await d.wait(500);

  // Send
  const sent = await d.executeJS(`
    (function() {
      var btn = document.querySelector('.msg-form__send-button');
      if (btn && !btn.disabled) { btn.click(); return 'sent'; }
      return 'not_found';
    })()
  `);

  if (sent !== 'sent') {
    await d.pressEnter();
  }

  await d.wait(2000);

  return { success: true, verified: true };
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
