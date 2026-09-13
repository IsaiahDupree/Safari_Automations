#!/usr/bin/env python3
"""
Safari Session Manager
Manages login sessions across all Safari-automated platforms.

Features:
- Login state detection for each platform
- Automatic session refresh to prevent logout
- Blocks automation if not logged in
- Session health monitoring
"""
import subprocess
import time
import json
import threading
import asyncio
from datetime import datetime, timedelta
from typing import Optional, Dict, Callable, List
from dataclasses import dataclass, field
from enum import Enum
from loguru import logger


class Platform(Enum):
    """Supported platforms for Safari automation."""
    TWITTER = "twitter"
    TIKTOK = "tiktok"
    INSTAGRAM = "instagram"
    SORA = "sora"
    YOUTUBE = "youtube"
    THREADS = "threads"
    REDDIT = "reddit"


@dataclass
class PlatformConfig:
    """Configuration for a platform's session management."""
    name: str
    home_url: str
    login_url: str
    # CSS selectors to detect logged-in state
    logged_in_indicators: List[str]
    # CSS selectors that indicate NOT logged in
    logged_out_indicators: List[str]
    # How often to refresh the page (minutes)
    refresh_interval_minutes: int = 30
    # Session timeout (minutes) - refresh before this
    session_timeout_minutes: int = 60


# Platform configurations
PLATFORM_CONFIGS: Dict[Platform, PlatformConfig] = {
    Platform.TWITTER: PlatformConfig(
        name="Twitter/X",
        home_url="https://x.com/home",
        login_url="https://x.com/login",
        logged_in_indicators=[
            '[data-testid="AppTabBar_Profile_Link"]',
            '[data-testid="SideNav_NewTweet_Button"]',
            'a[href="/compose/post"]',
            '[aria-label="Profile"]',
            '[data-testid="primaryColumn"]',
        ],
        logged_out_indicators=[
            'a[href="/login"]',
            'a[href="/i/flow/login"]',
            '[data-testid="loginButton"]',
        ],
        refresh_interval_minutes=25,
        session_timeout_minutes=60,
    ),
    Platform.TIKTOK: PlatformConfig(
        name="TikTok",
        home_url="https://www.tiktok.com/foryou",
        login_url="https://www.tiktok.com/login",
        logged_in_indicators=[
            '[data-e2e="profile-icon"]',
            '[data-e2e="upload-icon"]',
            'a[href*="/upload"]',
            '[data-e2e="nav-profile"]',
        ],
        logged_out_indicators=[
            '[data-e2e="top-login-button"]',
            'button[data-e2e="login-button"]',
            'a[href*="/login"]',
        ],
        refresh_interval_minutes=20,
        session_timeout_minutes=45,
    ),
    Platform.INSTAGRAM: PlatformConfig(
        name="Instagram",
        home_url="https://www.instagram.com/",
        login_url="https://www.instagram.com/accounts/login/",
        logged_in_indicators=[
            'a[href*="/direct/inbox/"]',
            '[aria-label="New post"]',
            'a[href="/accounts/activity/"]',
            'svg[aria-label="Home"]',
        ],
        logged_out_indicators=[
            'input[name="username"]',
            'button[type="submit"]',
            'a[href="/accounts/login/"]',
        ],
        refresh_interval_minutes=25,
        session_timeout_minutes=60,
    ),
    Platform.SORA: PlatformConfig(
        name="Sora (OpenAI)",
        home_url="https://sora.com/",
        login_url="https://sora.com/login",
        logged_in_indicators=[
            '[data-testid="profile-button"]',
            'button[aria-label*="profile"]',
            '[class*="avatar"]',
        ],
        logged_out_indicators=[
            'button[data-testid="login-button"]',
            'a[href*="/login"]',
        ],
        refresh_interval_minutes=30,
        session_timeout_minutes=120,
    ),
    Platform.YOUTUBE: PlatformConfig(
        name="YouTube",
        home_url="https://www.youtube.com/",
        login_url="https://accounts.google.com/",
        logged_in_indicators=[
            '#avatar-btn',
            'button[aria-label*="Account"]',
            'ytd-topbar-menu-button-renderer',
        ],
        logged_out_indicators=[
            'a[href*="accounts.google.com"]',
            'ytd-button-renderer[is-icon-only] a[href*="signin"]',
        ],
        refresh_interval_minutes=45,
        session_timeout_minutes=180,
    ),
    Platform.THREADS: PlatformConfig(
        name="Threads",
        home_url="https://www.threads.net/",
        login_url="https://www.threads.net/login",
        logged_in_indicators=[
            'a[href*="/activity"]',
            '[aria-label="Create"]',
            'svg[aria-label="Home"]',
        ],
        logged_out_indicators=[
            'a[href*="/login"]',
            '[data-testid="login-button"]',
        ],
        refresh_interval_minutes=25,
        session_timeout_minutes=60,
    ),
    Platform.REDDIT: PlatformConfig(
        name="Reddit",
        home_url="https://www.reddit.com/",
        login_url="https://www.reddit.com/login/",
        logged_in_indicators=[
            '[id="USER_DROPDOWN_ID"]',
            'button[aria-label*="profile"]',
            'a[href*="/user/"]',
            '[data-testid="create-post"]',
            'faceplate-dropdown-menu[name="user-drawer-tray"]',
        ],
        logged_out_indicators=[
            'a[href*="/login"]',
            'button[data-testid="login-button"]',
            'faceplate-tracker[noun="login"]',
        ],
        refresh_interval_minutes=30,
        session_timeout_minutes=120,
    ),
}


@dataclass
class SessionState:
    """Current session state for a platform."""
    platform: Platform
    is_logged_in: bool = False
    last_check: Optional[datetime] = None
    last_refresh: Optional[datetime] = None
    username: str = ""
    error: str = ""
    indicator_found: str = ""


class SafariSessionManager:
    """
    Manages Safari sessions across all platforms.
    
    Usage:
        manager = SafariSessionManager()
        
        # Check if logged in before running automation
        if manager.require_login(Platform.TWITTER):
            # Run automation
            poster.post_tweet(...)
        else:
            print("Not logged in, please login manually")
        
        # Start background session refresh
        manager.start_session_keeper()
    """
    
    _instance = None
    _lock = threading.Lock()
    
    def __new__(cls):
        """Singleton pattern to ensure one session manager."""
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._initialized = False
        return cls._instance
    
    def __init__(self):
        if self._initialized:
            return
        
        self._initialized = True
        self.sessions: Dict[Platform, SessionState] = {}
        self._refresh_thread: Optional[threading.Thread] = None
        self._stop_refresh = threading.Event()
        self._callbacks: Dict[Platform, List[Callable]] = {}
        
        # Initialize session states
        for platform in Platform:
            self.sessions[platform] = SessionState(platform=platform)
    
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
    
    def _get_current_safari_url(self) -> Optional[str]:
        """Get the current URL from Safari's active tab."""
        script = '''
        tell application "Safari"
            if not running then return "not_running"
            if (count of windows) = 0 then return "no_windows"
            tell window 1
                return URL of current tab
            end tell
        end tell
        '''
        success, url = self._run_applescript(script)
        if success and url not in ["not_running", "no_windows"]:
            return url
        return None
    
    def _navigate_to_url(self, url: str) -> bool:
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
        return success
    
    def _wait_for_page_load(self, timeout_seconds: int = 10) -> bool:
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
    
    def check_login_status(self, platform: Platform, navigate_if_needed: bool = True) -> SessionState:
        """
        Check if user is logged into a platform.
        
        Args:
            platform: The platform to check
            navigate_if_needed: If True, navigate to platform home if not already there
            
        Returns:
            SessionState with current login status
        """
        config = PLATFORM_CONFIGS.get(platform)
        if not config:
            logger.error(f"No config for platform: {platform}")
            return SessionState(platform=platform, error="No config")
        
        state = self.sessions[platform]
        state.last_check = datetime.now()
        
        # Check current URL
        current_url = self._get_current_safari_url()
        
        # Navigate to platform home if needed
        platform_domains = [config.home_url.split('/')[2], config.login_url.split('/')[2]]
        if current_url and not any(domain in current_url for domain in platform_domains):
            if navigate_if_needed:
                logger.info(f"Navigating to {config.name}...")
                self._navigate_to_url(config.home_url)
                time.sleep(3)
            else:
                state.error = "Not on platform page"
                return state
        
        # Wait for page load
        self._wait_for_page_load(5)
        time.sleep(1)
        
        # Use simpler approach - check URL first, then use simple selectors
        script = '''
        tell application "Safari"
            tell window 1
                set pageURL to URL of current tab
                tell current tab
                    set pageContent to do JavaScript "document.body.innerHTML.length"
                end tell
                return pageURL & "|" & pageContent
            end tell
        end tell
        '''
        
        success, result = self._run_applescript(script)
        
        if success and result:
            parts = result.split('|')
            page_url = parts[0] if len(parts) > 0 else ""
            # Handle scientific notation (e.g., "6.13277E+5")
            try:
                content_length = int(float(parts[1])) if len(parts) > 1 else 0
            except (ValueError, IndexError):
                content_length = 0
            
            # Check URL for login indicators
            if '/login' in page_url or '/signin' in page_url or '/flow/login' in page_url:
                state.is_logged_in = False
                state.error = "on_login_page"
                logger.warning(f"❌ {config.name}: On login page")
                self.sessions[platform] = state
                return state
            
            # Check if we're on the platform with content (likely logged in)
            platform_domain = config.home_url.split('/')[2]
            if platform_domain in page_url and content_length > 1000:
                # Now do a more specific check for interactive elements
                check_script = '''
                tell application "Safari"
                    tell window 1
                        tell current tab
                            do JavaScript "document.querySelector('[data-testid]') ? 'yes' : 'no'"
                        end tell
                    end tell
                end tell
                '''
                check_success, check_result = self._run_applescript(check_script)
                
                if check_success and 'yes' in check_result.lower():
                    state.is_logged_in = True
                    state.indicator_found = f"content:{content_length}"
                    logger.success(f"✅ {config.name}: Logged in (content detected, {content_length} chars)")
                    self.sessions[platform] = state
                    return state
                
                # Even without data-testid, large content on home page suggests logged in
                if content_length > 50000:
                    state.is_logged_in = True
                    state.indicator_found = f"large_content:{content_length}"
                    logger.success(f"✅ {config.name}: Logged in (large content detected)")
                    self.sessions[platform] = state
                    return state
            
            state.is_logged_in = False
            state.error = "no_indicators"
            logger.warning(f"❌ {config.name}: Not logged in - {state.error}")
        else:
            state.error = "script_failed"
            logger.error(f"❌ {config.name}: Script failed - {result}")
        
        self.sessions[platform] = state
        return state
    
    def require_login(self, platform: Platform) -> bool:
        """
        Check login and return True only if logged in.
        Use this before running any automation.

        Args:
            platform: The platform to check

        Returns:
            True if logged in, False otherwise
        """
        state = self.check_login_status(platform)

        if not state.is_logged_in:
            config = PLATFORM_CONFIGS.get(platform)
            logger.error(f"🚫 Automation blocked: Not logged in to {config.name}")
            logger.info(f"Please log in manually at: {config.login_url}")
            return False

        return True

    async def trigger_safari_wake(self, task_type: str, metadata: Optional[Dict] = None) -> bool:
        """
        Trigger sleep mode wake when Safari automation task is queued.

        This ensures the system is awake before attempting Safari automation,
        as Safari automation requires active UI interaction.

        Args:
            task_type: Type of Safari task (e.g., "twitter_post", "sora_generation")
            metadata: Additional task context

        Returns:
            True if wake triggered successfully (or already awake)

        Example:
            manager = SafariSessionManager()
            await manager.trigger_safari_wake("twitter_post", {"text": "Hello world"})
        """
        try:
            # Lazy import to avoid circular dependency
            from services.sleep_mode_service import SleepModeService, WakeTriggerType, SleepState

            sleep_service = SleepModeService.get_instance()

            # If already awake, nothing to do
            if sleep_service.state == SleepState.AWAKE:
                logger.debug(f"System already awake for Safari task: {task_type}")
                return True

            # Wake the system immediately
            await sleep_service.wake(
                trigger_type=WakeTriggerType.SAFARI_AUTOMATION,
                metadata={
                    "task_type": task_type,
                    "platform": metadata.get("platform") if metadata else None,
                    **(metadata or {})
                }
            )

            logger.info(f"⏰ Woke system for Safari automation: {task_type}")
            return True

        except Exception as e:
            logger.warning(f"Failed to trigger Safari wake: {e}")
            # Don't block automation if sleep mode is unavailable
            return True
    
    def refresh_session(self, platform: Platform) -> bool:
        """
        Refresh a platform session by reloading the page.
        This helps prevent session timeout.
        
        Args:
            platform: The platform to refresh
            
        Returns:
            True if refresh successful and still logged in
        """
        config = PLATFORM_CONFIGS.get(platform)
        if not config:
            return False
        
        state = self.sessions[platform]
        
        # Check if we're on the platform's page
        current_url = self._get_current_safari_url()
        platform_domain = config.home_url.split('/')[2]
        
        if current_url and platform_domain in current_url:
            # Reload the page
            script = '''
            tell application "Safari"
                tell window 1
                    tell current tab
                        do JavaScript "location.reload();"
                    end tell
                end tell
            end tell
            '''
            success, _ = self._run_applescript(script)
            
            if success:
                time.sleep(3)
                state.last_refresh = datetime.now()
                
                # Verify still logged in
                new_state = self.check_login_status(platform, navigate_if_needed=False)
                if new_state.is_logged_in:
                    logger.info(f"🔄 {config.name}: Session refreshed")
                    return True
                else:
                    logger.warning(f"⚠️ {config.name}: Session expired during refresh")
                    return False
        
        return False
    
    def get_all_session_states(self) -> Dict[str, Dict]:
        """Get session states for all platforms."""
        result = {}
        for platform, state in self.sessions.items():
            result[platform.value] = {
                'is_logged_in': state.is_logged_in,
                'last_check': state.last_check.isoformat() if state.last_check else None,
                'last_refresh': state.last_refresh.isoformat() if state.last_refresh else None,
                'username': state.username,
                'error': state.error,
            }
        return result
    
    def _session_keeper_loop(self):
        """Background thread that periodically refreshes sessions."""
        logger.info("🔄 Session keeper started")
        
        while not self._stop_refresh.is_set():
            now = datetime.now()
            
            for platform, state in self.sessions.items():
                if not state.is_logged_in:
                    continue
                
                config = PLATFORM_CONFIGS.get(platform)
                if not config:
                    continue
                
                # Check if refresh is needed
                if state.last_refresh:
                    minutes_since_refresh = (now - state.last_refresh).total_seconds() / 60
                    if minutes_since_refresh >= config.refresh_interval_minutes:
                        logger.info(f"Session refresh needed for {config.name}")
                        self.refresh_session(platform)
            
            # Sleep for 5 minutes before next check
            self._stop_refresh.wait(300)
        
        logger.info("🔄 Session keeper stopped")
    
    def start_session_keeper(self):
        """Start the background session keeper thread."""
        if self._refresh_thread and self._refresh_thread.is_alive():
            logger.warning("Session keeper already running")
            return
        
        self._stop_refresh.clear()
        self._refresh_thread = threading.Thread(
            target=self._session_keeper_loop,
            daemon=True,
            name="SafariSessionKeeper"
        )
        self._refresh_thread.start()
        logger.info("✅ Session keeper thread started")
    
    def stop_session_keeper(self):
        """Stop the background session keeper thread."""
        if self._refresh_thread:
            self._stop_refresh.set()
            self._refresh_thread.join(timeout=5)
            logger.info("Session keeper stopped")
    
    def on_logout(self, platform: Platform, callback: Callable):
        """Register a callback for when a platform logs out."""
        if platform not in self._callbacks:
            self._callbacks[platform] = []
        self._callbacks[platform].append(callback)


# Convenience functions
def require_twitter_login() -> bool:
    """Check if logged into Twitter before automation."""
    manager = SafariSessionManager()
    return manager.require_login(Platform.TWITTER)


def require_tiktok_login() -> bool:
    """Check if logged into TikTok before automation."""
    manager = SafariSessionManager()
    return manager.require_login(Platform.TIKTOK)


def require_instagram_login() -> bool:
    """Check if logged into Instagram before automation."""
    manager = SafariSessionManager()
    return manager.require_login(Platform.INSTAGRAM)


def check_all_sessions() -> Dict[str, Dict]:
    """Check login status for all platforms."""
    manager = SafariSessionManager()
    results = {}
    
    for platform in Platform:
        state = manager.check_login_status(platform, navigate_if_needed=True)
        results[platform.value] = {
            'logged_in': state.is_logged_in,
            'error': state.error,
        }
        time.sleep(2)  # Brief pause between platforms
    
    return results


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description='Safari Session Manager')
    parser.add_argument('--check', choices=[p.value for p in Platform] + ['all'],
                       help='Check login status for a platform')
    parser.add_argument('--refresh', choices=[p.value for p in Platform],
                       help='Refresh session for a platform')
    parser.add_argument('--keeper', action='store_true',
                       help='Run session keeper (blocks)')
    
    args = parser.parse_args()
    
    manager = SafariSessionManager()
    
    if args.check:
        if args.check == 'all':
            print("=" * 60)
            print("Checking All Platform Sessions")
            print("=" * 60)
            results = check_all_sessions()
            for platform, status in results.items():
                icon = "✅" if status['logged_in'] else "❌"
                print(f"  {icon} {platform}: {'Logged in' if status['logged_in'] else status['error']}")
        else:
            platform = Platform(args.check)
            print(f"Checking {platform.value} login status...")
            state = manager.check_login_status(platform)
            print(json.dumps({
                'platform': platform.value,
                'logged_in': state.is_logged_in,
                'error': state.error,
                'indicator': state.indicator_found,
            }, indent=2))
    
    elif args.refresh:
        platform = Platform(args.refresh)
        print(f"Refreshing {platform.value} session...")
        success = manager.refresh_session(platform)
        print(f"Refresh {'successful' if success else 'failed'}")
    
    elif args.keeper:
        print("Starting session keeper (Ctrl+C to stop)...")
        manager.start_session_keeper()
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            manager.stop_session_keeper()
    
    else:
        parser.print_help()
        print("\nExamples:")
        print("  python safari_session_manager.py --check twitter")
        print("  python safari_session_manager.py --check all")
        print("  python safari_session_manager.py --refresh tiktok")
        print("  python safari_session_manager.py --keeper")
