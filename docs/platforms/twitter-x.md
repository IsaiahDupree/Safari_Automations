# Twitter/X Platform Guide

## Overview

Twitter/X adapter supports:
- Timeline navigation and tweet discovery
- Tweet stat extraction (likes, retweets, views)
- Like/unlike actions
- Reply posting
- Quote tweets
- DM thread management
- Profile viewing

## URLs and Navigation

### Base URLs

| Page | URL Pattern |
|------|-------------|
| Home Timeline | `https://x.com/home` |
| Tweet | `https://x.com/{username}/status/{tweetId}` |
| Profile | `https://x.com/{username}` |
| DM Inbox | `https://x.com/messages` |
| DM Conversation | `https://x.com/messages/{conversationId}` |
| Search | `https://x.com/search?q={query}` |
| Explore | `https://x.com/explore` |
| Notifications | `https://x.com/notifications` |

### URL Notes

- `twitter.com` redirects to `x.com`
- Both domains work, but `x.com` is preferred
- Legacy URLs still function

### Navigation Map

```
Home Timeline (/home)
├── Tweet Cards (scrollable)
│   ├── Author info
│   │   ├── Avatar
│   │   ├── Display name
│   │   ├── Username (@handle)
│   │   └── Verified badge
│   ├── Tweet content
│   ├── Media (images/video/GIF)
│   ├── Quoted tweet (if any)
│   ├── Action buttons
│   │   ├── Reply + count
│   │   ├── Retweet/Quote + count
│   │   ├── Like + count
│   │   ├── Views
│   │   ├── Bookmark
│   │   └── Share
│   └── Timestamp
├── "Who to follow" suggestions
└── Trending topics (sidebar)

Tweet Page (/{username}/status/{id})
├── Original tweet
├── Reply thread
├── Reply composer
└── More tweets from author

Profile Page (/{username})
├── Header image
├── Profile info
│   ├── Avatar
│   ├── Display name
│   ├── Username
│   ├── Bio
│   ├── Location, website, join date
│   ├── Following/Followers counts
│   └── Action buttons (Follow, DM)
├── Tabs
│   ├── Tweets
│   ├── Replies
│   ├── Media
│   └── Likes
└── Tweet list

DM Inbox (/messages)
├── Conversation list
│   ├── Participant info
│   ├── Last message preview
│   └── Timestamp
└── Selected conversation
    ├── Message history
    └── Message composer
```

## Login/Session Strategy

### Session Cookies

Key cookies for X:
- `auth_token` - Primary authentication
- `ct0` - CSRF token
- `twid` - Twitter user ID
- `guest_id` - Guest identifier

### Login Detection

```typescript
async function isLoggedIn(browser: Browser): Promise<boolean> {
  const indicators = [
    '[data-testid="AppTabBar_Home_Link"]',
    '[data-testid="SideNav_NewTweet_Button"]',
    '[aria-label="Account menu"]',
  ];
  
  for (const selector of indicators) {
    if (await browser.elementExists(selector)) {
      return true;
    }
  }
  
  // Check for login page
  if (await browser.elementExists('[data-testid="loginButton"]')) {
    return false;
  }
  
  return false;
}
```

### Session Health

```typescript
async function checkSessionHealth(browser: Browser): Promise<SessionHealth> {
  await browser.navigate('https://x.com/home');
  
  // Check for suspension
  if (await browser.textExists('Your account is suspended')) {
    return { isValid: false, warnings: ['Account suspended'] };
  }
  
  // Check for locked account
  if (await browser.textExists('Your account has been locked')) {
    return { isValid: false, warnings: ['Account locked'] };
  }
  
  // Check for rate limit notice
  if (await browser.textExists('Rate limit exceeded')) {
    return { isValid: true, warnings: ['Rate limited'] };
  }
  
  return { isValid: true, warnings: [] };
}
```

## Selectors

### Tweet Selectors

```typescript
export const twitterTweetSelectors = {
  // Tweet container
  tweetContainer: {
    primary: '[data-testid="tweet"]',
    fallbacks: [
      'article[data-testid="tweet"]',
      'article[role="article"]',
    ],
  },
  
  // Like button
  likeButton: {
    primary: '[data-testid="like"]',
    fallbacks: [
      'div[data-testid="like"]',
      '[aria-label*="Like"]',
    ],
  },
  
  // Unlike button (liked state)
  unlikeButton: {
    primary: '[data-testid="unlike"]',
    fallbacks: [
      'div[data-testid="unlike"]',
      '[aria-label*="Liked"]',
    ],
  },
  
  // Like count
  likeCount: {
    primary: '[data-testid="like"] span span',
    fallbacks: [
      '[data-testid="like"] [dir="ltr"]',
    ],
  },
  
  // Reply button
  replyButton: {
    primary: '[data-testid="reply"]',
    fallbacks: [
      '[aria-label*="Reply"]',
    ],
  },
  
  // Reply count
  replyCount: {
    primary: '[data-testid="reply"] span span',
    fallbacks: [
      '[data-testid="reply"] [dir="ltr"]',
    ],
  },
  
  // Retweet button
  retweetButton: {
    primary: '[data-testid="retweet"]',
    fallbacks: [
      '[aria-label*="Repost"]',
      '[aria-label*="Retweet"]',
    ],
  },
  
  // Retweet count
  retweetCount: {
    primary: '[data-testid="retweet"] span span',
    fallbacks: [
      '[data-testid="retweet"] [dir="ltr"]',
    ],
  },
  
  // View count (impressions)
  viewCount: {
    primary: '[aria-label*="views"]',
    fallbacks: [
      'a[href$="/analytics"] span',
    ],
  },
  
  // Author username
  authorUsername: {
    primary: '[data-testid="User-Name"] a[href^="/"]',
    fallbacks: [
      'a[role="link"][href^="/"][tabindex="-1"]',
    ],
  },
  
  // Author display name
  authorDisplayName: {
    primary: '[data-testid="User-Name"] span span',
    fallbacks: [
      'a[role="link"] span span',
    ],
  },
  
  // Tweet text content
  tweetText: {
    primary: '[data-testid="tweetText"]',
    fallbacks: [
      'div[lang] span',
    ],
  },
  
  // Tweet timestamp
  timestamp: {
    primary: 'time[datetime]',
    fallbacks: [
      'a time',
    ],
  },
  
  // Reply composer (in modal)
  replyComposer: {
    primary: '[data-testid="tweetTextarea_0"]',
    fallbacks: [
      'div[data-testid="tweetTextarea_0"]',
      '[aria-label="Post text"]',
    ],
  },
  
  // Post reply button
  postReplyButton: {
    primary: '[data-testid="tweetButton"]',
    fallbacks: [
      '[data-testid="tweetButtonInline"]',
    ],
  },
  
  // Bookmark button
  bookmarkButton: {
    primary: '[data-testid="bookmark"]',
    fallbacks: [
      '[aria-label*="Bookmark"]',
    ],
  },
  
  // Share button
  shareButton: {
    primary: '[data-testid="share"]',
    fallbacks: [
      '[aria-label="Share post"]',
    ],
  },
};
```

### Timeline Selectors

```typescript
export const twitterTimelineSelectors = {
  // Timeline container
  timeline: {
    primary: '[data-testid="primaryColumn"]',
    fallbacks: [
      'main[role="main"]',
    ],
  },
  
  // Tweet in timeline
  timelineTweet: {
    primary: '[data-testid="cellInnerDiv"]:has([data-testid="tweet"])',
    fallbacks: [
      'article[data-testid="tweet"]',
    ],
  },
  
  // Tweet link
  tweetLink: {
    primary: 'a[href*="/status/"]',
    fallbacks: [
      'time[datetime] a',
    ],
  },
};
```

### DM Selectors

```typescript
export const twitterDMSelectors = {
  // Conversation list
  conversationList: {
    primary: '[data-testid="DM_Conversation_List"]',
    fallbacks: [
      '[aria-label="Timeline: Messages"]',
    ],
  },
  
  // Conversation item
  conversationItem: {
    primary: '[data-testid="conversation"]',
    fallbacks: [
      '[data-testid="cellInnerDiv"]:has(a[href^="/messages/"])',
    ],
  },
  
  // Message input
  messageInput: {
    primary: '[data-testid="dmComposerTextInput"]',
    fallbacks: [
      '[aria-label="Start a new message"]',
      'div[data-testid="dmComposerTextInput"]',
    ],
  },
  
  // Send button
  sendButton: {
    primary: '[data-testid="dmComposerSendButton"]',
    fallbacks: [
      '[aria-label="Send"]',
    ],
  },
  
  // Message bubble
  messageBubble: {
    primary: '[data-testid="messageEntry"]',
    fallbacks: [
      '[data-testid="tweetText"]',
    ],
  },
  
  // New message button
  newMessageButton: {
    primary: '[data-testid="NewDM_Button"]',
    fallbacks: [
      '[aria-label="New message"]',
    ],
  },
  
  // Recipient search
  recipientSearch: {
    primary: '[data-testid="searchPeople"]',
    fallbacks: [
      'input[placeholder*="Search"]',
    ],
  },
};
```

### Profile Selectors

```typescript
export const twitterProfileSelectors = {
  // Follower count
  followerCount: {
    primary: 'a[href$="/verified_followers"] span span',
    fallbacks: [
      'a[href$="/followers"] span span',
    ],
  },
  
  // Following count
  followingCount: {
    primary: 'a[href$="/following"] span span',
    fallbacks: [
      '[data-testid="following"]',
    ],
  },
  
  // Bio
  bio: {
    primary: '[data-testid="UserDescription"]',
    fallbacks: [
      'div[data-testid="UserDescription"]',
    ],
  },
  
  // Follow button
  followButton: {
    primary: '[data-testid="follow"]',
    fallbacks: [
      '[aria-label*="Follow"]',
    ],
  },
  
  // Message button
  messageButton: {
    primary: '[data-testid="sendDMFromProfile"]',
    fallbacks: [
      '[aria-label="Message"]',
    ],
  },
};
```

## Actions

### Like Tweet

```typescript
async function likeTweet(browser: Browser, tweetUrl: string): Promise<ActionResult> {
  await browser.navigate(tweetUrl);
  await browser.waitForSelector(selectors.tweetContainer);
  
  // Check if already liked
  const unlikeButton = await browser.findElementSafe(selectors.unlikeButton);
  if (unlikeButton) {
    return { success: true, alreadyDone: true };
  }
  
  // Click like button
  const likeButton = await browser.findElement(selectors.likeButton);
  await likeButton.click();
  
  // Verify state change
  await browser.waitForSelector(selectors.unlikeButton, { timeout: 5000 });
  
  return { success: true, alreadyDone: false };
}
```

### Reply to Tweet

```typescript
async function replyToTweet(
  browser: Browser,
  tweetUrl: string,
  text: string
): Promise<ActionResult> {
  await browser.navigate(tweetUrl);
  await browser.waitForSelector(selectors.tweetContainer);
  
  // Click reply button
  const replyButton = await browser.findElement(selectors.replyButton);
  await replyButton.click();
  
  // Wait for composer
  await browser.waitForSelector(selectors.replyComposer);
  
  // Type reply
  const composer = await browser.findElement(selectors.replyComposer);
  await composer.click();
  await composer.type(text);
  
  // Post reply
  const postButton = await browser.findElement(selectors.postReplyButton);
  await browser.waitForEnabled(postButton);
  await postButton.click();
  
  // Wait for modal to close
  await sleep(2000);
  
  return { success: true };
}
```

### Send DM

```typescript
async function sendDM(
  browser: Browser,
  conversationUrl: string,
  message: string
): Promise<ActionResult> {
  await browser.navigate(conversationUrl);
  await browser.waitForSelector(selectors.messageInput);
  
  // Type message
  const input = await browser.findElement(selectors.messageInput);
  await input.click();
  await input.type(message);
  
  // Send
  const sendButton = await browser.findElement(selectors.sendButton);
  await sendButton.click();
  
  // Verify message appears
  await browser.waitForText(message, { timeout: 10000 });
  
  return { success: true };
}
```

### Start New DM

```typescript
async function startNewDM(
  browser: Browser,
  recipientUsername: string,
  message: string
): Promise<ActionResult> {
  await browser.navigate('https://x.com/messages');
  await browser.waitForSelector(selectors.conversationList);
  
  // Click new message
  const newButton = await browser.findElement(selectors.newMessageButton);
  await newButton.click();
  
  // Search for recipient
  await browser.waitForSelector(selectors.recipientSearch);
  const search = await browser.findElement(selectors.recipientSearch);
  await search.type(recipientUsername);
  
  // Wait and select from results
  await sleep(1000);
  const result = await browser.findElement(`[data-testid="typeaheadResult"]:has-text("${recipientUsername}")`);
  await result.click();
  
  // Click Next
  const nextButton = await browser.findElement('[data-testid="nextButton"]');
  await nextButton.click();
  
  // Type and send message
  await browser.waitForSelector(selectors.messageInput);
  const input = await browser.findElement(selectors.messageInput);
  await input.type(message);
  
  const sendButton = await browser.findElement(selectors.sendButton);
  await sendButton.click();
  
  return { success: true };
}
```

## Stat Extraction

### Tweet Stats

```typescript
interface TwitterTweetStats {
  tweetId: string;
  authorUsername: string;
  authorDisplayName: string | null;
  content: string | null;
  likeCount: number | null;
  replyCount: number | null;
  retweetCount: number | null;
  viewCount: number | null;
  timestamp: Date | null;
  isRetweet: boolean;
  isQuote: boolean;
}

async function extractTweetStats(browser: Browser): Promise<TwitterTweetStats> {
  // Extract tweet ID from URL
  const url = await browser.getCurrentUrl();
  const tweetIdMatch = url.match(/\/status\/(\d+)/);
  const tweetId = tweetIdMatch?.[1] || '';
  
  const stats: TwitterTweetStats = {
    tweetId,
    authorUsername: await extractUsername(browser),
    authorDisplayName: await extractTextSafe(browser, selectors.authorDisplayName),
    content: await extractTextSafe(browser, selectors.tweetText),
    likeCount: await extractCount(browser, selectors.likeCount),
    replyCount: await extractCount(browser, selectors.replyCount),
    retweetCount: await extractCount(browser, selectors.retweetCount),
    viewCount: await extractViewCount(browser),
    timestamp: await extractTimestamp(browser),
    isRetweet: await isRetweet(browser),
    isQuote: await isQuoteTweet(browser),
  };
  
  return stats;
}

async function extractCount(browser: Browser, selector: Selector): Promise<number | null> {
  const text = await extractTextSafe(browser, selector);
  if (!text) return null;
  
  // Parse X's abbreviated numbers: 1.2K, 3.4M
  return parseAbbreviatedNumber(text);
}

function parseAbbreviatedNumber(text: string): number | null {
  const match = text.match(/([\d.]+)([KM])?/i);
  if (!match) return null;
  
  let value = parseFloat(match[1]);
  const suffix = match[2]?.toUpperCase();
  
  if (suffix === 'K') value *= 1000;
  else if (suffix === 'M') value *= 1000000;
  
  return Math.round(value);
}
```

## Verification Rules

### Like Verification

```typescript
async function verifyLike(browser: Browser, tweetUrl: string): Promise<boolean> {
  await browser.navigate(tweetUrl);
  await browser.waitForSelector(selectors.tweetContainer);
  
  const unlikeButton = await browser.findElementSafe(selectors.unlikeButton);
  return unlikeButton !== null;
}
```

### Reply Verification

```typescript
async function verifyReply(
  browser: Browser,
  tweetUrl: string,
  replyText: string
): Promise<boolean> {
  await browser.navigate(tweetUrl);
  await browser.waitForSelector(selectors.tweetContainer);
  
  // Scroll to load replies
  await browser.scroll('down', 500);
  await sleep(1000);
  
  return await browser.textExists(replyText);
}
```

### DM Verification

```typescript
async function verifyDM(
  browser: Browser,
  conversationUrl: string,
  messageText: string
): Promise<boolean> {
  await browser.navigate(conversationUrl);
  await browser.waitForSelector(selectors.messageBubble);
  
  return await browser.textExists(messageText);
}
```

## Known Pitfalls

### Rate Limiting

X has strict rate limits:
- **Likes**: ~30/hour (can be lower for new accounts)
- **Replies**: ~10/hour
- **DMs**: ~20/day for new conversations
- **Follows**: ~15/hour

### Detection Signals

X has sophisticated detection:
- Account age/reputation scoring
- Behavioral fingerprinting
- Timing analysis
- Content analysis (for spam)
- IP reputation

### Premium Features

Some features require X Premium:
- Longer posts
- Edit tweets
- Some analytics
- Reduced rate limits

### API vs Web

The web interface may behave differently than API:
- Different rate limits
- Different error messages
- UI-specific features

### Modal Handling

X uses modals extensively:

```typescript
async function dismissModals(browser: Browser): Promise<void> {
  const modalCloseSelectors = [
    '[data-testid="app-bar-close"]',
    '[aria-label="Close"]',
    '[data-testid="mask"]',
  ];
  
  for (const selector of modalCloseSelectors) {
    const button = await browser.findElementSafe(selector);
    if (button) {
      await button.click();
      await sleep(500);
    }
  }
}
```

### Login Challenges

X may present challenges:
- CAPTCHA
- Phone verification
- Email verification
- "Unusual activity" warnings

```typescript
async function detectChallenge(browser: Browser): Promise<string | null> {
  if (await browser.textExists('Verify your identity')) {
    return 'identity_verification';
  }
  if (await browser.textExists('Confirm your phone')) {
    return 'phone_verification';
  }
  if (await browser.elementExists('[data-testid="captcha"]')) {
    return 'captcha';
  }
  return null;
}
```

### Content Warnings

Some tweets may have content warnings:

```typescript
async function dismissContentWarning(browser: Browser): Promise<boolean> {
  const showButton = await browser.findElementSafe('[data-testid="show"]');
  if (showButton) {
    await showButton.click();
    return true;
  }
  return false;
}
```

## Best Practices

### Human-like Behavior

```typescript
// Vary timing
async function naturalDelay(): Promise<void> {
  const base = 2000 + Math.random() * 4000;
  await sleep(base);
}

// Scroll naturally
async function naturalBrowse(browser: Browser): Promise<void> {
  const scrolls = 2 + Math.floor(Math.random() * 3);
  for (let i = 0; i < scrolls; i++) {
    await browser.scroll('down', 200 + Math.random() * 400);
    await sleep(1000 + Math.random() * 2000);
  }
}
```

### Session Maintenance

```typescript
async function keepAlive(browser: Browser): Promise<void> {
  // Periodically check notifications
  await browser.navigate('https://x.com/notifications');
  await sleep(2000);
  await browser.navigate('https://x.com/home');
}
```
