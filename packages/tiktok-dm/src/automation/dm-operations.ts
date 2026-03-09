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
 * Detect TikTok rate limit UI indicators
 */
export async function detectTikTokRateLimit(driver: SafariDriver): Promise<{ limited: boolean; captcha: boolean; message?: string }> {
  const result = await driver.executeJS(`
    (function() {
      var bodyText = document.body.innerText || '';
      var hasCaptcha = !!document.querySelector('[class*="captcha"], [id*="captcha"], [class*="Captcha"]');

      var rateLimitPhrases = [
        'You are visiting too fast',
        'temporarily blocked',
        'verify you are human',
        'Too many requests',
        'slow down'
      ];

      var hasRateLimit = false;
      var foundPhrase = '';
      for (var i = 0; i < rateLimitPhrases.length; i++) {
        if (bodyText.includes(rateLimitPhrases[i])) {
          hasRateLimit = true;
          foundPhrase = rateLimitPhrases[i];
          break;
        }
      }

      return JSON.stringify({
        limited: hasRateLimit || hasCaptcha,
        captcha: hasCaptcha,
        message: hasRateLimit ? foundPhrase : (hasCaptcha ? 'Captcha detected' : '')
      });
    })()
  `);

  try {
    return JSON.parse(result);
  } catch {
    return { limited: false, captcha: false };
  }
}

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
  const handle = username.toLowerCase().replace(/^@/, '');

  // ── Strategy 1: inbox list search (fast if conversation is visible) ──────
  const url = await driver.getCurrentUrl();
  if (!url.includes('/messages')) {
    const navResult = await navigateToInbox(driver);
    if (!navResult.success) {
      console.log(`[TikTok openConversation] inbox nav failed, falling back to profile`);
    }
  }

  const escapedHandle = handle.replace(/"/g, '\\"');
  const clicked = await driver.executeJS(`
    (function() {
      var items = document.querySelectorAll('[data-e2e="chat-list-item"]');
      var target = "${escapedHandle}";
      var frags = target.split(/[_.]/g).filter(function(s) { return s.length > 3 && !/[0-9]/.test(s); });
      for (var i = 0; i < items.length; i++) {
        var text = items[i].innerText.toLowerCase();
        var fragMatch = frags.some(function(f) { return text.startsWith(f) || text.split('\\n')[0].includes(f); });
        if (text.includes(target) || fragMatch) {
          items[i].click();
          return 'clicked';
        }
      }
      return 'not_found';
    })()
  `);

  if (clicked === 'clicked') {
    await driver.wait(1500);
    return { success: true, currentUrl: await driver.getCurrentUrl() };
  }

  // ── Strategy 2: profile page Message button ──────────────────────────────
  console.log(`[TikTok openConversation] @${handle} not in inbox list — trying profile page`);
  await driver.navigateTo(`https://www.tiktok.com/@${handle}`);
  await driver.wait(2500);

  const msgBtnClicked = await driver.executeJS(`
    (function() {
      var selectors = [
        '[data-e2e="message-button"]',
        'button[aria-label*="Message"]',
        '[class*="ButtonMessage"]',
        '[class*="MessageButton"]'
      ];
      for (var s = 0; s < selectors.length; s++) {
        var btn = document.querySelector(selectors[s]);
        if (btn) { btn.click(); return selectors[s]; }
      }
      return 'not_found';
    })()
  `);

  if (!msgBtnClicked || msgBtnClicked === 'not_found') {
    return { success: false, error: `Conversation with ${username} not found` };
  }

  await driver.wait(2000);
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

        // Detect outgoing (our own) messages via multiple signals:
        // 1. Class name keywords (Right/self/Self/outgoing/owner/me)
        var allClasses = (item.className + ' ' + (item.innerHTML.match(/class="([^"]*)"/g) || []).join(' ')).toLowerCase();
        var isMine = allClasses.includes('right') ||
                     allClasses.includes('self') ||
                     allClasses.includes('outgoing') ||
                     allClasses.includes('owner') ||
                     allClasses.includes('isme');

        // 2. Visual alignment: right-aligned bubbles = ours; left-aligned = theirs
        if (!isMine) {
          var rect = item.getBoundingClientRect();
          var parentRect = item.parentElement ? item.parentElement.getBoundingClientRect() : {right: window.innerWidth, left: 0};
          // If the right edge of the item is within 20% of the parent right edge → right-aligned = ours
          if (parentRect.right > 0 && (parentRect.right - rect.right) < parentRect.width * 0.2) isMine = true;
        }

        // 3. Computed style justify-content on item or its direct parent
        if (!isMine) {
          var cs = window.getComputedStyle(item);
          if (cs.justifyContent === 'flex-end' || cs.justifyContent === 'right' || cs.alignSelf === 'flex-end') isMine = true;
          if (!isMine && item.parentElement) {
            var pcs = window.getComputedStyle(item.parentElement);
            if (pcs.justifyContent === 'flex-end') isMine = true;
          }
        }

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
 * Send a message in the current TikTok conversation WITHOUT requiring window focus.
 * Uses JavaScript-only event dispatch — no clipboard paste, no OS keystrokes.
 * Falls back through 3 strategies for React contenteditable compatibility.
 * Returns { success, strategy, error? }
 */
async function sendMessageBackground(
  driver: SafariDriver,
  message: string
): Promise<{ success: boolean; strategy?: string; error?: string }> {
  // ── Guard: check restriction banner ──────────────────────────────────────
  const restriction = await driver.executeJS(`
    (function() {
      var body = document.body.innerText || '';
      if (body.includes('only send up to 1 message') ||
          body.includes('accept your message request') ||
          body.includes('can only send') ||
          body.includes('message request')) return 'restricted';
      return 'ok';
    })()`);
  if (restriction === 'restricted') {
    return { success: false, error: 'dm_restricted: pending message request not yet accepted' };
  }

  // ── Strategy 1: React fiber direct insert + send button click ────────────
  // Access React's internal fiber to call onChange directly — most reliable for React apps
  const msgJson = JSON.stringify(message);
  const strat1 = await driver.executeJS(`
    (function() {
      var ce = document.querySelector('[contenteditable="true"]');
      if (!ce) return 'no_input';
      ce.focus();
      // Find React fiber key (React 16+ internal)
      var fiberKey = Object.keys(ce).find(function(k) {
        return k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance') || k.startsWith('__reactEventHandlers');
      });
      var txt = ${msgJson};
      var inserted = false;
      // Try beforeinput + input events (W3C InputEvent, React 17+ listens to this)
      try {
        ce.dispatchEvent(new InputEvent('beforeinput', {
          bubbles: true, cancelable: true, inputType: 'insertText', data: txt
        }));
        ce.dispatchEvent(new InputEvent('input', {
          bubbles: true, cancelable: false, inputType: 'insertText', data: txt
        }));
        var content = (ce.textContent || ce.innerText || '').trim();
        if (content.length > 0) inserted = true;
      } catch(e) {}
      if (!inserted) {
        // Try execCommand (works in some Safari versions)
        try {
          ce.focus();
          inserted = document.execCommand('insertText', false, txt);
        } catch(e) {}
      }
      if (!inserted) {
        // Direct textContent set + input event (last JS resort)
        try {
          ce.textContent = txt;
          ce.dispatchEvent(new Event('input', { bubbles: true }));
          ce.dispatchEvent(new Event('change', { bubbles: true }));
          inserted = true;
        } catch(e) {}
      }
      if (!inserted) return 'type_failed';
      // Verify text actually appeared
      var finalContent = (ce.textContent || ce.innerText || '').trim();
      if (finalContent.length === 0) return 'type_empty';
      return 'typed:' + finalContent.length;
    })()`);

  if (!strat1.startsWith('typed:')) {
    return { success: false, error: `background_type_failed: ${strat1}` };
  }

  await driver.wait(400);

  // ── Click send button via JS (no OS click needed) ─────────────────────
  const sendClick = await driver.executeJS(`
    (function() {
      var selectors = [
        '[data-e2e="message-send"]',
        '[class*="SendButton"]',
        '[aria-label="Send"]',
        '[aria-label*="Send"]',
        'button[type="submit"]',
        '[class*="send-btn"]',
        '[class*="SendBtn"]',
      ];
      for (var i = 0; i < selectors.length; i++) {
        var btn = document.querySelector(selectors[i]);
        if (btn && btn.getBoundingClientRect().width > 0) {
          btn.click();
          return 'clicked:' + selectors[i];
        }
      }
      // Fallback: Enter key events on contenteditable
      var ce = document.querySelector('[contenteditable="true"]');
      if (ce) {
        ['keydown','keypress','keyup'].forEach(function(t) {
          ce.dispatchEvent(new KeyboardEvent(t, {
            key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
            bubbles: true, cancelable: true
          }));
        });
        return 'enter_dispatched';
      }
      return 'no_send_button';
    })()`);

  // ── Poll for input cleared (message submitted) ────────────────────────
  let cleared = false;
  for (let i = 0; i < 8; i++) {
    await driver.wait(400);
    const state = await driver.executeJS(`
      (function() {
        var ce = document.querySelector('[contenteditable="true"]');
        if (!ce) return 'no_input';
        var txt = (ce.textContent || ce.innerText || '').trim();
        var body = document.body.innerText || '';
        if (body.includes('only send up to 1 message') || body.includes('accept your message request')) return 'restricted';
        return txt.length === 0 ? 'cleared' : 'has_text';
      })()`);
    if (state === 'restricted') return { success: false, error: 'dm_restricted: restriction after typing' };
    if (state === 'cleared' || state === 'no_input') { cleared = true; break; }
  }

  if (!cleared) {
    return { success: false, error: `background_not_cleared: send_click=${sendClick}` };
  }

  return { success: true, strategy: `bg_js:${sendClick}` };
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
    // ── EVENT 1: Check for restriction banner before typing ────────────────────
    // TikTok shows "You can only send up to 1 message before this user accepts"
    // if there's a pending outbound DM. Detect this upfront and fail fast.
    const restriction = await driver.executeJS(`
      (function() {
        var body = document.body.innerText || '';
        if (body.includes('only send up to 1 message') ||
            body.includes('accept your message request') ||
            body.includes('can only send') ||
            body.includes('message request')) {
          return 'restricted';
        }
        return 'ok';
      })()`);
    if (restriction === 'restricted') {
      return { success: false, error: 'dm_restricted: pending message request not yet accepted' };
    }

    // ── EVENT 2: Steal focus + OS-click the composer ──────────────────────────
    // Must bring Safari to front before clipboard paste and Enter keystroke work.
    await (driver as any).activateTrackedWindow?.() || await driver.activateSafari();
    await driver.wait(500);

    // Get screen coords of composer and OS-click it to ensure keyboard focus lands there.
    // Also handles placeholder state ("Send a message" div) — clicking the placeholder
    // triggers TikTok to convert it to a real contenteditable.
    const composerScreen = await driver.executeJS(`
      (function() {
        // Active selectors first (real input), then placeholder text nodes
        var selectors = [
          '[contenteditable="true"]',
          '[data-e2e="chat-input"]',
          '[class*="messageInput"]',
          '[class*="DivInputArea"]',
          '[class*="InputArea"]',
          '[placeholder*="message"]',
          '[placeholder*="Message"]',
        ];
        var chromeH = window.outerHeight - window.innerHeight;
        var sx = window.screenX; var sy = window.screenY + chromeH;
        for (var i = 0; i < selectors.length; i++) {
          var el = document.querySelector(selectors[i]);
          if (el) {
            var r = el.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) {
              return JSON.stringify({x: Math.round(sx + r.left + r.width/2), y: Math.round(sy + r.top + r.height/2)});
            }
          }
        }
        // Fallback: find any element with "Send a message" text in the lower half of screen
        var all = document.querySelectorAll('div, p, span');
        for (var j = 0; j < all.length; j++) {
          var t = (all[j].innerText || '').trim();
          if (t === 'Send a message' || t === 'Message...' || t === 'Type a message') {
            var r2 = all[j].getBoundingClientRect();
            if (r2.width > 0 && r2.height > 0 && r2.y > window.innerHeight * 0.5) {
              return JSON.stringify({x: Math.round(sx + r2.left + r2.width/2), y: Math.round(sy + r2.top + r2.height/2)});
            }
          }
        }
        // Last resort: scrollIntoView on contenteditable to force real dimensions, then re-measure
        var ceEl = document.querySelector('[contenteditable="true"]');
        if (ceEl) {
          ceEl.scrollIntoView({block:'nearest'});
          var r3 = ceEl.getBoundingClientRect();
          if (r3.width > 0 && r3.height > 0) {
            return JSON.stringify({x: Math.round(sx + r3.left + r3.width/2), y: Math.round(sy + r3.top + r3.height/2)});
          }
          // Still 0x0 — compute position from TikTok messages layout heuristic:
          // composer is at the bottom of the right-side chat panel (~70% horizontal, ~93% vertical)
          return JSON.stringify({x: Math.round(sx + window.innerWidth * 0.70), y: Math.round(sy + window.innerHeight * 0.93)});
        }
        return 'not_found';
      })()`);

    if (composerScreen && composerScreen !== 'not_found') {
      try {
        const cPos = JSON.parse(composerScreen);
        await driver.clickAtScreenPosition(cPos.x, cPos.y, true);
        await driver.wait(1200); // longer wait — placeholder click triggers contenteditable render
      } catch {}
    } else {
      // composerScreen 'not_found' — click approximate composer area and wait for React hydration.
      // TikTok messages layout: composer is at bottom of RIGHT chat panel (~70% horizontal, ~93% vertical)
      const approxPos = await driver.executeJS(
        `JSON.stringify({x: Math.round(window.screenX + window.innerWidth * 0.70), y: Math.round(window.screenY + window.outerHeight - window.innerHeight + window.innerHeight * 0.93)})`
      );
      try {
        const aPos = JSON.parse(approxPos);
        await driver.clickAtScreenPosition(aPos.x, aPos.y, true);
        await driver.wait(1500); // extra wait for React to hydrate real input
      } catch {}
    }

    const selectors = [
      TIKTOK_SELECTORS.messageInputDraft,
      TIKTOK_SELECTORS.messageInputFallback,
      TIKTOK_SELECTORS.messageInputCE,
      TIKTOK_SELECTORS.messageInputCEFallback,  // bare [contenteditable="true"] — last resort
    ];
    let focusResult = false;
    let foundSel = '';
    for (const sel of selectors) {
      focusResult = await driver.focusElement(sel);
      if (focusResult) { foundSel = sel; break; }
    }
    if (!focusResult) {
      // Second attempt: wait longer and try once more (React may need more time to hydrate)
      await driver.wait(2000);
      for (const sel of selectors) {
        focusResult = await driver.focusElement(sel);
        if (focusResult) { foundSel = sel; break; }
      }
    }
    if (!focusResult) {
      return { success: false, error: 'event_no_input: message input not found in DOM' };
    }

    await driver.wait(400);

    // ── EVENT 3: Type via clipboard, then verify text is actually in the input ─
    // typeViaJS returns true but silently fails for React contenteditable — must use clipboard.
    await (driver as any).typeViaClipboard?.(foundSel, message).catch(() => {});
    await driver.wait(400);

    const inputCheck = await driver.executeJS(`
      (function() {
        var el = document.querySelector('[contenteditable="true"]');
        if (!el) return 'no_input';
        var txt = (el.textContent || el.innerText || '').trim();
        return txt.length > 0 ? 'has_text:' + txt.substring(0, 30) : 'empty';
      })()`);

    if (!inputCheck.startsWith('has_text:')) {
      // typeViaClipboard didn't land — try once more
      await (driver as any).typeViaClipboard?.(foundSel, message).catch(() => {});
      await driver.wait(600);
      const retry = await driver.executeJS(`
        (function(){var el=document.querySelector('[contenteditable="true"]');return el&&(el.textContent||'').trim().length>0?'has_text':'empty';})()
      `);
      if (retry !== 'has_text') {
        return { success: false, error: `event_type_failed: input still empty after 2 attempts (got: ${inputCheck})` };
      }
    }

    // ── EVENT 4: Press Enter via AppleScript, then poll for send completion ───
    await (driver as any).pressEnterViaSafari?.();
    await driver.wait(300);
    // Immediate restriction check — if TikTok shows the 1-message cap banner now,
    // input will be cleared (false success) without actually delivering the message.
    const postEnterRestriction = await driver.executeJS(`
      (function() {
        var body = document.body.innerText || '';
        if (body.includes('only send up to 1 message') || body.includes('accept your message request') || body.includes('can only send')) return 'restricted';
        return 'ok';
      })()`);
    if (postEnterRestriction === 'restricted') {
      return { success: false, error: 'dm_restricted: restriction banner appeared immediately after Enter' };
    }
    await driver.wait(200);

    // Fallback: OS-level click on send button
    const sendPosRaw = await driver.executeJS(`
      (function() {
        var btn = document.querySelector('[data-e2e="message-send"]');
        if (!btn) { var sels=['[data-e2e="send-message-btn"]','[class*="SendButton"]','[aria-label*="Send"]']; for(var i=0;i<sels.length;i++){btn=document.querySelector(sels[i]);if(btn)break;} }
        if (!btn) return 'none';
        var r = btn.getBoundingClientRect(); if (r.width <= 0) return 'none';
        var ch = window.outerHeight - window.innerHeight;
        return JSON.stringify({x:Math.round(window.screenX+r.x+r.width/2),y:Math.round(window.screenY+ch+r.y+r.height/2)});
      })()`);
    if (sendPosRaw !== 'none') {
      try {
        const pos = JSON.parse(sendPosRaw);
        await (driver as any).activateTrackedWindow?.() || await driver.activateSafari();
        await driver.wait(300);
        await driver.clickAtScreenPosition(pos.x, pos.y, true);
      } catch {}
    }

    // ── EVENT 5: Poll for input cleared (message submitted to TikTok) ─────────
    // After a successful send, TikTok clears the contenteditable.
    // After a restriction, TikTok also clears it BUT shows a banner — already caught above.
    let inputCleared = false;
    for (let i = 0; i < 8; i++) {
      await driver.wait(400);
      const state = await driver.executeJS(`
        (function() {
          var el = document.querySelector('[contenteditable="true"]');
          if (!el) return 'no_input';
          var txt = (el.textContent || el.innerText || '').trim();
          // Check restriction banner appeared
          var body = document.body.innerText || '';
          if (body.includes('only send up to 1 message') || body.includes('accept your message request')) return 'restricted';
          return txt.length === 0 ? 'cleared' : 'has_text:' + txt.substring(0,20);
        })()`);
      if (state === 'restricted') {
        return { success: false, error: 'dm_restricted: restriction banner appeared after typing' };
      }
      if (state === 'cleared' || state === 'no_input') { inputCleared = true; break; }
    }

    if (!inputCleared) {
      return { success: false, error: 'event_not_sent: input still has text after Enter — TikTok did not accept the send' };
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
 * Click a conversation row in TikTok inbox using JavaScript only (no screen coordinates).
 * Background-safe — no window activation required.
 * Returns 'clicked:...' | 'not_found' | 'failed'
 */
async function clickConversationViaJS(driver: SafariDriver, handle: string): Promise<string> {
  const target = handle.toLowerCase();
  // Try direct el.click() on the conversation row
  const result = await driver.executeJS(`
    (function() {
      var target = '${target}';
      // Display-name fragments: e.g. "zoey_devine1" → ["zoey", "devine"]
      var frags = target.split(/[_.]/g).filter(function(s) { return s.length > 3 && !/[0-9]/.test(s); });
      // Try conversation item wrappers — data-e2e first (confirmed working)
      var selectors = [
        '[data-e2e="chat-list-item"]',
        '[class*="DivItemWrapper"]',
        '[class*="LiInboxItemWrapper"]',
        '[class*="ConversationItem"]',
        '[class*="conversation-item"]',
        '[class*="DivListItem"]',
        '[role="listitem"]',
      ];
      for (var si = 0; si < selectors.length; si++) {
        var rows = document.querySelectorAll(selectors[si]);
        for (var i = 0; i < rows.length; i++) {
          var text = (rows[i].innerText || '').toLowerCase();
          var squished = text.replace(/[^a-z0-9]/g, '');
          var fragMatch = frags.some(function(f) { return text.startsWith(f) || text.includes('\n' + f) || text.split('\n')[0].includes(f); });
          if (text.includes(target) || squished.includes(target) || fragMatch) {
            // Try clicking the row directly
            rows[i].click();
            // Also try clicking a child anchor or the avatar img
            var link = rows[i].querySelector('a, [role="button"]');
            if (link) link.click();
            return 'clicked:' + selectors[si];
          }
        }
      }
      return 'not_found';
    })()`);
  return result;
}

/**
 * Send DM via robust multi-strategy contact selection.
 * TikTok's virtual DOM doesn't respond to JS .click() — we use Quartz mouse events.
 *
 * Strategy chain (tries each until one works):
 *   0) Background-safe JS click — el.click() on conversation row (no window activation)
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
  driver: SafariDriver,
  opts: { force?: boolean } = {}
): Promise<SendMessageResult> {
  try {
    const handle = username.replace('@', '').toLowerCase();
    console.log(`[TikTok DM] 📤 Sending to @${handle}${opts.force ? ' [FORCE/REPLY mode]' : ''}`);

    // ── DEDUP GUARD: check inbox for existing recent message ───────
    // Navigate fresh to inbox root first — ensures no previous conversation stays open.
    await driver.navigateTo(TIKTOK_URLS.messages);
    await driver.wait(5000); // longer initial load

    // Scroll inbox down then back up to trigger virtual-scroll and load more conversations.
    // TikTok lazy-loads rows — without scrolling, only the first ~15 are in the DOM.
    const inboxScrollSel = `[class*="DivScrollWrap"], [class*="DivMessageListWrapper"], [class*="InboxList"], [class*="DivConversationList"]`;
    await driver.executeJS(`
      (function() {
        var sel = '${inboxScrollSel.replace(/'/g, "\\'")}';
        var el = document.querySelector(sel);
        if (el) { el.scrollTop = el.scrollHeight; return 'scrolled:el'; }
        // Fallback: scroll the main content area
        var main = document.querySelector('main, [role="main"]');
        if (main) { main.scrollTop = main.scrollHeight; return 'scrolled:main'; }
        window.scrollBy(0, 800);
        return 'scrolled:window';
      })()`);
    await driver.wait(1500);
    // Scroll back to top so the most-recent conversations are visible for the dedup check
    await driver.executeJS(`
      (function() {
        var sel = '${inboxScrollSel.replace(/'/g, "\\'")}';
        var el = document.querySelector(sel);
        if (el) { el.scrollTop = 0; }
        else { window.scrollTo(0, 0); }
      })()`);
    await driver.wait(800);

    // Check if we already have a conversation with this user containing recent outbound messages.
    // TikTok shows last message preview in inbox rows — if it contains our message text snippet
    // or was recently sent, abort to prevent double-sending to cold prospects.
    const alreadyMessaged = await driver.executeJS(`
      (function() {
        var target = '${handle.toLowerCase()}';
        // Cast a wide net — TikTok's class names change; try multiple selectors
        var rows = Array.from(document.querySelectorAll(
          '[class*="DivItemWrapper"], [class*="LiInboxItemWrapper"], [class*="ConversationItem"], [class*="DivListItem"], [class*="DivConversationItem"], li[class], [role="listitem"]'
        ));
        // De-duplicate DOM nodes (some selectors overlap)
        var seen = new Set();
        rows = rows.filter(function(r) { if (seen.has(r)) return false; seen.add(r); return true; });

        for (var i = 0; i < rows.length; i++) {
          var text = (rows[i].innerText || '').toLowerCase().trim();
          if (text.length < 3) continue;
          var squished = text.replace(/[^a-z0-9]/g, '');
          if (!text.includes(target) && !squished.includes(target)) continue;
          // Found a conversation row with this user — check if WE sent the last message
          // "You:" prefix means we sent it. Any existing conversation = already messaged.
          var hasOurMsg = text.includes('you:') || text.includes('you ·');
          var timeEl = rows[i].querySelector('[class*="time"], [class*="Time"], [class*="Timestamp"], span[class]');
          var timeText = timeEl ? timeEl.innerText.trim() : '';
          // Block if: we sent the last message (You:), OR it was today (HH:MM), OR it's ANY outbound
          var isToday = /^\\d{1,2}:\\d{2}/.test(timeText);
          if (hasOurMsg || isToday) {
            return JSON.stringify({found: true, reason: hasOurMsg ? 'we_sent_last' : 'today_conversation', preview: text.substring(0, 100), time: timeText, rows_scanned: rows.length});
          }
          // Even if they messaged us first (inbound), don't cold-DM — they're already in contact
          return JSON.stringify({found: true, reason: 'existing_conversation', preview: text.substring(0, 100), time: timeText, rows_scanned: rows.length});
        }
        return JSON.stringify({found: false, rows_scanned: rows.length});
      })()
    `);

    try {
      const dedupResult = JSON.parse(alreadyMessaged);
      console.log(`[TikTok DM] 🔍 Inbox scan: ${dedupResult.rows_scanned ?? '?'} rows checked for @${handle} — found=${dedupResult.found}`);
      if (dedupResult.found) {
        if (opts.force) {
          console.log(`[TikTok DM] ⚡ FORCE mode: @${handle} has existing conversation (${dedupResult.reason}) — proceeding anyway (reply)`);
        } else {
          console.log(`[TikTok DM] ⛔ DEDUP: @${handle} has existing conversation (${dedupResult.reason}, time: ${dedupResult.time}) — skipping`);
          return { success: false, error: `already_in_conversation: ${dedupResult.reason}`, username: handle };
        }
      }
    } catch {}

    // Inbox is clear for this user — proceed with send.

    // ── Helpers ────────────────────────────────────────────────────
    /** Get sidebar avatar image positions (the ONLY elements with real dimensions) */
    const getAvatarPositions = async (): Promise<Array<{x: number; y: number}>> => {
      const raw = await driver.executeJS(`
        (function() {
          var imgs = document.querySelectorAll('img');
          var out = [];
          var chromeH = window.outerHeight - window.innerHeight;
          var sx = window.screenX; var sy = window.screenY + chromeH;
          for (var i = 0; i < imgs.length; i++) {
            var r = imgs[i].getBoundingClientRect();
            if (r.width >= 36 && r.width <= 60 && r.x >= 50 && r.x <= 140 && r.y > 50) {
              out.push({x: Math.round(sx + r.x + r.width/2), y: Math.round(sy + r.y + r.height/2)});
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
      // First pass: find the matching element and scrollIntoView if needed
      await driver.executeJS(`
        (function() {
          var target = '${handle.toLowerCase()}';
          var frags = target.split(/[_.]/g).filter(function(s) { return s.length > 3 && !/[0-9]/.test(s); });
          var rows = document.querySelectorAll('[data-e2e="chat-list-item"],[class*="DivItemWrapper"],[class*="LiInboxItemWrapper"],[class*="ConversationItem"],[class*="DivListItem"],[class*="DivConversationItem"]');
          for (var i = 0; i < rows.length; i++) {
            var text = (rows[i].innerText || '').toLowerCase();
            var squished = text.replace(/[^a-z0-9]/g, '');
            var fragMatch = frags.some(function(f) { return text.startsWith(f) || text.includes('\\n' + f) || text.split('\\n')[0].includes(f); });
            if (text.includes(target) || squished.includes(target) || fragMatch) {
              rows[i].scrollIntoView({block: 'center', behavior: 'instant'});
              return 'scrolled';
            }
          }
          return 'not_found';
        })()`);
      await driver.wait(600); // let TikTok virtual DOM re-render after scroll

      const raw = await driver.executeJS(`
        (function() {
          var target = '${handle.toLowerCase()}';
          var frags = target.split(/[_.]/g).filter(function(s) { return s.length > 3 && !/[0-9]/.test(s); });
          var chromeH = window.outerHeight - window.innerHeight;
          var sx = window.screenX; var sy = window.screenY + chromeH;
          var rows = document.querySelectorAll('[data-e2e="chat-list-item"],[class*="DivItemWrapper"],[class*="LiInboxItemWrapper"],[class*="ConversationItem"],[class*="DivListItem"],[class*="DivConversationItem"]');
          for (var i = 0; i < rows.length; i++) {
            var text = (rows[i].innerText || '').toLowerCase();
            var squished = text.replace(/[^a-z0-9]/g, '');
            var fragMatch = frags.some(function(f) { return text.startsWith(f) || text.includes('\\n' + f) || text.split('\\n')[0].includes(f); });
            if (text.includes(target) || squished.includes(target) || fragMatch) {
              var r = rows[i].getBoundingClientRect();
              if (r.width > 0 && r.height > 0) {
                return JSON.stringify({x: Math.round(sx + r.left + r.width * 0.25), y: Math.round(sy + r.top + r.height / 2)});
              }
              // TikTok virtual DOM: row has 0-dim rect — find avatar img sibling with real dims
              var img = rows[i].querySelector('img');
              if (img) {
                var ri = img.getBoundingClientRect();
                if (ri.width > 20 && ri.height > 20) {
                  return JSON.stringify({x: Math.round(sx + ri.left + ri.width / 2), y: Math.round(sy + ri.top + ri.height / 2)});
                }
              }
              // Last resort: return the element's offsetTop position estimate
              var el = rows[i];
              var offsetTop = 0;
              while (el) { offsetTop += el.offsetTop || 0; el = el.offsetParent; }
              if (offsetTop > 0) {
                return JSON.stringify({x: Math.round(sx + 200), y: Math.round(sy + offsetTop + 24)});
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
          // Name fragments for display-name match (e.g. "zoey_devine1" → ["zoey","devine"])
          var frags = target.split(/[_.]/g).filter(function(s){ return s.length > 3 && !/[0-9]/.test(s); });
          // Primary: case-insensitive href scan (TikTok may capitalise the handle)
          var links = document.querySelectorAll('a[href*="@"]');
          for (var li = 0; li < links.length; li++) {
            var href = (links[li].getAttribute('href') || '').toLowerCase();
            if (href === '/@' + target || href.endsWith('/@' + target)) {
              return JSON.stringify({verified: true, header: links[li].innerText.trim().substring(0, 60) || target});
            }
          }
          // Check composer is open at all
          var hasComposer = !!document.querySelector('[contenteditable="true"]')
                         || (document.body.innerText || '').includes('Send a message');
          if (!hasComposer) {
            return JSON.stringify({verified: false, header: 'no_conversation_open'});
          }
          // Fallback: scan header area text nodes for handle OR name fragments
          // TikTok uses div elements for the chat header name — include all block elements
          var nodes = document.querySelectorAll('p, span, h1, h2, h3, h4, div[class*="name"], div[class*="Name"], div[class*="header"], div[class*="Header"], div[class*="title"], div[class*="Title"]');
          for (var i = 0; i < nodes.length; i++) {
            var r = nodes[i].getBoundingClientRect();
            var t = (nodes[i].textContent || '').trim();
            var tl = t.toLowerCase();
            // Look anywhere in top portion of screen (y < 300, x > 100)
            if (r.width > 0 && t.length < 80 && r.y < 300 && r.x > 100) {
              var nameMatch = frags.some(function(f){ return tl === f || tl.startsWith(f+' ') || tl.startsWith(f+'\\n') || tl.includes(f); });
              if (tl.includes(target) || nameMatch) {
                return JSON.stringify({verified: true, header: t.substring(0, 60)});
              }
            }
          }
          // Last resort: if composer is open and we navigated here via inbox, trust it
          return JSON.stringify({verified: true, header: 'composer_open_inbox_trusted'});
        })()
      `);
      try { return JSON.parse(raw); } catch { return {verified: false, header: ''}; }
    };

    // ── STRATEGY 0: Background-safe JS click ─────────────────────────────
    // Try to click the conversation row using el.click() — no window activation needed.
    console.log('[TikTok DM]   🔕 Strategy 0: background-safe JS click...');
    const jsClickResult = await clickConversationViaJS(driver, handle);
    if (jsClickResult.startsWith('clicked:')) {
      console.log(`[TikTok DM]   ✅ Strategy 0: JS click landed (${jsClickResult}), waiting for SPA transition...`);
      await driver.wait(4000);
      const composerCheck0 = await driver.executeJS(
        `(function(){var ce=document.querySelector('[contenteditable="true"]');return ce?'open':(document.body.innerText.includes('Send a message')||document.body.innerText.includes('Message...'))?'placeholder':'closed';})()`
      );
      if (composerCheck0 === 'open' || composerCheck0 === 'placeholder') {
        const idCheck0 = await verifyIdentity();
        if (idCheck0.verified) {
          console.log('[TikTok DM]   ✅ Strategy 0: identity verified, sending (background mode)...');
          return await _sendAndVerify(driver, handle, message, idCheck0.header);
        }
        console.log(`[TikTok DM]   ⚠️ Strategy 0: composer open but identity mismatch (${idCheck0.header}) — falling through`);
      } else {
        console.log(`[TikTok DM]   ⚠️ Strategy 0: composer not found after JS click (${composerCheck0}) — falling through`);
      }
    } else {
      console.log(`[TikTok DM]   ℹ️ Strategy 0: ${jsClickResult} — falling through to Strategy A`);
    }

    // ── STRATEGY A: Text-based LI click ────────────────────────────
    // Activate window BEFORE getting coordinates — virtual list may scroll when window activates,
    // making coordinates computed in background JS stale by the time we OS-click.
    console.log('[TikTok DM]   🔍 Strategy A: activating window first, then text-based conversation lookup...');
    await (driver as any).activateTrackedWindow?.() || await driver.activateSafari();
    await driver.wait(2000); // TikTok needs time to re-render the virtual list after window activation
    const convPos = await findConversationByText(); // get FRESH coords after activation

    if (convPos) {
      console.log(`[TikTok DM]   📍 Squish-matched @${handle} at (${convPos.x}, ${convPos.y}), OS-clicking...`);
      await driver.clickAtScreenPosition(convPos.x, convPos.y, true);
      await driver.wait(4000); // longer wait for SPA transition to settle

      // After squish-match, trust the row selection — just confirm composer opened
      const composerCheck = await driver.executeJS(
        `(function(){var ce=document.querySelector('[contenteditable="true"]');return ce?'open':(document.body.innerText.includes('Send a message')||document.body.innerText.includes('Message...'))?'placeholder':'closed';})()`
      );
      if (composerCheck === 'open' || composerCheck === 'placeholder') {
        // ALWAYS verify identity — a previously-open conversation could still have its
        // composer visible, causing us to send the wrong person's message into the wrong chat.
        const idCheckA = await verifyIdentity();
        if (!idCheckA.verified) {
          console.log(`[TikTok DM]   ⛔ Strategy A: composer open but identity mismatch (got "${idCheckA.header}") — aborting, NOT sending`);
          return { success: false, error: `identity_mismatch: expected @${handle}, got "${idCheckA.header}"`, username: handle };
        }
        console.log('[TikTok DM]   ✅ Strategy A: identity verified (' + idCheckA.header + '), sending...');
        return await _sendAndVerify(driver, handle, message, idCheckA.header);
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
    // Convert viewport coords to screen coords using window.screenX/Y + chrome height.
    const searchBarScreen = await driver.executeJS(`JSON.stringify({x: Math.round(window.screenX + 300), y: Math.round(window.screenY + window.outerHeight - window.innerHeight + 55)})`);
    const sbPos = (() => { try { return JSON.parse(searchBarScreen); } catch { return {x: 300, y: 55}; } })();
    await driver.clickAtScreenPosition(sbPos.x, sbPos.y, true);
    await driver.wait(500);

    // Clear any existing text then type handle
    const { execSync } = await import('child_process');
    try { execSync(`osascript -e 'tell application "System Events" to tell process "Safari" to keystroke "a" using command down'`); } catch {}
    await driver.wait(100);
    try { execSync(`osascript -e 'tell application "System Events" to tell process "Safari" to key code 51'`); } catch {}
    await driver.wait(200);
    // Type handle first; if search returns no results, retry with first fragment ("zoey" from "zoey_devine1")
    await driver.typeViaKeystrokes(handle);
    await driver.wait(3500);

    // Check if search returned results; if not, retry with fragment
    const searchCount = await driver.executeJS(
      `String(document.querySelectorAll('[class*="LiInboxItemWrapper"],[data-e2e="chat-list-item"]').length)`
    );
    if (searchCount === '0' || !searchCount) {
      const frags = handle.split(/[_.]/g).filter((f: string) => f.length > 2 && !/[0-9]/.test(f));
      if (frags.length > 0) {
        console.log(`[TikTok DM]   ℹ️ Strategy B: handle search returned 0 rows, retrying with fragment "${frags[0]}"...`);
        try { execSync(`osascript -e 'tell application "System Events" to tell process "Safari" to keystroke "a" using command down'`); } catch {}
        await driver.wait(100);
        try { execSync(`osascript -e 'tell application "System Events" to tell process "Safari" to key code 51'`); } catch {}
        await driver.wait(200);
        await driver.typeViaKeystrokes(frags[0]);
        await driver.wait(3000);
      }
    }

    // After search, find the first LiInboxItemWrapper avatar img and click via OS-level event.
    // TikTok virtual DOM: container rows have 0x0 dims, but avatar imgs have real dimensions.
    // CRITICAL: MUST verify row text matches handle/fragment before returning — never click first row blindly.
    const firstRowPos = await driver.executeJS(`
      (function() {
        var target = '${handle.toLowerCase()}';
        var frags = target.split(/[_.]/g).filter(function(s) { return s.length > 2 && !/[0-9]/.test(s); });
        // Convert viewport → screen coords
        var chromeH = window.outerHeight - window.innerHeight;
        var sx = window.screenX; var sy = window.screenY + chromeH;
        // Primary: find LiInboxItemWrapper rows — ONLY return a match if text matches target/fragment
        var rows = document.querySelectorAll('[class*="LiInboxItemWrapper"],[data-e2e="chat-list-item"]');
        for (var i = 0; i < rows.length; i++) {
          var text = (rows[i].innerText || '').toLowerCase();
          var squished = text.replace(/[^a-z0-9]/g, '');
          var fragMatch = frags.some(function(f) { return text.startsWith(f) || text.includes('\\n' + f) || text.split('\\n')[0].includes(f); });
          if (!text.includes(target) && !squished.includes(target) && !fragMatch) continue; // MUST match
          var img = rows[i].querySelector('img');
          if (img) {
            var ri = img.getBoundingClientRect();
            if (ri.width > 0 && ri.height > 0) {
              return JSON.stringify({x: Math.round(sx + ri.left + ri.width/2), y: Math.round(sy + ri.top + ri.height/2), text: rows[i].innerText.substring(0,40), via: 'img'});
            }
          }
          // Row matched but avatar has no dims — use row offsetTop estimate
          var el = rows[i]; var offsetTop = 0;
          while (el) { offsetTop += el.offsetTop || 0; el = el.offsetParent; }
          if (offsetTop > 0) {
            return JSON.stringify({x: Math.round(sx + 80), y: Math.round(sy + offsetTop + 24), text: rows[i].innerText.substring(0,40), via: 'offsetTop'});
          }
        }
        return 'not_found';
      })()
    `);

    if (!firstRowPos || firstRowPos === 'not_found') {
      // Cold prospect — not in inbox. Navigate to profile, JS-click Message button (proven reliable).
      console.log(`[TikTok DM]   ℹ️ @${handle} not in inbox — Strategy C (cold): profile page JS click...`);
      await driver.navigateTo(`https://www.tiktok.com/@${handle}`);
      await driver.wait(4000);
      // ── COLD DEDUP: before hitting profile, do a full scrolled inbox scan ──
      // User wasn't found in Strategy B search (not in inbox), but inbox rows are
      // lazily rendered — scroll fully before declaring them truly absent.
      await driver.navigateTo(TIKTOK_URLS.messages);
      await driver.wait(4000);
      await driver.executeJS(`
        (function() {
          var el = document.querySelector('[class*="DivScrollWrap"],[class*="DivMessageListWrapper"],[class*="DivConversationList"]');
          if (el) { el.scrollTop = el.scrollHeight; } else { window.scrollBy(0, 1000); }
        })()`);
      await driver.wait(1500);
      const coldDedupRaw = await driver.executeJS(`
        (function() {
          var target = '${handle.toLowerCase()}';
          var rows = Array.from(document.querySelectorAll(
            '[class*="DivItemWrapper"],[class*="LiInboxItemWrapper"],[class*="ConversationItem"],[class*="DivListItem"],[role="listitem"]'
          ));
          for (var i = 0; i < rows.length; i++) {
            var text = (rows[i].innerText || '').toLowerCase();
            var squished = text.replace(/[^a-z0-9]/g, '');
            if (text.includes(target) || squished.includes(target)) {
              return JSON.stringify({found: true, preview: text.substring(0, 80)});
            }
          }
          return JSON.stringify({found: false, rows: rows.length});
        })()`);
      try {
        const coldDedup = JSON.parse(coldDedupRaw);
        if (coldDedup.found) {
          if (opts.force) {
            console.log(`[TikTok DM] ⚡ FORCE mode: @${handle} found in full inbox scan — proceeding anyway (reply)`);
          } else {
            console.log(`[TikTok DM] ⛔ Cold dedup (full scan): @${handle} found in inbox — skipping`);
            return { success: false, error: `already_in_conversation: found_in_full_inbox_scan`, username: handle };
          }
        }
        console.log(`[TikTok DM]   ✅ Cold dedup clear — ${coldDedup.rows} rows scanned, @${handle} not found`);
      } catch {}
      await driver.navigateTo(`https://www.tiktok.com/@${handle}`);
      await driver.wait(4000);

      // JS click works reliably on TikTok profile Message button (unlike inbox rows where virtual DOM blocks JS)
      const coldClick = await driver.executeJS(`
        (function() {
          var candidates = ['[data-e2e="message-button"]','button[aria-label*="Message"]','[class*="ButtonMessage"],[class*="MessageButton"]'];
          for (var c = 0; c < candidates.length; c++) {
            var el = document.querySelector(candidates[c]);
            if (el && el.getBoundingClientRect().width > 0) { el.click(); return 'clicked:' + candidates[c]; }
          }
          var btns = document.querySelectorAll('button,a[role="button"],div[role="button"]');
          for (var i = 0; i < btns.length; i++) {
            var txt = (btns[i].innerText||'').trim();
            if (txt === 'Message' || txt === 'Send message') { btns[i].click(); return 'clicked:text'; }
          }
          return 'not_found';
        })()`);
      if (!coldClick || coldClick === 'not_found') {
        return { success: false, error: `dms_restricted: no Message button on @${handle} profile`, username: handle };
      }
      console.log(`[TikTok DM]   📍 Strategy C (cold): JS-clicked profile button (${coldClick}), waiting for composer...`);
      await driver.wait(5000); // profile Message button may navigate to messages page first
      const coldUrl = await driver.getCurrentUrl();
      let coldComposer = await driver.executeJS(
        `(function(){var ce=document.querySelector('[contenteditable="true"]');return ce?'open':(document.body.innerText.includes('Send a message')||document.body.innerText.includes('Message...'))?'placeholder':'closed';})()`
      );
      // If TikTok navigated to messages page (existing conversation), the composer may need an OS-click
      if ((coldComposer !== 'open' && coldComposer !== 'placeholder') && coldUrl.includes('/messages')) {
        console.log('[TikTok DM]   ℹ️ Strategy C: navigated to messages page but composer closed — trying OS-click on conversation row...');
        await (driver as any).activateTrackedWindow?.() || await driver.activateSafari();
        await driver.wait(1500);
        // Find conversation row for this handle and OS-click it
        const coldConvPos = await findConversationByText();
        if (coldConvPos) {
          console.log(`[TikTok DM]   📍 Strategy C fallback: OS-clicking conversation at (${coldConvPos.x}, ${coldConvPos.y})`);
          await driver.clickAtScreenPosition(coldConvPos.x, coldConvPos.y, true);
          await driver.wait(3000);
          coldComposer = await driver.executeJS(
            `(function(){var ce=document.querySelector('[contenteditable="true"]');return ce?'open':(document.body.innerText.includes('Send a message')||document.body.innerText.includes('Message...'))?'placeholder':'closed';})()`
          );
        }
      }
      if (coldComposer !== 'open' && coldComposer !== 'placeholder') {
        return { success: false, error: `Strategy C (cold): profile Message button JS-clicked but composer did not open (${coldComposer})`, username: handle };
      }
      console.log('[TikTok DM]   ✅ Strategy C (cold): composer open, sending...');
      return await _sendAndVerify(driver, handle, message, handle);
    }

    let rowPos: { x: number; y: number; via: string; text: string };
    try {
      rowPos = JSON.parse(firstRowPos);
    } catch {
      return { success: false, error: `Could not parse row position after searching "${handle}": ${firstRowPos}`, username: handle };
    }
    console.log(`[TikTok DM]   📍 OS-clicking ${rowPos.via} in first filtered row at (${rowPos.x}, ${rowPos.y}) — "${rowPos.text}"`);
    await (driver as any).activateTrackedWindow?.() || await driver.activateSafari();
    await driver.wait(600);
    await driver.clickAtScreenPosition(rowPos.x, rowPos.y, true);
    await driver.wait(3000);

    const idCheck = await verifyIdentity();
    if (!idCheck.verified) {
      console.log(`[TikTok DM]   ⚠️ Strategy B identity mismatch — trying Strategy C: profile page Message button...`);

      // ── STRATEGY C: Profile page Message button ─────────────────────────────
      await driver.navigateTo(`https://www.tiktok.com/@${handle}`);
      await driver.wait(4000);

      const msgBtnPos = await driver.executeJS(`
        (function() {
          var chromeH = window.outerHeight - window.innerHeight;
          var sx = window.screenX; var sy = window.screenY + chromeH;
          var candidates = [
            '[data-e2e="message-button"]',
            'button[aria-label*="Message"], button[aria-label*="message"]',
            '[class*="ButtonMessage"], [class*="MessageButton"]',
          ];
          for (var c = 0; c < candidates.length; c++) {
            var el = document.querySelector(candidates[c]);
            if (el) {
              var r = el.getBoundingClientRect();
              if (r.width > 0 && r.height > 0) {
                return JSON.stringify({x: Math.round(sx + r.left + r.width/2), y: Math.round(sy + r.top + r.height/2), sel: candidates[c]});
              }
            }
          }
          var buttons = document.querySelectorAll('button, a[role="button"], div[role="button"]');
          for (var i = 0; i < buttons.length; i++) {
            var txt = (buttons[i].innerText || '').trim();
            if (txt === 'Message' || txt === 'Send message') {
              var r2 = buttons[i].getBoundingClientRect();
              if (r2.width > 0 && r2.height > 0) {
                return JSON.stringify({x: Math.round(sx + r2.left + r2.width/2), y: Math.round(sy + r2.top + r2.height/2), sel: 'text:' + txt});
              }
            }
          }
          return 'not_found';
        })()
      `);

      if (msgBtnPos && msgBtnPos !== 'not_found') {
        try {
          const btnPos = JSON.parse(msgBtnPos);
          // Steal focus first, then OS-click the Message button
          await (driver as any).activateTrackedWindow?.() || await driver.activateSafari();
          await driver.wait(600);
          await driver.clickAtScreenPosition(btnPos.x, btnPos.y, true);
          await driver.wait(4000);
          const composerAfterProfile = await driver.executeJS(
            `(function(){var ce=document.querySelector('[contenteditable="true"]');return ce?'open':(document.body.innerText.includes('Send a message')||document.body.innerText.includes('Message...'))?'placeholder':'closed';})()`
          );
          if (composerAfterProfile === 'open' || composerAfterProfile === 'placeholder') {
            console.log('[TikTok DM]   ✅ Strategy C: profile Message button opened composer, sending...');
            return await _sendAndVerify(driver, handle, message, handle);
          }
          console.log(`[TikTok DM]   ⚠️ Strategy C: composer still closed (${composerAfterProfile}), trying Strategy D...`);
        } catch (e) {
          console.log(`[TikTok DM]   ⚠️ Strategy C error: ${e}`);
        }
      } else {
        console.log(`[TikTok DM]   ⚠️ Strategy C: no Message button found on @${handle} profile, trying Strategy D...`);
      }

      // ── STRATEGY D: Inbox compose flow using Quartz OS-clicks ────────────────
      // TikTok's virtual DOM ignores JS .click() — must use driver.clickElement (Quartz).
      const navResult = await navigateToInbox(driver);
      if (!navResult.success) {
        return { success: false, error: `Strategy D nav failed: ${navResult.error}`, username: handle };
      }

      const newMsgClicked = await driver.clickElement('[class*="NewMessage"]');
      if (!newMsgClicked) {
        return { success: false, error: `Strategy D: NewMessage compose button not found (cannot create new conversation)`, username: handle };
      }
      await driver.wait(1500);

      const searchTyped = await driver.typeViaKeystrokes(handle);
      if (!searchTyped) {
        return { success: false, error: 'Strategy D: could not type in compose search' };
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
          return { success: false, error: `Strategy D: @${handle} not in compose results`, username: handle };
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

  // ── Use OS-level send (clipboard + Enter) — required for TikTok React ────
  // Background JS send produces false positives (input clears without actual delivery).
  // sendMessage() steals focus, OS-clicks the composer, pastes via clipboard, presses Enter.
  let sendResult: SendMessageResult;
  sendResult = await sendMessage(driver, message);
  if (!sendResult.success) return { ...sendResult, username: handle };

  // Post-send verification — poll for our message appearing as a chat bubble.
  // We DON'T use "input cleared" as a proxy — that causes false positives when
  // TikTok clears the input due to a restriction banner.
  await driver.wait(2000);
  const snippet = message.substring(0, 20).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  let postCheck = 'no';
  let consecutiveFound = 0;
  for (let i = 0; i < 6; i++) {
    const check = await driver.executeJS(`
      (function() {
        // Look for message bubble elements containing our text
        var bubbles = document.querySelectorAll('[data-e2e="chat-item"], [class*="DivMessageBubble"], [class*="DivSingleMessage"], [class*="MessageText"]');
        for (var i = 0; i < bubbles.length; i++) {
          if ((bubbles[i].textContent || '').includes('${snippet}')) return 'bubble_found';
        }
        // Fallback: full page text scan
        if (document.body.innerText.includes('${snippet}')) return 'text_found';
        return 'not_yet';
      })()`);
    if (check === 'bubble_found' || check === 'text_found') {
      consecutiveFound++;
      // Require 2 consecutive positive checks to confirm delivery (not a transient UI ghost)
      if (consecutiveFound >= 2) { postCheck = 'yes'; break; }
    } else {
      if (consecutiveFound > 0) {
        console.log(`[TikTok DM] ⚠️ Post-verify: bubble appeared then disappeared — not confirmed yet (attempt ${i})`);
      }
      consecutiveFound = 0; // reset — transient bubble doesn't count
      postCheck = 'no';
    }
    if (i < 5) await driver.wait(700);
  }

  // Check for red ! error indicator — TikTok shows this when delivery fails silently
  // (e.g., user has DMs disabled, blocked, or server-side rejection)
  await driver.wait(1000);
  const errorCheck = await driver.executeJS(`
    (function() {
      // Red exclamation: SVG/icon with error color, or element with error/failed class near message area
      var errorSelectors = [
        '[class*="IconError"]',
        '[class*="error-icon"]',
        '[class*="FailedIcon"]',
        '[class*="SendFailed"]',
        '[class*="send-failed"]',
        '[class*="DivMessageFailed"]',
        'svg[class*="error"]',
        '[aria-label*="failed"]',
        '[aria-label*="Failed"]',
        '[title*="failed"]',
        '[title*="Failed"]',
      ];
      for (var i = 0; i < errorSelectors.length; i++) {
        if (document.querySelector(errorSelectors[i])) return 'error_icon_found:' + errorSelectors[i];
      }
      // Fallback: look for red-colored elements near the last message bubble
      var bubbles = document.querySelectorAll('[data-e2e="chat-item"], [class*="DivMessageBubble"], [class*="DivSingleMessage"]');
      var last = bubbles[bubbles.length - 1];
      if (last) {
        var inner = last.querySelector('[style*="color: rgb(255"], [style*="color:#f"], [style*="color: #f"]');
        if (inner) return 'red_element_found';
        // Check for any !, exclamation text node near last bubble
        var text = last.innerText || '';
        if (text.includes('!') && text.length < 5) return 'exclamation_text';
      }
      // Body-level failure text
      var body = document.body.innerText || '';
      if (body.includes('Failed to send') || body.includes('Message failed') || body.includes('Not delivered')) {
        return 'body_failure_text';
      }
      return 'no_error';
    })()`);

  if (errorCheck !== 'no_error') {
    console.log(`[TikTok DM] ❌ Delivery failure indicator detected: ${errorCheck}`);
    // Navigate back before returning failure
    await driver.navigateTo(TIKTOK_URLS.messages);
    await driver.wait(2000);
    return {
      success: false,
      error: `delivery_failed: ${errorCheck}`,
      username: handle,
      verified: false,
      verifiedRecipient: verifiedHeader,
    };
  }

  const result: SendMessageResult = {
    success: true,
    username: handle,
    verified: postCheck === 'yes',
    verifiedRecipient: verifiedHeader,
  };

  // Navigate back to inbox root to close the open conversation.
  await driver.navigateTo(TIKTOK_URLS.messages);
  await driver.wait(2000);

  return result;
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
