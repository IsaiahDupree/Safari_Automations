/**
 * Upwork Message Operations
 * High-level Safari automation for reading/sending Upwork messages.
 */

import { SafariDriver, getDefaultDriver } from './safari-driver.js';
import type {
  UpworkMessage,
  UpworkConversation,
  SendMessageResult,
  NavigationResult,
} from './types.js';

const UPWORK_MESSAGES = 'https://www.upwork.com/ab/messages';

// ─── Navigation ──────────────────────────────────────────────

export async function navigateToMessages(driver?: SafariDriver): Promise<NavigationResult> {
  const d = driver || getDefaultDriver();
  const success = await d.navigateTo(UPWORK_MESSAGES);
  if (!success) return { success: false, error: 'Failed to navigate to messages' };

  await d.wait(3000);
  const isLoggedIn = await d.isLoggedIn();
  if (!isLoggedIn) return { success: false, error: 'Not logged in to Upwork' };

  const currentUrl = await d.getCurrentUrl();
  return { success: true, currentUrl };
}

// ─── List Conversations ──────────────────────────────────────

export async function listConversations(driver?: SafariDriver): Promise<UpworkConversation[]> {
  const d = driver || getDefaultDriver();

  const convoJson = await d.executeJS(`
    (function() {
      var conversations = [];
      var items = document.querySelectorAll('.thread-list-item, [data-test="conversation"], .msg-conversations-container li');

      items.forEach(function(item) {
        try {
          var nameEl = item.querySelector('.user-name, [data-test="participant-name"], strong, h4');
          var name = nameEl ? nameEl.innerText.trim() : '';

          var jobEl = item.querySelector('.job-title, [data-test="job-title"], small, .text-muted');
          var jobTitle = jobEl ? jobEl.innerText.trim() : '';

          var msgEl = item.querySelector('.last-message, [data-test="last-message"], p');
          var lastMsg = msgEl ? msgEl.innerText.trim().substring(0, 100) : '';

          var timeEl = item.querySelector('time, .timestamp, [data-test="timestamp"]');
          var time = timeEl ? timeEl.innerText.trim() : '';

          var unread = item.classList.contains('unread') ||
                       !!item.querySelector('.unread-badge, .badge-unread, [data-test="unread"]');

          if (name) {
            conversations.push(JSON.stringify({
              id: item.getAttribute('data-thread-id') || item.getAttribute('data-test-id') || Date.now().toString(),
              clientName: name,
              jobTitle: jobTitle,
              lastMessage: lastMsg,
              lastMessageAt: time,
              unread: unread,
            }));
          }
        } catch(e) {}
      });

      return '[' + conversations.slice(0, 30).join(',') + ']';
    })()
  `);

  try {
    return JSON.parse(convoJson || '[]') as UpworkConversation[];
  } catch {
    return [];
  }
}

// ─── Read Messages ───────────────────────────────────────────

export async function readMessages(limit: number = 20, driver?: SafariDriver): Promise<UpworkMessage[]> {
  const d = driver || getDefaultDriver();

  const msgsJson = await d.executeJS(`
    (function() {
      var messages = [];
      var msgEls = document.querySelectorAll('.msg-list-item, [data-test="message"], .message-row, .air3-msg');

      var count = 0;
      msgEls.forEach(function(msg) {
        if (count >= ${limit}) return;
        try {
          var textEl = msg.querySelector('.message-text, [data-test="message-text"], .msg-body, p');
          var text = textEl ? textEl.innerText.trim() : '';

          var senderEl = msg.querySelector('.sender-name, [data-test="sender"], .user-name');
          var sender = senderEl ? senderEl.innerText.trim() : '';

          var timeEl = msg.querySelector('time, .timestamp, [data-test="timestamp"]');
          var time = timeEl ? (timeEl.getAttribute('datetime') || timeEl.innerText.trim()) : '';

          var isOutbound = msg.classList.contains('outbound') ||
                           msg.classList.contains('sent') ||
                           !!msg.querySelector('.sent-indicator');

          if (text) {
            messages.push(JSON.stringify({
              id: 'msg_' + count,
              from: sender,
              content: text.substring(0, 500),
              timestamp: time,
              isOutbound: isOutbound,
              isRead: true,
            }));
            count++;
          }
        } catch(e) {}
      });

      return '[' + messages.join(',') + ']';
    })()
  `);

  try {
    return JSON.parse(msgsJson || '[]') as UpworkMessage[];
  } catch {
    return [];
  }
}

// ─── Open Conversation ───────────────────────────────────────

export async function openConversation(clientName: string, driver?: SafariDriver): Promise<boolean> {
  const d = driver || getDefaultDriver();

  const result = await d.executeJS(`
    (function() {
      var items = document.querySelectorAll('.thread-list-item, [data-test="conversation"], .msg-conversations-container li');
      for (var item of items) {
        var nameEl = item.querySelector('.user-name, [data-test="participant-name"], strong, h4');
        if (nameEl && nameEl.innerText.trim().toLowerCase().includes('${clientName.toLowerCase().replace(/'/g, "\\'")}')) {
          item.click();
          return 'opened';
        }
      }
      return 'not_found';
    })()
  `);

  if (result === 'opened') {
    await d.wait(2000);
    return true;
  }
  return false;
}

// ─── Send Message ────────────────────────────────────────────

export async function sendMessage(text: string, driver?: SafariDriver): Promise<SendMessageResult> {
  const d = driver || getDefaultDriver();

  // Focus message input
  const focused = await d.executeJS(`
    (function() {
      var selectors = [
        '[data-test="message-input"]',
        '.msg-composer textarea',
        'textarea[placeholder*="message" i]',
        'textarea[placeholder*="type" i]',
        '[contenteditable="true"]',
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

  // Type message via clipboard
  const typed = await d.typeViaClipboard(text);
  if (!typed) {
    return { success: false, error: 'Failed to type message' };
  }

  await d.wait(500);

  // Click send button
  const sent = await d.executeJS(`
    (function() {
      var selectors = [
        '[data-test="send-message"]',
        'button[aria-label*="Send"]',
        'button.msg-form__send-button',
        'button[type="submit"]',
      ];
      for (var sel of selectors) {
        var btn = document.querySelector(sel);
        if (btn && !btn.disabled) {
          btn.click();
          return 'sent';
        }
      }
      return 'not_found';
    })()
  `);

  if (sent !== 'sent') {
    // Fallback: try Enter key
    await d.pressEnter();
    await d.wait(1000);
  } else {
    await d.wait(1500);
  }

  // Verify message was sent
  const verified = await d.executeJS(`
    (function() {
      var messages = document.querySelectorAll('.message-text, [data-test="message-text"], .msg-body p');
      var lastMsg = messages[messages.length - 1];
      if (lastMsg) {
        var text = lastMsg.innerText.trim();
        if (text.includes('${text.substring(0, 30).replace(/'/g, "\\'")}')) return 'verified';
      }
      return 'unverified';
    })()
  `);

  return {
    success: true,
    verified: verified === 'verified',
  };
}

// ─── Get Unread Count ────────────────────────────────────────

export async function getUnreadCount(driver?: SafariDriver): Promise<number> {
  const d = driver || getDefaultDriver();

  const countStr = await d.executeJS(`
    (function() {
      var badge = document.querySelector('[data-test="unread-count"], .unread-count, .nav-notifications-count');
      if (badge) return badge.innerText.trim();

      var unread = document.querySelectorAll('.thread-list-item.unread, [data-test="conversation"].unread');
      return String(unread.length);
    })()
  `);

  return parseInt(countStr) || 0;
}
