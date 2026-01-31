# Instagram Selectors Reference

**Last Updated:** January 30, 2026  
**Status:** Known Working Selectors  
**Source:** `instagram_selectors.py`, `safari_instagram_poster.py`, `instagram_feed_auto_commenter.py`

---

## Overview

Instagram web uses React with dynamic class names. This document lists all verified working selectors extracted from the automation codebase.

**Important Notes:**
- Class names can change with Instagram updates
- Prefer `aria-label` and semantic selectors over class names
- Always dispatch input events after setting values

---

## Navigation URLs

| Page | URL |
|------|-----|
| Home/Feed | `https://www.instagram.com/` |
| Explore | `https://www.instagram.com/explore/` |
| Reels | `https://www.instagram.com/reels/` |
| Direct Messages | `https://www.instagram.com/direct/inbox/` |
| Activity | `https://www.instagram.com/accounts/activity/` |
| Profile | `https://www.instagram.com/{username}/` |
| Post | `https://www.instagram.com/p/{shortcode}/` |
| Reel | `https://www.instagram.com/reel/{shortcode}/` |

---

## Navigation Icons (Sidebar)

| Element | Selector | Status |
|---------|----------|--------|
| Home | `svg[aria-label="Home"]` | ✅ Working |
| Search | `svg[aria-label="Search"]` | ✅ Working |
| Explore | `svg[aria-label="Explore"]` | ✅ Working |
| Reels | `svg[aria-label="Reels"]` | ✅ Working |
| Messages | `svg[aria-label="Messages"]` | ✅ Working |
| Notifications | `svg[aria-label="Notifications"]` | ✅ Working |
| New Post | `svg[aria-label="New post"]` | ✅ Working |
| Profile | `svg[aria-label="Profile"]` | ✅ Working |
| Settings | `svg[aria-label="Settings"]` | ✅ Working |

### Usage Example
```javascript
// Click Home icon
var homeIcon = document.querySelector('svg[aria-label="Home"]');
var btn = homeIcon.closest('a') || homeIcon.parentElement;
btn.click();
```

---

## Login Detection

### Check if Logged In
```javascript
// ✅ WORKING - Multiple indicators
(function() {
    var indicators = [
        'svg[aria-label="Home"]',           // Home icon in sidebar
        'img[alt*="profile picture"]',       // Profile picture
        'span[aria-label*="Profile"]',       // Profile label
        'a[href*="/direct/"]'                // DM link
    ];
    for (var i = 0; i < indicators.length; i++) {
        if (document.querySelector(indicators[i])) return 'logged_in';
    }
    return 'not_logged_in';
})();
```

### Check for Login Form
```javascript
// ✅ WORKING
document.querySelector('input[name="username"]')
document.querySelector('form input[name="username"]')
```

---

## Post Actions

| Action | Selector | Status |
|--------|----------|--------|
| Like | `svg[aria-label="Like"]` | ✅ Working |
| Unlike | `svg[aria-label="Unlike"]` | ✅ Working |
| Comment | `svg[aria-label="Comment"]` | ✅ Working |
| Share | `svg[aria-label="Share"]` | ✅ Working |
| Save | `svg[aria-label="Save"]` | ✅ Working |
| More Options | `svg[aria-label="More options"]` | ✅ Working |

### Click Action Button
```javascript
// ✅ WORKING - Click Like button
var likeIcon = document.querySelector('svg[aria-label="Like"]');
if (likeIcon) {
    var btn = likeIcon.closest('button') || 
              likeIcon.closest('[role="button"]') || 
              likeIcon.parentElement;
    btn.click();
}
```

---

## Content Containers

| Element | Selector | Status |
|---------|----------|--------|
| Post Article | `article` | ✅ Working |
| Post Link | `a[href*="/p/"], a[href*="/reel/"]` | ✅ Working |
| User Link | `a[href^="/"][href$="/"]` | ✅ Working |
| Caption Text | `span[dir="auto"]` | ✅ Working |
| Dialog/Modal | `[role="dialog"]` | ✅ Working |

### Get Feed Posts
```javascript
// ✅ WORKING
(function() {
    var posts = [];
    var articles = document.querySelectorAll('article');
    
    articles.forEach(function(article, i) {
        if (i < 5) {
            // Get username
            var userLink = article.querySelector('a[href^="/"][href$="/"]');
            var username = '';
            if (userLink) {
                var match = userLink.href.match(/instagram\.com\/([^\/\?]+)/);
                username = match ? match[1] : '';
            }
            
            // Get post URL
            var postLink = article.querySelector('a[href*="/p/"], a[href*="/reel/"]');
            var postUrl = postLink ? postLink.href : '';
            
            // Get caption
            var captionEl = article.querySelector('span[dir="auto"]');
            var caption = captionEl ? captionEl.innerText.substring(0, 200) : '';
            
            if (postUrl) {
                posts.push({
                    index: i,
                    username: username,
                    postUrl: postUrl,
                    caption: caption
                });
            }
        }
    });
    
    return JSON.stringify(posts);
})();
```

---

## Comment Input

### Textarea Selectors (Multiple Fallbacks)
```javascript
// ✅ WORKING - Try in order
var selectors = [
    'textarea[placeholder*="comment" i]',
    'textarea[aria-label*="comment" i]',
    'textarea[placeholder*="Add a comment" i]',
    'form textarea'
];

for (var i = 0; i < selectors.length; i++) {
    var input = document.querySelector(selectors[i]);
    if (input && input.offsetParent !== null) {  // Check visible
        input.focus();
        input.click();
        break;
    }
}
```

### Type Comment Text
```javascript
// ✅ WORKING
(function() {
    var input = document.activeElement;
    if (input && input.tagName === 'TEXTAREA') {
        input.value = 'Your comment here';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return 'typed';
    }
    
    // Fallback: find textarea if not focused
    var textarea = document.querySelector('textarea[placeholder*="comment" i]');
    if (textarea) {
        textarea.focus();
        textarea.value = 'Your comment here';
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        return 'typed';
    }
    
    return 'not_found';
})();
```

### Submit Comment (Post Button)
```javascript
// ✅ WORKING
(function() {
    // Find Post button
    var buttons = document.querySelectorAll('button[type="submit"], div[role="button"]');
    for (var i = 0; i < buttons.length; i++) {
        var text = (buttons[i].innerText || '').trim().toLowerCase();
        if (text === 'post' && !buttons[i].disabled) {
            buttons[i].click();
            return 'clicked_post';
        }
    }
    
    // Fallback: find submit in form
    var input = document.activeElement;
    if (input && input.tagName === 'TEXTAREA') {
        var form = input.closest('form');
        if (form) {
            var submitBtn = form.querySelector('button[type="submit"]');
            if (submitBtn && !submitBtn.disabled) {
                submitBtn.click();
                return 'clicked_submit';
            }
        }
    }
    
    return 'not_found';
})();
```

---

## Direct Messages

### DM Navigation
```javascript
// ✅ WORKING
document.querySelector('a[href*="/direct/inbox"]')
document.querySelector('a[href*="/direct/t/"]')  // Conversation link
```

### Message Input
```javascript
// ✅ WORKING - Two possible formats
document.querySelector('textarea[placeholder*="Message"]')
document.querySelector('div[contenteditable="true"][role="textbox"]')
```

### Get Conversations
```javascript
// ✅ WORKING
(function() {
    var conversations = [];
    
    // Strategy 1: Direct conversation links
    var links = document.querySelectorAll('a[href*="/direct/t/"]');
    
    // Strategy 2: Profile pictures in DM list
    if (links.length === 0) {
        var imgs = document.querySelectorAll('img[alt*="profile picture"]');
        imgs.forEach(function(img) {
            var parent = img.closest('div[role="button"]') || img.closest('a');
            if (parent) links.push(parent);
        });
    }
    
    links.forEach(function(element, index) {
        if (index >= 20) return;
        
        // Extract username from profile picture alt
        var usernameEl = element.querySelector('img[alt*="profile"]');
        var username = 'Unknown';
        if (usernameEl) {
            username = (usernameEl.getAttribute('alt') || '')
                .replace("'s profile picture", '').trim();
        }
        
        // Extract last message preview
        var spans = element.querySelectorAll('span[dir="auto"], span');
        var lastMessage = '';
        for (var i = spans.length - 1; i >= 0; i--) {
            var text = spans[i].textContent.trim();
            if (text && text !== username && text.length > 0 && text.length < 200) {
                lastMessage = text;
                break;
            }
        }
        
        // Check unread status
        var isUnread = element.innerHTML.includes('rgb(0, 149, 246)') ||
                      element.innerHTML.includes('font-weight: 600');
        
        conversations.push({
            index: index,
            username: username,
            lastMessage: lastMessage,
            isUnread: isUnread
        });
    });
    
    return JSON.stringify(conversations);
})();
```

---

## Modal/Dialog

### Close Modal
```javascript
// ✅ WORKING
(function() {
    // Method 1: Close button
    var closeBtn = document.querySelector('svg[aria-label="Close"]');
    if (closeBtn) {
        var btn = closeBtn.closest('button') || 
                  closeBtn.closest('[role="button"]') || 
                  closeBtn.parentElement;
        if (btn) {
            btn.click();
            return 'closed_modal';
        }
    }
    
    // Method 2: Press Escape
    document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape', 
        code: 'Escape', 
        keyCode: 27
    }));
    return 'escape_pressed';
})();
```

### Dialog Container
```javascript
// ✅ WORKING
document.querySelector('[role="dialog"]')
document.querySelector('[role="dialog"] article')  // Post in modal
```

---

## Notifications / Activity

### Notification Items
```javascript
// ✅ WORKING
document.querySelectorAll('div[role="listitem"]')
document.querySelectorAll('a[href*="/@"]')
```

---

## Notes (Stories Circle Notes)

### Get Notes from DM Inbox
```javascript
// ✅ WORKING
(function() {
    var notes = [];
    var noteItems = document.querySelectorAll('ul > li');
    
    noteItems.forEach(function(item, index) {
        var noteContainer = item.querySelector('div.x1vjfegm');
        if (!noteContainer) return;
        
        var textEl = noteContainer.querySelector('div[dir="auto"], span[dir="auto"]');
        var noteText = textEl ? textEl.textContent.trim() : '';
        
        if (!noteText || noteText === 'Note...' || noteText === 'Your note') return;
        
        var imgEl = item.querySelector('img[alt*="profile"]');
        var username = imgEl ? 
            (imgEl.getAttribute('alt') || '').replace("'s profile picture", '').trim() 
            : 'Unknown';
        
        notes.push({
            username: username,
            content: noteText.substring(0, 60),
            isOwn: index === 0
        });
    });
    
    return JSON.stringify(notes);
})();
```

---

## Scrolling

### Scroll Feed
```javascript
// ✅ WORKING
window.scrollBy(0, window.innerHeight * 0.8);
```

---

## Extract Post Context (Full)

```javascript
// ✅ WORKING - Complete context extraction
(function() {
    var result = {post: {}, comments: []};
    
    // Get article (modal or direct)
    var article = document.querySelector('article');
    if (!article) {
        var dialog = document.querySelector('[role="dialog"]');
        article = dialog ? dialog.querySelector('article') || dialog : null;
    }
    
    if (article) {
        // Username
        var userLink = article.querySelector('a[href^="/"][href$="/"]');
        if (userLink) {
            var match = userLink.href.match(/instagram\.com\/([^\/\?]+)/);
            result.post.username = match ? match[1] : '';
        }
        
        // Caption
        var captionSpans = article.querySelectorAll('span[dir="auto"]');
        var captions = [];
        captionSpans.forEach(function(span) {
            var text = span.innerText.trim();
            if (text && text.length > 10 && captions.indexOf(text) === -1) {
                captions.push(text);
            }
        });
        result.post.caption = captions.slice(0, 3).join(' ');
        
        // Image alt text (AI descriptions)
        var images = article.querySelectorAll('img[alt]');
        var alts = [];
        images.forEach(function(img) {
            if (img.alt && !img.alt.includes('profile') && img.alt.length > 5) {
                alts.push(img.alt);
            }
        });
        result.post.imageAlt = alts.slice(0, 3);
        
        // Comments
        var commentElements = article.querySelectorAll('ul li');
        commentElements.forEach(function(li, i) {
            if (i < 5 && i > 0) {  // Skip first (usually caption)
                var uLink = li.querySelector('a[href^="/"]');
                var uname = '';
                if (uLink) {
                    var m = uLink.href.match(/instagram\.com\/([^\/\?]+)/);
                    uname = m ? m[1] : '';
                }
                var textSpan = li.querySelector('span[dir="auto"]');
                var text = textSpan ? textSpan.innerText.substring(0, 150) : '';
                
                if (uname && text) {
                    result.comments.push({u: uname, t: text});
                }
            }
        });
    }
    
    return JSON.stringify(result);
})();
```

---

## Selector Patterns Summary

| Element | Primary Selector | Fallback |
|---------|-----------------|----------|
| Nav Icons | `svg[aria-label="X"]` | - |
| Post Article | `article` | `[role="dialog"] article` |
| Post Links | `a[href*="/p/"]` | `a[href*="/reel/"]` |
| Comment Input | `textarea[placeholder*="comment" i]` | `form textarea` |
| Post Button | Button with text "Post" | `button[type="submit"]` |
| Close Modal | `svg[aria-label="Close"]` | Escape key |
| Profile Picture | `img[alt*="profile picture"]` | - |
| DM Conversations | `a[href*="/direct/t/"]` | - |
| Message Input | `textarea[placeholder*="Message"]` | `div[contenteditable="true"]` |

---

## Known Issues

1. **Dynamic class names** - Instagram changes class names frequently; use aria-labels
2. **Rate limiting** - Instagram detects automation; add delays between actions
3. **Comment input** - May need to focus + click before typing
4. **Modal detection** - Post can be in feed or modal; check both
5. **Unread indicators** - Use CSS color/font-weight inspection

---

## Usage Example

```python
from automation.instagram_selectors import SELECTORS, JS, URLS

# Navigate to feed
safari_navigate(URLS.HOME)

# Check login
result = safari_js(JS.check_login())

# Get feed posts
posts = json.loads(safari_js(JS.get_feed_posts(5)))

# Comment on first post
safari_js(JS.click_comment_button(0))
safari_js(JS.focus_comment_input())
safari_js(JS.type_comment("Great post!"))
safari_js(JS.submit_comment())
```

---

**Document Owner:** Engineering Team
