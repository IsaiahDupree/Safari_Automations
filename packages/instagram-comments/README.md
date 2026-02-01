# Instagram Comments API

Safari automation API for posting comments on Instagram.

**Tested: ✅ 4 tests passing**

## Port: 3005

## Quick Start

```bash
npx tsx src/api/server.ts
npm test
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/api/instagram/status` | Check status |
| GET | `/api/instagram/rate-limits` | Rate limits |
| POST | `/api/instagram/comments/post` | Post comment |

## Usage

```bash
curl http://localhost:3005/api/instagram/status
curl -X POST http://localhost:3005/api/instagram/comments/post \
  -H "Content-Type: application/json" \
  -d '{"text": "Great photo!"}'
```

## Implementation

Uses working scripts from `python/engagement/instagram_engagement.py`
