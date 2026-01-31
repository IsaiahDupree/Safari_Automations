# Instagram DM Automation - Fundamental Patterns

> Core patterns verified and tested. Last updated: 2026-01-31
> Test Results: 17/20 passed (85%)

---

## Table of Contents

1. [Core Selectors](#1-core-selectors)
2. [Navigation Patterns](#2-navigation-patterns)
3. [Tab Management](#3-tab-management)
4. [Contact Operations](#4-contact-operations)
5. [Message Operations](#5-message-operations)
6. [Request Actions](#6-request-actions)
7. [Detection Patterns](#7-detection-patterns)
8. [Skip Patterns](#8-skip-patterns)

---

## 1. Core Selectors

### Primary Selectors (Verified Working)

| Element | Selector | Reliability |
|---------|----------|-------------|
| DM Tabs | `[role="tab"]` | ✅ High |
| Message Input | `[role="textbox"]` | ✅ High |
| Buttons | `div[role="button"]` | ✅ High |
| Inbox Container | `div.xb57i2i.x1q594ok.x5lxg6s` | ⚠️ Medium |
| Profile Pictures | `img[alt*="profile picture"]` | ✅ High |

### Attribute Patterns

```javascript
// Tab selection state
element.getAttribute("aria-selected") === "true"

// Conversation identifier
element.getAttribute("aria-label") // "Conversation with [Name]"

// Profile link
element.getAttribute("aria-label") // "Open the profile page of [handle]"
```

---

## 2. Navigation Patterns

### Navigate to Inbox
```javascript
// Via Safari API
fetch('http://localhost:3100/api/inbox/navigate', { method: 'POST' })

// Via JavaScript (if already on Instagram)
window.location.href = 'https://www.instagram.com/direct/inbox/';
```

### Navigation Aria-Labels
| aria-label | Element |
|------------|---------|
| `Home` | Home button |
| `Messages` or `Direct messaging - N new notifications link` | DM inbox |
| `Search` | Search |
| `Explore` | Explore page |
| `Notifications` | Notifications |
| `New message` | Compose new DM |

---

## 3. Tab Management

### Tab Selectors
```javascript
// Get all tabs
var tabs = document.querySelectorAll("[role=tab]");

// Tab structure: Primary | General | Requests (N)
```

### Switch Tab
```javascript
function switchTab(tabName) {
  var tabs = document.querySelectorAll("[role=tab]");
  for (var i = 0; i < tabs.length; i++) {
    if (tabs[i].innerText.includes(tabName)) {
      tabs[i].click();
      return true;
    }
  }
  return false;
}

// Usage
switchTab("Primary");
switchTab("General");
switchTab("Requests");
```

### Get Tab Info
```javascript
function getTabInfo() {
  var tabs = document.querySelectorAll("[role=tab]");
  var info = [];
  for (var i = 0; i < tabs.length; i++) {
    var text = tabs[i].innerText.trim();
    var match = text.match(/\((\d+)\)/);
    info.push({
      name: text.replace(/\s*\(\d+\)/, "").trim(),
      selected: tabs[i].getAttribute("aria-selected") === "true",
      count: match ? parseInt(match[1]) : null
    });
  }
  return info;
}
```

---

## 4. Contact Operations

### Find Contacts in List
```javascript
function getVisibleContacts() {
  var contacts = [];
  var seen = {};
  var text = document.body.innerText;
  var lines = text.split("\n");
  
  var skip = [
    "Primary", "General", "Requests", "Messages", "Note...",
    "Search", "Unread", "Active", "Message...", "Instagram",
    "Home", "Reels", "Explore", "Notifications", "Create",
    "Dashboard", "Profile", "More", "Your note", "Your messages",
    "Hidden Requests", "Delete all"
  ];
  
  for (var i = 0; i < lines.length; i++) {
    var l = lines[i].trim();
    if (!l || l.length < 3 || l.length > 50) continue;
    if (!/^[A-Z]/.test(l)) continue;
    
    var isSkip = skip.some(s => l === s || l.startsWith(s));
    if (isSkip) continue;
    if (l.includes("·") || l.includes("sent a") || l.includes("You:")) continue;
    if (l.split(" ").length > 5) continue;
    
    var name = l.split("|")[0].trim();
    if (name.length > 2 && !seen[name]) {
      seen[name] = true;
      contacts.push(name);
    }
  }
  return contacts;
}
```

### Click Contact
```javascript
function clickContact(name) {
  var spans = document.querySelectorAll("span");
  for (var i = 0; i < spans.length; i++) {
    var t = spans[i].innerText;
    if (t === name || (t && t.startsWith(name) && t.length < 60)) {
      spans[i].click();
      return true;
    }
  }
  return false;
}
```

### Scroll Inbox
```javascript
function scrollInbox(amount) {
  var c = document.querySelector("div.xb57i2i.x1q594ok.x5lxg6s");
  if (c) {
    c.scrollTop += amount || 1500;
    return true;
  }
  return false;
}
```

---

## 5. Message Operations

### Find Username Handle
```javascript
function findHandle() {
  var text = document.body.innerText;
  var lines = text.split("\n");
  
  for (var i = 0; i < lines.length; i++) {
    var l = lines[i].trim();
    // Handle pattern: lowercase, 5-25 chars, only a-z, 0-9, dots, underscores
    if (/^[a-z0-9._]+$/.test(l) && l.length > 5 && l.length < 25) {
      // Exclude own handle
      if (l !== "the_isaiah_dupree") {
        return l;
      }
    }
  }
  return null;
}
```

### Scroll Message Container
```javascript
function scrollMessagesUp(amount) {
  var divs = document.querySelectorAll("div");
  for (var i = 0; i < divs.length; i++) {
    // Message container: scrollHeight > 1500, clientHeight > 400
    if (divs[i].scrollHeight > 1500 && divs[i].clientHeight > 400) {
      divs[i].scrollBy(0, -(amount || 5000));
      return true;
    }
  }
  return false;
}
```

### Extract Messages
```javascript
function extractMessages(handle) {
  var text = document.body.innerText;
  var idx = text.indexOf(handle);
  if (idx === -1) return [];
  
  var endIdx = text.indexOf("Message...", idx);
  if (endIdx === -1) endIdx = idx + 3000;
  
  var content = text.substring(idx + handle.length, endIdx);
  var lines = content.split("\n");
  var messages = [];
  var seen = {};
  
  for (var i = 0; i < lines.length; i++) {
    var l = lines[i].trim();
    if (!l || l.length < 5) continue;
    
    // Skip patterns
    if (/^[a-z0-9._]+$/.test(l) && l.length < 25) continue;
    if (/^\d{1,2}\/\d{1,2}\/\d{2}/.test(l)) continue;
    if (l.includes("messaged you about")) continue;
    if (l.includes("sent an attachment")) continue;
    if (l.includes("sent a voice")) continue;
    if (l.includes(" · ")) continue;
    
    if (l.length > 5 && l.length < 1000 && !seen[l]) {
      seen[l] = true;
      messages.push({ text: l, isOutbound: l.startsWith("I ") });
    }
  }
  return messages;
}
```

### Send Message
```javascript
function sendMessage(text) {
  // 1. Focus and type
  var textbox = document.querySelector("[role=textbox]");
  if (!textbox) return false;
  
  textbox.focus();
  document.execCommand("insertText", false, text);
  
  // 2. Click send button
  var parent = textbox.parentElement.parentElement.parentElement;
  var btns = parent.querySelectorAll("[aria-label]");
  for (var i = 0; i < btns.length; i++) {
    if (btns[i].getAttribute("aria-label") === "Send") {
      btns[i].click();
      return true;
    }
  }
  return false;
}
```

### Conversation Actions
| aria-label | Action |
|------------|--------|
| `Audio call` | Start voice call |
| `Video call` | Start video call |
| `Conversation information` | Open details |
| `Add Photo or Video` | Attach media |
| `Voice Clip` | Record voice |
| `Choose a GIF or sticker` | Send GIF |
| `Choose an emoji` | Emoji picker |
| `Send` | Send message |

---

## 6. Request Actions

### Accept Request
```javascript
function acceptRequest() {
  var btns = document.querySelectorAll("div[role=button]");
  for (var i = 0; i < btns.length; i++) {
    if (btns[i].innerText === "Accept") {
      btns[i].click();
      return true;
    }
  }
  return false;
}
```

### Delete Request
```javascript
function deleteRequest() {
  var btns = document.querySelectorAll("div[role=button]");
  for (var i = 0; i < btns.length; i++) {
    if (btns[i].innerText === "Delete") {
      btns[i].click();
      return true;
    }
  }
  return false;
}
```

### Block User
```javascript
function blockUser() {
  var btns = document.querySelectorAll("div[role=button]");
  for (var i = 0; i < btns.length; i++) {
    if (btns[i].innerText === "Block") {
      btns[i].click();
      return true;
    }
  }
  return false;
}
```

### Navigate to Hidden Requests
```javascript
function goToHiddenRequests() {
  var els = document.querySelectorAll("a, div, span");
  for (var i = 0; i < els.length; i++) {
    if ((els[i].innerText || "").includes("Hidden Requests")) {
      els[i].click();
      return true;
    }
  }
  return false;
}
```

---

## 7. Detection Patterns

### Page Detection
```javascript
function detectPage() {
  var text = document.body.innerText;
  var url = window.location.href;
  
  return {
    isInbox: url.includes("/direct/inbox"),
    isConversation: url.includes("/direct/t/"),
    isRequestsPage: text.includes("Message requests"),
    hasTextbox: !!document.querySelector("[role=textbox]"),
    hasAcceptButton: text.includes("Accept"),
    deleteAllCount: (text.match(/Delete all (\d+)/) || [])[1]
  };
}
```

### Timestamp Formats
| Format | Regex | Example |
|--------|-------|---------|
| Relative | `/\d+[wdhm]/` | `22w`, `1d`, `3h` |
| Day + Time | `/[A-Z][a-z]{2} \d{1,2}:\d{2} [AP]M/` | `Thu 6:14 PM` |
| Full Date | `/\d{1,2}\/\d{1,2}\/\d{2}/` | `8/24/25` |
| ISO-like | `/\d{4}-\d{2}-\d{2}/` | `2026-01-31` |

### Status Indicators
| Text | Meaning |
|------|---------|
| `Active` | User online |
| `Unread` | Has unread messages |
| `Verified` | Blue checkmark |
| `Instagram User` | Deleted account |

---

## 8. Skip Patterns

### UI Elements to Skip (Contact Parsing)
```javascript
var skipElements = [
  "Primary", "General", "Requests", "Messages", "Note...",
  "Search", "Unread", "Active", "Message...", "Instagram",
  "Home", "Reels", "Explore", "Notifications", "Create",
  "Dashboard", "Profile", "More", "Your note", "Your messages",
  "Send message", "YouTube", "Message requests", "Hidden Requests",
  "Decide who", "Delete all", "Open a chat", "View profile"
];
```

### Message Skip Patterns
```javascript
var skipPatterns = [
  /^[a-z0-9._]+$/,              // Username handles
  /^\d{1,2}\/\d{1,2}\/\d{2}/,   // Date formats
  /messaged you about/,         // Context lines
  /sent an attachment/,         // Attachment indicators
  /sent a voice/,               // Voice message indicators
  /sent a video/,               // Video indicators
  / · /,                        // Separator patterns
  /^(Active|Unread|View profile|See Post|Instagram|Accept|Delete|Block)$/
];
```

### Spam Detection
```javascript
var spamPatterns = [
  /followers instantly/i,
  /\$\d+/,                      // Price mentions
  /free trial/i,
  /DM.*to claim/i,
  /shorten\.(so|ee)/,           // Shortened URLs
  /blucheckmark/i,
  /10K.*followers/i
];
```

---

## Quick Reference - CLI Commands

```bash
# Tab Operations
npx tsx scripts/instagram-dm-automation.ts tabs
npx tsx scripts/instagram-dm-automation.ts switch General
npx tsx scripts/instagram-dm-automation.ts switch Requests

# Contact Operations
npx tsx scripts/instagram-dm-automation.ts contacts Primary
npx tsx scripts/instagram-dm-automation.ts contacts General
npx tsx scripts/instagram-dm-automation.ts open "Sarah Ashley"

# Message Operations
npx tsx scripts/instagram-dm-automation.ts extract "Evan Dawson"
npx tsx scripts/instagram-dm-automation.ts extract --tab General "Tony Gaskins"
npx tsx scripts/instagram-dm-automation.ts send "Contact Name" "Message"

# Request Operations
npx tsx scripts/instagram-dm-automation.ts request-info
npx tsx scripts/instagram-dm-automation.ts accept "Contact Name"
npx tsx scripts/instagram-dm-automation.ts delete-request "Contact Name"

# Batch Extraction
npx tsx scripts/extract-tab-dms.ts Primary
npx tsx scripts/extract-tab-dms.ts General
npx tsx scripts/extract-tab-dms.ts Requests

# Run Tests
npx tsx scripts/test-dm-patterns.ts
```

---

## Scripts Overview

| Script | Purpose | Status |
|--------|---------|--------|
| `instagram-dm-automation.ts` | CLI for all DM operations | ✅ Working |
| `extract-tab-dms.ts` | Batch extract from tab | ✅ Working |
| `extract-all-dms.ts` | Extract from all contacts | ✅ Working |
| `test-dm-patterns.ts` | Test all patterns | ✅ 85% Pass |
| `dm-extractor.ts` | Single contact extraction | ✅ Working |

---

## Database Schema

### Tables
- `instagram_contacts` - Contact info, handle, tags
- `instagram_conversations` - Conversation metadata, tab source
- `instagram_messages` - Individual messages, direction

### Tags Applied
- `dm_extracted` - Contact has been processed
- `handle:[username]` - Instagram handle
- `tab:primary|general|requests` - Source tab

---

*Generated: 2026-01-31 | Test Coverage: 85% | Patterns: 50+*
