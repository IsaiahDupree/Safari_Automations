# TikTok Automation — Complete Reference

**Last updated:** 2026-02-27 · **Status:** ✅ Production-verified

---

## Table of Contents

1. [Services Overview](#1-services-overview)
2. [Architecture — How It Works](#2-architecture--how-it-works)
3. [TikTok DOM Quirks (Critical)](#3-tiktok-dom-quirks-critical)
4. [SafariDriver — Low-Level Layer](#4-safaridriver--low-level-layer)
5. [TikTok DM Service (port 3102)](#5-tiktok-dm-service-port-3102)
6. [TikTok Comments Service (port 3006)](#6-tiktok-comments-service-port-3006)
7. [Market Research — TikTok (port 3106)](#7-market-research--tiktok-port-3106)
8. [Selectors Reference](#8-selectors-reference)
9. [Rate Limits](#9-rate-limits)
10. [Startup Commands](#10-startup-commands)
11. [Debugging Playbook](#11-debugging-playbook)
12. [Known Failure Modes & Fixes](#12-known-failure-modes--fixes)

---

## 1. Services Overview

| Service | Package | Port | Language | Status |
|---------|---------|------|----------|--------|
| TikTok DM | `packages/tiktok-dm` | **3102** | TypeScript | ✅ Live |
| TikTok Comments | `packages/tiktok-comments` | **3006** | TypeScript | ✅ Live |
| Market Research (TikTok) | `packages/market-research` | **3106** | TypeScript | ✅ Live |

All three services automate the **TikTok web app** (tiktok.com) via Safari + AppleScript.  
No mobile app. No private API. No credentials beyond a logged-in Safari session.

---

## 2. Architecture — How It Works

```
API Request (HTTP)
       │
       ▼
Express Server (server.ts)
       │
       ▼
dm-operations.ts / tiktok-driver.ts / tiktok-researcher.ts
       │
       ▼
SafariDriver
  ├── executeJS()       ← osascript → Safari → JavaScript in page
  ├── navigateTo()      ← osascript → set URL of tab
  ├── typeViaKeystrokes()  ← System Events → keystroke
  ├── pressEnter()         ← System Events → keystroke return
  ├── clickAtViewportPosition()   ← Python Quartz CGEvent
  └── clickAtScreenPosition()     ← Python Quartz CGEvent
```

### JavaScript Execution Path
```
executeJS(js)
  → write js to temp file in /tmp/safari-js-{ts}-{rand}.js
  → osascript: read file → do JavaScript in tab N of window M
  → return stdout
  → delete temp file
```

The temp-file approach avoids AppleScript string-escaping limits on large scripts.

### OS-Level Click Path (Quartz)
```
clickAtViewportPosition(x, y)
  → get Safari window bounds via AppleScript
  → compute screen_x = window.x + viewport_x
  → compute screen_y = window.y + toolbar_height + viewport_y
     (toolbar_height = windowHeight - viewportHeight, dynamic)
  → write Python script to /tmp using Quartz.CGEventCreateMouseEvent
  → subprocess.run python3 script
  → mouse_down → mouse_up at (screen_x, screen_y)
```

---

## 3. TikTok DOM Quirks (Critical)

TikTok's messages page uses **virtual rendering**. This causes two major problems:

### Problem 1 — Zero-dimension sidebar elements
```js
// Most sidebar items report 0×0
div[class*="LiInboxItemWrapper"].getBoundingClientRect()
// → {width: 0, height: 0, x: 0, y: 0}
```
`JS .click()` **silently fails** on these elements. They receive the event but the React
virtual DOM does not respond to synthetic clicks.

**Solution:** Quartz OS-level mouse events (`clickAtViewportPosition`).
Only `<img>` avatar elements have real dimensions (48×48 at x≈60–130, y>50).

### Problem 2 — Search input is 0×0 too
```js
input[data-e2e="search-user-input"].getBoundingClientRect()
// → {width: 0, height: 0}  ← JS .focus() fails
```
**Solution:** OS-click at known viewport coordinate (≈300, 55) then `typeViaKeystrokes`.

### Problem 3 — Conversation container is a virtual list
Only the currently rendered rows exist in DOM. Scrolling loads more.
`scrollAndListAllConversations` handles this with a scroll-until-stable loop.

---

## 4. SafariDriver — Low-Level Layer

**File:** `packages/tiktok-dm/src/automation/safari-driver.ts`

### Key Methods

| Method | Description |
|--------|-------------|
| `executeJS(js)` | Run JS in tracked tab; falls back to front document |
| `executeJSInTab(js, win, tab)` | Target a specific window+tab index |
| `navigateTo(url)` | Set URL of tracked tab (or front document) |
| `getCurrentUrl()` | Get current URL via AppleScript |
| `waitForElement(sel, ms)` | Poll until selector found |
| `typeViaKeystrokes(text)` | OS-level keystroke via System Events |
| `pressEnter()` | OS-level Return key |
| `focusElement(sel)` | JS focus + click on selector |
| `clickElement(sel)` | JS click on selector (fails on virtual DOM) |
| `clickAtViewportPosition(x, y)` | **Quartz CGEvent** at viewport coords |
| `clickAtScreenPosition(vx, vy, isViewport)` | Quartz with screen offset calc |
| `findTabByUrl(pattern)` | Scan all Safari windows for URL match |
| `ensureSession(urlPattern)` | Lock onto the TikTok tab |
| `wait(ms)` | Promise-based sleep |

### Session Tracking
```
SafariDriver tracks (windowIndex, tabIndex) after ensureSession().
Re-verification every 5 seconds (SESSION_VERIFY_TTL_MS).
All executeJS / navigateTo calls use the tracked tab.
```

### Quartz Dependency
```bash
pip3 install pyobjc-framework-Quartz
# Required for clickAtViewportPosition / clickAtScreenPosition
```

---

## 5. TikTok DM Service (port 3102)

**Start:** `PORT=3102 npx tsx packages/tiktok-dm/src/api/server.ts`  
**Files:**
- `packages/tiktok-dm/src/api/server.ts` — Express routes
- `packages/tiktok-dm/src/automation/dm-operations.ts` — Core logic
- `packages/tiktok-dm/src/automation/safari-driver.ts` — Safari layer
- `packages/tiktok-dm/src/automation/types.ts` — Types + selectors + URLs

### 5.1 API Endpoints

#### Health & Status
| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Service health, platform, port |
| GET | `/api/tiktok/status` | Current URL, login state |
| GET | `/api/tiktok/error-check` | Detect TikTok error page |
| POST | `/api/tiktok/error-retry` | Click retry on error page |
| GET | `/api/tiktok/rate-limits` | Current rate limit counters |

#### Inbox Navigation
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/tiktok/inbox/navigate` | Navigate to `/messages` |

#### Conversations
| Method | Path | Body | Description |
|--------|------|------|-------------|
| GET | `/api/tiktok/conversations` | — | List visible conversations |
| POST | `/api/tiktok/conversations/open` | `{username}` | Open a conversation |
| POST | `/api/tiktok/conversations/new` | `{username, message}` | Start new conversation + send |
| POST | `/api/tiktok/conversations/scroll` | — | Scroll inbox once to load more |

#### Messages
| Method | Path | Body | Description |
|--------|------|------|-------------|
| GET | `/api/tiktok/messages` | `?limit=50` | Read messages from open conversation |
| POST | `/api/tiktok/messages/send` | `{text}` | Send in current open conversation |
| POST | `/api/tiktok/messages/send-to` | `{username, text}` | **Full send flow to any user** |
| POST | `/api/tiktok/messages/send-to-url` | `{profileUrl, message}` | Send via profile URL |

#### CRM
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/tiktok/crm/stats` | Engagement/message stats |
| POST | `/api/tiktok/crm/score` | Score a contact `{contactId}` |
| POST | `/api/tiktok/crm/score-all` | Recalculate all contact scores |
| GET | `/api/tiktok/crm/top-contacts` | `?limit=10` Top contacts by score |

#### Templates & Outreach
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/tiktok/templates` | `?lane=&stage=` Get message templates |
| POST | `/api/tiktok/templates/next-action` | `{username}` Recommended next action |
| POST | `/api/tiktok/templates/fit-signals` | `{text}` Detect fit signals in text |
| GET | `/api/tiktok/outreach/pending` | Queued outreach actions |
| POST | `/api/tiktok/outreach/queue` | `{contact_id, message}` Queue action |
| POST | `/api/tiktok/outreach/:id/sent` | Mark action as sent |
| POST | `/api/tiktok/outreach/:id/failed` | Mark action as failed |
| GET | `/api/tiktok/outreach/stats` | Outreach stats |

#### AI
| Method | Path | Body | Description |
|--------|------|------|-------------|
| POST | `/api/tiktok/ai/generate` | `{username, purpose, topic}` | GPT-4o DM generation |

#### Advanced
| Method | Path | Body | Description |
|--------|------|------|-------------|
| POST | `/api/execute` | `{script}` | Execute raw JS in Safari |

### 5.2 Send Flow — `sendDMByUsername`

The core of TikTok DM sending. Three strategies tried in order:

```
sendDMByUsername(handle, message)
  │
  ├─ navigate to tiktok.com/messages
  │
  ├─ STRATEGY A: Squish-match inbox row
  │   ├── findConversationByText() — scan DivItemWrapper rows
  │   │     text "Sarah E Ashley" → squish → "saraheashley" → matches
  │   ├── clickAtScreenPosition(row.x, row.y)  ← Quartz
  │   ├── wait 4s
  │   └── check composer open → _sendAndVerify()
  │
  ├─ STRATEGY B: Search filter
  │   ├── OS-click search bar at viewport (300, 55)
  │   ├── typeViaKeystrokes(handle)
  │   ├── wait 3.5s for filtered results
  │   ├── find first LiInboxItemWrapper avatar img (has real dims)
  │   ├── clickAtScreenPosition(img.x, img.y)  ← Quartz
  │   ├── wait 3s
  │   ├── verifyIdentity() — check a[href="/@handle"] in chat panel
  │   └── if verified → _sendAndVerify()
  │
  └─ STRATEGY C: NewMessage compose flow
      ├── clickElement([class*="NewMessage"])  ← Quartz
      ├── typeViaKeystrokes(handle)
      ├── click matching user card result
      └── sendMessage()
```

### 5.3 Identity Verification

**Pre-send:** `verifyIdentity()` checks for `a[href="/@{handle}"]` in the right chat panel.  
TikTok always injects a profile link for the open conversation.

**Post-send:** `_sendAndVerify()` checks `document.body.innerText.includes(messageSnippet)`.

### 5.4 Scroll & CRM Functions

```typescript
scrollAndListAllConversations(driver, maxScrolls=30)
  // Scrolls UlInboxItemListContainer until count stable (2 rounds)
  // Returns all DMConversation[] after full load

readAllMessages(driver, maxScrolls=20)
  // Scrolls DivChatArea upward until message count stable
  // Returns all DMMessage[] (up to 9999)

enrichContact(username, driver)
  // Navigates to tiktok.com/@{username}
  // Returns: { fullName, bio, followers, following, likes }
  // Selectors: [data-e2e="user-title"], [data-e2e="user-bio"],
  //            [data-e2e="followers-count"] etc.
```

### 5.5 Data Types

```typescript
interface DMConversation {
  username: string;       // display name from inbox row
  displayName?: string;
  lastMessage?: string;
  timestamp?: string;
  unread: boolean;
  avatarUrl?: string;
}

interface DMMessage {
  id?: string;
  content: string;
  sender: 'me' | 'them';
  timestamp?: string;
  type: 'text' | 'image' | 'video' | 'sticker';
}

interface SendMessageResult {
  success: boolean;
  error?: string;
  username?: string;
  verified?: boolean;        // true if message found in DOM post-send
  verifiedRecipient?: string; // confirmed recipient name/handle
}
```

### 5.6 AI DM Generation

Requires `OPENAI_API_KEY` env var. Model: `gpt-4o`, max 150 chars.  
Falls back to a hardcoded template if key is missing.

```bash
POST /api/tiktok/ai/generate
{
  "username": "saraheashley",
  "purpose": "collab outreach",
  "topic": "travel content"
}
```

---

## 6. TikTok Comments Service (port 3006)

**Start:** `PORT=3006 npx tsx packages/tiktok-comments/src/api/server.ts`  
**Files:**
- `packages/tiktok-comments/src/api/server.ts` — Express routes
- `packages/tiktok-comments/src/automation/tiktok-driver.ts` — Driver + comment logic
- `packages/tiktok-comments/src/automation/tiktok-researcher.ts` — Research engine
- `packages/tiktok-comments/src/automation/safari-driver.ts` — Safari layer

### 6.1 API Endpoints

| Method | Path | Body | Description |
|--------|------|------|-------------|
| GET | `/health` | — | Service health |
| GET | `/api/tiktok/status` | — | Current URL, rate limits |
| GET | `/api/tiktok/rate-limits` | — | Get rate limit config |
| PUT | `/api/tiktok/rate-limits` | `{...config}` | Update rate limits |
| POST | `/api/tiktok/navigate` | `{url}` | Navigate to a video URL |
| GET | `/api/tiktok/comments` | `?limit=50` | Extract comments from current video |
| POST | `/api/tiktok/comments/post` | `{text, postUrl, useAI?, postContent?, username?}` | Post a comment |
| POST | `/api/tiktok/comments/generate` | `{postContent, username}` | AI comment generation only |
| GET | `/api/tiktok/config` | — | Get driver config |
| PUT | `/api/tiktok/config` | `{...config}` | Update driver config |

### 6.2 Posting a Comment

```bash
# Navigate first, then comment
POST /api/tiktok/comments/post
{
  "postUrl": "https://www.tiktok.com/@saraheashley/video/7123456789012345678",
  "text": "This is so relatable! 🔥"
}

# Or with AI-generated text
POST /api/tiktok/comments/post
{
  "postUrl": "https://www.tiktok.com/@saraheashley/video/7123456789012345678",
  "useAI": true,
  "postContent": "Travel vlog in Bali",
  "username": "saraheashley"
}
```

**Video URL format (required for TikTok):**
```
https://www.tiktok.com/@{username}/video/{videoId}
```

### 6.3 Comment Extraction

Navigates to video, opens comment section, scrapes:
- Author username + display name
- Comment text
- Like count
- Timestamp
- Reply count
- Verified badge

---

## 7. Market Research — TikTok (port 3106)

**Start:** `SAFARI_RESEARCH_ENABLED=true PORT=3106 npx tsx packages/market-research/src/api/server.ts`  
**Engine:** `packages/tiktok-comments/src/automation/tiktok-researcher.ts`

### 7.1 API Endpoints

| Method | Path | Body | Description |
|--------|------|------|-------------|
| POST | `/api/research/tiktok/search` | `{query, config?}` | Instant search, returns immediately |
| POST | `/api/research/tiktok/niche` | `{niche, config?}` | Async job — returns `jobId` |
| GET | `/api/research/status/:jobId` | — | Poll job progress |
| GET | `/api/research/results/latest/tiktok` | — | Latest saved TikTok results |
| POST | `/api/research/all/full` | `{niches[], platforms?}` | Cross-platform research job |

### 7.2 TikTokResearcher Engine

**Class:** `TikTokResearcher` in `tiktok-researcher.ts`

#### Config Defaults
```typescript
{
  videosPerNiche: 1000,          // target videos to collect
  creatorsPerNiche: 100,         // top creators to rank
  scrollPauseMs: 1800,           // delay between scrolls
  maxScrollsPerSearch: 200,      // max scroll attempts
  timeout: 30000,                // JS timeout ms
  outputDir: '~/Documents/tiktok-research'  // results path
}
```

#### Research Flow
```
TikTokResearcher.runNiche(niche, query)
  │
  ├─ search(query)
  │   └─ navigate to tiktok.com/search/video?q={query}
  │   └─ wait for data-e2e="search_video-item"
  │
  ├─ SCROLL LOOP (up to maxScrollsPerSearch):
  │   ├─ extractVisibleVideos(niche)  ← DOM scrape
  │   ├─ dedup by video ID
  │   ├─ window.scrollBy(0, 800)
  │   └─ wait scrollPauseMs
  │
  ├─ rankCreators(videos)
  │   ├─ group by author handle
  │   ├─ sum engagement: likes + comments×2 + shares×3
  │   └─ sort descending → top creatorsPerNiche
  │
  ├─ (optional) deepScrapeVideo(url) per top video
  │   └─ full engagement from video detail page
  │
  └─ save JSON to outputDir/{niche}-{timestamp}.json
```

#### Video Data Fields
```typescript
interface TikTokVideo {
  id: string;               // video ID from URL
  url: string;              // full tiktok.com URL
  description: string;      // caption text (up to 500 chars)
  author: string;           // @handle
  authorUrl: string;        // tiktok.com/@handle
  authorDisplayName: string;
  isVerified: boolean;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  engagementScore: number;  // likes + comments×2 + shares×3
  hashtags: string[];
  sound: string;
  niche: string;
  collectedAt: string;      // ISO timestamp
}
```

#### Creator Ranking Fields
```typescript
interface TikTokCreator {
  handle: string;
  displayName: string;
  url: string;
  isVerified: boolean;
  videoCount: number;
  totalViews: number;
  totalLikes: number;
  totalComments: number;
  totalShares: number;
  totalEngagement: number;
  avgEngagement: number;
  topVideoUrl: string;
  topVideoEngagement: number;
  niche: string;
}
```

#### Engagement Extraction — 4 Strategies
The researcher tries four DOM strategies per video card to extract metrics:

1. **`data-e2e` attributes** — `browse-video-like-count`, `browse-video-comment-count` etc.
2. **Numeric text nodes scan** — find all `K/M/B` suffixed numbers, assign by value (largest = views)
3. **`aria-label` parsing** — `"1.2M likes"`, `"45 comments"` patterns
4. **`innerText` fallback** — `"1.2M views"` regex on full card text

#### Output Files
```
~/Documents/tiktok-research/
  {niche}-{ISO-timestamp}.json
    {
      niche, query, videos[], creators[],
      totalCollected, uniqueVideos,
      collectionStarted, collectionFinished, durationMs
    }
```

### 7.3 Example Research Request

```bash
# Start an async research job
curl -X POST http://localhost:3106/api/research/tiktok/niche \
  -H "Content-Type: application/json" \
  -d '{
    "niche": "travel vlog",
    "config": {
      "creatorsPerNiche": 20,
      "postsPerNiche": 100,
      "maxScrollsPerSearch": 30
    }
  }'
# → {"jobId": "abc123", "status": "running"}

# Poll until complete
curl http://localhost:3106/api/research/status/abc123
# → {"status": "complete", "topCreators": [...], "posts": [...]}
```

---

## 8. Selectors Reference

### Conversation Inbox (`tiktok.com/messages`)

| Element | Selector | Notes |
|---------|----------|-------|
| Conversation list | `ul[class*="InboxItemListContainer"]` | Virtual list |
| Conversation row | `li[class*="InboxItemWrapper"]` | 0×0 dims — OS-click only |
| Row container | `div[class*="DivItemContainer"]` | |
| Avatar container | `div[class*="DivAvatarContainer"]` | |
| Avatar image | `img` (filter: 36–60px wide, x 50–140, y>50) | Only element with real dims |
| Profile link | `a[href="/@{handle}"]` | Reliable identity check |
| Search input | `input[data-e2e="search-user-input"]` | 0×0 — must OS-click at (300, 55) |

### Message Composer

| Element | Selector | Notes |
|---------|----------|-------|
| Draft.js root | `[class*="DivEditorContainer"] .DraftEditor-root .DraftEditor-editorContainer [contenteditable="true"]` | Most specific |
| Contenteditable fallback | `.public-DraftEditor-content[contenteditable="true"]` | |
| Send button | `[data-e2e="message-send"]` | SVG — click parent div |

### Profile Page (`tiktok.com/@{handle}`)

| Element | Selector |
|---------|----------|
| Display name | `h1[data-e2e="user-title"]` |
| Bio | `[data-e2e="user-bio"]` |
| Followers | `[data-e2e="followers-count"]` |
| Following | `[data-e2e="following-count"]` |
| Total likes | `[data-e2e="likes-count"]` |
| Message button | `[data-e2e="message-button"]` |
| Follow button | `[data-e2e="follow-button"]` |

### Search Results (`tiktok.com/search/video?q=`)

| Element | Selector |
|---------|----------|
| Video card | `[data-e2e="search_video-item"]`, `div[class*="DivVideoCard"]` |
| Description | `[data-e2e="search-card-desc"]`, `[data-e2e="video-desc"]` |
| Author | `[data-e2e="search-card-user-name"]` |
| Like count | `[data-e2e="browse-video-like-count"]` |
| View count | `[data-e2e="video-play-count"]` |
| Verified badge | `svg[data-e2e="verify-badge"]` |

---

## 9. Rate Limits

### DM Service (port 3102)
| Limit | Default |
|-------|---------|
| Messages per hour | 10 |
| Messages per day | 50 |
| Min delay between sends | 2 min |
| Max delay between sends | 5 min |
| Active hours | 9:00 – 21:00 |

### Comments Service (port 3006)
Configurable via `PUT /api/tiktok/config`.

### Research Service (port 3106)
Rate limited by `scrollPauseMs` (default 1800ms) between scroll steps.
Max 200 scrolls per search by default.

---

## 10. Startup Commands

```bash
# Navigate to project root
cd ~/Documents/Software/Safari\ Automation

# Start TikTok DM service
PORT=3102 npx tsx packages/tiktok-dm/src/api/server.ts &

# Start TikTok Comments service
PORT=3006 npx tsx packages/tiktok-comments/src/api/server.ts &

# Start Market Research service (TikTok + others)
SAFARI_RESEARCH_ENABLED=true PORT=3106 npx tsx packages/market-research/src/api/server.ts &

# Verify all running
curl http://localhost:3102/health
curl http://localhost:3006/health
curl http://localhost:3106/health
```

### Prerequisites
- Safari open with TikTok logged in
- Node.js 18+, `npx tsx` available
- `pip3 install pyobjc-framework-Quartz` (OS-level clicks)
- `OPENAI_API_KEY` in env (optional — enables AI DM/comment generation)

---

## 11. Debugging Playbook

### DM not sending
```bash
# 1. Check service is alive
curl http://localhost:3102/health

# 2. Check TikTok is open and logged in
curl http://localhost:3102/api/tiktok/status

# 3. Check for TikTok error page
curl http://localhost:3102/api/tiktok/error-check
# → {"hasError": true}  — trigger retry:
curl -X POST http://localhost:3102/api/tiktok/error-retry

# 4. Navigate to messages manually
curl -X POST http://localhost:3102/api/tiktok/inbox/navigate

# 5. List visible conversations
curl http://localhost:3102/api/tiktok/conversations

# 6. Execute raw JS to probe DOM
curl -X POST http://localhost:3102/api/execute \
  -H "Content-Type: application/json" \
  -d '{"script":"document.querySelectorAll(\"li[class*=InboxItemWrapper]\").length.toString()"}'
```

### Getting 0 conversations
```bash
# Probe what's actually in the DOM
curl -X POST http://localhost:3102/api/execute \
  -H "Content-Type: application/json" \
  -d '{"script":"(function(){var rows=document.querySelectorAll(\"[class*=LiInboxItemWrapper],[class*=DivItemWrapper]\");return rows.length + \" rows | \" + document.body.innerText.substring(0,200);})()"}'
```
TikTok virtualizes the list — make sure you're at `tiktok.com/messages` and scrolled to load items.

### Quartz click not landing
- Confirm `pyobjc-framework-Quartz` is installed: `python3 -c "import Quartz"`
- Verify Safari is frontmost when clicking: `driver.activateSafari()` is called before clicks
- Check toolbar height calculation: `windowHeight - viewportHeight` (varies by Safari version)

### Research returning 0 videos
- Confirm you're logged in to TikTok in Safari (search pages require login)
- `waitForSelector` checks for `data-e2e="search_video-item"` — if TikTok changes structure, check DOM manually
- Try a broader search query

---

## 12. Known Failure Modes & Fixes

| Symptom | Root Cause | Fix |
|---------|-----------|-----|
| `conversations: []` after navigate | Virtual DOM not loaded | Wait 5s after navigate; scroll inbox |
| Click lands on wrong conversation | Quartz window offset wrong | Toolbar offset = `windowHeight - viewportHeight` (dynamic, not hardcoded) |
| Message typed but not sent | Send button is SVG child — `.click()` fails | Click parent `div` of `[data-e2e="message-send"]` |
| "Page not available" error | TikTok rate-limiting or routing error | `POST /api/tiktok/error-retry` auto-clicks retry button |
| Strategy A squish-match wrong user | Inbox shows different user but text partially matches | Verify identity with `a[href="/@{handle}"]` check |
| `Cannot find module` on startup | TypeScript path issue | Use `npx tsx` not `ts-node`; check `package.json` exports |
| Research job stalls at 0 videos | Login wall on search page | Open `tiktok.com/search/video?q=test` in Safari manually, confirm logged in |
| AI generate returns template fallback | `OPENAI_API_KEY` not set | Export `OPENAI_API_KEY=sk-...` before starting server |

---

## Cross-References

- `docs/TIKTOK-DM-AUTOMATION.md` — Deep-dive on DM send strategies
- `docs/selectors/TIKTOK_SELECTORS_REFERENCE.md` — Full selector audit
- `docs/TIKTOK_COMMANDS_REFERENCE.md` — Quick curl command cheatsheet
- `docs/SAFARI_AUTOMATIONS_INVENTORY.md` — All platform services inventory
- `packages/tiktok-dm/src/automation/types.ts` — Ground-truth selectors (TIKTOK_SELECTORS, TIKTOK_URLS)
