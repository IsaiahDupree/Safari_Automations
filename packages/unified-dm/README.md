# Unified DM Client

Single interface for sending and receiving DMs across TikTok, Instagram, and Twitter.

## Features

- **Multi-Platform** - One API for all DM platforms
- **Health Checks** - Monitor all DM services
- **Conversation Management** - List, open, and manage conversations
- **Message Operations** - Send and read messages across platforms

## CLI Usage

```bash
# Check health of all DM APIs
npx tsx src/cli.ts health

# Check status of all platforms
npx tsx src/cli.ts status

# List conversations (all platforms)
npx tsx src/cli.ts list

# List conversations (specific platform)
npx tsx src/cli.ts list tiktok

# Send a DM
npx tsx src/cli.ts send tiktok @username "Hello!"
```

## Programmatic Usage

```typescript
import { UnifiedDMClient } from '@safari-automation/unified-dm';

const client = new UnifiedDMClient();

// Check health
const health = await client.checkHealth();
// { tiktok: true, instagram: true, twitter: false }

// List all conversations
const conversations = await client.listAllConversations();

// Send a DM
const result = await client.sendDM('tiktok', 'username', 'Hello!');
// { success: true, platform: 'tiktok', messageId: '...' }

// Get platform status
const status = await client.getPlatformStatus('instagram');
// { platform: 'instagram', isOnline: true, isLoggedIn: true, ... }
```

## Configuration

```typescript
const client = new UnifiedDMClient({
  tiktokApiUrl: 'http://localhost:3002',
  instagramApiUrl: 'http://localhost:3001',
  twitterApiUrl: 'http://localhost:3003',
  timeout: 30000,
});
```

## API Requirements

This client requires the DM API servers to be running:

| Platform | Port | Start Command |
|----------|------|---------------|
| TikTok | 3002 | `npx tsx packages/tiktok-dm/src/api/server.ts` |
| Instagram | 3001 | `npx tsx packages/instagram-dm/src/api/server.ts` |
| Twitter | 3003 | `npx tsx packages/twitter-dm/src/api/server.ts` |
