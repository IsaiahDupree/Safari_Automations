# Safari Automation File Structure

**Generated:** 2026-01-30

---

## 📁 Directory Overview

```
Backend/
├── automation/                    # Core Safari automation modules
├── scripts/auto_engagement/       # Engagement scripts (comment bots)
├── services/engagement/           # Engagement control services
├── services/                      # Orchestrators
├── api/endpoints/                 # API endpoints
└── SoraWatermarkCleaner/         # Sora video processing
```

---

## 🎯 Core Safari Automation (`Backend/automation/`)

### Platform Posters (Post content to platforms)
| File | Size | Purpose |
|------|------|---------|
| `safari_twitter_poster.py` | 90KB | Twitter/X posting with media |
| `safari_threads_poster.py` | 48KB | Threads posting |
| `safari_instagram_poster.py` | 28KB | Instagram posting |
| `safari_reddit_poster.py` | 36KB | Reddit posting |

### Platform Engagement (Auto-commenting)
| File | Size | Purpose |
|------|------|---------|
| `tiktok_engagement.py` | 62KB | TikTok FYP engagement |
| `threads_auto_commenter.py` | 42KB | Threads auto-commenter |
| `instagram_feed_auto_commenter.py` | 22KB | Instagram feed commenter |
| `instagram_comment_automation.py` | 17KB | Instagram comment automation |
| `run_fyp_engagement.py` | 18KB | FYP engagement runner |

### Sora Video Generation
| File | Size | Purpose |
|------|------|---------|
| `sora_full_automation.py` | 39KB | Full Sora automation |
| `sora_browser_automation.py` | 25KB | Browser-based Sora control |
| `safari_sora_scraper.py` | 16KB | Sora video scraping |

### Session & Login Management
| File | Size | Purpose |
|------|------|---------|
| `safari_session_manager.py` | 25KB | Multi-platform session manager |
| `tiktok_login_recorder.py` | 55KB | TikTok login recording |
| `tiktok_login_automation.py` | 32KB | TikTok login automation |
| `safari_tiktok_login.py` | 11KB | Safari TikTok login |
| `tiktok_session_manager.py` | 19KB | TikTok session management |

### Core Controllers
| File | Size | Purpose |
|------|------|---------|
| `safari_app_controller.py` | 43KB | Main Safari AppleScript controller |
| `engagement_scraper.py` | 19KB | Engagement data scraper |
| `browser_profile_manager.py` | 13KB | Browser profile management |

### Selectors & References
| File | Size | Purpose |
|------|------|---------|
| `tiktok_selectors.py` | 4KB | TikTok DOM selectors |
| `instagram_selectors.py` | 15KB | Instagram DOM selectors |
| `threads_selectors.py` | 17KB | Threads DOM selectors |

### DM Automation
| File | Size | Purpose |
|------|------|---------|
| `safari_twitter_dm.py` | 13KB | Twitter DM automation |
| `tiktok_messenger.py` | 14KB | TikTok DM messaging |

---

## 🤖 Auto-Engagement Scripts (`Backend/scripts/auto_engagement/`)

| File | Size | Purpose |
|------|------|---------|
| `safari_controller.py` | 8KB | Core Safari controller for engagement |
| `ai_comment_generator.py` | 7KB | OpenAI-powered comment generation |
| `instagram_engagement.py` | 20KB | Instagram engagement module |
| `threads_engagement.py` | 22KB | Threads engagement module |
| `tiktok_engagement.py` | 21KB | TikTok engagement module |
| `twitter_engagement.py` | 16KB | Twitter engagement module |

---

## ⚙️ Engagement Services (`Backend/services/engagement/`)

| File | Size | Purpose |
|------|------|---------|
| `engagement_controller.py` | 27KB | **Main controller** - start/stop, rate limiting |
| `engagement_runner.py` | 14KB | Executes engagement tasks |
| `engagement_service.py` | 11KB | High-level engagement API |
| `comment_tracker.py` | 15KB | Supabase comment tracking |

---

## 🎬 Sora Pipeline (`Backend/automation/sora/`)

| File | Size | Purpose |
|------|------|---------|
| `pipeline.py` | 34KB | Multi-part video pipeline |
| `sora_controller.py` | 28KB | Sora browser control |
| `generation_monitor.py` | 8KB | Monitor video generation |
| `video_downloader.py` | 8KB | Download generated videos |

---

## 🔧 Orchestrators (`Backend/services/`)

| File | Purpose |
|------|---------|
| `safari_automation_orchestrator.py` | **Main Safari orchestrator** - coordinates all Safari tasks |
| `master_orchestrator.py` | Full pipeline orchestrator |
| `content_analysis_orchestrator.py` | Content analysis coordination |

---

## 🌐 API Endpoints (`Backend/api/endpoints/`)

| File | Prefix | Purpose |
|------|--------|---------|
| `safari_automation.py` | `/api/safari/` | Safari orchestrator control |
| `safari_sessions.py` | `/api/safari-sessions/` | Session management |
| `engagement_control.py` | `/api/engagement-control/` | Engagement start/stop |
| `sora_automation.py` | `/api/sora/` | Sora automation |
| `sora_pipeline.py` | `/api/sora-pipeline/` | Sora pipeline |

---

## 📚 Documentation (`Backend/automation/`)

| File | Topic |
|------|-------|
| `SAFARI_USAGE.md` | Safari automation usage guide |
| `SAFARI_PERMISSIONS.md` | Required Safari permissions |
| `SAFARI_EXTENSION_SOLUTION.md` | Safari extension approach |
| `TIKTOK_AUTOMATION_STRATEGY.md` | TikTok automation strategy |
| `TIKTOK_SELECTORS_REFERENCE.md` | TikTok selector reference |
| `FYP_ENGAGEMENT_README.md` | FYP engagement guide |
| `QUICK_START_FYP.md` | Quick start for FYP |

---

## 🔑 Key API Endpoints

### Engagement Control
```bash
# Start engagement bot
curl -X POST http://localhost:5555/api/engagement-control/start

# Stop engagement bot
curl -X POST http://localhost:5555/api/engagement-control/stop

# Get status
curl http://localhost:5555/api/engagement-control/status

# Disable platform
curl -X POST http://localhost:5555/api/engagement-control/platform/twitter/disable
```

### Safari Orchestrator
```bash
# Get status
curl http://localhost:5555/api/safari/status

# Stop orchestrator
curl -X POST http://localhost:5555/api/safari/stop

# Get queue
curl http://localhost:5555/api/safari/queue
```

---

## 🏗️ Architecture Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    API Layer                                 │
│  engagement_control.py  │  safari_automation.py              │
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────┐
│                 Service Layer                                │
│  engagement_controller.py  │  safari_automation_orchestrator │
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────┐
│              Engagement Runner                               │
│  engagement_runner.py → Platform Modules                     │
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────┐
│           Platform Modules (scripts/auto_engagement/)        │
│  instagram_engagement │ threads_engagement │ tiktok_engagement│
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────┐
│              Safari Controller                               │
│  safari_controller.py → AppleScript → Safari Browser         │
└─────────────────────────────────────────────────────────────┘
```

---

## 📊 Summary

| Category | File Count |
|----------|------------|
| Safari automation files | ~40 |
| Sora automation files | ~15 |
| Engagement files | ~25 |
| Orchestrator files | ~10 |
| Documentation | ~20 |
| **Total** | **~110 files** |
