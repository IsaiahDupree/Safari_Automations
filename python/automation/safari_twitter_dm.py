#!/usr/bin/env python3
"""
Safari Twitter/X DM Automation
Handles direct message sending via Safari browser automation using AppleScript.

Features:
- Send DMs to specific users
- Check for new/unread DMs
- Retrieve conversation history
- Session management and login verification
- Rate limiting to avoid suspension

Note: Twitter's API v2 has limited DM capabilities without special access,
so Safari automation provides a reliable fallback.
"""
import subprocess
import time
import json
import os
from typing import Optional, Dict, List, Tuple
from datetime import datetime
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


class SafariTwitterDM:
    """Send and manage Twitter DMs via Safari browser automation."""

    # Twitter/X URLs
    X_MESSAGES_URL = "https://x.com/messages"
    X_DM_COMPOSE_URL = "https://x.com/messages/compose"

    def __init__(self):
        """Initialize Twitter DM automation."""
        self.last_dm_time = None
        self.min_interval_seconds = 10  # Minimum time between DMs (rate limiting)

        # Session manager (if available)
        if HAS_SESSION_MANAGER:
            self.session_manager = SafariSessionManager()
        else:
            self.session_manager = None

    def _run_applescript(self, script: str, timeout: int = 30) -> Tuple[bool, str]:
        """
        Run AppleScript and return success status and output.

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
            return result.returncode == 0, result.stdout.strip() or result.stderr.strip()
        except subprocess.TimeoutExpired:
            logger.error(f"AppleScript timeout after {timeout}s")
            return False, "AppleScript timeout"
        except Exception as e:
            logger.error(f"AppleScript error: {str(e)}")
            return False, str(e)

    def _wait_for_load(self, seconds: float = 2.0):
        """Wait for page to load."""
        time.sleep(seconds)

    def _ensure_rate_limit(self):
        """Ensure we don't exceed rate limits."""
        if self.last_dm_time:
            elapsed = time.time() - self.last_dm_time
            if elapsed < self.min_interval_seconds:
                wait_time = self.min_interval_seconds - elapsed
                logger.info(f"Rate limiting: waiting {wait_time:.1f}s")
                time.sleep(wait_time)

        self.last_dm_time = time.time()

    def is_logged_in(self) -> bool:
        """
        Check if user is logged into Twitter in Safari.

        Returns:
            True if logged in, False otherwise
        """
        if self.session_manager:
            return self.session_manager.is_logged_in(Platform.TWITTER)

        # Fallback: Check if we can access messages URL
        script = f'''
        tell application "Safari"
            if not running then return "not_running"

            -- Try to access messages page
            set URL of current tab of window 1 to "{self.X_MESSAGES_URL}"
            delay 2

            -- Check if we're on login page or messages page
            set currentURL to URL of current tab of window 1
            if currentURL contains "login" or currentURL contains "oauth" then
                return "not_logged_in"
            else if currentURL contains "messages" then
                return "logged_in"
            else
                return "unknown"
            end if
        end tell
        '''

        success, output = self._run_applescript(script)
        return success and output == "logged_in"

    def open_messages(self) -> bool:
        """
        Open Twitter Messages in Safari.

        Returns:
            True if successful, False otherwise
        """
        logger.info("Opening Twitter Messages...")

        script = f'''
        tell application "Safari"
            activate
            if (count of windows) = 0 then
                make new document
            end if
            set URL of current tab of window 1 to "{self.X_MESSAGES_URL}"
            delay 3
        end tell
        return "opened"
        '''

        success, output = self._run_applescript(script)

        if success:
            logger.success("✓ Opened Twitter Messages")
            return True
        else:
            logger.error(f"Failed to open messages: {output}")
            return False

    def send_dm(
        self,
        username: str,
        message: str,
        wait_before_send: float = 1.0
    ) -> bool:
        """
        Send a DM to a specific Twitter user.

        Args:
            username: Twitter username (without @)
            message: Message text to send
            wait_before_send: Seconds to wait before sending (default: 1.0)

        Returns:
            True if successful, False otherwise
        """
        # Ensure we're logged in
        if not self.is_logged_in():
            logger.error("Not logged into Twitter. Please log in first.")
            return False

        # Rate limiting
        self._ensure_rate_limit()

        logger.info(f"Sending DM to @{username}...")

        # Escape message for AppleScript
        escaped_message = message.replace('"', '\\"').replace('\n', '\\n')
        escaped_username = username.replace('"', '\\"')

        # AppleScript to send DM
        script = f'''
        tell application "Safari"
            activate

            -- Navigate to compose DM page
            set URL of current tab of window 1 to "{self.X_DM_COMPOSE_URL}"
            delay 2

            -- Type username in search field
            tell application "System Events"
                -- Click search input (usually auto-focused)
                keystroke "{escaped_username}"
                delay 1.5

                -- Press down arrow to select first result
                key code 125
                delay 0.5

                -- Press enter to select user
                keystroke return
                delay 1.5

                -- Type message in text field
                keystroke "{escaped_message}"
                delay {wait_before_send}

                -- Send message (Cmd+Enter or click Send button)
                keystroke return using {{command down}}
                delay 1
            end tell

            return "sent"
        end tell
        '''

        success, output = self._run_applescript(script, timeout=60)

        if success and output == "sent":
            logger.success(f"✓ DM sent to @{username}")
            return True
        else:
            logger.error(f"Failed to send DM: {output}")
            return False

    def get_unread_count(self) -> Optional[int]:
        """
        Get the number of unread DM conversations.

        Returns:
            Number of unread conversations, or None if unable to determine
        """
        logger.info("Checking for unread DMs...")

        # Open messages page
        if not self.open_messages():
            return None

        # AppleScript to check for unread indicator
        script = f'''
        tell application "Safari"
            -- Check for unread badge/indicator
            do JavaScript "
                const badge = document.querySelector('[data-testid=\"unread-badge\"]');
                if (badge) {{
                    badge.textContent || '0';
                }} else {{
                    '0';
                }}
            " in current tab of window 1
        end tell
        '''

        success, output = self._run_applescript(script)

        if success:
            try:
                count = int(output)
                logger.info(f"Found {count} unread DM(s)")
                return count
            except ValueError:
                logger.warning(f"Could not parse unread count: {output}")
                return None
        else:
            logger.error(f"Failed to get unread count: {output}")
            return None

    def check_inbox(self) -> List[Dict[str, str]]:
        """
        Check DM inbox for recent conversations.

        Returns:
            List of conversations with username and last message preview
        """
        logger.info("Checking DM inbox...")

        # Open messages page
        if not self.open_messages():
            return []

        self._wait_for_load(3)

        # AppleScript to extract conversation list
        script = f'''
        tell application "Safari"
            do JavaScript "
                const conversations = [];
                const items = document.querySelectorAll('[data-testid=\"conversation\"]');

                items.forEach(item => {{
                    const username = item.querySelector('[data-testid=\"User-Name\"]')?.textContent || 'Unknown';
                    const preview = item.querySelector('[data-testid=\"messagePreview\"]')?.textContent || '';
                    const isUnread = item.querySelector('[data-testid=\"unread-badge\"]') !== null;

                    conversations.push({{
                        username: username,
                        preview: preview,
                        unread: isUnread
                    }});
                }});

                JSON.stringify(conversations);
            " in current tab of window 1
        end tell
        '''

        success, output = self._run_applescript(script, timeout=45)

        if success:
            try:
                conversations = json.loads(output)
                logger.info(f"Found {len(conversations)} conversation(s)")
                return conversations
            except json.JSONDecodeError:
                logger.error(f"Could not parse conversations: {output}")
                return []
        else:
            logger.error(f"Failed to check inbox: {output}")
            return []

    def send_bulk_dms(
        self,
        recipients: List[str],
        message: str,
        delay_between: float = 15.0
    ) -> Dict[str, bool]:
        """
        Send the same message to multiple recipients.

        Args:
            recipients: List of Twitter usernames
            message: Message text to send
            delay_between: Seconds to wait between each DM (default: 15.0)

        Returns:
            Dict mapping username to success status
        """
        results = {}

        logger.info(f"Sending bulk DMs to {len(recipients)} recipients...")

        for i, username in enumerate(recipients, 1):
            logger.info(f"[{i}/{len(recipients)}] Sending to @{username}...")

            success = self.send_dm(username, message)
            results[username] = success

            # Wait between DMs (except after last one)
            if i < len(recipients):
                logger.info(f"Waiting {delay_between}s before next DM...")
                time.sleep(delay_between)

        successful = sum(1 for v in results.values() if v)
        logger.success(f"✓ Sent {successful}/{len(recipients)} DMs successfully")

        return results


def main():
    """Test the Twitter DM automation."""
    dm_automation = SafariTwitterDM()

    print("=== Twitter DM Automation Test ===\n")

    # Check login status
    print("1. Checking login status...")
    if dm_automation.is_logged_in():
        print("✓ Logged into Twitter\n")
    else:
        print("✗ Not logged in. Please log into Twitter in Safari first.\n")
        return

    # Open messages
    print("2. Opening messages...")
    if dm_automation.open_messages():
        print("✓ Messages opened\n")
    else:
        print("✗ Failed to open messages\n")
        return

    # Check unread count
    print("3. Checking unread DMs...")
    unread = dm_automation.get_unread_count()
    if unread is not None:
        print(f"✓ Unread DMs: {unread}\n")
    else:
        print("✗ Could not get unread count\n")

    # Check inbox
    print("4. Checking inbox...")
    conversations = dm_automation.check_inbox()
    if conversations:
        print(f"✓ Found {len(conversations)} conversation(s):")
        for conv in conversations[:5]:  # Show first 5
            unread_mark = "🔴" if conv.get("unread") else "  "
            print(f"  {unread_mark} @{conv['username']}: {conv['preview'][:50]}...")
    else:
        print("✗ No conversations found or failed to check inbox\n")

    # Test sending (commented out by default)
    # print("\n5. Sending test DM...")
    # success = dm_automation.send_dm(
    #     username="test_user",
    #     message="This is a test DM from MediaPoster automation"
    # )
    # if success:
    #     print("✓ DM sent successfully")
    # else:
    #     print("✗ Failed to send DM")


if __name__ == "__main__":
    main()
