# PRD: Threads DM Automation System
**Date:** February 5, 2026  
**Status:** 📋 PLANNED  
**Priority:** Medium  
**Platform:** Threads (threads.net)

---

## Overview

Safari-based automation for Meta's Threads platform to enable direct messaging capabilities. Threads shares infrastructure with Instagram but has distinct UI patterns. This system extends the existing Safari automation framework to interact with Threads' web interface.

---

## Goals

1. **Navigate Threads messaging** - Access and manage DM inbox
2. **Send and receive messages** - Full DM functionality
3. **Unified integration** - Work with existing unified-client
4. **Cross-platform sync** - Leverage Instagram session where possible

---

## Platform Context

### Threads vs Instagram
| Aspect | Instagram | Threads |
|--------|-----------|---------|
| DM Infrastructure | Native | Limited (redirects to IG) |
| Web DM Support | Full | Partial |
| API Access | None public | None public |
| Authentication | Separate | Uses Instagram login |
| Rate Limits | Known patterns | Unknown |

### Current Limitations
- Threads web has limited DM functionality
- Many actions redirect to Instagram
- May require Instagram session authentication
- Platform is still evolving rapidly

---

## Features

### Phase 1: Authentication & Navigation

#### 1.1 Session Management
```typescript
interface ThreadsSession {
  isLoggedIn: boolean;
  username: string;
  profileUrl: string;
  linkedInstagram: string;
  canAccessDMs: boolean;
}

// Threads uses Instagram login
checkThreadsSession(): Promise<ThreadsSession>
loginViaInstagram(): Promise<boolean>
```

#### 1.2 Navigation
```typescript
interface ThreadsNavigationResult {
  success: boolean;
  currentUrl: string;
  redirectedToInstagram: boolean;
  error?: string;
}

navigateToInbox(): Promise<ThreadsNavigationResult>
navigateToProfile(username: string): Promise<ThreadsNavigationResult>
navigateToThread(threadId: string): Promise<ThreadsNavigationResult>
```

### Phase 2: Conversation Management

#### 2.1 Conversation Types
```typescript
interface ThreadsConversation {
  conversationId: string;
  participants: {
    username: string;
    displayName: string;
    profileUrl: string;
    isVerified: boolean;
  }[];
  lastMessage: string;
  lastMessageAt: Date;
  unread: boolean;
  isGroup: boolean;
}
```

#### 2.2 Conversation Operations
```typescript
listConversations(): Promise<ThreadsConversation[]>
openConversation(conversationId: string): Promise<boolean>
startNewConversation(username: string): Promise<ConversationResult>
```

### Phase 3: Messaging

#### 3.1 Message Types
```typescript
interface ThreadsMessage {
  id: string;
  conversationId: string;
  sender: string;
  content: string;
  timestamp: Date;
  isOutbound: boolean;
  type: 'text' | 'media' | 'link';
}
```

#### 3.2 Message Operations
```typescript
readMessages(conversationId: string, limit?: number): Promise<ThreadsMessage[]>
sendMessage(text: string): Promise<SendMessageResult>
sendMessageTo(username: string, text: string): Promise<SendMessageResult>
```

### Phase 4: Profile Interaction

#### 4.1 Profile-to-DM Flow
```typescript
interface ThreadsProfile {
  username: string;
  displayName: string;
  bio: string;
  followers: number;
  following: number;
  isVerified: boolean;
  canMessage: boolean;  // Some profiles may restrict DMs
}

getProfile(username: string): Promise<ThreadsProfile>
sendDMFromProfile(username: string, message: string): Promise<SendMessageResult>
```

---

## API Endpoints

### Status
```
GET  /health
GET  /api/threads/status         - Session status
GET  /api/threads/rate-limits    - Rate limit status
```

### Navigation
```
POST /api/threads/inbox/navigate - Navigate to inbox
POST /api/threads/profile/:username - Navigate to profile
```

### Conversations
```
GET  /api/threads/conversations  - List conversations
POST /api/threads/conversations/open - Open conversation
POST /api/threads/conversations/new  - Start new conversation
```

### Messages
```
GET  /api/threads/messages       - Read messages
POST /api/threads/messages/send  - Send message
POST /api/threads/messages/send-to - Send to username
```

---

## Selectors (Research Required)

```typescript
const THREADS_SELECTORS = {
  // Login detection - likely shares with Instagram
  loggedIn: '[data-pressable-container="true"]',
  loginPrompt: 'a[href*="login"]',
  
  // Navigation
  inboxIcon: 'svg[aria-label="Direct"]',
  homeIcon: 'svg[aria-label="Home"]',
  
  // Conversations (similar to Instagram patterns)
  conversationList: '[role="list"]',
  conversationItem: '[role="listitem"]',
  
  // Messaging
  messageInput: '[contenteditable="true"]',
  sendButton: 'svg[aria-label="Send"]',
  
  // Profile
  profileName: 'h2',
  messageButton: 'button:contains("Message")',
};
```

**Note:** Threads UI changes frequently. Selectors need validation.

---

## Rate Limiting

```typescript
const THREADS_RATE_LIMITS = {
  messagesPerHour: 10,
  messagesPerDay: 30,
  conversationsPerHour: 5,
  minDelayMs: 120000,     // 2 minutes
  maxDelayMs: 300000,     // 5 minutes
  activeHoursStart: 9,
  activeHoursEnd: 21,
};
```

---

## Package Structure

```
packages/threads-dm/
├── src/
│   ├── api/
│   │   ├── server.ts
│   │   └── client.ts
│   ├── automation/
│   │   ├── safari-driver.ts
│   │   ├── dm-operations.ts
│   │   └── selectors.ts
│   ├── utils/
│   │   └── rate-limiter.ts
│   └── types.ts
├── package.json
└── tsconfig.json
```

---

## Implementation Timeline

| Phase | Features | Effort | Priority |
|-------|----------|--------|----------|
| **Phase 1** | Auth, navigation, session | 1 day | High |
| **Phase 2** | Conversation listing | 1 day | High |
| **Phase 3** | Send/receive messages | 1 day | High |
| **Phase 4** | Profile-to-DM flow | 0.5 day | Medium |

**Total Estimated Effort:** 3-4 days

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| DMs redirect to Instagram | High | High | Detect and handle redirects |
| Limited web DM support | High | Medium | Fall back to Instagram DM |
| Frequent UI changes | High | Medium | Selector versioning |
| Shared rate limits with IG | Medium | High | Combined limit tracking |

---

## Dependencies

- Safari automation framework
- Instagram DM package (session sharing)
- unified-client integration

---

**Created:** February 5, 2026  
**Status:** Ready for development (pending platform stability)
