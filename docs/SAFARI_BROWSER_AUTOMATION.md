# Safari Browser Automation for TikTok & Instagram

This document describes how MediaPoster controls the Safari browser for TikTok and Instagram comment automation.

## Overview

MediaPoster uses **AppleScript** to control the actual Safari.app browser (not a headless browser like Playwright's WebKit). This approach allows:
- Using your real Safari profile with existing logins/cookies
- Avoiding detection since it's the actual browser
- Accessing sites where you're already authenticated

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Python Backend                           │
├─────────────────────────────────────────────────────────────────┤
│  TikTokEngagement        │  InstagramCommentAutomation         │
│  (tiktok_engagement.py)  │  (comment_automation.py)            │
└─────────────┬────────────┴──────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   SafariAppController                           │
│              (safari_app_controller.py)                         │
│                                                                 │
│  • AppleScript execution via osascript                         │
│  • JavaScript injection into Safari tabs                       │
│  • Window/tab management                                       │
│  • Event listener installation                                 │
└─────────────┬───────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────────┐
│              SafariExtensionBridge (Optional)                   │
│           (safari_extension_bridge.py)                          │
│                                                                 │
│  • Direct communication with Safari Web Extension              │
│  • Handles Draft.js input fields (TikTok comments)             │
│  • Dispatches proper beforeinput events                        │
└─────────────┬───────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Safari.app                                  │
│                                                                 │
│  • Your actual browser with real cookies                       │
│  • Already logged into TikTok/Instagram                        │
│  • No detection risk                                           │
└─────────────────────────────────────────────────────────────────┘
```

## Core Components

### 1. SafariAppController (`Backend/automation/safari_app_controller.py`)

The main controller that interfaces with Safari.app using AppleScript.

#### Key Methods

```python
from automation.safari_app_controller import SafariAppController

controller = SafariAppController()

# Launch Safari with a URL
await controller.launch_safari("https://www.tiktok.com/en/")

# Find and activate existing TikTok window
await controller.activate_tiktok_window(require_logged_in=True)

# Get current URL
url = await controller.get_current_url()

# Execute JavaScript in Safari
result = controller._run_applescript('''
    tell application "Safari"
        tell front window
            tell current tab
                do JavaScript "document.title"
            end tell
        end tell
    end tell
''')

# Get comprehensive page state (inputs, buttons, forms)
state = await controller.get_page_state()

# Detect captchas
captcha = await controller.detect_captcha()

# Check login status
is_logged_in = await controller.check_for_login_success()
```

#### How AppleScript Control Works

```applescript
-- Basic pattern: Tell Safari to do something
tell application "Safari"
    -- Activate (bring to front)
    activate
    
    -- Access windows and tabs
    tell front window
        tell current tab
            -- Execute JavaScript
            do JavaScript "console.log('Hello from Python!')"
            
            -- Get page info
            set pageURL to URL
            set pageTitle to name
        end tell
    end tell
end tell
```

### 2. SafariExtensionBridge (`Backend/automation/safari_extension_bridge.py`)

Handles communication with an optional Safari Web Extension for complex input scenarios.

#### Why an Extension?

TikTok uses **Draft.js** for their comment input fields, which don't respond to normal keyboard events. The extension can:
- Dispatch `beforeinput` events that Draft.js recognizes
- Properly focus and type into contenteditable divs
- Handle React-managed form state

#### Usage

```python
from automation.safari_extension_bridge import SafariExtensionBridge

bridge = SafariExtensionBridge()

# Check if extension is loaded
if bridge.check_extension_loaded():
    # Type into TikTok comment field
    result = bridge.type_comment("Great video! 🔥")
    
    # Click the Post button
    bridge.click_post()
    
    # Or use the complete flow
    result = bridge.post_comment("Amazing content!", verify=True)
```

### 3. TikTokEngagement (`Backend/automation/tiktok_engagement.py`)

High-level automation for TikTok interactions.

#### Selectors (data-e2e attributes)

TikTok uses `data-e2e` attributes which are stable for testing. Key selectors:

```python
SELECTORS = {
    # Engagement buttons
    "like_button": '[data-e2e="like-icon"]',
    "comment_button": '[data-e2e="comment-icon"]',
    "share_button": '[data-e2e="share-icon"]',
    "follow_button": '[data-e2e="follow-button"]',
    
    # Comment input
    "comment_input": '[data-e2e="comment-input"], [contenteditable="true"]',
    "comment_post": '[data-e2e="comment-post"]',
    
    # Navigation
    "profile_icon": '[data-e2e="profile-icon"]',
    "inbox_icon": '[data-e2e="inbox-icon"]',
}
```

#### Comment Posting Flow

```python
from automation.tiktok_engagement import TikTokEngagement

engagement = TikTokEngagement(browser_type="safari")

# Start and find existing session
await engagement.start(find_existing=True)

# Post a comment
result = await engagement.post_comment(
    text="This is amazing! 🔥",
    verify=True,           # Verify comment appears
    use_extension=True     # Use extension if available
)

print(result)
# {'success': True, 'text': '...', 'verified': True, 'method': 'extension'}
```

### 4. InstagramCommentAutomation (`Backend/services/instagram/comment_automation.py`)

Instagram-specific automation with AI-generated comments.

#### Features

- **AI Comment Generation**: Uses OpenAI to create contextual comments
- **Human-like Typing**: Variable delays, occasional typos, thinking pauses
- **Session Persistence**: Cookie-based login persistence
- **Rate Limiting**: Built-in tracking to avoid detection

#### Usage

```python
from services.instagram.comment_automation import (
    InstagramCommentAutomation,
    CommentTarget
)

automation = InstagramCommentAutomation(
    account_username="the_isaiah_dupree",
    openai_api_key=os.getenv("OPENAI_API_KEY")
)

# Generate AI comment
comment = await automation.generate_ai_comment(
    post_caption="Just launched my new product! 🚀",
    post_username="targetuser",
    hashtags=["entrepreneurship", "startup"],
    brand_context={"voice": "friendly", "topics": ["tech"]}
)

# Post comment
target = CommentTarget(
    post_url="https://instagram.com/p/ABC123/",
    username="targetuser",
    caption="Just launched my new product! 🚀"
)

result = await automation.comment_on_post(target, comment_text=comment)
```

## Setup Requirements

### 1. Enable Safari Automation Permissions

```
System Settings → Privacy & Security → Automation
→ Enable Terminal (or your IDE) to control Safari
```

### 2. Enable Safari Developer Menu

```
Safari → Settings → Advanced
→ Check "Show features for web developers"
```

### 3. Allow Remote Automation (Optional)

```
Safari → Develop → Allow Remote Automation
```

### 4. Install Safari Extension (Optional)

For TikTok Draft.js input handling:

```
Location: Backend/automation/safari_extension/
```

## Session Management

### TikTokSessionManager (`Backend/automation/tiktok_session_manager.py`)

Tracks sessions, cookies, and rate limits.

```python
from automation.tiktok_session_manager import TikTokSessionManager

manager = TikTokSessionManager()

# Check rate limits before action
if manager.can_perform_action("comment"):
    # Perform action
    manager.add_action("comment", {"url": "...", "text": "..."})
else:
    wait_time = manager.get_wait_time_for_action("comment")
    await asyncio.sleep(wait_time)
```

#### Rate Limits (Default)

| Action     | Max per Hour |
|------------|-------------|
| like       | 100         |
| comment    | 30          |
| follow     | 50          |
| message    | 20          |
| navigation | 200         |

## JavaScript Injection Examples

### Click an Element

```python
js_code = '''
var btn = document.querySelector('[data-e2e="like-icon"]');
if (btn) {
    btn.click();
    'clicked';
} else {
    'not_found';
}
'''

script = f'''
tell application "Safari"
    tell front window
        tell current tab
            do JavaScript "{js_code}"
        end tell
    end tell
end tell
'''

result = controller._run_applescript(script)
```

### Type into Input Field

```python
js_code = '''
var input = document.querySelector('[contenteditable="true"]');
if (input) {
    input.focus();
    input.textContent = 'Hello World';
    input.dispatchEvent(new Event('input', {bubbles: true}));
    'typed';
} else {
    'not_found';
}
'''
```

### Get Page Information

```python
js_code = '''
JSON.stringify({
    url: window.location.href,
    title: document.title,
    loggedIn: !!document.querySelector('[data-e2e="profile-icon"]')
})
'''
```

## TikTok DOM Selectors (`Backend/automation/tiktok_selectors.py`)

Reference for stable TikTok selectors:

```python
from automation.tiktok_selectors import TikTokSelectors

# Comment input field
TikTokSelectors.COMMENT_INPUT_SELECTOR  # '[contenteditable="true"]'

# Comment icon (data-e2e attribute)
TikTokSelectors.COMMENT_ICON_ATTR  # 'data-e2e="comment-icon"'

# Get JS to find visible comment icons
js = TikTokSelectors.get_visible_comment_icons_script()

# Get JS to focus comment input
js = TikTokSelectors.get_comment_input_script()
```

## Error Handling

### Common Errors

1. **"not allowed assistive access"**
   ```
   Go to: System Settings > Privacy & Security > Automation
   Enable Terminal/IDE to control Safari
   ```

2. **"Extension not loaded"**
   - Ensure Safari extension is installed and enabled
   - Make sure you're on a TikTok page

3. **Timeout errors**
   - Safari may be slow to respond
   - Increase timeout parameter in `_run_applescript()`

### Captcha Detection

```python
captcha = await controller.detect_captcha()
if captcha and captcha.get("detected"):
    print(f"CAPTCHA type: {captcha.get('type')}")
    # Types: 'slide', 'whirl', '3d', 'unknown'
    # Manual intervention required
```

## File Locations

| File | Purpose |
|------|---------|
| `Backend/automation/safari_app_controller.py` | Core Safari control via AppleScript |
| `Backend/automation/safari_extension_bridge.py` | Safari extension communication |
| `Backend/automation/tiktok_engagement.py` | TikTok engagement automation |
| `Backend/automation/tiktok_selectors.py` | TikTok DOM selectors |
| `Backend/automation/tiktok_session_manager.py` | Session/cookie management |
| `Backend/services/instagram/comment_automation.py` | Instagram comment automation |
| `Backend/automation/sessions/` | Session cookie storage |

## Testing

### Quick Test Script

```python
import asyncio
from automation.safari_app_controller import SafariAppController

async def test():
    controller = SafariAppController()
    
    # Find TikTok tab
    found = await controller.activate_tiktok_window(require_logged_in=True)
    print(f"Found TikTok: {found}")
    
    # Get page state
    state = await controller.get_page_state()
    print(f"URL: {state.get('url')}")
    print(f"Logged in: {not state.get('hasLoginForm')}")

asyncio.run(test())
```

### Running Tests

```bash
cd Backend/automation
python -m pytest tests/test_tiktok_engagement_full.py -v
```

## Security Notes

1. **Never store credentials in code** - Use environment variables
2. **Rate limit all actions** - Avoid platform detection
3. **Use human-like delays** - Random jitter between actions
4. **Session cookies are stored locally** - In `Backend/automation/sessions/`
5. **Be logged in manually first** - Automation uses your existing session
