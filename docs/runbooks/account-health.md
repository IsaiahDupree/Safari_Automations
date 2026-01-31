# Account Health Runbook

## Overview

This runbook covers monitoring and maintaining healthy account status across platforms to avoid restrictions, bans, or detection.

## Health Checkpoints

### Daily Checks

| Check | How | Expected |
|-------|-----|----------|
| Session valid | Run `npm run session:verify` | All accounts "valid" |
| No restrictions | Check platform notifications | No warnings |
| Action success rate | Review last 24h audit logs | > 95% |
| Rate limit status | Check rate limit counters | Under limits |

### Weekly Checks

| Check | How | Expected |
|-------|-----|----------|
| Account standing | Manual login review | No warnings |
| Engagement patterns | Review analytics | Normal distribution |
| Follower changes | Compare week-over-week | Stable or growing |
| Platform announcements | Check official blogs | No policy changes |

## Health Indicators

### Green (Healthy)

- Session stable for > 8 hours
- All actions succeeding
- No platform warnings
- Rate limits not approached

### Yellow (Warning)

- Occasional action failures (< 10%)
- Session instability
- Approaching rate limits
- Unusual delays in platform responses

### Red (Critical)

- High failure rate (> 20%)
- Platform warning received
- Login challenges appearing
- Account restricted

## Common Issues

### Issue: Session Expired

**Symptoms**:
- Actions failing with auth errors
- Redirect to login page
- 401/403 responses

**Resolution**:
```bash
# 1. Verify session status
npm run session:verify -- --platform=instagram

# 2. If expired, recreate session
npm run session:create -- --platform=instagram

# 3. Encrypt and store
npm run session:encrypt -- --platform=instagram
```

### Issue: Login Challenge

**Symptoms**:
- "Suspicious activity" message
- Phone/email verification requested
- CAPTCHA appearing

**Resolution**:
1. **STOP** all automation immediately
2. Log in manually via browser
3. Complete verification (human only)
4. Wait 24 hours before resuming
5. Resume with reduced rate limits

```bash
# Pause automation
npm run automation:pause -- --account=<id>

# After manual resolution, wait, then resume at 50% rate
npm run automation:resume -- --account=<id> --rate-multiplier=0.5
```

### Issue: Action Block

**Symptoms**:
- Specific action type failing
- "Try again later" messages
- Temporary restriction notice

**Resolution**:
1. Stop the blocked action type
2. Continue other action types (if allowed)
3. Wait the specified time (usually 24-48 hours)
4. Resume gradually

```bash
# Block specific action type
npm run policy:block-action -- --account=<id> --action=comment --duration=48h

# Check block status
npm run policy:status -- --account=<id>
```

### Issue: Rate Limited

**Symptoms**:
- 429 responses
- "Rate limit exceeded" messages
- Actions timing out

**Resolution**:
1. Immediately pause all actions
2. Review rate limit configuration
3. Wait for rate limit window to reset
4. Reduce configured limits

```bash
# Check current rate usage
npm run ratelimit:status -- --account=<id>

# Reduce limits
npm run config:set -- --account=<id> --key=rateLimit.actionsPerHour --value=15
```

### Issue: Account Restricted

**Symptoms**:
- Cannot perform certain actions
- Reduced visibility
- Warning banner on profile

**Resolution**:
1. **STOP ALL AUTOMATION**
2. Document the restriction
3. Do NOT appeal immediately
4. Wait 7-14 days
5. Review what triggered it
6. Adjust automation settings
7. Resume very gradually

```bash
# Mark account as restricted
npm run account:restrict -- --account=<id> --reason="platform_restriction"

# Set resume date
npm run account:schedule-resume -- --account=<id> --date="2024-02-01"
```

## Cooldown Guidelines

### After Minor Issues

| Issue | Cooldown | Resume Rate |
|-------|----------|-------------|
| Session refresh | 1 hour | 100% |
| Single action failure | 15 minutes | 100% |
| Multiple failures | 2 hours | 75% |
| Rate limit hit | 24 hours | 50% |

### After Major Issues

| Issue | Cooldown | Resume Rate |
|-------|----------|-------------|
| Login challenge | 24-48 hours | 50% |
| Action block | 48-72 hours | 25% |
| Account warning | 7 days | 25% |
| Account restriction | 14-30 days | 10% |

## Monitoring Commands

```bash
# Overall health dashboard
npm run health:dashboard

# Specific account health
npm run health:check -- --account=<id>

# Recent issues
npm run health:issues -- --since=24h

# Rate limit status
npm run ratelimit:status

# Session validity
npm run session:verify-all
```

## Automated Health Checks

### Cron Schedule

```bash
# Add to crontab
# Check health every hour
0 * * * * cd /path/to/project && npm run health:check-all >> /var/log/health.log 2>&1

# Daily summary
0 9 * * * cd /path/to/project && npm run health:daily-report
```

### Alert Configuration

```typescript
// config/alerts.ts
export const healthAlerts = {
  sessionExpiry: {
    threshold: 4 * 60 * 60 * 1000, // 4 hours before expiry
    action: 'warn',
  },
  failureRate: {
    threshold: 0.1, // 10%
    window: 60 * 60 * 1000, // 1 hour
    action: 'pause',
  },
  rateLimit: {
    threshold: 0.8, // 80% of limit
    action: 'warn',
  },
};
```

## Recovery Procedures

### Full Account Recovery

If account is severely restricted:

1. **Document Everything**
   ```bash
   npm run audit:export -- --account=<id> --format=json > recovery_audit.json
   ```

2. **Complete Stop**
   ```bash
   npm run automation:stop -- --account=<id>
   npm run session:invalidate -- --account=<id>
   ```

3. **Manual Review**
   - Log in manually
   - Check all notifications
   - Complete any required verifications
   - Review account settings

4. **Wait Period**
   - Minimum 14 days for restrictions
   - 30 days for serious issues

5. **Gradual Resume**
   ```bash
   # Week 1: Manual actions only
   # Week 2: 10% automation rate
   npm run automation:resume -- --account=<id> --rate-multiplier=0.1
   
   # Week 3: 25% if no issues
   npm run config:set -- --account=<id> --key=rateLimit.multiplier --value=0.25
   
   # Week 4+: Gradually increase
   ```

## Prevention Best Practices

### Account Warm-up

For new accounts or accounts returning from restrictions:

```typescript
const warmupSchedule = [
  { day: 1, actions: 5, types: ['like'] },
  { day: 2, actions: 10, types: ['like'] },
  { day: 3, actions: 15, types: ['like'] },
  { day: 4, actions: 15, types: ['like', 'comment'] },
  { day: 5, actions: 20, types: ['like', 'comment'] },
  // ... gradually increase
];
```

### Diversification

- Don't rely on single action type
- Mix manual and automated activity
- Use the account normally too
- Don't automate 100% of activity

### Pattern Variation

- Randomize timing
- Vary action sequences
- Include "breaks" (no activity periods)
- Different activity on weekends

## Emergency Contacts

If account is suspended or banned:
1. Check platform's appeal process
2. Document all evidence of legitimate use
3. Be patient - appeals take time
4. Do NOT create new accounts to circumvent

## Checklist

### Before Each Session

- [ ] Verify session valid
- [ ] Check for platform announcements
- [ ] Review last session's issues
- [ ] Confirm rate limits configured
- [ ] Quiet hours respected

### After Issues

- [ ] Document what happened
- [ ] Identify root cause
- [ ] Adjust configuration
- [ ] Update runbook if needed
- [ ] Set appropriate cooldown
