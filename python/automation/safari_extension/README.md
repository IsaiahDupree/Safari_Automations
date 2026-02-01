# TikTok Comment Safari Web Extension

## Purpose

Inject keyboard events directly into TikTok's Draft.js comment input, bypassing macOS keyboard focus limitations.

**This extension solves the Draft.js typing problem** by running inside the TikTok page context and using `beforeinput` events that Draft.js recognizes.

## Quick Start

1. **Install Extension**: See [SAFARI_EXTENSION_SETUP.md](./SAFARI_EXTENSION_SETUP.md) for detailed instructions
2. **Enable in Safari**: Safari → Settings → Extensions → Enable "TikTok Comment Automation"
3. **Use from Python**:
   ```python
   from automation.safari_extension_bridge import SafariExtensionBridge
   
   bridge = SafariExtensionBridge()
   result = bridge.post_comment("Hello from automation! 🎉")
   ```

## Architecture

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

## How It Works

### 1. Content Script (content.js)
Runs directly in TikTok page with full access to Draft.js:

```javascript
// Uses beforeinput events - this is what Draft.js listens for!
const beforeInputEvent = new InputEvent('beforeinput', {
    inputType: 'insertText',
    data: char,
    bubbles: true,
    cancelable: true
});

input.dispatchEvent(beforeInputEvent);
// Draft.js updates React state ✅
```

### 2. Python Bridge (safari_extension_bridge.py)
Uses AppleScript to inject JavaScript that calls the extension:

```python
bridge = SafariExtensionBridge()
result = bridge.type_comment("My comment")
# Returns: {"success": True, "buttonActive": True, ...}
```

### 3. Integration (tiktok_engagement.py)
Automatically uses extension if available:

```python
engagement = TikTokEngagement()
await engagement.post_comment("My comment")
# Automatically uses extension if loaded, falls back to AppleScript
```

## Key Features

✅ **Draft.js Compatible**: Uses `beforeinput` events that Draft.js recognizes  
✅ **Automatic Fallback**: Falls back to AppleScript if extension not available  
✅ **Button State Detection**: Checks if Post button is active (red)  
✅ **Complete Flow**: Can handle entire comment posting flow  
✅ **Status Checking**: Can check current input/button state  

## Files

```
safari_extension/
├── manifest.json              # Extension configuration (Manifest V2 for Safari)
├── background.js              # Background script (message handler)
├── content.js                 # Content script (runs in TikTok page)
├── popup.html                 # Extension popup UI
├── popup.js                   # Popup script
├── README.md                  # This file
└── SAFARI_EXTENSION_SETUP.md # Detailed setup instructions

safari_extension_bridge.py     # Python bridge to communicate with extension
```

## Usage Examples

### Basic Usage

```python
from automation.safari_extension_bridge import SafariExtensionBridge

bridge = SafariExtensionBridge()

# Check if extension is loaded
if bridge.check_extension_loaded():
    # Type a comment
    result = bridge.type_comment("Hello!")
    
    # Check if button is active
    if result.get("buttonActive"):
        # Click Post
        bridge.click_post()
```

### Complete Flow

```python
# Post a comment (opens comments, types, posts)
result = bridge.post_comment("My automated comment!", verify=True)
print(result)
# {"success": True, "text": "My automated comment!", ...}
```

### Integration with TikTokEngagement

```python
from automation.tiktok_engagement import TikTokEngagement

engagement = TikTokEngagement()
await engagement.start("https://www.tiktok.com/@username/video/1234567890")

# Automatically uses extension if available
result = await engagement.post_comment("My comment")
print(result)
```

## Testing

### Manual Test via Popup

1. Navigate to a TikTok video
2. Click extension icon in Safari toolbar
3. Click "Test Comment"
4. Verify comment appears

### Python Test

```python
python -m automation.safari_extension_bridge
```

### Integration Test

```python
from automation.tiktok_engagement import TikTokEngagement
import asyncio

async def test():
    engagement = TikTokEngagement()
    await engagement.start("https://www.tiktok.com/@username/video/1234567890")
    result = await engagement.post_comment("Test comment")
    print(result)
    await engagement.cleanup()

asyncio.run(test())
```

## Troubleshooting

### Extension Not Loading

- Check Safari → Settings → Extensions
- Make sure extension is enabled
- Check "Allow Unsigned Extensions" (if using development mode)
- Navigate to TikTok and grant permissions

### Typing Not Working

- Verify extension is loaded: `bridge.check_extension_loaded()`
- Check status: `bridge.check_status()`
- Test manually via popup first
- Check Safari Web Inspector console for errors

### Button Not Activating

- Extension should return `buttonActive: true`
- If false, Draft.js may not have recognized the input
- Check content script console for errors
- Try manual typing to verify Draft.js is working

## Advantages

✅ **Works with Draft.js**: Uses proper `beforeinput` events  
✅ **No Focus Issues**: Runs in browser context  
✅ **Reliable**: Uses real browser APIs  
✅ **Automatic**: Integrated into `TikTokEngagement` class  
✅ **Fallback**: Falls back to AppleScript if extension not available  

## Limitations

⚠️ Requires manual installation in Safari  
⚠️ User must enable extension  
⚠️ Only works on TikTok pages  
⚠️ Draft.js implementation may change (may need updates)  

## Next Steps

1. **Install Extension**: Follow [SAFARI_EXTENSION_SETUP.md](./SAFARI_EXTENSION_SETUP.md)
2. **Test**: Use popup to test basic functionality
3. **Integrate**: Use in your automation scripts
4. **Monitor**: Check success rate and adjust as needed

## Support

See [SAFARI_EXTENSION_SETUP.md](./SAFARI_EXTENSION_SETUP.md) for:
- Detailed installation instructions
- Troubleshooting guide
- Testing procedures
- Architecture details
