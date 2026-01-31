# TikTok Selectors Reference

**Last Updated:** January 30, 2026  
**Status:** Known Working Selectors  
**Source:** `tiktok_selectors.py`, `tiktok_engagement.py`, `tiktok_messenger.py`, `tiktok_search.py`

---

## Overview

TikTok uses `data-e2e` attributes for testing which are relatively stable. Class names follow patterns like `DivXxxContainer`. This document lists all verified working selectors.

**Important Notes:**
- `data-e2e` attributes are most stable - prefer these
- Class patterns use `[class*="DivName"]` for partial matching
- Virtual scrolling means elements may appear multiple times - use visibility check
- Contenteditable divs are used for text input (Draft.js)

---

## Navigation URLs

| Page | URL |
|------|-----|
| Home/For You | `https://www.tiktok.com/foryou` or `https://www.tiktok.com/en/` |
| Following | `https://www.tiktok.com/following` |
| Explore | `https://www.tiktok.com/explore` |
| Live | `https://www.tiktok.com/live` |
| Messages | `https://www.tiktok.com/messages` |
| Profile | `https://www.tiktok.com/@{username}` |
| Video | `https://www.tiktok.com/@{username}/video/{video_id}` |
| Search | `https://www.tiktok.com/search?q={query}` |
| Search Users | `https://www.tiktok.com/search/user?q={query}` |
| Search Videos | `https://www.tiktok.com/search/video?q={query}` |
| Hashtag | `https://www.tiktok.com/tag/{hashtag}` |

---

## Login Detection

### Check if Logged In
```javascript
// ✅ WORKING
(function() {
    var profileIcon = document.querySelector('[data-e2e="profile-icon"]');
    var uploadIcon = document.querySelector('[data-e2e="upload-icon"]');
    return (profileIcon || uploadIcon) ? 'logged_in' : 'not_logged_in';
})();
```

---

## Engagement Buttons (On Videos)

| Element | Selector | Status |
|---------|----------|--------|
| Like | `[data-e2e="like-icon"], [data-e2e="browse-like-icon"]` | ✅ Working |
| Like Count | `[data-e2e="like-count"], [data-e2e="browse-like-count"]` | ✅ Working |
| Comment | `[data-e2e="comment-icon"], [data-e2e="browse-comment-icon"]` | ✅ Working |
| Comment Count | `[data-e2e="comment-count"]` | ✅ Working |
| Share | `[data-e2e="share-icon"], [data-e2e="browse-share-icon"]` | ✅ Working |
| Share Count | `[data-e2e="share-count"], [data-e2e="browse-share-count"]` | ✅ Working |
| Save/Bookmark | `[data-e2e="bookmark-icon"], [data-e2e="undefined-icon"]` | ✅ Working |
| Save Count | `[data-e2e="bookmark-count"]` | ✅ Working |
| Follow | `[data-e2e="follow-button"]` | ✅ Working |

### Find Visible Like Icon (Virtual Scrolling)
```javascript
// ✅ WORKING - TikTok uses virtual scrolling, need visibility check
(function() {
    var icons = document.querySelectorAll('[data-e2e="like-icon"]');
    var visible = null;
    for (var icon of icons) {
        var rect = icon.getBoundingClientRect();
        if (rect.top > 0 && rect.top < window.innerHeight && rect.left > 0) {
            visible = {
                x: rect.left + rect.width/2, 
                y: rect.top + rect.height/2
            };
            break;
        }
    }
    return visible ? JSON.stringify(visible) : 'null';
})();
```

### Check if Video is Liked
```javascript
// ✅ WORKING - Check for red fill color
(function() {
    var icons = document.querySelectorAll('[data-e2e="like-icon"]');
    var isLiked = false;
    for (var icon of icons) {
        var rect = icon.getBoundingClientRect();
        if (rect.top > 0 && rect.top < window.innerHeight && rect.left > 0) {
            var svg = icon.querySelector('svg');
            if (svg) {
                var fill = window.getComputedStyle(svg).fill;
                // Check for red color (rgb(255, 56, 92))
                if (fill.includes('255, 56, 92')) {
                    isLiked = true;
                }
            }
            break;
        }
    }
    return isLiked.toString();
})();
```

---

## Comments Section

### Selectors
| Element | Selector | Status |
|---------|----------|--------|
| Comment Input | `[data-e2e="comment-input"], [data-e2e="comment-text"], [contenteditable="true"]` | ✅ Working |
| Comment Post Button | `[data-e2e="comment-post"], [class*="DivPostButton"]` | ✅ Working |
| Comment List | `[data-e2e="comment-list"], [class*="DivCommentListContainer"]` | ✅ Working |
| Comment Items | `[data-e2e="comment-item"], [class*="DivCommentItemWrapper"]` | ✅ Working |
| Comment Username | `[data-e2e="comment-username-1"]` | ✅ Working |
| Comment Text | `[data-e2e="comment-level-1"]` | ✅ Working |
| Comment Footer | `[class*="DivCommentFooter"]` | ✅ Working |

### Focus Comment Input
```javascript
// ✅ WORKING
(function() {
    var footer = document.querySelector('[class*="DivCommentFooter"]');
    if (footer) {
        var input = footer.querySelector('[contenteditable="true"]');
        if (input) {
            input.focus();
            return 'found';
        }
        return 'input_not_found';
    }
    return 'footer_not_found';
})();
```

### Get Comments
```javascript
// ✅ WORKING
(function() {
    var comments = [];
    var items = document.querySelectorAll('[data-e2e="comment-level-1"]');
    
    items.forEach(function(item, i) {
        if (i >= 50) return;
        var wrapper = item.closest('div[class*="Comment"]');
        if (!wrapper) wrapper = item.parentElement.parentElement;
        
        var userEl = wrapper ? wrapper.querySelector('[data-e2e="comment-username-1"]') : null;
        if (!userEl) userEl = wrapper ? wrapper.querySelector('a[href*="/@"]') : null;
        
        var username = userEl ? userEl.textContent.trim().replace('@', '') : 'unknown';
        var text = item.textContent.trim();
        
        if (text) {
            comments.push({
                username: username,
                text: text.substring(0, 500),
                index: i
            });
        }
    });
    
    return JSON.stringify(comments);
})();
```

### Verify Comment Posted
```javascript
// ✅ WORKING
(function() {
    var searchText = 'First part of comment';  // First 30 chars
    var items = document.querySelectorAll('[data-e2e="comment-level-1"]');
    for (var i = 0; i < items.length; i++) {
        if (items[i].textContent.includes(searchText)) return 'found';
    }
    return 'not_found';
})();
```

---

## Video Info

| Element | Selector | Status |
|---------|----------|--------|
| Video Player | `[data-e2e="browse-video"], video` | ✅ Working |
| Video Caption | `[data-e2e="browse-video-desc"]` | ✅ Working |
| Video Username | `[data-e2e="browse-username"], a[href*="/@"]` | ✅ Working |
| Video Music | `[data-e2e="video-music"]` | ✅ Working |

### Get Current Video Info
```javascript
// ✅ WORKING
(function() {
    var info = {};
    
    // Username
    var usernameEl = document.querySelector('[data-e2e="browse-username"]') || 
                     document.querySelector('a[href*="/@"]');
    if (usernameEl) {
        var href = usernameEl.getAttribute('href') || '';
        var match = href.match(/@([^/]+)/);
        info.username = match ? match[1] : usernameEl.textContent.trim().replace('@', '');
    }
    
    // Caption
    var captionEl = document.querySelector('[data-e2e="browse-video-desc"]');
    if (captionEl) {
        info.caption = captionEl.textContent.trim();
    }
    
    // Video ID from URL
    var url = window.location.href;
    var videoMatch = url.match(/\/video\/(\d+)/);
    if (videoMatch) {
        info.video_id = videoMatch[1];
    }
    
    // Like count
    var likeCountEl = document.querySelector('[data-e2e="like-count"]');
    if (likeCountEl) {
        info.like_count = likeCountEl.textContent.trim();
    }
    
    return JSON.stringify(info);
})();
```

---

## Navigation Sidebar

| Element | Selector | Status |
|---------|----------|--------|
| For You | `a[href="/foryou"], a[href="/en/"]` | ✅ Working |
| Following | `a[href="/following"]` | ✅ Working |
| Explore | `a[href*="explore"]` | ✅ Working |
| Live | `a[href*="live"]` | ✅ Working |
| Messages | `a[href*="messages"], [data-e2e="inbox-icon"]` | ✅ Working |
| Profile | `a[href*="profile"], [data-e2e="profile-icon"]` | ✅ Working |
| Upload | `a[href*="upload"]` | ✅ Working |
| Nav Container | `[class*="DivMainNavContainer"]` | ✅ Working |

---

## Direct Messages

### Selectors
| Element | Selector | Status |
|---------|----------|--------|
| Messages Icon | `[data-e2e="message-icon"]` | ✅ Working |
| Messages Link | `a[href*="/messages"]` | ✅ Working |
| Conversation List | `[class*="DivConversationListContainer"]` | ✅ Working |
| Conversation Item | `[class*="DivConversationItem"]` | ✅ Working |
| Conversation Username | `[class*="PUsername"], [class*="SpanNickname"]` | ✅ Working |
| Message Input | `[class*="DivInputContainer"] [contenteditable="true"]` | ✅ Working |
| Message Input Alt | `[data-e2e="message-input"]` | ✅ Working |
| Send Button | `[class*="DivSendButton"]` | ✅ Working |
| Send Button Alt | `[data-e2e="send-message-btn"]` | ✅ Working |
| Message List | `[class*="DivMessageList"]` | ✅ Working |
| Message Item | `[class*="DivMessageItem"]` | ✅ Working |
| New Message Button | `[class*="DivNewMessageButton"]` | ✅ Working |
| Chat Main Area | `[class*="DivChatMain"]` | ✅ Working |

### Get Conversations
```javascript
// ✅ WORKING
(function() {
    var conversations = [];
    var items = document.querySelectorAll('[class*="DivConversationItem"], [class*="ConversationListItem"]');
    
    items.forEach(function(item) {
        var username = item.querySelector('[class*="Username"], [class*="PName"]');
        var lastMsg = item.querySelector('[class*="LastMessage"], [class*="PPreview"]');
        var time = item.querySelector('[class*="Time"], [class*="SpanTime"]');
        var unread = item.querySelector('[class*="Unread"], [class*="Badge"]');
        
        conversations.push({
            username: username ? username.innerText.trim() : 'Unknown',
            last_message: lastMsg ? lastMsg.innerText.trim() : '',
            timestamp: time ? time.innerText.trim() : '',
            unread: !!unread
        });
    });
    
    return JSON.stringify(conversations);
})();
```

### Send Message
```javascript
// ✅ WORKING - Focus input first
(function() {
    var input = document.querySelector('[class*="DivInputContainer"] [contenteditable="true"]');
    if (!input) input = document.querySelector('[data-e2e="message-input"]');
    if (!input) input = document.querySelector('[contenteditable="true"]');
    
    if (input) {
        input.focus();
        input.click();
        return 'FOCUSED';
    }
    return 'NO_INPUT';
})();

// Then click send
(function() {
    var btn = document.querySelector('[class*="DivSendButton"]');
    if (!btn) btn = document.querySelector('[data-e2e="send-message-btn"]');
    if (!btn) btn = document.querySelector('[aria-label*="Send"]');
    
    if (btn) {
        btn.click();
        return 'SENT';
    }
    return 'NO_BUTTON';
})();
```

---

## Search

### Selectors
| Element | Selector | Status |
|---------|----------|--------|
| Search Input | `input[data-e2e="search-user-input"], input[type="search"]` | ✅ Working |
| Search Button | `[data-e2e="search-icon"]` | ✅ Working |
| Search Clear | `[data-e2e="search-clear-icon"]` | ✅ Working |
| Tab: Top | `[data-e2e="search-top-tab"]` | ✅ Working |
| Tab: Users | `[data-e2e="search-user-tab"]` | ✅ Working |
| Tab: Videos | `[data-e2e="search-video-tab"]` | ✅ Working |
| Tab: Sounds | `[data-e2e="search-sound-tab"]` | ✅ Working |
| Tab: Live | `[data-e2e="search-live-tab"]` | ✅ Working |
| User Card | `[data-e2e="search-user-card"]` | ✅ Working |
| User Username | `[data-e2e="search-username"]` | ✅ Working |
| User Nickname | `[data-e2e="search-nickname"]` | ✅ Working |
| User Followers | `[data-e2e="search-follow-count"]` | ✅ Working |
| Video Card | `[data-e2e="search-video-card"]` | ✅ Working |
| Hashtag Card | `[data-e2e="search-challenge-card"]` | ✅ Working |

### Search Users
```javascript
// ✅ WORKING
(function() {
    var users = [];
    var cards = document.querySelectorAll('[data-e2e="search-user-card"], [class*="DivUserCardContainer"]');
    
    cards.forEach(function(card, i) {
        if (i >= 20) return;
        
        var username = card.querySelector('[data-e2e="search-username"], [class*="Username"]');
        var nickname = card.querySelector('[data-e2e="search-nickname"], [class*="Nickname"]');
        var followers = card.querySelector('[data-e2e="search-follow-count"], [class*="FollowerCount"]');
        var verified = card.querySelector('[class*="Verified"], svg[class*="verified"]');
        var link = card.querySelector('a[href*="/@"]');
        
        users.push({
            username: username ? username.innerText.trim().replace('@', '') : '',
            nickname: nickname ? nickname.innerText.trim() : '',
            followers: followers ? followers.innerText.trim() : '',
            verified: !!verified,
            url: link ? link.href : ''
        });
    });
    
    return JSON.stringify(users);
})();
```

---

## Profile Page

| Element | Selector | Status |
|---------|----------|--------|
| Profile Icon | `[data-e2e="profile-icon"]` | ✅ Working |
| User Avatar | `[data-e2e="user-avatar"]` | ✅ Working |
| User Title | `[data-e2e="user-title"], [class*="UserTitle"]` | ✅ Working |
| User Link | `a[href*="/@"]` | ✅ Working |

---

## Share Menu

### Copy Link Button
```javascript
// ✅ WORKING
(function() {
    var btn = document.querySelector('[data-e2e="share-copy-link"]');
    if (!btn) btn = document.querySelector('button[aria-label*="Copy link"]');
    if (!btn) btn = document.querySelector('div[data-e2e="copy-link"]');
    
    if (!btn) {
        var btns = document.querySelectorAll('button, div[role="button"]');
        for (var i = 0; i < btns.length; i++) {
            if (btns[i].textContent.toLowerCase().includes('copy link')) {
                btn = btns[i];
                break;
            }
        }
    }
    
    if (btn) {
        btn.click();
        return 'clicked';
    }
    return 'not_found';
})();
```

---

## Selector Patterns Summary

| Element | Primary Selector | Fallback |
|---------|-----------------|----------|
| Engagement Icons | `[data-e2e="X-icon"]` | `[class*="DivXWrapper"]` |
| Comment Input | `[data-e2e="comment-input"]` | `[contenteditable="true"]` |
| Comment Post | `[data-e2e="comment-post"]` | `[class*="DivPostButton"]` |
| Comment Text | `[data-e2e="comment-level-1"]` | - |
| Comment User | `[data-e2e="comment-username-1"]` | `a[href*="/@"]` |
| Video Info | `[data-e2e="browse-X"]` | - |
| DM Input | `[data-e2e="message-input"]` | `[contenteditable="true"]` |
| Search Elements | `[data-e2e="search-X"]` | `[class*="DivX"]` |
| Navigation | `a[href*="X"]` | `[data-e2e="X-icon"]` |

---

## Known Issues

1. **Virtual scrolling** - Multiple elements exist; use `getBoundingClientRect()` visibility check
2. **Draft.js input** - Use `contenteditable="true"` + InputEvent, not value
3. **Like color check** - Red is `rgb(255, 56, 92)` when liked
4. **Class name instability** - Prefer `data-e2e` over class names
5. **Rate limiting** - TikTok detects automation; add delays between actions

---

## Usage Example

```python
from automation.tiktok_engagement import TikTokEngagement

tiktok = TikTokEngagement()
await tiktok.start()

# Check login
await tiktok.check_login_status()

# Navigate to FYP
await tiktok.navigate_to_fyp()

# Like current video
await tiktok.like_current_video()

# Post comment
result = await tiktok.post_comment("Great video!")

# Get comments
comments = await tiktok.get_comments(limit=20)
```

---

**Document Owner:** Engineering Team
