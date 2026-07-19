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

// ─── Helpers ─────────────────────────────────────────────────

// LinkedIn sometimes shows a "Grow Your Business with Premium" upsell modal
// (.modal-upsell) that blocks the messaging UI. Dismiss it if present.
async function dismissPremiumModal(d: SafariDriver): Promise<void> {
  await d.executeJS(`
    (function(){
      var modal = document.querySelector('.modal-upsell, [data-test-modal].artdeco-modal');
      if (!modal) return;
      var closeBtn = modal.querySelector('button[data-test-modal-close-btn]')
                  || modal.querySelector('button[aria-label]')
                  || modal.querySelector('button');
      if (closeBtn) closeBtn.click();
    })()
  `);
  await d.wait(300);
}

// ─── Navigation ──────────────────────────────────────────────

export async function navigateToMessaging(driver?: SafariDriver): Promise<NavigationResult> {
  const d = driver || getDefaultDriver();
  const success = await d.navigateTo(LINKEDIN_MESSAGING);
  if (!success) return { success: false, error: 'Failed to navigate to messaging' };

  // Wait for messaging UI to load (app-loader--default may persist — check for actual UI elements)
  const ready = await d.waitForCondition(
    `(function(){return document.querySelector('.msg-overlay-list-bubble, .scaffold-layout__aside, .msg-conversations-container')?'ready':'';})()`,
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
//
// Multi-strategy button detection: scrollIntoView before measuring rect to handle
// buttons that are in the viewport but below initial fold.
// Falls back to messaging inbox if the profile Message button is not found.

export async function sendMessageToProfile(
  profileUrl: string,
  text: string,
  driver?: SafariDriver
): Promise<SendMessageResult> {
  const d = driver || getDefaultDriver();
  const log = (msg: string) => console.log(`[DM] ${msg}`);

  // ── Step 1: Activate the LinkedIn tab so it's visible ──
  // LinkedIn detects document.hidden and throttles React rendering when in background.
  // The tab MUST be the active, frontmost tab before navigating.
  const session = await d.ensureActiveSession('linkedin.com').catch(() => null);
  if (session) {
    await d.activateTab(session.windowIndex, session.tabIndex);
    await d.wait(300);
  }

  // ── Step 2: Navigate to profile page ──
  const url = profileUrl.startsWith('http') ? profileUrl : `https://www.linkedin.com/in/${profileUrl}/`;
  log(`Navigating to profile: ${url}`);
  await d.navigateTo(url);

  // Wait for profile page: first check main mounts, then wait for action buttons.
  // NOTE: LinkedIn keeps app-loader--default on <html> even after content loads — do NOT check it.
  const appReady = await d.waitForCondition(
    `(function(){
      // Need both <main> AND at least one action button to be rendered
      var hasMain = !!document.querySelector('main');
      if (!hasMain) return '';
      var scope = document.querySelector('main section.artdeco-card') || document.querySelector('main section') || document.querySelector('main');
      if (!scope) return '';
      var hasButtons = scope.querySelectorAll('button, a[href*="messaging"], a[href*="connect"]').length > 0;
      return hasButtons ? 'ready' : '';
    })()`,
    20000
  );
  if (!appReady) {
    return { success: false, error: 'Profile page did not fully load' };
  }

  // Extra wait for SPA to fully hydrate action buttons
  await d.wait(800);

  // Scroll to top so action section is visible
  await d.executeJS('window.scrollTo(0, 0)');
  await d.wait(300);

  // ── Step 2a: Detect profile button state and persist to Supabase ──
  const btnState = await detectProfileButtons(url, d);
  log(`Profile buttons — Message:${btnState.hasMessage} Connect:${btnState.hasConnect} Follow:${btnState.hasFollow} degree:${btnState.connectionDegree || '?'} raw:[${btnState.rawButtons.join(', ')}]`);
  // Premium-wall check will be done after attempting the Message button click (see Step 4).
  // Save now without premium_wall flag (will upsert again if wall is detected).
  saveProfileButtonState(btnState, false).catch(() => {});

  // ── Step 2b: Find Message button — scoped to profile card only ──
  // IMPORTANT: search within main > section only — LinkedIn's fixed top nav also has
  // a[href*="interop=msgOverlay"] (the compose icon) which is at y≈27 and must be excluded.
  const messageAnchorInfo = await d.executeJS(`
    (function() {
      // Scope to the profile card section — first artdeco-card inside main
      var scope = document.querySelector('main section.artdeco-card')
               || document.querySelector('main section')
               || document.querySelector('main');
      if (!scope) return JSON.stringify({found: false, connStatus: 'no_main'});

      // Strategy 1: interop=msgOverlay href inside profile card
      var s1 = scope.querySelectorAll('a[href*="interop=msgOverlay"]');
      for (var i = 0; i < s1.length; i++) {
        s1[i].scrollIntoView({block: 'center', behavior: 'instant'});
        var r = s1[i].getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && r.y > 60) {
          return JSON.stringify({found: true, x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2), href: s1[i].href, strategy: 1});
        }
      }

      // Strategy 2: aria-label containing "message" inside profile card
      var s2 = scope.querySelectorAll('button[aria-label*="essage" i], a[aria-label*="essage" i]');
      for (var i = 0; i < s2.length; i++) {
        var lbl = (s2[i].getAttribute('aria-label') || '').toLowerCase();
        if (!lbl.includes('message') || lbl.includes('see all') || lbl.includes('inbox')) continue;
        s2[i].scrollIntoView({block: 'center', behavior: 'instant'});
        var r = s2[i].getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && r.y > 60) {
          return JSON.stringify({found: true, x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2), href: s2[i].href || '', strategy: 2});
        }
      }

      // Strategy 3: button text exactly "Message" inside profile card
      var btns = scope.querySelectorAll('button');
      for (var i = 0; i < btns.length; i++) {
        if (btns[i].innerText.trim() === 'Message') {
          btns[i].scrollIntoView({block: 'center', behavior: 'instant'});
          var r = btns[i].getBoundingClientRect();
          if (r.width > 0 && r.height > 0 && r.y > 60) {
            return JSON.stringify({found: true, x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2), href: '', strategy: 3});
          }
        }
      }

      // Strategy 4: data-control-name contains "message" inside profile card
      var s4 = scope.querySelectorAll('[data-control-name*="message"]');
      for (var i = 0; i < s4.length; i++) {
        s4[i].scrollIntoView({block: 'center', behavior: 'instant'});
        var r = s4[i].getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && r.y > 60) {
          return JSON.stringify({found: true, x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2), href: s4[i].getAttribute('href') || '', strategy: 4});
        }
      }

      // Detect connection status for better error message
      var bodyText = scope.innerText.toLowerCase();
      var connStatus = bodyText.includes('pending') ? 'pending'
        : (bodyText.includes('connect') && !bodyText.includes('message')) ? 'not_connected'
        : 'unknown';
      return JSON.stringify({found: false, connStatus: connStatus});
    })()
  `);

  let anchorInfo: any;
  try { anchorInfo = JSON.parse(messageAnchorInfo); } catch {
    return { success: false, error: 'Failed to parse message anchor info' };
  }

  if (!anchorInfo.found) {
    const connStatus = anchorInfo.connStatus || 'unknown';
    log(`Message button not found (connection status: ${connStatus})`);

    if (connStatus === 'pending') {
      return { success: false, error: 'Connection request pending — cannot message yet' };
    }
    if (connStatus === 'not_connected') {
      return { success: false, error: 'Not connected — cannot message (not 1st degree)' };
    }

    // Fallback: search messaging inbox (handles existing conversations)
    log('Falling back to messaging inbox search...');
    return _sendViaMessagingInbox(text, profileUrl, d);
  }

  log(`Found Message button via strategy ${anchorInfo.strategy} at viewport (${anchorInfo.x}, ${anchorInfo.y})`);

  // ── Step 3: Navigate to the compose URL directly ──
  // Native AppleScript clicks don't reliably trigger LinkedIn's SPA event handler,
  // so instead we navigate directly to the href (includes interop=msgOverlay).
  // LinkedIn's router handles this URL and pre-opens the compose overlay on load.
  if (anchorInfo.href && anchorInfo.href.includes('messaging')) {
    log(`Navigating to compose URL: ${anchorInfo.href.substring(0, 80)}...`);
    await d.navigateTo(anchorInfo.href);
  } else {
    // No valid href — fall back to native click
    log('No compose href — falling back to native click');
    const clicked = await d.clickAtViewportPosition(anchorInfo.x, anchorInfo.y);
    if (!clicked) {
      return { success: false, error: 'Failed to click Message button' };
    }
    log('Clicked Message button with native click');
  }

  // ── Step 4: Wait for message input ──
  // Works for both the overlay bubble and full compose page
  const inputReady = await d.waitForCondition(
    `(function(){
      var el = document.querySelector('.msg-form__contenteditable, [role="textbox"][contenteditable="true"], .msg-convo-wrapper [contenteditable="true"], [contenteditable="true"]');
      return (el && el.offsetParent !== null) ? 'ready' : '';
    })()`,
    12000
  );

  if (!inputReady) {
    // Check for LinkedIn Premium paywall prompt before falling back
    const isWall = await detectPremiumWall(profileUrl, d);
    if (isWall) {
      log('LinkedIn Premium paywall detected — saving to Supabase');
      await saveProfileButtonState({ ...btnState, profileUrl: url }, true);
      return { success: false, error: 'LinkedIn Premium required to message this contact' };
    }

    // Fallback: use openNewCompose (messaging inbox → compose button → search name → send)
    log('Compose URL did not show input — falling back to openNewCompose...');
    const slug = profileUrl.split('/in/')[1]?.replace(/\/$/, '') || '';
    const recipientName = slug.replace(/-/g, ' ');
    return openNewCompose(recipientName, text, d);
  }

  // Focus the input
  await d.executeJS(`
    (function(){
      var el = document.querySelector('.msg-form__contenteditable')
            || document.querySelector('[role="textbox"][contenteditable="true"]')
            || document.querySelector('[contenteditable="true"]');
      if (el) { el.focus(); el.click(); }
    })()
  `);
  await d.wait(400);

  // ── Step 5: Type message via clipboard ──
  const typeResult = await d.typeViaClipboard(text);
  if (!typeResult.success) return { success: false, error: 'Failed to type message' };
  log(`Typed message using method: ${typeResult.method}`);
  await d.wait(1000);

  // ── Step 6: Click Send ──
  // Try class-based selector first, then innerText scan, then Enter fallback
  const sendAttempt = await d.executeJS(`
    (function(){
      var btn = document.querySelector('.msg-form__send-button:not([disabled])');
      if (btn) { btn.click(); return 'class'; }
      var btns = document.querySelectorAll('button');
      for (var i = 0; i < btns.length; i++) {
        if (btns[i].innerText.trim() === 'Send' && !btns[i].disabled) { btns[i].click(); return 'text'; }
      }
      return 'not_found';
    })()
  `);

  if (sendAttempt === 'not_found') {
    // Button may still be disabled — wait for it
    const sendEnabled = await d.waitForCondition(
      `(function(){
        var btn = document.querySelector('.msg-form__send-button:not([disabled])');
        if (btn) return 'ready';
        var btns = document.querySelectorAll('button');
        for (var i = 0; i < btns.length; i++) {
          if (btns[i].innerText.trim() === 'Send' && !btns[i].disabled) return 'ready';
        }
        return '';
      })()`,
      5000
    );
    if (sendEnabled) {
      await d.executeJS(`
        (function(){
          var btn = document.querySelector('.msg-form__send-button:not([disabled])');
          if (btn) { btn.click(); return; }
          var btns = document.querySelectorAll('button');
          for (var i = 0; i < btns.length; i++) {
            if (btns[i].innerText.trim() === 'Send' && !btns[i].disabled) { btns[i].click(); return; }
          }
        })()
      `);
      log('Clicked Send (after wait)');
    } else {
      await d.pressEnter();
      log('Send button not found — pressed Enter as fallback');
    }
  } else {
    log(`Clicked Send (${sendAttempt})`);
  }

  await d.wait(2000);

  // ── Step 7: Verify message appeared ──
  // Use JSON.stringify for the check text to safely escape all special chars
  const checkText = text.substring(0, 20);
  const verification = await d.executeJS(`
    (function() {
      var check = ${JSON.stringify(checkText)};
      var msgs = document.querySelectorAll('.msg-s-event-listitem__body, .msg-s-message-group__text');
      var verified = false;
      for (var i = msgs.length - 1; i >= Math.max(0, msgs.length - 5); i--) {
        if (msgs[i].innerText.trim().indexOf(check) >= 0) { verified = true; break; }
      }
      var recipient = '';
      var nameEl = document.querySelector('.msg-thread__link-to-profile, .msg-entity-lockup__entity-title, h2.msg-overlay-bubble-header__title');
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

// ─── Profile Button State Detection ─────────────────────────
// Scans a loaded LinkedIn profile page for action buttons (Message/Connect/Follow/More)
// and detects whether clicking Message triggers a LinkedIn Premium paywall prompt.
// Results are persisted to the linkedin_profile_buttons Supabase table.

export interface ProfileButtonState {
  profileUrl:        string;
  name?:             string;
  hasMessage:        boolean;
  hasConnect:        boolean;
  hasFollow:         boolean;
  hasMore:           boolean;
  connectionDegree?: string;   // '1st', '2nd', '3rd', 'out_of_network'
  rawButtons:        string[];
}

export async function detectProfileButtons(
  profileUrl: string,
  driver?: SafariDriver
): Promise<ProfileButtonState> {
  const d = driver || getDefaultDriver();

  const raw = await d.executeJS(`
    (function() {
      var scope = document.querySelector('main section.artdeco-card')
               || document.querySelector('main section')
               || document.querySelector('main');
      if (!scope) return JSON.stringify({error: 'no_main'});

      // Collect all visible button / anchor texts in the profile action row
      var labels = [];
      var btns = scope.querySelectorAll('button, a[role="button"]');
      for (var i = 0; i < btns.length; i++) {
        var r = btns[i].getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && r.y > 60 && r.y < 600) {
          var lbl = (btns[i].getAttribute('aria-label') || btns[i].innerText || '').trim();
          if (lbl) labels.push(lbl);
        }
      }

      // Connection degree
      var degEl = document.querySelector('.dist-value, [class*="distance"]');
      var degree = degEl ? degEl.innerText.trim() : '';
      // Also check profile headline area for "• 1st •" pattern
      if (!degree) {
        var bodyText = (scope.innerText || '');
        var m = bodyText.match(/\\b(1st|2nd|3rd)\\b/);
        if (m) degree = m[1];
      }

      var lower = labels.map(function(l) { return l.toLowerCase(); });
      return JSON.stringify({
        labels: labels,
        hasMessage: lower.some(function(l) { return l === 'message' || l.includes('send a message'); }),
        hasConnect: lower.some(function(l) { return l === 'connect' || l.includes('connect with'); }),
        hasFollow:  lower.some(function(l) { return l === 'follow' || l === 'unfollow'; }),
        hasMore:    lower.some(function(l) { return l === 'more' || l === '…'; }),
        degree: degree,
      });
    })()
  `);

  let parsed: any = {};
  try { parsed = JSON.parse(raw); } catch { /* ignore */ }

  return {
    profileUrl,
    hasMessage:        !!parsed.hasMessage,
    hasConnect:        !!parsed.hasConnect,
    hasFollow:         !!parsed.hasFollow,
    hasMore:           !!parsed.hasMore,
    connectionDegree:  parsed.degree || undefined,
    rawButtons:        parsed.labels || [],
  };
}

export async function detectPremiumWall(
  profileUrl: string,
  driver?: SafariDriver
): Promise<boolean> {
  const d = driver || getDefaultDriver();
  // After clicking Message, LinkedIn may show a modal asking to upgrade to Premium.
  // We check for this within 3 seconds — if found, the contact requires Premium to message.
  const wall = await d.waitForCondition(
    `(function(){
      var modal = document.querySelector('[data-test-modal], [role="dialog"]');
      if (!modal) return '';
      var txt = modal.innerText.toLowerCase();
      return (txt.includes('premium') || txt.includes('upgrade') || txt.includes('inmailcredit')) ? 'wall' : '';
    })()`,
    3000
  );
  return wall === 'wall';
}

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ivhfuhxorppptyuofbgq.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';

export async function saveProfileButtonState(
  state: ProfileButtonState,
  premiumWall: boolean
): Promise<void> {
  if (!SUPABASE_KEY) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/linkedin_profile_buttons`, {
      method: 'POST',
      headers: {
        'Content-Type':    'application/json',
        'apikey':          SUPABASE_KEY,
        'Authorization':   `Bearer ${SUPABASE_KEY}`,
        'Prefer':          'resolution=merge-duplicates',
      },
      body: JSON.stringify({
        profile_url:       state.profileUrl,
        name:              state.name || null,
        checked_at:        new Date().toISOString(),
        has_message:       state.hasMessage,
        has_connect:       state.hasConnect,
        has_follow:        state.hasFollow,
        has_more:          state.hasMore,
        premium_wall:      premiumWall,
        premium_wall_checked_at: premiumWall ? new Date().toISOString() : null,
        connection_degree: state.connectionDegree || null,
        raw_buttons:       state.rawButtons,
      }),
    });
  } catch { /* non-fatal */ }
}

// ─── Fallback: send via messaging inbox ──────────────────────
// Used when the profile page Message button isn't found (e.g. existing conversation
// or LinkedIn rendered a different profile layout).

async function _sendViaMessagingInbox(
  text: string,
  profileUrl: string,
  d: SafariDriver
): Promise<SendMessageResult> {
  const log = (msg: string) => console.log(`[DM:inbox] ${msg}`);
  const slug = profileUrl.split('/in/')[1]?.replace(/\/$/, '') || '';
  const searchName = slug.replace(/-/g, ' ');

  log(`Searching inbox for: ${searchName}`);
  await d.navigateTo('https://www.linkedin.com/messaging/');

  const inboxReady = await d.waitForCondition(
    `(function(){return document.querySelector('.msg-overlay-list-bubble, .scaffold-layout__aside, .msg-conversations-container')?'ready':'';})()`,
    10000
  );
  if (!inboxReady) {
    return { success: false, error: 'Messaging inbox did not load' };
  }

  await dismissPremiumModal(d);

  const found = await openConversation(searchName, d);
  if (!found) {
    return { success: false, error: `No conversation found for ${searchName} — not connected or no prior messages` };
  }

  await d.wait(500);
  return sendMessage(text, d);
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

  // ── Step 1: Activate tab + navigate to messaging page ──
  // LinkedIn throttles rendering when the tab is in background (document.hidden)
  const sess = await d.ensureActiveSession('linkedin.com').catch(() => null);
  if (sess) {
    await d.activateTab(sess.windowIndex, sess.tabIndex);
    await d.wait(300);
  }

  log(`Navigating to messaging...`);
  await d.navigateTo('https://www.linkedin.com/messaging/');

  // Wait for LinkedIn messaging UI to mount.
  // NOTE: LinkedIn often keeps app-loader--default on <html> even after the page is fully loaded
  // (known LinkedIn SPA quirk). We check for the actual UI elements instead.
  const messagingReady = await d.waitForCondition(
    `(function(){
      var el = document.querySelector('.msg-overlay-list-bubble, .scaffold-layout__aside, .msg-conversations-container');
      return el ? 'ready' : '';
    })()`,
    15000
  );

  if (!messagingReady) {
    return { success: false, error: 'Messaging page did not load' };
  }

  // Dismiss any Premium upsell modal that may be blocking the UI
  await dismissPremiumModal(d);

  // ── Step 2: Find and click compose button ──
  const composeButtonInfo = await d.executeJS(`
    (function() {
      // Strategy 1: data-control-name or aria-label
      var btns = document.querySelectorAll('[data-control-name=compose], button[aria-label*="Compose"], a[aria-label*="Compose"]');
      for (var i = 0; i < btns.length; i++) {
        var rect = btns[i].getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          return JSON.stringify({found: true, x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2), strategy: 1});
        }
      }
      // Strategy 2: innerText contains "compose" (LinkedIn renders pencil button with text, no aria-label)
      var allBtns = document.querySelectorAll('button, a[role="button"]');
      for (var i = 0; i < allBtns.length; i++) {
        var txt = allBtns[i].innerText.trim().toLowerCase();
        if (txt.includes('compose')) {
          var rect = allBtns[i].getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            return JSON.stringify({found: true, x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2), strategy: 2, text: allBtns[i].innerText.trim().substring(0, 30)});
          }
        }
      }
      // Strategy 3: SVG pencil icon buttons in the messaging aside panel
      var asidePanel = document.querySelector('.scaffold-layout__aside, .msg-overlay-list-bubble');
      if (asidePanel) {
        var panelBtns = asidePanel.querySelectorAll('button');
        for (var i = 0; i < panelBtns.length; i++) {
          var rect = panelBtns[i].getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0 && rect.width < 60 && rect.height < 60) {
            // Small icon buttons in the panel are typically compose/filter
            var lbl = panelBtns[i].getAttribute('aria-label') || '';
            if (lbl.toLowerCase().includes('compos') || lbl.toLowerCase().includes('new')) {
              return JSON.stringify({found: true, x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2), strategy: 3, label: lbl});
            }
          }
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
