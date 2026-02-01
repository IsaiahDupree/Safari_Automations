# Comment Automation Guide

Multi-platform comment automation using Safari and tested implementations.

## Test Status

| Package | Port | Tests | Live Verified |
|---------|------|-------|---------------|
| threads-comments | 3004 | 7 ✅ | ✅ Feb 1, 2026 |
| instagram-comments | 3005 | 4 ✅ | Pending |
| tiktok-comments | 3006 | 4 ✅ | Pending |
| twitter-comments | 3007 | 4 ✅ | Pending |
| **Total** | - | **19** | ✅ |

## Verified Threads Flow (Feb 1, 2026)

```
1. Navigate to Threads feed
2. Find posts (GET /api/threads/posts)
3. Click into post (POST /api/threads/click-post)
4. Analyze comments (GET /api/threads/context, /api/threads/comments)
5. Post comment (POST /api/threads/comments/post)
6. Verify comment appears (GET /api/threads/comments)
```

### Live Test Result
```
Post: @william.finds - "Why doesn't every chair do this??"
Comment: "This is genius! Need one of these 🪑✨"
Before: 1 comment | After: 2 comments (verified)
```

## Quick Start

```bash
# Start all comment servers
npx tsx packages/threads-comments/src/api/server.ts &
npx tsx packages/instagram-comments/src/api/server.ts &
npx tsx packages/tiktok-comments/src/api/server.ts &
npx tsx packages/twitter-comments/src/api/server.ts &

# Check health
curl http://localhost:3004/health
curl http://localhost:3005/health
curl http://localhost:3006/health
curl http://localhost:3007/health
```

## Unified Comments CLI

```bash
# Health check all platforms
npx tsx packages/unified-comments/src/cli.ts health

# Status of all platforms
npx tsx packages/unified-comments/src/cli.ts status

# Post comment to specific platform
npx tsx packages/unified-comments/src/cli.ts post threads "Great post!"
```

## Working Implementation Sources

All comment drivers use tested implementations from:

| Source | Used For |
|--------|----------|
| `python/controllers/safari_controller.py` | Safari control, clipboard typing |
| `python/engagement/threads_engagement.py` | Threads JS templates, flow |
| `python/engagement/instagram_engagement.py` | Instagram engagement |
| `python/engagement/tiktok_engagement.py` | TikTok engagement |
| `python/engagement/twitter_engagement.py` | Twitter engagement |
| `python/selectors/threads_selectors.py` | Verified DOM selectors |

## API Endpoints (All Platforms)

Each platform exposes the same endpoint structure:

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/api/{platform}/status` | Check login status |
| GET | `/api/{platform}/rate-limits` | Get rate limits |
| PUT | `/api/{platform}/rate-limits` | Update rate limits |
| POST | `/api/{platform}/comments/post` | Post a comment |
| GET | `/api/{platform}/config` | Get configuration |

### Threads-Specific Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/threads/posts` | Find posts to engage |
| GET | `/api/threads/context` | Extract post context for AI |
| POST | `/api/threads/engage` | Auto-engage with post |
| POST | `/api/threads/engage/loop` | Run engagement loop |

## Comment Posting Flow

The working flow (from Python scripts):

```
1. Click reply button → wait for composer
2. Focus input field → scroll into view
3. Type via clipboard → supports emojis
4. Click expand (if needed) → reveal submit
5. Submit → wait for confirmation
```

## Rate Limits

Default configuration per platform:
- **5 comments per hour**
- **20 comments per day**
- 60-180 second random delay between comments

## Running Tests

```bash
# Run all comment tests
cd packages/threads-comments && npm test
cd packages/instagram-comments && npm test
cd packages/tiktok-comments && npm test
cd packages/twitter-comments && npm test
```

## Requirements

- macOS with Safari browser
- Logged into each platform in Safari
- Safari > Develop > Allow JavaScript from Apple Events ✓

## Archived Scripts

Media poster scripts (not used for comments) moved to:
`python/_archived_media_poster/`
