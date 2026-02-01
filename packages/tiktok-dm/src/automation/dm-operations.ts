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
 * Send a message in the current conversation
 */
export async function sendMessage(
  driver: SafariDriver,
  message: string
): Promise<SendMessageResult> {
  try {
    // Focus the input using validated selectors
    const focusResult = await driver.executeScript(`
      (function() {
        var input = document.querySelector('[data-e2e="message-input-area"]');
        if (!input) input = document.querySelector('[contenteditable="true"]');
        
        if (input) {
          input.focus();
          input.click();
          return 'focused';
        }
        return 'no_input';
      })()
    `);

    if (focusResult !== 'focused') {
      return { success: false, error: 'Could not find message input' };
    }

    await driver.wait(300);

    // Type the message
    const escapedMessage = message
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n');

    const typeResult = await driver.executeScript(`
      (function() {
        var input = document.querySelector('[data-e2e="message-input-area"]');
        if (!input) input = document.querySelector('[contenteditable="true"]');
        
        if (!input) return 'no_input';
        
        input.focus();
        document.execCommand('insertText', false, "${escapedMessage}");
        return 'typed';
      })()
    `);

    if (typeResult !== 'typed') {
      return { success: false, error: 'Could not type message' };
    }

    await driver.wait(500);

    // Click send button - look for send icon/button
    const sendResult = await driver.executeScript(`
      (function() {
        // Try various send button selectors
        var btn = document.querySelector('[data-e2e="send-message-btn"]');
        if (!btn) btn = document.querySelector('[class*="SendButton"]');
        if (!btn) btn = document.querySelector('[aria-label*="Send"]');
        if (!btn) btn = document.querySelector('button[class*="send"]');
        // Look for SVG send icon
        if (!btn) {
          var svgs = document.querySelectorAll('svg');
          for (var i = 0; i < svgs.length; i++) {
            var parent = svgs[i].closest('button, div[role="button"]');
            if (parent && parent.className.toLowerCase().includes('send')) {
              btn = parent;
              break;
            }
          }
        }
        
        if (btn) {
          btn.click();
          return 'sent';
        }
        return 'no_button';
      })()
    `);

    if (sendResult !== 'sent') {
      return { success: false, error: 'Could not find send button' };
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
    const newMsgClicked = await driver.clickElement(TIKTOK_SELECTORS.newMessageButton);
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
 * Send DM by navigating to user's profile first (profile-to-DM flow)
 */
export async function sendDMByUsername(
  username: string,
  message: string,
  driver: SafariDriver
): Promise<SendMessageResult> {
  try {
    // Navigate to user's profile
    const profileUrl = TIKTOK_URLS.profile(username.replace('@', ''));
    await driver.navigate(profileUrl);
    await driver.wait(2500);

    // Check if profile loaded
    const profileStatus = await driver.executeScript(`
      (function() {
        var notFound = document.body.innerText.includes("Couldn't find this account") ||
                       document.body.innerText.includes("This account doesn't exist");
        if (notFound) return 'not_found';
        
        var messageBtn = document.querySelector('${TIKTOK_SELECTORS.profileMessageButton}');
        if (messageBtn) return 'ready';
        
        var followBtn = document.querySelector('${TIKTOK_SELECTORS.profileFollowButton}');
        if (followBtn && !messageBtn) return 'no_message_button';
        
        return 'loading';
      })()
    `);

    if (profileStatus === 'not_found') {
      return { success: false, error: 'User not found', username };
    }

    if (profileStatus === 'no_message_button') {
      return { success: false, error: 'Cannot message this user (may need to follow first)', username };
    }

    // Wait for profile to fully load if still loading
    if (profileStatus === 'loading') {
      await driver.wait(2000);
    }

    // Click the message button on profile - using validated selector
    const clickResult = await driver.executeScript(`
      (function() {
        var btn = document.querySelector('[data-e2e="message-button"]');
        if (!btn) btn = document.querySelector('[data-e2e="message-icon"]');
        if (!btn) {
          // Try alternate selectors
          var btns = document.querySelectorAll('button, div[role="button"]');
          for (var i = 0; i < btns.length; i++) {
            if (btns[i].textContent.toLowerCase().includes('message')) {
              btn = btns[i];
              break;
            }
          }
        }
        
        if (btn) {
          btn.click();
          return 'clicked';
        }
        return 'not_found';
      })()
    `);

    if (clickResult !== 'clicked') {
      return { success: false, error: 'Could not find message button on profile', username };
    }

    await driver.wait(2000);

    // Wait for DM composer to open
    const composerReady = await driver.waitForElement(TIKTOK_SELECTORS.messageInput, 5000) ||
                          await driver.waitForElement(TIKTOK_SELECTORS.messageInputAlt, 3000) ||
                          await driver.waitForElement(TIKTOK_SELECTORS.messageInputFallback, 3000);

    if (!composerReady) {
      return { success: false, error: 'DM composer did not open', username };
    }

    // Send the message
    const sendResult = await sendMessage(driver, message);
    return { ...sendResult, username };
  } catch (error) {
    return { success: false, error: String(error), username };
  }
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
