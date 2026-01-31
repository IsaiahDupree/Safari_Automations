# Twitter/X DOM Selectors Reference

> Captured from x.com/compose/post on Jan 16, 2026

## Compose Modal Elements

### Text Input
| Element | Selector | Type | Notes |
|---------|----------|------|-------|
| Tweet textarea | `[data-testid="tweetTextarea_0"]` | DIV | `contenteditable="true"`, `role="textbox"` |
| Textarea label | `[data-testid="tweetTextarea_0_label"]` | - | Hidden label |
| Rich text container | `[data-testid="tweetTextarea_0RichTextInputContainer"]` | - | Wrapper |

### Action Buttons
| Element | Selector | aria-label | Notes |
|---------|----------|------------|-------|
| **Post button** | `[data-testid="tweetButton"]` | - | Disabled when empty |
| Close modal | `[data-testid="app-bar-close"]` | "Close" | X button |
| Drafts | `[data-testid="unsentButton"]` | - | Shows "Drafts" |

### Media & Attachments
| Element | Selector | aria-label | Notes |
|---------|----------|------------|-------|
| File input | `[data-testid="fileInput"]` | - | `type="file"`, hidden |
| Add photos/video | `[aria-label="Add photos or video"]` | "Add photos or video" | Visible button |
| Add GIF | `[data-testid="gifSearchButton"]` | "Add a GIF" | Opens GIF picker |
| Add poll | `[data-testid="createPollButton"]` | "Add poll" | Opens poll creator |
| Add emoji | `[aria-label="Add emoji"]` | "Add emoji" | Opens emoji picker |
| Schedule post | `[data-testid="scheduleOption"]` | "Schedule post" | Opens scheduler |
| Tag location | `[data-testid="geoButton"]` | "Tag location" | Location picker |
| Grok enhance | `[data-testid="grokImgGen"]` | "Enhance your post with Grok" | AI enhancement |

### Audience Controls
| Element | Selector | aria-label | Notes |
|---------|----------|------------|-------|
| Choose audience | `[aria-label="Choose audience"]` | "Choose audience" | Public/Circle |
| Reply settings | `[aria-label="Everyone can reply"]` | "Everyone can reply" | Who can reply |

### Progress & Status
| Element | Selector | Notes |
|---------|----------|-------|
| Character counter | `[data-testid="progressBar-bar"]` | Visual progress bar |
| Mask overlay | `[data-testid="mask"]` | Background overlay |

### Navigation (visible in compose)
| Element | Selector | Notes |
|---------|----------|-------|
| Home link | `[data-testid="AppTabBar_Home_Link"]` | |
| Explore link | `[data-testid="AppTabBar_Explore_Link"]` | |
| Notifications | `[data-testid="AppTabBar_Notifications_Link"]` | |
| DMs | `[data-testid="AppTabBar_DirectMessage_Link"]` | |
| More menu | `[data-testid="AppTabBar_More_Menu"]` | |
| Account switcher | `[data-testid="SideNav_AccountSwitcher_Button"]` | |

### User Info
| Element | Selector | Notes |
|---------|----------|-------|
| User avatar | `[data-testid="UserAvatar-Container-{username}"]` | e.g., `UserAvatar-Container-IsaiahDupree7` |
| Profile link | `[data-testid="AppTabBar_Profile_Link"]` | In sidebar |

---

## Post Success Detection

After posting, detect success by:

### URL Change
```javascript
// Success: URL changes to /status/{tweet_id}
window.location.href.match(/\/status\/(\d+)/)
```

### Success Toast
```javascript
document.querySelector('[data-testid="toast"]')
```

### Compose Modal Closed
```javascript
// Modal gone = likely success
!document.querySelector('[data-testid="tweetTextarea_0"]')
```

---

## Timeline/Feed Selectors

### Tweet Elements
| Element | Selector | Notes |
|---------|----------|-------|
| Tweet article | `[data-testid="tweet"]` | Individual tweet |
| Tweet text | `[data-testid="tweetText"]` | Tweet content |
| Like button | `[data-testid="like"]` | Heart icon |
| Unlike button | `[data-testid="unlike"]` | Filled heart |
| Retweet button | `[data-testid="retweet"]` | Repost icon |
| Reply button | `[data-testid="reply"]` | Comment icon |
| Share button | `[data-testid="share"]` | Share menu |
| Bookmark | `[data-testid="bookmark"]` | Save tweet |

### Engagement Counts
```javascript
// Get engagement from tweet article
tweet.querySelector('[data-testid="like"]').innerText  // "42" or empty
tweet.querySelector('[data-testid="retweet"]').innerText
tweet.querySelector('[data-testid="reply"]').innerText
```

---

## XPath Equivalents

```xpath
// Tweet textarea
//div[@data-testid="tweetTextarea_0"]

// Post button
//button[@data-testid="tweetButton"]

// File input
//input[@data-testid="fileInput"]

// Any data-testid
//*[@data-testid="elementName"]
```

---

## JavaScript Helpers

### Type in compose box
```javascript
const editor = document.querySelector('[data-testid="tweetTextarea_0"]');
editor.focus();
document.execCommand('insertText', false, 'Your tweet text');
```

### Click post button
```javascript
const postBtn = document.querySelector('[data-testid="tweetButton"]');
if (postBtn && !postBtn.disabled) postBtn.click();
```

### Attach media (trigger file input)
```javascript
const fileInput = document.querySelector('[data-testid="fileInput"]');
// Note: Can't programmatically set files due to security
// Must use actual file picker or drag-drop
```

### Get current tweet URL after posting
```javascript
// Wait for redirect, then:
const match = window.location.href.match(/\/status\/(\d+)/);
if (match) {
    const tweetId = match[1];
    const tweetUrl = `https://x.com/${username}/status/${tweetId}`;
}
```

---

## API Endpoints for Metrics

### RapidAPI - Twitter API
```
Host: twitter-api45.p.rapidapi.com
Endpoint: /tweet.php?id={tweet_id}
Returns: likes, retweets, replies, quotes, views
```

### Direct Scraping (from page)
```javascript
// On tweet page /status/{id}
const views = document.querySelector('[aria-label*="Views"]')?.innerText;
const likes = document.querySelector('[data-testid="like"]')?.innerText;
```

---

*Last updated: January 16, 2026*
