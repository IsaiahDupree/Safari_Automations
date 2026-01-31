# PRD: Daily Sora Video Automation System

**Version:** 1.0  
**Date:** January 26, 2026  
**Status:** Implementation Ready  
**Priority:** High  
**Character:** @isaiahdupree

---

## Executive Summary

Fully automated daily video generation pipeline that:
1. Uses all 30 daily Sora video generations
2. Removes watermarks via BlankLogo (local)
3. Creates single videos OR 3-part story movies
4. Incorporates trending topics from social engagement
5. Publishes to YouTube daily
6. Integrates with existing pub/sub architecture

### Daily Output Target
```
30 Sora videos → Watermark Removal → 10 singles + 6 three-part movies → YouTube
```

---

## System Architecture

### Pub/Sub Event Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        DAILY SORA AUTOMATION                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────┐     ┌──────────────┐     ┌────────────────┐            │
│  │ Trend       │────▶│ Story        │────▶│ Sora Video     │            │
│  │ Collector   │     │ Generator    │     │ Generator      │            │
│  └─────────────┘     └──────────────┘     └───────┬────────┘            │
│        │                                          │                      │
│        │ trend.collected                          │ sora.video.completed │
│        ▼                                          ▼                      │
│  ┌─────────────┐     ┌──────────────┐     ┌────────────────┐            │
│  │ Comment     │     │ BlankLogo    │◀────│ Video          │            │
│  │ Analyzer    │     │ Watermark    │     │ Downloader     │            │
│  └─────────────┘     │ Remover      │     └────────────────┘            │
│                      └──────┬───────┘                                    │
│                             │ watermark.removed                          │
│                             ▼                                            │
│                      ┌──────────────┐     ┌────────────────┐            │
│                      │ Video        │────▶│ YouTube        │            │
│                      │ Stitcher     │     │ Publisher      │            │
│                      │ (3-part)     │     └────────────────┘            │
│                      └──────────────┘            │                       │
│                                                  │ youtube.published     │
│                                                  ▼                       │
│                                           ┌────────────────┐            │
│                                           │ Analytics      │            │
│                                           │ Tracker        │            │
│                                           └────────────────┘            │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Requirements

### SORA-AUTO-001: Daily Usage Optimization
**Priority:** P0 (Critical)

Automatically use all 30 daily Sora video generations.

| Requirement | Description |
|-------------|-------------|
| Usage Check | Check remaining Sora credits at start of day |
| Batch Planning | Plan 30 video generations based on content mix |
| Rate Limiting | Respect Sora's 3-concurrent generation limit |
| Retry Logic | Retry failed generations before end of day |
| Usage Tracking | Log all generations with timestamps |

#### Content Mix Strategy
```
Daily 30 Videos:
├── 12 videos → 4 three-part story movies (@isaiahdupree character)
├── 10 videos → Single standalone videos (trending topics)
└── 8 videos → Buffer for retries / experiments
```

---

### SORA-AUTO-002: BlankLogo Watermark Removal
**Priority:** P0 (Critical)

Process all Sora videos through local BlankLogo watermark remover.

| Requirement | Description |
|-------------|-------------|
| Local Integration | Use BlankLogo from `/Users/isaiahdupree/Documents/Software/ai-video-platform` |
| Auto-Processing | Automatically process each downloaded Sora video |
| Quality Check | Verify output quality after removal |
| Fallback | Keep original if removal fails |
| Batch Support | Process multiple videos in parallel |

#### BlankLogo Integration
```python
# Path to BlankLogo
BLANKLOGO_PATH = "/Users/isaiahdupree/Documents/Software/ai-video-platform"

# Expected command
# node apps/watermark-remover/index.js --input video.mp4 --output clean.mp4
```

---

### SORA-AUTO-003: Trend-Based Story Generation
**Priority:** P0 (Critical)

Generate stories based on trending topics from social engagement.

| Source | Data Type | Usage |
|--------|-----------|-------|
| Comments | Recent replies on posts | Extract hot topics |
| Inbox | DM themes | Identify audience interests |
| Twitter | Trending hashtags | Current events |
| TikTok | Trending sounds/topics | Viral content ideas |

#### Story Types
1. **Single Videos** - Standalone content on trending topic
2. **3-Part Movies** - Story arc with @isaiahdupree character
   - Part 1: Setup/Hook
   - Part 2: Conflict/Development
   - Part 3: Resolution/CTA

---

### SORA-AUTO-004: @isaiahdupree Character Stories
**Priority:** P0 (Critical)

Create narrative videos featuring the @isaiahdupree Sora character.

| Story Element | Description |
|---------------|-------------|
| Character | @isaiahdupree (Sora saved character) |
| Themes | Random daily themes OR trend-based |
| Arc Structure | 3-part narrative (hook → conflict → resolution) |
| Style | Cinematic, engaging, shareable |

#### Story Theme Categories
```python
STORY_THEMES = [
    "day_in_life",      # A day in Isaiah's life
    "challenge",        # Overcoming an obstacle
    "discovery",        # Finding something new
    "adventure",        # Going somewhere exciting
    "creation",         # Building/making something
    "connection",       # Meeting someone new
    "transformation",   # Personal growth moment
    "humor",            # Funny situation
    "inspiration",      # Motivational journey
    "mystery"           # Solving a puzzle
]
```

---

### SORA-AUTO-005: YouTube Daily Publishing
**Priority:** P0 (Critical)

Publish processed videos to YouTube daily.

| Requirement | Description |
|-------------|-------------|
| Channel | Isaiah Dupree YouTube (Account ID: 228) |
| Schedule | Spread throughout day for optimal reach |
| Metadata | AI-generated titles, descriptions, tags |
| Thumbnails | Auto-generate from video frames |
| Playlists | Auto-add to "Sora Stories" playlist |

#### Publishing Schedule
```
Singles (10/day):
- 6:00 AM, 8:00 AM, 10:00 AM, 12:00 PM, 2:00 PM
- 4:00 PM, 6:00 PM, 8:00 PM, 9:00 PM, 10:00 PM

3-Part Movies (4/day):
- 9:00 AM (Parts 1-3 as playlist)
- 1:00 PM (Parts 1-3 as playlist)
- 5:00 PM (Parts 1-3 as playlist)
- 7:00 PM (Parts 1-3 as playlist)
```

---

### SORA-AUTO-006: Pub/Sub Event Integration
**Priority:** P0 (Critical)

Integrate with existing EventBus architecture.

#### Event Types

| Event | Publisher | Subscribers |
|-------|-----------|-------------|
| `sora.daily.started` | DailyScheduler | Logger, Dashboard |
| `sora.generation.queued` | StoryGenerator | SoraWorker |
| `sora.generation.completed` | SoraWorker | Downloader |
| `sora.video.downloaded` | Downloader | WatermarkRemover |
| `sora.watermark.removed` | WatermarkRemover | Stitcher, Publisher |
| `sora.movie.stitched` | Stitcher | Publisher |
| `sora.youtube.published` | Publisher | Analytics, Logger |
| `sora.daily.completed` | DailyScheduler | Dashboard, Notifier |

---

## Database Schema

```sql
-- Daily Sora generation plans
CREATE TABLE sora_daily_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    date DATE NOT NULL UNIQUE,
    total_credits INTEGER DEFAULT 30,
    used_credits INTEGER DEFAULT 0,
    singles_planned INTEGER DEFAULT 10,
    movies_planned INTEGER DEFAULT 4,
    status TEXT DEFAULT 'pending', -- pending, in_progress, completed, failed
    created_at TIMESTAMP DEFAULT NOW(),
    completed_at TIMESTAMP
);

-- Individual generation jobs
CREATE TABLE sora_generation_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id UUID REFERENCES sora_daily_plans(id),
    job_type TEXT NOT NULL, -- single, movie_part_1, movie_part_2, movie_part_3
    movie_id UUID, -- Groups 3-part movies
    prompt TEXT NOT NULL,
    theme TEXT,
    trend_source TEXT,
    character TEXT DEFAULT '@isaiahdupree',
    
    -- Status tracking
    status TEXT DEFAULT 'pending',
    sora_job_id TEXT,
    video_url TEXT,
    local_path TEXT,
    watermark_removed_path TEXT,
    
    -- Publishing
    youtube_video_id TEXT,
    published_at TIMESTAMP,
    
    -- Metadata
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Trend sources for story ideas
CREATE TABLE sora_trend_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_type TEXT NOT NULL, -- comment, dm, twitter, tiktok
    topic TEXT NOT NULL,
    relevance_score FLOAT DEFAULT 0.5,
    used_in_story BOOLEAN DEFAULT FALSE,
    discovered_at TIMESTAMP DEFAULT NOW()
);
```

---

## File Structure

```
Backend/services/sora_daily/
├── __init__.py
├── daily_scheduler.py      # Main daily orchestration
├── story_generator.py      # AI story/prompt generation
├── trend_collector.py      # Collect trends from engagement
├── watermark_service.py    # BlankLogo integration
├── youtube_publisher.py    # YouTube upload handling
└── events.py               # Pub/sub event definitions

Backend/api/endpoints/
└── sora_daily.py           # API endpoints for dashboard

dashboard/app/(dashboard)/sora-daily/
└── page.tsx                # Daily Sora dashboard
```

---

## API Endpoints

```
GET    /api/sora-daily/status           # Today's generation status
GET    /api/sora-daily/plan             # Today's plan details
POST   /api/sora-daily/start            # Manually start daily run
POST   /api/sora-daily/pause            # Pause daily run
GET    /api/sora-daily/jobs             # List all jobs for today
GET    /api/sora-daily/jobs/{id}        # Get specific job details
POST   /api/sora-daily/jobs/{id}/retry  # Retry failed job
GET    /api/sora-daily/trends           # Get collected trends
GET    /api/sora-daily/history          # Past daily runs
```

---

## Implementation Phases

### Phase 1: Core Pipeline (Week 1)
- [ ] Daily scheduler service
- [ ] Sora usage checker
- [ ] BlankLogo watermark removal integration
- [ ] Basic video download and storage

### Phase 2: Story Generation (Week 1-2)
- [ ] Trend collector from comments/DMs
- [ ] AI story generator with themes
- [ ] 3-part movie prompt generation
- [ ] @isaiahdupree character integration

### Phase 3: Publishing (Week 2)
- [ ] YouTube publisher service
- [ ] Metadata generation
- [ ] Scheduling logic
- [ ] Playlist management

### Phase 4: Dashboard & Monitoring (Week 2)
- [ ] Daily status dashboard
- [ ] Job monitoring UI
- [ ] Trend visualization
- [ ] Analytics integration

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Daily Sora Usage | 30/30 (100%) |
| Watermark Removal Success | 95%+ |
| YouTube Publish Success | 98%+ |
| 3-Part Movie Completion | 4/day |
| Single Video Completion | 10/day |

---

## Dependencies

| Dependency | Status | Notes |
|------------|--------|-------|
| Sora Safari Automation | ✅ Ready | `Backend/automation/sora/` |
| BlankLogo | ✅ Available | `/Users/isaiahdupree/Documents/Software/ai-video-platform` |
| Video Stitcher | ✅ Ready | `Backend/services/ai_video_pipeline/stitcher.py` |
| YouTube Publishing | ✅ Ready | Blotato Account ID 228 |
| EventBus | ✅ Ready | `Backend/services/event_bus.py` |
| Trend Sources | ✅ Ready | Comments, Inbox, Twitter data |
