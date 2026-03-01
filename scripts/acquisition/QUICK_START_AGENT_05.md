# Quick Start — AAG Agent 05: Outreach Agent

## Prerequisites

```bash
# 1. Set environment variables
export ANTHROPIC_API_KEY=sk-ant-...
export SUPABASE_URL=https://your-project.supabase.co
export SUPABASE_SERVICE_KEY=your_service_key

# 2. Install dependencies
pip install -r scripts/acquisition/requirements.txt

# 3. Verify platform DM services are running
curl http://localhost:3001/health  # Instagram
curl http://localhost:3003/health  # Twitter
curl http://localhost:3102/health  # TikTok
curl http://localhost:3105/health  # LinkedIn
```

## Running the Agent

### 1. Preview Mode (Recommended First)

Generate DMs without sending:

```bash
python3 scripts/acquisition/outreach_agent.py --generate --limit 5
```

This will:
- ✓ Fetch 5 contacts in `ready_for_dm` stage
- ✓ Build context from their posts
- ✓ Generate personalized DMs using Claude
- ✓ Validate messages
- ✗ **NOT send** any DMs

### 2. Dry Run Mode

Full validation without actual sends:

```bash
python3 scripts/acquisition/outreach_agent.py --dry-run --limit 10
```

This will:
- ✓ Fetch contacts
- ✓ Generate and validate DMs
- ✓ Check daily caps
- ✓ Simulate send (no API calls)
- ✓ Record touches (dry_run=true)

### 3. Production Send

Actually send DMs:

```bash
python3 scripts/acquisition/outreach_agent.py --send --limit 10
```

This will:
- ✓ Fetch 10 contacts
- ✓ Generate personalized DMs
- ✓ Validate messages
- ✓ Check daily caps
- ✓ **SEND via platform APIs**
- ✓ Record all touches in database
- ✓ Update pipeline stages

### 4. Specify Service Offering

```bash
# AI content automation
python3 scripts/acquisition/outreach_agent.py --send --service ai-content-engine --limit 5

# LinkedIn B2B lead gen
python3 scripts/acquisition/outreach_agent.py --send --service linkedin-lead-gen --limit 5

# Multi-platform social outreach
python3 scripts/acquisition/outreach_agent.py --send --service social-outreach --limit 5
```

## Expected Output

```
🚀 Starting outreach run (service=ai-content-engine, limit=10, dry_run=False)
📋 Found 10 contacts ready for DM

🎯 Processing Jane Doe (twitter)...
💬 Generated: Loved your post about "AI automation for solopreneurs." Have you...
✔️  Validation: score=9, passed=True
✅ Recorded touch for Jane Doe

🎯 Processing John Smith (instagram)...
💬 Generated: Your content on scaling with AI tools really resonates. Curious...
✔️  Validation: score=8, passed=True
✅ Recorded touch for John Smith

...

✅ Outreach complete: 10 sent, 0 failed, 0 skipped

============================================================
OUTREACH SUMMARY
============================================================
Total processed: 10
Successful:      10
Failed:          0
Skipped:         0
============================================================
```

## Validation Failures

If a message fails validation:

```
🎯 Processing Bob Johnson (linkedin)...
💬 Generated: Hey there, hope this finds you well! I'm reaching out...
✔️  Validation: score=3, passed=False
⚠️  Validation failed: ['banned:hope this finds you', 'banned:reaching out']
```

The contact will NOT be sent a DM. Check logs and contact will remain in `ready_for_dm` stage.

## Daily Cap Reached

```
🎯 Processing Alice Williams (twitter)...
❌ Error: Daily cap reached for dm/twitter
```

The agent will stop sending on that platform. Other platforms continue.

## Database Records

After successful send, check:

```sql
-- Outreach sequence record
SELECT * FROM acq_outreach_sequences
WHERE contact_id = 'contact_123'
ORDER BY sent_at DESC LIMIT 1;

-- Contact stage updated
SELECT id, display_name, pipeline_stage, last_outbound_at
FROM crm_contacts
WHERE id = 'contact_123';

-- Funnel event recorded
SELECT * FROM acq_funnel_events
WHERE contact_id = 'contact_123'
ORDER BY occurred_at DESC LIMIT 1;
```

## Troubleshooting

### No contacts found

```
ℹ️  No contacts ready for DM
```

**Fix:** Run Agent 04 (Warmup) first to move contacts to `ready_for_dm` stage.

### Claude API error

```
❌ Claude API error: Unauthorized
```

**Fix:** Check `ANTHROPIC_API_KEY` environment variable.

### Platform service unavailable

```
❌ Send error: Connection refused (port 3003)
```

**Fix:** Start the Twitter DM service:
```bash
cd packages/twitter-dm
npm run dev
```

### Daily cap check failed

```
❌ Failed to fetch contacts: HTTP 401
```

**Fix:** Check `SUPABASE_SERVICE_KEY` and database connectivity.

## Testing

Run the test suite to verify everything works:

```bash
python3 -m pytest scripts/acquisition/tests/test_outreach_agent.py -v
```

Should see:
```
============================== 18 passed in 2.09s ==============================
```

## Channel Coordination

The agent automatically coordinates with email channel:

```python
from acquisition.channel_coordinator import ChannelCoordinator

coordinator = ChannelCoordinator()

# Check active channel for a contact
contact = {...}  # from database
channel = coordinator.get_active_channel(contact)
# Returns: "dm", "email", or "none"

# If DM gets reply, pause email
coordinator.pause_email_if_dm_replied(contact_id)

# If email gets reply, cancel DM
coordinator.cancel_dm_if_email_replied(contact_id)
```

## Monitoring

Watch the agent in real-time:

```bash
# In one terminal: run agent
python3 scripts/acquisition/outreach_agent.py --send --limit 20

# In another: watch database
watch -n 1 "psql $DATABASE_URL -c \"
  SELECT status, COUNT(*)
  FROM acq_outreach_sequences
  WHERE DATE(sent_at) = CURRENT_DATE
  GROUP BY status;
\""
```

## Next Agent

After outreach completes, run **Agent 06: Follow-up Agent** to:
- Detect replies to DMs
- Send follow-up sequences (Touch 2, Touch 3)
- Archive non-responders after 10 days

---

**Built:** 2026-02-28
**Status:** ✅ Production Ready (18/18 tests passing)
