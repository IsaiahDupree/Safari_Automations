#!/usr/bin/env python3
"""
Instagram Safari Automation - Ported from Riona TypeScript codebase.

Provides comprehensive Instagram automation via Safari and AppleScript:
- DM conversations (list, read, send)
- Notifications viewing
- Login verification
- Notes (view and create)

Based on: Riona/src/client/SafariController.ts and InstagramDM.ts
"""

import asyncio
import subprocess
import os
import time
import json
import re
from pathlib import Path
from datetime import datetime
from typing import Optional, List, Dict, Tuple, Any
from dataclasses import dataclass
from loguru import logger

try:
    from automation.safari_session_manager import SafariSessionManager, Platform
    HAS_SESSION_MANAGER = True
except ImportError:
    try:
        from safari_session_manager import SafariSessionManager, Platform
        HAS_SESSION_MANAGER = True
    except ImportError:
        HAS_SESSION_MANAGER = False


@dataclass
class ConversationInfo:
    """Instagram DM conversation info."""
    index: int
    username: str
    last_message: str
    timestamp: str
    is_unread: bool
    is_group: bool


@dataclass
class MessageInfo:
    """Instagram DM message info."""
    sender: str
    content: str
    timestamp: str
    is_from_me: bool
    message_type: str  # text, image, video, link, other


@dataclass
class NoteInfo:
    """Instagram Note info."""
    username: str
    content: str
    timestamp: str
    is_own: bool


@dataclass
class PageState:
    """Current Instagram page state."""
    url: str
    title: str
    logged_in: bool
    has_login_form: bool
    has_dm_inbox: bool
    conversation_count: int
    current_tab: str  # primary, general, requests, unknown


class SafariInstagramAutomation:
    """
    Safari-based Instagram automation using AppleScript.
    Ported from Riona TypeScript codebase.
    """
    
    SELECTORS = {
        # Login detection
        "logged_in_indicators": [
            'img[alt*="profile picture"]',
            'span[aria-label*="Profile"]',
            'a[href*="/direct/"]',
        ],
        # DM navigation
        "dm_inbox": 'a[href*="/direct/inbox"]',
        "conversation_link": 'a[href*="/direct/t/"]',
        # Message input
        "message_input": 'textarea[placeholder*="Message"]',
        "message_input_contenteditable": 'div[contenteditable="true"][role="textbox"]',
        # Notifications
        "notification_item": 'div[role="listitem"]',
        "activity_item": 'a[href*="/@"]',
    }
    
    def __init__(self, timeout: int = 60):
        self.timeout = timeout
        self.session_manager = SafariSessionManager() if HAS_SESSION_MANAGER else None
        logger.info("SafariInstagramAutomation initialized")
    
    def _run_applescript(self, script: str) -> Tuple[bool, str]:
        """Execute AppleScript and return (success, output)."""
        try:
            result = subprocess.run(
                ["osascript", "-e", script],
                capture_output=True,
                text=True,
                timeout=self.timeout
            )
            if result.returncode == 0:
                return True, result.stdout.strip()
            return False, result.stderr.strip()
        except subprocess.TimeoutExpired:
            return False, "timeout"
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
    if (count of windows) = 0 then
        make new document
    end if
    set URL of front document to "{url}"
end tell
'''
        success, _ = self._run_applescript(script)
        if success:
            time.sleep(2)
        return success
    
    def get_url(self) -> str:
        """Get current page URL."""
        script = '''
tell application "Safari"
    return URL of front document
end tell
'''
        success, url = self._run_applescript(script)
        return url if success else ""
    
    def require_login(self) -> bool:
        """Check if logged into Instagram."""
        if self.session_manager:
            return self.session_manager.require_login(Platform.INSTAGRAM)
        # Fallback: check via JS
        return self.check_login_status()
    
    def check_login_status(self) -> bool:
        """Check login status via page inspection."""
        js = '''
(function() {
    var indicators = [
        'img[alt*="profile picture"]',
        'span[aria-label*="Profile"]',
        'a[href*="/direct/"]'
    ];
    for (var i = 0; i < indicators.length; i++) {
        if (document.querySelector(indicators[i])) return 'true';
    }
    return 'false';
})();
'''
        result = self._run_js(js)
        return result == 'true'
    
    def get_page_state(self) -> PageState:
        """Get comprehensive page state."""
        js = '''
(function() {
    var url = window.location.href;
    var title = document.title;
    var loggedIn = !!document.querySelector('img[alt*="profile picture"]') || 
                   !!document.querySelector('span[aria-label*="Profile"]') ||
                   url.includes('/direct/');
    var hasLoginForm = !!document.querySelector('input[name="username"]');
    var hasDMInbox = url.includes('/direct/inbox') || url.includes('/direct/t/');
    var convElements = document.querySelectorAll('a[href*="/direct/t/"]');
    var conversationCount = convElements.length;
    var currentTab = 'unknown';
    
    return JSON.stringify({
        url: url,
        title: title,
        loggedIn: loggedIn,
        hasLoginForm: hasLoginForm,
        hasDMInbox: hasDMInbox,
        conversationCount: conversationCount,
        currentTab: currentTab
    });
})();
'''
        result = self._run_js(js)
        try:
            data = json.loads(result) if result else {}
            return PageState(
                url=data.get('url', ''),
                title=data.get('title', ''),
                logged_in=data.get('loggedIn', False),
                has_login_form=data.get('hasLoginForm', False),
                has_dm_inbox=data.get('hasDMInbox', False),
                conversation_count=data.get('conversationCount', 0),
                current_tab=data.get('currentTab', 'unknown')
            )
        except json.JSONDecodeError:
            return PageState('', '', False, False, False, 0, 'unknown')
    
    # ==================== DM FUNCTIONALITY ====================
    
    def navigate_to_dms(self) -> bool:
        """Navigate to Instagram Direct Messages."""
        self.navigate('https://www.instagram.com/direct/inbox/')
        time.sleep(3)
        state = self.get_page_state()
        return state.has_dm_inbox
    
    def get_conversations(self, limit: int = 20) -> List[ConversationInfo]:
        """Get list of DM conversations."""
        js = f'''
(function() {{
    var conversations = [];
    var convElements = [];
    
    // Strategy 1: Direct links to conversations
    var links = document.querySelectorAll('a[href*="/direct/t/"]');
    if (links.length > 0) {{
        convElements = Array.from(links);
    }}
    
    // Strategy 2: Profile pictures in conversation list
    if (convElements.length === 0) {{
        var imgs = document.querySelectorAll('img[alt*="profile picture"]');
        imgs.forEach(function(img) {{
            var parent = img.closest('div[role="button"]') || img.closest('a');
            if (parent && !convElements.includes(parent)) {{
                convElements.push(parent);
            }}
        }});
    }}
    
    convElements.slice(0, {limit}).forEach(function(element, index) {{
        try {{
            var container = element;
            
            // Extract username
            var usernameEl = container.querySelector('span[dir="auto"]') || 
                            container.querySelector('img[alt*="profile"]');
            var username = 'Unknown';
            if (usernameEl) {{
                if (usernameEl.tagName === 'IMG') {{
                    username = (usernameEl.getAttribute('alt') || '').replace("'s profile picture", '').trim();
                }} else {{
                    username = usernameEl.textContent.trim();
                }}
            }}
            
            // Extract last message preview
            var allSpans = container.querySelectorAll('span[dir="auto"], span');
            var lastMessage = '';
            for (var i = allSpans.length - 1; i >= 0; i--) {{
                var text = allSpans[i].textContent.trim();
                if (text && text !== username && text.length > 0 && text.length < 200) {{
                    lastMessage = text;
                    break;
                }}
            }}
            
            // Check for unread indicator
            var containerHTML = container.innerHTML || '';
            var isUnread = containerHTML.includes('rgb(0, 149, 246)') || 
                          containerHTML.includes('font-weight: 600') ||
                          !!container.querySelector('[aria-label*="unread"]');
            
            // Check if group chat
            var isGroup = username.includes(',') || 
                         (container.querySelectorAll('img[alt*="profile"]').length > 1);
            
            // Extract timestamp
            var timeEl = container.querySelector('time');
            var timestamp = timeEl ? (timeEl.getAttribute('datetime') || timeEl.textContent.trim()) : '';
            
            if (username !== 'Unknown' || lastMessage) {{
                conversations.push({{
                    index: index,
                    username: username.substring(0, 50),
                    lastMessage: lastMessage.substring(0, 100),
                    timestamp: timestamp,
                    isUnread: isUnread,
                    isGroup: isGroup
                }});
            }}
        }} catch (e) {{
            console.log('Error parsing conversation ' + index);
        }}
    }});
    
    return JSON.stringify(conversations);
}})();
'''
        result = self._run_js(js)
        try:
            data = json.loads(result) if result else []
            return [
                ConversationInfo(
                    index=c['index'],
                    username=c['username'],
                    last_message=c['lastMessage'],
                    timestamp=c['timestamp'],
                    is_unread=c['isUnread'],
                    is_group=c['isGroup']
                )
                for c in data
            ]
        except json.JSONDecodeError:
            return []
    
    def click_conversation(self, index: int) -> bool:
        """Click on a specific conversation by index."""
        js = f'''
(function() {{
    var convLinks = document.querySelectorAll('a[href*="/direct/t/"]');
    if (convLinks[{index}]) {{
        convLinks[{index}].click();
        return 'clicked';
    }}
    
    // Fallback: profile pictures
    var profileImgs = document.querySelectorAll('img[alt*="profile picture"]');
    var convContainers = [];
    profileImgs.forEach(function(img) {{
        var container = img.closest('div[role="button"]') || img.closest('div[tabindex="0"]');
        if (container && !convContainers.includes(container)) {{
            convContainers.push(container);
        }}
    }});
    
    if (convContainers[{index}]) {{
        convContainers[{index}].click();
        return 'clicked';
    }}
    
    return 'not_found';
}})();
'''
        result = self._run_js(js)
        if result.startswith('clicked'):
            time.sleep(2)
            return True
        return False
    
    def get_messages(self, limit: int = 20) -> List[MessageInfo]:
        """Get messages from current conversation."""
        js = f'''
(function() {{
    var messages = [];
    var seenContent = new Set();
    
    // Find message elements by their ID pattern (mid.$...)
    var msgElements = document.querySelectorAll('[id^="mid."]');
    
    msgElements.forEach(function(msgEl) {{
        try {{
            var textEl = msgEl.querySelector('span[dir="auto"]') || 
                        msgEl.querySelector('div[dir="auto"]');
            
            if (!textEl) return;
            
            var content = textEl.textContent.trim();
            if (!content || content.length < 1) return;
            if (seenContent.has(content)) return;
            seenContent.add(content);
            
            // Check if message is from me by looking at container alignment
            var isFromMe = false;
            var parentRow = msgEl.closest('div.x78zum5');
            if (parentRow) {{
                var style = window.getComputedStyle(parentRow);
                isFromMe = style.justifyContent === 'flex-end';
            }}
            
            messages.push({{
                sender: isFromMe ? 'me' : 'them',
                content: content.substring(0, 500),
                timestamp: '',
                isFromMe: isFromMe,
                type: 'text'
            }});
        }} catch (e) {{}}
    }});
    
    return JSON.stringify(messages.slice(0, {limit}));
}})();
'''
        result = self._run_js(js)
        try:
            data = json.loads(result) if result else []
            return [
                MessageInfo(
                    sender=m['sender'],
                    content=m['content'],
                    timestamp=m['timestamp'],
                    is_from_me=m['isFromMe'],
                    message_type=m['type']
                )
                for m in data
            ]
        except json.JSONDecodeError:
            return []
    
    def type_message(self, text: str) -> bool:
        """Type a message in the current conversation."""
        escaped = text.replace('\\', '\\\\').replace("'", "\\'").replace('"', '\\"').replace('\n', '\\n')
        js = f'''
(function() {{
    var input = document.querySelector('textarea[placeholder*="Message"]') ||
               document.querySelector('div[contenteditable="true"][role="textbox"]') ||
               document.querySelector('[aria-label*="Message"]');
    
    if (!input) return 'input_not_found';
    
    input.focus();
    
    if (input.tagName === 'TEXTAREA') {{
        input.value = '{escaped}';
        input.dispatchEvent(new Event('input', {{bubbles: true}}));
    }} else {{
        input.textContent = '{escaped}';
        input.dispatchEvent(new InputEvent('input', {{bubbles: true, data: '{escaped}'}}));
    }}
    
    return 'typed';
}})();
'''
        result = self._run_js(js)
        return result == 'typed'
    
    def send_message(self) -> bool:
        """Send the typed message."""
        js = '''
(function() {
    var sendBtn = document.querySelector('button[type="submit"]') ||
                 document.querySelector('[aria-label*="Send"]');
    
    if (sendBtn) {
        sendBtn.click();
        return 'sent';
    }
    
    // Fallback: press Enter
    var input = document.querySelector('textarea[placeholder*="Message"]') ||
               document.querySelector('div[contenteditable="true"][role="textbox"]');
    
    if (input) {
        input.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', keyCode: 13, bubbles: true}));
        return 'enter_pressed';
    }
    
    return 'not_sent';
})();
'''
        result = self._run_js(js)
        if result in ['sent', 'enter_pressed']:
            time.sleep(1)
            return True
        return False
    
    def send_dm(self, username: str, message: str) -> Dict[str, Any]:
        """Send a DM to a user (full flow)."""
        logger.info(f"Sending DM to @{username}")
        
        # Navigate to DMs
        if not self.navigate_to_dms():
            return {"success": False, "error": "Could not navigate to DMs"}
        
        time.sleep(2)
        
        # Find conversation
        conversations = self.get_conversations()
        target_idx = None
        for conv in conversations:
            if conv.username.lower() == username.lower():
                target_idx = conv.index
                break
        
        if target_idx is None:
            return {"success": False, "error": f"Conversation with @{username} not found"}
        
        # Open conversation
        if not self.click_conversation(target_idx):
            return {"success": False, "error": "Could not open conversation"}
        
        time.sleep(2)
        
        # Type and send message
        if not self.type_message(message):
            return {"success": False, "error": "Could not type message"}
        
        time.sleep(0.5)
        
        if not self.send_message():
            return {"success": False, "error": "Could not send message"}
        
        return {"success": True, "message": f"Sent DM to @{username}"}
    
    # ==================== NOTIFICATIONS ====================
    
    def navigate_to_activity(self) -> bool:
        """Navigate to activity/notifications."""
        self.navigate('https://www.instagram.com/accounts/activity/')
        time.sleep(3)
        return True
    
    def get_notifications(self, limit: int = 20) -> Dict[str, Any]:
        """Get recent notifications/activity."""
        if not self.navigate_to_activity():
            return {"success": False, "error": "Could not navigate to activity"}
        
        js = f'''
(function() {{
    var notifications = [];
    
    // Find notification items
    var items = document.querySelectorAll('div[role="listitem"], a[href*="/@"]');
    
    items.forEach(function(item, idx) {{
        if (idx >= {limit}) return;
        
        try {{
            var text = item.innerText.substring(0, 200);
            var link = item.href || item.querySelector('a')?.href || '';
            var timeEl = item.querySelector('time');
            var timestamp = timeEl ? timeEl.getAttribute('datetime') : '';
            
            // Skip if too short or UI text
            if (text.length < 5 || text === 'Activity') return;
            
            notifications.push({{
                text: text,
                link: link,
                timestamp: timestamp
            }});
        }} catch (e) {{}}
    }});
    
    return JSON.stringify(notifications);
}})();
'''
        result = self._run_js(js)
        try:
            data = json.loads(result) if result else []
            return {
                "success": True,
                "count": len(data),
                "notifications": data
            }
        except json.JSONDecodeError:
            return {"success": False, "error": "Failed to parse notifications"}
    
    # ==================== NOTES ====================
    
    def get_notes(self) -> List[NoteInfo]:
        """Get all visible notes from the DM inbox."""
        js = '''
(function() {
    var notes = [];
    
    var noteItems = document.querySelectorAll('ul > li');
    
    noteItems.forEach(function(item, index) {
        try {
            var noteContainer = item.querySelector('div.x1vjfegm');
            if (!noteContainer) return;
            
            var noteText = '';
            var textEl = noteContainer.querySelector('div[dir="auto"], span[dir="auto"]');
            if (textEl) {
                noteText = textEl.textContent.trim();
            }
            
            if (!noteText || noteText === 'Note...' || noteText === 'Your note') return;
            
            var username = 'Unknown';
            var imgEl = item.querySelector('img[alt*="profile"]');
            if (imgEl) {
                var alt = imgEl.getAttribute('alt') || '';
                username = alt.replace("'s profile picture", '').replace("'s note", '').trim();
            }
            
            var isOwn = index === 0;
            
            notes.push({
                username: username,
                content: noteText.substring(0, 60),
                timestamp: '',
                isOwn: isOwn
            });
        } catch (e) {}
    });
    
    return JSON.stringify(notes);
})();
'''
        result = self._run_js(js)
        try:
            data = json.loads(result) if result else []
            return [
                NoteInfo(
                    username=n['username'],
                    content=n['content'],
                    timestamp=n['timestamp'],
                    is_own=n['isOwn']
                )
                for n in data
            ]
        except json.JSONDecodeError:
            return []


class InstagramNotifications:
    """Instagram notifications handler."""
    
    def __init__(self):
        self.automation = SafariInstagramAutomation()
    
    def get_notifications(self, limit: int = 20) -> Dict[str, Any]:
        """Get recent notifications."""
        return self.automation.get_notifications(limit)


class InstagramDM:
    """Instagram DM handler."""
    
    def __init__(self):
        self.automation = SafariInstagramAutomation()
    
    def get_conversations(self, limit: int = 20) -> Dict[str, Any]:
        """Get DM conversations list."""
        if not self.automation.navigate_to_dms():
            return {"success": False, "error": "Could not navigate to DMs"}
        
        time.sleep(2)
        conversations = self.automation.get_conversations(limit)
        
        return {
            "success": True,
            "count": len(conversations),
            "conversations": [
                {
                    "name": c.username,
                    "preview": c.last_message,
                    "unread": c.is_unread,
                    "is_group": c.is_group,
                    "timestamp": c.timestamp
                }
                for c in conversations
            ]
        }
    
    def read_messages(self, username: str, limit: int = 20) -> Dict[str, Any]:
        """Read messages from a conversation."""
        if not self.automation.navigate_to_dms():
            return {"success": False, "error": "Could not navigate to DMs"}
        
        time.sleep(2)
        
        # Find and open conversation
        conversations = self.automation.get_conversations()
        target_idx = None
        for conv in conversations:
            if conv.username.lower() == username.lower():
                target_idx = conv.index
                break
        
        if target_idx is None:
            return {"success": False, "error": f"Conversation with @{username} not found"}
        
        if not self.automation.click_conversation(target_idx):
            return {"success": False, "error": "Could not open conversation"}
        
        time.sleep(2)
        messages = self.automation.get_messages(limit)
        
        return {
            "success": True,
            "count": len(messages),
            "messages": [
                {
                    "sender": m.sender,
                    "content": m.content,
                    "is_from_me": m.is_from_me,
                    "type": m.message_type
                }
                for m in messages
            ]
        }
    
    def send_message(self, username: str, message: str) -> Dict[str, Any]:
        """Send a DM to a user."""
        return self.automation.send_dm(username, message)


# ==================== CLI ====================

def main():
    import argparse
    
    parser = argparse.ArgumentParser(
        description="Instagram Safari Automation CLI",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s --check-login
  %(prog)s notifications
  %(prog)s dm list
  %(prog)s dm read username
  %(prog)s dm send username "Hello!"
"""
    )
    
    parser.add_argument('--check-login', action='store_true', help='Check Instagram login status')
    
    subparsers = parser.add_subparsers(dest='command')
    
    # Notifications
    notif_parser = subparsers.add_parser('notifications', help='View notifications')
    notif_parser.add_argument('--limit', type=int, default=20, help='Max notifications')
    
    # DM commands
    dm_parser = subparsers.add_parser('dm', help='DM commands')
    dm_subparsers = dm_parser.add_subparsers(dest='dm_command')
    
    dm_list = dm_subparsers.add_parser('list', help='List conversations')
    dm_list.add_argument('--limit', type=int, default=20, help='Max conversations')
    
    dm_read = dm_subparsers.add_parser('read', help='Read messages from conversation')
    dm_read.add_argument('username', help='Username to read messages from')
    dm_read.add_argument('--limit', type=int, default=20, help='Max messages')
    
    dm_send = dm_subparsers.add_parser('send', help='Send a DM')
    dm_send.add_argument('username', help='Username to send to')
    dm_send.add_argument('message', help='Message to send')
    
    args = parser.parse_args()
    
    automation = SafariInstagramAutomation()
    
    if args.check_login:
        automation.activate()
        automation.navigate('https://www.instagram.com/')
        time.sleep(3)
        logged_in = automation.check_login_status()
        if logged_in:
            print("✓ Logged into Instagram")
        else:
            print("✗ Not logged into Instagram")
            print("  Please log in manually in Safari")
        return
    
    if args.command == 'notifications':
        notif = InstagramNotifications()
        result = notif.get_notifications(args.limit)
        if result['success']:
            print(f"\n📬 Notifications ({result['count']}):\n")
            for n in result['notifications']:
                print(f"  • {n['text'][:80]}...")
        else:
            print(f"Error: {result['error']}")
    
    elif args.command == 'dm':
        dm = InstagramDM()
        
        if args.dm_command == 'list':
            result = dm.get_conversations(args.limit)
            if result['success']:
                print(f"\n💬 Conversations ({result['count']}):\n")
                for c in result['conversations']:
                    status = "🔵" if c['unread'] else "⚪"
                    print(f"  {status} {c['name']}: {c['preview'][:50]}...")
            else:
                print(f"Error: {result['error']}")
        
        elif args.dm_command == 'read':
            result = dm.read_messages(args.username, args.limit)
            if result['success']:
                print(f"\n📨 Messages with @{args.username} ({result['count']}):\n")
                for m in result['messages']:
                    prefix = "→" if m['is_from_me'] else "←"
                    print(f"  {prefix} {m['content'][:80]}...")
            else:
                print(f"Error: {result['error']}")
        
        elif args.dm_command == 'send':
            result = dm.send_message(args.username, args.message)
            if result['success']:
                print(f"✓ {result['message']}")
            else:
                print(f"Error: {result['error']}")
    
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
