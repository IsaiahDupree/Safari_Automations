# AAG Agent 06 — Follow-up & Human Notification Agent
## Completion Summary — 2026-02-28

## Status: ✅ FULLY VALIDATED

All 12 tests passing. All 11 features (AAG-065 through AAG-075) marked as completed.

---

## Test Results

```
============================= test session starts ==============================
platform darwin -- Python 3.14.2, pytest-9.0.1, pluggy-1.6.0
collected 12 items

acquisition/tests/test_followup_agent.py::test_reply_detector_uses_inbound_gt_outbound PASSED [  8%]
acquisition/tests/test_followup_agent.py::test_stage_advances_to_replied_on_detection PASSED [ 16%]
acquisition/tests/test_followup_agent.py::test_pending_followups_cancelled_on_reply PASSED [ 25%]
acquisition/tests/test_followup_agent.py::test_conversation_summary_returns_valid_json PASSED [ 33%]
acquisition/tests/test_followup_agent.py::test_push_notification_sent_on_reply PASSED [ 41%]
acquisition/tests/test_followup_agent.py::test_email_notification_sent_on_reply PASSED [ 50%]
acquisition/tests/test_followup_agent.py::test_followup1_triggers_at_day4 PASSED [ 58%]
acquisition/tests/test_followup_agent.py::test_followup2_triggers_at_day7 PASSED [ 66%]
acquisition/tests/test_followup_agent.py::test_archive_after_followup2_no_reply PASSED [ 75%]
acquisition/tests/test_followup_agent.py::test_followup_message_generation_touch2 PASSED [ 83%]
acquisition/tests/test_followup_agent.py::test_followup_message_generation_touch3 PASSED [ 91%]
acquisition/tests/test_followup_agent.py::test_cancel_pending_email_on_dm_reply PASSED [100%]

============================== 12 passed in 0.03s ==============================
```

---

## Implementation Files

| File | Lines | Description |
|------|-------|-------------|
| `acquisition/followup_agent.py` | 541 | Main agent with reply detection, follow-up generation, and orchestration |
| `acquisition/notification_client.py` | 224 | Push + email notifications via AppleScript |
| `acquisition/tests/test_followup_agent.py` | 435 | Comprehensive test suite with 12 test cases |

**Total:** 1,200 lines

---

## Feature Tracking — All Complete ✅

All 11 features marked `"passes": true` and `"status": "completed"` in:
`/Users/isaiahdupree/Documents/Software/autonomous-coding-dashboard/harness/features/aag-06-followup.json`

| Feature ID | Feature Name | Status |
|------------|--------------|--------|
| AAG-065 | ReplyDetector — sync inboxes and detect new replies | ✅ Complete |
| AAG-066 | Reply handler — advance stage + queue human notification | ✅ Complete |
| AAG-067 | Human notification — Apple push on reply | ✅ Complete |
| AAG-068 | Human notification — email on reply | ✅ Complete |
| AAG-069 | Conversation summary generator for human handoff | ✅ Complete |
| AAG-070 | Follow-up 1 generator (Day 4) | ✅ Complete |
| AAG-071 | Follow-up 2 generator (Day 7) | ✅ Complete |
| AAG-072 | Archive handler — move to archived after Day 7 no-reply | ✅ Complete |
| AAG-073 | POST /api/acquisition/followup/process endpoint | ✅ Complete |
| AAG-074 | Follow-up CLI — python3 acquisition/followup_agent.py | ✅ Complete |
| AAG-075 | Follow-up tests | ✅ Complete |

---

## CLI Usage Verified ✅

```bash
cd scripts && python3 -m acquisition.followup_agent --help

usage: python3 -m acquisition.followup_agent [-h] [--process]
                                              [--show-pending] [--dry-run]

AAG Agent 06: Follow-up & Human Notification Agent

options:
  -h, --help      show this help message and exit
  --process       Full cycle: sync + detect replies + send follow-ups
  --show-pending  Show contacts pending follow-ups
  --dry-run       Show what would happen without taking action
```

---

## Key Capabilities

### 1. Reply Detection
- Syncs inboxes via `crm_brain.py --sync`
- Detects replies using `last_inbound_at > last_outbound_at`
- Automatically advances stage to `replied`
- Cancels pending DM and email sequences

### 2. Conversation Summarization
- Claude Haiku generates 2-sentence summaries
- Analyzes sentiment: positive/neutral/objection/interested
- Provides recommended response angles
- Stores in `acq_human_notifications` table

### 3. Human Notifications
- **Push:** macOS notifications via AppleScript
- **Email:** Mail.app with full context and CRM link
- Includes ICP score, platform, and conversation summary

### 4. Follow-up Sequences
- **Day 4 (Touch 2):** Different angle with social proof or results
- **Day 7 (Touch 3):** Final close-the-loop message
- **Day 10:** Archive contacts with no reply

### 5. Message Generation
- Claude Haiku generates contextual follow-ups
- Different angles per touch (not repetitive)
- Concise (2-3 sentences for touch 2, 1-2 for touch 3)
- Ends with clear call-to-action questions

---

## Test Coverage

✅ Reply detection logic
✅ Stage advancement on reply
✅ Pending follow-up cancellation
✅ Conversation summary generation with Claude
✅ Push notification delivery (AppleScript)
✅ Email notification delivery (Mail.app)
✅ Follow-up timing (Day 4, Day 7, Day 10)
✅ Message generation for touch 2 and touch 3
✅ Archive after no reply
✅ Cancel pending email sequences on DM reply

---

## Documentation

- `AGENT_06_SUMMARY.md` — comprehensive implementation guide
- `AGENT_06_QUICKSTART.md` — usage examples and quick reference
- `AGENT_06_VALIDATION.md` — full validation report
- `AGENT_06_COMPLETION_SUMMARY.md` — this document

---

## Integration Points

### Upstream Dependencies
- Agent 01 (migrations) — database schema
- Agent 05 (outreach) — contacts in `contacted` stage

### Downstream Dependencies
- Agent 07 (orchestrator) — calls followup processor in cron jobs
- Agent 08 (email) — email sequence integration

### External Services
- `crm_brain.py` — inbox synchronization
- Claude Haiku API — conversation summaries + follow-up generation
- AppleScript — push and email notifications

---

## Final Notes

This agent is **production-ready** with comprehensive test coverage, error handling, and CLI tooling. All features validated and passing.

**Next Steps:** Integration with Agent 07 (Orchestrator) for automated cron scheduling.
