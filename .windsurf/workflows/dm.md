---
description: Manage DM automation across TikTok, Instagram, and Twitter
---

# DM Automation — Quick Reference

> Full API docs: `docs/DM_API_REFERENCE.md`
> All DM operations are done via REST API servers. No manual osascript or CLI commands needed.

## 1. Start Servers

```bash
# Instagram (port 3100)
npx tsx packages/instagram-dm/src/api/server.ts

# TikTok (port 3102)
npx tsx packages/tiktok-dm/src/api/server.ts

# Twitter (port 3003)
npx tsx packages/twitter-dm/src/api/server.ts
```

## 2. Health Check (all platforms)

// turbo
```bash
curl -s http://localhost:3100/health | python3 -m json.tool
curl -s http://localhost:3102/health | python3 -m json.tool
curl -s http://localhost:3003/health | python3 -m json.tool
```

## 3. Send a DM

### Instagram — Profile-to-DM (most reliable)
```bash
curl -s -X POST http://localhost:3100/api/messages/send-from-profile \
  -H 'Content-Type: application/json' \
  -d '{"username": "saraheashley", "text": "Hey! How are things going?"}' \
  | python3 -m json.tool
```

### Instagram — Inbox Search
```bash
curl -s -X POST http://localhost:3100/api/messages/send-to \
  -H 'Content-Type: application/json' \
  -d '{"username": "saraheashley", "text": "Hey! How are things going?"}' \
  | python3 -m json.tool
```

### TikTok — Profile-to-DM
```bash
curl -s -X POST http://localhost:3102/api/tiktok/messages/send-to \
  -H 'Content-Type: application/json' \
  -d '{"username": "saraheashley", "message": "Hey! Your content is amazing!"}' \
  | python3 -m json.tool
```

### Twitter — Profile-to-DM
```bash
curl -s -X POST http://localhost:3003/api/twitter/messages/send-to \
  -H 'Content-Type: application/json' \
  -d '{"username": "saraheashley", "text": "Hey! Love your tweets."}' \
  | python3 -m json.tool
```

## 4. AI-Generated DMs

```bash
# Instagram
curl -s -X POST http://localhost:3100/api/ai/generate \
  -H 'Content-Type: application/json' \
  -d '{"username": "saraheashley", "purpose": "check-in", "topic": "connecting"}' \
  | python3 -m json.tool

# TikTok
curl -s -X POST http://localhost:3102/api/tiktok/ai/generate \
  -H 'Content-Type: application/json' \
  -d '{"username": "saraheashley", "purpose": "collab", "topic": "content"}' \
  | python3 -m json.tool

# Twitter
curl -s -X POST http://localhost:3003/api/twitter/ai/generate \
  -H 'Content-Type: application/json' \
  -d '{"username": "saraheashley", "purpose": "networking", "topic": "tech"}' \
  | python3 -m json.tool
```

## 5. Conversations

```bash
# Navigate to inbox
curl -s -X POST http://localhost:3100/api/inbox/navigate | python3 -m json.tool

# List conversations
curl -s http://localhost:3100/api/conversations | python3 -m json.tool

# Read messages in open conversation
curl -s http://localhost:3100/api/messages | python3 -m json.tool
```

## 6. Template System (Next-Best-Action)

```bash
# Get all templates
curl -s http://localhost:3100/api/templates | python3 -m json.tool

# Get templates by lane (friendship, service, offer, retention, rewarm)
curl -s 'http://localhost:3100/api/templates?lane=friendship' | python3 -m json.tool

# Get next-best-action for a contact
curl -s -X POST http://localhost:3100/api/templates/next-action \
  -H 'Content-Type: application/json' \
  -d '{"username": "saraheashley", "relationship_score": 45, "pipeline_stage": "context_captured"}' \
  | python3 -m json.tool

# Detect fit signals in conversation text
curl -s -X POST http://localhost:3100/api/templates/fit-signals \
  -H 'Content-Type: application/json' \
  -d '{"text": "I need help building a mobile app for my business"}' \
  | python3 -m json.tool

# Check 3:1 rule compliance
curl -s http://localhost:3100/api/templates/rule-check/{contact_uuid} | python3 -m json.tool
```

## 7. Outreach Queue

```bash
# Get pending outreach actions
curl -s http://localhost:3100/api/outreach/pending | python3 -m json.tool

# Queue a new action
curl -s -X POST http://localhost:3100/api/outreach/queue \
  -H 'Content-Type: application/json' \
  -d '{"contact_id": "uuid", "message": "hey!", "template_id": "A1", "lane": "friendship", "phase": "introduction", "priority": 5}' \
  | python3 -m json.tool

# Mark action as sent
curl -s -X POST http://localhost:3100/api/outreach/{action_uuid}/sent | python3 -m json.tool

# Get outreach stats
curl -s http://localhost:3100/api/outreach/stats | python3 -m json.tool
```

## 8. CRM & Scoring

```bash
# Get DM stats
curl -s http://localhost:3100/api/crm/stats | python3 -m json.tool

# Recalculate relationship score
curl -s -X POST http://localhost:3100/api/crm/score \
  -H 'Content-Type: application/json' \
  -d '{"contactId": "uuid"}' \
  | python3 -m json.tool

# Get top contacts
curl -s 'http://localhost:3100/api/crm/top-contacts?limit=10' | python3 -m json.tool
```

## 9. Multi-Platform Outreach Script

```bash
# Preview outreach queue (all platforms)
npx tsx scripts/automated-outreach.ts --dry-run

# Preview single platform
npx tsx scripts/automated-outreach.ts --dry-run --platform=instagram

# Execute outreach
npx tsx scripts/automated-outreach.ts --send

# Show stats
npx tsx scripts/automated-outreach.ts --stats
```

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
    │  SafariDriver (OS-level keystrokes)│
    │  → navigateTo() → focusElement()  │
    │  → typeViaKeystrokes() → pressEnter│
    └──────────────────┬────────────────┘
                       │
    ┌──────────────────▼────────────────┐
    │  Safari.app (real browser session) │
    └───────────────────────────────────┘

Supabase Tables:
  • nba_templates     — 18 templates, 5 lanes
  • fit_signal_config — 7 product fit signals
  • suggested_actions — outreach queue
  • dm_contacts       — (TODO) unified contacts
  • dm_messages       — (TODO) unified messages
  • dm_sessions       — (TODO) session tracking
```

## Key Files

| File | Purpose |
|------|---------|
| `packages/instagram-dm/src/api/server.ts` | Instagram API server (port 3100) |
| `packages/tiktok-dm/src/api/server.ts` | TikTok API server (port 3102) |
| `packages/twitter-dm/src/api/server.ts` | Twitter API server (port 3003) |
| `packages/instagram-dm/src/automation/safari-driver.ts` | Safari automation driver |
| `packages/instagram-dm/src/automation/dm-operations.ts` | Instagram DM operations |
| `packages/tiktok-dm/src/automation/dm-operations.ts` | TikTok DM operations |
| `packages/twitter-dm/src/automation/dm-operations.ts` | Twitter DM operations |
| `packages/shared/template-engine.ts` | Template engine (shared) |
| `scripts/automated-outreach.ts` | Multi-platform outreach runner |
| `docs/PRDs/PRD_DM_Playbook.md` | Template definitions, lanes, 3:1 rule |
| `docs/PRDs/PRD_DM_Outreach_System.md` | Outreach phases, sequencing |
| `docs/PRDs/AUTOMATION_GAPS_MASTER.md` | Master status tracker |
