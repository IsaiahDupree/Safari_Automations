#!/usr/bin/env python3
"""
TikTok Safari Automation CLI - Unified command line interface for all TikTok features.

Features:
- Engagement: like, comment, follow
- DMs: list conversations, read messages, send messages
- Notifications: view inbox activity
- Navigation: FYP, profiles, videos

Usage:
    python safari_tiktok_cli.py --help
"""

import asyncio
import argparse
import json
import sys
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from loguru import logger

# Import TikTok automation modules
try:
    from automation.safari_session_manager import SafariSessionManager, Platform
except ImportError:
    from safari_session_manager import SafariSessionManager, Platform

try:
    from automation.safari_app_controller import SafariAppController
except ImportError:
    from safari_app_controller import SafariAppController

# Import TikTok modules with optional playwright dependency
TikTokEngagement = None
TikTokNotifications = None
TikTokMessenger = None

try:
    from automation.tiktok_engagement import TikTokEngagement, TikTokNotifications
except ImportError:
    try:
        from tiktok_engagement import TikTokEngagement, TikTokNotifications
    except ImportError:
        logger.warning("TikTokEngagement not available (missing playwright)")

try:
    from automation.tiktok_messenger import TikTokMessenger
except ImportError:
    try:
        from tiktok_messenger import TikTokMessenger
    except ImportError:
        logger.warning("TikTokMessenger not available")


def check_login():
    """Check TikTok login status."""
    manager = SafariSessionManager()
    state = manager.check_login_status(Platform.TIKTOK)
    return {
        'logged_in': state.is_logged_in,
        'platform': 'tiktok',
        'indicator': state.indicator_found,
        'error': state.error
    }


async def run_like(video_url: str):
    """Like a video."""
    engagement = TikTokEngagement()
    try:
        await engagement.start(video_url)
        result = await engagement.like_current_video()
        return {'success': result, 'action': 'like', 'url': video_url}
    finally:
        await engagement.cleanup()


async def run_comment(video_url: str, comment_text: str):
    """Post a comment on a video."""
    engagement = TikTokEngagement()
    try:
        await engagement.start(video_url)
        result = await engagement.post_comment(comment_text)
        return result
    finally:
        await engagement.cleanup()


async def run_follow(username: str):
    """Follow a user."""
    engagement = TikTokEngagement()
    try:
        await engagement.start()
        await engagement.navigate_to_profile(username)
        result = await engagement.follow_user()
        return {'success': result, 'action': 'follow', 'username': username}
    finally:
        await engagement.cleanup()


def run_notifications(limit: int = 20):
    """Get notifications."""
    notifications = TikTokNotifications()
    return notifications.get_notifications(limit=limit)


def run_activity(limit: int = 20):
    """Get all activity."""
    notifications = TikTokNotifications()
    return notifications.get_all_activity(limit=limit)


def run_dm_list(limit: int = 20):
    """List DM conversations."""
    controller = SafariAppController()
    messenger = TikTokMessenger(controller)
    if messenger.open_inbox():
        conversations = messenger.get_conversations()
        return {
            'success': True,
            'count': len(conversations),
            'conversations': [
                {
                    'username': c.username,
                    'preview': c.last_message,
                    'time': c.timestamp,
                    'unread': c.unread
                }
                for c in conversations[:limit]
            ]
        }
    return {'success': False, 'error': 'Could not open inbox'}


def run_dm_read(username: str, limit: int = 50):
    """Read messages from a user."""
    controller = SafariAppController()
    messenger = TikTokMessenger(controller)
    if messenger.open_inbox():
        if messenger.open_conversation(username):
            messages = messenger.get_messages(limit=limit)
            return {
                'success': True,
                'count': len(messages),
                'messages': [
                    {
                        'text': m.text,
                        'time': m.timestamp,
                        'is_sent': m.is_self
                    }
                    for m in messages
                ]
            }
        return {'success': False, 'error': f'Could not open conversation with {username}'}
    return {'success': False, 'error': 'Could not open inbox'}


def run_dm_send(username: str, message: str):
    """Send a DM to a user."""
    controller = SafariAppController()
    messenger = TikTokMessenger(controller)
    result = messenger.send_to_user(username, message)
    return {
        'success': result,
        'action': 'send_dm',
        'recipient': username,
        'message': message[:50]
    }


def main():
    parser = argparse.ArgumentParser(
        description='TikTok Safari Automation - Full Feature CLI',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
EXAMPLES:
  Check login:
    python safari_tiktok_cli.py --check-login

  Like a video:
    python safari_tiktok_cli.py like https://www.tiktok.com/@user/video/123

  Comment on video:
    python safari_tiktok_cli.py comment https://www.tiktok.com/@user/video/123 "Great video!"

  Follow user:
    python safari_tiktok_cli.py follow @username

  View notifications:
    python safari_tiktok_cli.py notifications
    python safari_tiktok_cli.py notifications --limit 10

  View all activity:
    python safari_tiktok_cli.py activity

  DM commands:
    python safari_tiktok_cli.py dm list
    python safari_tiktok_cli.py dm read username
    python safari_tiktok_cli.py dm send username "Hello!"
        """
    )
    
    subparsers = parser.add_subparsers(dest='command', help='Commands')
    
    # Login check
    parser.add_argument('--check-login', action='store_true', help='Check TikTok login status')
    
    # Like command
    like_parser = subparsers.add_parser('like', help='Like a video')
    like_parser.add_argument('url', help='Video URL')
    
    # Comment command
    comment_parser = subparsers.add_parser('comment', help='Comment on a video')
    comment_parser.add_argument('url', help='Video URL')
    comment_parser.add_argument('text', nargs='+', help='Comment text')
    
    # Follow command
    follow_parser = subparsers.add_parser('follow', help='Follow a user')
    follow_parser.add_argument('username', help='Username to follow')
    
    # Notifications command
    notif_parser = subparsers.add_parser('notifications', help='View notifications')
    notif_parser.add_argument('--limit', '-l', type=int, default=20, help='Max notifications')
    
    # Activity command
    activity_parser = subparsers.add_parser('activity', help='View all activity')
    activity_parser.add_argument('--limit', '-l', type=int, default=20, help='Max items')
    
    # DM commands
    dm_parser = subparsers.add_parser('dm', help='Direct messages')
    dm_subparsers = dm_parser.add_subparsers(dest='dm_action', help='DM actions')
    
    dm_list_parser = dm_subparsers.add_parser('list', help='List conversations')
    dm_list_parser.add_argument('--limit', '-l', type=int, default=20, help='Max conversations')
    
    dm_read_parser = dm_subparsers.add_parser('read', help='Read messages from user')
    dm_read_parser.add_argument('username', help='Username')
    dm_read_parser.add_argument('--limit', '-l', type=int, default=50, help='Max messages')
    
    dm_send_parser = dm_subparsers.add_parser('send', help='Send a DM')
    dm_send_parser.add_argument('username', help='Username')
    dm_send_parser.add_argument('message', nargs='+', help='Message text')
    
    # Open command
    open_parser = subparsers.add_parser('open', help='Open TikTok in Safari')
    open_parser.add_argument('--url', '-u', default='https://www.tiktok.com/foryou', help='URL to open')
    
    args = parser.parse_args()
    
    # Configure logging
    logger.remove()
    logger.add(sys.stderr, format="<level>{message}</level>", level="INFO")
    
    if args.check_login:
        print("=" * 50)
        print("Checking TikTok Login Status")
        print("=" * 50)
        result = check_login()
        print(f"\nResult: {json.dumps(result, indent=2)}")
    
    elif args.command == 'like':
        print("=" * 50)
        print(f"Liking video: {args.url[:50]}...")
        print("=" * 50)
        result = asyncio.run(run_like(args.url))
        print(f"\nResult: {json.dumps(result, indent=2)}")
    
    elif args.command == 'comment':
        text = " ".join(args.text)
        print("=" * 50)
        print(f"Commenting on: {args.url[:50]}...")
        print(f"Comment: {text[:50]}...")
        print("=" * 50)
        result = asyncio.run(run_comment(args.url, text))
        print(f"\nResult: {json.dumps(result, indent=2)}")
    
    elif args.command == 'follow':
        print("=" * 50)
        print(f"Following: {args.username}")
        print("=" * 50)
        result = asyncio.run(run_follow(args.username))
        print(f"\nResult: {json.dumps(result, indent=2)}")
    
    elif args.command == 'notifications':
        print("=" * 50)
        print(f"Fetching Notifications (limit: {args.limit})")
        print("=" * 50)
        result = run_notifications(args.limit)
        
        if result.get('success'):
            print(f"\n📬 Found {result['count']} notifications:\n")
            for notif in result.get('notifications', []):
                user = notif.get('user', 'unknown')
                text = notif.get('text', '')[:80]
                time_str = notif.get('time', '')
                print(f"  @{user}: {text}")
                if time_str:
                    print(f"    🕐 {time_str}")
                print()
        else:
            print(f"\n❌ Error: {result.get('error')}")
    
    elif args.command == 'activity':
        print("=" * 50)
        print(f"Fetching All Activity (limit: {args.limit})")
        print("=" * 50)
        result = run_activity(args.limit)
        
        if result.get('success'):
            print(f"\n📊 Found {result['count']} activity items:\n")
            for item in result.get('activities', []):
                content = item.get('content', '')[:80]
                video = item.get('video_link', '')
                print(f"  {content}")
                if video:
                    print(f"    📹 {video[:50]}...")
                print()
        else:
            print(f"\n❌ Error: {result.get('error')}")
    
    elif args.command == 'dm':
        if args.dm_action == 'list':
            print("=" * 50)
            print(f"Fetching DM Conversations (limit: {args.limit})")
            print("=" * 50)
            result = run_dm_list(args.limit)
            
            if result.get('success'):
                print(f"\n💬 Found {result['count']} conversations:\n")
                for conv in result.get('conversations', []):
                    name = conv.get('username', 'Unknown')
                    preview = conv.get('preview', '')[:50]
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
            result = run_dm_read(args.username, args.limit)
            
            if result.get('success'):
                print(f"\n📨 Found {result['count']} messages:\n")
                for msg in result.get('messages', []):
                    direction = "➡️ Sent" if msg.get('is_sent') else "⬅️ Received"
                    text = msg.get('text', '')
                    print(f"  {direction}: {text}")
                    print()
            else:
                print(f"\n❌ Error: {result.get('error')}")
        
        elif args.dm_action == 'send':
            message = " ".join(args.message)
            print("=" * 50)
            print(f"Sending DM to @{args.username}")
            print(f"Message: {message[:50]}...")
            print("=" * 50)
            result = run_dm_send(args.username, message)
            print(f"\nResult: {json.dumps(result, indent=2)}")
        
        else:
            dm_parser.print_help()
    
    elif args.command == 'open':
        print(f"Opening TikTok: {args.url}")
        import subprocess
        script = f'''
        tell application "Safari"
            activate
            if (count of windows) = 0 then
                make new document
            end if
            set URL of front document to "{args.url}"
        end tell
        '''
        subprocess.run(["osascript", "-e", script])
        print("✅ TikTok opened in Safari")
    
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
