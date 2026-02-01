# Safari Task Scheduler

Unified task scheduler for Safari automation with Sora credit monitoring and resource-aware scheduling.

## Features

- **Priority Queue** - Tasks processed by priority (1=highest, 5=lowest)
- **Sora Credit Monitor** - Tracks credits, estimates refresh time, auto-triggers when available
- **Resource Awareness** - Tasks wait for required resources (credits, platform availability)
- **Persistence** - Queue state saved to disk, survives restarts
- **REST API** - HTTP endpoints for remote control (port 3010)

## CLI Usage

```bash
# Check status
npx tsx cli/scheduler-cli.ts status

# View queue
npx tsx cli/scheduler-cli.ts queue

# Check resources (Sora credits)
npx tsx cli/scheduler-cli.ts resources

# Schedule Sora trilogy (waits for credits)
npx tsx cli/scheduler-cli.ts sora first_contact --when-credits 3

# Schedule DM session
npx tsx cli/scheduler-cli.ts dm tiktok --duration 60

# Start scheduler daemon
npx tsx cli/scheduler-cli.ts start

# Cancel a task
npx tsx cli/scheduler-cli.ts cancel <taskId>
```

## REST API

Start the API server:
```bash
npx tsx src/api/server.ts
```

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/api/scheduler/status` | Scheduler status |
| GET | `/api/scheduler/queue` | View task queue |
| POST | `/api/scheduler/start` | Start scheduler |
| POST | `/api/scheduler/stop` | Stop scheduler |
| POST | `/api/scheduler/task` | Create new task |
| DELETE | `/api/scheduler/task/:id` | Cancel task |
| GET | `/api/resources` | All resources status |
| GET | `/api/resources/sora` | Sora credits |
| POST | `/api/sora/queue-trilogy` | Queue Sora trilogy |
| POST | `/api/dm/schedule` | Schedule DM session |

## Programmatic Usage

```typescript
import { TaskScheduler, SoraCreditMonitor } from '@safari-automation/scheduler';

const scheduler = new TaskScheduler({
  persistPath: './scheduler-state.json',
  checkIntervalMs: 10000,
  enableSoraMonitor: true,
});

// Schedule a Sora trilogy
scheduler.scheduleSoraTrilogy('first_contact', 'First Contact', {
  waitForCredits: 3,
  priority: 2,
});

// Start processing
scheduler.start();

// Listen for events
scheduler.on('taskCompleted', (task) => {
  console.log(`Completed: ${task.name}`);
});
```

## Configuration

```typescript
interface SchedulerConfig {
  persistPath: string;         // Where to save state
  checkIntervalMs: number;     // How often to check queue (default: 5000)
  maxConcurrentTasks: number;  // Max parallel tasks (default: 1)
  defaultRetries: number;      // Retry count (default: 3)
  quietHoursStart?: number;    // Quiet hours start (0-23)
  quietHoursEnd?: number;      // Quiet hours end (0-23)
  enableSoraMonitor: boolean;  // Enable credit monitoring
  soraCheckIntervalMs: number; // Credit check interval (default: 5min)
}
```
