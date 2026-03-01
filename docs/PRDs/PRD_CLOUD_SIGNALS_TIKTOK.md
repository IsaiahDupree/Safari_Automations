# PRD: TikTok Cloud Signals & Automation Gaps

**Platform**: TikTok
**Services**: DM (port 3102), Comments (port 3006), Market Research (port 3106)
**Cloud Sync Poller**: `packages/cloud-sync/src/pollers/tiktok-poller.ts`
**Last Updated**: 2026-02-28

---

## 1. Current Status (What's Working)

| Signal | Status | Source | Notes |
|---|---|---|---|
| DM conversations | ✅ Polling | Port 3102 `/api/tiktok/conversations` | Opens each convo, reads last 5 messages |
| DM message text | ✅ Polling | Port 3102 `/api/tiktok/messages` | Text, sender, timestamp, read status |
| Unread DM notifications | ✅ Polling | Port 3102 conversations unread flag | Pushed as `notification_type: 'dm'` |
| Post stats (views, likes, comments, shares, saves) | ✅ Polling | Port 3006 `/api/search` for `@isaiahdupree` | Engagement rate calculated |
| Comment posting | ✅ Available | Port 3006 `/api/tiktok/comment` | Can post comments on any video URL |
| DM sending | ✅ Available | Port 3102 `/api/tiktok/dm` | Pre-send identity verification, Quartz clicks |

## 2. Signals Needed (Not Yet Implemented)

### 2a. Comment Text + Sentiment — **HIGH PRIORITY**

**What we need**: Full text of comments on our own posts, commenter username, timestamp, like count per comment, reply threads.

**Why it matters**: Comments reveal audience questions, objections, testimonials, and content requests. Sentiment classification enables automated content brief generation.

**How to get it** (VERIFIED 2026-02-28):
- Comments service (port 3006) already has `GET /api/tiktok/comments?limit=50` → returns `{username, text, timestamp}`
- TikTok Studio Comments page at `/tiktokstudio/comment` shows ALL comments with: username, text, timestamp, like count, Reply/Delete actions
- Filters available on Studio: All comments, Posted by all, Follower count, Comment date
- **Zero new Safari automation needed** — just wire existing endpoints to Supabase

**Cloud actions enabled**:
- Classify question-type comments → generate FAQ content briefs
- Identify testimonial comments → repurpose as social proof
- Detect negative sentiment → flag for manual review
- Auto-reply to questions with AI-generated responses

**Implementation**:
1. Add `pollComments()` method to `TikTokPoller`
2. For top N posts (by recency or engagement), call comments service to extract comment text
3. Create `platform_comments` table: `id, platform, post_id, post_url, commenter_username, comment_text, likes, is_reply, parent_comment_id, sentiment, intent_type, raw_data, synced_at, dedup_key`
4. Add `syncComments()` to `CloudSupabase`
5. Wire into sync engine poll cycle

---

### 2b. Watch Time / Completion Rate — **HIGH PRIORITY**

**What we need**: Average watch time, completion rate (% who watched to end), traffic source breakdown, audience demographics per video.

**Why it matters**: Completion rate is TikTok's #1 ranking signal. A video with 50% completion and 10K views will outperform one with 10% completion and 100K views on future distribution. This data drives hook optimization.

**How to get it** (VERIFIED 2026-02-28):
- **Per-video URL**: `https://www.tiktok.com/tiktokstudio/analytics/{videoId}/overview`
- Confirmed scrapable fields from live DOM:
  - `Video views`: 2.2K
  - `Total play time`: 1h:8m:13s
  - `Average watch time`: 2.12s
  - `Watched full video`: 0.2% ← **completion rate**
  - `New followers`: 29 (per-video follower attribution!)
  - `Retention rate`: "Most viewers stopped watching at 0:01" with timestamp + % curve
  - `Traffic source`: FYP 85.3%, Profile 11.3%, Following 2.7%, Search 0.2%
  - `Search queries`: specific terms that led to this video
- **Content tab** (`/tiktokstudio/analytics/content`): lists all posts with rank, duration, caption, period views, all-time views, posted date
- **Engagement tab** (`/tiktokstudio/analytics/{videoId}/engagement`): like timing ("Most liked at 0:00"), top comment words
- **Video IDs extracted** from Content tab "View data" button clicks → navigates to per-video URL
- Time ranges: Last 7 / 28 / 60 / 365 days, Custom

**Cloud actions enabled**:
- Flag videos with <30% completion → analyze first 3 seconds for hook weakness
- Correlate hook type vs. completion rate → optimize content briefs
- Identify "slow burn" videos (low initial views, high completion) → boost with paid promotion
- Thompson Sampling on hook formats using completion rate as reward signal
- Attribute follower gains to specific videos (per-video "New followers" count)
- Identify which traffic sources drive completion (FYP vs. Search vs. Profile)

**Implementation**:
1. Add TikTok Studio scraper endpoint to comments service (port 3006)
2. Navigate to `/tiktokstudio/analytics/content` → extract video IDs from post list
3. For each video, navigate to `/tiktokstudio/analytics/{videoId}/overview` → parse innerText for metrics
4. Extend `PostStats` type with `watch_time_avg`, `completion_rate`, `total_play_time`, `retention_drop_point`, `traffic_sources`, `search_queries`, `new_followers_from_video`
5. Add columns to `post_stats` Supabase table
6. Update `TikTokPoller.pollPostStats()` to merge Studio analytics data

---

### 2c. New Follower Notifications — **MEDIUM PRIORITY**

**What we need**: New follower username, bio, follower count, which post drove the follow (if attributable), follow/unfollow delta.

**Why it matters**: Correlating content type → follower acquisition identifies what converts browsers to followers. Bio analysis identifies ICP-aligned followers for DM outreach prioritization.

**How to get it** (VERIFIED 2026-02-28):
- ⚠️ **TikTok notifications/inbox NOT accessible on web** — `/inbox` redirects to For You feed
- **Alternative**: Per-video follower attribution IS available on TikTok Studio (`/tiktokstudio/analytics/{videoId}/overview` → "New followers: 29")
- **Alternative**: TikTok Studio overview at `/tiktokstudio/analytics/overview` shows aggregate "Followers: 535" count
- Could scrape follower count daily and compute delta
- Individual follower list requires mobile app or TikTok API

**Cloud actions enabled**:
- New follower → check bio for ICP keywords → auto-DM welcome sequence
- Track follower growth per post → weight content briefs toward high-conversion formats
- Detect unfollow spikes → correlate with specific post types to avoid

**Implementation**:
1. Add follower activity endpoint to TikTok service
2. Scrape activity/notifications page for recent follows
3. Store in `platform_notifications` with `notification_type: 'follow'`
4. Optionally create dedicated `platform_followers` table for richer tracking

---

### 2d. Engagement Anomaly Detection — **MEDIUM PRIORITY**

**What we need**: Rolling average engagement rate, deviation alerts, shadowban proxy signals (reach collapse while follower count stable).

**Why it matters**: A 30%+ engagement drop over 3+ posts signals either content misalignment, shadowban, or algorithm shift. Early detection enables course correction before follower attrition.

**How to get it**:
- Computed from existing `post_stats` data in Supabase
- No new scraping needed — purely analytical layer on top of polled data

**Cloud actions enabled**:
- Alert when 3 consecutive posts are below rolling average by >30%
- Pause posting schedule + trigger content audit
- A/B test different hook styles to break out of slump
- Detect shadowban (views < 10% of follower count for 3+ posts)

**Implementation**:
1. Add anomaly detection query/function in `CloudSupabase` or separate analytics module
2. Run after each `post_stats` sync cycle
3. Store alerts in `platform_notifications` with `notification_type: 'anomaly'`
4. Optionally trigger `cloud_action_queue` entries to pause/adjust posting

---

## 3. Priority Roadmap

| # | Signal | Priority | Effort | Dependencies |
|---|---|---|---|---|
| 1 | Comment text + sentiment | **High** | Medium | Comments service already running; needs new table + poller method |
| 2 | Watch time / completion rate | **High** | High | Needs analytics page scraper (new Safari automation) |
| 3 | New follower notifications | Medium | Medium | Activity page scraper |
| 4 | Engagement anomaly detection | Medium | Low | Pure SQL/analytics on existing data |

## 4. Supabase Schema Additions Needed

```sql
-- platform_comments (shared across all platforms)
CREATE TABLE platform_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform text NOT NULL,
  post_id text NOT NULL,
  post_url text,
  commenter_username text,
  commenter_display_name text,
  comment_text text NOT NULL,
  likes integer DEFAULT 0,
  is_reply boolean DEFAULT false,
  parent_comment_id text,
  sentiment text, -- positive, negative, neutral, question
  intent_type text, -- question, testimonial, objection, request, spam
  is_actioned boolean DEFAULT false,
  action_taken text,
  raw_data jsonb DEFAULT '{}',
  platform_timestamp timestamptz,
  synced_at timestamptz DEFAULT now(),
  dedup_key text UNIQUE
);

-- post_stats additions (ALTER TABLE)
-- ALTER TABLE post_stats ADD COLUMN watch_time_avg numeric;
-- ALTER TABLE post_stats ADD COLUMN completion_rate numeric;
-- ALTER TABLE post_stats ADD COLUMN traffic_sources jsonb DEFAULT '{}';
```

## 5. Service Architecture

```
TikTok DM Service (3102)          TikTok Comments Service (3006)
  ├─ /api/tiktok/conversations      ├─ /api/search (post discovery)
  ├─ /api/tiktok/messages            ├─ /api/tiktok/comment (post comment)
  ├─ /api/tiktok/dm (send)           ├─ /api/tiktok/comment/detail [NEW]
  └─ /health                         └─ /health
                    ↓                              ↓
              TikTok Poller (cloud-sync)
              ├─ pollDMs() ✅
              ├─ pollNotifications() ✅
              ├─ pollPostStats() ✅
              ├─ pollComments() [NEW]
              └─ pollAnalytics() [NEW]
                    ↓
              Supabase
              ├─ platform_dms ✅
              ├─ platform_notifications ✅
              ├─ post_stats ✅
              ├─ platform_comments [NEW]
              └─ post_stats.completion_rate [NEW]
```
