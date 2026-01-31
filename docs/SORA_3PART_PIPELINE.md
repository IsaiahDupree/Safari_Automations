# Sora 3-Part Video Pipeline

**Version:** 1.0  
**Date:** January 28, 2026  
**Status:** ✅ Implemented & Tested

---

## Overview

Complete automation pipeline for generating multi-part Sora videos with:
- AI-generated prompts for each part
- @isaiahdupree character support
- Watermark removal
- FFmpeg stitching
- AI content analysis (titles, hashtags, CTAs)
- Multi-platform posting via Blotato

---

## API Endpoints

### 1. Generate 3-Part Video

```bash
curl -X POST http://localhost:5555/api/sora/pipeline/multi-part \
  -H "Content-Type: application/json" \
  -d '{
    "theme": "managing social media is like juggling cats",
    "num_parts": 3,
    "character": "isaiahdupree",
    "auto_stitch": true,
    "auto_analyze": true,
    "remove_watermarks": true,
    "post_to_platforms": ["tiktok", "instagram"]
  }'
```

**Response:**
```json
{
  "success": true,
  "message": "Started 3-part video pipeline",
  "job_id": "abc12345",
  "theme": "managing social media is like juggling cats",
  "character": "isaiahdupree",
  "will_post_to": ["tiktok", "instagram"]
}
```

### 2. Full Pipeline (Generate + Post)

```bash
curl -X POST http://localhost:5555/api/sora/pipeline/full \
  -H "Content-Type: application/json" \
  -d '{
    "theme": "AI is changing content creation",
    "character": "isaiahdupree",
    "num_parts": 3,
    "post_to_platforms": ["tiktok", "instagram", "youtube"]
  }'
```

### 3. Check Job Status

```bash
curl http://localhost:5555/api/sora/pipeline/job/{job_id}
```

### 4. List All Jobs

```bash
curl http://localhost:5555/api/sora/pipeline/jobs
```

### 5. Post Existing Video

```bash
curl -X POST "http://localhost:5555/api/sora/post?video_path=/path/to/video.mp4&platforms=tiktok&platforms=instagram"
```

---

## Python Usage

### Direct Pipeline Usage

```python
from automation.sora.pipeline import SoraPipeline
import asyncio

async def main():
    pipeline = SoraPipeline()
    
    result = await pipeline.generate_multi_part(
        theme="managing social media is like juggling cats",
        num_parts=3,
        character="@isaiahdupree",
        auto_stitch=True,
        auto_analyze=True,
        remove_watermarks=True
    )
    
    print(f"Status: {result['status']}")
    print(f"Stitched video: {result.get('stitched_video')}")
    print(f"Analysis: {result.get('analysis')}")

asyncio.run(main())
```

### With Custom Prompts

```python
result = await pipeline.generate_multi_part(
    theme="social media automation",
    num_parts=3,
    character="@isaiahdupree",
    part_prompts=[
        "@isaiahdupree looking overwhelmed at multiple phone screens, chaotic energy",
        "@isaiahdupree discovering a magic button that controls all social media",
        "@isaiahdupree relaxing while automation handles everything, satisfied smile"
    ]
)
```

---

## Pipeline Flow

```
┌─────────────────┐
│  Theme/Prompt   │
└────────┬────────┘
         ▼
┌─────────────────┐
│ AI Prompt Gen   │ ← GPT-4o-mini generates 3 cohesive prompts
└────────┬────────┘
         ▼
┌─────────────────┐
│ Sora Generation │ ← Safari automation, max 3 concurrent
│   (Part 1-3)    │
└────────┬────────┘
         ▼
┌─────────────────┐
│ Download Videos │ ← From /drafts page
└────────┬────────┘
         ▼
┌─────────────────┐
│ Remove Watermarks│ ← SoraWatermarkCleaner
└────────┬────────┘
         ▼
┌─────────────────┐
│  FFmpeg Stitch  │ ← Concatenate all parts
└────────┬────────┘
         ▼
┌─────────────────┐
│  AI Analysis    │ ← Generate titles, hashtags, CTA
└────────┬────────┘
         ▼
┌─────────────────┐
│ Post to Platforms│ ← TikTok, Instagram, YouTube via Blotato
└─────────────────┘
```

---

## Output Structure

```python
{
    "id": "abc12345",
    "type": "multi_part",
    "theme": "managing social media is like juggling cats",
    "num_parts": 3,
    "character": "@isaiahdupree",
    "status": "completed",  # completed | partial | failed
    "started_at": "2026-01-28T01:00:00",
    "completed_at": "2026-01-28T01:35:00",
    
    "prompts": [
        "Part 1 prompt...",
        "Part 2 prompt...",
        "Part 3 prompt..."
    ],
    
    "parts": [
        {"part_number": 1, "prompt": "...", "result": {...}},
        {"part_number": 2, "prompt": "...", "result": {...}},
        {"part_number": 3, "prompt": "...", "result": {...}}
    ],
    
    "successful_parts": 3,
    "failed_parts": 0,
    
    "stitched_video": "/path/to/multipart_abc12345_final.mp4",
    
    "analysis": {
        "title_tiktok": "POV: You finally automated your social media 🤯",
        "title_instagram": "This changed everything about my workflow",
        "title_youtube": "How I Automated My Social Media in 2026",
        "description": "Ever feel like managing social media is impossible?",
        "hashtags": ["socialmedia", "automation", "ai", "fyp", "viral"],
        "hook": "What if I told you there's a better way?",
        "cta": "Follow for more automation tips!"
    },
    
    "post_results": {
        "tiktok": {"success": true, "post_id": "123", "url": "..."},
        "instagram": {"success": true, "post_id": "456", "url": "..."}
    }
}
```

---

## Files

| File | Purpose |
|------|---------|
| `automation/sora/pipeline.py` | Main pipeline implementation |
| `automation/sora/sora_controller.py` | Safari automation controller |
| `automation/sora/video_downloader.py` | Video download handler |
| `automation/sora/generation_monitor.py` | Generation status monitoring |
| `api/endpoints/sora_automation.py` | API endpoints |
| `services/blotato_connector.py` | Platform posting |

---

## Configuration

### Environment Variables

```bash
OPENAI_API_KEY=sk-...  # For AI prompt generation & analysis
```

### Paths

```python
# Output directory
output/sora_pipeline/

# Watermark cleaner
Backend/SoraWatermarkCleaner/
```

---

## Integration with Engagement Control

The pipeline integrates with the existing engagement control system:

```bash
# Start engagement automation (includes Sora scheduling)
curl -X POST http://localhost:5555/api/engagement-control/start

# Trigger 3-part video pipeline
curl -X POST http://localhost:5555/api/sora/pipeline/full \
  -d '{"theme": "...", "post_to_platforms": ["tiktok", "instagram"]}'

# Stop all automation
curl -X POST http://localhost:5555/api/engagement-control/stop
```

---

## Blotato Account Mapping

Videos are posted to these accounts via Blotato:

| Platform | Account IDs |
|----------|-------------|
| TikTok | 710, 243, 4508, 571 |
| Instagram | 807, 670, 1369, 4508 |
| YouTube | 228, 3370 |
| Threads | 173, 201, 1369, 4150 |

---

## Timing Estimates

| Step | Duration |
|------|----------|
| AI Prompt Generation | ~5 seconds |
| Video Generation (per part) | 8-12 minutes |
| Watermark Removal (per part) | 30-60 seconds |
| Stitching | 10-30 seconds |
| AI Analysis | ~3 seconds |
| Platform Posting | 30-60 seconds per platform |

**Total for 3-part video:** ~30-40 minutes

---

## Error Handling

- **Login required:** Prompts user to log in manually
- **Queue full:** Waits for slot (max 3 concurrent)
- **Generation timeout:** Returns partial result
- **Download failed:** Retries up to 3 times
- **Post failed:** Logs error, continues with other platforms
