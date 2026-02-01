# TikTok DM Commands Reference

**Last Updated:** January 31, 2026  
**Status:** ✅ All Commands Verified Working

---

## Chat Types

TikTok has two distinct types of conversations:

| Type | Location | Has Input | Selectors |
|------|----------|-----------|-----------|
| **REGULAR_DM** | Main conversation list | ✅ Yes | `message-input-area` present |
| **MESSAGE_REQUEST** | "Message requests" section | ❌ No (until accepted) | `StrangerBox` present |

### How to Detect Type
```javascript
(function(){
  var strangerBox = document.querySelector('[class*="StrangerBox"]');
  var input = document.querySelector('[data-e2e="message-input-area"]');
  return strangerBox ? 'MESSAGE_REQUEST' : input ? 'REGULAR_DM' : 'UNKNOWN';
})()
```

### Verified REGULAR_DM Examples
- MELOMATIC (@officialmelomatic)
- EDM / Dubstep Producer (@hitmarkerrj)
- y2kchrome (@y2kchrome)
- Sarah E Ashley (@saraheashley)

### MESSAGE_REQUEST Examples
Located in the "Message requests" section (click `[class*="DivRequestGroup"]`):
- FernVale - "Yo buddy! Stay amazing always 😊"
- Spam accounts with crypto scam messages

---

## Quick Start

```bash
# Start API server
npx tsx packages/tiktok-dm/src/api/server.ts

# Verify everything works
npx tsx scripts/tiktok-verify.ts
```

---

## CLI Scripts

### 1. Verification Script
```bash
npx tsx scripts/tiktok-verify.ts
```
Runs 9 tests: health, status, error detection, rate limits, navigation, conversations, messages, script execution.

### 2. Selector Discovery
```bash
npx tsx scripts/tiktok-discover.ts all        # Full discovery
npx tsx scripts/tiktok-discover.ts e2e        # data-e2e selectors
npx tsx scripts/tiktok-discover.ts classes    # Class patterns
npx tsx scripts/tiktok-discover.ts convos     # Conversation list
npx tsx scripts/tiktok-discover.ts messages   # Chat messages
npx tsx scripts/tiktok-discover.ts error      # Check for errors
npx tsx scripts/tiktok-discover.ts scroll-convos  # Scroll list
npx tsx scripts/tiktok-discover.ts scroll-chat    # Scroll chat
```

### 3. Chat Extraction
```bash
npx tsx scripts/tiktok-chat-extract.ts              # Current chat
npx tsx scripts/tiktok-chat-extract.ts sarah        # Open & extract
npx tsx scripts/tiktok-chat-extract.ts --list       # List all convos
npx tsx scripts/tiktok-chat-extract.ts --discover   # Discover selectors
npx tsx scripts/tiktok-chat-extract.ts --scroll     # Scroll for more
```

### 4. Message Requests
```bash
npx tsx scripts/tiktok-message-requests.ts list          # List requests
npx tsx scripts/tiktok-message-requests.ts open <name>   # Open request
npx tsx scripts/tiktok-message-requests.ts read          # Read current
npx tsx scripts/tiktok-message-requests.ts accept        # Accept request
npx tsx scripts/tiktok-message-requests.ts delete        # Delete request
npx tsx scripts/tiktok-message-requests.ts messages      # Extract messages
```

### 5. Chat Categorization
```bash
npx tsx scripts/tiktok-categorize-chats.ts              # Categorize first 20
npx tsx scripts/tiktok-categorize-chats.ts 50           # Categorize first 50
```
Scans conversations and categorizes as REGULAR_DM or MESSAGE_REQUEST.

---

## API Endpoints

### Health & Status
```bash
# Health check
curl http://localhost:3102/health

# TikTok status
curl http://localhost:3102/api/tiktok/status

# Error detection
curl http://localhost:3102/api/tiktok/error-check

# Auto-retry errors
curl -X POST http://localhost:3102/api/tiktok/error-retry
```

### Navigation
```bash
# Navigate to inbox
curl -X POST http://localhost:3102/api/tiktok/inbox/navigate
```

### Conversations
```bash
# List all conversations
curl http://localhost:3102/api/tiktok/conversations

# Open conversation
curl -X POST http://localhost:3102/api/tiktok/conversations/open \
  -H "Content-Type: application/json" \
  -d '{"username": "sarah"}'

# Scroll to load more
curl -X POST http://localhost:3102/api/tiktok/conversations/scroll
```

### Messages
```bash
# Read messages
curl "http://localhost:3102/api/tiktok/messages?limit=20"

# Send message (current chat)
curl -X POST http://localhost:3102/api/tiktok/messages/send \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello!"}'

# Send DM by username
curl -X POST http://localhost:3102/api/tiktok/messages/send-to \
  -H "Content-Type: application/json" \
  -d '{"username": "creator123", "message": "Hello!"}'
```

### Rate Limits
```bash
# Get rate limits
curl http://localhost:3102/api/tiktok/rate-limits

# Update rate limits
curl -X PUT http://localhost:3102/api/tiktok/rate-limits \
  -H "Content-Type: application/json" \
  -d '{"messagesPerHour": 15}'
```

### Raw Script Execution
```bash
# Execute JavaScript
curl -X POST http://localhost:3102/api/execute \
  -H "Content-Type: application/json" \
  -d '{"script": "document.title"}'
```

---

## JavaScript Injection Scripts

### Navigate to Message Requests
```javascript
(function(){
  var requestGroup = document.querySelector('[class*="RequestGroup"]');
  if (requestGroup) { requestGroup.click(); return 'clicked'; }
  return 'not_found';
})()
```

### List Conversations
```javascript
(function(){
  var items = document.querySelectorAll('[data-e2e="chat-list-item"]');
  var convos = [];
  items.forEach(function(item) {
    var nickname = item.querySelector('[class*="PInfoNickname"]');
    var extract = item.querySelector('[class*="SpanInfoExtract"]');
    var time = item.querySelector('[class*="SpanInfoTime"]');
    convos.push({
      displayName: nickname ? nickname.innerText.trim() : 'Unknown',
      lastMessage: extract ? extract.innerText.trim() : '',
      timestamp: time ? time.innerText.trim() : ''
    });
  });
  return JSON.stringify(convos);
})()
```

### Open Conversation by Name
```javascript
(function(){
  var items = document.querySelectorAll('[data-e2e="chat-list-item"]');
  for (var i = 0; i < items.length; i++) {
    if (items[i].innerText.toLowerCase().includes('TARGET_NAME')) {
      items[i].click();
      return 'clicked';
    }
  }
  return 'not_found';
})()
```

### Extract Messages
```javascript
(function(){
  var msgs = document.querySelectorAll('[data-e2e="chat-item"]');
  var results = [];
  msgs.forEach(function(m) {
    var link = m.querySelector('a[href*="@"]');
    var sender = link ? link.href.match(/@([^/]+)/)?.[1] : 'unknown';
    var textEl = m.querySelector('[class*="TextContainer"]');
    results.push({
      sender: sender,
      content: textEl ? textEl.innerText.trim() : m.innerText.substring(0, 100)
    });
  });
  return JSON.stringify(results);
})()
```

### Accept Message Request
```javascript
(function(){
  var strangerBox = document.querySelector('[class*="StrangerBox"]');
  if (!strangerBox) return 'not_a_request';
  var buttons = strangerBox.querySelectorAll('div[role="button"]');
  if (buttons[1]) { buttons[1].click(); return 'accepted'; }
  return 'button_not_found';
})()
```

### Delete Message Request
```javascript
(function(){
  var strangerBox = document.querySelector('[class*="StrangerBox"]');
  if (!strangerBox) return 'not_a_request';
  var buttons = strangerBox.querySelectorAll('div[role="button"]');
  if (buttons[0]) { buttons[0].click(); return 'deleted'; }
  return 'button_not_found';
})()
```

### Check for Error Page
```javascript
(function(){
  var bodyText = document.body.innerText || '';
  var hasError = bodyText.includes('Page not available') || 
                 bodyText.includes('Sorry about that') ||
                 bodyText.includes('Something went wrong');
  if (hasError) {
    var buttons = document.querySelectorAll('button');
    for (var i = 0; i < buttons.length; i++) {
      if (buttons[i].innerText.toLowerCase().includes('try again')) {
        buttons[i].click();
        return 'retried';
      }
    }
    return 'error_no_button';
  }
  return 'no_error';
})()
```

### Send Message (Focus Input)
```javascript
(function(){
  var input = document.querySelector('[data-e2e="message-input-area"]');
  if (!input) input = document.querySelector('[contenteditable="true"]');
  if (input) {
    input.focus();
    input.click();
    return 'focused';
  }
  return 'no_input';
})()
```

---

## Selectors Reference

### Conversation List
| Element | Selector |
|---------|----------|
| Item | `[data-e2e="chat-list-item"]` |
| Display Name | `[class*="PInfoNickname"]` |
| Last Message | `[class*="SpanInfoExtract"]` |
| Timestamp | `[class*="SpanInfoTime"]` |
| Avatar | `[class*="ImgAvatar"]` |
| More Actions | `[data-e2e="more-action-icon"]` |

### Chat Messages
| Element | Selector |
|---------|----------|
| Message | `[data-e2e="chat-item"]` |
| Avatar | `[data-e2e="chat-avatar"]` |
| Text | `[class*="DivTextContainer"]` |
| Video | `[class*="DivVideoContainer"]` |
| Time | `[class*="DivTimeContainer"]` |
| Sender Link | `a[href*="@"]` |

### Chat Header
| Element | Selector |
|---------|----------|
| Nickname | `[data-e2e="chat-nickname"]` |
| Username | `[data-e2e="chat-uniqueid"]` |
| Avatar | `[data-e2e="top-chat-avatar"] img` |

### Message Input
| Element | Selector |
|---------|----------|
| Input Area | `[data-e2e="message-input-area"]` |
| Contenteditable | `[contenteditable="true"]` |
| Emoji Button | `[class*="DivEmojiButton"]` |

### Message Requests
| Element | Selector |
|---------|----------|
| Requests Section | `[class*="DivRequestGroup"]` |
| Stranger Box | `[class*="DivStrangerBox"]` |
| Delete Button | `div[role="button"]:first-child` in StrangerBox |
| Accept Button | `div[role="button"]:last-child` in StrangerBox |

---

## Native Keyboard Input (for sending messages)

TikTok uses Draft.js which doesn't respond to JavaScript keyboard events. Use AppleScript:

```bash
# Type and send message
osascript -e 'tell application "Safari" to activate' \
          -e 'tell application "System Events" to keystroke "Your message here"' \
          -e 'tell application "System Events" to keystroke return'
```

---

## Files Reference

| File | Purpose |
|------|---------|
| `scripts/tiktok-verify.ts` | API verification tests |
| `scripts/tiktok-discover.ts` | Selector discovery CLI |
| `scripts/tiktok-chat-extract.ts` | Chat extraction tool |
| `scripts/tiktok-message-requests.ts` | Message requests management |
| `packages/tiktok-dm/` | Main TikTok DM package |
| `docs/TIKTOK_DM_API.md` | API documentation |
| `docs/TIKTOK_COMMANDS_REFERENCE.md` | This file |
| `docs/selectors/TIKTOK_SELECTORS_REFERENCE.md` | Full selector docs |
