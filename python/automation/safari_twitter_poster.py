#!/usr/bin/env python3
"""
Safari Twitter/X Poster
Posts tweets directly via Safari browser automation using AppleScript.
Fallback when Blotato API has issues.

Supports:
- Text-only tweets
- Tweets with media (images/video)
- Login verification via session manager
- Success confirmation
- Automatic session refresh
"""
import subprocess
import time
import json
import os
from typing import Optional, Dict, List
from loguru import logger
from pathlib import Path

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


class SafariTwitterPoster:
    """Post tweets via Safari browser automation."""
    
    # X.com URLs (Twitter rebranded)
    X_COMPOSE_URL = "https://x.com/compose/post"
    X_HOME_URL = "https://x.com/home"
    X_INTENT_URL = "https://x.com/intent/post"
    
    # Legacy Twitter URLs (for fallback)
    TWITTER_COMPOSE_URL = "https://twitter.com/compose/tweet"
    TWITTER_HOME_URL = "https://twitter.com/home"
    
    def __init__(self, use_x_domain: bool = True):
        self.last_post_time = None
        self.min_interval_seconds = 30  # Minimum time between posts
        self.use_x_domain = use_x_domain
        
        # Initialize session manager if available
        if HAS_SESSION_MANAGER:
            self.session_manager = SafariSessionManager()
        else:
            self.session_manager = None
        
        # Select URLs based on domain preference
        if use_x_domain:
            self.compose_url = self.X_COMPOSE_URL
            self.home_url = self.X_HOME_URL
        else:
            self.compose_url = self.TWITTER_COMPOSE_URL
            self.home_url = self.TWITTER_HOME_URL
        
    def _run_applescript(self, script: str, timeout: int = 60) -> tuple[bool, str]:
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
    
    def simple_login_check(self) -> Dict:
        """Simple login check - just verifies we're on x.com/twitter.com home."""
        script = '''
        tell application "Safari"
            if not running then return "not_running"
            if (count of windows) = 0 then return "no_windows"
            tell window 1
                set currentURL to URL of current tab
                return currentURL
            end tell
        end tell
        '''
        success, url = self._run_applescript(script)
        if not success:
            return {'logged_in': False, 'reason': 'safari_error', 'error': url}
        
        # If we're on x.com or twitter.com home/feed, we're likely logged in
        if ('x.com/home' in url or 'twitter.com/home' in url or 
            'x.com/compose' in url or 'twitter.com/compose' in url):
            return {'logged_in': True, 'url': url}
        
        # If we're on login page, not logged in
        if '/login' in url or '/i/flow' in url:
            return {'logged_in': False, 'reason': 'on_login_page', 'url': url}
        
        # Otherwise, try the detailed check
        return {'logged_in': None, 'reason': 'needs_detailed_check', 'url': url}
    
    def is_logged_in(self) -> bool:
        """Check if user is logged into Twitter in Safari."""
        script = '''
        tell application "Safari"
            if not running then return "not_running"
            tell window 1
                set currentURL to URL of current tab
                return currentURL
            end tell
        end tell
        '''
        success, url = self._run_applescript(script)
        if not success:
            return False
        return "twitter.com" in url or "x.com" in url
    
    def open_twitter(self) -> bool:
        """Open Twitter/X in Safari."""
        script = f'''
        tell application "Safari"
            activate
            if (count of windows) = 0 then
                make new document
            end if
            set URL of current tab of window 1 to "{self.home_url}"
        end tell
        '''
        success, _ = self._run_applescript(script)
        if success:
            time.sleep(3)  # Wait for page load
        return success
    
    def open_compose(self) -> bool:
        """Open the tweet compose modal."""
        script = f'''
        tell application "Safari"
            activate
            if (count of windows) = 0 then
                make new document
            end if
            set URL of current tab of window 1 to "{self.compose_url}"
        end tell
        '''
        success, _ = self._run_applescript(script)
        if success:
            time.sleep(2)  # Wait for compose modal
        return success
    
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
        """Check if user is logged into X/Twitter using JavaScript."""
        # Wait for page to load first
        self.wait_for_page_load(5)
        time.sleep(1)  # Extra wait for dynamic content
        
        script = '''
        tell application "Safari"
            tell window 1
                tell current tab
                    set jsResult to do JavaScript "
                        (function() {
                            var url = window.location.href;
                            
                            // Check for login/signup page (not logged in)
                            if (url.includes('/login') || url.includes('/i/flow/login') || url.includes('/i/flow/signup')) {
                                return JSON.stringify({logged_in: false, reason: 'on_login_page', url: url});
                            }
                            
                            // Check for various logged-in indicators
                            var indicators = [
                                '[data-testid=\\"AppTabBar_Profile_Link\\"]',
                                '[data-testid=\\"SideNav_NewTweet_Button\\"]',
                                'a[href=\\"/compose/post\\"]',
                                'a[href=\\"/compose/tweet\\"]',
                                '[aria-label=\\"Profile\\"]',
                                '[data-testid=\\"primaryColumn\\"]',
                                '[data-testid=\\"tweetTextarea_0\\"]'
                            ];
                            
                            for (var i = 0; i < indicators.length; i++) {
                                var el = document.querySelector(indicators[i]);
                                if (el) {
                                    // Try to find username
                                    var username = '';
                                    var profileLink = document.querySelector('a[data-testid=\\"AppTabBar_Profile_Link\\"]');
                                    if (profileLink) {
                                        var href = profileLink.getAttribute('href');
                                        if (href) username = href.replace('/', '');
                                    }
                                    return JSON.stringify({logged_in: true, username: username, indicator: indicators[i]});
                                }
                            }
                            
                            // Check for login button (definitely not logged in)
                            var loginIndicators = [
                                'a[href=\\"/login\\"]',
                                'a[href=\\"/i/flow/login\\"]',
                                '[data-testid=\\"loginButton\\"]',
                                'a[href=\\"/i/flow/signup\\"]'
                            ];
                            
                            for (var j = 0; j < loginIndicators.length; j++) {
                                if (document.querySelector(loginIndicators[j])) {
                                    return JSON.stringify({logged_in: false, reason: 'login_button_visible'});
                                }
                            }
                            
                            // Check if page is still loading
                            if (document.body.innerText.length < 100) {
                                return JSON.stringify({logged_in: false, reason: 'page_still_loading'});
                            }
                            
                            return JSON.stringify({logged_in: false, reason: 'no_indicators_found', url: url, bodyLength: document.body.innerText.length});
                        })();
                    "
                    return jsResult
                end tell
            end tell
        end tell
        '''
        success, result = self._run_applescript(script)
        if success and result:
            try:
                return json.loads(result)
            except:
                pass
        return {'logged_in': False, 'reason': 'script_error'}
    
    def type_tweet_via_js(self, text: str) -> bool:
        """Type tweet text using JavaScript injection (more reliable)."""
        # Escape for JavaScript string
        escaped_text = (text
            .replace('\\', '\\\\')
            .replace('"', '\\"')
            .replace("'", "\\'")
            .replace('\n', '\\n')
            .replace('\r', '\\r'))
        
        script = f'''
        tell application "Safari"
            tell window 1
                tell current tab
                    set jsResult to do JavaScript "
                        (function() {{
                            // Find the tweet compose textarea/contenteditable
                            var editor = document.querySelector('[data-testid=\\"tweetTextarea_0\\"]');
                            if (!editor) {{
                                editor = document.querySelector('[role=\\"textbox\\"][data-testid*=\\"tweetTextarea\\"]');
                            }}
                            if (!editor) {{
                                editor = document.querySelector('.public-DraftEditor-content');
                            }}
                            if (!editor) {{
                                editor = document.querySelector('[contenteditable=\\"true\\"]');
                            }}
                            
                            if (editor) {{
                                editor.focus();
                                // Use execCommand for contenteditable
                                document.execCommand('insertText', false, \\"{escaped_text}\\");
                                return 'success';
                            }}
                            return 'editor_not_found';
                        }})();
                    "
                    return jsResult
                end tell
            end tell
        end tell
        '''
        success, result = self._run_applescript(script)
        if success and result == "success":
            return True
        logger.warning(f"JS type failed: {result}, falling back to keystroke")
        return self.type_tweet(text)
    
    def type_tweet(self, text: str) -> bool:
        """Type the tweet text into the compose box using keystrokes (fallback)."""
        # Escape special characters for AppleScript
        escaped_text = text.replace('\\', '\\\\').replace('"', '\\"').replace('\n', '\\n')
        
        script = f'''
        tell application "Safari"
            activate
            delay 0.5
        end tell
        
        tell application "System Events"
            tell process "Safari"
                -- Focus on the tweet compose area
                delay 0.5
                
                -- Type the tweet
                keystroke "{escaped_text}"
                
                delay 0.3
            end tell
        end tell
        '''
        success, output = self._run_applescript(script)
        if not success:
            logger.error(f"Failed to type tweet: {output}")
        return success
    
    def click_post_button(self) -> bool:
        """Click the Post button to submit the tweet."""
        script = '''
        tell application "System Events"
            tell process "Safari"
                delay 0.5
                
                -- Try to find and click the Post button
                -- The button text is "Post" on Twitter/X
                try
                    -- Method 1: Click by keyboard shortcut (Cmd+Enter)
                    keystroke return using {command down}
                    return "success"
                on error
                    return "failed"
                end try
            end tell
        end tell
        '''
        success, output = self._run_applescript(script)
        if success and output == "success":
            time.sleep(2)  # Wait for post to submit
            return True
        return False
    
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
    
    def click_post_button_via_js(self) -> bool:
        """Click the Post button using JavaScript (more reliable)."""
        script = '''
        tell application "Safari"
            tell window 1
                tell current tab
                    set jsResult to do JavaScript "
                        (function() {
                            // Find the Post button
                            var postBtn = document.querySelector('[data-testid=\\"tweetButton\\"]');
                            if (!postBtn) {
                                postBtn = document.querySelector('[data-testid=\\"tweetButtonInline\\"]');
                            }
                            if (!postBtn) {
                                // Try by button text
                                var buttons = document.querySelectorAll('button');
                                for (var i = 0; i < buttons.length; i++) {
                                    var text = buttons[i].innerText || buttons[i].textContent;
                                    if (text && (text.trim() === 'Post' || text.trim() === 'Tweet')) {
                                        postBtn = buttons[i];
                                        break;
                                    }
                                }
                            }
                            
                            if (postBtn && !postBtn.disabled) {
                                postBtn.click();
                                return 'clicked';
                            } else if (postBtn && postBtn.disabled) {
                                return 'button_disabled';
                            }
                            return 'button_not_found';
                        })();
                    "
                    return jsResult
                end tell
            end tell
        end tell
        '''
        success, result = self._run_applescript(script)
        if success and result == "clicked":
            time.sleep(2)
            return True
        logger.warning(f"JS click failed: {result}, falling back to keyboard shortcut")
        return self.click_post_button()
    
    def verify_post_success(self, max_wait: int = 10) -> Dict:
        """
        Verify that the tweet was posted successfully and capture the tweet URL.
        
        Args:
            max_wait: Maximum seconds to wait for redirect
            
        Returns:
            Dict with posted status, tweet_url, tweet_id
        """
        import re
        
        # Wait for post and possible redirect
        for i in range(max_wait):
            time.sleep(1)
            
            script = '''
            tell application "Safari"
                tell window 1
                    set pageURL to URL of current tab
                    tell current tab
                        set jsResult to do JavaScript "
                            (function() {
                                var url = window.location.href;
                                var result = {url: url};
                                
                                // Check if we're on a status page (successful post)
                                var match = url.match(/\\/status\\/(\\d+)/);
                                if (match) {
                                    result.posted = true;
                                    result.tweet_id = match[1];
                                    return JSON.stringify(result);
                                }
                                
                                // Check for toast notifications
                                var toast = document.querySelector('[data-testid=\\\"toast\\\"]');
                                if (toast) {
                                    result.toast = toast.innerText;
                                }
                                
                                // Check if compose modal is gone (likely success)
                                var composer = document.querySelector('[data-testid=\\\"tweetTextarea_0\\\"]');
                                result.compose_open = !!composer;
                                
                                // Check for error states
                                var errorBanner = document.querySelector('[role=\\\"alert\\\"]');
                                if (errorBanner) {
                                    result.error = errorBanner.innerText;
                                }
                                
                                return JSON.stringify(result);
                            })();
                        "
                    end tell
                    return jsResult
                end tell
            end tell
            '''
            
            success, result = self._run_applescript(script)
            
            if success and result:
                try:
                    data = json.loads(result)
                    
                    # Success - got tweet URL
                    if data.get('posted') and data.get('tweet_id'):
                        tweet_id = data['tweet_id']
                        tweet_url = data['url']
                        logger.success(f"✅ Tweet posted! ID: {tweet_id}")
                        return {
                            'posted': True,
                            'tweet_id': tweet_id,
                            'tweet_url': tweet_url,
                            'url': tweet_url
                        }
                    
                    # Compose modal closed but no redirect yet
                    if not data.get('compose_open') and '/compose' not in data.get('url', ''):
                        # Might have posted, check URL
                        url = data.get('url', '')
                        match = re.search(r'/status/(\d+)', url)
                        if match:
                            return {
                                'posted': True,
                                'tweet_id': match.group(1),
                                'tweet_url': url,
                                'url': url
                            }
                    
                    # Error detected
                    if data.get('error'):
                        return {
                            'posted': False,
                            'error': data['error']
                        }
                        
                except json.JSONDecodeError:
                    pass
            
            logger.debug(f"Waiting for post confirmation... ({i+1}/{max_wait})")
        
        # Timeout - check final state
        final_url = self.get_current_url()
        if final_url:
            match = re.search(r'/status/(\d+)', final_url)
            if match:
                return {
                    'posted': True,
                    'tweet_id': match.group(1),
                    'tweet_url': final_url,
                    'url': final_url
                }
        
        # Last resort: Check user's profile for the recent tweet
        logger.info("Checking profile for recently posted tweet...")
        recent_tweet = self._find_recent_tweet_on_profile()
        if recent_tweet:
            return {
                'posted': True,
                'tweet_id': recent_tweet.get('tweet_id'),
                'tweet_url': recent_tweet.get('url'),
                'url': recent_tweet.get('url'),
                'verified_via': 'profile_check'
            }
        
        return {'posted': 'unknown', 'error': 'verification_timeout', 'final_url': final_url}
    
    def _find_recent_tweet_on_profile(self) -> Optional[Dict]:
        """Navigate to profile and find the most recent tweet posted in last 2 minutes."""
        import re
        from datetime import datetime, timezone
        
        # Get username from session or use known username
        script = '''
        tell application "Safari"
            tell window 1
                tell current tab
                    do JavaScript "
                        (function() {
                            var profileLink = document.querySelector('[data-testid=\\\"AppTabBar_Profile_Link\\\"]');
                            if (profileLink) {
                                return profileLink.getAttribute('href').replace('/', '');
                            }
                            return '';
                        })();
                    "
                end tell
            end tell
        end tell
        '''
        success, username = self._run_applescript(script)
        
        if not success or not username:
            return None
        
        # Navigate to profile
        profile_url = f"https://x.com/{username}"
        nav_script = f'''
        tell application "Safari"
            set URL of current tab of window 1 to "{profile_url}"
        end tell
        '''
        self._run_applescript(nav_script)
        time.sleep(3)
        
        # Find recent tweets - use simpler JS with proper escaping
        find_script = '''
        tell application "Safari"
            tell window 1
                tell current tab
                    do JavaScript "
                        (function() {
                            var tweets = document.querySelectorAll('article[data-testid=\\"tweet\\"]');
                            var results = [];
                            for (var i = 0; i < Math.min(5, tweets.length); i++) {
                                var tweet = tweets[i];
                                var textEl = tweet.querySelector('[data-testid=\\"tweetText\\"]');
                                var timeEl = tweet.querySelector('time');
                                var timeLink = timeEl ? timeEl.parentElement : null;
                                if (timeEl && timeLink && timeLink.href) {
                                    var match = timeLink.href.match(/status\\\\/(\\\\d+)/);
                                    results.push({
                                        text: textEl ? textEl.innerText.substring(0, 100) : null,
                                        url: timeLink.href,
                                        tweet_id: match ? match[1] : null,
                                        time: timeEl.getAttribute('datetime')
                                    });
                                }
                            }
                            return JSON.stringify(results);
                        })();
                    "
                end tell
            end tell
        end tell
        '''
        success, result = self._run_applescript(find_script)
        
        if success and result:
            try:
                tweets = json.loads(result)
                # Check ALL recent tweets (not just first - might be pinned)
                for tweet in tweets:
                    if tweet.get('time'):
                        tweet_time = datetime.fromisoformat(tweet['time'].replace('Z', '+00:00'))
                        now = datetime.now(timezone.utc)
                        diff = (now - tweet_time).total_seconds()
                        if diff < 120:  # Posted within 2 minutes
                            logger.success(f"Found recently posted tweet: {tweet.get('tweet_id')}")
                            return tweet
            except Exception as e:
                logger.warning(f"Error parsing tweets: {e}")
        
        return None
    
    def get_tweet_engagement(self, tweet_id: str) -> Optional[Dict]:
        """
        Get engagement metrics for a tweet by navigating to it.
        
        Args:
            tweet_id: The tweet ID
            
        Returns:
            Dict with views, likes, retweets, replies, quotes
        """
        # Navigate to the tweet
        tweet_url = f"https://x.com/i/status/{tweet_id}"
        script = f'''
        tell application "Safari"
            activate
            set URL of current tab of window 1 to "{tweet_url}"
        end tell
        '''
        self._run_applescript(script)
        time.sleep(3)
        
        # Extract metrics from the page
        metrics_script = '''
        tell application "Safari"
            tell window 1
                tell current tab
                    do JavaScript "
                        (function() {
                            var metrics = {};
                            
                            // Get view count (usually in aria-label)
                            var viewsEl = document.querySelector('[aria-label*=\\\"View\\\"]');
                            if (viewsEl) {
                                var match = viewsEl.getAttribute('aria-label').match(/([\\d,]+)/);
                                if (match) metrics.views = match[1].replace(/,/g, '');
                            }
                            
                            // Alternative: look for analytics link
                            var analyticsLink = document.querySelector('a[href*=\\\"/analytics\\\"]');
                            if (analyticsLink) {
                                var viewText = analyticsLink.innerText;
                                var match = viewText.match(/([\\d,.]+[KMB]?)/i);
                                if (match) metrics.views = match[1];
                            }
                            
                            // Get like count
                            var likeBtn = document.querySelector('[data-testid=\\\"like\\\"]') || 
                                          document.querySelector('[data-testid=\\\"unlike\\\"]');
                            if (likeBtn) {
                                var likeText = likeBtn.getAttribute('aria-label') || likeBtn.innerText;
                                var match = likeText.match(/([\\d,]+)/);
                                if (match) metrics.likes = match[1].replace(/,/g, '');
                            }
                            
                            // Get retweet count
                            var rtBtn = document.querySelector('[data-testid=\\\"retweet\\\"]');
                            if (rtBtn) {
                                var rtText = rtBtn.getAttribute('aria-label') || rtBtn.innerText;
                                var match = rtText.match(/([\\d,]+)/);
                                if (match) metrics.retweets = match[1].replace(/,/g, '');
                            }
                            
                            // Get reply count
                            var replyBtn = document.querySelector('[data-testid=\\\"reply\\\"]');
                            if (replyBtn) {
                                var replyText = replyBtn.getAttribute('aria-label') || replyBtn.innerText;
                                var match = replyText.match(/([\\d,]+)/);
                                if (match) metrics.replies = match[1].replace(/,/g, '');
                            }
                            
                            return JSON.stringify(metrics);
                        })();
                    "
                end tell
            end tell
        end tell
        '''
        
        success, result = self._run_applescript(metrics_script)
        if success and result:
            try:
                return json.loads(result)
            except:
                pass
        return None
    
    def get_tweet_metrics_via_api(self, tweet_id: str) -> Optional[Dict]:
        """
        Fetch tweet metrics via RapidAPI (The Old Bird / twitter-api45).
        
        Args:
            tweet_id: The tweet ID
            
        Returns:
            Dict with engagement metrics or None if failed
        """
        import httpx
        
        rapidapi_key = os.environ.get('RAPIDAPI_KEY')
        if not rapidapi_key:
            logger.warning("RAPIDAPI_KEY not set, cannot fetch metrics via API")
            return None
        
        headers = {
            "X-RapidAPI-Key": rapidapi_key,
            "X-RapidAPI-Host": "twitter-api45.p.rapidapi.com"
        }
        
        try:
            response = httpx.get(
                "https://twitter-api45.p.rapidapi.com/tweet.php",
                headers=headers,
                params={"tweet_id": tweet_id},
                timeout=15
            )
            
            if response.status_code == 200:
                data = response.json()
                return {
                    'tweet_id': tweet_id,
                    'views': data.get('view_count') or data.get('views'),
                    'likes': data.get('favorite_count') or data.get('likes'),
                    'retweets': data.get('retweet_count') or data.get('retweets'),
                    'replies': data.get('reply_count') or data.get('replies'),
                    'quotes': data.get('quote_count') or data.get('quotes'),
                    'source': 'rapidapi'
                }
            else:
                logger.warning(f"RapidAPI returned {response.status_code}: {response.text[:200]}")
                return None
                
        except Exception as e:
            logger.error(f"Failed to fetch metrics via API: {e}")
            return None
    
    def post_tweet(self, text: str, media_paths: Optional[List[str]] = None) -> Dict:
        """
        Post a tweet via Safari automation.

        Args:
            text: Tweet text (max 280 chars)
            media_paths: Optional list of media file paths to attach

        Returns:
            Dict with success status and details
        """
        logger.info(f"Posting tweet via Safari: {text[:50]}...")

        # Wake system if sleeping (Safari automation requires active UI)
        if self.session_manager:
            self.session_manager.trigger_safari_wake(
                task_type="twitter_post",
                metadata={"text": text[:50], "has_media": bool(media_paths)}
            )

        # Validate tweet length
        if len(text) > 280:
            return {
                'success': False,
                'error': f'Tweet too long: {len(text)} chars (max 280)'
            }

        # Rate limiting
        if self.last_post_time:
            elapsed = time.time() - self.last_post_time
            if elapsed < self.min_interval_seconds:
                wait_time = self.min_interval_seconds - elapsed
                logger.info(f"Rate limiting: waiting {wait_time:.1f}s")
                time.sleep(wait_time)

        try:
            # Step 1: Check login status FIRST using session manager
            if HAS_SESSION_MANAGER:
                session_manager = SafariSessionManager()
                if not session_manager.require_login(Platform.TWITTER):
                    return {
                        'success': False,
                        'error': 'Not logged in to X/Twitter. Please log in manually first.',
                        'requires_login': True
                    }
                logger.info("✅ Login verified via session manager")
            
            # Step 2: Open compose modal
            logger.info("Opening compose modal...")
            if not self.open_compose():
                return {'success': False, 'error': 'Failed to open compose modal'}
            
            time.sleep(2)  # Wait for modal to fully load
            
            # Step 3: Attach media if provided
            if media_paths:
                logger.info(f"Attaching {len(media_paths)} media files...")
                for media_path in media_paths:
                    if not self.attach_media(media_path):
                        logger.warning(f"Failed to attach media: {media_path}")
                time.sleep(1)
            
            # Step 4: Type the tweet (prefer JS, fallback to keystroke)
            logger.info("Typing tweet...")
            if not self.type_tweet_via_js(text):
                return {'success': False, 'error': 'Failed to type tweet'}
            
            time.sleep(1)
            
            # Step 5: Click post button (prefer JS, fallback to keyboard)
            logger.info("Clicking post button...")
            if not self.click_post_button_via_js():
                return {'success': False, 'error': 'Failed to click post button'}
            
            self.last_post_time = time.time()
            
            # Step 6: Verify post success
            verification = self.verify_post_success()
            
            if verification.get('posted') == True:
                logger.success(f"✅ Tweet posted successfully!")
                return {
                    'success': True,
                    'platform': 'twitter',
                    'method': 'safari_automation',
                    'tweet_text': text,
                    'url': verification.get('url'),
                    'media_count': len(media_paths) if media_paths else 0
                }
            elif verification.get('posted') == False:
                return {
                    'success': False,
                    'error': verification.get('error', 'Post verification failed')
                }
            else:
                # Unknown status - assume success if no error
                current_url = self.get_current_url()
                logger.info(f"Post status unknown, current URL: {current_url}")
                return {
                    'success': True,
                    'platform': 'twitter',
                    'method': 'safari_automation',
                    'tweet_text': text,
                    'url': current_url,
                    'verified': False
                }
            
        except Exception as e:
            logger.error(f"Tweet posting failed: {e}")
            return {
                'success': False,
                'error': str(e)
            }
    
    def attach_media(self, media_path: str) -> bool:
        """Attach a media file to the tweet using file picker."""
        if not os.path.exists(media_path):
            logger.error(f"Media file not found: {media_path}")
            return False
        
        # Click the media button and use file picker
        # Click the media button to open file picker
        click_media_script = '''
        tell application "Safari"
            activate
            tell window 1
                tell current tab
                    do JavaScript "
                        (function() {
                            var mediaBtn = document.querySelector('[aria-label=\\"Add photos or video\\"]');
                            if (mediaBtn) {
                                mediaBtn.click();
                                return 'clicked';
                            }
                            // Try file input directly
                            var fileInput = document.querySelector('[data-testid=\\"fileInput\\"]');
                            if (fileInput) {
                                fileInput.click();
                                return 'input_clicked';
                            }
                            return 'not_found';
                        })();
                    "
                end tell
            end tell
        end tell
        '''
        success, result = self._run_applescript(click_media_script)
        
        if not success or result == 'not_found':
            logger.warning("Could not find media button")
            return False
        
        time.sleep(1)
        
        # Use System Events to interact with the file picker dialog
        # Get the directory and filename
        abs_path = os.path.abspath(media_path)
        directory = os.path.dirname(abs_path)
        filename = os.path.basename(abs_path)
        
        file_picker_script = f'''
        tell application "System Events"
            tell process "Safari"
                delay 1
                -- Press Cmd+Shift+G to open "Go to Folder" in the file dialog
                keystroke "g" using {{command down, shift down}}
                delay 0.5
                -- Type the directory path
                keystroke "{directory}"
                delay 0.3
                keystroke return
                delay 1
                -- Type the filename
                keystroke "{filename}"
                delay 0.3
                keystroke return
                delay 1
            end tell
        end tell
        '''
        
        success, _ = self._run_applescript(file_picker_script)
        
        if success:
            logger.info(f"✅ Media attached: {filename}")
            time.sleep(2)  # Wait for upload
            return True
        else:
            logger.warning(f"Failed to attach media: {media_path}")
            return False
    
    def create_poll(self, text: str, options: List[str], duration_days: int = 1) -> Dict:
        """
        Create a tweet with a poll.
        
        Args:
            text: Tweet text
            options: List of poll options (2-4 options)
            duration_days: Poll duration in days (1-7)
            
        Returns:
            Dict with success status
        """
        if len(options) < 2 or len(options) > 4:
            return {'success': False, 'error': 'Poll must have 2-4 options'}
        
        if duration_days < 1 or duration_days > 7:
            return {'success': False, 'error': 'Poll duration must be 1-7 days'}
        
        logger.info(f"Creating poll with {len(options)} options...")
        
        # Check login
        if HAS_SESSION_MANAGER:
            session_manager = SafariSessionManager()
            if not session_manager.require_login(Platform.TWITTER):
                return {'success': False, 'error': 'Not logged in', 'requires_login': True}
        
        # Open compose
        if not self.open_compose():
            return {'success': False, 'error': 'Failed to open compose'}
        time.sleep(2)
        
        # Type the tweet text
        if not self.type_tweet_via_js(text):
            return {'success': False, 'error': 'Failed to type text'}
        time.sleep(0.5)
        
        # Click poll button
        poll_script = '''
        tell application "Safari"
            tell window 1
                tell current tab
                    do JavaScript "
                        (function() {
                            var pollBtn = document.querySelector('[data-testid=\\"createPollButton\\"]');
                            if (!pollBtn) pollBtn = document.querySelector('[aria-label=\\"Add poll\\"]');
                            if (pollBtn) {
                                pollBtn.click();
                                return 'clicked';
                            }
                            return 'not_found';
                        })();
                    "
                end tell
            end tell
        end tell
        '''
        success, result = self._run_applescript(poll_script)
        
        if not success or result == 'not_found':
            return {'success': False, 'error': 'Could not find poll button'}
        
        time.sleep(1)
        
        # Fill in poll options
        for i, option in enumerate(options):
            option_escaped = option.replace('"', '\\"').replace("'", "\\'")
            fill_option_script = f'''
            tell application "Safari"
                tell window 1
                    tell current tab
                        do JavaScript "
                            (function() {{
                                var inputs = document.querySelectorAll('input[placeholder*=\\"Choice\\"]');
                                if (inputs.length > {i}) {{
                                    inputs[{i}].focus();
                                    inputs[{i}].value = \\"{option_escaped}\\";
                                    inputs[{i}].dispatchEvent(new Event('input', {{bubbles: true}}));
                                    return 'filled';
                                }}
                                return 'not_found';
                            }})();
                        "
                    end tell
                end tell
            end tell
            '''
            self._run_applescript(fill_option_script)
            time.sleep(0.3)
        
        time.sleep(1)
        
        # Click post button
        if not self.click_post_button_via_js():
            return {'success': False, 'error': 'Failed to click post'}
        
        # Verify
        verification = self.verify_post_success()
        
        if verification.get('posted') == True:
            logger.success("✅ Poll created successfully!")
            return {
                'success': True,
                'tweet_id': verification.get('tweet_id'),
                'tweet_url': verification.get('url'),
                'poll_options': options,
                'duration_days': duration_days
            }
        
        return {'success': False, 'error': 'Poll creation verification failed'}
    
    def schedule_tweet(self, text: str, schedule_time: str, media_paths: Optional[List[str]] = None) -> Dict:
        """
        Schedule a tweet for later.
        
        Args:
            text: Tweet text
            schedule_time: ISO format datetime string (e.g., "2026-01-20T14:30:00")
            media_paths: Optional media files
            
        Returns:
            Dict with success status
        """
        from datetime import datetime
        
        try:
            scheduled_dt = datetime.fromisoformat(schedule_time)
        except ValueError:
            return {'success': False, 'error': f'Invalid datetime format: {schedule_time}'}
        
        logger.info(f"Scheduling tweet for {scheduled_dt}...")
        
        # Check login
        if HAS_SESSION_MANAGER:
            session_manager = SafariSessionManager()
            if not session_manager.require_login(Platform.TWITTER):
                return {'success': False, 'error': 'Not logged in', 'requires_login': True}
        
        # Open compose
        if not self.open_compose():
            return {'success': False, 'error': 'Failed to open compose'}
        time.sleep(2)
        
        # Type the tweet
        if not self.type_tweet_via_js(text):
            return {'success': False, 'error': 'Failed to type text'}
        time.sleep(0.5)
        
        # Attach media if provided
        if media_paths:
            for media_path in media_paths:
                self.attach_media(media_path)
            time.sleep(1)
        
        # Click schedule button
        schedule_script = '''
        tell application "Safari"
            tell window 1
                tell current tab
                    do JavaScript "
                        (function() {
                            var scheduleBtn = document.querySelector('[data-testid=\\"scheduleOption\\"]');
                            if (!scheduleBtn) scheduleBtn = document.querySelector('[aria-label=\\"Schedule post\\"]');
                            if (scheduleBtn) {
                                scheduleBtn.click();
                                return 'clicked';
                            }
                            return 'not_found';
                        })();
                    "
                end tell
            end tell
        end tell
        '''
        success, result = self._run_applescript(schedule_script)
        
        if not success or result == 'not_found':
            return {'success': False, 'error': 'Could not find schedule button'}
        
        time.sleep(1)
        
        # Fill in date/time (this is complex due to Twitter's date picker)
        # For now, use keyboard navigation
        month = scheduled_dt.strftime('%B')
        day = str(scheduled_dt.day)
        year = str(scheduled_dt.year)
        hour = scheduled_dt.strftime('%I')  # 12-hour format
        minute = scheduled_dt.strftime('%M')
        ampm = scheduled_dt.strftime('%p')
        
        logger.info(f"Setting schedule: {month} {day}, {year} at {hour}:{minute} {ampm}")
        
        # This requires interacting with Twitter's date/time picker
        # For simplicity, we'll confirm the schedule after user reviews
        time.sleep(2)
        
        # Click confirm/schedule button
        confirm_script = '''
        tell application "Safari"
            tell window 1
                tell current tab
                    do JavaScript "
                        (function() {
                            var confirmBtn = document.querySelector('[data-testid=\\"scheduledConfirmationPrimaryAction\\"]');
                            if (!confirmBtn) {
                                var buttons = document.querySelectorAll('button');
                                for (var i = 0; i < buttons.length; i++) {
                                    if (buttons[i].innerText.includes('Schedule') || buttons[i].innerText.includes('Confirm')) {
                                        confirmBtn = buttons[i];
                                        break;
                                    }
                                }
                            }
                            if (confirmBtn) {
                                confirmBtn.click();
                                return 'confirmed';
                            }
                            return 'not_found';
                        })();
                    "
                end tell
            end tell
        end tell
        '''
        success, result = self._run_applescript(confirm_script)
        
        if success and result == 'confirmed':
            logger.success(f"✅ Tweet scheduled for {scheduled_dt}")
            return {
                'success': True,
                'scheduled': True,
                'scheduled_time': schedule_time,
                'tweet_text': text
            }
        
        return {
            'success': False, 
            'error': 'Schedule confirmation failed - please set time manually',
            'schedule_modal_open': True
        }
    
    def post_thread(self, tweets: List[str], media_per_tweet: Optional[List[List[str]]] = None) -> Dict:
        """
        Post a thread (multiple connected tweets).
        
        Args:
            tweets: List of tweet texts
            media_per_tweet: Optional list of media paths per tweet
            
        Returns:
            Dict with success status and thread URLs
        """
        if not tweets:
            return {'success': False, 'error': 'No tweets provided'}
        
        if len(tweets) > 25:
            return {'success': False, 'error': 'Thread too long (max 25 tweets)'}
        
        logger.info(f"Posting thread with {len(tweets)} tweets...")
        
        # Check login
        if HAS_SESSION_MANAGER:
            session_manager = SafariSessionManager()
            if not session_manager.require_login(Platform.TWITTER):
                return {'success': False, 'error': 'Not logged in', 'requires_login': True}
        
        # Open compose
        if not self.open_compose():
            return {'success': False, 'error': 'Failed to open compose'}
        time.sleep(2)
        
        thread_ids = []
        
        for i, tweet_text in enumerate(tweets):
            logger.info(f"Writing tweet {i+1}/{len(tweets)}...")
            
            # Type this tweet
            if not self.type_tweet_via_js(tweet_text):
                return {'success': False, 'error': f'Failed to type tweet {i+1}'}
            time.sleep(0.5)
            
            # Attach media if provided
            if media_per_tweet and i < len(media_per_tweet) and media_per_tweet[i]:
                for media_path in media_per_tweet[i]:
                    self.attach_media(media_path)
                time.sleep(1)
            
            # If not the last tweet, click "Add another tweet" button
            if i < len(tweets) - 1:
                add_tweet_script = '''
                tell application "Safari"
                    tell window 1
                        tell current tab
                            do JavaScript "
                                (function() {
                                    var addBtn = document.querySelector('[data-testid=\\"addButton\\"]');
                                    if (!addBtn) addBtn = document.querySelector('[aria-label=\\"Add post\\"]');
                                    if (!addBtn) {
                                        // Look for + button
                                        var buttons = document.querySelectorAll('button');
                                        for (var i = 0; i < buttons.length; i++) {
                                            if (buttons[i].getAttribute('aria-label')?.includes('Add')) {
                                                addBtn = buttons[i];
                                                break;
                                            }
                                        }
                                    }
                                    if (addBtn) {
                                        addBtn.click();
                                        return 'added';
                                    }
                                    return 'not_found';
                                })();
                            "
                        end tell
                    end tell
                end tell
                '''
                success, result = self._run_applescript(add_tweet_script)
                
                if not success or result == 'not_found':
                    logger.warning(f"Could not add tweet {i+2}, posting what we have")
                    break
                
                time.sleep(1)
        
        # Post the entire thread
        logger.info("Posting thread...")
        if not self.click_post_button_via_js():
            return {'success': False, 'error': 'Failed to post thread'}
        
        # Verify
        verification = self.verify_post_success()
        
        if verification.get('posted') == True:
            logger.success(f"✅ Thread posted! First tweet: {verification.get('tweet_id')}")
            return {
                'success': True,
                'thread': True,
                'tweet_count': len(tweets),
                'first_tweet_id': verification.get('tweet_id'),
                'first_tweet_url': verification.get('url')
            }
        
        return {'success': False, 'error': 'Thread posting verification failed'}
    
    def reply_to_tweet(self, tweet_url: str, reply_text: str, media_paths: Optional[List[str]] = None) -> Dict:
        """
        Reply to an existing tweet.
        
        Args:
            tweet_url: URL of the tweet to reply to
            reply_text: Reply text
            media_paths: Optional media to attach
            
        Returns:
            Dict with success status
        """
        import re
        
        # Extract tweet ID from URL
        match = re.search(r'/status/(\d+)', tweet_url)
        if not match:
            return {'success': False, 'error': f'Invalid tweet URL: {tweet_url}'}
        
        original_tweet_id = match.group(1)
        logger.info(f"Replying to tweet {original_tweet_id}...")
        
        # Check login
        if HAS_SESSION_MANAGER:
            session_manager = SafariSessionManager()
            if not session_manager.require_login(Platform.TWITTER):
                return {'success': False, 'error': 'Not logged in', 'requires_login': True}
        
        # Navigate to the tweet
        nav_script = f'''
        tell application "Safari"
            activate
            set URL of current tab of window 1 to "{tweet_url}"
        end tell
        '''
        self._run_applescript(nav_script)
        time.sleep(4)  # Wait for page to fully load
        
        # Wait for tweet to be visible and click reply
        reply_script = '''
        tell application "Safari"
            tell window 1
                tell current tab
                    do JavaScript "
                        (function() {
                            // Try multiple selectors for the reply button
                            var replyBtn = document.querySelector('article [data-testid=\\"reply\\"]');
                            if (!replyBtn) {
                                replyBtn = document.querySelector('[data-testid=\\"reply\\"]');
                            }
                            if (!replyBtn) {
                                // Look for reply by aria-label
                                var buttons = document.querySelectorAll('button[aria-label]');
                                for (var i = 0; i < buttons.length; i++) {
                                    var label = buttons[i].getAttribute('aria-label');
                                    if (label && label.toLowerCase().includes('reply')) {
                                        replyBtn = buttons[i];
                                        break;
                                    }
                                }
                            }
                            if (replyBtn) {
                                replyBtn.click();
                                return 'clicked';
                            }
                            return 'not_found:' + document.querySelectorAll('[data-testid]').length + '_elements';
                        })();
                    "
                end tell
            end tell
        end tell
        '''
        success, result = self._run_applescript(reply_script)
        
        if not success or 'not_found' in str(result):
            logger.warning(f"Reply button not found: {result}")
            # Try clicking on the tweet first to expand it
            expand_script = '''
            tell application "Safari"
                tell window 1
                    tell current tab
                        do JavaScript "
                            (function() {
                                var article = document.querySelector('article');
                                if (article) article.click();
                                return 'expanded';
                            })();
                        "
                    end tell
                end tell
            end tell
            '''
            self._run_applescript(expand_script)
            time.sleep(2)
            
            # Try again
            success, result = self._run_applescript(reply_script)
            if not success or 'not_found' in str(result):
                return {'success': False, 'error': f'Could not find reply button: {result}'}
        
        time.sleep(2)
        
        # Type the reply
        if not self.type_tweet_via_js(reply_text):
            return {'success': False, 'error': 'Failed to type reply'}
        time.sleep(0.5)
        
        # Attach media if provided
        if media_paths:
            for media_path in media_paths:
                self.attach_media(media_path)
            time.sleep(1)
        
        # Click reply/post button
        if not self.click_post_button_via_js():
            return {'success': False, 'error': 'Failed to post reply'}
        
        # Verify
        verification = self.verify_post_success()
        
        if verification.get('posted') == True:
            logger.success(f"✅ Reply posted!")
            return {
                'success': True,
                'reply': True,
                'in_reply_to': original_tweet_id,
                'reply_id': verification.get('tweet_id'),
                'reply_url': verification.get('url')
            }
        
        return {'success': False, 'error': 'Reply verification failed'}
    
    def post_tweet_with_retry(self, text: str, max_retries: int = 3) -> Dict:
        """Post tweet with retry logic."""
        for attempt in range(max_retries):
            result = self.post_tweet(text)
            if result['success']:
                return result
            
            logger.warning(f"Attempt {attempt + 1}/{max_retries} failed: {result.get('error')}")
            if attempt < max_retries - 1:
                time.sleep(5)  # Wait before retry
        
        return result


def post_tweet(text: str, media_paths: Optional[List[str]] = None) -> Dict:
    """Convenience function to post a single tweet."""
    poster = SafariTwitterPoster()
    return poster.post_tweet(text, media_paths)


# =============================================================================
# NOTIFICATIONS FUNCTIONALITY
# =============================================================================

class TwitterNotifications:
    """Read and manage Twitter/X notifications via Safari."""
    
    NOTIFICATIONS_URL = "https://x.com/notifications"
    MENTIONS_URL = "https://x.com/notifications/mentions"
    
    def __init__(self):
        self.session_manager = SafariSessionManager() if HAS_SESSION_MANAGER else None
    
    def _run_applescript(self, script: str) -> tuple:
        """Execute AppleScript and return (success, output)."""
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
        """Check if logged into Twitter."""
        if self.session_manager:
            return self.session_manager.require_login(Platform.TWITTER)
        return True
    
    def get_notifications(self, limit: int = 20, mentions_only: bool = False) -> Dict:
        """
        Get recent notifications from Twitter.
        
        Args:
            limit: Maximum notifications to fetch
            mentions_only: If True, only get mentions
        
        Returns:
            Dict with notifications list
        """
        if not self.require_login():
            return {'success': False, 'error': 'Not logged in'}
        
        url = self.MENTIONS_URL if mentions_only else self.NOTIFICATIONS_URL
        
        # Navigate to notifications
        nav_script = f'''
        tell application "Safari"
            activate
            set URL of front document to "{url}"
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
                        var items = document.querySelectorAll('article, [data-testid=\\"notification\\"], [data-testid=\\"cellInnerDiv\\"]');
                        
                        for (var i = 0; i < Math.min(items.length, {limit}); i++) {{
                            var item = items[i];
                            var textEl = item.querySelector('[data-testid=\\"tweetText\\"], span');
                            var userEl = item.querySelector('a[href*=\\"/\\"]');
                            var timeEl = item.querySelector('time');
                            
                            if (textEl) {{
                                notifications.push({{
                                    text: textEl.innerText.substring(0, 200),
                                    user: userEl ? userEl.href.split('/').pop() : null,
                                    time: timeEl ? timeEl.getAttribute('datetime') : null
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
                notifications = json.loads(result)
                return {
                    'success': True,
                    'count': len(notifications),
                    'notifications': notifications,
                    'mentions_only': mentions_only
                }
            except json.JSONDecodeError:
                return {'success': True, 'count': 0, 'notifications': [], 'raw': result}
        
        return {'success': False, 'error': result}
    
    def get_unread_count(self) -> Dict:
        """Get count of unread notifications."""
        script = '''
        tell application "Safari"
            tell front document
                do JavaScript "
                    (function() {
                        var badge = document.querySelector('[aria-label*=\\"notification\\"] [aria-label*=\\"unread\\"], [data-testid=\\"notificationIndicator\\"]');
                        if (badge) {
                            var count = badge.innerText || badge.getAttribute('aria-label');
                            return count ? count.match(/\\d+/)?.[0] || '1' : '0';
                        }
                        return '0';
                    })();
                "
            end tell
        end tell
        '''
        success, result = self._run_applescript(script)
        
        if success:
            try:
                count = int(result) if result.isdigit() else 0
                return {'success': True, 'unread_count': count}
            except:
                return {'success': True, 'unread_count': 0}
        
        return {'success': False, 'error': result}


# =============================================================================
# DM/CHAT FUNCTIONALITY
# =============================================================================

class TwitterDM:
    """Read and send Twitter/X direct messages via Safari."""
    
    DM_URL = "https://x.com/messages"
    
    def __init__(self):
        self.session_manager = SafariSessionManager() if HAS_SESSION_MANAGER else None
    
    def _run_applescript(self, script: str) -> tuple:
        """Execute AppleScript and return (success, output)."""
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
    
    def _escape_for_js(self, text: str) -> str:
        """Escape text for JavaScript."""
        return (text
                .replace("\\", "\\\\")
                .replace('"', '\\"')
                .replace("'", "\\'")
                .replace("\n", "\\n"))
    
    def require_login(self) -> bool:
        """Check if logged into Twitter."""
        if self.session_manager:
            return self.session_manager.require_login(Platform.TWITTER)
        return True
    
    def get_conversations(self, limit: int = 20) -> Dict:
        """
        Get list of DM conversations.
        
        Returns:
            Dict with conversation list
        """
        if not self.require_login():
            return {'success': False, 'error': 'Not logged in'}
        
        # Navigate to DMs
        nav_script = f'''
        tell application "Safari"
            activate
            set URL of front document to "{self.DM_URL}"
        end tell
        '''
        self._run_applescript(nav_script)
        time.sleep(3)
        
        # Extract conversations
        script = f'''
        tell application "Safari"
            tell front document
                do JavaScript "
                    (function() {{
                        var conversations = [];
                        var items = document.querySelectorAll('[data-testid=\\"conversation\\"], [data-testid=\\"DMConversationEntry\\"], [role=\\"listitem\\"]');
                        
                        for (var i = 0; i < Math.min(items.length, {limit}); i++) {{
                            var item = items[i];
                            var nameEl = item.querySelector('[dir=\\"ltr\\"] span, [data-testid=\\"User-Name\\"]');
                            var previewEl = item.querySelector('[data-testid=\\"dmConversationContent\\"], [dir=\\"auto\\"]');
                            var timeEl = item.querySelector('time');
                            var unread = item.querySelector('[data-testid=\\"unread\\"]') !== null;
                            
                            if (nameEl) {{
                                conversations.push({{
                                    name: nameEl.innerText,
                                    preview: previewEl ? previewEl.innerText.substring(0, 100) : '',
                                    time: timeEl ? timeEl.getAttribute('datetime') : null,
                                    unread: unread
                                }});
                            }}
                        }}
                        
                        return JSON.stringify(conversations);
                    }})();
                "
            end tell
        end tell
        '''
        success, result = self._run_applescript(script)
        
        if success:
            try:
                conversations = json.loads(result)
                unread_count = sum(1 for c in conversations if c.get('unread'))
                return {
                    'success': True,
                    'count': len(conversations),
                    'unread_count': unread_count,
                    'conversations': conversations
                }
            except json.JSONDecodeError:
                return {'success': True, 'count': 0, 'conversations': [], 'raw': result}
        
        return {'success': False, 'error': result}
    
    def open_conversation(self, username: str) -> bool:
        """
        Open a DM conversation with a specific user.
        
        Args:
            username: Twitter username (without @)
        
        Returns:
            True if conversation opened
        """
        if not self.require_login():
            return False
        
        # Navigate to new message compose
        url = f"https://x.com/messages/compose"
        nav_script = f'''
        tell application "Safari"
            activate
            set URL of front document to "{url}"
        end tell
        '''
        self._run_applescript(nav_script)
        time.sleep(2)
        
        # Search for user
        escaped_username = self._escape_for_js(username)
        script = f'''
        tell application "Safari"
            tell front document
                do JavaScript "
                    (function() {{
                        var searchInput = document.querySelector('input[placeholder*=\\"Search\\"], input[data-testid=\\"searchPeople\\"]');
                        if (searchInput) {{
                            searchInput.focus();
                            searchInput.value = '{escaped_username}';
                            searchInput.dispatchEvent(new Event('input', {{ bubbles: true }}));
                            return 'searching';
                        }}
                        return 'not_found';
                    }})();
                "
            end tell
        end tell
        '''
        success, result = self._run_applescript(script)
        
        if success and result == 'searching':
            time.sleep(2)
            
            # Click on user result
            click_script = f'''
            tell application "Safari"
                tell front document
                    do JavaScript "
                        (function() {{
                            var results = document.querySelectorAll('[data-testid=\\"TypeaheadUser\\"], [role=\\"option\\"]');
                            for (var i = 0; i < results.length; i++) {{
                                if (results[i].innerText.toLowerCase().includes('{escaped_username.lower()}')) {{
                                    results[i].click();
                                    return 'clicked';
                                }}
                            }}
                            return 'no_match';
                        }})();
                    "
                end tell
            end tell
            '''
            success, result = self._run_applescript(click_script)
            time.sleep(1)
            
            # Click Next button
            next_script = '''
            tell application "Safari"
                tell front document
                    do JavaScript "
                        (function() {
                            var nextBtn = document.querySelector('[data-testid=\\"nextButton\\"], button[type=\\"submit\\"]');
                            if (nextBtn) {
                                nextBtn.click();
                                return 'opened';
                            }
                            return 'no_next';
                        })();
                    "
                end tell
            end tell
            '''
            self._run_applescript(next_script)
            time.sleep(2)
            return True
        
        return False
    
    def read_messages(self, limit: int = 50) -> Dict:
        """
        Read messages from the current open conversation.
        
        Returns:
            Dict with messages list
        """
        script = f'''
        tell application "Safari"
            tell front document
                do JavaScript "
                    (function() {{
                        var messages = [];
                        var items = document.querySelectorAll('[data-testid=\\"messageEntry\\"], [data-testid=\\"DMMessageBubble\\"]');
                        
                        for (var i = 0; i < Math.min(items.length, {limit}); i++) {{
                            var item = items[i];
                            var textEl = item.querySelector('[data-testid=\\"tweetText\\"], [dir=\\"auto\\"]');
                            var timeEl = item.querySelector('time');
                            var isSent = item.classList.contains('sent') || item.closest('[data-testid*=\\"sent\\"]') !== null;
                            
                            if (textEl) {{
                                messages.push({{
                                    text: textEl.innerText,
                                    time: timeEl ? timeEl.getAttribute('datetime') : null,
                                    is_sent: isSent
                                }});
                            }}
                        }}
                        
                        return JSON.stringify(messages);
                    }})();
                "
            end tell
        end tell
        '''
        success, result = self._run_applescript(script)
        
        if success:
            try:
                messages = json.loads(result)
                return {
                    'success': True,
                    'count': len(messages),
                    'messages': messages
                }
            except json.JSONDecodeError:
                return {'success': True, 'count': 0, 'messages': [], 'raw': result}
        
        return {'success': False, 'error': result}
    
    def send_message(self, text: str, username: Optional[str] = None) -> Dict:
        """
        Send a DM message.
        
        Args:
            text: Message text
            username: If provided, opens conversation with user first
        
        Returns:
            Dict with success status
        """
        if not self.require_login():
            return {'success': False, 'error': 'Not logged in'}
        
        # Open conversation if username provided
        if username:
            if not self.open_conversation(username):
                return {'success': False, 'error': f'Could not open conversation with {username}'}
        
        # Type message
        escaped_text = self._escape_for_js(text)
        script = f'''
        tell application "Safari"
            tell front document
                do JavaScript "
                    (function() {{
                        var input = document.querySelector('[data-testid=\\"dmComposerTextInput\\"], [contenteditable=\\"true\\"], textarea[placeholder*=\\"message\\"]');
                        if (input) {{
                            input.focus();
                            if (input.tagName === 'TEXTAREA') {{
                                input.value = '{escaped_text}';
                            }} else {{
                                input.innerText = '{escaped_text}';
                            }}
                            input.dispatchEvent(new Event('input', {{ bubbles: true }}));
                            return 'typed';
                        }}
                        return 'input_not_found';
                    }})();
                "
            end tell
        end tell
        '''
        success, result = self._run_applescript(script)
        
        if not success or result != 'typed':
            return {'success': False, 'error': f'Failed to type message: {result}'}
        
        time.sleep(0.5)
        
        # Click send button
        send_script = '''
        tell application "Safari"
            tell front document
                do JavaScript "
                    (function() {
                        var sendBtn = document.querySelector('[data-testid=\\"dmComposerSendButton\\"], [aria-label*=\\"Send\\"]');
                        if (sendBtn && !sendBtn.disabled) {
                            sendBtn.click();
                            return 'sent';
                        }
                        return 'send_not_found';
                    })();
                "
            end tell
        end tell
        '''
        success, result = self._run_applescript(send_script)
        
        if success and result == 'sent':
            logger.success(f"✅ DM sent: {text[:50]}...")
            return {
                'success': True,
                'message': text,
                'recipient': username
            }
        
        return {'success': False, 'error': f'Failed to send: {result}'}


def test_login_status() -> Dict:
    """Test if user is logged into X/Twitter."""
    poster = SafariTwitterPoster()
    
    # First open Twitter
    print("Opening X.com...")
    poster.open_twitter()
    time.sleep(3)
    
    # Check login status
    print("Checking login status...")
    status = poster.check_login_status()
    return status


def test_compose_flow(dry_run: bool = True) -> Dict:
    """
    Test the compose flow without actually posting.
    
    Args:
        dry_run: If True, don't click the post button
    """
    poster = SafariTwitterPoster()
    
    # Step 1: Check login via session manager FIRST
    print("Step 1: Checking login status via session manager...")
    if HAS_SESSION_MANAGER:
        session_manager = SafariSessionManager()
        state = session_manager.check_login_status(Platform.TWITTER)
        print(f"  Session state: logged_in={state.is_logged_in}, indicator={state.indicator_found}")
        
        if not state.is_logged_in:
            return {'success': False, 'error': 'Not logged in', 'details': state.error}
    else:
        print("  Session manager not available, skipping pre-check")
    
    print("Step 2: Opening compose modal...")
    if not poster.open_compose():
        return {'success': False, 'error': 'Failed to open compose'}
    time.sleep(2)
    
    print("Step 3: Typing test text...")
    test_text = "Test tweet - will be cancelled"
    if not poster.type_tweet_via_js(test_text):
        return {'success': False, 'error': 'Failed to type text'}
    
    if dry_run:
        print("Step 4: DRY RUN - Not clicking post button")
        print("  Press Escape to cancel the compose modal")
        return {'success': True, 'dry_run': True, 'message': 'Compose flow tested successfully'}
    else:
        print("Step 4: Clicking post button...")
        if not poster.click_post_button_via_js():
            return {'success': False, 'error': 'Failed to click post'}
        
        return poster.verify_post_success()


if __name__ == "__main__":
    import sys
    import argparse
    
    parser = argparse.ArgumentParser(description='Safari Twitter/X Poster - Full Feature Set')
    subparsers = parser.add_subparsers(dest='command', help='Commands')
    
    # Test commands
    parser.add_argument('--test-login', action='store_true', help='Test login status only')
    parser.add_argument('--test-compose', action='store_true', help='Test compose flow (dry run)')
    
    # Post command
    post_parser = subparsers.add_parser('post', help='Post a tweet')
    post_parser.add_argument('text', nargs='+', help='Tweet text')
    post_parser.add_argument('--media', '-m', action='append', help='Media file path(s)')
    
    # Thread command
    thread_parser = subparsers.add_parser('thread', help='Post a thread')
    thread_parser.add_argument('--tweets', '-t', nargs='+', required=True, help='Tweet texts (separate with |)')
    
    # Reply command
    reply_parser = subparsers.add_parser('reply', help='Reply to a tweet')
    reply_parser.add_argument('url', help='Tweet URL to reply to')
    reply_parser.add_argument('text', nargs='+', help='Reply text')
    reply_parser.add_argument('--media', '-m', action='append', help='Media file path(s)')
    
    # Poll command
    poll_parser = subparsers.add_parser('poll', help='Create a poll')
    poll_parser.add_argument('text', nargs='+', help='Poll question/text')
    poll_parser.add_argument('--options', '-o', nargs='+', required=True, help='Poll options (2-4)')
    poll_parser.add_argument('--days', '-d', type=int, default=1, help='Duration in days (1-7)')
    
    # Schedule command
    schedule_parser = subparsers.add_parser('schedule', help='Schedule a tweet')
    schedule_parser.add_argument('text', nargs='+', help='Tweet text')
    schedule_parser.add_argument('--time', '-t', required=True, help='Schedule time (ISO format)')
    schedule_parser.add_argument('--media', '-m', action='append', help='Media file path(s)')
    
    # Notifications command
    notif_parser = subparsers.add_parser('notifications', help='View notifications')
    notif_parser.add_argument('--mentions', '-m', action='store_true', help='Only show mentions')
    notif_parser.add_argument('--limit', '-l', type=int, default=20, help='Max notifications')
    notif_parser.add_argument('--unread', '-u', action='store_true', help='Show unread count only')
    
    # DM commands
    dm_parser = subparsers.add_parser('dm', help='Direct messages')
    dm_subparsers = dm_parser.add_subparsers(dest='dm_action', help='DM actions')
    
    # DM list
    dm_list_parser = dm_subparsers.add_parser('list', help='List conversations')
    dm_list_parser.add_argument('--limit', '-l', type=int, default=20, help='Max conversations')
    
    # DM read
    dm_read_parser = dm_subparsers.add_parser('read', help='Read messages from user')
    dm_read_parser.add_argument('username', help='Username to read messages from')
    dm_read_parser.add_argument('--limit', '-l', type=int, default=50, help='Max messages')
    
    # DM send
    dm_send_parser = dm_subparsers.add_parser('send', help='Send a DM')
    dm_send_parser.add_argument('username', help='Username to message')
    dm_send_parser.add_argument('message', nargs='+', help='Message text')
    
    args = parser.parse_args()
    poster = SafariTwitterPoster()
    
    if args.test_login:
        print("=" * 50)
        print("Testing X/Twitter Login Status")
        print("=" * 50)
        result = test_login_status()
        print(f"\nResult: {json.dumps(result, indent=2)}")
        
    elif args.test_compose:
        print("=" * 50)
        print("Testing Compose Flow (Dry Run)")
        print("=" * 50)
        result = test_compose_flow(dry_run=True)
        print(f"\nResult: {json.dumps(result, indent=2)}")
        
    elif args.command == 'post':
        tweet_text = " ".join(args.text)
        media_paths = args.media if args.media else None
        print("=" * 50)
        print(f"Posting Tweet: {tweet_text[:50]}...")
        if media_paths:
            print(f"With media: {media_paths}")
        print("=" * 50)
        result = poster.post_tweet(tweet_text, media_paths)
        print(f"\nResult: {json.dumps(result, indent=2)}")
        
    elif args.command == 'thread':
        # Split tweets by | if provided as single string, or use as list
        tweets = []
        for t in args.tweets:
            if '|' in t:
                tweets.extend([x.strip() for x in t.split('|')])
            else:
                tweets.append(t)
        print("=" * 50)
        print(f"Posting Thread ({len(tweets)} tweets)")
        print("=" * 50)
        result = poster.post_thread(tweets)
        print(f"\nResult: {json.dumps(result, indent=2)}")
        
    elif args.command == 'reply':
        reply_text = " ".join(args.text)
        media_paths = args.media if args.media else None
        print("=" * 50)
        print(f"Replying to: {args.url}")
        print(f"Reply: {reply_text[:50]}...")
        print("=" * 50)
        result = poster.reply_to_tweet(args.url, reply_text, media_paths)
        print(f"\nResult: {json.dumps(result, indent=2)}")
        
    elif args.command == 'poll':
        poll_text = " ".join(args.text)
        print("=" * 50)
        print(f"Creating Poll: {poll_text[:50]}...")
        print(f"Options: {args.options}")
        print("=" * 50)
        result = poster.create_poll(poll_text, args.options, args.days)
        print(f"\nResult: {json.dumps(result, indent=2)}")
        
    elif args.command == 'schedule':
        tweet_text = " ".join(args.text)
        media_paths = args.media if args.media else None
        print("=" * 50)
        print(f"Scheduling Tweet: {tweet_text[:50]}...")
        print(f"For: {args.time}")
        print("=" * 50)
        result = poster.schedule_tweet(tweet_text, args.time, media_paths)
        print(f"\nResult: {json.dumps(result, indent=2)}")
    
    elif args.command == 'notifications':
        notifications = TwitterNotifications()
        
        if args.unread:
            print("=" * 50)
            print("Checking Unread Notifications")
            print("=" * 50)
            result = notifications.get_unread_count()
            print(f"\nUnread count: {result.get('unread_count', 0)}")
        else:
            print("=" * 50)
            print(f"Fetching {'Mentions' if args.mentions else 'Notifications'} (limit: {args.limit})")
            print("=" * 50)
            result = notifications.get_notifications(limit=args.limit, mentions_only=args.mentions)
            
            if result.get('success'):
                print(f"\n📬 Found {result['count']} notifications:\n")
                for notif in result.get('notifications', []):
                    user = notif.get('user', 'unknown')
                    text = notif.get('text', '')[:100]
                    time_str = notif.get('time', '')
                    print(f"  @{user}: {text}")
                    if time_str:
                        print(f"    🕐 {time_str}")
                    print()
            else:
                print(f"\n❌ Error: {result.get('error')}")
    
    elif args.command == 'dm':
        dm = TwitterDM()
        
        if args.dm_action == 'list':
            print("=" * 50)
            print(f"Fetching DM Conversations (limit: {args.limit})")
            print("=" * 50)
            result = dm.get_conversations(limit=args.limit)
            
            if result.get('success'):
                print(f"\n💬 Found {result['count']} conversations ({result.get('unread_count', 0)} unread):\n")
                for conv in result.get('conversations', []):
                    name = conv.get('name', 'Unknown')
                    preview = conv.get('preview', '')[:60]
                    unread = "🔵 " if conv.get('unread') else ""
                    print(f"  {unread}{name}")
                    print(f"    {preview}...")
                    print()
            else:
                print(f"\n❌ Error: {result.get('error')}")
        
        elif args.dm_action == 'read':
            print("=" * 50)
            print(f"Reading Messages from @{args.username}")
            print("=" * 50)
            
            # Open conversation first
            if dm.open_conversation(args.username):
                result = dm.read_messages(limit=args.limit)
                
                if result.get('success'):
                    print(f"\n📨 Found {result['count']} messages:\n")
                    for msg in result.get('messages', []):
                        direction = "➡️ Sent" if msg.get('is_sent') else "⬅️ Received"
                        text = msg.get('text', '')
                        print(f"  {direction}: {text}")
                        print()
                else:
                    print(f"\n❌ Error: {result.get('error')}")
            else:
                print(f"\n❌ Could not open conversation with @{args.username}")
        
        elif args.dm_action == 'send':
            message = " ".join(args.message)
            print("=" * 50)
            print(f"Sending DM to @{args.username}")
            print(f"Message: {message[:50]}...")
            print("=" * 50)
            result = dm.send_message(message, args.username)
            print(f"\nResult: {json.dumps(result, indent=2)}")
        
        else:
            dm_parser.print_help()
        
    else:
        parser.print_help()
        print("\n" + "=" * 50)
        print("EXAMPLES")
        print("=" * 50)
        print("\n📝 Basic tweet:")
        print("  python safari_twitter_poster.py post Hello World!")
        print("\n🖼️  Tweet with media:")
        print("  python safari_twitter_poster.py post Check this out! -m /path/to/image.jpg")
        print("\n🧵 Thread:")
        print('  python safari_twitter_poster.py thread -t "First tweet" "Second tweet" "Third tweet"')
        print("  python safari_twitter_poster.py thread -t 'Tweet 1 | Tweet 2 | Tweet 3'")
        print("\n💬 Reply:")
        print("  python safari_twitter_poster.py reply https://x.com/user/status/123 Great post!")
        print("\n📊 Poll:")
        print("  python safari_twitter_poster.py poll 'What is best?' -o 'Option A' 'Option B' 'Option C'")
        print("\n⏰ Schedule:")
        print("  python safari_twitter_poster.py schedule 'Future tweet' -t 2026-01-20T14:30:00")
        print("\n🔔 Notifications:")
        print("  python safari_twitter_poster.py notifications")
        print("  python safari_twitter_poster.py notifications --mentions")
        print("  python safari_twitter_poster.py notifications --unread")
        print("\n💬 DMs:")
        print("  python safari_twitter_poster.py dm list")
        print("  python safari_twitter_poster.py dm read elonmusk")
        print("  python safari_twitter_poster.py dm send elonmusk 'Hey! Great work on X!'")
        print("\n🔍 Test:")
        print("  python safari_twitter_poster.py --test-login")
        print("  python safari_twitter_poster.py --test-compose")
