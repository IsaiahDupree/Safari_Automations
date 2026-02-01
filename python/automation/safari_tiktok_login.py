#!/usr/bin/env python3
"""
TikTok Login Automation using Safari and AppleScript.
Uses native macOS Safari automation to leverage existing browser session.
"""

import asyncio
import subprocess
import os
import time
from pathlib import Path
from datetime import datetime
from typing import Optional, Dict
from loguru import logger
from dotenv import load_dotenv

# Load environment variables
load_dotenv()


class SafariTikTokAutomation:
    """Safari-based TikTok automation using AppleScript."""
    
    def __init__(self):
        self.username = os.getenv("TIKTOK_USERNAME", "")
        self.password = os.getenv("TIKTOK_PASSWORD", "")
        self.screenshots_dir = Path(__file__).parent / "screenshots"
        self.screenshots_dir.mkdir(exist_ok=True)
        
        logger.info(f"Safari TikTok automation initialized for user: {self.username}")
    
    def run_applescript(self, script: str) -> str:
        """Execute an AppleScript and return the result."""
        try:
            result = subprocess.run(
                ["osascript", "-e", script],
                capture_output=True,
                text=True,
                timeout=30
            )
            if result.returncode != 0:
                logger.error(f"AppleScript error: {result.stderr}")
                return ""
            return result.stdout.strip()
        except subprocess.TimeoutExpired:
            logger.error("AppleScript execution timed out")
            return ""
        except Exception as e:
            logger.error(f"AppleScript execution failed: {e}")
            return ""
    
    def open_safari(self) -> bool:
        """Open Safari browser."""
        script = '''
        tell application "Safari"
            activate
        end tell
        '''
        self.run_applescript(script)
        time.sleep(1)
        return True
    
    def navigate_to_url(self, url: str) -> bool:
        """Navigate Safari to a URL."""
        script = f'''
        tell application "Safari"
            activate
            if (count of windows) = 0 then
                make new document
            end if
            set URL of front document to "{url}"
        end tell
        '''
        self.run_applescript(script)
        time.sleep(3)  # Wait for page to load
        return True
    
    def get_current_url(self) -> str:
        """Get the current URL from Safari."""
        script = '''
        tell application "Safari"
            if (count of windows) > 0 then
                return URL of front document
            end if
            return ""
        end tell
        '''
        return self.run_applescript(script)
    
    def get_page_source(self) -> str:
        """Get the page source/HTML from Safari."""
        script = '''
        tell application "Safari"
            if (count of windows) > 0 then
                return source of front document
            end if
            return ""
        end tell
        '''
        return self.run_applescript(script)
    
    def execute_javascript(self, js_code: str) -> str:
        """Execute JavaScript in Safari and return the result."""
        # Escape backslashes first, then quotes for AppleScript
        js_escaped = js_code.replace('\\', '\\\\').replace('"', '\\"')
        script = f'''
tell application "Safari"
    if (count of windows) > 0 then
        return do JavaScript "{js_escaped}" in front document
    end if
    return ""
end tell
'''
        return self.run_applescript(script)
    
    def click_element_by_selector(self, selector: str) -> bool:
        """Click an element using JavaScript selector."""
        js_code = f"document.querySelector('{selector}')?.click(); 'clicked';"
        result = self.execute_javascript(js_code)
        return result == "clicked"
    
    def fill_input(self, selector: str, value: str) -> bool:
        """Fill an input field using JavaScript."""
        js_code = f'''
        var el = document.querySelector('{selector}');
        if (el) {{
            el.value = '{value}';
            el.dispatchEvent(new Event('input', {{ bubbles: true }}));
            'filled';
        }} else {{
            'not found';
        }}
        '''
        result = self.execute_javascript(js_code)
        return result == "filled"
    
    def wait_for_element(self, selector: str, timeout: int = 10) -> bool:
        """Wait for an element to appear on the page."""
        start_time = time.time()
        while time.time() - start_time < timeout:
            js_code = f"document.querySelector('{selector}') ? 'found' : 'not found';"
            result = self.execute_javascript(js_code)
            if result == "found":
                return True
            time.sleep(0.5)
        return False
    
    def take_screenshot(self, name: str) -> Optional[Path]:
        """Take a screenshot using macOS screencapture."""
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filepath = self.screenshots_dir / f"{name}_{timestamp}.png"
        try:
            subprocess.run(
                ["screencapture", "-x", "-w", str(filepath)],
                timeout=10
            )
            logger.info(f"Screenshot saved: {filepath}")
            return filepath
        except Exception as e:
            logger.error(f"Screenshot failed: {e}")
            return None
    
    def check_if_logged_in(self) -> bool:
        """Check if user is already logged into TikTok."""
        # Check for profile icon or upload button that appears when logged in
        js_code = '''
        (document.querySelector('[data-e2e="profile-icon"]') ||
         document.querySelector('[data-e2e="upload-icon"]') ||
         document.querySelector('a[href*="/upload"]')) ? 'logged_in' : 'not_logged_in';
        '''
        result = self.execute_javascript(js_code)
        return result == "logged_in"
    
    async def login(self) -> bool:
        """
        Perform TikTok login using Safari.
        Returns True if login successful.
        """
        try:
            logger.info("Starting Safari TikTok login...")
            
            # Open Safari
            self.open_safari()
            
            # Navigate to TikTok
            logger.info("Navigating to TikTok...")
            self.navigate_to_url("https://www.tiktok.com/en/")
            time.sleep(3)
            
            # Check if already logged in
            if self.check_if_logged_in():
                logger.success("Already logged in to TikTok!")
                return True
            
            # Click the login button
            logger.info("Looking for login button...")
            
            # Try clicking the sidebar login button
            clicked = self.click_element_by_selector('#header-login-button')
            if not clicked:
                # Try alternative selectors
                clicked = self.click_element_by_selector('[data-e2e="top-login-button"]')
            
            if not clicked:
                logger.warning("Could not find login button, trying direct navigation...")
                self.navigate_to_url("https://www.tiktok.com/login/phone-or-email/email")
                time.sleep(2)
            else:
                time.sleep(2)  # Wait for modal
            
            # Wait for login modal or form
            if self.wait_for_element('input[name="username"]', timeout=10):
                logger.info("Login form found, entering credentials...")
                
                # Fill username
                self.fill_input('input[name="username"]', self.username)
                time.sleep(0.5)
                
                # Fill password
                self.fill_input('input[type="password"]', self.password)
                time.sleep(0.5)
                
                # Click login button
                self.click_element_by_selector('button[type="submit"]')
                time.sleep(5)
                
                # Check for captcha
                captcha_detected = self.execute_javascript(
                    "document.querySelector('[class*=\"captcha\"]') ? 'yes' : 'no';"
                )
                if captcha_detected == "yes":
                    logger.warning("Captcha detected! Manual intervention may be required.")
                    # Wait for user to solve captcha
                    time.sleep(30)
            
            else:
                # Try clicking "Use phone / email / username" first
                logger.info("Looking for email login option...")
                self.click_element_by_selector('[data-e2e="channel-item"]:has-text("email")')
                time.sleep(2)
            
            # Verify login
            time.sleep(5)
            if self.check_if_logged_in():
                logger.success("Login successful!")
                return True
            else:
                current_url = self.get_current_url()
                logger.error(f"Login verification failed. Current URL: {current_url}")
                return False
                
        except Exception as e:
            logger.error(f"Login error: {e}")
            return False
    
    async def get_account_stats(self) -> Optional[Dict]:
        """Get TikTok account statistics after login."""
        try:
            # Navigate to profile
            logger.info("Navigating to profile...")
            self.click_element_by_selector('[data-e2e="profile-icon"]')
            time.sleep(3)
            
            # Extract stats
            stats = {}
            
            # Followers
            followers = self.execute_javascript(
                "document.querySelector('[data-e2e=\"followers-count\"]')?.innerText || '0';"
            )
            stats['followers'] = followers
            
            # Following
            following = self.execute_javascript(
                "document.querySelector('[data-e2e=\"following-count\"]')?.innerText || '0';"
            )
            stats['following'] = following
            
            # Likes
            likes = self.execute_javascript(
                "document.querySelector('[data-e2e=\"likes-count\"]')?.innerText || '0';"
            )
            stats['likes'] = likes
            
            logger.info(f"Account stats: {stats}")
            return stats
            
        except Exception as e:
            logger.error(f"Failed to get account stats: {e}")
            return None
    
    def close_safari(self):
        """Close Safari browser."""
        script = '''
        tell application "Safari"
            quit
        end tell
        '''
        self.run_applescript(script)


async def main():
    """Main entry point for Safari TikTok automation."""
    automation = SafariTikTokAutomation()
    
    try:
        success = await automation.login()
        
        if success:
            logger.success("✅ TikTok login automation completed successfully!")
            
            # Get account stats
            stats = await automation.get_account_stats()
            if stats:
                logger.info(f"Account statistics: {stats}")
        else:
            logger.error("❌ TikTok login automation failed")
            
    except Exception as e:
        logger.error(f"Automation error: {e}")
    finally:
        # Don't close Safari so user can see the result
        logger.info("Safari session left open for review")


if __name__ == "__main__":
    asyncio.run(main())
