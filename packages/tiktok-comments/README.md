# TikTok Comments API

Safari automation API for posting comments on TikTok.

**Tested: ✅ 4 tests passing**

## Port: 3006

## Quick Start

```bash
npx tsx src/api/server.ts
npm test
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/api/tiktok/status` | Check status |
| GET | `/api/tiktok/rate-limits` | Rate limits |
| POST | `/api/tiktok/comments/post` | Post comment |

## Usage

```bash
curl http://localhost:3006/api/tiktok/status
curl -X POST http://localhost:3006/api/tiktok/comments/post \
  -H "Content-Type: application/json" \
  -d '{"text": "Love this video!"}'
```

## Implementation

Uses working scripts from `python/engagement/tiktok_engagement.py`
