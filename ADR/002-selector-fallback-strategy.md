# ADR 002: Selector Fallback Strategy

## Status

Accepted

## Context

Social media platforms frequently update their UIs, breaking CSS/XPath selectors. We need a strategy that:

1. Minimizes automation failures when UIs change
2. Allows quick recovery from selector breakage
3. Maintains high reliability for core actions
4. Is maintainable as platforms evolve

## Decision

Implement a **multi-fallback selector system** with the following characteristics:

1. **Primary selector**: Most stable, preferred approach
2. **3+ fallback selectors**: Alternative approaches using different strategies
3. **Selector contracts**: Define expected behavior for validation
4. **Automatic fallback**: Try fallbacks sequentially on primary failure

## Selector Priority Order

When defining selectors, prioritize stability:

1. **Accessibility attributes** (`aria-label`, `role`) - Most stable
2. **data-testid attributes** - Stable when present
3. **Semantic CSS** (element type + stable class patterns)
4. **Structural CSS** (hierarchy-based)
5. **XPath** - Last resort

## Implementation

```typescript
interface Selector {
  primary: string;
  fallbacks: string[];
  type: 'css' | 'xpath' | 'aria';
  contract: {
    expectedCount: 'one' | 'many' | number;
    mustBeClickable?: boolean;
    mustBeVisible?: boolean;
  };
}

async function findWithFallbacks(
  browser: Browser,
  selector: Selector
): Promise<Element> {
  const allSelectors = [selector.primary, ...selector.fallbacks];
  
  for (const sel of allSelectors) {
    try {
      const elements = await browser.findElements(sel);
      if (elements.length > 0) {
        // Validate against contract
        if (await validateContract(elements, selector.contract)) {
          return elements[0];
        }
      }
    } catch (e) {
      // Continue to next fallback
    }
  }
  
  throw new SelectorError(`No working selector found for ${selector.primary}`);
}
```

## Rationale

### Why Multiple Fallbacks?

- Platforms A/B test UI changes
- Different users see different versions
- Changes roll out gradually
- One approach may break while others still work

### Why Accessibility First?

- Accessibility attributes are required for compliance
- They're semantic and describe function, not appearance
- Less likely to change arbitrarily
- data-testid is explicitly for testing, relatively stable

### Why Contracts?

- Validates that we found the right element
- Catches false positives (wrong element matches selector)
- Enables automated selector health checking

## Consequences

### Positive

- Higher reliability during UI changes
- Faster recovery from breakage
- Self-healing capability
- Better observability into selector health

### Negative

- More selectors to maintain
- Slightly slower element lookup
- More complex codebase
- Need regular selector audits

### Mitigations

- Automated nightly selector sweeps
- Quarantine system for broken selectors
- Clear selector update workflow
- Good tooling for selector debugging

## Example

```typescript
const likeButton: Selector = {
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
};
```

## References

- [docs/04-selector-system.md](../docs/04-selector-system.md)
- [docs/runbooks/selector-breakage.md](../docs/runbooks/selector-breakage.md)
