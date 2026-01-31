"""
Safari Browser Controller for Social Media Automation

Provides core Safari automation utilities using AppleScript and JavaScript injection.
This module is the foundation for all platform-specific engagement scripts.

Usage:
    from auto_engagement.safari_controller import SafariController
    
    safari = SafariController()
    safari.navigate_to('https://www.instagram.com/')
    result = safari.execute_js('return document.title')
"""

import subprocess
import tempfile
import time
import os
from typing import Optional, Tuple
from dataclasses import dataclass


@dataclass
class NavigationResult:
    """Result of a navigation attempt."""
    success: bool
    url: str
    error: str = ""


class SafariController:
    """
    Safari browser controller with robust state management.
    
    Handles AppleScript execution, JavaScript injection, screenshots,
    and maintains browser state across platform navigations.
    """
    
    def __init__(self):
        self._last_url = ""
        self._session_active = False
    
    def run_applescript(self, script: str, timeout: int = 30) -> Tuple[bool, str]:
        """
        Execute AppleScript and return (success, output).
        
        Args:
            script: AppleScript code to execute
            timeout: Maximum execution time in seconds
            
        Returns:
            Tuple of (success: bool, output: str)
        """
        try:
            result = subprocess.run(
                ['osascript', '-e', script],
                capture_output=True,
                text=True,
                timeout=timeout
            )
            return result.returncode == 0, result.stdout.strip()
        except subprocess.TimeoutExpired:
            return False, "timeout"
        except Exception as e:
            return False, str(e)
    
    def ensure_safari_ready(self) -> bool:
        """
        Ensure Safari is running and has a window.
        
        Returns:
            True if Safari is ready, False otherwise
        """
        script = '''
        tell application "Safari"
            activate
            if (count of windows) = 0 then
                make new document
                delay 1
            end if
            return "ready"
        end tell
        '''
        success, _ = self.run_applescript(script)
        self._session_active = success
        return success
    
    def navigate_to(self, url: str, wait_time: float = 3.0) -> NavigationResult:
        """
        Navigate Safari to URL.
        
        Args:
            url: URL to navigate to
            wait_time: Seconds to wait after navigation
            
        Returns:
            NavigationResult with success status and current URL
        """
        self.ensure_safari_ready()
        
        script = f'''
        tell application "Safari"
            activate
            set URL of front document to "{url}"
        end tell
        '''
        success, _ = self.run_applescript(script)
        
        if success:
            self._last_url = url
            time.sleep(wait_time)
            current = self.get_current_url()
            return NavigationResult(success=True, url=current)
        
        return NavigationResult(success=False, url="", error="Navigation failed")
    
    def navigate_with_verification(self, url: str, domain: str, max_attempts: int = 3) -> NavigationResult:
        """
        Navigate to URL with domain verification and retry logic.
        
        Args:
            url: URL to navigate to
            domain: Domain to verify (e.g., 'tiktok.com')
            max_attempts: Maximum navigation attempts
            
        Returns:
            NavigationResult with verification status
        """
        for attempt in range(max_attempts):
            if attempt > 0:
                self.navigate_to('about:blank', wait_time=1)
            
            self.navigate_to(url, wait_time=2)
            
            if self.wait_for_url_contains(domain, timeout=8):
                return NavigationResult(success=True, url=self.get_current_url())
            
            print(f"      Retry {attempt + 1}/{max_attempts}...")
        
        return NavigationResult(success=False, url="", error=f"Failed to verify {domain}")
    
    def get_current_url(self) -> str:
        """Get current Safari URL."""
        script = 'tell application "Safari" to return URL of front document'
        success, url = self.run_applescript(script)
        return url if success else ""
    
    def wait_for_url_contains(self, domain: str, timeout: int = 10) -> bool:
        """
        Wait until URL contains the expected domain.
        
        Args:
            domain: Domain string to check for
            timeout: Maximum wait time in seconds
            
        Returns:
            True if domain found in URL, False if timeout
        """
        for _ in range(timeout):
            url = self.get_current_url()
            if domain in url:
                return True
            time.sleep(1)
        return False
    
    def execute_js(self, code: str) -> Optional[str]:
        """
        Execute JavaScript in Safari and return result.
        
        Args:
            code: JavaScript code to execute
            
        Returns:
            Result string or None if execution failed
        """
        with tempfile.NamedTemporaryFile(mode='w', suffix='.js', delete=False) as f:
            f.write(code)
            js_file = f.name
        
        script = f'''
        tell application "Safari"
            tell front document
                set jsCode to read POSIX file "{js_file}"
                do JavaScript jsCode
            end tell
        end tell
        '''
        
        success, output = self.run_applescript(script, timeout=15)
        os.unlink(js_file)
        return output if success else None
    
    def take_screenshot(self, filepath: str) -> bool:
        """
        Take screenshot of Safari window.
        
        Args:
            filepath: Path to save screenshot
            
        Returns:
            True if screenshot saved successfully
        """
        script = f'''
        tell application "Safari" to activate
        delay 0.3
        tell application "System Events"
            tell process "Safari"
                set frontWindow to front window
                set winPos to position of frontWindow
                set winSize to size of frontWindow
            end tell
        end tell
        set x to item 1 of winPos
        set y to item 2 of winPos
        set w to item 1 of winSize
        set h to item 2 of winSize
        do shell script "screencapture -R" & x & "," & y & "," & w & "," & h & " {filepath}"
        '''
        success, _ = self.run_applescript(script)
        return success
    
    def type_via_clipboard(self, text: str) -> bool:
        """
        Type text using clipboard paste (supports emojis).
        
        Args:
            text: Text to type (can include emojis)
            
        Returns:
            True if text was pasted successfully
        """
        process = subprocess.Popen(['pbcopy'], stdin=subprocess.PIPE)
        process.communicate(text.encode('utf-8'))
        time.sleep(0.2)
        
        script = '''
        tell application "Safari" to activate
        delay 0.2
        tell application "System Events"
            keystroke "v" using command down
        end tell
        '''
        success, _ = self.run_applescript(script)
        return success
    
    def press_enter(self) -> bool:
        """Press Enter key."""
        script = '''
        tell application "Safari" to activate
        delay 0.1
        tell application "System Events"
            keystroke return
        end tell
        '''
        success, _ = self.run_applescript(script)
        return success
    
    def refresh_page(self) -> bool:
        """Refresh current page."""
        script = '''
        tell application "Safari"
            tell front document
                do JavaScript "location.reload()"
            end tell
        end tell
        '''
        success, _ = self.run_applescript(script)
        time.sleep(2)
        return success
    
    def scroll_down(self, pixels: int = 400) -> bool:
        """Scroll page down by specified pixels."""
        return self.execute_js(f'window.scrollBy(0, {pixels})') is not None
