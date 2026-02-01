# @safari-automation/tiktok-dm

TikTok DM automation module using Safari browser automation. Designed to be called from a CRM server or used directly on macOS.

**API Port:** 3102 (default)  
**Status:** ✅ Verified Working (Jan 31, 2026)

## Installation

```bash
npm install @safari-automation/tiktok-dm
```

## Verification

Run the verification script to test all API endpoints:
```bash
npx tsx scripts/tiktok-verify.ts
```

## Quick Start

### Direct Automation (macOS)

```typescript
import { 
  SafariDriver, 
  navigateToInbox, 
  listConversations, 
  sendDMByUsername 
} from '@safari-automation/tiktok-dm';

// Create driver
const driver = new SafariDriver({ verbose: true });

// Navigate to inbox
await navigateToInbox(driver);

// List conversations
const conversations = await listConversations(driver);
console.log(conversations);

// Send DM via profile
await sendDMByUsername('creator123', 'Love your content!', driver);
```

### Via REST API (from any server)

**Start the API server on macOS:**
```bash
npx tsx packages/tiktok-dm/src/api/server.ts
# or
npm run start:server
```

**Call from your CRM server:**
```typescript
import { createTikTokDMClient } from '@safari-automation/tiktok-dm';

const client = createTikTokDMClient('http://mac-server:3102');

// Check status
const status = await client.getStatus();
console.log(status.data?.isLoggedIn);

// Send message
const result = await client.sendMessageTo('creator123', 'Love your content!');
console.log(result.success);

// List conversations
const convos = await client.listConversations();
console.log(convos.data?.conversations);
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| GET | `/api/tiktok/status` | TikTok login status |
| GET | `/api/tiktok/rate-limits` | Rate limit status |
| PUT | `/api/tiktok/rate-limits` | Update rate limits |
| GET | `/api/tiktok/conversations` | List conversations |
| POST | `/api/tiktok/inbox/navigate` | Navigate to inbox |
| POST | `/api/tiktok/conversations/open` | Open conversation |
| POST | `/api/tiktok/conversations/new` | Start new conversation |
| POST | `/api/tiktok/conversations/scroll` | Scroll to load more |
| GET | `/api/tiktok/messages` | Read messages |
| POST | `/api/tiktok/messages/send` | Send message |
| POST | `/api/tiktok/messages/send-to` | Send to user (via profile) |
| POST | `/api/tiktok/messages/send-to-url` | Send via profile URL |

## Rate Limiting

Built-in rate limiting to avoid detection:

| Limit | Default |
|-------|---------|
| Messages per hour | 10 |
| Messages per day | 50 |
| Min delay between | 2min |
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
tiktok-dm/
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
import { sendDMByUsername } from '@safari-automation/tiktok-dm';

// Navigate to profile -> click DM button -> send message
const result = await sendDMByUsername('creator123', 'Great content!', driver);
if (result.success) {
  console.log('Message sent!');
} else {
  console.error('Failed:', result.error);
}
```

### Error Handling

The profile-to-DM flow handles various states:
- `User not found` - Account doesn't exist
- `Cannot message this user` - DMs disabled or need to follow
- `Could not find message button` - UI changed or not available
- `DM composer did not open` - UI timing issue

## TikTok-Specific Notes

### Selectors
TikTok uses `data-e2e` attributes which are relatively stable:

| Element | Selector |
|---------|----------|
| Messages Icon | `[data-e2e="message-icon"]` |
| Message Input | `[data-e2e="message-input"]` |
| Send Button | `[data-e2e="send-message-btn"]` |
| Conversation List | `[class*="DivConversationListContainer"]` |

### Challenges
1. **Dynamic class names** - Use `data-e2e` or `[class*="Pattern"]`
2. **Contenteditable divs** - Use `document.execCommand` for typing
3. **Virtual scrolling** - Check element visibility with `getBoundingClientRect`
4. **Rate limiting** - TikTok is aggressive; use conservative limits

## CRM Integration

```typescript
import { createTikTokDMClient } from '@safari-automation/tiktok-dm';

const dm = createTikTokDMClient(process.env.TIKTOK_DM_API_URL);

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

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` or `TIKTOK_DM_PORT` | API server port | 3102 |
| `VERBOSE` | Enable verbose logging | false |
| `CRM_RATE_MESSAGES_PER_HOUR` | Hourly limit | 10 |
| `CRM_RATE_MESSAGES_PER_DAY` | Daily limit | 50 |
| `CRM_RATE_MIN_DELAY_MS` | Min delay | 120000 |
| `CRM_RATE_MAX_DELAY_MS` | Max delay | 300000 |
| `CRM_ACTIVE_HOURS_START` | Start hour | 9 |
| `CRM_ACTIVE_HOURS_END` | End hour | 21 |

## Safety Notes

- Always test with a test account first
- TikTok is aggressive with rate limits - start very conservative
- Monitor for shadowbans or restrictions
- Use human-like delays and personalization
- Respect TikTok's terms of service
- Never spam or harass users
