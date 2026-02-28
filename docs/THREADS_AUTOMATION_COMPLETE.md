# Threads Automation — Complete Reference

**Last updated:** 2026-02-27 · **Status:** ✅ Production-verified  
**Port:** 3004 (Comments/Research — only service; no Threads DM service)  
**Package:** `packages/threads-comments/`

> **DM note:** Threads has **no native DM system** on threads.net. All DMs from Threads users go through Instagram. Use the Instagram DM service (port 3100) for any Threads DM needs.

---

## Table of Contents

1. [Service Overview](#1-service-overview)
2. [Architecture — How It Works](#2-architecture--how-it-works)
3. [Threads DOM Quirks (Critical)](#3-threads-dom-quirks-critical)
4. [ThreadsDriver — Core Class](#4-threadsdriver--core-class)
   - [JS Execution Model](#41-js-execution-model)
   - [SELECTORS Const](#42-selectors-const)
   - [JS_TEMPLATES Library](#43-js_templates-library)
   - [postComment — 7-Step Flow](#44-postcomment--7-step-flow)
   - [commentOnMultiplePosts](#45-commentonmultipleposts)
   - [Rate Limits](#46-rate-limits)
5. [ThreadsAutoCommenter](#5-threadsautocommenter)
6. [ThreadsAICommentGenerator](#6-threadsaicommentgenerator)
7. [ThreadsResearcher](#7-threadsresearcher)
8. [All API Endpoints (Port 3004)](#8-all-api-endpoints-port-3004)
9. [Selectors Reference](#9-selectors-reference)
10. [Rate Limits](#10-rate-limits)
11. [Startup & Prerequisites](#11-startup--prerequisites)
12. [Debugging Playbook](#12-debugging-playbook)
13. [Known Failure Modes & Fixes](#13-known-failure-modes--fixes)

---

## 1. Service Overview

One Express API service driving Threads via Safari + AppleScript. No private API, no credentials stored — requires a logged-in Safari tab at `threads.net` or `threads.com`.

### Package Structure

```
packages/threads-comments/src/
  api/
    server.ts              ← Express routes (all endpoints)
  automation/
    threads-driver.ts      ← ThreadsDriver (core: nav, post details, comments, postComment)
    threads-auto-commenter.ts ← ThreadsAutoCommenter (single-post engagement loop)
    ai-comment-generator.ts   ← ThreadsAICommentGenerator (OpenAI/Anthropic/local)
    threads-researcher.ts     ← ThreadsResearcher (niche research, creator ranking)
    safari-driver.ts          ← SafariDriver base (shared with other packages)
  db/
    comment-logger.ts      ← SQLite comment session logging + history
  index.ts                 ← Re-exports

docs/
  platforms/threads.md          ← Platform overview, URLs, session sharing
  selectors/THREADS_SELECTORS_REFERENCE.md ← Full selector catalog (verified Jan 2026)
  PRDs/PRD_THREADS_DM_AUTOMATION.md        ← PRD (DM is via Instagram)
```

**Source lineage (Python origins):**
- `python/selectors/threads_selectors.py` → `threads-driver.ts` (SELECTORS + JS_TEMPLATES)
- `python/engagement/threads_engagement.py` → `threads-driver.ts` (findAllPosts, extractContext, focusInput)
- `python/automation/safari_threads_poster.py` → `threads-driver.ts` (postComment flow)
- `python/utils/ai_comment_generator.py` → `ai-comment-generator.ts`

---

## 2. Architecture — How It Works

```
HTTP Request
      │
      ▼
Port 3004: Threads Comments Server (Express)
      │
      ├─→ ThreadsDriver
      │       │
      │       ├── executeJS(script)
      │       │     Write JS → /tmp/safari_js_{ts}_{rand}.js
      │       │     Write AppleScript → /tmp/safari_cmd_{ts}_{rand}.scpt
      │       │     osascript "{scptFile}" → stdout
      │       │     (Cleanup both temp files in finally{})
      │       │
      │       ├── typeViaClipboard(text)
      │       │     spawn pbcopy → stdin.write(text)
      │       │     osascript: keystroke "v" using command down
      │       │
      │       └── navigate(url)
      │             osascript: set URL of current tab of front window to "{url}"
      │
      ├─→ ThreadsAutoCommenter      (wraps ThreadsDriver for engagement loops)
      ├─→ ThreadsAICommentGenerator (GPT-4o / Anthropic / local templates)
      └─→ CommentLogger             (SQLite session logging + duplicate tracking)
```

### JavaScript Execution Pattern

Both `ThreadsDriver` and `ThreadsResearcher` use the same temp-file pattern:

```typescript
// 1. Write JS to temp file
fs.writeFileSync('/tmp/safari_js_{ts}.js', script);

// 2. Write AppleScript wrapper to temp file
const appleScript = `
tell application "Safari"
  tell front document
    set jsCode to read POSIX file "/tmp/safari_js_{ts}.js"
    do JavaScript jsCode
  end tell
end tell`;
fs.writeFileSync('/tmp/safari_cmd_{ts}.scpt', appleScript);

// 3. Execute
const { stdout } = await execAsync(`osascript "/tmp/safari_cmd_{ts}.scpt"`, { timeout: 15000 });

// 4. Cleanup both temp files
```

This avoids AppleScript inline string-length limits for large JS payloads.

### Session Model

No `SafariDriver` session tracking (unlike Instagram/TikTok/Twitter DM packages). Each `executeJS` call operates on `front document` of the front Safari window. No tab caching or self-healing session — the front tab must already be on `threads.net` or `threads.com`.

---

## 3. Threads DOM Quirks (Critical)

### Quirk 1 — No `<article>` elements
Threads uses `[data-pressable-container="true"]` for **every** content unit (posts AND replies). There is no `<article>` tag. The first `[data-pressable-container="true"]` on a post page is the main post; subsequent ones are replies.

### Quirk 2 — Contenteditable div, not `<textarea>`
The reply composer is `[role="textbox"][contenteditable="true"]`. Raw `.value =` assignment doesn't exist; must use:
1. `document.execCommand('insertText', false, text)` — works with React's synthetic events
2. `pbcopy` + ⌘V clipboard paste — supports emoji/Unicode
3. `el.innerText = text` + `dispatchEvent(new InputEvent('input', {bubbles:true}))` — last resort

### Quirk 3 — Double Reply button
When the reply composer is open, **two** `svg[aria-label="Reply"]` elements exist:
- `replyBtns[0]` — the original action button that opened the composer
- `replyBtns[1]` — the submit button inside the composer

Submit by clicking the 2nd one (if not `aria-disabled`), or find `div[role="button"]` with `.innerText === 'Post'`.

### Quirk 4 — Engagement counts are near SVG parents
`likes`, `replies`, `reposts` counts live as text nodes next to the action SVGs. There's no stable `data-testid` attribute. Extraction walks `svg.parentElement.innerText` and parses `\d+[KkMm]?` with K/M expansion.

### Quirk 5 — Post ID is in the URL, not the DOM
`/post/([A-Za-z0-9_-]+)` — extracted from `a[href*="/post/"]` links within the container.

### Quirk 6 — Username format: `/@username`
Profile links are `a[href^="/@username"]`. Extraction: `href.split('/@').pop().split('/')[0].split('?')[0]`.

### Quirk 7 — `threads.net` and `threads.com` both work
Both domains are valid. The driver defaults to `threads.com` for navigation, but search uses `threads.net/search`.

### Quirk 8 — Auth shares with Instagram
Same Meta account/session. Login on `threads.net` uses Instagram cookies (`sessionid`, `csrftoken`, `ds_user_id`). If Threads redirects to `instagram.com/accounts/login`, completing that login also logs into Threads.

### Quirk 9 — Expand composer button (optional step)
`svg[aria-label="Expand composer"]` may appear when the reply box is inline (collapsed mode). Clicking it opens the full composer modal. The driver includes an optional Step 5 for this — it's non-fatal if not found.

---

## 4. ThreadsDriver — Core Class

**File:** `packages/threads-comments/src/automation/threads-driver.ts`

Single class managing all Safari interaction for Threads. Rate limit log is in-memory: `commentLog: { timestamp: Date }[]`.

### 4.1 JS Execution Model

```typescript
private async executeJS(script: string): Promise<string>
private async typeViaClipboard(text: string): Promise<boolean>
private async navigate(url: string): Promise<boolean>  // 3s wait built in
private wait(ms: number): Promise<void>
private randomDelay(): number  // minDelayMs + random * (max - min)
```

### 4.2 SELECTORS Const

```typescript
export const SELECTORS = {
  // Navigation
  NAV_HOME:          'svg[aria-label="Home"]',
  NAV_SEARCH:        'svg[aria-label="Search"]',
  NAV_CREATE:        'svg[aria-label="Create"]',
  NAV_NOTIFICATIONS: 'svg[aria-label="Notifications"]',
  NAV_PROFILE:       'svg[aria-label="Profile"]',
  NAV_MORE:          'svg[aria-label="More"]',
  NAV_BACK:          'svg[aria-label="Back"]',
  // Post Actions
  ACTION_LIKE:   'svg[aria-label="Like"]',
  ACTION_UNLIKE: 'svg[aria-label="Unlike"]',
  ACTION_REPLY:  'svg[aria-label="Reply"]',
  ACTION_REPOST: 'svg[aria-label="Repost"]',
  ACTION_SHARE:  'svg[aria-label="Share"]',
  ACTION_MORE:   'svg[aria-label="More"]',
  // Composer
  COMPOSER_INPUT:          '[role="textbox"][contenteditable="true"]',
  COMPOSER_INPUT_ALT:      '[contenteditable="true"]',
  COMPOSER_INPUT_ARIA:     '[aria-label*="Empty text field"]',
  COMPOSER_EXPAND:         'svg[aria-label="Expand composer"]',
  COMPOSER_SUBMIT_REPLY:   'svg[aria-label="Reply"]',
  COMPOSER_SUBMIT_CREATE:  'svg[aria-label="Create"]',
  // Content
  POST_CONTAINER: '[data-pressable-container="true"]',
  USER_LINK:      'a[href*="/@"]',
  POST_LINK:      'a[href*="/post/"]',
  TIMESTAMP:      'time',
  TEXT_CONTENT:   '[dir="auto"] span',
  TEXT_CONTENT_ALT: '[dir="ltr"] span',
  // Modal
  DIALOG:       '[role="dialog"]',
  DIALOG_CLOSE: 'svg[aria-label="Close"]',
  // Generic
  ROLE_BUTTON:     '[role="button"]',
  BUTTON_DISABLED: '[aria-disabled="true"]',
};
```

### 4.3 JS_TEMPLATES Library

Pre-built JavaScript snippets for common operations:

| Template | Description |
|----------|-------------|
| `clickReplyButton` | `querySelectorAll('svg[aria-label="Reply"]')[0]` → closest `[role="button"]` → `.click()` |
| `submitReply` | 3-strategy: dialog "Post" → any visible "Post" → leaf text "Post" → clickable parent |
| `checkLoginStatus` | `svg[aria-label="Create"]` or `Profile` → `'logged_in'`; `a[href*="/login"]` → `'not_logged_in'` |
| `getPostDetails` | First `[data-pressable-container]` → `{username, text, timestamp, post_id, url}` |
| `typeInComposer(text)` | JS string-set via `innerText` + `InputEvent` dispatch |
| `extractComments(limit)` | Containers[1..limit+1] → `{username, text, timestamp}[]` |
| `findAllPosts(limit)` | All `[data-pressable-container]` with `a[href^="/@"]` + `a[href*="/post/"]` → `{username, url, content, index}[]` |
| `extractContext` | Main post text + likeCount + replyCount + up to 10 reply excerpts |
| `scrollDown` | `window.scrollBy(0, 800)` |
| `clickPost(index)` | Click `a[href*="/post/"]` in containers[index] |
| `focusInput` | Find visible `[contenteditable]` (offsetHeight > 10), `scrollIntoView`, `.focus()`, `.click()`, clear placeholder |
| `clickExpand` | Find `svg` with aria-label containing "expand"/"full" → click parent |
| `clickBack` | `svg[aria-label="Back"]` → parent → `.click()`; fallback: `window.history.back()` |

### Public Methods

| Method | Description |
|--------|-------------|
| `getStatus()` | `{isOnThreads, isLoggedIn, currentUrl}` |
| `navigateToPost(url)` | `navigate(url)` (3s wait) |
| `getPostDetails()` | Run `JS_TEMPLATES.getPostDetails` → parse JSON |
| `getComments(limit=50)` | Run `JS_TEMPLATES.extractComments(limit)` → `{username, text, timestamp}[]` |
| `findPosts(limit=10)` | Run `JS_TEMPLATES.findAllPosts(limit)` → `{username, url, content, index}[]` |
| `getContext()` | Run `JS_TEMPLATES.extractContext` → `{mainPost, username, replies[], likeCount, replyCount}` |
| `scroll()` | `window.scrollBy(0, 800)` |
| `clickPost(index)` | Click post at DOM index |
| `clickBack()` | Click back or `history.back()` + 2s wait |
| `postComment(text)` | Full 7-step flow (see below) |
| `commentOnMultiplePosts(count, generator, delay, opts)` | Multi-post loop with retries |
| `checkRateLimit()` | `{allowed, reason?}` |
| `getRateLimits()` | `{commentsThisHour, commentsToday, limits}` |
| `setConfig(updates)` | Hot update rate limits |
| `getConfig()` | Current `ThreadsConfig` copy |

### 4.4 postComment — 7-Step Flow

```
Up to 3 attempts (with 2s × attempt backoff):

Pre-check:
  checkRateLimit()                       ← enforced before every attempt
  Detect platform errors:
    "Something went wrong" → wait 3s, retry
    "rate" + "limit" in body → wait 3s, retry

Step 1: Click Reply button
  JS_TEMPLATES.clickReplyButton
    → querySelectorAll('svg[aria-label="Reply"]')[0]
    → .closest('[role="button"]') || .parentElement → .click()
  if !== 'clicked': lastError = 'Reply button not found'; continue

Step 2: Smart wait for composer (poll 10 × 400ms)
  JS: document.querySelector('[contenteditable="true"]').offsetParent !== null
  if never ready: lastError = 'Composer never appeared'; continue

Step 3: Focus input
  JS_TEMPLATES.focusInput
    → finds visible [contenteditable] (offsetHeight > 10)
    → scrollIntoView, .click(), .focus()
    → clears placeholder text if present
  if !== 'focused': lastError = 'Could not focus reply input'; continue
  wait 300ms

Step 4: Type text — 3-strategy chain:
  Strategy 1: execCommand('insertText', false, text) [React-compatible]
    → result === 'execCommand' → typed=true, strategy='execCommand'
  Strategy 2: typeViaClipboard(text)   [pbcopy + ⌘V, Unicode-safe]
    → clipOk === true → typed=true, strategy='clipboard'
  Strategy 3: innerText + InputEvent dispatch
    → el.innerText = text
    → dispatchEvent(new InputEvent('input', {bubbles:true, inputType:'insertText', data:text}))
    → result === 'dispatched' → typed=true, strategy='innerText'
  if !typed: lastError = 'All typing strategies failed'; continue
  wait 800ms

Step 5: Expand composer (optional)
  JS_TEMPLATES.clickExpand
  → Non-fatal: 'no_expand_found' is acceptable
  wait 800ms

Step 6: Submit (up to 5 attempts × 600ms)
  JS_TEMPLATES.submitReply:
    1. [role="dialog"] → querySelectorAll('div[role="button"]') text === "Post" → .click()
    2. All div[role="button"] with .innerText === 'Post' && .offsetParent !== null → .click()
    3. All elements with leaf text === 'Post' → .closest('[role="button"]') → .click()
  if not submitted: lastError = 'Submit button not found or disabled'

Step 7: Verify (wait 2s, then poll 6 × 1500ms)
  JS: querySelectorAll('[data-pressable-container] span, p span, div span')
      → any .textContent includes text.substring(0, 25)
  verified = true/false (non-fatal — comment may still have been posted)

On success:
  commentLog.push({ timestamp: new Date() })  ← feeds rate limit counter
  commentId = 'th_' + Date.now()
  return { success: true, commentId, verified }

On all retries exhausted:
  screencapture -x /tmp/threads-post-failure-{ts}.png
  return { success: false, error: lastError }
```

### 4.5 commentOnMultiplePosts

High-level multi-post commenting loop built into `ThreadsDriver`:

```typescript
commentOnMultiplePosts(
  count: number = 5,
  commentGenerator: (context) => string | Promise<string>,
  delayBetweenMs: number = 30000,
  options: { maxRetries?: number; captureScreenshots?: boolean; screenshotDir?: string }
): Promise<{ results[], summary, logs[] }>
```

Flow:
```
Navigate to https://www.threads.com
wait 3s

For i = 0..count:
  Check: consecutiveFailures >= 3 → stop early

  Up to maxRetries (default 2):
    findPosts(10)
    if no posts: scroll + wait 2s + retry
    clickPost((i + retryCount) % posts.length)
    wait 3s
    getContext() → validate mainPost.length > 5
    commentGenerator(context) → comment string
    if comment.startsWith('__SKIP__:'): clickBack, scroll, continue
    postComment(comment)
    if screenshot mode: screencapture -x {screenshotDir}/threads_comment_{ts}.png
    clickBack() + wait 2s
    scroll + wait 1s
    consecutiveFailures = 0

  delayBetweenMs before next post (skipped for last)

Return: { results[], summary{total, successful, failed, duration}, logs[] }
```

**Skip protocol:** If `commentGenerator` returns `'__SKIP__:reason'`, the post is skipped without counting as failure. The AI generator uses this for inappropriate content.

### 4.6 Rate Limits

**`DEFAULT_CONFIG`:**
```typescript
{
  timeout: 30000,
  minDelayMs: 60000,    // 1 minute min between actions
  maxDelayMs: 180000,   // 3 minutes max
  commentsPerHour: 5,
  commentsPerDay: 20,
}
```

`checkRateLimit()` counts `commentLog` entries within last 1h / 24h windows against `commentsPerHour` / `commentsPerDay`.

---

## 5. ThreadsAutoCommenter

**File:** `packages/threads-comments/src/automation/threads-auto-commenter.ts`

Wraps `ThreadsDriver` with:
- In-memory `commentedUrls: Set<string>` for session-level duplicate prevention
- `skipDuplicates: boolean` config (default: true)
- Simpler single-post `engageWithPost(postUrl?)` flow
- `runEngagementLoop(count, delayBetween)` for sequential engagement

**`engageWithPost(postUrl?)` flow:**
```
1. Navigate to postUrl OR find non-duplicate post from feed
2. clickPost(index) for feed post OR navigate directly
3. extractContext() (via osascript for current URL)
4. Validate mainPost.length >= 10
5. generateAIComment(context)
6. driver.postComment(comment)
7. commentedUrls.add(postUrl)
Return: EngagementResult { success, username, postUrl, postContent, repliesFound, generatedComment, commentPosted, commentId? }
```

**`findNonDuplicatePost()`:**
- `findPosts(15)` → filter by `commentedUrls`
- If all visible are duplicates: `scroll()` + 2s wait → retry up to `maxScrolls` (default 5) times

**`AutoCommenterConfig`:**
```typescript
{
  maxScrolls: 5,
  delayBetweenActions: 2000,
  skipDuplicates: true,
  aiEnabled: true,
  openaiApiKey?: string,
}
```

**Note:** `ThreadsAutoCommenter.generateAIComment()` is a lightweight fallback using template strings. The full AI pipeline is in `ThreadsAICommentGenerator` and used by the server's `/engage/multi` endpoint directly.

---

## 6. ThreadsAICommentGenerator

**File:** `packages/threads-comments/src/automation/ai-comment-generator.ts`

### Content Safety Filter

`isInappropriateContent(text)` — pre-screens posts before generating comments:

**Blocked keywords:**
```
'onlyfans', 'of link', 'link in bio', 'dm for more', 'dm me',
'swipe up', 'exclusive content', 'subscribe', 'spicy', 'uncensored',
'nsfw', '18+', 'adults only', 'mature content',
'rate me', 'am i pretty', 'am i hot', 'do you like', 'what would you do',
'smash or pass', 'would you date', 'sliding into', 'hit me up',
'crypto', 'nft drop', 'free money', 'giveaway', 'dm to win',
'make money fast', 'passive income', 'get rich'
```

**Blocked emoji combos:** ≥ 2 of `🍑 🍆 🥵 💦 🔞 👅 💋 🤤`

**Short text + photo indicator:** text < 10 chars after emoji strip + contains attention phrase + `📸`

### `analyzePost(context)` → `PostAnalysis`

```typescript
{
  mainPost: string;
  username: string;
  replies: string[];
  hasImage: boolean;
  hasVideo: boolean;
  sentiment: 'positive' | 'negative' | 'neutral' | 'question';
  topics: string[];  // tech, art, fitness, business, lifestyle, motivation, food, travel, humor, general
  tone: string;      // 'casual', 'professional', 'emotional', 'neutral'
  engagement?: string;
  isInappropriate?: boolean;
  skipReason?: string;
}
```

Sentiment detection order: question (?) → positive (love/amazing/🔥) → negative (hate/😢) → neutral.

Topic detection: keyword maps for 9 topics. Multiple topics possible.

### `generateComment(analysis)` → string

Provider routing:
1. **OpenAI** (`OPENAI_API_KEY` set): GPT-4o, 15s timeout, `max_tokens: 100`, temp `0.85`
2. **Anthropic** (`provider: 'anthropic'`): claude-3-haiku, same timeout
3. **Local** (no API key or fallback): topic-keyed template arrays + sentiment prefix

**GPT-4o System Prompt:** _"You are a social media engagement expert. Generate authentic, contextual comments that sound natural. Never be generic or spammy."_

**Platform vibe for Threads prompt:** `"conversational and thoughtful"` (vs Instagram: supportive/engaging, TikTok: casual/fun, Twitter: witty/concise)

**Prompt structure (matching Python original):**
```
POST BY @{username}: {mainPost[:400]}
WHAT OTHERS ARE SAYING: {replies[:5]}
ANALYSIS: Sentiment: X, Topics: Y, Tone: Z
Generate comment: max {maxLength} chars, 1-2 emojis, references specific content...
```

**Local templates by topic** (4 per topic):
- `tech`: "This is exactly the kind of innovation we need 🔥", etc.
- `art`: "The creativity here is unmatched ✨", etc.
- `fitness`: "This is the motivation I needed today 💪", etc.
- `business`: "This perspective on growth is spot on 📈", etc.
- `motivation`: "Needed to hear this today 🙌", etc.
- `humor`: "I literally cannot stop laughing at this 😂", etc.
- `lifestyle`: "This is the vibe we're all chasing ✨", etc.
- `general`: "This really resonates with me ✨", etc.

**`AICommentConfig` defaults:**
```typescript
{ provider: 'openai', model: 'gpt-4o', maxLength: 80, temperature: 0.85, style: 'engaging' }
```

---

## 7. ThreadsResearcher

**File:** `packages/threads-comments/src/automation/threads-researcher.ts`

Market research pipeline for Threads. Single-pass collection (no separate detail-scrape pass unlike Instagram researcher).

### Types

**`ThreadsPost`:**
```typescript
{
  id: string;               // postId from /post/{id}
  url: string;              // https://www.threads.net/@user/post/{id}
  text: string;             // post body up to 500 chars
  author: string;           // @handle (no @)
  authorDisplayName: string;
  isVerified: boolean;      // svg[aria-label="Verified"] || title="Verified"
  likes: number;
  replies: number;
  reposts: number;
  engagementScore: number;  // likes + reposts*2 + replies
  hasMedia: boolean;        // img[src*="scontent"] || video || [role="img"]
  timestamp: string;        // time[datetime] value
  niche: string;
  collectedAt: string;      // ISO
}
```

**`ThreadsCreator`:**
```typescript
{
  handle: string;
  displayName: string;
  isVerified: boolean;
  postCount: number;
  totalLikes: number;
  totalReplies: number;
  totalReposts: number;
  totalEngagement: number;
  avgEngagement: number;
  topPostUrl: string;
  topPostEngagement: number;
  niche: string;
}
```

**`DEFAULT_THREADS_RESEARCH_CONFIG`:**
```typescript
{
  postsPerNiche: 1000,
  creatorsPerNiche: 100,
  scrollPauseMs: 1500,
  maxScrollsPerSearch: 200,
  timeout: 30000,
  outputDir: '~/Documents/threads-research',
  maxRetries: 3,
}
```

### `buildSearchQueries(niche)` → 5 variants
```
base                           → "solopreneur"
"base"  (quoted)               → '"solopreneur"'
#tag (spaces removed)          → "#solopreneur"
base + " tips"                 → "solopreneur tips"
base + " growth"               → "solopreneur growth"
```

### Search URL
```
https://www.threads.net/search?q={encodeURIComponent(query)}&serp_type=default
```
Waits for `[data-pressable-container="true"]` (12s) or `a[href*="/post/"]` (8s fallback).

### `extractVisiblePosts(niche)` — in-DOM scraper

For each `[data-pressable-container="true"]`:
- `handle`: `a[href*="/@"]` → `.href.split('/@').pop().split('/')[0].split('?')[0]`
- `displayName`: first `span` in user link
- `text`: `span[dir="auto"], [dir="auto"] span` filtered (len > 3, not timestamp `/^\d+[hmd]$/`, not handle, not "Verified") → joined, max 500 chars
- `postId` + `url`: `a[href*="/post/"]` → `/post/([A-Za-z0-9_-]+)` regex
- `likes/replies/reposts`: walk all `svg` in post → check `aria-label` → `.parentElement.innerText` → parse K/M
- Fallback engagement: `statsText.match(/(\d+[KkMm]?)\s*like/i)` etc.
- `isVerified`: `svg[aria-label="Verified"]` || `[title="Verified"]`
- `hasMedia`: `img[src*="scontent"]` || `video` || `[role="img"]`
- Filter: `postId && handle && text.length > 5`

`engagementScore = likes + reposts * 2 + replies`

### `scrollAndCollect(niche, targetCount)` — scroll-until-stable

```
while seen.size < targetCount && scrolls < maxScrollsPerSearch (200):
  extractVisiblePosts() → deduplicate by postId
  if newCount === 0: noNewCount++
    noNewCount >= 5 → break  ← truly at end
  window.scrollBy(0, window.innerHeight * 2)
  wait scrollPauseMs (1500ms)
  Error detection:
    "Something went wrong" → reload + wait 5s
    "rate" + "limit"       → wait 60s
Return all unique posts
```

### `rankCreators(posts, niche, topN)` — engagement ranking

Groups posts by `author`, sums all engagement fields, tracks `topPostUrl` (highest per-post score), sorts by `totalEngagement desc` then `avgEngagement desc`, returns top `N` (default 100).

### `researchNiche(niche)` — full pipeline

```
buildSearchQueries(niche) → 5 queries
For each query (stop when postsPerNiche reached):
  search(query) → threads.net/search URL
  scrollAndCollect(niche, targetPerQuery)
  deduplicate into allPosts map by postId
  wait 3s between queries
Sort allPosts by engagementScore desc
rankCreators(postArray, niche) → top 100
Save to ~/Documents/threads-research/{niche}-{ts}.json
Return ThreadsNicheResult
```

**`ThreadsNicheResult`:**
```typescript
{
  niche: string;
  query: string;         // first query used
  posts: ThreadsPost[];
  creators: ThreadsCreator[];
  totalCollected: number;
  uniquePosts: number;
  collectionStarted: string;
  collectionFinished: string;
  durationMs: number;
}
```

---

## 8. All API Endpoints (Port 3004)

### Health & Status
| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | `{status:"ok", service:"threads-comments", port:3004, timestamp}` |
| GET | `/api/threads/status` | `{isOnThreads, isLoggedIn, currentUrl, commentsThisHour, commentsToday}` |

### Rate Limits
| Method | Path | Body | Description |
|--------|------|------|-------------|
| GET | `/api/threads/rate-limits` | — | Current counts + config |
| PUT | `/api/threads/rate-limits` | Partial `ThreadsConfig` | Update config (hot) |
| GET | `/api/threads/config` | — | Full driver config |
| PUT | `/api/threads/config` | Partial `ThreadsConfig` | Update driver config |

### Navigation
| Method | Path | Body | Description |
|--------|------|------|-------------|
| POST | `/api/threads/navigate` | `{url}` | Navigate Safari to any URL |
| POST | `/api/threads/scroll` | — | `window.scrollBy(0, 800)` |
| POST | `/api/threads/back` | — | Click back button or history.back() |

### Post Data
| Method | Path | Query | Description |
|--------|------|-------|-------------|
| GET | `/api/threads/post` | — | Current post details `{username, text, timestamp, post_id, url}` |
| GET | `/api/threads/comments` | `?limit=50` | Comments from current post thread |
| GET | `/api/threads/posts` | `?limit=10` | Feed posts visible on current page |
| GET | `/api/threads/context` | — | Full context: mainPost + replies + likeCount + replyCount |

### Comment Posting
| Method | Path | Body | Description |
|--------|------|------|-------------|
| POST | `/api/threads/comments/post` | `{text, postUrl?}` | Post a comment (navigates if postUrl given) |
| POST | `/api/threads/click-post` | `{index}` | Click into a post at DOM index |

### Auto Engagement (ThreadsAutoCommenter)
| Method | Path | Body | Description |
|--------|------|------|-------------|
| POST | `/api/threads/engage` | `{postUrl?}` | Engage with single post (find or navigate) |
| POST | `/api/threads/engage/loop` | `{count=1, delayBetween=60000}` | Sequential engagement loop |
| GET | `/api/threads/engage/history` | — | List commented URLs (session-only) |
| DELETE | `/api/threads/engage/history` | — | Clear commented URL history |

### Multi-Post AI Engagement
| Method | Path | Body | Description |
|--------|------|------|-------------|
| POST | `/api/threads/engage/multi` | `{count=5, delayBetween=30000, useAI=true, maxRetries=2, captureScreenshots=false}` | Multi-post feed engagement with AI comments |
| POST | `/api/threads/analyze` | — | Analyze current post + generate suggested comment |

### Database
| Method | Path | Query | Description |
|--------|------|-------|-------------|
| GET | `/api/threads/db/history` | `?limit=50&sessionId=` | Comment session history |
| GET | `/api/threads/db/stats` | — | Total comments, success rate, top posts |

### Debug
| Method | Path | Body | Description |
|--------|------|------|-------------|
| POST | `/api/threads/execute` | `{script}` | Execute raw JS in Safari front tab |

---

## 9. Selectors Reference

### Navigation (Left Sidebar)

| Element | Selector |
|---------|----------|
| Home | `svg[aria-label="Home"]` |
| Search | `svg[aria-label="Search"]` |
| Create (= logged in indicator) | `svg[aria-label="Create"]` |
| Notifications | `svg[aria-label="Notifications"]` |
| Profile | `svg[aria-label="Profile"]` |
| More | `svg[aria-label="More"]` |
| Back | `svg[aria-label="Back"]` |

**Generic click pattern for any SVG button:**
```javascript
var svg = document.querySelector('svg[aria-label="Home"]');
var btn = svg.closest('[role="button"]') || svg.parentElement;
btn.click();
```

### Post Containers & Content

| Element | Selector | Notes |
|---------|----------|-------|
| Post / Reply container | `[data-pressable-container="true"]` | Used for EVERYTHING |
| Post link | `a[href*="/post/"]` | For post ID extraction |
| User link | `a[href*="/@"]` | Username: `.split('/@').pop().split('/')[0].split('?')[0]` |
| Post text | `[dir="auto"] span` | Alt: `[dir="ltr"] span` |
| Timestamp | `time[datetime]` | `.getAttribute('datetime')` |
| Verified badge | `svg[aria-label="Verified"]` | Or `[title="Verified"]` |
| Media presence | `img[src*="scontent"]`, `video`, `[role="img"]` | Any = hasMedia |

### Post Actions

| Action | SVG Selector |
|--------|-------------|
| Like | `svg[aria-label="Like"]` |
| Unlike (liked) | `svg[aria-label="Unlike"]` |
| Reply (action + submit) | `svg[aria-label="Reply"]` |
| Repost | `svg[aria-label="Repost"]` |
| Share | `svg[aria-label="Share"]` |
| More options | `svg[aria-label="More"]` |

### Composer (Reply Input)

| Element | Selector | Notes |
|---------|----------|-------|
| Primary input | `[role="textbox"][contenteditable="true"]` | |
| Fallback input | `[contenteditable="true"]` | |
| Aria input | `[aria-label*="Empty text field"]` | |
| Expand button | `svg[aria-label="Expand composer"]` | Optional |
| Submit (2nd Reply) | `querySelectorAll('svg[aria-label="Reply"]')[1]` | When composer open |
| Submit ("Post" text) | `div[role="button"]` with `.innerText === 'Post'` | |

### Modal / Dialog

| Element | Selector |
|---------|----------|
| Dialog container | `[role="dialog"]` |
| Close button | `svg[aria-label="Close"]` → `closest('[role="button"]')` |

### URL Patterns

| Page | URL |
|------|-----|
| Home Feed | `https://www.threads.net/` or `https://www.threads.com/` |
| Search | `https://www.threads.net/search?q={query}&serp_type=default` |
| Profile | `https://www.threads.net/@{username}` |
| Post / Thread | `https://www.threads.net/@{username}/post/{postId}` |
| Activity | `https://www.threads.net/activity` |
| Compose | `https://www.threads.net/compose` |
| DM Inbox | `https://www.threads.net/direct/inbox` (routes to Instagram DMs) |

---

## 10. Rate Limits

| Limit | Default | Notes |
|-------|---------|-------|
| `commentsPerHour` | 5 | Hard cap in `checkRateLimit()` |
| `commentsPerDay` | 20 | Hard cap in `checkRateLimit()` |
| `minDelayMs` | 60000 (1min) | Between comment actions |
| `maxDelayMs` | 180000 (3min) | Max random delay |
| `timeout` | 30000 | JS execution timeout |

Counts are instance-level `commentLog[]` (in-memory, cleared on server restart).

**Reported platform limits** (from `docs/platforms/threads.md`):
- Likes: ~30/hour
- Replies: ~10/hour
- Profile views: generally unrestricted

Override via API:
```bash
curl -X PUT http://localhost:3004/api/threads/rate-limits \
  -H "Content-Type: application/json" \
  -d '{"commentsPerDay": 30}'
```

---

## 11. Startup & Prerequisites

```bash
# Start Threads comments service
PORT=3004 npx tsx packages/threads-comments/src/api/server.ts

# With AI enabled
OPENAI_API_KEY=sk-... PORT=3004 npx tsx packages/threads-comments/src/api/server.ts

# With Anthropic instead
ANTHROPIC_API_KEY=sk-ant-... PORT=3004 npx tsx packages/threads-comments/src/api/server.ts
```

### Prerequisites
- Safari open and logged in to Threads (`threads.net` or `threads.com`)
- Node.js 18+, `npx tsx` available
- macOS (AppleScript + pbcopy required)
- `OPENAI_API_KEY` — optional; enables GPT-4o comment generation
- Threads shares auth with Instagram — logging into either works for both

### Verify Running
```bash
curl http://localhost:3004/health
curl http://localhost:3004/api/threads/status
```

---

## 12. Debugging Playbook

```bash
T=http://localhost:3004

# 1. Check service alive + login
curl $T/health
curl $T/api/threads/status

# 2. Check current page context
curl $T/api/threads/post
curl $T/api/threads/context

# 3. Find posts on feed
curl $T/api/threads/posts

# 4. Navigate to a specific post
curl -X POST $T/api/threads/navigate \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.threads.net/@someuser/post/ABC123"}'

# 5. Get comments on current post
curl "$T/api/threads/comments?limit=10"

# 6. Post a single comment (with navigation)
curl -X POST $T/api/threads/comments/post \
  -H "Content-Type: application/json" \
  -d '{"text":"This is amazing! 🔥","postUrl":"https://www.threads.net/@someuser/post/ABC123"}'

# 7. Analyze current post with AI
curl -X POST $T/api/threads/analyze

# 8. Run multi-post engagement (5 posts, AI)
curl -X POST $T/api/threads/engage/multi \
  -H "Content-Type: application/json" \
  -d '{"count":5,"delayBetween":30000,"useAI":true}'

# 9. Check rate limits
curl $T/api/threads/rate-limits

# 10. Execute raw JS to probe DOM
curl -X POST $T/api/threads/execute \
  -H "Content-Type: application/json" \
  -d '{"script":"document.querySelectorAll(\"[data-pressable-container=true]\").length.toString()"}'

# 11. Clear engagement history (session duplicate tracking)
curl -X DELETE $T/api/threads/engage/history

# 12. View comment history from database
curl "$T/api/threads/db/history?limit=20"
curl $T/api/threads/db/stats
```

---

## 13. Known Failure Modes & Fixes

| Symptom | Root Cause | Fix |
|---------|-----------|-----|
| `status.isLoggedIn = false` | Front Safari tab not on threads.net, or not logged in | Navigate to `threads.net`, log in via Instagram if redirected |
| `clickReplyButton` returns `'not_found'` | Not on a post page; on feed or profile | Navigate to a specific post URL first |
| Composer never appeared | Reply modal blocked by another modal | `POST /api/threads/execute` with `JS_TEMPLATES.clickBack` to dismiss, retry |
| All typing strategies fail | contenteditable requires actual user interaction first | Click into the page via `/api/threads/execute` → `document.body.click()` |
| Submit returns `'submit_not_found'` | Text wasn't typed, so "Post" button stays disabled | Check typing step; try `captureScreenshots: true` for visual debug |
| `verified: false` after submit | Comment posted but didn't appear in DOM poll window | Usually still successful — the post was sent |
| "Something went wrong" platform error | Transient Threads server error | Retry after 3s; the driver handles this automatically |
| "rate" + "limit" in body | Threads rate-limited the account | Wait 60s (auto) then reduce `commentsPerDay` |
| Research returns 0 posts | Search URL changed or query has no results | Try simplified query, check URL format `?serp_type=default` |
| `executeJS` timeout | Safari not responding / page frozen | Reload the page manually in Safari |
| AI generates fallback template | `OPENAI_API_KEY` missing or expired | Set env var; fallback templates are functional |
| `commentOnMultiplePosts` stops early | 3 consecutive failures | Check `consecutiveFailures` counter; usually a navigation or DOM issue |
| Threads redirects to Instagram login | Session expired | Log in again in Safari; both platforms share the session |
| `clickPost` returns `'not_found'` | Index out of bounds for current feed | `findPosts()` first to verify count before clicking |

---

## Cross-References

- `docs/platforms/threads.md` — Platform guide with URL map, session sharing, modal handling
- `docs/selectors/THREADS_SELECTORS_REFERENCE.md` — Extended selector catalog (verified Jan 2026)
- `docs/PRDs/PRD_THREADS_DM_AUTOMATION.md` — PRD (note: DMs via Instagram)
- `packages/instagram-dm/src/api/server.ts` — Port 3100, use for Threads user DMs
- `packages/threads-comments/src/automation/threads-driver.ts` — `SELECTORS` + `JS_TEMPLATES` constants
- Gateway registry: port 3004 registered as `threads` platform in Safari Gateway (port 3000)
