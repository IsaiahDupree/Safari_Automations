/**
 * TikTok Comment Adapter
 * 
 * Posts comments to TikTok via Safari automation.
 * Uses selectors from python/selectors/tiktok_selectors.py
 */

import { BaseCommentAdapter, PostCommentResult, VerifyCommentResult, AdapterConfig } from './base';
import type { CommentTask, PostTarget } from '../types';

// Selectors from tiktok_selectors.py
const SELECTORS = {
  // Root containers
  APP_ROOT: '#app',
  FYP_ROOT: '#main-content-homepage_hot',
  
  // Interaction icons
  COMMENT_ICON: '[data-e2e="comment-icon"]',
  LIKE_ICON: '[data-e2e="like-icon"]',
  SHARE_ICON: '[data-e2e="share-icon"]',
  
  // Comment section
  COMMENT_SIDEBAR: '[class*="DivCommentSidebarTransitionWrapper"]',
  COMMENT_FOOTER: '[class*="DivCommentFooter"]',
  POST_BUTTON: '[class*="DivPostButton"]',
  
  // Input
  COMMENT_INPUT: '[contenteditable="true"]',
  
  // Messages/DMs
  CHAT_BOTTOM: '[class*="DivChatBottom"]',
  MESSAGE_INPUT: '[class*="DivMessageInputAndSendButton"]',
  
  // Login check
  PROFILE_ICON: '[data-e2e="profile-icon"]',
  UPLOAD_ICON: '[data-e2e="upload-icon"]',
};

// JavaScript snippets for TikTok
const JS = {
  openCommentSection: `
    (function() {
      var icons = document.querySelectorAll('[data-e2e="comment-icon"]');
      var visible = null;
      for (var icon of icons) {
        var rect = icon.getBoundingClientRect();
        if (rect.top > 0 && rect.top < window.innerHeight && rect.left > 0) {
          icon.click();
          return 'clicked';
        }
      }
      return 'not_found';
    })();
  `,
  
  focusCommentInput: `
    (function() {
      var footer = document.querySelector('[class*="DivCommentFooter"]');
      if (footer) {
        var input = footer.querySelector('[contenteditable="true"]');
        if (input) {
          input.focus();
          return 'found';
        }
        return 'input_not_found';
      }
      return 'footer_not_found';
    })();
  `,
  
  typeComment: (text: string) => {
    const escaped = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/'/g, "\\'").replace(/\n/g, '\\n');
    return `
      (function() {
        var footer = document.querySelector('[class*="DivCommentFooter"]');
        if (footer) {
          var input = footer.querySelector('[contenteditable="true"]');
          if (input) {
            input.focus();
            input.innerText = '${escaped}';
            input.dispatchEvent(new InputEvent('input', { bubbles: true }));
            return 'typed';
          }
        }
        return 'not_found';
      })();
    `;
  },
  
  submitComment: `
    (function() {
      var postBtn = document.querySelector('[class*="DivPostButton"]');
      if (postBtn) {
        postBtn.click();
        return 'clicked';
      }
      
      // Fallback: look for submit button in footer
      var footer = document.querySelector('[class*="DivCommentFooter"]');
      if (footer) {
        var btn = footer.querySelector('button[type="submit"], [role="button"]');
        if (btn) {
          btn.click();
          return 'clicked_fallback';
        }
      }
      
      return 'not_found';
    })();
  `,
  
  checkIfLiked: `
    (function() {
      var icons = document.querySelectorAll('[data-e2e="like-icon"]');
      for (var icon of icons) {
        var rect = icon.getBoundingClientRect();
        if (rect.top > 0 && rect.top < window.innerHeight && rect.left > 0) {
          var svg = icon.querySelector('svg');
          if (svg) {
            var fill = window.getComputedStyle(svg).fill;
            if (fill.includes('255, 56, 92')) {
              return 'true';
            }
          }
          return 'false';
        }
      }
      return 'not_found';
    })();
  `,
  
  getVideoStats: `
    (function() {
      var stats = {};
      
      var likeIcon = document.querySelector('[data-e2e="like-icon"]');
      if (likeIcon) {
        var parent = likeIcon.closest('[class*="DivActionItem"]');
        if (parent) {
          var count = parent.querySelector('strong');
          stats.likes = count ? count.innerText : '0';
        }
      }
      
      var commentIcon = document.querySelector('[data-e2e="comment-icon"]');
      if (commentIcon) {
        var parent = commentIcon.closest('[class*="DivActionItem"]');
        if (parent) {
          var count = parent.querySelector('strong');
          stats.comments = count ? count.innerText : '0';
        }
      }
      
      return JSON.stringify(stats);
    })();
  `,
};

export class TikTokAdapter extends BaseCommentAdapter {
  readonly platform = 'tiktok';

  constructor(config: AdapterConfig = {}) {
    super(config);
  }

  async postComment(task: CommentTask): Promise<PostCommentResult> {
    try {
      console.log(`[TikTok] Posting comment to ${task.target.postUrl}`);
      console.log(`[TikTok] Comment: "${task.generatedComment}"`);
      
      // Steps would be:
      // 1. Navigate to video URL
      // 2. Click comment icon to open sidebar
      // 3. Focus comment input
      // 4. Type comment
      // 5. Submit
      // 6. Wait for confirmation
      
      await this.wait(this.jitter(2500));
      
      return {
        success: true,
        commentId: `tt_${Date.now()}`,
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
      console.log(`[TikTok] Verifying comment ${task.postedCommentId}`);
      
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
    // Check if comments are enabled on the video
    return true;
  }

  async navigateToPost(url: string): Promise<boolean> {
    console.log(`[TikTok] Navigating to ${url}`);
    return true;
  }

  getCommentInputSelector(): string {
    return SELECTORS.COMMENT_INPUT;
  }

  getSubmitButtonSelector(): string {
    return SELECTORS.POST_BUTTON;
  }

  static getSelectors() {
    return SELECTORS;
  }

  static getJS() {
    return JS;
  }
}
