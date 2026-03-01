# AAG Agent 02 — Discovery Agent Quick Start

## What It Does

The Discovery Agent (Agent 02) finds qualified prospects from social platforms and seeds them into the CRM pipeline for scoring and outreach.

## CLI Usage

```bash
# Run discovery for all active niches
cd scripts && python3 -m acquisition.discovery_agent --run

# Run for specific niche
python3 -m acquisition.discovery_agent --niche-id <UUID>

# Platform-specific discovery
python3 -m acquisition.discovery_agent --platform instagram

# Limit results
python3 -m acquisition.discovery_agent --platform twitter --limit 20

# Dry run (no database writes)
python3 -m acquisition.discovery_agent --dry-run
```

## API Usage

Start the API server:
```bash
cd scripts && python3 -m uvicorn acquisition.api.server:app --port 8000
```

### Trigger Discovery Run
```bash
curl -X POST http://localhost:8000/api/acquisition/discovery/run \
  -H "Content-Type: application/json" \
  -d '{"platform": "instagram", "limit": 50, "dry_run": false}'
```

### List Discovery Runs
```bash
curl http://localhost:8000/api/acquisition/discovery/runs?limit=20
```

### Create Niche Config
```bash
curl -X POST http://localhost:8000/api/acquisition/niches \
  -H "Content-Type: application/json" \
  -d '{
    "name": "ai-automation",
    "service_slug": "ai-automation",
    "platforms": ["instagram", "twitter"],
    "keywords": ["ai automation", "no code ai"],
    "icp_min_score": 65,
    "max_weekly": 100
  }'
```

### List Niche Configs
```bash
curl http://localhost:8000/api/acquisition/niches?active_only=true
```

### Health Check
```bash
curl http://localhost:8000/api/acquisition/discovery/health
```

## Testing

```bash
cd scripts && python3 -m pytest acquisition/tests/test_discovery_agent.py -v
```

Expected: 9/9 tests passing ✅

## What Happens During Discovery

1. **Scan Platforms** — Calls Market Research API for each platform × keyword
2. **Deduplicate** — Checks existing contacts across all platform handles
3. **Check Re-entry** — Archived (180 days) and closed_lost (90 days) contacts can re-enter
4. **Seed Contacts** — Upserts new prospects to `crm_contacts` with `pipeline_stage='new'`
5. **TikTok Enrichment** — Pulls follower counts for TikTok prospects
6. **Entity Resolution** — Enqueues contacts for cross-platform entity matching
7. **Log Run** — Records stats to `acq_discovery_runs`

## Rate Limits

- Max 3 concurrent platform scans
- 5-second delay between requests to same platform
- Prevents API rate limiting

## Dependencies

- Market Research API must be running on port 3106
- Database tables: `acq_niche_configs`, `acq_discovery_runs`, `crm_contacts`
- Optional: `li_prospect.py` for LinkedIn discovery
- Optional: TikTok enrichment service on port 3102

## Files

- `discovery_agent.py` — Main agent (475 lines)
- `clients/market_research_client.py` — API wrapper (167 lines)
- `api/routes/discovery.py` — FastAPI routes (319 lines)
- `tests/test_discovery_agent.py` — Tests (334 lines)

## Status

✅ **COMPLETE** — All 16 features implemented and tested
✅ **9/9 tests passing**
✅ **API endpoints functional**
✅ **CLI functional**
