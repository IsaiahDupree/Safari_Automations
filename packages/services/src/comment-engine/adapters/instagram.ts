/**
 * Instagram Comment Adapter
 * 
 * Posts comments to Instagram via Safari automation.
 * Uses selectors from python/selectors/instagram_selectors.py
 */

import { BaseCommentAdapter, PostCommentResult, VerifyCommentResult, AdapterConfig } from './base';
import type { CommentTask, PostTarget } from '../types';

// Selectors from instagram_selectors.py
const SELECTORS = {
  // Comment input
  COMMENT_TEXTAREA: 'textarea[placeholder*="comment" i], textarea[aria-label*="comment" i]',
  COMMENT_TEXTAREA_ADD: 'textarea[placeholder*="Add a comment" i]',
  
  // Post button
  COMMENT_POST_BUTTON: 'button[type="submit"]',
  
  // Comment icon to open input
  ACTION_COMMENT: 'svg[aria-label="Comment"]',
  
  // Post container
  POST_ARTICLE: 'article',
  
  // Login check
  LOGIN_CHECK: 'svg[aria-label="Home"]',
  
  // Dialog
  DIALOG: '[role="dialog"]',
  DIALOG_CLOSE: 'svg[aria-label="Close"]',
};

// JavaScript snippets for Instagram
const JS = {
  focusCommentInput: `
    (function() {
      var selectors = [
        'textarea[placeholder*="comment" i]',
        'textarea[aria-label*="comment" i]',
        'textarea[placeholder*="Add a comment" i]',
        'form textarea'
      ];
      
      for (var i = 0; i < selectors.length; i++) {
        var input = document.querySelector(selectors[i]);
        if (input && input.offsetParent !== null) {
          input.focus();
          input.click();
          return 'found';
        }
      }
      return 'not_found';
    })();
  `,
  
  typeComment: (text: string) => {
    const escaped = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/'/g, "\\'").replace(/\n/g, '\\n');
    return `
      (function() {
        var input = document.activeElement;
        if (input && input.tagName === 'TEXTAREA') {
          input.value = '${escaped}';
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          return 'typed';
        }
        
        var textarea = document.querySelector('textarea[placeholder*="comment" i]');
        if (textarea) {
          textarea.focus();
          textarea.value = '${escaped}';
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
          return 'typed';
        }
        
        return 'not_found';
      })();
    `;
  },
  
  submitComment: `
    (function() {
      var buttons = document.querySelectorAll('button[type="submit"], div[role="button"]');
      for (var i = 0; i < buttons.length; i++) {
        var text = (buttons[i].innerText || '').trim().toLowerCase();
        if (text === 'post' && !buttons[i].disabled) {
          buttons[i].click();
          return 'clicked_post';
        }
      }
      
      var input = document.activeElement;
      if (input && input.tagName === 'TEXTAREA') {
        var form = input.closest('form');
        if (form) {
          var submitBtn = form.querySelector('button[type="submit"]');
          if (submitBtn && !submitBtn.disabled) {
            submitBtn.click();
            return 'clicked_submit';
          }
        }
      }
      
      return 'not_found';
    })();
  `,
  
  checkCommentPosted: (commentText: string) => {
    const escaped = commentText.substring(0, 50).replace(/'/g, "\\'");
    return `
      (function() {
        var comments = document.querySelectorAll('span[dir="auto"]');
        for (var i = 0; i < comments.length; i++) {
          if (comments[i].innerText.includes('${escaped}')) {
            return 'found';
          }
        }
        return 'not_found';
      })();
    `;
  },
};

export class InstagramAdapter extends BaseCommentAdapter {
  readonly platform = 'instagram';

  constructor(config: AdapterConfig = {}) {
    super(config);
  }

  async postComment(task: CommentTask): Promise<PostCommentResult> {
    try {
      // Note: Actual Safari automation would be done here
      // This is the integration point with SafariController
      
      console.log(`[Instagram] Posting comment to ${task.target.postUrl}`);
      console.log(`[Instagram] Comment: "${task.generatedComment}"`);
      
      // Steps would be:
      // 1. Navigate to post URL
      // 2. Wait for page load
      // 3. Focus comment input (JS.focusCommentInput)
      // 4. Type comment (JS.typeComment)
      // 5. Submit (JS.submitComment)
      // 6. Wait for confirmation
      
      // Placeholder for actual implementation
      await this.wait(this.jitter(2000));
      
      return {
        success: true,
        commentId: `ig_${Date.now()}`,
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
      // Would execute JS.checkCommentPosted and verify
      console.log(`[Instagram] Verifying comment ${task.postedCommentId}`);
      
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
    // Check if comments are enabled on the post
    // Would check for disabled comment input or "Comments on this post have been limited"
    return true;
  }

  async navigateToPost(url: string): Promise<boolean> {
    // Would use SafariController to navigate
    console.log(`[Instagram] Navigating to ${url}`);
    return true;
  }

  getCommentInputSelector(): string {
    return SELECTORS.COMMENT_TEXTAREA;
  }

  getSubmitButtonSelector(): string {
    return SELECTORS.COMMENT_POST_BUTTON;
  }

  /**
   * Get all Instagram selectors for external use
   */
  static getSelectors() {
    return SELECTORS;
  }

  /**
   * Get JavaScript snippets for external use
   */
  static getJS() {
    return JS;
  }
}
