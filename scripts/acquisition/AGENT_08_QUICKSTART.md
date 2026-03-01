# AAG Agent 08 — Email Outreach Quick Start

**Status:** ✅ Production Ready

---

## Prerequisites

```bash
# Required environment variables
export RESEND_API_KEY="re_your_key_here"
export ANTHROPIC_API_KEY="sk-ant-your_key_here"
export FROM_EMAIL="outreach@yourdomain.com"
export EMAIL_UNSUB_SECRET="random-secret-string"
export COMPANY_ADDRESS="123 Main St, City, State ZIP"

# Optional
export PERPLEXITY_API_KEY="pplx_your_key_here"
export IMAP_HOST="imap.gmail.com"
export IMAP_USER="your@email.com"
export IMAP_PASS="app-password"
```

---

## CLI Commands

### 1. Discover Emails
```bash
# Dry run (don't save)
cd scripts && python3 -m acquisition.email_agent discover --dry-run

# Live run (saves discoveries)
cd scripts && python3 -m acquisition.email_agent discover --limit 20

# With custom limit
cd scripts && python3 -m acquisition.email_agent discover 50
```

**What it does:**
- Gets qualified contacts without verified emails
- Tries discovery sources in order: LinkedIn → Website → Pattern → Perplexity
- Verifies emails via MX + SMTP checks
- Saves first verified email per contact
- Updates `crm_contacts.email` and `email_verified=true`

### 2. Schedule 3-Touch Sequences
```bash
# Schedule sequences for contacts with verified emails
cd scripts && python3 -m acquisition.email_agent schedule --limit 20

# With custom limit
cd scripts && python3 -m acquisition.email_agent schedule 50
```

**What it does:**
- Gets contacts in `ready_for_dm` stage with verified emails
- Creates 3 sequences:
  - Touch 1: Immediate send
  - Touch 2: +4 days
  - Touch 3: +11 days (7 days after Touch 2)
- Inserts into `acq_email_sequences` table

### 3. Send Pending Emails
```bash
# Dry run (don't actually send)
cd scripts && python3 -m acquisition.email_agent send --dry-run

# Live send (up to daily cap)
cd scripts && python3 -m acquisition.email_agent send --limit 30

# With custom limit
cd scripts && python3 -m acquisition.email_agent send 10
```

**What it does:**
- Gets pending sequences (scheduled_at <= now)
- Checks daily cap (default: 30/day)
- Generates email if not pre-generated (Claude API)
- Validates for spam words and quality
- Sends via Resend API
- Updates status, increments cap, logs to CRM messages

---

## API Endpoints

### Start API Server
```bash
cd scripts
uvicorn acquisition.api.server:app --port 8000 --reload
```

### Trigger Email Discovery
```bash
curl -X POST "http://localhost:8000/api/acquisition/email/discover?limit=20&dry_run=false"
```

**Response:**
```json
{
  "processed": 20,
  "linkedin": 2,
  "website": 8,
  "pattern": 10,
  "perplexity": 0,
  "verified": 8,
  "saved": 8
}
```

### Schedule Email Sequences
```bash
curl -X POST "http://localhost:8000/api/acquisition/email/schedule?limit=20"
```

**Response:**
```json
{
  "processed": 20,
  "scheduled": 60,
  "errors": []
}
```

### Send Pending Emails
```bash
curl -X POST "http://localhost:8000/api/acquisition/email/send?limit=30&dry_run=false"
```

**Response:**
```json
{
  "processed": 30,
  "sent": 28,
  "skipped_opted_out": 1,
  "skipped_daily_cap": 0,
  "skipped_invalid": 1,
  "errors": []
}
```

### Get Email Status
```bash
curl "http://localhost:8000/api/acquisition/email/status"
```

**Response:**
```json
{
  "pending_sequences": 45,
  "sent_today": 28,
  "cap_limit": 30,
  "cap_usage_pct": 93.3,
  "metrics_7d": {
    "total_sent": 120,
    "open_rate": 42.5,
    "click_rate": 8.3,
    "bounce_rate": 2.1,
    "reply_rate": 12.5,
    "unsubscribe_rate": 0.8
  }
}
```

---

## Testing

### Run All Tests
```bash
cd scripts
python3 -m pytest acquisition/tests/test_email_agent.py -v
```

**Expected:** 19/19 tests pass ✅

### Run Specific Test Category
```bash
# Email validator tests
python3 -m pytest acquisition/tests/test_email_agent.py::test_email_validator -v

# Resend client tests
python3 -m pytest acquisition/tests/test_email_agent.py::test_resend_client -v

# Discovery tests
python3 -m pytest acquisition/tests/test_email_agent.py::test_mx_validator -v
```

---

## Database Queries

### Check Pending Sequences
```sql
SELECT 
  id, contact_id, touch_number, subject, 
  scheduled_at, status
FROM acq_email_sequences
WHERE status = 'pending'
ORDER BY scheduled_at
LIMIT 10;
```

### Check Email Discoveries
```sql
SELECT 
  contact_id, email, source, confidence, 
  verified, discovered_at
FROM acq_email_discoveries
WHERE verified = true
ORDER BY discovered_at DESC
LIMIT 10;
```

### Check Unsubscribes
```sql
SELECT 
  email, contact_id, reason, created_at
FROM acq_email_unsubscribes
ORDER BY created_at DESC
LIMIT 10;
```

### Check Daily Cap Usage
```sql
SELECT 
  action_type, platform, date, count, limit_value
FROM acq_daily_caps
WHERE action_type = 'email'
ORDER BY date DESC
LIMIT 7;
```

---

## Resend Webhook Setup

### 1. Configure in Resend Dashboard
```
Webhook URL: https://yourdomain.com/api/acquisition/email/webhooks/resend
Events: email.opened, email.clicked, email.bounced, email.complained
```

### 2. Test Webhook Locally (ngrok)
```bash
# Start ngrok
ngrok http 8000

# Use ngrok URL in Resend dashboard
https://your-random-id.ngrok.io/api/acquisition/email/webhooks/resend
```

### 3. Monitor Webhooks
```bash
# Check logs
tail -f logs/email_agent.log

# Test webhook manually
curl -X POST http://localhost:8000/api/acquisition/email/webhooks/resend \
  -H "Content-Type: application/json" \
  -d '{
    "type": "email.opened",
    "data": {
      "email_id": "test_123",
      "to": ["test@example.com"]
    }
  }'
```

---

## Cron Jobs

### Install Cron Jobs
```bash
# Edit crontab
crontab -e

# Add these lines:
30 7 * * * cd /path/to/scripts && python3 -m acquisition.email_agent discover 20
30 9 * * * cd /path/to/scripts && python3 -m acquisition.email_agent schedule 20
0 10 * * * cd /path/to/scripts && python3 -m acquisition.email_agent send 30
0 */4 * * * cd /path/to/scripts && python3 -m acquisition.email.imap_watcher
```

### Verify Cron Jobs
```bash
# List installed cron jobs
crontab -l

# Check logs
tail -f /var/log/cron
```

---

## Troubleshooting

### No emails being sent

**Check 1: Daily cap**
```bash
curl http://localhost:8000/api/acquisition/email/status | jq '.cap_usage_pct'
```
If > 100%, wait until midnight UTC for reset.

**Check 2: Pending sequences**
```sql
SELECT COUNT(*) FROM acq_email_sequences WHERE status='pending' AND scheduled_at <= NOW();
```
If 0, run `schedule` command first.

**Check 3: Environment variables**
```bash
echo $RESEND_API_KEY
echo $FROM_EMAIL
```
Ensure both are set.

### Low open rates (<20%)

**Check 1: Spam score**
Test emails at https://www.mail-tester.com/

**Check 2: Subject lines**
```bash
curl http://localhost:8000/api/acquisition/email/status | jq '.metrics_7d.best_subjects'
```
Use top-performing subjects.

**Check 3: Send time**
Most opens occur 9-11 AM local time. Adjust cron schedule.

### High bounce rates (>5%)

**Check 1: Email verification**
```sql
SELECT source, AVG(verified::int) as verify_rate
FROM acq_email_discoveries
GROUP BY source;
```
If website/pattern have low verify_rate, prioritize LinkedIn/Perplexity.

**Check 2: Resend domain reputation**
Check Resend dashboard for domain health score.

### Unsubscribe link not working

**Check 1: JWT secret**
```bash
echo $EMAIL_UNSUB_SECRET
```
Must be set and consistent across deploys.

**Check 2: Test token manually**
```python
from acquisition.api.routes.email import generate_unsub_token, decode_unsub_token

token = generate_unsub_token("contact_123")
print(f"Token: {token}")

decoded = decode_unsub_token(token)
print(f"Decoded: {decoded}")  # Should print "contact_123"
```

---

## Best Practices

### 1. Start with Dry Runs
Always test with `--dry-run` first:
```bash
python3 -m acquisition.email_agent discover --dry-run
python3 -m acquisition.email_agent send --dry-run
```

### 2. Monitor Daily Caps
Check cap usage regularly:
```bash
curl http://localhost:8000/api/acquisition/email/status | jq '.cap_usage_pct'
```

### 3. Review Subject Lines
Track best performers and iterate:
```bash
curl http://localhost:8000/api/acquisition/email/status | jq '.metrics_7d.best_subjects'
```

### 4. Verify Sender Reputation
Check Resend dashboard weekly for:
- Bounce rate (<5%)
- Spam complaint rate (<0.1%)
- Domain reputation score (>80)

### 5. Test Emails First
Send test emails to yourself:
```sql
INSERT INTO acq_email_sequences (id, contact_id, service_slug, touch_number, 
  subject, from_email, to_email, scheduled_at, status)
VALUES (
  gen_random_uuid(),
  'test_contact',
  'ai-content-engine',
  1,
  'Test Subject',
  'outreach@yourdomain.com',
  'your-email@gmail.com',
  NOW(),
  'pending'
);
```

Then run send:
```bash
python3 -m acquisition.email_agent send 1
```

---

## Performance Optimization

### Batch Processing
Process in batches to avoid API rate limits:
```bash
# Instead of: discover 100
# Do:
for i in {1..5}; do
  python3 -m acquisition.email_agent discover 20
  sleep 60
done
```

### Parallel Discovery
Run discovery and scheduling in parallel:
```bash
python3 -m acquisition.email_agent discover 20 &
python3 -m acquisition.email_agent schedule 20 &
wait
```

### Cache Verification Results
Email verification results are cached in `acq_email_discoveries`.
Reuse discoveries:
```sql
SELECT email, verified
FROM acq_email_discoveries
WHERE contact_id = 'contact_123'
ORDER BY discovered_at DESC
LIMIT 1;
```

---

## Security Checklist

- ✅ Set strong `EMAIL_UNSUB_SECRET` (>32 chars random)
- ✅ Never commit API keys to git
- ✅ Use HTTPS for webhook URLs
- ✅ Verify Resend sender email
- ✅ Enable 2FA on Resend account
- ✅ Rotate API keys quarterly
- ✅ Monitor webhook signature validation
- ✅ Review unsubscribe list weekly

---

## Support

### Documentation
- `AGENT_08_SUMMARY.md` — Full documentation
- `AGENT_08_VALIDATION_REPORT.md` — Test results

### Logs
```bash
# Email agent logs
tail -f logs/email_agent.log

# API server logs
tail -f logs/uvicorn.log
```

### Database
```bash
# Connect to Supabase
psql $DATABASE_URL

# Or use Supabase dashboard
https://app.supabase.com/project/your-project/editor
```

---

**Quick Start Complete!** 🎉

For detailed documentation, see `AGENT_08_SUMMARY.md`.
