# BlankLogo ↔ Safari Automation Integration

This document describes how BlankLogo can integrate with Safari Automation to provide high-quality watermark removal and AI upscaling for Sora-generated videos.

## Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          VIDEO PROCESSING FLOW                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────┐        ┌─────────────────────┐        ┌────────────────┐  │
│  │   BlankLogo  │──────▶│  Safari Automation  │───────▶│  MediaPoster   │  │
│  │   (Client)   │        │     (Server)        │        │  (Publisher)   │  │
│  └──────────────┘        └─────────────────────┘        └────────────────┘  │
│        │                          │                            │            │
│        │  1. Submit video         │  3. Return cleaned         │            │
│        │     for processing       │     + upscaled video       │            │
│        │                          │                            │            │
│        │                  ┌───────▼───────┐                    │            │
│        │                  │ HQ Pipeline   │                    │            │
│        │                  │ ────────────  │                    │            │
│        │                  │ • YOLO detect │                    │            │
│        │                  │ • LAMA inpaint│                    │            │
│        │                  │ • Real-ESRGAN │                    │            │
│        │                  │ • HEVC encode │                    │            │
│        │                  └───────────────┘                    │            │
│        │                                                       │            │
│        │                  2. Process with                      │            │
│        │                     maximum quality                   │            │
│        │                                                       │            │
│        └───────────────────────────────────────────────────────┘            │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Safari Automation API

### Base URLs

| Environment | Control Plane | Telemetry |
|-------------|---------------|-----------|
| Local | `http://localhost:7070` | `ws://localhost:7071` |
| Production | `https://safari.yourdomain.com` | `wss://safari.yourdomain.com/ws` |

### Endpoints

#### 1. Submit Video for Processing

```http
POST /api/v1/video/process
Content-Type: application/json

{
  "video_url": "https://storage.example.com/sora-video.mp4",
  "video_bytes": "<base64-encoded-video>",  // Alternative to video_url
  "options": {
    "watermark_removal": {
      "enabled": true,
      "method": "modal",         // "modal" | "local" | "auto"
      "platform": "sora"         // "sora" | "tiktok" | "runway" | "pika"
    },
    "upscaling": {
      "enabled": true,
      "scale": 2,                // 2 or 4
      "model": "real-esrgan"
    },
    "encoding": {
      "codec": "hevc",           // "hevc" | "h264"
      "crf": 18,                 // Quality: 0 (lossless) - 51 (worst)
      "preset": "medium"
    },
    "callback": {
      "webhook_url": "https://blanklogo.com/api/webhooks/video-ready",
      "include_video_bytes": false  // If true, includes base64 video in callback
    }
  },
  "metadata": {
    "job_id": "bl-job-12345",
    "user_id": "user-xyz",
    "character": "isaiahdupree",
    "platforms": ["youtube", "tiktok"]
  }
}
```

**Response:**
```json
{
  "job_id": "sa-job-abc123",
  "status": "queued",
  "estimated_time_seconds": 120,
  "tracking_url": "http://localhost:7070/api/v1/jobs/sa-job-abc123"
}
```

#### 2. Check Job Status

```http
GET /api/v1/jobs/{job_id}
```

**Response:**
```json
{
  "job_id": "sa-job-abc123",
  "status": "completed",      // "queued" | "processing" | "completed" | "failed"
  "progress": 100,
  "created_at": "2026-01-31T12:00:00Z",
  "completed_at": "2026-01-31T12:02:15Z",
  "result": {
    "video_url": "https://storage.supabase.co/cleaned/hq_video.mp4",
    "video_bytes": null,       // Base64 if requested
    "stats": {
      "input_size_mb": 0.95,
      "output_size_mb": 2.1,
      "processing_time_s": 135,
      "watermarks_detected": 1,
      "frames_processed": 291,
      "upscaled": true,
      "method": "modal-inpaint+esrgan"
    }
  },
  "error": null
}
```

#### 3. Download Processed Video

```http
GET /api/v1/jobs/{job_id}/download
```

Returns the processed video file directly.

#### 4. Real-time Status (WebSocket)

```javascript
const ws = new WebSocket('ws://localhost:7071');

ws.onopen = () => {
  ws.send(JSON.stringify({
    type: 'subscribe',
    job_id: 'sa-job-abc123'
  }));
};

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  // { type: 'progress', job_id: 'sa-job-abc123', progress: 45, stage: 'inpainting' }
  // { type: 'completed', job_id: 'sa-job-abc123', result: { ... } }
};
```

## BlankLogo Local Setup

### Prerequisites

```bash
# Clone Safari Automation
git clone https://github.com/IsaiahDupree/Safari_Automations.git
cd Safari_Automations

# Install dependencies
npm install

# Set up environment
cp .env.example .env
```

### Environment Variables

```bash
# .env file for Safari Automation

# Modal API (AI watermark inpainting)
MODAL_TOKEN_ID=your-modal-token-id
MODAL_TOKEN_SECRET=your-modal-token-secret
MODAL_WORKSPACE=isaiahdupree33
MODAL_APP_NAME=blanklogo-watermark-removal

# Replicate API (Real-ESRGAN upscaling)
REPLICATE_API_TOKEN=your-replicate-token

# Supabase (video storage + job tracking)
SUPABASE_URL=https://owcutgdfteomvfqhfwce.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_KEY=your-service-key

# Server ports
CONTROL_PORT=7070
TELEMETRY_PORT=7071

# MediaPoster (final publishing)
MEDIAPOSTER_WEBHOOK_URL=http://localhost:5555/api/webhooks/video-ready
```

### Start the Server

```bash
# Start Safari Automation API server
npm run start:api

# Or with hot reload
npm run dev:api
```

### Verify Connection

```bash
curl http://localhost:7070/health
# { "status": "ok", "services": { "modal": true, "replicate": true, "supabase": true } }
```

## Integration Code Examples

### TypeScript/JavaScript (BlankLogo → Safari Automation)

```typescript
// blanklogo/services/safari-automation-client.ts

interface VideoProcessingOptions {
  watermarkRemoval: {
    enabled: boolean;
    method: 'modal' | 'local' | 'auto';
    platform: 'sora' | 'tiktok' | 'runway' | 'pika';
  };
  upscaling: {
    enabled: boolean;
    scale: 2 | 4;
  };
  encoding: {
    codec: 'hevc' | 'h264';
    crf: number;
  };
}

interface ProcessingResult {
  jobId: string;
  status: 'completed' | 'failed';
  videoUrl?: string;
  videoBytes?: string;
  stats: {
    inputSizeMb: number;
    outputSizeMb: number;
    processingTimeS: number;
    watermarksDetected: number;
    upscaled: boolean;
    method: string;
  };
  error?: string;
}

export class SafariAutomationClient {
  private baseUrl: string;
  private wsUrl: string;

  constructor(baseUrl = 'http://localhost:7070', wsUrl = 'ws://localhost:7071') {
    this.baseUrl = baseUrl;
    this.wsUrl = wsUrl;
  }

  /**
   * Submit a video for high-quality processing
   */
  async processVideo(
    videoPath: string,
    options: Partial<VideoProcessingOptions> = {}
  ): Promise<ProcessingResult> {
    const fs = await import('fs');
    const videoBytes = fs.readFileSync(videoPath);
    const videoBase64 = videoBytes.toString('base64');

    // Submit job
    const response = await fetch(`${this.baseUrl}/api/v1/video/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        video_bytes: videoBase64,
        options: {
          watermark_removal: {
            enabled: true,
            method: options.watermarkRemoval?.method || 'auto',
            platform: options.watermarkRemoval?.platform || 'sora',
          },
          upscaling: {
            enabled: options.upscaling?.enabled ?? true,
            scale: options.upscaling?.scale || 2,
            model: 'real-esrgan',
          },
          encoding: {
            codec: options.encoding?.codec || 'hevc',
            crf: options.encoding?.crf || 18,
            preset: 'medium',
          },
        },
      }),
    });

    const job = await response.json();
    
    // Poll for completion
    return this.waitForCompletion(job.job_id);
  }

  /**
   * Wait for job completion with polling
   */
  async waitForCompletion(jobId: string, timeoutMs = 600000): Promise<ProcessingResult> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const response = await fetch(`${this.baseUrl}/api/v1/jobs/${jobId}`);
      const job = await response.json();

      if (job.status === 'completed') {
        return {
          jobId: job.job_id,
          status: 'completed',
          videoUrl: job.result.video_url,
          videoBytes: job.result.video_bytes,
          stats: {
            inputSizeMb: job.result.stats.input_size_mb,
            outputSizeMb: job.result.stats.output_size_mb,
            processingTimeS: job.result.stats.processing_time_s,
            watermarksDetected: job.result.stats.watermarks_detected,
            upscaled: job.result.stats.upscaled,
            method: job.result.stats.method,
          },
        };
      }

      if (job.status === 'failed') {
        return {
          jobId: job.job_id,
          status: 'failed',
          stats: {} as any,
          error: job.error,
        };
      }

      // Wait 5 seconds before next poll
      await new Promise(r => setTimeout(r, 5000));
    }

    throw new Error('Processing timeout');
  }

  /**
   * Subscribe to real-time job updates
   */
  subscribeToJob(jobId: string, onProgress: (progress: number, stage: string) => void): WebSocket {
    const ws = new WebSocket(this.wsUrl);

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'subscribe', job_id: jobId }));
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'progress') {
        onProgress(data.progress, data.stage);
      }
    };

    return ws;
  }
}

// Usage
const client = new SafariAutomationClient();

const result = await client.processVideo('/path/to/sora-video.mp4', {
  watermarkRemoval: { enabled: true, method: 'modal', platform: 'sora' },
  upscaling: { enabled: true, scale: 2 },
  encoding: { codec: 'hevc', crf: 18 },
});

console.log(`Processed: ${result.videoUrl}`);
console.log(`Quality: ${result.stats.method}`);
console.log(`Size: ${result.stats.inputSizeMb}MB → ${result.stats.outputSizeMb}MB`);
```

### Python (BlankLogo → Safari Automation)

```python
# blanklogo/services/safari_automation_client.py

import requests
import base64
import time
from pathlib import Path
from dataclasses import dataclass
from typing import Optional

@dataclass
class ProcessingStats:
    input_size_mb: float
    output_size_mb: float
    processing_time_s: float
    watermarks_detected: int
    upscaled: bool
    method: str

@dataclass
class ProcessingResult:
    job_id: str
    status: str
    video_url: Optional[str] = None
    video_bytes: Optional[bytes] = None
    stats: Optional[ProcessingStats] = None
    error: Optional[str] = None


class SafariAutomationClient:
    """Client for Safari Automation HQ Video Processing API"""
    
    def __init__(self, base_url: str = "http://localhost:7070"):
        self.base_url = base_url
    
    def process_video(
        self,
        video_path: str,
        method: str = "auto",
        platform: str = "sora",
        upscale: bool = True,
        scale: int = 2,
        codec: str = "hevc",
        crf: int = 18,
    ) -> ProcessingResult:
        """
        Submit a video for high-quality processing.
        
        Args:
            video_path: Path to the input video
            method: Watermark removal method ("modal", "local", "auto")
            platform: Source platform ("sora", "tiktok", "runway", "pika")
            upscale: Enable AI upscaling
            scale: Upscale factor (2 or 4)
            codec: Output codec ("hevc" or "h264")
            crf: Quality level (0-51, lower is better)
        
        Returns:
            ProcessingResult with video URL and stats
        """
        # Read and encode video
        with open(video_path, "rb") as f:
            video_bytes = base64.b64encode(f.read()).decode()
        
        # Submit job
        response = requests.post(
            f"{self.base_url}/api/v1/video/process",
            json={
                "video_bytes": video_bytes,
                "options": {
                    "watermark_removal": {
                        "enabled": True,
                        "method": method,
                        "platform": platform,
                    },
                    "upscaling": {
                        "enabled": upscale,
                        "scale": scale,
                        "model": "real-esrgan",
                    },
                    "encoding": {
                        "codec": codec,
                        "crf": crf,
                        "preset": "medium",
                    },
                },
            },
        )
        response.raise_for_status()
        job = response.json()
        
        # Wait for completion
        return self._wait_for_completion(job["job_id"])
    
    def _wait_for_completion(
        self, 
        job_id: str, 
        timeout_s: int = 600,
        poll_interval_s: int = 5,
    ) -> ProcessingResult:
        """Poll for job completion."""
        start_time = time.time()
        
        while time.time() - start_time < timeout_s:
            response = requests.get(f"{self.base_url}/api/v1/jobs/{job_id}")
            job = response.json()
            
            if job["status"] == "completed":
                result = job["result"]
                return ProcessingResult(
                    job_id=job["job_id"],
                    status="completed",
                    video_url=result.get("video_url"),
                    video_bytes=base64.b64decode(result["video_bytes"]) if result.get("video_bytes") else None,
                    stats=ProcessingStats(
                        input_size_mb=result["stats"]["input_size_mb"],
                        output_size_mb=result["stats"]["output_size_mb"],
                        processing_time_s=result["stats"]["processing_time_s"],
                        watermarks_detected=result["stats"]["watermarks_detected"],
                        upscaled=result["stats"]["upscaled"],
                        method=result["stats"]["method"],
                    ),
                )
            
            if job["status"] == "failed":
                return ProcessingResult(
                    job_id=job["job_id"],
                    status="failed",
                    error=job.get("error"),
                )
            
            print(f"[Safari] Job {job_id}: {job['status']} ({job.get('progress', 0)}%)")
            time.sleep(poll_interval_s)
        
        raise TimeoutError(f"Job {job_id} did not complete within {timeout_s}s")
    
    def download_video(self, job_id: str, output_path: str) -> str:
        """Download the processed video to a file."""
        response = requests.get(
            f"{self.base_url}/api/v1/jobs/{job_id}/download",
            stream=True,
        )
        response.raise_for_status()
        
        with open(output_path, "wb") as f:
            for chunk in response.iter_content(chunk_size=8192):
                f.write(chunk)
        
        return output_path


# Usage
if __name__ == "__main__":
    client = SafariAutomationClient()
    
    result = client.process_video(
        video_path="/path/to/sora-video.mp4",
        method="modal",      # AI inpainting
        platform="sora",
        upscale=True,
        scale=2,
        codec="hevc",        # Preserve quality
        crf=18,
    )
    
    if result.status == "completed":
        print(f"✅ Processed: {result.video_url}")
        print(f"   Method: {result.stats.method}")
        print(f"   Size: {result.stats.input_size_mb}MB → {result.stats.output_size_mb}MB")
        print(f"   Time: {result.stats.processing_time_s}s")
    else:
        print(f"❌ Failed: {result.error}")
```

## Processing Pipeline Details

### Stage 1: Watermark Removal

| Method | Technology | Quality | Speed | Cost |
|--------|------------|---------|-------|------|
| **Modal AI** | YOLO + LAMA inpainting | ⭐⭐⭐⭐⭐ | 30-60s | ~$0.05 |
| **Local** | FFmpeg crop | ⭐⭐⭐ | 5-10s | Free |
| **Auto** | Modal → Local fallback | ⭐⭐⭐⭐⭐ | Variable | Variable |

**Modal AI Process:**
1. YOLO v8 detects watermark bounding box
2. LAMA model inpaints the region
3. Full resolution preserved (no cropping)

### Stage 2: AI Upscaling (Optional)

| Model | Scale | Quality | Time | Cost |
|-------|-------|---------|------|------|
| Real-ESRGAN | 2x | ⭐⭐⭐⭐⭐ | 2-3min | ~$0.14 |
| Real-ESRGAN | 4x | ⭐⭐⭐⭐⭐ | 4-5min | ~$0.20 |

### Stage 3: Encoding

| Codec | Quality/Size | Compatibility |
|-------|--------------|---------------|
| **HEVC (H.265)** | Best | Modern devices, YouTube, TikTok |
| **H.264** | Good | Universal |

**Recommended settings:**
```
Codec: HEVC
CRF: 18 (excellent quality)
Preset: medium (balanced speed/quality)
```

## Webhook Callback

When processing completes, Safari Automation sends a callback to BlankLogo:

```http
POST https://blanklogo.com/api/webhooks/video-ready
Content-Type: application/json

{
  "event": "video.processed",
  "job_id": "sa-job-abc123",
  "blanklogo_job_id": "bl-job-12345",
  "status": "completed",
  "result": {
    "video_url": "https://storage.supabase.co/cleaned/hq_video.mp4",
    "stats": {
      "input_size_mb": 0.95,
      "output_size_mb": 2.1,
      "processing_time_s": 135,
      "watermarks_detected": 1,
      "upscaled": true,
      "method": "modal-inpaint+esrgan"
    }
  },
  "metadata": {
    "character": "isaiahdupree",
    "platforms": ["youtube", "tiktok"]
  }
}
```

## Forward to MediaPoster

After receiving the processed video, BlankLogo can forward to MediaPoster:

```http
POST http://localhost:5555/api/webhooks/video-ready
Content-Type: application/json

{
  "video_path": "/path/to/processed-video.mp4",
  "video_url": "https://storage.supabase.co/cleaned/hq_video.mp4",
  "source": "sora",
  "character": "isaiahdupree",
  "platforms": ["youtube", "tiktok"],
  "auto_publish": true,
  "metadata": {
    "processed_by": "safari-automation",
    "processing_method": "modal-inpaint+esrgan",
    "original_size_mb": 0.95,
    "final_size_mb": 2.1
  }
}
```

## Quality Comparison

Based on testing with Sora videos (480x872, HEVC, ~1MB):

| Processing | Output Size | Quality | Notes |
|------------|-------------|---------|-------|
| Original | 1.0 MB | Baseline | Has watermark |
| HEVC Crop | 2.0 MB | ⭐⭐⭐⭐ | Fast, slight quality loss |
| H.264 Crop | 3.5 MB | ⭐⭐⭐ | Codec change inflates size |
| Modal AI | 2.0 MB | ⭐⭐⭐⭐⭐ | Full resolution, no crop |
| Modal + ESRGAN 2x | 8.0 MB | ⭐⭐⭐⭐⭐ | Upscaled, enhanced |

## Error Handling

| Error Code | Description | Resolution |
|------------|-------------|------------|
| `ERR_MODAL_UNAVAILABLE` | Modal API unreachable | Falls back to local |
| `ERR_VIDEO_INVALID` | Unsupported format | Use MP4/MOV |
| `ERR_UPSCALE_TIMEOUT` | Replicate timeout | Retry or skip upscaling |
| `ERR_ENCODING_FAILED` | FFmpeg error | Check codec support |

## Rate Limits

| Tier | Requests/min | Concurrent Jobs |
|------|--------------|-----------------|
| Free | 10 | 2 |
| Pro | 60 | 10 |
| Enterprise | Unlimited | 50 |

## See Also

- [HQ_VIDEO_PIPELINE.md](./HQ_VIDEO_PIPELINE.md) - Pipeline implementation details
- [MEDIAPOSTER_INTEGRATION.md](./MEDIAPOSTER_INTEGRATION.md) - Publishing integration
- [VIDEO_PIPELINE.md](./VIDEO_PIPELINE.md) - Standard pipeline docs
