# AppleScript Safari Automation Reference

**Last Updated:** 2026-01-16

A standalone reference for Safari browser automation using AppleScript and JavaScript injection on macOS.

---

## Quick Start

### Minimal Python Setup

```python
import subprocess

def run_applescript(script: str) -> tuple:
    """Execute AppleScript, return (success, output)."""
    result = subprocess.run(
        ["osascript", "-e", script],
        capture_output=True,
        text=True,
        timeout=60
    )
    return result.returncode == 0, result.stdout.strip()

# Navigate
run_applescript('tell application "Safari" to set URL of front document to "https://x.com"')

# Execute JS
run_applescript('tell application "Safari" to tell front document to do JavaScript "document.title"')
```

---

## Core AppleScript Commands

### Launch Safari
```applescript
tell application "Safari"
    activate
    if (count of windows) = 0 then
        make new document
    end if
end tell
```

### Navigate to URL
```applescript
tell application "Safari"
    set URL of front document to "https://example.com"
end tell
```

### Get Current URL
```applescript
tell application "Safari"
    return URL of front document
end tell
```

### Execute JavaScript
```applescript
tell application "Safari"
    tell front document
        do JavaScript "document.querySelector('button').click()"
    end tell
end tell
```

### Get Page Title
```applescript
tell application "Safari"
    return name of front document
end tell
```

### Wait for Page Load
```applescript
tell application "Safari"
    tell front document
        repeat until (do JavaScript "document.readyState") is "complete"
            delay 0.5
        end repeat
    end tell
end tell
```

---

## Tab & Window Management

### New Tab
```applescript
tell application "Safari"
    tell front window
        set newTab to make new tab with properties {URL:"https://example.com"}
        set current tab to newTab
    end tell
end tell
```

### Switch to Tab by Index
```applescript
tell application "Safari"
    tell front window
        set current tab to tab 2
    end tell
end tell
```

### Close Current Tab
```applescript
tell application "Safari"
    tell front window
        close current tab
    end tell
end tell
```

### Get All Tab URLs
```applescript
tell application "Safari"
    set tabURLs to {}
    repeat with t in tabs of front window
        set end of tabURLs to URL of t
    end repeat
    return tabURLs
end tell
```

### Find Tab by URL Pattern
```applescript
tell application "Safari"
    repeat with w in windows
        repeat with t in tabs of w
            if URL of t contains "twitter" or URL of t contains "x.com" then
                set current tab of w to t
                return "found"
            end if
        end repeat
    end repeat
    return "not_found"
end tell
```

---

## JavaScript Injection Patterns

### Click Element
```javascript
(function() {
    var el = document.querySelector('[data-testid="tweetButton"]');
    if (el) { el.click(); return 'clicked'; }
    return 'not_found';
})();
```

### Fill Text Input
```javascript
(function() {
    var input = document.querySelector('input[name="username"]');
    if (input) {
        input.value = 'myusername';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return 'filled';
    }
    return 'not_found';
})();
```

### Fill ContentEditable (Rich Text)
```javascript
(function() {
    var editor = document.querySelector('[contenteditable="true"]');
    if (editor) {
        editor.focus();
        editor.innerText = 'Hello World!';
        editor.dispatchEvent(new Event('input', { bubbles: true }));
        return 'filled';
    }
    return 'not_found';
})();
```

### Scroll to Element
```javascript
(function() {
    var el = document.querySelector('.target-element');
    if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return 'scrolled';
    }
    return 'not_found';
})();
```

### Wait for Element (Polling)
```javascript
(function() {
    var found = false;
    var attempts = 0;
    while (!found && attempts < 20) {
        if (document.querySelector('.success-message')) {
            found = true;
        } else {
            // Busy wait (not ideal but works in sync context)
            var start = Date.now();
            while (Date.now() - start < 500) {}
            attempts++;
        }
    }
    return found ? 'found' : 'timeout';
})();
```

### Extract List Data
```javascript
(function() {
    var items = [];
    document.querySelectorAll('[data-e2e="notification"]').forEach(function(el, i) {
        if (i < 20) {
            items.push({
                text: el.innerText.substring(0, 200),
                link: el.querySelector('a')?.href || null
            });
        }
    });
    return JSON.stringify(items);
})();
```

### Check Element State
```javascript
(function() {
    var btn = document.querySelector('[data-testid="like-button"]');
    if (!btn) return 'not_found';
    
    var svg = btn.querySelector('svg');
    var fill = svg?.getAttribute('fill') || '';
    var isLiked = fill.includes('rgb(249') || btn.className.includes('liked');
    
    return isLiked ? 'liked' : 'not_liked';
})();
```

### Simulate Keyboard
```javascript
(function() {
    var el = document.activeElement;
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13 }));
    el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', keyCode: 13 }));
    return 'pressed';
})();
```

---

## Complete SafariController Class

```python
import subprocess
import time
import json
from typing import Optional, Dict, Any, List, Tuple

class SafariController:
    """
    Safari browser automation via AppleScript.
    
    Usage:
        controller = SafariController()
        controller.navigate("https://x.com")
        controller.run_js("document.title")
    """
    
    def __init__(self, timeout: int = 60):
        self.timeout = timeout
        self.current_url = ""
    
    def _run_applescript(self, script: str) -> Tuple[bool, str]:
        """Execute AppleScript."""
        try:
            result = subprocess.run(
                ["osascript", "-e", script],
                capture_output=True,
                text=True,
                timeout=self.timeout
            )
            return result.returncode == 0, result.stdout.strip()
        except subprocess.TimeoutExpired:
            return False, "timeout"
        except Exception as e:
            return False, str(e)
    
    def activate(self) -> bool:
        """Activate Safari and ensure a window exists."""
        script = '''
        tell application "Safari"
            activate
            if (count of windows) = 0 then
                make new document
            end if
        end tell
        '''
        success, _ = self._run_applescript(script)
        return success
    
    def navigate(self, url: str) -> bool:
        """Navigate to URL."""
        script = f'''
        tell application "Safari"
            activate
            set URL of front document to "{url}"
        end tell
        '''
        success, _ = self._run_applescript(script)
        if success:
            self.current_url = url
        return success
    
    def get_url(self) -> str:
        """Get current page URL."""
        script = '''
        tell application "Safari"
            return URL of front document
        end tell
        '''
        success, url = self._run_applescript(script)
        if success:
            self.current_url = url
        return url if success else ""
    
    def run_js(self, code: str) -> str:
        """Execute JavaScript and return result."""
        # Escape for AppleScript string
        escaped = code.replace('\\', '\\\\').replace('"', '\\"')
        script = f'''
        tell application "Safari"
            tell front document
                do JavaScript "{escaped}"
            end tell
        end tell
        '''
        success, result = self._run_applescript(script)
        return result if success else ""
    
    def click(self, selector: str) -> bool:
        """Click element by CSS selector."""
        js = f'''
        (function() {{
            var el = document.querySelector('{selector}');
            if (el) {{ el.click(); return 'clicked'; }}
            return 'not_found';
        }})();
        '''
        result = self.run_js(js)
        return result == 'clicked'
    
    def fill(self, selector: str, text: str) -> bool:
        """Fill input field."""
        escaped_text = text.replace("'", "\\'").replace("\n", "\\n")
        js = f'''
        (function() {{
            var el = document.querySelector('{selector}');
            if (!el) return 'not_found';
            el.focus();
            if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {{
                el.value = '{escaped_text}';
            }} else {{
                el.innerText = '{escaped_text}';
            }}
            el.dispatchEvent(new Event('input', {{ bubbles: true }}));
            return 'filled';
        }})();
        '''
        result = self.run_js(js)
        return result == 'filled'
    
    def wait_for(self, selector: str, timeout: int = 30) -> bool:
        """Wait for element to appear."""
        for _ in range(timeout * 2):
            js = f"document.querySelector('{selector}') !== null"
            if self.run_js(js) == 'true':
                return True
            time.sleep(0.5)
        return False
    
    def get_text(self, selector: str) -> str:
        """Get element text content."""
        js = f'''
        (function() {{
            var el = document.querySelector('{selector}');
            return el ? el.innerText : '';
        }})();
        '''
        return self.run_js(js)
    
    def get_elements(self, selector: str, limit: int = 50) -> List[Dict]:
        """Get list of elements as JSON."""
        js = f'''
        (function() {{
            var items = [];
            document.querySelectorAll('{selector}').forEach(function(el, i) {{
                if (i < {limit}) {{
                    items.push({{
                        text: el.innerText.substring(0, 200),
                        href: el.href || null,
                        class: el.className
                    }});
                }}
            }});
            return JSON.stringify(items);
        }})();
        '''
        result = self.run_js(js)
        try:
            return json.loads(result) if result else []
        except json.JSONDecodeError:
            return []
    
    def screenshot(self, filename: str) -> bool:
        """Take screenshot of current window."""
        try:
            subprocess.run(
                ["screencapture", "-w", filename],
                timeout=10
            )
            return True
        except Exception:
            return False
```

---

## Selector Strategies

### Priority Order (Most to Least Stable)

1. **data-testid / data-e2e** - Designed for testing, rarely changes
   ```javascript
   '[data-testid="tweetButton"]'
   '[data-e2e="comment-post"]'
   ```

2. **aria-label** - Accessibility attributes, semantic
   ```javascript
   '[aria-label="Post"]'
   '[aria-label="Send message"]'
   ```

3. **Semantic HTML + type**
   ```javascript
   'button[type="submit"]'
   'input[name="username"]'
   ```

4. **Placeholder text**
   ```javascript
   '[placeholder*="What is happening"]'
   ```

5. **Class patterns** - Use contains for partial matches
   ```javascript
   '[class*="PostButton"]'
   '[class*="DivCommentInput"]'
   ```

### Platform-Specific Selectors

#### Twitter/X
```javascript
'[data-testid="tweetButton"]'         // Post button
'[data-testid="tweetTextarea_0"]'     // Compose area
'[data-testid="like"]'                // Like button
'[data-testid="reply"]'               // Reply button
'[data-testid="notification"]'        // Notification item
'[data-testid="DM_Inbox"]'            // DM inbox
```

#### TikTok
```javascript
'[data-e2e="like-icon"]'              // Like button
'[data-e2e="comment-icon"]'           // Comment button
'[data-e2e="comment-post"]'           // Post comment
'[data-e2e="comment-input"]'          // Comment input
'[data-e2e="browse-username"]'        // Video username
```

#### Threads
```javascript
'[role="textbox"]'                    // Compose area
'[role="button"]'                     // Buttons
'[role="listitem"]'                   // List items
'a[href*="/@"]'                       // User links
```

---

## Common Patterns

### Login Detection
```python
def is_logged_in(self, platform: str) -> bool:
    selectors = {
        'twitter': '[data-testid="SideNav_AccountSwitcher_Button"]',
        'tiktok': '[data-e2e="profile-icon"]',
        'threads': '[role="button"][aria-label*="profile"]',
    }
    selector = selectors.get(platform, '')
    return self.run_js(f"document.querySelector('{selector}') !== null") == 'true'
```

### Retry Pattern
```python
def click_with_retry(self, selector: str, max_retries: int = 3) -> bool:
    for attempt in range(max_retries):
        if self.click(selector):
            return True
        time.sleep(1)
    return False
```

### Wait and Click
```python
def wait_and_click(self, selector: str, timeout: int = 10) -> bool:
    if self.wait_for(selector, timeout):
        time.sleep(0.3)  # Brief pause after element appears
        return self.click(selector)
    return False
```

---

## Limitations

1. **macOS Only** - AppleScript is macOS-specific
2. **Safari Only** - These scripts don't work with Chrome/Firefox
3. **Permissions Required** - Must enable "Allow JavaScript from Apple Events"
4. **Single Thread** - AppleScript blocks Python execution
5. **No Headless** - Safari must be visible (though can be minimized)
6. **Rate Limits** - Platforms may detect automation

---

## Enable Safari Automation

1. **Safari → Preferences → Advanced**
   - Check "Show Develop menu in menu bar"

2. **Develop → Allow JavaScript from Apple Events**
   - Must be checked for `do JavaScript` to work

3. **System Preferences → Security & Privacy → Automation**
   - Allow Terminal/Python to control Safari
