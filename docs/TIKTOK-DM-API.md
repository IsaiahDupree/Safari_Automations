# TikTok DM API

Safari-based TikTok DM automation. Controls the TikTok web app (`tiktok.com/messages`) via JavaScript injection and OS-level mouse/keyboard events through Safari on macOS.

**Port:** `3102`  
**Base URL:** `http://localhost:3102`  
**Package:** `packages/tiktok-dm/`

---

## Start the Server

```bash
PORT=3102 npx tsx packages/tiktok-dm/src/api/server.ts
```

Optional env vars:

```bash
OPENAI_API_KEY=sk-...          # enables AI DM generation
VERBOSE=true                   # verbose Safari driver logging
CRM_SUPABASE_URL=https://...   # enables CRM logging to Supabase
CRM_SUPABASE_ANON_KEY=...      # Supabase anon key
```

**Safari must be open and logged into TikTok** in the front tab before making any DM calls.

---

## Architecture Notes

TikTok's messages page uses **virtual DOM rendering** — most sidebar elements report `0×0` from `getBoundingClientRect()` and ignore JS `.click()`. The automation works around this with:

- **Quartz CGEvent native mouse clicks** (`clickAtViewportPosition`) for selecting conversations and clicking buttons
- **OS-level keystrokes** via `System Events` (`typeViaKeystrokes`) for typing — required for the Draft.js composer
- **Avatar image elements** (48×48px, x ≈ 60–130) as the only sidebar elements with real dimensions

### Send Strategy Chain (`sendDMByUsername`)

When you call `send-to`, the service tries three strategies in order:

| Strategy | How | When used |
|----------|-----|-----------|
| **A** Text-based row lookup | Find `DivItemWrapper` row containing the handle text → OS-click it | Existing conversation visible in inbox |
| **B** Search filter | Type handle in inbox search → OS-click first filtered row | Handle not visible but account has DMs open |
| **C** Compose new | Click NewMessage button → search → click UserCard | First-ever DM to this account |

After opening a conversation, **identity is verified** by checking the `DivChatHeader` for the target handle before sending. Post-send verification confirms the message snippet appears in the DOM.

---

## Endpoints

### Health & Status

#### `GET /health`
```bash
curl http://localhost:3102/health
```
```json
{ "status": "ok", "platform": "tiktok", "port": 3102 }
```

#### `GET /api/tiktok/status`
Returns whether Safari is on TikTok and logged in.
```bash
curl http://localhost:3102/api/tiktok/status
```
```json
{
  "isOnTikTok": true,
  "isLoggedIn": true,
  "currentUrl": "https://www.tiktok.com/messages"
}
```

#### `GET /api/tiktok/error-check`
Detects TikTok error pages ("Something went wrong", "Page not available").
```bash
curl http://localhost:3102/api/tiktok/error-check
```
```json
{ "hasError": false }
```

#### `POST /api/tiktok/error-retry`
Detects error page and clicks the "Try again" button automatically.
```bash
curl -X POST http://localhost:3102/api/tiktok/error-retry
```
```json
{ "retried": true, "hasError": false }
```

---

### Rate Limits

#### `GET /api/tiktok/rate-limits`
```bash
curl http://localhost:3102/api/tiktok/rate-limits
```
```json
{
  "limits": {
    "messagesPerHour": 10,
    "messagesPerDay": 50,
    "minDelayMs": 120000,
    "maxDelayMs": 300000,
    "activeHoursStart": 9,
    "activeHoursEnd": 21
  },
  "messagesSentToday": 3,
  "messagesSentThisHour": 1,
  "activeHours": {
    "start": 9,
    "end": 21,
    "isActive": true
  },
  "nextDelay": 145000
}
```

#### `PUT /api/tiktok/rate-limits`
Update limits at runtime. All fields optional.
```bash
curl -X PUT http://localhost:3102/api/tiktok/rate-limits \
  -H "Content-Type: application/json" \
  -d '{
    "messagesPerHour": 5,
    "messagesPerDay": 20,
    "activeHoursStart": 10,
    "activeHoursEnd": 18
  }'
```

---

### Inbox Navigation

#### `POST /api/tiktok/inbox/navigate`
Navigate Safari to `tiktok.com/messages`.
```bash
curl -X POST http://localhost:3102/api/tiktok/inbox/navigate
```
```json
{ "success": true, "currentUrl": "https://www.tiktok.com/messages" }
```

---

### Conversations

#### `GET /api/tiktok/conversations`
List conversations visible in the inbox.
```bash
curl http://localhost:3102/api/tiktok/conversations
```
```json
{
  "conversations": [
    {
      "username": "creatorname",
      "displayName": "Creator Name",
      "lastMessage": "Sounds great! Let's connect 🙌",
      "timestamp": "2h",
      "unread": false
    }
  ],
  "count": 12
}
```

#### `POST /api/tiktok/conversations/open`
Open an existing conversation by username.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `username` | string | ✅ | TikTok handle (with or without `@`) |

```bash
curl -X POST http://localhost:3102/api/tiktok/conversations/open \
  -H "Content-Type: application/json" \
  -d '{"username": "creatorname"}'
```
```json
{ "success": true, "currentUrl": "https://www.tiktok.com/messages" }
```

#### `POST /api/tiktok/conversations/new`
Start a new conversation by searching for a user in the inbox compose flow.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `username` | string | ✅ | TikTok handle |
| `message` | string | ✅ | Message to send |

```bash
curl -X POST http://localhost:3102/api/tiktok/conversations/new \
  -H "Content-Type: application/json" \
  -d '{"username": "creatorname", "message": "Hey! Love your content 🔥"}'
```
```json
{
  "success": true,
  "username": "creatorname",
  "rateLimits": { "hourly": 1, "daily": 1 }
}
```

#### `POST /api/tiktok/conversations/scroll`
Scroll the inbox list to load more conversations.
```bash
curl -X POST http://localhost:3102/api/tiktok/conversations/scroll
```
```json
{ "newCount": 8 }
```

---

### Messages

#### `GET /api/tiktok/messages?limit=50`
Read messages from the currently open conversation.

| Query Param | Default | Description |
|-------------|---------|-------------|
| `limit` | 50 | Max messages to return |

```bash
curl "http://localhost:3102/api/tiktok/messages?limit=20"
```
```json
{
  "messages": [
    { "content": "Hey!", "sender": "them", "type": "text" },
    { "content": "Thanks for reaching out 🙌", "sender": "me", "type": "text" }
  ],
  "count": 2
}
```

#### `POST /api/tiktok/messages/send`
Send a message in the **currently open** conversation. Use `open` first to select one.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `text` | string | ✅ | Message text (also accepts `message`) |

```bash
curl -X POST http://localhost:3102/api/tiktok/messages/send \
  -H "Content-Type: application/json" \
  -d '{"text": "Hey! Just wanted to connect 👋"}'
```
```json
{
  "success": true,
  "rateLimits": { "hourly": 1, "daily": 1 }
}
```

#### `POST /api/tiktok/messages/send-to` ⭐ Recommended
**Primary send endpoint.** Navigates to inbox, finds the user via the 3-strategy chain, verifies identity, sends, and confirms delivery.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `username` | string | ✅ | TikTok handle (with or without `@`) |
| `text` | string | ✅ | Message text (also accepts `message`) |

```bash
curl -X POST http://localhost:3102/api/tiktok/messages/send-to \
  -H "Content-Type: application/json" \
  -d '{"username": "creatorname", "text": "Hey! Love your content 🔥 Let'\''s collab!"}'
```
```json
{
  "success": true,
  "username": "creatorname",
  "verified": true,
  "verifiedRecipient": "Creator Name",
  "rateLimits": { "hourly": 1, "daily": 1 }
}
```

**Error responses:**
```json
{ "success": false, "error": "Outside active hours", "rateLimits": { ... } }   // 429
{ "success": false, "error": "No visible conversation rows after searching..." } // 400
```

#### `POST /api/tiktok/messages/send-to-url`
Send DM by TikTok profile URL instead of username.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `profileUrl` | string | ✅ | e.g. `https://www.tiktok.com/@creatorname` |
| `message` | string | ✅ | Message text |

```bash
curl -X POST http://localhost:3102/api/tiktok/messages/send-to-url \
  -H "Content-Type: application/json" \
  -d '{
    "profileUrl": "https://www.tiktok.com/@creatorname",
    "message": "Hey! Love your content 🔥"
  }'
```
```json
{
  "success": true,
  "username": "creatorname",
  "rateLimits": { "hourly": 1, "daily": 1 }
}
```

---

### AI DM Generation

#### `POST /api/tiktok/ai/generate`
Generate a short, casual TikTok DM via GPT-4o (max ~150 chars). Falls back to a template if `OPENAI_API_KEY` is not set.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `username` | string | ✅ | Recipient handle |
| `purpose` | string | — | e.g. `"collab"`, `"networking"`, `"shoutout"` |
| `topic` | string | — | e.g. `"AI automation"`, `"travel content"` |

```bash
curl -X POST http://localhost:3102/api/tiktok/ai/generate \
  -H "Content-Type: application/json" \
  -d '{"username": "creatorname", "purpose": "collab", "topic": "AI automation"}'
```
```json
{
  "success": true,
  "message": "Yo your AI content is 🔥 Would love to collab on something big! DM me?",
  "aiEnabled": true
}
```

**Combine with send-to:**
```bash
# 1. Generate
MSG=$(curl -s -X POST http://localhost:3102/api/tiktok/ai/generate \
  -H "Content-Type: application/json" \
  -d '{"username": "creatorname", "purpose": "collab"}' | jq -r '.message')

# 2. Send
curl -X POST http://localhost:3102/api/tiktok/messages/send-to \
  -H "Content-Type: application/json" \
  -d "{\"username\": \"creatorname\", \"text\": \"$MSG\"}"
```

---

### CRM

DM activity is automatically logged to Supabase (`dm_contacts` + `dm_messages` tables) when `CRM_SUPABASE_URL` and `CRM_SUPABASE_ANON_KEY` are set.

#### `GET /api/tiktok/crm/stats`
```bash
curl http://localhost:3102/api/tiktok/crm/stats
```
```json
{
  "success": true,
  "stats": {
    "totalContacts": 48,
    "messagesSentTotal": 112,
    "messagesToday": 3
  }
}
```

#### `POST /api/tiktok/crm/score`
Recalculate lead score for a single contact.

```bash
curl -X POST http://localhost:3102/api/tiktok/crm/score \
  -H "Content-Type: application/json" \
  -d '{"contactId": "uuid-here"}'
```

#### `POST /api/tiktok/crm/score-all`
Recalculate scores for all TikTok contacts.
```bash
curl -X POST http://localhost:3102/api/tiktok/crm/score-all
```

#### `GET /api/tiktok/crm/top-contacts?limit=10`
Get highest-scored contacts.
```bash
curl "http://localhost:3102/api/tiktok/crm/top-contacts?limit=5"
```

---

### Template Engine

The template engine manages multi-touch outreach sequences with a 3:1 value-to-pitch ratio.

#### `GET /api/tiktok/templates?lane=cold&stage=first_touch`
List templates, optionally filtered by `lane` and `stage`.
```bash
curl "http://localhost:3102/api/tiktok/templates?lane=cold"
```

#### `POST /api/tiktok/templates/next-action`
Get the recommended next message for a contact based on their pipeline stage.

```bash
curl -X POST http://localhost:3102/api/tiktok/templates/next-action \
  -H "Content-Type: application/json" \
  -d '{"username": "creatorname", "stage": "first_touch", "lane": "cold"}'
```

#### `POST /api/tiktok/templates/fit-signals`
Detect intent/fit signals in a message (e.g. buying signals, objections).
```bash
curl -X POST http://localhost:3102/api/tiktok/templates/fit-signals \
  -H "Content-Type: application/json" \
  -d '{"text": "Yeah I have been thinking about automating my outreach"}'
```

#### `GET /api/tiktok/templates/rule-check/:contactId`
Check 3:1 rule compliance for a contact (must send 3 value messages per pitch).
```bash
curl http://localhost:3102/api/tiktok/templates/rule-check/contact-uuid
```

---

### Outreach Queue

Batch outreach management — queue messages to be sent, mark them sent/failed.

#### `GET /api/tiktok/outreach/pending?limit=10`
```bash
curl "http://localhost:3102/api/tiktok/outreach/pending?limit=5"
```

#### `POST /api/tiktok/outreach/queue`
Queue an outreach action.

| Field | Type | Required |
|-------|------|----------|
| `contact_id` | string | ✅ |
| `message` | string | ✅ |

```bash
curl -X POST http://localhost:3102/api/tiktok/outreach/queue \
  -H "Content-Type: application/json" \
  -d '{"contact_id": "uuid-here", "message": "Hey! Love your content 🔥"}'
```

#### `POST /api/tiktok/outreach/:actionId/sent`
Mark a queued action as sent.
```bash
curl -X POST http://localhost:3102/api/tiktok/outreach/action-uuid/sent
```

#### `POST /api/tiktok/outreach/:actionId/failed`
Mark a queued action as failed.
```bash
curl -X POST http://localhost:3102/api/tiktok/outreach/action-uuid/failed \
  -H "Content-Type: application/json" \
  -d '{"error": "User not found in inbox"}'
```

#### `GET /api/tiktok/outreach/stats`
```bash
curl http://localhost:3102/api/tiktok/outreach/stats
```

---

### Advanced

#### `POST /api/execute`
Execute raw JavaScript in the current Safari tab (debug/advanced use).

```bash
curl -X POST http://localhost:3102/api/execute \
  -H "Content-Type: application/json" \
  -d '{"script": "document.title"}'
```
```json
{ "output": "TikTok - Make Your Day" }
```

---

## Default Rate Limits

| Limit | Default | Override |
|-------|---------|----------|
| Messages per hour | 10 | `CRM_RATE_MESSAGES_PER_HOUR` |
| Messages per day | 50 | `CRM_RATE_MESSAGES_PER_DAY` |
| Min delay between messages | 2 min | `CRM_RATE_MIN_DELAY_MS` |
| Max delay between messages | 5 min | `CRM_RATE_MAX_DELAY_MS` |
| Active hours start | 9am | `CRM_ACTIVE_HOURS_START` |
| Active hours end | 9pm | `CRM_ACTIVE_HOURS_END` |

Requests to send endpoints outside active hours return **HTTP 429**.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `"isLoggedIn": false` | Safari not logged into TikTok | Open Safari, go to tiktok.com, log in manually |
| `"Could not find message input"` | Conversation not open | Call `conversations/open` or `conversations/new` first |
| `"No visible conversation rows after searching"` | User has DMs disabled or handle is wrong | Check handle spelling; DMs may be restricted on their account |
| `"Outside active hours"` (429) | Request outside 9am–9pm window | Update limits via `PUT /api/tiktok/rate-limits` or wait for active hours |
| `verified: false` on send | Message sent but not confirmed in DOM | Usually still sent — TikTok may render slowly; retry or check manually |
| Strategy A/B both fail | User not in inbox and search fails | TikTok DMs may be restricted for new accounts; try profile Message button flow |
| OS-level click misses target | Safari window moved or resized | Ensure Safari is the front window and not partially off-screen |
