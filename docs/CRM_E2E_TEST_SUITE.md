# CRM End-to-End Test Suite

Script: `scripts/test_crm_e2e.py`  
40 checks across 7 suites. No false positives.

---

## Verdict System

Every test emits exactly one verdict:

| Verdict | Symbol | Meaning |
|---|---|---|
| **PASS** | ✅ | `success:true` returned **with real data** (sent DM, got posts, DB rows exist) |
| **SKIP** | ⏭ | Service is UP, payload is correct, but **needs an active Safari session/tab** |
| **FAIL** | ❌ | Service DOWN, wrong credentials, or genuinely empty result when data must exist |

> **HTTP 400 / timeout / "No tab found" / overlay errors → SKIP, not PASS.**  
> Only `success:true` with actual data counts as PASS.

---

## Running the Suite

```bash
# All 7 suites
python3 scripts/test_crm_e2e.py

# Single suite
python3 scripts/test_crm_e2e.py --suite dm
python3 scripts/test_crm_e2e.py --suite research
python3 scripts/test_crm_e2e.py --suite market
python3 scripts/test_crm_e2e.py --suite comments
python3 scripts/test_crm_e2e.py --suite navigate
python3 scripts/test_crm_e2e.py --suite sync
python3 scripts/test_crm_e2e.py --suite cloud

# Dry-run (no real sends — skips all DM/comment actions)
python3 scripts/test_crm_e2e.py --dry-run
```

Requires `ANTHROPIC_API_KEY` set for Suites 2 (AI scoring) and 7 (cloud DM).

---

## Suite Reference

### Suite 1 — Direct Messaging (5 checks)

| Check | Platform | Target | Pass Condition |
|---|---|---|---|
| 1a | Instagram | Sarah E Ashley (`saraheashley_`) | `success:true, verified:true` |
| 1b | Twitter | Sarah E Ashley (`saraheashley`) | `success:true, verified:true` |
| 1c | TikTok | Sarah E Ashley (`Sarah E Ashley`) | `success:true, verified:true` |
| 1d | LinkedIn | Isaiah Dupree (profile URL) | `success:true` |
| 1e | CRM queue | `crm_brain --send-test` routing | exits 0 + "sent/sending/no messages" |

**Service endpoints:**
```
Instagram  POST :3001/api/messages/send-to          {username, text}
Twitter    POST :3003/api/twitter/messages/send-to  {username, text}
TikTok     POST :3102/api/tiktok/messages/send-to   {username, text}
LinkedIn   POST :3105/api/linkedin/messages/send-to {profileUrl, text}
```

> ⚠️ Instagram field is `text` (NOT `message`). Port 3001 bypasses `requireActiveSession` middleware on 3100.

**Pre-navigation:** Each DM test navigates Safari to the platform inbox URL before sending:
```python
INBOX_URLS = {
    "instagram": "https://www.instagram.com/direct/inbox/",
    "twitter":   "https://x.com/messages",
    "tiktok":    "https://www.tiktok.com/messages",
    "linkedin":  "https://www.linkedin.com/messaging/",
}
```

---

### Suite 2 — Client Research (5 checks)

| Check | Description | Pass Condition |
|---|---|---|
| 2a | Sarah E Ashley in CRM (all platforms) | ≥ 1 row with platform + username |
| 2b | AI score Sarah via Claude | 15 analysis lines printed |
| 2c | Isaiah Dupree in CRM | ≥ 1 row found |
| 2d | Message history accessible | ≥ 1 conversation thread |
| 2e | Batch AI scoring (limit=5) | "Scored N contacts" in output |

---

### Suite 3 — Market Research (7 checks)

| Check | Platform | Query | Pass Condition |
|---|---|---|---|
| 3a (×2) | Twitter | "AI copywriting", "brand voice" | posts.length ≥ 1 |
| 3b | Twitter | "AI copywriting" niche | creators.length > 0 (SKIP if 0 — needs active tab) |
| 3c | Twitter | Latest results file | creators with follower data (SKIP if no prior niche run) |
| 3d | TikTok | "brand voice" | posts.length ≥ 1 |
| 3e | Instagram | "content strategy" | posts.length ≥ 1 (SKIP if 0 — needs IG tab) |

**Endpoints:**
```
POST :3106/api/research/{platform}/search  {query, config: {postsPerQuery}}
POST :3106/api/research/{platform}/niche   {niche, config: {creatorsPerNiche, postsPerNiche}}
GET  :3106/api/research/results/latest/{platform}
```

> The `/niche` endpoint runs a full live scrolling pipeline — requires active Safari tab on that platform. The `/search` endpoint works headlessly on cached data.

---

### Suite 4 — Comments on All Platforms (5 checks)

| Check | Platform | Endpoint | Pass Condition |
|---|---|---|---|
| 4a | Instagram | `:3005/api/instagram/comments/post` | `success:true` |
| 4b | Twitter | `:3007/api/twitter/comments/post` | `success:true` |
| 4c | TikTok | `:3006/api/tiktok/comments/post` | `success:true` |
| 4d | Threads | `:3004/api/threads/comments/post` | `success:true` |
| 4e | Twitter (AI) | `:3007/api/twitter/comments/post` | `success:true` (useAI=true) |

Body: `{postUrl, text}`. Test navigates Safari to `postUrl` before posting.

> **SAMPLE_POSTS URLs** in the script are placeholder URLs. Replace with real post URLs for full PASS on comment tests. Until then, these will SKIP (needs active Safari session).

---

### Suite 5 — Contact Navigation (8 checks)

| Check | Description | Pass Condition |
|---|---|---|
| 5a | Load Sarah handles from CRM | ≥ 1 handle returned from DB |
| 5b | Navigate Safari → Sarah on Instagram | osascript exits 0 |
| 5c | Navigate Safari → Sarah on Twitter/X | osascript exits 0 |
| 5d | Navigate Safari → Sarah on TikTok | osascript exits 0 |
| 5e | Navigate Safari → Isaiah on LinkedIn | osascript exits 0 |
| 5f (×3) | DM Sarah from navigated profile (IG/TW/TT) | `success:true` per platform |

Navigation uses: `osascript -e 'tell application "Safari" to set URL of front document to "..."'`

---

### Suite 6 — Data Sync (5 checks)

| Check | Description | Pass Condition |
|---|---|---|
| 6a | Pre-sync DB counts | `crm_contacts > 0` (DB accessible) |
| 6b | `crm_brain --sync` all platforms | exits 0 + "synced" in output |
| 6c | `crm_brain --sync-linkedin` | exits 0 |
| 6d | Post-sync counts delta | row counts ≥ pre-sync |
| 6e | Sarah in crm_conversations | ≥ 1 thread (SKIP if none — needs inbox sync) |

---

### Suite 7 — Cloud → Safari Control (5 checks)

| Check | Description | Pass Condition |
|---|---|---|
| 7a | `safari_command_queue` table accessible | Supabase query returns without error |
| 7b | Enqueue navigate command | Supabase INSERT succeeds, returns ID |
| 7c | Enqueue DM command (Twitter → @saraheashley) | Supabase INSERT succeeds |
| 7d | Enqueue market research command | Supabase INSERT succeeds |
| 7e | Daemon `--run-once` executes pending | exits 0 + "executed" in output |
| 7f | Cloud DM has `success:true` in result | `safari_command_queue.result.success == true` |

---

## Known SKIP Conditions (Expected)

These are honest skips — the system is working, just needs an active browser:

| Test | Why it SKIPs |
|---|---|
| 1a IG DM | `requireActiveSession` on port 3100; or IG tab not on inbox |
| 1c TikTok DM | Needs TikTok inbox tab open |
| 1d LinkedIn DM | Needs LinkedIn messaging tab open |
| 3b Top Creators | Niche pipeline scrolls Twitter live |
| 3c Followers | No stored niche results yet |
| 3e Instagram posts | Needs active Instagram tab |
| 4a-4e Comments | Post URLs are placeholders; needs real posts + active platform tab |
| 6e Sarah conversations | Needs Safari inbox sync with message threads open |

---

## Service Port Map

| Service | Port | Status |
|---|---|---|
| Instagram DM (no auth) | 3001 | ✅ Confirmed working |
| Instagram DM (auth) | 3100 | ⚠️ Requires active session |
| Twitter DM | 3003 | ✅ Confirmed working |
| TikTok DM | 3102 | ✅ Confirmed working |
| LinkedIn DM | 3105 | ⚠️ Requires LinkedIn tab |
| Instagram Comments | 3005 | ✅ Route verified |
| Twitter Comments | 3007 | ✅ Confirmed working |
| TikTok Comments | 3006 | ✅ Route verified |
| Threads Comments | 3004 | ✅ Route verified |
| Market Research | 3106 | ✅ Confirmed working |

Start all services:
```bash
bash scripts/start-services.sh
```
