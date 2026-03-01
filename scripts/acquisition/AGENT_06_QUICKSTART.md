# Agent 06 Quick Start Guide

## Installation

No installation needed — Agent 06 is ready to use.

## Environment Variables

```bash
# Required
export ANTHROPIC_API_KEY="sk-ant-..."           # For Claude Haiku
export SUPABASE_URL="https://...supabase.co"    # CRM database
export SUPABASE_SERVICE_KEY="..."              # Database access
export OWNER_EMAIL="your@email.com"             # Notification recipient

# Optional
export FROM_EMAIL="outreach@example.com"        # Email sender
```

## Basic Usage

### 1. Show Pending Follow-ups (Read-Only)

```bash
cd scripts
python3 -m acquisition.followup_agent --show-pending
```

**Output:**
```
=== Pending Follow-ups ===

Follow-up 1 pending: 5
  - John Doe (@johndoe) on twitter
  - Jane Smith (@janesmith) on instagram
  ...

Follow-up 2 pending: 2
  - Bob Wilson (@bobwilson) on linkedin
  ...

Ready for archival: 1
  - Alice Brown (@aliceb) on tiktok
```

### 2. Preview Mode (Dry Run)

```bash
python3 -m acquisition.followup_agent --dry-run
```

Shows what would happen without taking any actions.

### 3. Process Follow-ups (Production)

```bash
python3 -m acquisition.followup_agent --process
```

**This will:**
1. Sync inbox via `crm_brain.py`
2. Detect and process replies
3. Send push + email notifications
4. Generate and schedule follow-up messages
5. Archive contacts after Day 10

## Testing Notifications

### Test Push Notification

```bash
python3 -m acquisition.notification_client --test-push
```

You should see a macOS notification appear.

### Test Email Notification

```bash
python3 -m acquisition.notification_client --test-email
```

A draft email will open in Mail.app.

## Common Scenarios

### Scenario: Check for New Replies

```bash
# 1. First, sync inbox
cd scripts
python3 crm_brain.py --sync

# 2. Check for replies (dry-run)
python3 -m acquisition.followup_agent --dry-run

# 3. If you see replies, process them
python3 -m acquisition.followup_agent --process
```

### Scenario: Manually Trigger Follow-ups

```bash
# 1. Check who's ready for follow-ups
python3 -m acquisition.followup_agent --show-pending

# 2. Preview what will happen
python3 -m acquisition.followup_agent --dry-run

# 3. Process follow-ups
python3 -m acquisition.followup_agent --process
```

### Scenario: Test End-to-End

```bash
# 1. Create test contact in 'contacted' stage (via Supabase UI)
# 2. Set last_outbound_at to 5 days ago
# 3. Run agent in dry-run mode
python3 -m acquisition.followup_agent --dry-run

# You should see:
# [FollowUp1] Found 1 contacts ready for follow-up 1
# [FollowUp1] [DRY-RUN] Would generate follow-up 1 for Test Contact
```

## Timing Reference

| Day | Stage | Action |
|-----|-------|--------|
| 0 | contacted | Initial DM sent |
| 4 | follow_up_1 | First follow-up (different angle) |
| 7 | follow_up_2 | Final follow-up (graceful close) |
| 10 | archived | No reply → archive |

**Note:** Each transition requires 3 days with no reply.

## Notification Format

### Push Notification
```
Title: Reply from John Doe
Body: They're interested in learning more — TWITTER
Sound: default
```

### Email Notification
```
Subject: [CRM] John Doe replied on TWITTER

Body:
New reply detected from John Doe (@johndoe) on TWITTER.

SUMMARY: They're interested in learning more about AI automation
SENTIMENT: positive
RECOMMENDED RESPONSE: Share case study or demo video

ICP Score: 85/100
Platform: TWITTER
CRM Link: https://...supabase.co/contacts/abc123
```

## Troubleshooting

### "No API key found in request"
- Set `SUPABASE_SERVICE_KEY` environment variable
- Or use `SUPABASE_ANON_KEY` (limited permissions)

### "Claude API error"
- Set `ANTHROPIC_API_KEY` environment variable
- Check API key is valid and has credits

### "CRM sync failed"
- Check `crm_brain.py` exists in parent directory
- Ensure Safari automation services are running

### No notifications appearing
- macOS: Check System Settings → Notifications → Terminal/Script Editor
- Email: Ensure Mail.app is configured with an account
- Test with: `--test-push` or `--test-email`

## Cron Setup (Production)

Add to crontab to run every 4 hours:

```bash
# Follow-up agent (every 4 hours)
0 */4 * * * cd /path/to/Safari\ Automation/scripts && /usr/local/bin/python3 -m acquisition.followup_agent --process >> /tmp/followup-agent.log 2>&1
```

Or use Agent 07 (Orchestrator) for managed scheduling.

## Monitoring

### Check logs
```bash
tail -f /tmp/followup-agent.log
```

### Query notification table
```sql
SELECT
  created_at,
  trigger,
  summary,
  actioned_at
FROM acq_human_notifications
WHERE actioned_at IS NULL
ORDER BY created_at DESC
LIMIT 10;
```

### Track reply rates
```sql
SELECT
  COUNT(*) FILTER (WHERE to_stage = 'replied') AS replies,
  COUNT(*) FILTER (WHERE to_stage = 'archived' AND from_stage LIKE 'follow_up%') AS archived
FROM acq_funnel_events
WHERE occurred_at >= NOW() - INTERVAL '7 days';
```

## Performance

- **Reply detection:** ~1-2s (depends on inbox size)
- **Conversation summary:** ~0.5-1s per contact (Claude Haiku)
- **Follow-up generation:** ~0.5-1s per contact (Claude Haiku)
- **Notifications:** ~0.1s per notification (AppleScript)

**Expected runtime:** ~30s for 50 contacts (with 5 replies + 10 follow-ups)

## Cost Estimate

### Claude API (Haiku)
- Conversation summary: ~500 tokens = $0.0004
- Follow-up generation: ~300 tokens = $0.0002
- **Total:** ~$0.0006 per contact with reply

### Example Monthly Cost
- 100 replies/month: $0.06
- 200 follow-ups/month: $0.04
- **Total:** ~$0.10/month

## Support

- **Documentation:** See `AGENT_06_SUMMARY.md`
- **Tests:** `python3 -m acquisition.tests.test_followup_agent`
- **Issues:** Check database queries in `db/queries.py`

## Next Steps

1. ✅ Test notifications work on your machine
2. ✅ Run dry-run to verify timing logic
3. ✅ Process a few real follow-ups manually
4. → Set up cron or Agent 07 for automation
5. → Monitor reply rates in Agent 10 reports
