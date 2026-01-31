# Sora Watermark Removal

## Overview

This document describes how to remove watermarks from Sora AI-generated videos using the SoraWatermarkCleaner tool.

## Tool: SoraWatermarkCleaner

**GitHub:** https://github.com/linkedlist771/SoraWatermarkCleaner

### How It Works

The tool uses a two-stage AI pipeline:

1. **YOLOv11s Detection** - Trained model detects Sora watermark location in each frame
2. **LAMA Inpainting** - AI fills in the watermark area seamlessly using surrounding context

### Installation

```bash
# Clone the repo
cd /Users/isaiahdupree/Documents/Software/MediaPoster/Backend
git clone https://github.com/linkedlist771/SoraWatermarkCleaner.git

# Install uv (if not installed)
brew install uv

# Install dependencies
cd SoraWatermarkCleaner
uv sync

# Models are downloaded automatically on first run:
# - YOLOv11s weights: resources/best.pt
# - LAMA model: ~/.cache/torch/hub/
```

### Usage

```bash
# Activate virtual environment
source .venv/bin/activate

# Process all videos in a folder
python cli.py -i /path/to/input -o /path/to/output --pattern "*.mp4"

# Example for Sora videos
python cli.py -i /Users/isaiahdupree/Documents/SoraVideos \
              -o /Users/isaiahdupree/Documents/SoraVideos/clean \
              --pattern "*_watermarked.mp4"
```

### Models Available

| Model | Quality | Speed | GPU Required |
|-------|---------|-------|--------------|
| **LAMA** (default) | Good | Fast (~45s/video) | No (MPS/CPU) |
| **E2FGVI_HQ** | Best (time-consistent) | Very Slow | Yes (CUDA only) |

### Performance on Apple Silicon (M1/M2/M3)

- Uses MPS (Metal Performance Shaders) for GPU acceleration
- LAMA model works well on MPS
- E2FGVI_HQ falls back to CPU (very slow, not recommended)
- Processing speed: ~45-60 seconds per video

## Alternative: FFmpeg Crop Method

For faster processing (but loses bottom 100px):

```bash
# Crop bottom 100px where watermark is located
ffmpeg -y -i input.mp4 -vf "crop=width:height-100:0:0" -c:a copy output.mp4
```

### Comparison

| Method | Quality | Speed | Full Frame |
|--------|---------|-------|------------|
| **AI Inpainting** | ⭐⭐⭐⭐⭐ | ~45s/video | ✅ Yes |
| **Crop** | ⭐⭐⭐ | ~2s/video | ❌ No (loses 100px) |

## File Locations

```
/Users/isaiahdupree/Documents/SoraVideos/
├── s_*_watermarked.mp4        # Original downloaded videos
├── s_*.mp4                    # Cropped versions (old method)
├── clean/                     # AI-cleaned versions
│   └── cleaned_s_*.mp4
└── sora_manifest.json         # Download manifest
```

## Scripts

### Safari Scraper
`Backend/automation/safari_sora_scraper.py`
- Automatically scrapes videos from sora.chatgpt.com/profile
- Downloads all videos
- Saves to `/Users/isaiahdupree/Documents/SoraVideos/`

### Batch Processing
```bash
# Full pipeline: scrape → download → AI watermark removal
cd /Users/isaiahdupree/Documents/Software/MediaPoster/Backend/SoraWatermarkCleaner
source .venv/bin/activate
python cli.py -i /Users/isaiahdupree/Documents/SoraVideos \
              -o /Users/isaiahdupree/Documents/SoraVideos/clean \
              --pattern "*_watermarked.mp4"
```

## Troubleshooting

### "E2FGVI_HQ doesn't support MPS"
- This is expected on Apple Silicon
- The tool automatically falls back to LAMA model
- LAMA is fast and produces good results

### Models not downloading
- Check internet connection
- Models are downloaded from:
  - YOLO: https://github.com/linkedlist771/SoraWatermarkCleaner/releases
  - LAMA: https://github.com/Sanster/models/releases

## Results

- **96 Sora videos** scraped from profile
- AI inpainting successfully removes "Sora @username" watermark
- Output preserves full frame (no cropping needed)
