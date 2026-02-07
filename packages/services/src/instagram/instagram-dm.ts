/**
 * @deprecated — LEGACY FILE. Use packages/instagram-dm/src/automation/dm-operations.ts instead.
 * The canonical Instagram DM API is served by packages/instagram-dm/src/api/server.ts (port 3100).
 * This file is kept for reference only. Do not import from here in new code.
 *
 * Instagram DM Automation via Safari
 * 
 * Full control of Instagram Direct Messages using Safari browser automation.
 * 
 * Features:
 * - Navigate to DM inbox
 * - List conversations with unread status
 * - Read messages in a conversation
 * - Send messages (text)
 * - Start new conversations
 * - Rate limiting protection
 * 
 * Based on: INSTAGRAM_SELECTORS_REFERENCE.md, PRD_INSTAGRAM_DM_FULL_CONTROL.md
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// === URLS ===
const URLS = {
  HOME: 'https://www.instagram.com/',
  DM_INBOX: 'https://www.instagram.com/direct/inbox/',
  DM_THREAD: (threadId: string) => `https://www.instagram.com/direct/t/${threadId}/`,
  PROFILE: (username: string) => `https://www.instagram.com/${username}/`,
};

// === RATE LIMITS ===
const RATE_LIMITS = {
  MAX_DMS_PER_HOUR: 20,
  MAX_DMS_PER_DAY: 100,
  MIN_DELAY_MS: 60000,  // 1 minute between DMs
  MAX_DELAY_MS: 180000, // 3 minutes max
};

// === JAVASCRIPT FUNCTIONS ===
const JS = {
  // Check if logged in
  checkLogin: `
    (function() {
      var indicators = [
        'svg[aria-label="Home"]',
        'img[alt*="profile picture"]',
        'a[href*="/direct/"]'
      ];
      for (var i = 0; i < indicators.length; i++) {
        if (document.querySelector(indicators[i])) return 'logged_in';
      }
      if (document.querySelector('input[name="username"]')) return 'login_page';
      return 'unknown';
    })()
  `,

  // Check for rate limit
  checkRateLimit: `
    (function() {
      var text = document.body.innerText.toLowerCase();
      if (text.includes('try again later') || text.includes('action blocked')) {
        return 'rate_limited';
      }
      return 'ok';
    })()
  `,

  // Get conversations list
  getConversations: `
    (function() {
      var conversations = [];
      var links = document.querySelectorAll('a[href*="/direct/t/"]');
      
      if (links.length === 0) {
        var imgs = document.querySelectorAll('img[alt*="profile picture"]');
        imgs.forEach(function(img) {
          var parent = img.closest('div[role="button"]') || img.closest('a');
          if (parent) links = [...links, parent];
        });
      }
      
      links.forEach(function(element, index) {
        if (index >= 20) return;
        
        var usernameEl = element.querySelector('img[alt*="profile"]');
        var username = 'Unknown';
        if (usernameEl) {
          username = (usernameEl.getAttribute('alt') || '')
            .replace("'s profile picture", '').trim();
        }
        
        var spans = element.querySelectorAll('span[dir="auto"], span');
        var lastMessage = '';
        for (var i = spans.length - 1; i >= 0; i--) {
          var text = spans[i].textContent.trim();
          if (text && text !== username && text.length > 0 && text.length < 200) {
            lastMessage = text;
            break;
          }
        }
        
        var isUnread = element.innerHTML.includes('rgb(0, 149, 246)') ||
                      element.innerHTML.includes('font-weight: 600');
        
        var href = element.getAttribute('href') || '';
        var threadMatch = href.match(/\\/direct\\/t\\/([^\\/]+)/);
        var threadId = threadMatch ? threadMatch[1] : '';
        
        conversations.push({
          index: index,
          username: username,
          lastMessage: lastMessage.substring(0, 100),
          isUnread: isUnread,
          threadId: threadId
        });
      });
      
      return JSON.stringify(conversations);
    })()
  `,

  // Click on conversation by index
  clickConversation: (index: number) => `
    (function() {
      // Try direct links first
      var links = document.querySelectorAll('a[href*="/direct/t/"]');
      if (links[${index}]) {
        links[${index}].click();
        return 'clicked';
      }
      
      // Fallback: clickable divs with profile pictures
      var items = document.querySelectorAll('div[role="button"]');
      var convItems = [];
      items.forEach(function(item) {
        if (item.querySelector('img[alt*="profile"]')) {
          convItems.push(item);
        }
      });
      
      if (convItems[${index}]) {
        convItems[${index}].click();
        return 'clicked';
      }
      
      // Fallback 2: any clickable row in conversation list
      var rows = document.querySelectorAll('[class*="conversation"], [class*="thread"]');
      if (rows[${index}]) {
        rows[${index}].click();
        return 'clicked';
      }
      
      return 'not_found';
    })()
  `,

  // Get messages in current conversation
  getMessages: `
    (function() {
      var messages = [];
      var container = document.querySelector('[role="main"]');
      if (!container) return JSON.stringify([]);
      
      var msgElements = container.querySelectorAll('[class*="message"], div[dir="auto"]');
      var seen = new Set();
      
      msgElements.forEach(function(el, i) {
        var text = el.innerText.trim();
        if (text && text.length > 0 && text.length < 1000 && !seen.has(text)) {
          seen.add(text);
          
          var parent = el.closest('[class*="sent"]') || el.closest('[class*="received"]');
          var isSent = parent && parent.className.includes('sent');
          
          messages.push({
            index: i,
            text: text.substring(0, 500),
            isSent: isSent || false
          });
        }
      });
      
      return JSON.stringify(messages.slice(-20));  // Last 20 messages
    })()
  `,

  // Find and focus message input
  focusMessageInput: `
    (function() {
      var selectors = [
        'textarea[placeholder*="Message"]',
        'div[contenteditable="true"][role="textbox"]',
        'textarea[aria-label*="Message"]'
      ];
      
      for (var i = 0; i < selectors.length; i++) {
        var input = document.querySelector(selectors[i]);
        if (input && input.offsetParent !== null) {
          input.focus();
          input.click();
          return 'focused';
        }
      }
      return 'not_found';
    })()
  `,

  // Type message into input
  typeMessage: (text: string) => `
    (function() {
      var input = document.activeElement;
      
      if (input && (input.tagName === 'TEXTAREA' || input.contentEditable === 'true')) {
        if (input.tagName === 'TEXTAREA') {
          input.value = ${JSON.stringify(text)};
        } else {
          input.innerHTML = ${JSON.stringify(text)};
        }
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return 'typed';
      }
      
      // Fallback: find input directly
      var textarea = document.querySelector('textarea[placeholder*="Message"]');
      if (textarea) {
        textarea.focus();
        textarea.value = ${JSON.stringify(text)};
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        return 'typed';
      }
      
      return 'not_found';
    })()
  `,

  // Send message (press Enter or click Send)
  sendMessage: `
    (function() {
      var input = document.activeElement;
      
      // Try Enter key
      input.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        bubbles: true
      }));
      
      // Also try click Send button
      setTimeout(function() {
        var sendBtn = document.querySelector('button[type="submit"]');
        if (!sendBtn) {
          var btns = document.querySelectorAll('button');
          for (var i = 0; i < btns.length; i++) {
            if (btns[i].textContent.toLowerCase().includes('send')) {
              sendBtn = btns[i];
              break;
            }
          }
        }
        if (sendBtn && !sendBtn.disabled) {
          sendBtn.click();
        }
      }, 100);
      
      return 'sent';
    })()
  `,

  // Click New Message button
  clickNewMessage: `
    (function() {
      var btn = document.querySelector('[aria-label="New message"]');
      if (!btn) {
        btn = document.querySelector('svg[aria-label="New message"]');
        if (btn) btn = btn.closest('button') || btn.parentElement;
      }
      if (btn) {
        btn.click();
        return 'clicked';
      }
      return 'not_found';
    })()
  `,

  // Search for user in new message dialog
  searchUser: (username: string) => `
    (function() {
      var input = document.querySelector('input[placeholder*="Search"]');
      if (input) {
        input.focus();
        input.value = ${JSON.stringify(username)};
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return 'searching';
      }
      return 'not_found';
    })()
  `,

  // Select user from search results
  selectUser: (username: string) => `
    (function() {
      var results = document.querySelectorAll('[role="button"], div[role="listitem"]');
      for (var i = 0; i < results.length; i++) {
        if (results[i].innerText.toLowerCase().includes(${JSON.stringify(username.toLowerCase())})) {
          results[i].click();
          return 'selected';
        }
      }
      return 'not_found';
    })()
  `,

  // Click Next/Chat button after selecting user
  clickNextChat: `
    (function() {
      var btns = document.querySelectorAll('button, div[role="button"]');
      for (var i = 0; i < btns.length; i++) {
        var text = btns[i].textContent.toLowerCase();
        if (text === 'next' || text === 'chat') {
          btns[i].click();
          return 'clicked';
        }
      }
      return 'not_found';
    })()
  `,
};

// === TYPES ===
export interface Conversation {
  index: number;
  username: string;
  lastMessage: string;
  isUnread: boolean;
  threadId: string;
}

export interface Message {
  index: number;
  text: string;
  isSent: boolean;
}

export interface DMResult {
  success: boolean;
  data?: any;
  error?: string;
}

// === MAIN CLASS ===
export class InstagramDM {
  private dmsSentToday = 0;
  private dmsSentThisHour = 0;
  private lastDMTime = 0;

  /**
   * Execute JavaScript in Safari
   */
  private async execJS(js: string): Promise<string> {
    // Clean up JS: remove newlines, collapse spaces
    const cleanJS = js.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
    
    // Write JS to temp file to avoid shell escaping issues
    const fs = await import('fs/promises');
    const os = await import('os');
    const path = await import('path');
    
    const tempFile = path.join(os.tmpdir(), `safari-js-${Date.now()}.js`);
    await fs.writeFile(tempFile, cleanJS);
    
    const script = `
      set jsCode to read POSIX file "${tempFile}" as «class utf8»
      tell application "Safari"
        do JavaScript jsCode in front document
      end tell
    `;
    
    try {
      const { stdout } = await execAsync(`osascript -e '${script.replace(/'/g, "'\"'\"'")}'`);
      await fs.unlink(tempFile).catch(() => {}); // Cleanup
      return stdout.trim();
    } catch (error) {
      await fs.unlink(tempFile).catch(() => {}); // Cleanup
      console.error('[InstagramDM] JS execution error:', error);
      return '';
    }
  }

  /**
   * Navigate Safari to URL
   */
  private async navigate(url: string): Promise<void> {
    const script = `tell application "Safari" to set URL of front document to "${url}"`;
    await execAsync(`osascript -e '${script}'`);
    await this.wait(3000); // Wait for page load
  }

  /**
   * Wait helper
   */
  private wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Check rate limits before sending DM
   */
  private checkRateLimits(): { allowed: boolean; reason?: string } {
    const now = Date.now();
    
    if (this.dmsSentToday >= RATE_LIMITS.MAX_DMS_PER_DAY) {
      return { allowed: false, reason: 'Daily DM limit reached' };
    }
    
    if (this.dmsSentThisHour >= RATE_LIMITS.MAX_DMS_PER_HOUR) {
      return { allowed: false, reason: 'Hourly DM limit reached' };
    }
    
    if (now - this.lastDMTime < RATE_LIMITS.MIN_DELAY_MS) {
      const waitTime = Math.ceil((RATE_LIMITS.MIN_DELAY_MS - (now - this.lastDMTime)) / 1000);
      return { allowed: false, reason: `Wait ${waitTime}s before next DM` };
    }
    
    return { allowed: true };
  }

  // === PUBLIC METHODS ===

  /**
   * Check if logged into Instagram
   */
  async checkLogin(): Promise<DMResult> {
    const result = await this.execJS(JS.checkLogin);
    return {
      success: result === 'logged_in',
      data: { status: result },
    };
  }

  /**
   * Navigate to DM inbox
   */
  async goToInbox(): Promise<DMResult> {
    await this.navigate(URLS.DM_INBOX);
    await this.wait(2000);
    
    const loginStatus = await this.execJS(JS.checkLogin);
    if (loginStatus !== 'logged_in') {
      return { success: false, error: 'Not logged in' };
    }
    
    return { success: true };
  }

  /**
   * Get list of conversations
   */
  async getConversations(): Promise<DMResult> {
    const result = await this.execJS(JS.getConversations);
    
    try {
      const conversations: Conversation[] = JSON.parse(result);
      return {
        success: true,
        data: { 
          conversations,
          count: conversations.length,
          unreadCount: conversations.filter(c => c.isUnread).length,
        },
      };
    } catch {
      return { success: false, error: 'Failed to parse conversations' };
    }
  }

  /**
   * Open a specific conversation
   */
  async openConversation(index: number): Promise<DMResult> {
    const result = await this.execJS(JS.clickConversation(index));
    await this.wait(2000);
    
    return {
      success: result === 'clicked',
      error: result === 'not_found' ? 'Conversation not found' : undefined,
    };
  }

  /**
   * Navigate directly to a conversation by thread ID
   */
  async goToThread(threadId: string): Promise<DMResult> {
    await this.navigate(URLS.DM_THREAD(threadId));
    await this.wait(2000);
    return { success: true };
  }

  /**
   * Get messages in current conversation
   */
  async getMessages(): Promise<DMResult> {
    const result = await this.execJS(JS.getMessages);
    
    try {
      const messages: Message[] = JSON.parse(result);
      return {
        success: true,
        data: { messages, count: messages.length },
      };
    } catch {
      return { success: false, error: 'Failed to parse messages' };
    }
  }

  /**
   * Send a message in current conversation
   */
  async sendMessage(text: string): Promise<DMResult> {
    // Check rate limits
    const rateCheck = this.checkRateLimits();
    if (!rateCheck.allowed) {
      return { success: false, error: rateCheck.reason };
    }
    
    // Check Instagram rate limit
    const rateLimitStatus = await this.execJS(JS.checkRateLimit);
    if (rateLimitStatus === 'rate_limited') {
      return { success: false, error: 'Instagram rate limit detected' };
    }
    
    // Focus input
    const focusResult = await this.execJS(JS.focusMessageInput);
    if (focusResult === 'not_found') {
      return { success: false, error: 'Message input not found' };
    }
    await this.wait(500);
    
    // Type message
    const typeResult = await this.execJS(JS.typeMessage(text));
    if (typeResult === 'not_found') {
      return { success: false, error: 'Could not type message' };
    }
    await this.wait(500);
    
    // Send
    await this.execJS(JS.sendMessage);
    await this.wait(1000);
    
    // Update rate limit counters
    this.dmsSentToday++;
    this.dmsSentThisHour++;
    this.lastDMTime = Date.now();
    
    return { success: true, data: { message: text } };
  }

  /**
   * Start a new conversation with a user
   */
  async startConversation(username: string, message: string): Promise<DMResult> {
    // Check rate limits
    const rateCheck = this.checkRateLimits();
    if (!rateCheck.allowed) {
      return { success: false, error: rateCheck.reason };
    }
    
    // Go to inbox first
    await this.goToInbox();
    
    // Click New Message
    const newMsgResult = await this.execJS(JS.clickNewMessage);
    if (newMsgResult === 'not_found') {
      return { success: false, error: 'New message button not found' };
    }
    await this.wait(1500);
    
    // Search for user
    await this.execJS(JS.searchUser(username));
    await this.wait(2000);
    
    // Select user from results
    const selectResult = await this.execJS(JS.selectUser(username));
    if (selectResult === 'not_found') {
      return { success: false, error: `User ${username} not found in search` };
    }
    await this.wait(1000);
    
    // Click Next/Chat
    await this.execJS(JS.clickNextChat);
    await this.wait(2000);
    
    // Send the message
    return this.sendMessage(message);
  }

  /**
   * Reply to unread conversations
   */
  async replyToUnread(replyFn: (username: string, lastMessage: string) => string | null): Promise<DMResult> {
    const convResult = await this.getConversations();
    if (!convResult.success) return convResult;
    
    const unread = (convResult.data.conversations as Conversation[]).filter(c => c.isUnread);
    const replies: any[] = [];
    
    for (const conv of unread) {
      const reply = replyFn(conv.username, conv.lastMessage);
      if (reply) {
        // Check rate limits before each reply
        const rateCheck = this.checkRateLimits();
        if (!rateCheck.allowed) {
          break; // Stop if rate limited
        }
        
        // Open conversation
        await this.openConversation(conv.index);
        await this.wait(1500);
        
        // Send reply
        const sendResult = await this.sendMessage(reply);
        replies.push({
          username: conv.username,
          reply,
          success: sendResult.success,
        });
        
        // Random delay between 1-3 minutes
        const delay = RATE_LIMITS.MIN_DELAY_MS + Math.random() * (RATE_LIMITS.MAX_DELAY_MS - RATE_LIMITS.MIN_DELAY_MS);
        await this.wait(delay);
      }
    }
    
    return {
      success: true,
      data: { repliesSent: replies.length, replies },
    };
  }

  /**
   * Get current rate limit status
   */
  getRateLimitStatus(): { dmsSentToday: number; dmsSentThisHour: number; canSend: boolean } {
    const check = this.checkRateLimits();
    return {
      dmsSentToday: this.dmsSentToday,
      dmsSentThisHour: this.dmsSentThisHour,
      canSend: check.allowed,
    };
  }

  /**
   * Reset hourly counter (call at start of each hour)
   */
  resetHourlyCounter(): void {
    this.dmsSentThisHour = 0;
  }

  /**
   * Reset daily counter (call at start of each day)
   */
  resetDailyCounter(): void {
    this.dmsSentToday = 0;
    this.dmsSentThisHour = 0;
  }
}

export default InstagramDM;
