# PRD: Instagram DM Full Platform Control

**Version:** 2.0  
**Date:** January 28, 2026  
**Updated:** February 6, 2026  
**Status:** ⚠️ Core Working — Gaps Identified  
**Package:** `packages/instagram-dm/` (TypeScript)  
**Port:** 3100

---

## Executive Summary

Complete Safari automation for Instagram Direct Messages with full controllability of all UI elements, buttons, selectors, and features.

**Target URL:** `https://www.instagram.com/direct/inbox/`  
**Implementation:** `packages/instagram-dm/src/` (TypeScript + Express REST API)

---

## Success Criteria

### ✅ = Implemented | ⚠️ = Partial | ❌ = Not Working | 🔲 = Not Started

**Last audited:** February 6, 2026 (against actual code in `packages/instagram-dm/`)

---

## 1. NAVIGATION

| Criterion | Status | Notes |
|-----------|--------|-------|
| Navigate to instagram.com | ✅ | `SafariDriver.navigateTo()` |
| Navigate to /direct/inbox/ | ✅ | `navigateToInbox()` in dm-operations.ts |
| Navigate to /direct/t/{thread_id}/ | ⚠️ | Via `openConversation()`, not direct URL nav |
| Navigate to user profile | ✅ | Via `SafariDriver.navigateTo()` |
| Detect current page | ✅ | `SafariDriver.getCurrentUrl()` + `isOnInstagram()` |

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
| Detect logged in state | ✅ | `SafariDriver.isLoggedIn()` |
| Detect login prompt | ⚠️ | Inverse of isLoggedIn check |
| Handle 2FA prompt | 🔲 | Manual intervention required |
| Handle session expiry | 🔲 | No auto-detection |
| Detect rate limiting | ⚠️ | Server-side tracking, no IG UI detection |

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
| List all conversations | ✅ | `listConversations()` → returns conversation array |
| Get conversation count | ✅ | Returned from `listConversations().length` |
| Get unread count | 🔲 | Not implemented |
| Scroll to load more | 🔲 | Not implemented |
| Search conversations | 🔲 | Not implemented |
| Filter by type (Primary/General/Requests) | ✅ | `switchTab()` + `getAllConversations()` |

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
| Click on conversation | ✅ | `openConversation(username)` |
| Get selected conversation | ⚠️ | Implicit from open state |
| Get conversation username | ✅ | Returned in conversation list |
| Get last message preview | ⚠️ | In conversation list data |
| Get message timestamp | 🔲 | Not extracted |

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
| Get all messages in thread | ✅ | `readMessages(limit)` |
| Get message text | ✅ | Included in message data |
| Get message sender | ⚠️ | Basic sender detection |
| Get message timestamp | 🔲 | Not extracted |
| Detect message type (text/image/video/voice) | 🔲 | Text only |
| Scroll to load older messages | 🔲 | Not implemented |
| Mark as read | 🔲 | Implicit on open |

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
| Find message input | ✅ | Via selector in dm-operations |
| Clear input | ⚠️ | Implicit |
| Type message | ✅ | JS injection |
| Send message (Enter key) | ✅ | Primary send method |
| Send message (Send button) | ⚠️ | Fallback available |
| Verify message sent | ⚠️ | Basic result check |
| Handle send failure | ⚠️ | Returns success/failure, no retry |

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
| Click "New Message" button | ✅ | `startNewConversation()` |
| Search for user | ✅ | Username search in new convo dialog |
| Select user from results | ✅ | Auto-select from results |
| Start conversation | ✅ | Full flow: open + type + send |

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
| Attach image | 🔲 | Not implemented |
| Attach video | 🔲 | Not implemented |
| Send voice message | 🔲 | Not implemented |
| Send GIF | 🔲 | Not implemented |
| Send emoji | ⚠️ | Emoji in text works, picker not automated |
| React to message | 🔲 | Not implemented |

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
| Delete conversation | 🔲 | Not implemented |
| Mute conversation | 🔲 | Not implemented |
| Block user | 🔲 | Not implemented |
| Report conversation | 🔲 | Not implemented |
| Pin conversation | 🔲 | Not implemented |

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
| Navigate to requests | ✅ | Via `switchTab('requests')` |
| List pending requests | ✅ | Via `listConversations()` after tab switch |
| Accept request | 🔲 | Not implemented |
| Decline request | 🔲 | Not implemented |
| Get request count | 🔲 | Not implemented |

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
| Get username | ⚠️ | From conversation data, not profile scrape |
| Get display name | 🔲 | Not implemented |
| Get follower count | 🔲 | Not implemented |
| Get following count | 🔲 | Not implemented |
| Get bio | 🔲 | Not implemented |
| Check if verified | 🔲 | Not implemented |
| Check if following | 🔲 | Not implemented |

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
| Detect rate limit warning | 🔲 | No IG UI detection |
| Detect action blocked | 🔲 | No IG UI detection |
| Implement delay between messages | ✅ | Active hours enforcement |
| Implement daily limits | ✅ | `messagesPerDay` enforced via middleware |
| Implement hourly limits | ✅ | `messagesPerHour` enforced via middleware |
| Log all actions | ⚠️ | Console logging only, no DB persistence |

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

## Actual File Structure (TypeScript)

```
packages/instagram-dm/
├── src/
│   ├── api/
│   │   ├── server.ts        # Express REST API (port 3100)
│   │   ├── client.ts        # Client library for other services
│   │   └── index.ts         # API exports
│   ├── automation/
│   │   ├── safari-driver.ts # Safari AppleScript + JS execution
│   │   ├── dm-operations.ts # Core DM functions
│   │   ├── types.ts         # TypeScript interfaces
│   │   └── index.ts         # Automation exports
│   ├── utils/
│   │   └── index.ts         # Helpers
│   └── index.ts             # Package exports
├── package.json
└── tsconfig.json
```

---

## API Endpoints (Implemented)

```
GET  /health                  ✅ Health check + rate limit status
GET  /api/status              ✅ Login status, current URL
GET  /api/rate-limits         ✅ Rate limit details
PUT  /api/rate-limits         ✅ Update rate limits
GET  /api/conversations       ✅ List conversations (current tab)
GET  /api/conversations/all   ✅ All tabs (Primary/General/Requests)
POST /api/inbox/navigate      ✅ Navigate to inbox
POST /api/inbox/tab           ✅ Switch tab
POST /api/conversations/open  ✅ Open conversation by username
POST /api/conversations/new   ✅ Start new conversation
GET  /api/messages            ✅ Read messages (with limit)
POST /api/messages/send       ✅ Send in current convo (rate limited)
POST /api/messages/send-to    ✅ Send to user (open/create + send)
POST /api/execute             ✅ Raw JS execution
PUT  /api/config              ✅ Update driver config
```

---

## 13. AI INTEGRATION

| Criterion | Status | Notes |
|-----------|--------|-------|
| AI DM generation | ✅ | `generateAIDM()` via OpenAI GPT-4o |
| Personalized by recipient | ✅ | Username + purpose + topic |
| Fallback on API failure | ✅ | Static fallback message |
| AI endpoint exposed | 🔲 | Function exists but no dedicated API route |

---

## 14. CRM / DATABASE INTEGRATION

| Criterion | Status | Notes |
|-----------|--------|-------|
| Log DMs to Supabase | ❌ | Not wired |
| Contact creation on DM | ❌ | Not wired |
| Relationship scoring | ❌ | Not implemented |
| Outreach sequence tracking | ❌ | Not implemented |
| Template system | ❌ | Not implemented |

---

## 15. SCHEDULER INTEGRATION

| Criterion | Status | Notes |
|-----------|--------|-------|
| Scheduled DM sessions | ❌ | Not wired to scheduler |
| Automated daily touches | ❌ | Not implemented |
| Cadence enforcement | ❌ | Not implemented |

---

## Summary Scorecard

| Category | Score | Notes |
|----------|-------|-------|
| Navigation | 4/5 | ✅ Solid |
| Authentication | 2/5 | ⚠️ Basic login check only |
| DM Inbox | 4/6 | ✅ Core works, missing scroll/search/unread count |
| Conversation Selection | 3/5 | ✅ Core works |
| Message Reading | 2/7 | ⚠️ Text only, no timestamps/types |
| Message Sending | 5/7 | ✅ Good |
| New Conversation | 4/4 | ✅ Complete |
| Media Handling | 0/6 | 🔲 Not started |
| Conversation Mgmt | 0/5 | 🔲 Not started |
| Message Requests | 2/5 | ⚠️ Can navigate/list, can't accept/decline |
| User Profile | 0/7 | 🔲 Not started |
| Rate Limiting | 3/5 | ✅ Server-side, no IG UI detection |
| AI Integration | 3/4 | ✅ Working |
| CRM Integration | 0/5 | ❌ Not wired |
| Scheduler | 0/3 | ❌ Not wired |
| **TOTAL** | **32/79 (40%)** | |

---

## Next Steps (Priority Order)

1. ❌ Wire CRM logging (Supabase) for all DM send/receive
2. ❌ Add AI DM generation API endpoint
3. ❌ Add message timestamp extraction
4. ❌ Add unread count detection
5. ❌ Add conversation scroll/load more
6. ❌ Wire scheduler for automated sessions
7. 🔲 Accept/decline message requests
8. 🔲 User profile extraction from DM context

---

**Last Updated:** February 6, 2026  
**Audited Against:** `packages/instagram-dm/src/` (TypeScript)
