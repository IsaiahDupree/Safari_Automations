# OpenAI Sora Video Generation API

## Overview

Sora is OpenAI's video generation model that creates detailed, dynamic clips with audio from natural language or images. Built on multimodal diffusion, trained on diverse visual data.

## Models

### sora-2
- **Use Case:** Speed and flexibility
- **Best For:** Exploration, rapid iteration, social media content
- **Characteristics:** Fast, good quality, cost-effective

### sora-2-pro
- **Use Case:** Production-quality output
- **Best For:** Cinematic footage, marketing assets, high-fidelity content
- **Characteristics:** Slower, expensive, polished results

## API Endpoints

1. **POST /videos** - Create video render job
2. **GET /videos/{video_id}** - Get video status
3. **GET /videos/{video_id}/content** - Download MP4
4. **GET /videos** - List videos
5. **DELETE /videos/{video_id}** - Delete video

## Workflow

### 1. Create Video (Async)
```python
from openai import OpenAI

client = OpenAI()

video = client.videos.create(
    model="sora-2",
    prompt="A video of a cool cat on a motorcycle in the night",
    size="1280x720",  # or 1920x1080
    seconds="8"  # 2-20 seconds
)

print("Job ID:", video.id)
print("Status:", video.status)  # queued, in_progress
```

### 2. Monitor Progress

**Option A: Poll**
```python
import time

while video.status in ("queued", "in_progress"):
    video = client.videos.retrieve(video.id)
    print(f"Progress: {video.progress}%")
    time.sleep(10)
```

**Option B: Webhook** (recommended)
- Configure at: https://platform.openai.com/settings/project/webhooks
- Events: `video.completed`, `video.failed`

### 3. Download Result
```python
if video.status == "completed":
    content = client.videos.download_content(video.id)
    content.write_to_file("video.mp4")
```

## Parameters

### Video Creation
- `model`: "sora-2" or "sora-2-pro"
- `prompt`: Text description (be specific!)
- `size`: "1280x720" or "1920x1080"
- `seconds`: "2" to "20"
- `input_reference`: Optional image file (first frame)

### Effective Prompting
Describe: **shot type, subject, action, setting, lighting**

Examples:
- "Wide shot of a child flying a red kite in a grassy park, golden hour sunlight, camera slowly pans upward."
- "Close-up of a steaming coffee cup on a wooden table, morning light through blinds, soft depth of field."

## Advanced Features

### Image Reference
Use an image as the first frame:
```bash
curl -X POST "https://api.openai.com/v1/videos" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -F prompt="She turns around and smiles" \
  -F model="sora-2-pro" \
  -F input_reference="@image.jpeg;type=image/jpeg"
```

### Remix
Modify existing video with targeted changes:
```bash
curl -X POST "https://api.openai.com/v1/videos/{video_id}/remix" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d '{"prompt": "Change the color palette to teal, sand, and rust"}'
```

### Download Assets
```bash
# Video (default)
GET /videos/{video_id}/content?variant=video

# Thumbnail
GET /videos/{video_id}/content?variant=thumbnail

# Spritesheet
GET /videos/{video_id}/content?variant=spritesheet
```

## Status States
- `queued` - Job accepted, waiting to start
- `in_progress` - Rendering (check progress %)
- `completed` - Ready to download
- `failed` - Check error message

## Guardrails & Restrictions
- Content must be suitable for under 18
- No copyrighted characters or music
- No real people (including public figures)
- No faces in input images

## Library Management

**List videos:**
```bash
GET /videos?limit=20&after=video_123&order=asc
```

**Delete video:**
```bash
DELETE /videos/{video_id}
```

## Pricing & Timing
- **sora-2**: Faster, cheaper
- **sora-2-pro**: Slower, more expensive
- Generation time: Several minutes depending on resolution and API load
- Download URLs valid for 1 hour max

## Best Practices
1. Use `sora-2` for iteration and concepting
2. Use `sora-2-pro` for final production
3. Set up webhooks instead of polling
4. Download and store videos promptly (1 hour URL expiration)
5. Use remix for small, focused changes
6. Be specific in prompts with visual details
