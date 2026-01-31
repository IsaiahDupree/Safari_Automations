# PRD: TikTok DM Full Platform Control

**Version:** 1.0  
**Date:** January 28, 2026  
**Status:** Assessment & Implementation

---

## Executive Summary

Complete Safari automation for TikTok Direct Messages with full controllability of all UI elements, buttons, selectors, and features.

**Target URL:** `https://www.tiktok.com/messages`

---

## Success Criteria

### ✅ = Implemented | ⚠️ = Partial | ❌ = Not Working | 🔲 = Not Started

---

## 1. NAVIGATION

| Criterion | Status | Notes |
|-----------|--------|-------|
| Navigate to tiktok.com | 🔲 | |
| Navigate to /messages | 🔲 | DM inbox |
| Navigate to specific conversation | 🔲 | |
| Navigate to user profile | 🔲 | |
| Navigate to For You page | 🔲 | |
| Detect current page | 🔲 | |

### Required Selectors
```javascript
// Navigation URLs
URL: https://www.tiktok.com/messages
URL: https://www.tiktok.com/@{username}
URL: https://www.tiktok.com/foryou

// Detect messages page
window.location.pathname === '/messages'
document.querySelector('[data-e2e="message-page"]')
```

---

## 2. AUTHENTICATION

| Criterion | Status | Notes |
|-----------|--------|-------|
| Detect logged in state | 🔲 | |
| Detect login prompt | 🔲 | |
| Handle CAPTCHA | 🔲 | Manual |
| Handle 2FA/verification | 🔲 | Manual |
| Handle session expiry | 🔲 | |
| Detect rate limiting | 🔲 | |

### Required Selectors
```javascript
// Login detection
document.querySelector('[data-e2e="profile-icon"]') // Logged in
document.querySelector('[data-e2e="login-button"]') // Not logged in
document.querySelector('button[data-e2e="top-login-button"]')

// Rate limit / action blocked
document.body.innerText.includes('You are visiting')
document.body.innerText.includes('too fast')
document.body.innerText.includes('temporarily blocked')
```

---

## 3. DM INBOX

| Criterion | Status | Notes |
|-----------|--------|-------|
| List all conversations | 🔲 | |
| Get conversation count | 🔲 | |
| Get unread count | 🔲 | |
| Scroll to load more | 🔲 | |
| Search conversations | 🔲 | |
| Filter conversations | 🔲 | |

### Required Selectors
```javascript
// Conversation list container
document.querySelector('[data-e2e="message-list"]')
document.querySelector('[class*="DivMessageList"]')

// Individual conversations
document.querySelectorAll('[data-e2e="message-item"]')
document.querySelectorAll('[class*="DivConversationItem"]')

// Unread badge
document.querySelectorAll('[class*="unread"]')
document.querySelectorAll('[class*="badge"]')

// Search input
document.querySelector('input[placeholder*="Search"]')
document.querySelector('[data-e2e="search-input"]')
```

---

## 4. CONVERSATION SELECTION

| Criterion | Status | Notes |
|-----------|--------|-------|
| Click on conversation | 🔲 | |
| Get selected conversation | 🔲 | |
| Get conversation username | 🔲 | |
| Get last message preview | 🔲 | |
| Get message timestamp | 🔲 | |
| Detect conversation type (group/single) | 🔲 | |

### Required Selectors
```javascript
// Click conversation
conversationItem.click()

// Username
conversation.querySelector('[data-e2e="message-username"]')
conversation.querySelector('[class*="SpanUserName"]')

// Last message preview
conversation.querySelector('[class*="SpanLastMessage"]')
conversation.querySelector('[data-e2e="message-preview"]')

// Timestamp
conversation.querySelector('[class*="SpanTime"]')
```

---

## 5. MESSAGE READING

| Criterion | Status | Notes |
|-----------|--------|-------|
| Get all messages in thread | 🔲 | |
| Get message text | 🔲 | |
| Get message sender | 🔲 | |
| Get message timestamp | 🔲 | |
| Detect message type (text/image/video/sticker) | 🔲 | |
| Scroll to load older messages | 🔲 | |
| Detect read status | 🔲 | |

### Required Selectors
```javascript
// Message container
document.querySelector('[data-e2e="message-detail"]')
document.querySelector('[class*="DivMessageDetail"]')

// All messages
document.querySelectorAll('[data-e2e="message-bubble"]')
document.querySelectorAll('[class*="DivMessageBubble"]')

// Message text
message.querySelector('[class*="SpanMessageText"]')
message.innerText

// Sender detection (your message vs theirs)
message.classList.contains('self') // Your message
message.querySelector('[class*="MessageSelf"]')
message.querySelector('[class*="MessageOther"]')

// Timestamp
message.querySelector('[class*="SpanMessageTime"]')
```

---

## 6. MESSAGE SENDING

| Criterion | Status | Notes |
|-----------|--------|-------|
| Find message input | 🔲 | |
| Clear input | 🔲 | |
| Type message | 🔲 | |
| Send message (Enter key) | 🔲 | |
| Send message (Send button) | 🔲 | |
| Verify message sent | 🔲 | |
| Handle send failure | 🔲 | |
| Detect "pending" state | 🔲 | |

### Required Selectors
```javascript
// Message input - TikTok uses contenteditable div
document.querySelector('[data-e2e="message-input"]')
document.querySelector('[contenteditable="true"]')
document.querySelector('[class*="DivEditorContainer"] [contenteditable]')
document.querySelector('div[data-placeholder*="Send a message"]')

// Send button
document.querySelector('[data-e2e="message-send-button"]')
document.querySelector('button[class*="ButtonSend"]')
document.querySelector('[class*="DivSendButton"]')

// Set text in contenteditable
input.focus();
input.innerText = message;
input.dispatchEvent(new InputEvent('input', { bubbles: true }));

// Send via keyboard
input.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Enter',
    code: 'Enter',
    bubbles: true
}));

// Verify sent - check for message appearing in chat
document.querySelector('[class*="MessageSelf"]:last-child')
```

---

## 7. NEW CONVERSATION

| Criterion | Status | Notes |
|-----------|--------|-------|
| Click "New Message" button | 🔲 | |
| Search for user | 🔲 | |
| Select user from results | 🔲 | |
| Handle "Following only" restriction | 🔲 | |
| Start conversation | 🔲 | |

### Required Selectors
```javascript
// New message button
document.querySelector('[data-e2e="new-message-button"]')
document.querySelector('[class*="ButtonNewMessage"]')
document.querySelector('button[aria-label*="New message"]')

// Search input in new message modal
document.querySelector('[data-e2e="search-user-input"]')
document.querySelector('input[placeholder*="Search"]')

// User search results
document.querySelectorAll('[data-e2e="search-result-item"]')
document.querySelectorAll('[class*="DivSearchResult"]')

// Select user
result.click()

// Confirm/Next button
document.querySelector('button[data-e2e="confirm-button"]')
document.querySelector('button').find(b => b.textContent.includes('Chat'))
```

---

## 8. MEDIA & STICKERS

| Criterion | Status | Notes |
|-----------|--------|-------|
| Send image | 🔲 | |
| Send video | 🔲 | |
| Send sticker | 🔲 | |
| Send GIF | 🔲 | |
| Send emoji | 🔲 | |
| View received media | 🔲 | |

### Required Selectors
```javascript
// Image/video button
document.querySelector('[data-e2e="message-image-button"]')
document.querySelector('input[type="file"]')
document.querySelector('[class*="IconImage"]').parentElement

// Sticker button
document.querySelector('[data-e2e="message-sticker-button"]')
document.querySelector('[class*="IconSticker"]').parentElement

// Emoji button
document.querySelector('[data-e2e="message-emoji-button"]')
document.querySelector('[class*="IconEmoji"]').parentElement

// GIF button
document.querySelector('[data-e2e="message-gif-button"]')
```

---

## 9. CONVERSATION MANAGEMENT

| Criterion | Status | Notes |
|-----------|--------|-------|
| Delete conversation | 🔲 | |
| Mute conversation | 🔲 | |
| Block user | 🔲 | |
| Report conversation | 🔲 | |
| Pin conversation | 🔲 | |
| Mark as read/unread | 🔲 | |

### Required Selectors
```javascript
// Options menu (three dots / more)
document.querySelector('[data-e2e="message-more-button"]')
document.querySelector('[class*="IconMore"]').parentElement

// Menu items
document.querySelectorAll('[data-e2e="menu-item"]')
document.querySelectorAll('[class*="DivMenuItem"]')

// Specific actions
document.querySelector('[data-e2e="delete-conversation"]')
document.querySelector('[data-e2e="mute-conversation"]')
document.querySelector('[data-e2e="block-user"]')
```

---

## 10. MESSAGE REQUESTS

| Criterion | Status | Notes |
|-----------|--------|-------|
| Navigate to requests | 🔲 | |
| List pending requests | 🔲 | |
| Accept request | 🔲 | |
| Decline request | 🔲 | |
| Get request count | 🔲 | |

### Required Selectors
```javascript
// Requests tab/section
document.querySelector('[data-e2e="message-requests"]')
document.querySelector('[class*="DivRequestsTab"]')

// Request items
document.querySelectorAll('[data-e2e="request-item"]')

// Accept button
document.querySelector('button').find(b => b.textContent.includes('Accept'))
document.querySelector('[data-e2e="accept-request"]')

// Decline button
document.querySelector('button').find(b => b.textContent.includes('Delete'))
document.querySelector('[data-e2e="decline-request"]')
```

---

## 11. USER PROFILE INFO (from DM)

| Criterion | Status | Notes |
|-----------|--------|-------|
| Get username | 🔲 | |
| Get display name | 🔲 | |
| Get follower count | 🔲 | |
| Get following count | 🔲 | |
| Get bio | 🔲 | |
| Check if verified | 🔲 | |
| Check if following | 🔲 | |
| Navigate to full profile | 🔲 | |

### Required Selectors
```javascript
// Profile header in conversation
document.querySelector('[data-e2e="conversation-header"]')
document.querySelector('[class*="DivConversationHeader"]')

// Click to view profile
document.querySelector('[data-e2e="view-profile"]')

// Username
header.querySelector('[class*="SpanUserName"]')

// Verified badge
header.querySelector('[data-e2e="verified-badge"]')
header.querySelector('svg[class*="Verified"]')
```

---

## 12. RATE LIMITING & SAFETY

| Criterion | Status | Notes |
|-----------|--------|-------|
| Detect rate limit warning | 🔲 | |
| Detect action blocked | 🔲 | |
| Detect CAPTCHA | 🔲 | |
| Implement delay between messages | 🔲 | |
| Implement daily limits | 🔲 | |
| Log all actions | 🔲 | |
| Rotate accounts | 🔲 | |

### Safety Limits (TikTok is stricter than Instagram)
```python
# Recommended limits - TikTok is very sensitive
MAX_DMS_PER_HOUR = 10  # Conservative
MAX_DMS_PER_DAY = 50   # Very conservative
MIN_DELAY_BETWEEN_DMS = 120  # 2 minutes
MAX_DELAY_BETWEEN_DMS = 300  # 5 minutes

# New account limits (first 30 days)
NEW_ACCOUNT_DMS_PER_DAY = 10

# Following-only restriction
# TikTok often restricts DMs to users you follow or who follow you
```

### Detection Patterns
```javascript
// Rate limit indicators
document.body.innerText.includes('too frequently')
document.body.innerText.includes('try again later')
document.body.innerText.includes('temporarily unavailable')
document.querySelector('[class*="captcha"]')
```

---

## 13. GROUP MESSAGES

| Criterion | Status | Notes |
|-----------|--------|-------|
| Create group | 🔲 | |
| Add members | 🔲 | |
| Remove members | 🔲 | |
| Leave group | 🔲 | |
| Rename group | 🔲 | |
| Detect group vs 1:1 | 🔲 | |

### Required Selectors
```javascript
// Group indicator
conversation.querySelector('[data-e2e="group-icon"]')
conversation.querySelector('[class*="GroupAvatar"]')

// Group settings
document.querySelector('[data-e2e="group-settings"]')
```

---

## Implementation Priority

### P0 - Critical
1. Navigate to /messages
2. Detect logged in state
3. Find message input (contenteditable)
4. Send message
5. Rate limit detection
6. CAPTCHA detection

### P1 - High
7. List conversations
8. Select conversation
9. Read messages
10. New conversation flow
11. Handle "Following only" restriction

### P2 - Medium
12. Message requests handling
13. User profile info
14. Media sending

### P3 - Low
15. Conversation management
16. Group messages
17. Advanced media (stickers, GIF)

---

## TikTok-Specific Challenges

### 1. Contenteditable Input
TikTok uses `contenteditable` div, not textarea:
```javascript
// Setting text requires special handling
const input = document.querySelector('[contenteditable="true"]');
input.focus();
input.innerHTML = ''; // Clear first
document.execCommand('insertText', false, message);
// OR
input.innerText = message;
input.dispatchEvent(new InputEvent('input', {bubbles: true, data: message}));
```

### 2. Following-Only Restriction
Many accounts can only receive DMs from people they follow:
```javascript
// Detect restriction
document.body.innerText.includes('can\'t message this account')
document.body.innerText.includes('following each other')
```

### 3. Heavy Anti-Automation
TikTok has aggressive bot detection:
- Randomize delays more
- Use realistic mouse movements
- Avoid patterns
- Monitor for CAPTCHA

---

## File Structure

```
Backend/
├── automation/
│   ├── tiktok_dm_automation.py      # Main DM automation
│   └── tiktok_messenger.py          # Existing (check for reuse)
├── services/
│   └── tiktok/
│       ├── dm_service.py            # High-level DM service
│       ├── dm_sender.py             # Message sending
│       └── dm_reader.py             # Message reading
└── scripts/
    └── tiktok_dm_test.py            # Test script
```

---

## Existing Files to Check

| File | Purpose |
|------|---------|
| `automation/tiktok_messenger.py` | Existing TikTok automation |
| `automation/tiktok_engagement.py` | TikTok engagement |
| `services/tiktok/dm_automation.py` | Existing DM service |
| `automation/safari_session_manager.py` | Session management |

---

## Testing Checklist

```bash
# 1. Test navigation
python -c "from automation.tiktok_dm_automation import TikTokDMAutomation; dm=TikTokDMAutomation(); dm.navigate_to_inbox()"

# 2. Test login check
python -c "from automation.tiktok_dm_automation import TikTokDMAutomation; dm=TikTokDMAutomation(); print(dm.check_login())"

# 3. Test find input
python -c "from automation.tiktok_dm_automation import TikTokDMAutomation; dm=TikTokDMAutomation(); print(dm.find_message_input())"

# 4. Test send message
python -c "from automation.tiktok_dm_automation import TikTokDMAutomation; dm=TikTokDMAutomation(); dm.send_message('username', 'Hello!')"
```

---

## Selector Investigation Script

```python
# Run to investigate TikTok DM page structure
python3 -c "
import subprocess
import time

subprocess.run(['osascript', '-e', 
    'tell application \"Safari\" to set URL of front document to \"https://www.tiktok.com/messages\"'])
time.sleep(5)

js = '''
(function() {
    var result = {
        buttons: [],
        inputs: [],
        conversations: [],
        editables: [],
        url: window.location.href
    };
    
    document.querySelectorAll('button').forEach((b, i) => {
        if (i < 15) {
            result.buttons.push({
                text: b.textContent.trim().substring(0, 30),
                dataE2e: b.getAttribute('data-e2e'),
                ariaLabel: b.getAttribute('aria-label')
            });
        }
    });
    
    document.querySelectorAll('input, textarea').forEach(i => {
        result.inputs.push({
            type: i.type || 'textarea',
            placeholder: i.placeholder,
            dataE2e: i.getAttribute('data-e2e')
        });
    });
    
    document.querySelectorAll('[contenteditable]').forEach(e => {
        result.editables.push({
            placeholder: e.getAttribute('data-placeholder'),
            class: e.className.substring(0, 50)
        });
    });
    
    return JSON.stringify(result, null, 2);
})()
'''

print(subprocess.run(['osascript', '-e', 
    f'tell application \"Safari\" to do JavaScript \"{js}\" in front document'],
    capture_output=True, text=True).stdout)
"
```

---

## Next Steps

1. Check existing `tiktok_messenger.py` for reusable code
2. Investigate actual TikTok DM page selectors
3. Implement core send/read functions
4. Add strict rate limiting (TikTok is sensitive)
5. Handle Following-only restriction gracefully
6. Integrate with warmth scoring system
