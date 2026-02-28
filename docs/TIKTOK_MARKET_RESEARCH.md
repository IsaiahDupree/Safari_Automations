# TikTok Market Research — Complete Guide

> **Script**: `scripts/tiktok-research-exercise.ts`  
> **Services used**: TikTok Comments (port 3006), Market Research (port 3106)  
> **Last verified**: Feb 28, 2026

---

## Table of Contents

1. [Overview](#overview)
2. [Quick Start](#quick-start)
3. [Full Pipeline Architecture](#full-pipeline-architecture)
4. [Phase 0 — Service & Login Check](#phase-0--service--login-check)
5. [Phase 1 — Keyword Search & URL Extraction](#phase-1--keyword-search--url-extraction)
6. [Phase 2 — Per-Video Deep Dive](#phase-2--per-video-deep-dive)
7. [Phase 3 — Final Report](#phase-3--final-report)
8. [API Endpoints Added](#api-endpoints-added)
9. [DOM Selectors Reference](#dom-selectors-reference)
10. [Configuration & CLI Flags](#configuration--cli-flags)
11. [Files Modified](#files-modified)
12. [Root Cause: TikTokResearcher Escaping Bug](#root-cause-tiktokresearcher-escaping-bug)
13. [Troubleshooting](#troubleshooting)
14. [Sample Output](#sample-output)
15. [Extension Ideas](#extension-ideas)

---

## Overview

This exercise demonstrates an end-to-end TikTok market research workflow:

```
Keyword → TikTok Search → Post URLs → Navigate Each Post → Engagement Metrics + Comments
```

It answers:
- **Who** are the top-performing creators for a niche?
- **What** content gets the most engagement (likes, comments, shares)?
- **How** is the audience responding (actual comment text)?
- **Which** posts should you model or comment on?

The pipeline runs entirely through Safari automation — no TikTok API credentials required.

---

## Quick Start

```bash
# Ensure services are running
PORT=3006 npx tsx packages/tiktok-comments/src/api/server.ts &
PORT=3106 npx tsx packages/market-research/src/api/server.ts &

# Run research
npx tsx scripts/tiktok-research-exercise.ts "solopreneur"
npx tsx scripts/tiktok-research-exercise.ts "AI tools" --max 3
npx tsx scripts/tiktok-research-exercise.ts "fitness" --max 5 --comments 15
npx tsx scripts/tiktok-research-exercise.ts "content creator" --no-comments
npx tsx scripts/tiktok-research-exercise.ts "dropshipping" --max 6 --wait 9000
```

---

## Full Pipeline Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  tiktok-research-exercise.ts                                │
│                                                             │
│  Phase 0  ──  Health check + TikTok login status           │
│     ↓                                                       │
│  Phase 1  ──  POST /api/tiktok/search-cards (port 3006)    │
│               Navigate Safari → tiktok.com/search/video    │
│               Extract video cards from search results       │
│               Returns: URL, author, description, views      │
│     ↓                                                       │
│  Phase 2  ──  For each video URL (port 3006):              │
│               POST /api/tiktok/navigate  → open video page  │
│               GET  /api/tiktok/video-metrics → engagement   │
│               GET  /api/tiktok/comments  → comment text     │
│     ↓                                                       │
│  Phase 3  ──  Ranked report + top creators summary         │
└─────────────────────────────────────────────────────────────┘
```

### Service Responsibilities

| Service | Port | Role in Pipeline |
|---------|------|-----------------|
| TikTok Comments | 3006 | **Primary driver** — search, navigate, metrics, comments |
| Market Research | 3106 | Health check only in current script (search-cards bypasses it) |

> **Why not use the Market Research server for search?**  
> `TikTokResearcher.extractVisibleVideos()` in the market research server has a double-quote escaping bug — see [Root Cause](#root-cause-tiktokresearcher-escaping-bug). The new `search-cards` endpoint on port 3006 uses the working `TikTokDriver.executeJS()` instead.

---

## Phase 0 — Service & Login Check

```typescript
GET  http://localhost:3106/health   → { status: 'ok' }
GET  http://localhost:3006/health   → { status: 'ok' }
GET  http://localhost:3006/api/tiktok/status
```

**Status response shape:**
```json
{
  "isOnTikTok": true,
  "isLoggedIn": true,
  "currentUrl": "https://www.tiktok.com/...",
  "commentsThisHour": 0,
  "commentsToday": 0
}
```

Login is detected by presence of `[data-e2e="upload-icon"]` or `a[href*="/upload"]`. If not logged in, the pipeline warns but continues — search cards still load for most queries.

---

## Phase 1 — Keyword Search & URL Extraction

**Endpoint:** `POST http://localhost:3006/api/tiktok/search-cards`

```json
{
  "query": "solopreneur",
  "maxCards": 5,
  "waitMs": 6000
}
```

**What it does:**
1. Calls `TikTokDriver.navigateToPost(searchUrl)` where `searchUrl = https://www.tiktok.com/search/video?q={query}`
2. Waits `waitMs` milliseconds for search result cards to render
3. Runs JS extraction using `[data-e2e='search_video-item']` (single-quoted — avoids the escaping bug)
4. Returns all video cards up to `maxCards`

**Response shape:**
```json
{
  "success": true,
  "query": "solopreneur",
  "count": 5,
  "videos": [
    {
      "id": "7323680986997345578",
      "url": "https://www.tiktok.com/@starterstory/video/7323680986997345578",
      "author": "starterstory",
      "description": "I interviewed 1000+ soloprenuers...",
      "viewsRaw": "13.9K"
    }
  ]
}
```

**Data available from search cards:**
- ✅ Video URL + ID
- ✅ Author handle
- ✅ Caption / description
- ✅ View count (abbreviated string like "13.9K")
- ❌ Likes, shares, comments — **not shown on search cards** (requires video page)

**View count parsing:**  
`viewsRaw` is parsed from abbreviated notation: `13.9K → 13900`, `2.1M → 2100000`, `1.2B → 1200000000`

---

## Phase 2 — Per-Video Deep Dive

For each URL collected in Phase 1, the script:

### Step A: Navigate

```
POST http://localhost:3006/api/tiktok/navigate
{ "url": "https://www.tiktok.com/@starterstory/video/7323680986997345578" }
```

Uses `TikTokDriver.navigateToPost()` which sets Safari's URL and waits 3s. After the API call returns, the script waits an additional `navWaitMs` (default 5000ms, configurable via `--wait`) for TikTok's virtual DOM to fully render.

### Step B: Engagement Metrics

```
GET http://localhost:3006/api/tiktok/video-metrics
```

Runs JS on the current Safari tab. Uses `TikTokDriver.getVideoMetrics()`:

```javascript
// Selectors (verified Feb 2026 on video feed pages)
var lk = document.querySelector('[data-e2e="like-count"]');
var cm = document.querySelector('[data-e2e="comment-count"]');
var sh = document.querySelector('[data-e2e="share-count"]');
var vw = document.querySelector('[data-e2e="video-views"]')
      || document.querySelector('[data-e2e="play-count"]');
```

**Response shape:**
```json
{
  "success": true,
  "views": 0,
  "likes": 13900,
  "comments": 101,
  "shares": 1100,
  "currentUrl": "https://www.tiktok.com/@starterstory/video/..."
}
```

> **Note on Views:** `[data-e2e="video-views"]` is only present on TikTok **search result cards**, not on individual video pages. When navigating directly to `/@user/video/ID`, views reports 0 from the video page. The `searchViews` field in the report uses the search card value instead.

**Engagement Score formula** (same as `TikTokResearcher`):
```
engagementScore = likes + (comments × 2) + (shares × 3)
```
Comments weighted ×2, shares ×3 because they represent stronger intent signals.

### Step C: Comments

```
GET http://localhost:3006/api/tiktok/comments?limit=10
```

Uses updated `TikTokDriver.getComments()` with a two-tier strategy:

**Tier 1 — data-e2e selector** (works on browse/for-you pages):
```javascript
document.querySelectorAll('[data-e2e="comment-item"]')
```

**Tier 2 — class-based fallback** (used on direct video pages, Feb 2026):
```javascript
document.querySelectorAll('[class*="DivCommentObjectWrapper"], [class*="DivCommentItemWrapper"]')
```
Extracts username from `[class*="DivCommentHeaderWrapper"]` and text from `[class*="DivCommentContentWrapper"]`.

**Comment icon auto-click:** If neither selector finds items, the driver clicks `[data-e2e="comment-icon"]` to open the comments panel, waits 3s, then retries extraction.

**Response shape:**
```json
{
  "comments": [
    { "username": "suzchadwick", "text": "I discovered him through a podcast interview..." },
    { "username": "mrrich_ards",  "text": "Bro next time, just keep the information all in one video..." }
  ],
  "count": 10
}
```

---

## Phase 3 — Final Report

After all videos are processed, the script prints:

### Per-Post Summary
```
[1] @starterstory
    URL     : https://www.tiktok.com/@starterstory/video/7323680986997345578
    Caption : I interviewed 1000+ soloprenuers and here's what I found...
    Views   : 0 (search card: 13.9K)
    Likes   : 13.9K
    Comments: 101
    Shares  : 1.1K
    Score   :   17.4K   ████████████████████
    Top comments:
      @suzchadwick      "I discovered him through a podcast interview..."
      @mrrich_ards      "Bro next time, just keep the information all in one video..."
```

### Top Creators Table
Creators ranked by **total engagement score** across all posts collected. Includes average score per post and a bar chart.

```
@starterstory    17.4K pts  avg  17.4K  █████████████████
@brettfully      16.0K pts  avg   8.0K  █████████░░░░░░░░
@aistartupfren     180 pts  avg    180  ░░░░░░░░░░░░░░░░░
```

---

## API Endpoints Added

All endpoints are on the **TikTok Comments server (port 3006)**.

### `POST /api/tiktok/search-cards`

Navigate to TikTok search and extract video cards from search results.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `query` | string | required | Search keyword |
| `maxCards` | number | 20 | Max cards to extract |
| `waitMs` | number | 4000 | Ms to wait after navigation for cards to render |

**Response:**
```json
{
  "success": true,
  "query": "...",
  "count": 5,
  "videos": [{ "id", "url", "author", "description", "viewsRaw" }]
}
```

---

### `GET /api/tiktok/video-metrics`

Extract engagement data from the currently loaded TikTok video page.

No parameters. Reads Safari's current tab.

**Response:**
```json
{
  "success": true,
  "views": 0,
  "likes": 13900,
  "comments": 101,
  "shares": 1100,
  "currentUrl": "https://www.tiktok.com/@..."
}
```

---

### `GET /api/tiktok/comments?limit=N` *(updated)*

Now includes two-tier extraction (data-e2e + class-based fallback) and auto-opens comment panel if needed.

| Query param | Type | Default | Description |
|-------------|------|---------|-------------|
| `limit` | number | 50 | Max comments to return |

**Response:**
```json
{
  "comments": [{ "username": "...", "text": "..." }],
  "count": 10
}
```

---

## DOM Selectors Reference

### TikTok Search Page (`/search/video?q=...`)

| Selector | Data |
|----------|------|
| `[data-e2e="search_video-item"]` | Video card container (24 per page typical) |
| `a[href*="/video/"]` inside card | Video link + URL |
| `[data-e2e="search-card-video-caption"]` | Caption text |
| `[data-e2e="search-card-desc"]` | Alternative caption selector |
| `[data-e2e="video-views"]` | View count string (e.g. "13.9K") |

### TikTok Video Page (`/@user/video/ID`)

| Selector | Data |
|----------|------|
| `[data-e2e="like-count"]` | Like count |
| `[data-e2e="comment-count"]` | Comment count |
| `[data-e2e="share-count"]` | Share count |
| `[data-e2e="comment-icon"]` | Button to open comments panel |
| `[data-e2e="comment-item"]` | Comment items (browse/FYP layout) |
| `[class*="DivCommentObjectWrapper"]` | Comment items (direct video page layout) |
| `[class*="DivCommentContentWrapper"]` | Comment text content |
| `[class*="DivCommentHeaderWrapper"]` | Comment author name |
| `[class*="DivCommentListContainer"]` | Comment list container |

> **Layout note:** When navigating to `/@user/video/ID` directly, TikTok renders in a feed-style layout (scrollable, `recommend-list-item-container`). This uses class-based selectors. When browsing via the For You Page, TikTok uses `data-e2e` attribute selectors.

---

## Configuration & CLI Flags

```bash
npx tsx scripts/tiktok-research-exercise.ts [keyword] [flags]
```

| Flag | Default | Description |
|------|---------|-------------|
| `keyword` (positional) | `"solopreneur"` | Search query |
| `--max N` or `--max=N` | `5` | Max videos to research |
| `--wait=MS` | `5000` | Ms to wait after each video navigation (increase for slow connections) |
| `--comments=N` | `10` | Max comments per video |
| `--no-comments` | off | Skip comment extraction (faster) |

**Examples:**
```bash
# Minimal (just metrics, no comments)
npx tsx scripts/tiktok-research-exercise.ts "drop shipping" --no-comments

# Deep research, more comments
npx tsx scripts/tiktok-research-exercise.ts "side hustle" --max 8 --comments 20

# Slow connection / TikTok taking long to render
npx tsx scripts/tiktok-research-exercise.ts "crypto" --max 4 --wait 10000

# Quick test
npx tsx scripts/tiktok-research-exercise.ts "fitness" --max 2 --no-comments
```

---

## Files Modified

### `packages/tiktok-comments/src/automation/tiktok-driver.ts`

**Added:** `getVideoMetrics()` method
- Extracts likes, comments, shares, views from current video page
- Returns `{ views, likes, comments, shares, currentUrl }`

**Updated:** `getComments(limit)` method
- **New**: Auto-clicks `[data-e2e="comment-icon"]` if comment panel not open
- **New**: Falls back to `[class*="DivCommentObjectWrapper"]` class selectors when `[data-e2e="comment-item"]` returns 0 results
- **New**: Deduplication via `seen` map

---

### `packages/tiktok-comments/src/api/server.ts`

**Added:** `POST /api/tiktok/search-cards`
- Navigates to TikTok search URL and extracts video cards
- Uses single-quoted CSS attribute selectors to avoid AppleScript escaping bug

**Added:** `GET /api/tiktok/video-metrics`
- Calls `driver.getVideoMetrics()` on current Safari tab

---

### `scripts/tiktok-research-exercise.ts`

New script — full three-phase market research pipeline. See [Quick Start](#quick-start) for usage.

---

## Root Cause & Fix: TikTokResearcher Escaping Bug

### The Bug

`TikTokResearcher.executeJS()` originally embedded JS code directly into an AppleScript string:
```typescript
const jsCode = script.replace(/"/g, '\\"');
const appleScript = `tell application "Safari" to do JavaScript "${jsCode}" in ...`;
fs.writeFileSync(tmpFile, appleScript);
```

Any JS containing `"` (e.g. `querySelectorAll('[data-e2e="search_video-item"]')`) would break the AppleScript string. AppleScript files do **not** support `\"` as an escape — the `"` terminates the string, causing silent failure with 0 results.

A second issue compounded this: Node's `child_process` corrupts the AppleScript `«class utf8»` guillemet characters when passed via `-e` flags or inline strings.

### The Permanent Fix (Feb 2026)

`executeJS()` now uses a **two-file strategy** — JS and AppleScript are written as separate temp files, so JS double quotes never appear inside an AppleScript string:

```typescript
// 1. Write JS to temp file (any content, any quotes — doesn't matter)
fs.writeFileSync(jsFile, script);

// 2. Write .applescript that reads the JS file at runtime
const laquo = String.fromCharCode(0xAB); // «
const raquo = String.fromCharCode(0xBB); // »
fs.writeFileSync(asFile,
  `set jsCode to read POSIX file "${jsFile}" as ${laquo}class utf8${raquo}\n` +
  `tell application "Safari" to do JavaScript jsCode in front document\n`
);

// 3. Execute the .applescript file
await execAsync(`osascript "${asFile}"`);
```

**Why this works:**
- JS is loaded via `read POSIX file` — never embedded in an AppleScript string literal
- `String.fromCharCode(0xAB/0xBB)` produces proper `«»` when Node writes to disk (avoids UTF-8 double-encoding from `\xC2\xAB`)
- Both temp files are cleaned up in a `finally` block

---

## Troubleshooting

### "0 videos found" in Phase 1

| Cause | Fix |
|-------|-----|
| TikTok search cards haven't rendered | Increase `--wait`: `--wait=10000` |
| Safari not open / on wrong page | Make sure Safari is running and TikTok tab is front window |
| TikTok login wall | Log in to TikTok in Safari, rerun |
| Stale search page from previous run | Run again — Phase 1 always re-navigates |

### Views = 0

Expected. TikTok video pages (`/@user/video/ID`) don't expose a view counter in the DOM. The `searchViews` column shows the value from the search card. This is a TikTok DOM limitation, not a script bug.

### "0 comments loaded"

| Cause | Fix |
|-------|-----|
| Comments panel not open | Driver now auto-clicks comment icon. If this fails, increase `--wait` |
| TikTok slow to load comments | Add `await wait(5000)` before comment fetch in the script |
| Comment selector changed | Probe DOM: run `mcp1_applescript_execute` to check `[class*="DivComment"]` |

### Services not responding

```bash
# Check what's running
lsof -i :3006
lsof -i :3106

# Restart tiktok-comments
lsof -ti :3006 | xargs kill -9
PORT=3006 npx tsx packages/tiktok-comments/src/api/server.ts &

# Restart market-research
lsof -ti :3106 | xargs kill -9
PORT=3106 npx tsx packages/market-research/src/api/server.ts &
```

### TikTok rate limiting / CAPTCHA

TikTok may show a CAPTCHA or slow down after many navigations in quick succession. Increase `--wait` and reduce `--max`. Wait a few minutes between runs.

---

## Sample Output

```
════════════════════════════════════════════════════════════════
  TikTok Market Research Exercise
  Keyword : "solopreneur"   Max videos: 3
  Comments: top 10   Nav wait: 6000ms
════════════════════════════════════════════════════════════════

[0] Checking services...
  ✓  market-research:3106   ✓  tiktok-comments:3006
  TikTok: ✓ logged in   ✓ on TikTok   https://www.tiktok.com

[1] Shallow search for "solopreneur"...
  ⏳  Navigating Safari to tiktok.com/search/video — ~10s

  ✓  3 video URLs collected from search page

  [1] @starterstory
       https://www.tiktok.com/@starterstory/video/7323680986997345578
       Views: 13.9K   "I interviewed 1000+ soloprenuers..."
  [2] @brettfully
       https://www.tiktok.com/@brettfully/video/7268052541479423278
       Views: 6.6K   "The highest paid solopreneur on the internet..."
  [3] @experience.aspire
       https://www.tiktok.com/@experience.aspire/video/7390508749389139232
       Views: 684   "I quit my 6-figure corporate job..."

[2] Deep-diving 3 videos (navigate → metrics → comments)...
  ⏳  ~14s per video

  ─── Video 1/3: @starterstory ───
  Navigate... ✓  Waiting for page to load...
  Metrics...  ✓  views=0 likes=13.9K comments=101 shares=1.1K
  Comments (top 10)... ✓  10 loaded

  ─── Video 2/3: @brettfully ───
  Navigate... ✓  Waiting for page to load...
  Metrics...  ✓  views=0 likes=6.6K comments=62 shares=1.2K
  Comments (top 10)... ✓  5 loaded

  ─── Video 3/3: @experience.aspire ───
  Navigate... ✓  Waiting for page to load...
  Metrics...  ✓  views=0 likes=684 comments=15 shares=42
  Comments (top 10)... ✓  5 loaded

════════════════════════════════════════════════════════════════
  RESULTS — POST LINKS + ENGAGEMENT METRICS
════════════════════════════════════════════════════════════════

  [1] @starterstory
      URL     : https://www.tiktok.com/@starterstory/video/7323680986997345578
      Caption : I interviewed 1000+ soloprenuers and here's what I found...
      Views   : 0 (search card: 13.9K)
      Likes   : 13.9K
      Comments: 101
      Shares  : 1.1K
      Score   :   17.4K   ████████████████████
      Top comments:
        @suzchadwick      "I discovered him through a podcast interview..."
        @mrrich_ards      "Bro next time, just keep the information all in one video..."
        @maxwell_maher    "Definitely not the highest paid solopreneur given the..."

  [2] @brettfully
      URL     : https://www.tiktok.com/@brettfully/video/7268052541479423278
      Caption : The highest paid solopreneur on the internet...
      Views   : 0 (search card: 6.6K)
      Likes   : 6.6K
      Comments: 62
      Shares  : 1.2K
      Score   :   10.3K   ████████████░░░░░░░░
      Top comments:
        @thesalesdocrx    "A course for how to grow on TikTok?..."
        @suzchadwick      "I discovered him through a podcast interview..."

  [3] @experience.aspire
      URL     : https://www.tiktok.com/@experience.aspire/video/7390508749389139232
      Caption : I quit my 6-figure corporate job...
      Views   : 0 (search card: 684)
      Likes   : 684
      Comments: 15
      Shares  : 42
      Score   :     840   █░░░░░░░░░░░░░░░░░░░
      Top comments:
        @patty_gonz       "If this isn't a sign, idk what is..."
        @victorianstage   "What was your corporate job?..."

────────────────────────────────────────────────────────────────
  TOP CREATORS (ranked by total engagement score)
────────────────────────────────────────────────────────────────
  @starterstory              17.4K pts  avg  17.4K  █████████████████
  @brettfully                10.3K pts  avg  10.3K  █████████░░░░░░░░
  @experience.aspire           840 pts  avg    840  █░░░░░░░░░░░░░░░░

════════════════════════════════════════════════════════════════
  Done. 3 videos analysed for "solopreneur"
════════════════════════════════════════════════════════════════
```

---

## Extension Ideas

### Save Results to JSON
```typescript
import { writeFileSync } from 'fs';
writeFileSync(`research-${keyword}-${Date.now()}.json`, JSON.stringify(results, null, 2));
```

### Pipe into Creative Radar
Results can feed directly into `scripts/creative-radar-experiment.ts` — use top post captions as brief inputs for Sora video prompts.

### Scroll for More Cards
Phase 1 only collects the initial viewport of search cards. To get more:
1. Add an AppleScript scroll after navigation in `search-cards`
2. Re-run extraction to collect newly rendered cards
3. Repeat until `maxCards` met

### Auto-Comment on Top Posts
After identifying high-engagement posts, chain directly into commenting:
```bash
# From within the exercise script after Phase 2:
POST /api/tiktok/comments/post { useAI: true, postContent: r.description }
```

### Cross-Platform Comparison
Run the same keyword across platforms:
```bash
npx tsx scripts/tiktok-research-exercise.ts "solopreneur" --max 5
# Then compare against:
POST http://localhost:3106/api/research/twitter/search  { query: "solopreneur" }
POST http://localhost:3106/api/research/instagram/search { query: "solopreneur" }
```

---

## Curl Commands — TikTok Comments Server (port 3006)

> **Start server:** `PORT=3006 npx tsx packages/tiktok-comments/src/api/server.ts &`  
> **Base URL:** `http://localhost:3006`

---

### Server & Status

```bash
# Health check
curl http://localhost:3006/health

# TikTok login + rate limit status
curl http://localhost:3006/api/tiktok/status

# Get current config (rate limits, etc.)
curl http://localhost:3006/api/tiktok/config

# Get rate limits only
curl http://localhost:3006/api/tiktok/rate-limits
```

---

### Navigation

```bash
# Navigate Safari to any TikTok URL
curl -X POST http://localhost:3006/api/tiktok/navigate \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.tiktok.com/@starterstory/video/7323680986997345578"}'

# Navigate to a user profile
curl -X POST http://localhost:3006/api/tiktok/navigate \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.tiktok.com/@brettfully"}'

# Navigate to For You feed
curl -X POST http://localhost:3006/api/tiktok/navigate \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.tiktok.com/foryou"}'

# Navigate to search
curl -X POST http://localhost:3006/api/tiktok/navigate \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.tiktok.com/search/video?q=solopreneur"}'
```

---

### Market Research

```bash
# Search keyword → collect video URLs + view counts from search cards
curl -X POST http://localhost:3006/api/tiktok/search-cards \
  -H "Content-Type: application/json" \
  -d '{"query": "solopreneur", "maxCards": 10, "waitMs": 6000}'

# With defaults (maxCards=20, waitMs=4000)
curl -X POST http://localhost:3006/api/tiktok/search-cards \
  -H "Content-Type: application/json" \
  -d '{"query": "AI tools"}'

# Get engagement metrics from currently open video page
curl http://localhost:3006/api/tiktok/video-metrics
```

**search-cards response:**
```json
{
  "success": true, "query": "solopreneur", "count": 5,
  "videos": [
    { "id": "7323...", "url": "https://www.tiktok.com/@starterstory/video/7323...",
      "author": "starterstory", "description": "I interviewed 1000+...", "viewsRaw": "13.9K" }
  ]
}
```

**video-metrics response:**
```json
{ "success": true, "views": 0, "likes": 13900, "comments": 101, "shares": 1100,
  "currentUrl": "https://www.tiktok.com/@starterstory/video/..." }
```

---

### Comments — Read

```bash
# Get top 50 comments from currently open video page
curl http://localhost:3006/api/tiktok/comments

# Limit to N comments
curl "http://localhost:3006/api/tiktok/comments?limit=10"
curl "http://localhost:3006/api/tiktok/comments?limit=25"
```

**Response:**
```json
{
  "comments": [
    { "username": "suzchadwick", "text": "I discovered him through a podcast..." },
    { "username": "mrrich_ards",  "text": "Bro next time, just keep the info..." }
  ],
  "count": 10
}
```

---

### Comments — Post

```bash
# Post a specific comment on the current page
curl -X POST http://localhost:3006/api/tiktok/comments/post \
  -H "Content-Type: application/json" \
  -d '{"text": "This is so helpful! 🔥"}'

# Navigate to a post URL then comment (one call)
curl -X POST http://localhost:3006/api/tiktok/comments/post \
  -H "Content-Type: application/json" \
  -d '{
    "postUrl": "https://www.tiktok.com/@starterstory/video/7323680986997345578",
    "text": "Great content! 💯"
  }'

# AI-generated comment (requires OPENAI_API_KEY env var)
curl -X POST http://localhost:3006/api/tiktok/comments/post \
  -H "Content-Type: application/json" \
  -d '{
    "postUrl": "https://www.tiktok.com/@brettfully/video/7268052541479423278",
    "useAI": true,
    "postContent": "The highest paid solopreneur on the internet",
    "username": "brettfully"
  }'

# Generate an AI comment WITHOUT posting it
curl -X POST http://localhost:3006/api/tiktok/comments/generate \
  -H "Content-Type: application/json" \
  -d '{"postContent": "How I made $10k as a solopreneur", "username": "brettfully"}'
```

**Post comment response:**
```json
{
  "success": true,
  "generatedComment": "This is fire! 🔥",
  "usedAI": true
}
```

**Generate comment response:**
```json
{ "success": true, "comment": "Honestly needed this 🙌", "usedAI": true }
```

---

### Config & Rate Limits

```bash
# View full config
curl http://localhost:3006/api/tiktok/config

# Update rate limits (commentsPerHour, commentsPerDay, etc.)
curl -X PUT http://localhost:3006/api/tiktok/rate-limits \
  -H "Content-Type: application/json" \
  -d '{"commentsPerHour": 20, "commentsPerDay": 100}'

# Update full config
curl -X PUT http://localhost:3006/api/tiktok/config \
  -H "Content-Type: application/json" \
  -d '{"commentsPerHour": 15, "minDelayBetweenComments": 30}'
```

---

### Full Research Workflow (chained)

```bash
# 1. Check server is up
curl http://localhost:3006/health

# 2. Check TikTok login
curl http://localhost:3006/api/tiktok/status

# 3. Search for videos by keyword
curl -X POST http://localhost:3006/api/tiktok/search-cards \
  -H "Content-Type: application/json" \
  -d '{"query": "solopreneur", "maxCards": 5, "waitMs": 6000}'

# 4. Navigate to a specific video
curl -X POST http://localhost:3006/api/tiktok/navigate \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.tiktok.com/@starterstory/video/7323680986997345578"}'

# 5. Get engagement metrics (after ~5s page load)
sleep 5 && curl http://localhost:3006/api/tiktok/video-metrics

# 6. Get top comments
curl "http://localhost:3006/api/tiktok/comments?limit=10"

# 7. Post an AI comment
curl -X POST http://localhost:3006/api/tiktok/comments/post \
  -H "Content-Type: application/json" \
  -d '{"useAI": true, "postContent": "solopreneur income breakdown", "username": "starterstory"}'
```

---

### Run the Full Research Script

```bash
# Basic run
npx tsx scripts/tiktok-research-exercise.ts "solopreneur"

# With options
npx tsx scripts/tiktok-research-exercise.ts "AI tools" --max 5 --comments 15 --wait 7000

# Skip comments (faster, metrics only)
npx tsx scripts/tiktok-research-exercise.ts "dropshipping" --max 8 --no-comments
```

---

## Curl Commands — Market Research Server (port 3106)

> **Start server:** `PORT=3106 npx tsx packages/market-research/src/api/server.ts &`  
> **Base URL:** `http://localhost:3106`

```bash
# Health check
curl http://localhost:3106/health

# TikTok search (deep scrape — navigates into each video, extracts metrics)
curl -X POST http://localhost:3106/api/research/tiktok/search \
  -H "Content-Type: application/json" \
  -d '{
    "query": "solopreneur",
    "config": { "postsPerQuery": 5, "maxPosts": 5, "deepScrape": true }
  }'

# Instagram hashtag search
curl -X POST http://localhost:3106/api/research/instagram/search \
  -H "Content-Type: application/json" \
  -d '{"query": "solopreneur", "config": {"maxPosts": 10}}'

# Twitter search
curl -X POST http://localhost:3106/api/research/twitter/search \
  -H "Content-Type: application/json" \
  -d '{"query": "solopreneur", "config": {"maxPosts": 10}}'
```

---

*See also:*
- `docs/TIKTOK_AUTOMATION_COMPLETE.md` — full TikTok service reference
- `docs/TIKTOK_COMMANDS_REFERENCE.md` — DM server (port 3102) curl commands
- `docs/DOCS_INDEX.md` — master index of all documentation
- `packages/tiktok-comments/src/automation/tiktok-driver.ts` — TikTokDriver class
- `packages/tiktok-comments/src/automation/tiktok-researcher.ts` — TikTokResearcher class
- `packages/market-research/src/api/server.ts` — Market Research API server
