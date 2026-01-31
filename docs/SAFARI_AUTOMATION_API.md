# Safari Automation API Documentation

## Overview

The Safari Automation API provides REST endpoints for browser automation tasks including video processing, watermark removal, and platform-specific content workflows.

---

## Base URLs

| Environment | URL |
|-------------|-----|
| **Local Safari API** | `http://localhost:7070` |
| **Direct Modal API** | `https://isaiahdupree33--blanklogo-watermark-removal-process-video-http.modal.run` |
| **Backend API** | `http://localhost:5555` |

---

## Endpoints

### Health Check

```http
GET /health
```

**Response:**
```json
{
  "status": "healthy",
  "version": "1.0.0",
  "uptime": 3600
}
```

---

### Process Video

```http
POST /api/v1/video/process
Content-Type: application/json
```

**Request Body:**
```json
{
  "video_url": "https://example.com/video.mp4",
  "video_path": "/local/path/to/video.mp4",
  "mode": "inpaint",
  "platform_preset": "sora",
  "output_format": "mp4",
  "quality": "high"
}
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `video_url` | string | Either url or path | Remote video URL |
| `video_path` | string | Either url or path | Local file path |
| `mode` | string | No | Processing mode: `inpaint`, `crop`, `auto` |
| `platform_preset` | string | No | Platform: `sora`, `tiktok`, `runway`, `generic` |
| `output_format` | string | No | Output format: `mp4`, `webm`, `mov` |
| `quality` | string | No | Quality: `low`, `medium`, `high`, `lossless` |

**Response:**
```json
{
  "job_id": "abc123",
  "status": "processing",
  "estimated_time": 30
}
```

---

### Get Job Status

```http
GET /api/v1/jobs/:id
```

**Response (Processing):**
```json
{
  "job_id": "abc123",
  "status": "processing",
  "progress": 65,
  "stage": "watermark_removal"
}
```

**Response (Complete):**
```json
{
  "job_id": "abc123",
  "status": "complete",
  "output_url": "https://storage.example.com/processed/video.mp4",
  "output_path": "/path/to/processed/video.mp4",
  "duration_seconds": 28.5,
  "metadata": {
    "original_size": 15000000,
    "processed_size": 14500000,
    "watermarks_removed": 1
  }
}
```

---

## Processing Modes

### `inpaint` (Default)
Uses AI to intelligently remove watermarks by analyzing surrounding pixels. Best for complex watermarks.

### `crop`
Crops the video to remove watermark regions. Faster but may lose content.

### `auto`
Automatically selects the best mode based on watermark analysis.

---

## Platform Presets

| Preset | Watermark Location | Recommended Mode |
|--------|-------------------|------------------|
| `sora` | Bottom-right corner | `inpaint` |
| `tiktok` | Bottom-center + username | `inpaint` |
| `runway` | Bottom-right corner | `inpaint` |
| `generic` | Auto-detect | `auto` |

---

## Code Examples

### TypeScript/JavaScript

```typescript
const API_URL = 'http://localhost:7070';

async function processVideo(videoPath: string): Promise<string> {
  // Start processing
  const response = await fetch(`${API_URL}/api/v1/video/process`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      video_path: videoPath,
      mode: 'inpaint',
      platform_preset: 'sora'
    })
  });
  
  const { job_id } = await response.json();
  
  // Poll for completion
  while (true) {
    const status = await fetch(`${API_URL}/api/v1/jobs/${job_id}`);
    const job = await status.json();
    
    if (job.status === 'complete') {
      return job.output_path;
    } else if (job.status === 'failed') {
      throw new Error(job.error);
    }
    
    await new Promise(r => setTimeout(r, 2000));
  }
}
```

### Python

```python
import requests
import time

API_URL = 'http://localhost:7070'

def process_video(video_path: str) -> str:
    # Start processing
    response = requests.post(f'{API_URL}/api/v1/video/process', json={
        'video_path': video_path,
        'mode': 'inpaint',
        'platform_preset': 'sora'
    })
    job_id = response.json()['job_id']
    
    # Poll for completion
    while True:
        status = requests.get(f'{API_URL}/api/v1/jobs/{job_id}')
        job = status.json()
        
        if job['status'] == 'complete':
            return job['output_path']
        elif job['status'] == 'failed':
            raise Exception(job['error'])
        
        time.sleep(2)
```

### cURL

```bash
# Start processing
curl -X POST http://localhost:7070/api/v1/video/process \
  -H "Content-Type: application/json" \
  -d '{"video_path": "/path/to/video.mp4", "mode": "inpaint", "platform_preset": "sora"}'

# Check status
curl http://localhost:7070/api/v1/jobs/abc123
```

---

## Direct Modal API

For direct access without the Safari wrapper:

```python
import modal

# Direct function call
result = modal.Function.lookup("blanklogo-watermark-removal", "process_video_http").remote(
    video_url="https://example.com/video.mp4",
    mode="inpaint"
)
```

```bash
# HTTP endpoint
curl -X POST "https://isaiahdupree33--blanklogo-watermark-removal-process-video-http.modal.run" \
  -H "Content-Type: application/json" \
  -d '{"video_url": "https://example.com/video.mp4", "mode": "inpaint"}'
```

---

## Error Handling

### Error Response Format

```json
{
  "error": true,
  "code": "WATERMARK_NOT_FOUND",
  "message": "No watermark detected in video",
  "details": {
    "frames_analyzed": 100,
    "confidence": 0.15
  }
}
```

### Error Codes

| Code | Description |
|------|-------------|
| `INVALID_VIDEO` | Video file is corrupted or unsupported format |
| `WATERMARK_NOT_FOUND` | No watermark detected |
| `PROCESSING_FAILED` | Internal processing error |
| `TIMEOUT` | Processing exceeded time limit |
| `QUOTA_EXCEEDED` | API rate limit reached |

---

## Rate Limits

| Plan | Requests/Hour | Max Video Length |
|------|---------------|------------------|
| Free | 10 | 60 seconds |
| Pro | 100 | 5 minutes |
| Unlimited | ∞ | 30 minutes |

---

## Related Documentation

- [Media Poster Integration](./MEDIA_POSTER_INTEGRATION.md)
- [Safari Automations Guide](./SAFARI_AUTOMATIONS.md)
- [Sora Browser Automation PRD](./SORA_BROWSER_AUTOMATION_PRD.md)
