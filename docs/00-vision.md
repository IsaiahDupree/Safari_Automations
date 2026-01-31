# Vision & Goals

## Project Vision

Build a robust, test-first Safari automation framework for strategic social media engagement that is:

- **Reliable**: Extensive selector testing and fallbacks
- **Auditable**: Full traceability of every action
- **Safe**: Rate-limited, human-approved, responsible automation
- **Maintainable**: Clean architecture with clear boundaries

## Goals

### Primary Goals

1. **Safari Automation Excellence**
   - Native Safari WebDriver integration
   - Stable session management
   - Robust error handling and recovery

2. **Comprehensive Platform Coverage**
   - Instagram: Feed, posts, comments, DMs
   - TikTok: Feed, posts, comments
   - Threads: Feed, posts, comments
   - Twitter/X: Feed, posts, comments, DMs

3. **Selector Reliability**
   - Versioned selector registry
   - Multiple fallbacks per element
   - Contract tests for every selector
   - Rapid breakage detection and recovery

4. **Data Completeness**
   - Extract all available post stats
   - Store engagement history
   - Track author information
   - Maintain interaction records

5. **Action Verification**
   - Confirm every action succeeded
   - Prevent duplicate engagements
   - Audit trail for all operations

### Non-Goals

1. **Not a Growth Hacking Tool**
   - No follow/unfollow automation
   - No mass following
   - No engagement pods

2. **Not a Scraping Service**
   - No bulk data extraction
   - No competitive intelligence
   - No data resale

3. **Not a Bypass Tool**
   - No captcha solving
   - No rate limit circumvention
   - No ban evasion

4. **Not Multi-Account Management**
   - Focus on your own accounts
   - No account farming
   - No coordinated inauthentic behavior

## Definitions

### Core Concepts

| Term | Definition |
|------|------------|
| **Post** | A piece of content on a platform (photo, video, text) |
| **Post ID** | Platform-specific unique identifier for a post |
| **Author** | The user who created a post |
| **Engagement** | An interaction with a post (like, comment, share) |
| **DM Thread** | A direct message conversation |
| **Session** | An authenticated browser session |
| **Selector** | A CSS/XPath query to locate an element |

### Action Types

| Action | Description |
|--------|-------------|
| `DISCOVER` | Find new posts or users |
| `EXTRACT` | Pull data from a page |
| `LIKE` | Like/heart a post |
| `COMMENT` | Add a comment to a post |
| `DM_SEND` | Send a direct message |
| `DM_READ` | Read direct messages |
| `VERIFY` | Confirm an action succeeded |

### States

| State | Description |
|-------|-------------|
| `DISCOVERED` | Post found but not processed |
| `ELIGIBLE` | Post passes policy checks |
| `ACTION_ATTEMPTED` | Action was attempted |
| `VERIFIED` | Action confirmed successful |
| `STORED` | Data persisted to database |
| `DONE` | Processing complete |

### Failure States

| State | Description |
|-------|-------------|
| `SELECTOR_MISSING` | Required element not found |
| `RATE_LIMITED` | Platform rate limit hit |
| `REQUIRES_HUMAN` | Human intervention needed |
| `PLATFORM_CHANGED` | UI changed, selectors broken |
| `SESSION_EXPIRED` | Login required |

## Success Metrics

### Reliability

| Metric | Target |
|--------|--------|
| Selector success rate | > 95% |
| Action verification rate | > 99% |
| Session stability | > 8 hours |
| Recovery from failures | < 5 min |

### Safety

| Metric | Target |
|--------|--------|
| Duplicate actions | 0 |
| Rate limit violations | 0 |
| Account restrictions | 0 |
| Unverified actions | < 1% |

### Coverage

| Metric | Target |
|--------|--------|
| Platform features covered | > 80% |
| Selector fallback depth | ≥ 3 |
| Test coverage (code) | > 80% |
| Test coverage (selectors) | 100% |

## Principles

### 1. Test First

Every selector, every action, every feature has tests before implementation.

### 2. Fail Safe

When in doubt, don't act. Human intervention is always an option.

### 3. Full Traceability

Every action can be traced back through audit logs.

### 4. Graceful Degradation

When selectors break, quarantine and alert—don't crash.

### 5. Respect Platforms

Rate limits exist for a reason. We follow them.

### 6. Privacy by Default

Collect only what's needed. Encrypt what's sensitive. Delete when done.

## Milestones

### M1: Foundation (Weeks 1-2)
- Safari WebDriver integration working
- Basic selector registry structure
- Database schema defined
- Logging infrastructure

### M2: First Platform (Weeks 3-4)
- Instagram adapter complete
- All Instagram selectors with tests
- Basic engagement flow working
- Verification implemented

### M3: Platform Expansion (Weeks 5-8)
- TikTok adapter
- Threads adapter
- Twitter/X adapter
- Cross-platform consistency

### M4: Intelligence (Weeks 9-10)
- Engagement strategy rules
- Duplicate prevention
- Cooldown management
- Analytics dashboard

### M5: Operations (Weeks 11-12)
- CI/CD pipeline
- Monitoring and alerting
- Runbooks complete
- Documentation finalized
