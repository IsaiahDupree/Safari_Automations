# Safari Web Extension Setup Guide

This guide will help you install and configure the Safari Web Extension for TikTok comment automation.

## Why This Extension?

TikTok uses **Draft.js** for its comment input, which requires real browser keyboard events to update React's internal state. System-level keyboard simulation (AppleScript, pyautogui, etc.) doesn't work because it doesn't reach Safari's focused web element.

The Safari Web Extension runs **inside** the TikTok page context, allowing it to:
- ✅ Dispatch proper `beforeinput` events that Draft.js recognizes
- ✅ Directly manipulate the DOM and React state
- ✅ Bypass macOS keyboard focus limitations

## Prerequisites

- macOS (Safari Web Extensions only work on macOS)
- Safari browser
- Xcode Command Line Tools (for building the extension)

## Installation Steps

### 1. Enable Safari Developer Menu

1. Open Safari
2. Go to **Safari → Settings → Advanced**
3. Check **"Show Develop menu in menu bar"**

### 2. Build the Extension

Safari Web Extensions need to be built using Xcode. However, for development/testing, you can load it as an unsigned extension:

#### Option A: Load as Unsigned Extension (Development)

1. Open Safari
2. Go to **Develop → Allow Unsigned Extensions**
3. Navigate to the extension directory:
   ```bash
   cd Backend/automation/safari_extension
   ```
4. In Safari, go to **Develop → Show Extension Builder**
5. Click **"+"** and select the `safari_extension` folder
6. Click **"Run"** to load the extension

#### Option B: Build with Xcode (Production)

1. Open Xcode
2. Create a new project: **File → New → Project → macOS → App**
3. Name it "TikTokCommentExtension"
4. Copy the extension files into the project
5. Add the extension target:
   - **File → New → Target → Safari Extension**
   - Select "Safari Web Extension"
6. Build and run the app
7. Enable the extension in **Safari → Settings → Extensions**

### 3. Enable the Extension

1. Open Safari
2. Go to **Safari → Settings → Extensions**
3. Find **"TikTok Comment Automation"**
4. Check the box to enable it
5. Make sure **"Allow Unsigned Extensions"** is enabled (if using Option A)

### 4. Grant Permissions

1. Navigate to `https://www.tiktok.com`
2. Safari will prompt you to allow the extension
3. Click **"Allow"**

### 5. Verify Installation

1. Navigate to any TikTok video
2. Open the extension popup (click the extension icon in Safari toolbar)
3. Click **"Check Status"** - it should show the current page status
4. Click **"Test Comment"** - it should post a test comment

## Using from Python

Once the extension is installed, you can use it from your Python automation scripts:

```python
from automation.safari_extension_bridge import SafariExtensionBridge

# Create bridge
bridge = SafariExtensionBridge()

# Check if extension is loaded
if bridge.check_extension_loaded():
    # Post a comment
    result = bridge.post_comment("Hello from automation! 🎉")
    print(result)
else:
    print("Extension not loaded - make sure it's installed and enabled")
```

The `TikTokEngagement` class automatically uses the extension if available:

```python
from automation.tiktok_engagement import TikTokEngagement

engagement = TikTokEngagement()
await engagement.start("https://www.tiktok.com/@username/video/1234567890")
result = await engagement.post_comment("My automated comment!")
print(result)
```

## How It Works

### Architecture

```
┌─────────────────┐
│ Python Script   │  Uses AppleScript to inject JavaScript
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Safari Extension│  Content script runs in TikTok page
│  (Content.js)   │  Exposes window.tiktokAutomation API
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ TikTok Page     │  Draft.js editor receives beforeinput events
│  (Draft.js)     │  React state updates ✅
└─────────────────┘
```

### Key Implementation Details

1. **Content Script** (`content.js`):
   - Runs in TikTok page context
   - Exposes `window.tiktokAutomation` global API
   - Uses `beforeinput` events with `inputType: 'insertText'`
   - Inserts text into DOM and triggers React state updates

2. **Python Bridge** (`safari_extension_bridge.py`):
   - Uses AppleScript to inject JavaScript
   - Calls `window.tiktokAutomation` functions
   - Returns results as JSON

3. **Integration** (`tiktok_engagement.py`):
   - Automatically tries extension first
   - Falls back to AppleScript if extension not available
   - Checks if Post button is active (indicates success)

## Troubleshooting

### Extension Not Loading

1. **Check Safari Settings**:
   - Safari → Settings → Extensions
   - Make sure extension is enabled
   - Check "Allow Unsigned Extensions" (if using development mode)

2. **Check Permissions**:
   - Navigate to TikTok
   - Safari should prompt for permission
   - Check Safari → Settings → Websites → Extensions

3. **Check Console**:
   - Open Safari Web Inspector (Develop → Show Web Inspector)
   - Check Console for errors
   - Look for `[TikTok Automation]` messages

### Typing Not Working

1. **Verify Extension is Loaded**:
   ```python
   bridge = SafariExtensionBridge()
   if bridge.check_extension_loaded():
       print("✅ Extension loaded")
   else:
       print("❌ Extension not loaded")
   ```

2. **Check Status**:
   ```python
   status = bridge.check_status()
   print(status)
   ```

3. **Test Manually**:
   - Open extension popup
   - Click "Test Comment"
   - Check if comment appears

### Button Not Activating

If the Post button stays grey after typing:

1. **Check Input Text**:
   - The extension should return `buttonActive: true`
   - If false, Draft.js may not have recognized the input

2. **Try Different Approach**:
   - The extension uses `beforeinput` events
   - If this doesn't work, TikTok may have changed their implementation
   - Check the content script console for errors

3. **Manual Verification**:
   - Open comments panel
   - Check if text appears in input field
   - Check if Post button turns red when you manually type

## Files Structure

```
safari_extension/
├── manifest.json              # Extension configuration
├── background.js              # Background script (message handler)
├── content.js                 # Content script (runs in TikTok page)
├── popup.html                 # Extension popup UI
├── popup.js                   # Popup script
└── README.md                  # This file

safari_extension_bridge.py     # Python bridge to communicate with extension
```

## Testing

### Manual Test

1. Navigate to a TikTok video
2. Open extension popup
3. Click "Test Comment"
4. Verify comment appears

### Python Test

```python
python -m automation.safari_extension_bridge
```

This will:
- Check if extension is loaded
- Display current status
- Test basic functionality

### Integration Test

```python
from automation.tiktok_engagement import TikTokEngagement

async def test():
    engagement = TikTokEngagement()
    await engagement.start("https://www.tiktok.com/@username/video/1234567890")
    result = await engagement.post_comment("Test comment")
    print(result)
    await engagement.cleanup()

import asyncio
asyncio.run(test())
```

## Success Indicators

✅ **Extension Loaded**: `bridge.check_extension_loaded()` returns `True`

✅ **Typing Works**: `bridge.type_comment("test")` returns `{"success": true, "buttonActive": true}`

✅ **Post Works**: `bridge.post_comment("test")` returns `{"success": true}`

✅ **Comment Appears**: Comment appears in comments list after posting

## Next Steps

Once the extension is working:

1. **Integrate with Automation**: The `TikTokEngagement` class will automatically use it
2. **Test End-to-End**: Run your full automation flow
3. **Monitor Success Rate**: Check if comments are posting successfully
4. **Rate Limiting**: Make sure to respect TikTok's rate limits

## Support

If you encounter issues:

1. Check Safari Web Inspector console for errors
2. Verify extension is enabled in Safari settings
3. Test with the popup UI first
4. Check Python logs for bridge errors
5. Review the content script for Draft.js compatibility

## Notes

- The extension must be manually installed (can't be automated)
- Safari Web Extensions require user approval
- The extension only works on TikTok pages
- Draft.js implementation may change - content script may need updates

