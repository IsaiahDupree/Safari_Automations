# AAG Agent 08 — Email Outreach Integration ✅ COMPLETE

## What Was Built

Complete email outreach system with:

### 1. **Email Discovery** (`email/discovery.py`)
Multi-source email discovery with priority order:
- ✅ LinkedIn profile scraping (port 3105)
- ✅ Website email scraper (contact/about pages)
- ✅ Pattern guesser (firstname@domain, etc.)
- ✅ Perplexity AI search
- ✅ MX/SMTP email verification

### 2. **Resend API Client** (`email/resend_client.py`)
- ✅ Async email sending via Resend API
- ✅ Error handling (422 invalid email, 429 rate limit)
- ✅ Email status tracking

### 3. **Email Generator** (`email/generator.py`)
- ✅ Claude-powered 3-touch sequences
  - Touch 1: Value-first introduction (Sonnet 3.5)
  - Touch 2: Case study/proof (Haiku 3)
  - Touch 3: Direct CTA (Haiku 3)
- ✅ SPAM word blacklist validation
- ✅ Subject/body length validation
- ✅ HTML template wrapping
- ✅ CAN-SPAM compliance (unsubscribe link, physical address)

### 4. **HTML Email Template** (`email/templates/base.html`)
- ✅ Responsive design (max-width 600px)
- ✅ CAN-SPAM footer with unsubscribe link
- ✅ Clean, professional styling

### 5. **IMAP Watcher** (`email/imap_watcher.py`)
- ✅ Monitor inbox for replies
- ✅ Email parsing and extraction
- ✅ Reply detection logic

### 6. **Email Agent Orchestrator** (`email_agent.py`)
Main orchestrator with three core methods:

**`discover_emails(limit, dry_run)`**
- Finds emails for qualified contacts
- Tries all discovery sources in priority order
- Verifies discovered emails
- Saves to `acq_email_discoveries`

**`schedule_sequences(limit, service_slug)`**
- Schedules 3-touch email sequences
- Touch 1: Immediate
- Touch 2: +4 days
- Touch 3: +11 days

**`send_pending(limit, dry_run)`**
- Sends up to 30 emails/day (configurable)
- Generates content with Claude if not pre-generated
- Validates before sending
- Tracks sends in CRM
- Respects daily caps and opt-outs

### 7. **API Routes** (`api/routes/email.py`)
- ✅ `POST /api/acquisition/email/webhooks/resend` — Webhook handler
  - email.opened → Update opened_at
  - email.clicked → Update clicked_at
  - email.bounced → Mark bounced, switch to DM
  - email.complained → Unsubscribe, opt out
- ✅ `GET /api/acquisition/email/unsubscribe?token={jwt}` — Unsubscribe handler
  - JWT token validation
  - Contact opt-out
  - Cancel pending sequences
  - Professional HTML response
- ✅ Manual trigger endpoints:
  - `POST /api/acquisition/email/discover`
  - `POST /api/acquisition/email/schedule`
  - `POST /api/acquisition/email/send`

### 8. **Database Queries** (`db/queries.py`)
Added 15+ new query functions:
- ✅ `upsert_email_discovery()`
- ✅ `update_contact_email()`
- ✅ `get_email_sequences_for_contact()`
- ✅ `get_contact()`
- ✅ `check_daily_cap()`
- ✅ `update_email_draft()`
- ✅ `update_email_sent()`
- ✅ `update_email_opened()`
- ✅ `update_email_clicked()`
- ✅ `insert_crm_message()`
- ✅ `insert_unsubscribe()`
- ✅ `set_email_opted_out()`
- ✅ `cancel_pending_email_sequences()`
- ✅ `set_email_unverified()`
- ✅ And more...

### 9. **Comprehensive Tests** (`tests/test_email_agent.py`)
- ✅ Email validator tests (spam words, length, caps, exclamations)
- ✅ Resend client error handling (422, 429)
- ✅ Email discovery and verification
- ✅ MX validator tests
- ✅ Unsubscribe token roundtrip
- ✅ Daily cap enforcement
- ✅ Opted-out contact skipping
- ✅ Email generator validation

---

## Setup Instructions

### 1. Install Dependencies

```bash
cd scripts/acquisition
pip install -r requirements.txt
```

### 2. Environment Variables

Add to your `.env`:

```bash
# Email (Agent 08)
RESEND_API_KEY=re_...
FROM_EMAIL=outreach@yourdomain.com
EMAIL_UNSUB_SECRET=your-secret-key-here
COMPANY_ADDRESS="1234 Main St, San Francisco, CA 94102"

# IMAP (for reply detection)
IMAP_HOST=imap.gmail.com
IMAP_USER=your-email@gmail.com
IMAP_PASS=your-app-password

# Perplexity (optional, for email search)
PERPLEXITY_API_KEY=pplx-...
```

### 3. Database Tables

The required tables already exist from Agent 01:
- `acq_email_sequences`
- `acq_email_discoveries`
- `acq_email_unsubscribes`

### 4. Verify Setup

```bash
# Test email discovery (dry run)
python -m acquisition.email_agent discover 5 --dry-run

# Test email scheduling
python -m acquisition.email_agent schedule 5

# Test email sending (dry run)
python -m acquisition.email_agent send 5 --dry-run
```

---

## Usage Examples

### CLI Interface

```bash
# Discover emails for 20 qualified contacts
python -m acquisition.email_agent discover 20

# Schedule 3-touch sequences for 20 contacts
python -m acquisition.email_agent schedule 20

# Send up to 30 pending emails
python -m acquisition.email_agent send 30
```

### Python API

```python
from acquisition.email_agent import EmailAgent

agent = EmailAgent()

# Discover emails
stats = await agent.discover_emails(limit=20)
print(f"Discovered: {stats['verified']} verified emails")

# Schedule sequences
stats = await agent.schedule_sequences(limit=20)
print(f"Scheduled: {stats['scheduled']} sequences")

# Send pending
stats = await agent.send_pending(limit=30)
print(f"Sent: {stats['sent']} emails")
```

### REST API

```bash
# Trigger email discovery
curl -X POST "http://localhost:8000/api/acquisition/email/discover?limit=20"

# Trigger scheduling
curl -X POST "http://localhost:8000/api/acquisition/email/schedule?limit=20"

# Trigger send
curl -X POST "http://localhost:8000/api/acquisition/email/send?limit=30"
```

---

## Daily Schedule Integration

Add to orchestrator cron jobs:

```python
# 7:30 AM - Email discovery
await email_agent.discover_emails(limit=20)

# 9:30 AM - Send scheduled emails
await email_agent.send_pending(limit=30)

# Every 4 hours - Check for replies (future)
# await imap_watcher.fetch_new_replies()
```

---

## Resend Webhook Configuration

Configure webhook in Resend dashboard:

**Webhook URL:** `https://yourdomain.com/api/acquisition/email/webhooks/resend`

**Events to subscribe:**
- `email.opened`
- `email.clicked`
- `email.bounced`
- `email.complained`

---

## Testing

```bash
# Run all tests
cd scripts/acquisition
pytest tests/test_email_agent.py -v

# Run specific test
pytest tests/test_email_agent.py::test_email_validator_rejects_spam_words -v

# Run with coverage
pytest tests/test_email_agent.py --cov=email --cov-report=html
```

---

## Features Implemented (AAG-121 to AAG-150)

✅ **AAG-121**: Resend API integration
✅ **AAG-122**: Email sequence generation (3 touches)
✅ **AAG-123**: Daily cap enforcement (30/day)
✅ **AAG-124**: LinkedIn email extraction
✅ **AAG-125**: Website email scraping
✅ **AAG-126**: Pattern-based email guessing
✅ **AAG-127**: Perplexity email search
✅ **AAG-128**: MX/SMTP email verification
✅ **AAG-129**: Email validation (spam words, length)
✅ **AAG-130**: HTML template with CAN-SPAM compliance
✅ **AAG-131**: Unsubscribe handling (JWT tokens)
✅ **AAG-132**: Webhook handling (opens, clicks, bounces)
✅ **AAG-133**: Bounce detection → switch to DM
✅ **AAG-134**: Spam complaint → auto-unsubscribe
✅ **AAG-135**: IMAP reply detection
✅ **AAG-136**: CRM message tracking
✅ **AAG-137**: Comprehensive test suite

---

## File Structure

```
acquisition/
├── email_agent.py                   # Main orchestrator
├── email/
│   ├── __init__.py                  # Package exports
│   ├── resend_client.py             # Resend API client
│   ├── discovery.py                 # Email discovery + verification
│   ├── generator.py                 # Claude-powered generation
│   ├── imap_watcher.py              # Reply detection
│   └── templates/
│       └── base.html                # Email HTML template
├── api/
│   └── routes/
│       └── email.py                 # API endpoints + webhooks
├── db/
│   └── queries.py                   # Updated with email functions
└── tests/
    └── test_email_agent.py          # Comprehensive tests
```

---

## Next Steps

1. **Test in Production**
   - Send test emails to verify Resend integration
   - Test webhook delivery
   - Verify unsubscribe flow

2. **Connect to Orchestrator (Agent 07)**
   - Add to daily schedule
   - Integrate with pipeline stages

3. **Monitor Performance**
   - Track open rates (via webhooks)
   - Track reply rates (via IMAP watcher)
   - A/B test message variants

4. **Optimize**
   - Tune Claude prompts based on reply rates
   - Adjust daily caps based on engagement
   - Refine email discovery sources

---

## Dependencies on Other Agents

- ✅ **Agent 01 (Foundation)**: Database tables exist
- ⏳ **Agent 05 (Outreach)**: Channel coordinator integration pending
- ⏳ **Agent 07 (Orchestrator)**: Daily schedule integration pending

---

## Status: ✅ READY FOR TESTING

All components built and tested. Ready to integrate with orchestrator and test in production.
