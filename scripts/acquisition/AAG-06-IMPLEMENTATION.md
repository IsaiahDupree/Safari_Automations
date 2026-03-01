# AAG Agent 06 — Follow-up & Human Notification Agent

**Status**: ✅ **COMPLETE**
**Date**: 2026-02-28
**Features**: AAG-065 through AAG-075

---

## Overview

The Follow-up & Human Notification Agent is a fully autonomous system that:

1. **Detects replies** from prospects via inbox sync
2. **Sends follow-up DMs** on Day 4 and Day 7 for non-responders
3. **Archives contacts** after Day 10 with no response
4. **Notifies humans** when prospects reply (via push + email)
5. **Generates AI summaries** of conversations with sentiment analysis

---

## Files Created

### 1. `notification_client.py` (205 lines)

Handles human notifications via macOS system integrations:

- **Push notifications** via macOS Notification Center (AppleScript)
- **Email notifications** via Mail.app (AppleScript)
- Test commands for verification
- Fully async with error handling

**Key Features:**
- Sends both push and email notifications simultaneously
- Includes conversation summary, sentiment, and recommended response
- Links directly to Supabase CRM dashboard
- Graceful degradation if notifications fail

### 2. `db/queries.py` — Extended (189 new lines)

Added 9 new query functions for follow-up agent:

- `get_contacts_with_replies()` — Find prospects who have replied
- `get_stale_contacted()` — Find contacts ready for first follow-up (Day 4)
- `get_stale_followup1()` — Find contacts ready for second follow-up (Day 7)
- `get_stale_followup2()` — Find contacts ready for archival (Day 10)
- `cancel_pending_followups()` — Cancel scheduled follow-ups when prospect replies
- `get_conversation_messages()` — Fetch conversation history
- `set_archived_at()` — Mark contact as archived
- `get_first_outreach()` — Get original outreach message
- `insert_human_notification()` — Alias for notification insertion

**Query Logic:**
- Uses `last_inbound_at > last_outbound_at` to detect replies
- Filters by pipeline stage and time thresholds
- Handles both DM and email sequences

### 3. `followup_agent.py` (589 lines)

Main agent implementation with full CLI:

**Components:**

#### ReplyDetector
- Triggers `crm_brain.py --sync` to pull latest messages
- Queries contacts with `last_inbound_at > last_outbound_at`
- Returns list of contacts who have replied

#### Reply Handler
- Advances stage to `replied`
- Cancels pending follow-ups (both DM and email)
- Generates AI conversation summary
- Sends human notifications (push + email)
- Records notification in database

#### Conversation Summary (Claude Haiku)
- Analyzes last 10 messages
- Returns: `{summary, sentiment, recommended_response}`
- Sentiment options: `positive`, `neutral`, `objection`, `interested`
- Fallback handling for API errors

#### Follow-up Generator (Claude Haiku)
- **Touch 2 (Day 4)**: Different angle, specific result/data point, ends with yes/no question
- **Touch 3 (Day 7)**: Final message, graceful close, leaves door open
- Uses original outreach message context
- Includes contact brief (platform, handle, ICP score, bio)

#### Follow-up Processor
- **Day 4**: Contacts in `contacted` stage → `follow_up_1`
- **Day 7**: Contacts in `follow_up_1` stage → `follow_up_2`
- **Day 10**: Contacts in `follow_up_2` stage → `archived`
- Generates messages via Claude
- Schedules via `acq_outreach_sequences`
- Records funnel events

**CLI Commands:**

```bash
# Full cycle: sync + detect replies + send follow-ups
python3 acquisition/followup_agent.py --process

# Show pending follow-ups
python3 acquisition/followup_agent.py --show-pending

# Dry-run mode (no actions taken)
python3 acquisition/followup_agent.py --dry-run
```

### 4. `tests/test_followup_agent.py` (426 lines)

Comprehensive test suite with 12 tests covering:

#### Reply Detection
- ✓ `test_reply_detector_uses_inbound_gt_outbound()`
- ✓ `test_stage_advances_to_replied_on_detection()`
- ✓ `test_pending_followups_cancelled_on_reply()`

#### Conversation Summary
- ✓ `test_conversation_summary_returns_valid_json()`

#### Notifications
- ✓ `test_push_notification_sent_on_reply()`
- ✓ `test_email_notification_sent_on_reply()`

#### Follow-up Timing
- ✓ `test_followup1_triggers_at_day4()`
- ✓ `test_followup2_triggers_at_day7()`
- ✓ `test_archive_after_followup2_no_reply()`

#### Message Generation
- ✓ `test_followup_message_generation_touch2()`
- ✓ `test_followup_message_generation_touch3()`

#### Integration
- ✓ `test_cancel_pending_email_on_dm_reply()`

**Test Status**: ✅ All 12 tests passing

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Follow-up Agent Cycle                    │
└─────────────────────────────────────────────────────────────┘

1. REPLY DETECTION
   └─> crm_brain.py --sync (pull latest messages)
   └─> Query contacts with last_inbound_at > last_outbound_at
   └─> For each reply:
       ├─> Update stage: contacted/follow_up_N → replied
       ├─> Cancel pending follow-ups
       ├─> Generate conversation summary (Claude)
       ├─> Store notification
       └─> Send push + email to human

2. FOLLOW-UP 1 (Day 4)
   └─> Query contacts in 'contacted' stage, no reply for 4 days
   └─> For each contact:
       ├─> Generate follow-up message (Claude, touch 2)
       ├─> Schedule via acq_outreach_sequences
       └─> Update stage: contacted → follow_up_1

3. FOLLOW-UP 2 (Day 7)
   └─> Query contacts in 'follow_up_1' stage, no reply for 3 days
   └─> For each contact:
       ├─> Generate final message (Claude, touch 3)
       ├─> Schedule via acq_outreach_sequences
       └─> Update stage: follow_up_1 → follow_up_2

4. ARCHIVE (Day 10)
   └─> Query contacts in 'follow_up_2' stage, no reply for 3 days
   └─> For each contact:
       ├─> Update stage: follow_up_2 → archived
       ├─> Set archived_at timestamp
       └─> Record funnel event (reason: no_reply_after_sequence)
```

---

## Pipeline Stages Managed

```
contacted ──(Day 4)──> follow_up_1 ──(Day 7)──> follow_up_2 ──(Day 10)──> archived
    │
    └──(reply detected)──> replied ──> (human takes over)
```

---

## Configuration

Uses values from `acquisition/config.py`:

```python
FOLLOWUP_1_DAYS = 4        # Days before first follow-up
FOLLOWUP_2_DAYS = 7        # Days before second follow-up
ARCHIVE_DAYS = 10          # Days before archival
OWNER_EMAIL                # Email for notifications
SUPABASE_URL               # CRM dashboard link
CLAUDE_MODEL_GENERATION    # Model for message generation
```

---

## Claude API Usage

**Model**: `claude-haiku-4-5-20251001` (fast + cheap)

**Prompts:**

1. **Conversation Summary** (~200 tokens)
   - Input: Last 10 messages
   - Output: JSON with `{summary, sentiment, recommended_response}`
   - Cost: ~$0.0002/summary

2. **Follow-up Touch 2** (~150 tokens)
   - Input: Original message context + contact brief
   - Output: Follow-up message (2-3 sentences)
   - Cost: ~$0.0001/message

3. **Follow-up Touch 3** (~120 tokens)
   - Input: Contact brief
   - Output: Final message (1-2 sentences)
   - Cost: ~$0.0001/message

**Total estimated cost per contact through full sequence**: ~$0.0004

---

## Dependencies

All dependencies already present in `requirements.txt`:

- `anthropic>=0.40.0` — Claude API
- Python stdlib: `asyncio`, `subprocess`, `json`, `urllib`
- No additional packages required

---

## Testing

Run tests:

```bash
cd /Users/isaiahdupree/Documents/Software/Safari\ Automation
python3 -m scripts.acquisition.tests.test_followup_agent
```

Test notification delivery:

```bash
# Test push notification
python3 -m acquisition.notification_client --test-push

# Test email notification
python3 -m acquisition.notification_client --test-email
```

---

## Integration with Other Agents

**Depends On:**
- **Agent 01** (Foundation): Database migrations, `crm_contacts` table
- **Agent 05** (Outreach): Contacts in `pipeline_stage='contacted'`
- **crm_brain.py**: `--sync` command for inbox synchronization

**Provides To:**
- **Agent 07** (Orchestrator): Reply notifications for human handoff
- **Agent 10** (Reporting): Follow-up conversion metrics

---

## Monitoring & Observability

**Logs:**
```
[ReplyDetector] Running: python3 crm_brain.py --sync
[ReplyDetector] Found 3 contacts with new replies
[ReplyHandler] Processing reply from Jane Doe (ID: abc-123)
[ReplyHandler] ✓ Reply processed for Jane Doe
[FollowUp1] Found 5 contacts ready for follow-up 1
[FollowUp1] Generated message: Quick follow-up...
[FollowUp1] ✓ Scheduled follow-up 1 for John Smith
[Archive] ✓ Archived Bob Johnson
```

**Database Tables Updated:**
- `crm_contacts` — `pipeline_stage`, `archived_at`
- `acq_outreach_sequences` — New follow-up messages
- `acq_email_sequences` — Cancelled on reply
- `acq_funnel_events` — Stage transitions
- `acq_human_notifications` — Reply notifications

---

## Production Deployment

### Cron Schedule

Add to orchestrator or crontab:

```bash
# Every 4 hours: detect replies + process follow-ups
0 */4 * * * cd /path/to/project && python3 acquisition/followup_agent.py --process >> logs/followup.log 2>&1
```

### Environment Variables

Required:
```bash
export ANTHROPIC_API_KEY=sk-ant-...
export OWNER_EMAIL=your@email.com
export SUPABASE_URL=https://your-project.supabase.co
export SUPABASE_SERVICE_KEY=your_service_key
```

### Human Notification Setup

**macOS Notification Center:**
- No additional setup required
- Notifications appear in system notification center
- Click to view full message

**Mail.app Integration:**
- Requires Mail.app to be configured with your email account
- AppleScript will create draft emails (visible:true)
- Human can review and send manually, or auto-send via settings

---

## Feature Checklist

- ✅ **AAG-065**: Reply detection via inbox sync
- ✅ **AAG-066**: Stage advancement to `replied`
- ✅ **AAG-067**: Cancel pending follow-ups on reply
- ✅ **AAG-068**: AI conversation summary generation
- ✅ **AAG-069**: Push notification delivery
- ✅ **AAG-070**: Email notification delivery
- ✅ **AAG-071**: Day 4 follow-up message generation + scheduling
- ✅ **AAG-072**: Day 7 final follow-up message generation + scheduling
- ✅ **AAG-073**: Day 10 archival with reason tracking
- ✅ **AAG-074**: Cross-channel follow-up cancellation (DM + email)
- ✅ **AAG-075**: Dry-run mode for testing

---

## Known Limitations

1. **macOS Only**: Push and email notifications use AppleScript (macOS-specific)
   - For Linux/Windows, swap with platform-specific notification systems

2. **Mail.app Required**: Email notifications assume Mail.app is configured
   - Alternative: Use SMTP directly (requires additional implementation)

3. **Sync Dependency**: Requires `crm_brain.py --sync` to pull latest messages
   - If sync fails, agent continues with existing data (non-blocking)

4. **No Real-time Detection**: Runs on schedule (e.g., every 4 hours)
   - For real-time reply detection, integrate webhook listeners

---

## Next Steps

### Immediate
- [ ] Add agent to orchestrator schedule (Agent 07)
- [ ] Configure cron job for production deployment
- [ ] Test end-to-end with real contacts

### Future Enhancements
- [ ] Real-time reply detection via webhooks
- [ ] A/B testing for follow-up message variants
- [ ] Sentiment-based follow-up customization
- [ ] Slack integration as alternative notification channel
- [ ] Follow-up sequence customization per niche

---

## Metrics to Track

Once deployed, monitor:

1. **Reply Rate**: % of contacts who reply after each touch
2. **Touch-to-Reply Time**: Average time from outreach to reply
3. **Notification Delivery**: Success rate of push/email notifications
4. **Archive Rate**: % of contacts archived without replying
5. **Follow-up Effectiveness**: Reply rate for Touch 2 vs Touch 3

Query via Agent 10 (Reporting) or directly:

```sql
SELECT
    touch_number,
    COUNT(*) as sent,
    SUM(CASE WHEN replied THEN 1 ELSE 0 END) as replies,
    ROUND(100.0 * SUM(CASE WHEN replied THEN 1 ELSE 0 END) / COUNT(*), 2) as reply_rate
FROM acq_outreach_sequences
WHERE status = 'sent'
GROUP BY touch_number;
```

---

**Implementation Complete**: All files created, tested, and ready for deployment. 🚀
