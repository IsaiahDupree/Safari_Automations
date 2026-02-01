# @safari-automation/twitter-dm

Twitter/X DM automation module using Safari browser automation. Designed to be called from a CRM server or used directly on macOS.

## Installation

```bash
npm install @safari-automation/twitter-dm
```

## Quick Start

### Direct Automation (macOS)

```typescript
import { 
  SafariDriver, 
  navigateToInbox, 
  listConversations, 
  sendDMByUsername 
} from '@safari-automation/twitter-dm';

// Create driver
const driver = new SafariDriver({ verbose: true });

// Navigate to inbox
await navigateToInbox(driver);

// List conversations
const conversations = await listConversations(driver);
console.log(conversations);

// Send DM via profile
await sendDMByUsername('username', 'Hello!', driver);
```

### Via REST API (from any server)

**Start the API server on macOS:**
```bash
npx tsx packages/twitter-dm/src/api/server.ts
# or
npm run start:server
```

**Call from your CRM server:**
```typescript
import { createTwitterDMClient } from '@safari-automation/twitter-dm';

const client = createTwitterDMClient('http://mac-server:3101');

// Check status
const status = await client.getStatus();
console.log(status.data?.isLoggedIn);

// Send message
const result = await client.sendMessageTo('username', 'Hello!');
console.log(result.success);

// List conversations
const convos = await client.listConversations();
console.log(convos.data?.conversations);
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| GET | `/api/twitter/status` | Twitter login status |
| GET | `/api/twitter/rate-limits` | Rate limit status |
| PUT | `/api/twitter/rate-limits` | Update rate limits |
| GET | `/api/twitter/conversations` | List conversations |
| GET | `/api/twitter/conversations/all` | All tabs |
| GET | `/api/twitter/conversations/unread` | Unread conversations |
| POST | `/api/twitter/inbox/navigate` | Navigate to inbox |
| POST | `/api/twitter/inbox/tab` | Switch tab |
| POST | `/api/twitter/conversations/open` | Open conversation |
| POST | `/api/twitter/conversations/new` | Start new conversation |
| POST | `/api/twitter/conversations/scroll` | Scroll to load more |
| GET | `/api/twitter/messages` | Read messages |
| POST | `/api/twitter/messages/send` | Send message |
| POST | `/api/twitter/messages/send-to` | Send to user (via profile) |
| POST | `/api/twitter/messages/send-to-url` | Send via profile URL |

## Rate Limiting

Built-in rate limiting to avoid detection:

| Limit | Default |
|-------|---------|
| Messages per hour | 15 |
| Messages per day | 100 |
| Min delay between | 90s |
| Max delay between | 4min |
| Active hours | 9 AM - 9 PM |

Configure via environment or API:

```bash
export CRM_RATE_MESSAGES_PER_HOUR=20
export CRM_RATE_MESSAGES_PER_DAY=80
export CRM_ACTIVE_HOURS_START=8
export CRM_ACTIVE_HOURS_END=22
```

## Architecture

```
twitter-dm/
├── src/
│   ├── automation/
│   │   ├── types.ts          # TypeScript interfaces + selectors
│   │   ├── safari-driver.ts  # Safari/AppleScript wrapper
│   │   └── dm-operations.ts  # High-level DM functions
│   ├── api/
│   │   ├── server.ts         # Express REST API
│   │   └── client.ts         # API client library
│   ├── utils/                # Helpers
│   └── index.ts              # Main exports
└── tests/
```

## Key Functions

### Profile-to-DM Flow

```typescript
import { sendDMByUsername } from '@safari-automation/twitter-dm';

// Navigate to profile -> click DM button -> send message
const result = await sendDMByUsername('elonmusk', 'Hello!');
if (result.success) {
  console.log('Message sent!');
} else {
  console.error('Failed:', result.error);
}
```

### Error Handling

The profile-to-DM flow handles various states:
- `User not found` - Account doesn't exist
- `Account suspended` - Account is suspended
- `Account is protected` - Private account
- `Could not find Message button` - DMs disabled for this user
- `DM composer did not open` - UI timing issue

## CRM Integration

### From Your CRM Server

```typescript
import { createTwitterDMClient } from '@safari-automation/twitter-dm';

const dm = createTwitterDMClient(process.env.TWITTER_DM_API_URL);

async function sendOutreach(username: string, message: string) {
  // Check rate limits first
  const limits = await dm.getRateLimits();
  if (!limits.data?.activeHours.isActive) {
    console.log('Outside active hours, queuing for later');
    return;
  }
  
  // Send message
  const result = await dm.sendMessageTo(username, message);
  
  if (result.success) {
    // Log to CRM database
    await logMessage(username, message, result.data?.rateLimits);
  }
  
  return result;
}
```

### With crm-core Package

```typescript
import { createTwitterDMClient } from '@safari-automation/twitter-dm';
import { 
  generateReplySuggestions, 
  getDefaultTemplates,
  getCRMClient 
} from '@safari-automation/crm-core';

const dm = createTwitterDMClient('http://localhost:3101');
const supabase = getCRMClient();

async function smartOutreach(contactId: string) {
  const { data: contact } = await supabase
    .from('twitter_contacts')
    .select('*')
    .eq('id', contactId)
    .single();
  
  const suggestions = generateReplySuggestions({
    contact,
    messages: [],
    templates: getDefaultTemplates(),
  });
  
  const message = suggestions[0]?.personalized;
  
  return dm.sendMessageTo(contact.twitter_username, message);
}
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` or `TWITTER_DM_PORT` | API server port | 3101 |
| `VERBOSE` | Enable verbose logging | false |
| `CRM_RATE_MESSAGES_PER_HOUR` | Hourly limit | 15 |
| `CRM_RATE_MESSAGES_PER_DAY` | Daily limit | 100 |
| `CRM_RATE_MIN_DELAY_MS` | Min delay | 90000 |
| `CRM_RATE_MAX_DELAY_MS` | Max delay | 240000 |
| `CRM_ACTIVE_HOURS_START` | Start hour | 9 |
| `CRM_ACTIVE_HOURS_END` | End hour | 21 |

## Twitter/X Selectors

Key selectors used (from `TWITTER_SELECTORS`):

| Selector | Description |
|----------|-------------|
| `[data-testid="sendDMFromProfile"]` | DM button on profile |
| `[data-testid="dm-composer-textarea"]` | Message input |
| `[data-testid="dm-composer-send-button"]` | Send button |
| `[data-testid="conversation"]` | Conversation item |
| `[data-testid="messageEntry"]` | Message bubble |

## Safety Notes

- Always test with a test account first
- Monitor rate limits to avoid account flags
- Use human-like delays and personalization
- Respect Twitter's terms of service
- Never spam or harass users
