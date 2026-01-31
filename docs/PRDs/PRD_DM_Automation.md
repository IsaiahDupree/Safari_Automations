# PRD: Relationship-First DM Automation System

## Overview
An AI-powered social DM automation system focused on building genuine relationships that convert to long-term value, inspired by Revio's framework but optimized for friendship retention and trust-based selling.

---

## Competitive Analysis: Revio (getrevio.com)

### What Revio Does
- AI-powered sales CRM for Instagram/Facebook DMs
- Follower scraping → lead universe
- AI lead scoring + prioritization
- Automated outbound DMs to qualified prospects
- AI "Copilot" for reply suggestions
- AI Sales Coach (conversation scoring + feedback)
- Centralized DM inbox (multi-rep, no shared logins)
- Personal audio follow-ups
- Pipeline + analytics visualization
- 24/7 booking/appointment setting

### Revio URLs
- Main site: https://www.getrevio.com
- App login: https://app.prod.getrevio.cloud/
- Third-party overview: https://sourceforge.net/software/product/Revio/
- Review: https://www.automateed.com/revio-review

### Revio Pricing
- ~$500/month for ~20-seat teams (reported)
- Exact pricing requires demo booking

---

## Our Differentiation: Relationship-First Framework

### Philosophy
Instead of "lead score = buy soon," we score **relationship health**. LTV is a byproduct of "trust momentum."

---

## Core Features

### 1. Relationship Health Score (0-100)

| Factor | Description |
|--------|-------------|
| **Recency** | Days since last meaningful touch |
| **Resonance** | Response quality (detail/emotion vs "lol") |
| **Need Clarity** | Do we know what they're building/trying to fix? |
| **Value Delivered** | Recent wins, intros, resources given |
| **Reliability** | Did we follow through on commitments? |
| **Consent** | Have they opted into updates? |

This score tells you **who needs care**, not who needs a pitch.

---

### 2. Relationship Pipeline Stages

```
1. First Touch          → They engage / you engage
2. Shared Context       → You know their situation
3. Micro-Win Delivered  → You helped in a tangible way
4. Cadence Established  → Light ongoing touch
5. Trust Signals        → They ask opinions / refer / share personal updates
6. Fit Identified       → A solvable problem appears repeatedly
7. Permissioned Offer   → Only after consent
8. Post-Win Expansion   → Keep helping after purchase
```

**Key Insight**: Most people skip stages 2-5 and wonder why LTV sucks.

---

### 3. Intent Ladder (Non-Salesy Messaging)

| Lane | Purpose | Examples |
|------|---------|----------|
| **A: Friendship** | No business | "How did that thing go?" |
| **B: Service** | Value-first | Resources, templates, quick audits, intros |
| **C: Offer** | Permission-based | "Want me to show you a simple way to fix this?" |

**Rule**: Ask permission before offering → stops being pushy.

---

### 4. The 3:1 Rule for LTV

For every **1 offer-related touch**, do **3 non-offer touches**:
1. Micro-win delivery
2. Check-in
3. Personalization (remembered detail)

This makes offers feel like natural continuation.

---

### 5. Context Card (Relationship Profile)

```json
{
  "contact_id": "uuid",
  "platform": "instagram|tiktok|twitter|threads",
  "username": "@example",
  
  "context": {
    "building": "What are they working on right now?",
    "struggles": "What's hard for them lately?",
    "values": "What do they care about (values/style/constraints)?",
    "win_30d": "What would a win look like in 30 days?",
    "preferred_cadence": "daily|weekly|monthly",
    "do_not_do": ["hate calls", "hate spam"]
  },
  
  "scores": {
    "relationship_health": 75,
    "recency_days": 3,
    "resonance": "high",
    "value_delivered_count": 4,
    "trust_signals": ["asked_opinion", "referred_friend"]
  },
  
  "pipeline_stage": "trust_signals",
  "last_touch": "2026-01-20",
  "next_action": "celebration_prompt"
}
```

---

### 6. AI Next-Best-Action Library

Instead of "send pitch," AI suggests relationship-building actions:

| Action Type | Prompt Template |
|-------------|-----------------|
| **Curiosity** | "What are you optimizing for right now?" |
| **Support** | "Want a quick checklist/template for that?" |
| **Accountability** | "When do you want to have this done?" |
| **Connection** | "I know someone doing that—want an intro?" |
| **Celebration** | "That's a real win—how did you pull it off?" |
| **Permissioned Offer** | "If I built a tool/service that solves that, want me to show you when it's ready?" |

---

### 7. Offer Timing Rules

Make an offer **only when**:
- [ ] Same pain shows up 2-3 times
- [ ] They've accepted help before
- [ ] They've signaled trust ("what would you do?")

**Non-Pushy Offer Script**:
```
"I keep noticing you run into X. I can help with that."
"Do you want a quick suggestion, or do you want me to actually handle it with you?"
"No pressure—either way I'm here."
```

---

### 8. Touch Cadences

#### Daily (Light)
- Reply to stories
- "How's it going" for hot relationships

#### Weekly (Structured)
- 10 people: Send micro-win, resource, or intro
- 10 people: Ask curiosity question
- 5 people: Permissioned offer (only if fit)

#### Monthly (Deep)
- "Catch-up / reflection" messages
- "What are you focused on next month?"

---

### 9. Success Metrics

| Metric | What It Measures |
|--------|------------------|
| Meaningful replies/week | Engagement quality |
| % contacts with context cards | Relationship depth |
| Micro-wins delivered/month | Value creation |
| Time-to-follow-up | Reliability |
| Permissioned offers accepted | Offer timing accuracy |
| Referrals/introductions | Trust level |

---

## Technical Architecture

### Database Schema

```sql
-- Contacts with relationship context
CREATE TABLE dm_contacts (
    id UUID PRIMARY KEY,
    platform VARCHAR(20),
    username VARCHAR(100),
    display_name VARCHAR(200),
    profile_url TEXT,
    
    -- Context card
    building TEXT,
    struggles TEXT,
    values_style TEXT,
    win_30d TEXT,
    preferred_cadence VARCHAR(20),
    do_not_do TEXT[],
    
    -- Scores
    relationship_health INTEGER DEFAULT 0,
    recency_days INTEGER,
    resonance VARCHAR(20),
    value_delivered_count INTEGER DEFAULT 0,
    trust_signals TEXT[],
    
    -- Pipeline
    pipeline_stage VARCHAR(50) DEFAULT 'first_touch',
    last_touch TIMESTAMPTZ,
    next_action VARCHAR(50),
    next_action_date DATE,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Conversation history
CREATE TABLE dm_conversations (
    id UUID PRIMARY KEY,
    contact_id UUID REFERENCES dm_contacts(id),
    platform VARCHAR(20),
    
    message_type VARCHAR(20), -- inbound, outbound
    content TEXT,
    intent_lane VARCHAR(20), -- friendship, service, offer
    ai_suggested BOOLEAN DEFAULT FALSE,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Value tracking (micro-wins)
CREATE TABLE dm_value_delivered (
    id UUID PRIMARY KEY,
    contact_id UUID REFERENCES dm_contacts(id),
    value_type VARCHAR(50), -- resource, intro, feedback, template
    description TEXT,
    delivered_at TIMESTAMPTZ DEFAULT NOW()
);

-- Offer tracking
CREATE TABLE dm_offers (
    id UUID PRIMARY KEY,
    contact_id UUID REFERENCES dm_contacts(id),
    offer_type VARCHAR(100),
    permissioned BOOLEAN DEFAULT FALSE,
    accepted BOOLEAN,
    offered_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Integration Points

1. **Existing Engagement System** - Use current Safari automation for DM sending
2. **AI Comment Generator** - Extend for relationship-first message generation
3. **Platform Modules** - Instagram, TikTok, Twitter, Threads DM capabilities

---

## Implementation Phases

### Phase 1: Foundation
- [ ] Create dm_contacts table with context cards
- [ ] Build relationship health scoring algorithm
- [ ] Add pipeline stage tracking

### Phase 2: AI Integration
- [ ] Extend AI generator for next-best-action suggestions
- [ ] Implement 3:1 rule enforcement
- [ ] Build intent lane classification

### Phase 3: Automation
- [ ] Daily/weekly/monthly touch cadence automation
- [ ] Context card auto-population from conversations
- [ ] Permissioned offer timing detection

### Phase 4: Analytics
- [ ] Relationship health dashboard
- [ ] LTV correlation analysis
- [ ] Trust signal tracking

---

## References

- Revio (getrevio.com) - AI Sales CRM
- Relationship-first selling methodology
- Trust-based conversion framework

---

*Created: January 25, 2026*
*Status: PRD Draft*
