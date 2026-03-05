# Safari Automation — Platform Architecture Reference

> **Status as of 2026-03-04**
> Instagram is the fully built reference implementation.
> Twitter, LinkedIn, TikTok, Threads have REST services + MCP tools but are missing the
> daemon layer, cloud dispatch, prospect discovery, and goal-driven scheduling.

---

## Layer Map

Every platform needs 6 layers to be fully operational. Instagram has all 6. Others have layers 1–2 only.

```
Layer 6 ── Goal-Driven Scheduler  (safari_schedule_planner.py)
              reads business-goals.json + Supabase metrics
              creates Google Calendar events for the week
              ↓
Layer 5 ── Calendar Bridge  (gcal_safari_bridge.py + heartbeat_agent.py)
              polls calendar every 30min
              fires events into safari_command_queue
              ↓
Layer 4 ── Cloud Queue  (safari_command_queue — Supabase)
              platform-tagged rows: pending → completed
              ↓
Layer 3 ── Local Daemon  ({platform}-daemon — ~/bin/)
              polls queue every 10s
              also handles terminal IPC via /tmp/{platform}_inbox/
              ↓
Layer 2 ── REST Service  (packages/{platform}-dm — localhost:PORT)
              Safari navigation, scraping, sending
              ↓
Layer 1 ── MCP Tools  (mcp-server.ts in each package)
              Claude Code callable via ~/.claude/settings.json
```

---

## Instagram — Reference Implementation (COMPLETE ✅)

### What it can do right now

| Action | Trigger | Result stored |
|--------|---------|---------------|
| `discover_prospects` | Calendar / terminal / cloud | Scored ICP candidate list |
| `conversations` | Calendar / terminal / cloud | DM thread list in memory |
| `enrich` | Terminal / cloud | Profile data (bio, followers, posts) |
| `dm` | Terminal / cloud (approval gate) | DM sent, logged in safari_command_queue |
| `sync` | Calendar / terminal / cloud | CRMLite updated with full inbox |
| `scrape` | Calendar / cloud | Post metrics in actp_feedback_posts |
| `pipeline` | Cloud | Full 7-step: navigate → inbox → sync → score → queue |
| `comment_sweep` | Terminal / cloud | Commenters scored, flagged for DM |
| `score_prospect` | MCP tool | ICP score 0-100 + signals |

### Data it collects and where it goes

```
Safari scrapes:
  Instagram profile page  →  fullName, bio, followers, following, posts, isPrivate
  DM inbox               →  conversation list, last message, unread count
  DM thread              →  message history with timestamps
  Post page              →  likes, comments, views, saves, caption
  Hashtag page           →  post authors (usernames)
  Followers feed         →  recent follower usernames

Where data lands:
  crm_contacts           →  CRMLite (upserted per username)
  crm_message_history    →  CRMLite (every DM thread synced)
  actp_feedback_posts    →  post metrics for content analysis
  safari_command_queue   →  action log (pending → completed + result)
  suggested_actions      →  outreach queue (pending DMs to send)
  Google Calendar        →  result appended back to event description
```

### What's still missing from Instagram

- `suggested_actions` Supabase table not created (outreach queue returns 404)
- Active hours guard commented out — re-enable after testing
- Warm-up sequence (comment → 24h wait → DM) not built
- Follow-up re-engagement after no reply not built
- Calendly/booking link injection in DM templates
- Tests (integration test suite exists but needs expansion)

### Service topology

```
Port 3100 — instagram-dm      (DM, profile, inbox, outreach, prospect discovery)
Port 3005 — instagram-comments (post metrics, comment read/write, hashtag search)
~/bin/ig-daemon               (local IPC + cloud queue poller)
~/bin/ig-request              (terminal CLI: dm, sync, discover, score, pipeline)
```

### Supported `safari_command_queue` actions

```
status              → returns service health + session info
conversations       → scrapes DM inbox, returns thread list
enrich              → enriches one username, returns profile
dm                  → sends DM (params: username, text)
sync                → full inbox → CRMLite sync
scrape              → post metrics scrape
pipeline            → 7-step full pipeline
discover_prospects  → ICP prospect discovery (params: keywords, maxCandidates, minScore)
comment_sweep       → sweep comments on post URL (params: post_url)
```

---

## What Each Other Platform Needs

### Shared pattern to implement

For each platform (Twitter, LinkedIn, TikTok, Threads), the missing layers are identical:

**Layer 3 — Daemon** (`~/bin/{platform}-daemon`):
```bash
# Core structure mirrors ig-daemon exactly:
PLATFORM="twitter"              # change per platform
PORT=3003                       # change per platform
SERVER="http://localhost:$PORT"
INBOX_DIR="/tmp/${PLATFORM}_inbox"
OUTBOX_DIR="/tmp/${PLATFORM}_outbox"

# Same IPC loop, same Supabase poll, same action handler pattern
# Only the handle_* functions differ (call platform-specific endpoints)
```

**Layer 4 — Cloud routing**: Add platform to `poll_supabase_queue` filter in each daemon.
The `safari_command_queue` table already has a `platform` column — just filter on it.

**Layer 5 — Calendar bridge** (`gcal_safari_bridge.py`):
Currently dispatches all actions to `instagram` platform. Needs a platform field in calendar event:
```
safari_action: discover_prospects
safari_platform: twitter
safari_params: {"keywords": ["buildinpublic"]}
```

**Layer 6 — Goal planner** (`safari_schedule_planner.py`):
Currently only tracks Instagram metrics. Needs per-platform gap tracking.

---

## Twitter — Implementation Spec

**Port:** 3003 | **Daemon:** `~/bin/twitter-daemon`

### What the service already has (Layer 1–2)

REST routes (30+):
- `GET  /api/twitter/conversations` — inbox
- `POST /api/twitter/messages/send-to` — send DM
- `GET  /api/twitter/conversations/search` — search threads
- `GET  /api/twitter/messages` — read thread
- `POST /api/twitter/conversations/new` — start conversation
- `POST /api/twitter/compose_tweet` — post tweet
- `POST /api/twitter/like_tweet` — like
- `POST /api/twitter/retweet` — retweet
- `GET  /api/twitter/profile/:username` — profile
- `GET  /api/twitter/timeline` — timeline scrape

MCP tools (24): `twitter_send_dm`, `twitter_get_conversations`, `twitter_get_profile`,
`twitter_compose_tweet`, `twitter_like_tweet`, `twitter_retweet`, `twitter_search`,
`twitter_ai_generate_dm`, `twitter_crm_get_contact`, `twitter_is_ready`, and 14 more

### What needs to be built (Layer 3–6)

**Actions to support in twitter-daemon:**

```
status              → GET /api/twitter/status
conversations       → GET /api/twitter/conversations
enrich              → GET /api/twitter/profile/:username
dm                  → POST /api/twitter/messages/send-to {username, text}
sync                → GET /api/twitter/conversations → CRMLite
tweet               → POST /api/twitter/compose_tweet {text}
like                → POST /api/twitter/like_tweet {tweet_url}
reply               → POST /api/twitter/messages/send-to (reply context)
discover_prospects  → search by keyword → enrich → ICP score
comment_sweep       → search tweet replies → score commenters
```

**Prospect discovery for Twitter:**
- Source 1: `GET /api/twitter/timeline` — ICP-relevant tweets from followed accounts
- Source 2: `POST /api/twitter/search` with keywords → post authors
- Source 3: New followers (need `/api/twitter/activity/followers` route — not yet built)
- Scoring: same ICP_KEYWORDS as Instagram, +bio:operator, +twitter_analytics signals

**ICP signals unique to Twitter:**
- Follower/following ratio (< 5 = not spam)
- Tweet frequency (> 5 tweets/week = active)
- Retweet ratio (< 40% = original content creator)
- List memberships (> 3 = recognized in niche)

**File to create:** `packages/twitter-dm/src/api/prospect-discovery.ts`
(copy from instagram-dm, swap API endpoints)

**Calendar event platform tag:**
```
safari_action: discover_prospects
safari_platform: twitter
safari_params: {"keywords": ["buildinpublic", "indiedev", "saasfounder"]}
```

**Goal metrics to track:**
- Twitter followers (target: 5,000 from business-goals.json)
- Tweets per day (target: 3)
- DM reply rate (target > 15%)

---

## LinkedIn — Implementation Spec

**Port:** 3105 | **Daemon:** `~/bin/linkedin-daemon`

> ⚠️ LinkedIn has strict automation detection. All actions must include 2-5s delays.
> Use `POST /api/linkedin/navigate/via-google` for profile visits (avoids direct LinkedIn nav).

### What the service already has (Layer 1–2)

REST routes (30+):
- `POST /api/linkedin/search/people` — keyword + filter search
- `GET  /api/linkedin/profile/:username` — profile extract
- `POST /api/linkedin/profile/score` — score against ICP
- `POST /api/linkedin/connections/request` — send connection
- `GET  /api/linkedin/connections/pending` — pending requests
- `POST /api/linkedin/connections/accept` — accept connection
- `GET  /api/linkedin/conversations` — message threads
- `POST /api/linkedin/messages/send` — send message
- `POST /api/linkedin/navigate/profile` — navigate to profile
- `GET  /api/linkedin/messages/unread` — unread messages

MCP tools (20+): `linkedin_search_people`, `linkedin_get_profile`, `linkedin_send_connection`,
`linkedin_accept_connection`, `linkedin_send_message`, `linkedin_get_conversations`,
`linkedin_get_messages`, and more

### What needs to be built (Layer 3–6)

**Actions to support in linkedin-daemon:**

```
status              → GET /health
conversations       → GET /api/linkedin/conversations
enrich              → GET /api/linkedin/profile/:username
connect             → POST /api/linkedin/connections/request {username, note}
dm                  → POST /api/linkedin/messages/send {username, text}
sync                → GET /api/linkedin/conversations → CRMLite
search              → POST /api/linkedin/search/people {keywords, filters}
discover_prospects  → search → enrich → ICP score
accept_connections  → GET pending → POST accept (batch)
```

**Prospect discovery for LinkedIn:**
- Source 1: `POST /api/linkedin/search/people` with ICP keywords
- Source 2: Connection requests received (people who connected first = warm lead)
- Source 3: Profile viewers (LinkedIn shows who viewed — high intent signal)
- No hashtag equivalent — use job title + company size filters instead

**ICP signals unique to LinkedIn:**
- Job title contains: founder, CEO, CTO, VP, director, owner, head of
- Company size: 2-50 employees (startup/SMB range)
- Industry: software, SaaS, technology, marketing, digital
- Connection degree: 2nd degree (warm enough to connect, not already connected)
- Activity: posts in last 30 days (not dormant)

**Important LinkedIn-specific rules:**
- Max 20 connection requests/day (LinkedIn limit)
- Add 3-5s delay between profile visits
- Never navigate directly to linkedin.com/in/ — use Google or search results
- Use `waitForSelector` non-throwing (selector-health check first)
- Connection note max 300 chars — keep it personal and short
- Replace `networkidle2` with `domcontentloaded` to avoid timeouts

**File to create:** `packages/linkedin-automation/src/api/prospect-discovery.ts`

**Goal metrics to track:**
- Connections sent per week (target: 20/day = 100/week)
- Acceptance rate (target > 30%)
- Message reply rate (target > 20%)

---

## TikTok — Implementation Spec

**Port:** 3102 (DM) + 3006 (Comments) | **Daemon:** `~/bin/tiktok-daemon`

### What the service already has (Layer 1–2)

DM service (3102) REST routes:
- `GET  /api/tiktok/conversations` — inbox
- `POST /api/tiktok/messages/send-to` — send DM
- `GET  /api/tiktok/profile/:username` — profile
- `GET  /api/tiktok/messages` — read thread
- `POST /api/tiktok/post/comment` — post comment
- `GET  /api/tiktok/trending` — trending videos

Comments service (3006) REST routes:
- `GET  /health`
- Comment read/write, video metrics, AI generation

MCP tools (18): `tiktok_send_dm`, `tiktok_get_conversations`, `tiktok_get_profile`,
`tiktok_get_trending`, `tiktok_post_comment`, `tiktok_get_comments`, `tiktok_video_metrics`,
`tiktok_search`, `tiktok_ai_generate_dm`, `tiktok_is_ready`, and more

### What needs to be built (Layer 3–6)

**Actions to support in tiktok-daemon:**

```
status              → GET /health
conversations       → GET /api/tiktok/conversations
enrich              → GET /api/tiktok/profile/:username
dm                  → POST /api/tiktok/messages/send-to {username, text}
sync                → GET /api/tiktok/conversations → CRMLite
comment             → POST /api/tiktok/post/comment {video_url, text}
discover_prospects  → trending videos → video authors → ICP score
comment_sweep       → get video comments → score commenters
```

**Prospect discovery for TikTok:**
- Source 1: `GET /api/tiktok/trending` with niche keywords → video creators
- Source 2: Recent video comments on your own content (engaged users = warm)
- Source 3: Followers who comment frequently (power engagers)

**ICP signals unique to TikTok:**
- Creator (has > 10 own videos, not just repost account)
- Niche match in bio (automation, AI, SaaS, business, creator)
- Follower count 1K-500K (TikTok range — broader than Instagram)
- Video engagement rate > 5% (active engaged audience)

**TikTok-specific constraints:**
- DMs only available after mutual follow in some regions
- Comment character limit: 150 chars
- Rate limits stricter than Instagram — add 5-10s delays

---

## Threads — Implementation Spec

**Port:** 3004 | **Daemon:** `~/bin/threads-daemon`

> Threads is tied to Instagram — same login, same account.
> The ig-daemon can potentially handle some Threads actions by switching tabs.

### What the service already has (Layer 1–2)

REST routes (20+):
- Comment posting, profile extraction, thread search, AI generation

MCP tools (8): `threads_navigate`, `threads_post_comment`, `threads_get_comments`,
`threads_search`, `threads_like`, `threads_get_status`, `threads_get_profile`, `threads_ai_comment`

### What needs to be built (Layer 3–6)

**Actions to support in threads-daemon:**

```
status              → GET /health
navigate            → POST navigate to URL
comment             → POST comment on thread
search              → POST search by keyword
like                → POST like a thread
enrich              → GET profile
discover_prospects  → search keywords → post authors → ICP score
```

**Note on Threads:** Since Threads is Meta/Instagram, use the same Safari tab with a Threads URL.
The ig-daemon could be extended to handle Threads actions instead of a separate daemon.
Add `threads_*` action cases to ig-daemon rather than building a separate daemon.

---

## Implementing a New Platform Daemon — Template

Copy this structure for each new daemon (`~/bin/{platform}-daemon`):

```bash
#!/bin/zsh
# {PLATFORM}-daemon — Local IPC + Cloud Safari Automation Daemon
# Mirrors ig-daemon exactly. Change: PLATFORM, PORT, SERVER, handle_* functions.

PLATFORM="{platform}"           # twitter | linkedin | tiktok | threads
PORT={PORT}                     # 3003 | 3105 | 3102 | 3004
SERVER="http://localhost:$PORT"
INBOX_DIR="/tmp/${PLATFORM}_inbox"
OUTBOX_DIR="/tmp/${PLATFORM}_outbox"
LOG_FILE="/tmp/${PLATFORM}-daemon.log"
PID_FILE="/tmp/${PLATFORM}_daemon.pid"

# ─── Supabase ────────────────────────────────────────────────────────────────
SUPABASE_URL="${SUPABASE_URL}"
SUPABASE_KEY="${SUPABASE_SERVICE_ROLE_KEY}"

# ─── IPC + Cloud ─────────────────────────────────────────────────────────────
# Copy process_request, poll_supabase_queue, main loop from ig-daemon verbatim.
# Only change: platform filter in poll_supabase_queue query.
# Only change: handle_* functions to call the correct REST endpoints.

# ─── Action handlers (platform-specific) ─────────────────────────────────────

handle_status() {
  curl -s --max-time 10 "$SERVER/health"
}

handle_conversations() {
  curl -s --max-time 30 "$SERVER/api/{platform}/conversations"
}

handle_enrich() {
  local username="$1"
  curl -s --max-time 30 "$SERVER/api/{platform}/profile/$username"
}

handle_dm() {
  local body_file="/tmp/${PLATFORM}_dm_params_$$.json"
  [[ -f "$body_file" ]] || echo '{}' > "$body_file"
  curl -s --max-time 60 -X POST "$SERVER/api/{platform}/messages/send-to" \
    -H 'Content-Type: application/json' --data-binary "@$body_file"
  rm -f "$body_file"
}

handle_sync() {
  # Fetch conversations → POST to CRMLite sync endpoint
  local convos; convos=$(curl -s --max-time 30 "$SERVER/api/{platform}/conversations")
  local crmlite_url="${CRMLITE_URL:-https://crmlite-isaiahduprees-projects.vercel.app}"
  printf '%s' "$convos" | python3 - "$crmlite_url" "$CRMLITE_API_KEY" "$PLATFORM" <<'PYEOF'
import json, sys
from urllib.request import urlopen, Request
convos_raw = sys.stdin.read()
crmlite_url, api_key, platform = sys.argv[1], sys.argv[2], sys.argv[3]
convos = json.loads(convos_raw) if convos_raw else []
payload = json.dumps({"platform": platform, "conversations": convos}).encode()
req = Request(f"{crmlite_url}/api/sync/dm", data=payload, headers={
    "Content-Type": "application/json",
    "x-api-key": api_key
}, method="POST")
resp = urlopen(req)
print(resp.read().decode())
PYEOF
}

handle_discover_prospects() {
  # Platform-specific: search → enrich → ICP score
  # For Twitter: use search API with ICP keywords
  # For LinkedIn: use search/people with job title filters
  # For TikTok: use trending with niche filter
  local body_file="/tmp/${PLATFORM}_discover_params_$$.json"
  [[ -f "$body_file" ]] || echo '{}' > "$body_file"
  curl -s --max-time 150 -X POST "$SERVER/api/prospect/discover" \
    -H 'Content-Type: application/json' --data-binary "@$body_file"
  rm -f "$body_file"
}
```

---

## Calendar Bridge — Adding Platform Support

Update `gcal_safari_bridge.py` to route by platform:

```python
# In parse_safari_event(), extract platform field:
SAFARI_PLATFORM_DESC = r'safari_platform:\s*(\S+)'

def parse_safari_event(event):
    # ... existing code ...
    platform_match = re.search(SAFARI_PLATFORM_DESC, desc)
    platform = platform_match.group(1).strip() if platform_match else 'instagram'
    return {
        'event_id': event['id'],
        'action': action,
        'params': params,
        'platform': platform,   # ← new field
        ...
    }

# In queue_safari_action(), use parsed platform:
def queue_safari_action(supabase, action, params, calendar_event_id, platform='instagram'):
    supabase.table('safari_command_queue').insert({
        'platform': platform,   # ← was hardcoded 'instagram'
        'action': action,
        ...
    })
```

**Calendar event format for other platforms:**
```
[safari:discover_prospects] LinkedIn Morning Prospect Hunt
---
safari_action: discover_prospects
safari_platform: linkedin
safari_params: {"keywords": ["VP of Engineering", "SaaS founder"], "maxCandidates": 10}
```

---

## Goal Planner — Adding Platform Metrics

Update `safari_schedule_planner.py` to track all platforms:

```python
# In collect_metrics():
for platform in ['instagram', 'twitter', 'linkedin', 'tiktok']:
    r = sb.table('safari_command_queue')\
        .select('id', count='exact', head=True)\
        .eq('platform', platform).eq('action', 'dm')\
        .eq('status', 'completed').gte('updated_at', week_ago).execute()
    metrics[f'{platform}_dms_sent_week'] = r.count or 0

# In analyze_gaps():
# Add Twitter followers gap
twitter_followers_target = growth.get('twitter_followers_target', 5000)
# (would need to track followers in Supabase — add to actp_accounts table)
```

---

## Build Priority Order

Based on business goals (linkedin + twitter are priority platforms):

1. **LinkedIn daemon** — highest business value (direct B2B outreach, $2,500 offer)
   - Estimated: 2-3 hours (copy ig-daemon pattern, wire to port 3105)
   - Priority: LinkedIn DMs convert best for high-ticket B2B

2. **Twitter daemon** — second priority (5K follower target, content feedback loop)
   - Estimated: 1-2 hours (cleanest API surface, similar to Instagram)
   - Extra: add `tweet`, `like`, `reply` actions (no Instagram equivalent)

3. **Prospect discovery for LinkedIn + Twitter** — after daemons
   - Estimated: 2 hours each (copy prospect-discovery.ts, swap endpoints)

4. **Multi-platform schedule planner** — after per-platform daemons exist
   - Add platform dimension to gap analysis + calendar events

5. **TikTok daemon** — third priority
   - Content platform, less DM-driven for B2B

6. **Threads** — lowest priority
   - Extend ig-daemon with Threads tab-switching instead of separate daemon

---

## Testing Each Platform

Before calling a platform "working", verify these 5 checks:

```bash
# 1. Service health
curl -s http://localhost:{PORT}/health | python3 -m json.tool

# 2. Session active (manual: verify correct account is logged in Safari)
curl -s http://localhost:{PORT}/api/{platform}/status

# 3. Inbox readable
curl -s http://localhost:{PORT}/api/{platform}/conversations | python3 -m json.tool | head -30

# 4. Profile enrichable
curl -s http://localhost:{PORT}/api/{platform}/profile/saraheashley | python3 -m json.tool

# 5. DM sendable (test account only)
curl -s -X POST http://localhost:{PORT}/api/{platform}/messages/send-to \
  -H 'Content-Type: application/json' \
  -d '{"username":"saraheashley","text":"Test ping","dryRun":true}' \
  | python3 -m json.tool

# 6. Cloud round-trip (after daemon is running)
# Insert row to safari_command_queue with platform={platform}, action=status
# Verify it gets marked completed within 30s
```

**Test accounts (from CLAUDE.md):**
- LinkedIn: Isaiah Dupree — https://www.linkedin.com/in/isaiah-dupree33/
- All others: Sarah E Ashley — @saraheashley (Instagram, TikTok, Twitter, Threads)
