# PRD: Twitter/X DM Full Platform Control

**Version:** 2.0  
**Date:** January 28, 2026  
**Updated:** February 6, 2026  
**Status:** ⚠️ Core Working — Gaps Identified (No AI DM generation)  
**Package:** `packages/twitter-dm/` (TypeScript)  
**Port:** 3003

---

## Executive Summary

Complete Safari automation for Twitter/X Direct Messages with full controllability of all UI elements, buttons, selectors, and features.

**Target URL:** `https://x.com/messages`  
**Implementation:** `packages/twitter-dm/src/` (TypeScript + Express REST API)

---

## Success Criteria

### ✅ = Implemented | ⚠️ = Partial | ❌ = Not Working | 🔲 = Not Started

**Last audited:** February 6, 2026 (against actual code in `packages/twitter-dm/`)

---

## 1. NAVIGATION

| Criterion | Status | Notes |
|-----------|--------|-------|
| Navigate to x.com | ✅ | `SafariDriver.navigateTo()` |
| Navigate to /messages | ✅ | `navigateToInbox()` |
| Navigate to specific conversation | ⚠️ | Via `openConversation()`, not direct URL |
| Navigate to user profile | ✅ | Via URL navigation |
| Navigate to /home | ✅ | Via URL navigation |
| Detect current page | ✅ | `SafariDriver.getCurrentUrl()` + `isOnTwitter()` |

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
| Detect logged in state | ✅ | `SafariDriver.isLoggedIn()` |
| Detect login prompt | ⚠️ | Inverse of isLoggedIn |
| Handle 2FA prompt | 🔲 | Manual (code: 7911) |
| Handle encryption code prompt | 🔲 | Code: 7911 |
| Handle session expiry | 🔲 | No auto-detection |
| Detect rate limiting | ⚠️ | Server-side only, no Twitter UI detection |
| Detect account suspension | 🔲 | Not implemented |

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
| List all conversations | ✅ | `listConversations()` |
| Get conversation count | ✅ | From `.length` |
| Get unread count | ✅ | `getUnreadConversations()` — **unique to Twitter** |
| Scroll to load more | 🔲 | Not in inbox, only in conversation thread |
| Search conversations | 🔲 | Not implemented |
| Filter by type (All/Unread/Groups) | ✅ | `switchTab()` + `getAllConversations()` |

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
| Click on conversation | ✅ | `openConversation(username)` |
| Get selected conversation | ⚠️ | Implicit from open state |
| Get conversation participant(s) | ✅ | In conversation list data |
| Get last message preview | ⚠️ | In conversation list data |
| Get message timestamp | 🔲 | Not extracted |
| Detect conversation type (group/single) | 🔲 | Not implemented |

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
| Get all messages in thread | ✅ | `readMessages(limit)` |
| Get message text | ✅ | Included in message data |
| Get message sender | ⚠️ | Basic sender detection |
| Get message timestamp | 🔲 | Not extracted |
| Detect message type (text/image/video/gif/link) | 🔲 | Text only |
| Scroll to load older messages | ✅ | `scrollConversation(scrollCount)` |
| Detect read receipts | 🔲 | Not implemented |
| Detect "seen" status | 🔲 | Not implemented |

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
| Find message input | ✅ | Via DraftJS/contenteditable selector |
| Clear input | ⚠️ | Implicit |
| Type message | ✅ | JS injection |
| Send message (Enter key) | ✅ | Primary send method |
| Send message (Send button) | ⚠️ | Fallback available |
| Verify message sent | ⚠️ | Basic result check |
| Handle send failure | ⚠️ | Returns success/failure, no retry |
| Detect "pending" state | 🔲 | Not implemented |

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
| Click "New Message" button | ✅ | `startNewConversation()` |
| Search for user | ✅ | Username search |
| Select user from results | ✅ | Auto-select |
| Handle "DMs disabled" restriction | 🔲 | Not detected |
| Select multiple users (group) | 🔲 | Not implemented |
| Start conversation | ✅ | Full flow works |

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
| Send image | 🔲 | Not implemented |
| Send video | 🔲 | Not implemented |
| Send GIF | 🔲 | Not implemented |
| Send emoji | ⚠️ | Emoji in text works, picker not automated |
| Send link (auto-preview) | ⚠️ | Links work in text, no preview control |
| View received media | 🔲 | Not implemented |
| React to message | 🔲 | Not implemented |

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
| Delete conversation | 🔲 | Not implemented |
| Leave group | 🔲 | Not implemented |
| Mute conversation | 🔲 | Not implemented |
| Block user | 🔲 | Not implemented |
| Report conversation | 🔲 | Not implemented |
| Pin conversation | 🔲 | Not implemented |
| Snooze notifications | 🔲 | Not implemented |

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
| Navigate to requests | 🔲 | Not implemented |
| List pending requests | 🔲 | Not implemented |
| Accept request | 🔲 | Not implemented |
| Decline request | 🔲 | Not implemented |
| Get request count | 🔲 | Not implemented |

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
| Get username | ⚠️ | From conversation data |
| Get display name | 🔲 | Not implemented |
| Get follower count | 🔲 | Not implemented |
| Get following count | 🔲 | Not implemented |
| Get bio | 🔲 | Not implemented |
| Check if verified (blue/gold) | 🔲 | Not implemented |
| Check if following | 🔲 | Not implemented |
| Check if they follow you | 🔲 | Not implemented |
| Navigate to full profile | ✅ | `sendDMFromProfileUrl()` navigates to profile |

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
| Detect rate limit warning | 🔲 | No Twitter UI detection |
| Detect action blocked | 🔲 | No Twitter UI detection |
| Detect account locked | 🔲 | Not implemented |
| Implement delay between messages | ✅ | Active hours enforcement |
| Implement daily limits | ✅ | `messagesPerDay` enforced |
| Implement hourly limits | ✅ | `messagesPerHour` enforced |
| Log all actions | ⚠️ | Console only, no DB |
| Handle verification prompts | 🔲 | Not implemented |

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
| Create group | 🔲 | Not implemented |
| Add members | 🔲 | Not implemented |
| Remove members | 🔲 | Not implemented |
| Leave group | 🔲 | Not implemented |
| Rename group | 🔲 | Not implemented |
| Set group image | 🔲 | Not implemented |
| Detect group vs 1:1 | 🔲 | Not implemented |
| Admin controls | 🔲 | Not implemented |

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
| Send DM from profile URL | ✅ | `sendDMFromProfileUrl()` |
| Send DM by username | ✅ | `sendDMByUsername()` |
| Get unread conversations | ✅ | `getUnreadConversations()` — unique to Twitter |
| Scroll conversation thread | ✅ | `scrollConversation(scrollCount)` |
| Share tweet via DM | 🔲 | Not implemented |
| Share profile via DM | 🔲 | Not implemented |
| Voice messages | 🔲 | Premium feature |
| Video calls | 🔲 | Not implemented |
| Scheduled messages | 🔲 | Not implemented |
| Reply to specific message | 🔲 | Not implemented |

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

## Actual File Structure (TypeScript)

```
packages/twitter-dm/
├── src/
│   ├── api/
│   │   ├── server.ts        # Express REST API (port 3003)
│   │   ├── client.ts        # Client library for other services
│   │   └── index.ts         # API exports
│   ├── automation/
│   │   ├── safari-driver.ts # Safari AppleScript + JS execution
│   │   ├── dm-operations.ts # Core DM functions
│   │   ├── types.ts         # TypeScript interfaces
│   │   └── index.ts         # Automation exports
│   ├── utils/
│   │   └── index.ts         # isWithinActiveHours
│   └── index.ts             # Package exports
├── package.json
└── tsconfig.json
```

---

## API Endpoints (Implemented)

```
GET  /health                            ✅ Health check
GET  /api/twitter/status                ✅ Login status, current URL
GET  /api/twitter/rate-limits           ✅ Rate limit details
PUT  /api/twitter/rate-limits           ✅ Update rate limits
POST /api/twitter/inbox/navigate        ✅ Navigate to inbox
POST /api/twitter/inbox/tab             ✅ Switch tab
GET  /api/twitter/conversations         ✅ List conversations
GET  /api/twitter/conversations/all     ✅ All tabs
GET  /api/twitter/conversations/unread  ✅ Unread conversations
POST /api/twitter/conversations/open    ✅ Open by username
POST /api/twitter/conversations/new     ✅ Start new conversation
POST /api/twitter/conversations/scroll  ✅ Scroll in conversation
GET  /api/twitter/messages              ✅ Read messages (with limit)
POST /api/twitter/messages/send         ✅ Send in current convo
POST /api/twitter/messages/send-to      ✅ Send to user by username
POST /api/twitter/messages/send-to-url  ✅ Send via profile URL
POST /api/twitter/execute               ✅ Raw JS execution
PUT  /api/twitter/config                ✅ Update driver config
```

---

## 15. AI INTEGRATION

| Criterion | Status | Notes |
|-----------|--------|-------|
| AI DM generation | ❌ | **NOT IMPLEMENTED** — only platform missing this |
| Personalized by recipient | ❌ | No AI function exists |
| Fallback message | ❌ | No fallback |
| AI endpoint exposed | ❌ | No endpoint |

**⚠️ This is the #1 gap for Twitter DM.** Instagram and TikTok both have `generateAIDM()`. Twitter needs one with a professional/witty tone.

---

## 16. CRM / DATABASE INTEGRATION

| Criterion | Status | Notes |
|-----------|--------|-------|
| Log DMs to Supabase | ❌ | Not wired |
| Contact creation on DM | ❌ | Not wired |
| Relationship scoring | ❌ | Not implemented |
| Outreach sequence tracking | ❌ | Not implemented |
| Template system | ❌ | Not implemented |

---

## 17. SCHEDULER INTEGRATION

| Criterion | Status | Notes |
|-----------|--------|-------|
| Scheduled DM sessions | ❌ | Not wired to scheduler |
| Automated daily touches | ❌ | Not implemented |
| Cadence enforcement | ❌ | Not implemented |

---

## Authentication Notes

**IMPORTANT:** If Twitter/X prompts for encryption/verification code:
```
Code: 7911
```

---

## Summary Scorecard

| Category | Score | Notes |
|----------|-------|-------|
| Navigation | 5/6 | ✅ Solid |
| Authentication | 2/7 | ⚠️ Basic login check |
| DM Inbox | 5/6 | ✅ Best of all 3 (has unread) |
| Conversation Selection | 3/6 | ✅ Core works |
| Message Reading | 3/8 | ⚠️ Has scroll, but text-only |
| Message Sending | 5/8 | ✅ Good |
| New Conversation | 4/6 | ✅ Good, missing DM-disabled detection |
| Media & Attachments | 0/7 | 🔲 Not started |
| Conversation Mgmt | 0/7 | 🔲 Not started |
| Message Requests | 0/5 | 🔲 Not started |
| User Profile | 1/9 | ⚠️ Only profile URL nav |
| Rate Limiting | 4/7 | ✅ Server-side, no UI detection |
| AI Integration | 0/4 | ❌ **NOT IMPLEMENTED** |
| CRM Integration | 0/5 | ❌ Not wired |
| Scheduler | 0/3 | ❌ Not wired |
| Twitter-Specific | 4/10 | ⚠️ Has unique features, many unbuilt |
| **TOTAL** | **36/104 (35%)** | |

---

## Next Steps (Priority Order)

1. ❌ **Add AI DM generation** — #1 gap, only platform without it
2. ❌ Wire CRM logging (Supabase) for all DM send/receive
3. ❌ Add message timestamp extraction
4. ❌ Wire scheduler for automated sessions
5. 🔲 Message requests handling
6. 🔲 User profile extraction
7. 🔲 DMs-disabled detection

---

**Last Updated:** February 6, 2026  
**Audited Against:** `packages/twitter-dm/src/` (TypeScript)
