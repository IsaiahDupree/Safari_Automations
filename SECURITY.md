# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.x.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

**Do not report security vulnerabilities through public GitHub issues.**

Instead, please report them via email to: [security@your-domain.com]

Include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

You will receive a response within 48 hours acknowledging receipt.

## Security Practices

### Secrets Management

#### Never Commit Secrets

The following should **NEVER** be committed:

- `.env` files
- API keys or tokens
- Session cookies
- Database credentials
- Platform login credentials

#### Storage Requirements

| Secret Type | Storage Method |
|-------------|----------------|
| API Keys | Environment variables |
| Session Data | Encrypted local storage |
| Database Credentials | Environment variables |
| Platform Cookies | Encrypted cookie jar |

#### Encryption at Rest

All sensitive data stored locally must be encrypted:

```typescript
// Example: Encrypted session storage
import { encrypt, decrypt } from '@/packages/crypto';

const encryptedSession = encrypt(sessionData, process.env.ENCRYPTION_KEY);
await fs.writeFile('.sessions/instagram.enc', encryptedSession);
```

### Authentication & Sessions

#### Session Handling

- Sessions are stored encrypted locally
- Session files have restricted permissions (0600)
- Sessions auto-expire based on platform policy
- Manual session invalidation supported

#### Credential Flow

```
User Input → Memory Only → Encrypted Session → Local Storage
     ↓
  NEVER logged
  NEVER committed
  NEVER transmitted
```

### Data Privacy

#### What We Store

| Data Type | Stored | Encrypted | Retention |
|-----------|--------|-----------|-----------|
| Post IDs | Yes | No | Indefinite |
| Post Content | Yes | No | 90 days |
| User Handles | Yes | No | Indefinite |
| DM Content | Yes | **Yes** | 30 days |
| Screenshots | Yes | No | 7 days |
| Session Cookies | Yes | **Yes** | Until expiry |

#### What We Never Store

- Passwords
- Authentication tokens (except encrypted sessions)
- Private user data beyond engagement scope
- Financial information

#### Data Deletion

Users can request deletion of all stored data:

```bash
npm run data:delete -- --account=<account_id>
```

This removes:
- All action history
- All engagement records
- All stored content
- Session data

### Network Security

#### Outbound Connections

This tool only connects to:
- Platform websites (instagram.com, tiktok.com, threads.net, twitter.com/x.com)
- No external APIs
- No analytics services
- No telemetry

#### No Proxy/MITM

- Direct HTTPS connections only
- Certificate validation enforced
- No proxy support (intentional)

### Audit Logging

Every action is logged with:

```typescript
interface AuditEntry {
  timestamp: Date;
  runId: string;
  actionType: string;
  platform: string;
  targetId: string;
  outcome: 'success' | 'failure' | 'skipped';
  reason?: string;
  // NO sensitive content logged
}
```

Audit logs are:
- Append-only
- Timestamped
- Retained for 1 year
- Available for export

### Platform Account Security

#### Rate Limiting

Built-in protections:
- Max actions per hour (configurable)
- Cooldown between actions
- Quiet hours support
- Automatic backoff on errors

#### Account Health

Monitoring for:
- Login challenges
- Captcha appearances
- Temporary blocks
- Unusual activity warnings

See [docs/runbooks/account-health.md](docs/runbooks/account-health.md).

### Development Security

#### Dependencies

- Regular `npm audit` checks
- Dependabot enabled
- No unnecessary dependencies
- Pinned versions in `package-lock.json`

#### CI/CD

- No secrets in CI logs
- Secrets injected via GitHub Secrets
- Artifacts auto-expire
- No production credentials in CI

### Threat Model

| Threat | Mitigation |
|--------|------------|
| Credential theft | Encrypted storage, no logging |
| Session hijacking | Encrypted sessions, auto-expiry |
| Data exfiltration | No external connections |
| Platform detection | Rate limiting, human-like patterns |
| Local file access | Restricted permissions |

### Incident Response

If you suspect a security incident:

1. **Immediately** revoke affected sessions
2. Check audit logs for unauthorized actions
3. Rotate any potentially exposed secrets
4. Document the incident
5. Report via security contact

See [docs/runbooks/incidents.md](docs/runbooks/incidents.md).

## Security Checklist for Contributors

Before submitting a PR:

- [ ] No secrets in code or commits
- [ ] No hardcoded credentials
- [ ] Sensitive data is encrypted
- [ ] No excessive logging of user data
- [ ] Permissions are restrictive
- [ ] Dependencies are audited
- [ ] Tests don't expose real data

## Contact

Security issues: [security@your-domain.com]

For non-security issues, use GitHub Issues.
