# PRD: Instagram DM Full Platform Control

**Version:** 1.0  
**Date:** January 28, 2026  
**Status:** Assessment & Implementation

---

## Executive Summary

Complete Safari automation for Instagram Direct Messages with full controllability of all UI elements, buttons, selectors, and features.

**Target URL:** `https://www.instagram.com/direct/inbox/`

---

## Success Criteria

### ✅ = Implemented | ⚠️ = Partial | ❌ = Not Working | 🔲 = Not Started

---

## 1. NAVIGATION

| Criterion | Status | Notes |
|-----------|--------|-------|
| Navigate to instagram.com | 🔲 | |
| Navigate to /direct/inbox/ | 🔲 | DM inbox |
| Navigate to /direct/t/{thread_id}/ | 🔲 | Specific conversation |
| Navigate to user profile | 🔲 | |
| Detect current page | 🔲 | |

### Required Selectors
```javascript
// Navigation URLs
URL: https://www.instagram.com/direct/inbox/
URL: https://www.instagram.com/direct/t/{thread_id}/
URL: https://www.instagram.com/{username}/

// Detect DM page
document.querySelector('[aria-label="Direct messaging"]')
window.location.pathname.startsWith('/direct/')
```

---

## 2. AUTHENTICATION

| Criterion | Status | Notes |
|-----------|--------|-------|
| Detect logged in state | 🔲 | |
| Detect login prompt | 🔲 | |
| Handle 2FA prompt | 🔲 | Manual |
| Handle session expiry | 🔲 | |
| Detect rate limiting | 🔲 | |

### Required Selectors
```javascript
// Login detection
document.querySelector('input[name="username"]') // Login page
document.querySelector('[aria-label="Home"]') // Logged in indicator
document.querySelector('svg[aria-label="Instagram"]') // Header present

// Rate limit detection
document.body.innerText.includes('try again later')
document.body.innerText.includes('Action Blocked')
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
| Filter by type (Primary/General/Requests) | 🔲 | |

### Required Selectors
```javascript
// Conversation list
document.querySelectorAll('[role="listitem"]')
document.querySelectorAll('div[class*="conversation"]')

// Unread indicator
document.querySelectorAll('[class*="unread"]')
document.querySelectorAll('span[class*="badge"]')

// Tabs (Primary, General, Requests)
document.querySelectorAll('[role="tab"]')
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

### Required Selectors
```javascript
// Conversation item
document.querySelector('[role="listitem"]')

// Username in conversation
conversation.querySelector('span[class*="username"]')
conversation.querySelector('div[class*="title"]')

// Last message
conversation.querySelector('span[class*="preview"]')
```

---

## 5. MESSAGE READING

| Criterion | Status | Notes |
|-----------|--------|-------|
| Get all messages in thread | 🔲 | |
| Get message text | 🔲 | |
| Get message sender | 🔲 | |
| Get message timestamp | 🔲 | |
| Detect message type (text/image/video/voice) | 🔲 | |
| Scroll to load older messages | 🔲 | |
| Mark as read | 🔲 | |

### Required Selectors
```javascript
// Message container
document.querySelector('[role="main"]')
document.querySelectorAll('[class*="message"]')

// Message text
message.querySelector('span[class*="text"]')
message.innerText

// Sender (their messages vs yours)
message.querySelector('[class*="received"]') // Their message
message.querySelector('[class*="sent"]') // Your message
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

### Required Selectors
```javascript
// Message input
document.querySelector('textarea[placeholder*="Message"]')
document.querySelector('[contenteditable="true"]')
document.querySelector('[aria-label="Message"]')

// Send button
document.querySelector('button[type="submit"]')
document.querySelector('[aria-label="Send"]')
document.querySelectorAll('button').find(b => b.textContent === 'Send')

// Send via keyboard
textarea.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}))
```

---

## 7. NEW CONVERSATION

| Criterion | Status | Notes |
|-----------|--------|-------|
| Click "New Message" button | 🔲 | |
| Search for user | 🔲 | |
| Select user from results | 🔲 | |
| Start conversation | 🔲 | |

### Required Selectors
```javascript
// New message button
document.querySelector('[aria-label="New message"]')
document.querySelector('svg[aria-label="New message"]').parentElement

// Search input in new message dialog
document.querySelector('input[placeholder*="Search"]')

// User search results
document.querySelectorAll('[role="button"]').filter(b => b.innerText.includes(username))
```

---

## 8. MEDIA HANDLING

| Criterion | Status | Notes |
|-----------|--------|-------|
| Attach image | 🔲 | |
| Attach video | 🔲 | |
| Send voice message | 🔲 | |
| Send GIF | 🔲 | |
| Send emoji | 🔲 | |
| React to message | 🔲 | |

### Required Selectors
```javascript
// Media attachment button
document.querySelector('[aria-label="Add Photo or Video"]')
document.querySelector('input[type="file"]')

// Emoji button
document.querySelector('[aria-label="Emoji"]')

// GIF button
document.querySelector('[aria-label="Choose a GIF"]')
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

### Required Selectors
```javascript
// Conversation options (three dots menu)
document.querySelector('[aria-label="Conversation information"]')
document.querySelector('[aria-label="More options"]')

// Menu items
document.querySelectorAll('[role="menuitem"]')
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
// Requests tab/link
document.querySelector('a[href*="requests"]')
document.querySelectorAll('[role="tab"]').find(t => t.innerText.includes('Requests'))

// Accept/Decline buttons
document.querySelector('button').filter(b => b.textContent === 'Accept')
document.querySelector('button').filter(b => b.textContent === 'Decline')
```

---

## 11. USER PROFILE INFO

| Criterion | Status | Notes |
|-----------|--------|-------|
| Get username | 🔲 | |
| Get display name | 🔲 | |
| Get follower count | 🔲 | |
| Get following count | 🔲 | |
| Get bio | 🔲 | |
| Check if verified | 🔲 | |
| Check if following | 🔲 | |

### Required Selectors
```javascript
// Profile header in DM
document.querySelector('[class*="profileHeader"]')

// Username
document.querySelector('h2')
document.querySelector('[class*="username"]')

// Stats
document.querySelectorAll('[class*="stat"]')
```

---

## 12. RATE LIMITING & SAFETY

| Criterion | Status | Notes |
|-----------|--------|-------|
| Detect rate limit warning | 🔲 | |
| Detect action blocked | 🔲 | |
| Implement delay between messages | 🔲 | |
| Implement daily limits | 🔲 | |
| Log all actions | 🔲 | |

### Safety Limits
```python
# Recommended limits
MAX_DMS_PER_HOUR = 20
MAX_DMS_PER_DAY = 100
MIN_DELAY_BETWEEN_DMS = 60  # seconds
MAX_DELAY_BETWEEN_DMS = 180  # seconds

# New account limits (first 30 days)
NEW_ACCOUNT_DMS_PER_DAY = 20
```

---

## Implementation Priority

### P0 - Critical
1. Navigate to DM inbox
2. Detect logged in state
3. Find message input
4. Send message
5. Rate limit detection

### P1 - High
6. List conversations
7. Select conversation
8. Read messages
9. New conversation flow

### P2 - Medium
10. Message requests handling
11. User profile info
12. Media sending

### P3 - Low
13. Conversation management
14. Advanced media (GIF, voice)

---

## File Structure

```
Backend/
├── automation/
│   └── instagram_dm_automation.py      # Main automation
├── services/
│   └── instagram/
│       ├── dm_service.py               # High-level DM service
│       ├── dm_sender.py                # Message sending
│       └── dm_reader.py                # Message reading
└── scripts/
    └── instagram_dm_test.py            # Test script
```

---

## Testing Checklist

```bash
# 1. Test navigation
python -c "from automation.instagram_dm_automation import InstagramDMAutomation; dm=InstagramDMAutomation(); dm.navigate_to_inbox()"

# 2. Test login check
python -c "from automation.instagram_dm_automation import InstagramDMAutomation; dm=InstagramDMAutomation(); print(dm.check_login())"

# 3. Test conversation list
python -c "from automation.instagram_dm_automation import InstagramDMAutomation; dm=InstagramDMAutomation(); print(dm.get_conversations())"

# 4. Test send message
python -c "from automation.instagram_dm_automation import InstagramDMAutomation; dm=InstagramDMAutomation(); dm.send_message('username', 'Hello!')"
```

---

## Selector Investigation Script

```python
# Run to investigate Instagram DM page structure
python3 -c "
import subprocess
import time

subprocess.run(['osascript', '-e', 
    'tell application \"Safari\" to set URL of front document to \"https://www.instagram.com/direct/inbox/\"'])
time.sleep(5)

js = '''
(function() {
    var result = {
        buttons: [],
        inputs: [],
        conversations: [],
        url: window.location.href
    };
    
    document.querySelectorAll('button').forEach((b, i) => {
        if (i < 15) {
            result.buttons.push({
                text: b.textContent.trim().substring(0, 30),
                ariaLabel: b.getAttribute('aria-label')
            });
        }
    });
    
    document.querySelectorAll('input, textarea').forEach(i => {
        result.inputs.push({
            type: i.type || 'textarea',
            placeholder: i.placeholder,
            ariaLabel: i.getAttribute('aria-label')
        });
    });
    
    document.querySelectorAll('[role=\"listitem\"]').forEach((c, i) => {
        if (i < 5) {
            result.conversations.push({
                text: c.innerText.substring(0, 50)
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

## Integration with Warmth Score

```python
# DM automation should integrate with warmth scoring
from services.dm_warmth_system import DMWarmthManager

warmth = DMWarmthManager()

# Before sending DM
contact = warmth.get_contact(platform='instagram', username=username)
if contact.warmth_score < 0.3:
    # Too cold - need more engagement first
    pass
elif contact.warmth_score > 0.7:
    # Warm enough for promotional content
    pass
else:
    # Medium - send value-first content
    pass

# After sending DM
warmth.log_interaction(
    platform='instagram',
    username=username,
    interaction_type='dm_sent',
    sentiment='positive'
)
```

---

## Current Files to Check

| File | Purpose |
|------|---------|
| `services/instagram/comment_automation.py` | Existing IG automation |
| `services/dm_warmth_system.py` | Warmth scoring |
| `automation/safari_session_manager.py` | Session management |

---

## Next Steps

1. Investigate actual Instagram DM page selectors
2. Create `instagram_dm_automation.py`
3. Implement core send/read functions
4. Add rate limiting and safety
5. Integrate with warmth scoring system
