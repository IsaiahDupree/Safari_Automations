# Safari WebDriver Setup

## Overview

Safari WebDriver (safaridriver) is Apple's implementation of the WebDriver protocol for Safari. It enables automated testing and browser control on macOS.

## Requirements

- **macOS** 10.13 (High Sierra) or later
- **Safari** 10 or later (included with macOS)
- **Administrator access** for initial setup

## Initial Setup

### 1. Enable Safari WebDriver

Open Terminal and run:

```bash
safaridriver --enable
```

You'll be prompted for your administrator password. This is a one-time setup.

### 2. Verify Installation

```bash
safaridriver --version
```

Expected output:
```
Included with Safari 17.0 (macOS 14.0)
```

### 3. Enable Remote Automation in Safari

1. Open **Safari**
2. Go to **Safari → Settings** (or Preferences)
3. Click **Advanced** tab
4. Check **"Show Develop menu in menu bar"**
5. Close Settings
6. Click **Develop** menu
7. Check **"Allow Remote Automation"**

### 4. First Run Authorization

The first time safaridriver connects, macOS will prompt for permission. Run a simple test:

```bash
# Start safaridriver on default port
safaridriver --port 4444 &

# Test with a simple curl (should return session info)
curl -X POST http://localhost:4444/session \
  -H "Content-Type: application/json" \
  -d '{"capabilities": {"browserName": "safari"}}'
```

Click **"Allow"** when prompted.

## Configuration Options

### Port Configuration

Default port is 4444. To use a different port:

```bash
safaridriver --port 9515
```

### Diagnostic Mode

For debugging issues:

```bash
safaridriver --diagnose
```

This outputs detailed diagnostic information.

## Known Limitations

### 1. No Headless Mode

Safari WebDriver **does not support headless mode**. Safari must run with a visible window.

**Workaround for CI**: Use Playwright's WebKit engine for headless testing (not true Safari, but same rendering engine).

### 2. Single Session

Safari WebDriver supports **only one session at a time**. Attempting to create a second session will fail.

**Workaround**: Queue sessions, don't parallelize.

### 3. macOS Only

Safari WebDriver only runs on macOS. No Windows or Linux support.

**Workaround**: Use macOS CI runners (GitHub Actions supports macOS).

### 4. No Incognito/Private Mode

Cannot create private browsing sessions via WebDriver.

**Workaround**: Clear cookies/storage between sessions programmatically.

### 5. Window Must Be Visible

Safari window cannot be minimized or hidden during automation.

**Workaround**: Run on dedicated machine or use screen sharing.

### 6. No Network Throttling

Cannot simulate slow network conditions.

### 7. No Mobile Emulation

Cannot emulate mobile Safari (iOS) with desktop Safari WebDriver.

## Session Management

### Creating a Session

```typescript
import { Builder } from 'selenium-webdriver';
import safari from 'selenium-webdriver/safari';

const options = new safari.Options();

const driver = await new Builder()
  .forBrowser('safari')
  .setSafariOptions(options)
  .build();
```

### Session Capabilities

```typescript
const capabilities = {
  browserName: 'safari',
  platformName: 'macOS',
  'safari:automaticInspection': false,
  'safari:automaticProfiling': false,
};
```

### Ending a Session

Always quit the session properly:

```typescript
await driver.quit();
```

Failing to quit leaves Safari in an unstable state.

## Cookie Management

### Saving Cookies

```typescript
async function saveCookies(driver: WebDriver, filepath: string) {
  const cookies = await driver.manage().getCookies();
  await fs.writeFile(filepath, JSON.stringify(cookies, null, 2));
}
```

### Restoring Cookies

```typescript
async function restoreCookies(driver: WebDriver, filepath: string) {
  const cookies = JSON.parse(await fs.readFile(filepath, 'utf-8'));
  
  for (const cookie of cookies) {
    await driver.manage().addCookie(cookie);
  }
}
```

### Session Persistence Strategy

```
1. Navigate to platform domain (required before adding cookies)
2. Clear existing cookies
3. Restore saved cookies
4. Refresh page
5. Verify login state
```

## Error Handling

### Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `SessionNotCreatedException` | Another session active | Quit existing session |
| `WebDriverException: safari` | safaridriver not enabled | Run `safaridriver --enable` |
| `UnknownError: An unknown error occurred` | Permission denied | Allow Remote Automation |
| `InvalidSessionId` | Session expired/closed | Create new session |
| `NoSuchElementException` | Element not found | Check selector, add wait |
| `ElementNotInteractableException` | Element not clickable | Scroll into view, wait |

### Recovery Strategies

```typescript
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  delayMs: number = 1000
): Promise<T> {
  let lastError: Error;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      if (isRecoverable(error)) {
        await sleep(delayMs * (i + 1));
        continue;
      }
      
      throw error;
    }
  }
  
  throw lastError;
}

function isRecoverable(error: Error): boolean {
  const recoverableMessages = [
    'stale element reference',
    'element not interactable',
    'timeout',
  ];
  
  return recoverableMessages.some(msg => 
    error.message.toLowerCase().includes(msg)
  );
}
```

## Performance Tips

### 1. Reuse Sessions

Don't create new sessions for every action. Reuse the session:

```typescript
class BrowserManager {
  private driver: WebDriver | null = null;
  
  async getDriver(): Promise<WebDriver> {
    if (!this.driver) {
      this.driver = await this.createDriver();
    }
    return this.driver;
  }
  
  async close(): Promise<void> {
    if (this.driver) {
      await this.driver.quit();
      this.driver = null;
    }
  }
}
```

### 2. Explicit Waits Over Implicit

```typescript
// Good: Explicit wait for specific element
await driver.wait(until.elementLocated(By.css('.post')), 10000);

// Avoid: Implicit waits (affects all operations)
await driver.manage().setTimeouts({ implicit: 10000 });
```

### 3. Minimize Page Loads

Navigate once, interact multiple times:

```typescript
// Good: Load page once, interact with multiple elements
await driver.get(postUrl);
await extractStats();
await likePost();
await addComment();

// Avoid: Reloading between actions
await driver.get(postUrl);
await extractStats();
await driver.get(postUrl);  // Unnecessary reload
await likePost();
```

### 4. Use JavaScript for Complex Operations

```typescript
// Fast: Execute JavaScript directly
const stats = await driver.executeScript(`
  return {
    likes: document.querySelector('.likes-count')?.textContent,
    comments: document.querySelector('.comments-count')?.textContent,
  };
`);

// Slower: Multiple WebDriver calls
const likesEl = await driver.findElement(By.css('.likes-count'));
const likes = await likesEl.getText();
const commentsEl = await driver.findElement(By.css('.comments-count'));
const comments = await commentsEl.getText();
```

## Debugging

### Screenshot on Failure

```typescript
async function takeScreenshot(driver: WebDriver, name: string): Promise<string> {
  const screenshot = await driver.takeScreenshot();
  const filepath = `./screenshots/${name}-${Date.now()}.png`;
  await fs.writeFile(filepath, screenshot, 'base64');
  return filepath;
}
```

### Page Source on Failure

```typescript
async function savePageSource(driver: WebDriver, name: string): Promise<string> {
  const source = await driver.getPageSource();
  const filepath = `./debug/${name}-${Date.now()}.html`;
  await fs.writeFile(filepath, source);
  return filepath;
}
```

### Console Logs

```typescript
async function getConsoleLogs(driver: WebDriver): Promise<string[]> {
  const logs = await driver.manage().logs().get('browser');
  return logs.map(entry => `[${entry.level}] ${entry.message}`);
}
```

## Troubleshooting

### "Allow Remote Automation" Won't Stay Enabled

This can happen after macOS updates. Solution:

```bash
# Reset Safari automation settings
defaults delete com.apple.Safari AllowRemoteAutomation

# Re-enable
safaridriver --enable
```

Then re-check "Allow Remote Automation" in Safari.

### Session Hangs

If Safari becomes unresponsive:

```bash
# Kill Safari processes
pkill -9 Safari
pkill -9 safaridriver

# Restart safaridriver
safaridriver --port 4444
```

### "Operation not permitted" Errors

System Integrity Protection (SIP) may block automation:

1. Verify safaridriver location: `which safaridriver` → should be `/usr/bin/safaridriver`
2. Don't move or symlink safaridriver
3. Use the system-provided binary only

## Integration with This Project

### Browser Package

The `packages/browser` module wraps Safari WebDriver:

```typescript
import { SafariBrowser } from '@/packages/browser';

const browser = new SafariBrowser({
  screenshotOnFailure: true,
  defaultTimeout: 30000,
});

await browser.initialize();
await browser.navigate('https://instagram.com');
// ... actions
await browser.close();
```

See `packages/browser/README.md` for full API documentation.
