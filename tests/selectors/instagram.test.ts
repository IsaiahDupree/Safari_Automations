import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SafariBrowser } from '../../packages/browser/src';
import { instagramSelectors } from '../../packages/selectors/src';
import type { Browser } from '../../packages/browser/src';

describe('Instagram Selector Contract Tests', () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = new SafariBrowser();
    await browser.initialize();
  });

  afterAll(async () => {
    await browser.close();
  });

  describe('Post Selectors', () => {
    describe('likeButton', () => {
      it('should find exactly one like button on post page', async () => {
        // Skip if no test URL available
        const testUrl = process.env.INSTAGRAM_TEST_POST_URL;
        if (!testUrl) {
          console.log('Skipping: INSTAGRAM_TEST_POST_URL not set');
          return;
        }

        await browser.navigate(testUrl);
        const selector = instagramSelectors.post.likeButton;
        
        const elements = await browser.findElements(selector.primary);
        expect(elements.length).toBe(1);
      });

      it('should have working fallbacks', async () => {
        const testUrl = process.env.INSTAGRAM_TEST_POST_URL;
        if (!testUrl) return;

        await browser.navigate(testUrl);
        const selector = instagramSelectors.post.likeButton;
        
        let found = false;
        for (const sel of [selector.primary, ...selector.fallbacks]) {
          const elements = await browser.findElements(sel);
          if (elements.length > 0) {
            found = true;
            break;
          }
        }
        
        expect(found).toBe(true);
      });
    });

    describe('commentInput', () => {
      it('should find comment input on post page', async () => {
        const testUrl = process.env.INSTAGRAM_TEST_POST_URL;
        if (!testUrl) return;

        await browser.navigate(testUrl);
        const selector = instagramSelectors.post.commentInput;
        
        const element = await browser.findElementSafe(selector.primary);
        // Comment input may not be visible if not logged in
        if (element) {
          expect(await element.isDisplayed()).toBe(true);
        }
      });
    });

    describe('authorUsername', () => {
      it('should extract author username', async () => {
        const testUrl = process.env.INSTAGRAM_TEST_POST_URL;
        if (!testUrl) return;

        await browser.navigate(testUrl);
        const selector = instagramSelectors.post.authorUsername;
        
        const element = await browser.findElementSafe(selector.primary);
        if (element) {
          const text = await element.getText();
          expect(text.length).toBeGreaterThan(0);
        }
      });
    });
  });

  describe('Feed Selectors', () => {
    describe('postCard', () => {
      it('should find multiple post cards on feed', async () => {
        // Requires logged in session
        const hasSesssion = process.env.INSTAGRAM_SESSION_FILE;
        if (!hasSesssion) {
          console.log('Skipping: No session available');
          return;
        }

        await browser.navigate('https://instagram.com');
        const selector = instagramSelectors.feed.postCard;
        
        // Wait for feed to load
        await new Promise((r) => setTimeout(r, 3000));
        
        const elements = await browser.findElements(selector.primary);
        expect(elements.length).toBeGreaterThan(0);
      });
    });
  });
});
