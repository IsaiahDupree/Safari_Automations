# Cloud → Safari Controller

Daemon that polls Supabase for pending commands and executes them via local Safari Automation services.  
Script: `scripts/safari_cloud_controller.py`

---

## Architecture

```
Cloud (Supabase)                    Local Machine
───────────────                     ─────────────
safari_command_queue  ──poll──►  safari_cloud_controller.py
  { action, platform,               │
    params, status }     ◄──update─┘
                                     │
                            ┌────────┼────────┐
                            ▼        ▼        ▼
                          :3003    :3102    :3106
                         TW DM   TT DM   Market
                          ...    Research  ...
```

**Flow:**
1. Any client (cloud dashboard, Supabase UI, external app) inserts a row into `safari_command_queue`
2. Daemon polls the table every 30 seconds
3. Claims pending commands (sets `status = processing`)
4. Dispatches to the correct local service
5. Writes result JSON + sets `status = completed` or `failed`

---

## CLI

```bash
# Poll indefinitely (every 30s)
python3 scripts/safari_cloud_controller.py --daemon

# Execute all pending commands once, then exit
python3 scripts/safari_cloud_controller.py --run-once

# Show queue state (pending / processing / completed / failed)
python3 scripts/safari_cloud_controller.py --status

# Verify tables exist in Supabase
python3 scripts/safari_cloud_controller.py --create-table
```

---

## Supported Actions

| Action | Params | Dispatches To |
|---|---|---|
| `navigate` | `{url}` | `osascript` (Safari front tab) |
| `send_dm` | `{username, text}` | Platform DM service |
| `comment` | `{postUrl, text}` | Platform comment service |
| `market_research` | `{keyword, maxPosts}` | `:3106/api/research/{platform}/search` |
| `sync` | — | `crm_brain.py --sync` |
| `score` | `{limit?}` | `crm_brain.py --score` |
| `generate` | — | `crm_brain.py --generate` |
| `pipeline` | — | `crm_brain.py --pipeline` |

---

## `safari_command_queue` Schema

```sql
CREATE TABLE safari_command_queue (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  action      TEXT NOT NULL,        -- navigate | send_dm | comment | ...
  platform    TEXT,                 -- instagram | twitter | tiktok | linkedin | threads
  params      JSONB,                -- action-specific payload
  priority    INTEGER DEFAULT 5,    -- lower = higher priority
  status      TEXT DEFAULT 'pending', -- pending | processing | completed | failed
  result      JSONB,                -- service response after execution
  error       TEXT,                 -- error message if failed
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);
```

---

## Command Examples

### Navigate Safari to a profile
```json
{
  "action":   "navigate",
  "platform": "instagram",
  "params":   { "url": "https://www.instagram.com/saraheashley_/" },
  "priority": 1,
  "status":   "pending"
}
```

### Send a DM via cloud trigger
```json
{
  "action":   "send_dm",
  "platform": "twitter",
  "params":   { "username": "saraheashley", "text": "Hey! Loved your content." },
  "priority": 2,
  "status":   "pending"
}
```

### Run market research
```json
{
  "action":   "market_research",
  "platform": "twitter",
  "params":   { "keyword": "AI copywriting", "maxPosts": 10 },
  "priority": 3,
  "status":   "pending"
}
```

---

## Platform → Service Port Routing

| Platform | Action | Port | Path |
|---|---|---|---|
| instagram | send_dm | 3001 | `/api/messages/send-to` |
| twitter | send_dm | 3003 | `/api/twitter/messages/send-to` |
| tiktok | send_dm | 3102 | `/api/tiktok/messages/send-to` |
| linkedin | send_dm | 3105 | `/api/linkedin/messages/send-to` |
| instagram | comment | 3005 | `/api/instagram/comments/post` |
| twitter | comment | 3007 | `/api/twitter/comments/post` |
| tiktok | comment | 3006 | `/api/tiktok/comments/post` |
| threads | comment | 3004 | `/api/threads/comments/post` |
| any | market_research | 3106 | `/api/research/{platform}/search` |

> **Key fix**: `send_dm` payload must use `text` (not `message`) for all platforms. Market research body uses `query` (not `keyword`) with a `config` object.

---

## Verified Results

| Command | Result |
|---|---|
| `send_dm` twitter → @saraheashley | `success:true, verified:true` ✅ |
| `navigate` to Instagram profile | osascript navigated ✅ |
| `market_research` twitter | posts returned ✅ |
| `sync` (crm_brain) | 520 contacts synced ✅ |

---

## Running as Background Daemon

```bash
# Start daemon (logs to stdout)
nohup python3 scripts/safari_cloud_controller.py --daemon > /tmp/cloud-controller.log 2>&1 &

# Check logs
tail -f /tmp/cloud-controller.log

# Stop
kill $(pgrep -f safari_cloud_controller)
```

The daemon requires:
- All Safari Automation services running (`bash scripts/start-services.sh`)
- `SUPABASE_URL` and `SUPABASE_ANON_KEY` in environment
- Safari open and logged into target platforms
