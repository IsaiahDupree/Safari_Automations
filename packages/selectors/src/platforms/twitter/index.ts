import type { SelectorGroup } from '../../types';

export const tweetSelectors: SelectorGroup = {
  likeButton: {
    primary: '[data-testid="like"]',
    fallbacks: ['div[data-testid="like"]', '[aria-label*="Like"]'],
    type: 'css',
    contract: { expectedCount: 'one', mustBeClickable: true },
  },
  unlikeButton: {
    primary: '[data-testid="unlike"]',
    fallbacks: ['div[data-testid="unlike"]', '[aria-label*="Liked"]'],
    type: 'css',
    contract: { expectedCount: 'one', mustBeClickable: true },
  },
  likeCount: {
    primary: '[data-testid="like"] span span',
    fallbacks: ['[data-testid="like"] [dir="ltr"]'],
    type: 'css',
    contract: { expectedCount: 'one', extractionType: 'text', optional: true },
  },
  replyButton: {
    primary: '[data-testid="reply"]',
    fallbacks: ['[aria-label*="Reply"]'],
    type: 'css',
    contract: { expectedCount: 'one', mustBeClickable: true },
  },
  retweetButton: {
    primary: '[data-testid="retweet"]',
    fallbacks: ['[aria-label*="Repost"]'],
    type: 'css',
    contract: { expectedCount: 'one', mustBeClickable: true },
  },
  tweetText: {
    primary: '[data-testid="tweetText"]',
    fallbacks: ['div[lang] span'],
    type: 'css',
    contract: { expectedCount: 'one', extractionType: 'text', optional: true },
  },
  authorUsername: {
    primary: '[data-testid="User-Name"] a[href^="/"]',
    fallbacks: ['a[role="link"][href^="/"][tabindex="-1"]'],
    type: 'css',
    contract: { expectedCount: 'one', extractionType: 'text' },
  },
  timestamp: {
    primary: 'time[datetime]',
    fallbacks: ['a time'],
    type: 'css',
    contract: { expectedCount: 'one', extractionType: 'attribute', attribute: 'datetime' },
  },
  replyComposer: {
    primary: '[data-testid="tweetTextarea_0"]',
    fallbacks: ['[aria-label="Post text"]'],
    type: 'css',
    contract: { expectedCount: 'one', mustBeVisible: true },
  },
};

export const timelineSelectors: SelectorGroup = {
  timeline: {
    primary: '[data-testid="primaryColumn"]',
    fallbacks: ['main[role="main"]'],
    type: 'css',
    contract: { expectedCount: 'one' },
  },
  timelineTweet: {
    primary: '[data-testid="cellInnerDiv"]:has([data-testid="tweet"])',
    fallbacks: ['article[data-testid="tweet"]'],
    type: 'css',
    contract: { expectedCount: 'many' },
  },
  tweetLink: {
    primary: 'a[href*="/status/"]',
    fallbacks: ['time[datetime] a'],
    type: 'css',
    contract: { expectedCount: 'many' },
  },
};

export const dmSelectors: SelectorGroup = {
  conversationList: {
    primary: '[data-testid="DM_Conversation_List"]',
    fallbacks: ['[aria-label="Timeline: Messages"]'],
    type: 'css',
    contract: { expectedCount: 'one' },
  },
  messageInput: {
    primary: '[data-testid="dmComposerTextInput"]',
    fallbacks: ['[aria-label="Start a new message"]'],
    type: 'css',
    contract: { expectedCount: 'one', mustBeVisible: true },
  },
  sendButton: {
    primary: '[data-testid="dmComposerSendButton"]',
    fallbacks: ['[aria-label="Send"]'],
    type: 'css',
    contract: { expectedCount: 'one', mustBeClickable: true },
  },
};

export const twitterSelectors = {
  tweet: tweetSelectors,
  timeline: timelineSelectors,
  dm: dmSelectors,
};
