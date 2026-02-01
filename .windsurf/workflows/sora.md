---
description: Generate Sora video trilogies featuring @isaiahdupree
---

## Check Sora credits
// turbo
```bash
npx tsx packages/scheduler/cli/scheduler-cli.ts resources
```

## List available trilogies
// turbo
```bash
npx tsx scripts/sora-batch-trilogies.ts --list
```

## Run a specific trilogy
```bash
npx tsx scripts/sora-trilogy-runner.ts --story <trilogy_id>
```

## Run batch of trilogies starting from ID
```bash
npx tsx scripts/sora-batch-trilogies.ts --from <id>
```

## Schedule trilogy when credits available
```bash
npx tsx packages/scheduler/cli/scheduler-cli.ts sora first_contact --when-credits 3
```

## Trilogies Status
- ✅ 1-8: Complete
- ⏳ 9 (First Contact): Waiting for credits
