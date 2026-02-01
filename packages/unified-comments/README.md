# Unified Comments Client

Single interface for posting comments across Threads, Instagram, TikTok, and Twitter.

## Quick Start

```bash
# Check health of all comment APIs
npx tsx src/cli.ts health

# Check status
npx tsx src/cli.ts status

# Post a comment
npx tsx src/cli.ts post threads "Great post!"
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `health` | Check all comment API health |
| `status [platform]` | Show platform status |
| `comments <platform> [limit]` | List comments on current post |
| `post <platform> "text" [url]` | Post a comment |
| `navigate <platform> <url>` | Navigate to a post |

## Programmatic Usage

```typescript
import { UnifiedCommentsClient } from '@safari-automation/unified-comments';

const client = new UnifiedCommentsClient();

// Check health
const health = await client.checkHealth();
// { threads: true, instagram: true, tiktok: true, twitter: true }

// Get status
const status = await client.getStatus('threads');

// Post a comment
const result = await client.postComment('threads', 'Great post!', 'https://threads.net/...');

// Get comments from current post
const comments = await client.getComments('instagram', 20);

// Post to multiple platforms
const results = await client.postToAll('Check this out!', {
  threads: 'https://threads.net/...',
  instagram: 'https://instagram.com/p/...',
});
```

## Port Reference

| Platform | Port |
|----------|------|
| Threads | 3004 |
| Instagram | 3005 |
| TikTok | 3006 |
| Twitter | 3007 |

## Requirements

Comment API servers must be running:
```bash
npx tsx packages/threads-comments/src/api/server.ts &
npx tsx packages/instagram-comments/src/api/server.ts &
npx tsx packages/tiktok-comments/src/api/server.ts &
npx tsx packages/twitter-comments/src/api/server.ts &
```
