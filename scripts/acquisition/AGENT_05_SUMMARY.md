# AAG Agent 05 — Outreach Agent — Implementation Summary

## Status: ✅ COMPLETE & VALIDATED

All features implemented and tested (18/18 tests passing).

**Last Updated:** 2026-02-28 (improvements applied)

---

## Recent Improvements (2026-02-28)

### 🔧 Fixed Critical Gaps

While the outreach agent was largely complete, two critical database operations were missing:

1. **Added crm_messages recording**
   - Previously had a TODO comment in TouchRecorder
   - Now properly calls `queries.insert_crm_message()` on every touch
   - Critical for reply detection and reporting metrics
   - Required by Agent 06 (Follow-up) and Agent 10 (Reporting)

2. **Added last_outbound_at timestamp tracking**
   - New query functions added:
     - `update_last_outbound_at(contact_id, timestamp)`
     - `update_last_inbound_at(contact_id, timestamp)` (for future use)
   - Called by TouchRecorder after every send
   - Critical for follow-up timing logic
   - Used by Agent 06 to determine stale contacts (3-day follow-up window)

3. **Updated test suite**
   - Added mocks for `insert_crm_message` in TouchRecorder tests
   - Added mocks for `update_last_outbound_at` in TouchRecorder tests
   - Verified all database writes are properly tested
   - All 18 tests still passing ✅

### Impact

These fixes ensure:
- **Complete audit trail** — Every DM is recorded in crm_messages for reply detection
- **Accurate timing** — Follow-up agent can correctly identify stale contacts
- **Reporting accuracy** — Weekly reports show true message counts
- **Reply detection** — System can compare last_inbound_at vs last_outbound_at

---

## What Was Built

### 1. OutreachAgent (`outreach_agent.py`)
Full-featured outreach automation with Claude-powered DM generation.

**Components:**
- `OutreachAgent` - Main agent orchestrator
- `ContextBuilder` - Builds rich contact context from posts and scores
- `DMGenerator` - Generates personalized DMs using Claude Sonnet
- `MessageValidator` - Validates messages against quality criteria
- `DMSender` - Routes DMs to platform-specific services
- `TouchRecorder` - Records all touches in database

**Features:**
- ✅ Fetches contacts in `pipeline_stage='ready_for_dm'`
- ✅ Builds context from top posts via market research API
- ✅ Generates personalized DMs using Claude (model: haiku)
- ✅ Validates messages for:
  - Length limits per platform
  - Banned phrases (9 common sales phrases)
  - Specific content references
- ✅ Routes to correct platform DM service:
  - Instagram, Twitter, TikTok: single-step
  - LinkedIn: 2-step (open + send)
- ✅ Enforces daily caps before sending
- ✅ Records touches in:
  - `crm_messages` (actual message content)
  - `acq_outreach_sequences` (sequence tracking)
  - `crm_contacts` (updates pipeline_stage to 'contacted' + last_outbound_at)
  - `acq_funnel_events` (via update_pipeline_stage)
- ✅ Dry-run mode for testing
- ✅ Full CLI interface

### 2. ChannelCoordinator (`channel_coordinator.py`)
Prevents conflicts between DM and email outreach channels.

**Features:**
- ✅ Determines active channel (DM vs Email)
- ✅ LinkedIn + email → prefer email
- ✅ Other platforms → prefer DM
- ✅ Blocks email when DM sequence active
- ✅ Blocks DM when email sequence active
- ✅ Pauses email if DM gets reply
- ✅ Cancels DM if email gets reply
- ✅ Switches to email after DM archived (10+ days, no reply)
- ✅ Emergency block (unsubscribe, complaints)

### 3. Test Suite (`tests/test_outreach_agent.py`)
Comprehensive test coverage (18 tests, all passing).

**Test Coverage:**
- ✅ Message validation (banned phrases, length, quality)
- ✅ Context building (top posts, scores)
- ✅ DM generation (Claude API integration)
- ✅ DM sending (platform routing, LinkedIn 2-step)
- ✅ Daily cap enforcement
- ✅ Touch recording (all tables)
- ✅ Channel coordination (DM/email conflicts)
- ✅ End-to-end agent execution

---

## Usage

### CLI Commands

```bash
# Preview mode: Generate DMs but don't send
python3 scripts/acquisition/outreach_agent.py --generate --limit 5

# Send DMs to 10 contacts
python3 scripts/acquisition/outreach_agent.py --send --limit 10

# Dry run: Full validation, no actual sends
python3 scripts/acquisition/outreach_agent.py --dry-run --limit 20

# Specify service offering
python3 scripts/acquisition/outreach_agent.py --send --service linkedin-lead-gen --limit 5
```

### Service Options
- `ai-content-engine` (default) - AI automation for content creators
- `linkedin-lead-gen` - B2B lead generation for agencies
- `social-outreach` - Multi-platform outreach automation

### Python API

```python
from acquisition.outreach_agent import OutreachAgent

agent = OutreachAgent()

# Run outreach
result = await agent.run(
    service_slug="ai-content-engine",
    limit=10,
    dry_run=False
)

print(f"Sent: {result.successful}, Failed: {result.failed}")
```

---

## Message Quality Standards

### Validation Criteria
Messages are scored out of 10:
- **-4 points**: Exceeds platform length limit
- **-3 points**: Each banned phrase
- **-2 points**: No specific content reference

**Pass threshold**: 7/10 or higher

### Banned Phrases
1. "hope this finds you"
2. "reaching out"
3. "quick call"
4. "pick your brain"
5. "synergy"
6. "i noticed your profile"
7. "would love to connect"
8. "let me know if you're interested"
9. "free consultation"

### Platform Limits
- Twitter: 280 chars
- Instagram: 1000 chars
- TikTok: 500 chars
- LinkedIn: 500 chars

---

## Message Generation Prompt

The agent uses Claude with this framework:

```
You are writing a personalized first DM to a prospect on {platform}.

Contact context:
- Name: {display_name}
- Platform: {platform} (@{handle})
- ICP Score: {score}/100
- Score reasoning: {score_reasoning}
- Their top post: "{top_post_text}" ({top_post_likes} likes)
- Their niche: {niche}

Service being offered: {service_description}

Write a first DM that:
1. Opens with ONE specific reference to their content
2. Delivers a genuine insight or observation (1-2 sentences)
3. Makes a soft, low-pressure ask (NOT a pitch, NOT a meeting request)
4. Feels like a peer reaching out, not a vendor
5. Max 4 sentences. No emojis. No corporate speak.
```

---

## Database Schema

### Tables Written To

**crm_messages** (NEW - added 2026-02-28)
```sql
- contact_id (uuid)
- message_type (text) -- 'dm', 'comment', 'email'
- is_outbound (boolean) -- true for outreach
- message_text (text)
- sent_at (timestamp)
```

**acq_outreach_sequences**
```sql
- contact_id (uuid)
- service_slug (text)
- touch_number (int)
- message_text (text)
- platform (text)
- sent_at (timestamp)
- status (text) -- 'sent', 'failed', 'archived'
- platform_message_id (text)
```

**crm_contacts** (updated)
```sql
- pipeline_stage → 'contacted'
- last_outbound_at → current timestamp (NEW - added 2026-02-28)
```

**acq_funnel_events** (via update_pipeline_stage)
```sql
- contact_id
- from_stage → 'ready_for_dm'
- to_stage → 'contacted'
- triggered_by → 'outreach_agent'
```

---

## DM Service Endpoints

The agent sends DMs via these running services:

```python
# Standard platforms (single POST)
POST http://localhost:3001/api/messages/send-to  # Instagram
POST http://localhost:3003/api/messages/send-to  # Twitter
POST http://localhost:3102/api/messages/send-to  # TikTok

# LinkedIn (2-step)
POST http://localhost:3105/api/linkedin/messages/open    # Step 1
POST http://localhost:3105/api/linkedin/messages/send    # Step 2
```

**Request format (standard):**
```json
{
  "username": "johndoe",
  "message": "Your personalized DM here..."
}
```

**LinkedIn Step 1:**
```json
{
  "participantName": "John Doe"
}
```

**LinkedIn Step 2:**
```json
{
  "text": "Your personalized DM here..."
}
```

---

## Daily Caps Integration

The agent checks and increments daily caps before every send:

```python
from acquisition.db import queries

# Check cap
can_send, err = queries.increment_daily_cap("dm", "twitter")

if not can_send:
    # Block send, log error
```

**Default caps:**
- Instagram DM: 20/day
- Twitter DM: 50/day
- TikTok DM: 30/day
- LinkedIn DM: 50/day

Caps reset at midnight UTC (managed by `acq_daily_caps` table).

---

## Channel Coordination

### Rules

1. **LinkedIn with email** → Prefer email channel
2. **Other platforms** → Prefer DM channel
3. **DM active** → Block email
4. **Email active** → Block DM
5. **DM reply** → Pause email sequences
6. **Email reply** → Cancel DM sequences
7. **DM archived + 10 days** → Switch to email
8. **Contact in 'replied' stage** → No automated outreach (human takeover)

### Emergency Block

```python
from acquisition.channel_coordinator import ChannelCoordinator

coordinator = ChannelCoordinator()

# Block all outreach (e.g., unsubscribe)
coordinator.block_outreach(
    contact_id="contact_123",
    reason="unsubscribed"
)
```

---

## Testing

### Run All Tests

```bash
cd /Users/isaiahdupree/Documents/Software/Safari\ Automation
python3 -m pytest scripts/acquisition/tests/test_outreach_agent.py -v
```

### Test Output

```
18 tests collected

TestMessageValidator
  ✓ test_accepts_good_message
  ✓ test_multiple_banned_phrases
  ✓ test_rejects_banned_phrases
  ✓ test_rejects_too_long

TestContextBuilder
  ✓ test_build_context_includes_top_posts

TestDMGenerator
  ✓ test_generate_dm_calls_claude

TestDMSender
  ✓ test_daily_cap_blocks_send
  ✓ test_dry_run_returns_success
  ✓ test_linkedin_uses_two_step
  ✓ test_send_standard_platform

TestTouchRecorder
  ✓ test_records_failed_touch
  ✓ test_records_touch_in_all_tables

TestChannelCoordinator
  ✓ test_blocks_email_during_dm
  ✓ test_cancel_dm_if_email_replied
  ✓ test_linkedin_with_email_prefers_email
  ✓ test_pause_email_if_dm_replied

TestOutreachAgent
  ✓ test_handles_no_contacts
  ✓ test_processes_contact_successfully

============================== 18 passed in 2.09s ==============================
```

---

## Dependencies

From `requirements.txt`:

```
anthropic>=0.40.0          # Claude API for DM generation
httpx>=0.27.0              # Async HTTP (future enhancement)
pydantic>=2.5.0            # Data validation
python-dotenv>=1.0.0       # Environment variables
```

### Environment Variables Required

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export SUPABASE_URL=https://your-project.supabase.co
export SUPABASE_SERVICE_KEY=your_service_key
```

---

## Integration Points

### Upstream Dependencies (Agent 04)
- Requires contacts in `pipeline_stage='ready_for_dm'`
- Warmup agent should have moved contacts from 'warming' → 'ready_for_dm'

### Downstream Dependencies (Agent 06)
- Follow-up agent will detect replies and send follow-up sequences
- Follow-up agent reads from `acq_outreach_sequences` to determine next touch

### External Services
- Market Research API (port 3106) - provides post data
- Platform DM services (ports 3001, 3003, 3102, 3105)
- Claude API (Anthropic)
- Supabase (database)

---

## File Structure

```
scripts/acquisition/
├── outreach_agent.py          # 650 lines - Main agent
├── channel_coordinator.py      # 220 lines - Channel logic
└── tests/
    └── test_outreach_agent.py  # 450 lines - 18 tests
```

---

## Next Steps

### To Make It Production-Ready

1. **Deploy database migrations** (if not already done):
   ```bash
   psql $DATABASE_URL -f scripts/acquisition/db/migrations/001_acquisition_tables.sql
   psql $DATABASE_URL -f scripts/acquisition/db/migrations/002_crm_contacts_columns.sql
   ```

2. **Start market research service** (port 3106)

3. **Verify platform DM services are running**:
   - Instagram DM: port 3001
   - Twitter DM: port 3003
   - TikTok DM: port 3102
   - LinkedIn Messages: port 3105

4. **Set environment variables** in `.env`

5. **Run in dry-run mode first**:
   ```bash
   python3 scripts/acquisition/outreach_agent.py --dry-run --limit 5
   ```

6. **Monitor first real sends**:
   ```bash
   python3 scripts/acquisition/outreach_agent.py --send --limit 3
   ```

7. **Schedule with Orchestrator** (Agent 07)

---

## Success Metrics

The agent tracks:
- **Contacts processed**: Total contacts attempted
- **Successful sends**: DMs successfully delivered
- **Validation failures**: Messages that didn't meet quality standards
- **Daily cap blocks**: Sends blocked by rate limits
- **Platform errors**: API/service failures

Check `acq_outreach_sequences` table for full audit trail.

---

## Built By
Claude Code (Sonnet 4.5)
Date: 2026-02-28

Feature spec: AAG-051 through AAG-064, AAG-139, AAG-140
