/**
 * Safari Service
 * 
 * High-level Safari automation service that connects to platform adapters.
 * Manages browser state, session, and coordinates actions.
 */

import { SafariExecutor } from './safari-executor';
import type { SafariConfig, ExecutionResult, NavigationResult } from './types';
import { DEFAULT_CONFIG } from './types';
import type { CommentTask } from '../comment-engine/types';

export class SafariService {
  private executor: SafariExecutor;
  private config: SafariConfig;
  private isReady = false;

  constructor(config: Partial<SafariConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.executor = new SafariExecutor(this.config);
  }

  /**
   * Initialize Safari and verify it's ready
   */
  async initialize(): Promise<boolean> {
    this.isReady = await this.executor.ensureSafariReady();
    return this.isReady;
  }

  /**
   * Navigate to a URL
   */
  async navigateTo(url: string): Promise<NavigationResult> {
    if (!this.isReady) {
      await this.initialize();
    }
    return this.executor.navigateTo(url);
  }

  /**
   * Post a comment to Instagram
   */
  async postInstagramComment(task: CommentTask): Promise<ExecutionResult> {
    const startTime = Date.now();
    
    try {
      // Navigate to post
      const nav = await this.executor.navigateWithVerification(
        task.target.postUrl,
        'instagram.com'
      );
      
      if (!nav.success) {
        return { success: false, error: nav.error, duration: Date.now() - startTime };
      }

      await this.wait(2000);

      // Focus comment input
      const focusResult = await this.executor.executeJS(`
        (function() {
          var selectors = [
            'textarea[placeholder*="comment" i]',
            'textarea[aria-label*="comment" i]',
            'textarea[placeholder*="Add a comment" i]'
          ];
          for (var s of selectors) {
            var input = document.querySelector(s);
            if (input && input.offsetParent !== null) {
              input.focus();
              input.click();
              return 'found';
            }
          }
          return 'not_found';
        })();
      `);

      if (focusResult.result !== 'found') {
        // Try clicking comment icon first
        await this.executor.executeJS(`
          var btn = document.querySelector('svg[aria-label="Comment"]');
          if (btn) {
            var parent = btn.closest('button') || btn.parentElement;
            if (parent) parent.click();
          }
        `);
        await this.wait(1000);
      }

      // Type comment
      await this.executor.typeViaClipboard(task.generatedComment!);
      await this.wait(500);

      // Submit
      const submitResult = await this.executor.executeJS(`
        (function() {
          var buttons = document.querySelectorAll('button[type="submit"], div[role="button"]');
          for (var btn of buttons) {
            var text = (btn.innerText || '').trim().toLowerCase();
            if (text === 'post' && !btn.disabled) {
              btn.click();
              return 'clicked';
            }
          }
          return 'not_found';
        })();
      `);

      await this.wait(2000);

      return {
        success: submitResult.result === 'clicked',
        data: { commentId: `ig_${Date.now()}` },
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Post a reply to Twitter
   */
  async postTwitterReply(task: CommentTask): Promise<ExecutionResult> {
    const startTime = Date.now();
    
    try {
      const nav = await this.executor.navigateWithVerification(
        task.target.postUrl,
        'x.com'
      );
      
      if (!nav.success) {
        return { success: false, error: nav.error, duration: Date.now() - startTime };
      }

      await this.wait(2000);

      // Click reply button
      await this.executor.executeJS(`
        var replyBtn = document.querySelector('[data-testid="reply"]');
        if (replyBtn) replyBtn.click();
      `);
      
      await this.wait(1500);

      // Type reply
      await this.executor.typeViaClipboard(task.generatedComment!);
      await this.wait(500);

      // Submit
      const submitResult = await this.executor.executeJS(`
        (function() {
          var btn = document.querySelector('[data-testid="tweetButtonInline"]') ||
                    document.querySelector('[data-testid="tweetButton"]');
          if (btn && !btn.disabled) {
            btn.click();
            return 'clicked';
          }
          return 'not_found';
        })();
      `);

      await this.wait(2000);

      return {
        success: submitResult.result === 'clicked',
        data: { commentId: `tw_${Date.now()}` },
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Post a comment to TikTok
   */
  async postTikTokComment(task: CommentTask): Promise<ExecutionResult> {
    const startTime = Date.now();
    
    try {
      const nav = await this.executor.navigateWithVerification(
        task.target.postUrl,
        'tiktok.com'
      );
      
      if (!nav.success) {
        return { success: false, error: nav.error, duration: Date.now() - startTime };
      }

      await this.wait(2500);

      // Click comment icon to open sidebar
      await this.executor.executeJS(`
        var icons = document.querySelectorAll('[data-e2e="comment-icon"]');
        for (var icon of icons) {
          var rect = icon.getBoundingClientRect();
          if (rect.top > 0 && rect.top < window.innerHeight) {
            icon.click();
            break;
          }
        }
      `);
      
      await this.wait(1500);

      // Focus and type in comment input
      await this.executor.executeJS(`
        var footer = document.querySelector('[class*="DivCommentFooter"]');
        if (footer) {
          var input = footer.querySelector('[contenteditable="true"]');
          if (input) input.focus();
        }
      `);
      
      await this.wait(300);
      await this.executor.typeViaClipboard(task.generatedComment!);
      await this.wait(500);

      // Submit
      const submitResult = await this.executor.executeJS(`
        (function() {
          var btn = document.querySelector('[class*="DivPostButton"]');
          if (btn) {
            btn.click();
            return 'clicked';
          }
          return 'not_found';
        })();
      `);

      await this.wait(2000);

      return {
        success: submitResult.result === 'clicked',
        data: { commentId: `tt_${Date.now()}` },
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Post a reply to Threads
   */
  async postThreadsReply(task: CommentTask): Promise<ExecutionResult> {
    const startTime = Date.now();
    
    try {
      const nav = await this.executor.navigateWithVerification(
        task.target.postUrl,
        'threads.net'
      );
      
      if (!nav.success) {
        return { success: false, error: nav.error, duration: Date.now() - startTime };
      }

      await this.wait(2000);

      // Click reply button
      await this.executor.executeJS(`
        var replyBtns = document.querySelectorAll('svg[aria-label="Reply"]');
        if (replyBtns.length > 0) {
          var btn = replyBtns[0].closest('[role="button"]') || replyBtns[0].parentElement;
          if (btn) btn.click();
        }
      `);
      
      await this.wait(1500);

      // Focus composer and type
      await this.executor.executeJS(`
        var input = document.querySelector('[role="textbox"][contenteditable="true"]');
        if (input) input.focus();
      `);
      
      await this.wait(300);
      await this.executor.typeViaClipboard(task.generatedComment!);
      await this.wait(500);

      // Submit
      const submitResult = await this.executor.executeJS(`
        (function() {
          var replyBtns = document.querySelectorAll('svg[aria-label="Reply"]');
          if (replyBtns.length >= 2) {
            var btn = replyBtns[1].closest('[role="button"]');
            if (btn && !btn.getAttribute('aria-disabled')) {
              btn.click();
              return 'clicked';
            }
          }
          return 'not_found';
        })();
      `);

      await this.wait(2000);

      return {
        success: submitResult.result === 'clicked',
        data: { commentId: `th_${Date.now()}` },
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Post comment to any platform
   */
  async postComment(task: CommentTask): Promise<ExecutionResult> {
    switch (task.target.platform) {
      case 'instagram':
        return this.postInstagramComment(task);
      case 'twitter':
        return this.postTwitterReply(task);
      case 'tiktok':
        return this.postTikTokComment(task);
      case 'threads':
        return this.postThreadsReply(task);
      default:
        return {
          success: false,
          error: `Unsupported platform: ${task.target.platform}`,
          duration: 0,
        };
    }
  }

  /**
   * Check login status for a platform
   */
  async checkLoginStatus(platform: string): Promise<{ loggedIn: boolean; username?: string }> {
    const checks: Record<string, { url: string; selector: string }> = {
      instagram: {
        url: 'https://www.instagram.com/',
        selector: 'svg[aria-label="Home"]',
      },
      twitter: {
        url: 'https://x.com/home',
        selector: '[data-testid="AppTabBar_Profile_Link"]',
      },
      tiktok: {
        url: 'https://www.tiktok.com/',
        selector: '[data-e2e="profile-icon"]',
      },
      threads: {
        url: 'https://www.threads.net/',
        selector: 'svg[aria-label="Create"]',
      },
    };

    const check = checks[platform];
    if (!check) {
      return { loggedIn: false };
    }

    await this.executor.navigateTo(check.url);
    await this.wait(3000);

    const result = await this.executor.executeJS(`
      !!document.querySelector('${check.selector}')
    `);

    return {
      loggedIn: result.result === 'true',
    };
  }

  /**
   * Get executor for direct access
   */
  getExecutor(): SafariExecutor {
    return this.executor;
  }

  private wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
