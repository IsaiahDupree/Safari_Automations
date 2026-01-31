# Safari Automation Success Criteria PRD

**Version:** 1.0  
**Date:** 2026-01-30  
**Status:** Active  

---

## Overview

This document defines **strict, verifiable success criteria** for all Safari automation components. Each criterion includes:
- **Testable assertion** - Concrete pass/fail condition
- **Verification method** - How to prove it works
- **Anti-false-positive guard** - Ensures genuine success, not coincidental passes

---

## Anti-False-Positive Philosophy

> **A test that cannot fail is not a test.**

Every test MUST:
1. **Verify state change** - Not just absence of errors
2. **Confirm causality** - The action caused the result
3. **Check specificity** - The right thing happened, not just something
4. **Validate timing** - Within expected timeframe
5. **Require artifacts** - Screenshots, DOM snapshots, or logs as proof

---

## PRD 1: Safari Session Manager

### SC-1.1: Session Persistence
| Criterion | Sessions survive browser restart |
|-----------|----------------------------------|
| **Assertion** | After Safari restart, `isAuthenticated(platform)` returns `true` for previously logged-in platforms |
| **Verification** | 1. Login to platform → 2. Capture session cookies → 3. Restart Safari → 4. Verify cookies restored → 5. Navigate to platform → 6. Confirm logged-in state via DOM check |
| **Anti-FP Guard** | Must verify logged-in UI element exists (e.g., profile avatar), NOT just cookie presence |
| **Proof Required** | Screenshot of logged-in state, cookie diff before/after restart |

### SC-1.2: Multi-Platform Isolation
| Criterion | Platform sessions don't interfere |
|-----------|-----------------------------------|
| **Assertion** | Logging out of Platform A does not affect Platform B session |
| **Verification** | 1. Login to Twitter + Instagram → 2. Logout Twitter → 3. Verify Instagram still authenticated |
| **Anti-FP Guard** | Must check Instagram-specific logged-in element, not generic page load |
| **Proof Required** | Screenshots of both platforms before/after logout |

### SC-1.3: Cookie Encryption
| Criterion | Stored cookies are encrypted at rest |
|-----------|--------------------------------------|
| **Assertion** | Cookie storage file is not readable as plaintext |
| **Verification** | 1. Store session → 2. Read storage file → 3. Attempt JSON parse → 4. Must fail or show encrypted blob |
| **Anti-FP Guard** | File must exist AND be non-empty AND fail plaintext parse |
| **Proof Required** | Hex dump of first 100 bytes showing non-ASCII content |

### SC-1.4: Session Health Check
| Criterion | Detects expired/invalid sessions |
|-----------|----------------------------------|
| **Assertion** | `checkSessionHealth(platform)` returns `{ valid: false }` for expired sessions |
| **Verification** | 1. Login → 2. Manually invalidate session (clear cookies via Safari) → 3. Call health check → 4. Verify returns invalid |
| **Anti-FP Guard** | Must actually navigate to platform and check auth state, not just cookie expiry |
| **Proof Required** | API response showing `valid: false` with reason |

---

## PRD 2: Safari Browser Automation Core

### SC-2.1: Element Interaction Reliability
| Criterion | Click actions succeed on visible elements |
|-----------|------------------------------------------|
| **Assertion** | `click(selector)` returns success only when element was actually clicked |
| **Verification** | 1. Navigate to page with button → 2. Click button → 3. Verify resulting state change (navigation, modal, etc.) |
| **Anti-FP Guard** | Must verify POST-click state, not just click execution. Check for expected DOM mutation. |
| **Proof Required** | Before/after screenshots, DOM diff showing state change |

### SC-2.2: Navigation Accuracy
| Criterion | Navigation reaches correct destination |
|-----------|----------------------------------------|
| **Assertion** | After `navigate(url)`, `getCurrentUrl()` matches expected URL (allowing redirects) |
| **Verification** | 1. Navigate to URL → 2. Wait for load → 3. Compare final URL to expected patterns |
| **Anti-FP Guard** | Must handle redirects gracefully. Check for error pages (404, 500). Verify page content matches expectations. |
| **Proof Required** | Screenshot of loaded page, URL logged |

### SC-2.3: Text Input Accuracy
| Criterion | Typed text matches intended input |
|-----------|-----------------------------------|
| **Assertion** | After `type(selector, text)`, element's value equals input text |
| **Verification** | 1. Focus input → 2. Type text → 3. Read back element value → 4. Compare character-by-character |
| **Anti-FP Guard** | Must read ACTUAL element value, not echo input. Check for truncation. Verify no autocomplete interference. |
| **Proof Required** | Input value screenshot, character count verification |

### SC-2.4: Wait Conditions
| Criterion | Waits complete when condition is met |
|-----------|--------------------------------------|
| **Assertion** | `waitForElement(selector)` returns only when element exists and is visible |
| **Verification** | 1. Start wait → 2. Inject element after delay → 3. Verify wait completes within tolerance of injection time |
| **Anti-FP Guard** | Must verify element wasn't already present. Time wait duration to ensure it actually waited. |
| **Proof Required** | Timestamps: wait start, element injection, wait completion |

---

## PRD 3: Sora Browser Automation

### SC-3.1: Sora Disabled by Default
| Criterion | Sora does not auto-trigger |
|-----------|----------------------------|
| **Assertion** | `SoraRateLimiter.canGenerateNow()` returns `{ allowed: false }` without explicit enable |
| **Verification** | 1. Create new limiter instance → 2. Call canGenerateNow() → 3. Verify blocked with "DISABLED" reason |
| **Anti-FP Guard** | Must be NEW instance, not modified. Check reason string contains "DISABLED". |
| **Proof Required** | API response logged, config dump showing `enabled: false` |

### SC-3.2: Single-Shot Mode
| Criterion | Sora auto-disables after one generation |
|-----------|----------------------------------------|
| **Assertion** | After completing 1 generation, `isEnabled()` returns `false` |
| **Verification** | 1. Enable limiter → 2. Complete generation → 3. Check isEnabled() → 4. Verify false |
| **Anti-FP Guard** | Must actually complete generation (not just start). Verify config.singleShotMode was true. |
| **Proof Required** | Before/after enabled state, generation completion log |

### SC-3.3: Rate Limit Enforcement
| Criterion | Cannot exceed daily generation limit |
|-----------|--------------------------------------|
| **Assertion** | After N generations (where N = maxVideosPerDay), canGenerateNow() returns blocked |
| **Verification** | 1. Enable → 2. Simulate N completions → 3. Verify N+1 is blocked |
| **Anti-FP Guard** | Must verify exact count. Check history length matches. Verify reason mentions "limit". |
| **Proof Required** | Generation history dump, canGenerateNow response |

### SC-3.4: Time Window Enforcement
| Criterion | Blocks generation outside allowed hours |
|-----------|----------------------------------------|
| **Assertion** | At 3 AM, canGenerateNow() returns blocked (assuming default 10AM-6PM window) |
| **Verification** | 1. Enable → 2. Mock time to 3 AM on weekday → 3. Verify blocked with hour reason |
| **Anti-FP Guard** | Must verify blocked for TIME reason, not other reasons. Check allowed hours in config. |
| **Proof Required** | Mock time value, config hours, rejection reason |

---

## PRD 4: Comment Automation

### SC-4.1: Comment Successfully Posted
| Criterion | Comment appears on target post |
|-----------|-------------------------------|
| **Assertion** | After posting, comment is visible in post's comment section |
| **Verification** | 1. Navigate to post → 2. Post comment with unique marker → 3. Refresh page → 4. Find comment with marker |
| **Anti-FP Guard** | Unique marker (timestamp + random) prevents matching old comments. Must REFRESH before checking. |
| **Proof Required** | Screenshot of comment in context, DOM element with comment text |

### SC-4.2: Deduplication Works
| Criterion | Same comment not posted twice to same post |
|-----------|-------------------------------------------|
| **Assertion** | Second attempt to post identical comment returns `{ skipped: true, reason: 'duplicate' }` |
| **Verification** | 1. Post comment → 2. Attempt same comment → 3. Verify skipped response |
| **Anti-FP Guard** | Must verify first post succeeded before testing duplicate. Check dedupe key generation. |
| **Proof Required** | Both API responses, dedupe key logged |

### SC-4.3: Rate Limiting Respected
| Criterion | Comments spaced according to configured interval |
|-----------|------------------------------------------------|
| **Assertion** | Rapid comment attempts are queued/rejected per rate limit |
| **Verification** | 1. Post comment → 2. Immediately attempt second → 3. Verify second is delayed/blocked |
| **Anti-FP Guard** | Must verify timing, not just success. Check elapsed time between posts. |
| **Proof Required** | Timestamps of both attempts, rate limit config |

---

## PRD 5: DM Automation

### SC-5.1: DM Delivered
| Criterion | DM appears in recipient's inbox |
|-----------|--------------------------------|
| **Assertion** | After sending, message visible in conversation thread |
| **Verification** | 1. Send DM → 2. Navigate to conversation → 3. Find sent message |
| **Anti-FP Guard** | Use unique message content. Verify message timestamp is recent (within 1 minute). |
| **Proof Required** | Screenshot of sent message in thread, message content match |

### SC-5.2: DM Deduplication
| Criterion | Same DM not sent twice to same user in timeframe |
|-----------|------------------------------------------------|
| **Assertion** | Duplicate DM attempt within cooldown period is blocked |
| **Verification** | 1. Send DM → 2. Immediately attempt same DM → 3. Verify blocked |
| **Anti-FP Guard** | Verify first DM was actually sent (not just attempted). Check cooldown window. |
| **Proof Required** | Both API responses, cooldown config |

---

## PRD 6: Discovery System

### SC-6.1: Relevant Posts Found
| Criterion | Discovery returns posts matching criteria |
|-----------|------------------------------------------|
| **Assertion** | `discover({ keywords: ['AI'] })` returns posts containing 'AI' |
| **Verification** | 1. Run discovery → 2. For each result, verify keyword present in text |
| **Anti-FP Guard** | Must check EACH result, not just first. Keyword match must be case-insensitive. |
| **Proof Required** | Result list with keyword highlights, match percentage |

### SC-6.2: Freshness Filter
| Criterion | Only returns posts within time window |
|-----------|--------------------------------------|
| **Assertion** | `discover({ maxAge: '24h' })` returns only posts from last 24 hours |
| **Verification** | 1. Run discovery → 2. Parse each post's timestamp → 3. Verify all within window |
| **Anti-FP Guard** | Must parse ACTUAL post timestamp, not API response time. Handle timezone differences. |
| **Proof Required** | Post timestamps logged, current time, age calculation |

---

## PRD 7: Verification & Audit System

### SC-7.1: All Actions Logged
| Criterion | Every automation action creates audit record |
|-----------|---------------------------------------------|
| **Assertion** | After any action, `getActionRecord(id)` returns complete record |
| **Verification** | 1. Perform action → 2. Retrieve record → 3. Verify all fields populated |
| **Anti-FP Guard** | Must verify record has: actionType, platform, timestamp, status, proofs array |
| **Proof Required** | Full action record JSON dump |

### SC-7.2: Proof Artifacts Captured
| Criterion | Actions include verifiable proof artifacts |
|-----------|-------------------------------------------|
| **Assertion** | Action record contains at least 1 proof artifact (screenshot, element, etc.) |
| **Verification** | 1. Perform action → 2. Check record.proofs.length > 0 → 3. Verify proof type valid |
| **Anti-FP Guard** | Proof must have: type, data (non-empty), timestamp, validator |
| **Proof Required** | Proof artifact list with types |

### SC-7.3: Verification Score Accurate
| Criterion | Score reflects actual proof validity |
|-----------|-------------------------------------|
| **Assertion** | Score calculation matches: (validProofs / requiredProofs) * 100 |
| **Verification** | 1. Add known proofs → 2. Calculate score → 3. Verify matches manual calculation |
| **Anti-FP Guard** | Must test with edge cases: 0 proofs, partial proofs, all proofs, invalid proofs |
| **Proof Required** | Proof counts, score calculation breakdown |

---

## Success Metrics Summary

| Category | Criteria Count | Target Pass Rate |
|----------|---------------|------------------|
| Session Management | 4 | 100% |
| Browser Automation | 4 | 95% |
| Sora Automation | 4 | 100% |
| Comment Automation | 3 | 90% |
| DM Automation | 2 | 90% |
| Discovery System | 2 | 85% |
| Verification System | 3 | 100% |
| **Total** | **22** | **95%** |

---

## Test Execution Requirements

### Before Each Test
1. Clean state - no leftover data from previous runs
2. Fresh browser session (unless testing persistence)
3. Network connectivity verified
4. Target platforms accessible

### During Each Test
1. Capture timestamps at each step
2. Take screenshots at state transitions
3. Log all API calls and responses
4. Record any errors or warnings

### After Each Test
1. Generate proof artifacts
2. Calculate verification score
3. Clean up test data (unless needed for next test)
4. Log pass/fail with evidence

---

## Appendix: Anti-False-Positive Patterns

### Pattern 1: State Mutation Verification
```typescript
// BAD - Checks function ran without error
const result = await click(button);
expect(result.success).toBe(true); // Could be false positive

// GOOD - Checks actual state change
const beforeState = await getPageState();
await click(button);
const afterState = await getPageState();
expect(afterState).not.toEqual(beforeState); // Proves change
expect(afterState.modalOpen).toBe(true); // Specific change
```

### Pattern 2: Unique Markers
```typescript
// BAD - Checks if comment exists
const comment = await findComment('Great post!');
expect(comment).toBeDefined(); // Could match old comment

// GOOD - Uses unique marker
const marker = `test_${Date.now()}_${Math.random().toString(36).slice(2)}`;
await postComment(`Great post! ${marker}`);
const comment = await findComment(marker);
expect(comment).toBeDefined(); // Only matches our comment
```

### Pattern 3: Timing Verification
```typescript
// BAD - Checks wait completed
await waitForElement('.loading');
expect(true).toBe(true); // Always passes

// GOOD - Verifies actual wait occurred
const start = Date.now();
await waitForElement('.loading');
const elapsed = Date.now() - start;
expect(elapsed).toBeGreaterThan(100); // Actually waited
expect(elapsed).toBeLessThan(5000); // Within timeout
```

### Pattern 4: Negative Testing
```typescript
// BAD - Only tests happy path
expect(await isLoggedIn()).toBe(true);

// GOOD - Also tests unhappy path
await logout();
expect(await isLoggedIn()).toBe(false); // Proves detection works
await login();
expect(await isLoggedIn()).toBe(true); // Now meaningful
```

---

## Revision History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-01-30 | Initial success criteria document |
