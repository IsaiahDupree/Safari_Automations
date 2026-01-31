import type { SelectorGroup } from '../../types';

export const videoSelectors: SelectorGroup = {
  likeButton: {
    primary: '[data-e2e="like-icon"]',
    fallbacks: ['[data-e2e="browse-like-icon"]', 'span[data-e2e="like-icon"]'],
    type: 'css',
    contract: { expectedCount: 'one', mustBeClickable: true },
  },
  likeCount: {
    primary: '[data-e2e="like-count"]',
    fallbacks: ['strong[data-e2e="like-count"]'],
    type: 'css',
    contract: { expectedCount: 'one', extractionType: 'text' },
  },
  commentButton: {
    primary: '[data-e2e="comment-icon"]',
    fallbacks: ['[data-e2e="browse-comment-icon"]'],
    type: 'css',
    contract: { expectedCount: 'one', mustBeClickable: true },
  },
  commentCount: {
    primary: '[data-e2e="comment-count"]',
    fallbacks: ['strong[data-e2e="comment-count"]'],
    type: 'css',
    contract: { expectedCount: 'one', extractionType: 'text' },
  },
  authorUsername: {
    primary: '[data-e2e="browse-username"]',
    fallbacks: ['h3[data-e2e="browse-username"]'],
    type: 'css',
    contract: { expectedCount: 'one', extractionType: 'text' },
  },
  caption: {
    primary: '[data-e2e="browse-video-desc"]',
    fallbacks: ['[data-e2e="video-desc"]'],
    type: 'css',
    contract: { expectedCount: 'one', extractionType: 'text', optional: true },
  },
  commentInput: {
    primary: '[data-e2e="comment-input"]',
    fallbacks: ['div[contenteditable="true"][data-e2e="comment-input"]'],
    type: 'css',
    contract: { expectedCount: 'one', mustBeVisible: true },
  },
};

export const feedSelectors: SelectorGroup = {
  videoContainer: {
    primary: '[data-e2e="recommend-list-item-container"]',
    fallbacks: ['div[class*="DivItemContainerV2"]'],
    type: 'css',
    contract: { expectedCount: 'many' },
  },
  videoLink: {
    primary: 'a[href*="/video/"]',
    fallbacks: ['[data-e2e="recommend-list-item-container"] a'],
    type: 'css',
    contract: { expectedCount: 'many' },
  },
};

export const tiktokSelectors = {
  video: videoSelectors,
  feed: feedSelectors,
};
