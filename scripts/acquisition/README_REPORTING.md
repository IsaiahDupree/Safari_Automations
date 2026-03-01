# AAG Agent 10 — Pipeline Analytics & Reporting Agent

**Status**: ✅ Implementation Complete

## Mission

Build the reporting agent that generates weekly pipeline performance reports, tracks A/B message variant performance, calculates conversion rates at every stage, delivers reports via email + push notification + Obsidian, and auto-applies data-backed recommendations to improve the pipeline.

## Features Implemented

- **AAG-093**: Weekly pipeline stats collection (funnel metrics, conversion rates)
- **AAG-094**: Stage-to-stage conversion tracking
- **AAG-095**: A/B variant performance tracking with auto-winner detection
- **AAG-096**: Claude-powered insight generation
- **AAG-097**: Markdown + HTML report formatting
- **AAG-098**: Multi-channel delivery (email, push, Obsidian, database)
- **AAG-099**: Auto-apply high-confidence insights
- **AAG-100**: REST API endpoints for reporting
- **AAG-101**: CLI interface for manual report generation

## Architecture

```
reporting_agent.py (CLI + Orchestrator)
├── reporting/
│   ├── stats_collector.py      # Collect weekly metrics
│   ├── insight_generator.py    # Claude analysis + auto-apply
│   └── formatter.py            # Markdown/HTML formatting
├── api/routes/reports.py       # REST API endpoints
└── tests/test_reporting_agent.py
```

## Usage

### CLI Commands

```bash
# Generate and print report for current week
python3 reporting_agent.py --generate

# Generate and deliver (email + push + Obsidian + DB)
python3 reporting_agent.py --deliver

# Specific week
python3 reporting_agent.py --week 2026-02-24 --deliver

# Dry run (preview without saving)
python3 reporting_agent.py --generate --dry-run

# Auto-apply insights from latest report
python3 reporting_agent.py --apply-insights

# Dry-run insights (show what would be applied)
python3 reporting_agent.py --apply-insights --dry-run
```

### API Endpoints

```python
# Get latest report
GET /api/reports/latest

# Generate new report
POST /api/reports/generate?week_start=2026-02-24&deliver=false&dry_run=true

# Get conversion rates
GET /api/reports/analytics/conversion?days=30

# Get variant performance
GET /api/reports/analytics/variants

# Apply insights
POST /api/reports/analytics/apply-insights?dry_run=true

# Get weekly stats (raw)
GET /api/reports/stats/2026-02-24

# Update variant tracking
POST /api/reports/analytics/update-variants
```

### Python API

```python
from acquisition.reporting import (
    collect_weekly_stats,
    generate_insights,
    format_markdown,
    auto_apply_insights
)
from datetime import date

# Collect stats
stats, err = collect_weekly_stats(date(2026, 2, 24))

# Generate insights
insights, err = generate_insights(stats)

# Format report
report_md = format_markdown(stats, insights)

# Auto-apply insights
applied, err = auto_apply_insights(insights, dry_run=False)
```

## Report Delivery Channels

### 1. Email (via Mail.app)
- Creates draft email with HTML report
- Sent to `OWNER_EMAIL` from environment
- Subject: "📊 Weekly Acquisition Report — Week of Feb 24, 2026"

### 2. Push Notification (macOS)
- Short summary: "20 replies (29%), 5 calls, 2 closed. Top: twitter"
- Uses native macOS notification system

### 3. Obsidian Vault
- Written to `~/.memory/vault/DAILY-NOTES/`
- Filename: `2026-02-24-acquisition-report.md`
- Full markdown report

### 4. Database (Supabase)
- Stored in `acq_weekly_reports` table
- Includes markdown, HTML, stats JSON, and insights

## Weekly Stats Collected

| Metric | Description |
|--------|-------------|
| **Discovered** | New prospects scored this week |
| **Qualified** | Prospects that met ICP threshold |
| **Warmup Sent** | Warming comments/likes sent |
| **DMs Sent** | Direct messages sent |
| **Emails Sent** | Emails sent |
| **Replies** | Inbound messages from prospects |
| **Calls Booked** | Calendar invites accepted |
| **Closed Won** | Deals closed |

## Conversion Rates

- **Discovery → Qualified**: % of discovered that meet ICP
- **Outreach → Reply**: % of DMs/emails that get replies
- **Email Reply Rate**: % of emails that get replies
- **Reply → Close**: % of replies that convert to deals
- **Overall Funnel**: End-to-end conversion rate

## A/B Variant Tracking

The system automatically:
1. Tracks sends and replies for each message variant
2. Calculates reply rates
3. **Auto-flags winner** when one variant has:
   - 2x the reply rate of another
   - At least 10 sends (winner)
   - At least 5 sends (loser)
4. Deactivates underperforming variants

## Auto-Apply Insights

High-confidence insights (>= 75% confidence) are automatically applied:

### Supported Actions

1. **Raise/Lower ICP min_score**
   - Pattern: "Raise ICP min_score to 75"
   - Bounds: 60-85
   - Updates all active niche configs

2. **Promote winning variant**
   - Pattern: "Promote variant A" or "Make variant default"
   - Marks best variant as winner

3. **Platform focus** (manual)
   - Pattern: "Focus on Twitter" or "Increase Twitter outreach"
   - Logged as recommendation (requires manual daily cap adjustment)

## Example Report

```markdown
# Acquisition Pipeline — Week of Feb 24–Mar 03, 2026

## 📊 Funnel This Week

| Metric | This Week | vs Last Week |
|--------|-----------|--------------|
| Discovered | 120 | +15 (+14%) |
| Qualified | 84 (70%) | +5pp |
| DMs Sent | 50 | — |
| Emails Sent | 34 | — |
| Replies | 24 (29% reply rate) | +7pp |
| Calls Booked | 6 | — |
| Closed Won | 2 | — |

## 🏆 Best Performing

- **Platform**: twitter
- **Niche**: ai-automation-coaches
- **Message Variant**: variant-A (32% reply, 47 sends)

## 💡 Insights & Recommended Actions

1. **Twitter significantly outperforms other platforms**
   - Evidence: Twitter 32% reply rate vs Instagram 14% (50 sends each)
   - → Action: Increase Twitter daily cap from 50 to 75
   - Confidence: 92%

2. **Qualify rate dropping week-over-week**
   - Evidence: Dropped from 75% to 70% (15pp drop)
   - → Action: Raise ICP min_score to 72
   - Confidence: 78%
```

## Testing

```bash
# Run all tests
cd scripts/acquisition
python3 -m pytest tests/test_reporting_agent.py -v

# Run specific test
python3 -m pytest tests/test_reporting_agent.py::TestStatsCollector::test_safe_divide_handles_zero_denominator -v

# With coverage
python3 -m pytest tests/test_reporting_agent.py --cov=reporting --cov-report=html
```

## Environment Variables

```bash
# Required
ANTHROPIC_API_KEY=sk-...        # For insight generation
SUPABASE_URL=https://...         # Database
SUPABASE_SERVICE_KEY=...         # Database auth

# Optional
OWNER_EMAIL=you@example.com      # For email delivery
```

## Database Schema

### acq_weekly_reports

```sql
CREATE TABLE acq_weekly_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  week_start DATE NOT NULL,
  week_end DATE NOT NULL,
  report_md TEXT NOT NULL,
  report_html TEXT,
  stats JSONB NOT NULL,
  insights JSONB,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

## Dependencies

- Python 3.9+
- `urllib` (stdlib, for HTTP requests)
- `dataclasses` (stdlib)
- `subprocess` (stdlib, for AppleScript)
- Claude API (for insights)
- Supabase (for data storage)

## Performance

- **Stats collection**: ~2-5 seconds (depends on data volume)
- **Insight generation**: ~3-8 seconds (Claude API call)
- **Report formatting**: <100ms
- **Full workflow**: ~5-15 seconds

## Error Handling

All functions return `(result, error)` tuples:
- Success: `(data, None)`
- Failure: `(None, error_message)` or `(empty_value, error_message)`

The CLI and API gracefully handle:
- Missing environment variables
- Database connection errors
- Claude API failures (report still generated, just without insights)
- Missing Obsidian vault
- Email sending failures

## Monitoring

The agent tracks its own API usage:
```python
from acquisition.db import queries

# Track Claude API call
queries.track_api_usage("claude", cost_usd=0.015)
```

## Future Enhancements

1. **Per-platform daily cap auto-adjustment** based on reply rates
2. **Trend analysis** across multiple weeks
3. **Anomaly detection** (sudden drops in conversion)
4. **Predictive analytics** (forecast next week's metrics)
5. **Slack/Discord delivery** channels
6. **Interactive dashboard** (web UI)

---

**Status**: Ready for production use
**Last Updated**: 2026-02-28
**Agent**: AAG-10
