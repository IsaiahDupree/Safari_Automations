# CRM Sync API — Read All Chats Across Platforms

Pull conversation lists, message history, and CRM contact scores from all three DM services and sync to your CRM.

**Services must be running:**
```bash
PORT=3001 npx tsx packages/instagram-dm/src/api/server.ts &
PORT=3003 npx tsx packages/twitter-dm/src/api/server.ts &
PORT=3102 npx tsx packages/tiktok-dm/src/api/server.ts &
```

---

## Platform Summary

| Platform  | Base URL                    | Conversations                         | Messages                       | CRM Stats                     |
|-----------|-----------------------------|---------------------------------------|--------------------------------|-------------------------------|
| Instagram | `http://localhost:3001`     | `GET /api/conversations`              | `GET /api/messages`            | `GET /api/crm/stats`          |
| Twitter   | `http://localhost:3003`     | `GET /api/twitter/conversations`      | `GET /api/twitter/messages`    | `GET /api/twitter/crm/stats`  |
| TikTok    | `http://localhost:3102`     | `GET /api/tiktok/conversations`       | `GET /api/tiktok/messages`     | `GET /api/tiktok/crm/stats`   |

---

## Step 1 — List All Conversations

### Instagram
```bash
curl http://localhost:3001/api/conversations
```
```json
{
  "conversations": [
    { "username": "saraheashley", "lastMessage": "Hey Sarah!", "timestamp": "2026-02-26T20:00:00Z", "unread": false }
  ],
  "count": 42
}
```

### Instagram (all tabs — Primary, General, Requests)
```bash
curl http://localhost:3001/api/conversations/all
```
```json
{
  "conversations": {
    "primary": [ { "username": "saraheashley", "lastMessage": "...", "unread": false } ],
    "general":  [ { "username": "brandaccount", "lastMessage": "...", "unread": true  } ],
    "requests": [ { "username": "newuser123",   "lastMessage": "...", "unread": true  } ]
  },
  "totalCount": 87
}
```

### Twitter
```bash
curl http://localhost:3003/api/twitter/conversations
```
```json
{
  "conversations": [
    { "username": "saraheashley", "displayName": "Sarah E. Ashley", "lastMessage": "...", "unread": false }
  ],
  "count": 18
}
```

### Twitter (unread only)
```bash
curl http://localhost:3003/api/twitter/conversations/unread
```
```json
{
  "conversations": [ { "username": "newlead99", "lastMessage": "Interested!", "unread": true } ],
  "count": 3
}
```

### TikTok
```bash
curl http://localhost:3102/api/tiktok/conversations
```
```json
{
  "conversations": [
    { "username": "saraheashley", "displayName": "Sarah E Ashley | Travel & Life", "lastMessage": "You shared a video", "timestamp": "17:51" }
  ],
  "count": 14
}
```

### TikTok — load more (scroll to fetch older conversations)
```bash
curl -X POST http://localhost:3102/api/tiktok/conversations/scroll
```
```json
{ "newCount": 6 }
```

---

## Step 2 — Open a Conversation + Read Messages

Open a specific conversation, then read its messages. This is the pattern for reading per-contact history.

### Instagram
```bash
# Open conversation
curl -X POST http://localhost:3001/api/conversations/open \
  -H "Content-Type: application/json" \
  -d '{"username": "saraheashley"}'

# Read last 50 messages
curl "http://localhost:3001/api/messages?limit=50"
```

### Twitter
```bash
# Open conversation
curl -X POST http://localhost:3003/api/twitter/conversations/open \
  -H "Content-Type: application/json" \
  -d '{"username": "saraheashley"}'

# Scroll to load older messages (optional)
curl -X POST http://localhost:3003/api/twitter/conversations/scroll \
  -H "Content-Type: application/json" \
  -d '{"scrollCount": 5}'

# Read messages
curl "http://localhost:3003/api/twitter/messages?limit=50"
```

### TikTok
```bash
# Open conversation
curl -X POST http://localhost:3102/api/tiktok/conversations/open \
  -H "Content-Type: application/json" \
  -d '{"username": "saraheashley"}'

# Read messages
curl "http://localhost:3102/api/tiktok/messages?limit=50"
```

**Message object shape (all platforms):**
```json
{
  "id": "msg_001",
  "sender": "saraheashley",
  "text": "Hey! Thanks for reaching out",
  "timestamp": "2026-02-26T20:15:00Z",
  "isOutbound": false
}
```

---

## Step 3 — Pull CRM Scores & Top Contacts

Each service has its own built-in CRM layer backed by Supabase (when configured).

### Get CRM stats (message counts, engagement rates)

```bash
# Instagram
curl http://localhost:3001/api/crm/stats

# Twitter
curl http://localhost:3003/api/twitter/crm/stats

# TikTok
curl http://localhost:3102/api/tiktok/crm/stats
```
```json
{
  "success": true,
  "stats": {
    "platform": "instagram",
    "totalContacts": 42,
    "totalMessagesSent": 127,
    "totalRepliesReceived": 38,
    "replyRate": 0.30,
    "avgEngagementScore": 4.2
  }
}
```

### Get top contacts by engagement score

```bash
# Instagram — top 20
curl "http://localhost:3001/api/crm/top-contacts?limit=20"

# Twitter — top 10
curl "http://localhost:3003/api/twitter/crm/top-contacts?limit=10"

# TikTok — top 10
curl "http://localhost:3102/api/tiktok/crm/top-contacts?limit=10"
```
```json
{
  "success": true,
  "contacts": [
    {
      "id": "contact_abc123",
      "username": "saraheashley",
      "platform": "instagram",
      "messagesSent": 3,
      "repliesReceived": 2,
      "engagementScore": 8.5,
      "lastContactedAt": "2026-02-26T20:00:00Z",
      "stage": "warm"
    }
  ]
}
```

### Recalculate scores

```bash
# Score a single contact
curl -X POST http://localhost:3001/api/crm/score \
  -H "Content-Type: application/json" \
  -d '{"contactId": "contact_abc123"}'

# Score all contacts on the platform
curl -X POST http://localhost:3001/api/crm/score-all
curl -X POST http://localhost:3003/api/twitter/crm/score-all
curl -X POST http://localhost:3102/api/tiktok/crm/score-all
```

---

## Full CRM Sync Script (Python)

Pulls all conversations + messages from all three platforms and outputs a unified JSON payload ready to push to any CRM.

```python
#!/usr/bin/env python3
"""
crm_sync.py — Pull all inbox data from IG/TW/TT and build unified CRM contact records.
"""
import json, time, urllib.request, urllib.error
from datetime import datetime

SERVICES = {
    "instagram": {
        "base": "http://localhost:3001",
        "conversations": "/api/conversations/all",
        "open":          "/api/conversations/open",
        "messages":      "/api/messages",
        "top_contacts":  "/api/crm/top-contacts",
        "stats":         "/api/crm/stats",
    },
    "twitter": {
        "base": "http://localhost:3003",
        "conversations": "/api/twitter/conversations",
        "open":          "/api/twitter/conversations/open",
        "messages":      "/api/twitter/messages",
        "top_contacts":  "/api/twitter/crm/top-contacts",
        "stats":         "/api/twitter/crm/stats",
    },
    "tiktok": {
        "base": "http://localhost:3102",
        "conversations": "/api/tiktok/conversations",
        "open":          "/api/tiktok/conversations/open",
        "messages":      "/api/tiktok/messages",
        "top_contacts":  "/api/tiktok/crm/top-contacts",
        "stats":         "/api/tiktok/crm/stats",
    },
}

def get(url, timeout=30):
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return json.loads(r.read())
    except Exception as e:
        return {"_error": str(e)[:80]}

def post(url, body, timeout=30):
    data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read())
    except Exception as e:
        return {"_error": str(e)[:80]}

def sync_platform(platform, cfg, message_limit=20):
    base = cfg["base"]
    print(f"\n[{platform}] Fetching conversations...")

    # 1. List conversations
    convs_raw = get(f"{base}{cfg['conversations']}")
    if "_error" in convs_raw:
        print(f"  ⚠️  Could not reach {platform}: {convs_raw['_error']}")
        return []

    # Normalize: instagram /all returns nested dict, others return flat list
    if isinstance(convs_raw.get("conversations"), dict):
        flat = []
        for tab_convs in convs_raw["conversations"].values():
            flat.extend(tab_convs)
        conversations = flat
    else:
        conversations = convs_raw.get("conversations", [])

    print(f"  Found {len(conversations)} conversations")

    # 2. Pull top contacts (scored)
    top = get(f"{base}{cfg['top_contacts']}?limit=100")
    top_map = {c["username"]: c for c in top.get("contacts", [])}

    # 3. Pull stats
    stats = get(f"{base}{cfg['stats']}")

    # 4. Build contact records
    contacts = []
    for conv in conversations:
        username = conv.get("username") or conv.get("handle") or ""
        if not username:
            continue

        # Open conversation + read messages
        open_result = post(f"{base}{cfg['open']}", {"username": username})
        time.sleep(0.5)
        msgs_raw = get(f"{base}{cfg['messages']}?limit={message_limit}")
        messages = msgs_raw.get("messages", [])

        crm_data = top_map.get(username, {})

        contacts.append({
            "platform":          platform,
            "username":          username,
            "displayName":       conv.get("displayName", username),
            "lastMessage":       conv.get("lastMessage", ""),
            "lastMessageAt":     conv.get("timestamp", ""),
            "unread":            conv.get("unread", False),
            "messages":          messages,
            "messageCount":      len(messages),
            "engagementScore":   crm_data.get("engagementScore"),
            "stage":             crm_data.get("stage"),
            "messagesSent":      crm_data.get("messagesSent"),
            "repliesReceived":   crm_data.get("repliesReceived"),
            "lastContactedAt":   crm_data.get("lastContactedAt"),
            "syncedAt":          datetime.utcnow().isoformat() + "Z",
        })

    print(f"  ✅ {len(contacts)} contacts synced from {platform}")
    return contacts


def run_full_sync(message_limit=20):
    all_contacts = []
    for platform, cfg in SERVICES.items():
        contacts = sync_platform(platform, cfg, message_limit)
        all_contacts.extend(contacts)

    output = {
        "syncedAt":     datetime.utcnow().isoformat() + "Z",
        "totalContacts": len(all_contacts),
        "contacts":     all_contacts,
    }

    with open("crm_sync_output.json", "w") as f:
        json.dump(output, f, indent=2)

    print(f"\n{'='*50}")
    print(f"✅ CRM sync complete: {len(all_contacts)} total contacts")
    print(f"   Output: crm_sync_output.json")
    return output


if __name__ == "__main__":
    run_full_sync(message_limit=20)
```

Run it:
```bash
python3 crm_sync.py
# → writes crm_sync_output.json
```

---

## Push to External CRM

The output JSON is flat enough to POST directly to most CRM APIs. Examples:

### Supabase (upsert)
```python
import httpx, os

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]

def upsert_to_supabase(contacts):
    rows = [
        {
            "platform":        c["platform"],
            "username":        c["username"],
            "display_name":    c["displayName"],
            "last_message":    c["lastMessage"],
            "unread":          c["unread"],
            "engagement_score":c["engagementScore"],
            "stage":           c["stage"],
            "messages_sent":   c["messagesSent"],
            "replies_received":c["repliesReceived"],
            "last_contacted_at":c["lastContactedAt"],
            "synced_at":       c["syncedAt"],
        }
        for c in contacts
    ]
    r = httpx.post(
        f"{SUPABASE_URL}/rest/v1/crm_contacts",
        headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Prefer": "resolution=merge-duplicates",
        },
        json=rows,
    )
    r.raise_for_status()
    return r.json()
```

Required Supabase table:
```sql
CREATE TABLE crm_contacts (
  id               uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  platform         text NOT NULL,
  username         text NOT NULL,
  display_name     text,
  last_message     text,
  unread           boolean DEFAULT false,
  engagement_score float,
  stage            text,
  messages_sent    int,
  replies_received int,
  last_contacted_at timestamptz,
  synced_at        timestamptz,
  UNIQUE (platform, username)
);
```

### Airtable
```python
import httpx, os

def upsert_to_airtable(contacts, base_id, table_name):
    headers = {
        "Authorization": f"Bearer {os.environ['AIRTABLE_API_KEY']}",
        "Content-Type": "application/json",
    }
    records = [{"fields": {
        "Platform": c["platform"],
        "Username": c["username"],
        "Display Name": c["displayName"],
        "Last Message": c["lastMessage"],
        "Engagement Score": c["engagementScore"] or 0,
        "Stage": c["stage"] or "cold",
        "Messages Sent": c["messagesSent"] or 0,
        "Replies Received": c["repliesReceived"] or 0,
        "Synced At": c["syncedAt"],
    }} for c in contacts]

    # Airtable max 10 records per request
    for i in range(0, len(records), 10):
        httpx.patch(
            f"https://api.airtable.com/v0/{base_id}/{table_name}",
            headers=headers,
            json={"records": records[i:i+10], "performUpsert": {"fieldsToMergeOn": ["Platform", "Username"]}},
        ).raise_for_status()
```

---

## Automating the Sync

### Cron (every hour)
```bash
# crontab -e
0 * * * * cd /path/to/safari-automation && python3 crm_sync.py >> /tmp/crm_sync.log 2>&1
```

### One-liner health check before sync
```bash
for port in 3001 3003 3102; do
  curl -sf http://localhost:$port/health | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'port $port: {d[\"status\"]}')" || echo "port $port: DOWN"
done
```

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `requireActiveSession` 401 | Safari not on platform / not logged in | Navigate Safari to the platform manually |
| `conversations: []` | Inbox not loaded yet | Wait 5s and retry, or call `/api/inbox/navigate` first |
| Messages empty after open | SPA transition not complete | Add `time.sleep(2)` after open call |
| TikTok `listConversations` slow | Virtual DOM pagination | Call `/api/tiktok/conversations/scroll` first to load more rows |
| CRM stats all zeros | Supabase not configured | Set `CRM_SUPABASE_URL` + `CRM_SUPABASE_ANON_KEY` env vars |
