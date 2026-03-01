# Quick Start — AAG Agent 10: Reporting Agent

**5-Minute Setup Guide for Weekly Pipeline Reports**

---

## Prerequisites

1. ✅ Python 3.9+ installed
2. ✅ Supabase database configured (AAG-01 complete)
3. ✅ Other acquisition agents generating data (AAG-02, 03, 04, 05, 08)
4. ✅ Environment variables set:
   ```bash
   export SUPABASE_URL="https://..."
   export SUPABASE_SERVICE_KEY="..."
   export ANTHROPIC_API_KEY="sk-..."  # Optional (for insights)
   export OWNER_EMAIL="you@example.com"  # Optional (for email delivery)
   ```

---

## Quick Start (3 Commands)

### 1. Generate Your First Report

```bash
cd scripts
python3 -m acquisition.reporting_agent --generate --dry-run
```

**What this does**:
- Collects weekly pipeline stats from database
- Generates insights using Claude AI
- Formats report as markdown
- Prints to terminal (no delivery)

**Expected output**:
```
📊 Generating report for week of Feb 24, 2026...
  → Collecting weekly statistics...
  → Generating insights with Claude...
  → Formatting reports...

================================================================================
# Acquisition Pipeline — Week of Feb 24–Mar 03, 2026

## 📊 Funnel This Week

| Metric | This Week | vs Last Week |
|--------|-----------|--------------|
| **Discovered** | 120 | +15 (+14%) |
| **Qualified** | 84 (70%) | +5.0pp |
...
================================================================================

⚠️  Dry run mode: Report not saved or delivered
```

---

### 2. Deliver Report (Email + Push + Obsidian + DB)

```bash
python3 -m acquisition.reporting_agent --deliver
```

**What this does**:
- Generates report for current week
- Creates email draft in Mail.app
- Sends macOS push notification
- Writes to Obsidian vault
- Stores in `acq_weekly_reports` table

**Expected output**:
```
📊 Generating report for week of Feb 24, 2026...
  → Collecting weekly statistics...
  → Generating insights with Claude...
  → Formatting reports...
  → Delivering report...
    ✅ email: Email draft created in Mail.app
    ✅ push: Push notification sent
    ✅ obsidian: Report written to /Users/you/.memory/vault/DAILY-NOTES/2026-02-24-acquisition-report.md
    ✅ database: Stored in acq_weekly_reports
```

---

### 3. Auto-Apply Insights (Preview First)

```bash
# Preview what would be applied
python3 -m acquisition.reporting_agent --apply-insights --dry-run

# Actually apply (after reviewing preview)
python3 -m acquisition.reporting_agent --apply-insights
```

**What this does**:
- Reads latest report from database
- Filters for high-confidence insights (≥75%)
- Applies recommended actions:
  - Raise/lower ICP min_score
  - Promote winning message variant
  - Log platform focus recommendations

**Expected output**:
```
🔧 Applying insights from latest report...
  → Found 3 insights, filtering for high-confidence...

  ✅ 2 changes were applied:
    - Raised ICP min_score to 72
    - Promoted winning message variant to default
```

---

## Common Workflows

### Weekly Report Generation (Monday Morning)

```bash
# Generate report for last week and deliver
python3 -m acquisition.reporting_agent --week 2026-02-17 --deliver

# Auto-apply insights (with preview)
python3 -m acquisition.reporting_agent --apply-insights --dry-run
python3 -m acquisition.reporting_agent --apply-insights
```

---

### Custom Week Report

```bash
# Generate report for specific week
python3 -m acquisition.reporting_agent --week 2026-01-27 --generate
```

---

### API Access (Programmatic)

```python
from acquisition.reporting import stats_collector, insight_generator, formatter
from datetime import date

# 1. Collect stats
week_start = date(2026, 2, 24)
stats, err = stats_collector.collect_weekly_stats(week_start)

if err:
    print(f"Error: {err}")
else:
    print(f"Discovered: {stats.discovered}")
    print(f"Qualify rate: {stats.qualify_rate:.1%}")
    print(f"Reply rate: {stats.reply_rate:.1%}")

# 2. Generate insights
insights, err = insight_generator.generate_insights(stats)
for insight in insights:
    print(f"{insight.observation} (confidence: {insight.confidence}%)")
    print(f"  → {insight.recommended_action}")

# 3. Format report
report_md = formatter.format_markdown(stats, insights)
print(report_md)

# 4. Auto-apply (optional)
applied, err = insight_generator.auto_apply_insights(insights, dry_run=False)
for change in applied:
    print(f"Applied: {change}")
```

---

## Troubleshooting

### Issue: "ANTHROPIC_API_KEY not configured"

**Solution**: Set your API key
```bash
export ANTHROPIC_API_KEY="sk-ant-..."
```

**Note**: Report still generates without insights if API key is missing.

---

### Issue: "No reports found" when applying insights

**Solution**: Generate a report first
```bash
python3 -m acquisition.reporting_agent --deliver
python3 -m acquisition.reporting_agent --apply-insights
```

---

### Issue: Email not sending

**Cause**: `OWNER_EMAIL` not configured or not on macOS

**Solution**:
```bash
export OWNER_EMAIL="you@example.com"
```

**Note**: Email delivery requires macOS with Mail.app. Other delivery channels (push, Obsidian, DB) still work.

---

### Issue: "Obsidian vault not found"

**Solution**: Create vault directory
```bash
mkdir -p ~/.memory/vault/DAILY-NOTES
```

**Note**: Report still delivers to other channels if Obsidian is unavailable.

---

### Issue: Low data / "No insights generated"

**Cause**: Not enough data in pipeline yet

**Solution**: Run discovery, scoring, and outreach agents first to populate data:
```bash
# Discover prospects
python3 -m acquisition.discovery_agent --run

# Score them
python3 -m acquisition.scoring_agent --run

# Send outreach
python3 -m acquisition.outreach_agent --run

# Wait a week for replies, then generate report
python3 -m acquisition.reporting_agent --generate
```

---

## Configuration Options

### Environment Variables

```bash
# Required
SUPABASE_URL="https://your-project.supabase.co"
SUPABASE_SERVICE_KEY="eyJ..."

# Optional
ANTHROPIC_API_KEY="sk-ant-..."  # For Claude insights (recommended)
OWNER_EMAIL="you@example.com"   # For email delivery
```

---

### CLI Flags Reference

| Flag | Description | Default |
|------|-------------|---------|
| `--generate` | Generate and print report | - |
| `--deliver` | Generate + deliver via all channels | - |
| `--week YYYY-MM-DD` | Week start date | Current Monday |
| `--dry-run` | Preview without saving | False |
| `--apply-insights` | Auto-apply recommendations | - |

---

## Scheduling (Cron/Launchd)

### Weekly Report (Monday 9am)

**macOS Launchd** (`~/Library/LaunchAgents/com.acquisition.weekly-report.plist`):
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.acquisition.weekly-report</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/python3</string>
        <string>-m</string>
        <string>acquisition.reporting_agent</string>
        <string>--deliver</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/Users/you/path/to/scripts</string>
    <key>StartCalendarInterval</key>
    <dict>
        <key>Weekday</key>
        <integer>1</integer><!-- Monday -->
        <key>Hour</key>
        <integer>9</integer>
        <key>Minute</key>
        <integer>0</integer>
    </dict>
    <key>StandardOutPath</key>
    <string>/tmp/acquisition-report.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/acquisition-report.error.log</string>
</dict>
</plist>
```

Load it:
```bash
launchctl load ~/Library/LaunchAgents/com.acquisition.weekly-report.plist
```

---

**Linux Cron** (every Monday at 9am):
```bash
crontab -e
```

Add:
```
0 9 * * 1 cd /path/to/scripts && python3 -m acquisition.reporting_agent --deliver >> /tmp/acquisition-report.log 2>&1
```

---

## Testing

### Run Full Test Suite

```bash
cd scripts
python3 -m pytest acquisition/tests/test_reporting_agent.py -v
```

**Expected**: 13 passed, 1 skipped

---

### Run Specific Test

```bash
python3 -m pytest acquisition/tests/test_reporting_agent.py::TestStatsCollector::test_collect_weekly_stats_returns_valid_stats -v
```

---

## Next Steps

1. ✅ Generate your first report
2. ✅ Review insights for quality
3. ✅ Test auto-apply with dry-run
4. ✅ Set up weekly scheduled delivery
5. ✅ Monitor API usage in `acq_api_usage` table
6. ✅ Integrate with dashboard (coming soon)

---

## Support

- **Documentation**: `README_REPORTING.md`
- **Validation**: `AGENT_10_VALIDATION_REPORT.md`
- **Summary**: `AGENT_10_SUMMARY.md`
- **Tests**: `tests/test_reporting_agent.py`

---

**Last Updated**: 2026-02-28
**Agent**: AAG-10
**Status**: ✅ Production Ready
