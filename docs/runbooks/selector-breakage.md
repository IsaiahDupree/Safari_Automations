# Selector Breakage Runbook

## Overview

Selectors break when platforms update their UI. This runbook covers detection, triage, and resolution of selector breakage.

## Detection

### Automated Detection

**Nightly Selector Sweep**:
- Runs at 6 AM UTC daily
- Tests all selectors against live platforms
- Reports failures to Slack/email
- Creates GitHub issues for failures

**CI Detection**:
- Selector tests run on every PR
- Failures block merge (configurable)
- Artifacts saved on failure

### Manual Detection

Signs of selector breakage:
- Actions suddenly failing
- "Element not found" errors in logs
- Zero elements matched
- Wrong elements matched

### Detection Commands

```bash
# Test all selectors
npm run test:selectors

# Test specific platform
npm run test:selectors -- --platform=instagram

# Test specific selector
npm run selectors:test -- --path=instagram.post.likeButton

# Debug a selector
npm run selectors:debug -- --path=instagram.post.likeButton
```

## Triage

### Severity Levels

| Severity | Criteria | Response Time |
|----------|----------|---------------|
| P1 | Core action selector broken (like, comment) | < 4 hours |
| P2 | Secondary selector broken (counts, metadata) | < 24 hours |
| P3 | Fallback selector broken, primary works | < 1 week |
| P4 | Minor selector, workaround available | As time permits |

### Triage Questions

1. **Which selectors are affected?**
   ```bash
   npm run selectors:status -- --failed-only
   ```

2. **Is it platform-wide or specific pages?**
   - Check multiple page types
   - Compare with other accounts

3. **Are fallbacks working?**
   ```bash
   npm run selectors:test-fallbacks -- --path=instagram.post.likeButton
   ```

4. **When did it break?**
   - Check CI history
   - Check nightly sweep logs

5. **Is it an A/B test or full rollout?**
   - Test on different accounts
   - Test on different browsers
   - Check platform news/forums

## Quarantine

While investigating/fixing, quarantine affected tests:

```bash
# Quarantine a selector's tests
npm run selectors:quarantine -- --path=instagram.post.likeButton --reason="UI update" --issue="#123"

# View quarantined selectors
npm run selectors:quarantined

# Unquarantine after fix
npm run selectors:unquarantine -- --path=instagram.post.likeButton
```

### Quarantine File

```json
// tests/quarantine.json
{
  "quarantined": [
    {
      "path": "instagram.post.likeButton",
      "since": "2024-01-15T10:00:00Z",
      "reason": "Instagram UI redesign",
      "issue": "#123",
      "eta": "2024-01-17",
      "affectedTests": [
        "tests/selectors/instagram/post.test.ts::likeButton"
      ]
    }
  ]
}
```

## Investigation

### Step 1: Capture Current State

```bash
# Take screenshot and HTML snapshot
npm run debug:capture -- --url="https://instagram.com/p/ABC123" --name="instagram-post-investigation"
```

### Step 2: Inspect in Browser

1. Open Safari
2. Navigate to the page
3. Open Developer Tools (Cmd+Option+I)
4. Try selector in Console:
   ```javascript
   document.querySelectorAll('[aria-label="Like"]')
   ```
5. Inspect the actual element
6. Note any changes

### Step 3: Find New Selector

Priority order for new selectors:
1. **Accessibility attributes** (`aria-label`, `role`)
2. **data-testid** attributes
3. **Semantic structure** (stable class patterns)
4. **CSS patterns** (less stable)
5. **XPath** (last resort)

### Step 4: Test Candidate Selectors

```bash
# Test a candidate selector
npm run selectors:try -- --selector='[aria-label="Like"]' --url="https://instagram.com/p/ABC123"

# Output:
# Selector: [aria-label="Like"]
# Found: 1 element
# Clickable: Yes
# Visible: Yes
```

### Step 5: Verify Across Contexts

Test the new selector on:
- [ ] Different posts/tweets/threads
- [ ] Desktop vs mobile viewport
- [ ] Multiple accounts
- [ ] Different pages (feed vs direct link)

## Resolution

### Create Update Branch

```bash
git checkout -b selectors/instagram-2024-01-15
```

### Update Selector

```typescript
// packages/selectors/src/platforms/instagram/post.ts

export const instagramPostSelectors = {
  likeButton: {
    // Updated primary selector
    primary: '[data-testid="like-icon-container"] button',
    fallbacks: [
      // Keep old selector as fallback if it still works sometimes
      '[aria-label="Like"]',
      'svg[aria-label="Like"]',
      // Add new fallbacks
      'section button:first-child',
    ],
    type: 'css',
    contract: {
      expectedCount: 'one',
      mustBeClickable: true,
    },
  },
};
```

### Update Contract Tests

```typescript
// tests/selectors/instagram/post.test.ts

describe('Instagram Post Selectors', () => {
  describe('likeButton', () => {
    testSelectorContract('instagram.post.likeButton', {
      expectations: {
        matchCount: 1,
        isClickable: true,
        isVisible: true,
      },
    });
  });
});
```

### Run Tests

```bash
# Run selector tests
npm run test:selectors -- --platform=instagram

# Run integration tests
npm run test:integration -- --platform=instagram

# Run flow tests
npm run test:flows -- --platform=instagram
```

### Create ADR (if significant change)

```markdown
<!-- ADR/003-instagram-like-button-2024-01.md -->

# ADR 003: Instagram Like Button Selector Update

## Status
Accepted

## Context
Instagram UI update on 2024-01-15 changed the like button structure.

## Decision
Update primary selector from `[aria-label="Like"]` to `[data-testid="like-icon-container"] button`.

## Consequences
- Old selector moved to fallback position
- All tests passing
- Monitoring for further changes
```

### Open PR

```markdown
## Selector Update: Instagram 2024-01-15

### Affected Selectors
- `instagram.post.likeButton` - Primary selector updated

### Changes
- **Previous**: `[aria-label="Like"]`
- **New**: `[data-testid="like-icon-container"] button`

### Reason
Instagram UI update removed aria-label from like button.

### Testing
- [x] Contract tests pass
- [x] Integration tests pass
- [x] Manually verified on live site

### Related
- Fixes #123
- Unquarantines selector tests
```

### After Merge

```bash
# Unquarantine tests
npm run selectors:unquarantine -- --path=instagram.post.likeButton

# Update selector version
npm run selectors:bump-version -- --platform=instagram

# Notify team
npm run notify -- --message="Instagram selectors updated, monitoring"
```

## Rollback

If the fix causes issues:

```bash
# Revert to previous version
git revert <commit-sha>

# Re-quarantine
npm run selectors:quarantine -- --path=instagram.post.likeButton --reason="Fix caused issues"

# Deploy revert
git push origin main
```

## Prevention

### Multiple Fallbacks

Always maintain 3+ fallbacks:

```typescript
likeButton: {
  primary: '[data-testid="like-button"]',
  fallbacks: [
    '[aria-label="Like"]',
    'svg[aria-label="Like"]',
    'section button:first-child',
    'button:has(svg[fill="currentColor"])',
  ],
}
```

### Selector Diversity

Use different selector strategies:
- Mix accessibility, data-testid, and structural selectors
- Don't rely solely on one approach

### Early Warning

- Nightly sweeps catch breakage quickly
- Monitor platform engineering blogs/Twitter
- Subscribe to platform developer newsletters

## Monitoring

### Selector Health Dashboard

```bash
# View selector health
npm run selectors:health

# Output:
# Platform    | Total | Passing | Failing | Quarantined
# ------------|-------|---------|---------|------------
# instagram   | 45    | 43      | 1       | 1
# tiktok      | 38    | 38      | 0       | 0
# threads     | 32    | 32      | 0       | 0
# twitter     | 42    | 41      | 1       | 0
```

### Trends

Track over time:
- Breakage frequency per platform
- Time to fix
- Most unstable selectors

## Checklist

### When Breakage Detected

- [ ] Identify affected selectors
- [ ] Assess severity
- [ ] Quarantine tests
- [ ] Create issue
- [ ] Investigate root cause
- [ ] Test candidate selectors
- [ ] Update selectors
- [ ] Update tests
- [ ] Create PR
- [ ] Unquarantine after merge
- [ ] Monitor for recurrence

### After Resolution

- [ ] Document in ADR (if significant)
- [ ] Update version
- [ ] Notify team
- [ ] Close issue
- [ ] Review prevention measures
