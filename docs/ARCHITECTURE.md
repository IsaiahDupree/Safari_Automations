# Inter-Server Communication Architecture

## Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         LOCAL NETWORK                                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────────┐     ┌──────────────────┐     ┌─────────────┐ │
│  │  Safari Auto     │     │  CRM Server      │     │ MediaPoster │ │
│  │  (Mac)           │◄───►│  (Node.js)       │◄───►│ (Supabase)  │ │
│  │  Port: 3100      │     │  Port: 3200      │     │             │ │
│  └──────────────────┘     └──────────────────┘     └─────────────┘ │
│         │                        │                        │         │
│         │                        │                        │         │
│         ▼                        ▼                        ▼         │
│  ┌──────────────────┐     ┌──────────────────┐     ┌─────────────┐ │
│  │ Instagram DM     │     │ CRM Database     │     │ Content DB  │ │
│  │ - Send/Read      │     │ - Contacts       │     │ - Videos    │ │
│  │ - List Convos    │     │ - Messages       │     │ - Schedule  │ │
│  │ - Automation     │     │ - Scores         │     │ - Posts     │ │
│  └──────────────────┘     └──────────────────┘     └─────────────┘ │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

## Servers

### 1. Safari Automation Server (Port 3100)
- **Location**: Mac with Safari
- **Purpose**: Instagram DM automation
- **API**: REST endpoints for DM operations
- **Already built**: `packages/instagram-dm/src/api/server.ts`

### 2. CRM Server (Port 3200)
- **Location**: Any machine (can be same Mac)
- **Purpose**: Central coordination, business logic
- **Connects to**:
  - Safari Automation API (for DM actions)
  - CRM Database (for contact/message data)
  - MediaPoster Database (for content sync)

### 3. MediaPoster Database
- **Type**: Supabase
- **Contains**: Videos, content schedule, posting history
- **Integration**: CRM can query for content to share in DMs

## Data Flow

### Sending a DM with Content
```
1. CRM Server receives request: "Send video to @user"
2. CRM Server queries MediaPoster DB for video details
3. CRM Server calls Safari Automation: POST /api/messages/send-to
4. Safari Automation executes in Safari
5. CRM Server logs message to CRM Database
6. CRM Server updates relationship score
```

### Syncing DM Data
```
1. CRM Server calls Safari Automation: GET /api/conversations/all
2. Safari Automation reads from Instagram
3. CRM Server receives conversation data
4. CRM Server upserts to CRM Database
5. CRM Server runs scoring engine
6. CRM Server triggers webhooks if configured
```

### Content-to-DM Pipeline
```
1. MediaPoster schedules video post
2. CRM Server receives webhook: "video_posted"
3. CRM Server queries contacts interested in topic
4. CRM Server queues personalized DM outreach
5. Safari Automation sends DMs (rate-limited)
```

## API Endpoints

### CRM Server (Port 3200)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/contacts` | GET | List contacts with scores |
| `/api/contacts/:id` | GET | Get contact details |
| `/api/contacts/:id/score` | POST | Recalculate score |
| `/api/contacts/:id/dm` | POST | Send DM via Safari |
| `/api/conversations/sync` | POST | Sync from Instagram |
| `/api/coaching/analyze` | POST | Analyze conversation |
| `/api/copilot/suggest` | POST | Get reply suggestions |
| `/api/outreach/queue` | POST | Queue outreach message |
| `/api/outreach/process` | POST | Process next in queue |
| `/api/mediaposter/videos` | GET | List videos from MP |
| `/api/mediaposter/schedule` | GET | Get posting schedule |
| `/api/webhooks` | POST | Register webhook |

## Configuration

```env
# CRM Server
CRM_SERVER_PORT=3200

# Safari Automation connection
SAFARI_API_URL=http://localhost:3100

# CRM Database (Supabase)
CRM_SUPABASE_URL=https://crm-project.supabase.co
CRM_SUPABASE_KEY=your-key

# MediaPoster Database (Supabase)
MEDIAPOSTER_SUPABASE_URL=https://mp-project.supabase.co
MEDIAPOSTER_SUPABASE_KEY=your-key

# Webhooks
WEBHOOK_SECRET=your-secret
```

## Webhooks

### Registering a Webhook

```bash
curl -X POST http://localhost:3200/api/webhooks \
  -H "Content-Type: application/json" \
  -d '{
    "url": "http://your-server/webhook",
    "events": ["message.sent", "contact.score_changed"],
    "secret": "your-secret-key"
  }'
```

### Available Events

| Event | Description |
|-------|-------------|
| `contact.created` | New contact added |
| `contact.updated` | Contact info changed |
| `contact.score_changed` | Relationship score updated |
| `message.sent` | DM sent successfully |
| `message.received` | DM received |
| `message.failed` | DM send failed |
| `sync.completed` | Instagram sync finished |
| `outreach.queued` | Message added to queue |
| `outreach.sent` | Queued message sent |
| `mediaposter.video_posted` | Video posted to platform |
| `mediaposter.schedule_updated` | Schedule changed |

### Webhook Payload

```json
{
  "event": "message.sent",
  "timestamp": "2024-01-15T14:30:00.000Z",
  "data": {
    "username": "johndoe",
    "text": "Hello!",
    "automated": true
  }
}
```

### Verifying Signatures

```typescript
import crypto from 'crypto';

function verifyWebhook(payload: string, signature: string, secret: string): boolean {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
  return signature === expected;
}
```

### Incoming Webhooks from MediaPoster

MediaPoster can notify CRM of events:

```bash
# MediaPoster calls this when a video is posted
curl -X POST http://localhost:3200/api/incoming/mediaposter \
  -H "Content-Type: application/json" \
  -d '{
    "event": "video.posted",
    "data": {
      "video_id": "abc123",
      "platform": "instagram",
      "title": "New video"
    }
  }'
```

## MediaPoster Integration

### Local Supabase Connection

MediaPoster runs on local Supabase:

| Setting | Value |
|---------|-------|
| API URL | `http://127.0.0.1:54321` |
| Studio | `http://127.0.0.1:54323` |
| Database | `postgresql://postgres:postgres@127.0.0.1:54322/postgres` |

Get keys:
```bash
cd /Users/isaiahdupree/Documents/Software/MediaPoster && supabase status
```

### Syncing Content to DMs

```
1. MediaPoster posts video → sends webhook to CRM
2. CRM receives webhook at /api/incoming/mediaposter
3. CRM queries contacts interested in topic
4. CRM queues personalized DM outreach
5. Safari Automation sends DMs (rate-limited)
```

## Security

1. **Internal network only** - Services communicate on localhost/LAN
2. **API keys** - Each service requires authentication
3. **Rate limiting** - Instagram operations are throttled
4. **Webhook signatures** - HMAC verification for external calls
