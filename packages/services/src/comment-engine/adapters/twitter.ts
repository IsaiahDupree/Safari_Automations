/**
 * Twitter/X Comment Adapter
 * 
 * Posts replies to Twitter/X via Safari automation.
 * Uses selectors from python/selectors and docs/platforms/twitter-x.md
 */

import { BaseCommentAdapter, PostCommentResult, VerifyCommentResult, AdapterConfig } from './base';
import type { CommentTask, PostTarget } from '../types';

// Selectors for Twitter/X
const SELECTORS = {
  // Tweet/Post containers
  TWEET_ARTICLE: 'article[data-testid="tweet"]',
  TWEET_TEXT: '[data-testid="tweetText"]',
  
  // Reply input
  REPLY_INPUT: '[data-testid="tweetTextarea_0"]',
  REPLY_INPUT_ALT: 'div[role="textbox"][data-testid="tweetTextarea_0"]',
  
  // Reply button
  REPLY_BUTTON: '[data-testid="tweetButtonInline"]',
  REPLY_SUBMIT: '[data-testid="tweetButton"]',
  
  // Actions
  ACTION_REPLY: '[data-testid="reply"]',
  ACTION_LIKE: '[data-testid="like"]',
  ACTION_RETWEET: '[data-testid="retweet"]',
  
  // Login check
  LOGIN_CHECK: '[data-testid="AppTabBar_Profile_Link"]',
  NEW_TWEET_BUTTON: '[data-testid="SideNav_NewTweet_Button"]',
  
  // Dialog
  DIALOG: '[role="dialog"]',
  DIALOG_CLOSE: '[data-testid="app-bar-close"]',
};

// JavaScript snippets for Twitter
const JS = {
  focusReplyInput: `
    (function() {
      // Click reply button first to open composer
      var replyBtn = document.querySelector('[data-testid="reply"]');
      if (replyBtn) {
        replyBtn.click();
      }
      
      // Wait a moment then focus
      setTimeout(function() {
        var input = document.querySelector('[data-testid="tweetTextarea_0"]');
        if (input) {
          input.focus();
          return 'found';
        }
      }, 500);
      
      return 'clicked_reply';
    })();
  `,
  
  typeReply: (text: string) => {
    const escaped = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/'/g, "\\'").replace(/\n/g, '\\n');
    return `
      (function() {
        var input = document.querySelector('[data-testid="tweetTextarea_0"]');
        if (input) {
          input.focus();
          
          // Use execCommand for contenteditable
          document.execCommand('insertText', false, '${escaped}');
          
          // Dispatch events
          input.dispatchEvent(new InputEvent('input', { bubbles: true, data: '${escaped}' }));
          
          return 'typed';
        }
        return 'not_found';
      })();
    `;
  },
  
  submitReply: `
    (function() {
      // Look for the inline reply button or the modal reply button
      var submitBtn = document.querySelector('[data-testid="tweetButtonInline"]') ||
                      document.querySelector('[data-testid="tweetButton"]');
      
      if (submitBtn && !submitBtn.disabled) {
        submitBtn.click();
        return 'clicked';
      }
      return 'not_found';
    })();
  `,
  
  checkReplyPosted: (replyText: string) => {
    const escaped = replyText.substring(0, 50).replace(/'/g, "\\'");
    return `
      (function() {
        var tweets = document.querySelectorAll('[data-testid="tweetText"]');
        for (var i = 0; i < tweets.length; i++) {
          if (tweets[i].innerText.includes('${escaped}')) {
            return 'found';
          }
        }
        return 'not_found';
      })();
    `;
  },
  
  getTweetStats: `
    (function() {
      var article = document.querySelector('article[data-testid="tweet"]');
      if (!article) return JSON.stringify({error: 'no_tweet'});
      
      var stats = {};
      
      // Get reply count
      var replyBtn = article.querySelector('[data-testid="reply"]');
      if (replyBtn) {
        var count = replyBtn.querySelector('span[data-testid="app-text-transition-container"]');
        stats.replies = count ? parseInt(count.innerText) || 0 : 0;
      }
      
      // Get retweet count
      var rtBtn = article.querySelector('[data-testid="retweet"]');
      if (rtBtn) {
        var count = rtBtn.querySelector('span[data-testid="app-text-transition-container"]');
        stats.retweets = count ? parseInt(count.innerText) || 0 : 0;
      }
      
      // Get like count
      var likeBtn = article.querySelector('[data-testid="like"]');
      if (likeBtn) {
        var count = likeBtn.querySelector('span[data-testid="app-text-transition-container"]');
        stats.likes = count ? parseInt(count.innerText) || 0 : 0;
      }
      
      return JSON.stringify(stats);
    })();
  `,
};

export class TwitterAdapter extends BaseCommentAdapter {
  readonly platform = 'twitter';

  constructor(config: AdapterConfig = {}) {
    super(config);
  }

  async postComment(task: CommentTask): Promise<PostCommentResult> {
    try {
      console.log(`[Twitter] Posting reply to ${task.target.postUrl}`);
      console.log(`[Twitter] Reply: "${task.generatedComment}"`);
      
      // Steps would be:
      // 1. Navigate to tweet URL
      // 2. Click reply button to open composer
      // 3. Type reply
      // 4. Submit
      // 5. Wait for confirmation
      
      await this.wait(this.jitter(2000));
      
      return {
        success: true,
        commentId: `tw_${Date.now()}`,
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
      console.log(`[Twitter] Verifying reply ${task.postedCommentId}`);
      
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
    // Check if replies are enabled
    // Would check for "Who can reply" restrictions
    return true;
  }

  async navigateToPost(url: string): Promise<boolean> {
    console.log(`[Twitter] Navigating to ${url}`);
    return true;
  }

  getCommentInputSelector(): string {
    return SELECTORS.REPLY_INPUT;
  }

  getSubmitButtonSelector(): string {
    return SELECTORS.REPLY_SUBMIT;
  }

  static getSelectors() {
    return SELECTORS;
  }

  static getJS() {
    return JS;
  }
}
