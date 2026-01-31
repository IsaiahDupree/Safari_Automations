# CLI Commands Reference

Complete reference for all Instagram API CLI commands.

## Quick Start

```bash
# Navigate to the repo
cd /path/to/Local\ EverReach\ CRM

# Run any command
npx tsx scripts/instagram-api.ts <command> [args]
```

## Prerequisites

1. Safari API server running on `http://localhost:3100`
2. Supabase running locally on `http://127.0.0.1:54321`
3. Environment variables set in `.env`

---

## Profile & Data Extraction

### `profile <username>`
Extract profile data from Instagram.

```bash
npx tsx scripts/instagram-api.ts profile saraheashley
```

**Output:**
```
📸 Profile for @saraheashley:
  Display Name: Sarah Ashley
  Followers: 12.5K
  Following: 890
  Posts: 234
  Bio: Content Creator | Speaker
```

### `messages <username> [--save]`
Extract messages from a conversation.

```bash
# View messages
npx tsx scripts/instagram-api.ts messages saraheashley

# View and save to database
npx tsx scripts/instagram-api.ts messages saraheashley --save
```

### `full <username>`
Full user analysis (profile + messages + scoring).

```bash
npx tsx scripts/instagram-api.ts full saraheashley
```

### `batch`
Extract messages from all known contacts.

```bash
npx tsx scripts/instagram-api.ts batch
```

---

## Sending Messages

### `dm <username> <message>`
Send a direct message to a user.

```bash
npx tsx scripts/instagram-api.ts dm saraheashley "Hey! How's the project going?"
```

---

## Relationship Management

### `health <username>`
Show relationship health score breakdown (0-100).

```bash
npx tsx scripts/instagram-api.ts health day1marketing
```

**Output:**
```
💚 Relationship Health Score for @day1marketing:

  Total Score:     65/100
  ├─ Recency:      15/20
  ├─ Resonance:    10/20
  ├─ Need Clarity: 10/15
  ├─ Value Given:  15/20
  ├─ Reliability:  10/15
  └─ Consent:       5/10

  Stage: micro_win_delivered
  Next Action: service: permission_to_help
```

### `nextaction <username>`
Get AI-suggested next message based on relationship stage.

```bash
npx tsx scripts/instagram-api.ts nextaction day1marketing
```

**Output:**
```
🎯 Next Best Action for @day1marketing:

  Score: 65/100 | Stage: micro_win_delivered
  Lane:  service

  💬 Suggested message:
  "want ideas or just want to vent?"
```

### `grade <username>`
Grade conversation quality (0-100) with feedback.

```bash
npx tsx scripts/instagram-api.ts grade day1marketing
```

**Output:**
```
📊 Conversation Grade for @day1marketing:

  Score: 72/100

  ✅ Strengths:
     - Good back-and-forth balance
     - Using value-first language

  📈 Improvements:
     - Ask more questions to show curiosity

  Analyzed 25 messages | Outbound: 12, Inbound: 13
```

### `suggest <username> [last message]`
AI Copilot - generate reply suggestion based on context.

```bash
npx tsx scripts/instagram-api.ts suggest day1marketing "I need help with follow ups"
```

**Output:**
```
🤖 AI Copilot Suggestion for @day1marketing:

  💬 "i built a relationship OS for this—want a quick look when it's ready?"
```

---

## Weekly Operating System

### `weekly`
Get weekly task list organized by category.

```bash
npx tsx scripts/instagram-api.ts weekly
```

**Output:**
```
📅 Weekly Operating System Tasks:

  🎁 Micro-Wins (send value):
     @saraheashley
     @tonygaskins
     @owentheaiguy

  🤔 Curiosity (ask questions):
     @day1marketing
     @chase.h.ai
     @ajla_talks

  🔄 Re-warm (gentle re-engage):
     @oldcontact1
     @oldcontact2

  💼 Ready for Offer:
     @qualifiedlead1
```

### `attention`
Show contacts needing attention (stale > 30 days).

```bash
npx tsx scripts/instagram-api.ts attention
```

---

## Search & Analytics

### `search <query>`
Search messages in database.

```bash
npx tsx scripts/instagram-api.ts search "AI automation"
```

**Output:**
```
🔍 Searching messages for "AI automation"...

  1. ← @day1marketing: That's my main concern- would hate to build a stellar AI...
  2. → @tonygaskins: Hey! I help people upgrade their AI automation...
  3. ← @owentheaiguy: The AI automation space is getting crowded...
```

### `top`
Show top contacts by relationship score.

```bash
npx tsx scripts/instagram-api.ts top
```

### `recent`
Show recent conversations.

```bash
npx tsx scripts/instagram-api.ts recent
```

### `stats`
Show database statistics.

```bash
npx tsx scripts/instagram-api.ts stats
```

**Output:**
```
📊 Database Stats:

  Contacts:      69
  Conversations: 43
  Messages:      292
  Patterns:      54
```

---

## Fit Signal Detection

### `detect <message text>`
Detect fit signals in message text to suggest product offers.

```bash
npx tsx scripts/instagram-api.ts detect "I keep forgetting to follow up with people"
```

**Output:**
```
🔍 Detecting fit signals in: "I keep forgetting to follow up..."

  1. [everreach] follow_up_messy
     Offer: "i built a relationship OS for this—want a quick look when it's ready?"
  2. [everreach] network_messy
     Offer: "i built a relationship OS for this—want a quick look?"
```

---

## Contact Lookup

### `known`
List all known handle-to-display-name mappings.

```bash
npx tsx scripts/instagram-api.ts known
```

### `lookup <query>`
Lookup handle or display name.

```bash
npx tsx scripts/instagram-api.ts lookup "Sarah Ashley"
npx tsx scripts/instagram-api.ts lookup saraheashley
```

---

## Testing

### Run All Tests
```bash
npx tsx scripts/test-api.ts
```

**Output:**
```
🧪 Instagram CRM API Tests

📡 Connection Tests:
  ✅ Safari API connection
  ✅ Database connection
  ✅ Instagram page loaded

📋 Database Tables:
  ✅ automation_patterns table exists
  ✅ instagram_contacts table has data
  ...

✅ Results: 14/14 tests passed
```

---

## Environment Setup

### Required Environment Variables

```bash
# .env file
SAFARI_API_URL=http://localhost:3100
CRM_SUPABASE_URL=http://127.0.0.1:54321
CRM_SUPABASE_KEY=your-supabase-key
```

### Database Setup

```bash
# Seed patterns to database
npx tsx scripts/seed-patterns.ts seed

# List patterns
npx tsx scripts/seed-patterns.ts list
npx tsx scripts/seed-patterns.ts list known_handle
npx tsx scripts/seed-patterns.ts list selector
```

---

## Command Summary Table

| Command | Args | Description |
|---------|------|-------------|
| `profile` | `<username>` | Extract profile data |
| `messages` | `<username> [--save]` | Extract messages |
| `dm` | `<username> <message>` | Send DM |
| `full` | `<username>` | Full user analysis |
| `batch` | - | Extract from all known contacts |
| `health` | `<username>` | Relationship health score |
| `nextaction` | `<username>` | AI next-best-action |
| `grade` | `<username>` | Conversation quality grade |
| `suggest` | `<username> [msg]` | AI reply suggestion |
| `weekly` | - | Weekly task list |
| `attention` | - | Stale contacts |
| `search` | `<query>` | Search messages |
| `top` | - | Top contacts by score |
| `recent` | - | Recent conversations |
| `stats` | - | Database stats |
| `detect` | `<text>` | Detect fit signals |
| `known` | - | List known handles |
| `lookup` | `<query>` | Lookup handle/name |
