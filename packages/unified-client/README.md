# @safari-automation/unified-client

Unified social automation client providing a single interface for multi-platform DM management.

## Supported Platforms

- ✅ Instagram
- ✅ Twitter/X
- 🔜 Threads
- 🔜 TikTok

## Installation

```bash
npm install @safari-automation/unified-client
```

## Quick Start

```typescript
import { SocialAutomationClient } from '@safari-automation/unified-client';

const client = new SocialAutomationClient({
  safariApiUrl: 'http://localhost:3100',
});

// Send DM to any platform
await client.sendDM('instagram', 'username', 'Hello from Instagram!');
await client.sendDM('twitter', 'username', 'Hello from Twitter!');

// Get unified status
const status = await client.getAllStatus();
console.log('Instagram logged in:', status.instagram?.isLoggedIn);
console.log('Twitter logged in:', status.twitter?.isLoggedIn);

// Get combined rate limits
const limits = await client.getAllRateLimits();
console.log('Total messages today:', limits.combined.totalToday);
```

## API

### Constructor

```typescript
const client = new SocialAutomationClient({
  safariApiUrl: 'http://localhost:3100',  // Base Safari API URL
  instagramPort: 3100,                     // Optional: Instagram API port
  twitterPort: 3101,                       // Optional: Twitter API port
  timeout: 30000,                          // Optional: Request timeout
});
```

### Methods

#### `healthCheck()`
Check if platform APIs are responding.

```typescript
const health = await client.healthCheck();
// { instagram: true, twitter: true }
```

#### `getAllStatus()`
Get login status for all platforms.

```typescript
const status = await client.getAllStatus();
// {
//   instagram: { isOnPlatform: true, isLoggedIn: true, currentUrl: '...' },
//   twitter: { isOnPlatform: true, isLoggedIn: true, currentUrl: '...' }
// }
```

#### `getAllRateLimits()`
Get rate limit info for all platforms.

```typescript
const limits = await client.getAllRateLimits();
// {
//   instagram: { messagesSentToday: 5, messagesSentThisHour: 2, maxPerHour: 10, maxPerDay: 30, isActive: true },
//   twitter: { messagesSentToday: 8, messagesSentThisHour: 3, maxPerHour: 15, maxPerDay: 100, isActive: true },
//   combined: { totalToday: 13, totalThisHour: 5 }
// }
```

#### `sendDM(platform, username, message)`
Send a DM on a specific platform.

```typescript
const result = await client.sendDM('twitter', 'elonmusk', 'Hello!');
// { success: true, platform: 'twitter', username: 'elonmusk' }
```

#### `getAllConversations()`
Get conversations from all platforms.

```typescript
const conversations = await client.getAllConversations();
// [
//   { platform: 'instagram', username: 'user1', lastMessage: '...' },
//   { platform: 'twitter', username: 'user2', lastMessage: '...' }
// ]
```

#### `getClient(platform)`
Get the underlying platform client for advanced operations.

```typescript
const igClient = client.getClient('instagram');
const messages = await igClient.readMessages(50);
```

## CRM Integration Example

```typescript
import { SocialAutomationClient } from '@safari-automation/unified-client';
import { createClient } from '@supabase/supabase-js';

const social = new SocialAutomationClient({ safariApiUrl: 'http://localhost:3100' });
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function sendOutreachCampaign(contacts: Contact[]) {
  const limits = await social.getAllRateLimits();
  
  for (const contact of contacts) {
    // Check rate limits
    const platformLimits = limits[contact.platform];
    if (!platformLimits?.isActive) {
      console.log(`Skipping ${contact.username} - outside active hours`);
      continue;
    }
    
    if (platformLimits.messagesSentThisHour >= platformLimits.maxPerHour) {
      console.log('Hourly limit reached, stopping');
      break;
    }
    
    // Send message
    const result = await social.sendDM(
      contact.platform,
      contact.username,
      contact.message
    );
    
    // Log to database
    await supabase.from('outreach_log').insert({
      contact_id: contact.id,
      platform: contact.platform,
      success: result.success,
      error: result.error,
      sent_at: new Date().toISOString(),
    });
    
    // Random delay between messages
    await sleep(randomDelay(60000, 180000));
  }
}
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    SocialAutomationClient                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────────┐    ┌─────────────────────┐            │
│  │  InstagramDMClient  │    │   TwitterDMClient   │            │
│  │  (port 3100)        │    │   (port 3101)       │            │
│  └──────────┬──────────┘    └──────────┬──────────┘            │
│             │                          │                        │
│             ▼                          ▼                        │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              Safari Automation Server                    │   │
│  │              (macOS with Safari)                         │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `SAFARI_API_URL` | Base Safari automation API URL | `http://localhost:3100` |
| `INSTAGRAM_DM_PORT` | Instagram DM API port | 3100 |
| `TWITTER_DM_PORT` | Twitter DM API port | 3101 |
