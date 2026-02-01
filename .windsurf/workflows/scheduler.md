---
description: Manage the Safari Task Scheduler
---

## Check scheduler status
// turbo
```bash
npx tsx packages/scheduler/cli/scheduler-cli.ts status
```

## View task queue
// turbo
```bash
npx tsx packages/scheduler/cli/scheduler-cli.ts queue
```

## Check Sora credits and resources
// turbo
```bash
npx tsx packages/scheduler/cli/scheduler-cli.ts resources
```

## Schedule a Sora trilogy (waits for credits)
```bash
npx tsx packages/scheduler/cli/scheduler-cli.ts sora <trilogy_id> --when-credits 3
```

Available trilogies:
- volcanic_fury, abyssal_descent, neon_shadows
- frozen_edge, titan_protocol, temporal_shift
- midnight_run, way_of_dragon, first_contact

## Start the scheduler daemon
```bash
npx tsx packages/scheduler/cli/scheduler-cli.ts start
```

## Start the scheduler API (port 3010)
```bash
npx tsx packages/scheduler/src/api/server.ts
```
