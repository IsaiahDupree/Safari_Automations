# PRD: Relationship-First DM Playbook

A relationship-first DM playbook for agents/CRMs like EverReach — built to maximize **LTV, retention, and real friendship** while creating clean "permissioned" moments to offer help.

---

## 1) The Rules (So You Never Feel Pushy)

**The vibe:** You're not "closing," you're **building trust momentum**.

### 3 Non-Negotiables

1. **Consent > Conversion**: Ask before advising, pitching, or booking.
2. **Micro-wins > Big Promises**: Tiny help delivered fast beats "let's hop on a call."
3. **Reliability is the Product**: Follow-ups, sending resources, remembering details.

### The 3:1 Rule
For every 1 offer touch, do **3 relationship/value touches** first.

---

## 2) The "Relationship Card" (What You Track Per Person)

Minimum info to support people like a real friend *and* a pro.

### Relationship Card Fields

| Field | Description |
|-------|-------------|
| **Identity** | Name, handle, timezone, how you met |
| **Building** | What they're building right now |
| **Friction** | Current friction / repeating pain |
| **Win Definition** | Their definition of a win (30 days) |
| **Constraints** | Time, budget, energy, tools they use |
| **Style** | Prefer voice notes? Short texts? Hates calls? |
| **Trust Signals** | Asks your opinion, shares updates, refers others |
| **Touch Log** | Last meaningful touch + next planned touch |
| **Value Log** | Links, intros, templates, feedback delivered |

---

## 3) Relationship Health Score (0–100)

Score = **who needs care**, not who needs a pitch.

### Suggested Weights

| Factor | Weight | Signal |
|--------|--------|--------|
| **Recency** | 20 | Days since meaningful touch |
| **Resonance** | 20 | Depth of replies (details/emotion > "lol") |
| **Need Clarity** | 15 | Do you understand their current goal + pain? |
| **Value Delivered** | 20 | Have you helped lately (resource/intro/feedback)? |
| **Reliability** | 15 | Did you do what you said you'd do? |
| **Consent** | 10 | Do they welcome updates/offers? |

### How to Use the Score

| Score Range | Action |
|-------------|--------|
| **80–100** | Nurture + light collaboration, ask what they're focused on |
| **60–79** | Deliver a micro-win, capture context, establish cadence |
| **40–59** | Re-warm gently (story reply + one question) |
| **<40** | Don't chase — leave a kind open loop, re-engage later |

---

## 4) Pipeline Stages (Relationship-First)

```
1. First Touch
2. Context Captured (you know what they're up to)
3. Micro-Win Delivered
4. Cadence Established (light ongoing)
5. Trust Signals
6. Fit Repeats (same pain shows up 2–3 times)
7. Permissioned Offer
8. Post-Win Expansion (retention + referrals + friendship)
```

### Golden Trigger to Offer
- "Fit repeats" + 
- "They've accepted help before" + 
- "They ask what you'd do"

---

## 5) Next-Best-Action Library (Templates)

Use these like lego bricks. Keep them short. Keep them human.

### Lane A — Friendship (No Business)

| ID | Type | Template |
|----|------|----------|
| A1 | Check-in | "yo—how'd that thing go from last week?" |
| A2 | Celebrate | "ok that's a real win. what do you think made it click?" |
| A3 | Remembered Detail | "random but i remembered you said you were aiming for ___ — still the plan?" |

### Lane B — Service (Value-First)

| ID | Type | Template |
|----|------|----------|
| B4 | Permission to Help | "want ideas or just want to vent?" |
| B5 | Micro-Win Offer | "if i send you a quick template/checklist for that, would it help?" |
| B6 | Fast Feedback | "send the screenshot/link — i'll tell you the 1 thing i'd fix first" |
| B7 | Intro Offer | "i know someone doing that well. want an intro?" |
| B8 | Resource Drop | "this might save you time: [link]. if you tell me your setup i'll tailor it." |

### Lane C — Offer (Only Permissioned)

| ID | Type | Template |
|----|------|----------|
| C9 | Soft Fit Mirror | "you've mentioned ___ a couple times — feels like that's the bottleneck." |
| C10 | Permissioned Offer | "want me to show you a simple way i solve that? no pressure." |
| C11 | Two-Path Offer | "do you want a quick suggestion, or do you want me to actually help you implement it?" |
| C12 | Call Offer (after yes) | "cool — wanna do 15 min and i'll map the fastest path?" |

### Retention (After They Become a Client/Customer)

| ID | Type | Template |
|----|------|----------|
| R13 | Post-Win Care | "how's it feeling now that ___ is live? anything still annoying?" |
| R14 | Value Drop | "i found a tweak that might boost results — want it?" |
| R15 | Review + Story | "what part felt most helpful? i'm tightening the playbook." |
| R16 | Referral (No Pressure) | "if you know anyone stuck on ___ i'm happy to help them too." |

### Re-Warm (When It's Been Quiet)

| ID | Type | Template |
|----|------|----------|
| W17 | Low-Friction Re-open | "no rush to reply — what are you focused on this month?" |
| W18 | Help-First Nudge | "saw this and thought of you: [link]. want the 30-sec takeaway?" |

---

## 6) Fit Signals: When to Offer Which Product

### EverReach (Personal CRM / Relationship OS)

**Fit Signals:**
- "i keep forgetting to follow up"
- "my network is messy"
- "i lost track of mentors/clients"
- "i hate feeling like i'm spamming people"

**Permissioned Offer Line:**
> "i built a relationship OS for this—want a quick look when it's ready?"

---

### MatrixLoop.app (Meta Performance / Coaching Analytics)

**Fit Signals:**
- "my posts aren't converting"
- "i don't know what content is working"
- "i need a repeatable system"

**Offer Line:**
> "want me to show you a simple way to track what's actually moving the needle?"

---

### KeywordRadar.app (Keyword + Trend Discovery)

**Fit Signals:**
- "i don't know what to post"
- "i need better topics/hooks"
- "seo feels random"

**Offer Line:**
> "want a list of topics/hooks tailored to your niche that you can post this week?"

---

### Services (Automation / Systems / Web Apps)

**Fit Signals:**
- "this is taking me forever"
- "i'm drowning in manual work"
- "i need a system"

**Offer Line:**
> "if you want, i can either (a) give you a quick blueprint, or (b) build the automation with you."

---

## 7) Agent Configuration JSON

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
    {"id": "A3", "lane": "friendship", "stage": "any", "text": "random but i remembered you said you were aiming for ___ — still the plan?"},
    {"id": "B4", "lane": "service", "stage": "context", "text": "want ideas or just want to vent?"},
    {"id": "B5", "lane": "service", "stage": "context", "text": "if i send you a quick template/checklist for that, would it help?"},
    {"id": "B6", "lane": "service", "stage": "micro_win", "text": "send the screenshot/link — i'll tell you the 1 thing i'd fix first"},
    {"id": "B7", "lane": "service", "stage": "micro_win", "text": "i know someone doing that well. want an intro?"},
    {"id": "B8", "lane": "service", "stage": "micro_win", "text": "this might save you time: [link]. if you tell me your setup i'll tailor it."},
    {"id": "C9", "lane": "offer", "stage": "fit_repeats", "text": "you've mentioned ___ a couple times — feels like that's the bottleneck."},
    {"id": "C10", "lane": "offer", "stage": "fit_repeats", "text": "want me to show you a simple way i solve that? no pressure."},
    {"id": "C11", "lane": "offer", "stage": "fit_repeats", "text": "do you want a quick suggestion, or do you want me to actually help you implement it?"},
    {"id": "C12", "lane": "offer", "stage": "permissioned", "text": "cool — wanna do 15 min and i'll map the fastest path?"},
    {"id": "R13", "lane": "retention", "stage": "post_win", "text": "how's it feeling now that ___ is live? anything still annoying?"},
    {"id": "R14", "lane": "retention", "stage": "post_win", "text": "i found a tweak that might boost results — want it?"},
    {"id": "R15", "lane": "retention", "stage": "post_win", "text": "what part felt most helpful? i'm tightening the playbook."},
    {"id": "R16", "lane": "retention", "stage": "post_win", "text": "if you know anyone stuck on ___ i'm happy to help them too."},
    {"id": "W17", "lane": "rewarm", "stage": "cold", "text": "no rush to reply — what are you focused on this month?"},
    {"id": "W18", "lane": "rewarm", "stage": "cold", "text": "saw this and thought of you: [link]. want the 30-sec takeaway?"}
  ],
  "offer_fit": {
    "everreach": [
      "follow_up_messy",
      "relationship_management",
      "network_messy",
      "dont_want_to_spam"
    ],
    "matrixloop": [
      "content_not_converting",
      "need_repeatable_system",
      "wants_analytics"
    ],
    "keywordradar": [
      "dont_know_what_to_post",
      "needs_topics_hooks",
      "seo_uncertainty"
    ],
    "services": [
      "manual_overload",
      "needs_automation",
      "needs_system_build"
    ]
  }
}
```

---

## 8) Weekly Operating System

### Daily (Light Touch)
- Reply to stories
- "How's it going" for hot relationships (score 80+)

### Weekly Targets
| Action | Count | Description |
|--------|-------|-------------|
| Micro-wins | 10 | Send resources, templates, intros, feedback |
| Curiosity | 10 | Ask questions to capture context |
| Permissioned Offers | 5 | Only if fit repeats + trust signals |

### Monthly (Deep)
- "Catch-up / reflection" messages
- "What are you focused on next month?"
- Review value delivered log

---

## 9) Safety Notes (Account Protection)

If you automate outreach on IG/FB, keep it **human-safe**:

- ⚠️ Conservative volumes (don't blast)
- ⚠️ High personalization per message
- ⚠️ Prioritize **reply assistance + prioritization** over aggressive blasting
- ⚠️ Warm up accounts gradually
- ⚠️ Respect platform rate limits

---

## 10) Future Extensions

- [ ] 25-template library tagged by stage + lane + intent
- [ ] Next-best-action decision tree for agent auto-selection
- [ ] Relationship health score auto-calculation from conversation history
- [ ] Integration with existing engagement automation

---

*Created: January 25, 2026*
*Status: PRD - Relationship-First DM Playbook*
