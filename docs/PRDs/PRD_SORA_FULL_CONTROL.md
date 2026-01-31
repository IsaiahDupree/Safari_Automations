# PRD: Sora Full Platform Control

**Version:** 2.0  
**Date:** January 28, 2026  
**Status:** Assessment & Implementation

---

## Executive Summary

Complete Safari automation for sora.chatgpt.com with full controllability of all UI elements, buttons, selectors, and features.

---

## Success Criteria

### ✅ = Implemented | ⚠️ = Partial | ❌ = Not Working | 🔲 = Not Started

---

## 1. NAVIGATION

| Criterion | Status | Notes |
|-----------|--------|-------|
| Navigate to /explore | ✅ | Working |
| Navigate to /drafts | ✅ | Working |
| Navigate to /activity | 🔲 | Not tested |
| Navigate to /library | 🔲 | Not tested |
| Navigate to /settings | 🔲 | Not tested |
| Detect current page | ⚠️ | Needs improvement |

### Required Selectors
```javascript
// Navigation
URL: https://sora.chatgpt.com/explore
URL: https://sora.chatgpt.com/drafts
URL: https://sora.chatgpt.com/activity
URL: https://sora.chatgpt.com/library
```

---

## 2. AUTHENTICATION

| Criterion | Status | Notes |
|-----------|--------|-------|
| Detect logged in state | ⚠️ | Unreliable |
| Detect login prompt | 🔲 | Not implemented |
| Handle session expiry | 🔲 | Not implemented |

### Required Selectors
```javascript
// Login detection
textarea present = logged in
"Sign in" text = not logged in
```

---

## 3. PROMPT INPUT

| Criterion | Status | Notes |
|-----------|--------|-------|
| Find textarea | ✅ | Working |
| Clear textarea | ✅ | Working |
| Set prompt text | ✅ | Working |
| Type @character | ✅ | Working (direct typing) |
| Detect prompt length | 🔲 | Not implemented |

### Required Selectors
```javascript
// Prompt input
document.querySelector('textarea')

// Set value with React compatibility
var nativeSetter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype, 'value'
).set;
nativeSetter.call(textarea, prompt);
textarea.dispatchEvent(new Event('input', { bubbles: true }));
```

---

## 4. CHARACTER SELECTION

| Criterion | Status | Notes |
|-----------|--------|-------|
| Open Characters tab | ⚠️ | Button not always found |
| List available characters | ⚠️ | Timing issues |
| Select specific character | ⚠️ | Use direct @typing instead |
| Verify character selected | 🔲 | Not implemented |
| Deselect character | 🔲 | Not implemented |

### Current Working Method
```javascript
// Type @isaiahdupree directly in prompt (MOST RELIABLE)
prompt = "@isaiahdupree " + userPrompt;
```

### Required Selectors (for UI method)
```javascript
// Characters tab
document.querySelectorAll('button').find(b => b.textContent.trim() === 'Characters')

// Character buttons (after tab opened)
document.querySelectorAll('button').find(b => b.textContent.trim() === 'isaiahdupree')
```

---

## 5. STYLE SELECTION

| Criterion | Status | Notes |
|-----------|--------|-------|
| Open Styles tab | ⚠️ | Partial |
| List available styles | 🔲 | Not implemented |
| Select specific style | 🔲 | Not implemented |
| Verify style selected | 🔲 | Not implemented |

### Required Selectors
```javascript
// Styles tab
document.querySelectorAll('button').find(b => b.textContent.trim() === 'Styles')
```

---

## 6. VIDEO OPTIONS

| Criterion | Status | Notes |
|-----------|--------|-------|
| Set duration (10s/15s/25s) | ⚠️ | Partial |
| Set aspect ratio (Portrait/Landscape) | ⚠️ | Partial |
| Set resolution | 🔲 | Not implemented |
| Enable/disable audio | 🔲 | Not implemented |

### Required Selectors
```javascript
// Duration dropdown
document.querySelector('[aria-label*="duration"]')
// or find button containing "10 seconds" / "15 seconds" / "25 seconds"

// Aspect ratio
document.querySelector('[aria-label*="aspect"]')
// or find button containing "Portrait" / "Landscape"
```

---

## 7. VIDEO GENERATION

| Criterion | Status | Notes |
|-----------|--------|-------|
| Click "Create video" button | ✅ | Working |
| Detect button disabled state | 🔲 | Not implemented |
| Detect generation started | ⚠️ | By URL change |
| Detect queue position | 🔲 | Not implemented |

### Required Selectors
```javascript
// Create video button
document.querySelectorAll('button').find(b => 
    b.textContent.trim() === 'Create video' || 
    b.textContent.trim() === 'Create'
)

// Check if disabled
button.disabled === true
```

---

## 8. USAGE/CREDITS TRACKING

| Criterion | Status | Notes |
|-----------|--------|-------|
| Open Settings dialog | ⚠️ | Partial |
| Navigate to Usage tab | ⚠️ | Partial |
| Extract "X video gens left" | ❌ | **BROKEN - showing 0** |
| Extract "X free" count | ❌ | **BROKEN** |
| Extract "X paid" count | ❌ | **BROKEN** |
| Extract reset date | ❌ | **BROKEN** |
| Close dialog | ⚠️ | Partial |

### PRIORITY FIX NEEDED
```javascript
// Current broken selectors - need to investigate actual page structure

// Step 1: Click Settings button (sidebar)
document.querySelector('button[aria-label="Settings"]')

// Step 2: Click "User Settings" menu item
// Radix UI dynamic IDs - need better selector

// Step 3: Click "Usage" tab
dialog.querySelectorAll('button').find(b => b.textContent.trim() === 'Usage')

// Step 4: Extract usage text
// Pattern: "27 video gens left"
// Pattern: "27 free"
// Pattern: "0 paid"
// Pattern: "More available on Jan 29"
```

---

## 9. ACTIVITY/QUEUE MONITORING

| Criterion | Status | Notes |
|-----------|--------|-------|
| Navigate to /activity | 🔲 | Not tested |
| List generating videos | 🔲 | Not implemented |
| Get generation progress | 🔲 | Not implemented |
| Detect completion | 🔲 | Not implemented |
| Count queue items | 🔲 | Not implemented |

### Required Selectors
```javascript
// Activity page
URL: https://sora.chatgpt.com/activity

// Generating videos
document.querySelectorAll('[class*="generating"], [class*="progress"]')

// Progress indicators
// Need to inspect actual page structure
```

---

## 10. DRAFTS/DOWNLOADS

| Criterion | Status | Notes |
|-----------|--------|-------|
| Navigate to /drafts | ✅ | Working |
| List completed videos | ✅ | Working |
| Get video count | ✅ | Working |
| Get video URLs | ✅ | Working |
| Download video | ✅ | Working (curl) |
| Scroll to load more | ✅ | Working |

### Working Selectors
```javascript
// Video elements
document.querySelectorAll('video')

// Get video source URLs
videos.forEach(v => {
    var src = v.src || (v.querySelector('source') ? v.querySelector('source').src : '');
})
```

---

## 11. VIDEO PLAYBACK/PREVIEW

| Criterion | Status | Notes |
|-----------|--------|-------|
| Play video | 🔲 | Not implemented |
| Pause video | 🔲 | Not implemented |
| Seek video | 🔲 | Not implemented |
| Get video duration | 🔲 | Not implemented |

---

## 12. VIDEO MANAGEMENT

| Criterion | Status | Notes |
|-----------|--------|-------|
| Delete video | 🔲 | Not implemented |
| Download video (UI button) | 🔲 | Not implemented |
| Share video | 🔲 | Not implemented |
| Remix/edit video | 🔲 | Not implemented |

---

## Implementation Priority

### P0 - Critical (Fix Now)
1. **Usage/Credits extraction** - Currently broken, showing 0 instead of 27
2. **Reliable login detection**

### P1 - High
3. Activity page monitoring
4. Generation progress tracking
5. Queue management

### P2 - Medium
6. Character selection via UI (backup to @typing)
7. Style selection
8. Duration/aspect ratio controls

### P3 - Low
9. Video management (delete, share)
10. Video playback controls

---

## Testing Checklist

### Manual Test Script
```bash
# 1. Test navigation
python -c "from automation.sora_full_automation import SoraFullAutomation; s=SoraFullAutomation(); s.navigate_to_explore()"

# 2. Test login check
python -c "from automation.sora_full_automation import SoraFullAutomation; s=SoraFullAutomation(); print(s.check_login())"

# 3. Test usage (CURRENTLY BROKEN)
python -c "from automation.sora_full_automation import SoraFullAutomation; s=SoraFullAutomation(); print(s.get_usage())"

# 4. Test prompt entry
python -c "from automation.sora_full_automation import SoraFullAutomation; s=SoraFullAutomation(); s.set_prompt('@isaiahdupree test')"

# 5. Test create video
python -c "from automation.sora_full_automation import SoraFullAutomation; s=SoraFullAutomation(); s.click_create_video()"

# 6. Test drafts
python scripts/sora_download_from_drafts.py
```

---

## Selector Investigation Script

```python
# Run this to investigate current page structure
python3 -c "
import subprocess
import time

subprocess.run(['osascript', '-e', 
    'tell application \"Safari\" to set URL of front document to \"https://sora.chatgpt.com/explore\"'])
time.sleep(4)

js = '''
(function() {
    var result = {buttons: [], inputs: [], dialogs: []};
    
    document.querySelectorAll('button').forEach(b => {
        result.buttons.push({
            text: b.textContent.trim().substring(0, 50),
            ariaLabel: b.getAttribute('aria-label'),
            disabled: b.disabled
        });
    });
    
    document.querySelectorAll('input, textarea').forEach(i => {
        result.inputs.push({
            type: i.type,
            placeholder: i.placeholder,
            ariaLabel: i.getAttribute('aria-label')
        });
    });
    
    document.querySelectorAll('[role=dialog]').forEach(d => {
        result.dialogs.push({text: d.innerText.substring(0, 200)});
    });
    
    return JSON.stringify(result, null, 2);
})()
'''

print(subprocess.run(['osascript', '-e', 
    f'tell application \"Safari\" to do JavaScript \"{js}\" in front document'],
    capture_output=True, text=True).stdout)
"
```

---

## Files to Update

| File | Changes Needed |
|------|----------------|
| `automation/sora_full_automation.py` | Fix usage selectors |
| `services/sora/sora_usage_tracker.py` | Update extraction logic |
| `scripts/sora_generate_with_isaiahdupree.py` | Add usage check |

---

## Next Steps

1. Run selector investigation script on live Sora page
2. Update usage extraction selectors
3. Add activity page monitoring
4. Create comprehensive test suite
