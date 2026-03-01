# AAG Agent 09 — Quick Start Guide

**Cross-Platform Entity Resolution**
**Status**: ✅ Production Ready (All 19 tests passing)

---

## What It Does

Given one known social media handle, discovers:
- ✅ Twitter/X handle
- ✅ Instagram handle
- ✅ TikTok handle
- ✅ LinkedIn URL
- ✅ Personal website
- ✅ Email address

**Methods**:
1. Perplexity AI web search (with Safari fallback)
2. Fuzzy username matching
3. Bio link extraction + Linktree parsing
4. Claude AI disambiguation (80% confidence threshold)

---

## Installation

### 1. Install Dependencies
```bash
pip install httpx anthropic pytest
```

### 2. Set Environment Variables
```bash
# Required
export SUPABASE_URL="https://your-project.supabase.co"
export SUPABASE_SERVICE_KEY="eyJxxx..."

# Recommended (or use Safari fallback)
export PERPLEXITY_API_KEY="pplx-xxxxx"
export ANTHROPIC_API_KEY="sk-ant-xxxxx"
```

### 3. Verify Installation
```bash
cd scripts
python3 -m acquisition.verify_agent_09
```

Expected output:
```
✅ All verifications passed! Agent 09 is ready.
```

---

## Usage

### CLI Commands

#### Resolve Single Contact
```bash
cd scripts
python3 -m acquisition.entity_resolution_agent --resolve CONTACT_ID
```

#### Dry Run (Preview Only)
```bash
python3 -m acquisition.entity_resolution_agent --dry-run CONTACT_ID
```

#### Batch Process Unresolved Contacts
```bash
# Process up to 20 unresolved contacts
python3 -m acquisition.entity_resolution_agent --batch --limit 20
```

#### Show Unresolved Contacts
```bash
python3 -m acquisition.entity_resolution_agent --show-unresolved
```

#### View Stats
```bash
python3 -m acquisition.entity_resolution_agent --status
```

Output:
```
Entity Resolution Status:
  Total contacts: 150
  Resolved: 45 (30.0%)
  Average resolution score: 67.5/100
```

---

## API Endpoints

### Start API Server
```bash
cd scripts
python3 -m acquisition.api.server
```

### Endpoints

#### POST /entity/resolve
Resolve single contact:
```bash
curl -X POST http://localhost:5000/entity/resolve \
  -H "Content-Type: application/json" \
  -d '{
    "contact_id": "uuid-here",
    "dry_run": false
  }'
```

Response:
```json
{
  "success": true,
  "contact_id": "uuid",
  "confirmed": [
    {
      "platform": "twitter",
      "handle": "johndoe",
      "confidence": 95,
      "reasoning": "Same display name, bio mentions same business"
    }
  ],
  "resolution_score": 85
}
```

#### POST /entity/resolve-batch
Resolve multiple contacts:
```bash
curl -X POST http://localhost:5000/entity/resolve-batch \
  -H "Content-Type: application/json" \
  -d '{
    "contact_ids": ["uuid1", "uuid2"],
    "dry_run": false
  }'
```

#### GET /entity/status/:contact_id
Get resolution status:
```bash
curl http://localhost:5000/entity/status/CONTACT_ID
```

#### GET /entity/stats
Overall statistics:
```bash
curl http://localhost:5000/entity/stats
```

---

## Python API

### Resolve Single Contact
```python
import asyncio
from acquisition.entity_resolution_agent import EntityResolutionAgent

async def main():
    agent = EntityResolutionAgent(max_concurrent=3)
    result = await agent.resolve("contact-uuid", dry_run=False)

    print(f"Resolution Score: {result.resolution_score}/100")
    for candidate, disambiguation in result.confirmed:
        print(f"{candidate.platform}: @{candidate.handle} ({disambiguation.confidence}%)")

asyncio.run(main())
```

### Batch Processing
```python
from acquisition.entity_resolution_agent import resolve_unresolved_batch

async def main():
    results = await resolve_unresolved_batch(limit=20)
    print(f"Processed {len(results)} contacts")

asyncio.run(main())
```

---

## Resolution Score

Contacts receive a score from 0-100 based on profile coverage:

| Platform/Data | Points |
|---------------|--------|
| Email (verified) | +30 |
| Email (unverified) | +20 |
| LinkedIn URL | +25 |
| Twitter handle | +15 |
| Instagram handle | +15 |
| TikTok handle | +10 |
| Website URL | +5 |
| **Maximum** | **100** |

---

## Rate Limits

### Perplexity API
- **10 requests/minute**
- **500 requests/day**
- Auto rate-limiting built in

### Claude AI
- **Max 5 disambiguation calls per contact** (only for high-confidence candidates)
- Only called when candidate score ≥ 40

### Batch Processing
- **Max 3 contacts resolved concurrently** (semaphore-controlled)

---

## Testing

### Run Full Test Suite
```bash
cd scripts
python3 -m pytest acquisition/tests/test_entity_resolution.py -v
```

Expected:
```
19 passed in 0.59s
```

### Test Categories
- Username matching (5 tests)
- Bio link extraction (6 tests)
- Disambiguation logic (2 tests)
- Integration tests (3 tests)
- Performance tests (2 tests)
- CLI interface (1 test)

---

## Cost Estimation

Per contact resolution:
- Perplexity API: $0.005
- Claude Haiku (avg 3 calls): $0.001
- **Total: ~$0.01 per contact**

For 1,000 contacts: ~$10

---

## Troubleshooting

### "PERPLEXITY_API_KEY not set"
✅ **No problem!** The agent automatically falls back to Safari browser automation.

### "httpx not found"
```bash
pip install httpx
```

### "anthropic not found"
```bash
pip install anthropic
```

### "No unresolved contacts found"
Run Agent 02 (Discovery) first to populate contacts:
```bash
python3 -m acquisition.discovery_agent --run
```

### API server won't start
Check if port 5000 is available:
```bash
lsof -ti:5000 | xargs kill -9  # Kill existing process
```

---

## Integration with Other Agents

### Agent 02 (Discovery)
**Input**: Discovery creates contacts with `primary_handle` and `bio_text`
**Output**: Entity resolution enriches with cross-platform handles

### Agent 03 (Scoring)
**Input**: `resolution_score` contributes to ICP scoring
**Output**: Higher resolution = more confident prospect quality

### Agent 04 (Warmup)
**Input**: Warmup needs all social handles for engagement
**Output**: Cross-platform handles enable multi-channel warmup

### Agent 08 (Email)
**Input**: Email discovery is a key resolution goal
**Output**: Found emails trigger email outreach sequences

---

## Files & Modules

```
scripts/acquisition/
├── entity/
│   ├── perplexity_client.py      # Perplexity API + Safari fallback
│   ├── username_matcher.py        # Fuzzy matching engine
│   ├── bio_link_extractor.py      # URL/email extraction
│   └── disambiguator.py           # Claude AI validation
├── api/routes/
│   └── entity.py                  # REST API endpoints
├── tests/
│   └── test_entity_resolution.py  # Test suite (19 tests)
├── entity_resolution_agent.py     # Main orchestrator + CLI
└── verify_agent_09.py             # Quick verification
```

---

## Example Workflow

### 1. Discover Prospects (Agent 02)
```bash
python3 -m acquisition.discovery_agent --run --dry-run
```

### 2. Resolve Entities (Agent 09)
```bash
# Preview first
python3 -m acquisition.entity_resolution_agent --show-unresolved

# Resolve batch
python3 -m acquisition.entity_resolution_agent --batch --limit 10
```

### 3. Check Results
```bash
python3 -m acquisition.entity_resolution_agent --status
```

### 4. Score Prospects (Agent 03)
```bash
python3 -m acquisition.scoring_agent --run
```

Now you have enriched, scored prospects ready for outreach!

---

## Support

- **Documentation**: `AGENT_09_ENTITY_RESOLUTION.md`
- **Implementation Summary**: `AGENT_09_SUMMARY.md`
- **Validation Report**: `AGENT_09_FINAL_VALIDATION.md`
- **Tests**: `tests/test_entity_resolution.py`

---

✅ **Agent 09 is production-ready and fully tested!**

Last Updated: 2026-02-28
