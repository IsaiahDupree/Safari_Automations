# PRD: DM Outreach & Prospect Management System

**Version:** 1.0  
**Date:** January 26, 2026  
**Status:** Implementation Ready  
**Priority:** High  
**Extends:** PRD_Relationship_First_DM_System.md

---

## Executive Summary

A systematic approach to finding, managing, and nurturing DM prospects across all platforms and accounts. The system prioritizes long-term relationship building over immediate sales, while strategically presenting offers when prospects demonstrate genuine need.

### Core Philosophy
```
Find → Add to List → Build Trust → Experience Life Together → Offer When Ready
```

---

## System Architecture

### Prospect Pipeline

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    DM OUTREACH PIPELINE                                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  DISCOVERY                    QUALIFICATION                OUTREACH     │
│  ┌────────────┐              ┌────────────┐              ┌────────────┐ │
│  │ Platform   │──────────────▶│ Fit Score  │──────────────▶│ DM List   │ │
│  │ Scrapers   │              │ Calculator │              │ Manager   │ │
│  └────────────┘              └────────────┘              └────────────┘ │
│        │                           │                           │        │
│        ▼                           ▼                           ▼        │
│  ┌────────────┐              ┌────────────┐              ┌────────────┐ │
│  │ Comment    │              │ Offer      │              │ Sequence   │ │
│  │ Engagers   │              │ Matcher    │              │ Engine     │ │
│  └────────────┘              └────────────┘              └────────────┘ │
│        │                           │                           │        │
│        ▼                           ▼                           ▼        │
│  ┌────────────┐              ┌────────────┐              ┌────────────┐ │
│  │ Follower   │              │ Priority   │              │ Trust      │ │
│  │ Analyzer   │              │ Scorer     │              │ Tracker    │ │
│  └────────────┘              └────────────┘              └────────────┘ │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Requirements

### DM-OUT-001: Prospect Discovery
**Priority:** P0 (Critical)

Find potential DM targets across all platforms and accounts.

#### Discovery Sources

| Source | Platform | Method |
|--------|----------|--------|
| Comment Engagers | All | People who commented on your posts |
| Post Likers | IG, TikTok | High-engagement likers |
| Follower Analysis | All | New followers with aligned interests |
| Competitor Followers | All | People following similar creators |
| Hashtag Searchers | IG, TikTok, Twitter | Users engaging with relevant hashtags |
| Content Viewers | TikTok, YouTube | Video viewers with watch time |

#### Account Mapping

```python
# Per Platform, Per Account structure
ACCOUNTS = {
    "instagram": [
        {"id": 807, "username": "@the_isaiah_dupree", "offers": ["coaching", "course"]},
        {"id": 670, "username": "@the_isaiah_dupree_", "offers": ["affiliate"]},
    ],
    "tiktok": [
        {"id": 710, "username": "@isaiah_dupree", "offers": ["coaching"]},
        {"id": 243, "username": "@the_isaiah_dupree", "offers": ["course"]},
    ],
    "twitter": [
        {"id": 4151, "username": "@IsaiahDupree7", "offers": ["consulting"]},
    ]
}
```

---

### DM-OUT-002: Prospect Qualification
**Priority:** P0 (Critical)

Score and qualify prospects before adding to DM list.

#### Fit Score Calculation

| Signal | Weight | Description |
|--------|--------|-------------|
| Engagement Quality | 25% | Thoughtful comments vs emoji-only |
| Profile Alignment | 20% | Bio keywords, interests match |
| Follower Count | 15% | Sweet spot: 500-50K (not bots, not celebrities) |
| Activity Level | 15% | Posts frequently, active account |
| Offer Fit | 15% | Pain points match available offers |
| Previous Interaction | 10% | Already replied, liked, or engaged |

#### Offer Matching

```python
OFFERS = {
    "coaching": {
        "price_range": "$500-$5000",
        "fit_signals": ["struggling", "stuck", "need help", "how do you"],
        "disqualifiers": ["just browsing", "no budget"]
    },
    "course": {
        "price_range": "$97-$497",
        "fit_signals": ["learning", "beginner", "how to start"],
        "disqualifiers": ["already expert", "just curious"]
    },
    "affiliate": {
        "price_range": "varies",
        "fit_signals": ["what tool", "recommend", "use for"],
        "disqualifiers": []
    },
    "consulting": {
        "price_range": "$1000-$10000",
        "fit_signals": ["business", "agency", "team", "scale"],
        "disqualifiers": ["hobby", "just starting"]
    }
}
```

---

### DM-OUT-003: DM List Management
**Priority:** P0 (Critical)

Organize prospects into actionable DM lists.

#### List Structure

| Field | Description |
|-------|-------------|
| prospect_id | Unique identifier |
| platform | instagram, tiktok, twitter, etc. |
| account_id | Which of your accounts found them |
| username | Their @handle |
| display_name | Their display name |
| source | How they were discovered |
| fit_score | 0-100 qualification score |
| offer_match | Best matching offer |
| status | new, contacted, replied, nurturing, converted, churned |
| last_interaction | Timestamp of last touch |
| next_action_date | When to reach out next |
| notes | Context and conversation notes |

#### List Views

1. **Ready to Contact** - New prospects, never contacted
2. **Awaiting Reply** - Contacted, waiting for response
3. **Active Conversations** - Ongoing dialogue
4. **Nurturing** - Long-term relationship building
5. **Ready for Offer** - High trust, showing need
6. **Converted** - Became customers
7. **Archived** - Not a fit or unresponsive

---

### DM-OUT-004: Outreach Sequencing
**Priority:** P0 (Critical)

Systematic message cadence for trust building.

#### Trust Building Phases

```
Phase 1: INTRODUCTION (Day 0-7)
├── First touch: Genuine compliment or question
├── Wait for reply
└── Goal: Get a response, start conversation

Phase 2: VALUE DELIVERY (Day 7-30)
├── Share helpful content
├── Answer their questions
├── Engage with their content
└── Goal: Become a familiar, helpful presence

Phase 3: RELATIONSHIP DEEPENING (Day 30-90)
├── Personal conversations
├── Share struggles and wins
├── Celebrate their milestones
└── Goal: Genuine connection

Phase 4: OFFER INTRODUCTION (When Ready)
├── Only when they express need
├── Position as solution to their problem
├── No pressure, always option to continue relationship
└── Goal: Help them if they want it
```

#### Message Templates by Phase

**Phase 1 - Introduction:**
```
- "Hey {name}! Loved your comment on my post about {topic}. What made that resonate with you?"
- "Your content on {their_topic} is 🔥! How long have you been creating?"
- "Saw you're into {interest} too! What got you started?"
```

**Phase 2 - Value:**
```
- "Thought you might find this helpful based on what you shared: {resource}"
- "I noticed you're working on {their_goal}. Here's something that helped me: {tip}"
- "Quick tip on {topic} since I know you're interested: {insight}"
```

**Phase 3 - Relationship:**
```
- "How's the {their_project} going? Any wins to celebrate?"
- "Been thinking about what you said about {topic}. Here's my take..."
- "Saw your post about {milestone} - congrats! That's huge."
```

**Phase 4 - Offer:**
```
- "You mentioned struggling with {pain_point}. I actually help people with exactly that..."
- "Based on everything you've shared, I think {offer} might be perfect for you. Want details?"
- "No pressure at all, but I wanted to let you know about {offer} since it addresses {their_need}."
```

---

### DM-OUT-005: Experience Life Together
**Priority:** P1 (High)

Track and participate in prospects' life events.

#### Life Event Tracking

| Event Type | Action |
|------------|--------|
| Birthday | Send wishes, maybe small gift |
| Achievement | Celebrate publicly and privately |
| Struggle | Offer support, check in |
| Launch | Support, share, engage |
| Milestone | Acknowledge, celebrate |
| Life Change | Be present, offer perspective |

#### Engagement Actions

- Comment on their posts (3-5x per week for nurturing contacts)
- Like their content regularly
- Share their wins in stories
- Reply to their stories
- Remember personal details from conversations

---

### DM-OUT-006: Offer Timing Intelligence
**Priority:** P1 (High)

Detect optimal moments to introduce offers.

#### Ready Signals

| Signal | Weight | Description |
|--------|--------|-------------|
| Explicitly asks for help | 40% | "How do I...", "Can you help..." |
| Expresses frustration | 20% | "I'm stuck", "Nothing's working" |
| Shows buying intent | 15% | "How much...", "Do you offer..." |
| Hits a wall | 15% | Tried everything, needs guidance |
| Time pressure | 10% | Deadline, urgent need |

#### Not Ready Signals

| Signal | Action |
|--------|--------|
| Just curious | Continue value delivery |
| No budget mentioned | Keep nurturing |
| Happy with current solution | Stay connected |
| Not in target demographic | Archive or refer |

---

## Database Schema

```sql
-- Prospects discovered from various sources
CREATE TABLE dm_prospects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    platform TEXT NOT NULL,
    account_id INTEGER NOT NULL,
    username TEXT NOT NULL,
    display_name TEXT,
    bio TEXT,
    follower_count INTEGER DEFAULT 0,
    following_count INTEGER DEFAULT 0,
    post_count INTEGER DEFAULT 0,
    profile_url TEXT,
    avatar_url TEXT,
    
    -- Discovery
    source TEXT NOT NULL, -- comment, follower, competitor, hashtag
    source_post_id TEXT,
    source_comment TEXT,
    discovered_at TIMESTAMP DEFAULT NOW(),
    
    -- Qualification
    fit_score INTEGER DEFAULT 0,
    offer_match TEXT,
    qualified BOOLEAN DEFAULT FALSE,
    
    -- Metadata
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    UNIQUE(platform, username)
);

-- DM list entries for outreach
CREATE TABLE dm_list (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    prospect_id UUID REFERENCES dm_prospects(id),
    
    -- Status
    status TEXT DEFAULT 'new', -- new, contacted, replied, nurturing, offer_ready, converted, archived
    phase TEXT DEFAULT 'introduction', -- introduction, value, relationship, offer
    
    -- Tracking
    first_contact_at TIMESTAMP,
    last_interaction_at TIMESTAMP,
    next_action_date DATE,
    interaction_count INTEGER DEFAULT 0,
    
    -- Trust metrics
    trust_score INTEGER DEFAULT 0,
    response_rate FLOAT DEFAULT 0,
    
    -- Notes
    notes TEXT,
    tags TEXT[] DEFAULT '{}',
    
    -- Assignment
    assigned_to TEXT,
    
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Individual DM messages sent/received
CREATE TABLE dm_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dm_list_id UUID REFERENCES dm_list(id),
    
    direction TEXT NOT NULL, -- sent, received
    content TEXT NOT NULL,
    message_type TEXT DEFAULT 'text', -- text, image, voice, video
    
    -- Template tracking
    template_id TEXT,
    phase TEXT,
    
    -- Platform data
    platform_message_id TEXT,
    
    sent_at TIMESTAMP DEFAULT NOW(),
    read_at TIMESTAMP,
    replied_at TIMESTAMP
);

-- Offers and their assignments
CREATE TABLE dm_offers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    price_range TEXT,
    offer_type TEXT, -- coaching, course, affiliate, consulting
    fit_signals TEXT[] DEFAULT '{}',
    disqualifiers TEXT[] DEFAULT '{}',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Track which offers are available per account
CREATE TABLE account_offers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    platform TEXT NOT NULL,
    account_id INTEGER NOT NULL,
    offer_id UUID REFERENCES dm_offers(id),
    priority INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT NOW(),
    
    UNIQUE(platform, account_id, offer_id)
);
```

---

## API Endpoints

```
# Discovery
POST   /api/dm-outreach/discover              # Run discovery for platform/account
GET    /api/dm-outreach/prospects             # List discovered prospects
GET    /api/dm-outreach/prospects/{id}        # Get prospect details

# DM List
GET    /api/dm-outreach/list                  # Get DM list with filters
POST   /api/dm-outreach/list/add              # Add prospect to DM list
PUT    /api/dm-outreach/list/{id}/status      # Update status
PUT    /api/dm-outreach/list/{id}/phase       # Update phase
GET    /api/dm-outreach/list/ready            # Get prospects ready to contact

# Messaging
POST   /api/dm-outreach/list/{id}/message     # Send DM
GET    /api/dm-outreach/list/{id}/messages    # Get conversation history
POST   /api/dm-outreach/list/{id}/note        # Add note

# Offers
GET    /api/dm-outreach/offers                # List offers
POST   /api/dm-outreach/offers                # Create offer
PUT    /api/dm-outreach/offers/{id}           # Update offer
GET    /api/dm-outreach/accounts/{platform}/{id}/offers  # Get offers for account

# Analytics
GET    /api/dm-outreach/stats                 # Outreach statistics
GET    /api/dm-outreach/funnel                # Funnel metrics
```

---

## File Structure

```
Backend/services/dm_outreach/
├── __init__.py
├── prospect_finder.py       # Discovery across platforms
├── dm_list_manager.py       # DM list CRUD operations
├── outreach_sequencer.py    # Message cadence and timing
├── offer_matcher.py         # Match prospects to offers
├── trust_tracker.py         # Track relationship progress
└── message_templates.py     # Template library

Backend/api/endpoints/
└── dm_outreach.py           # API endpoints

dashboard/app/(dashboard)/dm-outreach/
└── page.tsx                 # Outreach dashboard
```

---

## Integration Points

| System | Integration |
|--------|-------------|
| Relationship CRM | Sync contacts, share trust scores |
| Community Inbox | Import comment/DM engagers |
| Safari Automation | Send DMs via browser automation |
| Blotato Accounts | Map accounts to offers |
| Analytics | Track conversion metrics |

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Response Rate | 30%+ |
| Conversation to Offer Rate | 10%+ |
| Offer to Conversion Rate | 20%+ |
| Average Trust-to-Offer Time | 30-90 days |
| Monthly New Prospects | 500+ |
| Monthly Conversations | 100+ |
