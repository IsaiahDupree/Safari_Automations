#!/bin/bash
# Instagram DM Automation - Reproducible Commands
# These are the WORKING commands tested on Instagram DMs via Safari
# 
# Usage: 
#   ./scripts/instagram-dm-commands.sh [command]
#
# Commands:
#   check-login     - Check if logged into Instagram
#   go-inbox        - Navigate to DM inbox
#   get-page        - Get current page content
#   list-convos     - List all conversations
#   click-user      - Click on a specific user's conversation
#   focus-input     - Focus the message input
#   type-message    - Type a message (doesn't send)
#   send-message    - Send the typed message
#   get-tabs        - Get available DM tabs (Primary, General, Requests)
#   click-tab       - Click on a specific tab

set -e

# === WORKING COMMANDS ===

check_login() {
    osascript << 'EOF'
tell application "Safari"
    do JavaScript "
        (function() {
            var indicators = [
                'svg[aria-label=\"Home\"]',
                'img[alt*=\"profile picture\"]',
                'a[href*=\"/direct/\"]'
            ];
            for (var i = 0; i < indicators.length; i++) {
                if (document.querySelector(indicators[i])) return 'logged_in';
            }
            if (document.querySelector('input[name=\"username\"]')) return 'login_page';
            return 'unknown';
        })()
    " in front document
end tell
EOF
}

go_inbox() {
    osascript -e 'tell application "Safari" to set URL of front document to "https://www.instagram.com/direct/inbox/"'
    sleep 3
    echo "Navigated to DM inbox"
}

get_page_content() {
    osascript << 'EOF'
tell application "Safari"
    do JavaScript "document.body.innerText.substring(0, 2000)" in front document
end tell
EOF
}

list_conversations() {
    osascript << 'EOF'
tell application "Safari"
    do JavaScript "
        (function() {
            var convos = [];
            var spans = document.querySelectorAll('span');
            var seen = new Set();
            
            spans.forEach(function(span) {
                var text = span.textContent.trim();
                // Look for usernames (typically short, no special chars except underscore)
                if (text && text.length > 2 && text.length < 50 && 
                    !text.includes('·') && !text.includes('Unread') &&
                    !seen.has(text)) {
                    
                    var parent = span.closest('div');
                    if (parent && parent.innerText.includes('·')) {
                        seen.add(text);
                        convos.push(text);
                    }
                }
            });
            
            return convos.slice(0, 20).join('\\n');
        })()
    " in front document
end tell
EOF
}

click_user() {
    local username="$1"
    if [ -z "$username" ]; then
        echo "Usage: click-user <username>"
        exit 1
    fi
    
    osascript << EOF
tell application "Safari"
    do JavaScript "
        (function() {
            var spans = document.querySelectorAll('span');
            for (var i = 0; i < spans.length; i++) {
                if (spans[i].textContent === '$username') {
                    var parent = spans[i].parentElement.parentElement.parentElement;
                    var evt = new MouseEvent('click', { bubbles: true, cancelable: true, view: window });
                    parent.dispatchEvent(evt);
                    return 'clicked';
                }
            }
            return 'not found';
        })()
    " in front document
end tell
EOF
}

focus_input() {
    osascript << 'EOF'
tell application "Safari"
    do JavaScript "
        (function() {
            var input = document.querySelector('textarea[placeholder*=\"Message\"]') ||
                       document.querySelector('div[contenteditable=\"true\"]') ||
                       document.querySelector('[aria-label*=\"Message\"]');
            
            if (input) {
                input.focus();
                input.click();
                return 'focused: ' + input.tagName;
            }
            return 'input not found';
        })()
    " in front document
end tell
EOF
}

type_message() {
    local message="$1"
    if [ -z "$message" ]; then
        echo "Usage: type-message <message>"
        exit 1
    fi
    
    osascript << EOF
tell application "Safari"
    do JavaScript "
        (function() {
            var input = document.activeElement;
            var msg = '$message';
            
            if (input.contentEditable === 'true') {
                input.textContent = msg;
                input.innerHTML = msg;
                input.dispatchEvent(new InputEvent('input', { bubbles: true, data: msg }));
                return 'typed in contenteditable';
            } else if (input.tagName === 'TEXTAREA') {
                input.value = msg;
                input.dispatchEvent(new Event('input', { bubbles: true }));
                return 'typed in textarea';
            }
            return 'unknown input type: ' + input.tagName;
        })()
    " in front document
end tell
EOF
}

send_message() {
    osascript << 'EOF'
tell application "Safari"
    do JavaScript "
        (function() {
            var input = document.activeElement;
            
            // Try pressing Enter
            var enterEvent = new KeyboardEvent('keydown', {
                key: 'Enter',
                code: 'Enter',
                keyCode: 13,
                which: 13,
                bubbles: true,
                cancelable: true
            });
            input.dispatchEvent(enterEvent);
            
            // Also try finding Send button
            setTimeout(function() {
                var btns = document.querySelectorAll('button, div[role=\"button\"]');
                for (var i = 0; i < btns.length; i++) {
                    var text = (btns[i].textContent || '').toLowerCase();
                    var label = (btns[i].getAttribute('aria-label') || '').toLowerCase();
                    if (text === 'send' || label.includes('send')) {
                        btns[i].click();
                        break;
                    }
                }
            }, 100);
            
            return 'sent';
        })()
    " in front document
end tell
EOF
}

get_tabs() {
    osascript << 'EOF'
tell application "Safari"
    do JavaScript "
        (function() {
            var tabs = [];
            var tabElements = document.querySelectorAll('[role=\"tab\"]');
            
            tabElements.forEach(function(tab) {
                var text = tab.innerText.trim();
                var selected = tab.getAttribute('aria-selected') === 'true';
                if (text) tabs.push((selected ? '* ' : '  ') + text);
            });
            
            return tabs.join('\\n');
        })()
    " in front document
end tell
EOF
}

click_tab() {
    local tabname="$1"
    if [ -z "$tabname" ]; then
        echo "Usage: click-tab <Primary|General|Requests>"
        exit 1
    fi
    
    osascript << EOF
tell application "Safari"
    do JavaScript "
        (function() {
            var tabs = document.querySelectorAll('[role=\"tab\"]');
            for (var i = 0; i < tabs.length; i++) {
                if (tabs[i].innerText.includes('$tabname')) {
                    tabs[i].click();
                    return 'clicked $tabname';
                }
            }
            return 'tab not found';
        })()
    " in front document
end tell
EOF
}

get_messages() {
    osascript << 'EOF'
tell application "Safari"
    do JavaScript "
        (function() {
            var messages = [];
            var container = document.querySelector('[role=\"main\"]') || document.body;
            
            var msgElements = container.querySelectorAll('div[dir=\"auto\"], span[dir=\"auto\"]');
            var seen = new Set();
            
            msgElements.forEach(function(el, i) {
                var text = (el.innerText || '').trim();
                if (text && text.length > 0 && text.length < 500 && !seen.has(text)) {
                    seen.add(text);
                    messages.push(text);
                }
            });
            
            return messages.slice(-20).join('\\n---\\n');
        })()
    " in front document
end tell
EOF
}

# === MAIN ===

case "$1" in
    check-login)
        check_login
        ;;
    go-inbox)
        go_inbox
        ;;
    get-page)
        get_page_content
        ;;
    list-convos)
        list_conversations
        ;;
    click-user)
        click_user "$2"
        ;;
    focus-input)
        focus_input
        ;;
    type-message)
        type_message "$2"
        ;;
    send-message)
        send_message
        ;;
    get-tabs)
        get_tabs
        ;;
    click-tab)
        click_tab "$2"
        ;;
    get-messages)
        get_messages
        ;;
    *)
        echo "Instagram DM Automation Commands"
        echo ""
        echo "Usage: $0 <command> [args]"
        echo ""
        echo "Commands:"
        echo "  check-login           Check if logged into Instagram"
        echo "  go-inbox              Navigate to DM inbox"
        echo "  get-page              Get current page content"
        echo "  list-convos           List all conversations"
        echo "  click-user <name>     Click on a user's conversation"
        echo "  focus-input           Focus the message input"
        echo "  type-message <msg>    Type a message (doesn't send)"
        echo "  send-message          Send the typed message"
        echo "  get-tabs              Get available DM tabs"
        echo "  click-tab <name>      Click on a specific tab"
        echo "  get-messages          Get messages in current conversation"
        echo ""
        echo "Example workflow:"
        echo "  $0 go-inbox"
        echo "  $0 click-user 'Sarah Ashley'"
        echo "  $0 focus-input"
        echo "  $0 type-message 'Hello!'"
        echo "  $0 send-message"
        ;;
esac
