# Instagram Automation — Complete Reference

**Last updated:** 2026-02-27 · **Status:** ✅ Production-verified  
**Ports:** 3100 (DM) · 3005 (Comments/Research)  
**Packages:** `packages/instagram-dm/` · `packages/instagram-comments/`

---

## Table of Contents

1. [Service Overview](#1-service-overview)
2. [Architecture — How It Works](#2-architecture--how-it-works)
3. [Instagram DOM Quirks (Critical)](#3-instagram-dom-quirks-critical)
4. [Package: instagram-dm (Port 3100)](#4-package-instagram-dm-port-3100)
   - [SafariDriver](#41-safaridriver)
   - [listConversations — 3-Strategy Extraction](#42-listconversations--3-strategy-extraction)
   - [DM Send Methods](#43-dm-send-methods)
   - [Thread Cache](#44-thread-cache)
   - [getAllConversations](#45-getallconversations)
   - [scrollAndListAllConversations](#46-scrollandlistallconversations)
   - [readAllMessages](#47-readallmessages)
   - [enrichContact](#48-enrichcontact)
   - [CRM Integration](#49-crm-integration)
5. [Package: instagram-comments (Port 3005)](#5-package-instagram-comments-port-3005)
   - [InstagramDriver](#51-instagramdriver)
   - [postComment — 6-Step Flow](#52-postcomment--6-step-flow)
   - [Multi-Post Engagement Engine](#53-multi-post-engagement-engine)
   - [AI Comment Generator](#54-ai-comment-generator)
   - [InstagramResearcher](#55-instagramresearcher)
6. [All API Endpoints — DM Service (3100)](#6-all-api-endpoints--dm-service-3100)
7. [All API Endpoints — Comments Service (3005)](#7-all-api-endpoints--comments-service-3005)
8. [Selectors Reference](#8-selectors-reference)
9. [Rate Limits](#9-rate-limits)
10. [Startup & Prerequisites](#10-startup--prerequisites)
11. [Debugging Playbook](#11-debugging-playbook)
12. [Known Failure Modes & Fixes](#12-known-failure-modes--fixes)

---

## 1. Service Overview

Two separate Express API services, each driving Instagram via Safari + AppleScript. No private API, no credentials stored — requires a logged-in Safari tab.

### Package Structure

```
packages/instagram-dm/src/
  api/
    server.ts          ← Express routes, rate-limit counters, AI DM generation
    client.ts          ← HTTP client for inter-service calls
  automation/
    safari-driver.ts   ← SafariDriver (session management, JS execution, input)
    dm-operations.ts   ← DM: list/open/read/send conversations, enrichContact
    types.ts           ← All types + rate limit defaults
    index.ts           ← Re-exports
  utils/
    dm-logger.ts       ← SQLite DM logging
    scoring-service.ts ← Contact scoring
    template-engine.ts ← Outreach templates + 3:1 rule enforcement

packages/instagram-comments/src/
  api/
    server.ts          ← Express routes for comments, multi-post engagement, research
  automation/
    instagram-driver.ts    ← InstagramDriver (post nav, comment posting, rate limits)
    ai-comment-generator.ts← AI analysis + GPT-4o comment generation
    instagram-researcher.ts← Market research: hashtag scraping, creator ranking
    safari-driver.ts       ← Shared SafariDriver base
  db/
    comment-logger.ts  ← SQLite comment session logging + duplicate tracking
```

---

## 2. Architecture — How It Works

```
API Request (HTTP)
        │
        ├─→ Port 3100: Instagram DM Server
        │       │
        │       ▼
        │   dm-operations.ts
        │       │
        │       ▼
        │   SafariDriver (instagram-dm)
        │       ├── executeJS()         ← temp .js file → osascript → Safari tab
        │       ├── navigateTo()        ← osascript set URL
        │       ├── typeViaKeystrokes() ← System Events keystroke
        │       ├── typeViaClipboard()  ← pbcopy + ⌘V
        │       ├── pressEnter()        ← System Events keystroke return
        │       └── ensureActiveSession()← self-healing tab lock (5s TTL)
        │
        └─→ Port 3005: Instagram Comments Server
                │
                ▼
            InstagramDriver
                │
                ├── executeJS()          ← temp .scpt file → osascript
                ├── navigate()           ← osascript set URL of current tab
                ├── typeViaClipboard()   ← printf + pbcopy + ⌘V
                └── postComment()        ← 6-step flow with 3 typing strategies

                InstagramResearcher
                └── executeJS()          ← same temp-file pattern
```

### JavaScript Execution
Both packages write JS to a temp file and run it via `osascript "${tmpFile}"`. This avoids AppleScript inline string-quoting limits on large scripts.

```
/tmp/safari-js-{ts}-{rand}.js      ← instagram-dm SafariDriver
/tmp/safari_ig_{ts}_{rand}.scpt    ← instagram-comments InstagramDriver/Researcher
```

### Session Management (DM service)
`ensureActiveSession('instagram.com')` self-heals:
1. **Fast path** (TTL 5s): verify tracked tab URL still contains `instagram.com` → reuse
2. **URL drift**: tab navigated away → invalidate → full scan
3. **Full scan**: loop all Safari windows/tabs for `instagram.com`
4. **Not found**: navigate front document to Instagram, re-scan

---

## 3. Instagram DOM Quirks (Critical)

### Quirk 1 — Conversation list changed in 2025+
Instagram removed `a[href*="/direct/t/"]` links from the inbox. The 2025 DOM uses `[aria-label="Thread list"]` containing DIV rows (~72px tall) with leaf `span` elements. Three strategies are used in cascade (see section 4.2).

### Quirk 2 — Message input is `contenteditable div`, not `textarea`
The DM thread input is `div[contenteditable="true"][role="textbox"]`. Raw `innerHTML` assignment doesn't trigger React events. Must use OS-level **keystrokes** (`System Events keystroke`) to type. Clipboard paste (`pbcopy + ⌘V`) is the fallback.

### Quirk 3 — Comment input IS a `<textarea>` but React-controlled
`textarea[aria-label="Add a comment…"]` exists but React overrides `.value =`. Three typing strategies are tried in order:
1. `document.execCommand('insertText')` — fastest
2. `pbcopy` + ⌘V clipboard paste
3. Native setter: `Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, text)` + `dispatchEvent('input')`

### Quirk 4 — Thread tabs removed; each section has its own URL
`[role="tab"]` elements for Primary/General/Requests no longer exist. Each inbox section is a **separate URL**:
```
Primary:         https://www.instagram.com/direct/inbox/
General:         https://www.instagram.com/direct/general/
Requests:        https://www.instagram.com/direct/requests/
Hidden Requests: https://www.instagram.com/direct/requests/hidden/
```

### Quirk 5 — Thread ID extraction is the reliable DM path
When the URL is `/direct/t/{threadId}`, the threadId is captured and cached. Future DMs to the same user navigate directly to `instagram.com/direct/t/{id}` — the most reliable send path.

### Quirk 6 — Outbound detection by visual position
Message elements have no reliable CSS class for sent vs received. Outbound is detected by `getBoundingClientRect().left > window.innerWidth / 2` (right-side = sent by you).

### Quirk 7 — Profile stats live in `<meta name="description">`
Follower/following/post counts are embedded in the meta description tag (e.g., `"12.5K Followers, 500 Following, 87 Posts — See..."`) rather than in visible DOM elements with stable selectors. Extraction uses regex on `meta[name="description"][content]`.

---

## 4. Package: instagram-dm (Port 3100)

### 4.1 SafariDriver

**File:** `packages/instagram-dm/src/automation/safari-driver.ts`

Same architecture as LinkedIn/TikTok SafariDriver. Key methods:

| Method | Description |
|--------|-------------|
| `executeJS(js)` | Write to temp file → osascript → Safari tab |
| `navigateTo(url)` | `set URL of tab N of window M` or front document |
| `getCurrentUrl()` | `get URL of front document` |
| `isLoggedIn()` | Checks for `input[name="username"]` in DOM |
| `isOnInstagram()` | Checks if URL includes `instagram.com` |
| `wait(ms)` | Promise sleep |
| `humanDelay(minMs, maxMs)` | Random anti-detection delay |
| `waitForElement(sel, maxMs)` | Poll until selector found |
| `typeViaKeystrokes(text)` | System Events `keystroke` — for DM input |
| `typeViaClipboard(text)` | `pbcopy` + ⌘V — Unicode-safe |
| `pressEnter()` | System Events `keystroke return` |
| `focusElement(sel)` | JS `.focus()` + `.click()` |
| `clickElement(sel)` | JS `.click()` |
| `activateSafari()` | Bring Safari to foreground |
| `activateTab(w, t)` | Focus specific window+tab |
| `findTabByUrl(pattern)` | Scan all windows for URL pattern |
| `ensureActiveSession(pattern)` | Self-healing session lock |
| `clearTrackedSession()` | Reset tracked window/tab |
| `getSessionInfo()` | Return tracked w/t/pattern/lastVerified |

### 4.2 listConversations — 3-Strategy Extraction

```typescript
listConversations(driver?) → DMConversation[]  // up to 50
```

The function tries three strategies in cascade, returning on first success:

**Strategy 1 — Thread links (classic DOM, pre-2025):**
```
querySelectorAll('a[href*="/direct/t/"]')
  → extract threadId from href regex /\/direct\/t\/([0-9]+)/
  → extract username from img[alt*="profile picture"].alt
     (strip "'s profile picture")
  → extract lastMessage from last span with 5 < text.length < 200
```

**Strategy 2 — Profile pictures fallback:**
```
querySelectorAll('img[alt*="profile picture"]')
  → username from .alt
  → threadId from closest a[href*="/direct/t/"]
```

**Strategy 3 — 2025+ Thread list DOM:**
```
[aria-label="Thread list"] → querySelectorAll('span')
For each leaf span (no children, 1 < text.length < 80):
  Walk up to 10 ancestors to find container with getBoundingClientRect:
    height > 65 && height < 90 && width > 300  ← row height ~72px
  Group spans by Math.round(rect.top) as rowKey
Sort rowKeys ascending → texts[0] = username, texts[last] = lastMessage
Skip "Hidden requests" header row
```

**`DMConversation` Fields:**
```typescript
{
  username: string;
  threadId?: string;      // from /direct/t/{id} link if available
  displayName?: string;
  profilePicUrl?: string;
  lastMessage?: string;   // up to 100 chars
  lastMessageAt?: string;
  unreadCount?: number;
  isVerified?: boolean;
}
```

### 4.3 DM Send Methods

Three send methods, ordered by reliability:

#### Method 1: `sendDMToThread(threadId, message)` — most reliable
```
Navigate to https://www.instagram.com/direct/t/{threadId}
wait 3s
Verify URL contains /direct/t/ (check for login wall)
waitForElement('div[contenteditable="true"][role="textbox"]', 5000)
  → fallback: 'textarea[placeholder*="Message"]'
Capture recipient from profile pic alt in header (y < 80px)
sendMessage(message)         ← OS-level keystrokes + Enter
wait 2s
Verify: document.body.innerText.includes(text.substring(0,30))
Return { success, verified, verifiedRecipient }
```

#### Method 2: `sendDMFromProfile(username, message)` — reliable for any user
```
Navigate to https://www.instagram.com/{username}/
wait 3s
Check profile loaded: body.innerText.includes("Sorry, this page") → not_found
Scan div[role="button"], button for text === 'Message'
  → no Message button → 'no_message_btn' (may need to follow first)
Click Message button
wait 3s
waitForElement(contenteditable + textarea fallback, 5s)
captureThreadId() from URL → registerThread(username, id)  ← auto-cache
sendMessage(message)
Verify + Return { success, verified, verifiedRecipient: username }
```

#### Method 3: `smartSendDM(username, message)` — recommended entry point
```
Check threadCache for username
  → found: sendDMToThread(cachedId)  → method: 'thread-url'
    (if that fails, fall through)
  → not found: sendDMFromProfile()   → method: 'profile-to-dm'
Return { ...result, method }
```

#### Low-level: `sendMessage(text)` — core send, requires open conversation
```
Try selectors one at a time (comma-joined selectors break AppleScript):
  'div[contenteditable="true"][role="textbox"]'
  'textarea[placeholder*="Message"]'
  '[aria-label*="Message"]'
focusElement(sel)
wait 500ms
typeViaKeystrokes(text)   ← OS-level keystrokes
wait 500ms
pressEnter()              ← OS-level enter
wait 1000ms
Return { success: true }
```

#### `startNewConversation(username)` — new message dialog flow
```
JS click: [aria-label*="New message"] or svg[aria-label*="New message"] closest button
wait 1.5s
focusElement('input[placeholder*="Search"], input[name="queryBox"]')
typeViaKeystrokes(username)
wait 2s
JS: scan div[role="button"], div[role="listitem"] for text includes username → click
wait 1s
JS: scan buttons for text "next" or "chat" → click
wait 1.5s
```

### 4.4 Thread Cache

In-memory `Map<string, string>` from `username.toLowerCase()` → `threadId`.

```typescript
registerThread(username, threadId)   // set
getThreadId(username)                // lookup
getAllThreads()                      // → Record<string, string>
```

Auto-populated by `sendDMFromProfile` when a thread URL is detected after opening the DM composer. Also manually managed via `/api/threads/register`.

**Known cached threads:**
- `saraheashley` → `110178857046022`

### 4.5 getAllConversations

```typescript
getAllConversations(driver?) → Record<DMTab, DMConversation[]>
```

Navigates to each inbox section URL separately (2025 fix — tabs removed):
```
for tab in ['primary', 'general', 'requests', 'hidden_requests']:
  navigateTo(TAB_URLS[tab])   ← direct URL navigation
  wait 3s
  scrollAndListAllConversations(driver, maxScrolls=20)
```

### 4.6 scrollAndListAllConversations

Scroll-until-stable mechanism for the conversation list:
```
for i in 0..maxScrolls (default 30):
  JS: scroll [aria-label="Thread list"] or div[role="list"] down +800px
  wait 1200ms
  JS count: a[href*="/direct/t/"].length OR 
             [aria-label="Thread list"] span count
  if count === prevCount: stableRounds++
    if stableRounds >= 2: break  ← at the bottom
  else: stableRounds = 0
  prevCount = count
call listConversations()
```

### 4.7 readAllMessages

Scroll-up-until-stable to load full history:
```
for i in 0..maxScrolls (default 20):
  JS: scroll [role="main"] [class*="messages"] pane up -1200px
  wait 1000ms
  count = div[role="row"], div[class*="message"] length
  stable × 2 → break
readMessages(9999)
```

`readMessages(limit)` extraction:
```
querySelectorAll('div[role="row"], div[class*="message"]')
For each el:
  text = el.innerText (200B to 2000B)
  isOutbound = getBoundingClientRect().left > window.innerWidth / 2
  messageType = 'text'
Return last {limit} messages
```

### 4.8 enrichContact

Navigates to `instagram.com/{username}/` and extracts profile data:
```typescript
enrichContact(username) → {
  fullName: string;     // from h1, h2, [class*="FullName"]
  bio: string;          // from [class*="_aa_c"], [class*="bio"]
  followers: string;    // from meta[name="description"] regex
  following: string;    // from meta description regex
  posts: string;        // from meta description regex
  isPrivate: boolean;   // "This account is private" in bodyText
}
```
Uses `meta[name="description"]` content, e.g.: `"12.5K Followers, 500 Following, 87 Posts - See Instagram..."`.

### 4.9 CRM Integration

The DM server wires into three utility services (all SQLite-backed):

**`dm-logger`** — logs every message sent, tracks conversation history  
**`scoring-service`** — scores contacts 0-100 based on engagement signals  
**`template-engine`** — manages outreach templates, 3:1 value-to-pitch rule, next-best-action

These are initialized at server startup:
```typescript
initDMLogger();
initScoringService();
initTemplateEngine();
```

---

## 5. Package: instagram-comments (Port 3005)

### 5.1 InstagramDriver

**File:** `packages/instagram-comments/src/automation/instagram-driver.ts`

Standalone class (not inheriting the DM SafariDriver). Manages comment rate limits internally via `commentLog: { timestamp: Date }[]`.

**Config defaults (`DEFAULT_CONFIG`):**
```typescript
{
  timeout: 30000,
  minDelayMs: 120000,   // 2 minutes between actions
  maxDelayMs: 300000,   // 5 minutes max
  commentsPerHour: 5,
  commentsPerDay: 15,
}
```

**Key methods:**
| Method | Description |
|--------|-------------|
| `getStatus()` | URL, login state from Safari |
| `navigateToPost(url)` | Navigate Safari to post URL |
| `getPostDetails()` | Extract username, caption, timestamp from `article` |
| `getComments(limit)` | Scrape `article ul li` for comment text/username |
| `getCommentsDetailed(limit)` | Enhanced comment scrape with more context |
| `getCaptionDetailed()` | Caption + extracted hashtags array |
| `postComment(text)` | Full 6-step flow with 3 typing strategies |
| `findPosts(limit)` | Find posts on current page via `a[href*="/p/"]` |
| `likePost()` | Click `svg[aria-label="Like"]` closest button |
| `clickBack()` | Browser back navigation |
| `scroll()` | `window.scrollBy(0, window.innerHeight)` |
| `searchByKeyword(kw)` | Navigate to explore search + extract post URLs |
| `checkRateLimit()` | Returns `{ allowed, reason }` |
| `getRateLimits()` | Current hour/day counts + config |
| `setConfig(updates)` | Update rate limits live |

### 5.2 postComment — 6-Step Flow

```
Attempt up to 3 times (with backoff):

Pre-check:
  checkRateLimit()                  ← enforce hourly/daily caps
  Detect platform errors:
    "action blocked"  → hard fail
    "try again later" → retry
    "commenting has been turned off" → hard fail
    "comments on this post have been limited" → hard fail

Step 1: Click comment icon
  JS: svg[aria-label="Comment"] → closest button → .click()

Step 2: Smart wait for textarea (poll up to 10×400ms)
  Selectors tried:
    textarea[aria-label="Add a comment…"]
    textarea[placeholder="Add a comment…"]
    textarea[aria-label*="comment" i]
    textarea[placeholder*="comment" i]
    form textarea
  Checks el.offsetParent !== null (visible)

Step 3: Focus input
  JS: same selectors → el.focus() + el.click()

Step 4: Type text (3-strategy chain, stops at first success)
  Strategy 1: document.execCommand('insertText', false, text)
  Strategy 2: typeViaClipboard()    ← printf + pbcopy + ⌘V
  Strategy 3: HTMLTextAreaElement.prototype.value native setter
              + dispatchEvent('input') + dispatchEvent('change')

Step 5: Submit (up to 5 attempts × 600ms)
  Strategy 1: button[type="submit"] if not disabled
  Strategy 2: div[role="button"] or button with innerText === "post"
  Strategy 3: article form.dispatchEvent('submit')

Step 6: Verify (poll up to 6×1500ms)
  article span, ul li span, span[dir="auto"] text includes snippet
  OR textarea.value === '' (cleared after submit)

On failure: screencapture -x /tmp/instagram-post-failure-{ts}.png
Log timestamp to commentLog → feeds rate limit counter
```

### 5.3 Multi-Post Engagement Engine

**Endpoint:** `POST /api/instagram/engage/multi`  
**Orchestrates:** navigate feed → collect posts → like while collecting → comment on each

```
Input: { count=5, delayBetween=30000, useAI=true }

Step 0: Load commentedPostIds from database (STRICT DUPLICATE PREVENTION)

Step 1: Collect {count} post URLs from feed
  d.findPosts(count * 2) → filter out already-commented IDs
  While < count && scrollAttempts < 5:
    Like up to 3 posts while browsing (svg[aria-label="Like"])
    Scroll feed for more

Step 2: For each target post:
  navigateToPost(url)
  wait 3s
  getPostDetails()          ← username, caption
  getCommentsDetailed(10)   ← existing comments for context
  Check already-commented by ourUsername → skip
  ai.analyzePost({mainPost, username, replies})
  if analysis.isInappropriate → skip
  ai.generateComment(analysis) → text
  d.postComment(text)
  wait 2s → getComments(5) → verify snippet in DOM
  delayBetween ms before next post

Return: { successful, failed, duration, results[], logs[], database{} }
```

### 5.4 AI Comment Generator

**File:** `packages/instagram-comments/src/automation/ai-comment-generator.ts`

**`isInappropriateContent(text)`** — pre-screens posts before commenting:
- Blocked keywords: `onlyfans`, `link in bio`, `dm for more`, `nsfw`, `18+`, `crypto`, `giveaway`, etc.
- Blocked emoji combos: ≥2 of `🍑 🍆 🥵 💦 🔞 👅 💋 🤤`
- Very short text (< 10 chars after removing emojis) with attention phrases

**`analyzePost(context)` → `PostAnalysis`:**
```typescript
{
  mainPost: string;
  username: string;
  replies: string[];         // existing comments as "@user: text"
  hasImage: boolean;
  hasVideo: boolean;
  sentiment: 'positive' | 'negative' | 'neutral' | 'question';
  topics: string[];
  tone: string;
  engagement?: string;
  isInappropriate?: boolean;
  skipReason?: string;
}
```

**`generateComment(analysis)` → string:**
- With `OPENAI_API_KEY`: GPT-4o, system prompt instructs short, authentic, contextual comment
- Without key: falls back to template strings keyed by sentiment + topics

**Provider config:**
```typescript
{ provider: 'openai' | 'local', apiKey?: string }
```

### 5.5 InstagramResearcher

**File:** `packages/instagram-comments/src/automation/instagram-researcher.ts`

Full market research pipeline for Instagram. Two-pass approach:
- **Pass 1 (fast):** Collect post URLs from hashtag/explore grids via grid scraping
- **Pass 2 (detailed):** Open top N posts individually to extract engagement metrics

**`InstagramPost` Fields:**
```typescript
{
  id: string;               // shortcode from URL (/p/{shortcode}/)
  url: string;
  text: string;             // caption up to 500 chars
  author: string;           // username
  authorDisplayName: string;
  isVerified: boolean;
  likes: number;
  comments: number;
  engagementScore: number;  // likes + comments × 2
  hasVideo: boolean;
  hashtags: string[];
  mentions: string[];
  timestamp: string;
  niche: string;
  collectedAt: string;
}
```

**`InstagramCreator` Fields:**
```typescript
{
  handle: string;
  displayName: string;
  isVerified: boolean;
  postCount: number;
  totalLikes: number;
  totalComments: number;
  totalEngagement: number;
  avgEngagement: number;
  topPostUrl: string;
  topPostEngagement: number;
  niche: string;
}
```

**`researchNiche(niche)` full flow:**
```
buildSearchQueries(niche) → 5 hashtag variants:
  tag, {tag}tips, {tag}strategy, firstWord, {tag}community

For each query (until postsPerNiche reached):
  searchHashtag(query)          ← navigate to /explore/tags/{tag}/
  scrollAndCollect(niche, targetCount)
    while seen.size < targetCount && scrolls < maxScrollsPerSearch:
      extractPostUrls() → batch of {id, url, author, hasVideo}
      window.scrollBy(0, window.innerHeight * 2)
      wait scrollPauseMs (1800ms default)
      check for "Action Blocked" / "Rate Limit" → wait 60s
      noNew × 5 → stop early
  Deduplicate by shortcode

scrapeTopPostDetails(posts, detailedScrapeTop=50)
  Open each post individually → extract:
    author, displayName, likes, comments, hashtags, mentions, timestamp

rankCreators(posts, niche)
  Group by author → sum engagement → sort desc → top N

Save to ~/Documents/instagram-research/{niche}-{ts}.json
```

**Default config:**
```typescript
{
  postsPerNiche: 1000,
  creatorsPerNiche: 100,
  scrollPauseMs: 1800,
  maxScrollsPerSearch: 200,
  detailedScrapeTop: 50,
  timeout: 30000,
  outputDir: '~/Documents/instagram-research',
  maxRetries: 3,
}
```

---

## 6. All API Endpoints — DM Service (3100)

### Health & Status
| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | `{status:"ok", service:"instagram-dm", port:3100}` |
| GET | `/api/status` | isOnInstagram, isLoggedIn, currentUrl, driverConfig |

### Session Management
| Method | Path | Body | Description |
|--------|------|------|-------------|
| GET | `/api/session/status` | — | Tracked tab info (no activation) |
| POST | `/api/session/ensure` | — | Find + activate Instagram tab |
| POST | `/api/session/clear` | — | Reset tracked session |

### Inbox & Conversations
| Method | Path | Body/Query | Description |
|--------|------|------|-------------|
| POST | `/api/inbox/navigate` | — | Navigate to DM inbox |
| POST | `/api/inbox/tab` | `{tab}` | Switch to primary/general/requests/hidden_requests (legacy) |
| GET | `/api/conversations` | — | List conversations from current view |
| GET | `/api/conversations/all` | — | All 4 tabs via direct URL navigation |
| POST | `/api/conversations/open` | `{username}` | Click on a conversation |
| POST | `/api/conversations/new` | `{username}` | Start new conversation dialog |

### Messages
| Method | Path | Body/Query | Description |
|--------|------|------|-------------|
| GET | `/api/messages` | `?limit=20` | Read messages from current conversation |
| POST | `/api/messages/send` | `{text, username?}` | Send in current open conversation (rate-limited) |
| POST | `/api/messages/send-to` | `{username, text}` | Open conversation + send (rate-limited) |
| POST | `/api/messages/smart-send` | `{username, text}` | Thread URL → profile-to-DM (rate-limited) |
| POST | `/api/messages/send-from-profile` | `{username, text}` | Profile-to-DM flow (rate-limited) |
| POST | `/api/messages/send-to-thread` | `{threadId, text}` | Direct thread URL send (rate-limited) |

### Thread Cache
| Method | Path | Body | Description |
|--------|------|------|-------------|
| POST | `/api/threads/register` | `{username, threadId}` | Cache a thread ID |
| GET | `/api/threads` | — | All cached threads |
| GET | `/api/threads/:username` | — | Lookup thread for user |

### Rate Limits
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/rate-limits` | Current counters + config |
| PUT | `/api/rate-limits` | Update config (hot, no restart) |

### CRM
| Method | Path | Body | Description |
|--------|------|------|-------------|
| GET | `/api/crm/stats` | — | DM send/receive statistics |
| POST | `/api/crm/score` | `{contactId}` | Score a single contact |
| POST | `/api/crm/score-all` | — | Recalculate all contact scores |
| GET | `/api/crm/top-contacts` | `?limit=10` | Top scored contacts |

### Templates & Outreach
| Method | Path | Body/Query | Description |
|--------|------|------|-------------|
| GET | `/api/templates` | `?lane=&stage=` | Get templates filtered by lane/stage |
| POST | `/api/templates/next-action` | `{username, ...context}` | Next-best-action recommendation |
| POST | `/api/templates/fit-signals` | `{text}` | Detect fit signals in conversation text |
| GET | `/api/templates/rule-check/:contactId` | — | Check 3:1 value-to-pitch rule compliance |
| GET | `/api/outreach/pending` | `?limit=10` | Pending outreach actions |
| POST | `/api/outreach/queue` | `{contact_id, message, ...}` | Queue an outreach action |
| POST | `/api/outreach/:actionId/sent` | — | Mark action as sent |
| POST | `/api/outreach/:actionId/failed` | `{error}` | Mark action as failed |
| GET | `/api/outreach/stats` | — | Outreach stats |

### AI & Debug
| Method | Path | Body | Description |
|--------|------|------|-------------|
| POST | `/api/ai/generate` | `{username, purpose, topic?}` | GPT-4o Instagram DM generation |
| POST | `/api/execute` | `{script}` | Execute raw JS in Safari |
| PUT | `/api/config` | Partial `AutomationConfig` | Update driver config |

---

## 7. All API Endpoints — Comments Service (3005)

### Health & Status
| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | `{status:"ok", service:"instagram-comments"}` |
| GET | `/api/instagram/status` | isOnInstagram, isLoggedIn, commentsThisHour, commentsToday |

### Post Interaction
| Method | Path | Body | Description |
|--------|------|------|-------------|
| POST | `/api/instagram/navigate` | `{url}` | Navigate Safari to a post URL |
| GET | `/api/instagram/post` | — | Get current post details (username, caption, timestamp) |
| GET | `/api/instagram/comments` | `?limit=50` | Get comments from current post |
| POST | `/api/instagram/comments/post` | `{text, postUrl?}` | Post a comment (navigates if postUrl given) |
| POST | `/api/instagram/analyze` | — | Analyze current post + generate suggested comment |

### Multi-Post Engagement
| Method | Path | Body | Description |
|--------|------|------|-------------|
| POST | `/api/instagram/engage/multi` | `{count=5, delayBetween=30000, useAI=true}` | Multi-post engagement run on feed |
| POST | `/api/instagram/search/keyword` | `{keyword, count=5, comment=true, delayBetween=8000}` | Search by keyword + comment |

### Configuration
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/instagram/rate-limits` | Get rate limit state |
| PUT | `/api/instagram/rate-limits` | Update rate limits (hot) |
| GET | `/api/instagram/config` | Get full driver config |
| PUT | `/api/instagram/config` | Update driver config |

### Database
| Method | Path | Query | Description |
|--------|------|-------|-------------|
| GET | `/api/instagram/db/history` | `?limit=50` | Comment session history |
| GET | `/api/instagram/db/stats` | — | Overall comment stats |

---

## 8. Selectors Reference

### DM Inbox (`instagram.com/direct/inbox/`)

| Element | Selector | Notes |
|---------|----------|-------|
| Thread list container | `[aria-label="Thread list"]` | 2025+ |
| Conversation rows | DIV ancestors with height 65–90px, width > 300 | 2025+ identified by bbox |
| Thread links (legacy) | `a[href*="/direct/t/"]` | Pre-2025 |
| Username in link | `img[alt*="profile picture"]` → `.alt` strip suffix | |
| Unread badge | Identified by visual styling | No reliable class |
| New message button | `[aria-label*="New message"]` | |
| New message icon | `svg[aria-label*="New message"]` closest `div[role="button"]` | |
| Search input | `input[placeholder*="Search"]`, `input[name="queryBox"]` | New message dialog |
| Tab roles | `[role="tab"]` with innerText | Pre-2025 (removed) |

### DM Thread (`instagram.com/direct/t/{id}`)

| Element | Selector | Notes |
|---------|----------|-------|
| Message input | `div[contenteditable="true"][role="textbox"]` | Primary |
| Message input alt | `textarea[placeholder*="Message"]` | Fallback |
| Message rows | `div[role="row"]`, `div[class*="message"]` | |
| Recipient header pic | `img[alt*="profile picture"]` with `getBoundingClientRect().y < 80` | |
| Outbound detection | `getBoundingClientRect().left > window.innerWidth / 2` | Position-based |

### Profile Page (`instagram.com/{username}/`)

| Element | Selector | Notes |
|---------|----------|-------|
| Full name | `h1`, `h2`, `[class*="FullName"]`, `span[class*="_ap3a"]` | |
| Bio | `[class*="_aa_c"]`, `[class*="bio"]`, `[data-testid="user-bio"]` | |
| Follower/following/posts | `meta[name="description"]` content → regex | Most reliable |
| Private account | `body.innerText.includes('This account is private')` | |
| Message button | `div[role="button"]` or `button` with `.textContent === 'Message'` | |
| Post links | `a[href*="/p/"]` | |
| Reel links | `a[href*="/reel/"]` | |

### Post Page (`instagram.com/p/{shortcode}/`)

| Element | Selector | Notes |
|---------|----------|-------|
| Post container | `article` | |
| Username link | `a[href^="/"]` (in article header) | |
| Caption | `span._ap3a`, `article span` | |
| Timestamp | `time[datetime]` | |
| Comment list | `article ul li` | Filter by username + text + len > 2 |
| Like button | `svg[aria-label="Like"]` → `closest('button')` | |
| Comment icon | `svg[aria-label="Comment"]` → `closest('button')` | |
| Comment textarea | `textarea[aria-label="Add a comment…"]` | |
| Comment placeholder | `textarea[placeholder="Add a comment…"]` | |
| Submit button | `button[type="submit"]` | |
| Post button | `div[role="button"]` or `button` with `.innerText === 'post'` | |

### Explore/Hashtag Page

| Element | Selector | Notes |
|---------|----------|-------|
| Post links | `a[href*="/p/"], a[href*="/reel/"]` | |
| Shortcode | `/\/(p\|reel)\/([A-Za-z0-9_-]+)/` regex on href | |
| Username from container | `a[href^="/"]` not `/p/`, `/reel/`, `/explore/` → strip `/` | |
| Video indicator | `svg[aria-label="Reel"]`, `svg[aria-label="Video"]` | |

### Navigation (left sidebar)

| Element | Selector |
|---------|----------|
| Home | `svg[aria-label="Home"]` |
| Search | `svg[aria-label="Search"]` |
| Explore | `svg[aria-label="Explore"]` |
| Messages | `svg[aria-label="Messenger"]` |
| New post | `svg[aria-label="New post"]` |
| Profile | `svg[aria-label="Profile"]` |

---

## 9. Rate Limits

### DM Service — `DEFAULT_RATE_LIMITS`
| Limit | Default | Notes |
|-------|---------|-------|
| `messagesPerHour` | 10 | Hard cap, returns 429 |
| `messagesPerDay` | 30 | Hard cap, returns 429 |
| `minDelayMs` | 60000 (1min) | Min between messages |
| `maxDelayMs` | 300000 (5min) | Max between messages |
| `activeHoursStart` | 9 | 9:00 AM |
| `activeHoursEnd` | 21 | 9:00 PM |

Counters `messagesSentToday` and `messagesSentThisHour` are in-memory, reset at midnight/top-of-hour.  
Override: `PUT /api/rate-limits { "messagesPerDay": 50 }`

### Comments Service — `DEFAULT_CONFIG`
| Limit | Default | Notes |
|-------|---------|-------|
| `commentsPerHour` | 5 | Enforced by `checkRateLimit()` |
| `commentsPerDay` | 15 | Enforced by `checkRateLimit()` |
| `minDelayMs` | 120000 (2min) | Between comment actions |
| `maxDelayMs` | 300000 (5min) | Max between actions |

Comment log is instance-level `{ timestamp: Date }[]`. Override: `PUT /api/instagram/rate-limits`

---

## 10. Startup & Prerequisites

```bash
# DM service
PORT=3100 npx tsx packages/instagram-dm/src/api/server.ts

# Comments/Research service
PORT=3005 npx tsx packages/instagram-comments/src/api/server.ts

# With AI enabled
OPENAI_API_KEY=sk-... PORT=3100 npx tsx packages/instagram-dm/src/api/server.ts
OPENAI_API_KEY=sk-... PORT=3005 npx tsx packages/instagram-comments/src/api/server.ts
```

### Prerequisites
- Safari open and logged in to Instagram
- Node.js 18+, `npx tsx` available
- `OPENAI_API_KEY` — optional; enables AI DM generation + AI comment generation (GPT-4o)
- macOS (AppleScript + pbcopy required)

### Verify Running
```bash
# DM service
curl http://localhost:3100/health
curl http://localhost:3100/api/status

# Comments service
curl http://localhost:3005/health
curl http://localhost:3005/api/instagram/status
```

---

## 11. Debugging Playbook

```bash
DM=http://localhost:3100
CMT=http://localhost:3005

# 1. Check DM service alive + login
curl $DM/health
curl $DM/api/status

# 2. Ensure Instagram tab is active
curl -X POST $DM/api/session/ensure

# 3. List conversations
curl $DM/api/conversations

# 4. Get all conversations (all 4 tabs)
curl $DM/api/conversations/all

# 5. Send a test DM via smart-send
curl -X POST $DM/api/messages/smart-send \
  -H "Content-Type: application/json" \
  -d '{"username":"someuser","text":"Test message"}'

# 6. Send via known thread ID (fastest)
curl -X POST $DM/api/messages/send-to-thread \
  -H "Content-Type: application/json" \
  -d '{"threadId":"110178857046022","text":"Test"}'

# 7. Check rate limits
curl $DM/api/rate-limits

# 8. Execute raw JS to probe DOM
curl -X POST $DM/api/execute \
  -H "Content-Type: application/json" \
  -d '{"script":"document.querySelectorAll(\"a[href*=\\\"/direct/t/\\\"]\").length.toString()"}'

# 9. Comments service status
curl $CMT/api/instagram/status
curl $CMT/api/instagram/rate-limits

# 10. Post a single comment to a known post URL
curl -X POST $CMT/api/instagram/comments/post \
  -H "Content-Type: application/json" \
  -d '{"text":"Great post!","postUrl":"https://www.instagram.com/p/ABC123/"}'

# 11. Clear stuck session
curl -X POST $DM/api/session/clear
```

---

## 12. Known Failure Modes & Fixes

| Symptom | Root Cause | Fix |
|---------|-----------|-----|
| `conversations: []` | 2025+ DOM — `a[href*="/direct/t/"]` removed | Strategy 3 uses `[aria-label="Thread list"]` rows; if that also fails, `getAllConversations()` via direct URL navigation |
| `getAllConversations` returns 0 for all tabs | Instagram changed inbox URL routing | Verify each URL manually: `/direct/inbox/`, `/direct/general/`, etc. |
| `sendMessage` fails — input not found | Not inside a `/direct/t/` thread | Use `sendDMToThread` or `sendDMFromProfile` to navigate first |
| `sendDMFromProfile` → `no_message_btn` | Not following the user, or they have restricted DMs | Follow user first, or try a different contact |
| Comment not posted — `execCommand` fails | React updates broke `insertText` | Falls through to clipboard → native setter automatically |
| Comment verified = false | Slow render; comment WAS posted | Increase verify poll count or accept `cleared` state as success |
| "Action blocked" error | Instagram rate-limiting the account | Wait 24h+, reduce `commentsPerDay` |
| `typeViaKeystrokes` garbles emoji | AppleScript can't handle full Unicode | Use `typeViaClipboard` instead |
| Session drifted (wrong tab used) | Safari changed active tab | `POST /api/session/clear` → `POST /api/session/ensure` |
| AI generates generic fallback | `OPENAI_API_KEY` missing or quota exceeded | Set env var; the fallback string is still functional |
| `scrollAndListAllConversations` returns duplicates | Both Strategy 1 and Strategy 3 active simultaneously | `seen` map deduplicates by username — should be safe |
| Thread URL navigation lands on login | Cookie expired | Log in to Instagram in Safari manually |
| `enrichContact` returns empty followers | Meta description missing followers text | Some accounts don't expose counts in meta; DOM scrape from stats row instead |
| Research `postsPerNiche` not reached | Instagram blocks/hides hashtag | Check for "hidden" / "community guidelines" flag in `searchHashtag()` result |

---

## Cross-References

- `docs/selectors/INSTAGRAM_SELECTORS_REFERENCE.md` — extended selector catalog
- `docs/PRDs/PRD_INSTAGRAM_DM_FULL_CONTROL.md` — original PRD
- `docs/platforms/instagram.md` — platform guide
- `docs/DM_API_REFERENCE.md` — cross-platform DM API reference
- `packages/instagram-dm/src/automation/types.ts` — ground-truth types + rate limit defaults
- `packages/instagram-comments/src/automation/instagram-driver.ts` — SELECTORS const
