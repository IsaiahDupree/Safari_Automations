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
