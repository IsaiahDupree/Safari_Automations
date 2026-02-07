# PRD: TikTok DM Full Platform Control

**Version:** 2.0  
**Date:** January 28, 2026  
**Updated:** February 6, 2026  
**Status:** ⚠️ Core Working — Gaps Identified  
**Package:** `packages/tiktok-dm/` (TypeScript)  
**Port:** 3102

---

## Executive Summary

Complete Safari automation for TikTok Direct Messages with full controllability of all UI elements, buttons, selectors, and features.

**Target URL:** `https://www.tiktok.com/messages`  
**Implementation:** `packages/tiktok-dm/src/` (TypeScript + Express REST API)

---

## Success Criteria

### ✅ = Implemented | ⚠️ = Partial | ❌ = Not Working | 🔲 = Not Started

**Last audited:** February 6, 2026 (against actual code in `packages/tiktok-dm/`)

---

## 1. NAVIGATION

| Criterion | Status | Notes |
|-----------|--------|-------|
| Navigate to tiktok.com | ✅ | `SafariDriver.navigateTo()` |
| Navigate to /messages | ✅ | `navigateToInbox()` |
| Navigate to specific conversation | ✅ | `openConversation(driver, username)` |
| Navigate to user profile | ✅ | Via `SafariDriver.navigateTo()` |
| Navigate to For You page | ✅ | Via URL navigation |
| Detect current page | ✅ | `SafariDriver.getCurrentUrl()` + `isOnTikTok()` |

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
| Detect logged in state | ✅ | `SafariDriver.isLoggedIn()` |
| Detect login prompt | ⚠️ | Inverse of isLoggedIn |
| Handle CAPTCHA | 🔲 | Manual intervention required |
| Handle 2FA/verification | 🔲 | Manual intervention required |
| Handle session expiry | 🔲 | No auto-detection |
| Detect rate limiting | ⚠️ | Server-side tracking, no TikTok UI detection |

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
| List all conversations | ✅ | `listConversations(driver)` |
| Get conversation count | ✅ | From `.length` |
| Get unread count | 🔲 | Not implemented |
| Scroll to load more | ✅ | `scrollConversations(driver)` |
| Search conversations | 🔲 | Not implemented |
| Filter conversations | 🔲 | Not implemented |

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
| Click on conversation | ✅ | `openConversation(driver, username)` |
| Get selected conversation | ⚠️ | Implicit from open state |
| Get conversation username | ✅ | In conversation list data |
| Get last message preview | ⚠️ | In conversation list data |
| Get message timestamp | 🔲 | Not extracted |
| Detect conversation type (group/single) | 🔲 | Not implemented |

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
| Get all messages in thread | ✅ | `readMessages(driver, limit)` |
| Get message text | ✅ | Included in message data |
| Get message sender | ⚠️ | Basic sender detection |
| Get message timestamp | 🔲 | Not extracted |
| Detect message type (text/image/video/sticker) | 🔲 | Text only |
| Scroll to load older messages | 🔲 | Not in message thread |
| Detect read status | 🔲 | Not implemented |

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
| Find message input | ✅ | Via contenteditable selector |
| Clear input | ⚠️ | Implicit |
| Type message | ✅ | JS injection into contenteditable |
| Send message (Enter key) | ✅ | Primary send method |
| Send message (Send button) | ⚠️ | Fallback available |
| Verify message sent | ⚠️ | Basic result check |
| Handle send failure | ⚠️ | Returns success/failure, no retry |
| Detect "pending" state | 🔲 | Not implemented |

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
| Click "New Message" button | ✅ | `startNewConversation()` |
| Search for user | ✅ | Username search |
| Select user from results | ✅ | Auto-select |
| Handle "Following only" restriction | 🔲 | Not detected |
| Start conversation | ✅ | Full flow works |

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
| Send image | 🔲 | Not implemented |
| Send video | 🔲 | Not implemented |
| Send sticker | 🔲 | Not implemented |
| Send GIF | 🔲 | Not implemented |
| Send emoji | ⚠️ | Emoji in text works, picker not automated |
| View received media | 🔲 | Not implemented |

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
| Delete conversation | 🔲 | Not implemented |
| Mute conversation | 🔲 | Not implemented |
| Block user | 🔲 | Not implemented |
| Report conversation | 🔲 | Not implemented |
| Pin conversation | 🔲 | Not implemented |
| Mark as read/unread | 🔲 | Not implemented |

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
| Navigate to requests | 🔲 | Not implemented |
| List pending requests | 🔲 | Not implemented |
| Accept request | 🔲 | Not implemented |
| Decline request | 🔲 | Not implemented |
| Get request count | 🔲 | Not implemented |

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
| Get username | ⚠️ | From conversation data |
| Get display name | 🔲 | Not implemented |
| Get follower count | 🔲 | Not implemented |
| Get following count | 🔲 | Not implemented |
| Get bio | 🔲 | Not implemented |
| Check if verified | 🔲 | Not implemented |
| Check if following | 🔲 | Not implemented |
| Navigate to full profile | ✅ | `sendDMFromProfileUrl()` navigates to profile |

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
| Detect rate limit warning | 🔲 | No TikTok UI detection |
| Detect action blocked | 🔲 | No TikTok UI detection |
| Detect CAPTCHA | 🔲 | No auto-detection |
| Implement delay between messages | ✅ | `minDelayMs`/`maxDelayMs` + active hours |
| Implement daily limits | ✅ | `messagesPerDay` enforced |
| Implement hourly limits | ✅ | `messagesPerHour` enforced |
| Log all actions | ⚠️ | In-memory messageLog (7-day rolling), no DB |
| Rotate accounts | 🔲 | Not implemented |
| Error state detection | ✅ | `hasErrorState()` + `checkAndRetryError()` |

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
| Create group | 🔲 | Not implemented |
| Add members | 🔲 | Not implemented |
| Remove members | 🔲 | Not implemented |
| Leave group | 🔲 | Not implemented |
| Rename group | 🔲 | Not implemented |
| Detect group vs 1:1 | 🔲 | Not implemented |

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

## Actual File Structure (TypeScript)

```
packages/tiktok-dm/
├── src/
│   ├── api/
│   │   ├── server.ts        # Express REST API (port 3102)
│   │   ├── client.ts        # Client library for other services
│   │   └── index.ts         # API exports
│   ├── automation/
│   │   ├── safari-driver.ts # Safari AppleScript + JS execution
│   │   ├── dm-operations.ts # Core DM functions
│   │   ├── types.ts         # TypeScript interfaces
│   │   └── index.ts         # Automation exports
│   ├── utils/
│   │   └── index.ts         # isWithinActiveHours, getRandomDelay
│   └── index.ts             # Package exports
├── package.json
└── tsconfig.json
```

---

## API Endpoints (Implemented)

```
GET  /health                           ✅ Health check
GET  /api/tiktok/status                ✅ Login status, current URL
GET  /api/tiktok/error-check           ✅ Check for error state
POST /api/tiktok/error-retry           ✅ Auto-retry on error
GET  /api/tiktok/rate-limits           ✅ Rate limit details
PUT  /api/tiktok/rate-limits           ✅ Update rate limits
POST /api/tiktok/inbox/navigate        ✅ Navigate to inbox
GET  /api/tiktok/conversations         ✅ List conversations
POST /api/tiktok/conversations/open    ✅ Open by username
POST /api/tiktok/conversations/new     ✅ New convo (username + message)
POST /api/tiktok/conversations/scroll  ✅ Scroll to load more
GET  /api/tiktok/messages              ✅ Read messages (with limit)
POST /api/tiktok/messages/send         ✅ Send in current convo
POST /api/tiktok/messages/send-to      ✅ Send to user by username
POST /api/tiktok/messages/send-to-url  ✅ Send via profile URL
POST /api/execute                      ✅ Raw JS execution
```

---

## 14. AI INTEGRATION

| Criterion | Status | Notes |
|-----------|--------|-------|
| AI DM generation | ✅ | `generateAIDM()` via OpenAI GPT-4o |
| Personalized by recipient | ✅ | Username + purpose + topic |
| Fallback on API failure | ✅ | Static fallback message |
| AI endpoint exposed | 🔲 | Function exists but no dedicated API route |
| TikTok tone (casual, emojis) | ✅ | Custom system prompt |

---

## 15. CRM / DATABASE INTEGRATION

| Criterion | Status | Notes |
|-----------|--------|-------|
| Log DMs to Supabase | ❌ | Not wired |
| Contact creation on DM | ❌ | Not wired |
| Relationship scoring | ❌ | Not implemented |
| Outreach sequence tracking | ❌ | Not implemented |
| Template system | ❌ | Not implemented |

---

## 16. SCHEDULER INTEGRATION

| Criterion | Status | Notes |
|-----------|--------|-------|
| Scheduled DM sessions | ❌ | Not wired to scheduler |
| Automated daily touches | ❌ | Not implemented |
| Cadence enforcement | ❌ | Not implemented |

---

## 17. TikTok-SPECIFIC FEATURES

| Criterion | Status | Notes |
|-----------|--------|-------|
| Send DM from profile URL | ✅ | `sendDMFromProfileUrl()` |
| Send DM by username | ✅ | `sendDMByUsername()` |
| Error state auto-recovery | ✅ | `checkAndRetryError()` |
| Following-only restriction detect | 🔲 | Not implemented |

---

## Summary Scorecard

| Category | Score | Notes |
|----------|-------|-------|
| Navigation | 6/6 | ✅ Complete |
| Authentication | 2/6 | ⚠️ Basic login check |
| DM Inbox | 4/6 | ✅ Good, has scroll |
| Conversation Selection | 3/6 | ✅ Core works |
| Message Reading | 2/7 | ⚠️ Text only |
| Message Sending | 5/8 | ✅ Good |
| New Conversation | 4/5 | ✅ Good, missing restriction detection |
| Media & Stickers | 0/6 | 🔲 Not started |
| Conversation Mgmt | 0/6 | 🔲 Not started |
| Message Requests | 0/5 | 🔲 Not started |
| User Profile | 1/8 | ⚠️ Only profile URL nav |
| Rate Limiting | 4/8 | ✅ Server-side + error recovery |
| AI Integration | 4/5 | ✅ Working |
| CRM Integration | 0/5 | ❌ Not wired |
| Scheduler | 0/3 | ❌ Not wired |
| TikTok-Specific | 3/4 | ✅ Good |
| **TOTAL** | **38/99 (38%)** | |

---

## Next Steps (Priority Order)

1. ❌ Wire CRM logging (Supabase) for all DM send/receive
2. ❌ Add AI DM generation API endpoint
3. ❌ Add message timestamp extraction
4. ❌ Add Following-only restriction detection
5. ❌ Wire scheduler for automated sessions
6. 🔲 Message requests handling
7. 🔲 User profile extraction
8. 🔲 CAPTCHA detection

---

**Last Updated:** February 6, 2026  
**Audited Against:** `packages/tiktok-dm/src/` (TypeScript)
