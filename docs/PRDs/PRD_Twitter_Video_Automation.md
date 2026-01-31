# PRD: Twitter/X Video Posting Automation

## Overview

Safari-based browser automation for posting videos to Twitter/X, bypassing API limitations and supporting full media upload capabilities.

## Problem Statement

Twitter/X API has restrictive rate limits and requires paid access for video uploads. Browser automation enables:
- Unlimited video posts (within Twitter's natural limits)
- No API costs
- Full feature parity with web interface
- Session persistence across restarts

## Features

### TWIT-001: Safari Session Management
**Priority:** P0 (Critical)

Manage authenticated Twitter sessions in Safari.

| Requirement | Description |
|-------------|-------------|
| Login detection | Check if user is logged in via DOM inspection |
| Session persistence | Store cookies/state across app restarts |
| Multi-account | Support switching between accounts |
| Session health | Periodic validation of session status |

**Implementation:** `Backend/automation/safari_session_manager.py`

### TWIT-002: Video Upload Automation
**Priority:** P0 (Critical)

Upload videos via Safari automation.

| Requirement | Description |
|-------------|-------------|
| File selection | Programmatic file picker interaction |
| Upload progress | Monitor upload completion |
| Format support | MP4, MOV, WebM (Twitter-supported formats) |
| Size validation | Check file size < 512MB before upload |
| Duration check | Validate video length ≤ 2:20 for free accounts |

**Implementation:** `Backend/automation/safari_twitter_poster.py`

### TWIT-003: Tweet Composition
**Priority:** P0 (Critical)

Compose and post tweets with media.

| Requirement | Description |
|-------------|-------------|
| Text input | Type tweet text via JS injection or keystrokes |
| Character count | Validate ≤ 280 characters |
| Media attachment | Attach 1-4 media files |
| Post button | Click post via JS or keyboard shortcut (Cmd+Enter) |
| Success verification | Confirm post appeared in timeline |

**Selectors:** `Backend/config/twitter_selectors.py`

### TWIT-004: Post Verification
**Priority:** P1 (High)

Verify successful post and extract metadata.

| Requirement | Description |
|-------------|-------------|
| URL extraction | Get tweet URL after posting |
| Tweet ID | Extract tweet ID for tracking |
| Error detection | Identify rate limits, content violations |
| Retry logic | Auto-retry on transient failures |

### TWIT-005: Scheduling Integration
**Priority:** P1 (High)

Integrate with MediaPoster scheduling system.

| Requirement | Description |
|-------------|-------------|
| Queue processing | Process scheduled tweets at designated times |
| Pub/sub events | Emit `twitter.post.requested`, `twitter.post.completed` |
| Failure handling | Mark failed posts, emit `twitter.post.failed` |

**Topics:** `Backend/services/event_bus/topics.py`

### TWIT-006: Rate Limit Management
**Priority:** P1 (High)

Respect Twitter's posting limits.

| Requirement | Description |
|-------------|-------------|
| Daily limit | Track posts per day (soft limit ~50) |
| Hourly spacing | Minimum 2 minutes between posts |
| Cool-down | Back off on rate limit detection |

## API Endpoints

```
POST /api/twitter/post
  - text: string
  - media_paths: string[] (optional)
  - account_id: string (optional)

GET /api/twitter/status
  - Returns session health, post counts

POST /api/twitter/login
  - Opens Safari for manual login

GET /api/twitter/accounts
  - List connected Twitter accounts
```

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  API Endpoint   │────▶│   EventBus       │────▶│  TwitterWorker  │
│  /api/twitter   │     │  twitter.post.*  │     │                 │
└─────────────────┘     └──────────────────┘     └────────┬────────┘
                                                          │
                                                          ▼
                                                 ┌─────────────────┐
                                                 │ SafariController│
                                                 │ (AppleScript)   │
                                                 └────────┬────────┘
                                                          │
                                                          ▼
                                                 ┌─────────────────┐
                                                 │  Safari Browser │
                                                 │  twitter.com    │
                                                 └─────────────────┘
```

## Files

| File | Purpose |
|------|---------|
| `Backend/automation/safari_twitter_poster.py` | Core posting automation |
| `Backend/automation/safari_controller.py` | Safari AppleScript wrapper |
| `Backend/automation/safari_session_manager.py` | Session management |
| `Backend/config/twitter_selectors.py` | CSS/XPath selectors |
| `Backend/api/endpoints/twitter_posting.py` | REST API |
| `Backend/services/workers/twitter_worker.py` | Pub/sub worker (TODO) |

## Success Metrics

| Metric | Target |
|--------|--------|
| Post success rate | > 95% |
| Average post time | < 30 seconds |
| Session persistence | 7+ days without re-login |
| Error recovery | Auto-recover from 80% of failures |

## Dependencies

- macOS (Safari automation via AppleScript)
- Logged-in Twitter account in Safari
- `osascript` command available

## Status

| Feature | Status |
|---------|--------|
| TWIT-001 | ✅ Implemented |
| TWIT-002 | ✅ Implemented |
| TWIT-003 | ✅ Implemented |
| TWIT-004 | ✅ Implemented |
| TWIT-005 | 🔄 Partial (API exists, worker TODO) |
| TWIT-006 | 🔄 Partial (basic tracking) |
