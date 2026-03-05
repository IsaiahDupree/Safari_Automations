# Instagram — What Actually Works Right Now

> Honest audit of the full Instagram automation stack. 2026-03-04.

---

## ✅ Fully Working (verified end-to-end)

| Action | How to trigger | Verified |
|--------|---------------|---------|
| Read DM inbox | `ig-request conversations` | ✅ |
| Open DM thread | `ig-request` → REST | ✅ |
| Read messages in thread | REST GET /api/messages | ✅ |
| Profile enrichment | `ig-request enrich @username` | ✅ |
| Send DM (within active hours) | `ig-request dm @username "text"` | ✅ |
| Sync inbox → CRMLite | `ig-request sync` | ✅ |
| Navigate to inbox | REST POST /api/inbox/navigate | ✅ |
| Session management | REST POST /api/session/ensure | ✅ |
| Post metrics scrape | igc_get_post_metrics | ✅ |
| Comment reading | igc_get_comments | ✅ |
| Comment posting | igc_post_comment | ✅ |
| Hashtag search | igc_navigate + igc_get_comments | ✅ |
| Follower list scrape | :3005/api/instagram/activity/followers | ✅ |
| ICP prospect discovery | POST /api/prospect/discover | ✅ |
| ICP prospect scoring | GET /api/prospect/score/:username | ✅ |
| Cloud dispatch (Supabase → Safari) | safari_command_queue → ig-daemon | ✅ |
| Terminal CLI | ig-request (15 actions) | ✅ |
| Calendar → Safari scheduling | gcal_safari_bridge + heartbeat | ✅ |
| Goal-driven weekly planner | safari_schedule_planner.py | ✅ |
| AI DM generation | instagram_ai_generate_dm | ✅ |
| CRM contact lookup | instagram_crm_get_contact | ✅ |

---

## ⚠️ Works But Needs Attention

| Item | Issue | Fix needed |
|------|-------|------------|
| DM sending | Active hours guard was disabled for testing — re-enable before production | Uncomment ~line 195 in server.ts |
| Prospect discovery (followers source) | :3005 returns `{events:[]}` format — fixed in prospect-discovery.ts, confirm stays fixed | Run test after next server restart |
| heartbeat_agent schedule planner | Runs morning window 07:00-10:00 UTC only — won't re-plan if started outside window | Make idempotent: check if week already planned |
| Calendar events | 15 events created in two runs (duplicate risk if planner re-runs same day) | Add `already_scheduled()` check runs fully — confirmed logic exists, needs testing |

---

## ❌ Not Working / Not Built

| Item | Why | Required for |
|------|-----|-------------|
| `suggested_actions` Supabase table | Table doesn't exist — migration never run | `instagram_queue_prospect`, outreach queue |
| Warm-up sequence | Not built — comment → 24h wait → DM | Better DM conversion |
| Follow-up re-engagement | Not built — no re-contact after no reply | Lead recovery |
| Booking link in DMs | No Calendly/Cal.com integration | Client conversion |
| DM → call → client tracking | No funnel metrics in Supabase | Revenue attribution |
| MCP tools in Claude Code | gcal-mcp registered but needs Claude Code restart to load | `/book-safari` skill |
| Tests | Integration tests exist (17 pass) but prospect discovery not covered | Before production |

---

## The Complete Data Flow (what the system does when fully running)

```
Every 30 minutes — heartbeat_agent.py runs:
  → ig_goal_observers.py checks: DM replies, follower delta, post performance, agent liveness
  → gcal_safari_bridge.py checks: upcoming calendar events tagged with safari:
      → If event found: insert row to safari_command_queue
  → (07:00-10:00 UTC) safari_schedule_planner.py:
      → reads business-goals.json targets
      → queries Supabase: crm_contacts, dms_sent_week, sync_runs, discovery_runs
      → computes gaps (CRM 579/1000, DMs 4/50, etc.)
      → creates Google Calendar events for the week (discover_prospects, sync, conversations, scrape)

Every 10 seconds — ig-daemon polls:
  → /tmp/ig_inbox/*.json  (terminal IPC from ig-request)
  → safari_command_queue WHERE platform=instagram AND status=pending
  → dispatches to correct handle_* function
  → writes response to /tmp/ig_outbox/res-*.json
  → PATCHes Supabase row to status=completed with result

When discover_prospects fires:
  → POST /api/prospect/discover {keywords, sources, maxCandidates, minScore}
  → fetchHashtagCandidates: calls :3005/api/instagram/search/keyword for each keyword
  → fetchFollowerCandidates: calls :3005/api/instagram/activity/followers
  → for each unique username (up to maxCandidates):
      → enrichContact(username): Safari navigates to instagram.com/{username}
      → scrapes: fullName, bio, followers, following, posts, isPrivate
      → scoreICP(): 6 signals → 0-100 score
      → isInCRM(): checks crm_contacts via CRMLite API
  → returns ranked list: [{username, icpScore, icpSignals, followers, bio, alreadyInCRM}]

When sync fires:
  → GET /api/conversations (all DM threads, paginated)
  → for each thread: GET /api/messages (last N messages)
  → POST https://crmlite.../api/sync/dm {platform, conversations}
      → CRMLite upserts crm_contacts, appends message history

When dm fires (with approval gate):
  → POST /api/messages/send-to {username, text}
      → Strategy 1: navigate to instagram.com/{username} → click Message
      → Strategy 2: navigate to inbox → search for thread → type + send
      → Strategy 3: start new conversation → send
  → logged to safari_command_queue result field

Every morning via calendar:
  → [safari:discover_prospects] 9am → 8 profiles enriched and scored
  → [safari:conversations] 6pm → inbox read, DM opportunities flagged
  → [safari:sync] 11pm → full inbox → CRMLite sync
```

---

## What 1 Week of Running Instagram Automation Looks Like

**Given current gaps (CRM 579, DMs 4/week):**

Week 1 actions (from current calendar schedule):
- 6× `discover_prospects` (weekday 9am) → ~48 prospects scored
- 2× `conversations` (6pm) → inbox checked
- 4× `sync` (11pm Mon-Thu) → CRMLite updated
- 1× `scrape` (post metrics)

Data collected:
- ~48 ICP-scored profiles (bios, follower counts, signals)
- ~480 new prospects total over 10 weeks → crosses 1,000 CRM target
- Full DM thread history synced nightly
- Post engagement metrics for top 12 posts

**Still requires human action for:**
- Reviewing prospect list and approving DMs (confirmation gate in /ig-prospect-hunt)
- Responding to DM replies (no auto-reply)
- Booking calls when someone says yes (no Calendly integration yet)

---

## Recommended next actions to make Instagram production-ready

1. **Run Supabase migration** for `suggested_actions` table (outreach queue)
2. **Re-enable active hours guard** in server.ts line ~195
3. **Write prospect discovery test** (Layer 3 of existing test suite)
4. **Add Calendly link** to DM templates in nba_templates Supabase table
5. **Build follow-up sequence** — 3-day re-engagement after no reply
