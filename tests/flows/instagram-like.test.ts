import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SafariBrowser } from '../../packages/browser/src';
import { instagramSelectors } from '../../packages/selectors/src';
import type { Browser } from '../../packages/browser/src';

describe('Instagram Like Flow', () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = new SafariBrowser();
    await browser.initialize();
  });

  afterAll(async () => {
    await browser.close();
  });

  it.skip('should like a post and verify', async () => {
    const testUrl = process.env.INSTAGRAM_TEST_POST_URL;
    if (!testUrl) {
      throw new Error('INSTAGRAM_TEST_POST_URL required');
    }

    // Navigate to post
    await browser.navigate(testUrl);

    // Check if already liked
    const unlikeButton = await browser.findElementSafe(
      instagramSelectors.post.unlikeButton.primary
    );

    if (unlikeButton) {
      console.log('Post already liked, skipping');
      return;
    }

    // Find and click like button
    const likeButton = await browser.findElement(
      instagramSelectors.post.likeButton.primary
    );
    await likeButton.click();

    // Wait for state change
    await new Promise((r) => setTimeout(r, 2000));

    // Verify like was registered
    const newUnlikeButton = await browser.findElementSafe(
      instagramSelectors.post.unlikeButton.primary
    );

    expect(newUnlikeButton).not.toBeNull();
  });
});
