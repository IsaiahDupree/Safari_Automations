# Instagram DM Selectors Reference

> Discovered via Safari Automation API commands. Last updated: 2026-01-31

## Quick Reference - Working Commands

### Click Contact by Name (WORKING)
```bash
curl -s -X POST http://localhost:3100/api/execute \
  -H "Content-Type: application/json" \
  -d '{"script":"(function(){ var spans = document.querySelectorAll(\"span\"); for(var i=0;i<spans.length;i++){ var t = spans[i].innerText; if(t===\"Sarah Ashley\"){ spans[i].click(); return \"clicked\"; }} return \"not found\"; })()"}'
```

### Scroll Message Container UP (WORKING)
```bash
curl -s -X POST http://localhost:3100/api/execute \
  -H "Content-Type: application/json" \
  -d '{"script":"(function(){ var c = document.querySelectorAll(\"div\"); for(var i=0;i<c.length;i++){ if(c[i].scrollHeight>2000 && c[i].clientHeight>400){ c[i].scrollBy(0,-5000); return \"scrolled\"; }} return \"none\"; })()"}'
```

### Extract Messages After Username Handle (WORKING)
```bash
curl -s -X POST http://localhost:3100/api/execute \
  -H "Content-Type: application/json" \
  -d '{"script":"(function(){ var t = document.body.innerText; var idx = t.indexOf(\"saraheashley\"); if(idx===-1) return \"no handle\"; return t.substring(idx+12, idx+800); })()"}'
```

## Discovered Username Handles
| Contact | Handle |
|---------|--------|
| Sarah Ashley | saraheashley |
| Owen Case | owentheaiguy |
| Evan Dawson | day1marketing |
| Steven Thiel | steveofallstreets |
| Sabrina Ramonov | sabrina_ramonov |
| Chase AI | chase.h.ai |
| Nate Herk | nateherkai |
| Liam Johnston | liamjohnston.ai |
| cyphyr.ai | cyphyr.ai |
| Thrive with Angela K | thrivewithangelak |
| Expand Lab | theexpandlab |
| Ahmed Alassafi | alassafi.ai |
| Nicolas Boucher | nicolasboucherfinance |
| Startup Archive | startuparchive_ |
| Tonya Qualls | tonya.qualls |
| Kenda Laney | kenda.laney |
| Demetrius Jeltz-Green | jeltz.green |
| Mr. Notion | mrnotion.co |
| Joel Yi | officialjoelyi |
| Andrew Sandler | andrew.sandler |
| Brooo 100% agree | the_adhd_entrepreneur |
| Nick Saraev | nick_saraev |
| Jordan Lee | jordanlee__ |
| Michael Kitka | michaelkitka |
| HAROON KHAN | haroonkhaans |

## New Pattern: Repeated Context Messages

When a user messages you about a comment, the pattern is:
```
[handle] messaged you about a comment you made on their post. See Post

[actual message content]
```

The context line `"messaged you about a comment..."` should be **skipped** - the actual message follows it.

## Extraction Pattern Summary

### Step 1: Navigate to Inbox
```bash
curl -s -X POST http://localhost:3100/api/inbox/navigate
sleep 1
```

### Step 2: Click Contact by Exact Name Match
```javascript
(function(){
  var spans = document.querySelectorAll("span");
  for(var i=0; i<spans.length; i++){
    var t = spans[i].innerText;
    if(t === "CONTACT_NAME"){
      spans[i].click();
      return "clicked";
    }
  }
  return "not found";
})()
```

### Step 3: Wait for Conversation Load
```bash
sleep 3  # 3 seconds minimum
```

### Step 4: Scroll Message Container UP (for older messages)
```javascript
(function(){
  var c = document.querySelectorAll("div");
  for(var i=0; i<c.length; i++){
    if(c[i].scrollHeight > 1500 && c[i].clientHeight > 400){
      c[i].scrollBy(0, -5000);
      return "scrolled";
    }
  }
  return "none";
})()
```

### Step 5: Find Username Handle & Extract Messages
```javascript
(function(){
  var t = document.body.innerText;
  var lines = t.split(String.fromCharCode(10));
  var handle = "";
  for(var i=0; i<lines.length; i++){
    var l = lines[i].trim();
    // Username handles are lowercase, 5-25 chars, contain only a-z, 0-9, dots, underscores
    if(l.match(/^[a-z0-9._]+$/) && l.length > 5 && l.length < 25 && l !== "the_isaiah_dupree"){
      handle = l;
      break;
    }
  }
  if(!handle) return "no handle";
  var idx = t.indexOf(handle);
  return "Handle: " + handle + " | " + t.substring(idx, idx + 800);
})()
```

## Key Patterns Discovered

1. **Contact names** appear in `<span>` elements with exact text match
2. **Username handles** are lowercase-only, 5-25 chars (e.g., `saraheashley`, `day1marketing`)
3. **Scrollable message container** has `scrollHeight > 1500` and `clientHeight > 400`
4. **Messages appear after** the username handle in page text
5. **Timestamps** use format: `Jan 1, 2026, 5:32 PM` or `8/24/25, 3:36 PM`
6. **"Message..."** indicates the end of conversation content

---

## Conversation List (Inbox)

### Scroll Container
```css
/* Main conversation list container */
div.xb57i2i.x1q594ok.x5lxg6s
```

### Scroll Commands
```bash
# Scroll conversation list down
curl -s -X POST http://localhost:3100/api/execute \
  -H "Content-Type: application/json" \
  -d '{"script":"(function(){ var c = document.querySelector(\"div.xb57i2i.x1q594ok.x5lxg6s\"); if(c){ c.scrollTop += 500; return c.scrollTop; } return \"none\"; })()"}'

# Scroll to top
curl -s -X POST http://localhost:3100/api/execute \
  -H "Content-Type: application/json" \
  -d '{"script":"(function(){ var c = document.querySelector(\"div.xb57i2i.x1q594ok.x5lxg6s\"); if(c) c.scrollTop = 0; return \"top\"; })()"}'
```

---

## Conversation Item Selectors

### XPath Pattern (item N)
```xpath
//*[@id="mount_0_0_y+"]/div/div/div[2]/div/div/div[1]/div[1]/div[2]/section/main/div/section/div/div/div/div[1]/div[1]/div/div[4]/div[2]/div[1]/div/div/div[N]
```

### Elements Inside Each Item

| Element | Relative Path | Description |
|---------|--------------|-------------|
| Profile Image | `div[1]/div/span/img` | Contact's profile picture |
| Contact Name | `div[2]/div/div/div[1]` | Display name |
| Last Message | `div[2]/div/div/div[2]/div` | Message preview |
| Unread Status | `div[3]` | Contains "Unread" if unread |

---

## Message View (Inside Conversation)

### Message Scroll Container
```javascript
// Find the scrollable message container (scrollHeight > 5000)
var containers = document.querySelectorAll("div");
for (var i = 0; i < containers.length; i++) {
  var c = containers[i];
  if (c.scrollHeight > 5000 && c.clientHeight > 500) {
    // This is the message container
    return c;
  }
}
```

### Scroll Commands for Messages
```bash
# Scroll UP to see older messages (negative value)
curl -s -X POST http://localhost:3100/api/execute \
  -H "Content-Type: application/json" \
  -d '{"script":"(function(){ var containers = document.querySelectorAll(\"div\"); for(var i=0;i<containers.length;i++){ var c = containers[i]; if(c.scrollHeight > 5000 && c.clientHeight > 500){ c.scrollBy(0, -3000); return \"scrolled up\"; }} return \"not found\"; })()"}'

# Scroll DOWN to see newer messages
curl -s -X POST http://localhost:3100/api/execute \
  -H "Content-Type: application/json" \
  -d '{"script":"(function(){ var containers = document.querySelectorAll(\"div\"); for(var i=0;i<containers.length;i++){ var c = containers[i]; if(c.scrollHeight > 5000 && c.clientHeight > 500){ c.scrollBy(0, 3000); return \"scrolled down\"; }} return \"not found\"; })()"}'
```

### Message XPath Pattern
```xpath
# Sent message (outbound)
//*[@id="mount_0_0_y+"]/div/div/div[2]/.../div[1]/div[1]/div/div/span/div

# Received message (inbound)  
//*[@id="mount_0_0_y+"]/div/div/div[2]/.../div[2]/div/div/div[2]/div/div/div[2]/div/div[1]/div/div/div/div/span/div
```

---

## Working Extraction Pattern

### 1. Navigate and Click Contact
```bash
# Navigate to inbox
curl -s -X POST http://localhost:3100/api/inbox/navigate

# Click on specific contact
curl -s -X POST http://localhost:3100/api/execute \
  -H "Content-Type: application/json" \
  -d '{"script":"(function(){ var items = document.querySelectorAll(\"div, span\"); for(var i=0;i<items.length;i++){ var t = items[i].innerText || \"\"; if(t.indexOf(\"Sarah Ashley\")===0 && t.length < 60){ items[i].click(); return \"clicked\"; }} return \"not found\"; })()"}'
```

### 2. Wait for Load (Important!)
```bash
sleep 4  # Wait 4+ seconds for conversation to load
```

### 3. Scroll to Load All Messages
```bash
# Scroll up multiple times to load older messages
for i in {1..5}; do
  curl -s -X POST http://localhost:3100/api/execute \
    -H "Content-Type: application/json" \
    -d '{"script":"(function(){ var c = document.querySelectorAll(\"div\"); for(var i=0;i<c.length;i++){ if(c[i].scrollHeight > 5000 && c[i].clientHeight > 500){ c[i].scrollBy(0,-3000); return \"scrolled\"; }} return \"none\"; })()"}'
  sleep 1
done
```

### 4. Extract Messages
```bash
# Get conversation text after username handle
curl -s -X POST http://localhost:3100/api/execute \
  -H "Content-Type: application/json" \
  -d '{"script":"document.body.innerText.substring(document.body.innerText.indexOf(\"saraheashley\"))"}'
```

---

## Message Structure Pattern

After scrolling, the conversation content follows this pattern:

```
[username_handle]        # e.g., "saraheashley"

[shared_username]        # e.g., "bryantgavello" (shared content)

[shared_content]         # e.g., "Me on a daily basis"
[timestamp]              # e.g., "Jan 1, 2026, 5:32 PM"
[message_text]           # e.g., "Hi Sarah! 👋 Test at 5:32:03 PM"
[timestamp]              # Next message timestamp
[message_text]           # Next message

...

Message...               # Input field at end
```

---

## Key Discoveries

1. **Conversation list scroll**: Use `div.xb57i2i.x1q594ok.x5lxg6s` with `scrollTop += N`

2. **Message scroll**: Find container with `scrollHeight > 5000`, use `scrollBy(0, -3000)` to go UP (older messages)

3. **Wait times matter**: Need 4+ seconds after clicking for conversation to load

4. **Message extraction**: Parse text after the username handle (e.g., "saraheashley")

5. **Timestamps**: Full format like "Jan 1, 2026, 5:32 PM" indicates message boundaries

---

## New Patterns Discovered (2026-01-31)

### Aria Labels for Navigation
| Element | aria-label |
|---------|------------|
| Home | `Home` |
| Messages | `Messages` or `Direct messaging - N new notifications link` |
| Search | `Search` |
| New message | `New message` |
| Thread list | `Thread list` |

### DM Tabs (role="tab")
```javascript
// Get tab info
var tabs = document.querySelectorAll("[role=tab]");
// Returns: Primary (selected), General, Requests (N)
```

### Timestamp Formats
| Format | Example | Use |
|--------|---------|-----|
| Relative | `22w`, `1d`, `3h`, `5m` | Inbox list |
| Day + Time | `Thu 6:14 PM`, `Fri 10:19 PM` | Conversation view |
| Full Date | `8/24/25, 3:36 PM` | Older messages |
| Time Only | `12:56 PM` | Same-day messages |

### Status Indicators
| Indicator | Meaning |
|-----------|---------|
| `Active` | User is online now |
| `Unread` | Has unread messages |
| `Seen` | Message was read |
| `Verified` | Verified account (blue check) |

### Message Type Indicators
| Pattern | Type |
|---------|------|
| `sent a voice message` | Voice message |
| `sent an attachment` | Image/video/file |
| `You:` prefix | Your outbound message (inbox preview) |
| `messaged you about a comment` | Context from comment reply |

### Message Input Field
```javascript
// Find message input
var textbox = document.querySelector("[role=textbox]");
// Properties: placeholder="Message...", contentEditable="true"
```

### Profile Pictures
```javascript
// Get all profile pics
var imgs = document.querySelectorAll("img[alt*='profile picture']");
// Alt format: "username's profile picture" or "user-profile-picture"
```

### Element Roles Found
| Role | Count (typical) | Purpose |
|------|-----------------|---------|
| `link` | 19 | Navigation links |
| `button` | 28 | Clickable actions |
| `tab` | 3 | Primary/General/Requests |
| `textbox` | 1 | Message input |
| `img` | 38 | Profile pictures, media |

---

## Skip Patterns for Message Extraction

When parsing messages, skip these patterns:

```javascript
var skipPatterns = [
  /^[a-z0-9._]+$/,           // Username handles
  /^\d{1,2}\/\d{1,2}\/\d{2}/, // Date formats
  /messaged you about/,       // Context lines
  /sent an attachment/,       // Attachment indicators
  /sent a voice/,             // Voice message indicators
  / · /,                      // Separator patterns
  /^(Active|Unread|View profile|See Post|Instagram)$/
];
```

---

## Replicable Extraction System

### Scripts Available
| Script | Purpose |
|--------|---------|
| `scripts/extract-all-dms.ts` | Extract from ALL contacts |
| `scripts/dm-extractor.ts` | Extract from specific contacts |
| `scripts/extract-top5-chats.ts` | Extract from top 5 contacts |

### Run Full Extraction
```bash
cd /path/to/Local\ EverReach\ CRM
npx tsx scripts/extract-all-dms.ts
```

### Extraction Stats (Latest Run)
- **40 contacts processed**
- **24 successful** (60% success rate)
- **128 messages found**
- **119 new messages saved**
- **139 total in database**
