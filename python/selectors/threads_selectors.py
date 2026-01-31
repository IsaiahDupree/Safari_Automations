"""
Threads DOM Selectors - Verified paths for Safari automation.

Last verified: January 23, 2026
Threads Version: Web (threads.net / threads.com)

These selectors are used by:
- threads_auto_commenter.py
- safari_threads_poster.py
"""

from dataclasses import dataclass
from typing import Dict, List


@dataclass
class ThreadsSelectors:
    """All verified CSS selectors for Threads automation."""
    
    # =========================================================================
    # NAVIGATION
    # =========================================================================
    NAV_HOME = 'svg[aria-label="Home"]'
    NAV_SEARCH = 'svg[aria-label="Search"]'
    NAV_CREATE = 'svg[aria-label="Create"]'
    NAV_NOTIFICATIONS = 'svg[aria-label="Notifications"]'
    NAV_PROFILE = 'svg[aria-label="Profile"]'
    NAV_MORE = 'svg[aria-label="More"]'
    NAV_BACK = 'svg[aria-label="Back"]'
    
    # =========================================================================
    # POST ACTIONS (on individual posts)
    # =========================================================================
    ACTION_LIKE = 'svg[aria-label="Like"]'
    ACTION_UNLIKE = 'svg[aria-label="Unlike"]'
    ACTION_REPLY = 'svg[aria-label="Reply"]'
    ACTION_REPOST = 'svg[aria-label="Repost"]'
    ACTION_SHARE = 'svg[aria-label="Share"]'
    ACTION_MORE = 'svg[aria-label="More"]'
    ACTION_AUDIO_MUTED = 'svg[aria-label="Audio is muted"]'
    
    # =========================================================================
    # COMPOSER (Reply/Create)
    # =========================================================================
    # Primary text input - contenteditable div with textbox role
    COMPOSER_INPUT = '[role="textbox"][contenteditable="true"]'
    COMPOSER_INPUT_ALT = '[contenteditable="true"]'
    COMPOSER_INPUT_ARIA = '[aria-label*="Empty text field"]'
    
    # Expand inline composer to modal
    COMPOSER_EXPAND = 'svg[aria-label="Expand composer"]'
    
    # Submit buttons
    COMPOSER_SUBMIT_REPLY = 'svg[aria-label="Reply"]'
    COMPOSER_SUBMIT_CREATE = 'svg[aria-label="Create"]'
    
    # Options
    COMPOSER_MARK_SPOILER = 'div[role="button"]'  # Contains "Mark spoiler" text
    
    # =========================================================================
    # CONTENT CONTAINERS
    # =========================================================================
    # Post/comment container (Threads uses this instead of <article>)
    POST_CONTAINER = '[data-pressable-container="true"]'
    
    # User links (profile links)
    USER_LINK = 'a[href*="/@"]'
    
    # Post links (to individual posts)
    POST_LINK = 'a[href*="/post/"]'
    
    # Timestamp
    TIMESTAMP = 'time'
    
    # Text content within posts
    TEXT_CONTENT = '[dir="auto"] span'
    TEXT_CONTENT_ALT = '[dir="ltr"] span'
    
    # =========================================================================
    # MODAL/DIALOG
    # =========================================================================
    DIALOG = '[role="dialog"]'
    DIALOG_CLOSE = 'svg[aria-label="Close"]'
    
    # =========================================================================
    # PROFILE PAGE
    # =========================================================================
    PROFILE_POSTS_TAB = '[role="tab"]'  # Contains "Threads" text
    PROFILE_REPLIES_TAB = '[role="tab"]'  # Contains "Replies" text
    
    # =========================================================================
    # ACTIVITY/NOTIFICATIONS PAGE
    # =========================================================================
    ACTIVITY_ITEM = '[role="listitem"]'
    
    # =========================================================================
    # BUTTON GENERIC
    # =========================================================================
    ROLE_BUTTON = '[role="button"]'
    BUTTON_DISABLED = '[aria-disabled="true"]'
    
    @classmethod
    def get_parent_button(cls, selector: str) -> str:
        """Get JS to find parent button of an element."""
        return f'document.querySelector("{selector}").closest("[role=\\"button\\"]")'
    
    @classmethod
    def click_svg_button(cls, aria_label: str) -> str:
        """Generate JS to click an SVG button by aria-label."""
        return f'''
            (function() {{
                var svg = document.querySelector('svg[aria-label="{aria_label}"]');
                if (svg) {{
                    var btn = svg.closest('[role="button"]') || svg.parentElement;
                    if (btn) {{
                        btn.click();
                        return 'clicked';
                    }}
                }}
                return 'not_found';
            }})();
        '''
    
    @classmethod
    def get_all_selectors(cls) -> Dict[str, str]:
        """Return all selectors as a dictionary."""
        return {
            # Navigation
            'nav_home': cls.NAV_HOME,
            'nav_search': cls.NAV_SEARCH,
            'nav_create': cls.NAV_CREATE,
            'nav_notifications': cls.NAV_NOTIFICATIONS,
            'nav_profile': cls.NAV_PROFILE,
            'nav_more': cls.NAV_MORE,
            'nav_back': cls.NAV_BACK,
            
            # Actions
            'action_like': cls.ACTION_LIKE,
            'action_unlike': cls.ACTION_UNLIKE,
            'action_reply': cls.ACTION_REPLY,
            'action_repost': cls.ACTION_REPOST,
            'action_share': cls.ACTION_SHARE,
            'action_more': cls.ACTION_MORE,
            
            # Composer
            'composer_input': cls.COMPOSER_INPUT,
            'composer_input_alt': cls.COMPOSER_INPUT_ALT,
            'composer_expand': cls.COMPOSER_EXPAND,
            'composer_submit_reply': cls.COMPOSER_SUBMIT_REPLY,
            'composer_submit_create': cls.COMPOSER_SUBMIT_CREATE,
            
            # Content
            'post_container': cls.POST_CONTAINER,
            'user_link': cls.USER_LINK,
            'post_link': cls.POST_LINK,
            'timestamp': cls.TIMESTAMP,
            'text_content': cls.TEXT_CONTENT,
            
            # Modal
            'dialog': cls.DIALOG,
            'dialog_close': cls.DIALOG_CLOSE,
        }


# =========================================================================
# JAVASCRIPT TEMPLATES
# =========================================================================

class ThreadsJS:
    """JavaScript templates for Threads automation."""
    
    @staticmethod
    def extract_comments(limit: int = 50) -> str:
        """JS to extract comments from a thread page."""
        return f'''
            (function() {{
                var comments = [];
                var containers = document.querySelectorAll('[data-pressable-container="true"]');
                
                // Skip first container (main post), get comments
                for (var i = 1; i < Math.min(containers.length, {limit + 1}); i++) {{
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
                    if (postLink) {{
                        var match = postLink.href.match(/\\/post\\/([A-Za-z0-9_-]+)/);
                        postId = match ? match[1] : 'comment_' + i;
                    }} else {{
                        postId = 'comment_' + i;
                    }}
                    
                    if (username && text) {{
                        comments.push({{
                            comment_id: postId,
                            username: username,
                            text: text.substring(0, 500),
                            timestamp: timestamp
                        }});
                    }}
                }}
                
                return JSON.stringify(comments);
            }})();
        '''
    
    @staticmethod
    def click_reply_button() -> str:
        """JS to click the reply button on current post."""
        return '''
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
        '''
    
    @staticmethod
    def type_in_composer(text: str) -> str:
        """JS to type text in the composer input."""
        escaped = text.replace('\\', '\\\\').replace('"', '\\"').replace("'", "\\'").replace('\n', '\\n')
        return f'''
            (function() {{
                var input = document.querySelector('[role="textbox"][contenteditable="true"]');
                if (!input) {{
                    input = document.querySelector('[contenteditable="true"]');
                }}
                if (input) {{
                    input.focus();
                    input.innerText = '{escaped}';
                    input.dispatchEvent(new InputEvent('input', {{ bubbles: true }}));
                    return 'typed';
                }}
                return 'input_not_found';
            }})();
        '''
    
    @staticmethod
    def submit_reply() -> str:
        """JS to submit the reply (click second Reply button or Post button)."""
        return '''
            (function() {
                // Look for the submit Reply button (second one on page when composer is open)
                var replyBtns = document.querySelectorAll('svg[aria-label="Reply"]');
                if (replyBtns.length >= 2) {
                    var btn = replyBtns[1].closest('[role="button"]') || replyBtns[1].parentElement;
                    if (btn && !btn.getAttribute('aria-disabled')) {
                        btn.click();
                        return 'clicked_reply';
                    }
                }
                
                // Fallback: look for Post button
                var buttons = document.querySelectorAll('[role="button"]');
                for (var i = 0; i < buttons.length; i++) {
                    var text = (buttons[i].innerText || '').trim();
                    if (text === 'Post' && !buttons[i].getAttribute('aria-disabled')) {
                        buttons[i].click();
                        return 'clicked_post';
                    }
                }
                
                // Fallback: Create button
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
        '''
    
    @staticmethod
    def get_post_details() -> str:
        """JS to get details of the current post."""
        return '''
            (function() {
                var container = document.querySelector('[data-pressable-container="true"]');
                if (!container) return JSON.stringify({error: 'no_container'});
                
                var userLink = container.querySelector('a[href*="/@"]');
                var username = userLink ? userLink.href.split('/@').pop().split('/')[0] : '';
                
                var textEl = container.querySelector('[dir="auto"] span');
                var text = textEl ? textEl.innerText : '';
                
                var timeEl = container.querySelector('time');
                var timestamp = timeEl ? timeEl.getAttribute('datetime') : '';
                
                var postLink = container.querySelector('a[href*="/post/"]');
                var postId = '';
                if (postLink) {
                    var match = postLink.href.match(/\\/post\\/([A-Za-z0-9_-]+)/);
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
        '''
    
    @staticmethod
    def click_back_button() -> str:
        """JS to click the Back button to return to previous page."""
        return '''
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
        '''
    
    @staticmethod
    def scroll_and_load(scroll_count: int = 3) -> str:
        """JS to scroll down to load more content."""
        return f'''
            (async function() {{
                for (var i = 0; i < {scroll_count}; i++) {{
                    window.scrollTo(0, document.body.scrollHeight);
                    await new Promise(r => setTimeout(r, 800));
                }}
                window.scrollTo(0, 0);
                return 'scrolled';
            }})();
        '''
    
    @staticmethod
    def check_login_status() -> str:
        """JS to check if user is logged in."""
        return '''
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
        '''


# =========================================================================
# URL PATTERNS
# =========================================================================

class ThreadsURLs:
    """URL patterns for Threads."""
    
    BASE = "https://www.threads.net"
    BASE_ALT = "https://www.threads.com"
    
    HOME = f"{BASE}/"
    LOGIN = f"{BASE}/login"
    ACTIVITY = f"{BASE}/activity"
    SEARCH = f"{BASE}/search"
    
    @classmethod
    def profile(cls, username: str) -> str:
        """Get profile URL for username."""
        username = username.lstrip('@')
        return f"{cls.BASE}/@{username}"
    
    @classmethod
    def post(cls, username: str, post_id: str) -> str:
        """Get post URL."""
        username = username.lstrip('@')
        return f"{cls.BASE}/@{username}/post/{post_id}"
    
    @classmethod
    def extract_post_id(cls, url: str) -> str:
        """Extract post ID from URL."""
        import re
        match = re.search(r'/post/([A-Za-z0-9_-]+)', url)
        return match.group(1) if match else ""
    
    @classmethod
    def extract_username(cls, url: str) -> str:
        """Extract username from URL."""
        import re
        match = re.search(r'/@([A-Za-z0-9_.]+)', url)
        return match.group(1) if match else ""


# Export for easy import
SELECTORS = ThreadsSelectors()
JS = ThreadsJS()
URLS = ThreadsURLs()
