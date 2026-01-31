# Test Strategy

## Overview

This project follows a test-first approach. Every selector, action, and feature has tests before implementation. The test pyramid ensures fast feedback while maintaining confidence.

## Test Pyramid

```
                    ┌─────────────┐
                    │   E2E/Flow  │  Few, slow, high confidence
                    │    Tests    │
                    ├─────────────┤
                   ╱               ╲
                  ╱   Integration   ╲  Moderate count, medium speed
                 ╱      Tests        ╲
                ├─────────────────────┤
               ╱                       ╲
              ╱    Selector Contract    ╲  Many, platform-dependent
             ╱          Tests            ╲
            ├─────────────────────────────┤
           ╱                               ╲
          ╱          Unit Tests             ╲  Many, fast, foundational
         ╱                                   ╲
        └─────────────────────────────────────┘
```

## Test Categories

### Unit Tests

**Purpose**: Test pure logic in isolation

**Location**: `tests/unit/`

**What to Test**:
- Parsers (extracting stats from HTML)
- Dedupe key generation
- Policy rules evaluation
- Rate limit calculations
- Data transformations

**Example**:

```typescript
// tests/unit/parsers/instagram.test.ts

import { parseInstagramLikeCount } from '@/packages/platforms/instagram/parsers';

describe('parseInstagramLikeCount', () => {
  it('parses numeric like count', () => {
    expect(parseInstagramLikeCount('1,234 likes')).toBe(1234);
  });

  it('parses "like" singular', () => {
    expect(parseInstagramLikeCount('1 like')).toBe(1);
  });

  it('parses abbreviated count (K)', () => {
    expect(parseInstagramLikeCount('12.5K likes')).toBe(12500);
  });

  it('parses abbreviated count (M)', () => {
    expect(parseInstagramLikeCount('1.2M likes')).toBe(1200000);
  });

  it('returns null for invalid input', () => {
    expect(parseInstagramLikeCount('invalid')).toBeNull();
  });
});
```

**Running**:
```bash
npm run test:unit
npm run test:unit -- --watch
npm run test:unit -- --coverage
```

### Selector Contract Tests

**Purpose**: Verify selectors still work on live platforms

**Location**: `tests/selectors/`

**What to Test**:
- Primary selector finds expected elements
- At least one fallback works
- Element meets contract (clickable, visible, etc.)
- Extracted values match expected patterns

**Example**:

```typescript
// tests/selectors/instagram/post.test.ts

import { testSelectorContract } from '@/test-utils';

describe('Instagram Post Selectors', () => {
  beforeAll(async () => {
    await browser.navigate(TEST_POST_URL);
  });

  testSelectorContract('instagram.post.likeButton', {
    expectations: {
      matchCount: 1,
      isClickable: true,
      isVisible: true,
    },
  });

  testSelectorContract('instagram.post.likeCount', {
    expectations: {
      matchCount: 1,
      extractedValueMatches: /^[\d,]+K?M?$/,
    },
  });
});
```

**Running**:
```bash
npm run test:selectors
npm run test:selectors -- --platform=instagram
npm run test:selectors:nightly  # Full sweep
```

### Integration Tests

**Purpose**: Test component interactions

**Location**: `tests/integration/`

**What to Test**:
- Browser + Selector Registry integration
- Action Engine + Verification Engine
- Policy Engine + Database
- Platform Adapter complete workflows

**Example**:

```typescript
// tests/integration/instagram/extractStats.test.ts

describe('Instagram Stats Extraction', () => {
  let browser: Browser;
  let adapter: InstagramAdapter;

  beforeAll(async () => {
    browser = await Browser.create();
    adapter = new InstagramAdapter(browser);
    await adapter.navigateToPost(TEST_POST_ID);
  });

  it('extracts all post stats', async () => {
    const stats = await adapter.extractPostStats(TEST_POST_ID);

    expect(stats).toMatchObject({
      postId: TEST_POST_ID,
      likeCount: expect.any(Number),
      commentCount: expect.any(Number),
      authorUsername: expect.any(String),
      timestamp: expect.any(Date),
    });
  });

  it('stats persist correctly', async () => {
    const stats = await adapter.extractPostStats(TEST_POST_ID);
    await db.savePost(stats);

    const retrieved = await db.getPost('instagram', TEST_POST_ID);
    expect(retrieved).toMatchObject(stats);
  });
});
```

**Running**:
```bash
npm run test:integration
npm run test:integration -- --platform=instagram
```

### Flow/E2E Tests

**Purpose**: Test complete user workflows

**Location**: `tests/flows/`

**What to Test**:
- Complete engagement flow (discover → engage → verify)
- DM flow (navigate → compose → send → verify)
- Error recovery flows
- Rate limiting behavior

**Example**:

```typescript
// tests/flows/instagram/engagementFlow.test.ts

describe('Instagram Engagement Flow', () => {
  let orchestrator: Orchestrator;

  beforeAll(async () => {
    orchestrator = await Orchestrator.create({
      platforms: ['instagram'],
      dryRun: false,
    });
  });

  it('completes full like engagement', async () => {
    // 1. Discover a post
    const posts = await orchestrator.discoverPosts({
      platform: 'instagram',
      limit: 1,
    });
    expect(posts.length).toBe(1);

    const post = posts[0];

    // 2. Check eligibility
    const eligibility = await orchestrator.checkEligibility(post);
    expect(eligibility.eligible).toBe(true);

    // 3. Execute like
    const result = await orchestrator.executeLike(post);
    expect(result.success).toBe(true);

    // 4. Verify
    const verification = await orchestrator.verify(result);
    expect(verification.verified).toBe(true);

    // 5. Check persistence
    const stored = await db.getActionHistory({
      platform: 'instagram',
      postId: post.id,
    });
    expect(stored.length).toBe(1);
    expect(stored[0].actionType).toBe('like');
  });

  it('prevents duplicate engagement', async () => {
    const post = await getAlreadyLikedPost();

    const eligibility = await orchestrator.checkEligibility(post);
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.reason).toBe('already_engaged');
  });
});
```

**Running**:
```bash
npm run test:flows
npm run test:flows -- --platform=instagram
```

### Audit Verification Tests

**Purpose**: Verify audit trail completeness and accuracy

**Location**: `tests/audit/`

**What to Test**:
- Every action produces audit entry
- Audit entries contain required fields
- Audit trail is queryable
- Audit data matches action outcomes

**Example**:

```typescript
// tests/audit/traceability.test.ts

describe('Audit Traceability', () => {
  it('like action produces complete audit entry', async () => {
    const result = await orchestrator.executeLike(testPost);

    const auditEntry = await db.getAuditEntry(result.auditId);

    expect(auditEntry).toMatchObject({
      id: expect.any(String),
      timestamp: expect.any(Date),
      runId: expect.any(String),
      platform: 'instagram',
      actionType: 'like',
      targetId: testPost.id,
      outcome: 'success',
      verificationStatus: 'verified',
    });
  });

  it('failed action audit includes error details', async () => {
    // Force a failure
    const result = await orchestrator.executeLike(invalidPost);

    const auditEntry = await db.getAuditEntry(result.auditId);

    expect(auditEntry.outcome).toBe('failure');
    expect(auditEntry.error).toBeDefined();
    expect(auditEntry.error.message).toBeDefined();
  });
});
```

## Test Configuration

### Vitest Config

```typescript
// vitest.config.ts

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/selectors/**'],  // Separate config for selectors
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      exclude: ['tests/**', '**/*.d.ts'],
    },
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
```

### Selector Tests Config

```typescript
// vitest.selectors.config.ts

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/selectors/**/*.test.ts'],
    testTimeout: 60000,  // Longer for browser operations
    hookTimeout: 120000,
    maxConcurrency: 1,   // Safari only supports one session
    retry: 2,            // Retry flaky selector tests
    reporters: ['verbose', 'json'],
    outputFile: 'test-results/selectors.json',
  },
});
```

## CI Strategy

### Test Jobs

```yaml
# .github/workflows/test.yml

name: Tests

on: [push, pull_request]

jobs:
  unit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npm run test:unit

  integration:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: safaridriver --enable
      - run: npm run test:integration
    env:
      INSTAGRAM_TEST_POST_URL: ${{ secrets.INSTAGRAM_TEST_POST_URL }}

  selectors-nightly:
    runs-on: macos-latest
    if: github.event_name == 'schedule'
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci
      - run: safaridriver --enable
      - run: npm run test:selectors:nightly
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: selector-failures
          path: test-results/
```

### Nightly Selector Sweep

```yaml
# .github/workflows/selectors-nightly.yml

name: Nightly Selector Sweep

on:
  schedule:
    - cron: '0 6 * * *'  # 6 AM UTC daily

jobs:
  sweep:
    runs-on: macos-latest
    strategy:
      fail-fast: false
      matrix:
        platform: [instagram, tiktok, threads, twitter]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci
      - run: safaridriver --enable
      - run: npm run test:selectors -- --platform=${{ matrix.platform }}
        continue-on-error: true
      - uses: actions/upload-artifact@v4
        with:
          name: results-${{ matrix.platform }}
          path: test-results/

  report:
    needs: sweep
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v4
      - run: npm run selectors:report
      - uses: slackapi/slack-github-action@v1
        if: failure()
        with:
          payload: |
            {
              "text": "🚨 Selector sweep found failures",
              "blocks": [...]
            }
```

## Flake Policy

### Definition

A test is **flaky** if it:
- Passes sometimes, fails other times
- Fails only in CI but not locally
- Depends on timing or external state

### Handling Flakes

1. **Identify**: Track test results over time
2. **Investigate**: Find root cause
3. **Fix or Quarantine**: Fix if possible, quarantine if not
4. **Document**: Record in quarantine tracker

### Retry Configuration

```typescript
// Only for selector tests (known to be environment-sensitive)
{
  retry: 2,
  retryDelay: 5000,
}
```

### Quarantine Tracker

```json
// tests/quarantine.json
{
  "quarantined": [
    {
      "test": "tests/selectors/instagram/post.test.ts::likeButton",
      "reason": "Flaky due to Instagram A/B testing",
      "since": "2024-01-15",
      "issue": "#45",
      "attempts_to_fix": 2
    }
  ],
  "flaky_history": [
    {
      "test": "tests/flows/instagram/dm.test.ts::sendDM",
      "flake_rate": 0.15,
      "last_flake": "2024-01-14"
    }
  ]
}
```

## Test Data Management

### Test Fixtures

```typescript
// tests/fixtures/instagram.ts

export const instagramFixtures = {
  posts: {
    standard: {
      url: 'https://instagram.com/p/ABC123',
      expectedStats: {
        likeCountMin: 100,
        hasComments: true,
      },
    },
    video: {
      url: 'https://instagram.com/p/DEF456',
      expectedStats: {
        hasVideo: true,
      },
    },
    noCaption: {
      url: 'https://instagram.com/p/GHI789',
      expectedStats: {
        hasCaption: false,
      },
    },
  },
};
```

### Test Account Requirements

For full flow testing, you need:

1. **Test accounts** on each platform (your own accounts)
2. **Test posts** that are stable (won't be deleted)
3. **Session files** for authenticated tests

```bash
# Generate session file (interactive)
npm run session:create -- --platform=instagram

# Verify session
npm run session:verify -- --platform=instagram
```

### Sensitive Data Handling

- **Never** commit real credentials
- Use environment variables for test URLs
- Use encrypted session files
- Rotate test accounts periodically

## Coverage Requirements

### Targets

| Category | Target |
|----------|--------|
| Unit Tests | 80% line coverage |
| Selector Contract Tests | 100% of selectors |
| Integration Tests | All platform adapters |
| Flow Tests | Critical paths |

### Coverage Report

```bash
npm run test:coverage

# Output:
# ----------------------|---------|----------|---------|---------|
# File                  | % Stmts | % Branch | % Funcs | % Lines |
# ----------------------|---------|----------|---------|---------|
# packages/actions      |   85.2  |   78.4   |   90.0  |   85.2  |
# packages/browser      |   82.1  |   75.0   |   88.5  |   82.1  |
# packages/platforms    |   79.8  |   72.3   |   85.0  |   79.8  |
# packages/selectors    |   95.0  |   90.2   |   98.0  |   95.0  |
# ----------------------|---------|----------|---------|---------|
```

## Running Tests

### Quick Reference

```bash
# All unit tests
npm run test:unit

# All tests with coverage
npm run test:coverage

# Selector tests (requires Safari)
npm run test:selectors

# Single platform selectors
npm run test:selectors -- --platform=instagram

# Integration tests
npm run test:integration

# Flow tests
npm run test:flows

# Watch mode
npm run test:unit -- --watch

# Single test file
npm run test -- tests/unit/parsers/instagram.test.ts
```

### Safari-Specific Requirements

```bash
# Ensure Safari WebDriver is enabled
safaridriver --enable

# Check Safari is available
safaridriver --version

# Run Safari-dependent tests
npm run test:safari
```
