# PRD: Twitter/X DM Full Platform Control

**Version:** 1.0  
**Date:** January 28, 2026  
**Status:** Assessment & Implementation

---

## Executive Summary

Complete Safari automation for Twitter/X Direct Messages with full controllability of all UI elements, buttons, selectors, and features.

**Target URL:** `https://x.com/messages`

---

## Success Criteria

### ✅ = Implemented | ⚠️ = Partial | ❌ = Not Working | 🔲 = Not Started

---

## 1. NAVIGATION

| Criterion | Status | Notes |
|-----------|--------|-------|
| Navigate to x.com | 🔲 | |
| Navigate to /messages | 🔲 | DM inbox |
| Navigate to specific conversation | 🔲 | /messages/{conversation_id} |
| Navigate to user profile | 🔲 | /{username} |
| Navigate to /home | 🔲 | Timeline |
| Detect current page | 🔲 | |

### Required Selectors
```javascript
// Navigation URLs
URL: https://x.com/messages
URL: https://x.com/messages/{conversation_id}
URL: https://x.com/{username}
URL: https://x.com/home

// Detect messages page
window.location.pathname.startsWith('/messages')
document.querySelector('[data-testid="DM_timeline"]')
document.querySelector('[aria-label="Timeline: Messages"]')
```

---

## 2. AUTHENTICATION

| Criterion | Status | Notes |
|-----------|--------|-------|
| Detect logged in state | 🔲 | |
| Detect login prompt | 🔲 | |
| Handle 2FA prompt | 🔲 | Manual (code: 7911) |
| Handle encryption code prompt | 🔲 | Code: 7911 |
| Handle session expiry | 🔲 | |
| Detect rate limiting | 🔲 | |
| Detect account suspension | 🔲 | |

### Required Selectors
```javascript
// Login detection
document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]') // Logged in
document.querySelector('[data-testid="loginButton"]') // Not logged in
document.querySelector('a[href="/login"]') // Login link

// Account info
document.querySelector('[data-testid="UserAvatar-Container"]')

// Rate limit / suspension
document.body.innerText.includes('rate limit')
document.body.innerText.includes('suspended')
document.body.innerText.includes('temporarily locked')
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
| Filter by type (All/Unread/Groups) | 🔲 | |

### Required Selectors
```javascript
// Conversation list container
document.querySelector('[data-testid="DM_timeline"]')
document.querySelector('[aria-label="Timeline: Messages"]')

// Individual conversations
document.querySelectorAll('[data-testid="conversation"]')
document.querySelectorAll('[data-testid="DMInboxItem"]')

// Unread indicator
document.querySelectorAll('[data-testid="conversation"] [data-testid="unread"]')
conversation.querySelector('[class*="unread"]')

// Search input
document.querySelector('[data-testid="SearchBox_Search_Input"]')
document.querySelector('input[placeholder*="Search"]')

// Filter tabs
document.querySelectorAll('[role="tab"]')
```

---

## 4. CONVERSATION SELECTION

| Criterion | Status | Notes |
|-----------|--------|-------|
| Click on conversation | 🔲 | |
| Get selected conversation | 🔲 | |
| Get conversation participant(s) | 🔲 | |
| Get last message preview | 🔲 | |
| Get message timestamp | 🔲 | |
| Detect conversation type (group/single) | 🔲 | |

### Required Selectors
```javascript
// Click conversation
conversation.click()

// Conversation item
document.querySelector('[data-testid="conversation"]')

// Participant name
conversation.querySelector('[data-testid="User-Name"]')
conversation.querySelector('span[class*="css-"]') // Username

// Last message preview
conversation.querySelector('[data-testid="tweetText"]')
conversation.querySelector('[class*="messageText"]')

// Timestamp
conversation.querySelector('time')
conversation.querySelector('[datetime]')
```

---

## 5. MESSAGE READING

| Criterion | Status | Notes |
|-----------|--------|-------|
| Get all messages in thread | 🔲 | |
| Get message text | 🔲 | |
| Get message sender | 🔲 | |
| Get message timestamp | 🔲 | |
| Detect message type (text/image/video/gif/link) | 🔲 | |
| Scroll to load older messages | 🔲 | |
| Detect read receipts | 🔲 | |
| Detect "seen" status | 🔲 | |

### Required Selectors
```javascript
// Message container
document.querySelector('[data-testid="DM_timeline"]')
document.querySelector('[aria-label*="conversation"]')

// All messages
document.querySelectorAll('[data-testid="messageEntry"]')
document.querySelectorAll('[data-testid="DMMessageContainer"]')

// Message text
message.querySelector('[data-testid="tweetText"]')
message.querySelector('[lang]') // Text with language attribute

// Sender detection
message.querySelector('[data-testid="User-Name"]')
message.classList.contains('r-1uaug3w') // Class patterns for sent vs received

// Timestamp
message.querySelector('time')
message.querySelector('[data-testid="timestamp"]')

// Read receipt / Seen
document.querySelector('[data-testid="seenReceipt"]')
document.body.innerText.includes('Seen')
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
// Message input - Twitter uses contenteditable or DraftJS
document.querySelector('[data-testid="dmComposerTextInput"]')
document.querySelector('[data-testid="DmComposer-Editor"]')
document.querySelector('[role="textbox"][data-testid*="dm"]')
document.querySelector('[contenteditable="true"][data-testid*="dm"]')

// Alternative - DraftJS editor
document.querySelector('.DraftEditor-root')
document.querySelector('[class*="DraftEditor"]')

// Send button
document.querySelector('[data-testid="dmComposerSendButton"]')
document.querySelector('[aria-label="Send"]')

// Set text in contenteditable
const input = document.querySelector('[data-testid="dmComposerTextInput"]');
input.focus();
// For DraftJS, use insertText
document.execCommand('insertText', false, message);
// Dispatch input event
input.dispatchEvent(new InputEvent('input', { bubbles: true }));

// Send via keyboard
input.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Enter',
    code: 'Enter',
    bubbles: true
}));

// Verify sent
document.querySelector('[data-testid="messageEntry"]:last-child')
```

---

## 7. NEW CONVERSATION

| Criterion | Status | Notes |
|-----------|--------|-------|
| Click "New Message" button | 🔲 | |
| Search for user | 🔲 | |
| Select user from results | 🔲 | |
| Handle "DMs disabled" restriction | 🔲 | |
| Select multiple users (group) | 🔲 | |
| Start conversation | 🔲 | |

### Required Selectors
```javascript
// New message button
document.querySelector('[data-testid="NewDM_Button"]')
document.querySelector('[aria-label="New message"]')
document.querySelector('[data-testid="DM_compose"]')

// Search input in new message modal
document.querySelector('[data-testid="SearchBox_Search_Input"]')
document.querySelector('input[placeholder*="Search"]')

// User search results
document.querySelectorAll('[data-testid="TypeaheadUser"]')
document.querySelectorAll('[data-testid="UserCell"]')

// Select user
result.click()

// Next/Confirm button
document.querySelector('[data-testid="nextButton"]')
document.querySelector('button[data-testid*="next"]')

// DMs disabled indicator
document.body.innerText.includes("can't be messaged")
document.body.innerText.includes("doesn't accept")
```

---

## 8. MEDIA & ATTACHMENTS

| Criterion | Status | Notes |
|-----------|--------|-------|
| Send image | 🔲 | |
| Send video | 🔲 | |
| Send GIF | 🔲 | |
| Send emoji | 🔲 | |
| Send link (auto-preview) | 🔲 | |
| View received media | 🔲 | |
| React to message | 🔲 | |

### Required Selectors
```javascript
// Media button (image/video)
document.querySelector('[data-testid="DM_media_button"]')
document.querySelector('[aria-label="Add Photos or video"]')
document.querySelector('input[type="file"][accept*="image"]')

// GIF button
document.querySelector('[data-testid="dmComposerGifButton"]')
document.querySelector('[aria-label="Add a GIF"]')

// Emoji button
document.querySelector('[data-testid="dmComposerEmojiButton"]')
document.querySelector('[aria-label="Add emoji"]')

// Reaction (long press or hover menu)
message.querySelector('[data-testid="reaction"]')
document.querySelector('[aria-label="React"]')
```

---

## 9. CONVERSATION MANAGEMENT

| Criterion | Status | Notes |
|-----------|--------|-------|
| Delete conversation | 🔲 | |
| Leave group | 🔲 | |
| Mute conversation | 🔲 | |
| Block user | 🔲 | |
| Report conversation | 🔲 | |
| Pin conversation | 🔲 | |
| Snooze notifications | 🔲 | |

### Required Selectors
```javascript
// Conversation settings/info button
document.querySelector('[data-testid="DMConversationDetailButton"]')
document.querySelector('[aria-label="Conversation info"]')

// Menu items in settings
document.querySelectorAll('[role="menuitem"]')
document.querySelectorAll('[data-testid*="MenuItem"]')

// Specific actions
document.querySelector('[data-testid="delete"]')
document.querySelector('[data-testid="leave"]')
document.querySelector('[data-testid="mute"]')
document.querySelector('[data-testid="block"]')
document.querySelector('[data-testid="report"]')
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
// Requests link/tab
document.querySelector('[href="/messages/requests"]')
document.querySelector('[data-testid="DM_requests"]')

// Request items
document.querySelectorAll('[data-testid="request"]')

// Accept button
document.querySelector('[data-testid="accept"]')
document.querySelector('button').find(b => b.textContent.includes('Accept'))

// Delete button
document.querySelector('[data-testid="delete"]')
document.querySelector('button').find(b => b.textContent.includes('Delete'))
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
| Check if verified (blue/gold) | 🔲 | |
| Check if following | 🔲 | |
| Check if they follow you | 🔲 | |
| Navigate to full profile | 🔲 | |

### Required Selectors
```javascript
// Profile header in conversation
document.querySelector('[data-testid="DMConversationHeader"]')
document.querySelector('[data-testid="UserAvatar-Container"]')

// Click to view profile
header.querySelector('a[href*="/@"]')

// Username
document.querySelector('[data-testid="User-Name"]')

// Verified badge (blue check / gold check)
document.querySelector('[data-testid="verificationBadge"]')
document.querySelector('svg[aria-label*="Verified"]')

// Following status
document.body.innerText.includes('Following')
document.body.innerText.includes('Follows you')
```

---

## 12. RATE LIMITING & SAFETY

| Criterion | Status | Notes |
|-----------|--------|-------|
| Detect rate limit warning | 🔲 | |
| Detect action blocked | 🔲 | |
| Detect account locked | 🔲 | |
| Implement delay between messages | 🔲 | |
| Implement daily limits | 🔲 | |
| Log all actions | 🔲 | |
| Handle verification prompts | 🔲 | |

### Safety Limits
```python
# Recommended limits for Twitter/X
MAX_DMS_PER_HOUR = 15
MAX_DMS_PER_DAY = 100
MIN_DELAY_BETWEEN_DMS = 90  # 1.5 minutes
MAX_DELAY_BETWEEN_DMS = 240  # 4 minutes

# New/unverified account limits
NEW_ACCOUNT_DMS_PER_DAY = 20

# Twitter Blue/Premium accounts may have higher limits
PREMIUM_DMS_PER_DAY = 200
```

### Detection Patterns
```javascript
// Rate limit
document.body.innerText.includes('rate limit')
document.body.innerText.includes('Try again later')
document.body.innerText.includes('too many')

// Account locked
document.body.innerText.includes('locked')
document.body.innerText.includes('unusual activity')
document.body.innerText.includes('verify')

// Verification prompt
document.querySelector('[data-testid="VerificationPrompt"]')
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
| Set group image | 🔲 | |
| Detect group vs 1:1 | 🔲 | |
| Admin controls | 🔲 | |

### Required Selectors
```javascript
// Create group - select multiple users in new message
document.querySelectorAll('[data-testid="TypeaheadUser"]').click()

// Group indicator
conversation.querySelectorAll('[data-testid="UserAvatar"]').length > 1

// Group settings
document.querySelector('[data-testid="groupSettings"]')

// Add member
document.querySelector('[data-testid="addMember"]')

// Leave group
document.querySelector('[data-testid="leaveGroup"]')
```

---

## 14. TWITTER-SPECIFIC FEATURES

| Criterion | Status | Notes |
|-----------|--------|-------|
| Share tweet via DM | 🔲 | |
| Share profile via DM | 🔲 | |
| Voice messages | 🔲 | Premium feature |
| Video calls | 🔲 | |
| Scheduled messages | 🔲 | |
| Reply to specific message | 🔲 | |

### Required Selectors
```javascript
// Share tweet button
document.querySelector('[data-testid="sendShortcut"]')
document.querySelector('[aria-label="Share via Direct Message"]')

// Voice message (Premium)
document.querySelector('[data-testid="voiceMessage"]')

// Reply to message (swipe or long press)
message.querySelector('[data-testid="reply"]')
```

---

## Implementation Priority

### P0 - Critical
1. Navigate to /messages
2. Detect logged in state
3. Find message input (DraftJS/contenteditable)
4. Send message
5. Rate limit detection
6. Handle verification/encryption code (7911)

### P1 - High
7. List conversations
8. Select conversation
9. Read messages
10. New conversation flow
11. Handle "DMs disabled" restriction

### P2 - Medium
12. Message requests handling
13. User profile info
14. Media sending

### P3 - Low
15. Conversation management
16. Group messages
17. Twitter-specific features (voice, share tweet)

---

## File Structure

```
Backend/
├── automation/
│   ├── twitter_dm_automation.py     # Main DM automation
│   └── safari_twitter_poster.py     # Existing Twitter automation
├── services/
│   └── twitter/
│       ├── dm_service.py            # High-level DM service
│       ├── dm_sender.py             # Message sending
│       └── dm_reader.py             # Message reading
└── scripts/
    └── twitter_dm_test.py           # Test script
```

---

## Existing Files to Check

| File | Purpose |
|------|---------|
| `automation/safari_twitter_poster.py` | Existing Twitter automation |
| `services/twitter/dm_automation.py` | Existing DM service |
| `automation/safari_session_manager.py` | Session management |

---

## Authentication Notes

**IMPORTANT:** If Twitter/X prompts for encryption/verification code:
```
Code: 7911
```

---

## Testing Checklist

```bash
# 1. Test navigation
python -c "from automation.twitter_dm_automation import TwitterDMAutomation; dm=TwitterDMAutomation(); dm.navigate_to_inbox()"

# 2. Test login check
python -c "from automation.twitter_dm_automation import TwitterDMAutomation; dm=TwitterDMAutomation(); print(dm.check_login())"

# 3. Test find input
python -c "from automation.twitter_dm_automation import TwitterDMAutomation; dm=TwitterDMAutomation(); print(dm.find_message_input())"

# 4. Test send message
python -c "from automation.twitter_dm_automation import TwitterDMAutomation; dm=TwitterDMAutomation(); dm.send_message('username', 'Hello!')"
```

---

## Selector Investigation Script

```python
# Run to investigate Twitter DM page structure
python3 -c "
import subprocess
import time

subprocess.run(['osascript', '-e', 
    'tell application \"Safari\" to set URL of front document to \"https://x.com/messages\"'])
time.sleep(5)

js = '''
(function() {
    var result = {
        testids: [],
        inputs: [],
        buttons: [],
        url: window.location.href
    };
    
    // Get all data-testid elements
    document.querySelectorAll('[data-testid]').forEach((e, i) => {
        if (i < 30) {
            result.testids.push({
                testid: e.getAttribute('data-testid'),
                tag: e.tagName,
                text: e.textContent.trim().substring(0, 30)
            });
        }
    });
    
    document.querySelectorAll('input, textarea, [contenteditable]').forEach(i => {
        result.inputs.push({
            type: i.type || i.tagName,
            placeholder: i.placeholder || i.getAttribute('data-placeholder'),
            testid: i.getAttribute('data-testid')
        });
    });
    
    document.querySelectorAll('button').forEach((b, i) => {
        if (i < 15) {
            result.buttons.push({
                testid: b.getAttribute('data-testid'),
                ariaLabel: b.getAttribute('aria-label'),
                text: b.textContent.trim().substring(0, 20)
            });
        }
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

1. Check existing `safari_twitter_poster.py` for reusable code
2. Investigate actual Twitter DM page selectors (data-testid patterns)
3. Implement core send/read functions
4. Handle DraftJS/contenteditable input
5. Add rate limiting and safety
6. Integrate with warmth scoring system
