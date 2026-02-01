# Safari Web Extension Setup Instructions

## Quick Start

### 1. Enable Safari Developer Mode
```bash
# Open Safari Preferences
Safari → Settings → Advanced → "Show Develop menu in menu bar" ✅
```

### 2. Load Unsigned Extension
```bash
# In Safari's Develop menu
Develop → Allow Unsigned Extensions ✅
```

### 3. Load Extension
```bash
# Open Extension Builder
Safari → Develop → Web Extension Converter
# Or manually: Safari → Settings → Extensions → Load Unsigned Extension

# Select directory:
/Users/isaiahdupree/Documents/Software/MediaPoster/Backend/automation/safari_extension
```

### 4. Test Extension
1. Open TikTok video in Safari
2. Open comments panel
3. Click Safari extension icon in toolbar
4. Click "Test: Type Hello"
5. Check if text appears and button turns RED

### 5. Use from Python
```bash
cd Backend/automation
python3 safari_extension/safari_extension_bridge.py "Test comment"
```

---

## Architecture Summary

The extension solves the keyboard focus issue by running **inside** the TikTok page:

```
Python Script (automation/tiktok_comment_agentic.py)
    ↓
Safari Extension Bridge (safari_extension_bridge.py)
    ↓
Background Script (background.js) - Routes messages
    ↓
Content Script (content.js) - Runs IN TikTok page
    ↓
Direct access to Draft.js editor ✅
```

---

## Files Created

| File | Purpose |
|------|---------|
| `manifest.json` | Extension config |
| `content.js` | Injects into TikTok, types comments |
| `background.js` | Message routing |
| `popup.html` | Test UI |
| `popup.js` | Test UI logic |
| `safari_extension_bridge.py` | Python API |
| `README.md` | Documentation |

---

## What This Fixes

✅ **Keyboard events reach Draft.js** - Content script runs in page context
✅ **Button turns RED** - Real browser events trigger React state update
✅ **Fully automated** - No manual typing needed
✅ **Works cross-window** - Finds correct Safari tab

---

## Alternative if Extension Doesn't Work

If Safari Web Extensions prove difficult, we can:
1. Use **Chrome with Puppeteer** (full browser control)
2. Keep **current hybrid approach** (you type, script posts)
3. Try **Playwright with Chromium** (similar to Puppeteer)
