# Contributing to Safari Social Automation

Thank you for your interest in contributing! This document outlines development setup, branching strategy, and how to add selectors/tests.

## Development Setup

### Prerequisites

- **macOS** (required for Safari WebDriver)
- **Node.js** 18+ 
- **Safari** with WebDriver enabled
- **Git**

### Initial Setup

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/safari-social-automation.git
cd safari-social-automation

# Install dependencies
npm install

# Enable Safari WebDriver (if not already done)
safaridriver --enable

# Copy environment template
cp .env.example .env

# Run initial tests to verify setup
npm run test:smoke
```

### Environment Configuration

Create a `.env` file (never committed):

```env
# Database
DATABASE_URL=sqlite://./data/automation.db

# Safari
SAFARI_DRIVER_PATH=/usr/bin/safaridriver
SAFARI_TIMEOUT_MS=30000

# Rate Limits
RATE_LIMIT_ACTIONS_PER_HOUR=30
RATE_LIMIT_COOLDOWN_MS=60000

# Logging
LOG_LEVEL=debug
SCREENSHOT_ON_FAILURE=true
```

## Project Structure

```
safari-social-automation/
├── apps/
│   └── runner/              # CLI orchestrator
├── packages/
│   ├── browser/             # Safari session management
│   ├── platforms/           # Platform adapters
│   │   ├── instagram/
│   │   ├── tiktok/
│   │   ├── threads/
│   │   └── twitter/
│   ├── selectors/           # Selector registry + validator
│   ├── actions/             # Action engine + verification
│   ├── db/                  # Database schema + migrations
│   └── observability/       # Logging, tracing, artifacts
├── tests/
│   ├── unit/                # Unit tests
│   ├── selectors/           # Selector contract tests
│   └── flows/               # Integration tests
├── docs/                    # Documentation
├── ADR/                     # Architecture Decision Records
└── scripts/                 # Utility scripts
```

## Branching Strategy

### Branch Naming

| Type | Pattern | Example |
|------|---------|---------|
| Feature | `feature/<description>` | `feature/instagram-dm-support` |
| Bug Fix | `fix/<description>` | `fix/twitter-selector-timeout` |
| Selector Update | `selectors/<platform>-<date>` | `selectors/instagram-2024-01` |
| Documentation | `docs/<description>` | `docs/tiktok-setup-guide` |
| Hotfix | `hotfix/<description>` | `hotfix/rate-limit-bypass` |

### Workflow

1. **Create branch** from `main`
2. **Develop** with small, focused commits
3. **Run tests** locally before pushing
4. **Open PR** with description template
5. **Address review** comments
6. **Squash merge** to `main`

## Adding Selectors

Selectors are the heart of this project. Follow this process carefully.

### 1. Selector Naming Convention

```
platform.page.element.variant
```

Examples:
- `instagram.post.likeButton.primary`
- `twitter.dm.messageInput.default`
- `tiktok.feed.videoCard.sponsored`

### 2. Selector File Structure

```typescript
// packages/selectors/src/platforms/instagram/post.ts

export const instagramPostSelectors = {
  likeButton: {
    primary: '[aria-label="Like"]',
    fallback1: 'svg[aria-label="Like"]',
    fallback2: '[data-testid="like-button"]',
    fallback3: 'button:has(svg[aria-label="Like"])',
  },
  commentInput: {
    primary: 'textarea[aria-label="Add a comment…"]',
    fallback1: '[data-testid="comment-input"]',
    fallback2: 'form textarea[placeholder*="comment"]',
  },
  // ...
};
```

### 3. Selector Priority

1. **Accessibility attributes** (aria-label, role) - most stable
2. **Data-testid attributes** - stable if present
3. **Semantic CSS** (element + class patterns)
4. **XPath** - last resort

### 4. Write Contract Tests

Every selector MUST have a contract test:

```typescript
// tests/selectors/instagram/post.test.ts

import { testSelectorContract } from '@/test-utils';
import { instagramPostSelectors } from '@/selectors/instagram/post';

describe('Instagram Post Selectors', () => {
  testSelectorContract('instagram.post.likeButton', {
    selectors: instagramPostSelectors.likeButton,
    expectations: {
      matchCount: 1,           // Exactly one element
      isClickable: true,       // Element can be clicked
      survivesScroll: true,    // Stable after scroll
      survivesRefresh: true,   // Stable after page refresh
    },
  });
});
```

### 5. Selector Change Workflow

1. **Detect breakage** (failing tests, alerts)
2. **Create branch** `selectors/<platform>-<date>`
3. **Update selectors** with new values
4. **Run contract tests** to verify
5. **Update snapshots** if needed
6. **Create ADR** if significant change
7. **Open PR** with breakage details

## Adding Platform Actions

### 1. Action Interface

All actions implement a standard interface:

```typescript
interface PlatformAction<TInput, TResult> {
  name: string;
  platform: Platform;
  execute(input: TInput, context: ActionContext): Promise<TResult>;
  verify(result: TResult, context: ActionContext): Promise<VerificationResult>;
  rollback?(result: TResult, context: ActionContext): Promise<void>;
}
```

### 2. Example Action

```typescript
// packages/actions/src/instagram/likePost.ts

export const likePostAction: PlatformAction<LikePostInput, LikePostResult> = {
  name: 'instagram.likePost',
  platform: 'instagram',
  
  async execute(input, context) {
    const { postUrl } = input;
    const { browser, selectors } = context;
    
    await browser.navigate(postUrl);
    const likeButton = await browser.findElement(selectors.instagram.post.likeButton);
    
    const wasAlreadyLiked = await likeButton.getAttribute('aria-pressed') === 'true';
    if (wasAlreadyLiked) {
      return { success: true, alreadyLiked: true, postUrl };
    }
    
    await likeButton.click();
    return { success: true, alreadyLiked: false, postUrl };
  },
  
  async verify(result, context) {
    // Re-check the like button state
    const likeButton = await context.browser.findElement(
      context.selectors.instagram.post.likeButton
    );
    const isLiked = await likeButton.getAttribute('aria-pressed') === 'true';
    
    return {
      verified: isLiked,
      method: 'dom-state-check',
      timestamp: new Date(),
    };
  },
};
```

### 3. Action Tests

```typescript
// tests/flows/instagram/likePost.test.ts

describe('Instagram Like Post', () => {
  it('should like an unliked post', async () => {
    const result = await likePostAction.execute(
      { postUrl: TEST_POST_URL },
      testContext
    );
    
    expect(result.success).toBe(true);
    expect(result.alreadyLiked).toBe(false);
    
    const verification = await likePostAction.verify(result, testContext);
    expect(verification.verified).toBe(true);
  });
  
  it('should handle already-liked post', async () => {
    // Like it first
    await likePostAction.execute({ postUrl: TEST_POST_URL }, testContext);
    
    // Try to like again
    const result = await likePostAction.execute(
      { postUrl: TEST_POST_URL },
      testContext
    );
    
    expect(result.success).toBe(true);
    expect(result.alreadyLiked).toBe(true);
  });
});
```

## Code Style

### TypeScript

- Strict mode enabled
- Explicit return types on public functions
- No `any` unless absolutely necessary
- Prefer `interface` over `type` for object shapes

### Testing

- Descriptive test names
- One assertion concept per test
- Use test fixtures, not hardcoded values
- Mock external dependencies

### Commits

```
type(scope): description

- feat: New feature
- fix: Bug fix
- docs: Documentation
- test: Test changes
- refactor: Code refactoring
- chore: Maintenance
```

Example: `feat(instagram): add DM thread extraction`

## Pull Request Process

### PR Template

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Feature
- [ ] Bug fix
- [ ] Selector update
- [ ] Documentation
- [ ] Refactor

## Platform(s) Affected
- [ ] Instagram
- [ ] TikTok
- [ ] Threads
- [ ] Twitter/X
- [ ] Core/All

## Testing
- [ ] Unit tests pass
- [ ] Selector contract tests pass
- [ ] Integration tests pass (if applicable)

## Checklist
- [ ] Code follows style guidelines
- [ ] Self-reviewed
- [ ] Documentation updated
- [ ] No sensitive data exposed
```

### Review Requirements

- **1 approval** minimum for most changes
- **2 approvals** for selector changes affecting multiple platforms
- **All CI checks** must pass

## Getting Help

- **Questions**: Open a Discussion
- **Bugs**: Open an Issue with reproduction steps
- **Security**: See [SECURITY.md](SECURITY.md)

## Code of Conduct

Be respectful, constructive, and collaborative. We're all here to build something useful.
