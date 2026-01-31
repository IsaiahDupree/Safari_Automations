# Database Schema Reference

Complete database schema for the Local EverReach CRM.

## Overview

The CRM uses **Supabase** (PostgreSQL) with the following core tables:

- **instagram_contacts** - Contact profiles, scores, and relationship data
- **instagram_conversations** - DM thread metadata
- **instagram_messages** - Individual messages
- **automation_patterns** - Selectors, handles, skip/spam patterns
- **next_best_actions** - Reply templates by lane and stage
- **fit_signals** - Product-specific trigger patterns
- **outreach_queue** - Scheduled outreach messages

---

## Core Tables

### instagram_contacts

Stores contact profiles with relationship scoring fields.

```sql
CREATE TABLE instagram_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instagram_username TEXT UNIQUE NOT NULL,
  display_name TEXT,
  profile_url TEXT,
  bio TEXT,
  follower_count INTEGER,
  following_count INTEGER,
  
  -- Relationship Scoring (Revio Framework)
  relationship_score INTEGER DEFAULT 50,
  relationship_stage TEXT DEFAULT 'first_touch',
  last_meaningful_touch TIMESTAMPTZ,
  next_planned_touch TIMESTAMPTZ,
  
  -- Score Components (0-20 each)
  resonance_score INTEGER DEFAULT 0,
  need_clarity_score INTEGER DEFAULT 0,
  value_delivered_score INTEGER DEFAULT 0,
  reliability_score INTEGER DEFAULT 0,
  consent_level INTEGER DEFAULT 0,
  
  -- Context Card
  what_theyre_building TEXT,
  current_friction TEXT,
  their_definition_of_win TEXT,
  constraints TEXT,
  preferred_contact_style TEXT,
  
  -- Trust & Engagement
  trust_signals JSONB DEFAULT '[]',
  fit_signals JSONB DEFAULT '[]',
  value_delivered_log JSONB DEFAULT '[]',
  
  -- Message Stats
  total_messages_sent INTEGER DEFAULT 0,
  total_messages_received INTEGER DEFAULT 0,
  
  -- Metadata
  tags TEXT[],
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_contacts_username ON instagram_contacts(instagram_username);
CREATE INDEX idx_contacts_score ON instagram_contacts(relationship_score DESC);
CREATE INDEX idx_contacts_stage ON instagram_contacts(relationship_stage);
```

#### Relationship Stages

| Stage | Description |
|-------|-------------|
| `first_touch` | Initial engagement |
| `context_captured` | You know their situation |
| `micro_win_delivered` | You helped tangibly |
| `cadence_established` | Light ongoing touch |
| `trust_signals` | They ask opinion, refer others |
| `fit_repeats` | Same pain shows up 2-3 times |
| `permissioned_offer` | Only after consent |
| `post_win` | Keep helping after purchase |

---

### instagram_conversations

Stores DM thread metadata.

```sql
CREATE TABLE instagram_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID REFERENCES instagram_contacts(id) ON DELETE CASCADE,
  thread_id TEXT,
  
  -- Last Message
  last_message_at TIMESTAMPTZ,
  last_message_preview TEXT,
  last_message_is_outbound BOOLEAN,
  
  -- Status
  is_read BOOLEAN DEFAULT TRUE,
  is_archived BOOLEAN DEFAULT FALSE,
  tab TEXT DEFAULT 'primary',
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_conversations_contact ON instagram_conversations(contact_id);
CREATE INDEX idx_conversations_updated ON instagram_conversations(updated_at DESC);
```

---

### instagram_messages

Stores individual messages.

```sql
CREATE TABLE instagram_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES instagram_conversations(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES instagram_contacts(id) ON DELETE CASCADE,
  
  -- Message Content
  message_text TEXT NOT NULL,
  message_type TEXT DEFAULT 'text',
  
  -- Direction
  is_outbound BOOLEAN NOT NULL,
  sent_by_automation BOOLEAN DEFAULT FALSE,
  
  -- Timing
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Metadata
  raw_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_messages_conversation ON instagram_messages(conversation_id);
CREATE INDEX idx_messages_contact ON instagram_messages(contact_id);
CREATE INDEX idx_messages_sent ON instagram_messages(sent_at DESC);
CREATE UNIQUE INDEX idx_messages_unique ON instagram_messages(contact_id, message_text, sent_at);
```

---

### automation_patterns

Stores selectors, known handles, skip patterns, and spam patterns.

```sql
CREATE TABLE automation_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_type TEXT NOT NULL,
  pattern_key TEXT NOT NULL,
  pattern_value TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(pattern_type, pattern_key)
);

CREATE INDEX idx_patterns_type ON automation_patterns(pattern_type);
```

#### Pattern Types

| Type | Description | Example |
|------|-------------|---------|
| `known_handle` | Username → Display name mapping | `saraheashley` → `Sarah Ashley` |
| `selector` | CSS selectors for UI elements | `textbox` → `[role="textbox"]` |
| `skip_pattern` | Patterns to skip in extraction | `date_pattern` → `^\d{1,2}/\d{1,2}/\d{2}` |
| `spam_pattern` | Spam detection patterns | `crypto` → `bitcoin,crypto,invest now` |

---

### next_best_actions

Stores reply templates by lane and stage.

```sql
CREATE TABLE next_best_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lane TEXT NOT NULL,
  stage TEXT,
  action_key TEXT NOT NULL,
  action_text TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(lane, action_key)
);
```

#### Lanes

| Lane | Purpose | When to Use |
|------|---------|-------------|
| `friendship` | No business, just connection | Score 80+ |
| `service` | Value-first help | Score 60-79 |
| `offer` | Permissioned pitch | Fit repeats + trust |
| `retention` | Post-sale care | After purchase |
| `rewarm` | Cold contacts | Score <40 |

#### Example Templates

```sql
INSERT INTO next_best_actions (lane, stage, action_key, action_text) VALUES
('friendship', 'any', 'check_in', 'yo—how''d that thing go from last week?'),
('service', 'context', 'permission_to_help', 'want ideas or just want to vent?'),
('offer', 'fit_repeats', 'permissioned_offer', 'want me to show you a simple way i solve that? no pressure.'),
('retention', 'post_win', 'post_win_care', 'how''s it feeling now that ___ is live? anything still annoying?'),
('rewarm', 'cold', 'low_friction', 'no rush to reply — what are you focused on this month?');
```

---

### fit_signals

Stores product-specific trigger patterns.

```sql
CREATE TABLE fit_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product TEXT NOT NULL,
  signal_key TEXT NOT NULL,
  signal_description TEXT NOT NULL,
  offer_template TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(product, signal_key)
);
```

#### Example Fit Signals

```sql
INSERT INTO fit_signals (product, signal_key, signal_description, offer_template) VALUES
('everreach', 'follow_up_messy', 'I keep forgetting to follow up', 'i built a relationship OS for this—want a quick look when it''s ready?'),
('matrixloop', 'content_not_converting', 'My posts aren''t converting', 'want me to show you a simple way to track what''s actually moving the needle?'),
('keywordradar', 'no_topics', 'I don''t know what to post', 'want a list of topics/hooks tailored to your niche that you can post this week?'),
('services', 'manual_overload', 'This is taking me forever', 'if you want, i can either give you a quick blueprint, or build the automation with you.');
```

---

### outreach_queue

Stores scheduled outreach messages.

```sql
CREATE TABLE outreach_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID REFERENCES instagram_contacts(id),
  username TEXT NOT NULL,
  message_text TEXT NOT NULL,
  priority INTEGER DEFAULT 5,
  status TEXT DEFAULT 'pending',
  scheduled_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_outreach_status ON outreach_queue(status);
CREATE INDEX idx_outreach_scheduled ON outreach_queue(scheduled_at);
```

#### Status Values

| Status | Description |
|--------|-------------|
| `pending` | Waiting to be sent |
| `scheduled` | Scheduled for specific time |
| `sent` | Successfully sent |
| `failed` | Failed to send |
| `cancelled` | Manually cancelled |

---

## Queries

### Get Relationship Health Score

```sql
SELECT 
  instagram_username,
  display_name,
  relationship_score,
  relationship_stage,
  resonance_score,
  need_clarity_score,
  value_delivered_score,
  reliability_score,
  consent_level,
  EXTRACT(DAY FROM NOW() - last_meaningful_touch) as days_since_touch
FROM instagram_contacts
WHERE instagram_username = 'saraheashley';
```

### Get Contacts Needing Attention

```sql
SELECT instagram_username, display_name, relationship_score, last_meaningful_touch
FROM instagram_contacts
WHERE last_meaningful_touch < NOW() - INTERVAL '30 days'
   OR last_meaningful_touch IS NULL
ORDER BY relationship_score DESC
LIMIT 10;
```

### Get Weekly Tasks by Score Range

```sql
-- High score (micro-wins)
SELECT instagram_username FROM instagram_contacts
WHERE relationship_score >= 60
ORDER BY relationship_score DESC LIMIT 10;

-- Medium score (curiosity)
SELECT instagram_username FROM instagram_contacts
WHERE relationship_score >= 40 AND relationship_score < 60
LIMIT 10;

-- Low score (rewarm)
SELECT instagram_username FROM instagram_contacts
WHERE relationship_score < 40
LIMIT 5;
```

### Search Messages

```sql
SELECT 
  m.message_text,
  m.is_outbound,
  m.sent_at,
  c.instagram_username
FROM instagram_messages m
JOIN instagram_contacts c ON m.contact_id = c.id
WHERE m.message_text ILIKE '%AI%'
ORDER BY m.sent_at DESC
LIMIT 20;
```

### Get Fit Signals

```sql
SELECT * FROM fit_signals
WHERE is_active = true
ORDER BY product;
```

---

## Migrations

All migrations are in `supabase/migrations/`:

| File | Description |
|------|-------------|
| `20240131_create_crm_tables.sql` | Core tables |
| `20250131_automation_patterns.sql` | Patterns table |

### Run Migrations

```bash
# Apply migrations
npx supabase db push --local

# Reset database
npx supabase db reset --local
```

---

## Seeding Data

### Seed Patterns

```bash
npx tsx scripts/seed-patterns.ts seed
```

This seeds:
- 35 known handles
- 7 UI selectors
- 5 skip patterns
- 3 spam patterns
- 20 next-best-action templates
- 13 fit signals
