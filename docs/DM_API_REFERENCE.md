# DM Automation — API Reference

> **Single source of truth** for all DM automation endpoints across Instagram, TikTok, and Twitter.
> All operations are fully API-driven via REST servers. No manual osascript or CLI commands needed.

---

## Quick Start

```bash
# Start all 3 servers
npx tsx packages/instagram-dm/src/api/server.ts   # Port 3100
npx tsx packages/tiktok-dm/src/api/server.ts       # Port 3102
npx tsx packages/twitter-dm/src/api/server.ts      # Port 3003

# Verify health
curl -s http://localhost:3100/health
curl -s http://localhost:3102/health
curl -s http://localhost:3003/health
```

---

## Endpoint Matrix

All platforms share the same endpoint patterns. Replace `{base}` with the platform base URL:

| Platform  | Base URL | Prefix |
|-----------|----------|--------|
| Instagram | `http://localhost:3100` | `/api` |
| TikTok    | `http://localhost:3102` | `/api/tiktok` |
| Twitter   | `http://localhost:3003` | `/api/twitter` |

### Core Endpoints (all platforms)

| Method | Path | Body | Description |
|--------|------|------|-------------|
| `GET` | `/health` | — | Server health check |
| `GET` | `{prefix}/status` | — | Login status + driver config |
| `GET` | `{prefix}/rate-limits` | — | Current rate limit counters |
| `PUT` | `{prefix}/rate-limits` | `{hourly, daily}` | Update rate limits |
| `POST` | `{prefix}/inbox/navigate` | — | Navigate Safari to DM inbox |
| `GET` | `{prefix}/conversations` | — | List visible conversations |
| `POST` | `{prefix}/conversations/open` | `{username}` or `{index}` | Open a conversation |
| `POST` | `{prefix}/conversations/new` | `{username}` | Start new conversation dialog |
| `GET` | `{prefix}/messages` | `?limit=20` | Read messages in open conversation |
| `POST` | `{prefix}/messages/send` | `{text}` | Send message in open conversation |
| `POST` | `{prefix}/messages/send-to` | `{username, text}` | Send DM to user (profile-to-DM) |
| `POST` | `{prefix}/ai/generate` | `{username, purpose, topic}` | AI-generate a DM |

### Instagram-Only Endpoints

| Method | Path | Body | Description |
|--------|------|------|-------------|
| `POST` | `/api/messages/send-from-profile` | `{username, text}` | Profile-to-DM (explicit flow) |
| `GET` | `/api/conversations/all` | — | Get conversations from all tabs |
| `POST` | `/api/inbox/tab` | `{tab}` | Switch inbox tab (primary/general/requests) |
| `PUT` | `/api/config` | config object | Update driver config |

### TikTok/Twitter Additional Endpoints

| Method | Path | Body | Description |
|--------|------|------|-------------|
| `POST` | `{prefix}/messages/send-to-url` | `{profileUrl, text}` | Send DM via full profile URL |
| `POST` | `{prefix}/conversations/scroll` | — | Scroll to load more conversations |

### Template System (all platforms)

| Method | Path | Body | Description |
|--------|------|------|-------------|
| `GET` | `{prefix}/templates` | `?lane=&stage=` | Get templates (filtered) |
| `POST` | `{prefix}/templates/next-action` | `{username, relationship_score, pipeline_stage}` | Get next-best-action |
| `POST` | `{prefix}/templates/fit-signals` | `{text}` | Detect product fit signals |
| `GET` | `{prefix}/templates/rule-check/:contactId` | — | Check 3:1 rule compliance |

### Outreach Queue (all platforms)

| Method | Path | Body | Description |
|--------|------|------|-------------|
| `GET` | `{prefix}/outreach/pending` | — | Get pending outreach actions |
| `POST` | `{prefix}/outreach/queue` | `{contact_id, message, ...}` | Queue new action |
| `POST` | `{prefix}/outreach/:actionId/sent` | — | Mark action as sent |
| `POST` | `{prefix}/outreach/:actionId/failed` | `{error}` | Mark action as failed |
| `GET` | `{prefix}/outreach/stats` | — | Get outreach statistics |

### CRM & Scoring (all platforms)

| Method | Path | Body | Description |
|--------|------|------|-------------|
| `GET` | `{prefix}/crm/stats` | — | DM activity statistics |
| `POST` | `{prefix}/crm/score` | `{contactId}` | Recalculate relationship score |
| `POST` | `{prefix}/crm/score-all` | — | Recalculate all scores |
| `GET` | `{prefix}/crm/top-contacts` | `?limit=10` | Get top-scored contacts |

---

## Body Parameter Standard

All DM send endpoints accept **`text`** as the primary message field.
TikTok also accepts `message` for backwards compatibility, but **`text` is preferred**.

```json
{
  "username": "saraheashley",
  "text": "Hey Sarah! How are things going?"
}
```

---

## Send DM — Platform Examples

### Instagram — Smart Send (RECOMMENDED)
Uses cached thread URL if available, falls back to profile-to-DM.
```bash
curl -s -X POST http://localhost:3100/api/messages/smart-send \
  -H 'Content-Type: application/json' \
  -d '{"username": "saraheashley", "text": "Hey Sarah! How are things going?"}' \
  | python3 -m json.tool
# Response includes "method": "thread-url" or "profile-to-dm"
```

### Instagram — Direct Thread URL
Navigate to `https://www.instagram.com/direct/t/{threadId}` and send.
```bash
curl -s -X POST http://localhost:3100/api/messages/send-to-thread \
  -H 'Content-Type: application/json' \
  -d '{"threadId": "110178857046022", "text": "Hey Sarah!"}' \
  | python3 -m json.tool
```

### Instagram — Profile-to-DM
```bash
curl -s -X POST http://localhost:3100/api/messages/send-from-profile \
  -H 'Content-Type: application/json' \
  -d '{"username": "saraheashley", "text": "Hey Sarah! How are things going?"}' \
  | python3 -m json.tool
```

### TikTok
```bash
curl -s -X POST http://localhost:3102/api/tiktok/messages/send-to \
  -H 'Content-Type: application/json' \
  -d '{"username": "saraheashley", "text": "Hey! Your content is amazing!"}' \
  | python3 -m json.tool
```

### Twitter
```bash
curl -s -X POST http://localhost:3003/api/twitter/messages/send-to \
  -H 'Content-Type: application/json' \
  -d '{"username": "saraheashley", "text": "Hey! Love your tweets."}' \
  | python3 -m json.tool
```

---

## Thread Management (Instagram)

Thread IDs enable direct URL navigation — the fastest and most reliable DM method.
Thread URL format: `https://www.instagram.com/direct/t/{threadId}`

```bash
# Register a known thread ID
curl -s -X POST http://localhost:3100/api/threads/register \
  -H 'Content-Type: application/json' \
  -d '{"username": "saraheashley", "threadId": "110178857046022"}' \
  | python3 -m json.tool

# View all cached threads
curl -s http://localhost:3100/api/threads | python3 -m json.tool

# Look up thread for a username
curl -s http://localhost:3100/api/threads/saraheashley | python3 -m json.tool
```

### Known Thread IDs
| Username | Thread ID | URL |
|----------|-----------|-----|
| saraheashley | 110178857046022 | https://www.instagram.com/direct/t/110178857046022 |

---

## AI-Generated DMs

```bash
# Generate message (does NOT send)
curl -s -X POST http://localhost:3100/api/ai/generate \
  -H 'Content-Type: application/json' \
  -d '{"username": "saraheashley", "purpose": "check-in", "topic": "connecting"}' \
  | python3 -m json.tool

# Response: {"success": true, "message": "Hey Sarah! ...", "aiEnabled": true}
# Then send it:
curl -s -X POST http://localhost:3100/api/messages/send-from-profile \
  -H 'Content-Type: application/json' \
  -d '{"username": "saraheashley", "text": "<paste AI message here>"}' \
  | python3 -m json.tool
```

---

## Multi-Platform Outreach Script

```bash
npx tsx scripts/automated-outreach.ts --dry-run                    # Preview all
npx tsx scripts/automated-outreach.ts --dry-run --platform=instagram  # Preview one
npx tsx scripts/automated-outreach.ts --send                       # Execute
npx tsx scripts/automated-outreach.ts --stats                      # View stats
```

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  automated-outreach.ts  (orchestrator)              │
│  Reads from: suggested_actions table                │
│  Sends via: platform API servers                    │
└──────────┬──────────┬──────────┬────────────────────┘
           │          │          │
    ┌──────▼──┐ ┌─────▼───┐ ┌───▼──────┐
    │IG :3100 │ │TT :3102 │ │TW :3003  │
    │ server  │ │ server  │ │ server   │
    └──────┬──┘ └─────┬───┘ └───┬──────┘
           │          │          │
    ┌──────▼──────────▼──────────▼──────┐
    │  SafariDriver (per-platform)       │
    │  Methods:                          │
    │  • navigateTo(url)                 │
    │  • executeJS(script)               │
    │  • focusElement(selector)          │
    │  • typeViaKeystrokes(text)  ← NEW  │
    │  • pressEnter()             ← NEW  │
    │  • activateSafari()         ← NEW  │
    │  • clickElement(selector)          │
    │  • waitForElement(selector)        │
    └──────────────────┬────────────────┘
                       │
    ┌──────────────────▼────────────────┐
    │  Safari.app (real browser session) │
    │  AppleScript → System Events       │
    └───────────────────────────────────┘
```

### Supabase Tables
| Table | Records | Purpose |
|-------|---------|---------|
| `nba_templates` | 18 | DM templates across 5 lanes |
| `fit_signal_config` | 7 | Product fit signal keywords |
| `suggested_actions` | dynamic | Outreach queue |
| `instagram_contacts` | dynamic | IG contacts + scores |

---

## Canonical Files

| File | Purpose |
|------|---------|
| `packages/instagram-dm/src/api/server.ts` | Instagram API server |
| `packages/instagram-dm/src/automation/dm-operations.ts` | Instagram DM operations |
| `packages/instagram-dm/src/automation/safari-driver.ts` | Instagram Safari driver |
| `packages/tiktok-dm/src/api/server.ts` | TikTok API server |
| `packages/tiktok-dm/src/automation/dm-operations.ts` | TikTok DM operations |
| `packages/tiktok-dm/src/automation/safari-driver.ts` | TikTok Safari driver |
| `packages/twitter-dm/src/api/server.ts` | Twitter API server |
| `packages/twitter-dm/src/automation/dm-operations.ts` | Twitter DM operations |
| `packages/twitter-dm/src/automation/safari-driver.ts` | Twitter Safari driver |
| `packages/shared/template-engine.ts` | Template engine (shared) |
| `packages/shared/dm-logger.ts` | DM CRM logger (shared) |
| `scripts/automated-outreach.ts` | Multi-platform outreach runner |

## Deprecated Files (do not import)

| File | Replaced By |
|------|-------------|
| `packages/services/src/instagram/instagram-dm.ts` | `packages/instagram-dm/src/automation/dm-operations.ts` |
| `packages/services/src/automation/dm-automation.ts` | Per-platform dm-operations.ts |
| `apps/safari-client/src/SafariProfileDM.ts` | `dm-operations.ts → sendDMFromProfile()` |
| `apps/safari-client/src/InstagramDMSafari.ts` | Playwright approach replaced by AppleScript |
| `packages/unified-dm/src/dm-logger.ts` | `packages/shared/dm-logger.ts` |
| `scripts/test-instagram-dm.ts` | Use API endpoints directly |

---

*Last updated: 2026-02-06*
