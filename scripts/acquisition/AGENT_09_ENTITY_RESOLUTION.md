# AAG Agent 09 — Cross-Platform Entity Resolution

**Status**: ✅ Complete
**Features**: AAG-151 through AAG-180
**Dependencies**: Agent 01 (Foundation/Migrations)

## Mission

Build an entity resolution agent that, given one known platform handle, discovers all other social profiles (Twitter, Instagram, TikTok, LinkedIn, website, email) using:

- **Perplexity web search** — Online AI search to find mentions of the person
- **Username fuzzy matching** — Intelligent handle similarity detection
- **Bio link extraction** — Parse Linktree, Beacons, and other aggregators
- **Claude AI disambiguation** — Validate matches with 80%+ confidence threshold

Updates `crm_contacts` with confirmed cross-platform handles and calculates a resolution score (0-100).

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│         EntityResolutionAgent (Orchestrator)            │
│  - Collect signals (Perplexity, bio links)             │
│  - Build candidates                                     │
│  - Score & rank                                         │
│  - Disambiguate with Claude                             │
│  - Write to database                                    │
└──────────────┬──────────────────────────────────────────┘
               │
     ┌─────────┼─────────┬──────────┬──────────┐
     ▼         ▼         ▼          ▼          ▼
┌─────────┐ ┌────────┐ ┌────────┐ ┌─────────┐ ┌─────────┐
│Perplexity│ │Username│ │BioLink │ │Disambig│ │Database │
│ Client  │ │Matcher │ │Extractor│ │  uator │ │Queries  │
└─────────┘ └────────┘ └────────┘ └─────────┘ └─────────┘
```

---

## Components

### 1. PerplexityClient (`entity/perplexity_client.py`)

**Purpose**: Search the web for cross-platform social profiles using Perplexity's online AI model.

**Features**:
- Rate limiting (10 req/min, 500 req/day)
- Automatic usage tracking to `acq_api_usage`
- Safari fallback when API key not configured
- Query templates for different search strategies

**Example**:
```python
from acquisition.entity import perplexity_client

client = perplexity_client.get_client()
query = client.query_by_handle("johndoe", "twitter", "ai automation")
result = await client.search(query)
# => "twitter: @johndoe, instagram: @johndoe, linkedin: linkedin.com/in/john-doe"
```

---

### 2. UsernameMatchEngine (`entity/username_matcher.py`)

**Purpose**: Fuzzy matching and normalization for social media handles.

**Features**:
- `squish()` — Normalize handles by removing non-alphanumeric chars
- `handle_similarity()` — Calculate similarity ratio (0.0 to 1.0)
- `is_likely_same_handle()` — 85% threshold for same person
- `name_to_handle_candidates()` — Generate likely handle variants from display names
- `extract_handle_from_url()` — Parse handles from social media URLs

**Example**:
```python
from acquisition.entity import username_matcher

# Normalization
username_matcher.squish("John_Doe")  # => "johndoe"

# Similarity
username_matcher.handle_similarity("john_doe", "johndoe")  # => 1.0
username_matcher.is_likely_same_handle("alice.smith", "alice_smith")  # => True

# Candidate generation
username_matcher.name_to_handle_candidates("John Doe")
# => ["johndoe", "john_doe", "john.doe", "jdoe", "doejohn"]

# URL extraction
username_matcher.extract_handle_from_url("https://twitter.com/johndoe")  # => "johndoe"
```

---

### 3. BioLinkExtractor (`entity/bio_link_extractor.py`)

**Purpose**: Extract URLs from contact bios and parse link aggregators (Linktree, Beacons, etc.).

**Features**:
- Extract all URLs from bio text
- Identify link aggregator services
- Parse social profile links from aggregator pages
- Extract emails and websites from bios

**Example**:
```python
from acquisition.entity import bio_link_extractor

# Extract from bio
contact = {"bio_text": "Check out https://linktr.ee/johndoe"}
links = await bio_link_extractor.extract_bio_links(contact)
# => ["https://twitter.com/johndoe", "https://instagram.com/johndoe", ...]

# Parse aggregator
urls = await bio_link_extractor.parse_link_aggregator("https://linktr.ee/johndoe")
# => ["https://twitter.com/johndoe", "https://instagram.com/johndoe"]

# Extract emails
emails = bio_link_extractor.extract_emails_from_text("Contact: john@example.com")
# => ["john@example.com"]
```

---

### 4. AIDisambiguator (`entity/disambiguator.py`)

**Purpose**: Use Claude AI to validate if two profiles belong to the same person.

**Features**:
- 80% confidence threshold to prevent false positives
- Structured JSON output with reasoning
- Warning flags for ambiguous/common names
- Skip logic for weak signals (saves API costs)

**Example**:
```python
from acquisition.entity.disambiguator import AIDisambiguator, CandidateProfile

disambiguator = AIDisambiguator()

known = {
    "primary_platform": "twitter",
    "primary_handle": "johndoe",
    "display_name": "John Doe",
    "bio_text": "AI automation consultant"
}

candidate = CandidateProfile(
    platform="instagram",
    handle="johndoe",
    display_name="John Doe",
    bio_text="AI & automation",
    name_similarity=0.95,
    bio_link_overlap=True,
    perplexity_mentioned=True,
    score=95,
    evidence_sources=["perplexity", "bio_link"]
)

result = await disambiguator.disambiguate(known, candidate)
# => DisambiguationResult(same_person=True, confidence=95, reasoning="...")
```

---

### 5. EntityResolutionAgent (`entity_resolution_agent.py`)

**Purpose**: Main orchestrator that ties everything together.

**Workflow**:
1. **Collect signals** — Perplexity search + bio link extraction (parallel)
2. **Build candidates** — Parse results into CandidateProfile objects
3. **Score & rank** — Calculate scores based on handle similarity, name match, evidence
4. **Disambiguate** — Top 5 candidates validated with Claude AI (if score >= 40)
5. **Write to DB** — Confirmed associations → `acq_entity_associations` + update `crm_contacts`
6. **Calculate score** — Resolution score (0-100) based on discovered platforms
7. **Log run** — Track performance metrics in `acq_resolution_runs`

**Example**:
```python
from acquisition.entity_resolution_agent import EntityResolutionAgent

agent = EntityResolutionAgent(max_concurrent=3)
result = await agent.resolve("contact-uuid-here")

print(f"Resolution Score: {result.resolution_score}/100")
print(f"Confirmed Profiles: {len(result.confirmed)}")
for candidate, disambiguation in result.confirmed:
    print(f"  - {candidate.platform}: @{candidate.handle} ({disambiguation.confidence}%)")
```

---

## Resolution Score Calculator

The resolution score (0-100) is calculated based on discovered handles:

| Platform | Points | Notes |
|----------|--------|-------|
| Email (verified) | 30 | Highest value |
| Email (unverified) | 20 | Still valuable |
| LinkedIn | 25 | High value for B2B |
| Twitter | 15 | Common for creators |
| Instagram | 15 | Common for creators |
| TikTok | 10 | Growing platform |
| Website | 5 | Nice to have |

**Maximum**: 100 (capped)

---

## API Routes

Defined in `api/routes/entity.py`:

### POST `/entity/resolve`
Resolve a single contact.

**Body**:
```json
{
  "contact_id": "uuid",
  "dry_run": false
}
```

**Response**:
```json
{
  "success": true,
  "contact_id": "uuid",
  "confirmed": [
    {
      "platform": "twitter",
      "handle": "johndoe",
      "confidence": 95,
      "reasoning": "..."
    }
  ],
  "resolution_score": 85
}
```

---

### POST `/entity/resolve-batch`
Resolve multiple contacts concurrently (max 50).

**Body**:
```json
{
  "contact_ids": ["uuid1", "uuid2"],
  "dry_run": false
}
```

---

### POST `/entity/resolve-unresolved`
Auto-resolve a batch of unresolved contacts.

**Body**:
```json
{
  "limit": 20
}
```

---

### GET `/entity/status/:contact_id`
Get resolution status and all associations for a contact.

**Response**:
```json
{
  "contact_id": "uuid",
  "entity_resolved": true,
  "resolution_score": 85,
  "associations": [
    {
      "platform": "twitter",
      "handle": "johndoe",
      "confidence": 95,
      "confirmed": true
    }
  ]
}
```

---

### GET `/entity/stats`
Get overall resolution statistics.

**Response**:
```json
{
  "total_contacts": 1000,
  "resolved": 750,
  "percent_resolved": 75.0,
  "avg_resolution_score": 72.5,
  "by_platform": {
    "twitter": 600,
    "instagram": 500,
    "linkedin": 400
  }
}
```

---

## CLI Usage

```bash
# Resolve single contact
python3 scripts/acquisition/entity_resolution_agent.py --resolve CONTACT_ID

# Dry run (no database writes)
python3 scripts/acquisition/entity_resolution_agent.py --dry-run CONTACT_ID

# Batch resolve unresolved contacts
python3 scripts/acquisition/entity_resolution_agent.py --batch --limit 20

# Show unresolved contacts
python3 scripts/acquisition/entity_resolution_agent.py --show-unresolved

# View overall status
python3 scripts/acquisition/entity_resolution_agent.py --status
```

---

## Database Schema

### `acq_entity_associations`
Stores confirmed cross-platform associations.

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| contact_id | uuid | FK to crm_contacts |
| found_platform | text | Platform (twitter, instagram, etc.) |
| found_handle | text | Handle or URL |
| association_type | text | "handle", "email", "website" |
| confidence | int | Claude confidence (0-100) |
| confirmed | boolean | Manually confirmed? |
| evidence_sources | jsonb | ["perplexity", "bio_link", etc.] |
| claude_reasoning | text | AI explanation |
| created_at | timestamp | Discovery timestamp |

### `acq_resolution_runs`
Logs each resolution run for metrics.

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| contact_id | uuid | FK to crm_contacts |
| associations_found | int | Candidates discovered |
| associations_confirmed | int | Validated by Claude |
| platforms_resolved | jsonb | ["twitter", "linkedin"] |
| email_found | boolean | Email discovered? |
| linkedin_found | boolean | LinkedIn discovered? |
| duration_ms | int | Runtime in milliseconds |
| run_at | timestamp | Timestamp |

### Updates to `crm_contacts`
- `entity_resolved` (boolean) — Resolution completed?
- `resolution_score` (int) — Score 0-100
- `twitter_handle` (text)
- `instagram_handle` (text)
- `tiktok_handle` (text)
- `linkedin_url` (text)
- `website_url` (text)
- `email` (text)

---

## False Positive Protection

### Skip Disambiguation Logic
To save Claude API costs, we skip disambiguation entirely if signals are too weak:

```python
def should_skip_disambiguation(candidate: CandidateProfile) -> bool:
    return (
        candidate.name_similarity < 0.5
        and not candidate.bio_link_overlap
        and not candidate.perplexity_mentioned
    )
```

### Confidence Threshold
Claude must return `confidence >= 80` for a match to be confirmed. Lower confidence matches are automatically rejected.

### Human Review
All associations are logged with `claude_reasoning` so humans can review/override if needed.

---

## Testing

Run tests with pytest:

```bash
cd scripts/acquisition
python3 -m pytest tests/test_entity_resolution.py -v
```

**Test Coverage**:
- ✅ Username normalization and matching
- ✅ Bio link extraction
- ✅ Linktree/aggregator parsing
- ✅ Email extraction
- ✅ Perplexity rate limiting
- ✅ Claude disambiguation confidence gate
- ✅ False positive skip logic
- ✅ Resolution score calculation
- ✅ Batch processing with semaphore
- ✅ CLI interface

---

## Configuration

### Environment Variables

```bash
# Required
PERPLEXITY_API_KEY=pplx-xxxxx  # Perplexity API key (or use Safari fallback)
ANTHROPIC_API_KEY=sk-ant-xxxxx  # Claude API key

# Optional
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=eyJxxx...
```

### Rate Limits

| Service | Limit | Enforcement |
|---------|-------|-------------|
| Perplexity | 10 req/min | Client-side rate limiter |
| Perplexity | 500 req/day | Manual monitoring |
| Claude | No hard limit | Cost-based (skip weak signals) |

---

## Performance Metrics

**Expected Performance**:
- **Single resolution**: 3-8 seconds (depends on Perplexity response time)
- **Batch (20 contacts)**: ~1-2 minutes (with max_concurrent=3)
- **Cost per resolution**: ~$0.01-0.02 (Perplexity $0.005 + Claude $0.005-0.015)

**Optimization**:
- Parallel signal collection (Perplexity + bio links)
- Skip Claude for weak signals
- Semaphore to control concurrency
- Deduplicate candidates before scoring

---

## Integration with Other Agents

### Agent 02 (Discovery)
Discovery agent populates `crm_contacts` with `primary_handle` and `bio_text`, which are inputs for entity resolution.

### Agent 03 (Scoring)
Resolution score contributes to ICP scoring — higher resolution = more confidence in prospect quality.

### Agent 04 (Warmup)
Multi-platform warming requires knowing all social handles. Entity resolution enables cross-platform engagement.

### Agent 08 (Email)
Email discovery is a key goal of entity resolution. Found emails are passed to the email agent.

---

## Known Limitations

1. **Perplexity accuracy** — Perplexity may return outdated or incorrect information. Always validate with Claude.
2. **Common names** — "John Smith" type names are hard to disambiguate. Claude flags these with warnings.
3. **Private profiles** — Can't extract bio links from private/locked profiles.
4. **Link aggregators** — Some aggregators use JavaScript rendering, which httpx can't parse. Safari fallback helps.

---

## Future Enhancements

- [ ] Support for more link aggregators (Tap.bio, Solo.to, etc.)
- [ ] Integration with Hunter.io for email discovery
- [ ] Reverse image search for profile photos
- [ ] Social graph analysis (mutual followers)
- [ ] Bulk import from CSV
- [ ] Manual review dashboard

---

## Success Metrics

Track in `acq_resolution_runs`:
- **Resolution rate**: % of contacts successfully resolved
- **Average resolution score**: Higher = better coverage
- **Email discovery rate**: % of contacts with email found
- **LinkedIn discovery rate**: % of contacts with LinkedIn found
- **Confidence distribution**: Are we getting high-confidence matches?

---

## Contact

For questions about AAG Agent 09:
- **Owner**: Autonomous Acquisition Agent System
- **Docs**: `scripts/acquisition/AGENT_09_ENTITY_RESOLUTION.md`
- **Code**: `scripts/acquisition/entity_resolution_agent.py`
- **Tests**: `scripts/acquisition/tests/test_entity_resolution.py`

---

**Status**: ✅ Production Ready
**Last Updated**: 2026-02-28
