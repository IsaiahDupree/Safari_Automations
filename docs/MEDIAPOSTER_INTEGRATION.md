# Safari Automation ↔ MediaPoster Integration

Complete documentation for the video pipeline connecting Safari Automation (Sora generation, watermark removal) to MediaPoster (AI analysis, multi-platform publishing).

## Architecture

```
┌────────────────────────────────────────────────────────────────────────────┐
│                         SAFARI AUTOMATION                                  │
│  ┌─────────────┐   ┌─────────────────┐   ┌───────────────────┐            │
│  │   Sora      │──▶│   Download      │──▶│   Watermark       │            │
│  │ Generation  │   │   Video         │   │   Removal         │            │
│  └─────────────┘   └─────────────────┘   └───────────────────┘            │
│                                                    │                       │
│                    Control API (7070)              │ Telemetry WS (7071)   │
│                    ──────────────────              ▼                       │
│                                          ┌─────────────────────┐          │
│                                          │  video-pipeline.ts  │          │
│                                          │  (alerts MediaPoster)│          │
│                                          └─────────────────────┘          │
└────────────────────────────────────────────────────│───────────────────────┘
                                                     │
                        HTTP POST / WebSocket        │
                        ─────────────────────        ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                           MEDIAPOSTER                                      │
│  ┌─────────────────────┐   ┌────────────────────┐   ┌──────────────────┐  │
│  │ safari_event_       │──▶│ video_ready_       │──▶│ Blotato API      │  │
│  │ listener.py         │   │ pipeline.py        │   │ Publishing       │  │
│  │ (WebSocket)         │   │ (AI Analysis)      │   │ (YT, TikTok)     │  │
│  └─────────────────────┘   └────────────────────┘   └──────────────────┘  │
│           │                        │                        │              │
│           │                        ▼                        │              │
│           │               ┌────────────────────┐            │              │
│           │               │ GPT-4o Analysis    │            │              │
│           │               │ - Transcript       │            │              │
│           │               │ - Caption gen      │            │              │
│           │               │ - Virality score   │            │              │
│           │               └────────────────────┘            │              │
│           ▼                                                 ▼              │
│  ┌─────────────────────────────────────────────────────────────────────┐  │
│  │                        Supabase Database                            │  │
│  │  safari_commands | safari_videos | safari_events | analyzed_videos  │  │
│  └─────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## Connection Methods

### 1. Webhook (Recommended)

Safari Automation calls MediaPoster webhook when video is ready.

**Safari Automation side** (`scripts/video-pipeline.ts`):
```typescript
// Called after watermark removal
await fetch('http://localhost:5555/api/webhooks/video-ready', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    video_path: '/Users/isaiahdupree/sora-videos/cleaned/cleaned_badass-01.mp4',
    raw_path: '/Users/isaiahdupree/sora-videos/badass-marathon/badass-01.mp4',
    prompt: '@isaiahdupree surfs a 100-foot tsunami wave in downtown Tokyo',
    character: 'isaiahdupree',
    source: 'sora',
    platforms: ['youtube', 'tiktok'],
    auto_publish: false
  })
});
```

**MediaPoster side** (`Backend/services/webhooks.py`):
```python
@router.post("/api/webhooks/video-ready")
async def video_ready_webhook(request: VideoReadyRequest):
    from services.video_ready_pipeline import VideoReadyPipeline
    
    pipeline = VideoReadyPipeline()
    result = await pipeline.process_video_ready(
        video_path=request.video_path,
        source=request.source,
        publish_to=request.platforms,
        metadata={"prompt": request.prompt, "character": request.character}
    )
    return {"job_id": result["video_id"], "status": result["status"]}
```

---

### 2. WebSocket Listener

MediaPoster listens to Safari Automation telemetry stream.

**Start the listener**:
```bash
cd /Users/isaiahdupree/Documents/Software/MediaPoster/Backend
python -m services.safari_event_listener
```

**Events handled**:
| Event | Trigger |
|-------|---------|
| `sora.video.complete` | Sora generation finished |
| `sora.video.downloaded` | Video downloaded locally |
| `watermark.removal.complete` | Watermark removed |
| `command.completed` | Any Safari command finished |

---

### 3. Polling (Fallback)

If WebSocket unavailable, poll Safari Automation control API.

```python
from services.safari_event_listener import SafariEventPoller

poller = SafariEventPoller(
    control_url="http://localhost:7070",
    poll_interval=10  # seconds
)
await poller.start()
```

---

## Video Ready Pipeline Flow

When `video_ready_pipeline.py` receives a video:

### Step 1: Ingest to Database
```python
video_id = await self.ingest_video_to_db(video_path, source, metadata)
# Creates record in original_videos table
```

### Step 2: AI Analysis (GPT-4o)
```python
analysis = await self.analyze_video(video_path, metadata)
# Returns AnalysisResult with:
# - transcript, summary, suggested_caption
# - hashtags, virality_score, duration_seconds
# - youtube_title, youtube_description
# - tiktok_caption, instagram_caption
# - hook_text, hook_type, hook_strength
# - cta_text, cta_type
# - seo_keywords, search_terms
# - predicted_likes, predicted_comments, predicted_shares
```

### Step 3: Publish via Blotato
```python
publish_results = await self.publish_to_platforms(
    video_path=video_path,
    analysis=analysis,
    platforms=["youtube", "tiktok"],
    custom_caption=custom_caption
)
```

---

## Configuration

### Safari Automation `.env`
```bash
# MediaPoster webhook
MEDIAPOSTER_WEBHOOK_URL=http://localhost:5555/api/webhooks/video-ready

# Supabase (shared)
SUPABASE_URL=https://owcutgdfteomvfqhfwce.supabase.co
SUPABASE_SERVICE_KEY=your-service-key
```

### MediaPoster `.env`
```bash
# Safari Automation telemetry
SAFARI_TELEMETRY_URL=ws://localhost:7071
SAFARI_CONTROL_URL=http://localhost:7070

# OpenAI for analysis
OPENAI_API_KEY=your-openai-key

# Blotato for publishing
BLOTATO_CLIENT_ID=your-client-id
BLOTATO_CLIENT_SECRET=your-client-secret

# Default accounts
YOUTUBE_ACCOUNT_ID=228
TIKTOK_ACCOUNT_ID=710
```

---

## Usage Examples

### Safari Automation CLI

```bash
# Process single video through full pipeline (watermark + MediaPoster alert)
cd /Users/isaiahdupree/Documents/Software/Safari\ Automation
npx tsx scripts/video-pipeline.ts \
  --video ~/sora-videos/badass-marathon/badass-01.mp4 \
  --prompt "@isaiahdupree surfs a 100-foot tsunami wave" \
  --platforms youtube,tiktok

# Process entire directory
npx tsx scripts/video-pipeline.ts \
  --dir ~/sora-videos/badass-marathon/ \
  --character isaiahdupree \
  --platforms youtube,tiktok
```

### MediaPoster Direct Call

```python
from services.video_ready_pipeline import VideoReadyPipeline

async def process_sora_video():
    pipeline = VideoReadyPipeline()
    
    result = await pipeline.process_video_ready(
        video_path="/Users/isaiahdupree/sora-videos/cleaned/cleaned_badass-01.mp4",
        source="sora",
        publish_to=["youtube", "tiktok"],
        metadata={
            "prompt": "@isaiahdupree surfs a 100-foot tsunami wave in downtown Tokyo",
            "character": "isaiahdupree"
        }
    )
    
    print(f"Video ID: {result['video_id']}")
    print(f"Status: {result['status']}")
    print(f"Virality Score: {result['analysis'].virality_score}")
    print(f"YouTube Title: {result['analysis'].youtube_title}")
    print(f"Publish Results: {result['publish_results']}")
```

### Curl Webhook Test

```bash
curl -X POST http://localhost:5555/api/webhooks/video-ready \
  -H "Content-Type: application/json" \
  -d '{
    "video_path": "/Users/isaiahdupree/sora-videos/cleaned/cleaned_badass-01.mp4",
    "source": "sora",
    "platforms": ["youtube", "tiktok"],
    "prompt": "@isaiahdupree surfs a 100-foot tsunami wave in downtown Tokyo",
    "character": "isaiahdupree",
    "auto_publish": false
  }'
```

---

## Database Tables

### Safari Automation (Supabase)

| Table | Purpose |
|-------|---------|
| `safari_commands` | Command tracking |
| `safari_videos` | Video catalog (raw + cleaned paths) |
| `watermark_removals` | Cleanup operations |
| `safari_events` | Telemetry audit trail |

### MediaPoster (PostgreSQL)

| Table | Purpose |
|-------|---------|
| `original_videos` | Ingested video records |
| `analyzed_videos` | AI analysis results |
| `published_content` | Publishing history |

---

## Full Workflow Example

```
1. User: "Generate 17 badass videos"
   └─▶ Safari Automation: badass-marathon.ts

2. Sora generates video
   └─▶ Safari Automation: Downloads to ~/sora-videos/badass-marathon/

3. Video Pipeline runs
   └─▶ Safari Automation: Removes watermark
   └─▶ Safari Automation: Saves to ~/sora-videos/cleaned/
   └─▶ Safari Automation: POSTs to MediaPoster webhook

4. MediaPoster receives webhook
   └─▶ MediaPoster: Ingests to database
   └─▶ MediaPoster: GPT-4o analyzes video
   └─▶ MediaPoster: Generates platform-specific captions
   └─▶ MediaPoster: Publishes to YouTube + TikTok via Blotato

5. Result
   └─▶ Video live on YouTube: "Isaiah Dupree Surfs 100-Foot Tsunami in Tokyo"
   └─▶ Video live on TikTok: "@isaiahdupree #tsunami #tokyo #epic"
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| MediaPoster not receiving webhook | Check `http://localhost:5555` is running |
| WebSocket connection fails | Ensure Safari Automation telemetry server on port 7071 |
| Watermark removal fails | Check SoraWatermarkCleaner path and uv environment |
| Blotato publishing fails | Verify OAuth tokens and account IDs |
| GPT-4o analysis fails | Check OPENAI_API_KEY in MediaPoster .env |

---

## Files Reference

### Safari Automation
- `scripts/video-pipeline.ts` - CLI for watermark + alert
- `packages/protocol/src/video-pipeline.ts` - Pipeline class
- `docs/VIDEO_PIPELINE.md` - Safari-side documentation

### MediaPoster
- `Backend/services/video_ready_pipeline.py` - Main processing pipeline
- `Backend/services/safari_event_listener.py` - WebSocket/polling listener
- `Backend/services/blotato_service.py` - Blotato API integration
