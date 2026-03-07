# Twitter Tech Research Agent

Autonomous research agent that scrapes Twitter/X for trending tech topics, runs deep multi-topic searches, synthesizes findings with Claude, and delivers concise structured reports to Telegram and Obsidian on a daily schedule.

## Architecture

```
watchdog-queue.sh (daily 7am)
  → twitter-research-agent.js (orchestrator)
    → trending-topic-scraper.js (Safari → Twitter Explore → extract top tech topics)
    → multi-topic-search-runner.js (TwitterResearcher per topic → raw tweet batches)
    → research-synthesizer.js (Claude Haiku → cluster, rank, extract signals)
    → report-formatter.js (structured report → Telegram + Obsidian + Supabase)
```

## Quick Start

```bash
# Run now (foreground)
./launch-twitter-research-agent.sh run-now

# Run in background
./launch-twitter-research-agent.sh start

# Check status
./launch-twitter-research-agent.sh status

# Just get trending topics (no full pipeline)
./launch-twitter-research-agent.sh topics-only

# Dry run (skip Telegram/Supabase, write local files)
./launch-twitter-research-agent.sh dry-run
```

## CLI Options

```bash
# Override topics instead of scraping
node twitter-research-agent.js --topics "AI agents, LLM tools"

# Dry run (skip Telegram + Supabase)
node twitter-research-agent.js --dry-run

# Just print trending topics
node twitter-research-agent.js --topics-only
```

## Output Files

- **Raw batches:** `~/Documents/twitter-research/batches/YYYY-MM-DD.json`
- **Synthesis:** `~/Documents/twitter-research/synthesis/YYYY-MM-DD.json`
- **Obsidian:** `~/.memory/vault/RESEARCH/twitter-trends-YYYY-MM-DD.md`
- **Supabase:** `twitter_research_reports` table

## Components

### 1. trending-topic-scraper.js
Scrapes Twitter/X Explore page for trending tech topics. Filters by tech keywords and falls back to seeded topics if needed.

### 2. multi-topic-search-runner.js
Runs TwitterResearcher sequentially per topic to collect raw tweet data. Collects top 20 tweets and top 5 accounts per topic.

### 3. research-synthesizer.js
Uses Claude Haiku API to cluster, rank, and extract business-relevant signals from raw tweet data.

### 4. report-formatter.js
Formats synthesis into readable reports and pushes to Telegram and Obsidian.

### 5. twitter-research-agent.js
Orchestrator daemon that runs the full pipeline end-to-end.

### 6. launch-twitter-research-agent.sh
Start/stop/status script with support for background execution and cron scheduling.

### 7. test-research-agent.js
End-to-end test suite validating all pipeline stages.

## Environment Variables

Required (loaded from `/Users/isaiahdupree/Documents/Software/actp-worker/.env`):
- `ANTHROPIC_API_KEY` - Claude API key
- `TELEGRAM_BOT_TOKEN` - Telegram bot token
- `TELEGRAM_CHAT_ID` - Telegram chat ID

## Database Migration

```sql
-- Applied via: mcp__supabase__apply_migration
CREATE TABLE IF NOT EXISTS twitter_research_reports (
  id uuid primary key default gen_random_uuid(),
  report_date date not null,
  topics text[] not null,
  raw_batch_path text,
  synthesis jsonb,
  telegram_sent boolean default false,
  obsidian_path text,
  tweet_count int,
  created_at timestamptz default now()
);
```

## Scheduling

Add to crontab for daily 7am runs:
```bash
0 7 * * * bash /Users/isaiahdupree/Documents/Software/Safari\ Automation/packages/market-research/src/research-agent/launch-twitter-research-agent.sh run-now
```

Or let the watchdog handle it (already integrated in `harness/watchdog-queue.sh`).

## Testing

```bash
# Run full test suite
node test-research-agent.js

# Individual tests
node twitter-research-agent.js --topics-only
node twitter-research-agent.js --dry-run --topics "AI agents"
```

## Key Constraints

- Uses real Safari browser automation (no mocks)
- Uses existing Safari tab claimed by twitter-dm or twitter-comments service
- Runs topics sequentially, never in parallel (one Safari instance)
- All output files are real (no stubs)
- Never auto-sends to Telegram without explicit confirmation (use --dry-run for testing)

## Dependencies

- TwitterResearcher class: `packages/market-research/dist/twitter-comments/src/automation/twitter-researcher.js`
- Safari tab coordinator: Tracks tabs on port 3003/3007
- Supabase project: `ivhfuhxorppptyuofbgq`
- Obsidian vault: `~/.memory/vault/`
