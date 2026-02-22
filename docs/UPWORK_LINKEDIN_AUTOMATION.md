# Upwork & LinkedIn Safari Automation

**Version:** 1.0.0  
**Date:** February 2026  
**Status:** Production  

---

## Overview

Safari-automated platforms for Upwork freelance management and LinkedIn professional networking. Both use the same AppleScript + JavaScript injection pattern as the existing Instagram, TikTok, and Twitter automations.

---

## Platform Summary

| Platform | Package | Port | Key Capabilities |
|----------|---------|------|------------------|
| **Upwork** | `packages/upwork-automation/` | 3104 | Job search, extraction, scoring, proposals, messaging |
| **LinkedIn** | `packages/linkedin-automation/` | 3105 | Profile extraction, connections, DMs, people search, lead scoring |

---

## Upwork Automation (Port 3104)

### Start Server
```bash
npx tsx packages/upwork-automation/src/api/server.ts
```

### API Endpoints

#### Status & Navigation
```bash
GET  /health                           # Server health
GET  /api/upwork/status                # Login status, rate limits
POST /api/upwork/navigate/find-work    # Go to Find Work
POST /api/upwork/navigate/my-jobs      # Go to My Jobs
POST /api/upwork/navigate/job          # {url} — Go to specific job
POST /api/upwork/navigate/messages     # Go to Messages
```

#### Job Discovery
```bash
# Search jobs with filters
POST /api/upwork/jobs/search
  Body: { keywords: ["TypeScript", "automation"], jobType: "both", 
          experienceLevel: "expert", postedWithin: "7d", sortBy: "newest" }

# Extract full job details
GET  /api/upwork/jobs/:id

# Score a job against your preferences
POST /api/upwork/jobs/score
  Body: { job: {...}, preferredSkills: ["TypeScript", "Node.js"], minBudget: 500 }

# Save a job
POST /api/upwork/jobs/:id/save
```

#### Applications
```bash
GET  /api/upwork/applications          # List all applications
```

#### Messages
```bash
GET  /api/upwork/conversations         # List message threads
GET  /api/upwork/messages              # Read messages in current thread
GET  /api/upwork/messages/unread       # Unread count
POST /api/upwork/messages/open         # {clientName} — Open a conversation
POST /api/upwork/messages/send         # {text} — Send message in current thread
```

#### AI Proposals (requires OPENAI_API_KEY)
```bash
POST /api/upwork/proposals/generate
  Body: { job: {...}, highlightSkills: ["TypeScript"], customInstructions: "..." }
  Returns: { coverLetter, suggestedQuestions, confidence }
```

### Job Scoring System

Jobs are scored 0-100 across 5 factors:
- **Budget Match** (0-25) — Does budget meet your minimum?
- **Skill Match** (0-30) — How many skills overlap with your preferred list?
- **Client Quality** (0-20) — Payment verified, review score, hire rate
- **Competition** (0-15) — Fewer proposals = higher score
- **Freshness** (0-10) — Just posted = highest

Recommendations: `apply` (70+), `maybe` (45-69), `skip` (<45)

---

## LinkedIn Automation (Port 3105)

### Start Server
```bash
npx tsx packages/linkedin-automation/src/api/server.ts
```

### ⚠️ Safety First
LinkedIn aggressively detects automation. This module uses:
- **Conservative rate limits** (20 connections/day, 50 messages/day)
- **Active hours only** (8am-6pm by default)
- **Human-like delays** (2-5s random between actions)
- **Session-based auth** (uses your logged-in Safari session)

### API Endpoints

#### Status & Navigation
```bash
GET  /health                              # Server health + active hours check
GET  /api/linkedin/status                 # Login status, counters
POST /api/linkedin/navigate/network       # Go to My Network
POST /api/linkedin/navigate/messaging     # Go to Messaging
POST /api/linkedin/navigate/profile       # {profileUrl} — Go to profile
```

#### Profile Extraction
```bash
# Extract full profile data
GET  /api/linkedin/profile/:username
  Returns: { name, headline, location, about, currentPosition, connectionDegree,
             mutualConnections, isOpenToWork, isHiring, skills }

# Score a lead
POST /api/linkedin/profile/score
  Body: { profile: {...}, targetTitles: ["CTO"], targetCompanies: ["..."] }
  Returns: { totalScore, factors, recommendation, reason }
```

#### Connection Management
```bash
# Check connection status
GET  /api/linkedin/connections/status?profileUrl=...

# Send connection request (with optional note, max 300 chars)
POST /api/linkedin/connections/request
  Body: { profileUrl: "...", note: "Hi, loved your talk on..." }

# List pending requests
GET  /api/linkedin/connections/pending?type=received
GET  /api/linkedin/connections/pending?type=sent

# Accept a request
POST /api/linkedin/connections/accept
  Body: { profileUrl: "..." }
```

#### People Search
```bash
POST /api/linkedin/search/people
  Body: { keywords: ["startup", "founder"], title: "CEO", location: "San Francisco" }
  Returns: { results: [{ name, profileUrl, headline, location, connectionDegree }] }
```

#### Messaging
```bash
GET  /api/linkedin/conversations          # List conversations
GET  /api/linkedin/messages               # Read current thread
GET  /api/linkedin/messages/unread        # Unread count
POST /api/linkedin/messages/open          # {participantName} — Open conversation
POST /api/linkedin/messages/send          # {text} — Send in current thread
POST /api/linkedin/messages/send-to       # {profileUrl, text} — Send to profile (new convo)
```

#### AI Message Generation (requires OPENAI_API_KEY)
```bash
POST /api/linkedin/ai/generate-message
  Body: { profile: {...}, purpose: "connection_note", tone: "professional", context: "..." }
  Returns: { text, confidence, aiGenerated }
```

### Lead Scoring System

Profiles scored 0-100 across 5 factors:
- **Title Match** (0-30) — Does their title match target roles?
- **Company Match** (0-20) — Are they at a target company?
- **Location Match** (0-15) — Are they in target geography?
- **Connection Proximity** (0-20) — 1st > 2nd > 3rd degree
- **Activity Level** (0-15) — Open to work, hiring, detailed profile

Recommendations: `high_priority` (70+), `medium` (50-69), `low` (30-49), `skip` (<30)

### Rate Limits

```
Connections: 20/day, 80/week
Messages: 10/hour, 50/day
Profile views: 30/hour
Searches: 15/hour
Active hours: 8am-6pm (configurable)
Min delay: 30s between actions
```

Override via:
```bash
PUT /api/linkedin/rate-limits
  Body: { connectionRequestsPerDay: 15, activeHoursStart: 9 }
```

---

## Package Structure

```
packages/upwork-automation/
├── src/
│   ├── automation/
│   │   ├── safari-driver.ts        # AppleScript + JS injection
│   │   ├── job-operations.ts       # Job search, extract, score
│   │   ├── message-operations.ts   # Conversations, send/read
│   │   ├── types.ts                # All interfaces + selectors
│   │   └── index.ts
│   ├── api/
│   │   └── server.ts              # Express REST API (port 3104)
│   └── index.ts
├── package.json
└── tsconfig.json

packages/linkedin-automation/
├── src/
│   ├── automation/
│   │   ├── safari-driver.ts        # AppleScript + JS injection (extra delays)
│   │   ├── connection-operations.ts # Profile extraction, connections, search, scoring
│   │   ├── dm-operations.ts        # Conversations, messaging
│   │   ├── types.ts                # All interfaces + selectors
│   │   └── index.ts
│   ├── api/
│   │   └── server.ts              # Express REST API (port 3105)
│   └── index.ts
├── package.json
└── tsconfig.json
```

---

## All Safari Automation Platform Ports

| Port | Platform | Package |
|------|----------|---------|
| 3003 | Twitter/X | `packages/twitter-dm/` |
| 3010 | Task Scheduler | `packages/scheduler/` |
| 3100 | Instagram | `packages/instagram-dm/` |
| 3102 | TikTok | `packages/tiktok-dm/` |
| 3104 | **Upwork** | `packages/upwork-automation/` |
| 3105 | **LinkedIn** | `packages/linkedin-automation/` |
| 5555 | MediaPoster Backend | External |

---

## Prerequisites

1. **Safari logged into Upwork** — navigate to upwork.com, log in
2. **Safari logged into LinkedIn** — navigate to linkedin.com, log in
3. **Node.js** — for running the API servers
4. **OPENAI_API_KEY** (optional) — for AI proposal/message generation

---

## Quick Start

```bash
# Start Upwork API
npx tsx packages/upwork-automation/src/api/server.ts

# Start LinkedIn API
npx tsx packages/linkedin-automation/src/api/server.ts

# Test Upwork status
curl http://localhost:3104/api/upwork/status

# Test LinkedIn status
curl http://localhost:3105/api/linkedin/status

# Search Upwork jobs
curl -X POST http://localhost:3104/api/upwork/jobs/search \
  -H "Content-Type: application/json" \
  -d '{"keywords": ["TypeScript", "Node.js"], "postedWithin": "3d"}'

# Extract LinkedIn profile
curl http://localhost:3105/api/linkedin/profile/isaiahdupree

# Send LinkedIn connection request
curl -X POST http://localhost:3105/api/linkedin/connections/request \
  -H "Content-Type: application/json" \
  -d '{"profileUrl": "https://www.linkedin.com/in/someone/", "note": "Great meeting you!"}'
```
