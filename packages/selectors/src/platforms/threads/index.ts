import type { SelectorGroup } from '../../types';

export const postSelectors: SelectorGroup = {
  likeButton: {
    primary: 'svg[aria-label="Like"]',
    fallbacks: ['[aria-label="Like"]', 'div[role="button"]:has(svg[aria-label="Like"])'],
    type: 'css',
    contract: { expectedCount: 'one', mustBeClickable: true },
  },
  unlikeButton: {
    primary: 'svg[aria-label="Unlike"]',
    fallbacks: ['[aria-label="Unlike"]'],
    type: 'css',
    contract: { expectedCount: 'one', mustBeClickable: true },
  },
  replyButton: {
    primary: 'svg[aria-label="Reply"]',
    fallbacks: ['[aria-label="Reply"]'],
    type: 'css',
    contract: { expectedCount: 'one', mustBeClickable: true },
  },
  authorUsername: {
    primary: 'a[href^="/@"] span',
    fallbacks: ['[data-testid="post-author"]'],
    type: 'css',
    contract: { expectedCount: 'one', extractionType: 'text' },
  },
  postContent: {
    primary: '[data-testid="post-content"]',
    fallbacks: ['article span[dir="auto"]'],
    type: 'css',
    contract: { expectedCount: 'one', extractionType: 'text', optional: true },
  },
  timestamp: {
    primary: 'time[datetime]',
    fallbacks: ['a time'],
    type: 'css',
    contract: { expectedCount: 'one', extractionType: 'attribute', attribute: 'datetime' },
  },
  replyInput: {
    primary: 'div[contenteditable="true"][role="textbox"]',
    fallbacks: ['[data-testid="reply-input"]'],
    type: 'css',
    contract: { expectedCount: 'one', mustBeVisible: true },
  },
};

export const feedSelectors: SelectorGroup = {
  feedContainer: {
    primary: 'main[role="main"]',
    fallbacks: ['div[data-testid="feed"]'],
    type: 'css',
    contract: { expectedCount: 'one' },
  },
  feedPost: {
    primary: '[data-pressable-container="true"]',
    fallbacks: ['article'],
    type: 'css',
    contract: { expectedCount: 'many' },
  },
  postLink: {
    primary: 'a[href*="/post/"]',
    fallbacks: ['time[datetime] a'],
    type: 'css',
    contract: { expectedCount: 'many' },
  },
};

export const threadsSelectors = {
  post: postSelectors,
  feed: feedSelectors,
};
