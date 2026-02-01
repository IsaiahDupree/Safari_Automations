# Threads Comments API

Safari automation API for posting comments on Threads.

**Tested: ✅ 7 tests passing | Verified: ✅ Live automation working**

## Port: 3004

## Quick Start

```bash
# Start the server
npx tsx src/api/server.ts

# Run tests
npm test
```

## Verified Automation Flow

The complete flow that has been tested and verified:

```
1. Navigate to Threads feed
2. Find posts to engage with
3. Click into a specific post
4. Analyze existing comments
5. Post comment (with emoji support)
6. Verify comment appears in thread
```

### Example Session

```bash
# Step 1: Check status
curl http://localhost:3004/api/threads/status
# → {"isOnThreads":true,"isLoggedIn":true}

# Step 2: Find posts
curl "http://localhost:3004/api/threads/posts?limit=5"
# → Returns 5 posts with username, url, content

# Step 3: Click into post
curl -X POST http://localhost:3004/api/threads/click-post \
  -H "Content-Type: application/json" -d '{"index": 0}'

# Step 4: Get context and comments
curl http://localhost:3004/api/threads/context
curl "http://localhost:3004/api/threads/comments?limit=10"

# Step 5: Post comment
curl -X POST http://localhost:3004/api/threads/comments/post \
  -H "Content-Type: application/json" \
  -d '{"text": "This is genius! 🪑✨"}'

# Step 6: Verify comment appears
curl "http://localhost:3004/api/threads/comments?limit=10"
# → Now includes your comment
```

## API Endpoints

### Core Endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/api/threads/status` | Check Threads status (logged in, current URL) |
| GET | `/api/threads/rate-limits` | Get rate limit configuration |
| PUT | `/api/threads/rate-limits` | Update rate limits |
| POST | `/api/threads/navigate` | Navigate to a post URL |
| GET | `/api/threads/post` | Get current post details |
| GET | `/api/threads/comments` | Get comments on current post |
| POST | `/api/threads/comments/post` | Post a comment |
| GET | `/api/threads/config` | Get configuration |
| PUT | `/api/threads/config` | Update configuration |

### Engagement Discovery
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/threads/posts` | Find posts to engage with |
| GET | `/api/threads/context` | Extract post + replies for AI |
| POST | `/api/threads/scroll` | Scroll feed to load more |
| POST | `/api/threads/click-post` | Click into a specific post |

### Auto Engagement
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/threads/engage` | Auto-engage with a post |
| POST | `/api/threads/engage/loop` | Run engagement loop |
| GET | `/api/threads/engage/history` | Get commented URLs |
| DELETE | `/api/threads/engage/history` | Clear history |

## Usage Examples

### Check Status
```bash
curl http://localhost:3004/api/threads/status
```

### Post a Comment
```bash
curl -X POST http://localhost:3004/api/threads/comments/post \
  -H "Content-Type: application/json" \
  -d '{"text": "Great post!", "postUrl": "https://www.threads.net/@user/post/abc123"}'
```

### Get Comments
```bash
curl http://localhost:3004/api/threads/comments?limit=20
```

### Navigate to Post
```bash
curl -X POST http://localhost:3004/api/threads/navigate \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.threads.net/@user/post/abc123"}'
```

## Rate Limits

Default configuration:
- **5 comments per hour**
- **20 comments per day**
- 60-180 second delay between comments

Update rate limits:
```bash
curl -X PUT http://localhost:3004/api/threads/rate-limits \
  -H "Content-Type: application/json" \
  -d '{"commentsPerHour": 10, "commentsPerDay": 30}'
```

### Auto Engage
```bash
# Engage with current/next post
curl -X POST http://localhost:3004/api/threads/engage

# Engage with specific post
curl -X POST http://localhost:3004/api/threads/engage \
  -H "Content-Type: application/json" \
  -d '{"postUrl": "https://threads.com/@user/post/abc"}'

# Run engagement loop (3 posts, 1 min delay)
curl -X POST http://localhost:3004/api/threads/engage/loop \
  -H "Content-Type: application/json" \
  -d '{"count": 3, "delayBetween": 60000}'
```

## Implementation

Uses working scripts from:
- `python/controllers/safari_controller.py` → clipboard typing
- `python/engagement/threads_engagement.py` → JS templates
- `python/selectors/threads_selectors.py` → DOM selectors

## Requirements

- macOS with Safari
- Logged into Threads in Safari
- Safari "Allow JavaScript from Apple Events" enabled
