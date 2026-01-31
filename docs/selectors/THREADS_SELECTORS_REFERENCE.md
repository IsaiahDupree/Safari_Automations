# Threads Selectors Reference

**Last Updated:** January 30, 2026  
**Status:** Known Working Selectors  
**Source:** `threads_selectors.py`, `safari_threads_poster.py`, `threads_auto_commenter.py`

---

## Overview

Threads (threads.net / threads.com) shares styling patterns with Instagram but has its own unique DOM structure. This document lists all verified working selectors.

**Important Notes:**
- Threads uses `[data-pressable-container="true"]` instead of `<article>` for posts
- SVG icons use `aria-label` for identification
- Contenteditable divs are used for text input (not textarea)

---

## Navigation URLs

| Page | URL |
|------|-----|
| Home/Feed | `https://www.threads.net/` |
| Login | `https://www.threads.net/login` |
| Activity | `https://www.threads.net/activity` |
| Search | `https://www.threads.net/search` |
| Profile | `https://www.threads.net/@{username}` |
| Post | `https://www.threads.net/@{username}/post/{post_id}` |
| DM Inbox | `https://www.threads.net/direct/inbox` |
| Compose | `https://www.threads.net/compose` |

**Alternative Domain:** `threads.com` also works

---

## Navigation Icons (Sidebar)

| Element | Selector | Status |
|---------|----------|--------|
| Home | `svg[aria-label="Home"]` | ✅ Working |
| Search | `svg[aria-label="Search"]` | ✅ Working |
| Create | `svg[aria-label="Create"]` | ✅ Working |
| Notifications | `svg[aria-label="Notifications"]` | ✅ Working |
| Profile | `svg[aria-label="Profile"]` | ✅ Working |
| More | `svg[aria-label="More"]` | ✅ Working |
| Back | `svg[aria-label="Back"]` | ✅ Working |

### Click SVG Button Pattern
```javascript
// ✅ WORKING - Generic pattern for all SVG buttons
(function() {
    var svg = document.querySelector('svg[aria-label="Home"]');
    if (svg) {
        var btn = svg.closest('[role="button"]') || svg.parentElement;
        if (btn) {
            btn.click();
            return 'clicked';
        }
    }
    return 'not_found';
})();
```

---

## Login Detection

### Check if Logged In
```javascript
// ✅ WORKING
(function() {
    // Check for create button (only visible when logged in)
    var createBtn = document.querySelector('svg[aria-label="Create"]');
    if (createBtn) return 'logged_in';
    
    // Check for profile link
    var profileBtn = document.querySelector('svg[aria-label="Profile"]');
    if (profileBtn) return 'logged_in';
    
    // Check for login button
    var loginBtn = document.querySelector('a[href*="/login"]');
    if (loginBtn) return 'not_logged_in';
    
    return 'unknown';
})();
```

---

## Post Actions

| Action | Selector | Status |
|--------|----------|--------|
| Like | `svg[aria-label="Like"]` | ✅ Working |
| Unlike | `svg[aria-label="Unlike"]` | ✅ Working |
| Reply | `svg[aria-label="Reply"]` | ✅ Working |
| Repost | `svg[aria-label="Repost"]` | ✅ Working |
| Share | `svg[aria-label="Share"]` | ✅ Working |
| More Options | `svg[aria-label="More"]` | ✅ Working |
| Audio Muted | `svg[aria-label="Audio is muted"]` | ✅ Working |

### Click Reply Button
```javascript
// ✅ WORKING
(function() {
    var replyBtns = document.querySelectorAll('svg[aria-label="Reply"]');
    if (replyBtns.length > 0) {
        var btn = replyBtns[0].closest('[role="button"]') || replyBtns[0].parentElement;
        if (btn) {
            btn.click();
            return 'clicked';
        }
    }
    return 'not_found';
})();
```

---

## Content Containers

| Element | Selector | Status |
|---------|----------|--------|
| Post Container | `[data-pressable-container="true"]` | ✅ Working |
| User Link | `a[href*="/@"]` | ✅ Working |
| Post Link | `a[href*="/post/"]` | ✅ Working |
| Timestamp | `time` | ✅ Working |
| Text Content | `[dir="auto"] span` | ✅ Working |
| Text Content Alt | `[dir="ltr"] span` | ✅ Working |
| Dialog/Modal | `[role="dialog"]` | ✅ Working |

### Get Post Details
```javascript
// ✅ WORKING
(function() {
    var container = document.querySelector('[data-pressable-container="true"]');
    if (!container) return JSON.stringify({error: 'no_container'});
    
    // Username
    var userLink = container.querySelector('a[href*="/@"]');
    var username = userLink ? userLink.href.split('/@').pop().split('/')[0] : '';
    
    // Text content
    var textEl = container.querySelector('[dir="auto"] span');
    var text = textEl ? textEl.innerText : '';
    
    // Timestamp
    var timeEl = container.querySelector('time');
    var timestamp = timeEl ? timeEl.getAttribute('datetime') : '';
    
    // Post ID from link
    var postLink = container.querySelector('a[href*="/post/"]');
    var postId = '';
    if (postLink) {
        var match = postLink.href.match(/\/post\/([A-Za-z0-9_-]+)/);
        postId = match ? match[1] : '';
    }
    
    return JSON.stringify({
        username: username,
        text: text.substring(0, 500),
        timestamp: timestamp,
        post_id: postId,
        url: window.location.href
    });
})();
```

---

## Composer (Reply/Create)

### Text Input Selectors
```javascript
// ✅ WORKING - Primary selector
document.querySelector('[role="textbox"][contenteditable="true"]')

// ✅ WORKING - Fallback
document.querySelector('[contenteditable="true"]')

// ✅ WORKING - Aria label based
document.querySelector('[aria-label*="Empty text field"]')
```

### Type in Composer
```javascript
// ✅ WORKING
(function() {
    var input = document.querySelector('[role="textbox"][contenteditable="true"]');
    if (!input) {
        input = document.querySelector('[contenteditable="true"]');
    }
    if (input) {
        input.focus();
        input.innerText = 'Your reply text here';
        input.dispatchEvent(new InputEvent('input', { bubbles: true }));
        return 'typed';
    }
    return 'input_not_found';
})();
```

### Submit Reply
```javascript
// ✅ WORKING
(function() {
    // Method 1: Second Reply button (submit button when composer is open)
    var replyBtns = document.querySelectorAll('svg[aria-label="Reply"]');
    if (replyBtns.length >= 2) {
        var btn = replyBtns[1].closest('[role="button"]') || replyBtns[1].parentElement;
        if (btn && !btn.getAttribute('aria-disabled')) {
            btn.click();
            return 'clicked_reply';
        }
    }
    
    // Method 2: Post button
    var buttons = document.querySelectorAll('[role="button"]');
    for (var i = 0; i < buttons.length; i++) {
        var text = (buttons[i].innerText || '').trim();
        if (text === 'Post' && !buttons[i].getAttribute('aria-disabled')) {
            buttons[i].click();
            return 'clicked_post';
        }
    }
    
    // Method 3: Create button
    var createBtn = document.querySelector('svg[aria-label="Create"]');
    if (createBtn) {
        var btn = createBtn.closest('[role="button"]');
        if (btn && !btn.getAttribute('aria-disabled')) {
            btn.click();
            return 'clicked_create';
        }
    }
    
    return 'submit_not_found';
})();
```

### Expand Composer
```javascript
// ✅ WORKING
document.querySelector('svg[aria-label="Expand composer"]')
```

---

## Extract Comments from Thread

```javascript
// ✅ WORKING
(function() {
    var comments = [];
    var containers = document.querySelectorAll('[data-pressable-container="true"]');
    
    // Skip first container (main post), get comments
    for (var i = 1; i < Math.min(containers.length, 51); i++) {
        var el = containers[i];
        
        // Username
        var userLink = el.querySelector('a[href*="/@"]');
        var username = userLink ? userLink.href.split('/@').pop().split('/')[0].split('?')[0] : '';
        
        // Text content
        var textEl = el.querySelector('[dir="auto"] span');
        var text = textEl ? textEl.innerText : '';
        
        // Timestamp
        var timeEl = el.querySelector('time');
        var timestamp = timeEl ? timeEl.getAttribute('datetime') : '';
        
        // Post ID from link
        var postLink = el.querySelector('a[href*="/post/"]');
        var postId = '';
        if (postLink) {
            var match = postLink.href.match(/\/post\/([A-Za-z0-9_-]+)/);
            postId = match ? match[1] : 'comment_' + i;
        } else {
            postId = 'comment_' + i;
        }
        
        if (username && text) {
            comments.push({
                comment_id: postId,
                username: username,
                text: text.substring(0, 500),
                timestamp: timestamp
            });
        }
    }
    
    return JSON.stringify(comments);
})();
```

---

## Navigation

### Click Back Button
```javascript
// ✅ WORKING
(function() {
    var backBtn = document.querySelector('svg[aria-label="Back"]');
    if (backBtn) {
        var btn = backBtn.closest('[role="button"]') || backBtn.parentElement;
        if (btn) {
            btn.click();
            return 'clicked_back';
        }
    }
    // Fallback: use browser history
    window.history.back();
    return 'history_back';
})();
```

### Close Modal
```javascript
// ✅ WORKING
var closeBtn = document.querySelector('svg[aria-label="Close"]');
if (closeBtn) {
    var btn = closeBtn.closest('[role="button"]') || closeBtn.parentElement;
    btn.click();
}
```

---

## Scrolling

### Scroll to Load More Content
```javascript
// ✅ WORKING
(async function() {
    for (var i = 0; i < 3; i++) {
        window.scrollTo(0, document.body.scrollHeight);
        await new Promise(r => setTimeout(r, 800));
    }
    window.scrollTo(0, 0);
    return 'scrolled';
})();
```

---

## Activity/Notifications

### Get Notifications
```javascript
// ✅ WORKING
(function() {
    var notifications = [];
    var items = document.querySelectorAll('[role="listitem"], article');
    
    items.forEach(function(item, idx) {
        if (idx >= 20) return;
        
        var textEl = item.querySelector('span, [dir="auto"]');
        var userEl = item.querySelector('a[href*="/@"]');
        var timeEl = item.querySelector('time');
        
        if (textEl) {
            notifications.push({
                text: textEl.innerText.substring(0, 200),
                user: userEl ? userEl.href.split('/@').pop().split('/')[0] : null,
                time: timeEl ? timeEl.getAttribute('datetime') : null
            });
        }
    });
    
    return JSON.stringify(notifications);
})();
```

---

## DM Conversations

### Get Conversation List
```javascript
// ✅ WORKING
(function() {
    var conversations = [];
    var items = document.querySelectorAll('[role="listitem"], [data-pressable-container="true"]');
    
    items.forEach(function(item, idx) {
        if (idx >= 20) return;
        
        var nameEl = item.querySelector('[dir="ltr"] span, a[href*="/@"]');
        var previewEl = item.querySelector('[dir="auto"]');
        var timeEl = item.querySelector('time');
        
        if (nameEl) {
            conversations.push({
                name: nameEl.innerText,
                preview: previewEl ? previewEl.innerText.substring(0, 100) : '',
                time: timeEl ? timeEl.getAttribute('datetime') : null
            });
        }
    });
    
    return JSON.stringify(conversations);
})();
```

---

## Extract Full Post Context (for AI Replies)

```javascript
// ✅ WORKING
(function() {
    var result = {post: {}, images: [], comments: []};
    var containers = document.querySelectorAll('[data-pressable-container="true"]');
    
    if (containers.length > 0) {
        var main = containers[0];
        
        // Username
        var userLink = main.querySelector('a[href*="/@"]');
        result.post.username = userLink ? userLink.href.split('/@').pop().split('/')[0] : '';
        
        // Text content (skip UI elements)
        var texts = [];
        main.querySelectorAll('[dir="auto"] span').forEach(function(el) {
            var t = el.innerText.trim();
            if (t && t.length > 3 && texts.indexOf(t) === -1 && !t.includes('View activity')) {
                texts.push(t);
            }
        });
        result.post.text = texts.slice(1, 5).join(' ');
        
        // Image alt text
        main.querySelectorAll('img').forEach(function(img) {
            var w = img.naturalWidth || img.width;
            if (w > 100 && img.alt && !img.alt.includes('profile')) {
                result.images.push(img.alt);
            }
        });
    }
    
    // Get comments (skip main post at index 0)
    for (var i = 1; i < Math.min(containers.length, 5); i++) {
        var c = containers[i];
        var uLink = c.querySelector('a[href*="/@"]');
        var uname = uLink ? uLink.href.split('/@').pop().split('/')[0] : '';
        var allText = [];
        c.querySelectorAll('[dir="auto"] span').forEach(function(el) {
            var t = el.innerText.trim();
            if (t && t.length > 2 && allText.indexOf(t) === -1) allText.push(t);
        });
        if (uname) result.comments.push({u: uname, t: allText.join(' ').substring(0, 150)});
    }
    
    return JSON.stringify(result);
})();
```

---

## Selector Patterns Summary

| Element | Primary Selector | Fallback |
|---------|-----------------|----------|
| Nav Icons | `svg[aria-label="X"]` | - |
| Post Container | `[data-pressable-container="true"]` | `article` |
| Post Links | `a[href*="/post/"]` | - |
| User Links | `a[href*="/@"]` | - |
| Text Input | `[role="textbox"][contenteditable="true"]` | `[contenteditable="true"]` |
| Submit Button | 2nd `svg[aria-label="Reply"]` | Button text "Post" |
| Close Modal | `svg[aria-label="Close"]` | - |
| Back Button | `svg[aria-label="Back"]` | `window.history.back()` |
| Text Content | `[dir="auto"] span` | `[dir="ltr"] span` |

---

## Known Issues

1. **Contenteditable input** - Must use `innerText` and `InputEvent`, not `value`
2. **Double Reply buttons** - First is action button, second is submit
3. **Post container** - Uses `[data-pressable-container="true"]` not `article`
4. **URL parsing** - Username in URLs uses `/@username` format
5. **Rate limiting** - Threads detects automation; add delays between actions

---

## Usage Example

```python
from automation.threads_selectors import SELECTORS, JS, URLS

# Navigate to profile
safari_navigate(URLS.profile("the_isaiah_dupree"))

# Check login
result = safari_js(JS.check_login_status())

# Get comments from thread
comments = json.loads(safari_js(JS.extract_comments(50)))

# Reply to thread
safari_js(JS.click_reply_button())
safari_js(JS.type_in_composer("Great thread!"))
safari_js(JS.submit_reply())
```

---

**Document Owner:** Engineering Team
