# PRD: Instagram Cloud Signals & Automation Gaps

**Platform**: Instagram
**Services**: DM (port 3100), Comments (port 3005)
**Cloud Sync Poller**: `packages/cloud-sync/src/pollers/instagram-poller.ts`
**Last Updated**: 2026-02-28

---

## 1. Current Status (What's Working)

| Signal | Status | Source | Notes |
|---|---|---|---|
| DM conversations | ✅ Polling | Port 3100 `/api/conversations` | Opens each convo, reads last 5 messages |
| DM message text | ✅ Polling | Port 3100 `/api/messages` | Text, sender, timestamp, read status |
| Unread DM notifications | ✅ Polling | Port 3100 conversations unread flag | Pushed as `notification_type: 'dm'` |
| DM sending | ✅ Available | Port 3100 `/api/dm` | Thread cache, profile fallback, verified delivery |
| Comment posting | ✅ Available | Port 3005 | Can post comments on any post URL |
| Post stats | ❌ Not polling | — | `pollPostStats()` returns empty array |

## 2. Signals Needed (Not Yet Implemented)

### 2a. Post Stats (Likes, Comments, Reach, Saves) — **HIGH PRIORITY**

**What we need**: Per-post likes, comments, shares, saves, reach, impressions, profile visits from post.

**Why it matters**: Without post stats, we can't calculate engagement rate, identify top-performing content, or feed the Thompson Sampling posting optimizer.

**How to get it** (VERIFIED 2026-02-28):
- **Instagram Insights page** at `/accounts/insights/?timeframe=30` confirmed scrapable:
  - `Views`: 33,874 (with follower/non-follower split: 1%/99%)
  - `Accounts reached`: 27,253 (by content type: Reels 52.1%, Posts 45.7%, Stories 2.2%)
  - `Interactions`: 1,181 (by content: Reels 91.7%, Posts 8.3%)
  - `Profile visits`: 1,452
  - `External link taps`: 17 ← **bio link click count!**
  - `Total followers`: 1,105
  - `Most active times`: Day × Hour heatmap (M-Su × 12a-9p) ← **optimal posting time**
- Time ranges available: Last 7 / 14 / 30 / 90 days
- ⚠️ **Per-post insights NOT available on web** — only account-level metrics. Per-post data requires mobile app.
- Option B: Comments service (port 3005) search for own posts — extract public counts (likes, comments) per post

**Cloud actions enabled**:
- Performance tier classification (viral/good/average/flop)
- Content brief optimization based on what's working
- Thompson Sampling on posting times and content formats
- Detect engagement anomalies

**Implementation**:
1. Add profile/insights page scraper endpoint to Instagram DM service or comments service
2. Navigate to own profile → click each recent post → extract stats overlay
3. Store in `post_stats` table
4. Update `InstagramPoller.pollPostStats()` to call new endpoint

---

### 2b. Comment Text + Sentiment — **HIGH PRIORITY**

**What we need**: Full text of comments on our own posts, commenter username, timestamp, like count per comment, reply threads.

**Why it matters**: Comment text reveals audience intent — questions, objections, testimonials, content requests. This is the richest signal for content strategy and sales pipeline.

**How to get it** (VERIFIED 2026-02-28):
- Comments service (port 3005) already has `GET /api/instagram/comments?limit=50` → returns `{username, text, timestamp}`
- Also has `GET /api/instagram/post` → returns post details (likes, comments count)
- Has `POST /api/instagram/navigate` to navigate to any post URL
- Has `POST /api/instagram/engage/multi` for AI-powered multi-post commenting
- Has `POST /api/instagram/search/keyword` for keyword-based post discovery
- Has `POST /api/instagram/analyze` for AI analysis of post content
- **Zero new Safari automation needed for comment extraction** — just wire existing endpoints to Supabase

**Cloud actions enabled**:
- Classify question-type comments → generate FAQ content briefs
- Identify testimonial comments → repurpose as social proof in Stories/Reels
- Detect negative sentiment → flag for manual review
- Auto-reply to questions with AI-generated responses via comments service
- Identify high-engagement commenters for DM outreach

**Implementation**:
1. Add `pollComments()` method to `InstagramPoller`
2. Use post URLs from `post_stats` or profile grid scrape
3. For top N posts, call comments service to extract comment text
4. Store in `platform_comments` table (shared schema across platforms)
5. Add sentiment classification (can use OpenAI or rule-based)

---

### 2c. Story Views / Exits — **MEDIUM PRIORITY**

**What we need**: Per-story view count, completion rate, exit rate, tap-forward/back rate, reply count, sticker interaction count.

**Why it matters**: Stories are Instagram's highest-reach format. Exit rate identifies where audience attention drops. Reply count is a direct engagement signal.

**How to get it** (VERIFIED 2026-02-28):
- ⚠️ **Story insights NOT available on Instagram web** — the Insights page at `/accounts/insights/` only shows account-level aggregates
- Per-story views, exits, tap-forward/back metrics are **mobile app only**
- The web Insights page DOES show aggregate story reach: "Stories 2.2%" of total reach
- **Workaround**: Could track story posting via DM service and correlate with account-level reach changes

**Cloud actions enabled**:
- Optimize story sequence length (exit rate analysis)
- Identify best-performing story formats (polls, questions, vs. static)
- Track reply volume as a proxy for audience connection
- Adjust story posting frequency based on view-through rates

**Implementation**:
1. Add Insights page scraper to Instagram service
2. Navigate to `instagram.com/accounts/insights/` → Content You Shared → Stories
3. Extract per-story metrics
4. Store in `post_stats` with `post_type: 'story'`

---

### 2d. New Follower Notifications — **MEDIUM PRIORITY**

**What we need**: New follower username, bio, follower count, post that drove the follow (if attributable).

**Why it matters**: Understanding which content drives follows enables targeted content strategy. Bio analysis identifies ICP-aligned followers for DM outreach.

**How to get it** (VERIFIED 2026-02-28 — **RICHEST FOLLOWER DATA SOURCE ACROSS ALL PLATFORMS**):
- **Activity feed** at `/notifications/` is incredibly rich:
  - New follower with display name: `"lifelikematrix (Rudy) started following you from your ad. 46m"`
  - **Ad attribution**: `"from your ad"` vs organic (no source text)
  - Follow back status: "Follow Back" button present
  - Comment likes: `"asos_asoss, mo_money310 and 332 others liked your reel. 17m"`
  - Comment text engagement: `"and 510 others liked your comment: Haha, this is too relatable!"`
  - Timestamps: relative ("46m", "1h", "2d", "1w")
- **Observed live**: 15+ new followers in last 24 hours, most attributed to ads
- Time sections: "New", "Yesterday", "This week" — structured for parsing
- Each follower entry has: username, display name (in parens), source attribution, timestamp

**Cloud actions enabled**:
- New follower → check bio for ICP keywords → prioritize for DM outreach
- Track follower growth per post → weight content briefs toward conversion content
- Welcome DM sequence for new followers matching ICP criteria

**Implementation**:
1. Add activity feed scraper endpoint to Instagram DM service
2. Navigate to activity page → extract recent follow notifications
3. Store in `platform_notifications` with `notification_type: 'follow'`
4. Trigger welcome DM via `cloud_action_queue` for ICP-matching followers

---

### 2e. Engagement Anomaly Detection — **MEDIUM PRIORITY**

**What we need**: Rolling average engagement rate, deviation alerts, shadowban proxy signals.

**Why it matters**: Instagram shadowbans are common and silent. Early detection prevents posting into a void.

**How to get it**:
- Computed from `post_stats` data — no new scraping needed
- Reach-to-follower ratio is the key shadowban indicator

**Cloud actions enabled**:
- Alert when reach drops to <5% of follower count for 3+ posts (shadowban signal)
- Pause posting schedule + switch to Stories-only (less affected by shadowbans)
- A/B test content types to break out of suppression

**Implementation**:
1. Analytics function in `CloudSupabase` or dedicated module
2. Query recent `post_stats` → compare against rolling 30-day average
3. Store alerts in `platform_notifications` with `notification_type: 'anomaly'`

---

## 3. Priority Roadmap

| # | Signal | Priority | Effort | Dependencies |
|---|---|---|---|---|
| 1 | Post stats (likes, reach, saves) | **High** | Medium | Profile/Insights page scraper needed |
| 2 | Comment text + sentiment | **High** | Medium | Needs post URLs from stats; comments service running |
| 3 | Story views / exits | Medium | Medium | Insights page scraper |
| 4 | New follower notifications | Medium | Medium | Activity feed scraper |
| 5 | Engagement anomaly detection | Medium | Low | Depends on post stats being polled first |

## 4. Supabase Schema Additions Needed

```sql
-- platform_comments (shared across all platforms — same table as TikTok PRD)
-- See PRD_CLOUD_SIGNALS_TIKTOK.md for full schema

-- post_stats additions for Instagram-specific metrics
-- ALTER TABLE post_stats ADD COLUMN reach integer DEFAULT 0;       -- already exists
-- ALTER TABLE post_stats ADD COLUMN impressions integer DEFAULT 0; -- already exists
-- ALTER TABLE post_stats ADD COLUMN saves integer DEFAULT 0;       -- already exists
-- ALTER TABLE post_stats ADD COLUMN profile_visits integer DEFAULT 0;
-- ALTER TABLE post_stats ADD COLUMN story_exits integer DEFAULT 0;
-- ALTER TABLE post_stats ADD COLUMN story_taps_forward integer DEFAULT 0;
-- ALTER TABLE post_stats ADD COLUMN story_taps_back integer DEFAULT 0;
```

## 5. Service Architecture

```
Instagram DM Service (3100)        Instagram Comments Service (3005)
  ├─ /api/conversations              ├─ /api/search (post discovery)
  ├─ /api/messages                   ├─ /api/instagram/comment (post)
  ├─ /api/dm (send)                  ├─ /api/instagram/comment/detail [NEW]
  ├─ /api/activity [NEW]             └─ /health
  └─ /health
                    ↓                              ↓
              Instagram Poller (cloud-sync)
              ├─ pollDMs() ✅
              ├─ pollNotifications() ✅ (DM-only)
              ├─ pollPostStats() ❌ → [IMPLEMENT]
              ├─ pollComments() [NEW]
              └─ pollActivity() [NEW] (follows, likes, mentions)
                    ↓
              Supabase
              ├─ platform_dms ✅
              ├─ platform_notifications ✅ (DM-only)
              ├─ post_stats [IMPLEMENT]
              ├─ platform_comments [NEW]
              └─ platform_notifications.follow [NEW]
```
