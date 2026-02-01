---
description: Manage comment automation across Threads, Instagram, TikTok, and Twitter
---

## Check Comment API health
// turbo
```bash
npx tsx packages/unified-comments/src/cli.ts health
```

## Check platform status
// turbo
```bash
npx tsx packages/unified-comments/src/cli.ts status
```

## Check specific platform status
```bash
npx tsx packages/unified-comments/src/cli.ts status threads
npx tsx packages/unified-comments/src/cli.ts status instagram
npx tsx packages/unified-comments/src/cli.ts status tiktok
npx tsx packages/unified-comments/src/cli.ts status twitter
```

## List comments on current post
```bash
npx tsx packages/unified-comments/src/cli.ts comments threads 20
```

## Post a comment
```bash
npx tsx packages/unified-comments/src/cli.ts post threads "Great post!"
npx tsx packages/unified-comments/src/cli.ts post instagram "Love this!" https://instagram.com/p/xyz
```

## Navigate to a post
```bash
npx tsx packages/unified-comments/src/cli.ts navigate threads https://threads.net/@user/post/abc
```

## Start Comment API servers

### Threads (port 3004)
```bash
npx tsx packages/threads-comments/src/api/server.ts
```

### Instagram (port 3005)
```bash
npx tsx packages/instagram-comments/src/api/server.ts
```

### TikTok (port 3006)
```bash
npx tsx packages/tiktok-comments/src/api/server.ts
```

### Twitter (port 3007)
```bash
npx tsx packages/twitter-comments/src/api/server.ts
```

## Start all comment servers at once
```bash
npx tsx packages/threads-comments/src/api/server.ts &
npx tsx packages/instagram-comments/src/api/server.ts &
npx tsx packages/tiktok-comments/src/api/server.ts &
npx tsx packages/twitter-comments/src/api/server.ts &
```
