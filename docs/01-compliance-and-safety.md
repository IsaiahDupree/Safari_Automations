# Compliance and Safety

## Responsible Automation Framework

This document defines the compliance and safety boundaries for the Safari Social Automation project.

## Core Principles

### 1. User-Authorized Accounts Only

**Rule**: This tool may only be used with accounts you own and control.

- No accessing others' accounts
- No credential sharing
- No delegation without explicit authorization

### 2. Human-in-the-Loop

**Rule**: Critical actions require human approval.

| Action Type | Approval Required |
|-------------|-------------------|
| Like | No (automated) |
| Comment | Configurable |
| DM (first contact) | **Yes** |
| DM (reply) | Configurable |
| Follow/Unfollow | Not supported |

### 3. Rate Limiting

**Rule**: Respect platform rate limits and add safety margins.

| Platform | Likes/Hour | Comments/Hour | DMs/Hour |
|----------|------------|---------------|----------|
| Instagram | 30 | 10 | 5 |
| TikTok | 30 | 10 | N/A |
| Threads | 30 | 10 | N/A |
| Twitter/X | 30 | 10 | 5 |

These are conservative defaults. Adjust based on account age and standing.

### 4. No Captcha Solving

**Rule**: If a captcha appears, stop and alert.

- No automated captcha solving
- No third-party captcha services
- Human must resolve manually

### 5. Full Audit Trail

**Rule**: Every action is logged and traceable.

```typescript
interface AuditRecord {
  id: string;
  timestamp: Date;
  platform: string;
  actionType: string;
  targetId: string;
  accountId: string;
  outcome: 'success' | 'failure' | 'skipped' | 'pending_approval';
  verificationStatus: 'verified' | 'unverified' | 'failed';
  reason?: string;
}
```

## Platform Terms Awareness

### Instagram

**Relevant Terms**:
- No automated data collection
- No automated engagement for commercial purposes
- No coordinated inauthentic behavior

**Our Approach**:
- Personal account use only
- Rate-limited engagement
- No bulk operations

### TikTok

**Relevant Terms**:
- No automated access without permission
- No systematic data extraction
- No manipulation of engagement metrics

**Our Approach**:
- Manual-style automation only
- Conservative rate limits
- No metric manipulation

### Threads

**Relevant Terms**:
- Subject to Meta's terms (similar to Instagram)
- No automated behavior at scale

**Our Approach**:
- Same restrictions as Instagram
- Lower rate limits (newer platform)

### Twitter/X

**Relevant Terms**:
- Automation policy exists for approved use cases
- No bulk actions
- No coordinated manipulation

**Our Approach**:
- Personal engagement only
- Within automation policy bounds
- No political manipulation

## Risk Assessment

### Risk Levels

| Risk Level | Description | Action |
|------------|-------------|--------|
| 🟢 Low | Normal operation | Continue |
| 🟡 Medium | Unusual patterns detected | Slow down |
| 🔴 High | Warning from platform | Stop immediately |
| ⚫ Critical | Account restricted | Human review required |

### Risk Indicators

**Platform Signals**:
- Captcha challenges
- "Suspicious activity" warnings
- Temporary action blocks
- Login verification requests
- Account restriction notices

**System Signals**:
- Higher than normal failure rate
- Selector breakage across pages
- Session instability
- Rate limit responses (429)

## Human-in-the-Loop Model

### Approval Workflows

#### DM Approval (Required)

```
User initiates DM request
        ↓
System prepares message
        ↓
Notification sent to human
        ↓
Human reviews: recipient, message, context
        ↓
Human approves or rejects
        ↓
If approved: System sends DM
        ↓
System verifies delivery
        ↓
Audit log updated
```

#### Comment Approval (Optional)

```
Post identified for comment
        ↓
System generates/selects comment
        ↓
[If approval required]
    Human reviews post + proposed comment
        ↓
    Human approves, edits, or rejects
        ↓
[End if]
        ↓
System posts comment
        ↓
System verifies comment appeared
        ↓
Audit log updated
```

### Approval Interface

```typescript
interface ApprovalRequest {
  id: string;
  actionType: 'dm' | 'comment';
  platform: string;
  target: {
    postId?: string;
    userId?: string;
    username?: string;
  };
  proposedContent: string;
  context: {
    previousInteractions: number;
    targetFollowerCount?: number;
    targetPostCount?: number;
  };
  expiresAt: Date;
}

interface ApprovalResponse {
  requestId: string;
  decision: 'approve' | 'reject' | 'edit';
  editedContent?: string;
  reason?: string;
}
```

## Rate Limiting Implementation

### Sliding Window

```typescript
interface RateLimiter {
  platform: string;
  actionType: string;
  windowMs: number;        // e.g., 3600000 (1 hour)
  maxActions: number;      // e.g., 30
  currentCount: number;
  windowStart: Date;
}
```

### Cooldown Periods

| After Action | Cooldown |
|--------------|----------|
| Like | 30-60 seconds |
| Comment | 60-120 seconds |
| DM | 120-300 seconds |
| Session start | 30 seconds |
| Page navigation | 5-10 seconds |

### Quiet Hours

Configurable periods of no activity:

```typescript
interface QuietHours {
  enabled: boolean;
  startHour: number;  // 0-23, local time
  endHour: number;    // 0-23, local time
  timezone: string;
}

// Example: No activity 11pm - 7am
const quietHours = {
  enabled: true,
  startHour: 23,
  endHour: 7,
  timezone: 'America/New_York'
};
```

## Blocklists and Opt-Outs

### Blocklist Types

| Type | Description |
|------|-------------|
| User Blocklist | Never interact with these users |
| Post Blocklist | Never engage with these posts |
| Keyword Blocklist | Skip posts containing these terms |
| Domain Blocklist | Skip posts linking to these domains |

### Opt-Out Handling

If a user requests no automated contact:

1. Immediately add to blocklist
2. Cancel any pending actions
3. Log the opt-out request
4. Never contact again

### Blocklist Format

```json
{
  "users": [
    { "platform": "instagram", "username": "user123", "reason": "requested", "addedAt": "2024-01-15" }
  ],
  "keywords": [
    { "term": "spam", "matchType": "contains" },
    { "term": "giveaway", "matchType": "contains" }
  ]
}
```

## Incident Response

### Severity Levels

| Level | Example | Response Time |
|-------|---------|---------------|
| P1 | Account banned | Immediate |
| P2 | Account restricted | < 1 hour |
| P3 | Unusual warning | < 4 hours |
| P4 | Minor anomaly | < 24 hours |

### Response Procedures

**P1 - Account Banned**:
1. Stop all automation immediately
2. Document current state
3. Do NOT attempt to circumvent
4. Review audit logs
5. Assess cause and remediation

**P2 - Account Restricted**:
1. Pause automation for this account
2. Check platform notification
3. Complete any required verification manually
4. Wait restriction period
5. Resume with reduced rate limits

See [runbooks/incidents.md](runbooks/incidents.md) for detailed procedures.

## Data Privacy

### Collection Limits

**Collect**:
- Post IDs and URLs
- Public engagement counts
- Public usernames
- Action timestamps

**Do Not Collect**:
- Private profile data
- Personal contact information
- Financial information
- Sensitive personal data

### Retention Policy

| Data Type | Retention |
|-----------|-----------|
| Action audit logs | 1 year |
| Post metadata | 90 days |
| Screenshots | 7 days |
| DM content | 30 days |
| Session data | Until logout |

### Deletion Rights

Users can delete all their data:

```bash
npm run data:export -- --account=<id>  # Export first
npm run data:delete -- --account=<id>  # Then delete
```

## Compliance Checklist

Before running:

- [ ] Using accounts you own
- [ ] Rate limits configured appropriately
- [ ] Human approval enabled for DMs
- [ ] Blocklists loaded
- [ ] Audit logging enabled
- [ ] Quiet hours configured (optional)
- [ ] Emergency stop procedure known

During operation:

- [ ] Monitor for platform warnings
- [ ] Check action success rates
- [ ] Review audit logs periodically
- [ ] Update blocklists as needed
- [ ] Respect opt-out requests

After incidents:

- [ ] Document what happened
- [ ] Identify root cause
- [ ] Update procedures if needed
- [ ] Adjust rate limits if needed
