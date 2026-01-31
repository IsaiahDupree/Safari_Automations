# API Reference

## Instagram DM API

Base URL: `http://localhost:3100`

### Health & Status

#### GET /health
Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-01-15T14:30:00.000Z",
  "rateLimits": {
    "messagesSentToday": 5,
    "messagesSentThisHour": 2,
    "limits": { ... }
  }
}
```

#### GET /api/status
Check Instagram login status.

**Response:**
```json
{
  "isOnInstagram": true,
  "isLoggedIn": true,
  "currentUrl": "https://www.instagram.com/direct/inbox/",
  "driverConfig": { ... }
}
```

#### GET /api/rate-limits
Get current rate limit status.

**Response:**
```json
{
  "messagesSentToday": 5,
  "messagesSentThisHour": 2,
  "limits": {
    "messagesPerHour": 10,
    "messagesPerDay": 30,
    "minDelayMs": 60000,
    "maxDelayMs": 300000,
    "activeHoursStart": 9,
    "activeHoursEnd": 21
  },
  "activeHours": {
    "start": 9,
    "end": 21,
    "currentHour": 14,
    "isActive": true
  }
}
```

#### PUT /api/rate-limits
Update rate limits.

**Request:**
```json
{
  "messagesPerHour": 15,
  "messagesPerDay": 40
}
```

---

### Navigation

#### POST /api/inbox/navigate
Navigate to Instagram DM inbox.

**Response:**
```json
{
  "success": true,
  "currentUrl": "https://www.instagram.com/direct/inbox/"
}
```

#### POST /api/inbox/tab
Switch DM tab.

**Request:**
```json
{
  "tab": "primary" | "general" | "requests" | "hidden_requests"
}
```

**Response:**
```json
{
  "success": true,
  "tab": "general"
}
```

---

### Conversations

#### GET /api/conversations
List conversations from current view.

**Response:**
```json
{
  "conversations": [
    {
      "username": "johndoe",
      "lastMessage": "Hey, how's it going?"
    }
  ],
  "count": 15
}
```

#### GET /api/conversations/all
Get conversations from all tabs.

**Response:**
```json
{
  "conversations": {
    "primary": [...],
    "general": [...],
    "requests": [...],
    "hidden_requests": [...]
  },
  "totalCount": 45
}
```

#### POST /api/conversations/open
Open a conversation by username.

**Request:**
```json
{
  "username": "johndoe"
}
```

**Response:**
```json
{
  "success": true,
  "username": "johndoe"
}
```

#### POST /api/conversations/new
Start a new conversation.

**Request:**
```json
{
  "username": "johndoe"
}
```

---

### Messages

#### GET /api/messages
Read messages from current conversation.

**Query Parameters:**
- `limit` (optional): Number of messages (default: 20)

**Response:**
```json
{
  "messages": [
    {
      "text": "Hello!",
      "isOutbound": false,
      "messageType": "text"
    }
  ],
  "count": 10
}
```

#### POST /api/messages/send
Send message to current conversation. Rate limited.

**Request:**
```json
{
  "text": "Hello, how are you?"
}
```

**Response:**
```json
{
  "success": true,
  "rateLimits": {
    "messagesSentToday": 6,
    "messagesSentThisHour": 3
  }
}
```

#### POST /api/messages/send-to
Send message to a specific user. Rate limited.

**Request:**
```json
{
  "username": "johndoe",
  "text": "Hello, how are you?"
}
```

**Response:**
```json
{
  "success": true,
  "username": "johndoe",
  "rateLimits": {
    "messagesSentToday": 7,
    "messagesSentThisHour": 4
  }
}
```

---

### Advanced

#### POST /api/execute
Execute raw JavaScript in Safari.

**Request:**
```json
{
  "script": "document.title"
}
```

**Response:**
```json
{
  "output": "Instagram"
}
```

#### PUT /api/config
Update driver configuration.

**Request:**
```json
{
  "verbose": true,
  "timeout": 60000
}
```

---

## CRM Core Functions

### Scoring Engine

```typescript
import { calculateRelationshipScore } from './packages/crm-core/src';

const result = calculateRelationshipScore({
  contact: Contact,
  messages?: Message[],
  valueDeliveredCount?: number,
  promisesKept?: number,
  promisesMade?: number,
});

// Result:
{
  overall: number;      // 0-100
  recency: number;      // 0-100
  resonance: number;    // 0-100
  needClarity: number;  // 0-100
  valueDelivered: number;
  reliability: number;
  consent: number;
}
```

### Coaching Engine

```typescript
import { analyzeConversation, getDefaultCoachingRules } from './packages/crm-core/src';

const result = analyzeConversation({
  messages: Message[],
  rules?: CoachingRule[],  // defaults provided
});

// Result:
{
  overallScore: number;
  curiosityScore: number;
  valueScore: number;
  permissionScore: number;
  personalizationScore: number;
  pacingScore: number;
  strengths: string[];
  improvements: string[];
  nextActionSuggestion: string;
}
```

### Copilot Engine

```typescript
import { generateReplySuggestions, getDefaultTemplates } from './packages/crm-core/src';

const suggestions = generateReplySuggestions({
  contact: Contact,
  messages: Message[],
  templates?: ActionTemplate[],  // defaults provided
  fitConfigs?: FitSignalConfig[],
});

// Result:
[
  {
    type: 'friendship' | 'service' | 'offer' | 'retention' | 'rewarm';
    template: string;
    personalized: string;
    reason: string;
    priority: number;
  }
]
```

---

## TypeScript Types

### Contact
```typescript
interface Contact {
  id: string;
  instagram_username: string;
  display_name?: string;
  relationship_score: number;
  pipeline_stage: PipelineStage;
  what_theyre_building?: string;
  current_friction?: string;
  their_definition_of_win?: string;
  asks_opinion: boolean;
  shares_updates: boolean;
  has_referred_others: boolean;
  fit_signals: string[];
  total_messages_sent: number;
  total_messages_received: number;
  last_message_at?: string;
}
```

### Message
```typescript
interface Message {
  id: string;
  conversation_id: string;
  contact_id: string;
  message_text: string;
  message_type: 'text' | 'image' | 'video' | 'audio' | 'story_reply' | 'link';
  is_outbound: boolean;
  sent_by_automation: boolean;
  sent_at: string;
}
```

### PipelineStage
```typescript
type PipelineStage = 
  | 'first_touch'
  | 'curiosity_exchange'
  | 'value_given'
  | 'fit_revealed'
  | 'fit_repeats'
  | 'active_opportunity'
  | 'post_win_expansion';
```

### ActionLane
```typescript
type ActionLane = 
  | 'friendship'
  | 'service'
  | 'offer'
  | 'retention'
  | 'rewarm';
```
