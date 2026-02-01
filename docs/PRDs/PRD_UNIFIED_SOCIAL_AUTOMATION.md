# PRD: Unified Social Automation Architecture

**Status:** ✅ Phase 1 Complete  
**Created:** 2026-01-31  
**Updated:** 2026-01-31  
**Priority:** High  

---

## Executive Summary

Consolidate the **Safari Automation** and **Local EverReach CRM** projects into a unified social automation platform with shared packages, centralized rate limiting, and a multi-platform API.

---

## Current System Overview

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              USER'S MAC                                        │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                                │
│  ┌─────────────────────────┐          ┌─────────────────────────┐            │
│  │   Safari Automation     │          │   Local EverReach CRM   │            │
│  │   (Port 3100)           │◄────────►│   (Scripts)             │            │
│  │                         │   HTTP   │                         │            │
│  │  • instagram-dm/server  │          │  • instagram-api.ts     │            │
│  │  • Safari WebDriver     │          │  • twitter-api.ts       │            │
│  │  • Selector Registry    │          │  • scoring-engine.ts    │            │
│  │  • crm-core package     │          │  • coaching-engine.ts   │            │
│  └───────────┬─────────────┘          └───────────┬─────────────┘            │
│              │                                    │                          │
│              ▼                                    ▼                          │
│  ┌─────────────────────────────────────────────────────────────────┐        │
│  │                      Supabase Database                           │        │
│  │                      (localhost:54321)                           │        │
│  │                                                                   │        │
│  │  Tables: instagram_contacts, twitter_contacts, messages, etc.   │        │
│  └─────────────────────────────────────────────────────────────────┘        │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## Problem Statement

### Connectivity Analysis

| Connection Point | Safari Automation | Local CRM | Status |
|------------------|-------------------|-----------|--------|
| **Safari API** | Exposes `:3100` | Calls `:3100` | ✅ Working |
| **Supabase** | Has `crm-core` package | Direct client | ⚠️ Duplicated |
| **Selectors** | `packages/selectors` | Hardcoded in scripts | ⚠️ Duplicated |
| **Rate Limits** | `instagram-dm/server` | In `twitter-api.ts` | ⚠️ Duplicated |
| **Scoring** | `crm-core/scoring-engine` | In scripts | ⚠️ Duplicated |

### Key Issues

1. **Duplication of Logic**
   - Scoring engine exists in both projects
   - Rate limiting implemented twice
   - Selectors hardcoded vs. centralized

2. **Separate Codebases**
   ```
   Safari Automation/           Local EverReach CRM/
   ├── packages/                ├── scripts/
   │   ├── crm-core/           │   ├── twitter-api.ts (52KB)
   │   ├── instagram-dm/       │   ├── instagram-api.ts (56KB)
   │   └── selectors/          │   └── (20+ scripts)
   ```

3. **No Unified Management Interface**
   - Each platform (Instagram/Twitter) has separate CLI
   - No central dashboard
   - Manual script execution required

---

## Target Architecture

### Consolidated Structure (Option A - Recommended)

```
Safari Automation/
├── packages/
│   ├── crm-core/           # ✅ Keep - scoring, coaching, copilot
│   ├── instagram-dm/       # ✅ Keep - Instagram automation
│   ├── twitter-dm/         # 🆕 NEW - Twitter automation (port from CRM)
│   ├── selectors/          # ✅ Keep - centralized selectors
│   └── unified-client/     # 🆕 NEW - Multi-platform client
├── apps/
│   ├── api/                # Extend to handle all platforms
│   └── dashboard/          # 🆕 NEW - Web UI for management
```

### Alternative: Shared Packages (Option B)

```typescript
// In Local CRM package.json
{
  "dependencies": {
    "@safari-automation/crm-core": "file:../Safari Automation/packages/crm-core",
    "@safari-automation/selectors": "file:../Safari Automation/packages/selectors"
  }
}
```

---

## Implementation Plan

### Phase 1: Twitter DM Package (High Priority)

Create `packages/twitter-dm/` with the same structure as `instagram-dm`:

```
twitter-dm/
├── src/
│   ├── automation/
│   │   ├── types.ts          # TypeScript interfaces
│   │   ├── safari-driver.ts  # Safari/AppleScript wrapper (shared)
│   │   └── dm-operations.ts  # High-level DM functions
│   ├── api/
│   │   ├── server.ts         # Express REST API
│   │   └── client.ts         # API client library
│   └── index.ts              # Main exports
├── tests/
├── package.json
└── README.md
```

**Key Functions:**
- `navigateToInbox(driver)` - Navigate to x.com/messages
- `listConversations(driver)` - List DM conversations
- `openConversation(username, driver)` - Open specific conversation
- `sendMessage(text, driver)` - Send message in open conversation
- `sendDMByUsername(username, message, driver)` - Profile-to-DM flow
- `sendDMFromProfileUrl(url, message, driver)` - DM from URL

### Phase 2: Unified Client Package

```typescript
// packages/unified-client/src/index.ts
export class SocialAutomationClient {
  private instagramDM: InstagramDMClient;
  private twitterDM: TwitterDMClient;
  
  constructor(config: { safariApiUrl: string }) {
    this.instagramDM = new InstagramDMClient({ baseUrl: config.safariApiUrl });
    this.twitterDM = new TwitterDMClient({ baseUrl: config.safariApiUrl });
  }
  
  async sendDM(platform: 'instagram' | 'twitter', username: string, message: string) {
    const client = platform === 'instagram' ? this.instagramDM : this.twitterDM;
    return client.sendMessageTo(username, message);
  }
  
  async getRateLimits() {
    return {
      instagram: await this.instagramDM.getRateLimits(),
      twitter: await this.twitterDM.getRateLimits(),
    };
  }
  
  async getStatus() {
    return {
      instagram: await this.instagramDM.getStatus(),
      twitter: await this.twitterDM.getStatus(),
    };
  }
}
```

### Phase 3: Unified CLI

```bash
# Instead of separate CLIs
npx tsx scripts/twitter-api.ts dm user "msg"
npx tsx scripts/instagram-api.ts dm user "msg"

# Unified
npx social-auto dm --platform=twitter user "msg"
npx social-auto dm --platform=instagram user "msg"
npx social-auto status --all
npx social-auto rate-limits
```

### Phase 4: Management Dashboard (Future)

```
┌─────────────────────────────────────────────────────────────────┐
│  Social Automation Dashboard                    localhost:3200   │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │  Instagram  │  │   Twitter   │  │   Threads   │             │
│  │  ✅ Online  │  │  ✅ Online  │  │  ⏳ Planned │             │
│  │  15/30 msgs │  │   8/15 msgs │  │     ---     │             │
│  └─────────────┘  └─────────────┘  └─────────────┘             │
│                                                                  │
│  📊 Rate Limits          📬 Pending Actions                     │
│  ├─ Hourly: 23/40       ├─ @saraheashley - follow up           │
│  ├─ Daily: 45/100       ├─ @johndoe - send intro               │
│  └─ Next reset: 2h 15m  └─ @jane - check-in (7 days cold)      │
│                                                                  │
│  🔥 Hot Contacts (Score > 80)                                   │
│  ├─ Sarah Ashley (92) - Last: 2d ago                            │
│  └─ John Doe (85) - Last: 5d ago                                │
└─────────────────────────────────────────────────────────────────┘
```

---

## API Endpoints (Unified)

### Status & Health
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| GET | `/api/status` | All platform statuses |
| GET | `/api/status/:platform` | Platform-specific status |

### Rate Limits
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/rate-limits` | All rate limits |
| GET | `/api/rate-limits/:platform` | Platform rate limits |
| PUT | `/api/rate-limits/:platform` | Update platform limits |

### Direct Messages
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/:platform/conversations` | List conversations |
| POST | `/api/:platform/inbox/navigate` | Navigate to inbox |
| POST | `/api/:platform/messages/send` | Send message |
| POST | `/api/:platform/messages/send-to` | Send to user |

---

## Rate Limiting Configuration

| Limit | Instagram | Twitter |
|-------|-----------|---------|
| Messages per hour | 10 | 15 |
| Messages per day | 30 | 100 |
| Min delay between | 60s | 90s |
| Max delay between | 5min | 4min |
| Active hours | 9 AM - 9 PM | 9 AM - 9 PM |

---

## Success Metrics

1. **Code Reduction:** Eliminate 50%+ duplicated code
2. **Single CLI:** One command for all platforms
3. **Unified Rate Limiting:** Centralized tracking across platforms
4. **Faster Development:** New platform adapters in < 2 hours

---

## Timeline

| Priority | Task | Effort | Status |
|----------|------|--------|--------|
| 🔴 High | Create `twitter-dm` package | 2-3 hrs | ✅ Complete |
| 🔴 High | Create `unified-client` package | 1 hr | ✅ Complete |
| � High | Create `social-cli` package | 2 hrs | ✅ Complete |
| � High | Link CRM to Safari Automation packages | 1 hr | ✅ Complete |
| 🟢 Low | Build web dashboard | 4-6 hrs | ⏳ Future |
| 🟢 Low | Add TikTok/Threads adapters | 3-4 hrs each | ⏳ Future |

## Completed Implementation

### New Packages Created

1. **`@safari-automation/twitter-dm`** (`packages/twitter-dm/`)
   - Safari WebDriver automation for Twitter/X DMs
   - Profile-to-DM flow with error handling
   - REST API server on port 3101
   - Rate limiting (15/hr, 100/day)

2. **`@safari-automation/unified-client`** (`packages/unified-client/`)
   - Multi-platform client interface
   - `sendDM(platform, username, message)`
   - Combined status and rate limit views

3. **`@safari-automation/social-cli`** (`packages/social-cli/`)
   - Unified CLI: `social-auto status|dm|conversations|rate-limits`
   - Works with both Instagram and Twitter

### Local CRM Integration

The Local EverReach CRM now imports Safari Automation packages:
```json
{
  "dependencies": {
    "@safari-automation/crm-core": "file:../Safari Automation/packages/crm-core",
    "@safari-automation/twitter-dm": "file:../Safari Automation/packages/twitter-dm",
    "@safari-automation/unified-client": "file:../Safari Automation/packages/unified-client"
  }
}
```

---

## References

- `docs/PRDs/PRD_TWITTER_DM_FULL_CONTROL.md` - Twitter DM requirements
- `docs/selectors/TWITTER_SELECTORS_REFERENCE.md` - Twitter selectors
- `packages/instagram-dm/README.md` - Instagram DM package structure
