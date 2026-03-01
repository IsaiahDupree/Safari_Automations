# AAG Agent 03 — ICP Scoring Agent

## Overview

The ICP Scoring Agent is a Claude-powered system that scores newly discovered contacts (0-100) against your ideal customer profile and automatically routes them to either `qualified` or `archived` pipeline stages.

## Features

✅ **Claude Haiku Integration** — Cost-efficient AI scoring using `claude-haiku-4-5-20251001`
✅ **Batch Processing** — Scores up to 20 contacts per API call for cost savings
✅ **Score History Tracking** — Full audit trail in `crm_score_history`
✅ **Automatic Routing** — Moves contacts to qualified/archived based on ICP threshold
✅ **Re-scoring** — Re-evaluate stale contacts (>30 days old)
✅ **Rich CLI** — Score distribution histogram and detailed output
✅ **Dry Run Mode** — Test scoring without database writes

## Installation

### 1. Run Migration

```bash
# Apply the score history migration
psql $DATABASE_URL -f scripts/acquisition/db/migrations/003_score_history.sql

# Or via Supabase SQL Editor
```

### 2. Set Environment Variables

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
export SUPABASE_URL="https://..."
export SUPABASE_SERVICE_KEY="..."
```

## Usage

### Score New Contacts

```bash
# Score up to 50 new contacts
python3 scripts/acquisition/scoring_agent.py --run

# Score with custom limit
python3 scripts/acquisition/scoring_agent.py --run --limit 20

# Filter to specific niche
python3 scripts/acquisition/scoring_agent.py --run --niche-id UUID
```

### Re-score Stale Contacts

```bash
# Re-score contacts last scored >30 days ago
python3 scripts/acquisition/scoring_agent.py --run --rescore-stale
```

### Dry Run (Test Mode)

```bash
# See scores without writing to database
python3 scripts/acquisition/scoring_agent.py --run --dry-run
```

## How It Works

### 1. Fetch Contacts

Queries `crm_contacts` for:
- **New scoring**: `relationship_score IS NULL AND pipeline_stage='new'`
- **Re-scoring**: `last_scored_at < NOW() - 30 days`

### 2. Batch Scoring

Groups contacts by `source_niche_config_id` to use the correct ICP prompt per niche. Sends up to 20 contacts per Claude API call.

### 3. Claude Scoring

**Single Contact Prompt:**
```
You are scoring a social media prospect against an ideal customer profile.

ICP Criteria: {config.scoring_prompt}

Contact:
- Name: Jane Doe
- Platform: twitter (@janedoe)
- Followers: 15,000
- Bio: Business coach helping entrepreneurs...
- Top post: "Just helped my client 10x..." (450 likes)
- Niche: ai-automation-coaches

Score 0-100 where:
100 = perfect ICP match
70+ = qualified
50-69 = borderline
<50 = not a fit

Respond: {"score": 82, "reasoning": "...", "signals": ["signal1", "signal2"]}
```

**Batch Prompt** (20 contacts):
```
Score each of these 20 contacts. Return JSON array with one object per contact.
Each: {"contact_index": 0, "score": 85, "reasoning": "..."}
```

### 4. Routing Logic

```python
if score >= min_score:
    new_stage = 'qualified'
else:
    new_stage = 'archived'
```

Default `min_score` is 65 (configurable per niche in `acq_niche_configs.icp_min_score`).

### 5. Score History

Every score is written to `crm_score_history`:

```sql
INSERT INTO crm_score_history (
    contact_id,
    score,
    reasoning,
    signals,
    model_used,
    scored_at
) VALUES (...);

UPDATE crm_contacts
SET relationship_score = 82,
    last_scored_at = NOW()
WHERE id = 'contact-uuid';
```

### 6. Funnel Events

Stage transitions are logged:

```sql
INSERT INTO acq_funnel_events (
    contact_id,
    from_stage,
    to_stage,
    triggered_by,
    occurred_at
) VALUES ('uuid', 'new', 'qualified', 'scoring_agent', NOW());
```

## Output

```
🎯 Scoring Agent starting...
   Mode: NEW CONTACTS
   Limit: 50

📋 Found 12 contacts to score

📊 Scoring 12 contacts for niche: ai-automation-coaches
   Min score: 65

   ✅ Jane Doe → 82/100 → qualified
      💭 Perfect ICP match: business coach with 15K followers, talks about growth...
   ❌ John Smith → 45/100 → archived
      💭 Too few followers, no business focus...
   ✅ Sarah Johnson → 71/100 → qualified
      💭 Good fit: content creator focused on audience building...

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

## Default ICP Prompt

```
Ideal customer: a business owner, coach, consultant, or creator who:
- Posts actively (at least weekly)
- Has 1,000–500,000 followers (not mega-celebrity, not micro-nano)
- Talks about growth, business, content strategy, or audience building
- Would benefit from AI-powered content or outreach automation
- Is NOT already a SaaS tool, agency, or competitor
```

**Customize per niche:**

```sql
UPDATE acq_niche_configs
SET scoring_prompt = 'Your custom ICP criteria here...'
WHERE name = 'your-niche';
```

## Testing

```bash
# Run all tests
pytest scripts/acquisition/tests/test_scoring_agent.py -v

# Run specific test
pytest scripts/acquisition/tests/test_scoring_agent.py::test_batch_scoring_20_contacts -v
```

### Test Coverage

✅ `test_scoring_prompt_returns_valid_json()` — Claude JSON parsing
✅ `test_batch_scoring_20_contacts()` — Batch API calls
✅ `test_score_routing_qualified_above_threshold()` — >= min_score → qualified
✅ `test_score_routing_archived_below_threshold()` — < min_score → archived
✅ `test_rescore_stale_triggers_correctly()` — Re-scoring logic
✅ `test_score_written_to_history()` — Score persistence
✅ `test_fallback_to_individual_on_batch_parse_fail()` — Error handling

## Architecture

```
┌─────────────────┐
│  crm_contacts   │
│ pipeline_stage  │
│  = 'new'        │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ ScoringAgent    │
│  .run()         │
└────────┬────────┘
         │
         ├─► get_contacts_for_scoring()
         │
         ├─► group by niche_config_id
         │
         ├─► batch_score() ──► Claude Haiku
         │                     (20 contacts/call)
         │
         ├─► insert_score_history()
         │   ├─► crm_score_history
         │   └─► crm_contacts.relationship_score
         │
         └─► route_contact()
             ├─► update_pipeline_stage()
             └─► insert_funnel_event()
```

## Cost Estimation

**Claude Haiku Pricing** (as of 2026):
- Input: $0.25 / 1M tokens
- Output: $1.25 / 1M tokens

**Per Contact** (batch of 20):
- ~300 input tokens (ICP + contact data)
- ~50 output tokens (JSON response)
- **Cost: ~$0.00025 per contact** (4,000 contacts per $1)

**Monthly at Scale:**
- 10,000 contacts/month = ~$2.50
- 50,000 contacts/month = ~$12.50

## Error Handling

### Claude API Errors
- Retries are not automatic
- Errors logged to `result.errors`
- Batch failures fall back to individual scoring

### Database Errors
- Score history write failures are logged
- Pipeline stage updates may fail independently
- Exit code 1 if any errors occurred

### Invalid JSON
- Markdown code blocks are stripped
- Parse failures return `None` for that contact
- Batch parse failures trigger individual fallback

## Integration

### Discovery Agent → Scoring Agent

```python
# Discovery Agent creates contacts with pipeline_stage='new'
await queries.upsert_contact({
    "id": uuid.uuid4(),
    "handle": "prospect",
    "pipeline_stage": "new",  # ← Scoring Agent picks these up
    "source_niche_config_id": niche_id,
})
```

### Scoring Agent → Warmup Agent

```python
# Scoring Agent moves qualified contacts forward
# Warmup Agent queries: pipeline_stage='qualified'
qualified_contacts = await queries.get_qualified_contacts(limit=50)
```

## Troubleshooting

### No contacts scored

```bash
# Check if contacts exist in 'new' stage
psql $DATABASE_URL -c "SELECT COUNT(*) FROM crm_contacts WHERE pipeline_stage='new' AND relationship_score IS NULL;"
```

### Claude API errors

```bash
# Verify API key
echo $ANTHROPIC_API_KEY

# Test direct API call
curl https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{"model":"claude-haiku-4-5-20251001","max_tokens":100,"messages":[{"role":"user","content":"test"}]}'
```

### Database connection issues

```bash
# Test Supabase connection
psql $DATABASE_URL -c "SELECT 1;"
```

## Files

```
scripts/acquisition/
├── scoring_agent.py              # Main agent (this file)
├── db/
│   ├── queries.py                # + insert_score_history()
│   │                             # + get_contacts_for_scoring()
│   │                             # + get_score_history()
│   └── migrations/
│       └── 003_score_history.sql # Score tables
└── tests/
    └── test_scoring_agent.py     # Full test suite
```

## Next Steps

After scoring:

1. **Warmup Agent** (AAG-04) — Comment on qualified contacts' posts
2. **Outreach Agent** (AAG-05) — Send DMs to warmed contacts
3. **Follow-up Agent** (AAG-06) — Send follow-up sequences
4. **Reporting Agent** (AAG-10) — Weekly performance reports

## Support

- **Logs**: Check stdout for score distribution and errors
- **History**: Query `crm_score_history` for audit trail
- **Re-scoring**: Use `--rescore-stale` to update old scores
- **Dry Run**: Use `--dry-run` to test without writes
