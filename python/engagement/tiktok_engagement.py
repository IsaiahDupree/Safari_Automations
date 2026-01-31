"""
TikTok Engagement Automation
Complete automation for TikTok interactions: navigation, likes, comments, follows, and messaging.
"""
import asyncio
import random
import sys
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Optional, Any
from loguru import logger

# Add parent directory to path
sys.path.append(str(Path(__file__).parent.parent))

from automation.safari_app_controller import SafariAppController
from automation.tiktok_session_manager import TikTokSessionManager
from automation.tiktok_login_automation_v2 import TikTokLoginAutomationV2

# Import centralized Safari session manager
try:
    from automation.safari_session_manager import SafariSessionManager, Platform
    HAS_SAFARI_SESSION_MANAGER = True
except ImportError:
    HAS_SAFARI_SESSION_MANAGER = False
    logger.warning("Safari session manager not available")

# Try to import extension bridge (optional - falls back to AppleScript if not available)
try:
    from automation.safari_extension_bridge import SafariExtensionBridge
    EXTENSION_AVAILABLE = True
except ImportError:
    EXTENSION_AVAILABLE = False
    SafariExtensionBridge = None


class TikTokEngagement:
    """
    TikTok engagement automation with state management.
    
    Supports:
    - Navigation to any TikTok page
    - Like/unlike videos
    - Post comments
    - Follow/unfollow users
    - Send direct messages
    - Session persistence
    """
    
    # TikTok element selectors
    # Priority: data-e2e (most stable) > class*="DivName" > generic
    SELECTORS = {
        # Engagement buttons
        "like_button": '[data-e2e="like-icon"], [data-e2e="browse-like-icon"], [class*="DivLikeWrapper"] button',
        "like_count": '[data-e2e="like-count"], [data-e2e="browse-like-count"]',
        "comment_button": '[data-e2e="comment-icon"], [data-e2e="browse-comment-icon"], [class*="DivCommentWrapper"] button',
        "comment_count": '[data-e2e="comment-count"]',
        "share_button": '[data-e2e="share-icon"], [data-e2e="browse-share-icon"], [class*="DivShareWrapper"] button',
        "share_count": '[data-e2e="share-count"], [data-e2e="browse-share-count"]',
        "save_button": '[data-e2e="bookmark-icon"], [data-e2e="undefined-icon"], [class*="DivBookmarkWrapper"] button',
        "save_count": '[data-e2e="bookmark-count"], [data-e2e="undefined-count"]',
        "follow_button": '[data-e2e="follow-button"], [class*="DivFollowButton"]',
        
        # Comments - using stable data-e2e + class*= fallbacks
        "comment_input": '[data-e2e="comment-input"], [data-e2e="comment-text"], [contenteditable="true"], [placeholder*="comment" i]',
        "comment_post": '[data-e2e="comment-post"], [class*="DivPostButton"], button[type="submit"]',
        "comment_post_button": '[data-e2e="comment-post"], [class*="DivPostButton"]',
        "comment_list": '[data-e2e="comment-list"], [class*="DivCommentListContainer"]',
        "comment_items": '[data-e2e="comment-item"], [class*="DivCommentItemWrapper"]',
        "comment_username": '[data-e2e="comment-username-1"], [class*="DivCommentUsername"]',
        "comment_text": '[data-e2e="comment-level-1"], [class*="DivCommentContentWrapper"] > span',
        "comment_footer": '[class*="DivCommentFooter"]',
        
        # Profile
        "profile_icon": '[data-e2e="profile-icon"]',
        "user_avatar": '[data-e2e="user-avatar"]',
        "user_link": 'a[href*="/@"]',
        
        # Video info
        "video_player": '[data-e2e="browse-video"], video',
        "video_caption": '[data-e2e="browse-video-desc"]',
        "video_username": '[data-e2e="browse-username"], a[href*="/@"]',
        "video_music": '[data-e2e="video-music"]',
        
        # Navigation sidebar - using class*= pattern for stability
        "nav_for_you": 'a[href="/foryou"], a[href="/en/"]',
        "nav_shop": 'a[href*="shop"]',
        "nav_explore": 'a[href*="explore"]',
        "nav_following": 'a[href="/following"]',
        "nav_friends": 'a[href*="friends"]',
        "nav_live": 'a[href*="live"]',
        "nav_messages": 'a[href*="messages"], [data-e2e="inbox-icon"]',
        "nav_activity": 'a[href*="activity"]',
        "nav_upload": 'a[href*="upload"]',
        "nav_profile": 'a[href*="profile"], [data-e2e="profile-icon"]',
        "nav_container": '[class*="DivMainNavContainer"]',
        
        # General navigation
        "inbox_icon": '[data-e2e="inbox-icon"]',
        "search_input": 'input[type="search"], [data-e2e="search-input"]',
        "home_link": 'a[href="/en/"]',
        
        # Messaging - using class*= pattern for DM elements
        "message_input": '[data-e2e="messenger-input"], [class*="DivMessageInputAndSendButton"] [contenteditable="true"], [placeholder*="message" i]',
        "message_send": '[data-e2e="messenger-send"], [class*="DivMessageInputAndSendButton"] button',
        "message_list": '[data-e2e="messenger-list"]',
        "messages_list": '[class*="DivConversationList"]',
        "message_conversation": '[class*="DivConversationItem"]',
        "message_username": '[class*="SpanNickname"]',
        "message_preview": '[class*="SpanLastMessage"]',
        "message_content": '[class*="DivMessageContent"]',
        "message_chat_main": '[class*="DivChatMain"]',
        "message_input_bar": '[class*="DivMessageInputAndSendButton"]',
    }
    
    def __init__(self, 
                 browser_type: str = "safari",
                 auto_restore_session: bool = True):
        """
        Initialize TikTok engagement automation.
        
        Args:
            browser_type: "safari" or "chrome"
            auto_restore_session: If True, automatically restore saved session
        """
        self.browser_type = browser_type
        self.auto_restore_session = auto_restore_session
        
        # Controllers
        self.safari_controller: Optional[SafariAppController] = None
        self.login_automation: Optional[TikTokLoginAutomationV2] = None
        self.session_manager = TikTokSessionManager()
        
        # Extension bridge (for Draft.js typing)
        self.extension_bridge: Optional[SafariExtensionBridge] = None
        if EXTENSION_AVAILABLE:
            try:
                self.extension_bridge = SafariExtensionBridge()
                logger.debug("✅ Safari extension bridge initialized")
            except Exception as e:
                logger.warning(f"⚠️ Could not initialize extension bridge: {e}")
        
        # State
        self.is_initialized = False
        self.is_logged_in = False
        self.current_url = ""
        
        # Centralized Safari session manager
        self.safari_session_manager = None
        if HAS_SAFARI_SESSION_MANAGER:
            self.safari_session_manager = SafariSessionManager()
    
    # ==================== Initialization ====================
    
    async def start(self, url: str = "https://www.tiktok.com/en/", find_existing: bool = True) -> bool:
        """
        Start the browser and initialize the automation.
        
        Args:
            url: Initial URL to navigate to
            find_existing: If True, try to find existing Safari window with TikTok
            
        Returns:
            True if started successfully.
        """
        try:
            # Load saved state
            self.session_manager.load_state_from_file()
            
            if self.browser_type == "safari":
                self.safari_controller = SafariAppController()
                
                # Try to find existing TikTok window first
                if find_existing:
                    logger.info("🔍 Looking for existing Safari window with TikTok...")
                    found = await self.safari_controller.activate_tiktok_window(require_logged_in=True)
                    
                    if found:
                        logger.info("✅ Found existing TikTok session, using it")
                        await asyncio.sleep(2)
                        # Get current URL
                        self.current_url = await self.get_current_url()
                        # Check login status
                        await self.check_login_status()
                    else:
                        logger.info("📝 No existing TikTok session found, opening new one...")
                        await self.safari_controller.launch_safari(url)
                else:
                    await self.safari_controller.launch_safari(url)
            else:
                self.login_automation = TikTokLoginAutomationV2(
                    browser_type=self.browser_type,
                    use_profile=True
                )
                await self.login_automation.start_browser()
            
            self.is_initialized = True
            self.current_url = url
            self.session_manager.update_state(
                page_type=self.session_manager.detect_page_type(url),
                current_url=url
            )
            
            # Wait for page to load
            await asyncio.sleep(3)
            
            # Check login status
            await self.check_login_status()
            
            logger.success("✅ TikTok Engagement started")
            return True
            
        except Exception as e:
            logger.error(f"Failed to start: {e}")
            return False
    
    async def check_login_status(self) -> bool:
        """
        Check if user is logged in.
        
        Returns:
            True if logged in.
        """
        try:
            if self.login_automation:
                status = await self.login_automation.check_login_status()
                self.is_logged_in = status.get('logged_in', False)
            else:
                # Check Safari for login indicators
                result = await self._run_js("""
                    (function() {
                        var profileIcon = document.querySelector('[data-e2e="profile-icon"]');
                        var uploadIcon = document.querySelector('[data-e2e="upload-icon"]');
                        return (profileIcon || uploadIcon) ? 'logged_in' : 'not_logged_in';
                    })();
                """)
                self.is_logged_in = 'logged_in' in result.lower()
            
            if self.is_logged_in:
                logger.info("✅ User is logged in")
            else:
                logger.warning("⚠️ User is not logged in")
            
            return self.is_logged_in
            
        except Exception as e:
            logger.debug(f"Login check error: {e}")
            return False
    
    # ==================== Navigation ====================
    
    async def navigate_to_url(self, url: str) -> bool:
        """
        Navigate to any TikTok URL.
        
        Args:
            url: URL to navigate to
            
        Returns:
            True if navigation successful.
        """
        try:
            # Rate limit check
            if not self.session_manager.can_perform_action("navigation"):
                logger.warning("Rate limit reached for navigation")
                return False
            
            # Add delay
            delay = self.session_manager.get_wait_time_for_action("navigation")
            await asyncio.sleep(delay)
            
            if self.safari_controller:
                script = f'''
                tell application "Safari"
                    tell front window
                        set URL of current tab to "{url}"
                    end tell
                end tell
                '''
                self.safari_controller._run_applescript(script)
            elif self.login_automation and self.login_automation.page:
                await self.login_automation.page.goto(url)
            
            self.current_url = url
            page_type = self.session_manager.detect_page_type(url)
            self.session_manager.update_state(page_type=page_type, current_url=url)
            self.session_manager.add_action("navigation", {"url": url, "page_type": page_type})
            
            # Wait for page load
            await asyncio.sleep(2)
            
            logger.info(f"📍 Navigated to: {url[:60]}...")
            return True
            
        except Exception as e:
            logger.error(f"Navigation error: {e}")
            return False
    
    async def navigate_to_fyp(self) -> bool:
        """Navigate to the For You Page."""
        return await self.navigate_to_url("https://www.tiktok.com/foryou")
    
    async def navigate_to_profile(self, username: str) -> bool:
        """
        Navigate to a user's profile.
        
        Args:
            username: TikTok username (with or without @)
        """
        if not username.startswith("@"):
            username = f"@{username}"
        return await self.navigate_to_url(f"https://www.tiktok.com/{username}")
    
    async def navigate_to_video(self, video_url: str) -> bool:
        """Navigate to a specific video."""
        return await self.navigate_to_url(video_url)
    
    async def go_to_next_video(self) -> bool:
        """
        Navigate to the next video on FYP (swipe down or press down arrow).
        
        Returns:
            True if navigation was successful.
        """
        try:
            if self.safari_controller:
                # Use JavaScript to scroll or use keyboard
                # TikTok FYP uses arrow keys or swipe gestures
                script = '''
                tell application "Safari"
                    tell front window
                        tell current tab
                            do JavaScript "window.scrollBy(0, window.innerHeight);"
                        end tell
                    end tell
                end tell
                '''
                self.safari_controller._run_applescript(script)
                await asyncio.sleep(1)  # Wait for video to load
                
                # Update current URL
                self.current_url = await self.get_current_url()
                return True
            elif self.login_automation and self.login_automation.page:
                # Use Playwright keyboard
                await self.login_automation.page.keyboard.press("ArrowDown")
                await asyncio.sleep(1)
                self.current_url = self.login_automation.page.url
                return True
            return False
        except Exception as e:
            logger.error(f"Go to next video error: {e}")
            return False
    
    async def get_current_url(self) -> str:
        """
        Get the current page URL.
        
        Returns:
            Current URL string.
        """
        try:
            if self.safari_controller:
                script = '''
                tell application "Safari"
                    tell front window
                        tell current tab
                            return URL
                        end tell
                    end tell
                end tell
                '''
                url = self.safari_controller._run_applescript(script).strip()
                self.current_url = url
                return url
            elif self.login_automation and self.login_automation.page:
                url = self.login_automation.page.url
                self.current_url = url
                return url
            return self.current_url or ""
        except Exception as e:
            logger.debug(f"Get current URL error: {e}")
            return self.current_url or ""
    
    async def get_current_video_info(self) -> Dict:
        """
        Get information about the current video.
        
        Returns:
            Dict with username, caption, video_id, etc.
        """
        try:
            # Use simpler JavaScript that avoids escaping issues
            js_code = """
            (function() {
                var info = {};
                var usernameEl = document.querySelector('[data-e2e="browse-username"]') || document.querySelector('a[href*="/@"]');
                if (usernameEl) {
                    var href = usernameEl.getAttribute('href') || '';
                    var match = href.match(/@([^/]+)/);
                    info.username = match ? match[1] : usernameEl.textContent.trim().replace('@', '');
                }
                var captionEl = document.querySelector('[data-e2e="browse-video-desc"]');
                if (captionEl) {
                    info.caption = captionEl.textContent.trim();
                }
                var url = window.location.href;
                var videoMatch = url.match(/\\/video\\/(\\d+)/);
                if (videoMatch) {
                    info.video_id = videoMatch[1];
                }
                var likeCountEl = document.querySelector('[data-e2e="like-count"]');
                if (likeCountEl) {
                    info.like_count = likeCountEl.textContent.trim();
                }
                return JSON.stringify(info);
            })();
            """
            
            result = await self._run_js(js_code)
            if result:
                import json
                try:
                    return json.loads(result)
                except json.JSONDecodeError:
                    pass
            
            return {}
        except Exception as e:
            logger.debug(f"Get video info error: {e}")
            return {}
    
    async def search(self, query: str) -> bool:
        """
        Search for content on TikTok.
        
        Args:
            query: Search query
            
        Returns:
            True if search was performed.
        """
        encoded_query = query.replace(" ", "%20")
        return await self.navigate_to_url(f"https://www.tiktok.com/search?q={encoded_query}")
    
    # ==================== Engagement Actions ====================
    
    async def like_current_video(self) -> bool:
        """
        Like the current video.
        
        Returns:
            True if like was successful.
        """
        try:
            if not self.session_manager.can_perform_action("like"):
                logger.warning("Rate limit reached for likes")
                return False
            
            delay = self.session_manager.get_wait_time_for_action("like")
            await asyncio.sleep(delay)
            
            result = await self._click_element(self.SELECTORS["like_button"])
            
            if result:
                self.session_manager.add_action("like", {"url": self.current_url})
                logger.info("❤️ Liked video")
            
            return result
            
        except Exception as e:
            logger.error(f"Like error: {e}")
            return False
    
    async def is_video_liked(self) -> bool:
        """
        Check if the current video is already liked.
        
        Returns:
            True if video is liked.
        """
        try:
            result = await self._run_js("""
                (function() {
                    var likeBtn = document.querySelector('[data-e2e="like-icon"], [data-e2e="browse-like-icon"]');
                    if (likeBtn) {
                        // Check if the like button has active/liked state
                        var svg = likeBtn.querySelector('svg');
                        if (svg) {
                            var fill = svg.getAttribute('fill') || '';
                            var className = likeBtn.className || '';
                            return (fill.includes('rgb(254') || className.includes('active')) ? 'liked' : 'not_liked';
                        }
                    }
                    return 'unknown';
                })();
            """)
            return 'liked' in result.lower()
        except:
            return False
    
    async def open_comments(self) -> bool:
        """
        Open the comments section.
        
        Returns:
            True if comments opened.
        """
        result = await self._click_element(self.SELECTORS["comment_button"])
        if result:
            await asyncio.sleep(1)  # Wait for comments to load
            logger.info("💬 Comments opened")
        return result
    
    async def post_comment(self, text: str, verify: bool = True, use_extension: bool = True) -> Dict:
        """
        Post a comment on the current video.
        
        Comment posting flow:
        1. Open comments panel (clicks comment-icon button)
        2. Click on comment input field (data-e2e="comment-input" or "comment-text")
        3. Type the comment text
        4. Click post button (data-e2e="comment-post")
        5. Verify comment appears in comments list (optional)
        
        Args:
            text: Comment text to post
            verify: If True, verify comment appears after posting
            use_extension: If True and extension is available, use extension's complete flow
            
        Returns:
            Dict with success status, posted text, and verification result
        """
        try:
            if not self.session_manager.can_perform_action("comment"):
                logger.warning("Rate limit reached for comments")
                return {"success": False, "error": "rate_limit", "text": text}
            
            if not self.is_logged_in:
                logger.warning("Must be logged in to comment")
                return {"success": False, "error": "not_logged_in", "text": text}
            
            delay = self.session_manager.get_wait_time_for_action("comment")
            await asyncio.sleep(delay)
            
            # Try using extension's complete flow if available and requested
            if use_extension and self.extension_bridge:
                try:
                    logger.info("🎯 Using Safari extension for comment posting...")
                    result = self.extension_bridge.post_comment(text, verify=verify)
                    
                    if result.get("success"):
                        self.session_manager.add_action("comment", {
                            "url": self.current_url,
                            "text": text[:100],
                            "text_length": len(text)
                        })
                        logger.info(f"💬 Posted comment via extension: {text[:30]}...")
                        return {
                            "success": True,
                            "text": text,
                            "verified": result.get("verification", {}).get("success", False),
                            "method": "extension"
                        }
                    else:
                        logger.warning(f"Extension posting failed: {result.get('error')}, falling back to manual flow")
                except Exception as e:
                    logger.warning(f"Extension error: {e}, falling back to manual flow")
            
            # Manual flow (original implementation)
            # Step 1: Open comments panel
            await self.open_comments()
            await asyncio.sleep(1)
            
            # Step 2: Find and click comment input field
            # TikTok uses data-e2e="comment-input" or "comment-text" for the input field
            input_clicked = await self._click_element(self.SELECTORS["comment_input"])
            if not input_clicked:
                # Try alternative selector
                input_clicked = await self._click_element('[data-e2e="comment-text"]')
            await asyncio.sleep(0.5)
            
            # Step 3: Type the comment text
            await self._type_text(text)
            await asyncio.sleep(0.5)
            
            # Step 4: Click post button (data-e2e="comment-post")
            post_clicked = await self._click_element(self.SELECTORS["comment_post"])
            
            if post_clicked:
                self.session_manager.add_action("comment", {
                    "url": self.current_url,
                    "text": text[:100],
                    "text_length": len(text)
                })
                logger.info(f"💬 Posted comment: {text[:30]}...")
                
                # Step 5: Verify comment appears (optional)
                verified = False
                if verify:
                    await asyncio.sleep(2)  # Wait for comment to appear
                    verified = await self._verify_comment_posted(text)
                    if verified:
                        logger.info("✅ Comment verified in comments list")
                    else:
                        logger.warning("⚠️ Could not verify comment appeared")
                
                return {"success": True, "text": text, "verified": verified, "method": "manual"}
            
            return {"success": False, "error": "post_button_not_clicked", "text": text}
            
        except Exception as e:
            logger.error(f"Comment error: {e}")
            return {"success": False, "error": str(e), "text": text}
    
    async def verify_comment_at_top(self, comment_text: str, username: str = None) -> Dict:
        """
        Verify that a comment appears at the top of the comments list.
        
        Args:
            comment_text: The comment text to look for
            username: Optional username to verify (your username)
            
        Returns:
            Dict with verified (bool), found_at_top (bool), username_match (bool), details
        """
        try:
            await asyncio.sleep(2)  # Wait for comment to appear
            
            # Get first few comments from the top
            js_code = """
            (function() {
                var comments = [];
                var items = document.querySelectorAll('[data-e2e="comment-level-1"]');
                for (var i = 0; i < Math.min(5, items.length); i++) {
                    var item = items[i];
                    var wrapper = item.closest('div[class*="Comment"]');
                    if (!wrapper) wrapper = item.parentElement.parentElement;
                    var userEl = wrapper ? wrapper.querySelector('[data-e2e="comment-username-1"]') : null;
                    if (!userEl) userEl = wrapper ? wrapper.querySelector('a[href*="/@"]') : null;
                    var username = userEl ? userEl.textContent.trim().replace('@', '') : 'unknown';
                    var text = item.textContent.trim();
                    comments.push({username: username, text: text, index: i});
                }
                return JSON.stringify(comments);
            })();
            """
            
            result = await self._run_js(js_code)
            
            if not result or result == "[]":
                return {
                    "verified": False,
                    "found_at_top": False,
                    "username_match": False,
                    "error": "No comments found",
                    "top_comments": []
                }
            
            import json
            try:
                comments = json.loads(result)
            except:
                return {
                    "verified": False,
                    "found_at_top": False,
                    "username_match": False,
                    "error": "Failed to parse comments",
                    "top_comments": []
                }
            
            # Check if our comment is at the top
            found_at_top = False
            username_match = False
            comment_match = False
            
            if comments:
                top_comment = comments[0]
                # Check if text matches (allow partial match)
                comment_lower = comment_text.lower()
                top_text_lower = top_comment.get("text", "").lower()
                
                # Check if comment text appears in top comment
                if comment_lower in top_text_lower or top_text_lower in comment_lower:
                    comment_match = True
                
                # Check if username matches (if provided)
                if username:
                    top_username = top_comment.get("username", "").lower()
                    username_lower = username.lower()
                    if username_lower in top_username or top_username in username_lower:
                        username_match = True
                
                found_at_top = comment_match
            
            verified = found_at_top and (username_match if username else True)
            
            return {
                "verified": verified,
                "found_at_top": found_at_top,
                "username_match": username_match,
                "comment_match": comment_match,
                "top_comments": comments[:3],
                "top_comment": comments[0] if comments else None
            }
            
        except Exception as e:
            logger.error(f"Verify comment error: {e}")
            return {
                "verified": False,
                "found_at_top": False,
                "username_match": False,
                "error": str(e),
                "top_comments": []
            }
    
    async def _verify_comment_posted(self, text: str) -> bool:
        """
        Verify a comment appears in the comments list.
        
        Args:
            text: The comment text to look for
            
        Returns:
            True if comment found
        """
        try:
            # Extract first part of comment for matching
            search_text = text[:30].replace("'", "\\'").replace('"', '\\"')
            
            js_code = f"""
(function(){{
var items=document.querySelectorAll('[data-e2e="comment-level-1"]');
for(var i=0;i<items.length;i++){{
if(items[i].textContent.includes('{search_text}'))return 'found';
}}
return 'not_found';
}})();
            """
            result = await self._run_js(js_code)
            return result == "found" if result else False
        except:
            return False
    
    async def reply_to_comment(
        self, 
        comment_index: int = 0, 
        reply_text: str = "", 
        delay: float = 0.5
    ) -> Dict:
        """
        Reply to a specific comment on the video.
        
        This clicks the "Reply" button on a comment to reply directly to that user.
        
        Args:
            comment_index: Index of comment to reply to (0 = first comment)
            reply_text: Text to reply with
            delay: Delay before action (rate limiting)
            
        Returns:
            Dict with success status and details
        """
        try:
            await asyncio.sleep(delay)
            
            # Step 1: Open comments panel if not already open
            await self.open_comments()
            await asyncio.sleep(1)
            
            # Step 2: Find and click Reply button on the specific comment
            # Reply buttons are inside each comment item wrapper
            # Using class*= selector pattern from reference
            reply_js = f'''(function(){{
var items=document.querySelectorAll("[class*=DivCommentItemWrapper]");
if(items.length<={comment_index})return "no_comment";
var item=items[{comment_index}];
var reply=item.querySelector("span:contains('Reply'),button:contains('Reply'),[class*=Reply]");
if(!reply){{
  var spans=item.querySelectorAll("span");
  for(var i=0;i<spans.length;i++){{
    if(spans[i].textContent.trim()==="Reply"){{reply=spans[i];break;}}
  }}
}}
if(reply){{reply.click();return "clicked";}}
return "reply_not_found";
}})()'''
            
            result = await self._run_js(reply_js)
            
            if result != "clicked":
                logger.warning(f"Could not click Reply button: {result}")
                # Fallback: try to click Reply by text content matching
                fallback_js = f'''(function(){{
var items=document.querySelectorAll("[class*=DivCommentItemWrapper]");
if(items.length<={comment_index})return "no_comment";
var item=items[{comment_index}];
var spans=item.querySelectorAll("span");
for(var i=0;i<spans.length;i++){{
  if(spans[i].textContent.trim()==="Reply"){{
    spans[i].click();
    return "clicked";
  }}
}}
return "reply_not_found";
}})()'''
                result = await self._run_js(fallback_js)
            
            if result != "clicked":
                return {"success": False, "error": result}
                
            await asyncio.sleep(0.5)
            
            # Step 3: Type the reply text (input should now be focused on this comment thread)
            await self._type_text(reply_text)
            await asyncio.sleep(0.5)
            
            # Step 4: Click post button
            post_clicked = await self._click_element(self.SELECTORS["comment_post"])
            
            if post_clicked:
                self.session_manager.add_action("reply_comment", {
                    "url": self.current_url,
                    "comment_index": comment_index,
                    "text": reply_text[:100],
                })
                logger.info(f"↩️ Replied to comment {comment_index}: {reply_text[:30]}...")
                return {"success": True, "text": reply_text, "comment_index": comment_index}
            
            return {"success": False, "error": "post_button_not_clicked"}
            
        except Exception as e:
            logger.error(f"Reply error: {e}")
            return {"success": False, "error": str(e)}

    
    async def get_comments(self, limit: int = 20) -> List[Dict]:
        """
        Get comments from the current video.
        
        Args:
            limit: Maximum number of comments to retrieve
            
        Returns:
            List of comment dicts with username, text, likes
        """
        try:
            # Make sure comments are open
            await self.open_comments()
            await asyncio.sleep(3)  # Wait for comments to fully load
            
            # JavaScript to extract comments using TikTok's data-e2e attributes
            # Key selectors found via DOM inspection:
            # - comment-level-1: the comment text span
            # - comment-username-1: the username div
            js_code = f"""
(function(){{
var c=[];
var items=document.querySelectorAll('[data-e2e="comment-level-1"]');
items.forEach(function(item,i){{
if(i>={limit})return;
var wrapper=item.closest('div[class*="Comment"]');
if(!wrapper)wrapper=item.parentElement.parentElement;
var userEl=wrapper?wrapper.querySelector('[data-e2e="comment-username-1"]'):null;
if(!userEl)userEl=wrapper?wrapper.querySelector('a[href*="/@"]'):null;
var u=userEl?userEl.textContent.trim():'unknown';
u=u.replace(/^@/,'');
var t=item.textContent.trim();
if(t)c.push({{u:u,t:t.substring(0,500)}});
}});
return JSON.stringify(c);
}})();
            """
            
            result = await self._run_js(js_code)
            
            if result and result != "[]":
                import json
                try:
                    raw_comments = json.loads(result)
                    comments = [{"username": c.get("u", ""), "text": c.get("t", ""), "likes": "0", "index": i} for i, c in enumerate(raw_comments)]
                    logger.info(f"📝 Retrieved {len(comments)} comments")
                    return comments
                except json.JSONDecodeError as e:
                    logger.warning(f"⚠️ Failed to parse comments JSON: {e}")
                    return []
            else:
                logger.warning("⚠️ No comments found - comments panel may not be open or video has no comments")
                return []
                
        except Exception as e:
            logger.error(f"Get comments error: {e}")
            return []
    
    async def save_comments(self, filepath: str = None, limit: int = 50) -> Dict:
        """
        Save comments from the current video to a JSON file.
        
        Args:
            filepath: Path to save comments (defaults to sessions/comments_<timestamp>.json)
            limit: Maximum number of comments to save
            
        Returns:
            Dict with save status, filepath, and comment count
        """
        try:
            comments = await self.get_comments(limit=limit)
            
            if not comments:
                return {"success": False, "error": "No comments found", "count": 0}
            
            # Generate default filepath if not provided
            if not filepath:
                timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                filepath = str(Path(__file__).parent / "sessions" / f"comments_{timestamp}.json")
            
            # Prepare data to save
            import json
            save_data = {
                "video_url": self.current_url,
                "saved_at": datetime.now().isoformat(),
                "comment_count": len(comments),
                "comments": comments
            }
            
            # Ensure directory exists
            Path(filepath).parent.mkdir(parents=True, exist_ok=True)
            
            # Save to file
            with open(filepath, "w", encoding="utf-8") as f:
                json.dump(save_data, f, indent=2, ensure_ascii=False)
            
            logger.success(f"💾 Saved {len(comments)} comments to {filepath}")
            
            return {
                "success": True,
                "filepath": filepath,
                "count": len(comments),
                "video_url": self.current_url
            }
            
        except Exception as e:
            logger.error(f"Save comments error: {e}")
            return {"success": False, "error": str(e), "count": 0}
    
    async def share_video(self, copy_link: bool = True) -> Dict:
        """
        Open share options for the current video and optionally copy the link.
        
        Args:
            copy_link: If True, also click copy link button after opening share menu
            
        Returns:
            Dict with share status and video URL.
        """
        try:
            # Click share button
            await self._click_element(self.SELECTORS["share_button"])
            await asyncio.sleep(1.5)
            
            video_url = self.current_url
            link_copied = False
            
            if copy_link:
                # Try to click "Copy link" button in share menu
                copy_link_js = """
(function(){
var btn=document.querySelector('[data-e2e="share-copy-link"]');
if(!btn)btn=document.querySelector('button[aria-label*="Copy link"],button[aria-label*="copy link"],div[data-e2e="copy-link"]');
if(!btn){
  var btns=document.querySelectorAll('button,div[role="button"]');
  for(var i=0;i<btns.length;i++){
    if(btns[i].textContent.toLowerCase().includes('copy link')){btn=btns[i];break;}
  }
}
if(btn){btn.click();return 'clicked';}
return 'not_found';
})();
                """
                result = await self._run_js(copy_link_js)
                link_copied = result == "clicked" if result else False
                await asyncio.sleep(0.5)
                
                if link_copied:
                    logger.info("🔗 Link copied to clipboard")
            
            self.session_manager.add_action("share", {"url": video_url, "link_copied": link_copied})
            logger.info(f"📤 Share menu opened{' and link copied' if link_copied else ''}")
            
            return {"shared": True, "url": video_url, "link_copied": link_copied}
            
        except Exception as e:
            logger.error(f"Share error: {e}")
            return {"shared": False, "url": self.current_url, "error": str(e)}
    
    async def save_video(self) -> bool:
        """
        Save/bookmark the current video to favorites.
        
        Returns:
            True if video was saved/bookmarked.
        """
        try:
            # Click the save/bookmark button
            result = await self._click_element(self.SELECTORS["save_button"])
            
            if result:
                await asyncio.sleep(0.5)
                self.session_manager.add_action("save", {"url": self.current_url})
                logger.info("🔖 Video saved/bookmarked")
                return True
            else:
                logger.warning("⚠️ Save button not found")
                return False
                
        except Exception as e:
            logger.error(f"Save error: {e}")
            return False
    
    async def is_video_saved(self) -> bool:
        """
        Check if the current video is already saved/bookmarked.
        
        Returns:
            True if video is saved.
        """
        try:
            # Check if save button is in "saved" state (usually has aria-pressed or class change)
            js_code = """
(function(){
var btn=document.querySelector('[data-e2e="bookmark-icon"],[data-e2e="undefined-icon"]');
if(!btn)return 'no_button';
var parent=btn.closest('button');
if(!parent)parent=btn.parentElement;
var pressed=parent.getAttribute('aria-pressed');
if(pressed==='true')return 'saved';
var cls=parent.className||'';
var svg=btn.querySelector('svg');
var fill=svg?svg.getAttribute('fill'):'';
if(cls.includes('active')||cls.includes('saved')||fill.includes('#')||fill!=='currentColor')return 'saved';
return 'not_saved';
})();
            """
            result = await self._run_js(js_code)
            return result == "saved" if result else False
        except:
            return False
    
    async def follow_user(self, username: Optional[str] = None) -> bool:
        """
        Follow a user.
        
        Args:
            username: Username to follow (navigates to profile if provided)
            
        Returns:
            True if follow was successful.
        """
        try:
            if not self.session_manager.can_perform_action("follow"):
                logger.warning("Rate limit reached for follows")
                return False
            
            if not self.is_logged_in:
                logger.warning("Must be logged in to follow")
                return False
            
            if username:
                await self.navigate_to_profile(username)
                await asyncio.sleep(2)
            
            delay = self.session_manager.get_wait_time_for_action("follow")
            await asyncio.sleep(delay)
            
            result = await self._click_element(self.SELECTORS["follow_button"])
            
            if result:
                self.session_manager.add_action("follow", {"username": username or "current"})
                logger.info(f"➕ Followed user: {username or 'current profile'}")
            
            return result
            
        except Exception as e:
            logger.error(f"Follow error: {e}")
            return False
    
    # ==================== Messaging ====================
    
    async def open_inbox(self) -> bool:
        """
        Open the inbox/messages section.
        
        Returns:
            True if inbox opened.
        """
        result = await self._click_element(self.SELECTORS["inbox_icon"])
        if result:
            await asyncio.sleep(2)
            self.session_manager.update_state(page_type="inbox")
            logger.info("📬 Inbox opened")
        return result
    
    async def send_dm(self, username: str, message: str) -> bool:
        """
        Send a direct message to a user.
        
        Args:
            username: Username to message
            message: Message text
            
        Returns:
            True if message was sent.
        """
        try:
            if not self.session_manager.can_perform_action("message"):
                logger.warning("Rate limit reached for messages")
                return False
            
            if not self.is_logged_in:
                logger.warning("Must be logged in to message")
                return False
            
            delay = self.session_manager.get_wait_time_for_action("message")
            await asyncio.sleep(delay)
            
            # Navigate to messages with the user
            # This URL pattern may need adjustment
            await self.navigate_to_url(f"https://www.tiktok.com/messages?u={username}")
            await asyncio.sleep(3)
            
            # Find and click message input
            await self._click_element(self.SELECTORS["message_input"])
            await asyncio.sleep(0.5)
            
            # Type message
            await self._type_text(message)
            await asyncio.sleep(0.5)
            
            # Send message
            result = await self._click_element(self.SELECTORS["message_send"])
            
            if result:
                self.session_manager.add_action("message", {
                    "username": username,
                    "message_length": len(message)
                })
                logger.info(f"✉️ Sent message to @{username}")
            
            return result
            
        except Exception as e:
            logger.error(f"Message error: {e}")
            return False
    
    # ==================== Session Management ====================
    
    async def save_session(self) -> bool:
        """
        Save the current session (cookies and state).
        
        Returns:
            True if session was saved.
        """
        try:
            # Save cookies
            if self.safari_controller:
                await self.session_manager.save_cookies_from_safari()
            elif self.login_automation and self.login_automation.context:
                await self.session_manager.save_cookies_from_context(
                    self.login_automation.context
                )
            
            # Save state
            self.session_manager.save_state_to_file()
            
            logger.success("✅ Session saved")
            return True
            
        except Exception as e:
            logger.error(f"Failed to save session: {e}")
            return False
    
    def get_state(self) -> Dict:
        """
        Get the current automation state.
        
        Returns:
            Dict with current state information.
        """
        return {
            "is_initialized": self.is_initialized,
            "is_logged_in": self.is_logged_in,
            "current_url": self.current_url,
            "browser_type": self.browser_type,
            "session": self.session_manager.get_current_state()
        }
    
    def get_action_history(self, limit: int = 50) -> List[Dict]:
        """
        Get the action history.
        
        Args:
            limit: Maximum number of actions to return
            
        Returns:
            List of action records.
        """
        return self.session_manager.get_action_history(limit=limit)
    
    # ==================== Helper Methods ====================
    
    async def _run_js(self, js_code: str) -> str:
        """
        Run JavaScript in the browser.
        
        Args:
            js_code: JavaScript code to execute
            
        Returns:
            Result string from JavaScript.
        """
        try:
            if self.safari_controller:
                script = f'''
                tell application "Safari"
                    tell front window
                        tell current tab
                            do JavaScript "{js_code.replace('"', '\\"').replace(chr(10), ' ')}"
                        end tell
                    end tell
                end tell
                '''
                return self.safari_controller._run_applescript(script)
            elif self.login_automation and self.login_automation.page:
                return await self.login_automation.page.evaluate(js_code)
            return ""
        except Exception as e:
            logger.debug(f"JS execution error: {e}")
            return ""
    
    async def _click_element(self, selector: str) -> bool:
        """
        Click an element by selector.
        
        Args:
            selector: CSS selector
            
        Returns:
            True if click was successful.
        """
        try:
            if self.safari_controller:
                # Use JavaScript to click
                js_code = f"""
                (function() {{
                    var selectors = '{selector}'.split(', ');
                    for (var i = 0; i < selectors.length; i++) {{
                        var el = document.querySelector(selectors[i].trim());
                        if (el) {{
                            el.click();
                            return 'clicked';
                        }}
                    }}
                    return 'not_found';
                }})();
                """
                result = await self._run_js(js_code)
                return 'clicked' in result.lower()
            elif self.login_automation and self.login_automation.page:
                # Try each selector
                for sel in selector.split(", "):
                    try:
                        element = await self.login_automation.page.query_selector(sel.strip())
                        if element:
                            await element.click()
                            return True
                    except:
                        continue
            return False
        except Exception as e:
            logger.debug(f"Click error: {e}")
            return False
    
    async def _type_text(self, text: str) -> bool:
        """
        Type text (simulates keyboard input).
        
        Prefers Safari extension (works with Draft.js) over AppleScript keystroke.
        
        Args:
            text: Text to type
            
        Returns:
            True if typing was successful.
        """
        try:
            # First, try Safari extension (works with Draft.js!)
            if self.extension_bridge:
                try:
                    result = self.extension_bridge.type_comment(text)
                    if result and result.get("success"):
                        # Check if button is active (indicates Draft.js recognized the input)
                        if result.get("buttonActive"):
                            logger.debug("✅ Extension typed successfully, button is active")
                            return True
                        else:
                            logger.warning("⚠️ Extension typed but button not active - Draft.js may not have updated")
                            # Still return True as text was typed, just state may not be updated
                            return True
                except Exception as e:
                    logger.debug(f"Extension typing failed: {e}, falling back to AppleScript")
            
            # Fallback to AppleScript keystroke (doesn't work with Draft.js but may work for other inputs)
            if self.safari_controller:
                script = f'''
                tell application "System Events"
                    tell process "Safari"
                        keystroke "{text.replace('"', '\\"')}"
                    end tell
                end tell
                '''
                self.safari_controller._run_applescript(script)
                logger.warning("⚠️ Used AppleScript keystroke (may not work with Draft.js)")
                return True
            elif self.login_automation and self.login_automation.page:
                await self.login_automation.page.keyboard.type(text, delay=50)
                return True
            return False
        except Exception as e:
            logger.debug(f"Type error: {e}")
            return False
    
    async def cleanup(self) -> None:
        """Clean up resources."""
        try:
            # Save session before cleanup
            await self.save_session()
            
            if self.login_automation:
                await self.login_automation.cleanup()
            
            logger.info("🧹 Cleanup complete")
        except Exception as e:
            logger.debug(f"Cleanup error: {e}")


# ==================== Convenience Functions ====================

async def quick_like_video(video_url: str) -> bool:
    """
    Quickly like a video by URL.
    
    Args:
        video_url: URL of the video to like
        
    Returns:
        True if video was liked.
    """
    engagement = TikTokEngagement()
    try:
        await engagement.start(video_url)
        result = await engagement.like_current_video()
        return result
    finally:
        await engagement.cleanup()


async def quick_comment_video(video_url: str, comment: str) -> bool:
    """
    Quickly comment on a video.
    
    Args:
        video_url: URL of the video
        comment: Comment text
        
    Returns:
        True if comment was posted.
    """
    engagement = TikTokEngagement()
    try:
        await engagement.start(video_url)
        result = await engagement.post_comment(comment)
        return result
    finally:
        await engagement.cleanup()


# =============================================================================
# NOTIFICATIONS FUNCTIONALITY
# =============================================================================

class TikTokNotifications:
    """Read TikTok notifications/activity via Safari."""
    
    INBOX_URL = "https://www.tiktok.com/inbox"
    ACTIVITY_URL = "https://www.tiktok.com/activity"
    
    def __init__(self):
        self.session_manager = SafariSessionManager() if HAS_SAFARI_SESSION_MANAGER else None
    
    def _run_applescript(self, script: str) -> tuple:
        """Execute AppleScript."""
        import subprocess
        try:
            result = subprocess.run(
                ["osascript", "-e", script],
                capture_output=True,
                text=True,
                timeout=60
            )
            if result.returncode == 0:
                return True, result.stdout.strip()
            return False, result.stderr.strip()
        except Exception as e:
            return False, str(e)
    
    def require_login(self) -> bool:
        """Check if logged into TikTok."""
        if self.session_manager:
            return self.session_manager.require_login(Platform.TIKTOK)
        return True
    
    def get_notifications(self, limit: int = 20) -> Dict:
        """
        Get recent notifications from TikTok inbox.
        
        Args:
            limit: Maximum notifications to fetch
        
        Returns:
            Dict with notifications list
        """
        if not self.require_login():
            return {'success': False, 'error': 'Not logged in'}
        
        # Navigate to inbox
        nav_script = f'''
        tell application "Safari"
            activate
            set URL of front document to "{self.INBOX_URL}"
        end tell
        '''
        self._run_applescript(nav_script)
        time.sleep(3)
        
        # Extract notifications
        script = f'''
        tell application "Safari"
            tell front document
                do JavaScript "
                    (function() {{
                        var notifications = [];
                        var items = document.querySelectorAll('[class*=\\"NotificationItem\\"], [class*=\\"DivItemContainer\\"], [data-e2e*=\\"notification\\"]');
                        
                        for (var i = 0; i < Math.min(items.length, {limit}); i++) {{
                            var item = items[i];
                            var textEl = item.querySelector('[class*=\\"Content\\"], span');
                            var userEl = item.querySelector('a[href*=\\"/@\\"]');
                            var timeEl = item.querySelector('[class*=\\"Time\\"], time');
                            var typeEl = item.querySelector('[class*=\\"Type\\"]');
                            
                            if (textEl) {{
                                notifications.push({{
                                    text: textEl.innerText.substring(0, 200),
                                    user: userEl ? userEl.href.split('/@').pop().split('/')[0] : null,
                                    time: timeEl ? timeEl.innerText : null,
                                    type: typeEl ? typeEl.innerText : 'activity'
                                }});
                            }}
                        }}
                        
                        return JSON.stringify(notifications);
                    }})();
                "
            end tell
        end tell
        '''
        success, result = self._run_applescript(script)
        
        if success:
            try:
                import json
                notifications = json.loads(result)
                return {
                    'success': True,
                    'count': len(notifications),
                    'notifications': notifications
                }
            except:
                return {'success': True, 'count': 0, 'notifications': [], 'raw': result}
        
        return {'success': False, 'error': result}
    
    def get_all_activity(self, limit: int = 20) -> Dict:
        """
        Get all activity (likes, comments, follows, mentions).
        
        Returns:
            Dict with activity items
        """
        if not self.require_login():
            return {'success': False, 'error': 'Not logged in'}
        
        # Navigate to activity page (All Activity tab)
        nav_script = '''
        tell application "Safari"
            activate
            set URL of front document to "https://www.tiktok.com/inbox?tab=all"
        end tell
        '''
        self._run_applescript(nav_script)
        time.sleep(3)
        
        # Extract activity
        script = f'''
        tell application "Safari"
            tell front document
                do JavaScript "
                    (function() {{
                        var activities = [];
                        var items = document.querySelectorAll('[class*=\\"ItemContainer\\"], [class*=\\"NotificationItem\\"], article');
                        
                        for (var i = 0; i < Math.min(items.length, {limit}); i++) {{
                            var item = items[i];
                            var contentEl = item.querySelector('[class*=\\"Content\\"], span');
                            var avatarEl = item.querySelector('img[class*=\\"Avatar\\"]');
                            var linkEl = item.querySelector('a[href*=\\"/video/\\"]');
                            
                            if (contentEl) {{
                                activities.push({{
                                    content: contentEl.innerText.substring(0, 200),
                                    has_avatar: !!avatarEl,
                                    video_link: linkEl ? linkEl.href : null
                                }});
                            }}
                        }}
                        
                        return JSON.stringify(activities);
                    }})();
                "
            end tell
        end tell
        '''
        success, result = self._run_applescript(script)
        
        if success:
            try:
                import json
                activities = json.loads(result)
                return {
                    'success': True,
                    'count': len(activities),
                    'activities': activities
                }
            except:
                return {'success': True, 'count': 0, 'activities': [], 'raw': result}
        
        return {'success': False, 'error': result}


# ==================== Main / Test ====================

async def main():
    """Example usage and testing."""
    logger.remove()
    logger.add(
        sys.stdout,
        format="<green>{time:HH:mm:ss}</green> | <level>{level: <8}</level> | <level>{message}</level>",
        level="INFO"
    )
    
    print("=" * 60)
    print("TikTok Engagement Automation")
    print("=" * 60)
    
    engagement = TikTokEngagement(browser_type="safari")
    
    try:
        # Start the browser
        print("\n📱 Starting TikTok...")
        await engagement.start()
        
        print("\n📊 Current state:")
        state = engagement.get_state()
        print(f"   Logged in: {state['is_logged_in']}")
        print(f"   URL: {state['current_url']}")
        
        print("\n🎯 Available commands:")
        print("   1. Navigate to FYP")
        print("   2. Navigate to a profile")
        print("   3. Like current video")
        print("   4. Post a comment")
        print("   5. Show action history")
        print("   6. Save session")
        print("   0. Exit")
        
        while True:
            try:
                choice = input("\nEnter choice (0-6): ").strip()
                
                if choice == "0":
                    break
                elif choice == "1":
                    await engagement.navigate_to_fyp()
                elif choice == "2":
                    username = input("Enter username: ").strip()
                    await engagement.navigate_to_profile(username)
                elif choice == "3":
                    await engagement.like_current_video()
                elif choice == "4":
                    comment = input("Enter comment: ").strip()
                    await engagement.post_comment(comment)
                elif choice == "5":
                    history = engagement.get_action_history(10)
                    print(f"\nLast {len(history)} actions:")
                    for action in history:
                        print(f"   {action['type']}: {action['timestamp']}")
                elif choice == "6":
                    await engagement.save_session()
                else:
                    print("Invalid choice")
                    
            except KeyboardInterrupt:
                break
        
    except Exception as e:
        logger.error(f"Error: {e}")
    finally:
        await engagement.cleanup()
        print("\n👋 Goodbye!")


if __name__ == "__main__":
    asyncio.run(main())
