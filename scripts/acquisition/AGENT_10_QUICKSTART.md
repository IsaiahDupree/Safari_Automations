# AAG Agent 10 — Quickstart Guide

## 📊 Pipeline Analytics & Reporting Agent

Generate weekly performance reports, track A/B variants, and auto-apply data-backed insights.

---

## Quick Start (30 seconds)

### 1. Generate This Week's Report
```bash
cd scripts
python3 -m acquisition.reporting_agent --generate
```

### 2. Generate + Deliver Report
```bash
python3 -m acquisition.reporting_agent --deliver
```

### 3. Auto-Apply Insights
```bash
python3 -m acquisition.reporting_agent --apply-insights
```

---

## CLI Options

| Flag | Description | Example |
|------|-------------|---------|
| `--generate` | Generate and print report | `--generate` |
| `--deliver` | Generate + deliver (email, push, Obsidian) | `--deliver` |
| `--week DATE` | Specific week (YYYY-MM-DD) | `--week 2026-02-24` |
| `--dry-run` | Preview without saving | `--dry-run` |
| `--apply-insights` | Auto-apply recommendations | `--apply-insights` |

---

## Example Workflows

### Preview Report for Last Week
```bash
python3 -m acquisition.reporting_agent --generate --dry-run
```

### Deliver Report for Specific Week
```bash
python3 -m acquisition.reporting_agent --deliver --week 2026-02-17
```

### Test Auto-Apply (Safe Preview)
```bash
python3 -m acquisition.reporting_agent --apply-insights --dry-run
```

### Execute Auto-Apply (Production)
```bash
python3 -m acquisition.reporting_agent --apply-insights
```

---

## Report Contents

### Metrics Included
- **Funnel Counts**: Discovered, qualified, contacted, closed
- **Conversion Rates**: Qualify rate, reply rate, close rate
- **Best Performers**: Top platform, top niche, best variant
- **Week-over-Week**: Comparison to previous week
- **Pipeline Snapshot**: Current stage distribution
- **AI Insights**: 3-5 actionable recommendations (via Claude)

### Example Report Output
```markdown
# Acquisition Pipeline — Week of Feb 24–Mar 03, 2026

## 📊 Funnel This Week

| Metric | This Week | vs Last Week |
|--------|-----------|--------------|
| Discovered | 127 | +23 (+22%) |
| Qualified | 89 (70%) | +2.3pp |
| Total Outreach | 312 | — |
| Replies | 58 (18.6% reply rate) | +1.8pp |
| Calls Booked | 12 | — |
| Closed Won | 3 | — |

## 🏆 Best Performing
- Platform: twitter
- Niche: ai-automation-coaches
- Message Variant: casual-value-first (24.1% reply, 83 sends)

## 💡 Insights & Recommended Actions
1. **Twitter outperforming Instagram by 2.1x on reply rate**
   Evidence: Twitter: 23.4% vs Instagram: 11.2% (n=156 vs n=89)
   → Action: Increase Twitter daily cap from 50 to 70 DMs
   Confidence: 87%

2. **AI automation niche showing 3.2x higher close rate**
   Evidence: AI niche: 4.5% close vs Agency niche: 1.4% (n=67 vs n=43)
   → Action: Raise ICP min_score for non-AI niches from 65 to 72
   Confidence: 82%
```

---

## Auto-Apply Rules

The agent automatically applies high-confidence insights (≥75%):

1. **ICP Score Adjustment** — Raise/lower min_score (60-85 range)
2. **Variant Promotion** — Mark best-performing variant as default
3. **Platform Recommendations** — Logged for manual review

---

## Delivery Channels

### 1. Email
- HTML report via Mail.app
- Sent to OWNER_EMAIL (from config)
- Creates draft (review before sending)

### 2. Push Notification
- macOS native notification
- Shows summary: "58 replies (18.6%), 12 calls. Top: twitter"

### 3. Obsidian Vault
- Markdown file in `~/.memory/vault/DAILY-NOTES/`
- Filename: `YYYY-MM-DD-acquisition-report.md`

### 4. Database
- Stored in `acq_weekly_reports` table
- Accessible via API: `GET /api/reports/latest`

---

## API Endpoints

### Fetch Latest Report
```bash
curl http://localhost:8000/api/reports/latest
```

### Generate Report for Specific Week
```bash
curl -X POST "http://localhost:8000/api/reports/generate?week_start=2026-02-24&deliver=false&dry_run=true"
```

### Get Conversion Rates (Last 30 Days)
```bash
curl http://localhost:8000/api/reports/analytics/conversion?days=30
```

### Get Variant Performance
```bash
curl http://localhost:8000/api/reports/analytics/variants
```

### Auto-Apply Insights (Dry Run)
```bash
curl -X POST "http://localhost:8000/api/reports/analytics/apply-insights?dry_run=true"
```

---

## Cron Schedule

Add to orchestrator for weekly automation:

```python
# In cron_definitions.py
{
    "name": "weekly-report",
    "schedule": "0 9 * * MON",  # Every Monday at 9am
    "command": "python3 -m acquisition.reporting_agent --deliver",
    "description": "Generate and deliver weekly acquisition pipeline report"
}
```

---

## Configuration

### Required Environment Variables
```bash
export ANTHROPIC_API_KEY="sk-ant-..."  # For Claude insights
export OWNER_EMAIL="you@example.com"   # Report recipient
```

### Optional Settings
- `SUPABASE_URL` — Database connection
- `SUPABASE_SERVICE_KEY` — Database auth

---

## Troubleshooting

### "No reports found"
→ Run `--generate` first to create initial report

### "ANTHROPIC_API_KEY not configured"
→ Set environment variable or insights will be skipped

### "Obsidian vault not found"
→ Create directory: `mkdir -p ~/.memory/vault/DAILY-NOTES`

### "No data for this week"
→ Check that other agents (02-09) have run and populated data

---

## Testing

Run the full test suite:

```bash
cd scripts
python3 -m pytest acquisition/tests/test_reporting_agent.py -v
```

Expected: **13 passed, 1 skipped** (skipped test requires API key)

---

## Production Checklist

- [ ] Set `ANTHROPIC_API_KEY` for Claude insights
- [ ] Set `OWNER_EMAIL` for report delivery
- [ ] Create Obsidian vault directory
- [ ] Add to orchestrator cron schedule
- [ ] Test with `--dry-run` first
- [ ] Verify email delivery works
- [ ] Review first auto-applied insight

---

## Support

For issues or questions:
1. Check `AGENT_10_VALIDATION.md` for detailed validation
2. Review test output: `pytest acquisition/tests/test_reporting_agent.py -v`
3. Run with `--dry-run` to preview without changes
