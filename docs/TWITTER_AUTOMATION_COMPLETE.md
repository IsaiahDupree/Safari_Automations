# Twitter/X Automation — Complete Reference

**Last updated:** 2026-03-01 · **Status:** ✅ Production-verified  
**Ports:** 3003 (DM) · 3007 (Comments/Research)  
**Packages:** `packages/twitter-dm/` · `packages/twitter-comments/`  
**Account:** @IsaiahDupree7 · `https://x.com/IsaiahDupree7`

---

## Table of Contents

1. [Service Overview](#1-service-overview)
2. [Architecture — How It Works](#2-architecture--how-it-works)
3. [Twitter/X DOM Quirks (Critical)](#3-twitterx-dom-quirks-critical)
4. [Package: twitter-dm (Port 3003)](#4-package-twitter-dm-port-3003)
   - [SafariDriver](#41-safaridriver)
   - [DM Operations](#42-dm-operations)
   - [Types & Selectors](#43-types--selectors)
   - [AI DM Generation](#44-ai-dm-generation)
   - [CRM Integration](#45-crm-integration)
5. [Package: twitter-comments (Port 3007)](#5-package-twitter-comments-port-3007)
   - [TwitterDriver — Low-Level Layer](#51-twitterdriver--low-level-layer)
   - [postComment — 5-Step Flow](#52-postcomment--5-step-flow)
   - [AI Comment Generator](#53-ai-comment-generator)
   - [TwitterResearcher](#54-twitterresearcher)
   - [TwitterFeedbackLoop](#55-twitterfeedbackloop)
6. [All API Endpoints — DM Service (3003)](#6-all-api-endpoints--dm-service-3003)
7. [All API Endpoints — Comments Service (3007)](#7-all-api-endpoints--comments-service-3007)
8. [Selectors Reference](#8-selectors-reference)
9. [Rate Limits](#9-rate-limits)
10. [Startup & Prerequisites](#10-startup--prerequisites)
11. [Debugging Playbook](#11-debugging-playbook)
12. [Known Failure Modes & Fixes](#12-known-failure-modes--fixes)

---

## 1. Service Overview

Two separate Express API services. Both drive Twitter/X (`x.com`) via Safari + AppleScript. No private Twitter API, no credentials stored — requires a logged-in Safari tab.

### Package Structure

```
packages/twitter-dm/src/
  api/
    server.ts          ← Express routes, rate-limit counters, AI DM generation
    client.ts          ← HTTP client for inter-service calls
    index.ts           ← API exports
  automation/
    safari-driver.ts   ← SafariDriver (session management, JS execution)
    dm-operations.ts   ← Core DM functions: list/open/read/send/scroll
    types.ts           ← TypeScript interfaces + TWITTER_SELECTORS constant
    index.ts           ← Re-exports
  utils/
    dm-logger.ts       ← SQLite DM logging (logDM, getDMStats)
    scoring-service.ts ← Contact scoring (recalculateScore, getTopContacts)
    template-engine.ts ← Outreach templates + 3:1 rule enforcement
    index.ts           ← isWithinActiveHours

packages/twitter-comments/src/
  api/
    server.ts          ← Express routes for comments + AI generation
  automation/
    twitter-driver.ts  ← TwitterDriver (post nav, comment posting, rate limits)
    twitter-researcher.ts ← Market research: tweet scraping, creator ranking
    twitter-feedback-loop.ts ← Feedback system: tracker, analyzer, prompt refiner
    safari-driver.ts   ← Shared SafariDriver base
  __tests__/
    (test files)
  index.ts             ← Package re-exports
```

---

## 2. Architecture — How It Works

```
API Request (HTTP)
        │
        ├─→ Port 3003: Twitter DM Server
        │     │  In-memory rate-limit counters (hour/day)
        │     │  Active hours enforcement (9am–9pm)
        │     │  SQLite DM logging (dm-logger)
        │     │  Contact scoring (scoring-service)
        │     │  Template engine + 3:1 rule
        │     ▼
        │   dm-operations.ts
        │     ├── navigateToInbox()
        │     ├── listConversations()
        │     ├── getAllConversations()
        │     ├── getUnreadConversations()
        │     ├── openConversation(username)
        │     ├── startNewConversation(username)
        │     ├── readMessages(limit)
        │     ├── sendMessage(text)
        │     ├── sendDMByUsername(username, text)
        │     ├── sendDMFromProfileUrl(profileUrl, text)
        │     └── scrollConversation(scrollCount)
        │     ▼
        │   SafariDriver
        │     ├── executeJS(js)     ← temp .scpt file → osascript → Safari tab
        │     ├── navigateTo(url)   ← osascript: set URL of current tab
        │     └── getConfig/setConfig
        │
        └─→ Port 3007: Twitter Comments Server
              │  In-memory rate-limit counters (hour/day)
              ▼
            TwitterDriver
              ├── navigateToPost(url)   ← navigate + waitForAny(TWEET selectors)
              ├── getComments(limit)    ← JS extraction from article elements
              ├── postComment(text)     ← 5-step reliable flow (see §5.2)
              ├── checkRateLimit()      ← in-memory sliding window
              └── captureScreenshot()  ← screencapture -x on failure
```

### Safari concurrency

Both services interact with independent Safari targets. Global lock acquisition
is retired; compatibility lock endpoints always report open.

---

## 3. Twitter/X DOM Quirks (Critical)

### DraftJS / contenteditable Inputs

Twitter's text inputs are **DraftJS** React components backed by `contenteditable` divs. Plain `element.value = text` does not work. The driver uses:

```javascript
// In reply modal (twitter-driver.ts)
document.execCommand('insertText', false, text)
// Fallback: System Events keystrokes via osascript
// Fallback: pbcopy + ⌘V paste
```

### React State vs DOM State

After typing, React's internal state may not match the visible DOM. The driver **verifies** the submit button is enabled (React enables it only when its internal state has content) before submitting. If the button stays disabled, all 3 typing strategies are tried.

### DM Composer Selector Drift

Twitter periodically renames `data-testid` attributes. `TWITTER_SELECTORS` in `types.ts` tracks the current stable set. The comment driver uses multi-selector arrays (tried in order) for the most fragile selectors.

### No `element.click()` issues

Unlike LinkedIn/TikTok, Twitter responds to JS `.click()`. OS-level Quartz clicks are **not needed** for Twitter.

### URL Patterns

| Action | URL |
|--------|-----|
| Home timeline | `https://x.com/home` |
| DM inbox | `https://x.com/messages` |
| Specific conversation | `https://x.com/messages/{conv_id}` |
| Profile | `https://x.com/{username}` |
| Tweet detail | `https://x.com/{username}/status/{tweet_id}` |
| Compose | `https://x.com/compose/tweet` |

### Auth Code

If Twitter prompts for an encryption/verification code: **`7911`**

---

## 4. Package: twitter-dm (Port 3003)

### 4.1 SafariDriver

Located at `packages/twitter-dm/src/automation/safari-driver.ts`. Minimal abstraction over AppleScript + JS execution.

Key methods:
- `executeJS(script)` — writes script to temp `.scpt` file, runs via `osascript`, returns stdout
- `navigateTo(url)` — sets Safari current tab URL via AppleScript
- `getCurrentUrl()` — reads current tab URL
- `isOnTwitter()` — checks URL contains `twitter.com` or `x.com`
- `isLoggedIn()` — checks for `[data-testid="SideNav_AccountSwitcher_Button"]`
- `getConfig() / setConfig(updates)` — runtime config management

### 4.2 DM Operations

Located at `packages/twitter-dm/src/automation/dm-operations.ts`. All functions accept a `SafariDriver` instance as their last argument.

| Function | Description |
|----------|-------------|
| `navigateToInbox(driver)` | Navigate to `x.com/messages` |
| `switchTab(tab, driver)` | Switch between `'inbox'` and `'requests'` tabs |
| `listConversations(driver)` | Extract visible conversations from inbox |
| `getAllConversations(driver)` | List conversations across all tabs |
| `getUnreadConversations(driver)` | Filter to conversations with unread indicator |
| `openConversation(username, driver)` | Click a conversation by username |
| `startNewConversation(username, driver)` | New Message → search → select → confirm |
| `readMessages(limit, driver)` | Extract messages from open conversation thread |
| `sendMessage(text, driver)` | Type + send in currently open conversation |
| `sendDMByUsername(username, text, driver)` | Open conversation by username then send |
| `sendDMFromProfileUrl(profileUrl, text, driver)` | Navigate to profile → click DM button → send |
| `scrollConversation(scrollCount, driver)` | Scroll up to load older messages |

### 4.3 Types & Selectors

Located at `packages/twitter-dm/src/automation/types.ts`.

**Core Types:**
```typescript
interface DMConversation {
  username: string;
  displayName?: string;
  profilePicUrl?: string;
  lastMessage?: string;
  lastMessageAt?: string;
  unreadCount?: number;
  isVerified?: boolean;
  conversationId?: string;
}

interface DMMessage {
  text: string;
  timestamp?: string;
  isOutbound: boolean;
  mediaUrl?: string;
  messageType: 'text' | 'image' | 'video' | 'gif' | 'link';
}

interface SendMessageResult {
  success: boolean;
  error?: string;
  messageId?: string;
  verified?: boolean;
  verifiedRecipient?: string;
}
```

**Default Rate Limits:**
```typescript
const DEFAULT_RATE_LIMITS: RateLimitConfig = {
  messagesPerHour: 15,
  messagesPerDay: 100,
  minDelayMs: 90000,    // 1.5 min between messages
  maxDelayMs: 240000,   // 4 min between messages
  activeHoursStart: 9,
  activeHoursEnd: 21,
};
```

**TWITTER_SELECTORS constant** — full list of `data-testid` selectors for navigation, login detection, DM container, inbox, conversations, messages, and composer.

### 4.4 AI DM Generation

`generateAIDM()` in `packages/twitter-dm/src/api/server.ts`:

- **Model:** `gpt-4o`
- **Max tokens:** 80
- **Temperature:** 0.85
- **Max chars:** 150
- **Tone:** Professional yet witty, direct, genuine — matches Twitter's conversational register
- **Fallback** (no API key): `"Hey! Really enjoy your takes on {topic}. Would love to connect and chat more about it."`
- **Timeout:** 15 seconds with `AbortController`

```typescript
// Usage
const message = await generateAIDM({
  recipientUsername: 'someuser',
  purpose: 'networking',
  topic: 'AI automation'
});
```

### 4.5 CRM Integration

Three utilities under `packages/twitter-dm/src/utils/`:

**dm-logger.ts** — SQLite logging of every sent/received DM.
- `initDMLogger()` — creates DB on startup
- `logDM({ platform, username, messageText, isOutbound })` — append record
- `getDMStats(platform)` — aggregate stats (total sent/received, per-user counts)

**scoring-service.ts** — Contact engagement scoring.
- `initScoringService()` — initialization
- `recalculateScore(contactId)` — score one contact based on DM history
- `recalculateAllScores(platform)` — batch rescore all contacts
- `getTopContacts(platform, limit)` — sorted by score

**template-engine.ts** — Outreach templates with 3:1 value-to-ask rule enforcement.
- `initTemplateEngine()` — load templates
- `getTemplates({ lane, stage, platform })` — filter templates
- `getNextBestAction(context)` — recommend next message for a contact
- `detectFitSignals(text)` — identify buying signals in text
- `check31Rule(contactId)` — verify 3 value messages before 1 ask
- `getPendingActions(platform, limit)` — outreach queue items ready to send
- `queueOutreachAction(action)` — enqueue an outreach action
- `markActionSent(actionId)` / `markActionFailed(actionId, error)` — update status
- `getOutreachStats(platform)` — funnel metrics

---

## 5. Package: twitter-comments (Port 3007)

### 5.1 TwitterDriver — Low-Level Layer

Located at `packages/twitter-comments/src/automation/twitter-driver.ts`.

**Multi-selector fallback arrays** (tried in order, survives DOM renames):
```typescript
SELECTORS = {
  TWEET:        ['article[data-testid="tweet"]', 'article[role="article"]'],
  TWEET_TEXT:   ['[data-testid="tweetText"]', 'div[lang] > span'],
  REPLY_ICON:   ['[data-testid="reply"]', '[aria-label="Reply"]', 'button[data-testid="reply"]'],
  REPLY_INPUT:  ['[data-testid="tweetTextarea_0"]',
                 'div[role="textbox"][contenteditable="true"]',
                 '[data-testid="tweetTextarea_0RichTextInputContainer"] [contenteditable]'],
  SUBMIT_BUTTON:['[data-testid="tweetButtonInline"]', '[data-testid="tweetButton"]'],
  LOGIN_CHECK:  ['[data-testid="SideNav_NewTweet_Button"]',
                 '[data-testid="AppTabBar_Profile_Link"]',
                 '[aria-label="Profile"]'],
}
```

**Default Config:**
```typescript
DEFAULT_CONFIG: TwitterConfig = {
  timeout: 30000,
  minDelayMs: 60000,     // 1 min between comments
  maxDelayMs: 180000,    // 3 min between comments
  commentsPerHour: 10,
  commentsPerDay: 30,
  maxRetries: 3,
  screenshotOnFailure: true,
  screenshotDir: '/tmp/twitter-automation-screenshots',
}
```

**Key private methods:**
- `executeJS(script)` — temp `.scpt` file approach (same as DM driver)
- `waitForAny(selectors, timeoutMs)` — polls DOM at 400ms intervals until a selector matches
- `detectErrors()` — checks toast elements and primaryColumn for rate limit / "Something went wrong"
- `clickFirst(selectors, context)` — tries each selector, clicks first found
- `typeText(text)` — 3-strategy chain (see §5.2)
- `verifyTypedText(text)` — checks submit button enabled state (React state verification)
- `submitReply()` — clicks enabled submit button, with 5 attempts and dialog fallback
- `verifyReplyPosted(text, timeoutMs)` — polls `tweetText` elements for posted content
- `captureScreenshot(label)` — `screencapture -x` to configured dir
- `retry(label, fn, maxAttempts)` — generic retry with exponential backoff

### 5.2 postComment — 5-Step Flow

The core `postComment(text)` method implements a 5-step sequence with full retry on each step:

```
Step 1: waitForAny(TWEET selectors, 8s)
        → clickFirst(REPLY_ICON selectors)
        
Step 2: waitForAny(REPLY_INPUT selectors, 8s)
        → reply input ready

Step 3: typeText(text)  [3-strategy chain]
        Strategy 1: document.execCommand('insertText') — DraftJS compatible
        Strategy 2: System Events keystrokes via osascript — OS-level bypass
        Strategy 3: pbcopy + ⌘V clipboard paste — last resort
        → verifyTypedText() checks submit button is enabled (React state)

Step 4: submitReply()
        Strategy 1: click data-testid="tweetButtonInline" or "tweetButton"
        Strategy 2: find button in [role="dialog"] with text "Reply"/"Post"
        5 polling attempts at 800ms intervals

Step 5: verifyReplyPosted(text, 12s)
        → polls tweetText elements for snippet match
```

**On all retries exhausted:**
- Captures screenshot to `/tmp/twitter-automation-screenshots/twitter-post-failure-{ts}.png`
- Returns `{ success: false, error, strategy, attempts, durationMs, screenshotPath }`

**Successful response:**
```typescript
{
  success: true,
  commentId: 'tw_1234567890',
  verified: true,              // reply text found in DOM
  strategy: 'execCommand',     // which typing strategy worked
  attempts: 1,
  durationMs: 4231
}
```

### 5.3 AI Comment Generator

`generateAIComment()` in `packages/twitter-comments/src/api/server.ts`:

- **Model:** `gpt-4o`
- **Max tokens:** 50
- **Temperature:** 0.85
- **Max chars:** 100
- **Tone:** Short, witty, 1 emoji
- **System prompt:** "You are a Twitter/X user. Generate SHORT, witty comments (max 100 chars) with 1 emoji. Be concise and clever."
- **Fallback templates** (no API key): `["This! 💯", "Exactly what I was thinking 🎯", "Well said 👏", "Facts 🔥"]`
- **Timeout:** 15 seconds

### 5.4 TwitterResearcher

Located at `packages/twitter-comments/src/automation/twitter-researcher.ts`. Exported as `TwitterResearcher`.

**Purpose:** Market research automation — search for tweets by niche, extract engagement metrics, identify top creators, and persist results.

**Default Config:**
```typescript
DEFAULT_RESEARCH_CONFIG: ResearchConfig = {
  tweetsPerNiche: 1000,
  creatorsPerNiche: 100,
  scrollPauseMs: 1500,
  maxScrolls: 200,
  searchTab: 'top',         // 'top' | 'latest' | 'people' | 'media'
  timeout: 30000,
  outputDir: '~/Documents/twitter-research',
  maxRetries: 3,
}
```

**Key methods:**
- `searchNiche(niche, config?)` → `NicheResult` — full research run for a niche
- `searchTweets(query, config?)` → `ResearchTweet[]` — search and extract tweets
- `extractTweets(limit?)` → `ResearchTweet[]` — extract tweets from current page
- `getTopCreators(tweets)` → `Creator[]` — rank creators by engagement
- `saveResults(niche, result)` — persist to `~/Documents/twitter-research/{niche}/`
- `acquireGatewayLock()` / `releaseGatewayLock()` — Safari Gateway coordination

**Extracted per tweet:**
```typescript
interface ResearchTweet {
  username: string;
  displayName: string;
  text: string;
  likes: number;
  retweets: number;
  replies: number;
  views: number;
  url: string;
  timestamp: string;
}
```

**Extracted per creator:**
```typescript
interface Creator {
  handle: string;
  totalEngagement: number;
  topPost: ResearchTweet;
  postCount: number;
}
```

**Used by:** The `market-research` package (port 3106) calls TwitterResearcher for the `/api/research/twitter` endpoint.

### 5.5 TwitterFeedbackLoop

Located at `packages/twitter-comments/src/automation/twitter-feedback-loop.ts`. Three classes + orchestrator.

**Default Config:**
```typescript
DEFAULT_FEEDBACK_CONFIG: FeedbackLoopConfig = {
  dataDir: '~/.twitter-feedback',
  checkBackPeriods: [3600000, 14400000, 86400000],  // 1h, 4h, 24h
  classificationThresholds: {
    viral: 95,    // top 5% engagement → viral
    strong: 80,   // top 20% → strong
    average: 50,  // median → average
    weak: 20,     // bottom 20% → weak
  },
  maxHistorySize: 500,
  twitterProfileUrl: '',
}
```

**TweetPerformanceTracker** — monitors tweet engagement over time.
- `trackTweet(tweetUrl, offerContext, nicheContext)` — add tweet to tracking
- `checkBackTweet(tweet)` — extract current metrics via Safari automation
- `runCheckBacks()` — check all tweets due for a check-back
- Persists to `~/.twitter-feedback/tweets.json`

**EngagementAnalyzer** — classifies performance and finds patterns.
- `classifyPerformance(tweet)` → `'viral' | 'strong' | 'average' | 'weak'`
- `analyzePatterns(tweets)` — identifies what hooks, CTAs, formats perform best
- `getTopPerformers(tweets, n)` — ranked by composite engagement score

**PromptRefiner** — generates optimized tweet creation prompts.
- `refinePrompts(analysis, context)` → `StrategyContext` with refined prompts
- Uses pattern analysis to emphasize winning formulas
- Persists refined prompts to `~/.twitter-feedback/prompts.json`

**TwitterFeedbackLoop** — orchestrates the full loop.
- `run(offerContext, nicheContext)` — full cycle: checkbacks → analyze → refine prompts
- `start(intervalMs)` — start recurring loop
- `stop()` — stop the loop

**Environment variable:** `SAFARI_CHECKBACKS_ENABLED=true` enables tweet check-backs.

---

## 6. All API Endpoints — DM Service (3003)

Start with: `TWITTER_DM_PORT=3003 npx tsx packages/twitter-dm/src/api/server.ts`

### Health & Status
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | `{ status: 'ok', service: 'twitter-dm', timestamp }` |
| `GET` | `/api/twitter/status` | `{ isOnTwitter, isLoggedIn, currentUrl, driverConfig }` |

### Rate Limits
| Method | Path | Body / Notes |
|--------|------|--------------|
| `GET` | `/api/twitter/rate-limits` | `{ messagesSentToday, messagesSentThisHour, limits, activeHours }` |
| `PUT` | `/api/twitter/rate-limits` | `Partial<RateLimitConfig>` — update any limit field |

### Navigation
| Method | Path | Body |
|--------|------|------|
| `POST` | `/api/twitter/inbox/navigate` | — navigate to x.com/messages |
| `POST` | `/api/twitter/inbox/tab` | `{ tab: 'inbox' \| 'requests' }` |

### Conversations
| Method | Path | Body / Notes |
|--------|------|--------------|
| `GET` | `/api/twitter/conversations` | `{ conversations[], count }` — current inbox tab |
| `GET` | `/api/twitter/conversations/all` | `{ conversations: {tab: []}, totalCount }` — all tabs |
| `GET` | `/api/twitter/conversations/unread` | `{ conversations[], count }` — unread only |
| `POST` | `/api/twitter/conversations/open` | `{ username }` — click existing conversation |
| `POST` | `/api/twitter/conversations/new` | `{ username }` — start new conversation |
| `POST` | `/api/twitter/conversations/scroll` | `{ scrollCount?: number }` → `{ totalMessages }` |

### Messages
| Method | Path | Body / Notes |
|--------|------|--------------|
| `GET` | `/api/twitter/messages` | `?limit=20` → `{ messages[], count }` |
| `POST` | `/api/twitter/messages/send` | `{ text }` — send in open conversation (rate-limited) |
| `POST` | `/api/twitter/messages/send-to` | `{ username, text }` — open + send + log to DM logger (rate-limited) |
| `POST` | `/api/twitter/messages/send-to-url` | `{ profileUrl, text }` — profile → DM button → send (rate-limited) |

All send endpoints return: `{ success, verified?, verifiedRecipient?, error?, rateLimits: { messagesSentToday, messagesSentThisHour } }`

### CRM Stats
| Method | Path | Body / Notes |
|--------|------|--------------|
| `GET` | `/api/twitter/crm/stats` | Aggregate DM stats from SQLite |
| `POST` | `/api/twitter/crm/score` | `{ contactId }` — recalculate one contact's score |
| `POST` | `/api/twitter/crm/score-all` | Batch rescore all Twitter contacts |
| `GET` | `/api/twitter/crm/top-contacts` | `?limit=10` → top contacts by score |

### Template Engine
| Method | Path | Body / Notes |
|--------|------|--------------|
| `GET` | `/api/twitter/templates` | `?lane=&stage=` → `{ templates[], count }` |
| `POST` | `/api/twitter/templates/next-action` | `{ username, ...context }` → recommended next action |
| `POST` | `/api/twitter/templates/fit-signals` | `{ text }` → detect buying signals |
| `GET` | `/api/twitter/templates/rule-check/:contactId` | Check 3:1 rule compliance |

### Outreach Queue
| Method | Path | Body / Notes |
|--------|------|--------------|
| `GET` | `/api/twitter/outreach/pending` | `?limit=10` → queued actions ready to send |
| `POST` | `/api/twitter/outreach/queue` | `{ contact_id, message, ...metadata }` — enqueue |
| `POST` | `/api/twitter/outreach/:actionId/sent` | Mark action as sent |
| `POST` | `/api/twitter/outreach/:actionId/failed` | `{ error }` — mark as failed |
| `GET` | `/api/twitter/outreach/stats` | Funnel metrics across queue |

### AI DM Generation
| Method | Path | Body |
|--------|------|------|
| `POST` | `/api/twitter/ai/generate` | `{ username, purpose?: string, topic?: string }` → `{ message, aiEnabled }` |

### Advanced
| Method | Path | Body |
|--------|------|------|
| `POST` | `/api/twitter/execute` | `{ script }` — raw JS execution in Safari tab |
| `PUT` | `/api/twitter/config` | Driver config updates |

---

## 7. All API Endpoints — Comments Service (3007)

Start with: `SAFARI_RESEARCH_ENABLED=true PORT=3007 npx tsx packages/twitter-comments/src/api/server.ts`

| Method | Path | Body / Notes |
|--------|------|--------------|
| `GET` | `/health` | `{ status: 'ok', service: 'twitter-comments', port, timestamp }` |
| `GET` | `/api/twitter/status` | `{ isOnTwitter, isLoggedIn, currentUrl, commentsThisHour, commentsToday, limits }` |
| `GET` | `/api/twitter/rate-limits` | `{ commentsThisHour, commentsToday, limits }` |
| `PUT` | `/api/twitter/rate-limits` | `Partial<TwitterConfig>` |
| `POST` | `/api/twitter/navigate` | `{ url }` — navigate to a tweet URL |
| `GET` | `/api/twitter/comments` | `?limit=50` → `{ comments[{username, text}], count }` |
| `POST` | `/api/twitter/comments/post` | `{ text?, postUrl?, useAI?, postContent?, username? }` → `{ success, commentId, verified, generatedComment, usedAI, ... }` |
| `POST` | `/api/twitter/comments/generate` | `{ postContent?, username? }` → `{ success, comment, usedAI }` |
| `GET` | `/api/twitter/config` | Current TwitterDriver config |
| `PUT` | `/api/twitter/config` | Update TwitterDriver config |

**`POST /api/twitter/comments/post` behavior:**
- If `postUrl` provided: navigates there first (3s wait), then posts
- If `useAI: true` or no `text`: generates via GPT-4o
- If `text` provided: posts directly
- Returns `verified: true` if reply text found in DOM after posting

---

## 8. Selectors Reference

### Stable `data-testid` Selectors

| Element | Selector |
|---------|----------|
| Account switcher (login check) | `[data-testid="SideNav_AccountSwitcher_Button"]` |
| New tweet button | `[data-testid="SideNav_NewTweet_Button"]` |
| New DM button | `[data-testid="NewDM_Button"]` |
| DM nav link | `[data-testid="AppTabBar_DirectMessage_Link"]` |
| Profile nav link | `[data-testid="AppTabBar_Profile_Link"]` |
| DM timeline container | `[data-testid="DM_timeline"]` |
| Conversation item | `[data-testid="conversation"]` |
| Message entry | `[data-testid="messageEntry"]` |
| DM search bar | `[data-testid="SearchBox_Search_Input"]` |
| DM composer textarea | `[data-testid="dm-composer-textarea"]` |
| DM send button | `[data-testid="dm-composer-send-button"]` |
| Send DM from profile | `[data-testid="sendDMFromProfile"]` |
| Tweet article | `article[data-testid="tweet"]` |
| Tweet text | `[data-testid="tweetText"]` |
| Reply button | `[data-testid="reply"]` |
| Reply textarea (compose) | `[data-testid="tweetTextarea_0"]` |
| Submit tweet/reply | `[data-testid="tweetButtonInline"]` |
| Submit tweet (modal) | `[data-testid="tweetButton"]` |
| Toast notification | `[data-testid="toast"]` |

### Login Detection
```javascript
// Logged in
!!document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]')
// Not logged in
!!document.querySelector('[data-testid="loginButton"]') ||
!!document.querySelector('a[href="/login"]')
```

### DM Composer Typing (DraftJS)
```javascript
const input = document.querySelector('[data-testid="dm-composer-textarea"]')
  || document.querySelector('[data-testid="dmComposerTextInput"]');
input.focus();
document.execCommand('insertText', false, messageText);
input.dispatchEvent(new InputEvent('input', { bubbles: true }));
```

### Reply Flow
```javascript
// Click reply on first tweet
document.querySelector('[data-testid="reply"]').click();
// Wait for textarea
const input = document.querySelector('[data-testid="tweetTextarea_0"]');
input.focus();
document.execCommand('insertText', false, replyText);
// Click submit (wait for it to be enabled)
document.querySelector('[data-testid="tweetButtonInline"]').click();
```

### Engagement Metrics Extraction
```javascript
// From a tweet article element
const tweet = document.querySelector('article[data-testid="tweet"]');
const metrics = {};
tweet.querySelectorAll('[role="group"] button').forEach(btn => {
  const label = btn.getAttribute('aria-label') || '';
  const match = label.match(/(\d+)\s*(like|repl|repost|view)/i);
  if (match) metrics[match[2].toLowerCase()] = parseInt(match[1]);
});
```

---

## 9. Rate Limits

### DM Service (Port 3003)

| Limit | Default | Configurable via |
|-------|---------|-----------------|
| Messages per hour | 15 | `PUT /api/twitter/rate-limits` |
| Messages per day | 100 | `PUT /api/twitter/rate-limits` |
| Min delay between DMs | 90s (1.5 min) | `minDelayMs` |
| Max delay between DMs | 240s (4 min) | `maxDelayMs` |
| Active hours | 9am–9pm | `activeHoursStart/End` |

Returns HTTP 429 when exceeded. Response includes `{ error: 'Hourly rate limit exceeded' }` or `{ error: 'Outside active hours', activeHours: '9:00 - 21:00' }`.

### Comments Service (Port 3007)

| Limit | Default | Configurable via |
|-------|---------|-----------------|
| Comments per hour | 10 | `PUT /api/twitter/config { commentsPerHour }` |
| Comments per day | 30 | `PUT /api/twitter/config { commentsPerDay }` |
| Min delay between comments | 60s | `minDelayMs` |
| Max delay between comments | 180s | `maxDelayMs` |

Rate limits are enforced in-memory via a `commentLog` sliding window (not persisted across restarts).

### Twitter Platform Limits (Recommended Maximums)

```
DMs:      ≤ 15/hour, ≤ 100/day, ≥ 90s between sends
Comments: ≤ 10/hour, ≤ 30/day, ≥ 60s between posts
Searches: ≤ 50 searches/hour (researcher)
```

---

## 10. Startup & Prerequisites

### Prerequisites
1. macOS with Safari open and logged in to `x.com` as @IsaiahDupree7
2. Safari → Settings → Advanced → "Allow Remote Automation" enabled
3. Node.js + `npx tsx` available
4. `OPENAI_API_KEY` in environment (optional — enables AI generation)

### Start Commands
```bash
# Twitter DM server (port 3003)
cd "Safari Automation"
PORT=3003 npx tsx packages/twitter-dm/src/api/server.ts

# Twitter Comments server (port 3007)
cd "Safari Automation"
SAFARI_RESEARCH_ENABLED=true PORT=3007 npx tsx packages/twitter-comments/src/api/server.ts

# With AI enabled
OPENAI_API_KEY=sk-... PORT=3003 npx tsx packages/twitter-dm/src/api/server.ts
OPENAI_API_KEY=sk-... SAFARI_RESEARCH_ENABLED=true PORT=3007 npx tsx packages/twitter-comments/src/api/server.ts
```

### Health Checks
```bash
curl http://localhost:3003/health
curl http://localhost:3007/health
```

### Safari Gateway Integration
Both services register with the Safari Gateway (port 3000). The gateway tracks them:
- Port 3003 → service `twitter-dm`, platform `twitter`
- Port 3007 → service `twitter-comments`, platform `twitter`

Start the gateway before running automated workflows:
```bash
npx tsx packages/scheduler/src/safari-gateway.ts
```

---

## 11. Debugging Playbook

### Check if logged in
```bash
curl http://localhost:3003/api/twitter/status
# Expect: { "isLoggedIn": true, "isOnTwitter": true }
```

### Check rate limits
```bash
curl http://localhost:3003/api/twitter/rate-limits
curl http://localhost:3007/api/twitter/rate-limits
```

### Navigate to inbox manually
```bash
curl -X POST http://localhost:3003/api/twitter/inbox/navigate
```

### Send a test DM
```bash
curl -X POST http://localhost:3003/api/twitter/messages/send-to \
  -H "Content-Type: application/json" \
  -d '{"username": "someuser", "text": "Hey, testing automation!"}'
```

### Test AI DM generation (no Safari needed)
```bash
curl -X POST http://localhost:3003/api/twitter/ai/generate \
  -H "Content-Type: application/json" \
  -d '{"username": "someuser", "purpose": "networking", "topic": "AI automation"}'
```

### Post a comment
```bash
# Navigate to tweet first
curl -X POST http://localhost:3007/api/twitter/navigate \
  -H "Content-Type: application/json" \
  -d '{"url": "https://x.com/someuser/status/1234567890"}'

# Post comment
curl -X POST http://localhost:3007/api/twitter/comments/post \
  -H "Content-Type: application/json" \
  -d '{"text": "Great point!", "useAI": false}'
```

### Run market research
```bash
curl -X POST http://localhost:3007/api/twitter/research \
  -H "Content-Type: application/json" \
  -d '{"niche": "solopreneur", "config": {"tweetsPerNiche": 50}}'
```

### Check screenshots on failure
```bash
ls /tmp/twitter-automation-screenshots/
```

### Execute raw JS in Safari
```bash
curl -X POST http://localhost:3003/api/twitter/execute \
  -H "Content-Type: application/json" \
  -d '{"script": "return document.title"}'
```

---

## 12. Known Failure Modes & Fixes

### "No tweet found on page" (comment driver)
- **Cause:** Tweet page not loaded, login wall, or 404.
- **Fix:** Check login status. Navigate to the tweet URL in Safari and verify it loads. Call `navigateToPost(url)` then wait 3s before `postComment()`.

### Reply textarea never appears
- **Cause:** Twitter rolled out a UI change; reply icon selector no longer matches.
- **Fix:** Update `SELECTORS.REPLY_ICON` array in `twitter-driver.ts`. Run the selector investigation script from `TWITTER_SELECTORS_REFERENCE.md`.

### All typing strategies failed
- **Cause:** DraftJS state didn't update; seen on older macOS or when Safari isn't frontmost.
- **Fix:** Ensure Safari is the active window. The keystrokes strategy requires Safari to be frontmost. Strategy 3 (clipboard) is the most reliable fallback.

### Submit button never enabled
- **Cause:** Text typed visually but React internal state empty (execCommand didn't fire proper events).
- **Fix:** The driver falls back to keystrokes then clipboard. If all 3 fail, there may be a CSRF or captcha overlay — check for `[data-testid="toast"]` content.

### Rate limit 429 during active hours
- **Cause:** Hourly counter full. In-memory counter resets every 60 minutes.
- **Fix:** Reduce frequency. Adjust limits: `PUT /api/twitter/rate-limits { "messagesPerHour": 10 }`.

### "Outside active hours" 429
- **Cause:** Current hour is outside `activeHoursStart`–`activeHoursEnd`.
- **Fix:** Change active hours: `PUT /api/twitter/rate-limits { "activeHoursStart": 0, "activeHoursEnd": 24 }` (disable restriction).

### DM composer selector not found
- **Cause:** Twitter renamed `dm-composer-textarea`. The `TWITTER_SELECTORS` constant in `types.ts` has the current set.
- **Fix:** Run `executeJS` to dump all `data-testid` elements on the DM page and update `types.ts`.

### Research produces 0 results
- **Cause:** `SAFARI_RESEARCH_ENABLED` not set, or Twitter search page not returning tweets (rate limited at platform level).
- **Fix:** Set `SAFARI_RESEARCH_ENABLED=true`. Wait 15 minutes if platform-rate-limited. Reduce `scrollPauseMs` if the page is slow to load.

### Screenshot capture fails
- **Cause:** `screencapture` permission not granted or directory doesn't exist.
- **Fix:** Grant Screen Recording permission to Terminal in macOS Privacy settings. The driver auto-creates the directory.

### Feedback loop check-back stuck
- **Cause:** `SAFARI_CHECKBACKS_ENABLED` not set, or tweet URL 404'd (deleted tweet).
- **Fix:** Set `SAFARI_CHECKBACKS_ENABLED=true`. Deleted tweets will produce empty metrics — they are still recorded (zeros).

---

*For selector updates after Twitter DOM changes, run the investigation snippet in `TWITTER_SELECTORS_REFERENCE.md` and update `packages/twitter-dm/src/automation/types.ts` (TWITTER_SELECTORS) and `packages/twitter-comments/src/automation/twitter-driver.ts` (SELECTORS).*
