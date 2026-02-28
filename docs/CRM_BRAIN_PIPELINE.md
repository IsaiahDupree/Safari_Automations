# CRM Brain Pipeline

AI-powered relationship management pipeline built on top of Safari Automation.  
Script: `scripts/crm_brain.py`

---

## Architecture

```
Safari Automation Services
  Instagram DM  :3001 (no auth) / :3100 (auth middleware)
  Twitter DM    :3003
  TikTok DM     :3102
  LinkedIn DM   :3105
        │
        ▼
crm_brain.py ──► Supabase (ivhfuhxorppptyuofbgq)
        │          crm_contacts
        │          crm_conversations
        │          crm_messages
        │          crm_message_queue
        │          crm_score_history
        │          linkedin_prospects
        ▼
  Anthropic Claude API
  (scoring + message generation)
```

---

## CLI Commands

```bash
# Pull all platform conversations → Supabase
python3 scripts/crm_brain.py --sync

# Import linkedin_prospects → crm_contacts
python3 scripts/crm_brain.py --sync-linkedin

# AI-score contacts 0–100 via Claude
python3 scripts/crm_brain.py --score
python3 scripts/crm_brain.py --score --limit=10

# Generate brand-aligned messages for top contacts
python3 scripts/crm_brain.py --generate

# Send pending queue items (all contacts)
python3 scripts/crm_brain.py --send

# Send only to TEST_CONTACT (Isaiah Dupree — safe for testing)
python3 scripts/crm_brain.py --send-test

# Full pipeline: sync → score → generate → send
python3 scripts/crm_brain.py --pipeline

# Dashboard
python3 scripts/crm_brain.py --status

# Review a specific contact
python3 scripts/crm_brain.py --review "sarah ashley"
```

---

## Data Model

### `crm_contacts`
| Field | Description |
|---|---|
| `id` | UUID |
| `display_name` | Human-readable name |
| `platform` | instagram / twitter / tiktok / linkedin |
| `username` | Handle (without @) |
| `relationship_score` | 0–100 AI score |
| `relationship_stage` | cold / warm / hot / customer |
| `last_message` | Last message preview |
| `offer_readiness` | 0–100 buying signal score |

### `crm_conversations`
Linked to `crm_contacts` via `contact_id`. Stores conversation threads per platform.

### `crm_message_queue`
Pending messages ready to send. Status: `pending` → `sent` / `failed`.

### `crm_score_history`
Time-series log of AI score changes per contact.

### `linkedin_prospects`
Pipeline stages: `new` → `qualified/not_fit` → `connection_sent` → `connected` → `messaged` → `responded` → `booked` → `closed_won/closed_lost`

---

## Sync Pipeline

`--sync` calls each platform service and pulls conversations:

| Platform | Service Port | Collect Method |
|---|---|---|
| Instagram | 3001 | `GET /api/messages/conversations` |
| Twitter | 3003 | `GET /api/twitter/messages/conversations` |
| TikTok | 3102 | `GET /api/tiktok/messages/conversations` |
| LinkedIn | 3105 | `GET /api/linkedin/conversations` |

**Key field mappings discovered:**
- LinkedIn: uses `participantName` (not `name`)
- Defensive resolution order: `participantName → displayName → username → name → handle`
- `_safe_ts()` sanitizes human-readable dates (`Feb 22`, `Jan 5`) → ISO timestamps
- Upsert replaced with find+update/insert for `crm_conversations` (Supabase on_conflict limitation)

---

## AI Scoring (Claude)

`--score` sends contact profile + message history to Anthropic Claude API and stores:
- Relationship score (0–100)
- Offer readiness (0–100)  
- Stage classification
- Recommended next action

Requires `ANTHROPIC_API_KEY` in `.env`.

---

## Message Generation

`--generate` uses Claude to write brand-aligned outreach messages for contacts in the queue.  
Brand voice: direct, value-first, relationship-driven.

---

## State (as of Feb 2026)

- **520 CRM contacts**: IG: 63 | TikTok: 107 | Twitter: 6 | LinkedIn: 344
- **55 LinkedIn prospects**: 19 qualified, 36 not_fit
- **8 pending messages** in queue (AI-generated)
- **12 LinkedIn conversations** synced clean

---

## Target Contacts

| Contact | Platform | Handle/URL |
|---|---|---|
| Sarah E Ashley | Instagram | `saraheashley_` |
| Sarah E Ashley | Twitter | `saraheashley` |
| Sarah E Ashley | TikTok | `Sarah E Ashley` (display name, squish → `saraheashley`) |
| Isaiah Dupree | Instagram | `the_isaiah_dupree` |
| Isaiah Dupree | LinkedIn | `https://www.linkedin.com/in/the-isaiah-dupree` |

> **Rule**: DM Sarah on IG/TW/TT. DM Isaiah on LinkedIn only. Never DM Sarah on LinkedIn.
