# Signal Discovery Findings — Live DOM Scrape Results

**Date**: 2026-02-28
**Method**: Safari DOM inspection via AppleScript on live authenticated sessions
**Purpose**: Map every scrapable data point per platform to close gaps in the cloud poller system

---

## 1. TikTok Studio Analytics

### 1a. Overview Tab (`/tiktokstudio/analytics/overview`)

| Metric | Value (60-day) | Scrapable | Notes |
|---|---|---|---|
| Video views | 12K | ✅ | With delta + % change |
| Profile views | 264 | ✅ | With delta + % change |
| Likes | 271 | ✅ | With delta + % change |
| Comments | 30 | ✅ | With delta + % change |
| Shares | 13 | ✅ | With delta + % change |
| Est. rewards | $0 | ✅ | Monetization tracking |
| Traffic source breakdown | Search 89.5%, Profile 5.5%, FYP 5%, Following 0%, Sound 0% | ✅ | Top 5 sources with % |
| Search queries | "Giant Squid", "sprinkler protector", etc. | ✅ | Top queries driving traffic |

**Time ranges available**: Last 7 / 28 / 60 / 365 days, Custom
**URL pattern**: `tiktokstudio/analytics/overview?dateRange={"type":"fixed","pastDay":60}`

### 1b. Per-Video Analytics (`/tiktokstudio/analytics/{videoId}/overview`)

| Metric | Example Value | Scrapable | Notes |
|---|---|---|---|
| Video views | 2.2K | ✅ | Per-video |
| Total play time | 1h:8m:13s | ✅ | **KEY SIGNAL** |
| Average watch time | 2.12s | ✅ | **KEY SIGNAL** — hook effectiveness |
| Watched full video | 0.2% | ✅ | **KEY SIGNAL** — completion rate |
| New followers | 29 | ✅ | Followers gained from this specific video |
| Retention rate | "Most viewers stopped at 0:01" with timestamp + % | ✅ | Retention curve with drop-off points |
| Traffic source | FYP 85.3%, Profile 11.3%, Following 2.7%, Other 0.5%, Search 0.2% | ✅ | Per-video traffic attribution |
| Search queries | "isaiah dupree" 50% | ✅ | Which searches led to this video |

**Video ID extraction**: From Content tab, each row has a "View data" button that navigates to `/tiktokstudio/analytics/{videoId}/overview`

### 1c. Per-Video Engagement Tab (`/tiktokstudio/analytics/{videoId}/engagement`)

| Metric | Example Value | Scrapable | Notes |
|---|---|---|---|
| Like timing | "Most viewers liked at 0:00" with 86% | ✅ | When in the video likes happen |
| Top comment words | (needs enough data) | ✅ | Word cloud of comment themes |

### 1d. Content Tab (`/tiktokstudio/analytics/content`)

| Metric | Scrapable | Notes |
|---|---|---|
| Post rank | ✅ | Ordered by views |
| Video duration | ✅ | Format: "00:35" |
| Caption text | ✅ | Full caption (truncated in table) |
| Views (period) | ✅ | Views in selected time range |
| All-time views | ✅ | Total lifetime views |
| Posted date | ✅ | "Jul 25, 2024" or "2mo ago" |

**Sorting options**: Most views, Most new viewers, Most likes, New followers

### 1e. Comments Page (`/tiktokstudio/comment`)

| Metric | Scrapable | Notes |
|---|---|---|
| Commenter username | ✅ | e.g. "elevate360method" |
| Comment text | ✅ | Full text |
| Timestamp | ✅ | "2w ago", "3w ago" |
| Like count | ✅ | Per-comment likes |
| Reply/Delete actions | ✅ | Can reply directly |

**Filters available**: All comments, Posted by all, Follower count, Comment date

### 1f. Follower Tab (`/tiktokstudio/analytics/follower`)

Shows same per-video metrics (watch time, completion) but scoped to a selected video. Data chart only shown for 21 days from post date.

### 1g. TikTok Notifications/Inbox

**NOT available on web** — `/inbox` redirects to For You feed. Follower notifications only accessible via mobile app.

---

## 2. Instagram Insights

### 2a. Account Insights (`/accounts/insights/?timeframe=30`)

| Metric | Value (30-day) | Scrapable | Notes |
|---|---|---|---|
| Views | 33,874 | ✅ | Total content views |
| Accounts reached | 27,253 | ✅ | Unique accounts |
| Reach by content type | Reels 52.1%, Posts 45.7%, Stories 2.2% | ✅ | Content type breakdown |
| Follower vs Non-follower reach | 1% / 99% | ✅ | Audience composition |
| Interactions | 1,181 | ✅ | Total interactions |
| Interaction by type | Reels 91.7%, Posts 8.3% | ✅ | Content type breakdown |
| Profile visits | 1,452 | ✅ | **KEY SIGNAL** |
| External link taps | 17 | ✅ | **Bio link clicks!** |
| Total followers | 1,105 | ✅ | Current follower count |
| Most active times | Day × Hour heatmap (M-Su × 12a-9p) | ✅ | **Optimal posting time** |

**Time ranges**: Last 7 / 14 / 30 / 90 days
**Per-post insights**: NOT available on web — only on mobile app

### 2b. Activity/Notifications Feed (`/notifications/`)

This is the **richest follower signal source** across all platforms:

| Signal | Example | Scrapable | Notes |
|---|---|---|---|
| New follower | "lifelikematrix (Rudy) started following you from your ad. 46m" | ✅ | **Username + display name + source attribution** |
| Follower source | "from your ad", organic (no source) | ✅ | **Ad vs organic attribution!** |
| Comment likes | "asos_asoss, mo_money310 and 332 others liked your reel. 17m" | ✅ | Reel/comment engagement |
| Comment text likes | "and 510 others liked your comment: Haha, this is too relatable!" | ✅ | Shows your comment text + like count |
| Follow back status | "Follow Back" button present | ✅ | Whether you follow them back |
| Timestamps | Relative: "46m", "1h", "2d", "1d", "1w" | ✅ | Notification recency |

**Observed in live session**: 15+ new followers in last 24 hours, most attributed to ads

### 2c. Story Insights

**NOT available on web** — Instagram Insights on web only shows account-level metrics. Per-story views, exits, tap-forward/back only on mobile app.

---

## 3. LinkedIn

### 3a. Dashboard (`/dashboard/`)

| Metric | Value | Scrapable | Notes |
|---|---|---|---|
| Post impressions | 131 | ✅ | With "3,175% past 7 days" delta |
| Followers | 803 | ✅ | With "0.7% past 7 days" delta |
| Profile viewers | 47 | ✅ | "Past 90 days" |
| Profile appearances | 195 | ✅ | "Previous week" (search appearances) |

### 3b. Profile Viewers (`/analytics/profile-views/`)

This is **premium-quality lead data**:

| Metric | Scrapable | Notes |
|---|---|---|
| Total viewer count | ✅ | "47 Profile viewers in the past 90 days" |
| Recruiter count | ✅ | "4 recruiters" |
| Company attribution | ✅ | "1 works at Olivia Technologies Inc" |
| Discovery source | ✅ | "6 found you through LinkedIn Profile" |
| Viewer name | ✅ (3 free, full with Premium) | "Jax Jacobsen" |
| Viewer headline | ✅ | "B2B Content Writer for Cleantech..." |
| Viewer connection degree | ✅ | "1st", "3rd" |
| View timestamp | ✅ | "Viewed 6d ago", "Viewed 1w ago", "Viewed 3w ago" |
| Message/Search button | ✅ | Action available per viewer |

### 3c. Post Activity (`/in/{username}/recent-activity/all/`)

Tabs available: All activity, Posts, Comments, Reactions
**Note**: No posts on this profile currently, but structure supports extraction when posts exist.

### 3d. LinkedIn Analytics URL

`/analytics/` → **404 page not found**. Dashboard at `/dashboard/` is the correct URL.

---

## 4. Twitter (X)

### 4a. Notifications (`/notifications`)

| Signal | Scrapable | Notes |
|---|---|---|
| Like notifications | ✅ | "Julius liked your post · 3h" with post text preview |
| Reply notifications | ✅ | Full reply text with @mention, timestamp |
| Post engagement | ✅ | Inline engagement counts |
| Notification timestamp | ✅ | Relative: "3h", "4h", "Feb 27" |

**Tabs**: All, Mentions
**No dedicated follower tab** — follower notifications mixed into "All" feed (unlike Instagram's clean separation)

### 4b. Existing Comment Service Endpoints (Port 3007)

| Endpoint | Returns | Notes |
|---|---|---|
| `GET /api/twitter/comments` | `{username, text, timestamp}` | Comments on current post page |
| `POST /api/twitter/tweet/detail` | Full tweet detail with replies | Navigate to tweet → get all replies |
| `POST /api/twitter/search` | Search results with engagement | `from:@isaiahdupree` for own posts |
| `POST /api/twitter/timeline` | User timeline posts | Get own recent posts |
| `POST /api/twitter/feed` | Home feed posts | For You / Following tabs |

---

## 5. Threads

### 5a. Existing Service Endpoints (Port 3004)

| Endpoint | Returns | Notes |
|---|---|---|
| `GET /api/threads/comments` | `{username, text, timestamp}` | Comments from current view |
| `GET /api/threads/context` | `{mainPost, username, replies, likeCount, replyCount}` | Full post context for AI |
| `POST /api/search` | Post discovery | Search for own posts |

### 5b. Platform Constraints

- No DMs on Threads
- No view counts (never exposed)
- No analytics page
- No notification/activity feed accessible via web
- All data must come from public post pages

---

## 6. Comment Text Services — All Already Running

| Port | Service | `GET /comments` | Returns |
|---|---|---|---|
| 3004 | Threads | ✅ `/api/threads/comments` | `{username, text, timestamp}` |
| 3005 | Instagram | ✅ `/api/instagram/comments` | `{username, text, timestamp}` |
| 3006 | TikTok | ✅ `/api/tiktok/comments` | `{username, text, timestamp}` |
| 3007 | Twitter | ✅ `/api/twitter/comments` | `{username, text, timestamp}` |

**All 4 services already extract comment text** — wiring this into a `platform_comments` Supabase table requires ZERO new Safari automation. Just new poller methods + Supabase table.

---

## 7. Signal Acquisition Matrix — Updated with Discovery

| Signal | Platform | URL/Endpoint | Scraping Method | Priority | Effort |
|---|---|---|---|---|---|
| Comment text + sentiment | TW/IG/TT/Threads | Services 3004-3007 `/api/{platform}/comments` | **Already built** — just wire to Supabase | **Critical** | Low |
| Watch time / completion % | TikTok | `/tiktokstudio/analytics/{videoId}/overview` | Safari scrape → parse innerText | **High** | Medium |
| Post impressions + traffic source | TikTok | `/tiktokstudio/analytics/overview` | Safari scrape → parse innerText | **High** | Medium |
| Account-level reach + interactions | Instagram | `/accounts/insights/?timeframe=30` | Safari scrape → parse innerText | **High** | Low |
| New follower notifications (with ad attribution) | Instagram | `/notifications/` | Safari scrape → parse activity feed | **High** | Medium |
| Profile visitors (with names/headlines) | LinkedIn | `/analytics/profile-views/` | Safari scrape → parse innerText | **High** | Medium |
| Dashboard metrics (impressions, followers, profile views) | LinkedIn | `/dashboard/` | Safari scrape → parse innerText | **High** | Low |
| Like/reply notifications | Twitter | `/notifications` | Safari scrape → parse notification cells | Medium | Medium |
| TikTok all comments management | TikTok | `/tiktokstudio/comment` | Safari scrape → parse comment list | Medium | Low |
| Bio link click count | Instagram | `/accounts/insights/?timeframe=30` (External link taps) | Already on insights page | Medium | Low |
| Most active follower times | Instagram | `/accounts/insights/?timeframe=30` | Heatmap data on insights page | Medium | Low |
| Story views / exits | Instagram | **Not on web** — mobile only | Cannot scrape from Safari | Low | N/A |
| Follower notifications | TikTok | **Not on web** — `/inbox` redirects | Cannot scrape from Safari | Low | N/A |

---

## 8. Recommended Implementation Order

### Phase 1 — Lowest Effort, Highest Value (Comment Text)
1. Create `platform_comments` Supabase table
2. Add `pollComments()` to all 4 platform pollers
3. Add `syncComments()` to CloudSupabase
4. Wire into sync engine poll cycle
5. **No new Safari automation needed**

### Phase 2 — TikTok Studio Scraper
1. Add TikTok Studio analytics scraper endpoint to TikTok comments service
2. Navigate to `/tiktokstudio/analytics/content` → extract post list with video IDs
3. For each video, navigate to `/tiktokstudio/analytics/{videoId}/overview` → extract watch time, completion %, retention, traffic
4. Store in extended `post_stats` table
5. Also scrape `/tiktokstudio/comment` for full comment management data

### Phase 3 — Instagram Insights + Activity Feed
1. Scrape `/accounts/insights/?timeframe=30` for account-level metrics
2. Scrape `/notifications/` for follower notifications with ad attribution
3. Store insights in `platform_account_stats` table
4. Store follower notifications in `platform_notifications` with source attribution

### Phase 4 — LinkedIn Dashboard + Profile Viewers
1. Scrape `/dashboard/` for post impressions, followers, profile viewers, appearances
2. Scrape `/analytics/profile-views/` for viewer names, headlines, companies
3. Store in `linkedin_profile_viewers` or `platform_notifications`
4. Auto-add high-value viewers to prospecting pipeline

### Phase 5 — Twitter Notifications
1. Scrape `/notifications` for likes, replies, mentions
2. Parse notification cells for engagement data
3. Store in `platform_notifications` with proper dedup
