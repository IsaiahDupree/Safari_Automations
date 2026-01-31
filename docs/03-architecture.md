# Architecture

## Overview

Safari Social Automation uses a layered architecture with clear boundaries between components. This enables testing at each layer and allows platform adapters to be added independently.

## System Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              CLI / Runner                                │
│                         (apps/runner)                                    │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │
│  │   discover  │  │   engage    │  │     dm      │  │   analyze   │    │
│  │   command   │  │   command   │  │   command   │  │   command   │    │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘    │
└─────────┼────────────────┼────────────────┼────────────────┼────────────┘
          │                │                │                │
          └────────────────┴────────────────┴────────────────┘
                                    │
┌───────────────────────────────────┼─────────────────────────────────────┐
│                           Orchestration Layer                            │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                      Action Queue / Scheduler                    │   │
│  │              (rate limiting, cooldowns, prioritization)          │   │
│  └──────────────────────────────┬──────────────────────────────────┘   │
│                                 │                                       │
│  ┌──────────────────────────────┴──────────────────────────────────┐   │
│  │                      Policy Engine                               │   │
│  │         (dedupe, blocklists, approval gates, eligibility)        │   │
│  └──────────────────────────────┬──────────────────────────────────┘   │
└─────────────────────────────────┼───────────────────────────────────────┘
                                  │
┌─────────────────────────────────┼───────────────────────────────────────┐
│                          Platform Layer                                  │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐            │
│  │ Instagram │  │  TikTok   │  │  Threads  │  │ Twitter/X │            │
│  │  Adapter  │  │  Adapter  │  │  Adapter  │  │  Adapter  │            │
│  └─────┬─────┘  └─────┬─────┘  └─────┬─────┘  └─────┬─────┘            │
│        └──────────────┴──────────────┴──────────────┘                   │
│                              │                                          │
│  ┌───────────────────────────┴───────────────────────────────────┐     │
│  │                     Selector Registry                          │     │
│  │       (versioned selectors, fallbacks, contract tests)         │     │
│  └───────────────────────────┬───────────────────────────────────┘     │
└──────────────────────────────┼──────────────────────────────────────────┘
                               │
┌──────────────────────────────┼──────────────────────────────────────────┐
│                         Action Layer                                     │
│  ┌────────────────────────────────────────────────────────────────┐    │
│  │                      Action Engine                              │    │
│  │   (execute actions, handle errors, emit events)                 │    │
│  └────────────────────────────┬───────────────────────────────────┘    │
│                               │                                         │
│  ┌────────────────────────────┴───────────────────────────────────┐    │
│  │                    Verification Engine                          │    │
│  │   (confirm actions, reconcile state, detect failures)           │    │
│  └────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘
                               │
┌──────────────────────────────┼──────────────────────────────────────────┐
│                       Infrastructure Layer                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                  │
│  │   Browser    │  │  Persistence │  │ Observability│                  │
│  │   (Safari)   │  │  (Database)  │  │   (Logs)     │                  │
│  └──────────────┘  └──────────────┘  └──────────────┘                  │
└─────────────────────────────────────────────────────────────────────────┘
```

## Component Details

### CLI / Runner (`apps/runner`)

Entry point for all operations. Commands:

| Command | Purpose |
|---------|---------|
| `discover` | Find new posts/users to engage with |
| `engage` | Execute engagement actions (like, comment) |
| `dm` | Manage direct messages |
| `analyze` | Generate engagement reports |
| `selectors:test` | Run selector contract tests |
| `selectors:update` | Update selector registry |

```typescript
// apps/runner/src/commands/engage.ts
export async function engageCommand(options: EngageOptions) {
  const orchestrator = new Orchestrator();
  const posts = await orchestrator.getEligiblePosts(options.platform);
  
  for (const post of posts) {
    await orchestrator.executeEngagement(post, options.actions);
  }
}
```

### Orchestration Layer

#### Action Queue / Scheduler

Manages action execution with rate limiting:

```typescript
interface ActionQueue {
  enqueue(action: QueuedAction): Promise<string>;
  process(): Promise<void>;
  pause(): void;
  resume(): void;
  getStatus(): QueueStatus;
}

interface QueuedAction {
  id: string;
  platform: Platform;
  actionType: ActionType;
  target: ActionTarget;
  priority: number;
  scheduledFor?: Date;
  expiresAt?: Date;
}
```

#### Policy Engine

Enforces rules before actions execute:

```typescript
interface PolicyEngine {
  checkEligibility(action: QueuedAction): Promise<PolicyResult>;
  isDuplicate(action: QueuedAction): Promise<boolean>;
  isBlocked(target: ActionTarget): Promise<boolean>;
  requiresApproval(action: QueuedAction): boolean;
}

interface PolicyResult {
  eligible: boolean;
  reason?: string;
  cooldownMs?: number;
}
```

### Platform Layer

#### Platform Adapters

Each platform has an adapter implementing a common interface:

```typescript
interface PlatformAdapter {
  readonly platform: Platform;
  
  // Navigation
  navigateToFeed(): Promise<void>;
  navigateToPost(postId: string): Promise<void>;
  navigateToProfile(username: string): Promise<void>;
  navigateToDMs(): Promise<void>;
  
  // Extraction
  extractPostStats(postId: string): Promise<PostStats>;
  extractFeedPosts(): Promise<DiscoveredPost[]>;
  extractComments(postId: string): Promise<Comment[]>;
  extractDMThreads(): Promise<DMThread[]>;
  
  // Actions
  likePost(postId: string): Promise<ActionResult>;
  commentOnPost(postId: string, text: string): Promise<ActionResult>;
  sendDM(userId: string, text: string): Promise<ActionResult>;
  
  // Verification
  verifyLike(postId: string): Promise<boolean>;
  verifyComment(postId: string, commentId: string): Promise<boolean>;
  verifyDM(threadId: string, messageId: string): Promise<boolean>;
  
  // Session
  isLoggedIn(): Promise<boolean>;
  getSessionHealth(): Promise<SessionHealth>;
}
```

#### Selector Registry

Centralized selector management:

```typescript
interface SelectorRegistry {
  get(path: string): Selector;
  getWithFallbacks(path: string): Selector[];
  validate(path: string): Promise<SelectorValidation>;
  getVersion(): string;
}

interface Selector {
  primary: string;
  fallbacks: string[];
  type: 'css' | 'xpath' | 'aria';
  contract: SelectorContract;
}

interface SelectorContract {
  expectedCount: number | 'one' | 'many';
  mustBeClickable?: boolean;
  mustBeVisible?: boolean;
  mustSurviveScroll?: boolean;
}
```

### Action Layer

#### Action Engine

Executes actions with retry and error handling:

```typescript
interface ActionEngine {
  execute<T extends Action>(action: T): Promise<ActionResult<T>>;
  retry<T extends Action>(action: T, maxRetries: number): Promise<ActionResult<T>>;
  cancel(actionId: string): Promise<void>;
}

type Action = 
  | LikePostAction
  | CommentPostAction
  | SendDMAction
  | ExtractStatsAction;

interface ActionResult<T extends Action> {
  action: T;
  success: boolean;
  data?: T['resultType'];
  error?: ActionError;
  duration: number;
  attempts: number;
}
```

#### Verification Engine

Confirms actions completed successfully:

```typescript
interface VerificationEngine {
  verify(action: Action, result: ActionResult): Promise<VerificationResult>;
  reconcile(expected: ActionResult, actual: DOMState): Promise<ReconciliationResult>;
}

interface VerificationResult {
  verified: boolean;
  method: VerificationMethod;
  confidence: number;
  details?: Record<string, unknown>;
}

type VerificationMethod = 
  | 'dom-state'      // Check DOM after action
  | 'reload-check'   // Reload and verify
  | 'api-response'   // Check network response
  | 'attribute-change'; // Watch for attribute mutation
```

### Infrastructure Layer

#### Browser (`packages/browser`)

Safari WebDriver wrapper:

```typescript
interface Browser {
  initialize(): Promise<void>;
  close(): Promise<void>;
  
  // Navigation
  navigate(url: string): Promise<void>;
  refresh(): Promise<void>;
  back(): Promise<void>;
  
  // Elements
  findElement(selector: Selector): Promise<Element>;
  findElements(selector: Selector): Promise<Element[]>;
  waitForElement(selector: Selector, timeout?: number): Promise<Element>;
  
  // Actions
  click(element: Element): Promise<void>;
  type(element: Element, text: string): Promise<void>;
  scroll(direction: 'up' | 'down', amount?: number): Promise<void>;
  
  // State
  getCookies(): Promise<Cookie[]>;
  setCookies(cookies: Cookie[]): Promise<void>;
  takeScreenshot(): Promise<Buffer>;
  getPageSource(): Promise<string>;
  
  // JavaScript
  executeScript<T>(script: string, ...args: unknown[]): Promise<T>;
}
```

#### Persistence (`packages/db`)

Database operations:

```typescript
interface Database {
  // Posts
  savePost(post: Post): Promise<void>;
  getPost(platform: Platform, postId: string): Promise<Post | null>;
  getPostsForEngagement(criteria: PostCriteria): Promise<Post[]>;
  
  // Actions
  saveAction(action: ActionRecord): Promise<void>;
  getActionHistory(target: ActionTarget): Promise<ActionRecord[]>;
  hasEngaged(target: ActionTarget, actionType: ActionType): Promise<boolean>;
  
  // DMs
  saveDMThread(thread: DMThread): Promise<void>;
  saveDMMessage(message: DMMessage): Promise<void>;
  getDMThreads(platform: Platform): Promise<DMThread[]>;
  
  // Audit
  saveAuditEntry(entry: AuditEntry): Promise<void>;
  getAuditLog(filters: AuditFilters): Promise<AuditEntry[]>;
}
```

#### Observability (`packages/observability`)

Logging and tracing:

```typescript
interface Logger {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, error?: Error, context?: Record<string, unknown>): void;
  debug(message: string, context?: Record<string, unknown>): void;
}

interface Tracer {
  startSpan(name: string): Span;
  getCurrentSpan(): Span | null;
}

interface ArtifactStore {
  saveScreenshot(runId: string, name: string, data: Buffer): Promise<string>;
  saveHTML(runId: string, name: string, html: string): Promise<string>;
  getArtifacts(runId: string): Promise<Artifact[]>;
}
```

## Data Flow

### Engagement Flow

```
1. User runs: `npm run engage -- --platform=instagram`
                    │
2. CLI parses options, initializes orchestrator
                    │
3. Orchestrator queries DB for eligible posts
                    │
4. For each post:
   ├─ Policy Engine checks eligibility
   │   ├─ Not already engaged?
   │   ├─ Not on blocklist?
   │   ├─ Within rate limits?
   │   └─ Not in cooldown?
   │
   ├─ If eligible, queue action
   │
   ├─ Action Queue processes:
   │   ├─ Get platform adapter
   │   ├─ Navigate to post
   │   ├─ Execute action (like/comment)
   │   └─ Return result
   │
   ├─ Verification Engine confirms:
   │   ├─ Check DOM state changed
   │   ├─ Optionally reload & verify
   │   └─ Return verification result
   │
   └─ Persist results:
       ├─ Save action record
       ├─ Update post status
       └─ Write audit log
```

### State Machine

Each action goes through defined states:

```
┌──────────────┐
│  DISCOVERED  │  Post found in feed
└──────┬───────┘
       │
       ▼
┌──────────────┐     ┌──────────────┐
│   ELIGIBLE   │────▶│   BLOCKED    │  Failed policy check
└──────┬───────┘     └──────────────┘
       │
       ▼
┌──────────────┐     ┌──────────────┐
│   QUEUED     │────▶│   EXPIRED    │  Past expiration
└──────┬───────┘     └──────────────┘
       │
       ▼
┌──────────────┐     ┌──────────────┐
│  EXECUTING   │────▶│   FAILED     │  Action failed
└──────┬───────┘     └──────────────┘
       │
       ▼
┌──────────────┐     ┌──────────────┐
│  VERIFYING   │────▶│  UNVERIFIED  │  Couldn't confirm
└──────┬───────┘     └──────────────┘
       │
       ▼
┌──────────────┐
│   VERIFIED   │  Action confirmed
└──────┬───────┘
       │
       ▼
┌──────────────┐
│    DONE      │  Fully processed
└──────────────┘
```

## Error Handling

### Error Categories

```typescript
type ErrorCategory = 
  | 'selector'      // Element not found
  | 'action'        // Action failed to execute
  | 'verification'  // Couldn't verify action
  | 'session'       // Session/auth issue
  | 'rate_limit'    // Platform rate limit
  | 'platform'      // Platform-specific error
  | 'network'       // Network/connection issue
  | 'system';       // Internal system error
```

### Recovery Strategies

| Error Type | Strategy |
|------------|----------|
| Selector not found | Try fallbacks → Quarantine → Alert |
| Action failed | Retry with backoff → Skip → Alert |
| Verification failed | Retry verification → Mark unverified |
| Session expired | Re-authenticate → Continue |
| Rate limited | Pause → Wait cooldown → Resume |
| Network error | Retry with backoff → Alert |

### Circuit Breaker

Prevents cascading failures:

```typescript
interface CircuitBreaker {
  state: 'closed' | 'open' | 'half-open';
  failureCount: number;
  lastFailure: Date | null;
  
  execute<T>(fn: () => Promise<T>): Promise<T>;
  recordSuccess(): void;
  recordFailure(error: Error): void;
  shouldTrip(): boolean;
  reset(): void;
}
```

## Configuration

### Environment-Based Config

```typescript
interface Config {
  browser: {
    timeout: number;
    screenshotOnFailure: boolean;
    sessionPath: string;
  };
  
  rateLimit: {
    actionsPerHour: number;
    cooldownMs: number;
    quietHours: { start: number; end: number } | null;
  };
  
  platforms: {
    [platform: string]: {
      enabled: boolean;
      selectors: string; // path to selector file
      rateLimit?: Partial<RateLimitConfig>;
    };
  };
  
  db: {
    url: string;
    maxConnections: number;
  };
  
  observability: {
    logLevel: 'debug' | 'info' | 'warn' | 'error';
    artifactPath: string;
    retentionDays: number;
  };
}
```

## Extensibility

### Adding a New Platform

1. Create adapter in `packages/platforms/<name>/`
2. Define selectors in `packages/selectors/src/platforms/<name>/`
3. Write selector contract tests
4. Implement platform-specific actions
5. Add to platform registry
6. Document in `docs/platforms/<name>.md`

### Adding a New Action Type

1. Define action interface in `packages/actions/src/types/`
2. Implement action for each platform adapter
3. Add verification method
4. Update policy engine if needed
5. Add tests at all levels
