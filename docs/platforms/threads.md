# Threads Platform Guide

## Overview

Threads adapter supports:
- Feed navigation and post discovery
- Post/thread extraction
- Like/unlike actions
- Reply posting
- Profile viewing
- **No DM support** (Threads uses Instagram DMs)

## URLs and Navigation

### Base URLs

| Page | URL Pattern |
|------|-------------|
| Home Feed | `https://www.threads.net/` |
| Post/Thread | `https://www.threads.net/@{username}/post/{postId}` |
| Profile | `https://www.threads.net/@{username}` |
| Search | `https://www.threads.net/search?q={query}` |
| Activity | `https://www.threads.net/activity` |

### Navigation Map

```
Home Feed (/)
├── Post Cards (scrollable)
│   ├── Author info
│   │   ├── Avatar
│   │   ├── Username
│   │   └── Timestamp
│   ├── Post content (text)
│   ├── Media (optional images/video)
│   ├── Action buttons
│   │   ├── Like + count
│   │   ├── Reply + count
│   │   ├── Repost
│   │   └── Share
│   └── Thread replies preview
└── Navigation tabs

Post Page (/@{username}/post/{postId})
├── Original post
├── Reply thread
├── Reply input
└── Related posts

Profile Page (/@{username})
├── Profile header
│   ├── Avatar
│   ├── Username
│   ├── Display name
│   ├── Bio
│   ├── Follower count
│   └── Action buttons (Follow)
├── Threads tab
└── Replies tab
```

## Login/Session Strategy

### Session Notes

Threads shares authentication with Instagram:
- Same Meta account
- Session cookies may overlap
- Login through threads.net or instagram.com

### Key Cookies

- `sessionid` - Session identifier
- `csrftoken` - CSRF token
- `ds_user_id` - User ID

### Login Detection

```typescript
async function isLoggedIn(browser: Browser): Promise<boolean> {
  const indicators = [
    '[aria-label="Home"]',
    '[aria-label="Create"]',
    '[aria-label="Activity"]',
    'a[href="/activity"]',
  ];
  
  for (const selector of indicators) {
    if (await browser.elementExists(selector)) {
      return true;
    }
  }
  
  // Check for login prompt
  if (await browser.elementExists('[data-testid="login-button"]')) {
    return false;
  }
  
  return false;
}
```

## Selectors

### Post Selectors

```typescript
export const threadsPostSelectors = {
  // Post container
  postContainer: {
    primary: '[data-pressable-container="true"]',
    fallbacks: [
      'article',
      'div[role="article"]',
    ],
  },
  
  // Like button
  likeButton: {
    primary: 'svg[aria-label="Like"]',
    fallbacks: [
      '[aria-label="Like"]',
      'div[role="button"]:has(svg[aria-label="Like"])',
    ],
  },
  
  // Unlike button (liked state)
  unlikeButton: {
    primary: 'svg[aria-label="Unlike"]',
    fallbacks: [
      '[aria-label="Unlike"]',
    ],
  },
  
  // Like count
  likeCount: {
    primary: 'span:has-text(/\\d+ likes?/)',
    fallbacks: [
      '[data-testid="like-count"]',
    ],
  },
  
  // Reply button
  replyButton: {
    primary: 'svg[aria-label="Reply"]',
    fallbacks: [
      '[aria-label="Reply"]',
      'div[role="button"]:has(svg[aria-label="Reply"])',
    ],
  },
  
  // Reply count
  replyCount: {
    primary: 'span:has-text(/\\d+ replies?/)',
    fallbacks: [
      '[data-testid="reply-count"]',
    ],
  },
  
  // Author username
  authorUsername: {
    primary: 'a[href^="/@"] span',
    fallbacks: [
      '[data-testid="post-author"]',
    ],
  },
  
  // Post content/text
  postContent: {
    primary: '[data-testid="post-content"]',
    fallbacks: [
      'article span[dir="auto"]',
      'div[dir="auto"]',
    ],
  },
  
  // Post timestamp
  timestamp: {
    primary: 'time[datetime]',
    fallbacks: [
      'a time',
    ],
  },
  
  // Reply input (in modal or inline)
  replyInput: {
    primary: 'div[contenteditable="true"][role="textbox"]',
    fallbacks: [
      '[data-testid="reply-input"]',
      'div[aria-label*="Reply"]',
    ],
  },
  
  // Post reply button
  postReplyButton: {
    primary: 'div[role="button"]:has-text("Post")',
    fallbacks: [
      'button:has-text("Post")',
      '[data-testid="post-reply-button"]',
    ],
  },
  
  // Repost button
  repostButton: {
    primary: 'svg[aria-label="Repost"]',
    fallbacks: [
      '[aria-label="Repost"]',
    ],
  },
  
  // Share button
  shareButton: {
    primary: 'svg[aria-label="Share"]',
    fallbacks: [
      '[aria-label="Share"]',
    ],
  },
};
```

### Feed Selectors

```typescript
export const threadsFeedSelectors = {
  // Feed container
  feedContainer: {
    primary: 'main[role="main"]',
    fallbacks: [
      'div[data-testid="feed"]',
    ],
  },
  
  // Post in feed
  feedPost: {
    primary: '[data-pressable-container="true"]',
    fallbacks: [
      'article',
    ],
  },
  
  // Post link
  postLink: {
    primary: 'a[href*="/post/"]',
    fallbacks: [
      'time[datetime] a',
    ],
  },
};
```

### Profile Selectors

```typescript
export const threadsProfileSelectors = {
  // Follower count
  followerCount: {
    primary: 'span:has-text(/\\d+ followers?/)',
    fallbacks: [
      '[data-testid="follower-count"]',
    ],
  },
  
  // Bio
  bio: {
    primary: '[data-testid="user-bio"]',
    fallbacks: [
      'header + div span[dir="auto"]',
    ],
  },
  
  // Follow button
  followButton: {
    primary: 'div[role="button"]:has-text("Follow")',
    fallbacks: [
      'button:has-text("Follow")',
    ],
  },
  
  // Profile posts grid
  postsContainer: {
    primary: '[data-testid="user-posts"]',
    fallbacks: [
      'main > div > div',
    ],
  },
};
```

## Actions

### Like Post

```typescript
async function likePost(browser: Browser, postUrl: string): Promise<ActionResult> {
  await browser.navigate(postUrl);
  await browser.waitForSelector(selectors.postContainer);
  
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

### Reply to Post

```typescript
async function replyToPost(
  browser: Browser,
  postUrl: string,
  text: string
): Promise<ActionResult> {
  await browser.navigate(postUrl);
  await browser.waitForSelector(selectors.postContainer);
  
  // Click reply button to open reply modal
  const replyButton = await browser.findElement(selectors.replyButton);
  await replyButton.click();
  
  // Wait for reply input
  await browser.waitForSelector(selectors.replyInput);
  
  // Type reply
  const input = await browser.findElement(selectors.replyInput);
  await input.click();
  await input.type(text);
  
  // Post reply
  const postButton = await browser.findElement(selectors.postReplyButton);
  await browser.waitForEnabled(postButton);
  await postButton.click();
  
  // Wait for modal to close or reply to appear
  await sleep(2000);
  
  return { success: true };
}
```

## Stat Extraction

### Post Stats

```typescript
interface ThreadsPostStats {
  postId: string;
  authorUsername: string;
  content: string | null;
  likeCount: number | null;
  replyCount: number | null;
  timestamp: Date | null;
  hasMedia: boolean;
}

async function extractPostStats(browser: Browser): Promise<ThreadsPostStats> {
  // Extract post ID from URL
  const url = await browser.getCurrentUrl();
  const postIdMatch = url.match(/\/post\/([^/?]+)/);
  const postId = postIdMatch?.[1] || '';
  
  const stats: ThreadsPostStats = {
    postId,
    authorUsername: await extractText(browser, selectors.authorUsername),
    content: await extractTextSafe(browser, selectors.postContent),
    likeCount: await extractLikeCount(browser),
    replyCount: await extractReplyCount(browser),
    timestamp: await extractTimestamp(browser),
    hasMedia: await hasMedia(browser),
  };
  
  return stats;
}

async function extractLikeCount(browser: Browser): Promise<number | null> {
  const text = await extractTextSafe(browser, selectors.likeCount);
  if (!text) return null;
  
  const match = text.match(/([\d,]+)\s*likes?/i);
  return match ? parseInt(match[1].replace(/,/g, ''), 10) : null;
}

async function extractReplyCount(browser: Browser): Promise<number | null> {
  const text = await extractTextSafe(browser, selectors.replyCount);
  if (!text) return null;
  
  const match = text.match(/([\d,]+)\s*replies?/i);
  return match ? parseInt(match[1].replace(/,/g, ''), 10) : null;
}
```

## Verification Rules

### Like Verification

```typescript
async function verifyLike(browser: Browser, postUrl: string): Promise<boolean> {
  await browser.navigate(postUrl);
  await browser.waitForSelector(selectors.postContainer);
  
  // Check for unlike button (indicates liked state)
  const unlikeButton = await browser.findElementSafe(selectors.unlikeButton);
  return unlikeButton !== null;
}
```

### Reply Verification

```typescript
async function verifyReply(
  browser: Browser,
  postUrl: string,
  replyText: string
): Promise<boolean> {
  await browser.navigate(postUrl);
  await browser.waitForSelector(selectors.postContainer);
  
  // Look for our reply text on the page
  return await browser.textExists(replyText);
}
```

## Known Pitfalls

### Platform Maturity

Threads is relatively new, so expect:
- Frequent UI changes
- Feature additions/removals
- Selector instability
- API changes

### Rate Limiting

Threads shares limits with Instagram (Meta ecosystem):
- **Likes**: ~30/hour
- **Replies**: ~10/hour
- **Profile views**: Generally unrestricted

### Detection

Same detection as Instagram:
- Behavioral analysis
- Timing patterns
- Session fingerprinting

### DM Notes

**Threads does NOT have its own DM system**:
- Users DM through Instagram
- No DM endpoints on threads.net
- Use Instagram adapter for DMs

### Modal Handling

Threads uses modals for:
- Reply composition
- Share options
- Login prompts

```typescript
async function dismissModals(browser: Browser): Promise<void> {
  const closeSelectors = [
    '[aria-label="Close"]',
    'div[role="button"][aria-label="Close"]',
  ];
  
  for (const selector of closeSelectors) {
    const button = await browser.findElementSafe(selector);
    if (button) {
      await button.click();
      await sleep(500);
    }
  }
}
```

### Instagram Login Redirect

Threads may redirect to Instagram for login:

```typescript
async function handleInstagramRedirect(browser: Browser): Promise<void> {
  const url = await browser.getCurrentUrl();
  
  if (url.includes('instagram.com/accounts/login')) {
    // Handle Instagram login flow
    // After login, redirect back to Threads
    await browser.navigate('https://www.threads.net/');
  }
}
```

## Session Sharing

Since Threads and Instagram share authentication:

```typescript
// Can use Instagram session for Threads
async function useInstagramSession(browser: Browser): Promise<void> {
  // Load Instagram session cookies
  const cookies = await loadSessionCookies('instagram');
  
  // Navigate to Threads
  await browser.navigate('https://www.threads.net/');
  
  // Cookies should work for both domains
  await browser.setCookies(cookies);
  
  // Refresh to apply
  await browser.refresh();
}
```
