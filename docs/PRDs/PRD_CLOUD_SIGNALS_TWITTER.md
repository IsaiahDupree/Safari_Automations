# PRD: Twitter Cloud Signals & Automation Gaps

**Platform**: Twitter (X)
**Services**: DM (port 3003), Comments/Compose (port 3007)
**Cloud Sync Poller**: `packages/cloud-sync/src/pollers/twitter-poller.ts`
**Last Updated**: 2026-02-28

---

## 1. Current Status (What's Working)

| Signal | Status | Source | Notes |
|---|---|---|---|
| DM conversations | ✅ Polling | Port 3003 `/api/twitter/conversations` | Opens each convo, reads last 5 messages |
| DM message text | ✅ Polling | Port 3003 `/api/twitter/messages` | Text, sender, timestamp, read status |
| Unread DM notifications | ✅ Polling | Port 3003 unread conversations | Pushed as `notification_type: 'dm'` |
| Engagement notifications | ✅ Polling | Port 3007 `/api/search` for own tweets | Likes + replies count per tweet |
| Post stats (views, likes, retweets, replies) | ✅ Polling | Port 3007 `/api/search` for `from:@isaiahdupree` | Engagement rate calculated |
| Tweet posting | ✅ Available | Port 3007 `POST /api/twitter/tweet` | AI generation, polls, threads, media, scheduling |
| Tweet replies | ✅ Available | Port 3007 `POST /api/twitter/tweet/reply` | Manual or AI-generated replies |
| Search & discovery | ✅ Available | Port 3007 `POST /api/twitter/search` | Top/Latest/People/Media tabs |
| DM sending | ✅ Available | Port 3003 `/api/twitter/dm` | Profile-to-DM flow, verified delivery |

## 2. Signals Needed (Not Yet Implemented)

### 2a. Comment/Reply Text + Sentiment — **HIGH PRIORITY**

**What we need**: Full text of replies to our tweets, replier username/handle, timestamp, like count per reply, quote tweets of our content.

**Why it matters**: Replies are Twitter's primary engagement signal. Reply text reveals audience questions, disagreements, amplifications, and content ideas. Quote tweets show how our content is being reframed.

**How to get it** (VERIFIED 2026-02-28):
- Comments service (port 3007) already has these endpoints:
  - `GET /api/twitter/comments?limit=50` → returns `{username, text, timestamp}` from current page
  - `POST /api/twitter/tweet/detail` → full tweet detail with all replies (navigate to tweet URL)
  - `POST /api/twitter/search` → search results with engagement (`from:@isaiahdupree` for own posts)
  - `POST /api/twitter/timeline` → user timeline posts
  - `POST /api/twitter/tweet/reply` → reply to any tweet (manual or AI-generated)
  - `POST /api/twitter/comments/generate` → AI comment generation
- Quote tweets discoverable via `POST /api/twitter/search` with tweet URL as query
- **Zero new Safari automation needed** — just wire existing endpoints to Supabase

**Cloud actions enabled**:
- Classify question replies → generate thread follow-ups answering them
- Identify high-follower repliers → prioritize for DM outreach / relationship building
- Detect negative sentiment / ratio'd tweets → adjust content strategy
- Find quote tweets → engage with them (like, reply, retweet)
- Extract recurring questions → create FAQ threads

**Implementation**:
1. Add `pollComments()` method to `TwitterPoller`
2. For recent tweets from `post_stats`, call `/api/twitter/tweet/detail` to get replies
3. Store in `platform_comments` table (shared schema)
4. Add sentiment/intent classification

---

### 2b. Bookmark Count + Save Rate — **MEDIUM PRIORITY**

**What we need**: Bookmark count per tweet (visible in tweet detail since X Premium).

**Why it matters**: Bookmarks indicate "save for later" intent — the strongest signal of valuable content. A tweet with high bookmarks relative to likes indicates reference-quality content.

**How to get it**:
- Already partially captured — `POST /api/twitter/tweet/detail` returns bookmark count
- Need to ensure `bookmarks` field is flowing through to `post_stats`

**Cloud actions enabled**:
- Identify "reference content" (high bookmark:like ratio) → create more of same format
- Correlate bookmark rate with content type → optimize for value-dense threads

**Implementation**:
1. Add `bookmarks` field to `PostStats` type and `post_stats` table (if not already present)
2. Update `TwitterPoller.pollPostStats()` to include bookmarks from search/detail results
3. Calculate bookmark rate as metric

---

### 2c. New Follower Notifications — **MEDIUM PRIORITY**

**What we need**: New follower username, bio, follower count, verified status, which tweet potentially drove the follow.

**Why it matters**: Twitter follows are high-intent signals in B2B — someone following after seeing a tweet is expressing interest in your expertise. Bio analysis identifies ICP-aligned followers.

**How to get it** (VERIFIED 2026-02-28):
- **Notifications page** at `/notifications` confirmed scrapable:
  - Like notifications: `"Julius liked your post · 3h"` with post text preview
  - Reply notifications: Full reply text with @mention and timestamp
  - Notification cells: `[data-testid="cellInnerDiv"]` — 21 cells observed
  - Tabs: **All** and **Mentions** only — **no dedicated follower tab**
  - Follower notifications mixed into "All" feed (harder to parse than Instagram's clean separation)
  - 7 "follow" mentions found in page text
- ⚠️ Less structured than Instagram activity feed — would need regex/heuristic parsing to separate follow notifications from other types

**Cloud actions enabled**:
- New follower → check bio for ICP keywords → auto-DM or add to CRM
- Track follower growth per tweet → identify which tweet topics drive follows
- Welcome thread or DM for high-value new followers

**Implementation**:
1. Add notifications page scraper to Twitter comments service
2. Navigate to `twitter.com/notifications` → filter for follows
3. Store in `platform_notifications` with `notification_type: 'follow'`
4. Cross-reference with recent tweets to attribute follow source

---

### 2d. DM Intent Classification — **MEDIUM PRIORITY**

**What we need**: DM text classification (lead, question, spam, partnership, fan), conversation thread context, time-to-first-reply, lead score.

**Why it matters**: DMs are already polled but not classified. Raw DM text in Supabase without intent classification creates manual review overhead.

**How to get it**:
- No new scraping needed — classification runs on existing `platform_dms` data
- Use OpenAI or rule-based classifier on `message_text` field
- Calculate response time from timestamps

**Cloud actions enabled**:
- Route lead-intent DMs to CRM pipeline with lead score
- Generate reply suggestions for common question types
- Auto-reply to spam/off-topic DMs
- Trigger follow-up sequences for unresponded leads after 24h

**Implementation**:
1. Add classification function (OpenAI or rules) that runs after DM sync
2. Add `intent_type`, `lead_score`, `suggested_reply` columns to `platform_dms`
3. Create `cloud_action_queue` entries for high-priority DMs needing replies

---

### 2e. Engagement Anomaly Detection — **LOW PRIORITY**

**What we need**: Rolling engagement rate tracking, deviation alerts.

**Why it matters**: Twitter's algorithm changes frequently. Detecting engagement drops early enables content strategy pivots.

**How to get it**:
- Computed from existing `post_stats` data
- Twitter-specific: monitor impressions-to-follower ratio as distribution signal

**Implementation**:
1. Analytics query on `post_stats` where `platform = 'twitter'`
2. Compare last 7 posts against 30-day rolling average
3. Alert if views drop >40% or engagement rate drops >30%

---

## 3. Priority Roadmap

| # | Signal | Priority | Effort | Dependencies |
|---|---|---|---|---|
| 1 | Reply/comment text + sentiment | **High** | Medium | Tweet detail endpoint already exists |
| 2 | Bookmark count in post stats | Medium | Low | Data likely already in raw_data, just needs mapping |
| 3 | New follower notifications | Medium | Medium | Needs notifications page scraper |
| 4 | DM intent classification | Medium | Medium | No scraping; ML/rules on existing data |
| 5 | Engagement anomaly detection | Low | Low | Pure analytics on existing post_stats |

## 4. Supabase Schema Additions Needed

```sql
-- platform_comments (shared table — see TikTok PRD for full schema)

-- post_stats additions for Twitter-specific metrics
-- ALTER TABLE post_stats ADD COLUMN bookmarks integer DEFAULT 0;
-- ALTER TABLE post_stats ADD COLUMN quote_tweets integer DEFAULT 0;
-- ALTER TABLE post_stats ADD COLUMN bookmark_rate numeric;

-- platform_dms additions for intent classification
-- ALTER TABLE platform_dms ADD COLUMN intent_type text;
-- ALTER TABLE platform_dms ADD COLUMN lead_score integer;
-- ALTER TABLE platform_dms ADD COLUMN suggested_reply text; -- already exists
```

## 5. Service Architecture

```
Twitter DM Service (3003)          Twitter Comments Service (3007)
  ├─ /api/twitter/conversations      ├─ /api/twitter/search
  ├─ /api/twitter/messages           ├─ /api/twitter/tweet (compose)
  ├─ /api/twitter/dm (send)          ├─ /api/twitter/tweet/reply
  └─ /health                         ├─ /api/twitter/tweet/detail
                                     ├─ /api/twitter/timeline
                                     ├─ /api/twitter/feed
                                     └─ /health
                    ↓                              ↓
              Twitter Poller (cloud-sync)
              ├─ pollDMs() ✅
              ├─ pollNotifications() ✅ (DMs + engagement counts)
              ├─ pollPostStats() ✅ (views, likes, retweets, replies)
              ├─ pollComments() [NEW] (reply text via tweet/detail)
              └─ pollFollowers() [NEW] (notifications page)
                    ↓
              Supabase
              ├─ platform_dms ✅
              ├─ platform_notifications ✅
              ├─ post_stats ✅
              ├─ platform_comments [NEW]
              └─ platform_dms.intent_type [NEW]
```
