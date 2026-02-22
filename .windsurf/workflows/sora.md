---
description: Generate Sora video trilogies featuring @isaiahdupree
---

## Universal Story Generator (Prompt-Agnostic)

### List available story templates
// turbo
```bash
npx tsx scripts/sora-generate.ts templates
```

### Generate prompts from a theme (AI-powered)
```bash
npx tsx scripts/sora-generate.ts generate \
  --theme "Your story theme here" \
  --template heros-journey \
  --output my-story.json
```

### Generate with secondary character
```bash
npx tsx scripts/sora-generate.ts generate \
  --theme "A love story in Paris" \
  --template love-story \
  --secondary '{"name":"Claire","description":"A French painter with red hair"}' \
  --output paris-love.json
```

### Run generation from config file
```bash
npx tsx scripts/sora-generate.ts run --config my-story.json
```

### Quick all-in-one (generate + run)
```bash
npx tsx scripts/sora-generate.ts quick \
  --theme "Your story theme" \
  --template action-trilogy \
  --project my-project
```

### Batch generate multiple stories
```bash
npx tsx scripts/sora-generate.ts batch \
  --themes themes.json \
  --template love-story \
  --output batch-stories.json
```

## Available Templates
- **heros-journey** - 6 parts (Campbell's monomyth)
- **love-story** - 3 parts (romantic journey)
- **action-trilogy** - 3 parts (high-octane action)
- **transformation** - 3 parts (character change arc)
- **epic-saga** - 6 parts (grand scale adventure)

---

## Legacy Commands

### Check Sora credits
// turbo
```bash
npx tsx packages/scheduler/cli/scheduler-cli.ts resources
```

### List available trilogies
// turbo
```bash
npx tsx scripts/sora-batch-trilogies.ts --list
```

### Run a specific trilogy
```bash
npx tsx scripts/sora-trilogy-runner.ts --story <trilogy_id>
```

### Run batch of trilogies starting from ID
```bash
npx tsx scripts/sora-batch-trilogies.ts --from <id>
```

### Schedule trilogy when credits available
```bash
npx tsx packages/scheduler/cli/scheduler-cli.ts sora first_contact --when-credits 3
```

---

## Content Generation (Trends + Offers → Sora Videos)

### Preview a balanced content mix (dry run)
// turbo
```bash
npx tsx scripts/sora-content-generator.ts --mode mix --count 6 --dry-run
```

### Generate from live social media trends
```bash
npx tsx scripts/sora-content-generator.ts --mode trends --count 5
```

### Generate offer/brand-focused content
```bash
npx tsx scripts/sora-content-generator.ts --mode offers --count 3
```

### Generate from curated prompt library
```bash
npx tsx scripts/sora-content-generator.ts --mode curated --count 4
```

### Save batch then generate later (two-step)
```bash
npx tsx scripts/sora-content-generator.ts --mode mix --count 6 --save
npx tsx scripts/sora-content-generator.ts --from-batch --generate
```

### Full end-to-end: generate prompts + run Sora + clean watermarks
```bash
npx tsx scripts/sora-content-generator.ts --mode mix --count 5 --generate
```

### Generate scripts via MediaPoster API directly
```bash
curl -X POST http://localhost:5555/api/sora-daily/scripts/generate-sync \
  -H 'Content-Type: application/json' \
  -d '{"source": "live", "count": 5, "include_series": true}'
```

### Generate offer-aware scripts via API
```bash
curl -X POST http://localhost:5555/api/sora-daily/scripts/generate-sync \
  -H 'Content-Type: application/json' \
  -d '{"source": "offers", "count": 3}'
```

---

## Sora Daily Pipeline (Full Automated Flow)

### Full daily run: Generate → Clean → Register → Catalog → Queue → Drain
```bash
npx tsx scripts/sora-daily-pipeline.ts
```

### Preview everything (dry run)
// turbo
```bash
npx tsx scripts/sora-daily-pipeline.ts --dry-run
```

### Skip generation (just queue + drain from existing catalog)
```bash
npx tsx scripts/sora-daily-pipeline.ts --skip-generate
```

### Generate only (no queue/drain)
```bash
npx tsx scripts/sora-daily-pipeline.ts --generate-only --mode mix --count 8
```

### Drain only (process existing publish queue)
```bash
npx tsx scripts/sora-daily-pipeline.ts --drain-only
```

### Custom params
```bash
npx tsx scripts/sora-daily-pipeline.ts --mode offers --count 4 --queue-count 6 --platforms youtube,tiktok
```

### Check pipeline status
// turbo
```bash
npx tsx scripts/sora-daily-pipeline.ts --status
```

---

## Queue Drain (Publish Queue Processor)

### Drain queue (default: stop after 3 rate limits)
```bash
npx tsx scripts/queue-drain.ts
```

### Persistent drain (keep retrying until empty)
```bash
npx tsx scripts/queue-drain.ts --persistent
```

### Custom drain params
```bash
npx tsx scripts/queue-drain.ts --max-published 10 --max-rounds 20 --wait 120 --batch-size 3
```

### Check queue status
// turbo
```bash
npx tsx scripts/queue-drain.ts --status
```

---

## Scheduler API (Automated Scheduling)

### Schedule a full daily pipeline run
```bash
curl -X POST http://localhost:3010/api/sora/daily-pipeline \
  -H 'Content-Type: application/json' \
  -d '{"mode": "mix", "count": 6, "queueCount": 4, "platforms": "youtube"}'
```

### Schedule recurring daily pipeline (7 days at 10am)
```bash
curl -X POST http://localhost:3010/api/sora/daily-pipeline/recurring \
  -H 'Content-Type: application/json' \
  -d '{"mode": "mix", "count": 6, "hour": 10, "days": 7}'
```

### Schedule a queue drain
```bash
curl -X POST http://localhost:3010/api/queue/drain \
  -H 'Content-Type: application/json' \
  -d '{"maxPublished": 10, "batchSize": 4}'
```

### Schedule recurring queue drains (every 2h, 6 times)
```bash
curl -X POST http://localhost:3010/api/queue/drain/recurring \
  -H 'Content-Type: application/json' \
  -d '{"maxPublished": 5, "intervalHours": 2, "times": 6}'
```

---

## Legacy: Daily Orchestrator (UGC + Sora Selection)

### Full daily run: UGC generation + Sora selection + queue + publish
```bash
npx tsx scripts/daily-orchestrator.ts --ugc-count 2 --sora-count 3 --platforms youtube
```

### Sora only (queue existing videos)
```bash
npx tsx scripts/daily-orchestrator.ts --sora-only --sora-count 4
```

### Multi-platform
```bash
npx tsx scripts/daily-orchestrator.ts --platforms youtube,tiktok,instagram
```

---

## Queue Processing (Blotato Publishing)

### Process next queued item → Blotato → YouTube
```bash
curl -X POST http://localhost:5555/api/publish-controls/process
```

### Process batch (up to 5)
```bash
curl -X POST 'http://localhost:5555/api/publish-controls/process/batch?max_items=5'
```

### Check publishing status
// turbo
```bash
curl -s http://localhost:5555/api/publish-controls/status | python3 -m json.tool
```

### Check what's in the queue
// turbo
```bash
curl -s 'http://localhost:5555/api/publish-controls/queue?status=queued' | python3 -c "import json,sys; d=json.load(sys.stdin); [print(f'  [{i[\"platform\"]}] {i[\"title\"][:50]}') for i in d.get('items',[])]"
```

### Pause/resume all publishing
```bash
curl -X POST http://localhost:5555/api/publish-controls/config/pause
curl -X POST http://localhost:5555/api/publish-controls/config/resume
```

---

## Content Pipeline (Lower-level)

### Queue videos directly (no UGC)
```bash
npx tsx scripts/daily-content-pipeline.ts --count 4 --platform youtube
```

### Rebuild content catalog only
// turbo
```bash
npx tsx scripts/daily-content-pipeline.ts --catalog
```

### Stitch all trilogies into finals
```bash
npx tsx scripts/stitch-trilogies.ts
```

### Schedule recurring daily publishing (via Scheduler API)
```bash
curl -X POST http://localhost:3010/api/publish/daily/recurring \
  -H 'Content-Type: application/json' \
  -d '{"count": 4, "platform": "youtube", "hour": 10, "days": 7}'
```
