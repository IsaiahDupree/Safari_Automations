# PRD: Safari Browser Automation Management System

**Version:** 1.0  
**Date:** January 28, 2026  
**Status:** Active  
**Priority:** High

---

## Executive Summary

Unified Safari browser automation system that orchestrates all social media activities through a single browser instance. Manages commenting, content polling, Sora video generation, Twitter posting, and multi-platform distribution via Blotato - all within Safari's authenticated sessions.

---

## Problem Statement

Current automation runs multiple independent Safari tasks without coordination, leading to:
- Browser conflicts when multiple tasks try to control Safari simultaneously
- Inefficient use of rate limits across platforms
- No unified queue management for browser operations
- Sora videos posted with watermarks before processing
- Missing integration between content discovery and posting workflow

---

## Goals

1. **Single Browser Queue**: All Safari operations go through one managed queue
2. **Smart Scheduling**: 30 comments/hour, 1 tweet/2 hours, 30 Sora generations/day
3. **Watermark Pipeline**: Auto-remove Sora watermarks via BlankLogo before posting
4. **Trend-Informed Content**: Generate videos based on discovered trends/offers
5. **Multi-Platform Distribution**: Post processed videos to all Blotato accounts

---

## Feature Requirements

### SAFARI-001: Browser Queue Manager

**Priority:** P0  
**Description:** Central queue that serializes all Safari browser operations

```
Queue Priority (highest first):
1. Active Sora generation polling (check every 30s when generating)
2. Twitter posting (time-sensitive, every 2 hours)
3. Commenting (30/hour = 1 every 2 minutes)
4. Stats polling (passive, fill gaps)
5. Trend discovery scraping (background)
```

**Acceptance Criteria:**
- [ ] Only one Safari operation executes at a time
- [ ] Higher priority tasks can preempt lower priority waits
- [ ] Failed tasks retry with exponential backoff
- [ ] Queue state persists across restarts

---

### SAFARI-002: Unified Comment Engine

**Priority:** P0  
**Description:** Comment across Twitter, TikTok, Instagram, Threads at 30/hour

| Platform | Comments/Hour | Interval |
|----------|---------------|----------|
| Twitter | 10 | 6 min |
| TikTok | 10 | 6 min |
| Instagram | 5 | 12 min |
| Threads | 5 | 12 min |
| **Total** | **30** | ~2 min avg |

**Comment Strategy:**
- Scrape trending posts in niche
- Generate contextual AI comments
- Rotate accounts if available
- Track engagement received

**Acceptance Criteria:**
- [ ] Distributes comments across platforms
- [ ] Uses AI to generate relevant comments
- [ ] Respects platform rate limits
- [ ] Logs all comments with post URLs

---

### SAFARI-003: Sora Generation Pipeline

**Priority:** P0  
**Description:** Generate 30 videos/day based on trends and offers

**Daily Workflow:**
1. **Morning (6 AM)**: Analyze overnight trends, queue 10 generations
2. **Midday (12 PM)**: Review performance, queue 10 more
3. **Evening (6 PM)**: Final batch of 10 based on day's trends

**Generation Triggers:**
- Trending topics in niche
- High-performing competitor content patterns
- Scheduled offer promotions
- Viral format templates

**Queue Management:**
- Max 3 concurrent Sora generations
- Poll every 30 seconds for completion
- Auto-download completed videos
- Trigger watermark removal on download

**Acceptance Criteria:**
- [ ] Queues generations based on trend analysis
- [ ] Polls Sora library for completion status
- [ ] Downloads videos automatically
- [ ] Triggers post-processing pipeline

---

### SAFARI-004: Watermark Removal Pipeline

**Priority:** P0  
**Description:** Process downloaded Sora videos through BlankLogo

**Pipeline:**
```
Sora Download → BlankLogo Watermark Removal → Video Analysis → Blotato Distribution
```

**Processing Steps:**
1. Detect new video in `/sora_downloads/`
2. Send to BlankLogo API for watermark removal
3. Save processed video to `/processed_videos/`
4. Analyze video content for captions/hashtags
5. Queue for multi-platform posting

**Acceptance Criteria:**
- [ ] Watches download folder for new videos
- [ ] Integrates with BlankLogo API
- [ ] Validates watermark removal success
- [ ] Queues processed videos for distribution

---

### SAFARI-005: Twitter Posting Schedule

**Priority:** P0  
**Description:** Post to Twitter every 2 hours (12 posts/day)

**Post Types (rotating):**
| Hour | Post Type | Content Source |
|------|-----------|----------------|
| 00:00 | Offer | Product promotion |
| 02:00 | Value | Educational/tip |
| 04:00 | Engagement | Question/poll |
| 06:00 | Video | Sora processed video |
| 08:00 | Offer | Product promotion |
| 10:00 | Story | Personal brand |
| 12:00 | Video | Sora processed video |
| 14:00 | Offer | Product promotion |
| 16:00 | Value | Educational/tip |
| 18:00 | Video | Sora processed video |
| 20:00 | Engagement | Question/poll |
| 22:00 | Offer | Product promotion |

**Acceptance Criteria:**
- [ ] Posts every 2 hours automatically
- [ ] Rotates content types
- [ ] Includes processed Sora videos when available
- [ ] Tracks post performance

---

### SAFARI-006: Blotato Multi-Platform Distribution

**Priority:** P1  
**Description:** Distribute processed videos to all connected accounts

**Platforms via Blotato:**
- Twitter/X
- TikTok
- Instagram Reels
- YouTube Shorts
- Facebook Reels
- LinkedIn

**Distribution Logic:**
- Stagger posts across platforms (15-30 min gaps)
- Customize captions per platform
- Track which videos posted where
- Avoid duplicate posting

**Acceptance Criteria:**
- [ ] Integrates with Blotato API
- [ ] Distributes to all active accounts
- [ ] Staggers posts to avoid spam detection
- [ ] Tracks distribution status

---

### SAFARI-007: Stats & Analytics Polling

**Priority:** P2  
**Description:** Collect engagement stats during browser idle time

**Metrics to Collect:**
- Post impressions/reach
- Engagement rates
- Follower changes
- Comment responses
- Video view counts

**Polling Schedule:**
- Every 15 min during idle periods
- Prioritize recent posts (< 24 hours)
- Store in analytics tables

**Acceptance Criteria:**
- [ ] Polls during queue idle time
- [ ] Updates analytics database
- [ ] Triggers alerts on viral content

---

## 1-Hour Timeframe Schedule

### Minute-by-Minute Breakdown

```
:00 - Twitter Post (if 2-hour mark) OR Comment #1
:02 - Comment #2
:04 - Comment #3 + Sora Poll (if generating)
:06 - Comment #4
:08 - Comment #5
:10 - Comment #6 + Stats Check
:12 - Comment #7
:14 - Comment #8
:16 - Comment #9 + Sora Poll
:18 - Comment #10
:20 - Comment #11
:22 - Comment #12 + Stats Check
:24 - Comment #13
:26 - Comment #14
:28 - Comment #15 + Sora Poll
:30 - Comment #16
:32 - Comment #17
:34 - Comment #18 + Stats Check
:36 - Comment #19
:38 - Comment #20
:40 - Comment #21 + Sora Poll
:42 - Comment #22
:44 - Comment #23
:46 - Comment #24 + Stats Check
:48 - Comment #25
:50 - Comment #26
:52 - Comment #27 + Sora Poll
:54 - Comment #28
:56 - Comment #29
:58 - Comment #30 + Stats Check + Trend Scrape
```

### Task Duration Estimates

| Task | Duration | Frequency/Hour |
|------|----------|----------------|
| Comment | 15-30s | 30x |
| Sora Poll | 10-20s | 6x |
| Stats Check | 20-30s | 6x |
| Twitter Post | 30-60s | 0.5x |
| Trend Scrape | 60-120s | 1x |

**Total Active Time:** ~25-30 min/hour  
**Idle/Buffer Time:** ~30-35 min/hour

---

## Data Models

### Safari Task Queue

```sql
CREATE TABLE safari_task_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_type TEXT NOT NULL, -- 'comment', 'tweet', 'sora_poll', 'stats', 'scrape'
    priority INTEGER DEFAULT 5, -- 1=highest, 10=lowest
    platform TEXT,
    payload JSONB NOT NULL,
    status TEXT DEFAULT 'pending', -- pending, running, completed, failed
    scheduled_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    retry_count INTEGER DEFAULT 0,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Sora Video Pipeline

```sql
CREATE TABLE sora_video_pipeline (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sora_job_id TEXT,
    prompt TEXT NOT NULL,
    trend_source TEXT, -- what triggered this generation
    status TEXT DEFAULT 'queued', -- queued, generating, downloading, processing, ready, distributed
    
    -- File paths
    raw_video_path TEXT,
    processed_video_path TEXT,
    
    -- Processing
    watermark_removed BOOLEAN DEFAULT FALSE,
    blanklogo_job_id TEXT,
    
    -- Distribution
    blotato_submission_id TEXT,
    platforms_posted TEXT[] DEFAULT '{}',
    
    -- Timestamps
    queued_at TIMESTAMPTZ DEFAULT NOW(),
    generated_at TIMESTAMPTZ,
    processed_at TIMESTAMPTZ,
    distributed_at TIMESTAMPTZ
);
```

### Comment Tracking

```sql
CREATE TABLE safari_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    platform TEXT NOT NULL,
    post_url TEXT NOT NULL,
    post_author TEXT,
    comment_text TEXT NOT NULL,
    ai_generated BOOLEAN DEFAULT TRUE,
    posted_at TIMESTAMPTZ DEFAULT NOW(),
    engagement_received INTEGER DEFAULT 0,
    reply_count INTEGER DEFAULT 0
);
```

---

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/safari/queue` | GET | View current queue |
| `/api/safari/queue` | POST | Add task to queue |
| `/api/safari/status` | GET | Browser automation status |
| `/api/safari/comments/today` | GET | Today's comments |
| `/api/safari/sora/pipeline` | GET | Video pipeline status |
| `/api/safari/sora/generate` | POST | Queue new generation |
| `/api/safari/pause` | POST | Pause automation |
| `/api/safari/resume` | POST | Resume automation |

---

## Integration Points

### BlankLogo Watermark Remover
- Watch `/sora_downloads/` for new files
- POST to BlankLogo API
- Poll for completion
- Download processed video

### Blotato Distribution
- POST video with platform-specific captions
- Track submission IDs
- Poll for post confirmations

### Trend Analysis
- Feed trends into Sora prompt generation
- Use high-performing content patterns
- Align with offer schedule

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Comments posted/day | 720 (30/hour × 24) |
| Twitter posts/day | 12 |
| Sora videos generated/day | 30 |
| Videos processed & distributed/day | 30 |
| Safari conflicts/day | 0 |
| Queue processing uptime | 99%+ |

---

## Implementation Phases

### Phase 1: Core Queue (Week 1)
- [ ] Safari task queue manager
- [ ] Comment scheduling (30/hour)
- [ ] Twitter posting (1/2 hours)

### Phase 2: Sora Pipeline (Week 2)
- [ ] Sora polling integration
- [ ] BlankLogo watermark removal
- [ ] Download automation

### Phase 3: Distribution (Week 3)
- [ ] Blotato API integration
- [ ] Multi-platform posting
- [ ] Analytics polling

### Phase 4: Intelligence (Week 4)
- [ ] Trend-informed generation
- [ ] Performance optimization
- [ ] AI comment improvement

---

## Dependencies

- Safari browser with logged-in sessions (Twitter, TikTok, Instagram, Threads, Sora)
- BlankLogo API access
- Blotato API access
- OpenAI API for comment generation
- Existing automation modules in `/Backend/automation/`

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Platform rate limits | Configurable intervals, exponential backoff |
| Safari crashes | Auto-restart, queue persistence |
| Account suspensions | Multiple accounts, conservative limits |
| BlankLogo downtime | Queue videos, process when available |

---

## Appendix: Existing Modules to Integrate

```
/Backend/automation/
├── safari_twitter_poster.py      ✅ Ready
├── safari_twitter_dm.py          ✅ Ready
├── safari_instagram_poster.py    ✅ Ready
├── safari_instagram_scraper.py   ✅ Ready
├── safari_threads_poster.py      ✅ Ready
├── safari_tiktok_login.py        ✅ Ready
├── safari_reddit_poster.py       ✅ Ready
├── sora_full_automation.py       ✅ Ready
├── safari_app_controller.py      ✅ Ready
└── safari_session_manager.py     ✅ Ready
```
