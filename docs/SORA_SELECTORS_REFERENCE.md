# Sora Selectors Reference

**URL:** `https://sora.chatgpt.com`  
**Last Updated:** 2026-01-30  
**Status:** Verified Working

---

## Summary of Known Working Sora Selectors

| Category | Selector | Status |
|----------|----------|--------|
| **Prompt Input** | `textarea` | ✅ Working |
| **Settings Button** | `button[aria-label="Settings"]` | ✅ Working |
| **Menu Items** | `[role=menuitem]` | ✅ Working |
| **Dialog** | `[role=dialog]` | ✅ Working |
| **Duration Options** | `[role=menuitemradio]`, `[data-radix-collection-item]` | ✅ Working |
| **Create Button** | Button text "Create video" | ✅ Working |
| **Video Element** | `video`, `video[src]` | ✅ Working |
| **Progress** | `[role="progressbar"]`, `[class*="progress"]` | ✅ Working |
| **Characters/Styles Tabs** | Button text match | ✅ Working |

---

## Detailed Selectors

### Prompt Input
```javascript
// Primary prompt textarea
const promptInput = document.querySelector('textarea');

// Set value with React compatibility
const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
  window.HTMLTextAreaElement.prototype, 'value'
).set;
nativeInputValueSetter.call(promptInput, '@isaiahdupree Your prompt here');
promptInput.dispatchEvent(new Event('input', { bubbles: true }));
```

### Settings Button
```javascript
// Open settings panel
const settingsBtn = document.querySelector('button[aria-label="Settings"]');
settingsBtn.click();
```

### Duration Selection (Radix UI Pattern)
```javascript
// Duration options use Radix UI - requires full mouse event sequence
function clickRadixElement(element) {
  const events = [
    new PointerEvent('pointerdown', { bubbles: true }),
    new MouseEvent('mousedown', { bubbles: true }),
    new PointerEvent('pointerup', { bubbles: true }),
    new MouseEvent('mouseup', { bubbles: true }),
    new MouseEvent('click', { bubbles: true })
  ];
  events.forEach(e => element.dispatchEvent(e));
}

// Find duration by text
const durations = document.querySelectorAll('[role=menuitemradio]');
durations.forEach(d => {
  if (d.textContent.includes('10s')) {
    clickRadixElement(d);
  }
});
```

### Aspect Ratio Selection
```javascript
// Aspect ratio options
const aspectOptions = document.querySelectorAll('[data-radix-collection-item]');
// Options: 16:9, 9:16, 1:1
```

### Create Video Button
```javascript
// Find by text content
const buttons = document.querySelectorAll('button');
const createBtn = Array.from(buttons).find(b => 
  b.textContent.includes('Create video')
);
createBtn.click();
```

### Video Detection (for polling drafts)
```javascript
// Check if video is ready
const video = document.querySelector('video[src]');
if (video && video.src) {
  console.log('Video ready:', video.src);
}

// Progress indicator
const progress = document.querySelector('[role="progressbar"]');
const progressClass = document.querySelector('[class*="progress"]');
```

### Character Selection
```javascript
// Find character tab/button
const charBtn = Array.from(document.querySelectorAll('button')).find(b =>
  b.textContent.toLowerCase().includes('character')
);

// Select specific character by name
const charOptions = document.querySelectorAll('[role=menuitem]');
charOptions.forEach(c => {
  if (c.textContent.includes('@isaiahdupree')) {
    clickRadixElement(c);
  }
});
```

### Library/Drafts Page
```javascript
// Navigate to library
// URL: https://sora.chatgpt.com/library

// Video cards in library
const videoCards = document.querySelectorAll('video');

// Scroll to load more (pagination)
window.scrollTo(0, document.body.scrollHeight);
```

---

## Key Patterns

### 1. Radix UI Requires Full Mouse Events
Radix UI components don't respond to simple `.click()`. Must dispatch full event sequence:
```javascript
pointerdown → mousedown → pointerup → mouseup → click
```

### 2. React Textarea Value Setting
React intercepts normal value setting. Use native setter + input event:
```javascript
const nativeSetter = Object.getOwnPropertyDescriptor(
  HTMLTextAreaElement.prototype, 'value'
).set;
nativeSetter.call(element, value);
element.dispatchEvent(new Event('input', { bubbles: true }));
```

### 3. Text-Based Button Selection
Most reliable for buttons (dynamic IDs change):
```javascript
Array.from(document.querySelectorAll('button'))
  .find(b => b.textContent.includes('Target Text'));
```

### 4. Drafts Pagination
Initial load shows ~13 videos. Scroll to load more:
```javascript
async function loadAllDrafts() {
  let lastCount = 0;
  while (true) {
    window.scrollTo(0, document.body.scrollHeight);
    await new Promise(r => setTimeout(r, 1000));
    const count = document.querySelectorAll('video').length;
    if (count === lastCount) break;
    lastCount = count;
  }
}
```

---

## Configuration Constants

```typescript
export const SORA_SELECTORS = {
  // URLs
  BASE_URL: 'https://sora.chatgpt.com',
  LIBRARY_URL: 'https://sora.chatgpt.com/library',
  
  // Prompt
  PROMPT_INPUT: 'textarea',
  
  // Settings
  SETTINGS_BUTTON: 'button[aria-label="Settings"]',
  
  // Menus
  MENU_ITEM: '[role=menuitem]',
  MENU_ITEM_RADIO: '[role=menuitemradio]',
  RADIX_ITEM: '[data-radix-collection-item]',
  DIALOG: '[role=dialog]',
  
  // Actions
  CREATE_BUTTON_TEXT: 'Create video',
  
  // Video
  VIDEO: 'video',
  VIDEO_WITH_SRC: 'video[src]',
  PROGRESS: '[role="progressbar"]',
  
  // Character
  CHARACTER_PREFIX: '@isaiahdupree',
};
```
