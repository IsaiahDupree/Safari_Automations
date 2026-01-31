# Observability

## Overview

Observability in this project covers:
- **Logging**: Structured logs for debugging and audit
- **Tracing**: Request/action flow tracking
- **Artifacts**: Screenshots, HTML snapshots, recordings
- **Metrics**: Action success rates, timing, health

## Logging

### Log Levels

| Level | Usage |
|-------|-------|
| `error` | Failures requiring attention |
| `warn` | Anomalies that don't block operation |
| `info` | Key events and state changes |
| `debug` | Detailed debugging information |

### Structured Logging

All logs are structured JSON for easy parsing:

```typescript
interface LogEntry {
  timestamp: string;       // ISO 8601
  level: 'error' | 'warn' | 'info' | 'debug';
  message: string;
  
  // Context
  runId?: string;
  stepId?: string;
  platform?: string;
  accountId?: string;
  
  // Error details
  error?: {
    name: string;
    message: string;
    stack?: string;
    code?: string;
  };
  
  // Additional context
  [key: string]: unknown;
}
```

### Logger Implementation

```typescript
// packages/observability/src/logger.ts

import pino from 'pino';

export interface LogContext {
  runId?: string;
  stepId?: string;
  platform?: string;
  accountId?: string;
}

export class Logger {
  private pino: pino.Logger;
  private context: LogContext = {};

  constructor(options: { level: string; pretty?: boolean }) {
    this.pino = pino({
      level: options.level,
      transport: options.pretty
        ? { target: 'pino-pretty' }
        : undefined,
      base: undefined,
      timestamp: pino.stdTimeFunctions.isoTime,
    });
  }

  withContext(context: Partial<LogContext>): Logger {
    const newLogger = Object.create(this);
    newLogger.context = { ...this.context, ...context };
    return newLogger;
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.pino.info({ ...this.context, ...data }, message);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.pino.warn({ ...this.context, ...data }, message);
  }

  error(message: string, error?: Error, data?: Record<string, unknown>): void {
    this.pino.error(
      {
        ...this.context,
        ...data,
        error: error
          ? {
              name: error.name,
              message: error.message,
              stack: error.stack,
            }
          : undefined,
      },
      message
    );
  }

  debug(message: string, data?: Record<string, unknown>): void {
    this.pino.debug({ ...this.context, ...data }, message);
  }
}
```

### Log Examples

```typescript
// Good: Structured with context
logger.info('Action completed', {
  actionType: 'like',
  postId: 'ABC123',
  durationMs: 1523,
  verified: true,
});

// Good: Error with full context
logger.error('Selector not found', selectorError, {
  selector: 'instagram.post.likeButton',
  fallbacksAttempted: 3,
  pageUrl: 'https://instagram.com/p/ABC123',
});

// Bad: Unstructured
logger.info(`Liked post ABC123 in 1523ms`);  // Don't do this
```

### What NOT to Log

- ❌ Passwords or credentials
- ❌ Session cookies
- ❌ Full DM content
- ❌ Personal user data beyond necessary
- ❌ API keys

## Tracing

### Trace Structure

```
Run
├── Step: Initialize Browser
│   └── Span: Safari session creation
├── Step: Navigate to Feed
│   ├── Span: Page load
│   └── Span: Wait for elements
├── Step: Extract Post
│   ├── Span: Find post element
│   ├── Span: Extract stats
│   └── Span: Parse data
├── Step: Like Post
│   ├── Span: Find like button
│   ├── Span: Click
│   └── Span: Verify
└── Step: Persist
    └── Span: Database write
```

### Tracer Implementation

```typescript
// packages/observability/src/tracer.ts

export interface Span {
  id: string;
  name: string;
  parentId: string | null;
  startTime: number;
  endTime?: number;
  status: 'in_progress' | 'success' | 'error';
  attributes: Record<string, unknown>;
  
  end(status?: 'success' | 'error'): void;
  setAttribute(key: string, value: unknown): void;
}

export class Tracer {
  private runId: string;
  private spans: Map<string, Span> = new Map();
  private currentSpanId: string | null = null;

  constructor(runId: string) {
    this.runId = runId;
  }

  startSpan(name: string, attributes?: Record<string, unknown>): Span {
    const span: Span = {
      id: generateId(),
      name,
      parentId: this.currentSpanId,
      startTime: Date.now(),
      status: 'in_progress',
      attributes: attributes || {},
      
      end: (status = 'success') => {
        span.endTime = Date.now();
        span.status = status;
        this.currentSpanId = span.parentId;
      },
      
      setAttribute: (key, value) => {
        span.attributes[key] = value;
      },
    };
    
    this.spans.set(span.id, span);
    this.currentSpanId = span.id;
    
    return span;
  }

  getCurrentSpan(): Span | null {
    return this.currentSpanId ? this.spans.get(this.currentSpanId) || null : null;
  }

  getTrace(): Span[] {
    return Array.from(this.spans.values());
  }
}
```

### Usage

```typescript
const tracer = new Tracer(runId);

// Action execution with tracing
const actionSpan = tracer.startSpan('like_post', { postId });

try {
  const findSpan = tracer.startSpan('find_like_button');
  const button = await browser.findElement(selectors.likeButton);
  findSpan.end('success');

  const clickSpan = tracer.startSpan('click_button');
  await button.click();
  clickSpan.end('success');

  const verifySpan = tracer.startSpan('verify_like');
  const verified = await verifyLike(postId);
  verifySpan.setAttribute('verified', verified);
  verifySpan.end(verified ? 'success' : 'error');

  actionSpan.end('success');
} catch (error) {
  actionSpan.setAttribute('error', error.message);
  actionSpan.end('error');
  throw error;
}
```

## Artifacts

### Artifact Types

| Type | Purpose | Retention |
|------|---------|-----------|
| Screenshot | Visual debugging | 7 days |
| HTML Snapshot | DOM state debugging | 7 days |
| Network HAR | Request debugging | 3 days |
| Trace JSON | Flow analysis | 30 days |

### Artifact Storage

```typescript
// packages/observability/src/artifacts.ts

export interface Artifact {
  id: string;
  runId: string;
  stepId: string;
  type: 'screenshot' | 'html' | 'har' | 'trace';
  filename: string;
  path: string;
  size: number;
  createdAt: Date;
  expiresAt: Date;
}

export class ArtifactStore {
  private basePath: string;

  constructor(basePath: string = './artifacts') {
    this.basePath = basePath;
  }

  async saveScreenshot(
    runId: string,
    stepId: string,
    name: string,
    data: Buffer
  ): Promise<Artifact> {
    const filename = `${name}-${Date.now()}.png`;
    const dir = path.join(this.basePath, runId);
    await fs.mkdir(dir, { recursive: true });
    
    const filepath = path.join(dir, filename);
    await fs.writeFile(filepath, data);
    
    return this.createArtifact({
      runId,
      stepId,
      type: 'screenshot',
      filename,
      path: filepath,
      size: data.length,
      retentionDays: 7,
    });
  }

  async saveHTML(
    runId: string,
    stepId: string,
    name: string,
    html: string
  ): Promise<Artifact> {
    const filename = `${name}-${Date.now()}.html`;
    const dir = path.join(this.basePath, runId);
    await fs.mkdir(dir, { recursive: true });
    
    const filepath = path.join(dir, filename);
    await fs.writeFile(filepath, html);
    
    return this.createArtifact({
      runId,
      stepId,
      type: 'html',
      filename,
      path: filepath,
      size: Buffer.byteLength(html),
      retentionDays: 7,
    });
  }

  async getArtifacts(runId: string): Promise<Artifact[]> {
    // Query database for artifacts by runId
  }

  async cleanup(): Promise<number> {
    // Delete expired artifacts
  }
}
```

### Screenshot on Failure

```typescript
// Automatically capture on error
async function withScreenshotOnFailure<T>(
  browser: Browser,
  artifacts: ArtifactStore,
  context: { runId: string; stepId: string; name: string },
  fn: () => Promise<T>
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    const screenshot = await browser.takeScreenshot();
    await artifacts.saveScreenshot(
      context.runId,
      context.stepId,
      `failure-${context.name}`,
      screenshot
    );
    
    const html = await browser.getPageSource();
    await artifacts.saveHTML(
      context.runId,
      context.stepId,
      `failure-${context.name}`,
      html
    );
    
    throw error;
  }
}
```

## Run Context

### Run ID Generation

Every execution session has a unique run ID:

```typescript
function generateRunId(): string {
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
  const random = Math.random().toString(36).slice(2, 8);
  return `run_${timestamp}_${random}`;
}

// Example: run_20240115T143022_a1b2c3
```

### Step ID Generation

Steps within a run:

```typescript
function generateStepId(runId: string, index: number): string {
  return `${runId}_step_${index.toString().padStart(4, '0')}`;
}

// Example: run_20240115T143022_a1b2c3_step_0001
```

### Context Propagation

```typescript
interface ExecutionContext {
  runId: string;
  stepIndex: number;
  logger: Logger;
  tracer: Tracer;
  artifacts: ArtifactStore;
}

// Create context at start
const context: ExecutionContext = {
  runId: generateRunId(),
  stepIndex: 0,
  logger: new Logger({ level: 'info' }).withContext({ runId }),
  tracer: new Tracer(runId),
  artifacts: new ArtifactStore(),
};

// Pass through all operations
await executeAction(action, context);
```

## Audit Timeline

### Timeline View

For any run, reconstruct exact sequence:

```typescript
interface TimelineEvent {
  timestamp: Date;
  type: 'log' | 'span_start' | 'span_end' | 'artifact' | 'audit';
  data: unknown;
}

async function getRunTimeline(runId: string): Promise<TimelineEvent[]> {
  const [logs, spans, artifacts, audits] = await Promise.all([
    getLogs(runId),
    getSpans(runId),
    getArtifacts(runId),
    getAuditEntries(runId),
  ]);
  
  const events: TimelineEvent[] = [
    ...logs.map(l => ({ timestamp: l.timestamp, type: 'log', data: l })),
    ...spans.flatMap(s => [
      { timestamp: s.startTime, type: 'span_start', data: s },
      s.endTime ? { timestamp: s.endTime, type: 'span_end', data: s } : null,
    ]).filter(Boolean),
    ...artifacts.map(a => ({ timestamp: a.createdAt, type: 'artifact', data: a })),
    ...audits.map(a => ({ timestamp: a.timestamp, type: 'audit', data: a })),
  ];
  
  return events.sort((a, b) => a.timestamp - b.timestamp);
}
```

### Timeline CLI

```bash
# View timeline for a run
npm run timeline -- --run=run_20240115T143022_a1b2c3

# Output:
# 14:30:22.001 [INFO] Session started
# 14:30:22.015 [SPAN] Initialize Browser (start)
# 14:30:23.456 [SPAN] Initialize Browser (end, 1441ms)
# 14:30:23.460 [INFO] Navigating to feed
# 14:30:23.461 [SPAN] Navigate (start)
# 14:30:25.789 [SPAN] Navigate (end, 2328ms)
# 14:30:25.800 [INFO] Extracting posts
# ...
```

## Health Metrics

### Key Metrics

| Metric | Description | Alert Threshold |
|--------|-------------|-----------------|
| `action_success_rate` | % of actions that succeed | < 90% |
| `selector_hit_rate` | % of primary selectors working | < 95% |
| `verification_rate` | % of actions verified | < 99% |
| `session_duration` | How long sessions last | < 30 min |
| `action_duration_p95` | 95th percentile action time | > 10s |

### Metrics Collection

```typescript
// packages/observability/src/metrics.ts

interface Metrics {
  increment(name: string, tags?: Record<string, string>): void;
  gauge(name: string, value: number, tags?: Record<string, string>): void;
  histogram(name: string, value: number, tags?: Record<string, string>): void;
}

class LocalMetrics implements Metrics {
  private data: Map<string, number[]> = new Map();

  increment(name: string, tags?: Record<string, string>): void {
    const key = this.makeKey(name, tags);
    const values = this.data.get(key) || [];
    values.push(1);
    this.data.set(key, values);
  }

  histogram(name: string, value: number, tags?: Record<string, string>): void {
    const key = this.makeKey(name, tags);
    const values = this.data.get(key) || [];
    values.push(value);
    this.data.set(key, values);
  }

  getStats(name: string): { count: number; avg: number; p95: number } {
    const values = this.data.get(name) || [];
    if (values.length === 0) return { count: 0, avg: 0, p95: 0 };
    
    const sorted = [...values].sort((a, b) => a - b);
    const p95Index = Math.floor(sorted.length * 0.95);
    
    return {
      count: values.length,
      avg: values.reduce((a, b) => a + b, 0) / values.length,
      p95: sorted[p95Index],
    };
  }
}
```

### Usage

```typescript
// Track action outcomes
metrics.increment('action_total', { platform: 'instagram', type: 'like' });
metrics.increment('action_success', { platform: 'instagram', type: 'like' });

// Track timing
metrics.histogram('action_duration_ms', durationMs, { platform: 'instagram', type: 'like' });

// Track selector performance
metrics.increment('selector_attempt', { selector: 'instagram.post.likeButton' });
metrics.increment('selector_hit', { selector: 'instagram.post.likeButton' });
```

## Alerting

### Alert Rules

```typescript
interface AlertRule {
  name: string;
  condition: (metrics: Metrics) => boolean;
  severity: 'warning' | 'critical';
  message: string;
}

const alertRules: AlertRule[] = [
  {
    name: 'low_success_rate',
    condition: (m) => m.getStats('action_success').count / m.getStats('action_total').count < 0.9,
    severity: 'critical',
    message: 'Action success rate below 90%',
  },
  {
    name: 'selector_breakage',
    condition: (m) => m.getStats('selector_hit').count / m.getStats('selector_attempt').count < 0.95,
    severity: 'warning',
    message: 'Selector hit rate below 95%',
  },
  {
    name: 'slow_actions',
    condition: (m) => m.getStats('action_duration_ms').p95 > 10000,
    severity: 'warning',
    message: 'P95 action duration exceeds 10 seconds',
  },
];
```

### Alert Destinations

```typescript
interface AlertDestination {
  send(alert: Alert): Promise<void>;
}

// Console (always enabled)
class ConsoleAlertDestination implements AlertDestination {
  async send(alert: Alert): Promise<void> {
    console.log(`[ALERT ${alert.severity}] ${alert.message}`);
  }
}

// File (for persistence)
class FileAlertDestination implements AlertDestination {
  async send(alert: Alert): Promise<void> {
    await fs.appendFile('alerts.log', JSON.stringify(alert) + '\n');
  }
}
```

## Configuration

### Environment Variables

```bash
# Log level
LOG_LEVEL=info  # debug | info | warn | error

# Artifact storage
ARTIFACT_PATH=./artifacts
ARTIFACT_RETENTION_DAYS=7

# Screenshots
SCREENSHOT_ON_FAILURE=true
SCREENSHOT_ON_SUCCESS=false

# Metrics
METRICS_ENABLED=true
```

### Observability Config

```typescript
interface ObservabilityConfig {
  logging: {
    level: string;
    pretty: boolean;
    destination: 'stdout' | 'file';
    filePath?: string;
  };
  artifacts: {
    enabled: boolean;
    path: string;
    screenshotOnFailure: boolean;
    htmlOnFailure: boolean;
    retention: {
      screenshots: number;  // days
      html: number;
      traces: number;
    };
  };
  metrics: {
    enabled: boolean;
    flushIntervalMs: number;
  };
  alerting: {
    enabled: boolean;
    destinations: ('console' | 'file')[];
  };
}
```
