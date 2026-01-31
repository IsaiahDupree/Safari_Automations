# High-Quality Video Pipeline

Maximum quality video processing for Sora-generated content.

## Overview

The HQ Video Pipeline processes videos with:
1. **AI Watermark Inpainting** - YOLO detection + LAMA inpainting via Modal GPU
2. **AI Upscaling** - Real-ESRGAN via Replicate API
3. **MediaPoster Integration** - Automatic publishing to YouTube/TikTok

## Quality Comparison

| Method | Quality | Speed | Cost |
|--------|---------|-------|------|
| **Modal AI Inpaint** | ⭐⭐⭐⭐⭐ | ~30-60s | ~$0.05/video |
| **Local FFmpeg Crop** | ⭐⭐⭐ | ~5-10s | Free |
| **Real-ESRGAN 2x** | ⭐⭐⭐⭐⭐ | ~2-3min | ~$0.14/video |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    HQ Video Pipeline                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────┐    ┌───────────────┐    ┌─────────────────┐   │
│  │  Input   │───▶│ Watermark     │───▶│ AI Upscaling    │   │
│  │  Video   │    │ Removal       │    │ (optional)      │   │
│  └──────────┘    └───────────────┘    └─────────────────┘   │
│                         │                      │             │
│                         ▼                      ▼             │
│              ┌─────────────────┐    ┌─────────────────┐     │
│              │ Modal GPU       │    │ Replicate       │     │
│              │ YOLO + LAMA     │    │ Real-ESRGAN     │     │
│              └─────────────────┘    └─────────────────┘     │
│                         │                      │             │
│                         └──────────┬───────────┘             │
│                                    ▼                         │
│                         ┌─────────────────┐                  │
│                         │ MediaPoster     │                  │
│                         │ YouTube/TikTok  │                  │
│                         └─────────────────┘                  │
└─────────────────────────────────────────────────────────────┘
```

## Processing Modes

### Modal AI Inpainting (Recommended)
Uses BlankLogo's Modal serverless GPU:
- **YOLO v8** detects watermark position
- **LAMA** inpaints the watermark region
- Preserves full video resolution
- No cropping = no quality loss

### Local FFmpeg Crop (Fallback)
Uses SoraWatermarkCleaner:
- FFmpeg crops bottom 100px
- Fast but loses some frame area
- Free, no API required

### Auto Mode (Default)
- Tries Modal first
- Falls back to local if Modal fails

## AI Upscaling

### Real-ESRGAN via Replicate
- 2x or 4x upscaling
- Enhances detail and sharpness
- ~$0.14 per video on A100 GPU
- Processing time: 2-3 minutes

## Usage

### Single Video
```bash
# AI inpainting only
npx tsx scripts/hq-video-pipeline.ts --video ~/sora-videos/test.mp4 --mode modal

# AI inpainting + 2x upscaling
npx tsx scripts/hq-video-pipeline.ts --video ~/sora-videos/test.mp4 --upscale

# AI inpainting + 4x upscaling
npx tsx scripts/hq-video-pipeline.ts --video ~/sora-videos/test.mp4 --upscale --scale 4
```

### Batch Processing
```bash
# Process all videos in directory
npx tsx scripts/hq-video-pipeline.ts --dir ~/sora-videos/badass-marathon/

# Process + send to MediaPoster
npx tsx scripts/hq-video-pipeline.ts --dir ~/sora-videos/badass-marathon/ \
  --character isaiahdupree --platforms youtube,tiktok
```

### Full Pipeline Example
```bash
# Maximum quality: AI inpaint + 2x upscale + publish
npx tsx scripts/hq-video-pipeline.ts \
  --dir ~/sora-videos/badass-marathon/ \
  --mode modal \
  --upscale \
  --scale 2 \
  --character isaiahdupree \
  --platforms youtube,tiktok
```

## Configuration

### Environment Variables

```bash
# Modal API (BlankLogo AI inpainting)
export MODAL_TOKEN_ID="your-modal-token-id"
export MODAL_TOKEN_SECRET="your-modal-token-secret"

# Replicate API (Real-ESRGAN upscaling)
export REPLICATE_API_TOKEN="your-replicate-token"

# Optional: Custom paths
export HQ_OUTPUT_DIR="~/sora-videos/hq-cleaned"
export HQ_UPSCALED_DIR="~/sora-videos/upscaled"
export MEDIAPOSTER_WEBHOOK_URL="http://localhost:5555/api/webhooks/video-ready"
```

### Get API Keys

1. **Modal**: https://modal.com/settings
   - Create account
   - Go to Settings → API Tokens
   - Create new token

2. **Replicate**: https://replicate.com/account/api-tokens
   - Create account
   - Go to API Tokens
   - Copy token

## Output Directories

| Directory | Contents |
|-----------|----------|
| `~/sora-videos/hq-cleaned/` | AI-inpainted videos (watermark removed) |
| `~/sora-videos/upscaled/` | Upscaled videos (2x or 4x) |
| `~/sora-videos/cleaned/` | Local FFmpeg cropped videos |

## CLI Reference

```
Options:
  --video <path>      Process a single video
  --dir <path>        Process all videos in directory
  --mode <mode>       Processing mode: modal, local, auto (default: auto)
  --upscale           Enable Real-ESRGAN AI upscaling
  --scale <n>         Upscale factor: 2 or 4 (default: 2)
  --platform <name>   Source platform: sora, tiktok, runway, pika
  --character <name>  Character name for MediaPoster
  --platforms <list>  Publish platforms: youtube,tiktok
  --alert             Alert MediaPoster when done
```

## Comparison: Methods

### Before (Simple Crop)
- ❌ Loses 100px of frame
- ❌ Black bars may remain
- ✅ Fast (5-10s)
- ✅ Free

### After (AI Inpainting)
- ✅ Full resolution preserved
- ✅ Watermark cleanly removed
- ✅ No visible artifacts
- ⚠️ Costs ~$0.05/video
- ⚠️ Takes 30-60s

### With Upscaling
- ✅ 2x or 4x resolution
- ✅ Enhanced sharpness
- ✅ Professional quality
- ⚠️ Costs ~$0.14/video
- ⚠️ Takes 2-3min

## Integration with Safari Automation

The HQ pipeline can be triggered after Sora video generation:

```typescript
// In sora-full-automation.ts
import { exec } from 'child_process';

// After video download
const hqPipeline = `npx tsx scripts/hq-video-pipeline.ts \
  --video "${downloadedPath}" \
  --mode modal \
  --character isaiahdupree \
  --platforms youtube,tiktok`;

exec(hqPipeline, (err, stdout) => {
  console.log('[SORA] HQ Pipeline:', stdout);
});
```

## Troubleshooting

### Modal Connection Issues
```
Error: Modal API error: 401
```
- Check MODAL_TOKEN_ID and MODAL_TOKEN_SECRET
- Ensure tokens are not expired
- Verify Modal app is deployed: `modal deploy apps/worker/python/modal_app.py`

### Replicate Timeout
```
Error: Prediction timed out
```
- Large videos may take longer
- Try smaller videos first
- Check Replicate dashboard for status

### Local Fallback Not Working
```
Error: uv not found
```
- Install uv: `pip install uv`
- Or use: `pip install -r requirements.txt` in SoraWatermarkCleaner

## Cost Estimation

For 17 videos (badass marathon):

| Process | Per Video | Total (17) |
|---------|-----------|------------|
| Modal AI Inpaint | $0.05 | $0.85 |
| Real-ESRGAN 2x | $0.14 | $2.38 |
| **Total (both)** | $0.19 | **$3.23** |

## See Also

- [VIDEO_PIPELINE.md](./VIDEO_PIPELINE.md) - Standard pipeline documentation
- [MEDIAPOSTER_INTEGRATION.md](./MEDIAPOSTER_INTEGRATION.md) - Publishing integration
- [BlankLogo README](../../../WaterMarkRemover%20-%20BlankLogo/README.md) - AI watermark removal
