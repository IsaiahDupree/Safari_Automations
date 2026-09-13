/**
 * Medium Operations
 *
 * High-level automation for Medium blogging platform:
 *   - Create & publish blog posts (title, body, tags, subtitle)
 *   - Clap on articles (1-50 claps)
 *   - Respond/comment on articles
 *   - Follow/unfollow authors
 *   - Bookmark articles
 *   - Read & extract article content
 *   - Extract article metrics (claps, responses)
 *   - Search articles
 *   - Read user profile & stories
 *   - Get notification count
 *   - Read your own stats
 */

import { MediumSafariDriver, SELECTORS } from './safari-driver.js';

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export interface MediumArticle {
  url: string;
  title: string;
  subtitle?: string;
  author: string;
  authorUrl?: string;
  publication?: string;
  readTime?: string;
  claps?: number;
  responses?: number;
  content?: string;             // First ~2000 chars of article text
  tags?: string[];
  publishedDate?: string;
}

export interface MediumFeedItem {
  title: string;
  url: string;
  author: string;
  authorUrl?: string;
  publication?: string;
  snippet?: string;
}

export interface PostDraft {
  title: string;
  body: string;                 // Plain text or markdown-ish
  tags?: string[];
  subtitle?: string;
  publishImmediately?: boolean; // true = publish, false = save as draft
}

export interface PostResult {
  success: boolean;
  url?: string;
  status: 'published' | 'draft' | 'failed';
  error?: string;
}

export interface ClapResult {
  success: boolean;
  clapsGiven: number;
  error?: string;
}

export interface RespondResult {
  success: boolean;
  error?: string;
}

export interface FollowResult {
  success: boolean;
  action: 'followed' | 'already_following' | 'failed';
  error?: string;
}

export interface ProfileInfo {
  name: string;
  bio?: string;
  followers?: string;
  following?: string;
  url: string;
  stories?: Array<{ title: string; url: string }>;
}

export interface UserStats {
  views?: number;
  reads?: number;
  fans?: number;
  url: string;
}

export interface ManagedStory {
  title: string;
  storyId: string;
  editUrl: string;
  publishedDate?: string;
  readTime?: string;
  views: number;
  claps: number;
  hasPaywall: boolean;
  publication?: string;
}

export interface StorySettings {
  storyId: string;
  title: string;
  author: string;
  profileUrl: string;
  partnerProgramStatus: string;
  seoTitle?: string;
  seoDescription?: string;
  friendLink?: string;
  licensing?: string;
  isMemberOnly: boolean;
}

export interface PaywallResult {
  success: boolean;
  storyId: string;
  title: string;
  action: 'added' | 'removed' | 'already_set' | 'failed';
  error?: string;
}

export interface BatchPaywallResult {
  total: number;
  succeeded: number;
  failed: number;
  results: PaywallResult[];
}

// ═══════════════════════════════════════════════════════════════
// MediumOperations
// ═══════════════════════════════════════════════════════════════

export class MediumOperations {
  private driver: MediumSafariDriver;

  constructor() {
    this.driver = new MediumSafariDriver();
  }

  // ─── Check Login Status ────────────────────────────────────

  async checkStatus(): Promise<{ loggedIn: boolean; url: string; notifications: number }> {
    await this.driver.navigate('https://medium.com');
    await this.driver.sleep(2000);

    const loginState = await this.driver.checkLoginStatus();
    const url = await this.driver.getCurrentURL();

    let notifications = 0;
    try {
      const countText = await this.driver.getTextContent(SELECTORS.HEADER_NOTIFICATION_COUNT);
      if (countText) notifications = parseInt(countText) || 0;
    } catch {}

    return { loggedIn: loginState === 'logged_in', url, notifications };
  }

  // ─── Create & Publish a Blog Post ──────────────────────────

  async createPost(draft: PostDraft): Promise<PostResult> {
    try {
      console.log(`[Medium] Creating post: "${draft.title}"`);

      // Navigate to new story editor
      const nav = await this.driver.navigate('https://medium.com/new-story');
      if (!nav) return { success: false, status: 'failed', error: 'Failed to navigate to editor' };

      // Wait for editor to load
      const editorLoaded = await this.driver.waitForSelector(SELECTORS.EDITOR_TITLE, 10000);
      if (!editorLoaded) return { success: false, status: 'failed', error: 'Editor did not load' };

      await this.driver.sleep(1500);

      // Type title
      console.log(`[Medium] Typing title...`);
      const titleOk = await this.driver.typeIntoGrafEditor(draft.title, true);
      if (!titleOk) return { success: false, status: 'failed', error: 'Failed to type title' };

      await this.driver.sleep(500);

      // Press Enter to move to body via keystrokes
      try {
        await this.driver.executeJS(`
          (function() {
            var el = document.querySelector('[data-testid="editorParagraphText"]');
            if (el) { el.click(); el.focus(); return 'focused'; }
            return 'not_found';
          })()
        `);
      } catch {}
      await this.driver.sleep(500);

      // Type body content — split into paragraphs for readability
      console.log(`[Medium] Typing body...`);
      const paragraphs = draft.body.split('\n\n');
      for (let i = 0; i < paragraphs.length; i++) {
        const para = paragraphs[i].trim();
        if (!para) continue;

        if (i === 0) {
          // First paragraph — type directly into the body placeholder
          await this.driver.typeText(para);
        } else {
          // Subsequent paragraphs — press Enter twice then type
          await this.driver.executeJS(`document.execCommand('insertText', false, '\\n\\n')`);
          await this.driver.sleep(200);
          await this.driver.typeText(para);
        }
        await this.driver.sleep(300);
      }

      await this.driver.sleep(1000);

      if (draft.publishImmediately !== false) {
        // Click "Publish" button
        console.log(`[Medium] Publishing...`);
        const pubClicked = await this.driver.clickButtonByText('Publish');
        if (!pubClicked) {
          // Try finding it as a green button
          const alt = await this.driver.executeJS(`
            (function() {
              var btns = document.querySelectorAll('button');
              for (var i = 0; i < btns.length; i++) {
                if (btns[i].textContent.trim().includes('Publish')) {
                  btns[i].click(); return 'clicked';
                }
              }
              return 'not_found';
            })()
          `);
          if (alt !== 'clicked') {
            return { success: true, status: 'draft', url: await this.driver.getCurrentURL(), error: 'Publish button not found — saved as draft' };
          }
        }

        await this.driver.sleep(2000);

        // Check for publish confirmation dialog (tags, etc.)
        // Medium shows a publish settings modal where you can add tags
        if (draft.tags && draft.tags.length > 0) {
          console.log(`[Medium] Adding tags: ${draft.tags.join(', ')}`);
          await this.addTagsInPublishDialog(draft.tags);
        }

        if (draft.subtitle) {
          console.log(`[Medium] Adding subtitle...`);
          await this.addSubtitleInPublishDialog(draft.subtitle);
        }

        // Click final "Publish now" button in the publish dialog
        await this.driver.sleep(500);
        const publishNow = await this.driver.clickButtonByText('Publish now');
        if (!publishNow) {
          // Try alternate text
          await this.driver.clickButtonByText('Publish');
        }

        await this.driver.sleep(3000);

        const finalUrl = await this.driver.getCurrentURL();
        const isPublished = finalUrl.includes('medium.com/') && !finalUrl.includes('new-story');

        console.log(`[Medium] ${isPublished ? '✅ Published' : '📝 Draft saved'}: ${finalUrl}`);
        return {
          success: true,
          url: finalUrl,
          status: isPublished ? 'published' : 'draft',
        };
      } else {
        // Just save as draft (don't click publish)
        const url = await this.driver.getCurrentURL();
        console.log(`[Medium] 📝 Draft saved: ${url}`);
        return { success: true, url, status: 'draft' };
      }

    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      console.error(`[Medium] Create post failed: ${error}`);
      await this.driver.captureScreenshot('create_post_error');
      return { success: false, status: 'failed', error };
    }
  }

  // ─── Add tags in publish dialog ────────────────────────────

  private async addTagsInPublishDialog(tags: string[]): Promise<void> {
    for (const tag of tags.slice(0, 5)) {  // Medium allows max 5 tags
      try {
        // Find the tag input
        const tagInputResult = await this.driver.executeJS(`
          (function() {
            var inputs = document.querySelectorAll('input[placeholder*="tag"], input[placeholder*="Tag"], input[type="text"]');
            for (var i = 0; i < inputs.length; i++) {
              var ph = inputs[i].placeholder || '';
              if (ph.toLowerCase().includes('tag') || ph.toLowerCase().includes('topic')) {
                inputs[i].focus();
                inputs[i].click();
                return 'focused';
              }
            }
            return 'not_found';
          })()
        `);

        if (tagInputResult === 'focused') {
          await this.driver.sleep(200);
          await this.driver.typeText(tag);
          await this.driver.sleep(500);

          // Press Enter to add the tag
          await this.driver.executeJS(`
            (function() {
              var active = document.activeElement;
              if (active) {
                active.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true}));
              }
            })()
          `);
          await this.driver.sleep(300);
        }
      } catch {}
    }
  }

  // ─── Add subtitle in publish dialog ────────────────────────

  private async addSubtitleInPublishDialog(subtitle: string): Promise<void> {
    try {
      await this.driver.executeJS(`
        (function() {
          var inputs = document.querySelectorAll('input[placeholder*="subtitle"], textarea[placeholder*="subtitle"], input[placeholder*="Subtitle"]');
          for (var i = 0; i < inputs.length; i++) {
            inputs[i].focus();
            inputs[i].value = '${subtitle.replace(/'/g, "\\'")}';
            inputs[i].dispatchEvent(new Event('input', {bubbles: true}));
            return 'filled';
          }
          return 'not_found';
        })()
      `);
    } catch {}
  }

  // ─── Clap on an Article ────────────────────────────────────

  async clapArticle(articleUrl: string, claps = 1): Promise<ClapResult> {
    try {
      claps = Math.min(Math.max(claps, 1), 50);  // Medium allows 1-50 claps
      console.log(`[Medium] Clapping ${claps}x on ${articleUrl}`);

      const nav = await this.driver.navigate(articleUrl);
      if (!nav) return { success: false, clapsGiven: 0, error: 'Failed to navigate' };

      const found = await this.driver.waitForSelector(SELECTORS.FOOTER_CLAP, 10000);
      if (!found) return { success: false, clapsGiven: 0, error: 'Clap button not found' };

      await this.driver.sleep(1000);

      // Click the clap button N times
      let clicked = 0;
      for (let i = 0; i < claps; i++) {
        const result = await this.driver.clickElement(SELECTORS.FOOTER_CLAP);
        if (result) clicked++;
        await this.driver.sleep(150 + Math.random() * 100); // Human-like delay
      }

      console.log(`[Medium] ✅ Clapped ${clicked}x`);
      return { success: clicked > 0, clapsGiven: clicked };

    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      return { success: false, clapsGiven: 0, error };
    }
  }

  // ─── Respond (Comment) on an Article ───────────────────────

  async respondToArticle(articleUrl: string, responseText: string): Promise<RespondResult> {
    try {
      console.log(`[Medium] Responding to ${articleUrl}`);

      const nav = await this.driver.navigate(articleUrl);
      if (!nav) return { success: false, error: 'Failed to navigate' };

      // Wait for respond button
      const found = await this.driver.waitForSelector(SELECTORS.RESPONSE_RESPOND_BTN, 10000);
      if (!found) {
        return { success: false, error: 'Response section not found' };
      }

      await this.driver.sleep(1000);

      // Scroll down to response section
      await this.driver.executeJS(`
        (function() {
          var btn = document.querySelector('[data-testid="ResponseRespondButton"]');
          if (btn) btn.scrollIntoView({behavior: 'smooth', block: 'center'});
        })()
      `);
      await this.driver.sleep(1000);

      // Find and type into the Slate.js response editor
      const typed = await this.driver.typeIntoSlateEditor(SELECTORS.RESPONSE_TEXTBOX, responseText);
      if (!typed) {
        return { success: false, error: 'Failed to type response text' };
      }

      await this.driver.sleep(500);

      // Click "Respond" button
      const respondClicked = await this.driver.clickElement(SELECTORS.RESPONSE_RESPOND_BTN);
      if (!respondClicked) {
        const alt = await this.driver.clickButtonByText('Respond');
        if (!alt) return { success: false, error: 'Respond button click failed' };
      }

      await this.driver.sleep(2000);

      console.log(`[Medium] ✅ Response posted`);
      return { success: true };

    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      await this.driver.captureScreenshot('respond_error');
      return { success: false, error };
    }
  }

  // ─── Follow an Author ─────────────────────────────────────

  async followAuthor(authorUrl: string): Promise<FollowResult> {
    try {
      console.log(`[Medium] Following author: ${authorUrl}`);

      const nav = await this.driver.navigate(authorUrl);
      if (!nav) return { success: false, action: 'failed', error: 'Failed to navigate' };

      await this.driver.sleep(2000);

      // Check if already following
      const status = await this.driver.executeJS(`
        (function() {
          var btns = document.querySelectorAll('button');
          for (var i = 0; i < btns.length; i++) {
            var text = btns[i].textContent.trim();
            if (text === 'Following') return 'already_following';
          }
          for (var i = 0; i < btns.length; i++) {
            var text = btns[i].textContent.trim();
            if (text === 'Follow') return 'can_follow';
          }
          return 'not_found';
        })()
      `);

      if (status === 'already_following') {
        return { success: true, action: 'already_following' };
      }

      if (status !== 'can_follow') {
        return { success: false, action: 'failed', error: 'Follow button not found' };
      }

      // Click the Follow button
      const clicked = await this.driver.clickButtonByText('Follow');
      if (!clicked) return { success: false, action: 'failed', error: 'Follow button click failed' };

      await this.driver.sleep(1000);

      console.log(`[Medium] ✅ Followed`);
      return { success: true, action: 'followed' };

    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      return { success: false, action: 'failed', error };
    }
  }

  // ─── Bookmark an Article ───────────────────────────────────

  async bookmarkArticle(articleUrl: string): Promise<{ success: boolean; error?: string }> {
    try {
      const nav = await this.driver.navigate(articleUrl);
      if (!nav) return { success: false, error: 'Failed to navigate' };

      await this.driver.waitForSelector(SELECTORS.HEADER_BOOKMARK, 10000);
      await this.driver.sleep(1000);

      const clicked = await this.driver.clickElement(SELECTORS.HEADER_BOOKMARK);
      if (!clicked) return { success: false, error: 'Bookmark button not found' };

      await this.driver.sleep(500);
      console.log(`[Medium] ✅ Bookmarked`);
      return { success: true };

    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  // ─── Extract Article Details ───────────────────────────────

  async readArticle(articleUrl: string): Promise<MediumArticle | null> {
    try {
      const nav = await this.driver.navigate(articleUrl);
      if (!nav) return null;

      await this.driver.waitForSelector(SELECTORS.STORY_TITLE, 10000);
      await this.driver.sleep(1500);

      const data = await this.driver.executeJS(`
        (function() {
          var r = {};
          var title = document.querySelector('[data-testid="storyTitle"]');
          r.title = title ? title.textContent.trim() : '';
          var author = document.querySelector('[data-testid="authorName"]');
          r.author = author ? author.textContent.trim() : '';
          r.authorUrl = author ? author.href : '';
          var readTime = document.querySelector('[data-testid="storyReadTime"]');
          r.readTime = readTime ? readTime.textContent.trim() : '';
          // Publication
          var pubLink = document.querySelector('a[data-testid="publicationName"]');
          r.publication = pubLink ? pubLink.textContent.trim() : '';
          // Content
          var article = document.querySelector('article');
          if (article) {
            var paragraphs = article.querySelectorAll('p, h1, h2, h3, h4, blockquote, pre');
            var text = Array.from(paragraphs).map(function(p){ return p.textContent.trim() }).join('\\n\\n');
            r.content = text.substring(0, 3000);
          }
          // Tags
          var tagEls = document.querySelectorAll('a[href*="/tag/"]');
          r.tags = Array.from(new Set(Array.from(tagEls).map(function(t){ return t.textContent.trim() }).filter(function(t){ return t.length > 0 && t.length < 40 }))).slice(0, 10);
          // Published date
          var time = document.querySelector('article time, span[data-testid="storyPublishDate"]');
          r.publishedDate = time ? (time.getAttribute('datetime') || time.textContent.trim()) : '';
          return JSON.stringify(r);
        })()
      `);

      const parsed = JSON.parse(data);
      return {
        url: articleUrl,
        title: parsed.title,
        author: parsed.author,
        authorUrl: parsed.authorUrl,
        publication: parsed.publication || undefined,
        readTime: parsed.readTime || undefined,
        content: parsed.content || undefined,
        tags: parsed.tags?.length ? parsed.tags : undefined,
        publishedDate: parsed.publishedDate || undefined,
      };

    } catch (e) {
      console.error(`[Medium] Read article failed: ${e}`);
      return null;
    }
  }

  // ─── Extract Article Metrics ───────────────────────────────

  async getArticleMetrics(articleUrl: string): Promise<{ claps: number; responses: number } | null> {
    try {
      const nav = await this.driver.navigate(articleUrl);
      if (!nav) return null;

      await this.driver.waitForSelector(SELECTORS.FOOTER_CLAP, 10000);
      await this.driver.sleep(1500);

      const data = await this.driver.executeJS(`
        (function() {
          var r = { claps: 0, responses: 0 };
          // Clap count — usually near the clap button
          var clapBtns = document.querySelectorAll('button[data-testid="headerClapButton"], button[data-testid="footerClapButton"]');
          for (var i = 0; i < clapBtns.length; i++) {
            var sibling = clapBtns[i].nextElementSibling;
            if (sibling) {
              var num = sibling.textContent.trim().replace(/[^0-9.KkMm]/g, '');
              if (num) {
                if (num.includes('K') || num.includes('k')) r.claps = Math.round(parseFloat(num) * 1000);
                else if (num.includes('M') || num.includes('m')) r.claps = Math.round(parseFloat(num) * 1000000);
                else r.claps = parseInt(num) || 0;
                break;
              }
            }
          }
          // Response count
          var respBtns = document.querySelectorAll('button[data-testid="ResponseRespondButton"]');
          for (var i = 0; i < respBtns.length; i++) {
            var sibling = respBtns[i].parentElement;
            if (sibling) {
              var nums = sibling.textContent.match(/\\d+/);
              if (nums) { r.responses = parseInt(nums[0]) || 0; break; }
            }
          }
          return JSON.stringify(r);
        })()
      `);

      return JSON.parse(data);

    } catch {
      return null;
    }
  }

  // ─── Read Feed (Home page articles) ────────────────────────

  async readFeed(limit = 10): Promise<MediumFeedItem[]> {
    try {
      await this.driver.navigate('https://medium.com');
      await this.driver.waitForSelector(SELECTORS.POST_PREVIEW, 10000);
      await this.driver.sleep(2000);

      const data = await this.driver.executeJS(`
        (function() {
          var articles = document.querySelectorAll('article[data-testid="post-preview"]');
          var results = [];
          for (var i = 0; i < Math.min(articles.length, ${limit}); i++) {
            var art = articles[i];
            var r = {};
            // Title link
            var links = art.querySelectorAll('a');
            for (var j = 0; j < links.length; j++) {
              var href = links[j].href || '';
              if (href.includes('medium.com/') && !href.includes('/tag/') && !href.includes('/@') && !href.includes('?source=') && links[j].textContent.trim().length > 10) {
                r.title = links[j].textContent.trim().substring(0, 200);
                r.url = href.split('?')[0];
                break;
              }
            }
            if (!r.url) {
              // Fallback: find first long-text link
              for (var j = 0; j < links.length; j++) {
                if (links[j].textContent.trim().length > 20) {
                  r.title = links[j].textContent.trim().substring(0, 200);
                  r.url = (links[j].href || '').split('?')[0];
                  break;
                }
              }
            }
            // Author
            var authorLink = art.querySelector('a[href*="/@"]');
            if (authorLink) {
              r.author = authorLink.textContent.trim();
              r.authorUrl = authorLink.href.split('?')[0];
            }
            // Snippet
            var ps = art.querySelectorAll('p, h3, h2');
            for (var j = 0; j < ps.length; j++) {
              var t = ps[j].textContent.trim();
              if (t.length > 30 && t !== r.title) { r.snippet = t.substring(0, 300); break; }
            }
            if (r.url) results.push(r);
          }
          return JSON.stringify(results);
        })()
      `);

      return JSON.parse(data);

    } catch (e) {
      console.error(`[Medium] Read feed failed: ${e}`);
      return [];
    }
  }

  // ─── Search Articles ───────────────────────────────────────

  async searchArticles(query: string, limit = 10): Promise<MediumFeedItem[]> {
    try {
      const encoded = encodeURIComponent(query);
      await this.driver.navigate(`https://medium.com/search?q=${encoded}`);
      await this.driver.waitForSelector(SELECTORS.POST_PREVIEW, 10000);
      await this.driver.sleep(2000);

      // Reuse feed extraction logic since search results use same post-preview structure
      const data = await this.driver.executeJS(`
        (function() {
          var articles = document.querySelectorAll('article[data-testid="post-preview"]');
          var results = [];
          for (var i = 0; i < Math.min(articles.length, ${limit}); i++) {
            var art = articles[i];
            var r = {};
            var links = art.querySelectorAll('a');
            for (var j = 0; j < links.length; j++) {
              if (links[j].textContent.trim().length > 10 && !links[j].href.includes('/tag/')) {
                r.title = links[j].textContent.trim().substring(0, 200);
                r.url = (links[j].href || '').split('?')[0];
                break;
              }
            }
            var authorLink = art.querySelector('a[href*="/@"]');
            if (authorLink) {
              r.author = authorLink.textContent.trim();
              r.authorUrl = authorLink.href.split('?')[0];
            }
            if (r.url) results.push(r);
          }
          return JSON.stringify(results);
        })()
      `);

      return JSON.parse(data);

    } catch (e) {
      console.error(`[Medium] Search failed: ${e}`);
      return [];
    }
  }

  // ─── Read User Profile ─────────────────────────────────────

  async readProfile(username: string): Promise<ProfileInfo | null> {
    try {
      const url = username.startsWith('http') ? username : `https://medium.com/@${username}`;
      await this.driver.navigate(url);
      await this.driver.sleep(3000);

      const data = await this.driver.executeJS(`
        (function() {
          var r = {};
          // Name — usually h2 or prominent text at top
          var h2 = document.querySelector('h2');
          r.name = h2 ? h2.textContent.trim() : '';
          // Bio
          var bio = document.querySelector('p[class]');
          r.bio = bio ? bio.textContent.trim().substring(0, 500) : '';
          // Follower count
          var allText = document.body.innerText;
          var followerMatch = allText.match(/([\\.\\d]+[KkMm]?)\\s*Follower/);
          r.followers = followerMatch ? followerMatch[1] : '';
          var followingMatch = allText.match(/Following\\s*([\\.\\d]+[KkMm]?)/);
          r.following = followingMatch ? followingMatch[1] : '';
          // Stories
          var articles = document.querySelectorAll('article[data-testid="post-preview"]');
          r.stories = [];
          for (var i = 0; i < Math.min(articles.length, 10); i++) {
            var links = articles[i].querySelectorAll('a');
            for (var j = 0; j < links.length; j++) {
              if (links[j].textContent.trim().length > 10) {
                r.stories.push({title: links[j].textContent.trim().substring(0,200), url: (links[j].href||'').split('?')[0]});
                break;
              }
            }
          }
          return JSON.stringify(r);
        })()
      `);

      const parsed = JSON.parse(data);
      return {
        name: parsed.name,
        bio: parsed.bio || undefined,
        followers: parsed.followers || undefined,
        following: parsed.following || undefined,
        url,
        stories: parsed.stories?.length ? parsed.stories : undefined,
      };

    } catch (e) {
      console.error(`[Medium] Read profile failed: ${e}`);
      return null;
    }
  }

  // ─── Your Stats ────────────────────────────────────────────

  async getMyStats(): Promise<UserStats | null> {
    try {
      await this.driver.navigate('https://medium.com/me/stats');
      await this.driver.sleep(3000);

      const data = await this.driver.executeJS(`
        (function() {
          var r = {};
          var text = document.body.innerText;
          // Look for stats numbers
          var viewsMatch = text.match(/([\\.\\d,]+)\\s*Views/i);
          if (viewsMatch) r.views = parseInt(viewsMatch[1].replace(/[,\\.]/g, '')) || 0;
          var readsMatch = text.match(/([\\.\\d,]+)\\s*Reads/i);
          if (readsMatch) r.reads = parseInt(readsMatch[1].replace(/[,\\.]/g, '')) || 0;
          var fansMatch = text.match(/([\\.\\d,]+)\\s*Fans/i);
          if (fansMatch) r.fans = parseInt(fansMatch[1].replace(/[,\\.]/g, '')) || 0;
          return JSON.stringify(r);
        })()
      `);

      const parsed = JSON.parse(data);
      return {
        ...parsed,
        url: 'https://medium.com/me/stats',
      };

    } catch {
      return null;
    }
  }

  // ─── Your Stories/Drafts (simple) ──────────────────────────

  async getMyStories(): Promise<Array<{ title: string; url: string; status: string }>> {
    try {
      await this.driver.navigate('https://medium.com/me/stories/drafts');
      await this.driver.sleep(3000);

      const data = await this.driver.executeJS(`
        (function() {
          var results = [];
          var articles = document.querySelectorAll('article, [data-testid="post-preview"]');
          for (var i = 0; i < articles.length; i++) {
            var links = articles[i].querySelectorAll('a');
            for (var j = 0; j < links.length; j++) {
              if (links[j].textContent.trim().length > 5) {
                results.push({
                  title: links[j].textContent.trim().substring(0,200),
                  url: (links[j].href || '').split('?')[0],
                  status: 'draft'
                });
                break;
              }
            }
          }
          return JSON.stringify(results);
        })()
      `);

      return JSON.parse(data);

    } catch {
      return [];
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // STORY MANAGEMENT & PAYWALL CONTROL
  // ═══════════════════════════════════════════════════════════════

  // ─── List Published Stories (with scroll to load more) ─────

  async listPublishedStories(opts: { maxStories?: number; scrollPages?: number } = {}): Promise<{ stories: ManagedStory[]; totalPublished: string; totalDrafts: string }> {
    const maxStories = opts.maxStories || 100;
    const scrollPages = opts.scrollPages || 10;

    try {
      await this.driver.navigate('https://medium.com/me/stories?tab=posts-published');
      await this.driver.sleep(3000);

      // Get total counts
      const countsData = await this.driver.executeJS(`
        (function() {
          var text = document.body.innerText;
          var drafts = '', published = '';
          var dMatch = text.match(/Drafts\\n([\\d,.KkMm]+)/);
          if (dMatch) drafts = dMatch[1];
          var pMatch = text.match(/Published\\n([\\d,.KkMm]+)/);
          if (pMatch) published = pMatch[1];
          return JSON.stringify({drafts: drafts, published: published});
        })()
      `);
      const counts = JSON.parse(countsData);

      const allStories: ManagedStory[] = [];
      const seenIds = new Set<string>();
      let lastCount = 0;
      let noNewCount = 0;

      for (let page = 0; page < scrollPages; page++) {
        // DOM-based extraction: each story has an edit link containing the storyId
        // Walk from each edit link upward to find the containing row, then extract metadata
        const data = await this.driver.executeJS(`
          (function() {
            var editLinks = document.querySelectorAll('a[href*="/edit"]');
            var results = [];
            for (var i = 0; i < editLinks.length; i++) {
              var link = editLinks[i];
              var match = link.href.match(/\\/p\\/([a-f0-9]+)\\/edit/);
              if (!match) continue;

              var storyId = match[1];
              var title = link.textContent.trim();
              if (!title || title.length < 3) continue;

              // Walk up to find the row container (usually 3-5 levels up)
              var row = link.parentElement;
              for (var up = 0; up < 6; up++) {
                if (!row || !row.parentElement) break;
                // Stop at a row that contains the menu button
                var hasBtns = row.querySelectorAll('button');
                var hasMenu = false;
                for (var b = 0; b < hasBtns.length; b++) {
                  if (hasBtns[b].textContent.trim() === 'Toggle actions menu') { hasMenu = true; break; }
                }
                if (hasMenu) break;
                row = row.parentElement;
              }

              // Extract metadata from the row text
              var rowText = row ? row.innerText : '';
              var pubDate = '';
              var readTime = '';
              var views = 0, claps = 0;

              var pubMatch = rowText.match(/Published\\s+((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[^\\n]*)/);
              if (pubMatch) pubDate = pubMatch[1].trim();

              var readMatch = rowText.match(/(\\d+\\s*min\\s*read)/);
              if (readMatch) readTime = readMatch[1];

              // Views and claps are two consecutive numbers near the end
              var nums = rowText.match(/\\n(\\d+)\\n(\\d+)\\n/);
              if (nums) {
                views = parseInt(nums[1]) || 0;
                claps = parseInt(nums[2]) || 0;
              }

              results.push({
                storyId: storyId,
                title: title.substring(0, 200),
                editUrl: link.href.split('?')[0],
                pubDate: pubDate,
                readTime: readTime,
                views: views,
                claps: claps
              });
            }
            return JSON.stringify(results);
          })()
        `);

        const parsed = JSON.parse(data);
        for (const story of parsed) {
          if (seenIds.has(story.storyId)) continue;
          seenIds.add(story.storyId);

          allStories.push({
            title: story.title,
            storyId: story.storyId,
            editUrl: story.editUrl,
            publishedDate: story.pubDate || undefined,
            readTime: story.readTime || undefined,
            views: story.views || 0,
            claps: story.claps || 0,
            hasPaywall: false,
          });
        }

        if (allStories.length >= maxStories) break;

        // Check if we got new stories
        if (allStories.length === lastCount) {
          noNewCount++;
          if (noNewCount >= 3) break;
        } else {
          noNewCount = 0;
          lastCount = allStories.length;
        }

        // Scroll down to load more
        await this.driver.executeJS(`window.scrollTo(0, document.body.scrollHeight)`);
        await this.driver.sleep(2000);

        if (page % 5 === 4) {
          console.log(`[Medium] Collected ${allStories.length} stories so far (scroll ${page + 1})...`);
        }
      }

      console.log(`[Medium] Listed ${allStories.length} published stories`);
      return {
        stories: allStories.slice(0, maxStories),
        totalPublished: counts.published,
        totalDrafts: counts.drafts,
      };

    } catch (e) {
      console.error(`[Medium] List stories failed: ${e}`);
      return { stories: [], totalPublished: '0', totalDrafts: '0' };
    }
  }

  // ─── Toggle Paywall on a Single Story ──────────────────────

  async togglePaywall(storyId: string, action: 'add' | 'remove'): Promise<PaywallResult> {
    try {
      console.log(`[Medium] ${action === 'add' ? 'Adding' : 'Removing'} paywall on ${storyId}`);

      // Navigate to published stories
      await this.driver.navigate('https://medium.com/me/stories?tab=posts-published');
      await this.driver.sleep(3000);

      // Find the story's "Toggle actions menu" button by locating the edit link
      // and then finding the nearby menu button
      const found = await this.findAndClickStoryMenu(storyId);
      if (!found.success) {
        return { success: false, storyId, title: found.title || '', action: 'failed', error: found.error };
      }

      await this.driver.sleep(800);

      // Check what the menu says — "Add paywall" or "Remove paywall"
      const menuAction = await this.driver.executeJS(`
        (function() {
          var items = document.querySelectorAll('button, li');
          for (var i = 0; i < items.length; i++) {
            var t = items[i].textContent.trim();
            if (t === 'Add paywall') return 'add_available';
            if (t === 'Remove paywall') return 'remove_available';
          }
          return 'not_found';
        })()
      `);

      // Determine if we need to act
      const targetText = action === 'add' ? 'Add paywall' : 'Remove paywall';
      const alreadySet = (action === 'add' && menuAction === 'remove_available') ||
                         (action === 'remove' && menuAction === 'add_available');

      if (alreadySet) {
        // Close menu
        await this.driver.executeJS(`document.body.click()`);
        console.log(`[Medium] Story ${storyId} already has paywall ${action === 'add' ? 'enabled' : 'disabled'}`);
        return { success: true, storyId, title: found.title || '', action: 'already_set' };
      }

      // Click the paywall button
      const clicked = await this.driver.executeJS(`
        (function() {
          var items = document.querySelectorAll('button');
          for (var i = 0; i < items.length; i++) {
            if (items[i].textContent.trim() === '${targetText}') {
              items[i].click();
              return 'clicked';
            }
          }
          return 'not_found';
        })()
      `);

      if (clicked !== 'clicked') {
        await this.driver.executeJS(`document.body.click()`);
        return { success: false, storyId, title: found.title || '', action: 'failed', error: `${targetText} button not found in menu` };
      }

      await this.driver.sleep(1500);

      // Check for confirmation dialog
      const dialogResult = await this.driver.executeJS(`
        (function() {
          var dialog = document.querySelector('[role="dialog"], [role="alertdialog"]');
          if (dialog) {
            var confirmBtns = dialog.querySelectorAll('button');
            for (var i = 0; i < confirmBtns.length; i++) {
              var t = confirmBtns[i].textContent.trim().toLowerCase();
              if (t.includes('confirm') || t.includes('yes') || t.includes('add') || t.includes('remove') || t === 'ok') {
                confirmBtns[i].click();
                return 'confirmed';
              }
            }
            return 'dialog_no_confirm';
          }
          return 'no_dialog';
        })()
      `);

      await this.driver.sleep(1000);

      const resultAction = action === 'add' ? 'added' : 'removed';
      console.log(`[Medium] ✅ Paywall ${resultAction} on "${found.title}"`);
      return { success: true, storyId, title: found.title || '', action: resultAction };

    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      console.error(`[Medium] Toggle paywall failed: ${error}`);
      return { success: false, storyId, title: '', action: 'failed', error };
    }
  }

  // ─── Find a story on the list and click its menu ───────────

  private async findAndClickStoryMenu(storyId: string, maxScrolls = 5): Promise<{ success: boolean; title?: string; error?: string }> {
    for (let scroll = 0; scroll < maxScrolls; scroll++) {
      const result = await this.driver.executeJS(`
        (function() {
          // Find the edit link for this story
          var links = document.querySelectorAll('a[href*="/p/${storyId}/edit"]');
          if (links.length === 0) return JSON.stringify({found: false});

          var link = links[0];
          var title = link.textContent.trim();

          // The "Toggle actions menu" button is a sibling in the same row
          // Walk up to the row container and find the menu button
          var row = link.closest('tr, div[class], li');
          if (!row) row = link.parentElement.parentElement.parentElement;

          // Search for Toggle actions menu button in this row or nearby
          var menuBtn = null;
          var searchEl = row;
          for (var attempt = 0; attempt < 5 && !menuBtn; attempt++) {
            if (!searchEl) break;
            var btns = searchEl.querySelectorAll('button');
            for (var i = 0; i < btns.length; i++) {
              if (btns[i].textContent.trim() === 'Toggle actions menu') {
                menuBtn = btns[i];
                break;
              }
            }
            searchEl = searchEl.parentElement;
          }

          if (menuBtn) {
            // Scroll into view first
            menuBtn.scrollIntoView({behavior: 'instant', block: 'center'});
            return JSON.stringify({found: true, title: title, clickReady: true});
          }

          return JSON.stringify({found: true, title: title, clickReady: false});
        })()
      `);

      const parsed = JSON.parse(result);

      if (parsed.found && parsed.clickReady) {
        await this.driver.sleep(300);
        // Now click the menu button
        const clicked = await this.driver.executeJS(`
          (function() {
            var links = document.querySelectorAll('a[href*="/p/${storyId}/edit"]');
            if (links.length === 0) return 'not_found';
            var link = links[0];
            var searchEl = link.parentElement;
            for (var attempt = 0; attempt < 8; attempt++) {
              if (!searchEl) break;
              var btns = searchEl.querySelectorAll('button');
              for (var i = 0; i < btns.length; i++) {
                if (btns[i].textContent.trim() === 'Toggle actions menu') {
                  btns[i].click();
                  return 'clicked';
                }
              }
              searchEl = searchEl.parentElement;
            }
            return 'menu_not_found';
          })()
        `);

        if (clicked === 'clicked') {
          return { success: true, title: parsed.title };
        }
        return { success: false, title: parsed.title, error: 'Menu button found but click failed' };
      }

      if (parsed.found && !parsed.clickReady) {
        return { success: false, title: parsed.title, error: 'Story found but menu button not accessible' };
      }

      // Scroll to load more
      await this.driver.executeJS(`window.scrollTo(0, document.body.scrollHeight)`);
      await this.driver.sleep(2000);
    }

    return { success: false, error: `Story ${storyId} not found after ${maxScrolls} scrolls` };
  }

  // ─── Batch Toggle Paywall ──────────────────────────────────

  async batchTogglePaywall(storyIds: string[], action: 'add' | 'remove', delayMs = 3000): Promise<BatchPaywallResult> {
    const results: PaywallResult[] = [];
    let succeeded = 0;
    let failed = 0;

    console.log(`[Medium] Batch ${action} paywall on ${storyIds.length} stories`);

    for (const storyId of storyIds) {
      const result = await this.togglePaywall(storyId, action);
      results.push(result);

      if (result.success) succeeded++;
      else failed++;

      // Delay between operations to be safe
      if (storyIds.indexOf(storyId) < storyIds.length - 1) {
        await this.driver.sleep(delayMs);
      }
    }

    console.log(`[Medium] Batch paywall complete: ${succeeded} succeeded, ${failed} failed`);
    return { total: storyIds.length, succeeded, failed, results };
  }

  // ─── Get Story Settings ────────────────────────────────────

  async getStorySettings(storyId: string): Promise<StorySettings | null> {
    try {
      await this.driver.navigate(`https://medium.com/p/${storyId}/settings`);
      await this.driver.sleep(3000);

      const data = await this.driver.executeJS(`
        (function() {
          var r = {};
          var text = document.body.innerText;

          // Title
          var h2 = text.match(/^(.+?)\\nStory settings/m);
          r.title = h2 ? h2[1].trim() : '';

          // Author
          var authorMatch = text.match(/Author\\nOverview\\n\\n(.+?)\\n@/);
          r.author = authorMatch ? authorMatch[1].trim() : '';

          // Profile
          var profileMatch = text.match(/@(\\w+)/);
          r.profileUrl = profileMatch ? 'https://medium.com/@' + profileMatch[1] : '';

          // Partner Program
          var ppMatch = text.match(/Partner Program Status[\\s\\S]*?\\n(Enrolled|Not enrolled|Ineligible)/);
          r.partnerProgramStatus = ppMatch ? ppMatch[1] : '';

          // SEO Title
          var seoMatch = text.match(/Title preview \\(\\d+\\):\\n(.+?)\\n/);
          r.seoTitle = seoMatch ? seoMatch[1] : '';

          // SEO Description
          var descMatch = text.match(/Description \\(\\d+\\):\\n(.+?)\\n/);
          r.seoDescription = descMatch ? descMatch[1] : '';

          // Friend Link (indicates member-only)
          var friendMatch = text.match(/Share free access to this member-only story/);
          r.isMemberOnly = !!friendMatch;

          // Friend Link URL
          var linkMatch = text.match(/(https:\\/\\/medium\\.com\\/@[^\\s]+\\?source=friends_link[^\\s]*)/);
          r.friendLink = linkMatch ? linkMatch[1] : '';

          // Licensing
          var licMatch = text.match(/Content Licensing[\\s\\S]*?\\n(All rights reserved|[^\\n]+)/);
          r.licensing = licMatch ? licMatch[1] : '';

          return JSON.stringify(r);
        })()
      `);

      const parsed = JSON.parse(data);
      return {
        storyId,
        ...parsed,
      };

    } catch (e) {
      console.error(`[Medium] Get story settings failed: ${e}`);
      return null;
    }
  }

  // ─── Get Story-Level Stats ─────────────────────────────────

  async getStoryStats(storyId: string): Promise<{ storyId: string; title: string; views: number; reads: number; readRatio: string; fans: number } | null> {
    try {
      await this.driver.navigate(`https://medium.com/me/stats/post/${storyId}`);
      await this.driver.sleep(3000);

      const data = await this.driver.executeJS(`
        (function() {
          var r = {};
          var text = document.body.innerText;

          // Story title
          var lines = text.split('\\n').filter(function(l){ return l.trim().length > 0 });
          r.title = '';
          for (var i = 0; i < lines.length; i++) {
            if (lines[i].match(/^\\d+\\s*(views|Views)/)) break;
            if (lines[i].length > 20 && !lines[i].match(/^(Sidebar|Write|Home|Library|Stats|Notifications)/)) {
              r.title = lines[i].trim();
              break;
            }
          }

          var viewsMatch = text.match(/(\\d[\\d,]*)\\s*views/i);
          r.views = viewsMatch ? parseInt(viewsMatch[1].replace(/,/g, '')) : 0;

          var readsMatch = text.match(/(\\d[\\d,]*)\\s*reads/i);
          r.reads = readsMatch ? parseInt(readsMatch[1].replace(/,/g, '')) : 0;

          var ratioMatch = text.match(/(\\d+\\.?\\d*)%\\s*read\\s*ratio/i);
          r.readRatio = ratioMatch ? ratioMatch[1] + '%' : '';

          var fansMatch = text.match(/(\\d[\\d,]*)\\s*fans/i);
          r.fans = fansMatch ? parseInt(fansMatch[1].replace(/,/g, '')) : 0;

          return JSON.stringify(r);
        })()
      `);

      const parsed = JSON.parse(data);
      return { storyId, ...parsed };

    } catch {
      return null;
    }
  }

  // ─── Scroll and collect ALL story IDs from published tab ───

  async collectAllStoryIds(maxStories = 500): Promise<Array<{ storyId: string; title: string }>> {
    try {
      await this.driver.navigate('https://medium.com/me/stories?tab=posts-published');
      await this.driver.sleep(3000);

      const allStories: Array<{ storyId: string; title: string }> = [];
      const seenIds = new Set<string>();
      let lastCount = 0;
      let noNewCount = 0;

      for (let scroll = 0; scroll < 50; scroll++) {
        const data = await this.driver.executeJS(`
          (function() {
            var links = document.querySelectorAll('a[href*="/edit"]');
            var results = [];
            for (var i = 0; i < links.length; i++) {
              var match = links[i].href.match(/\\/p\\/([a-f0-9]+)\\/edit/);
              if (match) {
                results.push({storyId: match[1], title: links[i].textContent.trim().substring(0,200)});
              }
            }
            return JSON.stringify(results);
          })()
        `);

        const parsed = JSON.parse(data);
        for (const item of parsed) {
          if (!seenIds.has(item.storyId)) {
            seenIds.add(item.storyId);
            allStories.push(item);
          }
        }

        if (allStories.length >= maxStories) break;

        // Check if we got new stories
        if (allStories.length === lastCount) {
          noNewCount++;
          if (noNewCount >= 3) break; // No new stories after 3 scrolls
        } else {
          noNewCount = 0;
          lastCount = allStories.length;
        }

        // Scroll to load more
        await this.driver.executeJS(`window.scrollTo(0, document.body.scrollHeight)`);
        await this.driver.sleep(2000);

        if (scroll % 5 === 4) {
          console.log(`[Medium] Collected ${allStories.length} stories so far (scroll ${scroll + 1})...`);
        }
      }

      console.log(`[Medium] Collected ${allStories.length} total story IDs`);
      return allStories;

    } catch (e) {
      console.error(`[Medium] Collect story IDs failed: ${e}`);
      return [];
    }
  }
}
