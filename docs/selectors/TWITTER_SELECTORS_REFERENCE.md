# Twitter/X Selectors Reference

**Last Updated:** January 30, 2026  
**Status:** Known Working Selectors  
**Source:** `twitter_selectors.py`, `safari_twitter_poster.py`, `safari_twitter_dm.py`, `twitter_engagement.py`

---

## Overview

Twitter/X uses `data-testid` attributes extensively for testing. These are the most stable selectors. Class names are dynamically generated and should be avoided.

**Important Notes:**
- `data-testid` attributes are most stable - prefer these
- Twitter uses Draft.js with `contenteditable` for text input
- The domain changed from `twitter.com` to `x.com` - both work
- Submit via `Cmd+Enter` keyboard shortcut is reliable

---

## Navigation URLs

| Page | URL |
|------|-----|
| Home | `https://x.com/home` |
| Home (Legacy) | `https://twitter.com/home` |
| Compose | `https://x.com/compose/post` |
| Compose (Legacy) | `https://twitter.com/compose/tweet` |
| Intent Post | `https://x.com/intent/post` |
| Notifications | `https://x.com/notifications` |
| Mentions | `https://x.com/notifications/mentions` |
| Messages | `https://x.com/messages` |
| DM Compose | `https://x.com/messages/compose` |
| Profile | `https://x.com/{username}` |
| Tweet/Status | `https://x.com/{username}/status/{tweet_id}` |

---

## Login Detection

### Logged In Indicators
```javascript
// ✅ WORKING - Check for any of these selectors
var indicators = [
    '[data-testid="AppTabBar_Profile_Link"]',
    '[data-testid="SideNav_NewTweet_Button"]',
    'a[href="/compose/post"]',
    'a[href="/compose/tweet"]',
    '[aria-label="Profile"]',
    '[data-testid="primaryColumn"]',
    '[data-testid="tweetTextarea_0"]'
];
```

### Logged Out Indicators
```javascript
// ✅ WORKING - Check for login/signup buttons
var loginIndicators = [
    'a[href="/login"]',
    'a[href="/i/flow/login"]',
    '[data-testid="loginButton"]',
    'a[href="/i/flow/signup"]'
];
```

### Full Login Check
```javascript
// ✅ WORKING
(function() {
    var url = window.location.href;
    
    // Check for login/signup page
    if (url.includes('/login') || url.includes('/i/flow/login') || url.includes('/i/flow/signup')) {
        return JSON.stringify({logged_in: false, reason: 'on_login_page', url: url});
    }
    
    // Check for logged-in indicators
    var indicators = [
        '[data-testid="AppTabBar_Profile_Link"]',
        '[data-testid="SideNav_NewTweet_Button"]',
        'a[href="/compose/post"]',
        '[data-testid="tweetTextarea_0"]'
    ];
    
    for (var i = 0; i < indicators.length; i++) {
        var el = document.querySelector(indicators[i]);
        if (el) {
            var profileLink = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
            var username = profileLink ? profileLink.getAttribute('href').replace('/', '') : '';
            return JSON.stringify({logged_in: true, username: username});
        }
    }
    
    return JSON.stringify({logged_in: false, reason: 'no_indicators_found'});
})();
```

---

## Compose / Post Creation

### Selectors
| Element | Selector | Status |
|---------|----------|--------|
| Text Input | `[data-testid="tweetTextarea_0"]` | ✅ Working |
| Text Input Alt | `[role="textbox"][data-testid*="tweetTextarea"]` | ✅ Working |
| Draft Editor | `.public-DraftEditor-content` | ✅ Working |
| Contenteditable | `[contenteditable="true"]` | ✅ Working |
| Post Button | `[data-testid="tweetButton"]` | ✅ Working |
| Post Button Inline | `[data-testid="tweetButtonInline"]` | ✅ Working |
| Media Button | `[aria-label="Add photos or video"]` | ✅ Working |
| File Input | `input[type="file"][accept*="image"]` | ✅ Working |
| GIF Button | `[aria-label="Add a GIF"]` | ✅ Working |
| Poll Button | `[data-testid="createPollButton"]` | ✅ Working |
| Schedule Button | `[data-testid="scheduleOption"]` | ✅ Working |
| Emoji Button | `[aria-label="Add emoji"]` | ✅ Working |

### Type in Composer
```javascript
// ✅ WORKING
(function() {
    var editor = document.querySelector('[data-testid="tweetTextarea_0"]');
    if (!editor) editor = document.querySelector('[role="textbox"][data-testid*="tweetTextarea"]');
    if (!editor) editor = document.querySelector('.public-DraftEditor-content');
    if (!editor) editor = document.querySelector('[contenteditable="true"]');
    
    if (editor) {
        editor.focus();
        document.execCommand('insertText', false, 'Your tweet text here');
        return 'success';
    }
    return 'editor_not_found';
})();
```

### Click Post Button
```javascript
// ✅ WORKING
(function() {
    var postBtn = document.querySelector('[data-testid="tweetButton"]');
    if (!postBtn) postBtn = document.querySelector('[data-testid="tweetButtonInline"]');
    
    if (!postBtn) {
        // Fallback: Find by button text
        var buttons = document.querySelectorAll('button');
        for (var i = 0; i < buttons.length; i++) {
            var text = (buttons[i].innerText || '').trim();
            if (text === 'Post' || text === 'Tweet') {
                postBtn = buttons[i];
                break;
            }
        }
    }
    
    if (postBtn && !postBtn.disabled) {
        postBtn.click();
        return 'clicked';
    } else if (postBtn && postBtn.disabled) {
        return 'button_disabled';
    }
    return 'button_not_found';
})();
```

---

## Feed / Timeline

### Selectors
| Element | Selector | Status |
|---------|----------|--------|
| Tweet Article | `article[data-testid="tweet"]` | ✅ Working |
| Tweet Article Alt | `article[role="article"]` | ✅ Working |
| Tweet Cell | `[data-testid="cellInnerDiv"] article` | ✅ Working |
| Tweet Text | `[data-testid="tweetText"]` | ✅ Working |
| Tweet Link | `a[href*="/status/"]` | ✅ Working |
| User Link | `a[href^="/"][role="link"]` | ✅ Working |
| Timestamp | `time[datetime]` | ✅ Working |

### Find Tweet in Feed
```javascript
// ✅ WORKING
(function() {
    var tweets = document.querySelectorAll('article[data-testid="tweet"]');
    if (!tweets.length) tweets = document.querySelectorAll('article[role="article"]');
    
    for (var i = 0; i < Math.min(tweets.length, 15); i++) {
        var tweet = tweets[i];
        
        // Get username
        var username = '';
        var userLinks = tweet.querySelectorAll('a[href^="/"]');
        for (var j = 0; j < userLinks.length; j++) {
            var href = userLinks[j].getAttribute('href') || '';
            if (href.match(/^\/[a-zA-Z0-9_]+$/) && !href.includes('/status/')) {
                username = href.replace('/', '');
                break;
            }
        }
        
        // Get tweet text
        var tweetText = tweet.querySelector('[data-testid="tweetText"]');
        var content = tweetText ? tweetText.innerText : '';
        
        // Get tweet link
        var timeLink = tweet.querySelector('a[href*="/status/"]');
        var tweetUrl = timeLink ? timeLink.href : '';
        
        if (username && content.length > 10 && tweetUrl) {
            return JSON.stringify({
                username: username,
                url: tweetUrl,
                content: content.substring(0, 300),
                index: i
            });
        }
    }
    return JSON.stringify({error: 'No suitable tweet found'});
})();
```

---

## Engagement Buttons

### Selectors
| Element | Selector | Status |
|---------|----------|--------|
| Like | `[data-testid="like"]` | ✅ Working |
| Unlike | `[data-testid="unlike"]` | ✅ Working |
| Retweet | `[data-testid="retweet"]` | ✅ Working |
| Reply | `[data-testid="reply"]` | ✅ Working |
| Share | `[data-testid="share"]` | ✅ Working |
| Bookmark | `[data-testid="bookmark"]` | ✅ Working |

### Like Tweet
```javascript
// ✅ WORKING
(function() {
    var likeButton = document.querySelector('[data-testid="like"]');
    if (likeButton) {
        likeButton.click();
        return 'liked';
    }
    return 'not_found';
})();
```

### Click Reply Button
```javascript
// ✅ WORKING
(function() {
    var replyButton = document.querySelector('[data-testid="reply"]');
    if (replyButton) {
        replyButton.click();
        return 'clicked';
    }
    return 'not_found';
})();
```

---

## Reply Modal

### Focus Reply Input
```javascript
// ✅ WORKING
(function() {
    // Strategy 1: Find contenteditable in #layers modal
    var layers = document.querySelector('#layers');
    if (layers) {
        var editable = layers.querySelector('[contenteditable="true"]');
        if (editable && editable.offsetParent !== null) {
            editable.focus();
            editable.click();
            return 'focused_layers_editable';
        }
    }
    
    // Strategy 2: Find the reply composer by data-testid
    var composer = document.querySelector('[data-testid="tweetTextarea_0"]');
    if (composer) {
        var editable = composer.querySelector('[contenteditable="true"]') || composer;
        editable.focus();
        editable.click();
        return 'focused_textarea';
    }
    
    // Strategy 3: Look for contenteditable in modal dialog
    var modal = document.querySelector('[aria-modal="true"]');
    if (modal) {
        var editable = modal.querySelector('[contenteditable="true"]');
        if (editable) {
            editable.focus();
            editable.click();
            return 'focused_modal_editable';
        }
    }
    
    return 'not_found';
})();
```

### Submit Reply
```javascript
// ✅ WORKING
(function() {
    // Strategy 1: Find Reply button in modal layers
    var btns = document.querySelectorAll('#layers button');
    for (var i = 0; i < btns.length; i++) {
        var btn = btns[i];
        var text = (btn.innerText || '').trim();
        if (text === 'Reply' && btn.offsetParent !== null) {
            btn.click();
            return 'clicked_layers_reply';
        }
    }
    
    // Strategy 2: Find Reply button by data-testid
    var replyBtn = document.querySelector('[data-testid="tweetButton"]');
    if (replyBtn && replyBtn.offsetParent !== null) {
        replyBtn.click();
        return 'submitted_tweetButton';
    }
    
    // Strategy 3: Find inline reply button
    var inlineBtn = document.querySelector('[data-testid="tweetButtonInline"]');
    if (inlineBtn && inlineBtn.offsetParent !== null) {
        inlineBtn.click();
        return 'submitted_inline';
    }
    
    return 'not_found';
})();
```

---

## Direct Messages

### Selectors
| Element | Selector | Status |
|---------|----------|--------|
| Conversation Item | `[data-testid="conversation"]` | ✅ Working |
| Conversation Entry | `[data-testid="DMConversationEntry"]` | ✅ Working |
| Message Input | `[data-testid="dmComposerTextInput"]` | ✅ Working |
| Message Input Alt | `[aria-label="Start a new message"]` | ✅ Working |
| Send Button | `[data-testid="dmComposerSendButton"]` | ✅ Working |
| Send Button Alt | `[aria-label="Send"]` | ✅ Working |
| Message Entry | `[data-testid="messageEntry"]` | ✅ Working |
| Message Bubble | `[data-testid="DM_message"]` | ✅ Working |
| Unread Badge | `[data-testid="unread-badge"]` | ✅ Working |
| User Name | `[data-testid="User-Name"]` | ✅ Working |
| Message Preview | `[data-testid="messagePreview"]` | ✅ Working |

### Get Conversations
```javascript
// ✅ WORKING
(function() {
    var conversations = [];
    var items = document.querySelectorAll('[data-testid="conversation"]');
    
    items.forEach(function(item) {
        var username = item.querySelector('[data-testid="User-Name"]');
        var preview = item.querySelector('[data-testid="messagePreview"]');
        var isUnread = item.querySelector('[data-testid="unread-badge"]') !== null;
        
        conversations.push({
            username: username ? username.textContent : 'Unknown',
            preview: preview ? preview.textContent : '',
            unread: isUnread
        });
    });
    
    return JSON.stringify(conversations);
})();
```

---

## Notifications

### Selectors
| Element | Selector | Status |
|---------|----------|--------|
| Notification Item | `[data-testid="notification"]` | ✅ Working |
| Notification Cell | `[data-testid="cellInnerDiv"]` | ✅ Working |
| Unread Badge | `[data-testid="notificationIndicator"]` | ✅ Working |
| All Tab | `[role="tab"][href="/notifications"]` | ✅ Working |
| Mentions Tab | `[role="tab"][href="/notifications/mentions"]` | ✅ Working |

---

## Profile

### Selectors
| Element | Selector | Status |
|---------|----------|--------|
| Profile Nav Link | `[data-testid="AppTabBar_Profile_Link"]` | ✅ Working |
| User Name | `[data-testid="UserName"]` | ✅ Working |
| Profile Header | `[data-testid="UserProfileHeader_Items"]` | ✅ Working |
| Follow Button | `[data-testid="followButton"]` | ✅ Working |
| Unfollow Button | `[data-testid="unfollowButton"]` | ✅ Working |

### Get Username
```javascript
// ✅ WORKING
(function() {
    var profileLink = document.querySelector('[data-testid="AppTabBar_Profile_Link"]');
    if (profileLink) {
        return profileLink.getAttribute('href').replace('/', '');
    }
    return '';
})();
```

---

## Toast / Feedback

### Selectors
| Element | Selector | Status |
|---------|----------|--------|
| Toast | `[data-testid="toast"]` | ✅ Working |
| Alert | `[role="alert"]` | ✅ Working |
| Error | `[data-testid="error"]` | ✅ Working |

---

## Verify Post Success

```javascript
// ✅ WORKING
(function() {
    var url = window.location.href;
    var result = {url: url};
    
    // Check if we're on a status page (successful post)
    var match = url.match(/\/status\/(\d+)/);
    if (match) {
        result.posted = true;
        result.tweet_id = match[1];
        return JSON.stringify(result);
    }
    
    // Check for toast notifications
    var toast = document.querySelector('[data-testid="toast"]');
    if (toast) {
        result.toast = toast.innerText;
    }
    
    // Check if compose modal is gone
    var composer = document.querySelector('[data-testid="tweetTextarea_0"]');
    result.compose_open = !!composer;
    
    // Check for error states
    var errorBanner = document.querySelector('[role="alert"]');
    if (errorBanner) {
        result.error = errorBanner.innerText;
    }
    
    return JSON.stringify(result);
})();
```

---

## Get Tweet Metrics

```javascript
// ✅ WORKING
(function() {
    var metrics = {};
    
    // Get like count
    var likeBtn = document.querySelector('[data-testid="like"]') || 
                  document.querySelector('[data-testid="unlike"]');
    if (likeBtn) {
        var likeText = likeBtn.getAttribute('aria-label') || likeBtn.innerText;
        var match = likeText.match(/[\d,]+/);
        if (match) metrics.likes = match[0].replace(/,/g, '');
    }
    
    // Get retweet count
    var rtBtn = document.querySelector('[data-testid="retweet"]');
    if (rtBtn) {
        var rtText = rtBtn.getAttribute('aria-label') || rtBtn.innerText;
        var match = rtText.match(/[\d,]+/);
        if (match) metrics.retweets = match[0].replace(/,/g, '');
    }
    
    // Get reply count
    var replyBtn = document.querySelector('[data-testid="reply"]');
    if (replyBtn) {
        var replyText = replyBtn.getAttribute('aria-label') || replyBtn.innerText;
        var match = replyText.match(/[\d,]+/);
        if (match) metrics.replies = match[0].replace(/,/g, '');
    }
    
    return JSON.stringify(metrics);
})();
```

---

## Selector Patterns Summary

| Element | Primary Selector | Fallback |
|---------|-----------------|----------|
| Tweet Article | `article[data-testid="tweet"]` | `article[role="article"]` |
| Tweet Text | `[data-testid="tweetText"]` | `[lang]` |
| Post Button | `[data-testid="tweetButton"]` | Button text "Post"/"Tweet" |
| Reply Button | `[data-testid="reply"]` | `[aria-label*="Reply"]` |
| Like Button | `[data-testid="like"]` | `[aria-label*="Like"]` |
| Retweet | `[data-testid="retweet"]` | `[aria-label*="Repost"]` |
| Text Input | `[data-testid="tweetTextarea_0"]` | `[contenteditable="true"]` |
| Profile Link | `[data-testid="AppTabBar_Profile_Link"]` | - |
| DM Input | `[data-testid="dmComposerTextInput"]` | `[contenteditable="true"]` |
| DM Send | `[data-testid="dmComposerSendButton"]` | `[aria-label="Send"]` |

---

## Known Issues

1. **Domain change** - `twitter.com` redirects to `x.com`, both URLs work
2. **Draft.js input** - Use `document.execCommand('insertText')` for typing
3. **Modal layers** - Reply modal is in `#layers` element
4. **Keyboard shortcut** - `Cmd+Enter` reliably submits posts/replies
5. **Rate limiting** - Add delays between actions to avoid suspension
6. **Encryption code** - If asked during login: `7911`

---

## Usage Example

```python
from automation.safari_twitter_poster import SafariTwitterPoster

twitter = SafariTwitterPoster()

# Check login
status = twitter.check_login_status()
if status.get('logged_in'):
    print(f"Logged in as: {status.get('username')}")

# Post tweet
result = twitter.post_tweet("Hello from MediaPoster!")
if result.get('posted'):
    print(f"Posted! Tweet ID: {result.get('tweet_id')}")
```

---

**Document Owner:** Engineering Team
