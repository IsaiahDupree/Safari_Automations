# Data Signals Inventory — Safari Automation System

> **Last updated**: Mar 1, 2026  
> **Supabase project**: `ivhfuhxorppptyuofbgq` (mediaposter-lite)  
> **Status**: Comprehensive audit of all data signals the system can collect, what's actively collecting, and what gaps remain.

---

## System Overview

The Safari Automation system collects data across **6 platforms** via dedicated service packages, each running as an Express server on a specific port. The **Cloud Sync Engine** (`packages/cloud-sync`) orchestrates polling and persists everything to Supabase.

### Service Architecture

| Service | Port | Platform | Package |
|---|---|---|---|
| Instagram DM | 3100 | Instagram | `packages/instagram-dm` |
| Twitter DM | 3003 | Twitter/X | `packages/twitter-dm` |
| TikTok DM | 3102 | TikTok | `packages/tiktok-dm` |
| LinkedIn | 3105 | LinkedIn | `packages/linkedin-automation` |
| Instagram Comments | 3005 | Instagram | `packages/instagram-comments` |
| TikTok Comments | 3006 | TikTok | `packages/tiktok-comments` |
| Twitter Comments | 3007 | Twitter/X | `packages/twitter-comments` |
| Threads Comments | 3004 | Threads | `packages/threads-comments` |
| Market Research | 3106 | Multi | `packages/market-research` |
| Upwork | 3104 | Upwork | `packages/upwork-automation` |
| Scheduler | 3108 | System | `packages/scheduler` |

---

## 1. Content Performance

### What's Actively Collecting

| Signal | TikTok | Instagram | Twitter/X | LinkedIn | Threads |
|---|---|---|---|---|---|
| **Views** | ~ (1/6 posts) | - | ✅ (19/19) | - | - |
| **Likes** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Comments count** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Shares/Reposts** | ~ (1/6) | - | ~ (1/19) | ✅ | - |
| **Saves** | - | - | - | - | - |
| **Impressions** | - | - | - | - | - |
| **Reach** | - | - | - | - | - |
| **Engagement rate** | computed | computed | computed | computed | computed |
| **Performance tier** | ✅ | ✅ | ✅ | - | - |
| **Watch time** | - | - | - | - | - |
| **Completion rate** | - | - | - | - | - |
| **Traffic source** | - | - | - | - | - |

**Supabase table**: `post_stats` (28 columns)  
**Current data**: 30 rows (TikTok: 6, Instagram: 5, Twitter: 19)  
**History table**: `post_stats_history` (105 snapshots for anomaly detection)

**Schema supports but not yet populated**: `avg_watch_time_seconds`, `completion_rate`, `traffic_source`, `impressions`, `reach`, `saves`

### Gap: TikTok Studio Analytics (HIGH PRIORITY)

From the TikTok Studio screenshots, these pages expose rich data via DOM scraping:

**Overview tab** (`tiktok.com/analytics/overview`):
- Video views (361), profile views (13), likes (3), comments (-2), shares (1)
- Estimated rewards ($0)
- 7-day trend chart
- **Traffic source breakdown**: Search 89.5%, Personal profile 5.5%, For You 5%, Following 0%
- **Search queries**: what terms drove views

**Content tab** (`tiktok.com/analytics/content`):
- Per-video performance (views, likes, comments, shares)
- Individual video analytics (watch time, completion rate if clicked in)

**Viewers tab** (`tiktok.com/analytics/viewers`):
- Daily viewer count timeline
- **Most active times**: hour-by-hour activity chart (peak: Feb 25, 5pm-6pm)
- **Competitor creators**: who your viewers also watch (LovelyJuice23, Liberty Mutual, TikTok Tips, McDonald's, etc.)
- **Gender split**: Male 63%, Female 37%

**Followers tab** (`tiktok.com/analytics/followers`):
- **Total followers**: 535
- **Net followers**: 0 (-2, -100%)
- Follower trend over time
- **Gender**: Male 72%, Female 26%, Other 2%
- **Age brackets**: 18-24 (14.7%), 25-34 (30.1%), 35-44 (29.6%), 45-54 (16.9%)
- **Most active times**: hour-by-hour (peak: Feb 26 at 2pm)

**Comments tab** (`tiktok.com/studio/comments`):
- Full comment text with usernames, timestamps, like counts
- Filter by: all comments, posted by all, follower count, comment date
- Reply/Delete actions available

### Gap: Instagram Insights (MEDIUM)

Instagram's professional dashboard exposes:
- Story views, exits, tap-forward/back
- Reach vs. impressions per post
- Profile visits
- Bio link clicks
- Audience demographics (age, gender, location)

*Currently not being scraped — would require navigating to instagram.com/professional/insights*

---

## 2. Comment Text & Sentiment

### What's Actively Collecting

| Signal | TikTok | Instagram | Twitter/X | Threads | LinkedIn |
|---|---|---|---|---|---|
| **Comment text** | ✅ | ✅ | ✅ | ✅ | - |
| **Username** | ✅ | ✅ | ✅ | ✅ | - |
| **Like count** | ✅ | ✅ | ✅ | ✅ | - |
| **is_question** | ✅ | ✅ | ✅ | ✅ | - |
| **is_testimonial** | schema ready | schema ready | schema ready | schema ready | - |
| **Sentiment** | - | - | - | - | - |
| **is_actioned** | schema ready | schema ready | schema ready | schema ready | - |

**Supabase table**: `platform_comments` (20 columns)  
**Current data**: 5 rows (TikTok: 2, Twitter: 3)  
**Dedup key**: `platform:post_id:username:text_first_80_chars`

**Comment services**: Instagram (3005), TikTok (3006), Twitter (3007), Threads (3004)  
**Poll flow**: Search own posts → navigate to each → extract comments → sync with dedup

### Gap: Sentiment Classification (MEDIUM)

The `sentiment` column exists but is never populated. Could be filled by:
1. Rule-based: positive words, question marks, exclamations
2. AI-based: GPT-4o mini classification on sync (batch)
3. Both: rules as fallback, AI for ambiguous

### Gap: TikTok Studio Comments (LOW)

The TikTok Studio Comments tab (screenshot 4) shows comments in a clean list format that's easier to scrape than the regular video page — includes username, timestamp, text, like count, and reply/delete options.

---

## 3. New Follower Attribution

### What's Actively Collecting

| Signal | Instagram | TikTok | Twitter/X | LinkedIn |
|---|---|---|---|---|
| **Follower username** | ✅ | ✅ | - | - |
| **Follow event type** | ✅ (follow) | ✅ (follow) | - | - |
| **Profile URL** | ✅ | ✅ | - | - |
| **Bio** | schema ready | schema ready | - | - |
| **Follower count** | schema ready | schema ready | - | - |
| **Attributed post** | - | - | - | - |

**Supabase table**: `follower_events` (14 columns)  
**Current data**: 0 rows (newly deployed, no poll cycles run yet)  
**Dedup key**: `platform:event_type:username`

**Extraction method**: Scrape activity/notifications feed for "started following you" / "followed you" events  
**False positive hardening**: Username regex validation, blocklist (18 nav elements), DOM dedup, profile_url domain check

### Gap: Follower Attribution (MEDIUM)

Currently captures WHO followed but not WHICH POST drove the follow. Would need:
- Correlate follow timestamp with recent post publish times
- Or scrape the activity feed for "liked your video" → "started following you" sequences

### Gap: Twitter Follower Notifications (LOW)

Twitter notifications page could be scraped for new follower events, but no endpoint exists yet.

---

## 4. DM Intent & Lead Scoring

### What's Actively Collecting

| Signal | Instagram | TikTok | Twitter/X | LinkedIn |
|---|---|---|---|---|
| **DM text** | ✅ | ✅ | ✅ | ✅ |
| **Sender username** | ✅ | ✅ | ✅ | ✅ |
| **Direction (in/out)** | ✅ | ✅ | ✅ | ✅ |
| **Lead score (0-100)** | ✅ | ✅ | ✅ | ✅ |
| **Conversation thread** | partial | partial | partial | partial |
| **Time-to-first-reply** | - | - | - | - |

**Supabase table**: `platform_dms` (20 columns)  
**Current data**: 10 rows (all LinkedIn)  
**Lead score**: `computeLeadScore()` — rule-based 0-100, factors: message length, question marks, business keywords, urgency signals

**DM services**: Instagram (3100), Twitter (3003), TikTok (3102), LinkedIn (3105)  
**Poll flow**: Navigate to inbox → extract visible conversations → sync with dedup  
**False positive prevention**: Domain verification (verifyPageDomain), text quality filters, self-message filtering

### Gap: Intent Classification (HIGH)

Lead score is rule-based. Missing:
- AI-powered intent classification (inquiry / complaint / collaboration / spam)
- Auto-generated reply suggestions
- CRM pipeline routing
- Follow-up sequence triggers

### Gap: Time-to-First-Reply (LOW)

Would require tracking first-seen timestamp of inbound DM vs. first outbound reply in same thread.

---

## 5. LinkedIn-Specific Signals

### What's Actively Collecting

| Signal | Status | Data |
|---|---|---|
| **Post reactions** | ✅ | reactions count (not broken by type) |
| **Post comments** | ✅ | count only |
| **Post reposts** | ✅ | count |
| **Connection invitations** | ✅ | sent/received, name, status |
| **Prospects** | ✅ | 55 records |
| **Profile search** | ✅ | degree filter, pagination |
| **Connection requests** | ✅ | with/without note |
| **Messages** | ✅ | compose + send via messaging page |

**Supabase tables**: 
- `linkedin_invitations` (12 rows)
- `linkedin_prospects` (55 rows)  
- `post_stats` (0 LinkedIn rows currently — endpoint built, needs live run)

### Gap: Reaction Type Breakdown (LOW)

LinkedIn has 6 reaction types (Like, Celebrate, Support, Funny, Love, Insightful). Currently only pulling total count. Would need refined selector for individual reaction type buttons.

### Gap: Profile Visit Count (MEDIUM)

LinkedIn dashboard shows "Who viewed your profile" count. Not currently scraped.

### Gap: Connection Accept Rate (MEDIUM)

Could be computed from `linkedin_invitations`: sent invitations vs. accepted status over time.

---

## 6. Engagement Anomaly Detection

### What's Actively Collecting

| Signal | Status |
|---|---|
| **Engagement spikes** | ✅ — deviation >50% from rolling avg |
| **Engagement drops** | ✅ — deviation <-30% from rolling avg |
| **Severity classification** | ✅ — low/medium/high thresholds |
| **Action queue integration** | ✅ — high severity → `cloud_action_queue` |
| **Rolling averages** | ✅ — 3-snapshot window per metric |
| **Dedup** | ✅ — `dedup_key` on both tables |

**Supabase tables**:
- `engagement_anomalies` (0 rows — clean, no anomalies detected yet)
- `cloud_action_queue` (0 rows)

**Metrics monitored**: views, likes, comments, shares, engagement_rate  
**Minimum thresholds**: views≥5, likes≥2, comments≥1, shares≥1, engagement_rate≥0.5

### Gap: Shadowban Proxy Detection (MEDIUM)

Could detect: reach collapse while follower count stable = potential shadowban.  
Would need: impressions/reach data (not currently collected on any platform).

---

## 7. Brand Mention Monitoring

### What's Actively Collecting

| Signal | Twitter/X | TikTok | Instagram | Threads |
|---|---|---|---|---|
| **@mention search** | ✅ | ✅ | - | - |
| **Comment mention scan** | ✅ | ✅ | ✅ | ✅ |
| **Self-post filtering** | ✅ | ✅ | ✅ | ✅ |
| **Word-boundary match** | ✅ | ✅ | ✅ | ✅ |
| **Text quality filter** | ✅ | ✅ | ✅ | ✅ |

**Supabase table**: `brand_mentions` (15 columns, 0 rows — no mentions found yet)

**Monitored handles**:
- Twitter: `IsaiahDupree7`, `isaiah_dupree`
- Instagram: `the_isaiah_dupree`
- TikTok: `isaiahdupree`, `isaiah_dupree`
- Threads: `the_isaiah_dupree`

**Note**: Instagram and Threads don't have public mention search APIs — only existing comments in DB are scanned.

---

## 8. Upwork Automation

### What's Actively Built

| Capability | Status | Endpoint |
|---|---|---|
| **Job search** (full filter support) | ✅ | `POST /api/upwork/jobs/search` |
| **Tab browsing** (Best Matches, Most Recent, US Only, Saved) | ✅ | `POST /api/upwork/jobs/tab` |
| **Job detail extraction** | ✅ | `GET /api/upwork/jobs/detail?url=` |
| **Job scoring** (0-100, 5 factors) | ✅ | `POST /api/upwork/jobs/score` |
| **Batch scoring** | ✅ | `POST /api/upwork/jobs/score-batch` |
| **Connects recommendation** | ✅ | Built into scoring |
| **AI proposal generation** (GPT-4o) | ✅ | `POST /api/upwork/proposals/generate` |
| **Proposal submission** (with dry-run) | ✅ | `POST /api/upwork/proposals/submit` |
| **Application tracking** | ✅ | `GET /api/upwork/applications` |
| **Conversations list** | ✅ | `GET /api/upwork/conversations` |
| **Message reading** | ✅ | `GET /api/upwork/messages` |
| **Message sending** | ✅ | `POST /api/upwork/messages/send` |
| **Unread count** | ✅ | `GET /api/upwork/messages/unread` |
| **Job monitor** (watches + scan) | ✅ | `POST /api/upwork/monitor/scan` |
| **Preset watches** | ✅ | `POST /api/upwork/monitor/setup` |
| **Save job** | ✅ | `POST /api/upwork/jobs/:id/save` |
| **Rate limiting** | ✅ | Configurable per-hour limits |

**Port**: 3104  
**Scoring factors**: budget match (0-25), skill match (0-30), client quality (0-20), competition (0-15), freshness (0-10)  
**Proposal flow**: Navigate → expand description → Apply Now → detect form type → set rate/price (OS-level keystroke typing) → fill cover letter → answer screening questions → attach files → set boost connects → click Set bid → submit → check "Yes, I understand" checkbox → click Continue → verify  
**Safety**: `dryRun: true` by default — fills form but does NOT click submit  
**Battle-tested**: Real proposal submitted Mar 1, 2026 — $1200 fixed-price, 13 Connects, verification: `success_url`  
**Docs**: See [UPWORK_PROPOSAL_GUIDE.md](./UPWORK_PROPOSAL_GUIDE.md) for complete submission guide (v2.1.0)

### Job Detail Extraction Fields
- Title, full description, skills/badges
- Experience level, project type, project length, weekly hours
- Budget (hourly range or fixed price)
- Proposal count, interviewing count, invites sent
- Connects required + available
- Client info: payment verified, total spent, hire rate, jobs posted, rating, location, member since
- Screening questions, attachments

---

## 9. Market Research

### What's Actively Built

| Capability | Platforms | Endpoint |
|---|---|---|
| **Keyword search** | IG, Twitter, TikTok, Threads | `POST /api/research/search` |
| **Competitor research** | IG, Twitter, TikTok, Threads | `POST /api/research/competitors` |
| **Top creator ranking** | IG, Twitter, TikTok, Threads | Via competitor research |

**Port**: 3106  
**Data returned**: author, likes, views, comments, shares, URL, text per post  
**Competitor research**: niche → scrape posts → rank creators by total engagement

---

## Readiness Assessment vs. Signal Wishlist

| Signal Category | Status | Ready? |
|---|---|---|
| **Content Performance** (views, likes, comments, shares) | ✅ Collecting across 3 platforms | Partially — missing saves, watch time, reach, impressions |
| **Comment Text + Sentiment** | ✅ Text collecting, sentiment schema ready | Needs sentiment classifier |
| **New Follower Attribution** | ✅ IG + TikTok follower events built | Needs post attribution logic |
| **DM Intent Classification** | ✅ DMs collecting + lead score | Needs AI intent classifier + reply suggestions |
| **LinkedIn Pipeline** | ✅ Invitations + prospects + post stats | Needs reaction breakdown + profile visits |
| **Engagement Anomaly Detection** | ✅ Fully operational | Needs impressions data for shadowban detection |
| **Brand Mentions** | ✅ Fully operational | Working, awaiting real mentions |
| **Upwork Proposals** | ✅ Battle-tested — real proposal submitted | See [UPWORK_PROPOSAL_GUIDE](./UPWORK_PROPOSAL_GUIDE.md) |
| **TikTok Studio Analytics** | ❌ Not built | HIGH PRIORITY — rich data available via DOM |
| **Instagram Insights** | ❌ Not built | MEDIUM — requires professional account nav |

---

## Priority Gap Matrix

| Gap | Platform | How to Get It | Priority | Effort |
|---|---|---|---|---|
| TikTok Studio overview metrics | TikTok | Navigate to `tiktok.com/analytics/overview`, scrape DOM | **High** | Medium |
| TikTok Studio audience demographics | TikTok | Navigate to viewers/followers tabs, scrape DOM | **High** | Medium |
| TikTok traffic sources + search queries | TikTok | Overview tab DOM extraction | **High** | Low |
| Sentiment classification | All | GPT-4o mini batch classification on sync | **High** | Low |
| AI intent classification for DMs | All | GPT-4o classification on new DMs | **High** | Medium |
| Reply suggestion generation | All | GPT-4o with conversation context | Medium | Medium |
| Instagram Insights (reach, impressions) | Instagram | Navigate to professional dashboard | Medium | High |
| LinkedIn profile visit count | LinkedIn | Dashboard page scrape | Medium | Low |
| LinkedIn connection accept rate | LinkedIn | Compute from `linkedin_invitations` data | Medium | Low |
| Follower → post attribution | IG/TikTok | Correlate timestamps or scan activity sequences | Medium | Medium |
| Watch time / completion rate | TikTok | TikTok Studio content tab per-video analytics | Medium | Medium |
| LinkedIn reaction type breakdown | LinkedIn | Refined selector per reaction button | Low | Low |
| Story views / exits | Instagram | Insights page scrape | Low | High |
| Twitter follower notifications | Twitter | Notifications page scrape | Low | Medium |

---

## Signal Coverage vs. Action Matrix

> This section maps every signal from the **High-Value Signals** breakdown to what the system **currently does**, what it **can act on**, and what **gaps remain**.

---

### A. Content Performance → Posting Strategy

| Signal | Status | How We Collect It | What Cloud Does With It | Gap |
|---|---|---|---|---|
| **Views** | ✅ TW (19/19), ~ TT (1/6) | Cloud Sync → `pollPostStats()` → `post_stats` table | Feeds engagement rate calc, performance tier, anomaly detection | TikTok views inconsistent (DOM extraction varies) |
| **Likes** | ✅ All 5 platforms | Cloud Sync → `pollPostStats()` | Engagement rate, performance tier (viral/good/avg/flop) | — |
| **Comments count** | ✅ All 5 platforms | Cloud Sync → `pollPostStats()` | Anomaly detection trigger, content scoring | — |
| **Shares/Reposts** | ~ TT (1/6), ~ TW (1/19), ✅ LI | Cloud Sync → `pollPostStats()` | Virality signal, content brief prioritization | Inconsistent on TikTok/Twitter |
| **Saves** | ❌ Not collected | `post_stats.saves` column exists, never populated | Would indicate evergreen content worth repurposing | Requires platform analytics page scrape |
| **Watch time / completion rate** | ❌ Not collected | `post_stats.avg_watch_time_seconds` + `completion_rate` columns exist | Would flag hooks that lose viewers, optimize video length | **TikTok Studio content tab** has per-video analytics |
| **Reach vs. impressions** | ❌ Not collected | `post_stats.reach` + `impressions` columns exist | Would enable shadowban detection (reach collapse + stable followers) | Requires IG Insights + TikTok Studio |
| **Performance tier** | ✅ TT, IG, TW | Computed in `detectAnomalies()` from rolling averages | Classifies viral/good/average/flop → drives content brief updates | LinkedIn/Threads not tiered yet |
| **Traffic source** | ❌ Not collected | `post_stats.traffic_source` column exists | Would show For You vs. Search vs. Profile → optimize discovery strategy | TikTok Studio overview tab has full breakdown |

**What cloud acts on today:**
- ✅ Engagement rate computed per post → feeds Thompson Sampling for posting time optimization
- ✅ Performance tier classification → flags viral posts in `cloud_action_queue`
- ✅ `post_stats_history` (105 snapshots) → rolling averages for anomaly detection
- ✅ Anomaly alerts: spike >50% or drop >30% → queued action

**What's missing for full coverage:**
- TikTok Studio scraper (overview + content + viewers tabs) — **HIGH PRIORITY**
- Instagram Insights scraper (professional dashboard) — MEDIUM
- Saves metric from both platforms

---

### B. Comment Sentiment → Content Topics

| Signal | Status | How We Collect It | What Cloud Does With It | Gap |
|---|---|---|---|---|
| **Comment text** | ✅ TT, IG, TW, Threads | Comment services (3004-3007) → `pollComments()` → `platform_comments` table | Raw text available for analysis | — |
| **Username** | ✅ All 4 | Extracted with each comment | Cross-reference with follower events, DM leads | — |
| **Like count** | ✅ All 4 | Per-comment engagement metric | Identifies high-signal comments worth responding to | — |
| **is_question** | ✅ All 4 | Rule-based: `?` detection in text | Flags questions for FAQ content generation | — |
| **is_testimonial** | Schema ready | `platform_comments.is_testimonial` column exists | Would identify social proof for repurposing | Needs classifier |
| **Sentiment** | ❌ Not classified | `platform_comments.sentiment` column exists, never populated | Would classify positive/negative/neutral → drive content topics | Needs GPT-4o mini or rule-based classifier |
| **@mention in others' posts** | ✅ TW, TT (search) | Brand mention monitoring scans comment text | Alerts on mentions, tracks word-boundary matches | IG/Threads limited to existing comments in DB |

**What cloud acts on today:**
- ✅ Comment text collected with dedup (`platform:post_id:username:text_80`) — 5 rows and growing
- ✅ `is_question` flag set for `?`-containing comments
- ✅ Self-comment tagging (own handles filtered with `_is_own_comment`)
- ✅ Brand mention scanning across all comment text after each sync

**What's missing for full coverage:**
- **Sentiment classification** — LOW effort, HIGH value: GPT-4o mini batch classify on sync
- Testimonial detection — rule-based ("love this", "amazing", "helped me") + AI
- Auto-generate FAQ content from question-type comments
- Objection identification → rebuttal post suggestions

---

### C. New Follower Attribution → Funnel Understanding

| Signal | Status | How We Collect It | What Cloud Does With It | Gap |
|---|---|---|---|---|
| **Follower username** | ✅ IG, TT | Activity feed scrape → `pollFollowers()` → `follower_events` table | Know WHO followed | — |
| **Follow event type** | ✅ IG, TT | "started following you" / "followed you" text detection | Distinguish follow vs. unfollow | — |
| **Profile URL** | ✅ IG, TT | Extracted from activity feed | Enable profile lookup for ICP scoring | — |
| **Follower bio / account type** | Schema ready | `follower_events.bio` + `follower_count` columns exist | Would enable ICP matching for DM outreach prioritization | Requires profile scrape per follower |
| **Which post drove follow** | ❌ Not tracked | Not available in activity feed | Would correlate content type → follower acquisition | Need timestamp correlation or activity sequence |
| **Follow/unfollow delta per post** | ❌ Not computed | Could derive from `follower_events` timestamps vs. `post_stats.created_at` | Net follower impact per piece of content | Computation logic not built |

**What cloud acts on today:**
- ✅ Follower events schema deployed with dedup key (`platform:event_type:username`)
- ✅ False positive hardening: username regex, 18-element nav blocklist, DOM dedup, domain check
- ✅ IG + TikTok polling built and tested

**What's missing for full coverage:**
- Twitter follower notifications (notifications page scrape) — LOW priority
- Post attribution (correlate follow timestamp with publish times) — MEDIUM
- ICP scoring from follower profiles — MEDIUM (requires per-follower profile scrape)

---

### D. DM Intent Classification → Sales Pipeline

| Signal | Status | How We Collect It | What Cloud Does With It | Gap |
|---|---|---|---|---|
| **DM text** | ✅ IG, TT, TW, LI | DM services (3100, 3102, 3003, 3105) → `pollDMs()` → `platform_dms` table | Raw conversation data available | — |
| **Sender username** | ✅ All 4 | Extracted per message | Cross-reference with CRM contacts | — |
| **Direction (in/out)** | ✅ All 4 | Detected from DOM context | Distinguish inbound leads from outbound outreach | — |
| **Lead score (0-100)** | ✅ All 4 | `computeLeadScore()` — rule-based: length, `?`, business keywords, urgency | Prioritize which DMs to respond to first | Rule-based only |
| **Conversation thread** | Partial | Multiple messages per conversation visible, but not full history | Context for reply generation | Full thread reconstruction not automated |
| **Time-to-first-reply** | ❌ Not tracked | Would need first inbound timestamp vs. first outbound in same thread | Response time SLA tracking | Computation not built |
| **Intent classification** | ❌ Not automated | `platform_dms` has text, but no AI classification | Would route: inquiry / collaboration / complaint / spam | **HIGH PRIORITY** — needs GPT-4o |
| **Auto reply suggestions** | ❌ Not built | CRM Brain pipeline has draft framework | Would generate context-aware reply options | Framework exists, needs wiring |
| **Follow-up sequences** | ❌ Not automated | CRM outreach engine has lifecycle stages | Would trigger time-based follow-ups | Logic designed, not triggered from DMs |

**What cloud acts on today:**
- ✅ DMs polling across 4 platforms with dedup
- ✅ Lead scoring (0-100) with multi-factor rule engine
- ✅ CRM contact sync — DMs create/update contact records
- ✅ Domain verification prevents cross-platform bleed

**What's missing for full coverage:**
- **AI intent classification** — HIGH priority: GPT-4o classify each new DM
- Auto reply suggestion generation — MEDIUM
- CRM pipeline routing (intent → stage transition) — MEDIUM
- Follow-up sequence triggers from DM inactivity — MEDIUM

---

### E. LinkedIn-Specific → B2B Pipeline

| Signal | Status | How We Collect It | What Cloud Does With It | Gap |
|---|---|---|---|---|
| **Post reactions (total)** | ✅ | Cloud Sync → `pollPostStats()` | Engagement tracking | — |
| **Reaction type breakdown** | ❌ | `post_stats` has total only | Would show which content gets "Insightful" vs. "Like" → optimize for decision-makers | Needs refined selector per reaction button |
| **Post comments** | ✅ Count | Cloud Sync → `pollPostStats()` | — | Text not collected (no LinkedIn comment service) |
| **Post reposts** | ✅ | Cloud Sync → `pollPostStats()` | Virality signal | — |
| **Connection accept rate** | Computable | `linkedin_invitations` has sent/accepted data | Would score prospecting effectiveness | Computation not built — straightforward query |
| **Profile visit count** | ❌ | Dashboard page shows "Who viewed your profile" | Would track inbound interest, optimize profile | Needs dashboard page scrape |
| **InMail response rate** | ❌ | Not tracked | Would optimize InMail templates | No InMail automation |
| **Connection invitations** | ✅ | Port 3105 → `linkedin_invitations` (12 rows) | Track sent/received, lifecycle | — |
| **People search** | ✅ | Port 3105 → degree filter, pagination, 10/page | Lead discovery | — |
| **Connection requests** | ✅ | With/without note (300 char max) via custom-invite URL | Outbound prospecting | — |
| **DM / messaging** | ✅ | Compose + send via messaging page | Lead nurturing | — |
| **Lead scoring** | ✅ | 0-100 scoring with title/company/location/activity factors | Prioritize outreach | — |
| **Prospects pipeline** | ✅ | 55 records, 6-step lifecycle | Full prospect management | — |

**What cloud acts on today:**
- ✅ Full prospect pipeline: search → score → connect (with note) → DM → track
- ✅ Outreach engine with 6-step cycle and rate limiting (20 connections/day, 80/week)
- ✅ Active hours enforcement (8am-6pm) with human-like delays (2-5s)
- ✅ AI message generation via GPT-4o

**What's missing for full coverage:**
- Connection accept rate computation — LOW effort (SQL query on existing data)
- Profile visit count scrape — MEDIUM
- Reaction type breakdown — LOW effort (selector refinement)
- Post comment text collection — MEDIUM (need LinkedIn comment extraction)

---

### F. Engagement Anomaly Detection → Reactive Strategy

| Signal | Status | How We Collect It | What Cloud Does With It | Gap |
|---|---|---|---|---|
| **Engagement spike (>50%)** | ✅ | `detectAnomalies()` on each `post_stats` sync | Alert + queue action in `cloud_action_queue` | — |
| **Engagement drop (>30%)** | ✅ | 3-snapshot rolling average comparison | Alert + trigger content audit suggestion | — |
| **Severity classification** | ✅ | low/medium/high thresholds | High severity → immediate action queue | — |
| **Consecutive drop detection** | ✅ | Rolling window tracks sustained declines | Catches gradual decline, not just one-off | — |
| **Shadowban proxy** | ❌ | Would need reach/impressions (not collected) | Would detect: reach collapse + stable follower count = potential shadowban | Requires IG Insights + TikTok reach data |
| **Auto-pause posting** | ❌ | Action queue framework exists | Would halt scheduled posts during anomaly investigation | Scheduler integration not wired |

**What cloud acts on today:**
- ✅ Full anomaly detection pipeline: monitor 5 metrics (views, likes, comments, shares, engagement_rate)
- ✅ Minimum thresholds to avoid noise (views≥5, likes≥2, etc.)
- ✅ `engagement_anomalies` table with dedup
- ✅ `cloud_action_queue` for high-severity events
- ✅ `post_stats_history` (105 snapshots) for rolling averages

**What's missing for full coverage:**
- Shadowban proxy detection — needs impressions/reach data first
- Auto-pause posting integration with scheduler — MEDIUM
- A/B test trigger on consecutive drops — future enhancement

---

### G. Upwork Freelancing → Revenue Pipeline

| Signal | Status | How We Collect It | What Cloud Does With It | Gap |
|---|---|---|---|---|
| **Job search** | ✅ | Full filter support: keywords, budget, experience, posted within | Discover relevant opportunities | — |
| **Job scoring (0-100)** | ✅ | 5 factors: budget, skills, client, competition, freshness | Prioritize which jobs to apply to | — |
| **AI proposal generation** | ✅ | GPT-4o with job context | Personalized cover letters | — |
| **Proposal submission** | ✅ Battle-tested | Fixed-price + hourly, OS-level input, dry-run, modal handling | Automated application pipeline | — |
| **File attachments** | ✅ | macOS file dialog automation | Portfolio/resume upload with proposals | — |
| **Job monitoring** | ✅ | Watches + periodic scan | Alert on new matching jobs | — |
| **Messaging** | ✅ | List, read, send, unread count | Client communication | — |
| **Application tracking** | ✅ | `GET /api/upwork/applications` | Track submitted proposals | — |

**Fully operational — no critical gaps.** See [UPWORK_PROPOSAL_GUIDE.md](./UPWORK_PROPOSAL_GUIDE.md).

---

### H. Market Research → Competitive Intelligence

| Signal | Status | Platform | Endpoint |
|---|---|---|---|
| **Keyword search** | ✅ | IG, TW, TT, Threads | `POST /api/research/search` (port 3106) |
| **Competitor research** | ✅ | IG, TW, TT, Threads | `POST /api/research/competitors` |
| **Top creator ranking** | ✅ | All 4 | Ranked by total engagement |
| **Per-post metrics** | ✅ | All 4 | author, likes, views, comments, shares, URL, text |

**Fully operational — no critical gaps.**

---

## Overall Coverage Summary

### What the system CAN act on today (automated)

1. **Content performance tracking** — views, likes, comments, shares across 3-5 platforms → `post_stats` + `post_stats_history`
2. **Comment text extraction** — full text with metadata across 4 platforms → `platform_comments`
3. **Follower event detection** — IG + TikTok activity feed scrape → `follower_events`
4. **DM collection + lead scoring** — 4 platforms, rule-based 0-100 scoring → `platform_dms`
5. **Engagement anomaly detection** — spike/drop alerting with severity → `engagement_anomalies` + `cloud_action_queue`
6. **Brand mention monitoring** — cross-platform @mention and text scanning → `brand_mentions`
7. **LinkedIn prospect pipeline** — search → score → connect → DM → track (55 prospects, 12 invitations)
8. **Upwork proposal pipeline** — search → score → generate → submit (battle-tested, real proposal submitted)
9. **Market research** — keyword search + competitor ranking across 4 platforms
10. **Comment posting** — automated replies on TW, IG, TT, Threads (with AI generation on Twitter)

### What the system observes but doesn't act on yet

| Signal | Has Data? | Missing Action |
|---|---|---|
| Comment text | ✅ 5 rows | No sentiment classification, no FAQ generation |
| DM text | ✅ 10 rows | No intent classification, no auto-reply suggestions |
| Lead score | ✅ Computed | No CRM pipeline routing, no follow-up triggers |
| Anomaly alerts | ✅ Detection active | No auto-pause posting, no A/B test triggers |
| Follower events | ✅ Schema + polling | No post attribution, no ICP scoring |

### What the system can't observe yet

| Signal | Platforms | Effort to Add |
|---|---|---|
| Watch time / completion rate | TikTok | Medium — TikTok Studio content tab |
| Traffic sources | TikTok | Low — TikTok Studio overview tab |
| Audience demographics | TikTok | Medium — TikTok Studio viewers/followers tabs |
| Reach / impressions | IG, TikTok | High — requires analytics page scrape |
| Saves | IG, TikTok | Medium — analytics page |
| Story views / exits | Instagram | High — Insights page |
| Profile visit count | LinkedIn | Low — dashboard page |
| Reaction type breakdown | LinkedIn | Low — selector refinement |
| Twitter follower notifications | Twitter | Medium — notifications page |
| Sentiment on comments | All | Low — GPT-4o mini batch on existing data |
| Intent on DMs | All | Medium — GPT-4o with conversation context |

---

## Supabase Data Snapshot (Current)

| Table | Rows | Notes |
|---|---|---|
| `post_stats` | 30 | TikTok: 6, Instagram: 5, Twitter: 19 |
| `post_stats_history` | 105 | Rolling snapshots for anomaly detection |
| `platform_comments` | 5 | TikTok: 2, Twitter: 3 (text + metadata) |
| `platform_dms` | 10 | All LinkedIn (with lead scores) |
| `platform_notifications` | 4 | Mixed |
| `follower_events` | 0 | Schema ready, polling built |
| `brand_mentions` | 0 | Schema ready, monitoring active |
| `engagement_anomalies` | 0 | Schema ready, detection active |
| `cloud_action_queue` | 0 | Schema ready, queue processing active |
| `linkedin_invitations` | 12 | Sent/received tracking |
| `linkedin_prospects` | 55 | Search + connection pipeline |
| `content_learnings` | 0 | Schema ready for content strategy |

---

## Cloud Sync Polling Schedule

| Data Type | Default Interval | Platforms |
|---|---|---|
| DMs | 180s (3 min) | Instagram, TikTok, Twitter, LinkedIn |
| Notifications | 300s (5 min) | All |
| Post Stats | 900s (15 min) | All |
| Comments | 600s (10 min) | Instagram, TikTok, Twitter, Threads |
| Followers | 600s (10 min) | Instagram, TikTok |
| Invitations | configurable | LinkedIn only |
| Anomaly Detection | After each post_stats sync | System-wide |
| Mention Monitoring | After each comments sync | System-wide |

---

## False Positive Prevention (8 Layers)

1. **Cross-platform domain verification** — `verifyPageDomain()` checks URL after navigation
2. **URL domain validation** — sync layer verifies post_url matches platform domain
3. **Text quality filters** — min length, min letters, rejects noise
4. **Username validation** — regex `[a-zA-Z0-9_.]+`, length bounds, blocklist (18 nav elements)
5. **post_id sanity** — reject HTML, URLs, >100 chars; LinkedIn requires numeric ≥5 digits
6. **Self-comment tagging** — cross-platform `ALL_OWN_HANDLES` set
7. **Dedup keys** — unique composite keys on all tables, `ignoreDuplicates: true`
8. **Word-boundary matching** — `@handle` must be followed by non-alphanumeric or end-of-string
