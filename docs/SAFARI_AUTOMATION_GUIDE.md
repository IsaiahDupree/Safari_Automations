# Safari Automation Guide

Complete guide to the Safari Automation system for DMs, comments, and video generation.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Safari Automation System                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐│
│  │   DM APIs   │  │Comment APIs │  │  Scheduler  │  │    Sora     ││
│  │ 3001-3003   │  │ 3004-3007   │  │    3010     │  │   Videos    ││
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘│
│         │                │                │                │        │
│         └────────────────┴────────────────┴────────────────┘        │
│                              │                                       │
│                     ┌────────┴────────┐                             │
│                     │  Safari Browser │                             │
│                     │   (AppleScript) │                             │
│                     └─────────────────┘                             │
└─────────────────────────────────────────────────────────────────────┘
```

## Port Reference

| Service | Port | Package |
|---------|------|---------|
| Main API | 3000 | — |
| Instagram DM | 3001 | `packages/instagram-dm` |
| TikTok DM | 3002 | `packages/tiktok-dm` |
| Twitter DM | 3003 | `packages/twitter-dm` |
| Threads Comments | 3004 | `packages/threads-comments` |
| Instagram Comments | 3005 | `packages/instagram-comments` |
| TikTok Comments | 3006 | `packages/tiktok-comments` |
| Twitter Comments | 3007 | `packages/twitter-comments` |
| Scheduler API | 3010 | `packages/scheduler` |

## Quick Start

### 1. Start Services

```bash
# Dashboard (view all services)
npx tsx scripts/dashboard.ts

# Start DM APIs
npx tsx packages/instagram-dm/src/api/server.ts &
npx tsx packages/tiktok-dm/src/api/server.ts &
npx tsx packages/twitter-dm/src/api/server.ts &

# Start Comment APIs
npx tsx packages/threads-comments/src/api/server.ts &
npx tsx packages/instagram-comments/src/api/server.ts &
npx tsx packages/tiktok-comments/src/api/server.ts &
npx tsx packages/twitter-comments/src/api/server.ts &

# Start Scheduler
npx tsx packages/scheduler/src/api/server.ts &
```

### 2. Check Health

```bash
# DM health
npx tsx packages/unified-dm/src/cli.ts health

# Comment health
npx tsx packages/unified-comments/src/cli.ts health

# Scheduler status
npx tsx packages/scheduler/cli/scheduler-cli.ts status
```

### 3. Send a DM

```bash
npx tsx packages/unified-dm/src/cli.ts send tiktok @username "Hello!"
```

### 4. Post a Comment

```bash
npx tsx packages/unified-comments/src/cli.ts post threads "Great post!"
```

### 5. Schedule Sora Trilogy

```bash
npx tsx packages/scheduler/cli/scheduler-cli.ts sora first_contact --when-credits 3
```

## Unified Clients

### Unified DM Client

```typescript
import { UnifiedDMClient } from '@safari-automation/unified-dm';

const dm = new UnifiedDMClient();

// Check health
await dm.checkHealth();

// Send DM
await dm.sendDM('tiktok', 'username', 'Hello!');

// List conversations
await dm.listConversations('instagram');
```

### Unified Comments Client

```typescript
import { UnifiedCommentsClient } from '@safari-automation/unified-comments';

const comments = new UnifiedCommentsClient();

// Check health
await comments.checkHealth();

// Post comment
await comments.postComment('threads', 'Great post!', 'https://...');

// Get comments
await comments.getComments('instagram', 20);
```

## Scheduler

The scheduler manages task queues and monitors Sora credits.

```bash
# View queue
npx tsx packages/scheduler/cli/scheduler-cli.ts queue

# Check resources (Sora credits)
npx tsx packages/scheduler/cli/scheduler-cli.ts resources

# Start scheduler daemon
npx tsx packages/scheduler/cli/scheduler-cli.ts start
```

## Rate Limits

| Platform | Comments/Hour | Comments/Day | DMs/Hour |
|----------|---------------|--------------|----------|
| Threads | 5 | 20 | — |
| Instagram | 5 | 15 | 10 |
| TikTok | 5 | 15 | 10 |
| Twitter | 10 | 30 | 15 |

## Workflows

Use slash commands in Windsurf:

- `/dashboard` - View all services
- `/scheduler` - Manage task scheduler
- `/sora` - Generate video trilogies
- `/dm` - Manage DM automation
- `/comments` - Manage comment automation

## Prerequisites

1. **macOS** with Safari
2. **Safari > Develop > Allow JavaScript from Apple Events** enabled
3. Logged into platforms in Safari
4. Node.js 18+
