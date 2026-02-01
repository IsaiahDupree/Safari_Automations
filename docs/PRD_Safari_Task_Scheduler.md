# PRD: Safari Task Scheduler & Unified Automation System

**Document ID:** SAFARI-002  
**Version:** 2.0  
**Date:** 2026-02-01  
**Author:** Cascade AI  
**Status:** ✅ Implemented  

---

## Executive Summary

This PRD defines a unified Safari Task Scheduler and Automation Manager that coordinates all browser-based automations (DMs, video generation, comments) with intelligent scheduling, resource monitoring (Sora credits), and CRM integration.

---

## Current State Analysis

### ✅ What Exists

| Component | Status | Port | Notes |
|-----------|--------|------|-------|
| **TikTok DM API** | ✅ Working | 3002 | Full API with rate limiting |
| **Instagram DM API** | ✅ Working | 3001 | Full API with CRM sync |
| **Twitter DM API** | ⚠️ Exists | 3101 | Has server, needs testing |
| **Sora Video Gen** | ✅ Working | — | CLI-based, no scheduling |
| **Comment Engine** | ⚠️ Partial | — | Basic structure exists |
| **Queue Manager** | ✅ Exists | — | Priority-based task queue |
| **Orchestrator** | ⚠️ Basic | — | Comment-focused only |
| **CRM Core** | ✅ Exists | — | Embedded in this repo |

### ✅ What Was Implemented

1. **Sora Credit Monitor** - ✅ `packages/scheduler/src/sora-credit-monitor.ts`
2. **Unified Task Scheduler** - ✅ `packages/scheduler/src/task-scheduler.ts`
3. **Cross-service Coordination** - ✅ `packages/unified-dm/` unified DM client
4. **CRM Offload** - ⏳ `packages/crm-client/` created (ready for migration)
5. **Comprehensive Tests** - ✅ Tests added for TikTok/Instagram/Twitter DM

### Current Test Coverage

| Package | Tests | Status |
|---------|-------|--------|
| Sora Automation | ✅ Unit tests | Good |
| Rate Limiter | ✅ Unit tests | Good |
| Verification | ✅ Unit tests | Good |
| TikTok DM | ⚠️ Integration only | Needs unit tests |
| Instagram DM | ⚠️ Scripts only | Needs formal tests |
| Twitter DM | ❌ None | Needs tests |
| CRM Core | ✅ Has tests dir | Partial |

---

## Requirements

### 1. Safari Task Scheduler (Core)

#### 1.1 Unified Task Queue

```typescript
interface ScheduledTask {
  id: string;
  type: 'sora' | 'dm' | 'comment' | 'discovery';
  platform?: 'tiktok' | 'instagram' | 'twitter';
  priority: 1 | 2 | 3 | 4 | 5; // 1 = highest
  scheduledFor: Date;
  dependencies?: string[]; // Task IDs that must complete first
  resourceRequirements?: {
    soraCredits?: number;
    platform?: string;
  };
  status: 'pending' | 'scheduled' | 'running' | 'completed' | 'failed';
  retryCount: number;
  maxRetries: number;
  payload: Record<string, unknown>;
}
```

#### 1.2 Resource Monitor

```typescript
interface ResourceMonitor {
  // Sora credits
  getSoraCredits(): Promise<{ free: number; paid: number; refreshesAt: Date }>;
  onCreditsAvailable(threshold: number, callback: () => void): void;
  
  // Platform availability  
  isPlatformReady(platform: string): Promise<boolean>;
  getPlatformCooldown(platform: string): number; // ms until ready
}
```

#### 1.3 Scheduler API

```typescript
interface TaskScheduler {
  // Task management
  schedule(task: Omit<ScheduledTask, 'id' | 'status'>): string;
  cancel(taskId: string): boolean;
  reschedule(taskId: string, newTime: Date): boolean;
  
  // Queue operations
  getQueue(): ScheduledTask[];
  getRunning(): ScheduledTask[];
  getCompleted(limit?: number): ScheduledTask[];
  
  // Control
  start(): void;
  stop(): void;
  pause(): void;
  resume(): void;
  
  // Events
  on(event: 'taskComplete' | 'taskFailed' | 'creditsRefreshed', handler: Function): void;
}
```

### 2. Sora Credit Monitor

#### 2.1 Credit Tracking

```typescript
interface SoraCreditMonitor {
  // Check current credits
  checkCredits(): Promise<SoraCreditStatus>;
  
  // Schedule check for credit refresh
  scheduleRefreshCheck(): void;
  
  // Auto-queue videos when credits available
  queueVideosOnRefresh(videos: VideoPrompt[]): void;
}

interface SoraCreditStatus {
  freeCredits: number;
  paidCredits: number;
  totalCredits: number;
  lastChecked: Date;
  estimatedRefreshTime: Date | null; // Based on patterns
  refreshIntervalHours: number; // Typically 24h for free tier
}
```

#### 2.2 Auto-Resume Feature

When Sora credits become available:
1. Check pending video queue
2. Automatically start next batch of trilogies
3. Resume DM/comment automation after video tasks complete

### 3. Twitter DM Service

#### 3.1 Port Assignment

| Service | Port |
|---------|------|
| Instagram DM | 3001 |
| TikTok DM | 3002 |
| **Twitter DM** | **3003** |
| Main API | 3000 |

#### 3.2 Required Tests

```
tests/
├── unit/
│   └── twitter-dm.test.ts
├── integration/
│   └── twitter-dm-api.test.ts
└── e2e/
    └── twitter-dm-flow.test.ts
```

### 4. CRM Offload Strategy

#### 4.1 Current State

CRM code lives in `packages/crm-core/` within this repo.

#### 4.2 Target State

```
Safari-Automation/
├── packages/
│   └── crm-client/          # Thin client to call CRM API
│       ├── src/
│       │   ├── client.ts    # HTTP client to CRM
│       │   └── types.ts     # Shared types
│       └── package.json

CRM-Repo/ (separate repository)
├── packages/
│   └── crm-core/            # Moved from Safari Automation
├── apps/
│   └── crm-api/             # REST API for CRM
└── package.json
```

#### 4.3 Migration Steps

1. Create new CRM repository
2. Move `packages/crm-core` to CRM repo
3. Create `packages/crm-client` in Safari Automation
4. Update imports throughout Safari Automation
5. Deploy CRM API separately

### 5. Unified Dashboard (Future)

```
┌─────────────────────────────────────────────────────────────┐
│  SAFARI AUTOMATION DASHBOARD                                │
├─────────────────────────────────────────────────────────────┤
│  RESOURCES                                                  │
│  ├─ Sora Credits: 3/50 (refreshes in 4h 23m)               │
│  ├─ TikTok: ✅ Ready (42 msgs today)                       │
│  ├─ Instagram: ✅ Ready (18 msgs today)                    │
│  └─ Twitter: ⚠️ Rate limited (resumes in 15m)              │
├─────────────────────────────────────────────────────────────┤
│  TASK QUEUE                                                 │
│  1. [RUNNING] Sora: Way of Dragon Ch3                      │
│  2. [PENDING] Sora: First Contact Trilogy (needs 3 credits)│
│  3. [SCHEDULED] TikTok DM: Reply to @user123 (in 5m)       │
│  4. [SCHEDULED] Instagram: Sync conversations (in 1h)      │
├─────────────────────────────────────────────────────────────┤
│  RECENT ACTIVITY                                            │
│  • 2:30 PM - Completed: Way of Dragon finale               │
│  • 2:15 PM - Sent DM to @creator on TikTok                 │
│  • 2:00 PM - Synced 12 Instagram conversations             │
└─────────────────────────────────────────────────────────────┘
```

---

## Implementation Plan

### Phase 1: Core Scheduler (Week 1-2)

- [ ] Create `packages/scheduler/` package
- [ ] Implement `TaskScheduler` class
- [ ] Implement `ResourceMonitor` class
- [ ] Create scheduler CLI commands
- [ ] Add persistence (JSON file or SQLite)

### Phase 2: Sora Integration (Week 2-3)

- [ ] Implement `SoraCreditMonitor`
- [ ] Add credit check to polling loop
- [ ] Create auto-resume for video queue
- [ ] Add trilogy batch scheduling

### Phase 3: Platform Unification (Week 3-4)

- [ ] Update Twitter DM to port 3003
- [ ] Add Twitter DM tests
- [ ] Create unified DM client
- [ ] Standardize API responses

### Phase 4: CRM Offload (Week 4-5)

- [ ] Create CRM repository
- [ ] Migrate crm-core package
- [ ] Create crm-client package
- [ ] Update all imports
- [ ] Deploy CRM API

### Phase 5: Testing & Polish (Week 5-6)

- [ ] Add comprehensive tests for all packages
- [ ] Create dashboard CLI
- [ ] Add monitoring/alerts
- [ ] Documentation

---

## API Design

### Scheduler CLI

```bash
# Start scheduler daemon
npx tsx scheduler start

# View queue
npx tsx scheduler queue

# Schedule Sora trilogy when credits available
npx tsx scheduler sora --trilogy first_contact --when-credits 3

# Schedule DM automation
npx tsx scheduler dm --platform tiktok --start "9:00" --end "17:00"

# Check resources
npx tsx scheduler resources

# Pause/resume
npx tsx scheduler pause
npx tsx scheduler resume
```

### Scheduler REST API

```
GET  /api/scheduler/status
GET  /api/scheduler/queue
POST /api/scheduler/task
DELETE /api/scheduler/task/:id

GET  /api/resources/sora
GET  /api/resources/platforms

POST /api/sora/queue-trilogy
GET  /api/sora/credits
```

---

## Success Criteria

1. **Unified Scheduling**: All tasks managed through single scheduler
2. **Auto-Resume**: Videos auto-generate when Sora credits refresh
3. **Resource Awareness**: Tasks wait for required resources
4. **Platform Coordination**: Safari shared cleanly between services
5. **CRM Separation**: CRM logic in dedicated repository
6. **Test Coverage**: >80% for all packages
7. **CLI Usability**: All features accessible via CLI

---

## File Structure

```
packages/
├── scheduler/
│   ├── src/
│   │   ├── index.ts
│   │   ├── task-scheduler.ts
│   │   ├── resource-monitor.ts
│   │   ├── sora-credit-monitor.ts
│   │   ├── persistence.ts
│   │   └── types.ts
│   ├── cli/
│   │   └── scheduler-cli.ts
│   └── package.json
├── crm-client/
│   ├── src/
│   │   ├── client.ts
│   │   └── types.ts
│   └── package.json
└── unified-dm/
    ├── src/
    │   ├── client.ts        # Unified DM client
    │   └── types.ts
    └── package.json
```

---

## Appendix: Current Port Assignments

| Service | Port | Status |
|---------|------|--------|
| Main API | 3000 | ✅ Active |
| Instagram DM | 3001 | ✅ Active |
| TikTok DM | 3002 | ✅ Active |
| Twitter DM | 3003 | ⚠️ Proposed |
| Scheduler API | 3010 | 📋 Planned |
| CRM API | 3020 | 📋 Planned |
