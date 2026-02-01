/**
 * TikTok Selector Discovery Script
 * Run via Safari automation to discover and document all selectors
 */

// Run this in the browser console or via Safari automation

const TikTokDiscovery = {
  
  // Discover all data-e2e attributes on the page
  discoverE2eSelectors: function() {
    const elements = document.querySelectorAll('[data-e2e]');
    const counts = {};
    elements.forEach(el => {
      const attr = el.getAttribute('data-e2e');
      if (attr) {
        if (!counts[attr]) counts[attr] = { count: 0, samples: [] };
        counts[attr].count++;
        if (counts[attr].samples.length < 2) {
          counts[attr].samples.push({
            tag: el.tagName,
            text: el.innerText.substring(0, 50).replace(/\n/g, ' ')
          });
        }
      }
    });
    return counts;
  },

  // Discover class patterns (extract semantic names from TikTok classes)
  discoverClassPatterns: function() {
    const divs = document.querySelectorAll('div[class]');
    const patterns = {};
    divs.forEach(div => {
      const matches = div.className.match(/--([A-Z][a-zA-Z]+)/g);
      if (matches) {
        matches.forEach(m => {
          const name = m.replace('--', '');
          if (!patterns[name]) patterns[name] = { count: 0, sample: null };
          patterns[name].count++;
          if (!patterns[name].sample) {
            patterns[name].sample = div.innerText.substring(0, 40).replace(/\n/g, ' ');
          }
        });
      }
    });
    return patterns;
  },

  // Extract conversation list data
  extractConversations: function(limit = 20) {
    const items = document.querySelectorAll('[data-e2e="chat-list-item"]');
    const conversations = [];
    for (let i = 0; i < Math.min(items.length, limit); i++) {
      const item = items[i];
      const nickname = item.querySelector('[class*="PInfoNickname"]');
      const extract = item.querySelector('[class*="SpanInfoExtract"]');
      const time = item.querySelector('[class*="SpanInfoTime"]');
      const avatar = item.querySelector('[class*="ImgAvatar"]');
      conversations.push({
        displayName: nickname ? nickname.innerText.trim() : null,
        lastMessage: extract ? extract.innerText.trim() : null,
        timestamp: time ? time.innerText.trim() : null,
        avatarUrl: avatar ? avatar.src : null
      });
    }
    return { count: items.length, conversations };
  },

  // Extract chat messages data
  extractMessages: function(limit = 50) {
    const items = document.querySelectorAll('[data-e2e="chat-item"]');
    const messages = [];
    for (let i = 0; i < Math.min(items.length, limit); i++) {
      const item = items[i];
      const link = item.querySelector('a[href*="@"]');
      const sender = link ? link.href.match(/@([^/]+)/)?.[1] : null;
      const textEl = item.querySelector('[class*="TextContainer"]');
      const videoEl = item.querySelector('[class*="VideoContainer"]');
      const authorEl = item.querySelector('[class*="AuthorInnerContainer"]');
      messages.push({
        sender: sender,
        type: textEl ? 'text' : videoEl ? 'video' : 'other',
        content: textEl ? textEl.innerText.trim() : 
                 authorEl ? authorEl.innerText.trim() : 
                 item.innerText.trim().substring(0, 100)
      });
    }
    return { count: items.length, messages };
  },

  // Extract chat header info
  extractChatHeader: function() {
    return {
      nickname: document.querySelector('[data-e2e="chat-nickname"]')?.innerText || null,
      uniqueId: document.querySelector('[data-e2e="chat-uniqueid"]')?.innerText || null,
      avatarSrc: document.querySelector('[data-e2e="top-chat-avatar"] img')?.src || null
    };
  },

  // Extract timestamps
  extractTimestamps: function() {
    const containers = document.querySelectorAll('[class*="TimeContainer"]');
    return Array.from(containers).map(c => c.innerText.trim());
  },

  // Scroll conversation list to load more
  scrollConversationList: function() {
    const list = document.querySelector('[class*="DivConversationListContainer"]');
    if (list) {
      const before = document.querySelectorAll('[data-e2e="chat-list-item"]').length;
      list.scrollTop = list.scrollHeight;
      return { scrolled: true, beforeCount: before };
    }
    return { scrolled: false };
  },

  // Scroll chat messages to load more
  scrollChatMessages: function() {
    const chat = document.querySelector('[class*="DivChatMain"]');
    if (chat) {
      const before = document.querySelectorAll('[data-e2e="chat-item"]').length;
      chat.scrollTop = 0; // Scroll up to load older messages
      return { scrolled: true, beforeCount: before };
    }
    return { scrolled: false };
  },

  // Full discovery - run all discovery functions
  fullDiscovery: function() {
    return {
      url: window.location.href,
      timestamp: new Date().toISOString(),
      e2eSelectors: this.discoverE2eSelectors(),
      classPatterns: this.discoverClassPatterns(),
      chatHeader: this.extractChatHeader(),
      conversations: this.extractConversations(10),
      messages: this.extractMessages(10),
      timestamps: this.extractTimestamps()
    };
  }
};

// Export for use
if (typeof module !== 'undefined') module.exports = TikTokDiscovery;
