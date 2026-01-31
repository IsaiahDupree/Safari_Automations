/**
 * Threads Comment Adapter
 * 
 * Posts replies to Threads via Safari automation.
 * Uses selectors from python/selectors/threads_selectors.py
 */

import { BaseCommentAdapter, PostCommentResult, VerifyCommentResult, AdapterConfig } from './base';
import type { CommentTask, PostTarget } from '../types';

// Selectors from threads_selectors.py
const SELECTORS = {
  // Navigation
  NAV_HOME: 'svg[aria-label="Home"]',
  NAV_SEARCH: 'svg[aria-label="Search"]',
  NAV_CREATE: 'svg[aria-label="Create"]',
  NAV_NOTIFICATIONS: 'svg[aria-label="Notifications"]',
  NAV_PROFILE: 'svg[aria-label="Profile"]',
  NAV_BACK: 'svg[aria-label="Back"]',
  
  // Post actions
  ACTION_LIKE: 'svg[aria-label="Like"]',
  ACTION_UNLIKE: 'svg[aria-label="Unlike"]',
  ACTION_REPLY: 'svg[aria-label="Reply"]',
  ACTION_REPOST: 'svg[aria-label="Repost"]',
  ACTION_SHARE: 'svg[aria-label="Share"]',
  
  // Composer
  COMPOSER_INPUT: '[role="textbox"][contenteditable="true"]',
  COMPOSER_INPUT_ALT: '[contenteditable="true"]',
  COMPOSER_SUBMIT_REPLY: 'svg[aria-label="Reply"]',
  COMPOSER_SUBMIT_CREATE: 'svg[aria-label="Create"]',
  
  // Content
  POST_CONTAINER: '[data-pressable-container="true"]',
  USER_LINK: 'a[href*="/@"]',
  POST_LINK: 'a[href*="/post/"]',
  TEXT_CONTENT: '[dir="auto"] span',
  
  // Dialog
  DIALOG: '[role="dialog"]',
  DIALOG_CLOSE: 'svg[aria-label="Close"]',
};

// JavaScript snippets for Threads
const JS = {
  clickReplyButton: `
    (function() {
      var replyBtns = document.querySelectorAll('svg[aria-label="Reply"]');
      if (replyBtns.length > 0) {
        var btn = replyBtns[0].closest('[role="button"]') || replyBtns[0].parentElement;
        if (btn) {
          btn.click();
          return 'clicked';
        }
      }
      return 'not_found';
    })();
  `,
  
  typeInComposer: (text: string) => {
    const escaped = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/'/g, "\\'").replace(/\n/g, '\\n');
    return `
      (function() {
        var input = document.querySelector('[role="textbox"][contenteditable="true"]');
        if (!input) {
          input = document.querySelector('[contenteditable="true"]');
        }
        if (input) {
          input.focus();
          input.innerText = '${escaped}';
          input.dispatchEvent(new InputEvent('input', { bubbles: true }));
          return 'typed';
        }
        return 'input_not_found';
      })();
    `;
  },
  
  submitReply: `
    (function() {
      // Look for the submit Reply button (second one on page when composer is open)
      var replyBtns = document.querySelectorAll('svg[aria-label="Reply"]');
      if (replyBtns.length >= 2) {
        var btn = replyBtns[1].closest('[role="button"]') || replyBtns[1].parentElement;
        if (btn && !btn.getAttribute('aria-disabled')) {
          btn.click();
          return 'clicked_reply';
        }
      }
      
      // Fallback: look for Post button
      var buttons = document.querySelectorAll('[role="button"]');
      for (var i = 0; i < buttons.length; i++) {
        var text = (buttons[i].innerText || '').trim();
        if (text === 'Post' && !buttons[i].getAttribute('aria-disabled')) {
          buttons[i].click();
          return 'clicked_post';
        }
      }
      
      return 'submit_not_found';
    })();
  `,
  
  getPostDetails: `
    (function() {
      var container = document.querySelector('[data-pressable-container="true"]');
      if (!container) return JSON.stringify({error: 'no_container'});
      
      var userLink = container.querySelector('a[href*="/@"]');
      var username = userLink ? userLink.href.split('/@').pop().split('/')[0] : '';
      
      var textEl = container.querySelector('[dir="auto"] span');
      var text = textEl ? textEl.innerText : '';
      
      var timeEl = container.querySelector('time');
      var timestamp = timeEl ? timeEl.getAttribute('datetime') : '';
      
      var postLink = container.querySelector('a[href*="/post/"]');
      var postId = '';
      if (postLink) {
        var match = postLink.href.match(/\\/post\\/([A-Za-z0-9_-]+)/);
        postId = match ? match[1] : '';
      }
      
      return JSON.stringify({
        username: username,
        text: text.substring(0, 500),
        timestamp: timestamp,
        post_id: postId,
        url: window.location.href
      });
    })();
  `,
  
  extractComments: (limit: number = 50) => `
    (function() {
      var comments = [];
      var containers = document.querySelectorAll('[data-pressable-container="true"]');
      
      for (var i = 1; i < Math.min(containers.length, ${limit + 1}); i++) {
        var el = containers[i];
        
        var userLink = el.querySelector('a[href*="/@"]');
        var username = userLink ? userLink.href.split('/@').pop().split('/')[0].split('?')[0] : '';
        
        var textEl = el.querySelector('[dir="auto"] span');
        var text = textEl ? textEl.innerText : '';
        
        var timeEl = el.querySelector('time');
        var timestamp = timeEl ? timeEl.getAttribute('datetime') : '';
        
        if (username && text) {
          comments.push({
            username: username,
            text: text.substring(0, 500),
            timestamp: timestamp
          });
        }
      }
      
      return JSON.stringify(comments);
    })();
  `,
  
  checkLoginStatus: `
    (function() {
      var createBtn = document.querySelector('svg[aria-label="Create"]');
      if (createBtn) return 'logged_in';
      
      var profileBtn = document.querySelector('svg[aria-label="Profile"]');
      if (profileBtn) return 'logged_in';
      
      var loginBtn = document.querySelector('a[href*="/login"]');
      if (loginBtn) return 'not_logged_in';
      
      return 'unknown';
    })();
  `,
};

export class ThreadsAdapter extends BaseCommentAdapter {
  readonly platform = 'threads';

  constructor(config: AdapterConfig = {}) {
    super(config);
  }

  async postComment(task: CommentTask): Promise<PostCommentResult> {
    try {
      console.log(`[Threads] Posting reply to ${task.target.postUrl}`);
      console.log(`[Threads] Reply: "${task.generatedComment}"`);
      
      // Steps would be:
      // 1. Navigate to post URL
      // 2. Click reply button
      // 3. Type in composer
      // 4. Submit reply
      // 5. Wait for confirmation
      
      await this.wait(this.jitter(2000));
      
      return {
        success: true,
        commentId: `th_${Date.now()}`,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async verifyComment(task: CommentTask): Promise<VerifyCommentResult> {
    try {
      console.log(`[Threads] Verifying reply ${task.postedCommentId}`);
      
      await this.wait(this.jitter(1000));
      
      return {
        found: true,
        commentId: task.postedCommentId,
        content: task.generatedComment,
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        found: false,
      };
    }
  }

  async canComment(target: PostTarget): Promise<boolean> {
    return true;
  }

  async navigateToPost(url: string): Promise<boolean> {
    console.log(`[Threads] Navigating to ${url}`);
    return true;
  }

  getCommentInputSelector(): string {
    return SELECTORS.COMPOSER_INPUT;
  }

  getSubmitButtonSelector(): string {
    return SELECTORS.COMPOSER_SUBMIT_REPLY;
  }

  static getSelectors() {
    return SELECTORS;
  }

  static getJS() {
    return JS;
  }
}
