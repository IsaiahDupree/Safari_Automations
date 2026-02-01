# TikTok Selectors Reference

**Last Updated:** January 31, 2026  
**Status:** Known Working Selectors  
**Source:** `tiktok_selectors.py`, `tiktok_engagement.py`, `tiktok_messenger.py`, `tiktok_search.py`, Safari Automation testing

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

### Selectors (Updated Jan 31, 2026 - Safari Automation Validated)
| Element | Selector | Status |
|---------|----------|--------|
| Messages Icon | `[data-e2e="top-dm-icon"], [data-e2e="nav-messages"]` | ✅ Validated |
| Messages Link | `a[href*="/messages"]` | ✅ Working |
| Conversation List | `[class*="DivConversationListContainer"]` | ✅ Validated |
| **Conversation Item** | `[data-e2e="chat-list-item"]` | ✅ **Validated** (Primary) |
| Conversation Item Alt | `[class*="LiInboxItemWrapper"]` | ✅ Working |
| Message Input | `[data-e2e="message-input-area"]` | ✅ **Validated** |
| Message Input Fallback | `[contenteditable="true"]` | ✅ Working |
| Send Button | `[class*="DivSendButton"]` | ⚠️ Needs Enter key |
| **Chat Messages** | `[data-e2e="chat-item"]` | ✅ **Validated** |
| Chat Nickname | `[data-e2e="chat-nickname"]` | ✅ Validated |
| Chat User ID | `[data-e2e="chat-uniqueid"]` | ✅ Validated |
| Chat Avatar | `[data-e2e="chat-avatar"]` | ✅ Validated |
| New Message Button | `[class*="SpanNewMessage"]` | ✅ Working |
| Chat Box Container | `[class*="DivChatBox"]` | ✅ Validated |

### Profile Message Button (for profile-to-DM flow)
| Element | Selector | Status |
|---------|----------|--------|
| **Message Button** | `[data-e2e="message-button"]` | ✅ **Validated** |
| Message Icon Alt | `[data-e2e="message-icon"]` | ✅ Working |
| Follow Button | `[data-e2e="follow-button"]` | ✅ Working |
| User Title | `[data-e2e="user-title"]` | ✅ Working |
| User Avatar | `[data-e2e="user-avatar"]` | ✅ Working |

### Conversation List Item Structure (Validated Jan 31, 2026)
```html
<!-- Each chat-list-item contains: -->
<div data-e2e="chat-list-item" class="DivItemWrapper">
  <div class="DivItemInfo">
    <div class="DivInfoAvatarWrapper">
      <span class="SpanAvatarContainer">
        <img class="ImgAvatar" src="..." />  <!-- Avatar image -->
      </span>
    </div>
    <div class="DivInfoTextWrapper">
      <p class="PInfoNickname">Display Name</p>  <!-- User's display name -->
      <p class="PInfoExtractTime">
        <span class="SpanInfoExtract">Last message preview</span>
        <span class="SpanInfoTime">22:38</span>  <!-- Timestamp -->
      </p>
    </div>
  </div>
  <svg data-e2e="more-action-icon" />  <!-- More actions menu -->
</div>
```

### Get Conversations (Updated - Validated Working)
```javascript
// ✅ VALIDATED Jan 31, 2026 - Found 96 conversations
(function() {
    var conversations = [];
    var items = document.querySelectorAll('[data-e2e="chat-list-item"]');
    
    items.forEach(function(item) {
        var nickname = item.querySelector('[class*="PInfoNickname"]');
        var extract = item.querySelector('[class*="SpanInfoExtract"]');
        var time = item.querySelector('[class*="SpanInfoTime"]');
        var avatar = item.querySelector('[class*="ImgAvatar"]');
        
        conversations.push({
            displayName: nickname ? nickname.innerText.trim() : 'Unknown',
            lastMessage: extract ? extract.innerText.trim() : '',
            timestamp: time ? time.innerText.trim() : '',
            avatarUrl: avatar ? avatar.src : null,
            unread: item.querySelector('[class*="Unread"], [class*="Badge"]') !== null
        });
    });
    
    return JSON.stringify(conversations);
})();
```

### Chat Header Selectors (Validated Jan 31, 2026)
| Element | Selector | Description |
|---------|----------|-------------|
| Chat Header | `[class*="DivChatHeader"]` | Header container |
| Nickname | `[data-e2e="chat-nickname"]` | Display name |
| Username | `[data-e2e="chat-uniqueid"]` | @username |
| Avatar | `[data-e2e="top-chat-avatar"] img` | Profile picture |

### Chat Message Selectors (Validated Jan 31, 2026)
| Element | Selector | Description |
|---------|----------|-------------|
| Message Item | `[data-e2e="chat-item"]` | Individual message |
| Message Avatar | `[data-e2e="chat-avatar"]` | Sender avatar |
| Time Container | `[class*="DivTimeContainer"]` | Timestamp divider |
| Text Message | `[class*="DivTextContainer"]` | Text content |
| Video Share | `[class*="DivVideoContainer"]` | Shared video |
| Actions | `[class*="DivActions"]` | Reaction actions |
| DM Warning | `[data-e2e="dm-warning"]` | Message type warning |

### Chat Message Structure
```html
<div data-e2e="chat-item" class="DivChatItemWrapper">
  <div class="DivMessageVerticalContainer">
    <div class="DivMessageHorizontalContainer">
      <a href="/@username">
        <span data-e2e="chat-avatar">
          <img class="ImgAvatar" />
        </span>
      </a>
      <div class="DivCommonContainer">
        <!-- For text messages -->
        <div class="DivTextContainer">Message text</div>
        <!-- For video shares -->
        <div class="DivVideoContainer">
          <div class="DivAuthorOutsideContainer">
            <div class="DivAuthorInnerContainer">Username</div>
          </div>
        </div>
      </div>
      <div class="DivActions">
        <!-- Reaction icons -->
      </div>
    </div>
  </div>
</div>
```

### Get Messages with Full Details
```javascript
// ✅ VALIDATED Jan 31, 2026
(function() {
    var messages = [];
    var items = document.querySelectorAll('[data-e2e="chat-item"]');
    
    items.forEach(function(item) {
        var link = item.querySelector('a[href*="@"]');
        var sender = link ? link.href.match(/@([^/]+)/)?.[1] : null;
        var textEl = item.querySelector('[class*="TextContainer"]');
        var videoEl = item.querySelector('[class*="VideoContainer"]');
        var authorEl = item.querySelector('[class*="AuthorInnerContainer"]');
        
        messages.push({
            sender: sender,
            type: textEl ? 'text' : videoEl ? 'video' : 'other',
            content: textEl ? textEl.innerText.trim() : 
                     authorEl ? authorEl.innerText.trim() : 
                     item.innerText.trim().substring(0, 100),
            isMine: sender === 'YOUR_USERNAME'
        });
    });
    
    return JSON.stringify(messages);
})();
```

### Get Timestamps
```javascript
// ✅ VALIDATED - Each TimeContainer shows date/time divider
(function() {
    var times = [];
    var containers = document.querySelectorAll('[class*="TimeContainer"]');
    containers.forEach(function(c) {
        times.push(c.innerText.trim());
    });
    return JSON.stringify(times);
    // Returns: ["January 4, 2026 00:02", "January 5, 2026 17:58", "22:38"]
})();
```

---

## Message Requests (Validated Jan 31, 2026)

### Message Requests List Selectors
| Element | Selector | Description |
|---------|----------|-------------|
| Requests Container | `[class*="DivRequestGroup"]` | "Message requests" section |
| Requests Info | `[class*="DivRequestInfo"]` | Request count info |
| Request Item | `[data-e2e="chat-list-item"]` | Same as regular chats |
| Header | `[class*="DivFullSideNavConversationRequestHeader"]` | Requests header |

### Message Request Chat Selectors
| Element | Selector | Description |
|---------|----------|-------------|
| Stranger Box | `[class*="DivStrangerBox"]` | Accept/Delete container |
| Hint Text | `[class*="DivHint"]` | "X wants to send you a message" |
| Title | `[class*="PStrangerTitle"]` | Request title |
| Description | `[class*="PStrangerDesc"]` | Request description |
| Operations | `[class*="DivOperation"]` | Button container |
| Delete Button | `[class*="DivItem"]:first-child` | Delete request |
| Accept Button | `[class*="DivItem"]:last-child` | Accept request |
| Report Link | `[class*="SpanReportText"]` | Report user link |

### Navigate to Message Requests
```javascript
// ✅ VALIDATED - Click into message requests section
(function() {
    var requestGroup = document.querySelector('[class*="RequestGroup"]');
    if (requestGroup) {
        requestGroup.click();
        return 'clicked';
    }
    return 'not found';
})();
```

### Extract Message Requests List
```javascript
// ✅ VALIDATED - Get all message requests
(function() {
    var text = document.body.innerText;
    var requestsIdx = text.indexOf('Message requests');
    if (requestsIdx === -1) return 'no requests section';
    return text.substring(requestsIdx, requestsIdx + 1000);
})();
```

### Accept/Delete Message Request
```javascript
// ✅ VALIDATED - Accept or delete a message request
(function(action) {
    var strangerBox = document.querySelector('[class*="StrangerBox"]');
    if (!strangerBox) return 'no stranger box';
    
    var items = strangerBox.querySelectorAll('[class*="DivItem"]');
    if (action === 'delete' && items[0]) {
        items[0].click();
        return 'deleted';
    }
    if (action === 'accept' && items[1]) {
        items[1].click();
        return 'accepted';
    }
    return 'action not found';
})('accept'); // or 'delete'
```

---

### Send Message (Updated - Use Native Keystrokes)
```javascript
// ⚠️ JavaScript keyboard events don't work with Draft.js
// Use AppleScript native keystrokes instead:
// osascript -e 'tell application "Safari" to activate'
// osascript -e 'tell application "System Events" to keystroke "message"'
// osascript -e 'tell application "System Events" to keystroke return'

// Focus input first (JavaScript)
(function() {
    var input = document.querySelector('[data-e2e="message-input-area"]');
    if (!input) input = document.querySelector('[contenteditable="true"]');
    if (input) {
        input.focus();
        input.click();
        return 'FOCUSED';
    }
    return 'NO_INPUT';
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
