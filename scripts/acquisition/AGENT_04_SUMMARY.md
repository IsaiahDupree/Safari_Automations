# AAG Agent 04 — Engagement Warmup Agent

**Status**: ✅ FULLY VALIDATED (13/13 tests passing)
**Date**: 2026-02-28

## Overview

The Warmup Agent schedules and sends platform comments on prospects' posts before DM outreach. Comments build recognition so the first DM feels familiar, not cold.

## Key Files

- `warmup_agent.py` — Main agent (810 lines)
- `tests/test_warmup_agent.py` — Comprehensive test suite (575 lines, 13 tests)
- `db/queries.py` — Database queries for warmup schedules

## Features Implemented ✅

### Core Scheduling (AAG-031 through AAG-035)
- **WarmupConfig model** — Configurable per-niche settings (comments_target, window_days, tone, skip threshold)
- **PostFetcher** — Fetches recent posts via Market Research API, filters duplicates
- **WarmupScheduler** — Creates schedule rows spread across window_days with randomized times (8AM-6PM)
- **Batch scheduler** — Processes all `qualified` contacts → `warming` stage
- **Same-day guard** — Never schedules two comments on the same day to the same contact

### Execution & Rate Limiting (AAG-036 through AAG-038)
- **CommentSender** — Sends scheduled comments via platform services
- **Platform routing** — Maps platforms to correct comment service ports
- **Rate limiter** — Checks daily caps before sending, reschedules if at limit
- **Failure handling** — Updates status to `failed`, reschedules or skips gracefully

### Smart Logic (AAG-039 through AAG-042)
- **Duplicate post guard** — Never comments on the same post URL twice
- **Completion detection** — Advances to `ready_for_dm` when target met
- **Window timeout** — Advances anyway if window expires (with metadata reason)
- **crm_messages logging** — Records every sent comment for tracking

### Comment Generation (AAG-033)
- **Claude-powered comments** — Uses Haiku for cost-efficient generation
- **Tone support** — insightful, encouraging, curious
- **Platform-specific rules** — Emojis on TikTok/Instagram, none on Twitter/LinkedIn
- **Anti-generic validation** — Comments reference specific post content

### Advanced Features (AAG-046, AAG-048, AAG-050)
- **CLI interface** — `--schedule`, `--execute`, `--status`, `--dry-run`, `--platform`
- **Per-niche config** — Different tones and targets per niche
- **High-score skip** — Contacts with score ≥85 skip warmup entirely → `ready_for_dm`

## CLI Usage

```bash
# Schedule warmup for all qualified contacts
python3 -m acquisition.warmup_agent --schedule

# Execute pending warmup comments
python3 -m acquisition.warmup_agent --execute

# Execute only Twitter comments
python3 -m acquisition.warmup_agent --execute --platform twitter

# Show pipeline status
python3 -m acquisition.warmup_agent --status

# Dry run (no writes)
python3 -m acquisition.warmup_agent --schedule --dry-run
python3 -m acquisition.warmup_agent --execute --dry-run
```

## Validation Results

```bash
$ python3 -m pytest acquisition/tests/test_warmup_agent.py -v
============================== 13 passed in 0.05s ==============================
```

All tests passing ✅

## Features Completed

- ✅ AAG-031: WarmupConfig model + defaults
- ✅ AAG-032: PostFetcher
- ✅ AAG-033: CommentGenerator (Claude-powered)
- ✅ AAG-034: WarmupScheduler
- ✅ AAG-035: Batch scheduler
- ✅ AAG-036: CommentSender
- ✅ AAG-037: Platform routing
- ✅ AAG-038: Rate limiter
- ✅ AAG-039: Duplicate post guard
- ✅ AAG-040: Completion detection
- ✅ AAG-041: Window timeout
- ✅ AAG-042: crm_messages logging
- ✅ AAG-046: CLI
- ✅ AAG-047: Tests (13/13 passing)
- ✅ AAG-048: Per-niche config
- ✅ AAG-050: High-score skip

**16/20 features completed** (API endpoints and analytics deferred)

---

**✅ Agent 04 validation complete — ready for production deployment**
