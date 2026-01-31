# Incidents Runbook

## Overview

This runbook covers incident response for situations where automation causes unintended effects or when platform issues require immediate action.

## Incident Severity Levels

| Level | Description | Examples | Response Time |
|-------|-------------|----------|---------------|
| P1 | Critical - Immediate harm | Account banned, wrong DMs sent, public embarrassment | Immediate |
| P2 | High - Significant impact | Account restricted, many duplicate comments | < 1 hour |
| P3 | Medium - Notable issue | Wrong engagement targets, partial failures | < 4 hours |
| P4 | Low - Minor issue | Single failed action, minor data issue | < 24 hours |

## Incident Response Flow

```
Incident Detected
       │
       ▼
┌──────────────┐
│  1. STOP     │  Stop all automation immediately
└──────┬───────┘
       │
       ▼
┌──────────────┐
│  2. ASSESS   │  Determine scope and severity
└──────┬───────┘
       │
       ▼
┌──────────────┐
│  3. CONTAIN  │  Prevent further damage
└──────┬───────┘
       │
       ▼
┌──────────────┐
│  4. DOCUMENT │  Record what happened
└──────┬───────┘
       │
       ▼
┌──────────────┐
│  5. REMEDIATE│  Fix the immediate issue
└──────┬───────┘
       │
       ▼
┌──────────────┐
│  6. REVIEW   │  Root cause analysis
└──────┬───────┘
       │
       ▼
┌──────────────┐
│  7. IMPROVE  │  Prevent recurrence
└──────────────┘
```

## Step 1: STOP

**Immediately halt all automation**:

```bash
# Emergency stop all automation
npm run emergency:stop

# Or stop specific account
npm run automation:stop -- --account=<id>

# Or stop specific platform
npm run automation:stop -- --platform=instagram
```

This command:
- Cancels all queued actions
- Terminates active browser sessions
- Logs the emergency stop
- Notifies configured contacts

## Step 2: ASSESS

### Gather Information

```bash
# View recent actions
npm run audit:recent -- --limit=100

# View actions for specific account
npm run audit:account -- --account=<id> --since=1h

# Export audit log for analysis
npm run audit:export -- --since=2h --format=json > incident_audit.json
```

### Assessment Questions

1. **What happened?**
   - What actions were taken?
   - What was the outcome?
   - What was intended vs actual?

2. **Scope?**
   - How many actions affected?
   - How many accounts?
   - How many platforms?

3. **Impact?**
   - User complaints?
   - Platform warnings?
   - Data issues?

4. **Timeline?**
   - When did it start?
   - When was it detected?
   - Is it still happening?

### Severity Determination

```typescript
interface IncidentAssessment {
  severity: 'P1' | 'P2' | 'P3' | 'P4';
  affectedAccounts: string[];
  affectedPlatforms: string[];
  actionCount: number;
  startTime: Date;
  endTime: Date | null;
  publiclyVisible: boolean;
  platformNotified: boolean;
}
```

## Step 3: CONTAIN

### For Wrong Comments/DMs Sent

```bash
# List recent comments made
npm run actions:list -- --type=comment --since=1h

# Attempt to delete comments (if possible)
npm run actions:undo -- --type=comment --since=1h --dry-run
npm run actions:undo -- --type=comment --since=1h  # Actually delete
```

**Note**: Not all platforms allow comment deletion via automation. Manual deletion may be required.

### For Wrong Likes

```bash
# Unlike recent likes
npm run actions:undo -- --type=like --since=1h
```

### For Account Issues

```bash
# Invalidate session (force re-auth later)
npm run session:invalidate -- --account=<id>

# Mark account as requiring review
npm run account:flag -- --account=<id> --reason="incident_review"
```

### For Data Issues

```bash
# Rollback recent database changes
npm run db:rollback-actions -- --since=1h --dry-run
npm run db:rollback-actions -- --since=1h
```

## Step 4: DOCUMENT

Create an incident record:

```bash
npm run incident:create -- --severity=P2 --title="Duplicate comments sent"
```

This creates a file in `incidents/`:

```markdown
<!-- incidents/INC-2024-001.md -->

# Incident INC-2024-001: Duplicate comments sent

## Summary
- **Severity**: P2
- **Status**: Active
- **Detected**: 2024-01-15 14:30 UTC
- **Resolved**: [pending]

## Timeline
- 14:00 - Automation started
- 14:15 - Duplicate comment logic failed
- 14:30 - Alert triggered, automation stopped
- 14:35 - Investigation started

## Impact
- 15 duplicate comments posted
- 1 account affected
- Instagram platform

## Root Cause
[To be determined]

## Resolution
[To be documented]

## Action Items
- [ ] Delete duplicate comments
- [ ] Fix dedupe logic
- [ ] Add regression test
```

### Save Artifacts

```bash
# Save relevant screenshots
cp artifacts/recent/* incidents/INC-2024-001/

# Export audit logs
npm run audit:export -- --since=2h > incidents/INC-2024-001/audit.json

# Save configuration state
npm run config:export > incidents/INC-2024-001/config.json
```

## Step 5: REMEDIATE

### Scenario: Duplicate Comments

1. **Identify duplicates**:
   ```bash
   npm run audit:duplicates -- --type=comment --since=24h
   ```

2. **Delete duplicates manually** (automation may not be trusted):
   - Log into each platform
   - Find and delete duplicate comments
   - Document each deletion

3. **Verify cleanup**:
   ```bash
   npm run audit:verify-cleanup -- --incident=INC-2024-001
   ```

### Scenario: Wrong DMs Sent

1. **Identify affected recipients**:
   ```bash
   npm run audit:dm-recipients -- --since=1h
   ```

2. **Send apology/correction** (manually):
   - Craft appropriate message
   - Send to each recipient
   - Document responses

3. **Add to blocklist** (if they request):
   ```bash
   npm run blocklist:add -- --type=user --value=@username --reason="opt_out"
   ```

### Scenario: Account Restricted

1. **Do NOT attempt to circumvent**
2. **Wait for restriction to lift**
3. **Review what triggered it**
4. **Adjust automation settings**

### Scenario: Data Corruption

1. **Restore from backup**:
   ```bash
   npm run db:restore -- --backup=2024-01-15-12-00
   ```

2. **Verify data integrity**:
   ```bash
   npm run db:verify
   ```

## Step 6: REVIEW (Post-Incident)

### Root Cause Analysis

Ask the "5 Whys":

1. **Why** did duplicate comments get posted?
   - Dedupe check didn't find existing comment
2. **Why** didn't dedupe check work?
   - Database query had wrong parameters
3. **Why** were parameters wrong?
   - Recent code change modified the query
4. **Why** wasn't this caught?
   - Test coverage didn't include this case
5. **Why** wasn't there test coverage?
   - Edge case wasn't documented

### Contributing Factors

- Code issues
- Configuration issues
- Process issues
- Monitoring gaps
- Documentation gaps

### Write Post-Mortem

```markdown
<!-- incidents/INC-2024-001-postmortem.md -->

# Post-Mortem: INC-2024-001

## Summary
On 2024-01-15, 15 duplicate comments were posted due to a bug in dedupe logic.

## Impact
- 15 duplicate comments
- 1 user complaint
- 2 hours to resolve

## Timeline
[Detailed timeline]

## Root Cause
Database query in dedupe check used wrong column for matching.

## Resolution
Fixed query, added test coverage, deleted duplicates.

## Lessons Learned
1. Need better test coverage for dedupe logic
2. Need monitoring for duplicate actions
3. Need faster alerting

## Action Items
| Item | Owner | Due | Status |
|------|-------|-----|--------|
| Add dedupe unit tests | Dev | 2024-01-20 | Done |
| Add duplicate detection alert | Ops | 2024-01-22 | In Progress |
| Review all dedupe queries | Dev | 2024-01-25 | Pending |
```

## Step 7: IMPROVE

### Immediate Fixes

```bash
# Apply hotfix
git checkout -b hotfix/incident-001
# Make fixes
git commit -m "fix: correct dedupe query (INC-2024-001)"
git push origin hotfix/incident-001
# Create PR, get review, merge
```

### Long-term Improvements

1. **Add tests** for the failure case
2. **Improve monitoring** to detect earlier
3. **Update documentation** with learnings
4. **Review similar code** for same issue

### Prevention Checklist

- [ ] Root cause addressed
- [ ] Test added for this case
- [ ] Monitoring improved
- [ ] Documentation updated
- [ ] Team notified of learnings
- [ ] Runbook updated if needed

## Common Incident Scenarios

### Scenario: Posting to Wrong Account

**Detection**: Actions appearing on wrong account

**Response**:
1. Stop immediately
2. Verify session mapping
3. Check session files match accounts
4. Re-authenticate affected accounts

### Scenario: Spam Detection Triggered

**Detection**: Platform warning about spam

**Response**:
1. Stop all engagement
2. Review recent action patterns
3. Reduce rate limits significantly
4. Wait 24-48 hours
5. Resume gradually

### Scenario: API Changes Break Everything

**Detection**: Mass failures across platform

**Response**:
1. Stop automation for that platform
2. Check platform status pages
3. Investigate selector changes
4. Update selectors if needed
5. Re-test before resuming

### Scenario: Credentials Leaked

**Detection**: Unexpected account activity

**Response**:
1. Immediately change passwords
2. Revoke all sessions
3. Enable 2FA
4. Audit recent activity
5. Re-create session files
6. Investigate leak source

## Emergency Contacts

| Role | Contact | When to Contact |
|------|---------|-----------------|
| Primary On-Call | [configured] | All P1/P2 |
| Secondary On-Call | [configured] | P1 if primary unavailable |
| Platform Support | [per platform] | Account bans/restrictions |

## Communication Templates

### Internal Alert

```
🚨 INCIDENT: [Title]
Severity: P[1-4]
Status: [Active/Resolved]
Impact: [Brief description]
Actions: [What's being done]
ETA: [If known]
```

### User Apology (if needed)

```
Hi [Name],

You may have received a duplicate/incorrect [message/comment] from our account. 
This was due to a technical issue on our end that has been resolved.

We apologize for any confusion this may have caused.

Best regards
```

## Checklist

### During Incident

- [ ] Automation stopped
- [ ] Scope assessed
- [ ] Severity determined
- [ ] Containment actions taken
- [ ] Incident documented
- [ ] Stakeholders notified

### After Incident

- [ ] Issue fully resolved
- [ ] Post-mortem written
- [ ] Action items created
- [ ] Fixes implemented
- [ ] Tests added
- [ ] Monitoring improved
- [ ] Runbook updated
