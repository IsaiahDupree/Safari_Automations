# PRD: Threads Cloud Signals & Automation Gaps

**Platform**: Threads (Meta)
**Services**: Comments (port 3004)
**Cloud Sync Poller**: `packages/cloud-sync/src/pollers/threads-poller.ts`
**Last Updated**: 2026-02-28

---

## 1. Current Status (What's Working)

| Signal | Status | Source | Notes |
|---|---|---|---|
| Post stats (likes, comments, reposts) | ✅ Polling | Port 3004 `/api/search` for `@isaiahdupree` | No view counts (Threads doesn't expose them) |
| Engagement notifications | ✅ Polling | Port 3004 search for own posts | Posts with likes/comments flagged |
| Comment posting | ✅ Available | Port 3004 comment endpoints | Can post comments on any Threads post |
| DMs | N/A | — | Threads does not support DMs |

**Key limitation**: Threads is the most restricted platform — no DMs, no view counts, no analytics page, no follower activity feed. Signals are limited to what's visible on public post pages.

## 2. Signals Needed (Not Yet Implemented)

### 2a. Comment/Reply Text + Sentiment — **HIGH PRIORITY**

**What we need**: Full text of replies to our Threads posts, replier username, timestamp, like count per reply, nested reply threads.

**Why it matters**: Threads is conversational by design — replies are the primary engagement format. Reply text reveals audience questions, disagreements, and content ideas. Unlike other platforms, Threads replies are public and indexable, making them high-value social proof.

**How to get it** (VERIFIED 2026-02-28):
- Comments service (port 3004) already has these endpoints:
  - `GET /api/threads/comments?limit=50` → returns `{username, text, timestamp}`
  - `GET /api/threads/context` → returns `{mainPost, username, replies, likeCount, replyCount}` — full post context
  - `POST /api/threads/comments/post` → post comments on any post URL
  - `POST /api/threads/click-post` → click into a specific post by index
  - `POST /api/threads/scroll` → scroll to load more content
- Auto engagement system (`ThreadsAutoCommenter`) already has `extractContext()` with AI comment generation
- **Zero new Safari automation needed** — just wire existing endpoints to Supabase

**Cloud actions enabled**:
- Classify question replies → generate follow-up thread posts
- Identify high-engagement repliers → prioritize for relationship building
- Extract testimonials from replies → repurpose in other platform content
- Auto-reply to questions with AI-generated responses
- Track which post topics generate the most conversational replies

**Implementation**:
1. Add `pollComments()` method to `ThreadsPoller`
2. For recent posts from `post_stats`, call comments service to extract reply text
3. Store in `platform_comments` table (shared schema)
4. Add sentiment/intent classification

---

### 2b. Repost Tracking — **MEDIUM PRIORITY**

**What we need**: Who reposted our content, their follower count, the amplification reach.

**Why it matters**: Reposts on Threads are the primary distribution mechanism (no algorithm-driven For You page like TikTok). Knowing who reposts and their reach helps identify advocates and measure content virality.

**How to get it**:
- Repost count is already captured in `post_stats` via search
- Individual reposters may be visible on the post page (Threads shows "reposted by" list)
- Requires navigating to post → extracting reposter list

**Cloud actions enabled**:
- Identify top amplifiers → nurture relationship (reply to their content, mention them)
- Track repost rate by content type → optimize for shareability
- Calculate amplification reach (reposter follower count × repost count)

**Implementation**:
1. Add repost detail extraction endpoint to Threads comments service
2. Navigate to post page → extract list of reposters
3. Store in `platform_notifications` with `notification_type: 'repost'` and reposter details in `raw_data`

---

### 2c. New Follower Detection — **MEDIUM PRIORITY**

**What we need**: New follower count (Threads shows follower count on profile), follower growth delta.

**Why it matters**: Threads follower growth is hard to attribute to specific posts (no analytics), but tracking the delta per day and correlating with posting activity provides directional signal.

**How to get it**:
- Scrape own profile page → extract follower count
- Store daily snapshots → calculate growth delta
- URL: `threads.net/@isaiahdupree`

**Cloud actions enabled**:
- Track follower growth rate → correlate with posting frequency and topics
- Detect follower spikes → identify what content drove them (by timestamp proximity)
- Detect follower drops → flag potential content issues

**Implementation**:
1. Add profile scraper endpoint to Threads comments service
2. Extract follower count from profile page
3. Store daily snapshots in new `platform_follower_snapshots` table or in `platform_notifications`
4. Calculate delta in analytics layer

---

### 2d. Engagement Anomaly Detection — **LOW PRIORITY**

**What we need**: Rolling engagement rate tracking (likes + replies per post), deviation alerts.

**Why it matters**: Without view counts, engagement rate on Threads is relative (not absolute). But tracking like/reply counts against your rolling average still detects content performance shifts.

**How to get it**:
- Computed from existing `post_stats` data
- Threads-specific: use like:reply ratio as a proxy for content depth (high replies = conversation-driving)

**Cloud actions enabled**:
- Alert when 3+ posts are below rolling average
- Shift content strategy toward more conversational/question-based posts
- Identify "dead" time slots → adjust posting schedule

**Implementation**:
1. Analytics query on `post_stats` where `platform = 'threads'`
2. No new scraping needed

---

## 3. Priority Roadmap

| # | Signal | Priority | Effort | Dependencies |
|---|---|---|---|---|
| 1 | Reply/comment text + sentiment | **High** | Medium | Comments service running; needs post URLs from stats |
| 2 | Repost tracking (who reposted) | Medium | Medium | Post page scraper needed |
| 3 | Follower count snapshots | Medium | Low | Profile page scraper |
| 4 | Engagement anomaly detection | Low | Low | Pure analytics on existing data |

## 4. Supabase Schema Additions Needed

```sql
-- platform_comments (shared table — see TikTok PRD for full schema)
-- No Threads-specific columns needed; standard schema works

-- Optional: daily follower snapshots
-- CREATE TABLE platform_follower_snapshots (
--   id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
--   platform text NOT NULL,
--   follower_count integer NOT NULL,
--   following_count integer,
--   delta integer DEFAULT 0,
--   snapshot_date date DEFAULT CURRENT_DATE,
--   raw_data jsonb DEFAULT '{}',
--   created_at timestamptz DEFAULT now(),
--   UNIQUE(platform, snapshot_date)
-- );
```

## 5. Service Architecture

```
Threads Comments Service (3004)
  ├─ /api/search (post discovery) ✅
  ├─ /api/threads/comment (post comment) ✅
  ├─ /api/threads/post/detail [NEW] (reply text extraction)
  ├─ /api/threads/profile [NEW] (follower count)
  └─ /health
                    ↓
              Threads Poller (cloud-sync)
              ├─ pollDMs() — N/A (no Threads DMs)
              ├─ pollNotifications() ✅ (engagement counts)
              ├─ pollPostStats() ✅ (likes, comments, reposts)
              ├─ pollComments() [NEW] (reply text)
              └─ pollFollowerCount() [NEW] (daily snapshot)
                    ↓
              Supabase
              ├─ platform_notifications ✅
              ├─ post_stats ✅
              ├─ platform_comments [NEW]
              └─ platform_follower_snapshots [NEW]
```

## 6. Platform Constraints

- **No DMs**: Threads does not support direct messaging. All engagement is public.
- **No view counts**: Unlike TikTok/Twitter, Threads doesn't expose view or impression counts. Engagement rate must be calculated relative to your own baseline, not absolute.
- **No analytics page**: No creator dashboard or insights page. All data comes from public-facing post pages.
- **No follower activity feed**: Cannot see who followed or when — only total count on profile.
- **Meta cross-posting**: Threads posts can auto-cross-post to Instagram. Track this to avoid double-counting engagement.
