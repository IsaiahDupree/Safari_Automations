# Sora Selectors Reference

**Last Updated:** January 30, 2026  
**Status:** Known Working Selectors  
**Source:** `sora_full_automation.py`, `sora_controller.py`

---

## Overview

Sora (sora.chatgpt.com) uses **Radix UI** components with dynamic IDs. This document lists all known working selectors extracted from the automation codebase.

**Important Notes:**
- Radix UI generates dynamic IDs like `#radix-:r5:` - don't rely on these
- Use role-based and text-based selectors instead
- Always dispatch full mouse events for Radix components to recognize clicks

---

## Navigation URLs

| Page | URL |
|------|-----|
| Home/Explore | `https://sora.chatgpt.com/explore` |
| Library | `https://sora.chatgpt.com/library` |
| Drafts (All Videos) | `https://sora.chatgpt.com/drafts` |
| Activity | `https://sora.chatgpt.com/activity` |
| Single Video | `https://sora.chatgpt.com/p/{video_id}` |

---

## Login Detection

### Check if Logged In
```javascript
// Working: Profile button presence
document.querySelector('[aria-label=Profile], [data-testid=profile]')

// Working: Check for login button absence
Array.from(document.querySelectorAll('button')).find(b => 
    b.textContent.toLowerCase().includes('log in') || 
    b.textContent.toLowerCase().includes('sign in')
)

// Working: User avatar check
document.querySelector('[data-testid="user-avatar"], [class*="avatar"], [class*="profile"]')
```

---

## Prompt Input

### Textarea (Main Prompt Input)
```javascript
// ✅ WORKING - Primary selector
document.querySelector('textarea')

// ✅ WORKING - Alternative selectors
document.querySelector('[contenteditable="true"]')
document.querySelector('input[type="text"][placeholder*="prompt"]')
```

### Setting Prompt Value (React-compatible)
```javascript
// ✅ WORKING - Must use native setter for React state sync
var ta = document.querySelector('textarea');
var nativeSetter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype, 'value'
).set;
nativeSetter.call(ta, 'Your prompt here');
ta.dispatchEvent(new Event('input', { bubbles: true }));
```

---

## Settings & Usage

### Settings Button (Sidebar)
```javascript
// ✅ WORKING
document.querySelector('button[aria-label="Settings"]')

// Click with full mouse events for Radix UI
['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(type => {
    settingsBtn.dispatchEvent(new MouseEvent(type, {
        bubbles: true, cancelable: true, view: window
    }));
});
```

### Settings Menu Item (After clicking Settings button)
```javascript
// ✅ WORKING - Find "Settings" in dropdown menu
var menuItems = document.querySelectorAll('[role=menuitem]');
for (var i = 0; i < menuItems.length; i++) {
    if (menuItems[i].textContent.trim() === 'Settings') {
        menuItems[i].click();
    }
}
```

### Usage Tab (In Settings Dialog)
```javascript
// ✅ WORKING - Find "Usage" button in dialog
var dialog = document.querySelector('[role=dialog]');
var btns = dialog.querySelectorAll('button');
for (var i = 0; i < btns.length; i++) {
    if (btns[i].textContent.trim() === 'Usage') {
        btns[i].click();
    }
}
```

### Extract Usage Information
```javascript
// ✅ WORKING - Parse usage text from dialog
var text = document.querySelector('[role=dialog]').innerText;

// "27 video gens left"
var gensMatch = text.match(/(\d+)\s*video\s*gens?\s*left/i);

// "27 free"
var freeMatch = text.match(/(\d+)\s*free/i);

// "0 paid"  
var paidMatch = text.match(/(\d+)\s*paid/i);

// "More available on Jan 26"
var dateMatch = text.match(/available\s+on\s+([A-Za-z]+\s*\d+)/i);
```

### Close Dialog (Done Button)
```javascript
// ✅ WORKING
Array.from(document.querySelectorAll('button')).find(b => 
    b.textContent.trim().toLowerCase() === 'done'
).click();
```

---

## Characters Tab

### Click Characters Tab
```javascript
// ✅ WORKING
var btns = document.querySelectorAll('button');
for (var i = 0; i < btns.length; i++) {
    if (btns[i].textContent.trim() === 'Characters') {
        btns[i].click();
    }
}
```

### Select a Character by Name
```javascript
// ✅ WORKING - After Characters tab is open
var btns = document.querySelectorAll('button');
for (var i = 0; i < btns.length; i++) {
    if (btns[i].textContent.trim() === 'isaiahdupree') {  // character name
        btns[i].click();
    }
}
```

---

## Styles Tab

### Click Styles Tab
```javascript
// ✅ WORKING
var btns = document.querySelectorAll('button');
for (var i = 0; i < btns.length; i++) {
    var txt = btns[i].textContent.trim();
    if (txt === 'Styles' || txt === 'StylesNEW') {
        btns[i].click();
    }
}
```

### Select a Style by Name
```javascript
// ✅ WORKING - After Styles tab is open
var btns = document.querySelectorAll('button');
for (var i = 0; i < btns.length; i++) {
    if (btns[i].textContent.trim().toLowerCase() === 'cinematic') {  // style name
        btns[i].click();
    }
}
```

---

## Duration Control

### Click Duration Button (Opens Menu)
```javascript
// ✅ WORKING - Button shows current duration like "15s"
var btns = document.querySelectorAll('button');
for (var i = 0; i < btns.length; i++) {
    var txt = btns[i].textContent.trim();
    if (txt.match(/^\d+s$/)) {  // matches "10s", "15s", "25s"
        btns[i].click();
    }
}
```

### Select Duration Option
```javascript
// ✅ WORKING - After opening duration menu
var options = document.querySelectorAll(
    '[role=menuitem], [role=option], [role=menuitemradio], [data-radix-collection-item]'
);
for (var i = 0; i < options.length; i++) {
    if (options[i].textContent.includes('15 seconds')) {  // or 10, 25
        options[i].click();
    }
}
```

**Valid Durations:** 10, 15, 25 seconds

---

## Aspect Ratio Control

### Click Aspect Ratio Button (Opens Menu)
```javascript
// ✅ WORKING
var btns = document.querySelectorAll('button');
for (var i = 0; i < btns.length; i++) {
    var txt = btns[i].textContent.trim();
    if (txt === 'Portrait' || txt === 'Landscape') {
        btns[i].click();
    }
}
```

### Select Aspect Ratio Option
```javascript
// ✅ WORKING
var options = document.querySelectorAll(
    '[role=menuitem], [role=option], [role=menuitemradio], [data-radix-collection-item]'
);
for (var i = 0; i < options.length; i++) {
    if (options[i].textContent.trim() === 'Portrait') {  // or 'Landscape'
        options[i].click();
    }
}
```

**Valid Ratios:**
- `Portrait` (9:16)
- `Landscape` (16:9)

---

## Video Generation

### Create Video Button
```javascript
// ✅ WORKING
var btns = document.querySelectorAll('button');
for (var i = 0; i < btns.length; i++) {
    var txt = btns[i].textContent.trim();
    if (txt === 'Create video' || txt === 'Create') {
        if (!btns[i].disabled) {
            btns[i].click();
        }
    }
}
```

### Generate Button (Alternative)
```javascript
// ✅ WORKING
document.querySelector('button[class*="generate"]') ||
document.querySelector('button[class*="create"]') ||
document.querySelector('button[type="submit"]')
```

---

## Queue & Status

### Get Queue Count (Generating Videos)
```javascript
// ✅ WORKING - Check for generating indicators
document.querySelectorAll('[data-status=generating], .generating, [aria-label*=generating]')

// ✅ WORKING - Check Activity badge
var activityBadge = document.querySelector('[aria-label=Activity] span, button[aria-label=Activity] span');
if (activityBadge && activityBadge.textContent.match(/\d+/)) {
    return activityBadge.textContent.match(/\d+/)[0];
}
```

### Progress Indicators
```javascript
// ✅ WORKING
document.querySelector('[class*="progress"]')
document.querySelector('[class*="loading"], [class*="spinner"]')
document.querySelector('[role="progressbar"]')

// Progress percentage from page text
var percentMatch = document.body.innerText.match(/(\d+)%/);
```

---

## Video Elements

### Get Video Source URL
```javascript
// ✅ WORKING - Direct video element
var video = document.querySelector('video');
video.src || (video.querySelector('source') ? video.querySelector('source').src : '')

// ✅ WORKING - Video with source
document.querySelector('video[src]').src
document.querySelector('video source[src]').src
```

### Get All Videos on Page (Drafts)
```javascript
// ✅ WORKING
var videos = document.querySelectorAll('video');
var result = [];
videos.forEach(function(v, i) {
    var src = v.src || (v.querySelector('source') ? v.querySelector('source').src : '');
    if (src) {
        result.push({
            index: i,
            video_src: src
        });
    }
});
```

### Video Cards
```javascript
// ✅ WORKING
document.querySelectorAll('[data-video-id], .video-card, [class*=video]')
document.querySelectorAll('div[class*=card], div[class*=video], [class*=thumbnail]')
```

---

## Download

### Download Button
```javascript
// ✅ WORKING
document.querySelector('[class*="download"]') ||
document.querySelector('button[download]') ||
document.querySelector('a[download]') ||
Array.from(document.querySelectorAll('button')).find(b =>
    b.textContent.toLowerCase().includes('download')
)
```

---

## Error Detection

### Error Messages
```javascript
// ✅ WORKING
document.querySelector('[class*="error"]')
```

---

## Selector Patterns Summary

| Element | Primary Selector | Fallback |
|---------|-----------------|----------|
| Prompt Input | `textarea` | `[contenteditable="true"]` |
| Settings Button | `button[aria-label="Settings"]` | - |
| Menu Items | `[role=menuitem]` | - |
| Dialog | `[role=dialog]` | - |
| Duration Options | `[role=menuitemradio]` | `[data-radix-collection-item]` |
| Create Button | Button with text "Create video" | `button[type="submit"]` |
| Video Element | `video` | `video[src]` |
| Progress | `[role="progressbar"]` | `[class*="progress"]` |

---

## Known Issues

1. **Dynamic Radix IDs** - Never use IDs like `#radix-:r5:` - they change on page reload
2. **React State** - Must use native setter + input event for textarea
3. **Radix Clicks** - Must dispatch full mouse event sequence (pointerdown → click)
4. **Drafts Pagination** - Only ~13 videos load initially, must scroll to load more

---

## Usage Example

```python
from automation.sora_full_automation import SoraFullAutomation

sora = SoraFullAutomation()

# Check usage
usage = sora.get_usage()
print(f"Videos left: {usage.get('video_gens_left')}")

# Generate video
sora.navigate_to_explore()
sora.select_character('isaiahdupree')
sora.set_duration(15)
sora.set_aspect_ratio('Portrait')
sora.set_prompt('A person walking through a forest')
sora.click_create_video()
```

---

**Document Owner:** Engineering Team
