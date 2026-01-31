# Revio-Style CRM Features Implementation

## Overview

This document outlines the Revio-style relationship-first CRM features implemented in the Instagram API, based on the getrevio.com framework for AI-powered social sales.

## Implemented Features

### 1. Relationship Health Score (0-100)

**Purpose**: Score relationship health, not just sales readiness.

| Component | Weight | Signal |
|-----------|--------|--------|
| Recency | 20 | Days since last meaningful touch |
| Resonance | 20 | Depth of their replies (emotion/detail vs "lol") |
| Need Clarity | 15 | Do you understand their goal/pain? |
| Value Delivered | 20 | Help provided recently (resources, intros, feedback) |
| Reliability | 15 | Promises kept rate |
| Consent | 10 | Opt-in level for updates/offers |

**CLI**: `npx tsx scripts/instagram-api.ts health <username>`

### 2. Relationship Pipeline Stages

Instead of "lead → close", we use "bond → fit":

1. `first_touch` - Initial engagement
2. `context_captured` - You know their situation
3. `micro_win_delivered` - You helped tangibly
4. `cadence_established` - Light ongoing touch
5. `trust_signals` - They ask opinion, refer others, share updates
6. `fit_repeats` - Same pain shows up 2-3 times
7. `permissioned_offer` - Only after consent
8. `post_win` - Keep helping after purchase

### 3. Next-Best-Action System

**5 Lanes** with templates stored in database:

| Lane | Purpose | When to Use |
|------|---------|-------------|
| **Friendship** | No business, just connection | Score 80+ |
| **Service** | Value-first help | Score 60-79 |
| **Offer** | Permissioned pitch | Fit repeats + trust |
| **Retention** | Post-sale care | After purchase |
| **Rewarm** | Cold contacts | Score <40 |

**CLI**: `npx tsx scripts/instagram-api.ts nextaction <username>`

### 4. Fit Signal Detection

Automatically detect when someone mentions pain points that match your products:

| Product | Fit Signals | Offer Template |
|---------|-------------|----------------|
| EverReach | "follow up messy", "network messy" | "i built a relationship OS..." |
| MatrixLoop | "posts not converting", "need system" | "track what's moving the needle..." |
| KeywordRadar | "don't know what to post" | "topics/hooks for your niche..." |
| Services | "drowning in manual work" | "build the automation with you..." |

**CLI**: `npx tsx scripts/instagram-api.ts detect "<message text>"`

### 5. Contacts Needing Attention

Identifies stale relationships (no touch in 30+ days) that need care.

**CLI**: `npx tsx scripts/instagram-api.ts attention`

## Database Tables

### `next_best_actions`
- 20 templates across 5 lanes
- Tagged by stage and intent
- Randomized selection per lane

### `fit_signals`
- 13 product-specific triggers
- Keyword matching on message text
- Auto-generated offer templates

### `instagram_contacts` (extended fields)
- `relationship_stage` - Current pipeline stage
- `last_meaningful_touch` - For recency scoring
- `resonance_score`, `need_clarity_score`, etc.
- `trust_signals` - JSON array of trust events
- `value_delivered_log` - History of help given

## The 3:1 Rule

For every 1 offer touch, do 3 non-offer touches:
1. Micro-win (value delivered)
2. Check-in (friendship)
3. Personalization (remembered detail)

## Weekly Operating System

Suggested cadence:

### Daily (Light)
- Reply to stories
- "how's it going" check-ins for hot relationships

### Weekly (Structured)
- 10 people: send micro-win, resource, or intro
- 10 people: ask curiosity question
- 5 people: permissioned offer (only if fit)

### Monthly (Deep)
- Catch-up/reflection messages
- Ask: "what are you focused on next month?"

## CLI Commands Reference

```bash
# Relationship Health
npx tsx scripts/instagram-api.ts health <username>

# Next Best Action
npx tsx scripts/instagram-api.ts nextaction <username>

# Contacts Needing Attention
npx tsx scripts/instagram-api.ts attention

# Detect Fit Signals
npx tsx scripts/instagram-api.ts detect "<message text>"

# Search Messages
npx tsx scripts/instagram-api.ts search "<query>"

# Top Contacts by Score
npx tsx scripts/instagram-api.ts top

# Recent Conversations
npx tsx scripts/instagram-api.ts recent

# Database Stats
npx tsx scripts/instagram-api.ts stats
```

## Programmatic Usage

```typescript
import {
  calculateRelationshipScore,
  getNextBestAction,
  detectFitSignals,
  recordInteraction,
  getContactsNeedingAttention,
  getTopContacts,
  searchMessages
} from './scripts/instagram-api';

// Get relationship health
const score = await calculateRelationshipScore('saraheashley');
// { total: 65, recency: 15, resonance: 10, ... stage: 'micro_win_delivered' }

// Get suggested action
const action = await getNextBestAction('saraheashley');
// { lane: 'service', action: { text: 'want ideas or just want to vent?' } }

// Record interaction to update scores
await recordInteraction('saraheashley', 'value_delivered');
```

## Future Features (Not Yet Implemented)

1. **AI Copilot** - Reply suggestions using LLM
2. **Conversation Scoring** - Grade chat quality (0-100)
3. **Automated Cadences** - Weekly touch automation
4. **Pipeline Analytics** - Visual funnel + bottleneck detection
5. **Audio/Video Follow-ups** - Media message support
6. **Calendar Integration** - Booking/appointment setting

## Sources

- Revio (getrevio.com) - AI Sales CRM framework
- Gainsight - Customer success platform research
- Relationship selling best practices
