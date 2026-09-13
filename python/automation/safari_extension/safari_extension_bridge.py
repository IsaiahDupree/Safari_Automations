#!/usr/bin/env python3
"""
Python bridge to communicate with Safari extension via extension messaging.

Usage:
    from safari_extension_bridge import type_comment, click_post

    # Type a comment
    result = type_comment("My automated comment!")
    
    # Click Post
    result = click_post()
"""

import subprocess
import json


def send_to_extension(action: str, **kwargs) -> dict:
    """
    Send a message to the Safari extension via AppleScript.
    
    Since native messaging isn't trivial in Safari, we use a simpler approach:
    Send messages via the extension's popup or by executing JS in the extension context.
    """
    # For now, we'll use AppleScript to trigger the extension
    # The extension needs to be installed and active
    
    message = {
        'action': action,
        **kwargs
    }
    
    # Send via AppleScript to extension
    script = f'''
tell application "Safari"
    -- Extension runs in content script automatically
    -- We just need to send message via tabs
    do JavaScript "
        if (typeof browser !== 'undefined') {{
            browser.runtime.sendMessage({json.dumps(message)}).then(r => console.log('Result:', r));
        }}
    " in current tab of front window
end tell
'''
    
    try:
        result = subprocess.run(
            ['osascript', '-e', script],
            capture_output=True,
            text=True,
            timeout=10
        )
        return {'success': True, 'output': result.stdout.strip()}
    except Exception as e:
        return {'success': False, 'error': str(e)}


def type_comment(text: str) -> dict:
    """Type a comment into TikTok via the extension."""
    return send_to_extension('typeComment', text=text)


def click_post() -> dict:
    """Click the Post button via the extension."""
    return send_to_extension('clickPost')


def check_status() -> dict:
    """Check current status."""
    return send_to_extension('checkStatus')


if __name__ == '__main__':
    import sys
    if len(sys.argv) > 1:
        result = type_comment(' '.join(sys.argv[1:]))
        print(json.dumps(result, indent=2))
    else:
        result = check_status()
        print(json.dumps(result, indent=2))
