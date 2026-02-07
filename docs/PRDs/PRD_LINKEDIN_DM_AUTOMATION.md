# PRD: LinkedIn DM Automation System
**Date:** February 5, 2026  
**Status:** 📋 PLANNED  
**Priority:** High  
**Platform:** LinkedIn (linkedin.com)

---

## Overview

Safari-based automation for LinkedIn to enable professional networking, connection management, and direct messaging. Uses the existing Safari automation framework to interact with LinkedIn's web interface while respecting platform limits and professional etiquette.

---

## Goals

1. **Automate connection requests** - Send personalized connection requests with notes
2. **Manage DM conversations** - Read, send, and organize LinkedIn messages
3. **Track networking pipeline** - Monitor connection acceptance rates and conversations
4. **AI-assisted messaging** - Generate professional, context-aware messages
5. **Lead qualification** - Score prospects based on profile data

---

## Challenges & Risks

### Platform-Specific Challenges
| Challenge | Severity | Mitigation |
|-----------|----------|------------|
| Strong anti-automation detection | High | Slow rate limits, human-like delays |
| Complex authentication (2FA) | High | Session persistence, manual login fallback |
| Dynamic class names | Medium | Data-testid selectors, text matching |
| Connection vs InMail distinction | Medium | Detect connection status first |
| Weekly connection limits (~100) | High | Track and respect limits |
| Premium vs Free feature differences | Medium | Detect account type |

### Account Risk
- LinkedIn actively monitors for automation
- Account restrictions can be permanent
- Must prioritize conservative rate limiting

---

## Features

### Phase 1: Navigation & Status

#### 1.1 Login & Session Management
```typescript
interface LinkedInSession {
  isLoggedIn: boolean;
  accountType: 'free' | 'premium' | 'sales_navigator';
  profileUrl: string;
  connectionCount: number;
  pendingInvitations: number;
  weeklyInvitesRemaining: number;
}
```

#### 1.2 Navigation Functions
```typescript
interface NavigationResult {
  success: boolean;
  currentUrl: string;
  error?: string;
}

// Core navigation
navigateToMessaging(): Promise<NavigationResult>
navigateToMyNetwork(): Promise<NavigationResult>
navigateToProfile(username: string): Promise<NavigationResult>
navigateToConnectionRequests(): Promise<NavigationResult>
```

### Phase 2: Connection Management

#### 2.1 Connection Request
```typescript
interface ConnectionRequest {
  profileUrl: string;
  note?: string;           // Max 300 chars for free, optional
  skipIfConnected: boolean;
  skipIfPending: boolean;
}

interface ConnectionResult {
  success: boolean;
  status: 'sent' | 'already_connected' | 'pending' | 'cannot_connect' | 'error';
  reason?: string;
}
```

#### 2.2 Connection Status Detection
```typescript
interface ConnectionStatus {
  profileUrl: string;
  status: 'connected' | 'pending_sent' | 'pending_received' | 'not_connected' | 'following';
  canMessage: boolean;
  canConnect: boolean;
  requiresInMail: boolean;
}
```

#### 2.3 Pending Requests Management
```typescript
interface PendingRequest {
  profileUrl: string;
  name: string;
  headline: string;
  mutualConnections: number;
  sentAt?: Date;
  receivedAt?: Date;
  type: 'sent' | 'received';
}

// Functions
listPendingRequests(type: 'sent' | 'received'): Promise<PendingRequest[]>
withdrawRequest(profileUrl: string): Promise<boolean>
acceptRequest(profileUrl: string): Promise<boolean>
ignoreRequest(profileUrl: string): Promise<boolean>
```

### Phase 3: Direct Messaging

#### 3.1 Conversation Types
```typescript
interface LinkedInConversation {
  conversationId: string;
  participants: {
    profileUrl: string;
    name: string;
    headline: string;
  }[];
  lastMessage: string;
  lastMessageAt: Date;
  unread: boolean;
  isGroup: boolean;
  isInMail: boolean;
}
```

#### 3.2 Message Operations
```typescript
interface LinkedInMessage {
  id: string;
  conversationId: string;
  sender: string;
  content: string;
  timestamp: Date;
  isOutbound: boolean;
  attachments?: string[];
}

// Functions
listConversations(filter?: 'all' | 'unread' | 'archived'): Promise<LinkedInConversation[]>
openConversation(conversationId: string): Promise<boolean>
readMessages(limit?: number): Promise<LinkedInMessage[]>
sendMessage(text: string): Promise<SendMessageResult>
sendMessageTo(profileUrl: string, text: string): Promise<SendMessageResult>
```

#### 3.3 InMail Handling
```typescript
interface InMailStatus {
  available: boolean;
  creditsRemaining: number;
  monthlyAllowance: number;
}

sendInMail(profileUrl: string, subject: string, body: string): Promise<SendMessageResult>
getInMailStatus(): Promise<InMailStatus>
```

### Phase 4: Profile Extraction

#### 4.1 Profile Data
```typescript
interface LinkedInProfile {
  profileUrl: string;
  name: string;
  headline: string;
  location: string;
  about?: string;
  currentPosition?: {
    title: string;
    company: string;
    duration: string;
  };
  connectionDegree: '1st' | '2nd' | '3rd' | 'out_of_network';
  mutualConnections: number;
  isOpenToWork: boolean;
  isHiring: boolean;
  skills: string[];
  endorsements: number;
}

extractProfile(profileUrl: string): Promise<LinkedInProfile>
```

#### 4.2 Lead Scoring
```typescript
interface LeadScore {
  profileUrl: string;
  totalScore: number;  // 0-100
  factors: {
    titleMatch: number;
    companyMatch: number;
    locationMatch: number;
    connectionProximity: number;
    activityLevel: number;
    openToConnect: number;
  };
  recommendation: 'high_priority' | 'medium' | 'low' | 'skip';
}
```

### Phase 5: AI-Assisted Messaging

#### 5.1 Message Generation
```typescript
interface MessageGenerationRequest {
  profile: LinkedInProfile;
  purpose: 'connection_note' | 'follow_up' | 'introduction' | 'inquiry' | 'thank_you';
  context?: string;
  tone: 'professional' | 'friendly' | 'formal';
  maxLength?: number;
}

interface GeneratedMessage {
  text: string;
  confidence: number;
  alternatives: string[];
}

generateMessage(request: MessageGenerationRequest): Promise<GeneratedMessage>
```

---

## API Endpoints

### Status
```
GET  /health
GET  /api/linkedin/status              - Login status, account type
GET  /api/linkedin/rate-limits         - Connection/message limits
```

### Navigation
```
POST /api/linkedin/navigate/messaging  - Go to messaging
POST /api/linkedin/navigate/network    - Go to my network
POST /api/linkedin/navigate/profile    - Go to a profile
```

### Connections
```
GET  /api/linkedin/connections/pending - List pending requests
POST /api/linkedin/connections/request - Send connection request
POST /api/linkedin/connections/accept  - Accept request
POST /api/linkedin/connections/withdraw - Withdraw sent request
GET  /api/linkedin/connections/status  - Check connection status
```

### Messages
```
GET  /api/linkedin/conversations       - List conversations
GET  /api/linkedin/messages            - Read messages in current convo
POST /api/linkedin/messages/send       - Send to current conversation
POST /api/linkedin/messages/send-to    - Send to specific profile
```

### Profiles
```
GET  /api/linkedin/profile/:username   - Extract profile data
POST /api/linkedin/profile/score       - Score a lead
```

### AI
```
POST /api/linkedin/ai/generate-message - Generate AI message
POST /api/linkedin/ai/generate-note    - Generate connection note
```

---

## Rate Limiting (Conservative)

```typescript
const LINKEDIN_RATE_LIMITS = {
  // Connections
  connectionRequestsPerDay: 20,        // Platform limit ~100/week
  connectionRequestsPerWeek: 80,       // Stay under 100
  
  // Messages
  messagesPerHour: 10,
  messagesPerDay: 50,
  
  // Navigation
  profileViewsPerHour: 30,
  searchesPerHour: 15,
  
  // Delays
  minDelayBetweenActions: 30000,       // 30 seconds minimum
  maxDelayBetweenActions: 120000,      // 2 minutes max
  
  // Active hours
  activeHoursStart: 8,                 // 8 AM (business hours)
  activeHoursEnd: 18,                  // 6 PM
};
```

---

## Selectors (Initial Research Needed)

```typescript
const LINKEDIN_SELECTORS = {
  // Login detection
  feedLoaded: '[data-test-id="feed-container"]',
  loginPrompt: '.login__form',
  
  // Navigation
  messagingNav: '[data-test-id="messaging-tab"]',
  networkNav: '[data-test-id="mynetwork-tab"]',
  
  // Messaging
  conversationList: '.msg-conversations-container__conversations-list',
  conversationItem: '.msg-conversation-listitem',
  messageInput: '.msg-form__contenteditable',
  sendButton: '.msg-form__send-button',
  
  // Connections
  connectButton: 'button[aria-label*="Connect"]',
  pendingButton: 'button[aria-label*="Pending"]',
  messageButton: 'button[aria-label*="Message"]',
  connectionNote: '#custom-message',
  
  // Profile
  profileName: '.pv-top-card--list li:first-child',
  profileHeadline: '.pv-top-card--list-bullet',
  profileAbout: '#about',
};
```

**Note:** LinkedIn frequently changes selectors. These need validation before implementation.

---

## Package Structure

```
packages/linkedin-dm/
├── src/
│   ├── api/
│   │   ├── server.ts           # REST API server
│   │   └── client.ts           # Client library
│   ├── automation/
│   │   ├── safari-driver.ts    # Safari automation core
│   │   ├── dm-operations.ts    # Message operations
│   │   ├── connection-ops.ts   # Connection management
│   │   └── profile-scraper.ts  # Profile extraction
│   ├── ai/
│   │   └── message-generator.ts
│   ├── utils/
│   │   ├── rate-limiter.ts
│   │   └── selectors.ts
│   └── types.ts
├── package.json
└── tsconfig.json
```

---

## Database Schema

```sql
-- LinkedIn contacts
CREATE TABLE linkedin_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_url TEXT UNIQUE NOT NULL,
  name TEXT,
  headline TEXT,
  company TEXT,
  location TEXT,
  connection_status TEXT,
  lead_score INTEGER,
  first_contacted_at TIMESTAMPTZ,
  last_contacted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Connection requests tracking
CREATE TABLE linkedin_connection_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID REFERENCES linkedin_contacts(id),
  direction TEXT NOT NULL,  -- 'sent' or 'received'
  note TEXT,
  status TEXT DEFAULT 'pending',
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  responded_at TIMESTAMPTZ
);

-- Message log
CREATE TABLE linkedin_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID REFERENCES linkedin_contacts(id),
  direction TEXT NOT NULL,
  content TEXT,
  sent_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Implementation Timeline

| Phase | Features | Effort | Priority |
|-------|----------|--------|----------|
| **Phase 1** | Navigation, login detection, status | 1 day | High |
| **Phase 2** | Connection requests, pending management | 2 days | High |
| **Phase 3** | DM reading and sending | 2 days | High |
| **Phase 4** | Profile extraction, lead scoring | 1 day | Medium |
| **Phase 5** | AI message generation | 1 day | Medium |

**Total Estimated Effort:** 7-8 days

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Connection acceptance rate | >30% |
| Message response rate | >25% |
| Account safety (no restrictions) | 100% |
| Time saved per outreach | 5 min |

---

## Dependencies

- Safari automation framework (existing)
- OpenAI API for AI features
- Supabase for data storage
- unified-client integration

---

**Created:** February 5, 2026  
**Status:** Ready for development
