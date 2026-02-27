# CRM Deep Sync — Click Into Every Chat on Every Platform

Opens every visible conversation on every platform, reads all messages, and upserts everything into Supabase (`crm_contacts` + `crm_messages` tables).

## The Script

**`scripts/crm_sync.py`** — single Python file, no extra dependencies beyond stdlib + urllib.

```
scripts/crm_sync.py
```

---

## Quick Start

```bash
# Dry run first — see what it would sync without writing to Supabase
python3 scripts/crm_sync.py --dry-run

# Normal sync — all 4 platforms (Instagram, Twitter, TikTok, LinkedIn)
python3 scripts/crm_sync.py

# One platform only
python3 scripts/crm_sync.py instagram
python3 scripts/crm_sync.py twitter
python3 scripts/crm_sync.py tiktok
python3 scripts/crm_sync.py linkedin

# Deep sync — scroll inbox 8 times, read 100 messages per chat
python3 scripts/crm_sync.py --deep

# Custom depth
python3 scripts/crm_sync.py --messages=50 --scroll=5

# Dry run on one platform
python3 scripts/crm_sync.py tiktok --dry-run
```

---

## What It Does Per Platform

For each platform the script:

1. **Navigates Safari** to the inbox URL (finds the matching tab by domain, doesn't open a new one)
2. **Scrolls the conversation list** N times to trigger lazy-load and expose all chats
3. **Scrapes conversation rows** from the DOM via osascript (bypasses stale API data)
4. **For each conversation:**
   - Calls `POST .../conversations/open` (or `/messages/open` for LinkedIn) to open it in Safari
   - Calls `GET .../messages?limit=N` to read messages from the now-open chat
   - Upserts contact + messages to Supabase

### Platform Details

| Platform | Port | Inbox URL | Conversation Selector | Open Endpoint |
|----------|------|-----------|----------------------|---------------|
| Instagram | 3100 | `instagram.com/direct/inbox/` | `div[role=listitem]` | `POST /api/conversations/open` |
| Twitter | 3003 | `x.com/messages` | `[data-testid=conversation]` | `POST /api/twitter/conversations/open` |
| TikTok | 3102 | `tiktok.com/messages` | `[class*=LiInboxItemWrapper]` | `POST /api/tiktok/conversations/open` |
| LinkedIn | 3105 | `linkedin.com/messaging/` | `.msg-conversation-listitem` | `POST /api/linkedin/messages/open` |

---

## Supabase Output Tables

### `crm_contacts` — one row per person per platform

| Column | Example |
|--------|---------|
| `platform` | `tiktok` |
| `username` | `saraheashley` |
| `display_name` | `Sarah E Ashley` |
| `last_message` | `Hey love your content!` |
| `last_message_at` | `2026-02-26T19:00:00Z` |
| `unread` | `false` |
| `engagement_score` | `87.0` |
| `stage` | `nurture` |
| `messages_sent` | `3` |
| `replies_received` | `2` |
| `reply_rate` | `0.66` |
| `synced_at` | `2026-02-26T21:00:00Z` |

Conflict key: `(platform, username)` — rows are upserted, not duplicated.

### `crm_messages` — one row per message

| Column | Example |
|--------|---------|
| `platform` | `tiktok` |
| `username` | `saraheashley` |
| `sender` | `me` / `saraheashley` |
| `text` | `Hey! Your travel content...` |
| `is_outbound` | `true` |
| `message_id` | `abc123` (or MD5 hash if no ID) |
| `timestamp_str` | `2026-02-26T19:00:00Z` |
| `synced_at` | `2026-02-26T21:00:00Z` |

Conflict key: `(platform, username, message_id)` — deduplicates on re-sync.

---

## Prerequisites

### 1. Services Running

Each platform's service must be running:

```bash
# Start only what you need
PORT=3100 npx tsx packages/instagram-dm/src/api/server.ts &
PORT=3003 npx tsx packages/twitter-dm/src/api/server.ts &
PORT=3102 npx tsx packages/tiktok-dm/src/api/server.ts &
PORT=3105 npx tsx packages/linkedin-automation/src/api/server.ts &
```

Or check which are already up:
```bash
curl -s http://localhost:3100/health && echo " IG ok"
curl -s http://localhost:3003/health && echo " TW ok"
curl -s http://localhost:3102/health && echo " TT ok"
curl -s http://localhost:3105/health && echo " LI ok"
```

### 2. Safari Logged In

Each platform must have an active logged-in tab in Safari. The script finds tabs by domain — it won't open new tabs or log you in.

### 3. Supabase Tables Exist

The script writes to `crm_contacts` and `crm_messages`. These need to exist in your Supabase project. Minimal SQL to create them:

```sql
create table if not exists crm_contacts (
  id              uuid primary key default gen_random_uuid(),
  platform        text not null,
  username        text not null,
  display_name    text,
  last_message    text,
  last_message_at text,
  unread          boolean default false,
  engagement_score float default 0,
  stage           text default 'cold',
  messages_sent   int default 0,
  replies_received int default 0,
  reply_rate      float default 0,
  synced_at       timestamptz,
  unique (platform, username)
);

create table if not exists crm_messages (
  id           uuid primary key default gen_random_uuid(),
  platform     text not null,
  username     text not null,
  sender       text,
  text         text,
  is_outbound  boolean default false,
  message_id   text,
  timestamp_str text,
  synced_at    timestamptz,
  unique (platform, username, message_id)
);
```

### 4. Env Vars (Optional)

If set, these override the hardcoded Supabase credentials:
```bash
export SUPABASE_URL=https://your-project.supabase.co
export SUPABASE_SERVICE_KEY=eyJ...   # or SUPABASE_ANON_KEY
```

---

## Scroll Depth Guide

Conversation lists are lazy-loaded — without scrolling you only see the top ~20 chats.

| Flag | Scroll Rounds | Messages/Chat | Use Case |
|------|--------------|---------------|----------|
| *(default)* | 3 | 20 | Daily incremental sync |
| `--scroll=5` | 5 | 20 | More chats, same message depth |
| `--messages=50` | 3 | 50 | Deeper message history |
| `--deep` | 8 | 100 | Full historical pull |

---

## Output

After a run you'll see:
```
============================================================
CRM SYNC — 2026-02-26 21:00 UTC
Platforms: instagram, twitter, tiktok, linkedin
Supabase:  https://ivhfuhxorppptyuofbgq.supabase.co
Dry run:   False
============================================================

[INSTAGRAM] checking service...
  ✅ Service up — navigating Safari to instagram inbox...
  🔄 Scrolling to load more conversations (3 rounds)...
  Found 47 conversations via DOM scrape
  📦 47 contacts, 312 messages to upsert
  ✅ crm_contacts: 47 rows upserted
  ✅ crm_messages: 312 rows upserted

[TWITTER] checking service...
  ✅ Service up — navigating Safari to twitter inbox...
  ...

[TIKTOK] ...
[LINKEDIN] ...

============================================================
✅ SYNC COMPLETE
   Total contacts: 134
   Total messages: 891
   Supabase table: crm_contacts / crm_messages
   Local backup:   /tmp/crm_sync_output.json
============================================================
```

A local JSON backup is always written to `/tmp/crm_sync_output.json`.

---

## Scheduling

To run this automatically, add to the Safari Task Scheduler (port 3010):

```bash
# Schedule a daily sync at 6am
curl -s -X POST http://localhost:3010/api/schedule \
  -H "Content-Type: application/json" \
  --data-raw '{
    "name": "CRM Deep Sync",
    "command": "python3 /Users/isaiahdupree/Documents/Software/Safari\\ Automation/scripts/crm_sync.py",
    "schedule": "0 6 * * *",
    "platform": "all"
  }'
```

Or add to crontab:
```bash
crontab -e
# Add:
0 6 * * * cd "/Users/isaiahdupree/Documents/Software/Safari Automation" && python3 scripts/crm_sync.py >> /tmp/crm_sync.log 2>&1
```

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `Service down — skipping instagram` | Start the service: `PORT=3100 npx tsx packages/instagram-dm/src/api/server.ts &` |
| `Found 0 conversations` | Safari isn't on the inbox page or isn't logged in — navigate manually first |
| `crm_contacts upsert error: HTTP 409` | Table missing unique constraint on `(platform, username)` — run the SQL above |
| TikTok shows 0 conversations | TikTok virtual DOM: try `--scroll=5` to trigger lazy-load, or open messages tab manually |
| LinkedIn shows 0 conversations | LinkedIn session may be expired — visit `linkedin.com/messaging` and re-login |
| Messages come back empty | Conversation `open` endpoint timed out — increase wait in script or re-run single platform |
| Duplicate messages in Supabase | Missing `unique (platform, username, message_id)` constraint — add it and messages will dedup on next run |

---

## Related Scripts

| Script | Purpose |
|--------|---------|
| `scripts/crm_sync.py` | **This script** — all platforms, click every chat |
| `scripts/sync-instagram-dm-to-crm.ts` | Instagram-only deep sync with tab support |
| `scripts/relationship-scoring-engine.ts` | Recalculate relationship scores after sync |
| `docs/CRM-INBOX-SYNC.md` | API-level reference for individual platform endpoints |
