# LinkedIn Automation — Complete Reference

**Last updated:** 2026-02-28 · **Status:** ✅ Production-verified  
**Port:** 3105 · **Package:** `packages/linkedin-automation/`

---

## Table of Contents

1. [Service Overview](#1-service-overview)
2. [Architecture — How It Works](#2-architecture--how-it-works)
3. [LinkedIn DOM Quirks (Critical)](#3-linkedin-dom-quirks-critical)
4. [SafariDriver — Low-Level Layer](#4-safaridriver--low-level-layer)
5. [Profile Extraction](#5-profile-extraction)
6. [People Search](#6-people-search)
7. [Lead Scoring](#7-lead-scoring)
8. [Connections](#8-connections)
9. [Messaging (DM)](#9-messaging-dm)
10. [Prospecting Pipeline](#10-prospecting-pipeline)
11. [Outreach Engine (Campaigns)](#11-outreach-engine-campaigns)
12. [AI Message Generation](#12-ai-message-generation)
13. [All API Endpoints](#13-all-api-endpoints)
14. [Selectors Reference](#14-selectors-reference)
15. [Rate Limits](#15-rate-limits)
16. [Startup & Prerequisites](#16-startup--prerequisites)
17. [Debugging Playbook](#17-debugging-playbook)
18. [Known Failure Modes & Fixes](#18-known-failure-modes--fixes)

---

## 1. Service Overview

Single Express REST API service. All automation drives the **LinkedIn web app** (linkedin.com) via Safari + AppleScript. No private LinkedIn API, no credentials stored — requires a logged-in Safari tab.

### Package Structure

```
packages/linkedin-automation/src/
  api/
    server.ts                 ← Express routes + rate-limit counters
  automation/
    safari-driver.ts          ← Low-level Safari/AppleScript abstraction
    types.ts                  ← All TypeScript types + selectors + rate limit defaults
    connection-operations.ts  ← Profile extraction, search, connection requests, scoring
    dm-operations.ts          ← Messaging: list/read/send/open conversations
    outreach-engine.ts        ← Campaign/prospect lifecycle engine (persistent state)
    prospecting-pipeline.ts   ← One-shot search→score→connect→DM pipeline
    index.ts                  ← Re-exports
  __tests__/
    selectors.test.ts         ← 18/18 selector validation tests
```

---

## 2. Architecture — How It Works

```
API Request (HTTP → port 3105)
        │
        ▼
Express Server (server.ts)
  │  In-memory rate-limit counters
  │  Active hours enforcement
        │
        ▼
connection-operations.ts / dm-operations.ts / outreach-engine.ts
        │
        ▼
SafariDriver
  ├── executeJS(js)             ← write JS to temp file → osascript → Safari tab
  ├── navigateTo(url)           ← osascript: set URL of tab
  ├── typeViaKeystrokes(text)   ← System Events → keystroke (for input fields)
  ├── typeViaClipboard(text)    ← pbcopy + ⌘V paste (for contenteditable)
  ├── pressEnter()              ← System Events → keystroke return
  ├── focusElement(sel)         ← JS .focus() + .click()
  ├── clickElement(sel)         ← JS .click()
  ├── clickAtViewportPosition() ← Python Quartz CGEvent (Ember.js workaround)
  ├── activateTab(w, t)         ← AppleScript: set window index + current tab
  └── ensureActiveSession()     ← self-healing session lock (TTL 5s)
```

### JavaScript Execution Path
```
executeJS(code)
  → strip newlines/extra whitespace
  → write to /tmp/safari-js-{ts}-{rand}.js
  → osascript: read file → do JavaScript in tab N of window M
  → return stdout, delete temp file
```

The temp-file approach avoids AppleScript string-quoting limits on large scripts.

### Session Management
`ensureActiveSession(urlPattern)` self-heals across Safari restarts:
1. **Fast path:** if tracked tab is within 5s TTL, verify URL still matches → reuse
2. **URL drift:** tab navigated away → invalidate, fall through to full scan
3. **Full scan:** loop all windows/tabs looking for `urlPattern` in URL
4. **Not found:** navigate front document to `https://www.{urlPattern}`, retry scan

---

## 3. LinkedIn DOM Quirks (Critical)

### Quirk 1 — Connect & Message are `<a>` tags, not `<button>` (Feb 2026)
```html
<!-- Connect -->
<a aria-label="Invite Name to connect" href="/preload/custom-invite/...">Connect</a>
<!-- Message -->
<a href="/messaging/compose/?profileUrn=...">Message</a>
<!-- Only "More" is a button -->
<button aria-label="More">...</button>
```
All connection/DM code checks **both** `querySelectorAll('button')` and `querySelectorAll('a')` in the profile section.

### Quirk 2 — Ember.js messaging ignores JS `.click()`
The `/messaging/` page uses LinkedIn's Ember.js framework. Conversation list items have real `getBoundingClientRect` values (unlike TikTok), but clicking them via JS `.click()` doesn't activate the React/Ember event handlers reliably.

**Solution:** `clickAtViewportPosition(x, y)` → Quartz CGEvent native mouse click.

### Quirk 3 — Profile extraction uses `innerText` parsing, not CSS selectors
LinkedIn Feb 2026 uses obfuscated class names that change frequently. Instead of relying on them, `PROFILE_EXTRACTION_JS` parses `main.innerText` line-by-line:
- Splits by newline, trims, filters empty
- Uses section headings ("Experience", "Skills", "About", etc.) as boundaries
- Extracts name from first `h2` that isn't a section heading
- Reads connection degree from `1st`/`2nd`/`3rd` pattern in intro block

### Quirk 4 — Search result deduplication
Each search result `<li>` contains **two** `<a href*="/in/">` links: one for the username, one for the `ACoAAA...` internal ID. The extraction JS picks the non-`ACoAA` link as the canonical URL.

### Quirk 5 — Message input uses clipboard paste, not keystrokes
`sendMessage()` calls `typeViaClipboard()` (pbcopy + ⌘V) for the `contenteditable` message box. Raw keystrokes lose Unicode characters; clipboard paste preserves them.

### Quirk 6 — Connect anchor JS `.click()` sends invite WITHOUT modal (Feb 2026)
The Connect `<a href="/preload/custom-invite/?vanityName=...">` tag's JS `.click()` fires Ember.js's internal handler that sends the invitation **immediately** — no modal, no "Add a note?" prompt, no page navigation. This is by design in LinkedIn's Ember routing.

**To add a note:** Navigate directly to `https://www.linkedin.com/preload/custom-invite/?vanityName={name}`. This page renders a form with "Add a note" / "Send without a note" buttons. See [§8 Connections](#8-connections) for the full flow.

> **Tested click approaches that all bypass the modal:**
> - JS `.click()` — sends invite directly
> - JS `dispatchEvent(new MouseEvent(...))` — sends invite directly
> - `cliclick` — sends invite directly
> - Python Quartz CGEvent — sends invite directly
> - AppleScript System Events — error -25200

### Quirk 7 — SPA race: Connect appears briefly for pending profiles
LinkedIn's SPA may render a Connect anchor for 1–3 seconds during page load, even for profiles where an invitation is already pending. The status check must poll for Pending after finding Connect to avoid false positives. The `sendConnectionRequest` function polls up to 5s for this transition.

---

## 4. SafariDriver — Low-Level Layer

**File:** `packages/linkedin-automation/src/automation/safari-driver.ts`

### All Public Methods

| Method | Description |
|--------|-------------|
| `executeJS(js)` | Run JS in tracked tab; uses temp file to avoid quoting issues |
| `executeJSInTab(js, w, t)` | Target a specific window+tab index directly |
| `navigateTo(url)` | `set URL of tab N of window M` or front document |
| `getCurrentUrl()` | `get URL of front document` via AppleScript |
| `isLoggedIn()` | Check for login form in DOM |
| `isOnLinkedIn()` | Check if current URL is linkedin.com |
| `wait(ms)` | Promise sleep |
| `humanDelay(minMs, maxMs)` | Random delay between min/max (anti-detection) |
| `waitForElement(sel, maxMs)` | Poll until selector found or timeout |
| `waitForCondition(jsExpr, maxMs, pollMs)` | Poll a JS expression until truthy string; returns result or `''` on timeout |
| `nativeClickSelector(sel)` | OS-level mouse click via Quartz CGEvent at element's screen coords |
| `typeViaKeystrokes(text)` | System Events `keystroke` — works for regular inputs |
| `typeViaClipboard(text)` | pbcopy + ⌘V — works for contenteditable |
| `pressEnter()` | System Events `keystroke return` |
| `focusElement(sel)` | JS `.focus()` + `.click()` |
| `clickElement(sel)` | JS `.click()` |
| `clickAtViewportPosition(x, y)` | Quartz CGEvent at viewport coords |
| `activateSafari()` | Bring Safari to foreground |
| `activateTab(w, t)` | Focus a specific window+tab |
| `findTabByUrl(pattern)` | Scan all windows for URL pattern |
| `ensureActiveSession(pattern)` | Self-healing session lock |
| `verifySession(pattern)` | Check if tracked tab URL still matches |
| `clearTrackedSession()` | Reset tracked window/tab |
| `getSessionInfo()` | Return tracked window/tab/pattern/lastVerified |
| `takeScreenshot(path)` | `screencapture -x` |
| `getConfig()` / `setConfig()` | Read/update AutomationConfig |

### Singleton
```typescript
getDefaultDriver()   // returns module-level SafariDriver singleton
setDefaultDriver(d)  // replace the singleton (for testing)
```

### Config Defaults
```typescript
{
  instanceType: 'local',  // or 'remote' (forwards JS over HTTP to remoteUrl)
  timeout: 30000,
  actionDelay: 2000,
  verbose: false,
}
```

---

## 5. Profile Extraction

**File:** `connection-operations.ts`

### `extractProfile(profileUrl)`
```
navigateToProfile(url)
  → wait 5s
  → poll: main.querySelectorAll("h2").length > 2 → "ready" (up to 15s)
  → executeJS(PROFILE_EXTRACTION_JS)  ← single round-trip
  → parse JSON → LinkedInProfile
```

### Extraction Strategy (innerText parsing)
```
main.innerText → split by \n → trim → filter empty → lines[]

1. Name: first h2 in <main> that isn't a section heading, < 60 chars
2. Intro block: scan 15 lines after name line
   - "1st"/"2nd"/"3rd" → connectionDegree
   - "{N} mutual" → mutualConnections  
   - First non-match line > 5 chars → headline
   - Line with comma or "United States" → location
3. Experience: lines between "Experience" and next section heading
   - line[0] → title, line[1] → company, scan for \d{4}|- → duration
4. About: lines between "About" and next section heading (up to 500 chars)
5. Skills: lines between "Skills" and next heading (up to 10, < 60 chars each)
6. Buttons AND anchors → canConnect, canMessage
7. Text scan → isOpenToWork, isHiring
```

### `LinkedInProfile` Fields
```typescript
{
  profileUrl: string;
  name: string;
  headline: string;
  location: string;
  about?: string;
  currentPosition?: { title, company, duration };
  connectionDegree: '1st' | '2nd' | '3rd' | 'out_of_network';
  mutualConnections: number;
  isOpenToWork: boolean;
  isHiring: boolean;
  skills: string[];          // up to 10
  canConnect: boolean;
  canMessage: boolean;
  scrapedAt: string;         // ISO timestamp
}
```

### `extractCurrentProfile()` (no navigation)
Runs `PROFILE_EXTRACTION_JS` on the currently loaded page.
Used by `GET /api/linkedin/profile/extract-current`.

---

## 6. People Search

**File:** `connection-operations.ts`

### `searchPeople(config)`
```
Build URL: linkedin.com/search/results/people/?keywords=...&titleFreeText=...&company=...
navigateTo(url)
wait 5s
poll: main querySelectorAll("a[href*='/in/']").length > 0 → ready (up to 15s)
executeJS(SEARCH_EXTRACTION_JS) → up to 20 results
```

### Search Config
```typescript
interface PeopleSearchConfig {
  keywords: string[];      // joined with space
  title?: string;          // → titleFreeText param
  company?: string;
  location?: string;       // not yet applied to URL (manual filter)
  connectionDegree?: '1st' | '2nd' | '3rd+';
  industry?: string;
}
```

### Extraction Strategy (`SEARCH_EXTRACTION_JS`)
```
mainEl = document.querySelector('main')
allLis = mainEl.querySelectorAll('li')

For each li:
1. Find a[href*="/in/"] — skip if none
2. Dedup: pick non-ACoAA href as canonical
3. Name: first span[aria-hidden="true"] that isn't visually-hidden, 
         doesn't start with •, no "degree" text
4. Degree: scan spans for "1st"/"2nd"/"3rd"
5. Headline / Location: leaf div nodes (no children), len 5–200
6. Mutual connections: allText.match(/(\d+)\s*mutual/i)
Returns up to 20 results
```

### `SearchResult` Fields
```typescript
{
  name: string;
  profileUrl: string;
  headline: string;
  location: string;
  connectionDegree: string;
  mutualConnections: number;
}
```

---

## 7. Lead Scoring

**File:** `connection-operations.ts` → `scoreProfile()`

### Score Factors (max 100 points)

| Factor | Weight | Logic |
|--------|--------|-------|
| `titleMatch` | 0–30 | 30 if any `targetTitles` substring matches `currentPosition.title`; else 5 (or 10 if no targets) |
| `companyMatch` | 0–20 | 20 if any `targetCompanies` substring match; else 3 (or 8 if no targets) |
| `locationMatch` | 0–15 | 15 if any `targetLocations` substring match; else 3 (or 8 if no targets) |
| `connectionProximity` | 0–20 | 1st=20, 2nd=15, 3rd=8, out_of_network=3 |
| `activityLevel` | 0–15 | +5 for isOpenToWork, +5 for isHiring, +5 if about.length > 50 |

### Recommendation Thresholds
| Score | Recommendation |
|-------|---------------|
| ≥70 | `high_priority` |
| ≥50 | `medium` |
| ≥30 | `low` |
| <30 | `skip` |

### `LeadScore` Fields
```typescript
{
  profileUrl: string;
  totalScore: number;           // 0-100
  factors: {
    titleMatch: number;
    companyMatch: number;
    locationMatch: number;
    connectionProximity: number;
    activityLevel: number;
  };
  recommendation: 'high_priority' | 'medium' | 'low' | 'skip';
  reason: string;               // e.g. "Title match, Close connection"
}
```

---

## 8. Connections

**File:** `connection-operations.ts`  
**Last verified:** 2026-02-28

### How It Works — Event-Driven Connection Flow

The connection request system uses an **event-driven approach** with DOM polling instead of fixed delays. It handles two distinct paths depending on whether a note is requested.

```
Step 1: Navigate + wait for profile action buttons (poll up to 10s)
        └── waitForCondition: section has Connect/Pending/Message elements

Step 2: Read DOM state → JSON { connect, message, pending, follow, more }
        └── SPA race guard: if Connect found, poll 5s for Pending transition

Step 3: Determine status
        ├── pending     → return { status: 'pending' }
        ├── message-only → return { status: 'already_connected' }
        ├── follow-only  → return { status: 'cannot_connect' }
        └── connect found → extract vanityName → proceed to Step 4

Step 4: Send invitation
        ├── Path A (WITH note):
        │     Navigate to /preload/custom-invite/?vanityName={name}
        │     waitForCondition: "Add a note" button appears
        │     JS click "Add a note" → textarea#custom-message appears
        │     JS: set textarea.value + dispatch input event
        │     waitForCondition: Send button enabled
        │     JS click "Send"
        │
        └── Path B (WITHOUT note):
              JS .click() on Connect anchor (sends invitation directly)
              wait 3s for async API completion

Step 5: Verify Pending
        Navigate back to profile (if needed)
        waitForCondition: Pending button appears (poll 8s)
        └── Fallback: re-read full state for edge cases
```

#### Key Design Decisions

- **Custom-Invite URL for notes:** LinkedIn's Connect `<a>` tag links to `/preload/custom-invite/?vanityName=...`. A JS `.click()` on this anchor sends the invitation immediately WITHOUT showing a modal. To add a note, we navigate directly to the custom-invite URL which renders a proper form with "Add a note" / "Send without a note" buttons and a `textarea#custom-message`.
- **JS click for no-note:** A simple `.click()` on the Connect anchor fires Ember.js's internal handler and sends the invite asynchronously. No page navigation occurs.
- **SPA race condition:** LinkedIn's SPA briefly renders a Connect anchor during page load even for already-pending profiles. A 5s poll for Pending after initial state read catches this transition.
- **More dropdown:** If Connect isn't directly visible, the function opens the "More" dropdown, checks for a "Connect" menu item, closes the dropdown, then proceeds via the custom-invite URL (ensuring notes work even for More-hidden Connect).

### `sendConnectionRequest(request)` — curl Examples

**Send without a note:**
```bash
curl -X POST http://localhost:3105/api/linkedin/connections/request \
  -H "Content-Type: application/json" \
  -d '{
    "profileUrl": "https://www.linkedin.com/in/johndoe/",
    "skipIfPending": true,
    "skipIfConnected": true
  }'
```

**Send with a note (max 300 chars):**
```bash
curl -X POST http://localhost:3105/api/linkedin/connections/request \
  -H "Content-Type: application/json" \
  -d '{
    "profileUrl": "https://www.linkedin.com/in/johndoe/",
    "note": "Hi John, I came across your work and would love to connect!",
    "skipIfPending": true,
    "skipIfConnected": true
  }'
```

**Force send outside active hours (testing):**
```bash
curl -X POST http://localhost:3105/api/linkedin/connections/request \
  -H "Content-Type: application/json" \
  -d '{
    "profileUrl": "https://www.linkedin.com/in/johndoe/",
    "note": "Hi! Would love to connect.",
    "force": true
  }'
```

### `ConnectionRequest` Type
```typescript
{
  profileUrl: string;          // Full LinkedIn profile URL
  note?: string;               // Optional note (max 300 chars, LinkedIn limit)
  skipIfConnected?: boolean;   // Return success if already connected
  skipIfPending?: boolean;     // Return success if invitation already pending
  force?: boolean;             // Bypass active hours check (8am-6pm)
}
```

### `ConnectionResult` Type
```typescript
{
  success: boolean;
  status: 'sent' | 'already_connected' | 'pending' | 'cannot_connect' | 'error';
  reason?: string;             // Human-readable reason for non-success
  noteSent?: boolean;          // true if invitation included a note
}
```

### Response Examples

```jsonc
// Successful — no note
{"success": true, "status": "sent", "noteSent": false}

// Successful — with note
{"success": true, "status": "sent", "noteSent": true}

// Already pending
{"success": true, "status": "pending"}               // if skipIfPending
{"success": false, "status": "pending", "reason": "Pending, click to withdraw..."}

// Already connected
{"success": true, "status": "already_connected"}      // if skipIfConnected

// Follow-only profile
{"success": false, "status": "cannot_connect", "reason": "Follow-only profile — no Connect option available"}

// Connect not in More menu
{"success": false, "status": "cannot_connect", "reason": "Connect not in More menu. Items: follow, report"}
```

### `listPendingRequests(type)` — sent or received
```
Navigate to:
  received → linkedin.com/mynetwork/invitation-manager/
  sent     → linkedin.com/mynetwork/invitation-manager/sent/
Scrape .invitation-card items (up to 30)
Return PendingRequest[]
```

### `acceptRequest(profileUrl)`
Finds card on invitation manager page, clicks `button[aria-label*="Accept"]`.

### `getConnectionStatus(profileUrl)`
Navigates to profile, reads buttons+anchors to determine status:
- `connected` — Message visible, no Connect
- `pending_sent` — Pending button visible
- `following` — Following button visible
- `not_connected` — fallback

---

## 9. Messaging (DM)

**File:** `dm-operations.ts`

### `listConversations()` → up to 30
Scrapes `.msg-conversation-listitem` items from messaging page.

**Selector precedence:**
1. `.msg-conversation-listitem` (primary)
2. `.msg-conversations-container__conversations-list li` (fallback)

**Fields extracted per conversation:**
```typescript
interface LinkedInConversation {
  conversationId: string;       // from data-control-id or href
  participantName: string;      // .msg-conversation-listitem__participant-names
  participantHeadline?: string; // .msg-conversation-listitem__headline
  lastMessage: string;          // .msg-conversation-card__message-snippet (up to 100 chars)
  lastMessageAt: string;        // .msg-conversation-listitem__time-stamp
  unread: boolean;              // class msg-conversation-listitem--unread
  isGroup: boolean;             // name.includes(',')
}
```

### `readMessages(limit)` → LinkedInMessage[]
Scrapes **only** `.msg-s-message-list__event` (parent LI).
- **Important:** Do NOT also query `.msg-s-event-listitem` — it's a child and causes duplicates.
- Message body: `.msg-s-event-listitem__body`
- Sender: `.msg-s-message-group__name`
- Time: `time` element or `.msg-s-message-group__timestamp`
- Outbound: `.msg-s-message-list__event--outbound` class or child `.msg-s-event-listitem--outbound`

### `openConversation(participantName)`
```
JS: find .msg-conversation-listitem where participantName includes search
JS: scrollIntoView({block:'center'})
wait 200ms (scroll reflow)
JS: getBoundingClientRect() → get x,y center coords
clickAtViewportPosition(x, y)  ← Quartz native click
wait 3s
JS: verify .msg-entity-lockup__entity-title includes target name
If mismatch: retry click at (x-50, y) once
```

### `sendMessage(text)` — in current open conversation
```
JS: focus .msg-form__contenteditable (+ 2 fallback selectors)
typeViaClipboard(text)          ← clipboard paste, not keystrokes
wait 0.5s
JS: click .msg-form__send-button (if not disabled)
  → fallback: pressEnter()
wait 2s
JS: verify last .msg-s-event-listitem__body contains first 30 chars of text
JS: get recipient from .msg-entity-lockup__entity-title
Return: { success, verified, verifiedRecipient }
```

### `sendMessageToProfile(profileUrl, text)` — new conversation from profile
```
navigateTo(profileUrl)
humanDelay(2–4s)
JS: click Message button or <a href="/messaging/compose/..."> anchor
wait 2s
JS: focus .msg-form__contenteditable
typeViaClipboard(text)
JS: click .msg-form__send-button
  → fallback: pressEnter()
wait 2s
Return: { success: true, verified: true }
```

### `getUnreadCount()`
Checks `.msg-overlay-bubble-header__badge` or nav badge. Returns integer.

---

## 10. Prospecting Pipeline

**File:** `prospecting-pipeline.ts`

One-shot pipeline for a single run: search → score → (optionally) connect → (optionally) DM.
No persistent state — results returned in API response.

### Pipeline Steps
```
1. searchPeople(config.search)
2. For each result (up to maxProspects):
   a. extractProfile(profileUrl)          ← full profile scrape
   b. scoreProfile(...)                   ← compute LeadScore
   c. if score < minScore → skip
   d. if connection.sendRequest:
      sendConnectionRequest(...)          ← rate-limited
   e. if dm.enabled AND 1st-degree:
      sendMessageToProfile(url, template) ← rate-limited
3. Return PipelineResult
```

### `ProspectingConfig`
```typescript
{
  search: Partial<PeopleSearchConfig>;
  scoring: {
    targetTitles: string[];
    targetCompanies: string[];
    targetLocations: string[];
    minScore: number;
  };
  connection: {
    sendRequest: boolean;
    noteTemplate: string;     // supports {firstName}, {headline}
    skipIfConnected: boolean;
    skipIfPending: boolean;
  };
  dm: {
    enabled: boolean;
    messageTemplate: string;  // supports {firstName}, {headline}
    onlyIfConnected: boolean;
  };
  maxProspects: number;
  dryRun: boolean;
  delayBetweenActions: number; // ms between actions
}
```

### `PipelineResult`
```typescript
{
  id: string;
  startedAt: string;
  completedAt: string;
  summary: {
    searched, extracted, scored, qualified,
    connectionsSent, messagesSent, skipped, errors
  };
  prospects: ProspectResult[];  // full detail per prospect
}
```

---

## 11. Outreach Engine (Campaigns)

**File:** `outreach-engine.ts`

Full prospect lifecycle management with **persistent JSON state** stored in `~/.linkedin-outreach/`.

### State Files
```
~/.linkedin-outreach/
  prospects.json   ← all prospects across all campaigns
  campaigns.json   ← campaign definitions
  runs.json        ← last 100 run results
```

### Prospect Lifecycle Stages
```
discovered
  → connection_sent
    → connected
      → first_dm_sent
        → replied ───────────────── → converted
        → follow_up_1               → opted_out
          → follow_up_2             → cold
            → follow_up_3
              → cold (giveUpAfterHours)
```

### `OutreachCampaign` Fields
```typescript
{
  id: string;                  // "camp_{ts}_{rand}"
  name: string;
  offer: string;               // substituted as {offer} in templates
  search: Partial<PeopleSearchConfig>;
  scoring: { targetTitles, targetCompanies, targetLocations, minScore };
  templates: {
    connectionNote: string;    // max 300 chars
    firstDm: string;
    followUp1: string;
    followUp2: string;
    followUp3: string;
  };
  timing: {
    afterConnectedHours: 2;    // hours to wait after connected before first DM
    followUp1Hours: 72;        // 3 days
    followUp2Hours: 168;       // 7 days
    followUp3Hours: 336;       // 14 days
    giveUpAfterHours: 504;     // 21 days
  };
  maxProspectsPerRun: number;
  active: boolean;
  createdAt: string;
}
```

### Template Variables
| Variable | Value |
|----------|-------|
| `{firstName}` | First word of `prospect.name` |
| `{name}` | Full `prospect.name` |
| `{headline}` | `prospect.headline` |
| `{location}` | `prospect.location` |
| `{offer}` | `campaign.offer` |

### `runOutreachCycle(campaignId, opts)`
```
Step 1 — DISCOVER (skip if opts.skipDiscovery):
  searchPeople(campaign.search) → new prospects not yet in list
  scoreProfile() for each → skip if below minScore
  Add to prospects.json as 'discovered'

Step 2 — SEND CONNECTIONS (up to maxProspectsPerRun):
  Prospects in 'discovered' stage
  sendConnectionRequest(url, note: render(templates.connectionNote))
  → stage: 'connection_sent'

Step 3 — DETECT REPLIES:
  For prospects in 'first_dm_sent', 'follow_up_1/2/3'
  listConversations() → scan for their name
  If found unread/recent reply → stage: 'replied'

Step 4 — SEND FIRST DM (skip if opts.skipFollowUps):
  Prospects in 'connected' stage AND hoursAgo(connectedAt) > afterConnectedHours
  sendMessageToProfile(url, render(templates.firstDm))
  → stage: 'first_dm_sent'

Step 5 — FOLLOW-UPS:
  followUp1: stage='first_dm_sent' AND no reply AND hoursAgo > followUp1Hours
  followUp2: stage='follow_up_1' AND hoursAgo > followUp2Hours
  followUp3: stage='follow_up_2' AND hoursAgo > followUp3Hours
  cold: hoursAgo > giveUpAfterHours

Save run to runs.json. Return OutreachRunResult.
```

### `OutreachStats`
```typescript
{
  total: number;
  byStage: Record<string, number>;
  connectionsSent: number;
  connectionsAccepted: number;
  dmsSent: number;
  replies: number;
  conversions: number;
  responseRate: number;       // replies / dmsSent × 100
  conversionRate: number;     // conversions / connectionsSent × 100
}
```

---

## 12. AI Message Generation

**File:** `server.ts`

Requires `OPENAI_API_KEY` env var. Model: `gpt-4o`.  
Falls back to template-based message if key is missing.

```bash
POST /api/linkedin/ai/generate-message
{
  "profile": { "name": "...", "headline": "...", "location": "...", "about": "..." },
  "purpose": "outreach | follow_up | connection_note",
  "tone": "professional | casual | friendly",
  "context": "Optional extra context"
}
```

**Prompt structure:** instructs GPT-4o to write a personalized LinkedIn message using profile data, purpose, tone, and context. Returns `{ message, characterCount }`.

---

## 13. All API Endpoints

### Health & Status
| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Service health, port, platform |
| GET | `/api/linkedin/status` | Current URL, login state, session info |

### Navigation
| Method | Path | Body | Description |
|--------|------|------|-------------|
| POST | `/api/linkedin/navigate/network` | — | Go to My Network |
| POST | `/api/linkedin/navigate/messaging` | — | Go to Messaging |
| POST | `/api/linkedin/navigate/profile` | `{profileUrl}` | Go to a profile |

### Profile
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/linkedin/profile/extract-current` | Extract profile from current page (**define before /:username**) |
| GET | `/api/linkedin/profile/:username` | Navigate to + extract profile |
| POST | `/api/linkedin/profile/score` | `{profile, targetTitles?, targetCompanies?, targetLocations?}` |

### Connections
| Method | Path | Body/Query | Description |
|--------|------|------|-------------|
| GET | `/api/linkedin/connections/status` | `?profileUrl=` | Check connection status |
| POST | `/api/linkedin/connections/request` | `{profileUrl, note?, skipIfConnected?, skipIfPending?, force?}` | Send connection request ([§8](#8-connections)) |
| GET | `/api/linkedin/connections/pending` | `?type=received\|sent` | List pending requests |
| POST | `/api/linkedin/connections/accept` | `{profileUrl}` | Accept a pending request |

### Search
| Method | Path | Body | Description |
|--------|------|------|-------------|
| POST | `/api/linkedin/search/people` | `{keywords[], title?, company?, location?}` | Search people (10 results/page) |
| GET | `/api/linkedin/search/extract-current` | — | Extract results from current search page |

### Messages
| Method | Path | Body/Query | Description |
|--------|------|------|-------------|
| GET | `/api/linkedin/conversations` | — | Navigate to messaging + list conversations |
| GET | `/api/linkedin/messages` | `?limit=20` | Read messages from open conversation |
| GET | `/api/linkedin/messages/unread` | — | Get unread count |
| POST | `/api/linkedin/messages/open` | `{participantName}` | Open a conversation |
| POST | `/api/linkedin/messages/send` | `{text}` | Send in current open conversation |
| POST | `/api/linkedin/messages/send-to` | `{profileUrl, text}` | Navigate to profile + send message |

### AI
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/linkedin/ai/generate-message` | `{profile, purpose, tone?, context?}` |

### Rate Limits
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/linkedin/rate-limits` | Get config + daily counters |
| PUT | `/api/linkedin/rate-limits` | Update config (all fields optional) |

### Prospecting Pipeline (one-shot)
| Method | Path | Body | Description |
|--------|------|------|-------------|
| POST | `/api/linkedin/prospect/search-score` | `{search, targetTitles?, targetCompanies?, targetLocations?}` | Search + score, sorted by score |
| POST | `/api/linkedin/prospect/pipeline` | `ProspectingConfig` | Full search→score→connect→DM run |

### Outreach Engine (Campaigns)
| Method | Path | Body/Query | Description |
|--------|------|------|-------------|
| POST | `/api/linkedin/outreach/campaigns` | `{name, offer, search, ...}` | Create campaign |
| GET | `/api/linkedin/outreach/campaigns` | — | List all campaigns |
| GET | `/api/linkedin/outreach/campaigns/:id` | — | Get single campaign |
| GET | `/api/linkedin/outreach/prospects` | `?campaign=&stage=&minScore=` | List prospects with filters |
| GET | `/api/linkedin/outreach/stats` | `?campaign=` | Get outreach stats |
| GET | `/api/linkedin/outreach/runs` | `?limit=10` | Recent run results |
| POST | `/api/linkedin/outreach/run` | `{campaignId, dryRun?, skipDiscovery?, skipFollowUps?}` | Execute outreach cycle |
| POST | `/api/linkedin/outreach/prospects/:id/convert` | `{notes?}` | Mark prospect as converted |
| POST | `/api/linkedin/outreach/prospects/:id/opt-out` | — | Mark as opted out |
| POST | `/api/linkedin/outreach/prospects/:id/note` | `{note}` | Add note to prospect |
| POST | `/api/linkedin/outreach/prospects/:id/tag` | `{tag}` | Tag a prospect |

### Debug
| Method | Path | Body | Description |
|--------|------|------|-------------|
| POST | `/api/linkedin/debug/js` | `{js}` | Execute raw JS in Safari |

---

## 14. Selectors Reference

### Profile Page (`linkedin.com/in/{username}`)

| Element | Selector |
|---------|----------|
| Profile name | `h1.text-heading-xlarge`, `h1[class*="break-words"]` — **or innerText parse** |
| Headline | `.text-body-medium[data-generated-suggestion-target]` — **or innerText parse** |
| Location | `span.text-body-small[class*="inline"]` — **or innerText parse** |
| About section | `#about ~ div .inline-show-more-text` — **or innerText parse** |
| Connect button (legacy) | `button[aria-label*="Connect"]` |
| Connect anchor (Feb 2026) | `a[aria-label*="Invite"][href*="custom-invite"]` |
| Message button (legacy) | `button[aria-label*="Message"]` |
| Message anchor (Feb 2026) | `a[href*="/messaging/compose/"]` |
| More button | `button[aria-label="More"]` (always a button) |
| Pending button | `button[aria-label*="Pending"]` |
| Follow button | `button[aria-label*="Follow"]` (check `!includes('unfollow')`) |

### Custom-Invite Page (`linkedin.com/preload/custom-invite/?vanityName={name}`)

> **This is where the note form lives.** Navigate here directly to add a note to a connection request. A JS `.click()` on the profile Connect anchor sends the invite immediately (no modal).

| Element | Selector | Notes |
|---------|----------|-------|
| "Add a note" button | `button` with `innerText === 'Add a note'` | Reveals textarea when clicked |
| "Send without a note" button | `button` with `innerText === 'Send without a note'` | Sends invite immediately |
| Note textarea | `textarea#custom-message`, `textarea[name="message"]` | Hidden until "Add a note" is clicked; class `ember-text-area` |
| Send button | `button` with `innerText === 'Send'` | Disabled until textarea has content |
| reCAPTCHA textarea | `textarea#g-recaptcha-response-*` | Hidden; ignore this — it's NOT the note field |

**Typing into the textarea:**
```javascript
// JS value + input event works with Ember textarea (no clipboard needed)
var ta = document.querySelector('textarea#custom-message');
ta.focus();
ta.value = 'Your note here';
ta.dispatchEvent(new Event('input', { bubbles: true }));
ta.dispatchEvent(new Event('change', { bubbles: true }));
// Send button becomes enabled after this
```

### Messaging Page (`linkedin.com/messaging/`)

| Element | Selector | Notes |
|---------|----------|-------|
| Conversation list | `.msg-conversations-container__conversations-list` | |
| Conversation item | `.msg-conversation-listitem` | Has real getBoundingClientRect dims |
| Item name | `.msg-conversation-listitem__participant-names`, `.msg-conversation-card__participant-names` | |
| Item snippet | `.msg-conversation-card__message-snippet` | NOT `__listitem__message-snippet` |
| Item time | `.msg-conversation-listitem__time-stamp`, `time` | |
| Unread class | `.msg-conversation-listitem--unread` | |
| Thread person | `.msg-entity-lockup__entity-title` | |
| Message event | `.msg-s-message-list__event` | Parent LI — use ONLY this |
| Message body | `.msg-s-event-listitem__body` | |
| Sender | `.msg-s-message-group__name` | |
| Message timestamp | `time`, `.msg-s-message-group__timestamp` | |
| Message input | `.msg-form__contenteditable` | div role="textbox" contenteditable |
| Send button | `.msg-form__send-button` | |
| Nav unread badge | `a[href*="/messaging/"] .notification-badge__count` | |

### My Network (`linkedin.com/mynetwork/`)

| Element | Selector |
|---------|----------|
| Invitation cards | `.invitation-card`, `.mn-invitation-list li` |
| Card title | `.invitation-card__title` |
| Card headline | `.invitation-card__subtitle` |
| Profile link | `a[href*="/in/"]` |
| Accept button | `button[aria-label*="Accept"]` |
| Ignore button | `button[aria-label*="Ignore"]` |

### Search Page (`linkedin.com/search/results/people/`)

| Element | Selector |
|---------|----------|
| Result items | `main li` (containing `a[href*="/in/"]`) |
| Username link | `a[href*="/in/"]` (non-ACoAA) |
| Name | `span[aria-hidden="true"]` (filtered) |
| Degree | spans containing "1st"/"2nd"/"3rd" |
| Headline/Location | leaf `div` elements (no children) |

---

## 15. Rate Limits

### Default Config (`DEFAULT_RATE_LIMITS`)
| Limit | Default | Notes |
|-------|---------|-------|
| `connectionRequestsPerDay` | 20 | LinkedIn soft-ban risk if exceeded |
| `connectionRequestsPerWeek` | 80 | Weekly tracking |
| `messagesPerHour` | 10 | Per-hour cap |
| `messagesPerDay` | 50 | Daily cap |
| `profileViewsPerHour` | 30 | Informational — not enforced in code |
| `searchesPerHour` | 15 | Checked via `checkHourlyLimit()` |
| `minDelayMs` | 30000 (30s) | Min between actions |
| `maxDelayMs` | 120000 (2min) | Max between actions |
| `activeHoursStart` | 8 | 8:00 AM |
| `activeHoursEnd` | 18 | 6:00 PM |

### Enforcement in Server
- `connectionsToday` / `messagesToday` counters in-memory, reset each day at midnight
- `checkHourlyLimit()` — blocks search/extraction if over `searchesPerHour`
- `isWithinActiveHours()` — `POST /api/linkedin/prospect/pipeline` returns 403 outside hours (override with `force: true`)
- `humanDelay(minDelayMs, maxDelayMs)` called between actions in pipeline/outreach cycles

**Update via API (no restart needed):**
```bash
PUT /api/linkedin/rate-limits
{ "connectionRequestsPerDay": 10, "activeHoursStart": 9 }
```

---

## 16. Startup & Prerequisites

```bash
# From project root
PORT=3105 npx tsx packages/linkedin-automation/src/api/server.ts

# Or with AI support
OPENAI_API_KEY=sk-... PORT=3105 npx tsx packages/linkedin-automation/src/api/server.ts
```

### Prerequisites
- Safari open and logged in to LinkedIn
- Node.js 18+, `npx tsx` available
- Quartz for OS-level clicks: `pip3 install pyobjc-framework-Quartz`
- `OPENAI_API_KEY` — optional, enables `POST /api/linkedin/ai/generate-message`

### Verify Running
```bash
curl http://localhost:3105/health
# → {"status":"ok","platform":"linkedin","port":3105}

curl http://localhost:3105/api/linkedin/status
# → {"isOnLinkedIn":true,"isLoggedIn":true,"currentUrl":"..."}
```

### Test Suite
```bash
npx tsx packages/linkedin-automation/src/__tests__/selectors.test.ts
# → 18/18 passing
```

---

## 17. Debugging Playbook

```bash
BASE=http://localhost:3105

# 1. Check service is alive
curl $BASE/health

# 2. Check login status
curl $BASE/api/linkedin/status

# 3. Try a profile extraction
curl "$BASE/api/linkedin/profile/williamhgates"

# 4. Run a people search
curl -X POST $BASE/api/linkedin/search/people \
  -H "Content-Type: application/json" \
  -d '{"keywords":["software engineer"],"title":"CTO"}'

# 5. Check if on messaging page + list conversations
curl $BASE/api/linkedin/conversations

# 6. Execute raw JS to probe DOM
curl -X POST $BASE/api/linkedin/debug/js \
  -H "Content-Type: application/json" \
  -d '{"js":"document.querySelectorAll(\".msg-conversation-listitem\").length.toString()"}'

# 7. Check rate limit state
curl $BASE/api/linkedin/rate-limits
```

---

## 18. Known Failure Modes & Fixes

| Symptom | Root Cause | Fix |
|---------|-----------|-----|
| Profile returns `{}` / empty name | LinkedIn changed class names; innerText parse still works | Verify main has > 2 h2 elements; increase poll timeout |
| Connect click does nothing | LinkedIn renders `<a>` not `<button>` for Connect | Code handles both — ensure status check returns `can_connect_direct` |
| False positive: sends Connect to already-pending profile | SPA race — Connect anchor shows for 1–3s before Pending button renders | `waitForCondition` polls 5s for Pending after detecting Connect (Quirk 7) |
| Note not attached to invitation | JS `.click()` on Connect anchor bypasses "Add a note?" modal entirely | Navigate to `/preload/custom-invite/?vanityName={name}` instead (Quirk 6) |
| Custom-invite page blank / no "Add a note" button | Slow load or LinkedIn changed the page | Falls back to "Send without a note" button; if that's also missing, JS-clicks Connect anchor directly |
| `conversations: []` | Not on messaging page, or conversation list not loaded | `POST /api/linkedin/navigate/messaging` first; wait 3s |
| `openConversation` → thread doesn't switch | Ember.js ignores JS .click() | `clickAtViewportPosition()` uses Quartz — ensure pyobjc installed |
| Message sends but `verified: false` | DM sent to InMail / Sponsored thread (no `.msg-form`) | Only 1st-degree connections have real message forms |
| Search returns 0 results | Login wall, or `main` not yet rendered | Manually confirm logged in; increase wait before extraction |
| Outside active hours 403 | `isWithinActiveHours()` check | Pass `"force": true` in body, or update `activeHoursStart/End` |
| `typeViaClipboard` types wrong text | Race condition between pbcopy and ⌘V | Already has 300ms delay; increase if on slow machine |
| Pipeline sends to wrong person | `skipIfConnected: false` → re-sends to 1st degree | Always use `skipIfConnected: true` in production |
| `Cannot find module` on startup | TypeScript ES module path issue | Use `npx tsx` not `ts-node` |

---

## Cross-References

- `docs/UPWORK_LINKEDIN_AUTOMATION.md` — Combined Upwork + LinkedIn overview
- `docs/PRDs/PRD_LINKEDIN_DM_AUTOMATION.md` — Original PRD
- `docs/LINKEDIN_AUTOMATION.md` — Legacy quick reference
- `docs/SAFARI_AUTOMATIONS_INVENTORY.md` — All platform services catalog
- `packages/linkedin-automation/src/automation/types.ts` — Ground-truth types + selectors + rate limits
