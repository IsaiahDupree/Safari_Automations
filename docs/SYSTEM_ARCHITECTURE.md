# Safari Automation System — Complete Architecture

> **Last updated**: February 22, 2026
> **Repository**: `IsaiahDupree/Safari_Automations`
> **Runtime**: macOS + Safari + Node.js (TypeScript) + Python

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [How It Works](#2-how-it-works)
3. [All Services & Ports](#3-all-services--ports)
4. [Platform Capabilities](#4-platform-capabilities)
5. [Sora Video Pipeline](#5-sora-video-pipeline)
6. [Market Research Engine](#6-market-research-engine)
7. [Twitter Feedback Loop](#7-twitter-feedback-loop)
8. [Universal Task Queue](#8-universal-task-queue)
9. [Safari Gateway](#9-safari-gateway)
10. [Task Scheduler](#10-task-scheduler)
11. [Content Packager](#11-content-packager)
12. [CRM & Relationship Scoring](#12-crm--relationship-scoring)
13. [External Access & Integration](#13-external-access--integration)
14. [Data Locations](#14-data-locations)
15. [Complete API Reference](#15-complete-api-reference)
16. [Starting the System](#16-starting-the-system)

---

## 1. System Overview

Safari Automation is a **full-stack social media automation platform** that uses macOS Safari as its browser engine. It automates engagement, content publishing, market research, lead generation, and feedback analysis across 7 platforms:

| Platform | Comments | DMs | Research | Publishing | Scraping |
|----------|----------|-----|----------|------------|----------|
| **Twitter/X** | ✅ | ✅ | ✅ | — | ✅ |
| **Instagram** | ✅ | ✅ | ✅ | ✅ (Blotato) | ✅ |
| **TikTok** | ✅ | ✅ | ✅ | ✅ (Blotato) | ✅ |
| **Threads** | ✅ | — | ✅ | — | ✅ |
| **Facebook** | ✅ | — | ✅ | — | ✅ |
| **LinkedIn** | — | ✅ | — | — | ✅ |
| **Upwork** | — | ✅ | — | — | ✅ |

Plus:
- **Sora AI** — video generation via OpenAI's Sora, watermark removal, stitching, publishing
- **YouTube** — video publishing via Blotato integration
- **Meta Ad Library** — ad scraping (no login required)

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    EXTERNAL SERVERS                          │
│  (any server, any language, via REST API or SDK client)      │
└─────────────┬───────────────────────────────┬───────────────┘
              │ REST API (port 3106)          │ Webhooks (push)
              ▼                               ▼
┌─────────────────────────────────────────────────────────────┐
│              MARKET RESEARCH API SERVER                       │
│  Port 3106 — Central orchestration hub                       │
│                                                              │
│  ┌──────────┐ ┌──────────────┐ ┌────────────┐ ┌──────────┐ │
│  │ Research  │ │ Feedback     │ │ Universal  │ │ Webhooks │ │
│  │ Engine   │ │ Loop         │ │ Task Queue │ │ System   │ │
│  └──────────┘ └──────────────┘ └────────────┘ └──────────┘ │
│  ┌──────────┐ ┌──────────────┐ ┌────────────┐              │
│  │ Auto-    │ │ API Key      │ │ SDK Client │              │
│  │ Scheduler│ │ Auth         │ │ (importable│              │
│  └──────────┘ └──────────────┘ └────────────┘              │
└─────────────┬───────────────────────────────────────────────┘
              │ Routes tasks to workers
              ▼
┌─────────────────────────────────────────────────────────────┐
│                   SAFARI GATEWAY                             │
│  Port 3000 — Browser lock + session management               │
└─────────────┬───────────────────────────────────────────────┘
              │ Exclusive Safari access
              ▼
┌─────────────────────────────────────────────────────────────┐
│               PLATFORM SERVICES (9 servers)                  │
│                                                              │
│  Twitter DM    (3003)    Instagram DM   (3100)               │
│  Threads Cmt   (3004)    TikTok DM      (3102)               │
│  IG Comments   (3005)    Upwork         (3104)               │
│  TikTok Cmt    (3006)    LinkedIn       (3105)               │
│  Twitter Cmt   (3007)                                        │
└─────────────┬───────────────────────────────────────────────┘
              │ AppleScript + JavaScript injection
              ▼
┌─────────────────────────────────────────────────────────────┐
│                    macOS SAFARI                               │
│  Real browser sessions — logged into all platforms           │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. How It Works

### Core Mechanism: AppleScript → Safari → JavaScript Injection

Every automation action follows this flow:

1. **AppleScript** tells Safari to navigate to a URL
2. **JavaScript** is injected into the page via `tell application "Safari" to do JavaScript`
3. The JS finds DOM elements, reads data, clicks buttons, types text
4. Results are returned as strings through AppleScript stdout

For actions that require real mouse clicks (TikTok, LinkedIn), the system uses **Quartz CGEvent** native mouse clicks via a Python helper, because some frameworks ignore synthetic JS `.click()` events.

### Reliability Layers (7 total)

Every posting/commenting action uses:

1. **Smart waits** — polls DOM conditions instead of fixed `sleep()` delays
2. **Multi-selector fallbacks** — tries multiple CSS selectors in priority order
3. **Retry with exponential backoff** — retries failed steps up to 3x
4. **3-strategy typing chain** — `execCommand('insertText')` → OS keystrokes → clipboard paste
5. **Typing verification** — confirms React/virtual DOM state updated before submit
6. **Error/popup detection** — catches rate limits, "something went wrong" toasts
7. **Screenshot on failure** — captures Safari state for debugging

### SafariDriver Pattern

Each platform package has a `SafariDriver` class that encapsulates:

```typescript
class SafariDriver {
  executeJS(script: string): Promise<string>     // Inject JS, get result
  navigate(url: string): Promise<boolean>         // Navigate Safari
  waitForSelector(sel: string): Promise<boolean>  // Smart wait
  clickAtViewportPosition(x, y): Promise<void>    // OS-level click (Quartz)
  typeViaKeystrokes(text: string): Promise<void>  // OS-level typing
  captureScreenshot(label: string): Promise<string>
}
```

---

## 3. All Services & Ports

| Port | Service | Package | What It Does |
|------|---------|---------|--------------|
| **3000** | Safari Gateway | `packages/scheduler` | Browser lock, session management, request routing |
| **3003** | Twitter DM | `packages/twitter-dm` | Send DMs, read conversations |
| **3004** | Threads Comments | `packages/threads-comments` | Post comments, read threads |
| **3005** | Instagram Comments | `packages/instagram-comments` | Post comments on IG posts |
| **3006** | TikTok Comments | `packages/tiktok-comments` | Post comments on TikTok videos |
| **3007** | Twitter Comments | `packages/twitter-comments` | Post replies, read tweets |
| **3010** | Task Scheduler | `packages/scheduler` | Recurring tasks, cron-like scheduling |
| **3100** | Instagram DM | `packages/instagram-dm` | Send DMs, thread management |
| **3102** | TikTok DM | `packages/tiktok-dm` | Send DMs with identity verification |
| **3104** | Upwork Automation | `packages/upwork-automation` | Job search, scoring, proposals, messages |
| **3105** | LinkedIn Automation | `packages/linkedin-automation` | Search, connect, DM, outreach engine |
| **3106** | Market Research API | `packages/market-research` | Research, feedback loop, universal queue |
| **5555** | MediaPoster Backend | External: `MediaPoster/Backend` | Video publishing queue → Blotato → YouTube/TikTok/IG |

---

## 4. Platform Capabilities

### Twitter/X (Ports 3003, 3007)

**Comments (3007):**
- `POST /api/twitter/comments/post` — post a reply to a tweet
- `GET /api/twitter/comments` — read comments on a tweet
- `GET /api/twitter/status` — check login status

**DMs (3003):**
- `POST /api/twitter/messages/send-to` — send DM to username
- Post-send verification: confirms message in DOM + captures recipient

**Research (via 3106):**
- Search by keyword, extract tweets with engagement metrics
- Scroll and collect up to 1000+ tweets per query
- Rank creators by engagement, identify top performers
- Multi-niche orchestration across multiple keywords

**Feedback Loop (via 3106):**
- Register tweets → check back at 1hr/4hr/24hr
- Extract live metrics: likes, retweets, replies, quotes, bookmarks, views
- Classify: viral / strong / average / weak / flop
- Analyze patterns: best hooks, topics, formats, times, lengths
- Generate optimized tweet prompts using performance history + offer context

### Instagram (Ports 3005, 3100)

**Comments (3005):**
- `POST /api/instagram/comments/post` — post comment on a post

**DMs (3100):**
- `POST /api/messages/smart-send` — auto-routes: thread cache → thread URL → profile-to-DM
- `POST /api/messages/send-to-thread` — fastest: direct thread URL
- `POST /api/messages/send-from-profile` — navigate to profile first
- `POST /api/threads/register` — cache thread IDs for fast access
- Auto-captures threadId on new conversations

**Research (via 3106):**
- Hashtag search, extract posts with engagement
- Detail scraping: likes, comments, caption, creator info
- 240+ posts scraped across 12+ hashtags

### TikTok (Ports 3006, 3102)

**Comments (3006):**
- `POST /api/tiktok/comments/post` — post comment on a video
- TikTok-specific selectors: `[data-e2e="comment-input"]`, etc.

**DMs (3102):**
- `POST /api/tiktok/messages/send-to` — send DM with pre-send identity verification
- Clicks avatars top-to-bottom, verifies conversation header matches target
- OS-level Quartz mouse click required (virtual DOM ignores JS click)

**Research (via 3106):**
- Search by keyword/hashtag
- Extract video engagement: views, likes, comments, shares
- Creator ranking with engagement scoring
- Multi-niche orchestration

### Threads (Port 3004)

**Comments:**
- `POST /api/threads/comments/post` — post comment on a thread
- `GET /api/threads/comments` — read thread comments

**Research (via 3106):**
- Search and extract threads with engagement metrics
- Creator identification and ranking

### Facebook (via 3106 + Python)

**Research:**
- Organic search scraping via Safari (`python/market_research/facebook_scraper.py`)
- 233+ posts scraped across multiple keywords
- Meta Ad Library scraping (`python/market_research/meta_ad_library.py`) — 536+ ads, no login needed

### LinkedIn (Port 3105)

**Profile Extraction:**
- `GET /api/linkedin/profile/:username` — full profile: name, headline, experience, skills, buttons

**Search:**
- `POST /api/linkedin/search/people` — search by keywords, title, company
- `POST /api/linkedin/prospect/search-score` — search + lead scoring (sorted)

**Connections:**
- `POST /api/linkedin/connections/request` — send connection with optional note
- Connection status detection: Connect/Message/Follow/Pending/More dropdown

**DMs:**
- `POST /api/linkedin/messages/send-to` — send DM to profile
- `GET /api/linkedin/messages/conversations` — list conversations
- `POST /api/linkedin/ai/generate-message` — GPT-4o personalized messages

**Outreach Engine:**
- `POST /api/linkedin/outreach/campaigns` — create multi-step outreach campaign
- `POST /api/linkedin/outreach/run` — execute: discover → connect → check → DM → follow-up → reply detect
- Prospect lifecycle: discovered → connection_sent → connected → first_dm → replied → engaged → converted
- Auto follow-ups at 3d/7d/14d, give up at 21d

### Upwork (Port 3104)

**Job Search:**
- `POST /api/upwork/jobs/search` — search with 20+ filters
- `POST /api/upwork/jobs/tab` — browse Best Matches, Most Recent, U.S. Only
- `GET /api/upwork/jobs/detail` — full job detail extraction
- `POST /api/upwork/jobs/score-batch` — AI scoring (0-100) with connects recommendations

**Messages:**
- `GET /api/upwork/messages` — list conversations
- `POST /api/upwork/messages/send` — send message with verification

**Proposals:**
- `POST /api/upwork/ai/generate-proposal` — GPT-4o proposal generation

**CAPTCHA Handling:**
- Cloudflare Turnstile detection + human-like mouse movement click

---

## 5. Sora Video Pipeline

### Generation → Processing → Publishing

```
Prompts → Sora AI → Raw Videos → Watermark Removal → Cleaned Videos
                                                          │
                                        ┌─────────────────┤
                                        ▼                 ▼
                                   Singles          Trilogies
                                                    (ffmpeg stitch)
                                        │                 │
                                        ▼                 ▼
                                    Daily Content Pipeline
                                        │
                                        ▼
                              Video Publish Queue (Supabase)
                                        │
                                        ▼
                              Blotato → YouTube / TikTok / IG
```

### Key Scripts

| Script | What It Does |
|--------|-------------|
| `scripts/sora-content-generator.ts` | Generate Sora videos from prompts |
| `scripts/stitch-trilogies.ts` | Concatenate multi-part videos via ffmpeg |
| `scripts/daily-content-pipeline.ts` | Scan cleaned videos, select daily mix, queue for publishing |
| `scripts/daily-orchestrator.ts` | UGC scripts + Sora video selection + queue management |
| `scripts/sora-daily-pipeline.ts` | Queue and drain the publish queue |
| `scripts/creative-radar-experiment.ts` | Market research briefs → Sora video prompts |

### Inventory (Feb 2026)

- **161 videos** in catalog, **158 available** (cleaned, watermark-free)
- **22 published** to YouTube (account 228: Isaiah Dupree)
- **~136 ready** to publish
- **7 batches**: february-trends (15), db-batch-1 (20), db-batch-2 (55), trending-batch-3 (47), content-gen-1 (4), content-gen-2 (8), content-gen-3 (9)

### Publishing Commands

```bash
# Dry run — see what would be published
npx tsx scripts/daily-content-pipeline.ts --dry-run --count 4

# Publish 4 videos to YouTube
npx tsx scripts/daily-content-pipeline.ts --count 4 --platform youtube

# Check publish status
npx tsx scripts/daily-content-pipeline.ts --status

# Stitch trilogy parts into finals
npx tsx scripts/stitch-trilogies.ts
```

---

## 6. Market Research Engine

### 5-Platform Research (Port 3106)

The unified research API runs full-pipeline research on any platform:

1. **Search** — finds posts/videos by keyword
2. **Extract** — pulls engagement metrics from each result
3. **Scroll & Collect** — scrolls page, deduplicates, collects 100s of items
4. **Rank Creators** — scores by total engagement, follower count, consistency
5. **Save** — persists to `~/Documents/market-research/{platform}/`

```bash
# Search a single query
curl -X POST localhost:3106/api/research/twitter/search \
  -H 'Content-Type: application/json' \
  -d '{"query": "AI automation"}'

# Full niche research (async job)
curl -X POST localhost:3106/api/research/tiktok/niche \
  -H 'Content-Type: application/json' \
  -d '{"niche": "indie hacking"}'

# Research across all 5 platforms
curl -X POST localhost:3106/api/research/all/full \
  -H 'Content-Type: application/json' \
  -d '{"niches": ["AI automation", "indie hacking", "SaaS"]}'
```

### Creative Radar (Python)

Advanced research pipeline that goes beyond raw scraping:

```
OfferSpec → discover() → load_all_posts() → ContentTagger → RankingEngine
    → PatternMiner → generate_briefs() → download_top_media()
        → Experiment Runner → Sora batch
```

4 offers configured: EverReach, SteadyLetters, VelvetHold, SnapMix

```bash
python3 python/market_research/creative_radar.py everreach --download-media
```

### Data Inventory

- **1,020+ posts** scraped: 178 Ad Library + 233 Facebook + 240+ Instagram + 300+ Twitter + TikTok
- **295 media files** (112MB) downloaded
- Results saved as JSON in `~/Documents/market-research/` and `~/market-research/`

---

## 7. Twitter Feedback Loop

### Closed-Loop: Post → Track → Analyze → Refine → Post

```
POST tweet
    │
    ▼
Register tweet (auto-extract hooks, CTA, hashtags)
    │
    ├── 1hr check-back → extract metrics
    ├── 4hr check-back → extract metrics
    └── 24hr check-back → extract final metrics
                              │
                              ▼
                    Classify (viral/strong/avg/weak/flop)
                              │
                              ▼
                    Analyze patterns
                    (best hooks, topics, formats, times, lengths)
                              │
                              ▼
                    Update strategy context
                    (winning patterns + anti-patterns + offer data)
                              │
                              ▼
                    Generate optimized tweet prompt
                              │
                              ▼
                    POST next tweet ← (loop)
```

### Components

| Component | What It Does |
|-----------|-------------|
| `TweetPerformanceTracker` | Stores tweets, schedules check-backs, extracts metrics from live Safari |
| `EngagementAnalyzer` | Classifies by percentile, finds hook/topic/format/time patterns |
| `PromptRefiner` | Generates optimized tweet prompts using history + offers + research |
| `TwitterFeedbackLoop` | Orchestrates the full cycle |
| `AutoScheduler` | Runs check-backs automatically every 10 minutes |

### Hook Pattern Detection

Automatically categorizes tweet hooks:
- `negative_command` — "Stop building apps from scratch"
- `how_to` — "Here's how I ship in 3 minutes"
- `personal_story` — "I wasted 6 months on auth"
- `numbered_list` — "5 tools I use daily"
- `question` — "What's your biggest bottleneck?"
- `curiosity_gap` — "The secret nobody tells you"
- `hot_take` — "Unpopular opinion: frameworks are overrated"

### Persistence

- `~/.twitter-feedback/tracked-tweets.json` — all tweets + metrics snapshots
- `~/.twitter-feedback/strategy-context.json` — latest analysis + prompt guidelines
- `~/.twitter-feedback/offers.json` — configured products/services
- `~/.twitter-feedback/niches.json` — niche context for prompt refinement

---

## 8. Universal Task Queue

### Platform-Agnostic, Task-Agnostic Job Queue

Any server can submit any type of task. The queue routes it to the right worker.

### Task Type Taxonomy

```
research.search        — keyword search on a platform
research.niche         — full niche research pipeline
research.full          — multi-niche research
research.all           — all platforms research

feedback.register      — register a tweet for tracking
feedback.checkback     — run due check-backs
feedback.analyze       — analyze + update strategy
feedback.metrics       — extract metrics for a URL
feedback.cycle         — full feedback loop cycle
feedback.prompt        — generate optimized prompt

comment.post           — post a comment on any platform
dm.send                — send a DM on any platform
video.queue            — queue a video for publishing
video.process          — process the publish queue
video.status           — get publish queue status
scrape.profile         — extract profile data
scrape.jobs            — search for jobs (Upwork)
```

### Features

- **Priority-based ordering**: critical > high > medium > low
- **Scheduled execution**: run tasks at a future time
- **Retry with backoff**: auto-retry failed tasks (configurable max retries)
- **Rate limiting**: per task-type or per platform
- **Per-task webhooks**: notify caller URL when task completes
- **Remote workers**: external servers register as workers via API
- **Persistent state**: survives server restarts (`~/.task-queue/`)

### 6 Built-in Workers

| Worker | Handles | Routes To |
|--------|---------|-----------|
| Research Worker | `research.*` | localhost:3106 research endpoints |
| Feedback Loop Worker | `feedback.*` | localhost:3106 feedback endpoints |
| Comment Worker | `comment.*` | Platform comment services (3004-3007) |
| DM Worker | `dm.*` | Platform DM services (3003, 3100, 3102, 3105) |
| Video Publish Worker | `video.*` | MediaPoster Backend (5555) |
| Scrape Worker | `scrape.*` | LinkedIn (3105), Upwork (3104) |

### Submit a Task

```bash
# Post a comment on Twitter
curl -X POST localhost:3106/api/queue/submit \
  -H 'Content-Type: application/json' \
  -d '{
    "type": "comment.post",
    "platform": "twitter",
    "payload": {"url": "https://x.com/user/status/123", "text": "Great thread!"},
    "priority": "high",
    "webhookUrl": "https://myserver.com/task-done"
  }'

# Send a DM on Instagram
curl -X POST localhost:3106/api/queue/submit \
  -d '{"type": "dm.send", "platform": "instagram", "payload": {"username": "johndoe", "text": "Hey!"}}'

# Run market research (async)
curl -X POST localhost:3106/api/queue/submit \
  -d '{"type": "research.niche", "platform": "tiktok", "payload": {"niche": "AI tools"}}'

# Schedule a task for later
curl -X POST localhost:3106/api/queue/submit \
  -d '{"type": "feedback.cycle", "payload": {"niche": "indie hacking"}, "scheduledFor": "2026-02-23T14:00:00Z"}'

# Submit a batch
curl -X POST localhost:3106/api/queue/submit/batch \
  -d '{"tasks": [
    {"type": "comment.post", "platform": "twitter", "payload": {"url": "...", "text": "Nice!"}},
    {"type": "dm.send", "platform": "instagram", "payload": {"username": "user1", "text": "Hey!"}}
  ]}'
```

### Register an External Worker

Any server can become a worker:

```bash
curl -X POST localhost:3106/api/queue/workers \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "My Custom AI Worker",
    "url": "http://myserver:8080/process-task",
    "taskPatterns": ["ai.generate", "ai.summarize"],
    "maxConcurrent": 3
  }'
```

Your server receives POSTs with:
```json
{
  "task": {
    "id": "task_1234",
    "type": "ai.generate",
    "platform": null,
    "payload": { "prompt": "Write a tweet about..." },
    "priority": "medium"
  }
}
```

---

## 9. Safari Gateway

### Port 3000 — Browser Lock + Session Management

Safari is a single-threaded resource. The Gateway ensures only one service uses it at a time.

```bash
# Acquire exclusive Safari access
curl -X POST localhost:3000/gateway/lock/acquire \
  -d '{"holder": "my-service", "platform": "twitter", "task": "post-comment", "timeoutMs": 30000}'

# Release when done
curl -X POST localhost:3000/gateway/lock/release -d '{"holder": "my-service"}'

# Check all platform login states
curl localhost:3000/gateway/sessions

# Full system dashboard
curl localhost:3000/gateway/dashboard

# Route a request through the gateway (auto-acquires lock)
curl -X POST localhost:3000/gateway/route \
  -d '{"platform": "twitter", "method": "POST", "path": "/api/twitter/comments/post", "body": {...}, "acquireLock": true}'
```

---

## 10. Task Scheduler

### Port 3010 — Recurring Task Management

```bash
# Schedule daily publishing
curl -X POST localhost:3010/api/publish/daily/recurring

# Schedule LinkedIn outreach cycle
curl -X POST localhost:3010/api/linkedin/outreach-cycle/recurring

# List all scheduled tasks
curl localhost:3010/api/tasks

# Trigger a task immediately
curl -X POST localhost:3010/api/tasks/:id/trigger
```

Task types: `publish`, `comment`, `dm`, `research`, `linkedin-outreach-cycle`

---

## 11. Content Packager

### Package: `packages/content-packager/`

Transforms raw market research data into structured `ContentPackage` JSON batches for a Remotion-based video recreation server.

```bash
npx tsx packages/content-packager/src/packager.ts \
  --platforms fb,ig --top-n 50 --min-engagement 1000
```

Output: `~/market-research/content-packages/batch_{timestamp}.json`

Each package includes: source reference, content analysis (hook, CTA, tone), media manifest, performance metrics, render spec (Remotion composition ID), recreation instructions.

---

## 12. CRM & Relationship Scoring

### Packages: `packages/crm-core/`, `packages/crm-client/`

- Relationship scoring engine (`scripts/relationship-scoring-engine.ts`)
- DM coaching engine (`scripts/dm-coaching-engine.ts`)
- Automated outreach (`scripts/automated-outreach.ts`)

---

## 13. External Access & Integration

### 3 Ways for External Servers to Connect

#### Option 1: TypeScript SDK Client (recommended)

```typescript
import { ResearchClient } from '@safari-automation/market-research';

const client = new ResearchClient({
  baseUrl: 'http://localhost:3106',
  apiKey: process.env.RESEARCH_API_KEY,
});

// Submit any task to the queue
await client.submitTask({
  type: 'comment.post',
  platform: 'twitter',
  payload: { url: '...', text: 'Great post!' },
  priority: 'high',
  webhookUrl: 'https://myserver.com/done',
});

// Run the feedback loop
await client.registerTweet('https://x.com/you/status/123', 'My tweet', 'indie hacking');
const strategy = await client.getStrategy();
const { prompt } = await client.generatePrompt('indie hacking', 'educational');

// Market research
await client.search('tiktok', 'AI automation');
await client.researchNiche('twitter', 'indie hacking');

// Webhooks
await client.registerWebhook('https://myserver.com/hook', ['strategy.updated', 'task.completed']);
```

#### Option 2: Webhooks (push model — zero polling)

```bash
# Register webhook
curl -X POST localhost:3106/api/webhooks \
  -d '{"url": "https://myserver.com/hook", "events": ["*"], "secret": "my-secret"}'
```

Events fired:
- `checkback.complete` — tweet check-backs finished
- `strategy.updated` — feedback strategy recalculated
- `task.completed` — a queued task finished
- `task.failed` — a queued task failed
- `test` — test delivery

Each webhook receives:
```json
{
  "event": "task.completed",
  "timestamp": "2026-02-23T03:22:27.705Z",
  "data": { "taskId": "...", "type": "comment.post", "result": {...} }
}
```
Headers: `X-Webhook-Event`, `X-Webhook-Secret`

#### Option 3: Direct REST API

```bash
# With API key auth enabled
curl -H 'X-API-Key: your-key' localhost:3106/api/queue/submit -d '{...}'

# Or via Bearer token
curl -H 'Authorization: Bearer your-key' localhost:3106/api/feedback/strategy

# Or query param
curl 'localhost:3106/api/queue/stats?api_key=your-key'
```

### Authentication

Set `RESEARCH_API_KEY` environment variable to enable auth:

```bash
RESEARCH_API_KEY=my-secret-key npx tsx packages/market-research/src/api/server.ts
```

When set, all endpoints require the key (except `/health`). When not set, all endpoints are open.

---

## 14. Data Locations

### Video Content

| Path | Contents |
|------|----------|
| `~/sora-videos/cleaned/{batch}/` | Watermark-free videos |
| `~/sora-videos/finals/{batch}/` | Stitched trilogy finals |
| `~/sora-videos/daily-pipeline-catalog.json` | Full video catalog (161 videos) |
| `~/sora-videos/daily-publish-log.json` | Published video log (22 entries) |
| `~/sora-videos/SORA_MASTER_CATALOG.json` | Master catalog |

### Research Data

| Path | Contents |
|------|----------|
| `~/Documents/market-research/` | Unified research output dir |
| `~/market-research/facebook/posts/` | Facebook scrape results |
| `~/market-research/instagram/posts/` | Instagram scrape results |
| `~/market-research/meta-ad-library/ads/` | Meta Ad Library results |
| `~/market-research/creative-radar/{offer}/` | Creative Radar output |

### Feedback & Queue State

| Path | Contents |
|------|----------|
| `~/.twitter-feedback/tracked-tweets.json` | All tracked tweets + metrics |
| `~/.twitter-feedback/strategy-context.json` | Latest analysis |
| `~/.twitter-feedback/offers.json` | Configured offers |
| `~/.twitter-feedback/niches.json` | Niche context |
| `~/.twitter-feedback/webhooks.json` | Registered webhooks |
| `~/.task-queue/tasks.json` | Universal queue tasks |
| `~/.task-queue/workers.json` | Registered remote workers |
| `~/.task-queue/rate-limits.json` | Rate limit config |

### LinkedIn Outreach

| Path | Contents |
|------|----------|
| `~/.linkedin-outreach/prospects.json` | All prospects + stages |
| `~/.linkedin-outreach/campaigns.json` | Outreach campaigns |
| `~/.linkedin-outreach/runs.json` | Run history |

---

## 15. Complete API Reference

### Market Research API (Port 3106)

#### Research Endpoints

| Method | Path | Body | Description |
|--------|------|------|-------------|
| GET | `/health` | — | Health check (always open) |
| GET | `/api/research/platforms` | — | List supported platforms |
| POST | `/api/research/:platform/search` | `{query, config?}` | Search a single query |
| POST | `/api/research/:platform/niche` | `{niche, config?}` | Full niche research (async) |
| POST | `/api/research/:platform/full` | `{niches[], config?}` | Multi-niche research (async) |
| POST | `/api/research/all/full` | `{niches[], platforms?, config?}` | All-platform research |
| GET | `/api/research/status` | — | Current + recent jobs |
| GET | `/api/research/status/:jobId` | — | Specific job status |
| GET | `/api/research/results` | `?platform=` | List result files |
| GET | `/api/research/results/latest/:platform` | — | Latest result for platform |
| GET | `/api/research/results/file/*` | — | Read a result file |
| GET | `/api/research/download/*` | — | Download a result file |

#### Feedback Loop Endpoints

| Method | Path | Body | Description |
|--------|------|------|-------------|
| GET | `/api/feedback/status` | — | Full system status |
| POST | `/api/feedback/register` | `{tweetUrl, text, niche?, offer?}` | Register tweet for tracking |
| POST | `/api/feedback/register/batch` | `{tweets[]}` | Register multiple tweets |
| POST | `/api/feedback/check-backs` | — | Run due check-backs |
| POST | `/api/feedback/metrics` | `{tweetUrl}` | Extract live metrics |
| POST | `/api/feedback/analyze` | — | Analyze + update strategy |
| GET | `/api/feedback/strategy` | — | Get current strategy |
| POST | `/api/feedback/generate-prompt` | `{niche, style?, offer?}` | Generate optimized prompt |
| POST | `/api/feedback/cycle` | `{niche, style?, offer?}` | Full cycle: check → analyze → prompt |
| POST | `/api/feedback/offers` | `{offers[]}` | Set offer context |
| GET | `/api/feedback/offers` | — | Get offers |
| POST | `/api/feedback/niches` | `{niches[]}` | Set niche context |
| GET | `/api/feedback/niches` | — | Get niches |
| GET | `/api/feedback/tweets` | `?classification=&status=` | List tracked tweets |
| GET | `/api/feedback/due` | — | Tweets due for check-back |

#### Universal Queue Endpoints

| Method | Path | Body | Description |
|--------|------|------|-------------|
| POST | `/api/queue/submit` | `{type, payload, platform?, priority?, scheduledFor?, webhookUrl?}` | Submit a task |
| POST | `/api/queue/submit/batch` | `{tasks[]}` | Submit multiple tasks |
| GET | `/api/queue/:taskId` | — | Get task status |
| GET | `/api/queue` | `?status=&type=&platform=&limit=&submittedBy=` | List tasks |
| POST | `/api/queue/cancel/:taskId` | — | Cancel a task |
| GET | `/api/queue/stats` | — | Queue statistics |
| POST | `/api/queue/workers` | `{name, url, taskPatterns[], platforms?, maxConcurrent?}` | Register remote worker |
| GET | `/api/queue/workers` | — | List all workers |
| DELETE | `/api/queue/workers/:id` | — | Remove a worker |
| POST | `/api/queue/rate-limits` | `{key, maxPerHour, maxPerDay}` | Set rate limit |
| POST | `/api/queue/control/start` | — | Start queue processing |
| POST | `/api/queue/control/stop` | — | Stop queue processing |
| POST | `/api/queue/control/cleanup` | `{olderThanMs?}` | Remove old completed tasks |

#### Webhook Endpoints

| Method | Path | Body | Description |
|--------|------|------|-------------|
| GET | `/api/webhooks` | — | List registered webhooks |
| POST | `/api/webhooks` | `{url, events[], secret?}` | Register a webhook |
| DELETE | `/api/webhooks/:id` | — | Delete a webhook |
| POST | `/api/webhooks/test` | `{url}` | Test webhook delivery |

#### Auto-Scheduler Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/scheduler/status` | Scheduler running state |
| POST | `/api/scheduler/start` | Start auto check-backs (every 10min) |
| POST | `/api/scheduler/stop` | Stop auto check-backs |
| POST | `/api/scheduler/trigger` | Run check-back tick immediately |

---

## 16. Starting the System

### Minimal (just the central API)

```bash
npx tsx packages/market-research/src/api/server.ts
```

This starts port 3106 with research, feedback loop, universal queue, webhooks, and auto-scheduler.

### Full System

```bash
# 1. Safari Gateway (manages browser lock)
npx tsx packages/scheduler/src/safari-gateway.ts

# 2. Platform services (start the ones you need)
npx tsx packages/twitter-dm/src/api/server.ts          # 3003
npx tsx packages/threads-comments/src/api/server.ts     # 3004
npx tsx packages/instagram-comments/src/api/server.ts   # 3005
npx tsx packages/tiktok-comments/src/api/server.ts      # 3006
npx tsx packages/twitter-comments/src/api/server.ts     # 3007
npx tsx packages/instagram-dm/src/api/server.ts         # 3100
npx tsx packages/tiktok-dm/src/api/server.ts            # 3102
npx tsx packages/upwork-automation/src/api/server.ts    # 3104
npx tsx packages/linkedin-automation/src/api/server.ts  # 3105

# 3. Central API (research + feedback + queue)
npx tsx packages/market-research/src/api/server.ts      # 3106

# 4. Task Scheduler
npx tsx packages/scheduler/src/server.ts                # 3010

# 5. With API key auth
RESEARCH_API_KEY=your-key npx tsx packages/market-research/src/api/server.ts
```

### Prerequisites

- **macOS** with Safari
- **Node.js** 18+ with `npx tsx` available
- **Python 3.9+** (for Creative Radar, Quartz clicks)
- **ffmpeg** (for video stitching)
- Safari logged into all target platforms
- `OPENAI_API_KEY` env var (for AI message generation)
- `pyobjc-framework-Quartz` Python package (for TikTok/LinkedIn native clicks)

---

## Package Directory

```
packages/
├── market-research/          # Central API: research + feedback + queue + SDK
│   ├── src/api/server.ts     #   Express server (port 3106)
│   ├── src/queue/            #   Universal task queue + built-in workers
│   └── src/sdk/client.ts     #   TypeScript SDK for external servers
├── twitter-comments/         # Twitter replies + feedback loop
├── twitter-dm/               # Twitter DMs
├── instagram-comments/       # Instagram comments
├── instagram-dm/             # Instagram DMs + thread management
├── tiktok-comments/          # TikTok comments + researcher
├── tiktok-dm/                # TikTok DMs + identity verification
├── threads-comments/         # Threads comments
├── facebook-comments/        # Facebook comments
├── linkedin-automation/      # LinkedIn: profiles, search, connect, DM, outreach
├── upwork-automation/        # Upwork: jobs, scoring, proposals, messages
├── scheduler/                # Safari Gateway + Task Scheduler
├── content-packager/         # Research → Remotion video packages
├── crm-core/                 # CRM data models
├── crm-client/               # CRM client
├── unified-comments/         # Cross-platform comment abstraction
├── unified-dm/               # Cross-platform DM abstraction
├── unified-client/           # Unified API client
├── social-cli/               # CLI tools
├── shared/                   # Shared utilities
├── selectors/                # CSS selector libraries
├── protocol/                 # Communication protocol
├── browser/                  # Browser helpers
├── services/                 # Service layer
├── comment-api/              # Comment API abstraction
└── actp/                     # Automation control protocol

scripts/                      # 47 automation scripts
python/                       # Python services
├── market_research/          #   Creative Radar, FB/IG/Ad scrapers
├── services/                 #   Orchestrator, event listener, queue manager
├── automation/               #   Safari extension helpers
├── controllers/              #   Controller layer
├── engagement/               #   Engagement analysis
├── selectors/                #   Python selector helpers
└── utils/                    #   Utilities

docs/                         # 46 documentation files
```
