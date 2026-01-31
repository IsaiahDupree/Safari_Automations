"""
Instagram DOM Selectors - Verified paths for Safari automation.

Last verified: January 23, 2026
Instagram Version: Web (instagram.com)

These selectors are used by:
- instagram_comment_automation.py
- instagram_feed_auto_commenter.py
"""

from dataclasses import dataclass
from typing import Dict


@dataclass
class InstagramSelectors:
    """All verified CSS selectors for Instagram automation."""
    
    # =========================================================================
    # NAVIGATION
    # =========================================================================
    NAV_HOME = 'svg[aria-label="Home"]'
    NAV_SEARCH = 'svg[aria-label="Search"]'
    NAV_EXPLORE = 'svg[aria-label="Explore"]'
    NAV_REELS = 'svg[aria-label="Reels"]'
    NAV_MESSAGES = 'svg[aria-label="Messages"]'
    NAV_NOTIFICATIONS = 'svg[aria-label="Notifications"]'
    NAV_NEW_POST = 'svg[aria-label="New post"]'
    NAV_PROFILE = 'svg[aria-label="Profile"]'
    NAV_SETTINGS = 'svg[aria-label="Settings"]'
    
    # =========================================================================
    # POST ACTIONS
    # =========================================================================
    ACTION_LIKE = 'svg[aria-label="Like"]'
    ACTION_UNLIKE = 'svg[aria-label="Unlike"]'
    ACTION_COMMENT = 'svg[aria-label="Comment"]'
    ACTION_SHARE = 'svg[aria-label="Share"]'
    ACTION_SAVE = 'svg[aria-label="Save"]'
    ACTION_MORE = 'svg[aria-label="More options"]'
    
    # =========================================================================
    # CONTENT CONTAINERS
    # =========================================================================
    POST_ARTICLE = 'article'
    POST_LINK = 'a[href*="/p/"], a[href*="/reel/"]'
    USER_LINK = 'a[href^="/"][href$="/"]'
    CAPTION_TEXT = 'span[dir="auto"]'
    
    # =========================================================================
    # COMMENT INPUT
    # =========================================================================
    COMMENT_TEXTAREA = 'textarea[placeholder*="comment" i], textarea[aria-label*="comment" i]'
    COMMENT_TEXTAREA_ADD = 'textarea[placeholder*="Add a comment" i]'
    COMMENT_POST_BUTTON = 'button[type="submit"]'
    COMMENT_POST_TEXT = 'div[role="button"]:has-text("Post")'
    
    # =========================================================================
    # MODAL/DIALOG
    # =========================================================================
    DIALOG = '[role="dialog"]'
    DIALOG_CLOSE = 'svg[aria-label="Close"]'
    
    # =========================================================================
    # LOGIN
    # =========================================================================
    LOGIN_CHECK = 'svg[aria-label="Home"]'
    LOGIN_FORM = 'form input[name="username"]'
    
    @classmethod
    def get_all_selectors(cls) -> Dict[str, str]:
        """Return all selectors as a dictionary."""
        return {
            'nav_home': cls.NAV_HOME,
            'nav_search': cls.NAV_SEARCH,
            'nav_explore': cls.NAV_EXPLORE,
            'nav_reels': cls.NAV_REELS,
            'nav_messages': cls.NAV_MESSAGES,
            'nav_notifications': cls.NAV_NOTIFICATIONS,
            'nav_new_post': cls.NAV_NEW_POST,
            'action_like': cls.ACTION_LIKE,
            'action_unlike': cls.ACTION_UNLIKE,
            'action_comment': cls.ACTION_COMMENT,
            'action_share': cls.ACTION_SHARE,
            'action_save': cls.ACTION_SAVE,
            'post_article': cls.POST_ARTICLE,
            'post_link': cls.POST_LINK,
            'comment_textarea': cls.COMMENT_TEXTAREA,
            'comment_post_button': cls.COMMENT_POST_BUTTON,
        }


class InstagramJS:
    """JavaScript templates for Instagram automation."""
    
    @staticmethod
    def check_login() -> str:
        """JS to check if user is logged in."""
        return '''
            (function() {
                var homeIcon = document.querySelector('svg[aria-label="Home"]');
                var profileLink = document.querySelector('a[href*="/accounts/edit"]');
                return (homeIcon || profileLink) ? 'logged_in' : 'not_logged_in';
            })();
        '''
    
    @staticmethod
    def get_feed_posts(limit: int = 5) -> str:
        """JS to get posts from the feed."""
        return f'''
            (function() {{
                var posts = [];
                var articles = document.querySelectorAll('article');
                
                articles.forEach(function(article, i) {{
                    if (i < {limit}) {{
                        var userLink = article.querySelector('a[href^="/"][href$="/"]');
                        var username = '';
                        if (userLink) {{
                            var match = userLink.href.match(/instagram\\.com\\/([^\\/\\?]+)/);
                            username = match ? match[1] : '';
                        }}
                        
                        var postLink = article.querySelector('a[href*="/p/"], a[href*="/reel/"]');
                        var postUrl = postLink ? postLink.href : '';
                        
                        var captionEl = article.querySelector('span[dir="auto"]');
                        var caption = captionEl ? captionEl.innerText.substring(0, 200) : '';
                        
                        if (postUrl) {{
                            posts.push({{
                                index: i,
                                username: username,
                                postUrl: postUrl,
                                caption: caption
                            }});
                        }}
                    }}
                }});
                
                return JSON.stringify(posts);
            }})();
        '''
    
    @staticmethod
    def click_comment_button(article_index: int = 0) -> str:
        """JS to click the comment button on a specific article."""
        return f'''
            (function() {{
                var articles = document.querySelectorAll('article');
                if (articles.length > {article_index}) {{
                    var commentBtn = articles[{article_index}].querySelector('svg[aria-label="Comment"]');
                    if (commentBtn) {{
                        var parent = commentBtn.closest('button') || commentBtn.closest('[role="button"]') || commentBtn.parentElement;
                        if (parent) {{
                            parent.click();
                            return 'clicked';
                        }}
                    }}
                }}
                return 'not_found';
            }})();
        '''
    
    @staticmethod
    def focus_comment_input() -> str:
        """JS to find and focus the comment input."""
        return '''
            (function() {
                var selectors = [
                    'textarea[placeholder*="comment" i]',
                    'textarea[aria-label*="comment" i]',
                    'textarea[placeholder*="Add a comment" i]',
                    'form textarea'
                ];
                
                for (var i = 0; i < selectors.length; i++) {
                    var input = document.querySelector(selectors[i]);
                    if (input && input.offsetParent !== null) {
                        input.focus();
                        input.click();
                        return 'found';
                    }
                }
                return 'not_found';
            })();
        '''
    
    @staticmethod
    def type_comment(text: str) -> str:
        """JS to type text into the focused comment input."""
        escaped = text.replace('\\', '\\\\').replace('"', '\\"').replace("'", "\\'").replace('\n', '\\n')
        return f'''
            (function() {{
                var input = document.activeElement;
                if (input && input.tagName === 'TEXTAREA') {{
                    input.value = '{escaped}';
                    input.dispatchEvent(new Event('input', {{ bubbles: true }}));
                    input.dispatchEvent(new Event('change', {{ bubbles: true }}));
                    return 'typed';
                }}
                
                // Try to find textarea if not focused
                var textarea = document.querySelector('textarea[placeholder*="comment" i]');
                if (textarea) {{
                    textarea.focus();
                    textarea.value = '{escaped}';
                    textarea.dispatchEvent(new Event('input', {{ bubbles: true }}));
                    return 'typed';
                }}
                
                return 'not_found';
            }})();
        '''
    
    @staticmethod
    def submit_comment() -> str:
        """JS to submit the comment."""
        return '''
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
                
                // Fallback: press Enter
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
        '''
    
    @staticmethod
    def extract_post_context() -> str:
        """JS to extract current post details including comments."""
        return '''
            (function() {
                var result = {post: {}, comments: []};
                
                // Get main post content
                var article = document.querySelector('article');
                if (!article) {
                    // Modal view
                    var dialog = document.querySelector('[role="dialog"]');
                    article = dialog ? dialog.querySelector('article') || dialog : null;
                }
                
                if (article) {
                    // Username
                    var userLink = article.querySelector('a[href^="/"][href$="/"]');
                    if (userLink) {
                        var match = userLink.href.match(/instagram\\.com\\/([^\\/\\?]+)/);
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
                    
                    // Image alt text
                    var images = article.querySelectorAll('img[alt]');
                    var alts = [];
                    images.forEach(function(img) {
                        if (img.alt && !img.alt.includes('profile') && img.alt.length > 5) {
                            alts.push(img.alt);
                        }
                    });
                    result.post.imageAlt = alts.slice(0, 3);
                    
                    // Comments (look for comment list)
                    var commentElements = article.querySelectorAll('ul li');
                    commentElements.forEach(function(li, i) {
                        if (i < 5 && i > 0) { // Skip first (usually caption)
                            var uLink = li.querySelector('a[href^="/"]');
                            var uname = '';
                            if (uLink) {
                                var m = uLink.href.match(/instagram\\.com\\/([^\\/\\?]+)/);
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
        '''
    
    @staticmethod
    def click_back_or_close() -> str:
        """JS to close modal or go back."""
        return '''
            (function() {
                // Try close button on modal
                var closeBtn = document.querySelector('svg[aria-label="Close"]');
                if (closeBtn) {
                    var btn = closeBtn.closest('button') || closeBtn.closest('[role="button"]') || closeBtn.parentElement;
                    if (btn) {
                        btn.click();
                        return 'closed_modal';
                    }
                }
                
                // Press Escape
                document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', code: 'Escape', keyCode: 27}));
                return 'escape_pressed';
            })();
        '''
    
    @staticmethod
    def scroll_feed() -> str:
        """JS to scroll the feed to load more posts."""
        return '''
            (function() {
                window.scrollBy(0, window.innerHeight * 0.8);
                return 'scrolled';
            })();
        '''


class InstagramURLs:
    """URL patterns for Instagram."""
    
    BASE = "https://www.instagram.com"
    HOME = f"{BASE}/"
    EXPLORE = f"{BASE}/explore/"
    REELS = f"{BASE}/reels/"
    DIRECT = f"{BASE}/direct/inbox/"
    
    @classmethod
    def profile(cls, username: str) -> str:
        username = username.lstrip('@')
        return f"{cls.BASE}/{username}/"
    
    @classmethod
    def post(cls, shortcode: str) -> str:
        return f"{cls.BASE}/p/{shortcode}/"
    
    @classmethod
    def reel(cls, shortcode: str) -> str:
        return f"{cls.BASE}/reel/{shortcode}/"


# Exports
SELECTORS = InstagramSelectors()
JS = InstagramJS()
URLS = InstagramURLs()
