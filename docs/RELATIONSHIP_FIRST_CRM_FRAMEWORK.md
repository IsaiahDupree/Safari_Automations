# Relationship-First CRM Framework
## Inspired by Revio (getrevio.com) + Trust-Based Sales Best Practices

> **Goal**: Maximize LTV, retention, and real friendship while creating clean "permissioned" moments to offer help.

---

## 1. Core Philosophy

**The vibe**: You're not "closing," you're building trust momentum.

### 3 Non-Negotiables
1. **Consent > Conversion**: Ask before advising, pitching, or booking
2. **Micro-wins > Big Promises**: Tiny help delivered fast beats "let's hop on a call"
3. **Reliability is the Product**: Follow-ups, sending resources, remembering details

### The 3:1 Rule
For every 1 offer touch, do 3 relationship/value touches first.

---

## 2. Relationship Card (Track Per Person)

```typescript
interface RelationshipCard {
  // Identity
  name: string;
  handle: string;
  timezone?: string;
  howWeMet?: string;
  
  // Current State
  whatTheyreBuilding?: string;
  currentFriction?: string;        // repeating pain
  definitionOfWin30Days?: string;
  
  // Constraints
  constraints?: {
    time?: string;
    budget?: string;
    energy?: string;
    toolsTheyUse?: string[];
  };
  
  // Communication Style
  preferredStyle?: 'voice_notes' | 'short_texts' | 'long_form' | 'calls';
  doNotDo?: string[];              // "hates calls", "no spam"
  
  // Trust Signals
  trustSignals?: {
    asksOpinion: boolean;
    sharesUpdates: boolean;
    refersOthers: boolean;
  };
  
  // Tracking
  lastMeaningfulTouch?: Date;
  nextPlannedTouch?: Date;
  valueDeliveredLog?: ValueDelivery[];
}

interface ValueDelivery {
  date: Date;
  type: 'link' | 'intro' | 'template' | 'feedback' | 'resource';
  description: string;
}
```

---

## 3. Relationship Health Score (0-100)

**Score tells you who needs care, not who needs a pitch.**

| Factor | Weight | Signal |
|--------|--------|--------|
| **Recency** | 20% | Days since meaningful touch |
| **Resonance** | 20% | Depth of replies (details/emotion > "lol") |
| **Need Clarity** | 15% | Do you understand their goal + pain? |
| **Value Delivered** | 20% | Have you helped lately? |
| **Reliability** | 15% | Did you do what you said? |
| **Consent** | 10% | Do they welcome updates/offers? |

### Score Interpretation

| Score | Action |
|-------|--------|
| 80-100 | Nurture + light collaboration, ask what they're focused on |
| 60-79 | Deliver a micro-win, capture context, establish cadence |
| 40-59 | Re-warm gently (story reply + one question) |
| <40 | Don't chase — leave kind open loop, re-engage later |

---

## 4. Pipeline Stages (Relationship-First)

```
1. First Touch
   ↓
2. Context Captured (you know what they're up to)
   ↓
3. Micro-Win Delivered
   ↓
4. Cadence Established (light ongoing touch)
   ↓
5. Trust Signals (they ask your opinion / refer / share personal updates)
   ↓
6. Fit Repeats (same pain shows up 2-3 times)
   ↓
7. Permissioned Offer
   ↓
8. Post-Win Expansion (retention + referrals + friendship)
```

**Golden Trigger to Offer**: 
- "Fit repeats" + "They've accepted help before" + "They ask what you'd do"

---

## 5. Next-Best-Action Templates

### Lane A — Friendship (No Business)

| ID | Type | Template |
|----|------|----------|
| A1 | Check-in | "yo—how'd that thing go from last week?" |
| A2 | Celebrate | "ok that's a real win. what do you think made it click?" |
| A3 | Remembered Detail | "random but i remembered you said you were aiming for ___ — still the plan?" |

### Lane B — Service (Value-First)

| ID | Type | Template |
|----|------|----------|
| B1 | Permission to Help | "want ideas or just want to vent?" |
| B2 | Micro-Win Offer | "if i send you a quick template/checklist for that, would it help?" |
| B3 | Fast Feedback | "send the screenshot/link — i'll tell you the 1 thing i'd fix first" |
| B4 | Intro Offer | "i know someone doing that well. want an intro?" |
| B5 | Resource Drop | "this might save you time: [link]. if you tell me your setup i'll tailor it." |

### Lane C — Offer (Only Permissioned)

| ID | Type | Template |
|----|------|----------|
| C1 | Soft Fit Mirror | "you've mentioned ___ a couple times — feels like that's the bottleneck." |
| C2 | Permissioned Offer | "want me to show you a simple way i solve that? no pressure." |
| C3 | Two-Path Offer | "do you want a quick suggestion, or do you want me to actually help you implement it?" |
| C4 | Call Offer | "cool — wanna do 15 min and i'll map the fastest path?" |

### Lane D — Retention (After Client)

| ID | Type | Template |
|----|------|----------|
| D1 | Post-Win Care | "how's it feeling now that ___ is live? anything still annoying?" |
| D2 | Value Drop | "i found a tweak that might boost results — want it?" |
| D3 | Review + Story | "what part felt most helpful? i'm tightening the playbook." |
| D4 | Referral (No Pressure) | "if you know anyone stuck on ___ i'm happy to help them too." |

### Lane E — Re-Warm (When Quiet)

| ID | Type | Template |
|----|------|----------|
| E1 | Low-Friction Re-open | "no rush to reply — what are you focused on this month?" |
| E2 | Help-First Nudge | "saw this and thought of you: [link]. want the 30-sec takeaway?" |

---

## 6. Fit Signals: When to Offer Which Product

### EverReach (Personal CRM / Relationship OS)

**Fit Signals**:
- "i keep forgetting to follow up"
- "my network is messy"
- "i lost track of mentors/clients"
- "i hate feeling like i'm spamming people"

**Offer Line**: "i built a relationship OS for this—want a quick look when it's ready?"

### MatrixLoop.app (Meta Performance / Coaching Analytics)

**Fit Signals**:
- "my posts aren't converting"
- "i don't know what content is working"
- "i need a repeatable system"

**Offer Line**: "want me to show you a simple way to track what's actually moving the needle?"

### KeywordRadar.app (Keyword + Trend Discovery)

**Fit Signals**:
- "i don't know what to post"
- "i need better topics/hooks"
- "seo feels random"

**Offer Line**: "want a list of topics/hooks tailored to your niche that you can post this week?"

### Services (Automation / Systems / Web Apps)

**Fit Signals**:
- "this is taking me forever"
- "i'm drowning in manual work"
- "i need a system"

**Offer Line**: "if you want, i can either (a) give you a quick blueprint, or (b) build the automation with you."

---

## 7. Weekly Operating Cadence

### Daily (Light)
- Reply to stories
- "how's it going" check-ins for hot relationships

### Weekly (Structured)
- **10 people**: Send a micro-win, resource, or intro
- **10 people**: Ask a curiosity question
- **5 people**: Permissioned offer (only if fit)

### Monthly (Deep)
- "catch-up / reflection" messages
- Ask: "what are you focused on next month?"

---

## 8. Metrics That Predict Long Relationships

| Metric | Why It Matters |
|--------|----------------|
| Meaningful replies per week | Engagement quality |
| % contacts with context cards filled | Relationship depth |
| Micro-wins delivered per month | Value given |
| Time-to-follow-up | Reliability signal |
| Permissioned offers accepted | Trust indicator |
| Referrals / introductions | Ultimate trust signal |

---

## 9. JSON Config for Agent/CRM

```json
{
  "relationship_score": {
    "recency": {"weight": 20, "signal": "days_since_meaningful_touch"},
    "resonance": {"weight": 20, "signal": "reply_depth"},
    "need_clarity": {"weight": 15, "signal": "goal_pain_known"},
    "value_delivered": {"weight": 20, "signal": "wins_last_30_days"},
    "reliability": {"weight": 15, "signal": "promises_kept_rate"},
    "consent": {"weight": 10, "signal": "opt_in_level"}
  },
  "templates": [
    {"id": "A1", "lane": "friendship", "stage": "any", "text": "yo—how'd that thing go from last week?"},
    {"id": "A2", "lane": "friendship", "stage": "any", "text": "ok that's a real win. what do you think made it click?"},
    {"id": "B1", "lane": "service", "stage": "context", "text": "want ideas or just want to vent?"},
    {"id": "B3", "lane": "service", "stage": "micro_win", "text": "send the screenshot/link — i'll tell you the 1 thing i'd fix first"},
    {"id": "C2", "lane": "offer", "stage": "fit_repeats", "text": "want me to show you a simple way i solve that? no pressure."},
    {"id": "C3", "lane": "offer", "stage": "fit_repeats", "text": "do you want a quick suggestion, or do you want me to actually help you implement it?"},
    {"id": "D1", "lane": "retention", "stage": "post_win", "text": "how's it feeling now that ___ is live? anything still annoying?"},
    {"id": "E1", "lane": "rewarm", "stage": "cold", "text": "no rush to reply — what are you focused on this month?"}
  ],
  "offer_fit": {
    "everreach": ["follow_up_messy", "relationship_management", "network_messy", "dont_want_to_spam"],
    "matrixloop": ["content_not_converting", "need_repeatable_system", "wants_analytics"],
    "keywordradar": ["dont_know_what_to_post", "needs_topics_hooks", "seo_uncertainty"],
    "services": ["manual_overload", "needs_automation", "needs_system_build"]
  }
}
```

---

## 10. Revio Feature Reference

### What Revio Does (getrevio.com)

| Feature | Description |
|---------|-------------|
| **Follower Scraping** | Scrapes IG/FB followers to build lead universe |
| **AI Lead Scoring** | Ranks prospects by conversion likelihood |
| **Automated Outbound DMs** | Sends messages to qualified followers |
| **Social CRM Inbox** | Centralizes all DMs in one place |
| **AI Copilot** | Suggests next-best reply based on successful chats |
| **AI Sales Coach** | Scores conversations, gives feedback to reps |
| **Pipeline Analytics** | Real-time visualization of sales funnel |
| **Personal Audio Follow-ups** | Voice/video messages to revive dead convos |
| **No Shared Logins** | Team works in Revio, not in raw social accounts |

### Revio URLs

- Main site: https://www.getrevio.com
- Feature overview: https://sourceforge.net/software/product/Revio/
- Review: https://www.automateed.com/revio-review
- Comparison: https://ghlextension.com/versus-getrevio.html

---

## 11. Implementation Notes: Safari Automation

### Local Safari Instance

**Pros**:
- Native environment, behaves like real user
- Same IP/network = less flagging risk
- Easy to debug (watch browser in real-time)

**Cons**:
- Machine must stay online
- Doesn't scale for 24/7 or multi-user

**Setup**:
```bash
# Enable Safari WebDriver
safaridriver --enable

# Run automation via Selenium or Playwright
```

### Remote Safari Instance

**Pros**:
- Always-on (cloud Mac VM)
- Scalable
- Can snapshot/reset environment

**Options**:
- MacStadium (dedicated Mac cloud)
- AWS macOS instances
- Selenium Grid with Mac node

**Setup**:
```bash
# On remote Mac, enable remote automation
# Safari > Develop > Allow Remote Automation

# Point WebDriver to remote address
# Use SSH tunnel or VPN for security
```

### Alternative: Playwright WebKit

```bash
# WebKit (Safari's engine) runs headlessly on Linux
npx playwright install webkit
```

This simulates Safari without full Mac GUI.

---

## 12. Technical Architecture for EverReach-Style App

```
┌─────────────────────────────────────────────────────────┐
│                    EverReach CRM                        │
├─────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │
│  │   Safari    │  │  Instagram  │  │  Facebook   │     │
│  │ Automation  │  │  Graph API  │  │ Messenger   │     │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘     │
│         │                │                │             │
│         └────────────────┼────────────────┘             │
│                          ▼                              │
│  ┌─────────────────────────────────────────────────┐   │
│  │              Unified Inbox Layer                │   │
│  │   - Normalize messages from all channels        │   │
│  │   - Match to contact records                    │   │
│  │   - Store conversation history                  │   │
│  └─────────────────────────────────────────────────┘   │
│                          │                              │
│         ┌────────────────┼────────────────┐            │
│         ▼                ▼                ▼            │
│  ┌───────────┐   ┌───────────┐   ┌───────────────┐    │
│  │Relationship│   │    AI     │   │  Pipeline &   │    │
│  │  Scoring  │   │  Copilot  │   │  Analytics    │    │
│  └───────────┘   └───────────┘   └───────────────┘    │
│         │                │                │            │
│         └────────────────┼────────────────┘            │
│                          ▼                              │
│  ┌─────────────────────────────────────────────────┐   │
│  │           Next-Best-Action Engine               │   │
│  │   - Suggests templates based on context         │   │
│  │   - Detects fit signals for offers              │   │
│  │   - Prioritizes who to contact                  │   │
│  └─────────────────────────────────────────────────┘   │
│                          │                              │
│                          ▼                              │
│  ┌─────────────────────────────────────────────────┐   │
│  │                 Supabase DB                     │   │
│  │   - instagram_contacts                          │   │
│  │   - instagram_conversations                     │   │
│  │   - instagram_messages                          │   │
│  │   - relationship_scores                         │   │
│  │   - next_actions                                │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

---

## 13. Key Insights from Research

### Why Relationship-First Works

- **68% of B2B customers leave** due to perceived indifference, not product issues
- **40% revenue growth** reported by companies using customer success platforms
- **30% conversion increase** from automated, personalized follow-ups
- **48% faster close time** with AI-assisted CRM workflows

### Trust-Based Social Selling Best Practices

1. Build personal brand on platform of choice
2. Share valuable content regularly  
3. Listen and engage before pitching
4. Use CRM insights to personalize every touch
5. Balance automation with authenticity

### AI Trends in Relationship Management

- **Predictive analytics**: AI identifies churn risk before customers voice it
- **Personalization at scale**: AI drafts tailored messages for thousands
- **Relationship intelligence**: AI maps connections and suggests warm intros
- **Conversational coaching**: AI analyzes calls and gives real-time feedback

---

## References

- Revio Insight (customer LTV/retention)
- Gainsight research (retention rates)
- HubSpot AI features (deal velocity)
- EveryoneSocial (relationship selling stats)
- getrevio.com (product features)
