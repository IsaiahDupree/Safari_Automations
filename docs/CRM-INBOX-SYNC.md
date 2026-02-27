# CRM Inbox Sync

How to pull all conversation and message data from every platform into the Supabase CRM (`dm_contacts` + `dm_messages` tables).

## Platform Ports

| Platform | Port | Prefix |
|----------|------|--------|
| Instagram DM | `3100` | `/api/` |
| Twitter DM | `3003` | `/api/twitter/` |
| TikTok DM | `3102` | `/api/tiktok/` |
| LinkedIn | `3105` | `/api/linkedin/` |

---

## Supabase CRM Tables

### `dm_contacts`
| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `platform` | text | `instagram` / `tiktok` / `twitter` |
| `platform_username` | text | Handle |
| `pipeline_stage` | text | `first_touch`, `nurture`, `pitched`, `converted` |
| `relationship_score` | int | 0–100 composite score |
| `total_messages_sent` | int | Outbound count |
| `total_messages_received` | int | Inbound count |
| `first_touch_at` | timestamptz | First DM timestamp |
| `last_message_at` | timestamptz | Most recent message |

### `dm_messages`
| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `contact_id` | uuid | FK → `dm_contacts.id` |
| `platform` | text | Platform name |
| `platform_username` | text | Handle (denormalized) |
| `message_text` | text | Message content |
| `message_type` | text | `text`, `image`, `video` |
| `is_outbound` | bool | `true` = sent by us |
| `sent_by_automation` | bool | Auto-logged |
| `ai_generated` | bool | GPT-generated message |
| `metadata` | jsonb | Extra context |
| `created_at` | timestamptz | Log timestamp |

> **Note:** Messages are auto-logged to Supabase on every `send-to` call when `CRM_SUPABASE_URL` + `CRM_SUPABASE_ANON_KEY` env vars are set. The sync steps below are for **pulling inbound messages** and **reading inbox state** into the CRM.

---

## Step 1 — Pull Conversations From Each Platform

Each platform exposes a conversations list endpoint. Run these to get all visible inbox conversations:

### Instagram (`3100`)
```bash
# Navigate to inbox first (required — Safari must be on Instagram)
curl -s -X POST http://localhost:3100/api/session/ensure
curl -s -X POST http://localhost:3100/api/inbox/navigate

# Get all conversations across all inbox tabs (Primary, General, Requests)
curl -s http://localhost:3100/api/conversations/all
```
```json
{
  "conversations": {
    "primary": [
      { "username": "creatorname", "displayName": "Creator Name", "lastMessage": "Thanks!", "unread": false }
    ],
    "general": [ ... ],
    "requests": [ ... ]
  },
  "totalCount": 47
}
```

### Twitter (`3003`)
```bash
curl -s -X POST http://localhost:3003/api/twitter/inbox/navigate
curl -s http://localhost:3003/api/twitter/conversations/all
```
```json
{
  "conversations": {
    "primary": [ ... ],
    "requests": [ ... ]
  },
  "totalCount": 22
}
```

### TikTok (`3102`)
```bash
curl -s -X POST http://localhost:3102/api/tiktok/inbox/navigate
curl -s http://localhost:3102/api/tiktok/conversations
```
```json
{
  "conversations": [
    { "username": "creatorname", "displayName": "Creator Name", "lastMessage": "Love it!", "unread": true }
  ],
  "count": 15
}
```

### LinkedIn (`3105`)
```bash
curl -s -X POST http://localhost:3105/api/linkedin/navigate/messaging
curl -s http://localhost:3105/api/linkedin/conversations
```
```json
{
  "conversations": [
    { "participantName": "John Doe", "lastMessage": "Let's connect", "unread": 1 }
  ],
  "count": 8
}
```

---

## Step 2 — Read Messages From a Conversation

Open a specific conversation, then read its messages:

### Instagram
```bash
curl -s -X POST http://localhost:3100/api/conversations/open \
  -H "Content-Type: application/json" \
  --data-raw '{"username": "creatorname"}'

curl -s "http://localhost:3100/api/messages?limit=50"
```

### Twitter
```bash
curl -s -X POST http://localhost:3003/api/twitter/conversations/open \
  -H "Content-Type: application/json" \
  --data-raw '{"username": "creatorname"}'

curl -s "http://localhost:3003/api/twitter/messages?limit=50"
```

### TikTok
```bash
curl -s -X POST http://localhost:3102/api/tiktok/conversations/open \
  -H "Content-Type: application/json" \
  --data-raw '{"username": "creatorname"}'

curl -s "http://localhost:3102/api/tiktok/messages?limit=50"
```

### LinkedIn
```bash
curl -s -X POST http://localhost:3105/api/linkedin/messages/open \
  -H "Content-Type: application/json" \
  --data-raw '{"participantName": "John Doe"}'

curl -s "http://localhost:3105/api/linkedin/messages?limit=50"
```

**Response shape (all platforms):**
```json
{
  "messages": [
    { "content": "Hey! Love your work", "sender": "them", "type": "text" },
    { "content": "Thanks! Let's connect", "sender": "me", "type": "text" }
  ],
  "count": 2
}
```

---

## Step 3 — Pull CRM Stats Per Platform

Check what's already logged in Supabase:

```bash
# Instagram
curl -s http://localhost:3100/api/crm/stats

# Twitter
curl -s http://localhost:3003/api/twitter/crm/stats

# TikTok
curl -s http://localhost:3102/api/tiktok/crm/stats
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

---

## Step 4 — Get Top Contacts by Relationship Score

```bash
# Instagram top 10
curl -s "http://localhost:3100/api/crm/top-contacts?limit=10"

# Twitter top 10
curl -s "http://localhost:3003/api/twitter/crm/top-contacts?limit=10"

# TikTok top 10
curl -s "http://localhost:3102/api/tiktok/crm/top-contacts?limit=10"
```
```json
{
  "success": true,
  "contacts": [
    {
      "id": "uuid",
      "username": "creatorname",
      "score": 87,
      "lastMessage": "2026-02-26T19:00:00Z",
      "messagesSent": 5
    }
  ]
}
```

**Score tiers:**
| Score | Tier | Meaning |
|-------|------|---------|
| 80–100 | 🌟 Strong | Active, engaged, high priority |
| 60–79 | 📈 Growing | Good momentum, nurture |
| 40–59 | 📊 Building | Early stage, keep warming |
| 20–39 | 🌱 New | First touch, just started |
| 0–19 | ❄️ Cold | No recent activity |

Score = 30% recency + 35% resonance (inbound message depth) + 35% activity (total message count).

---

## Step 5 — Recalculate Scores After Sync

After pulling new messages, refresh scores to reflect new data:

```bash
# Recalculate all contacts per platform
curl -s -X POST http://localhost:3100/api/crm/score-all     # Instagram
curl -s -X POST http://localhost:3003/api/twitter/crm/score-all  # Twitter
curl -s -X POST http://localhost:3102/api/tiktok/crm/score-all   # TikTok
```
```json
{ "success": true, "updated": 48, "errors": 0 }
```

Or recalculate a single contact:
```bash
curl -s -X POST http://localhost:3102/api/tiktok/crm/score \
  -H "Content-Type: application/json" \
  --data-raw '{"contactId": "uuid-here"}'
```

---

## Full Sync Script

Copy-paste shell script to pull all inbox state from all platforms and refresh CRM scores:

```bash
#!/bin/bash
set -e

echo "=== Safari Automation CRM Full Sync ==="

for svc in "instagram:3100" "twitter:3003" "tiktok:3102"; do
  platform="${svc%%:*}"
  port="${svc##*:}"
  echo ""
  echo "--- $platform (port $port) ---"

  # Health check
  health=$(curl -sf http://localhost:$port/health 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status','?'))" 2>/dev/null || echo "DOWN")
  if [ "$health" != "ok" ]; then
    echo "  ⚠️  Service DOWN — skipping"
    continue
  fi

  # Pull conversations
  if [ "$platform" = "instagram" ]; then
    curl -sf -X POST http://localhost:$port/api/session/ensure > /dev/null
    curl -sf -X POST http://localhost:$port/api/inbox/navigate > /dev/null
    COUNT=$(curl -sf http://localhost:$port/api/conversations/all | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('totalCount',0))" 2>/dev/null || echo 0)
  elif [ "$platform" = "twitter" ]; then
    curl -sf -X POST http://localhost:$port/api/twitter/inbox/navigate > /dev/null
    COUNT=$(curl -sf http://localhost:$port/api/twitter/conversations/all | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('totalCount',0))" 2>/dev/null || echo 0)
  else
    curl -sf -X POST http://localhost:$port/api/tiktok/inbox/navigate > /dev/null
    COUNT=$(curl -sf http://localhost:$port/api/tiktok/conversations | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('count',0))" 2>/dev/null || echo 0)
  fi
  echo "  Conversations visible: $COUNT"

  # CRM stats
  if [ "$platform" = "instagram" ]; then
    STATS=$(curl -sf http://localhost:$port/api/crm/stats)
  else
    STATS=$(curl -sf http://localhost:$port/api/$platform/crm/stats)
  fi
  echo "  CRM stats: $STATS"

  # Recalculate scores
  if [ "$platform" = "instagram" ]; then
    curl -sf -X POST http://localhost:$port/api/crm/score-all > /dev/null
  else
    curl -sf -X POST http://localhost:$port/api/$platform/crm/score-all > /dev/null
  fi
  echo "  ✅ Scores refreshed"
done

echo ""
echo "=== Sync complete ==="
```

---

## Unread-Only Sync (Twitter)

Twitter exposes an unread conversations endpoint — useful for faster incremental syncs:

```bash
curl -s http://localhost:3003/api/twitter/conversations/unread
```
```json
{
  "conversations": [
    { "username": "newlead", "lastMessage": "Hey I saw your post...", "unread": true }
  ],
  "count": 3
}
```

---

## LinkedIn Notes

LinkedIn doesn't have a `crm/stats` endpoint like the other platforms. Use the messaging endpoints directly:

```bash
# Unread count
curl -s http://localhost:3105/api/linkedin/messages/unread
# → { "unreadCount": 4 }

# Full conversation list (navigates Safari to linkedin.com/messaging)
curl -s http://localhost:3105/api/linkedin/conversations

# Read messages from current open conversation
curl -s "http://localhost:3105/api/linkedin/messages?limit=50"
```

LinkedIn contacts are managed separately via profile extraction rather than the `dm_contacts` Supabase table.

---

## Env Vars Required for CRM Logging

All platforms read these on startup. Set them before starting each service:

```bash
export SUPABASE_URL=https://your-project.supabase.co
export SUPABASE_ANON_KEY=eyJ...
# OR the CRM-prefixed versions:
export CRM_SUPABASE_URL=https://your-project.supabase.co
export CRM_SUPABASE_ANON_KEY=eyJ...
```

If not set, the service logs `[DM Logger] ⚠️ No Supabase credentials - CRM logging disabled` and all `crm/*` endpoints return `null` stats.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `stats: null` from CRM endpoints | `SUPABASE_URL` / `SUPABASE_ANON_KEY` not set |
| `conversations: []` or `count: 0` | Safari not on the platform or inbox not loaded — call `inbox/navigate` first |
| Instagram returns 401 on `/api/conversations` | Session not active — call `POST /api/session/ensure` first |
| Scores not updating | Supabase credentials missing or `dm_contacts` table doesn't exist — check Supabase dashboard |
| LinkedIn conversations empty | LinkedIn messaging page takes time to load — add a manual delay or retry |
