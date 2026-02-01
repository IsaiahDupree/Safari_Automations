#!/usr/bin/env python3
"""
Safari Reddit Poster
Posts to Reddit directly via Safari browser automation using AppleScript.

Supports:
- Text posts (self posts)
- Link posts
- Image/video posts with media upload
- Crossposting
- Login verification via session manager
- Subreddit selection
- Flair selection
- NSFW/Spoiler tagging
"""
import subprocess
import time
import json
import os
import re
from typing import Optional, Dict, List, Any
from loguru import logger
from pathlib import Path
from dataclasses import dataclass
from enum import Enum

# Import session manager for login verification
try:
    from automation.safari_session_manager import SafariSessionManager, Platform
    HAS_SESSION_MANAGER = True
except ImportError:
    try:
        from safari_session_manager import SafariSessionManager, Platform
        HAS_SESSION_MANAGER = True
    except ImportError:
        HAS_SESSION_MANAGER = False
        logger.warning("Session manager not available, using built-in login check")


class PostType(Enum):
    """Reddit post types."""
    TEXT = "text"
    LINK = "link"
    IMAGE = "image"
    VIDEO = "video"
    POLL = "poll"


@dataclass
class RedditPost:
    """Reddit post data."""
    title: str
    subreddit: str
    post_type: PostType = PostType.TEXT
    body: Optional[str] = None  # For text posts
    url: Optional[str] = None  # For link posts
    media_path: Optional[str] = None  # For image/video posts
    flair: Optional[str] = None
    nsfw: bool = False
    spoiler: bool = False
    send_replies: bool = True


@dataclass
class PostResult:
    """Result of a Reddit post attempt."""
    success: bool
    post_url: Optional[str] = None
    post_id: Optional[str] = None
    error: Optional[str] = None
    subreddit: Optional[str] = None


class SafariRedditPoster:
    """Post to Reddit via Safari browser automation."""
    
    # Reddit URLs - use old.reddit.com for simpler DOM structure
    REDDIT_HOME = "https://www.reddit.com/"
    REDDIT_SUBMIT = "https://old.reddit.com/submit"  # Old Reddit has simpler form
    REDDIT_LOGIN = "https://www.reddit.com/login/"
    OLD_REDDIT_HOME = "https://old.reddit.com/"
    
    def __init__(self):
        self.last_post_time = None
        self.min_interval_seconds = 60  # Reddit rate limits are strict
        self.username = None
        
    def _run_applescript(self, script: str, timeout: int = 30) -> tuple[bool, str]:
        """Run AppleScript and return success status and output."""
        try:
            result = subprocess.run(
                ['osascript', '-e', script],
                capture_output=True,
                text=True,
                timeout=timeout
            )
            return result.returncode == 0, result.stdout.strip() or result.stderr.strip()
        except subprocess.TimeoutExpired:
            return False, "AppleScript timeout"
        except Exception as e:
            return False, str(e)
    
    def _run_js(self, code: str) -> str:
        """Execute JavaScript in Safari and return result."""
        escaped = code.replace('\\', '\\\\').replace('"', '\\"').replace('\n', '\\n')
        script = f'''
tell application "Safari"
    tell front document
        do JavaScript "{escaped}"
    end tell
end tell
'''
        success, result = self._run_applescript(script)
        return result if success else ""
    
    def activate_safari(self) -> bool:
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
        """Navigate Safari to a URL."""
        script = f'''
tell application "Safari"
    activate
    if (count of windows) = 0 then
        make new document
    end if
    set URL of current tab of window 1 to "{url}"
end tell
'''
        success, _ = self._run_applescript(script)
        if success:
            time.sleep(2)
        return success
    
    def get_current_url(self) -> Optional[str]:
        """Get the current URL from Safari."""
        script = '''
tell application "Safari"
    tell window 1
        return URL of current tab
    end tell
end tell
'''
        success, url = self._run_applescript(script)
        return url if success else None
    
    def wait_for_page_load(self, timeout_seconds: int = 10) -> bool:
        """Wait for the page to finish loading."""
        script = f'''
tell application "Safari"
    tell window 1
        tell current tab
            set startTime to current date
            repeat
                set docState to do JavaScript "document.readyState"
                if docState is "complete" then
                    return "loaded"
                end if
                if ((current date) - startTime) > {timeout_seconds} then
                    return "timeout"
                end if
                delay 0.5
            end repeat
        end tell
    end tell
end tell
'''
        success, result = self._run_applescript(script)
        return success and result == "loaded"
    
    def check_login_status(self) -> Dict:
        """Check if user is logged into Reddit."""
        self.wait_for_page_load(5)
        time.sleep(1)
        
        js_code = '''
(function() {
    var url = window.location.href;
    
    // Check for login page
    if (url.includes('/login') || url.includes('/register')) {
        return JSON.stringify({logged_in: false, reason: 'on_login_page', url: url});
    }
    
    // Reddit new UI indicators for logged in state
    var indicators = [
        'faceplate-dropdown-menu[name="user-drawer-tray"]',
        '[id="USER_DROPDOWN_ID"]',
        'button[aria-label*="profile"]',
        'a[href*="/user/"][data-testid]',
        '#expand-user-drawer-button',
        'shreddit-async-loader[bundlename="user_drawer"]'
    ];
    
    for (var i = 0; i < indicators.length; i++) {
        var el = document.querySelector(indicators[i]);
        if (el) {
            // Try to find username
            var username = '';
            var userLink = document.querySelector('a[href*="/user/"]');
            if (userLink) {
                var href = userLink.getAttribute('href');
                var match = href.match(/\\/user\\/([^\\/]+)/);
                if (match) username = match[1];
            }
            return JSON.stringify({logged_in: true, username: username, indicator: indicators[i]});
        }
    }
    
    // Check for login buttons (definitely not logged in)
    var loginIndicators = [
        'a[href*="/login"]',
        'button[data-testid="login-button"]',
        'faceplate-tracker[noun="login"]'
    ];
    
    for (var j = 0; j < loginIndicators.length; j++) {
        if (document.querySelector(loginIndicators[j])) {
            return JSON.stringify({logged_in: false, reason: 'login_button_visible'});
        }
    }
    
    // Check page content length
    if (document.body && document.body.innerText.length < 100) {
        return JSON.stringify({logged_in: false, reason: 'page_still_loading'});
    }
    
    return JSON.stringify({logged_in: false, reason: 'no_indicators_found', url: url});
})();
'''
        result = self._run_js(js_code)
        if result:
            try:
                data = json.loads(result)
                if data.get('username'):
                    self.username = data['username']
                return data
            except json.JSONDecodeError:
                pass
        return {'logged_in': False, 'reason': 'script_error'}
    
    def require_login(self) -> bool:
        """Check login and return True only if logged in."""
        # First check current URL - if already on Reddit, check inline
        current_url = self.get_current_url()
        if current_url and 'reddit.com' in current_url:
            status = self.check_login_status()
            if status.get('logged_in'):
                return True
        
        # Navigate to Reddit home and check
        self.navigate(self.REDDIT_HOME)
        time.sleep(2)
        self.wait_for_page_load(5)
        status = self.check_login_status()
        return status.get('logged_in', False)
    
    def open_submit_page(self, subreddit: Optional[str] = None) -> bool:
        """Open the Reddit submit page (uses old.reddit.com for reliability)."""
        if subreddit:
            # Clean subreddit name
            subreddit = subreddit.replace('r/', '').replace('/r/', '').strip()
            url = f"https://old.reddit.com/r/{subreddit}/submit"
        else:
            url = self.REDDIT_SUBMIT
        
        self.navigate(url)
        time.sleep(2)
        self.wait_for_page_load(10)
        return True
    
    def select_post_type(self, post_type: PostType) -> bool:
        """Select the post type tab (Text, Images & Video, Link, Poll)."""
        tab_map = {
            PostType.TEXT: ['Post', 'Text'],
            PostType.LINK: ['Link'],
            PostType.IMAGE: ['Images & Video', 'Image', 'Media'],
            PostType.VIDEO: ['Images & Video', 'Video', 'Media'],
            PostType.POLL: ['Poll'],
        }
        
        tab_names = tab_map.get(post_type, ['Post'])
        
        js_code = f'''
(function() {{
    var tabNames = {json.dumps(tab_names)};
    
    // Try new Reddit UI tabs
    var tabs = document.querySelectorAll('button[role="tab"], [role="tablist"] button');
    for (var i = 0; i < tabs.length; i++) {{
        var text = tabs[i].textContent.trim();
        for (var j = 0; j < tabNames.length; j++) {{
            if (text.includes(tabNames[j])) {{
                tabs[i].click();
                return 'clicked: ' + text;
            }}
        }}
    }}
    
    // Try shreddit custom elements
    var shredditTabs = document.querySelectorAll('shreddit-composer-type-picker button');
    for (var i = 0; i < shredditTabs.length; i++) {{
        var text = shredditTabs[i].textContent.trim();
        for (var j = 0; j < tabNames.length; j++) {{
            if (text.includes(tabNames[j])) {{
                shredditTabs[i].click();
                return 'clicked_shreddit: ' + text;
            }}
        }}
    }}
    
    return 'no_tab_found';
}})();
'''
        result = self._run_js(js_code)
        if result and result.startswith('clicked'):
            time.sleep(1)
            return True
        logger.warning(f"Could not select post type tab: {result}")
        return False
    
    def enter_title(self, title: str) -> bool:
        """Enter the post title."""
        escaped_title = (title
            .replace('\\', '\\\\')
            .replace('"', '\\"')
            .replace("'", "\\'")
            .replace('\n', ' ')
            .replace('\r', ' '))
        
        js_code = f'''
(function() {{
    // Old Reddit selectors first (more reliable)
    var selectors = [
        'textarea[name="title"]',
        'input[name="title"]',
        '#title-field textarea',
        '.title textarea',
        // New Reddit fallbacks
        'textarea[placeholder*="title" i]',
        'input[placeholder*="title" i]',
        '[data-testid="post-title-input"]',
        'faceplate-textarea[name="title"]'
    ];
    
    var titleInput = null;
    for (var i = 0; i < selectors.length; i++) {{
        titleInput = document.querySelector(selectors[i]);
        if (titleInput) break;
    }}
    
    if (titleInput) {{
        titleInput.focus();
        titleInput.value = "{escaped_title}";
        titleInput.dispatchEvent(new Event('input', {{bubbles: true}}));
        titleInput.dispatchEvent(new Event('change', {{bubbles: true}}));
        return 'success';
    }}
    
    return 'title_input_not_found';
}})();
'''
        result = self._run_js(js_code)
        if result == 'success':
            return True
        
        # Fallback: use keyboard
        logger.info("Falling back to keyboard entry for title...")
        return self._type_via_keyboard(title)
    
    def enter_body(self, body: str) -> bool:
        """Enter the post body text."""
        escaped_body = (body
            .replace('\\', '\\\\')
            .replace('"', '\\"')
            .replace("'", "\\'")
            .replace('\n', '\\n')
            .replace('\r', ''))
        
        js_code = f'''
(function() {{
    // Old Reddit selectors first (more reliable)
    var selectors = [
        'textarea[name="text"]',
        '#text-field textarea',
        '.usertext-edit textarea',
        'textarea[name="body"]',
        // New Reddit fallbacks
        'div[data-testid="post-content-input"]',
        'div[contenteditable="true"][role="textbox"]',
        '.public-DraftEditor-content',
        '[data-testid="richtext-editor"]',
        'faceplate-textarea[name="body"]'
    ];
    
    var bodyInput = null;
    for (var i = 0; i < selectors.length; i++) {{
        bodyInput = document.querySelector(selectors[i]);
        if (bodyInput) break;
    }}
    
    if (bodyInput) {{
        bodyInput.focus();
        
        if (bodyInput.tagName === 'TEXTAREA' || bodyInput.tagName === 'INPUT') {{
            bodyInput.value = "{escaped_body}";
            bodyInput.dispatchEvent(new Event('input', {{bubbles: true}}));
        }} else {{
            // contenteditable
            bodyInput.textContent = "{escaped_body}";
            bodyInput.dispatchEvent(new InputEvent('input', {{bubbles: true}}));
        }}
        
        return 'success';
    }}
    
    return 'body_input_not_found';
}})();
'''
        result = self._run_js(js_code)
        return result == 'success'
    
    def enter_url(self, url: str) -> bool:
        """Enter the link URL for link posts."""
        escaped_url = url.replace('\\', '\\\\').replace('"', '\\"')
        
        js_code = f'''
(function() {{
    var selectors = [
        'input[name="url"]',
        'input[placeholder*="url" i]',
        'input[placeholder*="link" i]',
        '[data-testid="post-url-input"]',
        'faceplate-text-input[name="url"]'
    ];
    
    var urlInput = null;
    for (var i = 0; i < selectors.length; i++) {{
        urlInput = document.querySelector(selectors[i]);
        if (urlInput) break;
    }}
    
    if (urlInput) {{
        urlInput.focus();
        urlInput.value = "{escaped_url}";
        urlInput.dispatchEvent(new Event('input', {{bubbles: true}}));
        urlInput.dispatchEvent(new Event('change', {{bubbles: true}}));
        return 'success';
    }}
    
    return 'url_input_not_found';
}})();
'''
        result = self._run_js(js_code)
        return result == 'success'
    
    def select_subreddit(self, subreddit: str) -> bool:
        """Select or enter a subreddit."""
        subreddit = subreddit.replace('r/', '').replace('/r/', '').strip()
        
        js_code = f'''
(function() {{
    var subreddit = "{subreddit}";
    
    // Find subreddit selector/input
    var selectors = [
        'input[placeholder*="subreddit" i]',
        'input[placeholder*="community" i]',
        '[data-testid="subreddit-search-input"]',
        'faceplate-search-input[name="community"]',
        'button[aria-label*="community" i]'
    ];
    
    var subInput = null;
    for (var i = 0; i < selectors.length; i++) {{
        subInput = document.querySelector(selectors[i]);
        if (subInput) break;
    }}
    
    if (subInput) {{
        if (subInput.tagName === 'BUTTON') {{
            subInput.click();
            return 'clicked_dropdown';
        }}
        subInput.focus();
        subInput.value = subreddit;
        subInput.dispatchEvent(new Event('input', {{bubbles: true}}));
        return 'typed';
    }}
    
    return 'subreddit_input_not_found';
}})();
'''
        result = self._run_js(js_code)
        
        if result == 'clicked_dropdown':
            time.sleep(0.5)
            # Now type the subreddit
            self._type_via_keyboard(subreddit)
            time.sleep(1)
            # Press Enter to select
            self._press_enter()
            return True
        
        if result == 'typed':
            time.sleep(1)
            self._press_enter()
            return True
        
        return False
    
    def upload_media(self, media_path: str) -> bool:
        """Upload an image or video file."""
        if not os.path.exists(media_path):
            logger.error(f"Media file not found: {media_path}")
            return False
        
        abs_path = os.path.abspath(media_path)
        
        # Click on the file input to trigger upload
        js_code = '''
(function() {
    var fileInputs = document.querySelectorAll('input[type="file"]');
    if (fileInputs.length > 0) {
        return 'file_input_found';
    }
    
    // Try to find upload button
    var uploadBtn = document.querySelector('[data-testid="image-upload-button"]') ||
                   document.querySelector('button[aria-label*="upload" i]') ||
                   document.querySelector('label[for*="file"]');
    
    if (uploadBtn) {
        uploadBtn.click();
        return 'clicked_upload';
    }
    
    return 'no_upload_found';
})();
'''
        result = self._run_js(js_code)
        
        if 'found' in result or 'clicked' in result:
            time.sleep(1)
            # Use AppleScript to handle file dialog
            return self._handle_file_dialog(abs_path)
        
        logger.warning(f"Could not find upload element: {result}")
        return False
    
    def _handle_file_dialog(self, file_path: str) -> bool:
        """Handle the macOS file dialog for uploading."""
        script = f'''
tell application "System Events"
    tell process "Safari"
        delay 1
        -- Check if file dialog is open
        if exists sheet 1 of window 1 then
            keystroke "g" using {{command down, shift down}}
            delay 0.5
            keystroke "{file_path}"
            delay 0.3
            keystroke return
            delay 0.5
            click button "Open" of sheet 1 of window 1
            return "uploaded"
        end if
    end tell
end tell
'''
        # First, trigger the file input click
        trigger_js = '''
(function() {
    var fileInput = document.querySelector('input[type="file"]');
    if (fileInput) {
        fileInput.click();
        return 'clicked';
    }
    return 'not_found';
})();
'''
        self._run_js(trigger_js)
        time.sleep(1)
        
        success, result = self._run_applescript(script)
        return success and result == "uploaded"
    
    def toggle_nsfw(self, enabled: bool = True) -> bool:
        """Toggle NSFW tag."""
        js_code = f'''
(function() {{
    var nsfwBtn = document.querySelector('[data-testid="nsfw-button"]') ||
                 document.querySelector('button[aria-label*="NSFW" i]') ||
                 document.querySelector('label:has(input[name="nsfw"])');
    
    if (nsfwBtn) {{
        var isEnabled = nsfwBtn.classList.contains('active') ||
                       nsfwBtn.getAttribute('aria-pressed') === 'true';
        
        if (isEnabled !== {str(enabled).lower()}) {{
            nsfwBtn.click();
            return 'toggled';
        }}
        return 'already_set';
    }}
    return 'not_found';
}})();
'''
        result = self._run_js(js_code)
        return result in ['toggled', 'already_set']
    
    def toggle_spoiler(self, enabled: bool = True) -> bool:
        """Toggle spoiler tag."""
        js_code = f'''
(function() {{
    var spoilerBtn = document.querySelector('[data-testid="spoiler-button"]') ||
                    document.querySelector('button[aria-label*="spoiler" i]') ||
                    document.querySelector('label:has(input[name="spoiler"])');
    
    if (spoilerBtn) {{
        var isEnabled = spoilerBtn.classList.contains('active') ||
                       spoilerBtn.getAttribute('aria-pressed') === 'true';
        
        if (isEnabled !== {str(enabled).lower()}) {{
            spoilerBtn.click();
            return 'toggled';
        }}
        return 'already_set';
    }}
    return 'not_found';
}})();
'''
        result = self._run_js(js_code)
        return result in ['toggled', 'already_set']
    
    def select_flair(self, flair_text: str) -> bool:
        """Select a post flair."""
        escaped_flair = flair_text.replace('"', '\\"')
        
        js_code = f'''
(function() {{
    // Click flair button first
    var flairBtn = document.querySelector('[data-testid="flair-button"]') ||
                  document.querySelector('button[aria-label*="flair" i]') ||
                  document.querySelector('button:has(span:contains("Flair"))');
    
    if (!flairBtn) return 'flair_button_not_found';
    
    flairBtn.click();
    return 'flair_menu_opened';
}})();
'''
        result = self._run_js(js_code)
        
        if result == 'flair_menu_opened':
            time.sleep(1)
            # Now select the flair
            select_js = f'''
(function() {{
    var flairs = document.querySelectorAll('[role="menuitem"], [role="option"]');
    for (var i = 0; i < flairs.length; i++) {{
        if (flairs[i].textContent.includes("{escaped_flair}")) {{
            flairs[i].click();
            return 'selected';
        }}
    }}
    return 'flair_not_found';
}})();
'''
            return self._run_js(select_js) == 'selected'
        
        return False
    
    def click_post_button(self) -> bool:
        """Click the Post/Submit button."""
        js_code = '''
(function() {
    // Old Reddit selectors first (more reliable)
    var selectors = [
        'button[name="submit"]',
        '#submit button',
        '.submit-page button[type="submit"]',
        'button.submit',
        // New Reddit fallbacks
        'button[type="submit"]',
        '[data-testid="post-submit-button"]',
        'faceplate-button[type="submit"]'
    ];
    
    var submitBtn = null;
    for (var i = 0; i < selectors.length; i++) {
        submitBtn = document.querySelector(selectors[i]);
        if (submitBtn) break;
    }
    
    // Fallback: find button with "submit" or "post" text
    if (!submitBtn) {
        var buttons = document.querySelectorAll('button, input[type="submit"]');
        for (var i = 0; i < buttons.length; i++) {
            var text = (buttons[i].textContent || buttons[i].value || '').trim().toLowerCase();
            if (text === 'post' || text === 'submit') {
                submitBtn = buttons[i];
                break;
            }
        }
    }
    
    if (submitBtn && !submitBtn.disabled) {
        submitBtn.click();
        return 'clicked';
    } else if (submitBtn && submitBtn.disabled) {
        return 'button_disabled';
    }
    
    return 'button_not_found';
})();
'''
        result = self._run_js(js_code)
        if result == 'clicked':
            time.sleep(3)
            return True
        
        logger.warning(f"Submit button issue: {result}")
        return False
    
    def verify_post_success(self, max_wait: int = 15) -> PostResult:
        """Verify that the post was submitted successfully."""
        for i in range(max_wait):
            time.sleep(1)
            
            current_url = self.get_current_url()
            if not current_url:
                continue
            
            # Check if we're on a post page (successful submission)
            # Reddit post URLs: /r/subreddit/comments/post_id/...
            match = re.search(r'/r/(\w+)/comments/(\w+)', current_url)
            if match:
                subreddit = match.group(1)
                post_id = match.group(2)
                logger.success(f"✅ Reddit post successful! ID: {post_id}")
                return PostResult(
                    success=True,
                    post_url=current_url,
                    post_id=post_id,
                    subreddit=subreddit
                )
            
            # Check for error messages
            error_js = '''
(function() {
    var errors = document.querySelectorAll('[class*="error"], [role="alert"]');
    for (var i = 0; i < errors.length; i++) {
        var text = errors[i].textContent.trim();
        if (text.length > 5 && text.length < 500) {
            return text;
        }
    }
    return '';
})();
'''
            error = self._run_js(error_js)
            if error:
                return PostResult(success=False, error=error)
            
            logger.debug(f"Waiting for post confirmation... ({i+1}/{max_wait})")
        
        return PostResult(success=False, error="verification_timeout")
    
    def _type_via_keyboard(self, text: str) -> bool:
        """Type text using keyboard simulation."""
        escaped = text.replace('\\', '\\\\').replace('"', '\\"')
        script = f'''
tell application "System Events"
    tell process "Safari"
        keystroke "{escaped}"
    end tell
end tell
'''
        success, _ = self._run_applescript(script)
        return success
    
    def _press_enter(self) -> bool:
        """Press Enter key."""
        script = '''
tell application "System Events"
    tell process "Safari"
        keystroke return
    end tell
end tell
'''
        success, _ = self._run_applescript(script)
        return success
    
    def post(self, reddit_post: RedditPost) -> PostResult:
        """
        Post to Reddit via Safari automation.
        
        Args:
            reddit_post: RedditPost object with all post details
            
        Returns:
            PostResult with success status and details
        """
        logger.info(f"Posting to r/{reddit_post.subreddit}: {reddit_post.title[:50]}...")
        
        # Validate title
        if len(reddit_post.title) > 300:
            return PostResult(
                success=False,
                error=f'Title too long: {len(reddit_post.title)} chars (max 300)'
            )
        
        # Rate limiting
        if self.last_post_time:
            elapsed = time.time() - self.last_post_time
            if elapsed < self.min_interval_seconds:
                wait_time = self.min_interval_seconds - elapsed
                logger.info(f"Rate limiting: waiting {wait_time:.1f}s")
                time.sleep(wait_time)
        
        try:
            # Step 1: Check login status
            if not self.require_login():
                return PostResult(
                    success=False,
                    error='Not logged in to Reddit. Please log in manually first.'
                )
            logger.info("✅ Login verified")
            
            # Step 2: Open submit page for the subreddit
            logger.info(f"Opening submit page for r/{reddit_post.subreddit}...")
            self.open_submit_page(reddit_post.subreddit)
            time.sleep(2)
            
            # Step 3: Select post type
            if reddit_post.post_type != PostType.TEXT:
                self.select_post_type(reddit_post.post_type)
                time.sleep(1)
            
            # Step 4: Enter title
            logger.info("Entering title...")
            if not self.enter_title(reddit_post.title):
                return PostResult(success=False, error='Failed to enter title')
            time.sleep(0.5)
            
            # Step 5: Enter content based on post type
            if reddit_post.post_type == PostType.TEXT and reddit_post.body:
                logger.info("Entering body text...")
                if not self.enter_body(reddit_post.body):
                    logger.warning("Could not enter body text, continuing anyway")
            
            elif reddit_post.post_type == PostType.LINK and reddit_post.url:
                logger.info("Entering URL...")
                if not self.enter_url(reddit_post.url):
                    return PostResult(success=False, error='Failed to enter URL')
            
            elif reddit_post.post_type in [PostType.IMAGE, PostType.VIDEO] and reddit_post.media_path:
                logger.info("Uploading media...")
                if not self.upload_media(reddit_post.media_path):
                    return PostResult(success=False, error='Failed to upload media')
                time.sleep(3)  # Wait for upload
            
            # Step 6: Set flair if specified
            if reddit_post.flair:
                logger.info(f"Selecting flair: {reddit_post.flair}")
                self.select_flair(reddit_post.flair)
            
            # Step 7: Set NSFW/Spoiler tags
            if reddit_post.nsfw:
                self.toggle_nsfw(True)
            if reddit_post.spoiler:
                self.toggle_spoiler(True)
            
            time.sleep(1)
            
            # Step 8: Click Post button
            logger.info("Submitting post...")
            if not self.click_post_button():
                return PostResult(success=False, error='Failed to click post button')
            
            # Step 9: Verify success
            result = self.verify_post_success()
            
            if result.success:
                self.last_post_time = time.time()
            
            return result
            
        except Exception as e:
            logger.exception(f"Error posting to Reddit: {e}")
            return PostResult(success=False, error=str(e))
    
    def post_text(self, subreddit: str, title: str, body: Optional[str] = None, 
                  flair: Optional[str] = None, nsfw: bool = False) -> PostResult:
        """Convenience method for text posts."""
        post = RedditPost(
            title=title,
            subreddit=subreddit,
            post_type=PostType.TEXT,
            body=body,
            flair=flair,
            nsfw=nsfw
        )
        return self.post(post)
    
    def post_link(self, subreddit: str, title: str, url: str,
                  flair: Optional[str] = None, nsfw: bool = False) -> PostResult:
        """Convenience method for link posts."""
        post = RedditPost(
            title=title,
            subreddit=subreddit,
            post_type=PostType.LINK,
            url=url,
            flair=flair,
            nsfw=nsfw
        )
        return self.post(post)
    
    def post_image(self, subreddit: str, title: str, image_path: str,
                   flair: Optional[str] = None, nsfw: bool = False) -> PostResult:
        """Convenience method for image posts."""
        post = RedditPost(
            title=title,
            subreddit=subreddit,
            post_type=PostType.IMAGE,
            media_path=image_path,
            flair=flair,
            nsfw=nsfw
        )
        return self.post(post)
    
    def post_video(self, subreddit: str, title: str, video_path: str,
                   flair: Optional[str] = None, nsfw: bool = False) -> PostResult:
        """Convenience method for video posts."""
        post = RedditPost(
            title=title,
            subreddit=subreddit,
            post_type=PostType.VIDEO,
            media_path=video_path,
            flair=flair,
            nsfw=nsfw
        )
        return self.post(post)


# Convenience function
def require_reddit_login() -> bool:
    """Check if logged into Reddit before automation."""
    manager = SafariSessionManager()
    return manager.require_login(Platform.REDDIT)


# ==================== CLI ====================

def main():
    import argparse
    
    parser = argparse.ArgumentParser(
        description="Safari Reddit Poster - Post to Reddit via Safari automation",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s --check-login
  %(prog)s text -s AskReddit -t "What's your favorite food?" -b "Mine is pizza"
  %(prog)s link -s technology -t "Cool article" -u "https://example.com"
  %(prog)s image -s pics -t "My cat" -m "/path/to/cat.jpg"
"""
    )
    
    parser.add_argument('--check-login', action='store_true', help='Check Reddit login status')
    
    subparsers = parser.add_subparsers(dest='command')
    
    # Text post
    text_parser = subparsers.add_parser('text', help='Create a text post')
    text_parser.add_argument('-s', '--subreddit', required=True, help='Subreddit name')
    text_parser.add_argument('-t', '--title', required=True, help='Post title')
    text_parser.add_argument('-b', '--body', help='Post body text')
    text_parser.add_argument('-f', '--flair', help='Post flair')
    text_parser.add_argument('--nsfw', action='store_true', help='Mark as NSFW')
    
    # Link post
    link_parser = subparsers.add_parser('link', help='Create a link post')
    link_parser.add_argument('-s', '--subreddit', required=True, help='Subreddit name')
    link_parser.add_argument('-t', '--title', required=True, help='Post title')
    link_parser.add_argument('-u', '--url', required=True, help='Link URL')
    link_parser.add_argument('-f', '--flair', help='Post flair')
    link_parser.add_argument('--nsfw', action='store_true', help='Mark as NSFW')
    
    # Image post
    image_parser = subparsers.add_parser('image', help='Create an image post')
    image_parser.add_argument('-s', '--subreddit', required=True, help='Subreddit name')
    image_parser.add_argument('-t', '--title', required=True, help='Post title')
    image_parser.add_argument('-m', '--media', required=True, help='Path to image file')
    image_parser.add_argument('-f', '--flair', help='Post flair')
    image_parser.add_argument('--nsfw', action='store_true', help='Mark as NSFW')
    
    # Video post
    video_parser = subparsers.add_parser('video', help='Create a video post')
    video_parser.add_argument('-s', '--subreddit', required=True, help='Subreddit name')
    video_parser.add_argument('-t', '--title', required=True, help='Post title')
    video_parser.add_argument('-m', '--media', required=True, help='Path to video file')
    video_parser.add_argument('-f', '--flair', help='Post flair')
    video_parser.add_argument('--nsfw', action='store_true', help='Mark as NSFW')
    
    args = parser.parse_args()
    
    poster = SafariRedditPoster()
    
    if args.check_login:
        poster.activate_safari()
        poster.navigate(poster.REDDIT_HOME)
        time.sleep(3)
        status = poster.check_login_status()
        if status.get('logged_in'):
            print(f"✅ Logged into Reddit as: {status.get('username', 'unknown')}")
        else:
            print(f"❌ Not logged into Reddit: {status.get('reason', 'unknown')}")
            print(f"   Please log in at: {poster.REDDIT_LOGIN}")
        return
    
    if args.command == 'text':
        result = poster.post_text(
            subreddit=args.subreddit,
            title=args.title,
            body=args.body,
            flair=args.flair,
            nsfw=args.nsfw
        )
    elif args.command == 'link':
        result = poster.post_link(
            subreddit=args.subreddit,
            title=args.title,
            url=args.url,
            flair=args.flair,
            nsfw=args.nsfw
        )
    elif args.command == 'image':
        result = poster.post_image(
            subreddit=args.subreddit,
            title=args.title,
            image_path=args.media,
            flair=args.flair,
            nsfw=args.nsfw
        )
    elif args.command == 'video':
        result = poster.post_video(
            subreddit=args.subreddit,
            title=args.title,
            video_path=args.media,
            flair=args.flair,
            nsfw=args.nsfw
        )
    else:
        parser.print_help()
        return
    
    if result.success:
        print(f"✅ Post created successfully!")
        print(f"   URL: {result.post_url}")
        print(f"   ID: {result.post_id}")
    else:
        print(f"❌ Failed to create post: {result.error}")


if __name__ == "__main__":
    main()
