# ADR 001: Safari WebDriver as Primary Automation Tool

## Status

Accepted

## Context

We need to choose a browser automation approach for this project. The requirements are:

1. Must work with Safari on macOS
2. Must support real browser behavior (not headless simulation)
3. Must support session persistence
4. Must be maintainable long-term

Options considered:

1. **Safari WebDriver (safaridriver)** - Apple's native WebDriver implementation
2. **Playwright WebKit** - Cross-platform WebKit automation
3. **Selenium + Safari** - Selenium wrapper around safaridriver
4. **AppleScript + Safari** - Native macOS scripting

## Decision

We will use **Safari WebDriver (safaridriver)** as the primary automation tool, with Selenium WebDriver bindings for the JavaScript API.

## Rationale

### Safari WebDriver (Chosen)

**Pros**:
- Native Safari support from Apple
- Most accurate Safari behavior
- Maintained by Apple
- Supports all Safari features
- Session/cookie management works correctly
- No additional installation beyond macOS

**Cons**:
- macOS only
- No headless mode
- Single session at a time
- Window must be visible

### Playwright WebKit (Rejected for Primary)

**Pros**:
- Cross-platform
- Headless support
- Better CI integration
- Modern API

**Cons**:
- Not actual Safari (just WebKit engine)
- May have subtle differences from real Safari
- Cookie/session behavior may differ
- Platform detection may differ

**Decision**: Use Playwright WebKit as secondary option for CI smoke tests only.

### Selenium + Safari (Implementation Choice)

We'll use Selenium WebDriver bindings which wrap safaridriver, providing:
- Familiar API
- Good TypeScript support
- Ecosystem of utilities

### AppleScript (Rejected)

**Pros**:
- Very native
- Can do things WebDriver can't

**Cons**:
- Fragile
- Poor error handling
- Difficult to maintain
- Limited element interaction

## Consequences

### Positive

- Most accurate Safari behavior
- Cookie/session handling matches real Safari
- Platform detection works correctly
- Official Apple support

### Negative

- Development/testing requires macOS
- CI requires macOS runners (more expensive)
- Cannot run headless
- Single session limitation

### Mitigations

- Use Playwright WebKit for basic CI coverage
- Document macOS requirement clearly
- Provide session queuing for single-session limitation
- Consider self-hosted macOS runners for cost

## Implementation Notes

```typescript
import { Builder } from 'selenium-webdriver';
import safari from 'selenium-webdriver/safari';

const options = new safari.Options();
const driver = await new Builder()
  .forBrowser('safari')
  .setSafariOptions(options)
  .build();
```

## References

- [Safari WebDriver Documentation](https://developer.apple.com/documentation/webkit/testing_with_webdriver_in_safari)
- [Selenium Safari Driver](https://www.selenium.dev/documentation/webdriver/browsers/safari/)
