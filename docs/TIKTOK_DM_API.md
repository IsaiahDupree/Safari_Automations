# TikTok DM API Documentation

**Last Updated:** January 31, 2026  
**API Port:** 3102 (default)  
**Status:** ✅ Verified Working

---

## Quick Start

### 1. Start the Server
```bash
cd packages/tiktok-dm
npx tsx src/api/server.ts
```

### 2. Verify API is Ready
```bash
npx tsx scripts/tiktok-verify.ts
```

### 3. Check Status
```bash
curl http://localhost:3102/health
curl http://localhost:3102/api/tiktok/status
```

---

## API Endpoints

### Health & Status

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | API health check |
| `/api/tiktok/status` | GET | TikTok login/page status |
| `/api/tiktok/error-check` | GET | Check for error page |
| `/api/tiktok/error-retry` | POST | Auto-retry if error detected |

### Navigation

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/tiktok/inbox/navigate` | POST | Navigate to messages inbox |

### Conversations

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/tiktok/conversations` | GET | List all conversations |
| `/api/tiktok/conversations/open` | POST | Open a conversation |
| `/api/tiktok/conversations/scroll` | POST | Scroll to load more |

### Messages

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/tiktok/messages` | GET | Read messages in current chat |
| `/api/tiktok/messages/send` | POST | Send message in current chat |
| `/api/tiktok/messages/send-to` | POST | Send DM by username |

### Rate Limits

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/tiktok/rate-limits` | GET | Get current rate limits |
| `/api/tiktok/rate-limits` | PUT | Update rate limits |

### Raw Script Execution

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/execute` | POST | Execute raw JavaScript |

---

## Endpoint Details

### GET /health
```bash
curl http://localhost:3102/health
```
**Response:**
```json
{"status": "ok", "platform": "tiktok", "port": 3102}
```

### GET /api/tiktok/status
```bash
curl http://localhost:3102/api/tiktok/status
```
**Response:**
```json
{
  "isOnTikTok": true,
  "isLoggedIn": true,
  "currentUrl": "https://www.tiktok.com/messages"
}
```

### GET /api/tiktok/error-check
```bash
curl http://localhost:3102/api/tiktok/error-check
```
**Response:**
```json
{"hasError": false}
```

### POST /api/tiktok/error-retry
```bash
curl -X POST http://localhost:3102/api/tiktok/error-retry
```
**Response:**
```json
{"retried": true, "hasError": false}
```

### POST /api/tiktok/inbox/navigate
```bash
curl -X POST http://localhost:3102/api/tiktok/inbox/navigate
```
**Response:**
```json
{"success": true, "currentUrl": "https://www.tiktok.com/messages"}
```

### GET /api/tiktok/conversations
```bash
curl http://localhost:3102/api/tiktok/conversations
```
**Response:**
```json
{
  "conversations": [
    {
      "username": "Sarah E Ashley | Travel & Life",
      "displayName": "Sarah E Ashley | Travel & Life",
      "lastMessage": "Test message",
      "timestamp": "22:38",
      "unread": false
    }
  ],
  "count": 96
}
```

### POST /api/tiktok/conversations/open
```bash
curl -X POST http://localhost:3102/api/tiktok/conversations/open \
  -H "Content-Type: application/json" \
  -d '{"username": "sarah"}'
```
**Response:**
```json
{"success": true, "currentUrl": "https://www.tiktok.com/messages"}
```

### GET /api/tiktok/messages
```bash
curl "http://localhost:3102/api/tiktok/messages?limit=10"
```
**Response:**
```json
{
  "messages": [
    {
      "content": "Test message",
      "sender": "them",
      "type": "text"
    }
  ],
  "count": 25
}
```

### POST /api/tiktok/messages/send-to
```bash
curl -X POST http://localhost:3102/api/tiktok/messages/send-to \
  -H "Content-Type: application/json" \
  -d '{"username": "saraheashley", "message": "Hello!"}'
```
**Response:**
```json
{"success": true}
```

### GET /api/tiktok/rate-limits
```bash
curl http://localhost:3102/api/tiktok/rate-limits
```
**Response:**
```json
{
  "limits": {
    "messagesPerHour": 10,
    "messagesPerDay": 50,
    "minDelayMs": 3000,
    "maxDelayMs": 8000,
    "activeHoursStart": 9,
    "activeHoursEnd": 21
  },
  "messagesSentToday": 1,
  "messagesSentThisHour": 1,
  "activeHours": {
    "start": 9,
    "end": 21,
    "isActive": true
  }
}
```

### POST /api/execute
```bash
curl -X POST http://localhost:3102/api/execute \
  -H "Content-Type: application/json" \
  -d '{"script": "document.title"}'
```
**Response:**
```json
{"output": "TikTok"}
```

---

## CLI Tools

### Discovery Script
```bash
# Full discovery
npx tsx scripts/tiktok-discover.ts all

# Specific commands
npx tsx scripts/tiktok-discover.ts e2e        # data-e2e selectors
npx tsx scripts/tiktok-discover.ts classes    # Class patterns
npx tsx scripts/tiktok-discover.ts convos     # Conversations
npx tsx scripts/tiktok-discover.ts messages   # Messages
npx tsx scripts/tiktok-discover.ts error      # Check for error
npx tsx scripts/tiktok-discover.ts scroll-convos  # Scroll list
npx tsx scripts/tiktok-discover.ts scroll-chat    # Scroll chat
```

### Verification Script
```bash
# Run all API tests
npx tsx scripts/tiktok-verify.ts
```

---

## Validated Selectors

### Conversation List
| Element | Selector |
|---------|----------|
| Item | `[data-e2e="chat-list-item"]` |
| Display Name | `[class*="PInfoNickname"]` |
| Last Message | `[class*="SpanInfoExtract"]` |
| Timestamp | `[class*="SpanInfoTime"]` |
| Avatar | `[class*="ImgAvatar"]` |

### Chat Messages
| Element | Selector |
|---------|----------|
| Message | `[data-e2e="chat-item"]` |
| Avatar | `[data-e2e="chat-avatar"]` |
| Text | `[class*="DivTextContainer"]` |
| Video | `[class*="DivVideoContainer"]` |
| Time | `[class*="DivTimeContainer"]` |

### Chat Header
| Element | Selector |
|---------|----------|
| Nickname | `[data-e2e="chat-nickname"]` |
| Username | `[data-e2e="chat-uniqueid"]` |
| Avatar | `[data-e2e="top-chat-avatar"] img` |

### Input
| Element | Selector |
|---------|----------|
| Input Area | `[data-e2e="message-input-area"]` |
| Contenteditable | `[contenteditable="true"]` |

---

## Error Handling

The API automatically detects and handles TikTok error pages:

**Detected Errors:**
- "Page not available"
- "Sorry about that"
- "Something went wrong"

**Auto-Retry:**
- Finds "Try again" button
- Clicks to reload
- Waits for page recovery

---

## Sending Messages

⚠️ **Important:** TikTok uses Draft.js for text input. JavaScript keyboard events don't work reliably.

**Recommended Approach:** Use native AppleScript keystrokes:
```bash
osascript -e 'tell application "Safari" to activate'
osascript -e 'tell application "System Events" to keystroke "Your message"'
osascript -e 'tell application "System Events" to keystroke return'
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3102 | API server port |
| `TIKTOK_DM_PORT` | 3102 | Alt port config |
| `VERBOSE` | false | Enable verbose logging |
| `CRM_RATE_MESSAGES_PER_HOUR` | 10 | Hourly message limit |
| `CRM_RATE_MESSAGES_PER_DAY` | 50 | Daily message limit |
| `CRM_ACTIVE_HOURS_START` | 9 | Active hours start |
| `CRM_ACTIVE_HOURS_END` | 21 | Active hours end |

---

## Integration Example

```typescript
import { TikTokDMClient } from '@safari-automation/tiktok-dm';

const client = new TikTokDMClient('http://localhost:3102');

// Check if ready
const status = await client.getStatus();
console.log('Logged in:', status.isLoggedIn);

// List conversations
const convos = await client.getConversations();
console.log('Conversations:', convos.length);

// Send DM
const result = await client.sendDMByUsername('username', 'Hello!');
console.log('Sent:', result.success);
```

---

## Files Reference

| File | Purpose |
|------|---------|
| `packages/tiktok-dm/` | Main TikTok DM package |
| `scripts/tiktok-verify.ts` | API verification tests |
| `scripts/tiktok-discover.ts` | Selector discovery CLI |
| `docs/selectors/TIKTOK_SELECTORS_REFERENCE.md` | Full selector docs |
| `docs/TIKTOK_DM_API.md` | This documentation |
