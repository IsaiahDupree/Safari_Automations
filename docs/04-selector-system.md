# Selector System

## Overview

The selector system is the heart of this project. Social media platforms frequently update their UIs, so selectors must be:

- **Versioned** - Track changes over time
- **Redundant** - Multiple fallbacks per element
- **Tested** - Contract tests for every selector
- **Recoverable** - Quick detection and patching of breakage

## Selector Naming Convention

```
platform.page.element.variant
```

### Examples

| Selector Path | Description |
|---------------|-------------|
| `instagram.post.likeButton.primary` | Main like button on a post |
| `instagram.post.likeButton.fallback1` | First fallback selector |
| `instagram.feed.postCard.default` | Post card in feed view |
| `twitter.dm.messageInput.default` | DM message input field |
| `tiktok.post.commentCount.sponsored` | Comment count on sponsored posts |

### Naming Rules

1. **Platform**: lowercase (`instagram`, `tiktok`, `threads`, `twitter`)
2. **Page**: camelCase (`post`, `feed`, `profile`, `dmThread`)
3. **Element**: camelCase, describes the element (`likeButton`, `commentInput`, `followerCount`)
4. **Variant**: describes the context (`primary`, `fallback1`, `sponsored`, `mobile`)

## Selector Priority

When creating selectors, prioritize stability:

### 1. Accessibility Attributes (Most Stable)

```css
/* aria-label */
[aria-label="Like"]

/* role */
[role="button"][aria-label="Comment"]

/* aria-describedby */
[aria-describedby="post-caption"]
```

### 2. Data Test IDs (Stable if Present)

```css
[data-testid="like-button"]
[data-testid="comment-input"]
```

### 3. Semantic Structure

```css
/* Element + specific class pattern */
button.like-button
textarea.comment-input

/* Structural hierarchy */
article > footer > button:first-child
```

### 4. Complex CSS (Less Stable)

```css
/* Multiple attribute selectors */
button[type="button"][class*="like"]

/* Pseudo-selectors */
div.post-actions > button:nth-child(1)
```

### 5. XPath (Last Resort)

```xpath
//button[contains(@class, 'like') and .//svg]
//div[@data-section='comments']//textarea
```

## Selector File Structure

### Directory Layout

```
packages/selectors/
├── src/
│   ├── index.ts              # Main export
│   ├── registry.ts           # Registry implementation
│   ├── validator.ts          # Contract validator
│   └── platforms/
│       ├── instagram/
│       │   ├── index.ts
│       │   ├── feed.ts
│       │   ├── post.ts
│       │   ├── profile.ts
│       │   ├── dm.ts
│       │   └── common.ts
│       ├── tiktok/
│       │   └── ...
│       ├── threads/
│       │   └── ...
│       └── twitter/
│           └── ...
├── tests/
│   └── contracts/
│       ├── instagram/
│       ├── tiktok/
│       ├── threads/
│       └── twitter/
└── snapshots/                # Baseline snapshots
```

### Selector Definition Format

```typescript
// packages/selectors/src/platforms/instagram/post.ts

import { SelectorGroup } from '../../types';

export const instagramPostSelectors: SelectorGroup = {
  // Like button
  likeButton: {
    primary: '[aria-label="Like"]',
    fallbacks: [
      'svg[aria-label="Like"]',
      '[data-testid="like-button"]',
      'button:has(svg[aria-label="Like"])',
      'section button:first-child',
    ],
    type: 'css',
    contract: {
      expectedCount: 'one',
      mustBeClickable: true,
      mustBeVisible: true,
    },
  },

  // Unlike button (when already liked)
  unlikeButton: {
    primary: '[aria-label="Unlike"]',
    fallbacks: [
      'svg[aria-label="Unlike"]',
      '[data-testid="unlike-button"]',
    ],
    type: 'css',
    contract: {
      expectedCount: 'one',
      mustBeClickable: true,
    },
  },

  // Comment input
  commentInput: {
    primary: 'textarea[aria-label="Add a comment…"]',
    fallbacks: [
      '[data-testid="comment-input"]',
      'form textarea[placeholder*="comment"]',
      'textarea[placeholder*="Add a comment"]',
    ],
    type: 'css',
    contract: {
      expectedCount: 'one',
      mustBeVisible: true,
    },
  },

  // Like count
  likeCount: {
    primary: 'section a[href*="liked_by"] span',
    fallbacks: [
      '[data-testid="like-count"]',
      'button[type="button"] span:has-text(/\\d+ likes?/)',
    ],
    type: 'css',
    contract: {
      expectedCount: 'one',
      extractionType: 'text',
      pattern: /^[\d,]+$/,
    },
  },

  // Comment count
  commentCount: {
    primary: 'a[href*="comments"] span',
    fallbacks: [
      '[data-testid="comment-count"]',
    ],
    type: 'css',
    contract: {
      expectedCount: 'one',
      extractionType: 'text',
      pattern: /^[\d,]+\s*comments?$/i,
    },
  },

  // Post image/video
  postMedia: {
    primary: 'article img[style*="object-fit"]',
    fallbacks: [
      'article video',
      '[data-testid="post-media"]',
    ],
    type: 'css',
    contract: {
      expectedCount: 'one',
      mustBeVisible: true,
    },
  },

  // Author username
  authorUsername: {
    primary: 'header a[role="link"][href^="/"]',
    fallbacks: [
      '[data-testid="post-author"]',
      'article header a:first-of-type',
    ],
    type: 'css',
    contract: {
      expectedCount: 'one',
      extractionType: 'text',
    },
  },

  // Post caption
  postCaption: {
    primary: 'article div[role="button"] span:not(:empty)',
    fallbacks: [
      '[data-testid="post-caption"]',
    ],
    type: 'css',
    contract: {
      expectedCount: 'one',
      extractionType: 'text',
      optional: true, // Some posts have no caption
    },
  },

  // Timestamp
  postTimestamp: {
    primary: 'time[datetime]',
    fallbacks: [
      '[data-testid="post-timestamp"]',
    ],
    type: 'css',
    contract: {
      expectedCount: 'one',
      extractionType: 'attribute',
      attribute: 'datetime',
    },
  },
};
```

### Type Definitions

```typescript
// packages/selectors/src/types.ts

export type SelectorType = 'css' | 'xpath' | 'aria';

export interface SelectorContract {
  /** Expected number of matching elements */
  expectedCount: 'one' | 'many' | number;
  
  /** Element must be clickable (not disabled, not obscured) */
  mustBeClickable?: boolean;
  
  /** Element must be visible in viewport */
  mustBeVisible?: boolean;
  
  /** Selector must still work after scrolling */
  mustSurviveScroll?: boolean;
  
  /** Selector must still work after page refresh */
  mustSurviveRefresh?: boolean;
  
  /** What to extract from the element */
  extractionType?: 'text' | 'attribute' | 'html';
  
  /** Attribute to extract (if extractionType is 'attribute') */
  attribute?: string;
  
  /** Pattern the extracted value must match */
  pattern?: RegExp;
  
  /** Element may not exist (don't fail if missing) */
  optional?: boolean;
}

export interface Selector {
  primary: string;
  fallbacks: string[];
  type: SelectorType;
  contract: SelectorContract;
}

export interface SelectorGroup {
  [elementName: string]: Selector;
}

export interface SelectorValidation {
  selector: string;
  valid: boolean;
  matchCount: number;
  errors: string[];
  warnings: string[];
}
```

## Selector Registry

### Usage

```typescript
import { SelectorRegistry } from '@/packages/selectors';

const registry = new SelectorRegistry();

// Get a selector with fallbacks
const likeButtonSelectors = registry.getWithFallbacks('instagram.post.likeButton');
// Returns: ['[aria-label="Like"]', 'svg[aria-label="Like"]', ...]

// Get primary selector only
const primarySelector = registry.get('instagram.post.likeButton');
// Returns: '[aria-label="Like"]'

// Check registry version
const version = registry.getVersion();
// Returns: '2024.01.15'
```

### Implementation

```typescript
// packages/selectors/src/registry.ts

export class SelectorRegistry {
  private selectors: Map<string, Selector> = new Map();
  private version: string;

  constructor() {
    this.loadSelectors();
    this.version = this.computeVersion();
  }

  get(path: string): string {
    const selector = this.selectors.get(path);
    if (!selector) {
      throw new SelectorNotFoundError(path);
    }
    return selector.primary;
  }

  getWithFallbacks(path: string): string[] {
    const selector = this.selectors.get(path);
    if (!selector) {
      throw new SelectorNotFoundError(path);
    }
    return [selector.primary, ...selector.fallbacks];
  }

  getSelector(path: string): Selector {
    const selector = this.selectors.get(path);
    if (!selector) {
      throw new SelectorNotFoundError(path);
    }
    return selector;
  }

  async validate(path: string, browser: Browser): Promise<SelectorValidation> {
    const selector = this.getSelector(path);
    return this.validateSelector(selector, browser);
  }

  getVersion(): string {
    return this.version;
  }

  private loadSelectors(): void {
    // Load all platform selectors
    this.loadPlatformSelectors('instagram', instagramSelectors);
    this.loadPlatformSelectors('tiktok', tiktokSelectors);
    this.loadPlatformSelectors('threads', threadsSelectors);
    this.loadPlatformSelectors('twitter', twitterSelectors);
  }

  private loadPlatformSelectors(platform: string, selectors: Record<string, SelectorGroup>): void {
    for (const [page, group] of Object.entries(selectors)) {
      for (const [element, selector] of Object.entries(group)) {
        const path = `${platform}.${page}.${element}`;
        this.selectors.set(path, selector);
      }
    }
  }
}
```

## Contract Testing

### Test Structure

```typescript
// tests/selectors/instagram/post.test.ts

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Browser } from '@/packages/browser';
import { SelectorRegistry } from '@/packages/selectors';
import { testSelectorContract } from '@/test-utils';

describe('Instagram Post Selectors', () => {
  let browser: Browser;
  let registry: SelectorRegistry;

  beforeAll(async () => {
    browser = new Browser();
    await browser.initialize();
    registry = new SelectorRegistry();
    
    // Navigate to a test post
    await browser.navigate(process.env.INSTAGRAM_TEST_POST_URL);
    await browser.waitForElement(registry.get('instagram.post.postMedia'));
  });

  afterAll(async () => {
    await browser.close();
  });

  describe('likeButton', () => {
    testSelectorContract('instagram.post.likeButton', {
      registry,
      browser,
      expectations: {
        matchCount: 1,
        isClickable: true,
        isVisible: true,
        survivesScroll: true,
      },
    });
  });

  describe('commentInput', () => {
    testSelectorContract('instagram.post.commentInput', {
      registry,
      browser,
      expectations: {
        matchCount: 1,
        isVisible: true,
      },
    });
  });

  describe('likeCount', () => {
    testSelectorContract('instagram.post.likeCount', {
      registry,
      browser,
      expectations: {
        matchCount: 1,
        extractedValueMatches: /^[\d,]+$/,
      },
    });
  });

  describe('authorUsername', () => {
    testSelectorContract('instagram.post.authorUsername', {
      registry,
      browser,
      expectations: {
        matchCount: 1,
        extractedValueMatches: /^[a-z0-9._]+$/i,
      },
    });
  });
});
```

### Contract Test Helper

```typescript
// test-utils/selectorContract.ts

export interface ContractExpectations {
  matchCount?: number | 'one' | 'many';
  isClickable?: boolean;
  isVisible?: boolean;
  survivesScroll?: boolean;
  survivesRefresh?: boolean;
  extractedValueMatches?: RegExp;
}

export function testSelectorContract(
  path: string,
  options: {
    registry: SelectorRegistry;
    browser: Browser;
    expectations: ContractExpectations;
  }
) {
  const { registry, browser, expectations } = options;
  const selector = registry.getSelector(path);

  it('primary selector finds elements', async () => {
    const elements = await browser.findElements(selector.primary);
    
    if (expectations.matchCount === 'one') {
      expect(elements.length).toBe(1);
    } else if (expectations.matchCount === 'many') {
      expect(elements.length).toBeGreaterThan(0);
    } else if (typeof expectations.matchCount === 'number') {
      expect(elements.length).toBe(expectations.matchCount);
    }
  });

  if (selector.fallbacks.length > 0) {
    it('at least one fallback finds elements', async () => {
      let found = false;
      for (const fallback of selector.fallbacks) {
        const elements = await browser.findElements(fallback);
        if (elements.length > 0) {
          found = true;
          break;
        }
      }
      expect(found).toBe(true);
    });
  }

  if (expectations.isClickable) {
    it('element is clickable', async () => {
      const element = await browser.findElement(selector.primary);
      const isClickable = await element.isEnabled() && await element.isDisplayed();
      expect(isClickable).toBe(true);
    });
  }

  if (expectations.isVisible) {
    it('element is visible', async () => {
      const element = await browser.findElement(selector.primary);
      const isVisible = await element.isDisplayed();
      expect(isVisible).toBe(true);
    });
  }

  if (expectations.survivesScroll) {
    it('survives scroll', async () => {
      await browser.scroll('down', 200);
      await browser.scroll('up', 200);
      
      const elements = await browser.findElements(selector.primary);
      expect(elements.length).toBeGreaterThan(0);
    });
  }

  if (expectations.survivesRefresh) {
    it('survives refresh', async () => {
      await browser.refresh();
      await browser.waitForElement(selector.primary);
      
      const elements = await browser.findElements(selector.primary);
      expect(elements.length).toBeGreaterThan(0);
    });
  }

  if (expectations.extractedValueMatches) {
    it('extracted value matches pattern', async () => {
      const element = await browser.findElement(selector.primary);
      const text = await element.getText();
      expect(text).toMatch(expectations.extractedValueMatches);
    });
  }
}
```

## Selector Versioning

### Version Format

```
YYYY.MM.DD[-platform][-sequence]
```

Examples:
- `2024.01.15` - General update
- `2024.01.15-instagram` - Instagram-specific update
- `2024.01.15-instagram-2` - Second Instagram update that day

### Version Tracking

```typescript
// packages/selectors/src/version.ts

export interface SelectorVersion {
  version: string;
  date: Date;
  platforms: string[];
  changes: SelectorChange[];
}

export interface SelectorChange {
  path: string;
  type: 'added' | 'modified' | 'deprecated' | 'removed';
  reason: string;
  previousValue?: string;
  newValue?: string;
}

// Version history stored in selectors/versions.json
```

## Change Management Workflow

### When Selectors Break

```
1. CI detects failure
   ├─ Nightly selector sweep fails
   └─ Or: PR test fails
           │
2. Alert triggered
   ├─ Slack notification
   └─ Issue auto-created
           │
3. Quarantine failing tests
   ├─ Mark tests as quarantined
   └─ Don't block other PRs
           │
4. Investigate
   ├─ What changed on the platform?
   ├─ Which selectors affected?
   └─ What are new selectors?
           │
5. Create selector update branch
   └─ selectors/instagram-2024-01-15
           │
6. Update selectors
   ├─ Update primary if needed
   ├─ Update/add fallbacks
   └─ Update contracts if needed
           │
7. Run contract tests locally
           │
8. Open PR
   ├─ Include before/after
   ├─ Link to quarantined tests
   └─ Include ADR if major change
           │
9. Review + merge
           │
10. Unquarantine tests
            │
11. Update version
```

### Selector Update PR Template

```markdown
## Selector Update: [Platform] [Date]

### Affected Selectors
- `instagram.post.likeButton` - UI redesign
- `instagram.post.commentInput` - Class name changed

### Changes

#### `instagram.post.likeButton`
**Reason**: Instagram redesigned like button, removed aria-label
**Previous primary**: `[aria-label="Like"]`
**New primary**: `[data-testid="like-icon-container"] button`

#### `instagram.post.commentInput`
**Reason**: Class name obfuscation changed
**Previous primary**: `textarea.comment-input`
**New primary**: `form[method="POST"] textarea`

### Testing
- [x] Contract tests pass locally
- [x] Flow tests pass locally
- [ ] Verified on live site (manual)

### ADR
[Link to ADR if major change]
```

## Quarantine System

### Marking Tests as Quarantined

```typescript
// tests/selectors/instagram/post.test.ts

describe.quarantine('Instagram Post Selectors - QUARANTINED 2024-01-15', () => {
  // These tests are temporarily disabled
  // Issue: #123
  // Reason: Instagram UI update broke likeButton selector
  
  it.skip('likeButton primary selector', async () => {
    // ...
  });
});
```

### Quarantine Tracker

```json
// tests/quarantine.json
{
  "quarantined": [
    {
      "path": "instagram.post.likeButton",
      "since": "2024-01-15",
      "issue": "#123",
      "reason": "Instagram UI redesign",
      "eta": "2024-01-17"
    }
  ]
}
```

## Best Practices

### DO

- ✅ Use accessibility attributes first
- ✅ Provide 3+ fallbacks
- ✅ Write contract tests for every selector
- ✅ Document why fallbacks exist
- ✅ Version all changes
- ✅ Run nightly selector sweeps

### DON'T

- ❌ Rely on dynamic class names
- ❌ Use deeply nested CSS paths
- ❌ Skip contract tests
- ❌ Update selectors without testing
- ❌ Remove fallbacks without reason

## Debugging Selectors

### Browser DevTools Workflow

1. Open platform in Safari
2. Right-click element → Inspect
3. Try selector in Console:
   ```javascript
   document.querySelectorAll('[aria-label="Like"]')
   ```
4. Verify count and element
5. Test fallbacks the same way

### Selector Debugging Tool

```bash
# Test a selector interactively
npm run selectors:debug -- --path="instagram.post.likeButton"

# Output:
# Selector: instagram.post.likeButton
# Primary: [aria-label="Like"]
#   → Found: 1 element
#   → Clickable: Yes
#   → Visible: Yes
# Fallback 1: svg[aria-label="Like"]
#   → Found: 1 element
# Fallback 2: [data-testid="like-button"]
#   → Found: 0 elements ⚠️
```
