# Sora Browser Automation PRD

## Overview
End-to-end automation pipeline for generating, processing, and publishing AI-generated videos using OpenAI's Sora via Safari browser automation.

## Problem Statement
Sora's @ character feature (like @isaiahdupree) is web-only and not available via API. Browser automation is required to leverage these features for video generation at scale.

## Goals
1. Automate Safari to navigate to sora.chatgpt.com
2. Access user profile and input video prompts
3. Wait for video generation (~5 minutes)
4. Download generated videos
5. Remove Sora watermark using existing SoraWatermarkCleaner
6. Stitch videos together with captions
7. Schedule to social media via Blotato

## Technical Architecture

### Components

```
┌─────────────────────────────────────────────────────────────────┐
│                    Sora Automation Pipeline                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐       │
│  │   Safari     │───▶│    Sora      │───▶│   Download   │       │
│  │  Controller  │    │  Navigator   │    │   Handler    │       │
│  └──────────────┘    └──────────────┘    └──────────────┘       │
│         │                   │                   │                │
│         ▼                   ▼                   ▼                │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐       │
│  │   Prompt     │    │   Status     │    │  Watermark   │       │
│  │   Manager    │    │   Monitor    │    │   Remover    │       │
│  └──────────────┘    └──────────────┘    └──────────────┘       │
│                                                 │                │
│                                                 ▼                │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐       │
│  │   Caption    │◀───│   Video      │───▶│   Social     │       │
│  │   Generator  │    │   Stitcher   │    │   Scheduler  │       │
│  └──────────────┘    └──────────────┘    └──────────────┘       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### File Structure

```
Backend/automation/
├── sora/
│   ├── __init__.py
│   ├── sora_controller.py      # Main Safari automation for Sora
│   ├── prompt_manager.py       # Manage video prompts and @ characters
│   ├── generation_monitor.py   # Monitor generation status (polling)
│   ├── video_downloader.py     # Download completed videos
│   └── pipeline.py             # End-to-end pipeline orchestrator
├── video_processing/
│   ├── watermark_remover.py    # Integration with SoraWatermarkCleaner
│   ├── video_stitcher.py       # FFmpeg-based video stitching
│   └── caption_generator.py    # Add captions to videos
└── safari_app_controller.py    # Existing Safari controller (extend)
```

## Implementation Phases

### Phase 1: Safari Sora Navigator (Core)
- Navigate to sora.chatgpt.com
- Detect login state
- Find prompt input field
- Submit prompts with @ character support
- Monitor generation progress

### Phase 2: Video Download & Processing
- Detect video completion
- Extract video URL and download
- Integrate with SoraWatermarkCleaner
- Remove watermark automatically

### Phase 3: Post-Processing Pipeline
- Stitch multiple clips together
- Generate captions from transcript
- Add text overlays

### Phase 4: Social Media Integration
- Connect to Blotato scheduling API
- Queue videos for multi-platform posting
- Track posting status

## API Endpoints

### POST /api/sora/generate
```json
{
  "prompt": "A cinematic shot of @isaiahdupree walking through Tokyo at night",
  "character": "@isaiahdupree",
  "duration": "10s",
  "aspect_ratio": "9:16"
}
```

### GET /api/sora/status/{job_id}
```json
{
  "job_id": "uuid",
  "status": "generating|completed|failed",
  "progress_percent": 75,
  "video_url": "...",
  "estimated_completion": "2026-01-15T22:45:00Z"
}
```

### POST /api/sora/pipeline
```json
{
  "prompts": [
    {"prompt": "...", "character": "@isaiahdupree"},
    {"prompt": "...", "character": "@isaiahdupree"}
  ],
  "stitch_videos": true,
  "add_captions": true,
  "remove_watermark": true,
  "schedule": {
    "platform": ["tiktok", "instagram"],
    "time": "2026-01-16T10:00:00Z"
  }
}
```

## Sora Web Interface Selectors (to discover)

Key elements to identify:
- Prompt input textarea
- Generate button
- Video preview container
- Download button
- Progress indicator
- Character (@) suggestions dropdown

## Dependencies

- **SoraWatermarkCleaner** - Already in `Backend/SoraWatermarkCleaner/`
- **FFmpeg** - For video stitching
- **Safari AppleScript** - Via `safari_app_controller.py`
- **Blotato API** - For social scheduling

## Success Metrics

1. Successfully generate video from prompt via automation
2. Download video without manual intervention
3. Remove watermark with >95% quality preservation
4. Schedule to 3+ platforms in single workflow
5. Total pipeline time < 10 minutes per video

## Timeline

- **Day 1**: Sora Safari controller + prompt submission
- **Day 2**: Generation monitoring + video download
- **Day 3**: Watermark removal integration + stitching
- **Day 4**: Caption generation + social scheduling
- **Day 5**: End-to-end testing + dashboard UI

## Notes

- Sora generation typically takes 3-5 minutes
- Must handle session expiry and re-authentication
- Rate limiting may apply on Sora side
- Videos are 720p or 1080p depending on settings
