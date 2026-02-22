# Safari Automations — Complete Inventory & Architecture

> Last updated: Feb 22, 2026

---

## Overview

The Safari Automation system is a monorepo of **13 automation services** that all share a single Safari browser instance via AppleScript/Quartz. Each service runs as an independent Express API server on its own port.

**Core constraint:** Safari has ONE front document/tab. Only one automation can use Safari at a time. The scheduler manages exclusivity via `safariExclusive: true` resource requirements.

---

## Service Inventory

| # | Package | Port | Platform | Capabilities |
|---|---------|------|----------|-------------|
| 1 | `instagram-dm` | 3100 | Instagram | DMs, thread management, conversation list |
| 2 | `tiktok-dm` | 3102 | TikTok | DMs via OS-level Quartz click (virtual DOM) |
| 3 | `twitter-dm` | 3003 | Twitter/X | DMs, profile-to-DM flow |
| 4 | `threads-comments` | 3004 | Threads | Comment posting, reply automation |
| 5 | `instagram-comments` | 3005 | Instagram | Comment posting on posts |
| 6 | `tiktok-comments` | 3006 | TikTok | Comment posting on videos |
| 7 | `twitter-comments` | 3007 | Twitter/X | Reply posting on tweets |
| 8 | `upwork-automation` | 3104 | Upwork | Job scanning, proposals, monitoring |
| 9 | `linkedin-automation` | 3105 | LinkedIn | Profiles, connections, DMs, outreach engine |
| 10 | `scheduler` | 3010 | All | Task scheduling, queue management, Sora monitor |
| 11 | `services` | — | All | SafariService, SafariExecutor, SessionManager, Orchestrator |
| 12 | `protocol` | 7070/7071 | All | Control server, telemetry/WebSocket |
| 13 | `unified-dm` | — | Multi | CLI for cross-platform DM sending |

---

## Safari Driver Implementations

Each package has its own SafariDriver class (duplicated, not shared). All use the same core pattern:

```
AppleScript → osascript → Safari → do JavaScript → DOM
```

| Package | Driver File | Special Features |
|---------|------------|------------------|
| `services` | `safari-executor.ts` | Base executor: screenshot, JS file execution, domain verification |
| `services` | `safari-service.ts` | High-level: post comments on all 4 platforms, login checks |
| `instagram-dm` | `safari-driver.ts` | Local + remote mode, temp-file JS, login detection |
| `tiktok-dm` | `safari-driver.ts` | Quartz OS-level click (`clickAtViewportPosition`) |
| `twitter-dm` | `safari-driver.ts` | Local + remote mode, temp-file JS |
| `linkedin-automation` | `safari-driver.ts` | Quartz click, dynamic toolbar offset, `nativeClickByText` |
| `upwork-automation` | `safari-driver.ts` | CAPTCHA detection, scroll/type/clipboard |
| `instagram-comments` | `instagram-driver.ts` | Comment-specific selectors |

### Common Methods (all drivers)

| Method | Description |
|--------|-------------|
| `executeJS(code)` | Run JavaScript in Safari front document |
| `navigateTo(url)` | Navigate Safari to a URL |
| `getCurrentUrl()` | Get current page URL |
| `typeViaClipboard(text)` | Copy text → pbcopy → Cmd+V paste |
| `pressEnter()` | OS-level Enter keystroke |
| `activateSafari()` | Bring Safari to foreground |
| `clickElement(selector)` | JS `.click()` on CSS selector |
| `focusElement(selector)` | JS `.focus()` + `.click()` |
| `wait(ms)` | Sleep |
| `takeScreenshot(path)` | screencapture |

### Platform-Specific Methods

| Method | Package | Description |
|--------|---------|-------------|
| `clickAtViewportPosition(x, y)` | linkedin, tiktok | Quartz CGEvent native mouse click |
| `nativeClickSelector(css)` | linkedin | Get bounding rect → native click |
| `nativeClickByText(text)` | linkedin | Find by text → native click |
| `typeViaKeystrokes(text)` | instagram, twitter | OS-level character-by-character typing |
| `isLoggedIn()` | instagram | Check Instagram login state |
| `isOnTikTok()` | tiktok | URL check |

---

## Detailed Capabilities by Platform

### Instagram (ports 3100, 3005)

**DMs (3100):**
- `POST /api/messages/smart-send` — intelligent: thread cache → URL → profile fallback
- `POST /api/messages/send-to-thread` — direct thread URL navigation
- `POST /api/messages/send-from-profile` — profile page → Message button
- `GET /api/conversations` — list conversations
- `GET /api/messages/:threadId` — read messages
- `POST /api/threads/register` — cache thread IDs
- `GET /api/threads` — list cached threads

**Comments (3005):**
- `POST /api/comments/post` — post comment on a post URL
- `POST /api/comments/generate` — AI-generate comment
- `GET /api/comments/history` — comment history

### TikTok (ports 3102, 3006)

**DMs (3102):**
- `POST /api/tiktok/messages/send-to` — send DM to username
- OS-level Quartz click required (virtual DOM, 0x0 bounding rects)
- Pre-send identity verification: clicks avatars, checks header matches

**Comments (3006):**
- `POST /api/comments/post` — post comment on video
- `POST /api/comments/generate` — AI-generate comment

### Twitter/X (ports 3003, 3007)

**DMs (3003):**
- `POST /api/twitter/messages/send-to` — profile-to-DM flow
- `GET /api/twitter/conversations` — list conversations
- `[data-testid]` selectors (stable across updates)

**Comments (3007):**
- `POST /api/comments/post` — reply to tweet
- `POST /api/comments/generate` — AI-generate reply

### Threads (port 3004)

**Comments:**
- `POST /api/comments/post` — reply to a thread
- SVG `aria-label="Reply"` selectors

### LinkedIn (port 3105)

**Profiles:**
- `GET /api/linkedin/profile/:username` — full extraction
- `GET /api/linkedin/profile/extract-current` — current page
- `POST /api/linkedin/profile/score` — lead scoring

**Connections:**
- `POST /api/linkedin/connections/request` — send with note
- `GET /api/linkedin/connections/status` — check status
- `GET /api/linkedin/connections/pending` — pending requests
- `POST /api/linkedin/connections/accept` — accept request

**Messaging:**
- `GET /api/linkedin/conversations` — list all
- `POST /api/linkedin/messages/open` — open by name (native click)
- `GET /api/linkedin/messages` — read current thread
- `POST /api/linkedin/messages/send` — send in current thread
- `POST /api/linkedin/messages/send-to` — profile → compose

**Outreach Engine:**
- `POST /api/linkedin/outreach/campaigns` — create campaign
- `POST /api/linkedin/outreach/run` — run cycle (discover→connect→DM→follow-up)
- Full prospect lifecycle with persistent JSON state

**Search:**
- `POST /api/linkedin/search/people` — search with filters
- `POST /api/linkedin/prospect/search-score` — search + score
- `POST /api/linkedin/prospect/pipeline` — full pipeline

### Upwork (port 3104)

- `GET /api/upwork/jobs/scan` — scan job listings
- `POST /api/upwork/jobs/apply` — submit proposals
- `GET /api/upwork/jobs/monitor` — monitor saved jobs
- CAPTCHA detection and handling

### Sora / Content Pipeline

- `POST /api/sora/daily-pipeline` — generate → clean → register → catalog → queue → drain
- `POST /api/queue/drain` — drain publish queue to Blotato → YouTube/TikTok/IG
- Scheduler-managed (port 3010)

---

## Session Management

### Current State

The `SessionManager` class (`packages/services/src/session-manager/`) tracks login state for 7 platforms:

| Platform | Home URL | Logged-In Indicator | Refresh Interval |
|----------|----------|-------------------|-----------------|
| Twitter | `x.com/home` | `[data-testid="AppTabBar_Profile_Link"]` | 25 min |
| TikTok | `tiktok.com/foryou` | `[data-e2e="profile-icon"]` | 20 min |
| Instagram | `instagram.com/` | `svg[aria-label="Home"]` | 25 min |
| Threads | `threads.net/` | `[aria-label="Create"]` | 25 min |
| YouTube | `youtube.com/` | `#avatar-btn` | 45 min |
| Reddit | `reddit.com/` | `[data-testid="user-dropdown"]` | 30 min |
| Sora | `sora.com/` | `[class*="avatar"]` | 30 min |

**Note:** LinkedIn and Upwork are NOT yet in the SessionManager. They manage sessions implicitly.

### Session Status Flow

```
active → stale → expired
  ↑        ↓        ↓
  └── refresh ──┘  re-login required
```

---

## Scheduler (port 3010)

The scheduler manages task execution with Safari exclusivity.

### Task Types

| Task Type | Platform | Safari Exclusive | Timeout |
|-----------|----------|-----------------|---------|
| `sora-daily-pipeline` | Sora | Yes | 60 min |
| `sora-generate` | Sora | Yes | 30 min |
| `queue-drain` | All | No | 45 min |
| `publish` | All | Yes | 30 min |
| `dm` | Multi | Yes | 10 min |
| `comment` | Multi | Yes | 5 min |
| `discovery` | Multi | Yes | 15 min |
| `market-research` | Multi | Yes | 30 min |
| `market-research-instagram` | IG | Yes | 30 min |
| `upwork-job-scan` | Upwork | Yes | 15 min |
| `upwork-monitor-scan` | Upwork | Yes | 10 min |
| `upwork-apply` | Upwork | Yes | 20 min |
| `linkedin-outreach-cycle` | LinkedIn | Yes | 5 min |
| `linkedin-prospect` | LinkedIn | Yes | 10 min |

### Resource Management

```typescript
interface ResourceRequirements {
  soraCredits?: number;    // Sora generation credits needed
  platform?: Platform;     // Which platform session is needed
  safariExclusive?: boolean; // Needs exclusive Safari access
}
```

---

## Current Architecture Problems

### 1. No Unified Safari Lock
Each service runs independently. If two services try to use Safari simultaneously, they'll conflict. The scheduler has `safariExclusive` but only for tasks it manages — direct API calls bypass it.

### 2. Duplicated Drivers
6 separate SafariDriver implementations with identical core logic. Bug fixes (like `echo -n` → `printf`) must be applied to each.

### 3. No Session Pre-Check
Services don't verify login state before attempting operations. A stale session causes silent failures.

### 4. No Cross-Service Coordination
The DM services (Instagram, TikTok, Twitter) can't coordinate without manual orchestration. The scheduler routes tasks but doesn't manage the API layer.

---

## Proposed: Unified Safari Gateway

A single gateway service that:
1. **Manages Safari access** with a queue/lock
2. **Checks sessions** before routing tasks
3. **Routes API calls** to the correct service
4. **Reports status** across all platforms

### Architecture

```
                    ┌──────────────────┐
                    │  Safari Gateway   │
                    │    (port 3000)    │
                    ├──────────────────┤
  Clients ────────→ │  Safari Lock      │ ── acquires exclusive Safari access
                    │  Session Checker  │ ── verifies login before each task
                    │  Request Router   │ ── forwards to correct service
                    │  Health Monitor   │ ── tracks all service health
                    └─────┬──────┬─────┘
                          │      │
          ┌───────────────┼──────┼───────────────┐
          │               │      │               │
     ┌────▼───┐     ┌────▼───┐ ┌▼────────┐  ┌───▼────┐
     │IG DM   │     │TikTok  │ │LinkedIn  │  │Upwork  │ ...
     │ :3100  │     │ :3102  │ │ :3105   │  │ :3104  │
     └────────┘     └────────┘ └─────────┘  └────────┘
```

### Gateway Endpoints

```
GET  /gateway/health          — all services status
GET  /gateway/sessions        — all platform login states
POST /gateway/sessions/check  — verify login for a platform
POST /gateway/sessions/refresh — refresh a platform session
POST /gateway/acquire         — acquire Safari lock (with timeout)
POST /gateway/release         — release Safari lock
POST /gateway/route           — route a task to a service
```

### Safari Lock Protocol

```typescript
interface SafariLock {
  holder: string;       // service name
  acquiredAt: Date;
  expiresAt: Date;      // auto-release after timeout
  platform: Platform;
}
```

Any service wanting Safari must:
1. `POST /gateway/acquire` → gets lock or waits in queue
2. Perform operation
3. `POST /gateway/release` → frees Safari for next task

---

## Start Commands

```bash
# Individual services
npx tsx packages/scheduler/src/api/server.ts              # :3010
npx tsx packages/instagram-dm/src/api/server.ts           # :3100
npx tsx packages/tiktok-dm/src/api/server.ts              # :3102
npx tsx packages/twitter-dm/src/api/server.ts             # :3003
npx tsx packages/threads-comments/src/api/server.ts       # :3004
npx tsx packages/instagram-comments/src/api/server.ts     # :3005
npx tsx packages/tiktok-comments/src/api/server.ts        # :3006
npx tsx packages/twitter-comments/src/api/server.ts       # :3007
npx tsx packages/upwork-automation/src/api/server.ts      # :3104
npx tsx packages/linkedin-automation/src/api/server.ts    # :3105

# Protocol
npx tsx packages/protocol/src/control-server.ts           # :7070
npx tsx packages/protocol/src/telemetry-server.ts         # :7071
```

---

## Testing

| Package | Test Command | Tests |
|---------|-------------|-------|
| `linkedin-automation` | `npx tsx src/__tests__/selectors.test.ts` | 18/18 |
