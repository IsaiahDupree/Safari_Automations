# Twitter Comments API

Safari automation API for posting comments/replies on Twitter.

**Tested: ✅ 4 tests passing**

## Port: 3007

## Quick Start

```bash
npx tsx src/api/server.ts
npm test
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/api/twitter/status` | Check status |
| GET | `/api/twitter/rate-limits` | Rate limits |
| POST | `/api/twitter/comments/post` | Post reply |

## Usage

```bash
curl http://localhost:3007/api/twitter/status
curl -X POST http://localhost:3007/api/twitter/comments/post \
  -H "Content-Type: application/json" \
  -d '{"text": "Great tweet!"}'
```

## Implementation

Uses working scripts from `python/engagement/twitter_engagement.py`
