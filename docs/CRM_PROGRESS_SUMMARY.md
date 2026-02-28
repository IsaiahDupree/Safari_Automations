# CRM Safari Automation — Progress Summary

Last updated: Feb 2026

---

## What's Been Built

A full AI-powered CRM system layered on top of Safari Automation, enabling:
- Multi-platform DM sending (IG, TW, TT, LinkedIn) driven by AI scoring
- Live market research (posts + top creators) across Twitter, TikTok, Instagram
- Automated commenting on all platforms
- Cloud → local Safari control via Supabase command queue
- Bi-directional sync: Safari inbox → Supabase → AI scoring → message generation → send

---

## Components

| Component | File | Status |
|---|---|---|
| CRM Brain pipeline | `scripts/crm_brain.py` | ✅ Production ready |
| E2E test suite | `scripts/test_crm_e2e.py` | ✅ 7 suites, no false positives |
| Cloud controller daemon | `scripts/safari_cloud_controller.py` | ✅ Working |
| LinkedIn prospector | `scripts/li_prospect.py` | ✅ Working |

---

## Service Map

| Service | Port | Notes |
|---|---|---|
| Instagram DM | **3001** (use this) / 3100 (has auth middleware) | ✅ |
| Twitter DM | 3003 | ✅ |
| TikTok DM | 3102 | ✅ Fixed: cliclick OS-level click, squish-match |
| LinkedIn DM | 3105 | ✅ |
| Instagram Comments | 3005 | ✅ |
| Twitter Comments | 3007 | ✅ AI reply supported (`useAI:true`) |
| TikTok Comments | 3006 | ✅ |
| Threads Comments | 3004 | ✅ |
| Market Research | 3106 | ✅ |

Start all: `bash scripts/start-services.sh`

---

## Supabase Database (ivhfuhxorppptyuofbgq)

| Table | Rows | Purpose |
|---|---|---|
| `crm_contacts` | ~520 | All platform contacts (IG:63, TT:107, TW:6, LI:344) |
| `crm_conversations` | ~500+ | Conversation threads per contact |
| `crm_messages` | — | Individual messages |
| `crm_message_queue` | 8 pending | AI-generated messages awaiting send |
| `crm_score_history` | — | Time-series AI scores |
| `linkedin_prospects` | 55 | ICP-qualified LinkedIn contacts |
| `safari_command_queue` | — | Cloud → Safari command bus |
| `crm_market_research` | — | Stored market research results |

---

## Key Bugs Fixed

### Instagram DM field name
- **Wrong**: `{username, message}` → HTTP 400 "username and text required"
- **Fixed**: `{username, text}` ✅

### Instagram DM port
- Port 3100 has `requireActiveSession` middleware → 401 unless Safari is on IG inbox
- **Fix**: Use port **3001** (same service, no auth middleware)

### Market research body fields
- **Wrong**: `{keyword, maxResults}` → 400
- **Fixed**: `{query, config: {postsPerQuery}}` for `/search`
- **Fixed**: `{niche, config: {creatorsPerNiche, postsPerNiche}}` for `/niche`

### LinkedIn sync timestamp sanitization
- LinkedIn returns human dates: `"Feb 22"`, `"Jan 5"`, `"Yesterday"`
- **Fixed**: `_safe_ts()` converts to ISO 8601, falls back to `now()` for unparseable values

### LinkedIn contact field resolution
- Some entries use `participantName` instead of `name`
- **Fixed**: Multi-field resolution chain: `participantName → displayName → username → name → handle`

### TikTok DM click events
- TikTok ignores JavaScript `.click()` events on conversation items
- **Fixed**: `clickAtScreenPosition(x, y, true)` → OS-level Quartz event via `cliclick`

### Test suite false positives
- Old `assert_route` treated HTTP 400 / timeout / session errors as PASS
- **Fixed**: Rewritten with `_do_dm`, `_do_comment`, `_do_research` helpers
  - `success:true + verified:true` → PASS
  - Session/tab/overlay error → SKIP
  - Service DOWN / genuine error → FAIL

---

## Test Suite Results (Latest Run)

| Suite | Checks | Typical PASS | Typical SKIP | FAIL |
|---|---|---|---|---|
| 1 Direct Messaging | 5 | 2–3 | 1–2 | 0 |
| 2 Client Research | 5 | 5 | 0 | 0 |
| 3 Market Research | 7 | 4–5 | 1–2 | 0–1 |
| 4 Comments | 5 | 1–2 | 3–4 | 0 |
| 5 Navigation | 8 | 7–8 | 0–1 | 0 |
| 6 Data Sync | 5 | 4–5 | 0–1 | 0 |
| 7 Cloud Control | 5 | 3–4 | 1 | 0 |

> SKIPs are honest — they require an active Safari tab on the target platform. PASSes represent real data returned or confirmed sends.

**Confirmed working end-to-end:**
- ✅ Twitter DM → @saraheashley (`success:true, verified:true`)
- ✅ TikTok DM → @saraheashley (`success:true, verified:true`, 3/3 sends)
- ✅ Instagram DM → @saraheashley_ (port 3001)
- ✅ Twitter reply comment posted
- ✅ Market research: Twitter 6 posts, TikTok 12 posts
- ✅ Cloud DM via `safari_command_queue` → Twitter send confirmed
- ✅ CRM sync: 520 contacts, 12 LinkedIn conversations
- ✅ AI scoring: 5 contacts scored per batch

---

## LinkedIn Prospecting (Bonus)

Script: `scripts/li_prospect.py`  
Architecture: Direct `osascript` — no service dependency, bypasses `do JavaScript` timeout.

```bash
python3 scripts/li_prospect.py --search --limit 20   # search + score + upsert
python3 scripts/li_prospect.py --connect --limit 5   # send connection requests
python3 scripts/li_prospect.py --pipeline --limit 15 # full run
python3 scripts/li_prospect.py --status              # pipeline stats
```

Config: `scripts/prospect_config.yaml` — ICP criteria, search queries, connection templates.

---

## Docs Index

| Doc | Description |
|---|---|
| `docs/CRM_BRAIN_PIPELINE.md` | crm_brain.py CLI, data model, sync pipeline, AI scoring |
| `docs/CRM_E2E_TEST_SUITE.md` | 7-suite test reference, PASS/SKIP/FAIL semantics, endpoint map |
| `docs/CLOUD_SAFARI_CONTROLLER.md` | Cloud → local daemon, command queue schema, action routing |
| `docs/CRM_PROGRESS_SUMMARY.md` | This file — overall progress, bug fixes, results |
| `docs/LINKEDIN_AUTOMATION.md` | LinkedIn prospecting pipeline |
| `docs/DM_API_REFERENCE.md` | DM service API reference |
| `docs/COMMENT_AUTOMATION.md` | Comment service API reference |
| `docs/PRD_MARKET_RESEARCH_SCRAPER.md` | Market research service PRD |
| `docs/RELATIONSHIP_FIRST_CRM_FRAMEWORK.md` | CRM philosophy and approach |
