# PRD: LinkedIn Cloud Signals & Automation Gaps

**Platform**: LinkedIn
**Services**: Automation (port 3105)
**Cloud Sync Poller**: `packages/cloud-sync/src/pollers/linkedin-poller.ts`
**Last Updated**: 2026-02-28

---

## 1. Current Status (What's Working)

| Signal | Status | Source | Notes |
|---|---|---|---|
| DM conversations | ✅ Polling | Port 3105 `/api/linkedin/conversations` | Conversation list with last message |
| DM message text | ✅ Polling | Port 3105 conversations data | Snippet, timestamp, unread flag |
| Unread DM notifications | ✅ Polling | Port 3105 unread conversations | Pushed as `notification_type: 'dm'` |
| Received connection requests | ✅ Polling | Port 3105 `/api/linkedin/connections/pending?type=received` | Name, headline, username, note |
| Sent connection invitations | ✅ Polling | Port 3105 `/api/linkedin/connections/pending?type=sent` | Name, headline, username, sent time, note |
| Invitations → Supabase | ✅ Syncing | `linkedin_invitations` table | Dedup by direction + username, 12/12 verified |
| DM sending | ✅ Available | Port 3105 `/api/linkedin/messages/send-to` | Full-page compose, clipboard typing |
| Connection requests | ✅ Available | Port 3105 `/api/linkedin/connections/request` | With/without note, custom-invite URL |
| Profile extraction | ✅ Available | Port 3105 `/api/linkedin/profile/:username` | Name, headline, location, degree, experience, skills |
| People search | ✅ Available | Port 3105 `/api/linkedin/search/people` | Keywords, title, company, degree filter, pagination |
| Lead scoring + pipeline | ✅ Available | Port 3105 `/api/linkedin/prospect/*` | Search → score → connect → DM |
| Outreach campaigns | ✅ Available | Port 3105 `/api/linkedin/outreach/*` | Multi-stage drip campaigns |
| Post stats | ❌ Not polling | — | `pollPostStats()` returns empty array |

## 2. Signals Needed (Not Yet Implemented)

### 2a. Connection Accept Rate Tracking — **HIGH PRIORITY**

**What we need**: Track which sent invitations get accepted vs. withdrawn vs. expired. Connection accept rate by: note template, prospect score tier, headline keyword, time of day sent.

**Why it matters**: Connection accept rate is the top-of-funnel metric for LinkedIn B2B pipeline. A 30% accept rate vs. 15% means 2x more prospects entering the DM stage per campaign cycle. Tracking which note templates perform best enables A/B testing.

**How to get it**:
- Already have sent invitations in `linkedin_invitations` table
- Need to periodically re-poll sent invitations and diff against stored ones
- Invitations that disappear from "Sent" page were either accepted or withdrawn
- Cross-reference with `connections/status` endpoint to determine if now connected

**Cloud actions enabled**:
- A/B test connection note templates → optimize accept rate
- Score note effectiveness by prospect ICP segment
- Auto-withdraw stale invitations (>30 days) to free up weekly invite quota
- Trigger DM sequence when connection accepted (status change detection)

**Implementation**:
1. Add `status_changed_at` column to `linkedin_invitations`
2. On each invitation poll, compare current sent list against stored list
3. Missing invitations → check profile connection status → mark `accepted` or `withdrawn`
4. Calculate accept rate metrics per campaign/note template
5. Queue DM action when status changes to `accepted`

---

### 2b. Post Stats + Reaction Breakdown — **HIGH PRIORITY**

**What we need**: Per-post views, likes (with reaction type: Like/Celebrate/Insightful/Curious/Love), comments count, reposts, impressions.

**Why it matters**: LinkedIn's algorithm weights "Insightful" and "Celebrate" reactions higher than plain "Like." Knowing which content drives high-value reactions informs what to post for decision-maker audiences.

**How to get it** (VERIFIED 2026-02-28):
- ⚠️ **`/analytics/` returns 404** — that URL does not exist on LinkedIn
- **Dashboard** at `/dashboard/` confirmed scrapable:
  - `Post impressions`: 131 (with "3,175% past 7 days" delta)
  - `Followers`: 803 (with "0.7% past 7 days" delta)
  - `Profile viewers`: 47 ("Past 90 days")
  - `Profile appearances`: 195 ("Previous week" — search result appearances)
- **Activity page** at `/in/{username}/recent-activity/all/` — shows Posts/Comments/Reactions tabs
  - Note: Profile tested has no recent posts, but structure supports extraction
- Individual post pages show reaction breakdown by type

**Cloud actions enabled**:
- Identify posts that drive "Insightful" reactions → create more thought-leadership content
- Correlate post format (text-only vs. carousel vs. video vs. document) with engagement
- Track impressions → calculate true engagement rate (not just vanity likes)
- Feed Thompson Sampling for optimal posting time and format

**Implementation**:
1. Add LinkedIn post scraper endpoint to automation service
2. Navigate to activity page → extract per-post metrics
3. For top posts, navigate to individual post → extract reaction breakdown
4. Store in `post_stats` table with `platform: 'linkedin'`
5. Add `reaction_breakdown` jsonb column for LinkedIn-specific reaction types
6. Update `LinkedInPoller.pollPostStats()`

---

### 2c. Profile View Count + Viewer Details — **MEDIUM PRIORITY**

**What we need**: Total profile views (weekly/monthly trend), who viewed your profile (names, headlines, companies — available with Premium).

**Why it matters**: Profile views that spike after a post indicate content-driven interest. Viewer details (if available) can feed the prospecting pipeline — someone who viewed your profile after seeing your post is a warm lead.

**How to get it** (VERIFIED 2026-02-28 — **PREMIUM-QUALITY LEAD DATA**):
- **Profile viewers page** at `/analytics/profile-views/` confirmed scrapable:
  - Total count: "47 Profile viewers in the past 90 days"
  - Recruiter count: "4 recruiters"
  - Company attribution: "1 works at Olivia Technologies Inc", "1 works at Your Brand Amplified® Podcast"
  - Discovery source: "6 found you through LinkedIn Profile"
  - **Free tier** (3 viewers shown with full details):
    - Viewer name: "Jax Jacobsen"
    - Headline: "B2B Content Writer for Cleantech, Hardtech, and Heavy Industry..."
    - Connection degree: "1st", "3rd"
    - View timestamp: "Viewed 6d ago", "Viewed 1w ago", "Viewed 3w ago"
    - Action buttons: Message / Search
  - **Premium**: Full viewer list unlocked
  - Anonymous viewers shown as: "Founder in the Marketing Services industry from London Area"

**Cloud actions enabled**:
- Correlate profile view spikes with specific posts → double-down on those topics
- Premium viewers list → auto-add to prospecting pipeline as warm leads
- Track profile view trend over time → measure personal brand growth

**Implementation**:
1. Add profile views scraper to LinkedIn automation service
2. Navigate to profile views page → extract count + viewer list (if Premium)
3. Store count in `platform_notifications` with `notification_type: 'profile_view'`
4. Store individual viewers in `platform_notifications` with viewer details in `raw_data`

---

### 2d. Comment Text on Own Posts — **MEDIUM PRIORITY**

**What we need**: Full text of comments on our LinkedIn posts, commenter name/headline/company, timestamp.

**Why it matters**: LinkedIn comments are often from decision-makers. A CMO commenting on your post is a higher signal than 100 likes. Comment text reveals what resonates with your ICP.

**How to get it**:
- Navigate to individual post page → extract comments section
- LinkedIn shows comments with commenter name, headline, and company
- Sort by "Most relevant" or "Most recent"

**Cloud actions enabled**:
- Identify decision-maker commenters → add to prospecting pipeline
- Extract questions from comments → create follow-up posts answering them
- Reply to high-value commenters with personalized responses
- Track comment sentiment → adjust content tone

**Implementation**:
1. Add post comment extraction endpoint to LinkedIn automation service
2. For each post from `post_stats`, navigate to post → extract comments
3. Store in `platform_comments` table with LinkedIn-specific fields (commenter headline, company)
4. Score commenters against ICP criteria → prioritize for outreach

---

### 2e. InMail Response Rate — **LOW PRIORITY**

**What we need**: InMail sent count, response rate, response time (Premium/Sales Navigator feature).

**Why it matters**: InMail is expensive (credits-based). Tracking response rate by template/ICP segment optimizes credit spend.

**How to get it**:
- LinkedIn Sales Navigator dashboard or Premium messaging analytics
- URL varies by subscription tier

**Cloud actions enabled**:
- A/B test InMail templates → optimize response rate
- Avoid sending InMails to segments with <10% response rate
- Calculate cost-per-response for ROI analysis

**Implementation**:
1. Add Sales Navigator analytics scraper (only if user has Premium)
2. Extract InMail metrics from dashboard
3. Store in dedicated `linkedin_inmail_stats` table or extend `platform_dms`

---

### 2f. Invitation Status Change Detection — **MEDIUM PRIORITY**

**What we need**: Real-time detection when a sent invitation gets accepted (person is now a connection).

**Why it matters**: The moment someone accepts a connection request is the highest-intent window for a first DM. Triggering an automated DM within minutes of acceptance dramatically increases reply rates vs. waiting for the next poll cycle.

**How to get it**:
- Compare current `linkedin_invitations` (direction=sent, status=pending) against previous poll
- Missing entries = accepted, withdrawn, or expired
- Verify by checking connection status via profile page

**Cloud actions enabled**:
- Immediate DM trigger on connection acceptance (within 2 min of detection)
- Update outreach campaign prospect stage: `connection_sent` → `connected`
- Log conversion event for campaign analytics

**Implementation**:
1. In `pollInvitations()`, after fetching current sent list, query Supabase for previously stored sent invitations
2. Diff: stored but not in current list = status changed
3. For each changed invitation, check profile connection status
4. Update `linkedin_invitations.status` to `accepted` or `withdrawn`
5. Queue DM action in `cloud_action_queue` for accepted connections

---

## 3. Priority Roadmap

| # | Signal | Priority | Effort | Dependencies |
|---|---|---|---|---|
| 1 | Connection accept rate tracking | **High** | Medium | Diff logic on existing invitation data |
| 2 | Post stats + reaction breakdown | **High** | High | Activity page scraper needed |
| 3 | Invitation status change → auto-DM | Medium | Medium | Depends on #1 |
| 4 | Comment text on own posts | Medium | Medium | Depends on #2 for post URLs |
| 5 | Profile view count + viewers | Medium | Medium | Profile views page scraper |
| 6 | InMail response rate | Low | Medium | Requires Premium/Sales Navigator |

## 4. Supabase Schema Additions Needed

```sql
-- linkedin_invitations additions
-- ALTER TABLE linkedin_invitations ADD COLUMN status_changed_at timestamptz;
-- ALTER TABLE linkedin_invitations ADD COLUMN campaign_id text;
-- ALTER TABLE linkedin_invitations ADD COLUMN note_template text;
-- ALTER TABLE linkedin_invitations ADD COLUMN accept_detected_at timestamptz;

-- post_stats additions for LinkedIn-specific metrics
-- ALTER TABLE post_stats ADD COLUMN reaction_breakdown jsonb DEFAULT '{}';
-- reaction_breakdown example: {"like": 12, "celebrate": 5, "insightful": 8, "curious": 2, "love": 1}

-- platform_comments additions for LinkedIn-specific fields
-- commenter_headline and commenter_company can go in raw_data jsonb
```

## 5. Service Architecture

```
LinkedIn Automation Service (3105)
  ├─ /api/linkedin/conversations ✅
  ├─ /api/linkedin/messages/send-to ✅
  ├─ /api/linkedin/connections/pending ✅ (sent + received)
  ├─ /api/linkedin/connections/request ✅
  ├─ /api/linkedin/profile/:username ✅
  ├─ /api/linkedin/search/people ✅
  ├─ /api/linkedin/prospect/* ✅
  ├─ /api/linkedin/outreach/* ✅
  ├─ /api/linkedin/posts/stats [NEW] (activity page scrape)
  ├─ /api/linkedin/posts/:id/comments [NEW]
  ├─ /api/linkedin/analytics/profile-views [NEW]
  └─ /health
                    ↓
              LinkedIn Poller (cloud-sync)
              ├─ pollDMs() ✅
              ├─ pollNotifications() ✅ (DMs + connection requests)
              ├─ pollInvitations() ✅ (sent + received → Supabase)
              ├─ pollPostStats() ❌ → [IMPLEMENT]
              ├─ pollComments() [NEW]
              ├─ pollInvitationStatusChanges() [NEW]
              └─ pollProfileViews() [NEW]
                    ↓
              Supabase
              ├─ platform_dms ✅
              ├─ platform_notifications ✅
              ├─ linkedin_invitations ✅
              ├─ post_stats [IMPLEMENT]
              ├─ platform_comments [NEW]
              └─ cloud_action_queue (auto-DM on accept) [WIRE UP]
```
