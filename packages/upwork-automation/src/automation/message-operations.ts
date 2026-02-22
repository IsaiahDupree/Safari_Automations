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

  // Selectors verified against live Upwork messaging DOM (Feb 2026)
  const convoJson = await d.executeJS(`
    (function() {
      var conversations = [];
      var items = document.querySelectorAll('a.room-list-item');

      items.forEach(function(item) {
        try {
          var nameEl = item.querySelector('.item-title');
          var name = nameEl ? nameEl.innerText.trim() : '';

          var jobEl = item.querySelector('.item-subtitle');
          var jobTitle = jobEl ? jobEl.innerText.trim() : '';

          var msgEl = item.querySelector('.room-list-item-story, .last-message');
          var lastMsg = msgEl ? msgEl.innerText.trim().substring(0, 100) : '';

          var timeEl = item.querySelector('.timestamp, time, [class*="date"]');
          var time = timeEl ? timeEl.innerText.trim() : '';

          var unread = item.classList.contains('is-unread') ||
                       !!item.querySelector('.unread-badge, .badge-count');

          var roomUrl = item.href || '';
          var roomMatch = roomUrl.match(/rooms\\/(room_[a-f0-9]+)/);
          var roomId = roomMatch ? roomMatch[1] : '';

          if (name) {
            conversations.push(JSON.stringify({
              id: roomId || Date.now().toString(),
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

  // Selectors verified against live Upwork messaging DOM (Feb 2026)
  const msgsJson = await d.executeJS(`
    (function() {
      var messages = [];
      var storyItems = document.querySelectorAll('.up-d-story-item');

      var count = 0;
      storyItems.forEach(function(item) {
        if (count >= ${limit}) return;
        try {
          var fullText = item.innerText.trim();
          if (!fullText || fullText.length < 3) return;

          // Parse sender + time from the story item header
          // Format: "SenderName HH:MM AM/PM message text"
          var headerEl = item.querySelector('.story-header, .up-d-story-header');
          var sender = '';
          var time = '';
          if (headerEl) {
            sender = headerEl.innerText.trim();
          } else {
            // Try to parse from full text
            var match = fullText.match(/^(.+?)\\s+(\\d{1,2}:\\d{2}\\s*(?:AM|PM))/);
            if (match) {
              sender = match[1];
              time = match[2];
            }
          }

          // Get message body (everything after sender/time)
          var bodyEl = item.querySelector('.up-d-story-body, .story-body, .rr-mask');
          var body = bodyEl ? bodyEl.innerText.trim() : fullText;

          // Determine if outbound (from current user - typically "Isaiah Dupree" or "You:")
          var isOutbound = fullText.startsWith('Isaiah') || fullText.startsWith('You:');

          if (body) {
            messages.push(JSON.stringify({
              id: 'msg_' + count,
              from: sender || 'unknown',
              content: body.substring(0, 500),
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
      var items = document.querySelectorAll('a.room-list-item');
      for (var item of items) {
        var nameEl = item.querySelector('.item-title');
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

  // Focus message input — Upwork uses TipTap/ProseMirror contenteditable
  const focused = await d.executeJS(`
    (function() {
      var selectors = [
        '.composer .tiptap.ProseMirror',
        '.composer [contenteditable="true"]',
        '.composer-container [contenteditable="true"]',
        '.up-d-composer [contenteditable="true"]',
        '[role="textbox"][contenteditable="true"]',
      ];
      for (var sel of selectors) {
        var el = document.querySelector(sel);
        if (el) {
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

  // Click send button — Upwork uses air3-btn-circle in the composer
  const sent = await d.executeJS(`
    (function() {
      var selectors = [
        '.up-d-composer button.air3-btn-circle',
        '.composer-container button.air3-btn-circle',
        'button[aria-label*="Send"]',
        '.up-d-composer button',
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

  // Verify message was sent by checking last story item
  const snippet = text.substring(0, 30).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const verified = await d.executeJS(`
    (function() {
      var items = document.querySelectorAll('.up-d-story-item');
      var lastItem = items[items.length - 1];
      if (lastItem) {
        var content = lastItem.innerText.trim();
        if (content.includes('${snippet}')) return 'verified';
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
      // Check nav badge
      var navBadge = document.querySelector('.nav-messages .badge-count, .nav-messages .count');
      if (navBadge) return navBadge.innerText.trim();

      // Count unread room-list-items
      var unread = document.querySelectorAll('a.room-list-item.is-unread');
      return String(unread.length);
    })()
  `);

  return parseInt(countStr) || 0;
}
