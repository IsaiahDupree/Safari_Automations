# Safari Automation Testing Playbook

A step-by-step guide to manually test all four automation capabilities across every supported platform using `curl`. Each section covers prerequisites, the exact command, and what a successful response looks like.

---

## Platform & Port Reference

| Platform   | DM Port | Comments Port | Notes |
|------------|---------|---------------|-------|
| Twitter    | 3003    | 3007          | Requires `SAFARI_RESEARCH_ENABLED=true` to run research |
| Instagram  | 3100    | 3005          | — |
| TikTok     | 3102    | 3006          | — |
| Threads    | —       | 3004          | No DM service |
| LinkedIn   | 3105    | —             | Comments via DM service |
| Market Research (all platforms) | — | 3106 | Central research hub |

---

## Prerequisites

Before running any test, make sure the target services are running. Twitter is started **manually only** (not auto-launched):

```bash
# Required for all tests — Safari Gateway (lock coordinator)
npx tsx packages/scheduler/src/safari-gateway.ts &

# Twitter (start manually — NOT auto-launched)
SAFARI_RESEARCH_ENABLED=true PORT=3007 npx tsx packages/twitter-comments/src/api/server.ts &
PORT=3003 npx tsx packages/twitter-dm/src/api/server.ts &

# Instagram
PORT=3005 npx tsx packages/instagram-comments/src/api/server.ts &
PORT=3100 npx tsx packages/instagram-dm/src/api/server.ts &

# TikTok
PORT=3006 npx tsx packages/tiktok-comments/src/api/server.ts &
PORT=3102 npx tsx packages/tiktok-dm/src/api/server.ts &

# Threads
PORT=3004 npx tsx packages/threads-comments/src/api/server.ts &

# Market Research hub (all-platform research)
PORT=3106 npx tsx packages/market-research/src/api/server.ts &
```

Verify a service is up:
```bash
curl http://localhost:3007/health   # twitter-comments
curl http://localhost:3003/health   # twitter-dm
curl http://localhost:3005/health   # instagram-comments
curl http://localhost:3100/health   # instagram-dm
curl http://localhost:3006/health   # tiktok-comments
curl http://localhost:3102/health   # tiktok-dm
curl http://localhost:3004/health   # threads-comments
curl http://localhost:3106/health   # market-research
```

---

## Test 1 — DM on All Platforms

Send a test DM to a real account you control on each platform. Safari must be open and logged in to each platform.

### Twitter (port 3003)
```bash
curl -s -X POST http://localhost:3003/api/twitter/messages/send-to \
  -H "Content-Type: application/json" \
  -d '{"username": "testhandle", "text": "Hey! This is a test DM from Safari automation."}' | jq .
```

### Instagram (port 3100)
```bash
curl -s -X POST http://localhost:3100/api/messages/send-to \
  -H "Content-Type: application/json" \
  -d '{"username": "testhandle", "text": "Hey! This is a test DM from Safari automation."}' | jq .
```

### TikTok (port 3102)
```bash
curl -s -X POST http://localhost:3102/api/tiktok/messages/send-to \
  -H "Content-Type: application/json" \
  -d '{"username": "testhandle", "text": "Hey! This is a test DM from Safari automation."}' | jq .
```

### LinkedIn (port 3105)
```bash
curl -s -X POST http://localhost:3105/api/linkedin/messages/send-to \
  -H "Content-Type: application/json" \
  -d '{"username": "linkedin-username-slug", "text": "Hey! This is a test DM from Safari automation."}' | jq .
```

**Expected success shape:**
```json
{
  "success": true,
  "sent": true,
  "verified": true,
  "verifiedRecipient": "testhandle"
}
```

---

## Test 2 — Comment on a Feed Post on All Platforms

Navigate to a specific post URL and leave a comment. Swap in a real post URL for each platform.

### Twitter (port 3007)
```bash
curl -s -X POST http://localhost:3007/api/twitter/comments/post \
  -H "Content-Type: application/json" \
  -d '{
    "postUrl": "https://x.com/someuser/status/1234567890123456789",
    "text": "Great insight — thanks for sharing!",
    "useAI": false
  }' | jq .
```

Use `"useAI": true` to let GPT-4o write the comment automatically (no `text` needed).

### Instagram (port 3005)
```bash
curl -s -X POST http://localhost:3005/api/instagram/comments/post \
  -H "Content-Type: application/json" \
  -d '{
    "postUrl": "https://www.instagram.com/p/XXXXXXXXXXX/",
    "text": "Great insight — thanks for sharing!"
  }' | jq .
```

### TikTok (port 3006)
```bash
curl -s -X POST http://localhost:3006/api/tiktok/comments/post \
  -H "Content-Type: application/json" \
  -d '{
    "postUrl": "https://www.tiktok.com/@someuser/video/1234567890123456789",
    "text": "Great insight — thanks for sharing!"
  }' | jq .
```

### Threads (port 3004)
```bash
curl -s -X POST http://localhost:3004/api/threads/comments/post \
  -H "Content-Type: application/json" \
  -d '{
    "postUrl": "https://www.threads.net/@someuser/post/XXXXXXXXXXX",
    "text": "Great insight — thanks for sharing!"
  }' | jq .
```

**Expected success shape:**
```json
{
  "success": true,
  "posted": true,
  "comment": "Great insight — thanks for sharing!"
}
```

---

## Test 3 — Market Research: 1 Keyword, Stats from First Post

Navigates Safari to the platform's search, extracts the first visible post's stats (likes, views, engagement), and returns immediately — no long scroll session.

All commands hit the **Market Research hub on port 3106**.

### Twitter
```bash
curl -s -X POST http://localhost:3106/api/research/twitter/search \
  -H "Content-Type: application/json" \
  -d '{"query": "solopreneur", "config": {"tweetsPerNiche": 10}}' | jq '{
    platform: "twitter",
    keyword: .query,
    firstPost: .posts[0],
    totalFound: .count
  }'
```

### Instagram
```bash
curl -s -X POST http://localhost:3106/api/research/instagram/search \
  -H "Content-Type: application/json" \
  -d '{"query": "solopreneur", "config": {}}' | jq '{
    platform: "instagram",
    keyword: .query,
    firstPost: .posts[0],
    totalFound: .count
  }'
```

### TikTok
```bash
curl -s -X POST http://localhost:3106/api/research/tiktok/search \
  -H "Content-Type: application/json" \
  -d '{"query": "solopreneur", "config": {}}' | jq '{
    platform: "tiktok",
    keyword: .query,
    firstPost: .posts[0],
    totalFound: .count
  }'
```

### Threads
```bash
curl -s -X POST http://localhost:3106/api/research/threads/search \
  -H "Content-Type: application/json" \
  -d '{"query": "solopreneur", "config": {}}' | jq '{
    platform: "threads",
    keyword: .query,
    firstPost: .posts[0],
    totalFound: .count
  }'
```

**Expected success shape:**
```json
{
  "platform": "twitter",
  "keyword": "solopreneur",
  "firstPost": {
    "id": "1234567890",
    "url": "https://x.com/someuser/status/1234567890",
    "text": "...",
    "author": "someuser",
    "likes": 1200,
    "retweets": 340,
    "views": 48000,
    "engagementScore": 1880
  },
  "totalFound": 10
}
```

> **Note:** The `/search` endpoint returns synchronously (Safari navigates, extracts, returns). It does NOT do a long scroll session — that's what `/niche` (async job) does.

---

## Test 4 — Competitor Research: 5 Posts from Top Creators

Run a single-niche async research job per platform, targeting a small tweet count to get top creators fast. The job runs in the background; poll for results.

**Step A — Start the job**

### Twitter
```bash
curl -s -X POST http://localhost:3106/api/research/twitter/niche \
  -H "Content-Type: application/json" \
  -d '{
    "niche": "solopreneur",
    "config": {
      "tweetsPerNiche": 50,
      "creatorsPerNiche": 5,
      "scrollPauseMs": 1000,
      "maxScrollsPerSearch": 10
    }
  }' | jq '{jobId: .jobId, status: .status}'
```

### Instagram
```bash
curl -s -X POST http://localhost:3106/api/research/instagram/niche \
  -H "Content-Type: application/json" \
  -d '{"niche": "solopreneur", "config": {"postsPerNiche": 50, "creatorsPerNiche": 5}}' \
  | jq '{jobId: .jobId, status: .status}'
```

### TikTok
```bash
curl -s -X POST http://localhost:3106/api/research/tiktok/niche \
  -H "Content-Type: application/json" \
  -d '{"niche": "solopreneur", "config": {"postsPerNiche": 50, "creatorsPerNiche": 5}}' \
  | jq '{jobId: .jobId, status: .status}'
```

### Threads
```bash
curl -s -X POST http://localhost:3106/api/research/threads/niche \
  -H "Content-Type: application/json" \
  -d '{"niche": "solopreneur", "config": {"postsPerNiche": 50, "creatorsPerNiche": 5}}' \
  | jq '{jobId: .jobId, status: .status}'
```

**Step B — Poll for completion** (replace `JOB_ID` with value from Step A)
```bash
curl -s http://localhost:3106/api/research/status/JOB_ID | jq '{status: .status, progress: .progress}'
```

**Step C — Read top 5 creators once status is `completed`**
```bash
curl -s http://localhost:3106/api/research/status/JOB_ID | jq '{
  niche: .result.niche,
  totalTweets: .result.totalCollected,
  top5Creators: [.result.creators[:5][] | {
    handle: .handle,
    totalEngagement: .totalEngagement,
    topPost: .topTweetUrl
  }]
}'
```

**Expected shape:**
```json
{
  "niche": "solopreneur",
  "totalTweets": 47,
  "top5Creators": [
    { "handle": "creatorA", "totalEngagement": 18400, "topPost": "https://x.com/creatorA/status/..." },
    { "handle": "creatorB", "totalEngagement": 9200,  "topPost": "https://x.com/creatorB/status/..." },
    { "handle": "creatorC", "totalEngagement": 7100,  "topPost": "https://x.com/creatorC/status/..." },
    { "handle": "creatorD", "totalEngagement": 5300,  "topPost": "https://x.com/creatorD/status/..." },
    { "handle": "creatorE", "totalEngagement": 3800,  "topPost": "https://x.com/creatorE/status/..." }
  ]
}
```

---

## Quick All-Platform Test Script

Paste this into your terminal to run all four tests sequentially (Twitter only, as a smoke test):

```bash
#!/bin/bash
set -e
BASE_DM=3003
BASE_COMMENT=3007
BASE_RESEARCH=3106
HANDLE="yourtesthandle"         # change this
POST_URL="https://x.com/someuser/status/1234567890123456789"  # change this
KEYWORD="solopreneur"

echo "=== 1. DM Test ==="
curl -s -X POST http://localhost:$BASE_DM/api/twitter/messages/send-to \
  -H "Content-Type: application/json" \
  -d "{\"username\": \"$HANDLE\", \"text\": \"Test DM from automation\"}" | jq .

echo "=== 2. Comment Test ==="
curl -s -X POST http://localhost:$BASE_COMMENT/api/twitter/comments/post \
  -H "Content-Type: application/json" \
  -d "{\"postUrl\": \"$POST_URL\", \"useAI\": true}" | jq .

echo "=== 3. Market Research — first post stats ==="
curl -s -X POST http://localhost:$BASE_RESEARCH/api/research/twitter/search \
  -H "Content-Type: application/json" \
  -d "{\"query\": \"$KEYWORD\", \"config\": {\"tweetsPerNiche\": 10}}" \
  | jq '{firstPost: .posts[0], total: .count}'

echo "=== 4. Competitor Research — top 5 creators (async) ==="
JOB=$(curl -s -X POST http://localhost:$BASE_RESEARCH/api/research/twitter/niche \
  -H "Content-Type: application/json" \
  -d "{\"niche\": \"$KEYWORD\", \"config\": {\"tweetsPerNiche\": 50, \"creatorsPerNiche\": 5, \"maxScrollsPerSearch\": 10}}" \
  | jq -r '.jobId')
echo "Job ID: $JOB — polling..."
for i in {1..20}; do
  STATUS=$(curl -s http://localhost:$BASE_RESEARCH/api/research/status/$JOB | jq -r '.status')
  echo "  [$i] $STATUS"
  if [ "$STATUS" = "completed" ]; then
    curl -s http://localhost:$BASE_RESEARCH/api/research/status/$JOB \
      | jq '{top5: [.result.creators[:5][] | {handle, totalEngagement, topPost: .topTweetUrl}]}'
    break
  fi
  sleep 5
done
```

---

## Env Variables Reference

| Variable | Service | Purpose |
|----------|---------|---------|
| `SAFARI_RESEARCH_ENABLED=true` | twitter-comments (3007) | Must be set to allow research runs |
| `SAFARI_CHECKBACKS_ENABLED=true` | twitter-comments (3007) | Must be set to allow feedback loop check-backs |
| `SAFARI_GATEWAY_URL` | All | Defaults to `http://localhost:3000` |
| `OPENAI_API_KEY` | DM + Comment services | Enables AI-generated messages/comments |
| `RESEARCH_API_KEY` | market-research (3106) | Enables auth on the research hub (optional) |

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `"Safari Gateway lock"` error | Safari Gateway not running — start it first |
| `"Twitter research is disabled"` | Add `SAFARI_RESEARCH_ENABLED=true` when starting port 3007 |
| `"Could not acquire Safari lock"` | Another automation holds the lock — wait or call `POST http://localhost:3000/gateway/lock/force-release` |
| DM sends but `verified: false` | Message text didn't appear in DOM after send — platform may have throttled; retry |
| Research job stuck in `running` | Check service logs; Safari may be rate-limited — poll again in 60s |
| osascript errors | Safari must be open with the correct platform already loaded in the front tab |
