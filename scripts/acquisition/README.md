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
│   └── imap_watcher.py
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
