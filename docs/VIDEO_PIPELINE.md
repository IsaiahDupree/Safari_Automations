# Video Pipeline: Download → Watermark Removal → MediaPoster Alert

This document describes the automated pipeline for processing Sora-generated videos through watermark removal and alerting MediaPoster for publishing.

## Overview

```
┌─────────────────┐    ┌────────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│  Sora Video     │───▶│  Download to       │───▶│  Watermark      │───▶│  Alert          │
│  Generation     │    │  Local Storage     │    │  Removal        │    │  MediaPoster    │
└─────────────────┘    └────────────────────┘    └────────────────────┘    └─────────────────┘
         │                      │                        │                        │
         ▼                      ▼                        ▼                        ▼
    Sora drafts           ~/sora-videos/           ~/sora-videos/           POST webhook
    library               raw/                      cleaned/                to MediaPoster
```

## Components

### 1. Video Download
- **Source**: Sora drafts library at `https://sora.chatgpt.com/library`
- **Destination**: `~/sora-videos/raw/` or custom output directory
- **Naming**: `sora-{character}-{timestamp}.mp4`

### 2. Watermark Removal
- **Tool**: `SoraWatermarkCleaner` CLI
- **Location**: `/Users/isaiahdupree/Documents/Software/MediaPoster/Backend/SoraWatermarkCleaner`
- **Input**: Raw video from download
- **Output**: `~/sora-videos/cleaned/cleaned_{filename}.mp4`

### 3. MediaPoster Alert
- **Webhook**: `POST http://localhost:5555/api/webhooks/video-ready`
- **Payload**: Video path, metadata, suggested platforms
- **Actions**: AI analysis, caption generation, multi-platform publish

---

## Pipeline Architecture

### Event Flow

```
Safari Automation                    MediaPoster
──────────────────                   ───────────
     │                                    │
     │ 1. Video generated                 │
     │ 2. Download completed              │
     │ 3. Watermark removed               │
     │                                    │
     │──── HTTP POST /video-ready ───────▶│
     │     {                              │
     │       video_path,                  │
     │       cleaned_path,                │ 4. Receive webhook
     │       prompt,                      │ 5. AI analysis (Whisper + GPT)
     │       character,                   │ 6. Generate caption
     │       platforms                    │ 7. Publish to platforms
     │     }                              │
     │                                    │
     │◀─── HTTP 200 OK ──────────────────│
     │     {                              │
     │       job_id,                      │
     │       status                       │
     │     }                              │
```

### Database Integration

All pipeline events are logged to Supabase:

| Table | Records Created |
|-------|-----------------|
| `safari_videos` | Raw + cleaned paths |
| `watermark_removals` | Processing status |
| `safari_events` | Full audit trail |

---

## Implementation

### TypeScript Pipeline Class

```typescript
import { SoraFullAutomation } from './sora/sora-full-automation';
import { SafariSupabaseClient } from './supabase-client';

class VideoPipeline {
  async processVideo(videoPath: string, options: PipelineOptions): Promise<PipelineResult> {
    // 1. Download (already done by SoraFullAutomation)
    // 2. Remove watermark
    const cleanedPath = await this.removeWatermark(videoPath);
    // 3. Log to Supabase
    await this.logToSupabase(videoPath, cleanedPath, options);
    // 4. Alert MediaPoster
    const result = await this.alertMediaPoster(cleanedPath, options);
    return result;
  }
}
```

### Watermark Removal Integration

```bash
# CLI command
cd /Users/isaiahdupree/Documents/Software/MediaPoster/Backend/SoraWatermarkCleaner
uv run python -m SoraWatermarkCleaner.WaterMarkCleaner \
  --input /path/to/video.mp4 \
  --output /path/to/cleaned/

# Batch mode
uv run python -m SoraWatermarkCleaner.WaterMarkCleaner \
  --input /path/to/videos/ \
  --output /path/to/cleaned/ \
  --batch
```

### MediaPoster Webhook

```typescript
interface VideoReadyPayload {
  video_path: string;          // Path to cleaned video
  raw_path?: string;           // Path to original with watermark
  prompt: string;              // Generation prompt
  character: string;           // Character used (@isaiahdupree)
  source: 'sora';              // Video source
  platforms: string[];         // ['youtube', 'tiktok', 'instagram']
  metadata?: {
    duration_seconds?: number;
    file_size?: number;
    generation_time_ms?: number;
  };
}

// POST to MediaPoster
fetch('http://localhost:5555/api/webhooks/video-ready', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload)
});
```

---

## Usage

### Single Video

```typescript
import { VideoPipeline } from '@safari-automation/protocol';

const pipeline = new VideoPipeline();

await pipeline.processVideo('/path/to/video.mp4', {
  prompt: '@isaiahdupree riding a meteor',
  character: 'isaiahdupree',
  platforms: ['youtube', 'tiktok']
});
```

### Batch Processing

```typescript
const videos = [
  '/path/to/video1.mp4',
  '/path/to/video2.mp4',
  '/path/to/video3.mp4'
];

const results = await pipeline.processBatch(videos, {
  character: 'isaiahdupree',
  platforms: ['youtube', 'tiktok'],
  parallelCleanup: true  // Run watermark removal in parallel
});
```

### CLI Script

```bash
# Process single video
npx tsx scripts/video-pipeline.ts \
  --video /path/to/video.mp4 \
  --prompt "@isaiahdupree on Mars"

# Process directory
npx tsx scripts/video-pipeline.ts \
  --dir ~/sora-videos/badass-marathon/ \
  --character isaiahdupree \
  --platforms youtube,tiktok
```

---

## Configuration

### Environment Variables

```bash
# Safari Automation
SORA_VIDEO_DIR=~/sora-videos
SORA_CLEANED_DIR=~/sora-videos/cleaned

# Watermark Cleaner
WATERMARK_CLEANER_PATH=/Users/isaiahdupree/Documents/Software/MediaPoster/Backend/SoraWatermarkCleaner

# MediaPoster
MEDIAPOSTER_WEBHOOK_URL=http://localhost:5555/api/webhooks/video-ready
MEDIAPOSTER_API_KEY=optional-api-key

# Supabase (for logging)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-key
```

### Pipeline Options

```typescript
interface PipelineOptions {
  // Video info
  prompt: string;
  character: string;
  
  // Processing
  removeWatermark?: boolean;  // default: true
  skipExisting?: boolean;     // skip if cleaned exists
  
  // MediaPoster
  alertMediaPoster?: boolean; // default: true
  platforms?: string[];       // default: ['youtube', 'tiktok']
  autoPublish?: boolean;      // default: false (queue for review)
  
  // Logging
  logToSupabase?: boolean;    // default: true
}
```

---

## Events Emitted

| Event | When | Payload |
|-------|------|---------|
| `pipeline.started` | Pipeline begins | `{ video_path, options }` |
| `watermark.started` | Cleanup begins | `{ input_path }` |
| `watermark.completed` | Cleanup done | `{ input_path, output_path, duration_ms }` |
| `mediaposter.alerted` | Webhook sent | `{ video_path, platforms }` |
| `pipeline.completed` | All done | `{ results }` |
| `pipeline.error` | On failure | `{ error, stage }` |

---

## Error Handling

| Error | Recovery |
|-------|----------|
| Video not found | Skip, log warning |
| Watermark removal fails | Retry once, then alert with raw video |
| MediaPoster unreachable | Queue for retry, continue pipeline |
| Supabase error | Log locally, continue pipeline |

---

## Integration with Badass Marathon

The pipeline integrates with the badass marathon script:

```typescript
// In badass-marathon.ts
const pipeline = new VideoPipeline();

for (const prompt of PROMPTS) {
  // Generate video
  const result = await sora.generateVideo(prompt);
  
  if (result.success && result.video_path) {
    // Process through pipeline
    await pipeline.processVideo(result.video_path, {
      prompt,
      character: 'isaiahdupree',
      platforms: ['youtube', 'tiktok']
    });
  }
}
```

---

## Monitoring

### Check Pipeline Status

```bash
# View recent pipeline runs
curl http://localhost:7070/v1/commands?type=pipeline.process

# View specific video status
curl http://localhost:7070/v1/videos/{video_id}
```

### Supabase Dashboard

Query recent pipeline activity:

```sql
SELECT 
  v.prompt,
  v.raw_path,
  v.cleaned_path,
  v.status,
  w.processing_time_ms
FROM safari_videos v
LEFT JOIN watermark_removals w ON w.video_id = v.id
WHERE v.created_at > NOW() - INTERVAL '24 hours'
ORDER BY v.created_at DESC;
```
