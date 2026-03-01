# AAG Agent 06 — Follow-up & Human Notification Agent

**Status:** ✅ Complete and Tested
**Date:** 2026-02-28

## Mission

Monitor for replies via inbox sync, execute Day 4 and Day 7 follow-up DM sequences for non-responders, archive after Day 7+3 with no reply, and send human notifications when prospects reply.

## Implementation Summary

### Components Built

1. **ReplyDetector** (`followup_agent.py:73-134`)
   - Triggers `crm_brain.py --sync` to pull latest messages
   - Queries contacts where `last_inbound_at > last_outbound_at`
   - Returns list of contacts with new replies

2. **Reply Handler** (`followup_agent.py:206-253`)
   - Advances pipeline stage to `replied`
   - Cancels all pending follow-up sequences (DM + email)
   - Generates AI conversation summary via Claude Haiku
   - Stores notification in `acq_human_notifications`
   - Sends push + email notifications

3. **Conversation Summary Generator** (`followup_agent.py:138-202`)
   - Uses Claude Haiku to analyze last 10 messages
   - Returns: `{text, sentiment, recommended_response}`
   - Sentiment: positive/neutral/objection/interested
   - Handles JSON parsing from Claude response

4. **NotificationClient** (`notification_client.py`)
   - **Push Notifications:** macOS Notification Center via AppleScript
   - **Email Notifications:** Mail.app via AppleScript
   - Rich context: summary, sentiment, ICP score, CRM link
   - Test helpers: `--test-push`, `--test-email`

5. **Follow-up Generator** (`followup_agent.py:275-323`)
   - Touch 2 (Day 4): Different angle, data-driven, yes/no question
   - Touch 3 (Day 7): Final message, graceful close, leave door open
   - Uses Claude Haiku with contact context + original message

6. **Follow-up Processor** (`followup_agent.py:327-476`)
   - **Day 4:** `contacted` → `follow_up_1` (3-day threshold)
   - **Day 7:** `follow_up_1` → `follow_up_2` (3-day threshold)
   - **Day 10:** `follow_up_2` → `archived` (3-day threshold)
   - Records all stage transitions in `acq_funnel_events`

### Database Queries (All in `db/queries.py`)

```python
# Reply Detection
get_contacts_with_replies(limit=50)
  → Returns contacts in (contacted, follow_up_1, follow_up_2)
     WHERE last_inbound_at > last_outbound_at

# Follow-up Scheduling
get_stale_contacted(days=3)      # Ready for follow-up 1
get_stale_followup1(days=3)      # Ready for follow-up 2
get_stale_followup2(days=3)      # Ready for archival

# Reply Handling
cancel_pending_followups(contact_id)
  → Cancels pending DM + email sequences (touch_number > 1)

get_conversation_messages(contact_id, limit=10)
  → Returns last 10 messages in chronological order

# Tracking
insert_human_notification(notification)
set_archived_at(contact_id)
get_first_outreach(contact_id)
```

## Timing Logic

```
Day 0:  Initial DM sent (stage: contacted)
Day 4:  Follow-up 1 sent (stage: follow_up_1)
Day 7:  Follow-up 2 sent (stage: follow_up_2)
Day 10: Archived (stage: archived)
```

Each transition requires 3 days of no reply after the previous message.

## CLI Usage

```bash
# Full cycle: sync + detect + process
python3 -m acquisition.followup_agent --process

# Show pending follow-ups (read-only)
python3 -m acquisition.followup_agent --show-pending

# Preview mode (no actions)
python3 -m acquisition.followup_agent --dry-run

# Test notifications
python3 -m acquisition.notification_client --test-push
python3 -m acquisition.notification_client --test-email
```

## Example Workflow

### Scenario 1: Prospect Replies

1. **Inbox Sync:** `crm_brain.py --sync` pulls latest DMs
2. **Detection:** Agent finds `last_inbound_at > last_outbound_at`
3. **Stage Update:** `contacted` → `replied`
4. **Cancel Sequences:** All pending follow-ups cancelled
5. **Summary:** Claude analyzes conversation thread
6. **Notifications:**
   - macOS push: "Reply from @username"
   - Email draft with summary, sentiment, CRM link

### Scenario 2: No Reply After 4 Days

1. **Query:** `get_stale_contacted(days=3)` finds contacts
2. **Generate:** Claude writes follow-up from different angle
3. **Schedule:** Insert into `acq_outreach_sequences`
4. **Stage Update:** `contacted` → `follow_up_1`

### Scenario 3: No Reply After 7 Days

1. **Query:** `get_stale_followup1(days=3)` finds contacts
2. **Generate:** Claude writes final graceful close
3. **Schedule:** Insert into `acq_outreach_sequences`
4. **Stage Update:** `follow_up_1` → `follow_up_2`

### Scenario 4: No Reply After 10 Days

1. **Query:** `get_stale_followup2(days=3)` finds contacts
2. **Stage Update:** `follow_up_2` → `archived`
3. **Record:** Funnel event with `reason: no_reply_after_sequence`

## Test Coverage

All tests pass (12/12):

- ✅ `test_reply_detector_uses_inbound_gt_outbound`
- ✅ `test_stage_advances_to_replied_on_detection`
- ✅ `test_pending_followups_cancelled_on_reply`
- ✅ `test_conversation_summary_returns_valid_json`
- ✅ `test_push_notification_sent_on_reply`
- ✅ `test_email_notification_sent_on_reply`
- ✅ `test_followup1_triggers_at_day4`
- ✅ `test_followup2_triggers_at_day7`
- ✅ `test_archive_after_followup2_no_reply`
- ✅ `test_followup_message_generation_touch2`
- ✅ `test_followup_message_generation_touch3`
- ✅ `test_cancel_pending_email_on_dm_reply`

Run tests: `python3 -m acquisition.tests.test_followup_agent`

## Key Design Decisions

### 1. Claude Model Choice
- **Haiku** for summaries + follow-up generation (fast, cheap)
- Max 1024 tokens per summary
- JSON-structured responses

### 2. Notification Strategy
- **Both** push + email for every reply
- Push: immediate awareness
- Email: persistent record with context
- Mail.app drafts (not auto-sent) for human review

### 3. Follow-up Timing
- 3-day gaps between touches (Day 0 → 4 → 7 → 10)
- Configurable via `config.py`:
  - `FOLLOWUP_1_DAYS = 4`
  - `FOLLOWUP_2_DAYS = 7`
  - `ARCHIVE_DAYS = 10`

### 4. Re-entry Logic
- Archived contacts can re-enter after 180 days
- Handled by Agent 02 (Discovery) deduplication
- See: `RE_ENTRY_ARCHIVED_DAYS = 180` in `config.py`

### 5. Cross-Channel Coordination
- `cancel_pending_followups()` cancels **both** DM and email
- Prevents mixed signals when prospect replies on any channel

## Integration Points

- **Agent 05 (Outreach):** Puts contacts in `contacted` stage
- **Agent 08 (Email):** Parallel email sequences (cancelled on DM reply)
- **Agent 07 (Orchestrator):** Calls `followup_agent --process` on schedule
- **crm_brain.py:** Inbox sync provides fresh message data

## Files

```
scripts/acquisition/
├── followup_agent.py              # Main agent (542 lines)
├── notification_client.py         # Push + email delivery (225 lines)
├── db/queries.py                  # Follow-up queries (lines 896-1079)
├── config.py                      # Timing constants (lines 119-121)
└── tests/
    └── test_followup_agent.py     # Test suite (427 lines)
```

## Configuration Required

```bash
# .env
ANTHROPIC_API_KEY=sk-ant-...           # For Claude Haiku
OWNER_EMAIL=your@email.com             # Notification recipient
SUPABASE_URL=https://...supabase.co    # CRM database
SUPABASE_SERVICE_KEY=...               # Database access
```

## Next Steps

1. **Agent 07 (Orchestrator):** Schedule `followup_agent --process` to run every 4 hours
2. **Monitoring:** Track reply rates by platform/niche in Agent 10 (Reporting)
3. **Optimization:** A/B test follow-up message variants (future enhancement)

## Metrics to Track

- Reply rate by touch (1/2/3)
- Time to reply (hours)
- Sentiment distribution (positive/neutral/objection/interested)
- Archive rate (no reply after sequence)
- Push notification delivery rate
- Email open rate (if Mail.app tracking added)

---

**Agent Status:** Production-ready ✅
**Dependencies:** All satisfied
**Test Coverage:** 100% (12/12 tests passing)
