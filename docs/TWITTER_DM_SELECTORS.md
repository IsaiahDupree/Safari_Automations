# Twitter/X DM Selectors & Patterns

Complete reference for Twitter/X DM automation selectors discovered through exploration.

## Overview

Twitter/X uses `data-testid` attributes extensively, making automation more reliable than CSS classes.

**Base URL**: `https://x.com/messages`

---

## Navigation Selectors

### App Navigation
```javascript
// Bottom navigation bar
'[data-testid="BottomBar"]'
'[data-testid="AppTabBar_Home_Link"]'
'[data-testid="AppTabBar_Explore_Link"]'
'[data-testid="AppTabBar_Notifications_Link"]'
'[data-testid="AppTabBar_DirectMessage_Link"]'  // DM tab
'[data-testid="AppTabBar_Profile_Link"]'
'[data-testid="AppTabBar_More_Menu"]'

// Side navigation
'[data-testid="SideNav_NewTweet_Button"]'
'[data-testid="SideNav_AccountSwitcher_Button"]'
```

---

## DM Container Selectors

### Main Structure
```javascript
// Primary column
'[data-testid="primaryColumn"]'

// DM container (main wrapper)
'[data-testid="dm-container"]'

// Left panel (inbox)
'[data-testid="dm-inbox-panel"]'

// Right panel (conversation)
'[data-testid="dm-conversation-panel"]'
```

### Inbox Header
```javascript
'[data-testid="dm-inbox-header"]'
'[data-testid="dm-inbox-header-main"]'
'[data-testid="dm-inbox-title"]'
'[data-testid="dm-new-chat-button"]'  // New message button
'[data-testid="dm-search-bar"]'
```

### Inbox Tabs
```javascript
'[data-testid="dm-inbox-tabs-container"]'
'[data-testid="dm-inbox-tabs"]'
'[data-testid="dm-inbox-tabs-list"]'
'[data-testid="dm-inbox-tab-all"]'       // All messages tab
'[data-testid="dm-inbox-tab-requests"]'  // Requests tab
```

---

## Conversation Selectors

### Conversation List Items
```javascript
// Pattern: dm-conversation-item-{user_id}:{conversation_id}
'[data-testid^="dm-conversation-item"]'

// Example
'[data-testid="dm-conversation-item-284133102:1387950383134281733"]'
```

**Extracting Conversation ID**:
```javascript
const testid = element.getAttribute('data-testid');
const id = testid.replace('dm-conversation-item-', '');
// Returns: "284133102:1387950383134281733"
```

### Empty Conversation State
```javascript
'[data-testid="dm-empty-conversation-state"]'
'[data-testid="dm-empty-conversation-title"]'
'[data-testid="dm-empty-conversation-description"]'
'[data-testid="dm-empty-conversation-new-chat-button"]'
```

---

## Message Composer Selectors

### Text Input
```javascript
// Primary textbox selector
'[data-testid="dmComposerTextInput"]'

// Fallback selectors
'[role="textbox"]'
'[contenteditable="true"]'
```

### Send Button
```javascript
// Primary send button
'[data-testid="dmComposerSendButton"]'

// Fallback selectors
'button[aria-label*="Send"]'
'[role="button"][aria-label*="Send"]'
```

---

## Profile Page Selectors

### Message Button on Profile
```javascript
'[data-testid="sendDMFromProfile"]'
```

### Profile Data
```javascript
'[data-testid="UserName"]'
'[data-testid="UserDescription"]'
```

---

## JavaScript Patterns

### List Conversations
```javascript
(function(){
  var convos = document.querySelectorAll('[data-testid^="dm-conversation-item"]');
  var list = [];
  for(var i = 0; i < convos.length; i++) {
    var c = convos[i];
    var testid = c.getAttribute('data-testid');
    var id = testid.replace('dm-conversation-item-', '');
    var text = c.innerText;
    var lines = text.split('\n').filter(l => l.trim());
    list.push({
      id: id,
      displayName: lines[0] || '',
      lastMessage: lines[2] || lines[1] || '',
      timestamp: lines[1] || ''
    });
  }
  return JSON.stringify(list);
})()
```

### Click Conversation
```javascript
(function(){
  var conv = document.querySelector('[data-testid="dm-conversation-item-{ID}"]');
  if(conv) {
    conv.click();
    return 'clicked';
  }
  return 'not found';
})()
```

### Type and Send Message
```javascript
(function(){
  var tb = document.querySelector('[data-testid="dmComposerTextInput"]');
  if(!tb) tb = document.querySelector('[role="textbox"]');
  if(!tb) return 'no textbox';
  
  tb.focus();
  tb.innerText = "Your message here";
  tb.dispatchEvent(new InputEvent('input', {bubbles: true}));
  return 'typed';
})()

// Then click send
(function(){
  var btn = document.querySelector('[data-testid="dmComposerSendButton"]');
  if(btn) {
    btn.click();
    return 'sent';
  }
  return 'no send button';
})()
```

### Navigate to DMs
```javascript
window.location.href = "https://x.com/messages";
```

### Navigate to Specific Conversation
```javascript
// Format: /messages/{user_id}-{conversation_id}
window.location.href = "https://x.com/messages/284133102-1387950383134281733";
```

---

## URL Patterns

| URL | Description |
|-----|-------------|
| `x.com/messages` | DM inbox |
| `x.com/i/chat` | Alternative DM URL |
| `x.com/messages/{id}` | Specific conversation |
| `x.com/{username}` | User profile |

---

## Conversation ID Format

Twitter uses a compound ID format: `{user_id}:{conversation_id}`

Example: `284133102:1387950383134281733`

- First part: User ID
- Second part: Conversation/thread ID

---

## CLI Commands

```bash
# Check status
npx tsx scripts/twitter-api.ts status

# Navigate to DMs
npx tsx scripts/twitter-api.ts navigate

# List conversations
npx tsx scripts/twitter-api.ts conversations

# Open a conversation
npx tsx scripts/twitter-api.ts open 284133102:1387950383134281733

# Extract messages
npx tsx scripts/twitter-api.ts messages

# Send DM by username
npx tsx scripts/twitter-api.ts dm username "Hello!"

# Explore page DOM
npx tsx scripts/twitter-api.ts explore
```

---

## Comparison: Twitter vs Instagram

| Feature | Twitter/X | Instagram |
|---------|-----------|-----------|
| Selector style | `data-testid` | `aria-label`, `role` |
| ID format | `user:conversation` | Display name based |
| URL pattern | `/messages/{id}` | `/direct/inbox/` |
| Textbox selector | `dmComposerTextInput` | `[role="textbox"]` |
| Send button | `dmComposerSendButton` | `div[role="button"]` with "Send" |

---

## Notes

1. **Rate Limiting**: Twitter has strict rate limits. Keep automation human-paced.
2. **Authentication**: Must be logged in to access DMs.
3. **Dynamic Loading**: Conversations load dynamically; wait for elements.
4. **Data-testid Stability**: These selectors are relatively stable but may change with Twitter updates.
