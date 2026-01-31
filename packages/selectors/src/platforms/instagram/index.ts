import type { SelectorGroup } from '../../types';

export const postSelectors: SelectorGroup = {
  likeButton: {
    primary: '[aria-label="Like"]',
    fallbacks: [
      'svg[aria-label="Like"]',
      '[data-testid="like-button"]',
      'button:has(svg[aria-label="Like"])',
    ],
    type: 'css',
    contract: { expectedCount: 'one', mustBeClickable: true, mustBeVisible: true },
  },
  unlikeButton: {
    primary: '[aria-label="Unlike"]',
    fallbacks: ['svg[aria-label="Unlike"]'],
    type: 'css',
    contract: { expectedCount: 'one', mustBeClickable: true },
  },
  likeCount: {
    primary: 'section a[href$="/liked_by/"] span',
    fallbacks: ['[data-testid="like-count"]'],
    type: 'css',
    contract: { expectedCount: 'one', extractionType: 'text' },
  },
  commentInput: {
    primary: 'textarea[aria-label="Add a comment…"]',
    fallbacks: ['form textarea[placeholder*="comment"]'],
    type: 'css',
    contract: { expectedCount: 'one', mustBeVisible: true },
  },
  postCommentButton: {
    primary: 'button[type="submit"]:has-text("Post")',
    fallbacks: ['form button:not([disabled])'],
    type: 'css',
    contract: { expectedCount: 'one', mustBeClickable: true },
  },
  authorUsername: {
    primary: 'header a[role="link"] span',
    fallbacks: ['article header a:first-of-type'],
    type: 'css',
    contract: { expectedCount: 'one', extractionType: 'text' },
  },
  timestamp: {
    primary: 'time[datetime]',
    fallbacks: ['a time'],
    type: 'css',
    contract: { expectedCount: 'one', extractionType: 'attribute', attribute: 'datetime' },
  },
};

export const feedSelectors: SelectorGroup = {
  postCard: {
    primary: 'article[role="presentation"]',
    fallbacks: ['main article'],
    type: 'css',
    contract: { expectedCount: 'many' },
  },
  postLink: {
    primary: 'article a[href^="/p/"]',
    fallbacks: ['article a[href^="/reel/"]'],
    type: 'css',
    contract: { expectedCount: 'many' },
  },
};

export const dmSelectors: SelectorGroup = {
  threadItem: {
    primary: 'div[role="listitem"]',
    fallbacks: ['a[href^="/direct/t/"]'],
    type: 'css',
    contract: { expectedCount: 'many' },
  },
  messageInput: {
    primary: 'textarea[placeholder="Message..."]',
    fallbacks: ['div[role="textbox"]'],
    type: 'css',
    contract: { expectedCount: 'one', mustBeVisible: true },
  },
  sendButton: {
    primary: 'button:has-text("Send")',
    fallbacks: ['div[role="button"]:has-text("Send")'],
    type: 'css',
    contract: { expectedCount: 'one', mustBeClickable: true },
  },
};

export const instagramSelectors = {
  post: postSelectors,
  feed: feedSelectors,
  dm: dmSelectors,
};
