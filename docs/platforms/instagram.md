# Instagram Platform Guide

## Overview

Instagram adapter supports:
- Feed navigation and post discovery
- Post stat extraction (likes, comments, views)
- Like/unlike actions
- Comment posting
- DM thread management
- Story viewing (limited)

## URLs and Navigation

### Base URLs

| Page | URL Pattern |
|------|-------------|
| Home Feed | `https://www.instagram.com/` |
| Post | `https://www.instagram.com/p/{shortcode}/` |
| Reel | `https://www.instagram.com/reel/{shortcode}/` |
| Profile | `https://www.instagram.com/{username}/` |
| DM Inbox | `https://www.instagram.com/direct/inbox/` |
| DM Thread | `https://www.instagram.com/direct/t/{threadId}/` |

### Navigation Map

```
Home Feed
├── Post Cards (scrollable)
│   ├── Author info
│   ├── Media (image/video/carousel)
│   ├── Action buttons (like, comment, share, save)
│   ├── Like count
│   ├── Caption
│   └── Comments preview
└── Stories bar (top)

Post Page (/p/{shortcode}/)
├── Media
├── Author info
├── Like button + count
├── Comment section
│   ├── Comment input
│   └── Comment list
├── Timestamp
└── Share/Save buttons

Profile Page (/{username}/)
├── Profile header
│   ├── Avatar
│   ├── Username
│   ├── Stats (posts, followers, following)
│   ├── Bio
│   └── Action buttons (Follow, Message)
└── Post grid

DM Inbox (/direct/inbox/)
├── Thread list
│   ├── Participant avatar
│   ├── Participant name
│   ├── Last message preview
│   └── Timestamp
└── Search

DM Thread (/direct/t/{threadId}/)
├── Participant header
├── Message list
└── Message input
```

## Login/Session Strategy

### Session Persistence

Instagram sessions are cookie-based. Key cookies:
- `sessionid` - Main session identifier
- `csrftoken` - CSRF protection
- `ds_user_id` - User ID
- `mid` - Machine ID

### Session File Format

```json
{
  "cookies": [
    {
      "name": "sessionid",
      "value": "...",
      "domain": ".instagram.com",
      "path": "/",
      "expires": 1234567890,
      "httpOnly": true,
      "secure": true
    }
  ],
  "createdAt": "2024-01-15T10:00:00Z",
  "expiresAt": "2024-04-15T10:00:00Z"
}
```

### Login Detection

```typescript
async function isLoggedIn(browser: Browser): Promise<boolean> {
  // Check for logged-in indicators
  const indicators = [
    '[aria-label="Home"]',           // Nav home icon
    '[aria-label="New post"]',       // Create button
    'a[href="/direct/inbox/"]',      // DM link
  ];
  
  for (const selector of indicators) {
    if (await browser.elementExists(selector)) {
      return true;
    }
  }
  
  // Check for login form (indicates logged out)
  if (await browser.elementExists('input[name="username"]')) {
    return false;
  }
  
  return false;
}
```

### Session Health Check

```typescript
interface SessionHealth {
  isValid: boolean;
  expiresIn: number | null;  // milliseconds
  warnings: string[];
}

async function checkSessionHealth(browser: Browser): Promise<SessionHealth> {
  const warnings: string[] = [];
  
  // Navigate to a protected page
  await browser.navigate('https://www.instagram.com/');
  
  // Check for challenges
  if (await browser.elementExists('[data-testid="login-challenge"]')) {
    return { isValid: false, expiresIn: null, warnings: ['Login challenge required'] };
  }
  
  // Check for action blocks
  if (await browser.elementExists('[data-testid="action-blocked"]')) {
    warnings.push('Action block detected');
  }
  
  // Estimate expiry from cookie
  const cookies = await browser.getCookies();
  const sessionCookie = cookies.find(c => c.name === 'sessionid');
  const expiresIn = sessionCookie?.expires 
    ? sessionCookie.expires * 1000 - Date.now()
    : null;
  
  return {
    isValid: true,
    expiresIn,
    warnings,
  };
}
```

## Selectors

### Post Page Selectors

```typescript
export const instagramPostSelectors = {
  // Like button (not liked state)
  likeButton: {
    primary: 'svg[aria-label="Like"][width="24"]',
    fallbacks: [
      '[aria-label="Like"]',
      'section svg[aria-label="Like"]',
      'button:has(svg[aria-label="Like"])',
    ],
  },
  
  // Unlike button (liked state)
  unlikeButton: {
    primary: 'svg[aria-label="Unlike"][width="24"]',
    fallbacks: [
      '[aria-label="Unlike"]',
      'section svg[aria-label="Unlike"]',
    ],
  },
  
  // Like count
  likeCount: {
    primary: 'section a[href$="/liked_by/"] span',
    fallbacks: [
      'button span:has-text(/\\d+ likes?/)',
      'a[href*="liked_by"] span',
    ],
  },
  
  // Comment input
  commentInput: {
    primary: 'textarea[aria-label="Add a comment…"]',
    fallbacks: [
      'form textarea[placeholder*="comment"]',
      '[data-testid="post-comment-input"]',
    ],
  },
  
  // Post comment button
  postCommentButton: {
    primary: 'button[type="submit"]:has-text("Post")',
    fallbacks: [
      'form button:not([disabled]):has-text("Post")',
    ],
  },
  
  // Comment count
  commentCount: {
    primary: 'a[href$="/comments/"] span',
    fallbacks: [
      'button span:has-text(/View all \\d+ comments/)',
    ],
  },
  
  // Author username
  authorUsername: {
    primary: 'header a[role="link"] span',
    fallbacks: [
      'article header a:first-of-type',
    ],
  },
  
  // Post timestamp
  timestamp: {
    primary: 'time[datetime]',
    fallbacks: [
      'a time',
    ],
  },
  
  // Post caption
  caption: {
    primary: 'h1 + div span',
    fallbacks: [
      'article div[role="button"] span',
    ],
  },
  
  // Media container
  mediaContainer: {
    primary: 'article div[role="button"] img',
    fallbacks: [
      'article video',
      'article img[style*="object-fit"]',
    ],
  },
};
```

### Feed Selectors

```typescript
export const instagramFeedSelectors = {
  // Post card in feed
  postCard: {
    primary: 'article[role="presentation"]',
    fallbacks: [
      'main article',
    ],
  },
  
  // Post link (to get shortcode)
  postLink: {
    primary: 'article a[href^="/p/"]',
    fallbacks: [
      'article a[href^="/reel/"]',
    ],
  },
  
  // Feed container
  feedContainer: {
    primary: 'main[role="main"]',
    fallbacks: [
      'section main',
    ],
  },
};
```

### DM Selectors

```typescript
export const instagramDMSelectors = {
  // Thread list item
  threadItem: {
    primary: 'div[role="listitem"]',
    fallbacks: [
      'a[href^="/direct/t/"]',
    ],
  },
  
  // Message input
  messageInput: {
    primary: 'textarea[placeholder="Message..."]',
    fallbacks: [
      'div[role="textbox"]',
    ],
  },
  
  // Send button
  sendButton: {
    primary: 'button:has-text("Send")',
    fallbacks: [
      'div[role="button"]:has-text("Send")',
    ],
  },
  
  // Message bubble
  messageBubble: {
    primary: 'div[role="row"] span',
    fallbacks: [
      'div[data-testid="message"]',
    ],
  },
};
```

## Actions

### Like Post

```typescript
async function likePost(browser: Browser, postUrl: string): Promise<ActionResult> {
  await browser.navigate(postUrl);
  await browser.waitForSelector(selectors.mediaContainer);
  
  // Check if already liked
  const unlikeButton = await browser.findElementSafe(selectors.unlikeButton);
  if (unlikeButton) {
    return { success: true, alreadyDone: true };
  }
  
  // Find and click like button
  const likeButton = await browser.findElement(selectors.likeButton);
  await likeButton.click();
  
  // Wait for state change
  await browser.waitForSelector(selectors.unlikeButton, { timeout: 5000 });
  
  return { success: true, alreadyDone: false };
}
```

### Comment on Post

```typescript
async function commentOnPost(
  browser: Browser,
  postUrl: string,
  text: string
): Promise<ActionResult> {
  await browser.navigate(postUrl);
  await browser.waitForSelector(selectors.commentInput);
  
  // Focus and type comment
  const input = await browser.findElement(selectors.commentInput);
  await input.click();
  await input.type(text);
  
  // Click post button
  const postButton = await browser.findElement(selectors.postCommentButton);
  await browser.waitForEnabled(postButton);
  await postButton.click();
  
  // Wait for comment to appear
  await browser.waitForText(text, { timeout: 10000 });
  
  return { success: true };
}
```

### Send DM

```typescript
async function sendDM(
  browser: Browser,
  threadUrl: string,
  message: string
): Promise<ActionResult> {
  await browser.navigate(threadUrl);
  await browser.waitForSelector(selectors.messageInput);
  
  // Type message
  const input = await browser.findElement(selectors.messageInput);
  await input.click();
  await input.type(message);
  
  // Send
  const sendButton = await browser.findElement(selectors.sendButton);
  await sendButton.click();
  
  // Verify sent
  await browser.waitForText(message, { timeout: 10000 });
  
  return { success: true };
}
```

## Stat Extraction

### Post Stats

```typescript
interface InstagramPostStats {
  postId: string;
  shortcode: string;
  authorUsername: string;
  likeCount: number | null;
  commentCount: number | null;
  caption: string | null;
  timestamp: Date | null;
  mediaType: 'image' | 'video' | 'carousel';
  isSponsored: boolean;
}

async function extractPostStats(browser: Browser): Promise<InstagramPostStats> {
  // Extract shortcode from URL
  const url = await browser.getCurrentUrl();
  const shortcodeMatch = url.match(/\/(p|reel)\/([^/]+)/);
  const shortcode = shortcodeMatch?.[2] || '';
  
  // Extract stats
  const stats: InstagramPostStats = {
    postId: shortcode,
    shortcode,
    authorUsername: await extractText(browser, selectors.authorUsername),
    likeCount: await extractNumber(browser, selectors.likeCount),
    commentCount: await extractCommentCount(browser),
    caption: await extractTextSafe(browser, selectors.caption),
    timestamp: await extractTimestamp(browser),
    mediaType: await detectMediaType(browser),
    isSponsored: await detectSponsored(browser),
  };
  
  return stats;
}

async function extractCommentCount(browser: Browser): Promise<number | null> {
  const text = await extractTextSafe(browser, selectors.commentCount);
  if (!text) return null;
  
  // Parse "View all 123 comments" or "123 comments"
  const match = text.match(/([\d,]+)\s*comments?/i);
  return match ? parseInt(match[1].replace(/,/g, ''), 10) : null;
}
```

## Verification Rules

### Like Verification

```typescript
async function verifyLike(browser: Browser, postUrl: string): Promise<boolean> {
  await browser.navigate(postUrl);
  await browser.waitForSelector(selectors.mediaContainer);
  
  // Check for unlike button (indicates liked)
  const unlikeButton = await browser.findElementSafe(selectors.unlikeButton);
  return unlikeButton !== null;
}
```

### Comment Verification

```typescript
async function verifyComment(
  browser: Browser,
  postUrl: string,
  commentText: string
): Promise<boolean> {
  await browser.navigate(postUrl);
  
  // Look for our comment
  const found = await browser.textExists(commentText);
  return found;
}
```

## Known Pitfalls

### Rate Limiting

Instagram aggressively rate limits:
- **Likes**: ~30/hour safe, can be blocked at 60+
- **Comments**: ~10/hour safe
- **DMs**: ~5/hour for new conversations
- **Profile views**: Generally unrestricted

### Detection Signals

Instagram may detect automation via:
- Consistent timing between actions
- Lack of scrolling/natural behavior
- Too-fast typing
- Missing mouse movements
- Unusual session patterns

### Mitigation

```typescript
// Add human-like delays
async function humanDelay(min: number, max: number): Promise<void> {
  const delay = min + Math.random() * (max - min);
  await sleep(delay);
}

// Before clicking
await humanDelay(500, 1500);
await element.click();

// Between actions
await humanDelay(3000, 8000);
```

### UI Variations

Instagram frequently A/B tests UI changes:
- Different button placements
- Varying modal designs
- Alternative like animations
- New comment UIs

**Solution**: Robust fallback selectors + regular selector sweeps.

### Modal Handling

Various popups may appear:
- "Turn on Notifications" modal
- "Add to Home Screen" prompt
- Cookie consent
- Login suggestions

```typescript
async function dismissModals(browser: Browser): Promise<void> {
  const dismissSelectors = [
    '[role="dialog"] button:has-text("Not Now")',
    '[role="dialog"] button:has-text("Cancel")',
    'button[aria-label="Close"]',
  ];
  
  for (const selector of dismissSelectors) {
    const button = await browser.findElementSafe(selector);
    if (button) {
      await button.click();
      await sleep(500);
    }
  }
}
```

## Session Maintenance

### Keep Session Alive

```typescript
async function keepSessionAlive(browser: Browser): Promise<void> {
  // Periodic navigation to prevent session timeout
  await browser.navigate('https://www.instagram.com/');
  await sleep(2000);
}
```

### Handle Session Expiry

```typescript
async function handleSessionExpiry(browser: Browser): Promise<boolean> {
  // Check for login page redirect
  const url = await browser.getCurrentUrl();
  if (url.includes('/accounts/login')) {
    // Session expired, need re-auth
    return false;
  }
  return true;
}
```
