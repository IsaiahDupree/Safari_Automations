# AAG Agent 05 — Outreach Agent: QUICKSTART

**Status:** ✅ Production Ready
**Last Updated:** 2026-02-28

## What Is It?

The Outreach Agent generates personalized first DMs using Claude (informed by contacts' actual posts), sends them via platform-specific services, and coordinates with the email channel to prevent conflicts.

---

## Quick Start (5 Minutes)

### 1. Prerequisites

```bash
# Environment variables required
export ANTHROPIC_API_KEY="sk-ant-..."
export SUPABASE_URL="https://your-project.supabase.co"
export SUPABASE_SERVICE_KEY="your-service-key"

# Platform services must be running
# Instagram DM:  http://localhost:3001
# Twitter DM:    http://localhost:3003
# TikTok DM:     http://localhost:3102
# LinkedIn DM:   http://localhost:3105
# Market Research: http://localhost:3106
```

### 2. Preview Mode (Safe — No Sends)

```bash
cd /Users/isaiahdupree/Documents/Software/Safari\ Automation/scripts

# Generate 5 DMs without sending
python3 -m acquisition.outreach_agent --generate --limit 5
```

**Output:**
```
🚀 Starting outreach run (service=ai-content-engine, limit=5, dry_run=True)
🔍 Running in preview/dry-run mode - no messages will be sent
📋 Found 5 contacts ready for DM

🎯 Processing Jane Doe (twitter)...
💬 Generated: Loved your post about AI automation for solopreneurs. Have you tried batching...
✔️  Validation: score=10, passed=True
[DRY RUN] Would send to Jane Doe: Loved your post about AI automation...

============================================================
OUTREACH SUMMARY
============================================================
Total processed: 5
Successful:      5
Failed:          0
Skipped:         0
============================================================
```

### 3. Production Send (Actually Sends DMs)

```bash
# Send to 10 contacts
python3 -m acquisition.outreach_agent --send --limit 10
```

**Output:**
```
🚀 Starting outreach run (service=ai-content-engine, limit=10, dry_run=False)
📋 Found 10 contacts ready for DM

🎯 Processing Jane Doe (twitter)...
💬 Generated: Loved your post about AI automation for solopreneurs. Have you tried...
✔️  Validation: score=10, passed=True
✅ Recorded touch for Jane Doe

🎯 Processing John Smith (instagram)...
💬 Generated: Your content strategy framework is spot-on. Curious if you've tested...
✔️  Validation: score=9, passed=True
✅ Recorded touch for John Smith

============================================================
OUTREACH SUMMARY
============================================================
Total processed: 10
Successful:      10
Failed:          0
Skipped:         0
============================================================
```

---

## Common Commands

### Preview/Test Commands
```bash
# Generate DMs without sending (safe)
python3 -m acquisition.outreach_agent --generate --limit 5

# Dry run (validates everything but doesn't send)
python3 -m acquisition.outreach_agent --dry-run --limit 10

# Preview specific service
python3 -m acquisition.outreach_agent --generate --service linkedin-lead-gen
```

### Production Commands
```bash
# Send 10 DMs (default service: ai-content-engine)
python3 -m acquisition.outreach_agent --send --limit 10

# Send 20 DMs for LinkedIn lead gen service
python3 -m acquisition.outreach_agent --send --service linkedin-lead-gen --limit 20

# Send 50 DMs for social outreach service
python3 -m acquisition.outreach_agent --send --service social-outreach --limit 50
```

### Help
```bash
python3 -m acquisition.outreach_agent --help
```

---

## How It Works (Simple Version)

```
1. Fetch contacts from database (pipeline_stage='ready_for_dm')
   ↓
2. For each contact:
   a. Get their top 3 posts from Market Research API
   b. Get their ICP score and reasoning
   c. Build context brief
   ↓
3. Generate personalized DM using Claude Haiku
   - References specific post content
   - Includes genuine insight
   - Soft ask (not a pitch)
   - Max 4 sentences
   ↓
4. Validate message
   - Check length (platform limits)
   - Check for banned phrases
   - Check for specific reference
   - Must score >= 7/10 to pass
   ↓
5. Check daily cap for platform
   ↓
6. Send via platform service
   - Instagram/Twitter/TikTok: Single endpoint
   - LinkedIn: Two-step (open + send)
   ↓
7. Record touch in 4 tables:
   - crm_messages (the actual message)
   - acq_outreach_sequences (sequence tracking)
   - crm_contacts (update stage to 'contacted')
   - acq_funnel_events (transition event)
```

---

## Service Offerings

### ai-content-engine
**Target:** Solopreneurs, content creators
**Pitch:** AI-powered content engine for scaling output
**Platforms:** Instagram, Twitter, TikTok
**Example DM:**
> Loved your post about AI automation for solopreneurs. Have you tried batching content with Claude? Would love to share what we're seeing work for accounts like yours.

### linkedin-lead-gen
**Target:** B2B agencies, service businesses
**Pitch:** LinkedIn lead generation system
**Platforms:** LinkedIn, Twitter
**Example DM:**
> Your framework for scaling B2B outreach is solid. Curious if you've tested automated follow-up sequences. Happy to share what's working for agencies in your space.

### social-outreach
**Target:** Creators, agencies
**Pitch:** Multi-platform outreach automation
**Platforms:** All platforms
**Example DM:**
> Loved your take on building relationships at scale. Have you tried personalized DM sequences? Would love to share what we're seeing work.

---

## Daily Caps (Rate Limits)

Agent automatically enforces daily caps per platform:

| Platform  | Daily Limit |
|-----------|-------------|
| Instagram | 20 DMs      |
| Twitter   | 50 DMs      |
| TikTok    | 30 DMs      |
| LinkedIn  | 50 DMs      |

**What happens at limit?**
- Send blocked before API call
- Contact stays in 'ready_for_dm' queue
- Retry next day when caps reset

**Reset time:** UTC midnight (automated by orchestrator)

---

## Message Quality Rules

### ✅ Good Message Example
```
Loved your post about AI automation for solopreneurs. Have you tried
batching content with Claude? Would love to share what we're seeing
work for accounts like yours.
```

**Why it passes:**
- ✅ Specific reference ("AI automation for solopreneurs")
- ✅ Genuine insight (batching with Claude)
- ✅ Soft ask (not a pitch)
- ✅ Peer-to-peer tone
- ✅ Under 280 chars (Twitter limit)
- ✅ No banned phrases

### ❌ Bad Message Example
```
Hope this finds you well! I'm reaching out because I noticed your
profile and would love to connect. Do you have time for a quick call
to pick your brain about AI automation? I offer a free consultation.
```

**Why it fails:**
- ❌ "Hope this finds you well" (banned)
- ❌ "reaching out" (banned)
- ❌ "quick call" (banned)
- ❌ "pick your brain" (banned)
- ❌ "free consultation" (banned)
- ❌ No specific reference to their content
- ❌ Sounds like a vendor pitch

### Banned Phrases (Auto-Rejected)
- "hope this finds you"
- "reaching out"
- "quick call"
- "pick your brain"
- "synergy"
- "i noticed your profile"
- "would love to connect"
- "let me know if you're interested"
- "free consultation"

---

## Troubleshooting

### "No contacts ready for DM"
**Problem:** Agent finds 0 contacts
**Solution:**
```bash
# Check warmup agent has run
python3 -m acquisition.warmup_agent --run

# Manually advance a contact for testing
UPDATE crm_contacts SET pipeline_stage='ready_for_dm' WHERE id='contact_123';
```

### "Daily cap reached"
**Problem:** Hit platform send limit
**Solution:**
- Wait until next day (caps reset at UTC midnight)
- Or manually reset caps:
```bash
python3 -m acquisition.daily_caps --reset
```

### "Claude API error"
**Problem:** API key invalid or quota exceeded
**Solution:**
```bash
# Check API key is set
echo $ANTHROPIC_API_KEY

# Test API directly
curl https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{"model":"claude-haiku-4-5-20251001","max_tokens":100,"messages":[{"role":"user","content":"test"}]}'
```

### "Platform API connection refused"
**Problem:** DM service not running
**Solution:**
```bash
# Check which services are running
lsof -i :3001  # Instagram
lsof -i :3003  # Twitter
lsof -i :3102  # TikTok
lsof -i :3105  # LinkedIn

# Start missing services
cd packages/instagram-automation && npm start
cd packages/twitter-automation && npm start
cd packages/tiktok-automation && npm start
cd packages/linkedin-automation && npm start
```

### "Market Research API unavailable"
**Problem:** Can't fetch top posts
**Solution:**
- Agent continues with fallback (no posts)
- DM generation still works
- Start Market Research service:
```bash
cd packages/market-research && npm start
```

### "Validation failed: no_specific_reference"
**Problem:** Claude generated generic message
**Solution:**
- Check contact has posts in crm_market_research
- Re-run to regenerate (Claude varies output)
- Adjust prompt if pattern persists

---

## Channel Coordination

### DM vs Email (Automatic)

**Rule:** Only one active channel per contact at a time

**LinkedIn contacts with email:**
- Prefer email channel
- DM used as backup if email fails

**Other platforms:**
- Prefer DM channel
- Email used after DM archived (10+ days, no reply)

**On reply:**
- DM reply → pause all email sequences
- Email reply → cancel all DM sequences

**Check active channel:**
```python
from acquisition.channel_coordinator import ChannelCoordinator

coordinator = ChannelCoordinator()
active = coordinator.get_active_channel(contact)
# Returns: "dm" | "email" | "none"
```

---

## Testing

### Run All Tests
```bash
cd scripts
python3 -m pytest acquisition/tests/test_outreach_agent.py -v
```

**Expected:** 18/18 passing

### Run Specific Test
```bash
# Test message validation
python3 -m pytest acquisition/tests/test_outreach_agent.py::TestMessageValidator -v

# Test DM sender
python3 -m pytest acquisition/tests/test_outreach_agent.py::TestDMSender -v

# Test channel coordinator
python3 -m pytest acquisition/tests/test_outreach_agent.py::TestChannelCoordinator -v
```

---

## Performance

**Speed:**
- Context building: ~200ms
- DM generation: ~2-3s (Claude Haiku)
- Validation: <1ms
- Send: ~500ms
- Recording: ~100ms
- **Total:** ~3-4s per contact

**Throughput:**
- 10 contacts: ~30 seconds
- 50 contacts: ~3 minutes
- 100 contacts: ~6 minutes

**Cost (Claude Haiku):**
- Per contact: ~$0.0002
- 3000 contacts/month: ~$0.60

---

## Integration with Other Agents

### Before Outreach Agent
- **Agent 02 (Discovery):** Discovers prospects
- **Agent 03 (Scoring):** Scores prospects 0-100
- **Agent 04 (Warmup):** Engages via comments, moves to 'ready_for_dm'

### After Outreach Agent
- **Agent 06 (Follow-up):** Sends Day 4, 7, 10 follow-ups
- **Agent 08 (Email):** Coordinates via ChannelCoordinator

### Data Sources
- **Market Research API:** Top posts for personalization
- **acq_daily_caps:** Rate limit tracking
- **crm_score_history:** Latest ICP score/reasoning

---

## Safety Features

### Dry Run Mode
- Validates everything
- Doesn't send
- Doesn't increment caps
- Safe for testing

### Daily Caps
- Prevents platform bans
- Auto-enforced per platform
- Resets daily at UTC midnight

### Message Validation
- Rejects spammy messages
- Enforces quality rules
- Prevents banned phrases

### Channel Coordination
- Prevents DM/email conflicts
- Auto-pauses conflicting sequences
- Emergency block function

---

## Next Steps

1. ✅ Run in preview mode to see generated DMs
2. ✅ Validate message quality
3. ✅ Start with small batch (5-10 contacts)
4. ✅ Monitor results in database
5. ✅ Scale up gradually
6. ✅ Set up orchestrator for automation

---

## Related Documentation

- `AGENT_05_SUMMARY.md` — Complete technical documentation
- `AGENT_05_VALIDATION_REPORT.md` — Full test validation
- `AGENT_04_SUMMARY.md` — Warmup Agent (populates ready_for_dm)
- `AGENT_06_SUMMARY.md` — Follow-up Agent (handles touches 2-3)

---

**Questions?** Check the full summary or validation report for deeper technical details.
