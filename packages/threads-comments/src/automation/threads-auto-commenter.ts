/**
 * ThreadsAutoCommenter - Full Comment Automation
 * 
 * Integrates all Threads automation from:
 * - python/selectors/threads_selectors.py
 * - python/engagement/threads_engagement.py
 * - python/automation/safari_threads_poster.py
 * - packages/services/src/comment-engine/adapters/threads.ts
 */

import { ThreadsDriver, JS_TEMPLATES, CommentResult } from './threads-driver.js';

export interface PostContext {
  mainPost: string;
  username: string;
  postUrl: string;
  replies: string[];
  likeCount: string;
  replyCount: string;
}

export interface EngagementResult {
  success: boolean;
  username: string;
  postUrl: string;
  postContent: string;
  repliesFound: number;
  generatedComment: string;
  commentPosted: boolean;
  commentId?: string;
  error?: string;
}

export interface AutoCommenterConfig {
  maxScrolls: number;
  delayBetweenActions: number;
  skipDuplicates: boolean;
  aiEnabled: boolean;
  openaiApiKey?: string;
}

const DEFAULT_AUTO_CONFIG: AutoCommenterConfig = {
  maxScrolls: 5,
  delayBetweenActions: 2000,
  skipDuplicates: true,
  aiEnabled: true,
};

// Additional JS from python/engagement/threads_engagement.py
const ENGAGEMENT_JS = {
  // Find all posts on feed (from JS_FIND_ALL_POSTS)
  findAllPosts: (limit: number) => `
    (function() {
      var posts = document.querySelectorAll('div[data-pressable-container="true"]');
      var results = [];
      for (var i = 0; i < Math.min(posts.length, ${limit}); i++) {
        var post = posts[i];
        var userLink = post.querySelector('a[href^="/@"]');
        var postLink = post.querySelector('a[href*="/post/"]');
        var content = '';
        post.querySelectorAll('span[dir="auto"]').forEach(function(el) { content += el.innerText + ' '; });
        if (userLink && postLink && content.length > 20) {
          results.push({
            username: userLink.getAttribute('href').replace('/@', '').split('/')[0],
            url: postLink.href,
            content: content.substring(0, 300),
            index: i
          });
        }
      }
      return JSON.stringify(results);
    })();
  `,

  // Extract full context including replies (from JS_EXTRACT_CONTEXT)
  extractFullContext: `
    (function() {
      var data = { mainPost: '', username: '', replies: [], likeCount: '', replyCount: '' };
      var posts = document.querySelectorAll('div[data-pressable-container="true"]');
      if (posts[0]) {
        var mainPost = posts[0];
        var userEl = mainPost.querySelector('a[href^="/@"]');
        if (userEl) { data.username = userEl.getAttribute('href').replace('/@', '').split('/')[0]; }
        mainPost.querySelectorAll('span[dir="auto"]').forEach(function(el) {
          var text = el.innerText.trim();
          if (text.length > 10 && !text.match(/^\\d+[hmd]$/) && text !== data.username) {
            data.mainPost += text + ' ';
          }
        });
        var statsText = mainPost.innerText;
        var likeMatch = statsText.match(/(\\d+[KkMm]?)\\s*like/i);
        var replyMatch = statsText.match(/(\\d+[KkMm]?)\\s*repl/i);
        if (likeMatch) data.likeCount = likeMatch[1];
        if (replyMatch) data.replyCount = replyMatch[1];
      }
      for (var i = 1; i < Math.min(posts.length, 10); i++) {
        var reply = posts[i];
        var replyUser = '';
        var replyText = '';
        var userEl = reply.querySelector('a[href^="/@"]');
        if (userEl) { replyUser = userEl.getAttribute('href').replace('/@', '').split('/')[0]; }
        reply.querySelectorAll('span[dir="auto"]').forEach(function(el) {
          var text = el.innerText.trim();
          if (text.length > 5 && !text.match(/^\\d+[hmd]$/) && text !== replyUser) { replyText += text + ' '; }
        });
        if (replyUser && replyText.length > 5) { data.replies.push('@' + replyUser + ': ' + replyText.substring(0, 120)); }
      }
      return JSON.stringify(data);
    })();
  `,

  // Focus input (from JS_FOCUS_INPUT)
  focusInput: `
    (function() {
      var els = document.querySelectorAll('[contenteditable="true"]');
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        if (el.offsetParent !== null && el.offsetHeight > 10) {
          el.scrollIntoView({block: 'center'});
          el.click();
          el.focus();
          if (el.innerText.trim() === '' || el.innerText.includes('reply') || el.innerText.includes('Reply')) {
            el.innerText = '';
          }
          el.click();
          el.focus();
          return 'focused';
        }
      }
      return 'not_found';
    })();
  `,

  // Submit button (from JS_SUBMIT - multiple strategies)
  submitComment: `
    (function() {
      // Strategy 1: Find "Post" text and click its clickable parent
      var allElements = document.querySelectorAll('div, span, button');
      for (var i = 0; i < allElements.length; i++) {
        var el = allElements[i];
        var directText = '';
        for (var c = 0; c < el.childNodes.length; c++) {
          if (el.childNodes[c].nodeType === 3) { directText += el.childNodes[c].textContent; }
        }
        directText = directText.trim();
        if (directText === 'Post' && el.offsetParent !== null) {
          var rect = el.getBoundingClientRect();
          if (rect.width > 20 && rect.height > 10) {
            var parent = el.parentElement;
            while (parent && parent !== document.body) {
              if (parent.getAttribute('role') === 'button' || parent.className.includes('x1i10hfl')) {
                parent.click();
                return 'clicked_post_parent';
              }
              parent = parent.parentElement;
            }
            el.click();
            return 'clicked_post_direct';
          }
        }
      }
      
      // Strategy 2: Second Reply button
      var replyBtns = document.querySelectorAll('svg[aria-label="Reply"]');
      if (replyBtns.length >= 2) {
        var btn = replyBtns[1].closest('[role="button"]') || replyBtns[1].parentElement;
        if (btn && !btn.getAttribute('aria-disabled')) { btn.click(); return 'clicked_reply'; }
      }
      
      // Strategy 3: Find circular post button near composer
      var composer = null;
      var editables = document.querySelectorAll('[contenteditable="true"]');
      for (var i = 0; i < editables.length; i++) {
        if (editables[i].offsetParent !== null && editables[i].offsetHeight > 5) {
          composer = editables[i]; break;
        }
      }
      if (composer) {
        var cRect = composer.getBoundingClientRect();
        var buttons = document.querySelectorAll('div[role="button"]');
        for (var i = 0; i < buttons.length; i++) {
          var btn = buttons[i];
          if (!btn.offsetParent) continue;
          var rect = btn.getBoundingClientRect();
          if (btn.querySelector('svg') && rect.left > cRect.right - 50 && Math.abs(rect.top - cRect.top) < 30 && rect.width >= 28 && rect.width <= 50) {
            btn.click();
            return 'clicked_inline_button';
          }
        }
      }
      return 'not_found';
    })();
  `,

  // Scroll down
  scrollDown: `(function() { window.scrollBy(0, 800); return 'scrolled'; })();`,

  // Click into post by index
  clickPost: (index: number) => `
    (function() {
      var posts = document.querySelectorAll('div[data-pressable-container="true"]');
      if (posts[${index}]) {
        var postLink = posts[${index}].querySelector('a[href*="/post/"]');
        if (postLink) { postLink.click(); return 'clicked'; }
      }
      return 'not_found';
    })();
  `,
};

export class ThreadsAutoCommenter {
  private driver: ThreadsDriver;
  private config: AutoCommenterConfig;
  private commentedUrls: Set<string> = new Set();

  constructor(config: Partial<AutoCommenterConfig> = {}) {
    this.config = { ...DEFAULT_AUTO_CONFIG, ...config };
    this.driver = new ThreadsDriver();
  }

  private wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private log(msg: string): void {
    console.log(`[ThreadsAutoCommenter] ${msg}`);
  }

  async findPostsToEngage(limit = 10): Promise<Array<{ username: string; url: string; content: string; index: number }>> {
    return this.driver.findPosts(limit);
  }

  async findNonDuplicatePost(): Promise<{ username: string; url: string; content: string; index: number } | null> {
    for (let scroll = 0; scroll < this.config.maxScrolls; scroll++) {
      const posts = await this.findPostsToEngage(15);
      
      for (const post of posts) {
        if (this.config.skipDuplicates && this.commentedUrls.has(post.url)) {
          this.log(`Skipping duplicate: @${post.username}`);
          continue;
        }
        return post;
      }

      // All visible posts are duplicates, scroll for more
      if (scroll < this.config.maxScrolls - 1) {
        this.log(`Scrolling for more posts... (${scroll + 1}/${this.config.maxScrolls})`);
        await this.driver.scroll();
        await this.wait(2000);
      }
    }
    return null;
  }

  async extractContext(): Promise<PostContext> {
    const context = await this.driver.getContext();
    const { stdout: urlOut } = await import('child_process').then(cp => 
      import('util').then(util => util.promisify(cp.exec)(
        `osascript -e 'tell application "Safari" to get URL of current tab of front window'`
      ))
    );
    
    return {
      mainPost: context.mainPost,
      username: context.username,
      postUrl: urlOut.trim(),
      replies: context.replies,
      likeCount: context.likeCount,
      replyCount: context.replyCount,
    };
  }

  async generateAIComment(context: PostContext): Promise<string> {
    if (!this.config.aiEnabled) {
      return `Great post! 🔥`;
    }

    // Simple AI integration - can be expanded
    const prompt = `Generate a brief, authentic comment for this Threads post:
Post by @${context.username}: "${context.mainPost.substring(0, 200)}"
${context.replies.length > 0 ? `Existing replies: ${context.replies.slice(0, 3).join(' | ')}` : ''}

Requirements:
- Be genuine and conversational
- 1-2 sentences max
- No hashtags
- Match the tone of the post`;

    // For now return a placeholder - integrate OpenAI later
    const templates = [
      `This is so relatable! 🙌`,
      `Love this perspective 💯`,
      `Couldn't agree more! ✨`,
      `This made my day 🔥`,
      `Such a great point! 👏`,
    ];
    return templates[Math.floor(Math.random() * templates.length)];
  }

  async postComment(comment: string): Promise<CommentResult> {
    return this.driver.postComment(comment);
  }

  async engageWithPost(postUrl?: string): Promise<EngagementResult> {
    const result: EngagementResult = {
      success: false,
      username: '',
      postUrl: '',
      postContent: '',
      repliesFound: 0,
      generatedComment: '',
      commentPosted: false,
    };

    try {
      this.log('Starting engagement flow...');

      // Step 1: Find or navigate to post
      if (postUrl) {
        this.log(`Navigating to: ${postUrl}`);
        await this.driver.navigateToPost(postUrl);
        await this.wait(3000);
      } else {
        this.log('Finding post to engage with...');
        const post = await this.findNonDuplicatePost();
        if (!post) {
          result.error = 'No non-duplicate post found';
          return result;
        }
        this.log(`Found: @${post.username} - ${post.content.substring(0, 50)}...`);
        
        // Click into the post
        await this.driver.clickPost(post.index);
        await this.wait(3000);
      }

      // Step 2: Extract context
      this.log('Extracting post context...');
      const context = await this.extractContext();
      result.username = context.username;
      result.postUrl = context.postUrl;
      result.postContent = context.mainPost;
      result.repliesFound = context.replies.length;

      if (context.mainPost.length < 10) {
        result.error = 'Insufficient post content';
        return result;
      }

      this.log(`Post: "${context.mainPost.substring(0, 60)}..."`);
      this.log(`Replies: ${context.replies.length}`);

      // Step 3: Generate comment
      this.log('Generating comment...');
      const comment = await this.generateAIComment(context);
      result.generatedComment = comment;
      this.log(`Comment: "${comment}"`);

      // Step 4: Post comment
      this.log('Posting comment...');
      const postResult = await this.postComment(comment);
      
      if (postResult.success) {
        result.commentPosted = true;
        result.commentId = postResult.commentId;
        result.success = true;
        this.commentedUrls.add(context.postUrl);
        this.log(`✅ Comment posted! ID: ${postResult.commentId}`);
      } else {
        result.error = postResult.error;
        this.log(`❌ Failed: ${postResult.error}`);
      }

      return result;
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
      this.log(`❌ Error: ${result.error}`);
      return result;
    }
  }

  async runEngagementLoop(count = 1, delayBetween = 60000): Promise<EngagementResult[]> {
    const results: EngagementResult[] = [];

    for (let i = 0; i < count; i++) {
      this.log(`\n${'='.repeat(50)}`);
      this.log(`Engagement ${i + 1}/${count}`);
      this.log('='.repeat(50));

      const result = await this.engageWithPost();
      results.push(result);

      if (i < count - 1) {
        this.log(`Waiting ${delayBetween / 1000}s before next engagement...`);
        await this.wait(delayBetween);
      }
    }

    return results;
  }

  getCommentedUrls(): string[] {
    return Array.from(this.commentedUrls);
  }

  clearCommentedUrls(): void {
    this.commentedUrls.clear();
  }
}
