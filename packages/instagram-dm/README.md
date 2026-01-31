# @safari-automation/instagram-dm

Instagram DM automation module using Safari browser automation. Designed to be called from a CRM server or used directly on macOS.

## Installation

```bash
npm install @safari-automation/instagram-dm
```

## Quick Start

### Direct Automation (macOS)

```typescript
import { 
  SafariDriver, 
  navigateToInbox, 
  listConversations, 
  openConversation, 
  sendMessage 
} from '@safari-automation/instagram-dm';

// Create driver
const driver = new SafariDriver({ verbose: true });

// Navigate to inbox
await navigateToInbox(driver);

// List conversations
const conversations = await listConversations(driver);
console.log(conversations);

// Open and send message
await openConversation('username', driver);
await sendMessage('Hello!', driver);
```

### Via REST API (from any server)

**Start the API server on macOS:**
```bash
npx tsx packages/instagram-dm/src/api/server.ts
# or
npm run start:server
```

**Call from your CRM server:**
```typescript
import { createDMClient } from '@safari-automation/instagram-dm';

const client = createDMClient('http://mac-server:3100');

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
| GET | `/api/status` | Instagram login status |
| GET | `/api/rate-limits` | Rate limit status |
| PUT | `/api/rate-limits` | Update rate limits |
| GET | `/api/conversations` | List conversations |
| GET | `/api/conversations/all` | All tabs |
| POST | `/api/inbox/navigate` | Navigate to inbox |
| POST | `/api/inbox/tab` | Switch tab |
| POST | `/api/conversations/open` | Open conversation |
| POST | `/api/conversations/new` | Start new conversation |
| GET | `/api/messages` | Read messages |
| POST | `/api/messages/send` | Send message |
| POST | `/api/messages/send-to` | Send to user |

## Rate Limiting

Built-in rate limiting to avoid detection:

| Limit | Default |
|-------|---------|
| Messages per hour | 10 |
| Messages per day | 30 |
| Min delay between | 60s |
| Max delay between | 5min |
| Active hours | 9 AM - 9 PM |

Configure via environment or API:

```bash
export CRM_RATE_MESSAGES_PER_HOUR=15
export CRM_RATE_MESSAGES_PER_DAY=40
export CRM_ACTIVE_HOURS_START=8
export CRM_ACTIVE_HOURS_END=22
```

## Architecture

```
instagram-dm/
├── src/
│   ├── automation/
│   │   ├── types.ts          # TypeScript interfaces
│   │   ├── safari-driver.ts  # Safari/AppleScript wrapper
│   │   └── dm-operations.ts  # High-level DM functions
│   ├── api/
│   │   ├── server.ts         # Express REST API
│   │   └── client.ts         # API client library
│   ├── utils/                # Helpers
│   └── index.ts              # Main exports
└── tests/
```

## CRM Integration

### From Your CRM Server

```typescript
// In your CRM server (Node.js, Deno, etc.)
import { createDMClient } from '@safari-automation/instagram-dm';

const dm = createDMClient(process.env.DM_API_URL);

// Send outreach message
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
import { createDMClient } from '@safari-automation/instagram-dm';
import { 
  generateReplySuggestions, 
  getDefaultTemplates,
  getCRMClient 
} from '@safari-automation/crm-core';

const dm = createDMClient('http://localhost:3100');
const supabase = getCRMClient();

async function smartOutreach(contactId: string) {
  // Get contact from CRM
  const { data: contact } = await supabase
    .from('instagram_contacts')
    .select('*')
    .eq('id', contactId)
    .single();
  
  // Generate personalized message
  const suggestions = generateReplySuggestions({
    contact,
    messages: [],
    templates: getDefaultTemplates(),
  });
  
  const message = suggestions[0]?.personalized;
  
  // Send via DM API
  return dm.sendMessageTo(contact.instagram_username, message);
}
```

## Local vs Remote Safari

### Local (default)
Runs on the same Mac where Safari is open.

```typescript
const driver = new SafariDriver({ instanceType: 'local' });
```

### Remote
Calls a Safari automation server on another machine.

```typescript
const driver = new SafariDriver({ 
  instanceType: 'remote',
  remoteUrl: 'http://mac-mini.local:3100'
});
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | API server port | 3100 |
| `VERBOSE` | Enable verbose logging | false |
| `CRM_RATE_MESSAGES_PER_HOUR` | Hourly limit | 10 |
| `CRM_RATE_MESSAGES_PER_DAY` | Daily limit | 30 |
| `CRM_RATE_MIN_DELAY_MS` | Min delay | 60000 |
| `CRM_RATE_MAX_DELAY_MS` | Max delay | 300000 |
| `CRM_ACTIVE_HOURS_START` | Start hour | 9 |
| `CRM_ACTIVE_HOURS_END` | End hour | 21 |

## Safety Notes

- Always test with `--dry-run` first
- Monitor rate limits to avoid account flags
- Use human-like delays and personalization
- Respect Instagram's terms of service
