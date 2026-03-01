# AAG Agent 03 — ICP Scoring Agent

**Status:** ✅ Complete & Validated
**Date:** 2026-02-28
**Test Results:** 16/16 passing

## Overview

The ICP Scoring Agent (Agent 03) is a Claude-powered scoring system that evaluates newly discovered contacts against an ideal customer profile (ICP), assigns them a 0-100 score, and automatically routes them to either `qualified` or `archived` pipeline stages.

## Key Features

### ✅ Claude-Powered Scoring
- Uses **Claude Haiku** (claude-haiku-4-5-20251001) for cost-efficient scoring
- Single contact scoring with detailed reasoning
- Batch scoring (up to 20 contacts per API call) for efficiency
- Automatic fallback to individual scoring if batch parsing fails
- Handles markdown-wrapped JSON responses

### ✅ Score History Tracking
- Every score written to `crm_score_history` table
- Tracks score, reasoning, signals, model used, and timestamp
- Updates `crm_contacts.relationship_score` and `last_scored_at`
- Maintains full audit trail of all scoring decisions

### ✅ Automatic Routing
- Qualified: score >= `icp_min_score` → `qualified` stage
- Archived: score < `icp_min_score` → `archived` stage
- Records funnel events for analytics
- Respects per-niche scoring thresholds

### ✅ Re-scoring Stale Contacts
- Re-scores contacts with `last_scored_at > 30 days`
- Useful when market research data is updated
- CLI flag: `--rescore-stale`

### ✅ Rich CLI Interface
- Score distribution histogram
- Real-time progress display with emoji indicators
- Dry-run mode for testing
- Niche-specific filtering
- Error reporting

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Scoring Agent Workflow                   │
└─────────────────────────────────────────────────────────────┘

1. Fetch Contacts
   ├─ Query: crm_contacts WHERE relationship_score IS NULL
   ├─ Filter: pipeline_stage = 'new'
   └─ Order: created_at ASC (oldest first)

2. Group by Niche
   ├─ Fetch niche config for each group
   ├─ Use niche-specific scoring_prompt
   └─ Use niche-specific icp_min_score

3. Batch Score (20 at a time)
   ├─ Single contact → score_contact() directly
   ├─ Multiple contacts → batch_score() → Claude API
   └─ Parse JSON response (single or batch format)

4. Route Contact
   ├─ score >= min_score → 'qualified'
   └─ score < min_score → 'archived'

5. Write Results
   ├─ Insert into crm_score_history
   ├─ Update crm_contacts.relationship_score
   ├─ Update pipeline_stage
   └─ Record funnel event
```

## Database Schema

### crm_score_history
```sql
contact_id      UUID          -- FK to crm_contacts
score           INT           -- 0-100 ICP score
reasoning       TEXT          -- One-sentence explanation
signals         TEXT[]        -- Key signals detected
model_used      TEXT          -- Claude model identifier
scored_at       TIMESTAMPTZ   -- When scored
```

### crm_contacts (updated fields)
```sql
relationship_score  INT          -- Most recent score (0-100)
last_scored_at      TIMESTAMPTZ  -- When last scored
pipeline_stage      TEXT         -- Updated based on score
```

## Default Scoring Prompt

```
Ideal customer: a business owner, coach, consultant, or creator who:
- Posts actively (at least weekly)
- Has 1,000–500,000 followers (not mega-celebrity, not micro-nano)
- Talks about growth, business, content strategy, or audience building
- Would benefit from AI-powered content or outreach automation
- Is NOT already a SaaS tool, agency, or competitor
```

Each niche config can override this with a custom `scoring_prompt`.

## CLI Usage

### Basic Scoring
```bash
# Score all new contacts (default limit: 50)
python3 -m acquisition.scoring_agent --run

# Score with custom limit
python3 -m acquisition.scoring_agent --run --limit 20

# Score specific niche only
python3 -m acquisition.scoring_agent --run --niche-id <UUID>

# Dry run (no writes)
python3 -m acquisition.scoring_agent --run --dry-run
```

### Re-scoring Stale Contacts
```bash
# Re-score contacts older than 30 days
python3 -m acquisition.scoring_agent --run --rescore-stale

# Re-score stale for specific niche
python3 -m acquisition.scoring_agent --run --rescore-stale --niche-id <UUID>
```

## Example Output

```
🎯 Scoring Agent starting...
   Mode: NEW CONTACTS
   Limit: 50

📋 Found 12 contacts to score

📊 Scoring 12 contacts for niche: ai-automation-coaches
   Min score: 65

   ✅ Jane Doe → 85/100 → qualified
      💭 Perfect ICP match: business coach with 15K followers, talks about growth and AI...
   ✅ John Smith → 72/100 → qualified
      💭 Good fit: consultant with engaged audience, posts about automation...
   ❌ Random User → 45/100 → archived
      💭 Too small (500 followers), no business focus...

============================================================
📈 Scoring Complete
   Total scored: 12
   Qualified: 8
   Archived: 4

📊 Score Distribution:
   0-49:      4 ████
   50-64:     0
   65-79:     5 █████
   80-100:    3 ███
```

## Test Coverage

All 16 tests passing:

### Prompt Parsing (4 tests)
- ✅ Valid JSON response parsing
- ✅ Markdown-wrapped JSON handling
- ✅ Invalid JSON graceful failure
- ✅ Claude API error handling

### Batch Scoring (3 tests)
- ✅ Batch scoring up to 20 contacts
- ✅ Fallback to individual on batch parse fail
- ✅ Single contact uses individual scoring

### Routing (3 tests)
- ✅ Score >= threshold → qualified
- ✅ Score < threshold → archived
- ✅ Edge case: exact threshold → qualified

### Score History (1 test)
- ✅ Scores written to crm_score_history

### Full Run Workflow (4 tests)
- ✅ Process contacts and return summary
- ✅ Handle empty contact list
- ✅ Re-score stale contacts
- ✅ Handle DB errors

### Error Handling (1 test)
- ✅ Continue after individual score failure

## Integration Points

### Depends On
- **Agent 01 (Foundation)**: Database schema (`crm_score_history`, pipeline stages)
- **Agent 02 (Discovery)**: Contacts in `pipeline_stage='new'`

### Feeds Into
- **Agent 04 (Warmup)**: Contacts in `qualified` stage
- **Agent 05 (Outreach)**: Qualified contacts ready for outreach
- **Agent 10 (Reporting)**: Score distribution analytics

## Performance & Cost

### Batch Efficiency
- **Single scoring**: 1 API call per contact
- **Batch scoring**: 1 API call per 20 contacts (20x reduction)
- Average 50 contacts = ~3 API calls vs 50 calls

### Claude Costs (Haiku pricing)
- Input: $0.25 per 1M tokens
- Output: $1.25 per 1M tokens
- Estimated cost per contact: **~$0.002** (batch mode)

### Processing Speed
- 50 contacts in dry-run mode: **~40ms** (mocked)
- 50 contacts with real Claude API: **~5-10 seconds** (batch mode)

## Error Handling

### Graceful Degradation
1. **Batch parse fails** → Fallback to individual scoring
2. **Individual score fails** → Skip contact, continue with others
3. **DB write fails** → Log error, continue processing
4. **Missing niche config** → Use default scoring prompt

### Error Collection
- All errors collected in `ScoringResult.errors`
- Displayed at end of run
- Non-zero exit code if errors occurred

## Next Steps

### Agent 04 — Warmup Agent
Now that contacts are scored and qualified, the next agent will:
1. Query contacts in `qualified` stage
2. Find their top posts to comment on
3. Schedule 3 authentic comments over 5 days
4. Move to `warming` stage

### Improvements (Future)
- Multi-model scoring (A/B test Haiku vs Sonnet)
- Custom scoring criteria per niche
- Score confidence intervals
- Automatic re-scoring triggers (e.g., follower count changes)

## Files Modified

### New Files
- `acquisition/scoring_agent.py` — Main agent (455 lines)
- `acquisition/tests/test_scoring_agent.py` — Test suite (535 lines)
- `acquisition/AGENT_03_SUMMARY.md` — This document

### Modified Files
- `acquisition/db/queries.py` — Added score history functions:
  - `insert_score_history()`
  - `get_score_history()`
  - `get_contacts_for_scoring()`

## Validation

```bash
# Run all tests
cd scripts
python3 -m pytest acquisition/tests/test_scoring_agent.py -v

# Expected output:
# ============================== 16 passed in 0.04s ==============================
```

## References

- Feature Spec: AAG-021 through AAG-030
- Database: `crm_score_history`, `crm_contacts`
- Model: `claude-haiku-4-5-20251001`
- Dependencies: Agent 01 (migrations), Agent 02 (discovery)
