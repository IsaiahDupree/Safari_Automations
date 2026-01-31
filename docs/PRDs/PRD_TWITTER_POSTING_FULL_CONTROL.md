# PRD: Twitter/X Posting Full Platform Control

**Version:** 1.0  
**Date:** January 28, 2026  
**Status:** Assessment & Implementation

---

## Executive Summary

Complete Safari automation for Twitter/X posting (tweets, replies, threads) with full controllability of all UI elements, buttons, selectors, and features.

**Target URL:** `https://x.com/compose/tweet` or `https://x.com/home`

---

## Success Criteria

### ✅ = Implemented | ⚠️ = Partial | ❌ = Not Working | 🔲 = Not Started

---

## 1. NAVIGATION

| Criterion | Status | Notes |
|-----------|--------|-------|
| Navigate to x.com | 🔲 | |
| Navigate to /home | 🔲 | Timeline |
| Navigate to /compose/tweet | 🔲 | Compose modal |
| Navigate to specific tweet | 🔲 | /{username}/status/{id} |
| Navigate to user profile | 🔲 | /{username} |
| Navigate to /notifications | 🔲 | |
| Detect current page | 🔲 | |

### Required Selectors
```javascript
// Navigation URLs
URL: https://x.com/home
URL: https://x.com/compose/tweet
URL: https://x.com/{username}/status/{tweet_id}
URL: https://x.com/{username}
URL: https://x.com/notifications

// Detect home page
document.querySelector('[data-testid="primaryColumn"]')
window.location.pathname === '/home'
```

---

## 2. AUTHENTICATION

| Criterion | Status | Notes |
|-----------|--------|-------|
| Detect logged in state | 🔲 | |
| Detect login prompt | 🔲 | |
| Handle 2FA prompt | 🔲 | Manual (code: 7911) |
| Handle encryption code prompt | 🔲 | Code: 7911 |
| Handle session expiry | 🔲 | |
| Detect rate limiting | 🔲 | |
| Detect account suspension | 🔲 | |

### Required Selectors
```javascript
// Login detection
document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]') // Logged in
document.querySelector('[data-testid="loginButton"]') // Not logged in
document.querySelector('a[href="/login"]') // Login link

// Account selector (shows which account you're using)
document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]')

// Encryption code: 7911
```

---

## 3. COMPOSE TWEET

| Criterion | Status | Notes |
|-----------|--------|-------|
| Open compose modal | 🔲 | |
| Find tweet input | 🔲 | |
| Clear input | 🔲 | |
| Type tweet text | 🔲 | |
| Check character count | 🔲 | Max 280 |
| Detect over limit | 🔲 | |

### Required Selectors
```javascript
// Open compose modal
document.querySelector('[data-testid="SideNav_NewTweet_Button"]')
document.querySelector('[aria-label="Post"]')
document.querySelector('a[href="/compose/tweet"]')

// Tweet input - DraftJS editor
document.querySelector('[data-testid="tweetTextarea_0"]')
document.querySelector('[data-testid="tweetTextarea_0_label"]')
document.querySelector('[role="textbox"][data-testid*="tweet"]')
document.querySelector('.DraftEditor-root [contenteditable="true"]')

// Set text in DraftJS
const editor = document.querySelector('[data-testid="tweetTextarea_0"]');
editor.focus();
document.execCommand('insertText', false, tweetText);

// Character count
document.querySelector('[data-testid="tweetTextarea_0_label"] + div')
document.querySelector('[class*="CharacterCounter"]')
```

---

## 4. POST TWEET

| Criterion | Status | Notes |
|-----------|--------|-------|
| Find post button | 🔲 | |
| Check button enabled | 🔲 | |
| Click post button | 🔲 | |
| Verify tweet posted | 🔲 | |
| Get posted tweet URL | 🔲 | |
| Handle post failure | 🔲 | |

### Required Selectors
```javascript
// Post button
document.querySelector('[data-testid="tweetButton"]')
document.querySelector('[data-testid="tweetButtonInline"]')
document.querySelector('button[data-testid*="tweetButton"]')

// Check if enabled
button.disabled === false
button.getAttribute('aria-disabled') !== 'true'

// Click to post
button.click()

// Verify posted - check for success toast or redirect
document.querySelector('[data-testid="toast"]')
window.location.href.includes('/status/')
```

---

## 5. MEDIA ATTACHMENTS

| Criterion | Status | Notes |
|-----------|--------|-------|
| Attach image | 🔲 | |
| Attach multiple images (up to 4) | 🔲 | |
| Attach video | 🔲 | |
| Attach GIF | 🔲 | |
| Remove attachment | 🔲 | |
| Add alt text | 🔲 | |
| Detect upload progress | 🔲 | |
| Verify upload complete | 🔲 | |

### Required Selectors
```javascript
// Media button
document.querySelector('[data-testid="fileInput"]')
document.querySelector('input[type="file"][accept*="image"]')
document.querySelector('[aria-label="Add photos or video"]')

// GIF button
document.querySelector('[data-testid="gifSearchButton"]')
document.querySelector('[aria-label="Add a GIF"]')

// Emoji button
document.querySelector('[data-testid="emojiButton"]')
document.querySelector('[aria-label="Add emoji"]')

// Upload via file input
const fileInput = document.querySelector('input[type="file"]');
// Programmatically set files requires creating DataTransfer

// Remove attachment
document.querySelector('[data-testid="removeButton"]')
document.querySelector('[aria-label="Remove media"]')

// Alt text
document.querySelector('[data-testid="altTextButton"]')
document.querySelector('[aria-label="Add description"]')

// Upload progress
document.querySelector('[data-testid="progressBar"]')
document.querySelector('[class*="UploadProgress"]')
```

---

## 6. REPLY TO TWEET

| Criterion | Status | Notes |
|-----------|--------|-------|
| Navigate to tweet | 🔲 | |
| Click reply button | 🔲 | |
| Find reply input | 🔲 | |
| Type reply | 🔲 | |
| Post reply | 🔲 | |
| Verify reply posted | 🔲 | |

### Required Selectors
```javascript
// Reply button on tweet
document.querySelector('[data-testid="reply"]')
document.querySelector('[aria-label*="Reply"]')

// Reply input (same as tweet input in modal)
document.querySelector('[data-testid="tweetTextarea_0"]')

// Post reply button
document.querySelector('[data-testid="tweetButton"]')
```

---

## 7. QUOTE TWEET

| Criterion | Status | Notes |
|-----------|--------|-------|
| Click retweet button | 🔲 | |
| Select "Quote" option | 🔲 | |
| Add quote text | 🔲 | |
| Post quote tweet | 🔲 | |
| Verify posted | 🔲 | |

### Required Selectors
```javascript
// Retweet button
document.querySelector('[data-testid="retweet"]')
document.querySelector('[aria-label*="Repost"]')

// Quote option in menu
document.querySelector('[data-testid="QuoteTweet"]')
document.querySelector('[role="menuitem"]').find(m => m.innerText.includes('Quote'))

// Then use standard tweet compose flow
```

---

## 8. RETWEET (NO QUOTE)

| Criterion | Status | Notes |
|-----------|--------|-------|
| Click retweet button | 🔲 | |
| Select "Repost" option | 🔲 | |
| Verify retweet | 🔲 | |
| Undo retweet | 🔲 | |

### Required Selectors
```javascript
// Retweet button
document.querySelector('[data-testid="retweet"]')

// Repost option
document.querySelector('[data-testid="retweetConfirm"]')

// Undo
document.querySelector('[data-testid="unretweet"]')
```

---

## 9. LIKE TWEET

| Criterion | Status | Notes |
|-----------|--------|-------|
| Find like button | 🔲 | |
| Click like | 🔲 | |
| Verify liked | 🔲 | |
| Unlike | 🔲 | |

### Required Selectors
```javascript
// Like button
document.querySelector('[data-testid="like"]')
document.querySelector('[aria-label*="Like"]')

// Unlike
document.querySelector('[data-testid="unlike"]')

// Check if liked
button.getAttribute('data-testid') === 'unlike' // Already liked
```

---

## 10. THREAD CREATION

| Criterion | Status | Notes |
|-----------|--------|-------|
| Start thread | 🔲 | |
| Add thread tweet | 🔲 | |
| Add multiple tweets | 🔲 | |
| Remove tweet from thread | 🔲 | |
| Post entire thread | 🔲 | |
| Verify thread posted | 🔲 | |

### Required Selectors
```javascript
// Add another tweet button
document.querySelector('[data-testid="addTweetButton"]')
document.querySelector('[aria-label="Add another Tweet"]')

// Multiple tweet inputs
document.querySelectorAll('[data-testid^="tweetTextarea_"]')
document.querySelector('[data-testid="tweetTextarea_1"]') // Second tweet
document.querySelector('[data-testid="tweetTextarea_2"]') // Third tweet

// Remove tweet from thread
document.querySelector('[data-testid="removeTweetButton"]')
```

---

## 11. SCHEDULED TWEETS

| Criterion | Status | Notes |
|-----------|--------|-------|
| Open schedule options | 🔲 | |
| Set date/time | 🔲 | |
| Confirm schedule | 🔲 | |
| View scheduled tweets | 🔲 | |
| Edit scheduled tweet | 🔲 | |
| Delete scheduled tweet | 🔲 | |

### Required Selectors
```javascript
// Schedule button
document.querySelector('[data-testid="scheduleButton"]')
document.querySelector('[aria-label="Schedule"]')

// Date picker
document.querySelector('[data-testid="scheduleDatePicker"]')

// Time picker
document.querySelector('[data-testid="scheduleTimePicker"]')

// Confirm
document.querySelector('[data-testid="scheduleConfirmButton"]')

// View scheduled
URL: https://x.com/compose/tweet/unsent/scheduled
```

---

## 12. POLLS

| Criterion | Status | Notes |
|-----------|--------|-------|
| Add poll | 🔲 | |
| Enter poll options | 🔲 | |
| Set poll duration | 🔲 | |
| Remove poll | 🔲 | |

### Required Selectors
```javascript
// Poll button
document.querySelector('[data-testid="pollButton"]')
document.querySelector('[aria-label="Add poll"]')

// Poll option inputs
document.querySelectorAll('[data-testid="pollOption"]')
document.querySelector('[data-testid="pollOption_0"]')
document.querySelector('[data-testid="pollOption_1"]')

// Add option
document.querySelector('[data-testid="addPollOption"]')

// Duration selector
document.querySelector('[data-testid="pollDuration"]')

// Remove poll
document.querySelector('[data-testid="removePoll"]')
```

---

## 13. LOCATION TAGGING

| Criterion | Status | Notes |
|-----------|--------|-------|
| Open location picker | 🔲 | |
| Search location | 🔲 | |
| Select location | 🔲 | |
| Remove location | 🔲 | |

### Required Selectors
```javascript
// Location button
document.querySelector('[data-testid="geoButton"]')
document.querySelector('[aria-label="Add location"]')

// Location search
document.querySelector('[data-testid="locationSearchInput"]')

// Location results
document.querySelectorAll('[data-testid="locationResult"]')
```

---

## 14. AUDIENCE CONTROLS

| Criterion | Status | Notes |
|-----------|--------|-------|
| Set reply restrictions | 🔲 | Everyone/Following/Mentioned |
| Detect current setting | 🔲 | |

### Required Selectors
```javascript
// Audience button
document.querySelector('[data-testid="audienceButton"]')
document.querySelector('[aria-label*="who can reply"]')

// Options
document.querySelector('[data-testid="publicOption"]') // Everyone
document.querySelector('[data-testid="followingOption"]') // People you follow
document.querySelector('[data-testid="mentionsOption"]') // Only mentioned
```

---

## 15. RATE LIMITING & SAFETY

| Criterion | Status | Notes |
|-----------|--------|-------|
| Detect rate limit warning | 🔲 | |
| Detect action blocked | 🔲 | |
| Detect "slow down" warning | 🔲 | |
| Implement delay between tweets | 🔲 | |
| Implement daily limits | 🔲 | |
| Log all actions | 🔲 | |

### Safety Limits
```python
# Recommended limits for Twitter/X
MAX_TWEETS_PER_HOUR = 10
MAX_TWEETS_PER_DAY = 50
MIN_DELAY_BETWEEN_TWEETS = 120  # 2 minutes
MAX_DELAY_BETWEEN_TWEETS = 300  # 5 minutes

# Replies (can be higher)
MAX_REPLIES_PER_HOUR = 20
MAX_REPLIES_PER_DAY = 100

# Retweets
MAX_RETWEETS_PER_HOUR = 15
MAX_RETWEETS_PER_DAY = 75

# Likes (highest tolerance)
MAX_LIKES_PER_HOUR = 50
MAX_LIKES_PER_DAY = 500
```

### Detection Patterns
```javascript
// Rate limit
document.body.innerText.includes('rate limit')
document.body.innerText.includes('Try again later')
document.body.innerText.includes('too many')

// Slow down
document.body.innerText.includes('slow down')
document.body.innerText.includes('posting too quickly')

// Account issues
document.body.innerText.includes('locked')
document.body.innerText.includes('suspended')
document.body.innerText.includes('unusual activity')
```

---

## 16. BOOKMARK TWEET

| Criterion | Status | Notes |
|-----------|--------|-------|
| Find bookmark button | 🔲 | |
| Add bookmark | 🔲 | |
| Remove bookmark | 🔲 | |
| View bookmarks | 🔲 | |

### Required Selectors
```javascript
// Bookmark button
document.querySelector('[data-testid="bookmark"]')
document.querySelector('[aria-label="Bookmark"]')

// Unbookmark
document.querySelector('[data-testid="removeBookmark"]')

// View bookmarks
URL: https://x.com/i/bookmarks
```

---

## 17. SHARE TWEET

| Criterion | Status | Notes |
|-----------|--------|-------|
| Click share button | 🔲 | |
| Copy link | 🔲 | |
| Share via DM | 🔲 | |

### Required Selectors
```javascript
// Share button
document.querySelector('[data-testid="share"]')
document.querySelector('[aria-label="Share"]')

// Copy link option
document.querySelector('[data-testid="copyLink"]')

// Share via DM
document.querySelector('[data-testid="sendShortcut"]')
```

---

## Implementation Priority

### P0 - Critical (Currently Disabled)
1. Navigate to /home or /compose/tweet
2. Detect logged in state
3. Find tweet input (DraftJS)
4. Type tweet text
5. Click post button
6. Verify tweet posted
7. Handle encryption code (7911)

### P1 - High
8. Attach media (image/video)
9. Reply to tweet
10. Thread creation
11. Rate limit detection

### P2 - Medium
12. Quote tweet
13. Retweet
14. Like
15. Scheduled tweets

### P3 - Low
16. Polls
17. Location
18. Audience controls
19. Bookmarks

---

## Current Configuration

**Twitter posting is currently DISABLED:**
```python
# In safari_automation_orchestrator.py
twitter_posting_enabled: bool = False  # Disabled for testing
```

To enable:
```python
twitter_posting_enabled: bool = True
```

---

## File Structure

```
Backend/
├── automation/
│   └── safari_twitter_poster.py     # Main posting automation
├── services/
│   └── twitter/
│       ├── tweet_service.py         # High-level tweet service
│       ├── tweet_composer.py        # Tweet composition
│       └── tweet_poster.py          # Posting logic
└── scripts/
    └── twitter_post_test.py         # Test script
```

---

## Existing Files to Check

| File | Purpose |
|------|---------|
| `automation/safari_twitter_poster.py` | Existing Twitter automation |
| `automation/safari_session_manager.py` | Session management |
| `services/safari_automation_orchestrator.py` | Has twitter_posting_enabled flag |

---

## Authentication Notes

**IMPORTANT:** If Twitter/X prompts for encryption/verification code:
```
Code: 7911
```

---

## Testing Checklist

```bash
# 1. Test navigation
python -c "from automation.safari_twitter_poster import SafariTwitterPoster; p=SafariTwitterPoster(); p.navigate_to_home()"

# 2. Test login check
python -c "from automation.safari_twitter_poster import SafariTwitterPoster; p=SafariTwitterPoster(); print(p.check_login())"

# 3. Test find input
python -c "from automation.safari_twitter_poster import SafariTwitterPoster; p=SafariTwitterPoster(); print(p.find_tweet_input())"

# 4. Test post tweet
python -c "from automation.safari_twitter_poster import SafariTwitterPoster; p=SafariTwitterPoster(); p.post_tweet('Test tweet')"
```

---

## Selector Investigation Script

```python
# Run to investigate Twitter compose page structure
python3 -c "
import subprocess
import time

subprocess.run(['osascript', '-e', 
    'tell application \"Safari\" to set URL of front document to \"https://x.com/compose/tweet\"'])
time.sleep(5)

js = '''
(function() {
    var result = {
        testids: [],
        inputs: [],
        buttons: [],
        url: window.location.href
    };
    
    // Get all data-testid elements
    document.querySelectorAll('[data-testid]').forEach((e, i) => {
        if (i < 30) {
            result.testids.push({
                testid: e.getAttribute('data-testid'),
                tag: e.tagName,
                text: e.textContent.trim().substring(0, 30)
            });
        }
    });
    
    document.querySelectorAll('input, textarea, [contenteditable]').forEach(i => {
        result.inputs.push({
            type: i.type || i.tagName,
            testid: i.getAttribute('data-testid'),
            class: i.className.substring(0, 50)
        });
    });
    
    document.querySelectorAll('button').forEach((b, i) => {
        if (i < 15) {
            result.buttons.push({
                testid: b.getAttribute('data-testid'),
                ariaLabel: b.getAttribute('aria-label'),
                disabled: b.disabled
            });
        }
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

## Next Steps

1. Check existing `safari_twitter_poster.py` for current implementation
2. Investigate actual Twitter compose page selectors
3. Fix DraftJS input handling
4. Test posting flow
5. Enable `twitter_posting_enabled` when ready
6. Add proper rate limiting
