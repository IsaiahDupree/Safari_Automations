# @safari-automation/adobe-firefly

Safari automation for Adobe Firefly — generates AI images from text prompts via browser automation.

## Port: 3110

## Start

```bash
PORT=3110 npx tsx src/api/server.ts
```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Liveness check |
| GET | `/api/firefly/status` | Safari/Firefly session state + rate limits |
| POST | `/api/firefly/navigate` | Navigate Safari to Firefly image generator |
| POST | `/api/firefly/generate` | Generate images from a text prompt |
| GET | `/api/firefly/images` | Extract current image URLs from page |
| POST | `/api/firefly/download` | Download current images to local disk |
| GET | `/api/firefly/config` | Driver config |
| PUT | `/api/firefly/config` | Update driver config |
| GET | `/api/firefly/rate-limits` | Rate limit state |
| PUT | `/api/firefly/rate-limits` | Update rate limits |

## Generate Request

```json
POST /api/firefly/generate
{
  "prompt": "a futuristic city at sunset, cinematic lighting",
  "negativePrompt": "blurry, low quality",
  "aspectRatio": "widescreen",
  "style": "cinematic",
  "count": 4
}
```

**aspectRatio**: `square` | `landscape` | `portrait` | `widescreen`

**style**: `none` | `cinematic` | `vintage` | `minimalist` | `abstract` | `neon` | `watercolor` | `sketch` | `oil_painting` | `digital_art`

## Generate Response

```json
{
  "success": true,
  "prompt": "a futuristic city at sunset...",
  "imageUrls": ["https://...", "blob:..."],
  "savedPaths": ["/Users/.../Downloads/firefly-generated/firefly-a-futuristic-city-2026-02-27T....jpg"],
  "rateLimits": { "generationsThisHour": 1, "generationsToday": 1 }
}
```

## Prerequisites

1. Safari must be open and logged into https://firefly.adobe.com
2. Safari Developer → Allow JavaScript from Apple Events must be enabled

## Env Vars

```
ADOBE_FIREFLY_PORT=3110
FIREFLY_DOWNLOADS_DIR=/path/to/save/images
FIREFLY_GENERATE_TIMEOUT_MS=90000
FIREFLY_GENS_PER_HOUR=20
FIREFLY_GENS_PER_DAY=100
FIREFLY_MIN_DELAY_MS=5000
```
