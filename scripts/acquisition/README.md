# Autonomous Acquisition Agent

Fully autonomous AI agent system for prospect discovery, scoring, engagement warmup, outreach, follow-up, email outreach, entity resolution, and pipeline reporting.

## Architecture

```
acquisition/
├── config.py                 # All environment vars, ports, caps, stages
├── db/
│   ├── migrations/
│   │   ├── 001_acquisition_tables.sql   # All 15+ new tables
│   │   └── 002_crm_contacts_columns.sql # ALTER TABLE additions
│   └── queries.py            # Typed query functions (stdlib urllib.request)
├── discovery_agent.py        # Agent 02: Find prospects on social platforms
├── scoring_agent.py          # Agent 03: ICP scoring via Claude
├── warmup_agent.py           # Agent 04: Comment engagement before DM
├── outreach_agent.py         # Agent 05: First-touch DM outreach
├── followup_agent.py         # Agent 06: Follow-up sequences
├── email_agent.py            # Agent 08: Email outreach via Resend
├── entity_resolution_agent.py # Agent 09: Cross-platform profile linking
├── orchestrator.py           # Agent 07: Daily pipeline coordinator
├── reporting_agent.py        # Agent 10: Weekly analytics + insights
├── clients/
│   └── market_research_client.py
├── email/
│   ├── resend_client.py
│   ├── discovery.py
│   ├── generator.py
│   ├── gmail_watcher.py      # Read-only inbox sync via existing ACTP Gmail OAuth
│   ├── imap_watcher.py       # IMAP read + reply-link evidence helpers
│   └── reply_state.py        # Deterministic evidence-backed conversation review projection
├── entity/
│   ├── perplexity_client.py
│   ├── username_matcher.py
│   ├── bio_link_extractor.py
│   └── disambiguator.py
├── reporting/
│   ├── stats_collector.py
│   ├── insight_generator.py
│   └── formatter.py
├── api/
│   ├── server.py
│   └── routes/
│       ├── discovery.py
│       ├── warmup.py
│       ├── outreach.py
│       ├── email.py
│       └── reports.py
└── tests/
    ├── test_discovery_agent.py
    ├── test_scoring_agent.py
    └── ...
```

## Setup

### 1. Run database migrations

```bash
# Via Supabase SQL Editor or psql:
psql $DATABASE_URL -f scripts/acquisition/db/migrations/001_acquisition_tables.sql
psql $DATABASE_URL -f scripts/acquisition/db/migrations/002_crm_contacts_columns.sql
```

### 2. Set environment variables

```bash
# Required
export SUPABASE_URL=https://your-project.supabase.co
export SUPABASE_SERVICE_KEY=your_service_key
export ANTHROPIC_API_KEY=sk-ant-...
export ENABLE_ACQUISITION=true

# Email (Agent 08)
export RESEND_API_KEY=re_...
export FROM_EMAIL=outreach@yourdomain.com

# Entity Resolution (Agent 09)
export PERPLEXITY_API_KEY=pplx-...
```

### 3. Seed initial data

```bash
cd scripts
python -c "from acquisition.db.queries import seed_all; print(seed_all())"
```

### 4. Install Python dependencies

```bash
pip install -r scripts/acquisition/requirements.txt
```

## Daily Pipeline Schedule

| Time | Agent | Action |
|------|-------|--------|
| 6:00 AM | Discovery | Find 20-50 new prospects |
| 6:30 AM | Entity Resolution | Link cross-platform profiles |
| 7:00 AM | Scoring | ICP score with Claude Haiku |
| 7:30 AM | Email Discovery | Find verified emails |
| 8:00 AM | Warmup Schedule | Plan today's comments |
| 8:30 AM | Warmup Execute | Send comments |
| 9:00 AM | DM Outreach | Send first DMs |
| 9:30 AM | Email Send | Send scheduled emails |
| Every 4h | Follow-up | Sync inboxes, detect replies |
| Monday 9AM | Reporting | Weekly report |

## Pipeline Stages

```
new → scored → qualified → warming → ready_for_dm → contacted → replied → call_booked → closed_won
                                                                        → closed_lost → (re-entry after 90d)
                                                         → archived → (re-entry after 180d)
```

## Reply visibility contract

`email.imap_watcher.IMAPWatcher.fetch_new_replies()` returns an
`InboxSyncResult`, not a bare list. Consumers must check `ok` before making a
no-reply decision; failed IMAP reads return `ok=False` and an error so an empty
result cannot masquerade as a healthy inbox. Each parsed email retains its
Message-ID, In-Reply-To, References, and IMAP UID. `assess_reply_link()` marks
an inbound message as a confirmed reply only when its thread headers match a
known outbound Message-ID. Subject-only matches are `needs_review`; unlinked
mail stays `unmatched`.

`email.reply_state.conversation_review(contact, messages, sync_ok, synced_at)`
projects stored message evidence into one review row with state, timestamps,
message excerpt, source identifiers, link reason, freshness, and next action.
A failed sync always projects `stale_data`, never `awaiting_reply`. The
acquisition API connects this projection to durable inbox records and exposes
the review data as JSON; this repository does not include a visual inbox UI.

The API exposes `POST /api/acquisition/email/inbox/sync?since_days=30` and
`GET /api/acquisition/email/inbox/review?limit=100`. Sync uses the existing
ACTP Gmail OAuth token in read-only fashion, then stores message evidence in
`acq_inbound_messages`. Apply the generated `supabase/migrations/*_reply_inbox.sql`
migration before starting the service. Run the API on loopback (the Uvicorn
default) because its review endpoint returns private email content.

## Daily Caps (default)

| Action | Platform | Daily Limit |
|--------|----------|-------------|
| DM | Instagram | 20 |
| DM | Twitter | 50 |
| DM | TikTok | 30 |
| DM | LinkedIn | 50 |
| Comment | Instagram | 25 |
| Comment | Twitter | 40 |
| Comment | TikTok | 25 |
| Comment | Threads | 30 |
| Email | Email | 30 |
