# PRD: Full Social Automation Platform Roadmap

**Status:** 🚀 Active Development  
**Created:** 2026-01-31  
**Updated:** 2026-01-31  
**Priority:** High  
**Owner:** Isaiah Dupree

---

## Executive Summary

Build a comprehensive **multi-platform social automation system** that unifies DM management across all major social platforms using Safari WebDriver automation on macOS. The system provides centralized rate limiting, unified CLI/API access, and CRM integration.

---

## Vision

A single automation platform that enables relationship-first outreach across:
- ✅ Instagram (Complete)
- ✅ Twitter/X (Complete)
- 🔄 TikTok (In Progress)
- ⏳ Threads (Planned)
- ⏳ LinkedIn (Planned)
- ⏳ Facebook Messenger (Planned)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          SAFARI AUTOMATION PLATFORM                              │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌──────────────────────────────────────────────────────────────────────────┐   │
│  │                         Unified CLI (social-auto)                         │   │
│  │   social-auto dm <platform> <user> <msg>                                  │   │
│  │   social-auto status --all                                                │   │
│  │   social-auto conversations --platform=tiktok                             │   │
│  └──────────────────────────────────────────────────────────────────────────┘   │
│                                      │                                          │
│                                      ▼                                          │
│  ┌──────────────────────────────────────────────────────────────────────────┐   │
│  │                       Unified Client Library                              │   │
│  │   import { SocialAutomationClient } from '@safari-automation/unified'     │   │
│  │   client.sendDM('tiktok', 'username', 'Hello!')                           │   │
│  └──────────────────────────────────────────────────────────────────────────┘   │
│                                      │                                          │
│         ┌────────────────────────────┼────────────────────────────┐             │
│         ▼                            ▼                            ▼             │
│  ┌─────────────┐            ┌─────────────┐            ┌─────────────┐         │
│  │ instagram-dm│            │  twitter-dm │            │  tiktok-dm  │         │
│  │  Port 3100  │            │  Port 3101  │            │  Port 3102  │         │
│  └──────┬──────┘            └──────┬──────┘            └──────┬──────┘         │
│         │                          │                          │                 │
│         └──────────────────────────┼──────────────────────────┘                 │
│                                    ▼                                            │
│  ┌──────────────────────────────────────────────────────────────────────────┐   │
│  │                        Safari WebDriver Core                              │   │
│  │   • AppleScript execution                                                 │   │
│  │   • JavaScript injection                                                  │   │
│  │   • Screenshot capture                                                    │   │
│  │   • Element interaction                                                   │   │
│  └──────────────────────────────────────────────────────────────────────────┘   │
│                                    │                                            │
│                                    ▼                                            │
│  ┌──────────────────────────────────────────────────────────────────────────┐   │
│  │                      Centralized Selector Registry                        │   │
│  │   packages/selectors/                                                     │   │
│  │   • instagram.ts, twitter.ts, tiktok.ts, threads.ts                       │   │
│  └──────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          LOCAL EVERREACH CRM                                     │
├─────────────────────────────────────────────────────────────────────────────────┤
│  • Relationship scoring engine                                                   │
│  • DM coaching engine                                                            │
│  • AI copilot replies                                                            │
│  • Pipeline analytics                                                            │
│  • Contact management (Supabase)                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Platform Packages

### 1. Instagram DM (`@safari-automation/instagram-dm`)

**Status:** ✅ Complete  
**Port:** 3100  
**Location:** `packages/instagram-dm/`

#### Capabilities
| Feature | Status |
|---------|--------|
| Navigate to inbox | ✅ |
| List conversations | ✅ |
| Read messages | ✅ |
| Send message | ✅ |
| Start new conversation | ✅ |
| Switch tabs (Primary/General/Requests) | ✅ |
| Rate limiting | ✅ |
| Profile-to-DM flow | ✅ |

#### API Endpoints
```
GET  /health
GET  /api/instagram/status
GET  /api/instagram/rate-limits
GET  /api/instagram/conversations
POST /api/instagram/inbox/navigate
POST /api/instagram/messages/send
POST /api/instagram/messages/send-to
```

---

### 2. Twitter/X DM (`@safari-automation/twitter-dm`)

**Status:** ✅ Complete  
**Port:** 3101  
**Location:** `packages/twitter-dm/`

#### Capabilities
| Feature | Status |
|---------|--------|
| Navigate to inbox | ✅ |
| List conversations | ✅ |
| Read messages | ✅ |
| Send message | ✅ |
| Start new conversation | ✅ |
| Profile-to-DM flow | ✅ |
| Handle protected accounts | ✅ |
| Rate limiting | ✅ |

#### API Endpoints
```
GET  /health
GET  /api/twitter/status
GET  /api/twitter/rate-limits
GET  /api/twitter/conversations
POST /api/twitter/inbox/navigate
POST /api/twitter/messages/send
POST /api/twitter/messages/send-to
POST /api/twitter/messages/send-to-url
```

#### Key Selectors
```typescript
const TWITTER_SELECTORS = {
  dmButton: '[data-testid="sendDMFromProfile"]',
  composer: '[data-testid="dm-composer-textarea"]',
  sendButton: '[data-testid="dm-composer-send-button"]',
  conversation: '[data-testid="conversation"]',
  messageEntry: '[data-testid="messageEntry"]',
};
```

---

### 3. TikTok DM (`@safari-automation/tiktok-dm`)

**Status:** 🔄 In Progress  
**Port:** 3102  
**Location:** `packages/tiktok-dm/`

#### Planned Capabilities
| Feature | Priority | Status |
|---------|----------|--------|
| Navigate to inbox | High | ⏳ |
| List conversations | High | ⏳ |
| Read messages | High | ⏳ |
| Send message | High | ⏳ |
| Start new conversation | Medium | ⏳ |
| Profile-to-DM flow | High | ⏳ |
| Rate limiting | High | ⏳ |
| Handle creator vs personal accounts | Medium | ⏳ |

#### TikTok-Specific Challenges
1. **Dynamic class names** - TikTok uses hashed CSS classes that change between builds
2. **Multiple message layouts** - Desktop web vs mobile web differences
3. **Authentication detection** - Complex login state detection
4. **Rate limiting** - TikTok is aggressive with rate limits
5. **Message requests** - Similar to Instagram's request system

#### Expected Selectors (to be validated)
```typescript
const TIKTOK_SELECTORS = {
  // Navigation
  inboxButton: '[data-e2e="inbox-icon"]',
  messagesTab: '[data-e2e="messages-tab"]',
  
  // Conversations
  conversationList: '[data-e2e="conversation-list"]',
  conversationItem: '[data-e2e="conversation-item"]',
  
  // Composer
  messageInput: '[data-e2e="message-input"]',
  sendButton: '[data-e2e="send-button"]',
  
  // Profile
  profileMessageButton: '[data-e2e="message-icon"]',
};
```

#### API Endpoints (Planned)
```
GET  /health
GET  /api/tiktok/status
GET  /api/tiktok/rate-limits
GET  /api/tiktok/conversations
POST /api/tiktok/inbox/navigate
POST /api/tiktok/messages/send
POST /api/tiktok/messages/send-to
```

---

### 4. Threads DM (`@safari-automation/threads-dm`)

**Status:** ⏳ Planned  
**Port:** 3103  
**Location:** `packages/threads-dm/`

#### Notes
- Threads uses Instagram's backend
- DM functionality is limited on web
- May share selectors with Instagram
- Lower priority due to limited DM features

---

### 5. LinkedIn DM (`@safari-automation/linkedin-dm`)

**Status:** ⏳ Planned  
**Port:** 3104  
**Location:** `packages/linkedin-dm/`

#### Challenges
- Strong anti-automation measures
- Complex authentication (2FA common)
- Connection requests vs messages
- InMail vs regular messages

---

## Unified Client Library

**Package:** `@safari-automation/unified-client`  
**Status:** ✅ Complete

### Interface

```typescript
import { SocialAutomationClient } from '@safari-automation/unified-client';

const client = new SocialAutomationClient({
  safariApiUrl: 'http://localhost:3100',
});

// Send DM to any platform
await client.sendDM('instagram', 'username', 'Hello!');
await client.sendDM('twitter', 'username', 'Hello!');
await client.sendDM('tiktok', 'username', 'Hello!');  // Coming soon

// Get combined status
const status = await client.getAllStatus();
// { instagram: {...}, twitter: {...}, tiktok: {...} }

// Get combined rate limits
const limits = await client.getAllRateLimits();
// { combined: { totalToday: 25, totalThisHour: 8 } }

// Get all conversations across platforms
const convos = await client.getAllConversations();
// [{ platform: 'instagram', username: '...' }, ...]
```

---

## Unified CLI

**Package:** `@safari-automation/social-cli`  
**Status:** ✅ Complete

### Commands

```bash
# Status
social-auto status                    # All platforms
social-auto status -p instagram       # Specific platform

# Send DM
social-auto dm instagram user "msg"
social-auto dm twitter user "msg"
social-auto dm tiktok user "msg"      # Coming soon

# Conversations
social-auto conversations             # All platforms
social-auto convos -p twitter -l 20   # Platform + limit

# Rate limits
social-auto rate-limits
social-auto limits

# Navigation
social-auto navigate instagram
social-auto nav twitter

# Health check
social-auto health
```

---

## Rate Limiting Strategy

### Per-Platform Defaults

| Platform | Hourly | Daily | Min Delay | Max Delay | Active Hours |
|----------|--------|-------|-----------|-----------|--------------|
| Instagram | 10 | 30 | 120s | 300s | 9 AM - 9 PM |
| Twitter | 15 | 100 | 90s | 240s | 9 AM - 9 PM |
| TikTok | 10 | 50 | 120s | 300s | 9 AM - 9 PM |
| Threads | 10 | 30 | 120s | 300s | 9 AM - 9 PM |

### Combined Limits

```typescript
const COMBINED_LIMITS = {
  maxTotalPerHour: 30,      // Across all platforms
  maxTotalPerDay: 150,      // Across all platforms
  minDelayBetweenAny: 60000, // 1 min between any platform
};
```

### Implementation

```typescript
class UnifiedRateLimiter {
  private platformLimiters: Map<Platform, RateLimiter>;
  private combinedTracker: CombinedTracker;
  
  async canSend(platform: Platform): Promise<boolean> {
    // Check platform-specific limits
    if (!this.platformLimiters.get(platform)?.canSend()) {
      return false;
    }
    
    // Check combined limits
    if (!this.combinedTracker.canSend()) {
      return false;
    }
    
    // Check active hours
    if (!this.isActiveHours()) {
      return false;
    }
    
    return true;
  }
}
```

---

## CRM Integration

### Supabase Schema

```sql
-- Unified contacts table
CREATE TABLE social_contacts (
  id UUID PRIMARY KEY,
  platform TEXT NOT NULL,  -- 'instagram', 'twitter', 'tiktok'
  username TEXT NOT NULL,
  display_name TEXT,
  profile_url TEXT,
  relationship_score INTEGER DEFAULT 0,
  last_contacted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(platform, username)
);

-- Unified messages log
CREATE TABLE social_messages (
  id UUID PRIMARY KEY,
  contact_id UUID REFERENCES social_contacts(id),
  platform TEXT NOT NULL,
  direction TEXT NOT NULL,  -- 'inbound', 'outbound'
  content TEXT,
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  status TEXT DEFAULT 'sent'
);

-- Rate limit tracking
CREATE TABLE rate_limit_log (
  id UUID PRIMARY KEY,
  platform TEXT NOT NULL,
  action TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Scoring Engine Integration

```typescript
import { calculateRelationshipScore } from '@safari-automation/crm-core';

// Score works across platforms
const score = calculateRelationshipScore({
  platform: 'tiktok',
  username: 'creator123',
  messages: await getMessages('tiktok', 'creator123'),
  interactions: await getInteractions('tiktok', 'creator123'),
});
```

---

## Web Dashboard (Future)

### Planned Features

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Social Automation Dashboard                          localhost:3200    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐ │
│  │ Instagram │ │  Twitter  │ │  TikTok   │ │  Threads  │ │ LinkedIn  │ │
│  │  ✅ 15/30 │ │  ✅ 8/100 │ │  ✅ 5/50  │ │  ⏳ ---   │ │  ⏳ ---   │ │
│  └───────────┘ └───────────┘ └───────────┘ └───────────┘ └───────────┘ │
│                                                                          │
│  📊 Combined Rate Limits                                                 │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │ Hourly:  ████████░░░░░░░░░░░░  28/30 (93%)                      │    │
│  │ Daily:   ████░░░░░░░░░░░░░░░░  45/150 (30%)                     │    │
│  │ Next reset: 32 minutes                                           │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
│  📬 Pending Outreach Queue                                               │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │ Platform │ Username      │ Score │ Message              │ Action │   │
│  ├──────────┼───────────────┼───────┼──────────────────────┼────────┤   │
│  │ TikTok   │ @creator123   │ 85    │ "Loved your video.." │ [Send] │   │
│  │ Twitter  │ @tech_writer  │ 78    │ "Great thread on..." │ [Send] │   │
│  │ Instagram│ @photographer │ 72    │ "Your work is..."    │ [Send] │   │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
│  🔥 Hot Contacts (Score > 80)                                            │
│  • @sarah_creates (TikTok) - Score: 92 - Last: 2d ago                   │
│  • @dev_mike (Twitter) - Score: 88 - Last: 1d ago                       │
│  • @photo_jane (Instagram) - Score: 85 - Last: 3d ago                   │
│                                                                          │
│  📈 Analytics                                                            │
│  • Messages sent today: 28                                               │
│  • Response rate: 34%                                                    │
│  • Avg response time: 4.2 hours                                          │
│  • New connections this week: 12                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Tech Stack
- **Frontend:** React + TailwindCSS + shadcn/ui
- **Backend:** Express API (extends existing)
- **Real-time:** WebSocket for live updates
- **Database:** Supabase

---

## Implementation Timeline

### Phase 1: Foundation ✅ Complete
| Task | Status | Time |
|------|--------|------|
| Instagram DM package | ✅ | Pre-existing |
| Twitter DM package | ✅ | 3 hrs |
| Unified client library | ✅ | 1 hr |
| Unified CLI | ✅ | 2 hrs |
| CRM package linking | ✅ | 0.5 hr |

### Phase 2: TikTok ✅ Complete
| Task | Status | Time |
|------|--------|------|
| Explore TikTok web interface | ✅ | 1 hr |
| Document TikTok selectors | ✅ | Pre-existing |
| Create tiktok-dm package | ✅ | 2 hrs |
| Update unified-client | ✅ | 0.5 hr |
| Update CLI | ✅ | 0.5 hr |

### Phase 3: Threads (Future)
| Task | Status | Time |
|------|--------|------|
| Explore Threads web interface | ⏳ | 1 hr |
| Document Threads selectors | ⏳ | 1 hr |
| Create threads-dm package | ⏳ | 2 hrs |
| Update unified-client | ⏳ | 0.5 hr |

### Phase 4: Dashboard (Future)
| Task | Status | Time |
|------|--------|------|
| Set up React dashboard app | ⏳ | 1 hr |
| Platform status widgets | ⏳ | 2 hrs |
| Rate limit visualization | ⏳ | 1 hr |
| Outreach queue UI | ⏳ | 2 hrs |
| Contact management | ⏳ | 2 hrs |

### Phase 5: Advanced Features (Future)
| Task | Status | Time |
|------|--------|------|
| LinkedIn adapter | ⏳ | 4 hrs |
| AI message suggestions | ⏳ | 3 hrs |
| Scheduled messaging | ⏳ | 2 hrs |
| Analytics dashboard | ⏳ | 3 hrs |

---

## File Structure

```
Safari Automation/
├── packages/
│   ├── crm-core/              # ✅ Scoring, coaching, copilot
│   ├── instagram-dm/          # ✅ Instagram automation
│   ├── twitter-dm/            # ✅ Twitter automation
│   ├── tiktok-dm/             # 🔄 TikTok automation (in progress)
│   ├── threads-dm/            # ⏳ Threads automation (planned)
│   ├── unified-client/        # ✅ Multi-platform client
│   ├── social-cli/            # ✅ Unified CLI
│   └── selectors/             # ✅ Centralized selectors
├── apps/
│   ├── api/                   # Main Safari API
│   └── dashboard/             # ⏳ Web dashboard (planned)
└── docs/
    ├── PRDs/
    │   ├── PRD_FULL_SOCIAL_AUTOMATION_ROADMAP.md  # This document
    │   ├── PRD_UNIFIED_SOCIAL_AUTOMATION.md
    │   └── PRD_TWITTER_DM_FULL_CONTROL.md
    └── selectors/
        ├── TWITTER_SELECTORS_REFERENCE.md
        └── TIKTOK_SELECTORS_REFERENCE.md  # 🔄 In progress
```

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Platform coverage | 4+ platforms |
| API response time | < 500ms |
| Automation success rate | > 95% |
| Rate limit compliance | 100% |
| Unified CLI adoption | Replace individual scripts |

---

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Platform UI changes | High | High | Selector versioning, contract tests |
| Rate limit changes | Medium | High | Conservative defaults, monitoring |
| Account restrictions | Medium | High | Multiple accounts, slow rollout |
| Authentication changes | Medium | Medium | Fallback detection methods |

---

## References

- `docs/PRDs/PRD_TWITTER_DM_FULL_CONTROL.md` - Twitter DM requirements
- `docs/selectors/TWITTER_SELECTORS_REFERENCE.md` - Twitter selectors
- `packages/instagram-dm/README.md` - Instagram package docs
- `packages/twitter-dm/README.md` - Twitter package docs

---

## Changelog

| Date | Change |
|------|--------|
| 2026-01-31 | Initial PRD created |
| 2026-01-31 | Phase 1 completed (Instagram, Twitter, CLI) |
| 2026-01-31 | Phase 2 completed (TikTok DM package, unified-client, CLI updates) |
