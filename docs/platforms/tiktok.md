# TikTok Platform Guide

## Overview

TikTok adapter supports:
- For You Page (FYP) navigation
- Video post discovery and extraction
- Like/unlike actions
- Comment posting
- Profile viewing
- **No DM support** (TikTok DMs require mobile app)

## URLs and Navigation

### Base URLs

| Page | URL Pattern |
|------|-------------|
| For You Page | `https://www.tiktok.com/foryou` |
| Following Feed | `https://www.tiktok.com/following` |
| Video Post | `https://www.tiktok.com/@{username}/video/{videoId}` |
| Profile | `https://www.tiktok.com/@{username}` |
| Search | `https://www.tiktok.com/search?q={query}` |
| Explore | `https://www.tiktok.com/explore` |

### Navigation Map

```
For You Page (/foryou)
├── Video Feed (vertical scroll)
│   ├── Video player (full screen)
│   ├── Author info (right side)
│   │   ├── Avatar
│   │   ├── Username
│   │   └── Follow button
│   ├── Action buttons (right side)
│   │   ├── Like + count
│   │   ├── Comment + count
│   │   ├── Save/Bookmark
│   │   └── Share
│   ├── Caption (bottom)
│   └── Sound info (bottom)
└── Navigation (left sidebar)

Video Page (/@{username}/video/{videoId})
├── Video player
├── Author info
├── Action buttons
├── Caption
├── Comment section
│   ├── Comment input
│   └── Comment list
└── Related videos

Profile Page (/@{username})
├── Profile header
│   ├── Avatar
│   ├── Username + display name
│   ├── Stats (following, followers, likes)
│   ├── Bio
│   └── Action buttons (Follow, Message*)
└── Video grid
```

## Login/Session Strategy

### Session Persistence

TikTok sessions use multiple cookies:
- `sessionid` - Main session
- `sid_tt` - Secondary session ID
- `uid_tt` - User ID
- `csrf_token` - CSRF protection

### Login Detection

```typescript
async function isLoggedIn(browser: Browser): Promise<boolean> {
  // Check for logged-in indicators
  const indicators = [
    '[data-e2e="profile-icon"]',
    'a[href="/upload"]',
    '[data-e2e="inbox-icon"]',
  ];
  
  for (const selector of indicators) {
    if (await browser.elementExists(selector)) {
      return true;
    }
  }
  
  // Check for login button (indicates logged out)
  if (await browser.elementExists('[data-e2e="top-login-button"]')) {
    return false;
  }
  
  return false;
}
```

### Session Health

```typescript
async function checkSessionHealth(browser: Browser): Promise<SessionHealth> {
  await browser.navigate('https://www.tiktok.com/foryou');
  
  // Check for captcha
  if (await browser.elementExists('[class*="captcha"]')) {
    return { isValid: false, warnings: ['Captcha required'] };
  }
  
  // Check for age gate
  if (await browser.elementExists('[data-e2e="age-gate"]')) {
    return { isValid: true, warnings: ['Age gate present'] };
  }
  
  return { isValid: true, warnings: [] };
}
```

## Selectors

### Video Page Selectors

```typescript
export const tiktokVideoSelectors = {
  // Video player
  videoPlayer: {
    primary: 'video',
    fallbacks: [
      '[data-e2e="browse-video"]',
      'div[class*="DivVideoContainer"] video',
    ],
  },
  
  // Like button
  likeButton: {
    primary: '[data-e2e="like-icon"]',
    fallbacks: [
      '[data-e2e="browse-like-icon"]',
      'span[data-e2e="like-icon"]',
      'button:has(svg[data-e2e="like-icon"])',
    ],
  },
  
  // Like count
  likeCount: {
    primary: '[data-e2e="like-count"]',
    fallbacks: [
      '[data-e2e="browse-like-count"]',
      'strong[data-e2e="like-count"]',
    ],
  },
  
  // Comment button
  commentButton: {
    primary: '[data-e2e="comment-icon"]',
    fallbacks: [
      '[data-e2e="browse-comment-icon"]',
    ],
  },
  
  // Comment count
  commentCount: {
    primary: '[data-e2e="comment-count"]',
    fallbacks: [
      '[data-e2e="browse-comment-count"]',
      'strong[data-e2e="comment-count"]',
    ],
  },
  
  // Share count
  shareCount: {
    primary: '[data-e2e="share-count"]',
    fallbacks: [
      'strong[data-e2e="share-count"]',
    ],
  },
  
  // Author username
  authorUsername: {
    primary: '[data-e2e="browse-username"]',
    fallbacks: [
      'a[data-e2e="video-author-uniqueid"]',
      'h3[data-e2e="browse-username"]',
    ],
  },
  
  // Author display name
  authorDisplayName: {
    primary: '[data-e2e="browse-nickname"]',
    fallbacks: [
      'h4[data-e2e="browse-nickname"]',
    ],
  },
  
  // Caption
  caption: {
    primary: '[data-e2e="browse-video-desc"]',
    fallbacks: [
      '[data-e2e="video-desc"]',
      'div[class*="DivVideoInfoContainer"] span',
    ],
  },
  
  // View count (on video page)
  viewCount: {
    primary: '[data-e2e="video-views"]',
    fallbacks: [
      'strong[data-e2e="video-views"]',
    ],
  },
  
  // Comment input
  commentInput: {
    primary: '[data-e2e="comment-input"]',
    fallbacks: [
      'div[contenteditable="true"][data-e2e="comment-input"]',
      'div[class*="DivInputEditorContainer"]',
    ],
  },
  
  // Post comment button
  postCommentButton: {
    primary: '[data-e2e="comment-post"]',
    fallbacks: [
      'button[data-e2e="comment-post"]',
    ],
  },
  
  // Sound/music info
  soundInfo: {
    primary: '[data-e2e="browse-music"]',
    fallbacks: [
      'a[href*="/music/"]',
    ],
  },
};
```

### Feed Selectors

```typescript
export const tiktokFeedSelectors = {
  // Video container in feed
  videoContainer: {
    primary: '[data-e2e="recommend-list-item-container"]',
    fallbacks: [
      'div[class*="DivItemContainerV2"]',
    ],
  },
  
  // Video link
  videoLink: {
    primary: 'a[href*="/video/"]',
    fallbacks: [
      '[data-e2e="recommend-list-item-container"] a',
    ],
  },
  
  // Feed container
  feedContainer: {
    primary: '[data-e2e="recommend-list"]',
    fallbacks: [
      'div[class*="DivVideoFeedV2"]',
    ],
  },
};
```

### Profile Selectors

```typescript
export const tiktokProfileSelectors = {
  // Follower count
  followerCount: {
    primary: '[data-e2e="followers-count"]',
    fallbacks: [
      'strong[data-e2e="followers-count"]',
    ],
  },
  
  // Following count
  followingCount: {
    primary: '[data-e2e="following-count"]',
    fallbacks: [
      'strong[data-e2e="following-count"]',
    ],
  },
  
  // Total likes
  likesCount: {
    primary: '[data-e2e="likes-count"]',
    fallbacks: [
      'strong[data-e2e="likes-count"]',
    ],
  },
  
  // Bio
  bio: {
    primary: '[data-e2e="user-bio"]',
    fallbacks: [
      'h2[data-e2e="user-bio"]',
    ],
  },
  
  // Video grid
  videoGrid: {
    primary: '[data-e2e="user-post-item-list"]',
    fallbacks: [
      'div[class*="DivVideoListContainer"]',
    ],
  },
};
```

## Actions

### Like Video

```typescript
async function likeVideo(browser: Browser, videoUrl: string): Promise<ActionResult> {
  await browser.navigate(videoUrl);
  await browser.waitForSelector(selectors.videoPlayer);
  
  // Check current like state
  const likeButton = await browser.findElement(selectors.likeButton);
  const isLiked = await likeButton.getAttribute('class')?.includes('liked');
  
  if (isLiked) {
    return { success: true, alreadyDone: true };
  }
  
  await likeButton.click();
  
  // Wait for state change (class changes or count increments)
  await sleep(1000);
  
  return { success: true, alreadyDone: false };
}
```

### Comment on Video

```typescript
async function commentOnVideo(
  browser: Browser,
  videoUrl: string,
  text: string
): Promise<ActionResult> {
  await browser.navigate(videoUrl);
  await browser.waitForSelector(selectors.commentInput);
  
  // Open comment section if needed
  const commentSection = await browser.findElementSafe(selectors.commentInput);
  if (!commentSection) {
    const commentButton = await browser.findElement(selectors.commentButton);
    await commentButton.click();
    await browser.waitForSelector(selectors.commentInput);
  }
  
  // Type comment
  const input = await browser.findElement(selectors.commentInput);
  await input.click();
  await input.type(text);
  
  // Post
  const postButton = await browser.findElement(selectors.postCommentButton);
  await browser.waitForEnabled(postButton);
  await postButton.click();
  
  // Verify
  await browser.waitForText(text, { timeout: 10000 });
  
  return { success: true };
}
```

## Stat Extraction

### Video Stats

```typescript
interface TikTokVideoStats {
  videoId: string;
  authorUsername: string;
  authorDisplayName: string | null;
  likeCount: number | null;
  commentCount: number | null;
  shareCount: number | null;
  viewCount: number | null;
  caption: string | null;
  soundName: string | null;
  hashtags: string[];
}

async function extractVideoStats(browser: Browser): Promise<TikTokVideoStats> {
  // Extract video ID from URL
  const url = await browser.getCurrentUrl();
  const videoIdMatch = url.match(/\/video\/(\d+)/);
  const videoId = videoIdMatch?.[1] || '';
  
  const stats: TikTokVideoStats = {
    videoId,
    authorUsername: await extractText(browser, selectors.authorUsername),
    authorDisplayName: await extractTextSafe(browser, selectors.authorDisplayName),
    likeCount: await extractAbbreviatedNumber(browser, selectors.likeCount),
    commentCount: await extractAbbreviatedNumber(browser, selectors.commentCount),
    shareCount: await extractAbbreviatedNumber(browser, selectors.shareCount),
    viewCount: await extractAbbreviatedNumber(browser, selectors.viewCount),
    caption: await extractTextSafe(browser, selectors.caption),
    soundName: await extractTextSafe(browser, selectors.soundInfo),
    hashtags: await extractHashtags(browser),
  };
  
  return stats;
}

async function extractAbbreviatedNumber(
  browser: Browser,
  selector: Selector
): Promise<number | null> {
  const text = await extractTextSafe(browser, selector);
  if (!text) return null;
  
  // Parse TikTok's abbreviated numbers: 1.2K, 3.4M, 5.6B
  const match = text.match(/([\d.]+)([KMB])?/i);
  if (!match) return null;
  
  let value = parseFloat(match[1]);
  const suffix = match[2]?.toUpperCase();
  
  if (suffix === 'K') value *= 1000;
  else if (suffix === 'M') value *= 1000000;
  else if (suffix === 'B') value *= 1000000000;
  
  return Math.round(value);
}
```

## Verification Rules

### Like Verification

```typescript
async function verifyLike(browser: Browser, videoUrl: string): Promise<boolean> {
  await browser.navigate(videoUrl);
  await browser.waitForSelector(selectors.likeButton);
  
  const likeButton = await browser.findElement(selectors.likeButton);
  const className = await likeButton.getAttribute('class') || '';
  
  // TikTok typically adds a "liked" or similar class
  return className.includes('liked') || className.includes('active');
}
```

### Comment Verification

```typescript
async function verifyComment(
  browser: Browser,
  videoUrl: string,
  commentText: string
): Promise<boolean> {
  await browser.navigate(videoUrl);
  
  // Open comments if needed
  const commentButton = await browser.findElement(selectors.commentButton);
  await commentButton.click();
  await sleep(1000);
  
  // Search for our comment
  return await browser.textExists(commentText);
}
```

## Known Pitfalls

### Rate Limiting

TikTok rate limits vary:
- **Likes**: ~30/hour generally safe
- **Comments**: ~10/hour
- **Profile views**: Generally unrestricted
- **Video views**: No limit

### Detection Signals

TikTok uses sophisticated detection:
- Browser fingerprinting
- Behavioral analysis
- IP reputation
- Device ID tracking

### Mitigation Strategies

```typescript
// Vary timing significantly
async function naturalDelay(): Promise<void> {
  const baseDelay = 2000 + Math.random() * 5000;
  const extraDelay = Math.random() < 0.2 ? Math.random() * 10000 : 0;
  await sleep(baseDelay + extraDelay);
}

// Scroll through feed naturally
async function naturalScroll(browser: Browser): Promise<void> {
  const scrollAmount = 300 + Math.random() * 500;
  await browser.scroll('down', scrollAmount);
  await sleep(500 + Math.random() * 1500);
}
```

### Video Autoplay

TikTok videos autoplay. Handle this:

```typescript
async function pauseVideo(browser: Browser): Promise<void> {
  // Click video to pause
  const video = await browser.findElement(selectors.videoPlayer);
  await video.click();
}

async function ensureVideoPaused(browser: Browser): Promise<void> {
  const video = await browser.findElement(selectors.videoPlayer);
  const isPaused = await browser.executeScript(`
    return arguments[0].paused;
  `, video);
  
  if (!isPaused) {
    await video.click();
  }
}
```

### Login Walls

TikTok may show login prompts for:
- Viewing certain content
- Liking/commenting
- Accessing profiles

```typescript
async function dismissLoginWall(browser: Browser): Promise<boolean> {
  const loginModal = await browser.findElementSafe('[data-e2e="login-modal"]');
  if (loginModal) {
    const closeButton = await browser.findElementSafe(
      '[data-e2e="login-modal"] button[aria-label="Close"]'
    );
    if (closeButton) {
      await closeButton.click();
      return true;
    }
  }
  return false;
}
```

### Geo-Restrictions

Some content may be geo-restricted. Handle gracefully:

```typescript
async function isContentRestricted(browser: Browser): Promise<boolean> {
  const restrictedIndicators = [
    '[data-e2e="video-unavailable"]',
    ':has-text("This video is not available")',
    ':has-text("content is not available")',
  ];
  
  for (const selector of restrictedIndicators) {
    if (await browser.elementExists(selector)) {
      return true;
    }
  }
  return false;
}
```

## DM Limitations

**TikTok Direct Messages are NOT supported** in this automation because:
1. DMs require the mobile app or authenticated API
2. Web interface has very limited DM functionality
3. Detection risk is extremely high for DM automation

For DM needs, consider:
- Manual engagement only
- Using official TikTok API (if available for your use case)
