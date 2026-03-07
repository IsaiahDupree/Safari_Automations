# Business Goal Enhancements
_Goal: $5K/month | Current: $0/month | Last updated: 2026-03-06_

## Where We Are vs Where We Need to Be

| Metric | Target | Actual | Gap |
|--------|--------|--------|-----|
| Monthly revenue | $5,000 | $0 | 100% gap |
| CRM contacts | 1,000 | 738 | -262 |
| DMs sent (all time) | — | 2 | critical |
| DMs queued (7d) | 50/wk | 45 queued, 0 sent | stuck in queue |
| Upwork proposals/wk | 5 | 0 | 0 jobs in DB |
| Instagram prospects | — | 40 suggested, 0 contacted | pipeline stalled |
| LinkedIn DMs | — | 20 pending, 13 failed | broken |
| Content published | 21/wk | 0 | not running |

### Root Cause Summary

The pipeline has **three hard blockers** today:

1. **DMs stuck in queue** — `crm_message_queue` has 45 pending messages, 2 actually sent. The queue executor is not running.
2. **LinkedIn DMs failing** — 13 failed, 20 pending. `:3105` may have auth or selector issues.
3. **Zero Upwork activity** — `actp_upwork_jobs` table empty. The upwork pipeline never ran.

Everything below is ranked by **revenue impact** against the $5K/month target.

---

## Revenue Stream 1: Upwork Consulting ($2,500/month target)

**Current state: $0. Zero jobs in DB. Pipeline never ran.**

### Enhancement 1 — Fix Upwork job ingestion
The `actp_upwork_jobs` table is empty. The upwork-hunter (:3107) was just built and runs scans every 4h — but the actp-worker's `upwork_scorer.py` reads from `actp_upwork_jobs`, not from upwork-hunter's `upwork_proposals`.

**What's needed:**
- [ ] Wire upwork-hunter's RSS scan to INSERT into `actp_upwork_jobs` (Supabase) instead of/in addition to `upwork_proposals`
- [ ] OR: `upwork_scorer.py` reads from `upwork_proposals` table — update the table name it queries
- [ ] Run `POST :3107/api/scan` manually to populate the table immediately
- [ ] Verify `upwork_builder.py` (overstory UAF-003) was actually written — check actp-worker

**Target:** 5 jobs scored per day → 1 proposal drafted + sent per day → 1 win/month = $2,500

### Enhancement 2 — Telegram approval loop for Upwork
`upwork-hunter` sends to Telegram for approval but `TELEGRAM_BOT_TOKEN` is not set → auto-approve mode. This means proposals go out without review.

**What's needed:**
- [ ] Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` in Safari Automation `.env`
- [ ] Test: `POST :3107/api/proposals/generate` → verify Telegram message arrives
- [ ] Set up Telegram approval for real before submitting any proposal

### Enhancement 3 — Upwork proposal quality
The proposal generator uses `claude-haiku-4-5-20251001` with a generic prompt. No proven angle, no past wins to reference.

**What's needed:**
- [ ] Add Isaiah's actual case studies to the system prompt in `proposal-gen.ts`
- [ ] Add the `proven_angles.upwork_opening` field from `business-goals.json` to the prompt
- [ ] A/B test 2 opening hooks: "I saw your job..." vs "[specific insight about their stack]..."
- [ ] Track win rate per hook in `upwork_proposals` table

---

## Revenue Stream 2: Social DM Clients ($1,500/month target)

**Current state: $0. 40 prospects discovered, 0 DMs sent. Queue executor broken.**

### Enhancement 4 — Fix DM queue executor (MOST URGENT)

`crm_message_queue` has 45 rows in `pending` status. Zero are being sent. The ig-daemon handles `dm` actions from `safari_command_queue`, but the `crm_message_queue` is a different table — nothing reads it and sends the messages.

**What's needed:**
- [ ] Identify which service is supposed to drain `crm_message_queue`
- [ ] If `ig-daemon`: add a polling loop that reads `crm_message_queue WHERE status='pending' AND platform='instagram'` and calls `POST :3100/api/messages/send-to`
- [ ] If `heartbeat_agent.py`: add a step that drains the queue each cycle
- [ ] Add rate limiting: max 10 DMs per cycle, respect 9am–9pm window
- [ ] After sending: UPDATE `crm_message_queue SET status='sent', sent_at=now()`

**Quickest path:** Add to `ig-daemon` as a new `drain_dm_queue` step that runs after the cloud polling loop.

### Enhancement 5 — Fix LinkedIn DM failures

13 LinkedIn DMs in `crm_message_queue` have `status='failed'`. LinkedIn is the highest-value channel for the ICP (software founders $500K–$5M ARR).

**What's needed:**
- [ ] Read the failure reasons: `SELECT error_message FROM crm_message_queue WHERE status='failed' AND platform='linkedin' LIMIT 5`
- [ ] Test `:3105/api/linkedin/send-message` manually to see current error
- [ ] Check if linkedin-automation is logged into the right account
- [ ] Check selectors — LinkedIn DOM changes frequently
- [ ] After fix: re-queue the 13 failed messages with `UPDATE ... SET status='pending'`

### Enhancement 6 — Scale Instagram prospect discovery → DM flow

Current: 40 prospects discovered, 0 DMs sent. Need the full loop running.

**What's needed:**
- [ ] Schedule `POST :3100/api/prospect/run-pipeline` to run daily (via ig-daemon + safari_command_queue)
- [ ] After discovery: automatically call `POST :3100/api/prospect/schedule-batch?limit=10` to queue DMs
- [ ] The queue executor (Enhancement 4) then sends them
- [ ] Track reply rate per template in `actp_dm_templates` (Thompson Sampling — already built)
- [ ] Goal: 10 DMs/day → 70/week → at 5% reply rate = 3-4 conversations/week

### Enhancement 7 — Twitter/TikTok prospect pipelines

Currently only Instagram has a discovery pipeline. Twitter and TikTok agents are built but have no prospect discovery triggering.

**What's needed:**
- [ ] Add `POST :3003/api/prospect/run-pipeline` endpoint to twitter-dm (port it from instagram-dm)
- [ ] Add `POST :3102/api/prospect/discover` → `store-batch` flow to tiktok-dm
- [ ] Schedule both via agentlite cloud brain (bookings in `safari_command_queue`)
- [ ] All discovered prospects feed into `suggested_actions` table with `platform` field
- [ ] Unified DM queue drainer handles all platforms

---

## Revenue Stream 3: Content Monetization ($500/month target)

**Current state: 0 content pieces published. Posting schedule not running.**

### Enhancement 8 — Restart the content publishing pipeline

`actp_organic_posts` table is empty. Target is 21 pieces/week (3/day × 7 platforms).

**What's needed:**
- [ ] Check if `cloud_server.py` (:8090) is running — it likely handles content generation
- [ ] Check Blotato integration: does `publishlite` have a content source to draw from?
- [ ] Check ContentLite: is it generating content that feeds into the queue?
- [ ] Manual test: `POST https://mediaposter-lite.../api/schedule` with a test post
- [ ] The simplest path: run `/post-media` skill daily with AI-generated content until pipeline is automated

### Enhancement 9 — YouTube content (2,810 subscribers, target 5,000)

YouTube is 56% to target. Need a consistent publishing cadence.

**What's needed:**
- [ ] Define a content calendar: 2 videos/week on `ai_automation` and `saas_growth` niches
- [ ] Use Blotato account ID 228 (YouTube) for scheduled publishing
- [ ] Hook YouTube analytics to `youtube_video_stats` Supabase table for feedback loop
- [ ] Run `performance_tracker.py` check on YouTube watch time (add to metrics)

---

## Revenue Stream 4: Infrastructure Gaps Blocking All Streams

### Enhancement 10 — Agentlite deploy + cron activation

**✅ DONE (2026-03-07)** — AgentLite is deployed and live at `https://agentlite-jcma3kwoz-isaiahduprees-projects.vercel.app`. Crons running: orchestrate every 15min, process-results every 5min. Full cloud→local pipeline verified.

**Steps:**
```bash
cd /Users/isaiahdupree/Documents/Software/agentlite
# Set env vars in .env.local first:
# SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET
npx vercel --yes --prod
# Then add CRON_SECRET to Vercel project settings
```

**Impact:** Once live, the 15-minute cron automatically books daily prospect discovery, DM batches, and Upwork scans based on funnel state. This is the automation backbone.

### Enhancement 11 — ig-daemon: add missing cloud actions

The ig-daemon handles cloud commands from `safari_command_queue` but is missing:
- `prospect_discover` → `POST :3100/api/prospect/run-pipeline`
- `dm_batch` → `POST :3100/api/prospect/schedule-batch`
- `upwork_scan` → `POST :3107/api/scan`

Without these, agentlite's scheduled bookings hit the queue but nothing executes them.

**File:** `~/bin/ig-daemon`
Add 3 cases to the `case "$action" in` block.

### Enhancement 12 — Run the `processed_at` Supabase migration

Agentlite's result processor needs a `processed_at` column on `safari_command_queue`:

```sql
ALTER TABLE safari_command_queue
  ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;
```

Without this, the result processor crashes and completed actions are never marked done.

### Enhancement 13 — Proven angles: fill in `business-goals.json`

`proven_angles` is null for all fields. Agents default to generic approaches.

```json
"proven_angles": {
  "upwork_opening": null,  ← needs a winning hook
  "dm_opening": null,      ← needs a winning template
  "tweet_hook": null,
  "offer_framing": null
}
```

**What's needed:**
- [ ] Write 3 DM opening variations and A/B test via Thompson Sampling
- [ ] Write 3 Upwork proposal openings and test
- [ ] After 20+ sends each, the winning angle gets written back to `business-goals.json`
- [ ] All agents read this file and use the winner

---

## Prioritized Enhancement Roadmap

### This Week (get to first $0 → revenue)

| # | Enhancement | Effort | Revenue unblocked |
|---|-------------|--------|-------------------|
| 4 | Fix DM queue executor | 2h | $1,500/mo (social DMs) |
| 10 | Deploy agentlite to Vercel | 20min | All automation |
| 11 | Add prospect_discover/dm_batch/upwork_scan to ig-daemon | 1h | All automation |
| 12 | Run processed_at migration | 5min | Agentlite result loop |
| 1 | Run `POST :3107/api/scan` → populate upwork jobs | 5min | Upwork proposals |
| 5 | Debug LinkedIn DM failures (read error_message, test endpoint) | 1h | LinkedIn pipeline |

### Next Week (optimize and scale)

| # | Enhancement | Effort |
|---|-------------|--------|
| 3 | Add case studies + proven angles to Upwork proposal prompt | 2h |
| 6 | Schedule daily prospect discovery + DM batch in ig-daemon | 2h |
| 2 | Set TELEGRAM_BOT_TOKEN, test Upwork approval flow | 30min |
| 8 | Restart content publishing pipeline | 2h |

### Following Week (multi-platform scale)

| # | Enhancement | Effort |
|---|-------------|--------|
| 7 | Twitter + TikTok prospect pipelines | 4h (ACD agent) |
| 9 | YouTube cadence + analytics loop | 3h |
| 13 | Fill proven_angles after first test batch | ongoing |

---

## Revenue Math: Getting to $5K/Month

```
Upwork path:
  20 proposals/month × 10% win rate × $2,500/win = $5,000/month
  OR: 10 proposals × 20% win rate × $2,500/win = $5,000

DM client path:
  10 DMs/day → 300/month
  5% reply rate → 15 conversations
  20% close rate → 3 clients × $500/mo = $1,500/month

Content path (longer term):
  5,000 YouTube subscribers → affiliate revenue ~$500/month

Fastest path to $1K:
  1 Upwork win ($2,500) OR 5 DM clients at $500/mo ($2,500)
  → Focus on Upwork first (single sale, not recurring)
  → Then convert DM pipeline to retainer clients
```

---

## What the Agents Are Building Right Now

| Agent | Building | Revenue impact |
|-------|---------|---------------|
| `agentlite-cloud-brain` | ✅ Done — deployed + verified 2026-03-07 | Unlocks all automation |
| `self-improving-loop` | ✅ Done — needs wiring | Template optimization |
| `safari-tab-mgmt-*` | ✅ Done | Tab conflict prevention |
| `ig-e2e-integration` | ✅ Done | IG pipeline orchestration |
| `tiktok-browser-agent` | ✅ Done | TikTok channel |
| `upwork-autonomous-builder` | ✅ Done | Upwork proposals |
| Overstory `UAF-003` | ⏳ Building | `upwork_builder.py` in actp-worker |
| Overstory `PAP-002` | ⏳ Queued | `prospect_crm_sync.py` |
