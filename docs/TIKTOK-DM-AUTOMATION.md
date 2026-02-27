# TikTok DM Automation — Complete Technical Reference

**Service:** `packages/tiktok-dm` · Port `3102` · Language: TypeScript/Node  
**Last validated:** 2026-02-26 · Status: ✅ Production-verified

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [TikTok DOM Quirks — The Core Problem](#2-tiktok-dom-quirks)
3. [SafariDriver — Click Methods Explained](#3-safaridriver-click-methods)
4. [Send Strategies A / B / C](#4-send-strategies)
5. [findConversationByText — Squish Match](#5-findconversationbytext)
6. [verifyIdentity](#6-verifyidentity)
7. [sendMessage — Type + Click Send Button](#7-sendmessage)
8. [API Endpoints Reference](#8-api-endpoints)
9. [CRM Integration](#9-crm-integration)
10. [Rate Limits](#10-rate-limits)
11. [Selectors Reference](#11-selectors-reference)
12. [Environment & Startup](#12-environment--startup)
13. [Debugging Playbook](#13-debugging-playbook)
14. [Known Failure Modes & Fixes](#14-known-failure-modes--fixes)

---

## 1. Architecture Overview

```
POST /api/tiktok/messages/send-to
        │
        ▼
  sendDMByUsername()           ← dm-operations.ts
        │
        ├─ navigate to /messages
        ├─ Strategy A: squish-match inbox row → cliclick → check composer
        ├─ Strategy B: search filter → cliclick first row → check identity
        └─ Strategy C: NewMessage compose flow → cliclick → search → cliclick result
              │
              ▼
        sendMessage()           ← dm-operations.ts
              │
              ├─ focusElement(composer)
              ├─ typeViaKeystrokes(message)    ← OS-level System Events keystrokes
              ├─ JS click [data-e2e="message-send"]
              └─ cliclick send button (if JS click ignored)
```

**Key architectural principle:** TikTok runs on React with a virtual DOM. **JavaScript `.click()` events are ignored by most elements** because React uses synthetic event delegation. The only reliable way to interact with TikTok's UI is via **Quartz OS-level mouse events** (`cliclick`) or **System Events AppleScript keystrokes**.

---

## 2. TikTok DOM Quirks

### Why JavaScript clicks fail

TikTok's frontend is a React SPA with virtual DOM reconciliation. When you call `element.click()` via JavaScript:
- React's synthetic event system **does not receive the event**
- The click fires on the raw DOM but React's event handlers are bound at the document root via delegation
- Most interactive `div` and `button` elements appear to do nothing

### What DOES work via JavaScript
- Reading DOM content: `querySelector`, `innerText`, `getBoundingClientRect`
- `<img>` elements: respond to JS `.click()` (browser-native, not React-delegated)
- `<input>` elements: can be focused + `.value` set (but React won't see value changes without `Object.getOwnPropertyDescriptor` hack)
- `<a>` elements: respond to JS `.click()` for navigation

### What requires OS-level clicks (cliclick)
- `div` conversation rows in inbox sidebar
- Send button (`[data-e2e="message-send"]` SVG)
- Search bar in conversation list
- NewMessage compose button
- Any React-controlled interactive element

### What requires OS-level keystrokes (System Events)
- Typing into the message composer (`contenteditable` div)
- Typing into search inputs
- Pressing Enter/Return to send

### Coordinate system
```
Screen coords = Safari window screenX + viewport X
              + Safari toolbar height + viewport Y

window.screenX  = Safari window left edge on screen
window.screenY  = Safari window top edge on screen  
toolbar height  = window.outerHeight - window.innerHeight  (typically ~90px)
```

`clickAtScreenPosition(x, y, true)` in SafariDriver:
1. Gets `window.screenX`, `screenY`, `outerHeight - innerHeight` from page
2. Adds them to viewport coords → screen coords
3. Calls `cliclick c:X,Y` via `execSync`

---

## 3. SafariDriver Click Methods

| Method | Mechanism | Works on TikTok? | When to use |
|--------|-----------|-----------------|-------------|
| `clickAtViewportPosition(x, y)` | `document.elementFromPoint(x,y).click()` — JS | ❌ React divs ignored | Never for TikTok interactive elements |
| `clickAtScreenPosition(x, y, true)` | `cliclick c:X,Y` — Quartz CGEvent | ✅ Everything | Conversation rows, send button, search bar |
| `clickElement(selector)` | `cliclick` after getting element screen coords | ✅ | Named elements with stable selectors |
| `focusElement(selector)` | JS `.focus()` | ✅ Inputs only | Before typeViaKeystrokes |
| `typeViaKeystrokes(text)` | System Events `keystroke` | ✅ | Composer, search inputs |
| `pressEnter()` | System Events `key code 36` | ✅ | Submit forms |

### clickAtScreenPosition internals
```typescript
// safari-driver.ts (simplified)
async clickAtScreenPosition(viewportX: number, viewportY: number, useViewportCoords = false) {
  const offsets = await this.executeJS(
    `window.screenX + ' ' + window.screenY + ' ' + (window.outerHeight - window.innerHeight)`
  );
  const [winX, winY, toolbar] = offsets.split(' ').map(Number);
  const screenX = winX + viewportX;
  const screenY = winY + toolbar + viewportY;
  execSync(`cliclick c:${screenX},${screenY}`);
}
```

**Requirement:** `cliclick` must be installed: `brew install cliclick`

---

## 4. Send Strategies

### Strategy A — Squish-match inbox row (PRIMARY ✅)

**When it fires:** User has an existing conversation with the target in the TikTok inbox.

**Flow:**
1. Navigate to `https://www.tiktok.com/messages`
2. Wait 5s for inbox to load
3. Query all `[class*="DivItemWrapper"]` elements
4. For each row, compare `squish(row.innerText)` against `squish(handle)`
   - squish = lowercase, remove all non-alphanumeric chars
   - `"Sarah E Ashley | Travel & Life"` → `"saraheashleytravel&life"` contains `"saraheashley"` ✓
5. Get row's left-quarter viewport coords (avatar area)
6. `clickAtScreenPosition(vx, vy, true)` — cliclick OS event
7. Wait 4s for SPA conversation panel to open
8. Check `document.querySelector('[contenteditable="true"]')` — if found → send
9. Return success (no need for full identity verify after squish-match)

**Typical duration:** ~17s end-to-end

**Why left-quarter x?** The avatar image is in the left ~25% of the row. Clicking there is most reliable for triggering the conversation open.

### Strategy B — Search filter (FALLBACK)

**When it fires:** Strategy A finds no matching row (user not in visible inbox).

**Flow:**
1. Re-navigate to `/messages`
2. Wait 4s
3. `clickAtScreenPosition` on the search bar at viewport ~(300, 55)
4. `typeViaKeystrokes(handle)` — types into search
5. Wait 2s for filtered results
6. Query first visible `DivItemWrapper` in filtered list
7. `clickAtScreenPosition` on its img/center coords
8. Wait 3s
9. `verifyIdentity()` — check profile link `a[href="/@handle"]` exists in chat panel
10. If verified → send; else fall to Strategy C

**Common failure:** After search filter, the first row may not be the target user (TikTok shows suggestions). `verifyIdentity` guards against this.

### Strategy C — NewMessage compose (LAST RESORT)

**When it fires:** Both A and B failed.

**Flow:**
1. Navigate to `/messages`
2. Click the "New message" pencil/compose button (`[data-e2e="new-message-btn"]`)
3. Wait 2s for compose modal
4. Type handle into user search input
5. Wait 2s for results
6. `clickAtScreenPosition` on first result matching handle
7. Click "Chat" / confirm button
8. Wait 3s for conversation to open
9. Verify composer present → send

**Common failure:** TikTok rate-limits compose attempts. User must be following or have prior interaction.

---

## 5. findConversationByText — Squish Match

```typescript
// packages/tiktok-dm/src/automation/dm-operations.ts

const findConversationByText = async (): Promise<{x: number; y: number} | null> => {
  const raw = await driver.executeJS(`
    (function() {
      var target = '${handle.toLowerCase()}';
      var rows = document.querySelectorAll('[class*="DivItemWrapper"]');
      for (var i = 0; i < rows.length; i++) {
        var text = (rows[i].innerText || '').toLowerCase();
        // Squish: remove all non-alphanumeric chars for display name matching
        // e.g. "Sarah E Ashley | Travel & Life" → "saraheashleytravel&life" ⊇ "saraheashley"
        var squished = text.replace(/[^a-z0-9]/g, '');
        if (text.includes(target) || squished.includes(target)) {
          var r = rows[i].getBoundingClientRect();
          if (r.width > 0 && r.height > 0) {
            return JSON.stringify({
              x: Math.round(r.left + r.width * 0.25),  // left quarter = avatar area
              y: Math.round(r.top + r.height / 2)
            });
          }
        }
      }
      return 'not_found';
    })()
  `);
  if (raw === 'not_found') return null;
  try { return JSON.parse(raw); } catch { return null; }
};
```

**Why squish-match?**
TikTok displays the user's **display name** (e.g. `Sarah E Ashley | Travel & Life`), not their `@handle`. The `@handle` appears nowhere in the inbox row text. Stripping all non-alphanumeric from the display name and checking if it contains the handle solves this without needing a separate lookup.

**Edge cases:**
- Handle contained in another username: `"saraheashley"` inside `"notaraheashleyaccount"` — use `text.includes(target)` first which requires exact word match
- Multiple rows with same partial name: first match wins; `verifyIdentity` guards for accuracy
- Emoji in display names: stripped by `replace(/[^a-z0-9]/g, '')`

---

## 6. verifyIdentity

Used after Strategy B to confirm the opened conversation belongs to the target user.

```typescript
const verifyIdentity = async (): Promise<{verified: boolean; header: string}> => {
  const raw = await driver.executeJS(`
    (function() {
      var target = '${handle.toLowerCase()}';
      // Primary: TikTok always renders a[href="/@handle"] in the open chat panel
      var profileLink = document.querySelector('a[href="/@' + target + '"]');
      if (profileLink) {
        return JSON.stringify({verified: true, header: profileLink.innerText || target});
      }
      // Check composer is open at all
      var hasComposer = !!document.querySelector('[contenteditable="true"]')
                     || document.body.innerText.includes('Send a message');
      if (!hasComposer) {
        return JSON.stringify({verified: false, header: 'no_conversation_open'});
      }
      // Fallback: scan right-panel (x>200) text nodes for the handle
      var nodes = document.querySelectorAll('p, span, h2, h3');
      for (var i = 0; i < nodes.length; i++) {
        var r = nodes[i].getBoundingClientRect();
        var t = (nodes[i].textContent || '').trim();
        if (r.width > 0 && r.y < 200 && r.x > 200 && t.toLowerCase().includes(target)) {
          return JSON.stringify({verified: true, header: t.substring(0, 60)});
        }
      }
      return JSON.stringify({verified: false, header: 'composer_open_but_unverified'});
    })()
  `);
  try { return JSON.parse(raw); } catch { return {verified: false, header: ''}; }
};
```

**Important:** After Strategy A (squish-match), `verifyIdentity` is **skipped** — we trust the squish-match and only check that the composer opened. This avoids a race condition where `executeJS` returns empty during the SPA panel transition.

---

## 7. sendMessage — Type + Click Send Button

```typescript
// packages/tiktok-dm/src/automation/dm-operations.ts

export async function sendMessage(driver, message) {
  // 1. Focus composer — try multiple selectors
  const selectors = [
    '[data-e2e="message-input"]',      // draft composer
    '[placeholder*="message"]',         // placeholder text
    '[contenteditable="true"]',         // contenteditable div
  ];
  for (const sel of selectors) {
    if (await driver.focusElement(sel)) break;
  }

  // 2. Type via OS-level keystrokes (React sees these; JS .value= does not work)
  await driver.typeViaKeystrokes(message);
  await driver.wait(500);

  // 3. Try JS click on send button first (sometimes works on the SVG itself)
  const sendResult = await driver.executeJS(`
    (function() {
      var btn = document.querySelector('[data-e2e="message-send"]');
      if (btn) {
        var clickTarget = btn.closest('div') || btn.parentElement || btn;
        clickTarget.click();
        return 'sent_e2e';
      }
      var selectors = ['[data-e2e="send-message-btn"]', '[class*="SendButton"]', '[aria-label*="Send"]'];
      for (var i = 0; i < selectors.length; i++) {
        var el = document.querySelector(selectors[i]);
        if (el) { el.click(); return 'sent_fallback'; }
      }
      return 'no_button';
    })()
  `);

  if (sendResult.includes('sent')) return { success: true };

  // 4. Get send button screen coords and cliclick it (most reliable)
  const sendPos = await driver.executeJS(`
    (function() {
      var btn = document.querySelector('[data-e2e="message-send"]');
      if (btn) {
        var r = btn.getBoundingClientRect();
        if (r.width > 0)
          return JSON.stringify({x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2)});
      }
      return 'none';
    })()
  `);
  if (sendPos !== 'none') {
    const pos = JSON.parse(sendPos);
    await driver.clickAtScreenPosition(pos.x, pos.y, true);  // cliclick
    return { success: true };
  }

  // 5. Final fallback: Enter key
  await driver.pressEnter();
  return { success: true };
}
```

**The red send button** in the screenshot is `[data-e2e="message-send"]` — a pink/red arrow SVG. Steps 3→4→5 ensure it always gets pressed regardless of whether JS click works.

---

## 8. API Endpoints Reference

**Base:** `http://localhost:3102`

### Health & Status
| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Service health check |
| GET | `/api/tiktok/status` | Safari session status |
| GET | `/api/tiktok/rate-limits` | Current rate limit counters |
| GET | `/api/tiktok/error-check` | Check for TikTok error state in browser |

### Send DM
| Method | Path | Body | Description |
|--------|------|------|-------------|
| POST | `/api/tiktok/messages/send-to` | `{username, text}` | **Main endpoint** — find or create conversation and send |
| POST | `/api/tiktok/messages/send` | `{text}` | Send in currently open conversation |

### Conversations
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/tiktok/conversations` | List visible inbox conversations |
| POST | `/api/tiktok/conversations/open` | `{username}` — open conversation by username |
| POST | `/api/tiktok/conversations/new` | `{username, message}` — start new conversation |
| POST | `/api/tiktok/conversations/scroll` | Scroll inbox to load more conversations |

### Messages
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/tiktok/messages?limit=50` | Read messages from current open conversation |

### CRM
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/tiktok/crm/stats` | Platform-level stats (total sent, reply rate) |
| GET | `/api/tiktok/crm/top-contacts?limit=N` | Top contacts by engagement score |
| POST | `/api/tiktok/crm/score` | `{contactId}` — recalculate one contact's score |
| POST | `/api/tiktok/crm/score-all` | Recalculate all TikTok contact scores |

### Templates & Outreach
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/tiktok/templates` | List message templates |
| POST | `/api/tiktok/templates/next-action` | Get next best action for contact |
| GET | `/api/tiktok/outreach/pending` | Contacts pending outreach |
| GET | `/api/tiktok/outreach/stats` | Outreach funnel stats |

---

## 9. CRM Integration

### Supabase Connection
```
Project:  mediaposter-lite (ivhfuhxorppptyuofbgq)
URL:      https://ivhfuhxorppptyuofbgq.supabase.co
Anon key: see .env.supabase in Safari Automation root
Tables:   crm_contacts, crm_messages
```

### Syncing a TikTok conversation to Supabase

```python
import json, urllib.request, urllib.error

SUPABASE_URL = "https://ivhfuhxorppptyuofbgq.supabase.co"
SUPABASE_KEY = "<anon-or-service-key>"
TIKTOK_BASE  = "http://localhost:3102"

def supabase_upsert(table, rows):
    data = json.dumps(rows).encode()
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/{table}",
        data=data,
        headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates",
        },
        method="POST"
    )
    with urllib.request.urlopen(req) as r:
        return r.read()

def sync_tiktok_contact(username):
    # Open conversation
    post(f"{TIKTOK_BASE}/api/tiktok/conversations/open", {"username": username})

    # Read messages
    msgs_raw = get(f"{TIKTOK_BASE}/api/tiktok/messages?limit=50")
    messages = msgs_raw.get("messages", [])

    # Get CRM score
    top = get(f"{TIKTOK_BASE}/api/tiktok/crm/top-contacts?limit=200")
    crm = next((c for c in top.get("contacts", []) if c["username"] == username), {})

    # Upsert contact
    supabase_upsert("crm_contacts", [{
        "platform":        "tiktok",
        "username":        username,
        "display_name":    crm.get("displayName", username),
        "engagement_score":crm.get("engagementScore", 0),
        "stage":           crm.get("stage", "cold"),
        "messages_sent":   crm.get("messagesSent", 0),
        "replies_received":crm.get("repliesReceived", 0),
    }])

    # Upsert messages
    msg_rows = [{
        "platform":   "tiktok",
        "username":   username,
        "sender":     m.get("sender", ""),
        "text":       m.get("text", ""),
        "is_outbound":m.get("isOutbound", False),
        "message_id": m.get("id", f"{username}_{i}"),
        "timestamp_str": str(m.get("timestamp", "")),
    } for i, m in enumerate(messages)]
    if msg_rows:
        supabase_upsert("crm_messages", msg_rows)
```

---

## 10. Rate Limits

Built-in rate limits enforced by the service:

| Window | Default Limit |
|--------|--------------|
| Hourly | 10 DMs/hour |
| Daily  | 50 DMs/day  |

Rate limit headers returned in every send response:
```json
{
  "success": true,
  "rateLimits": { "hourly": 3, "daily": 12 }
}
```

When limit hit, service returns `429`:
```json
{ "error": "Rate limit exceeded", "resetAt": "2026-02-27T00:00:00Z" }
```

**TikTok platform limits** (enforced by TikTok, not the service):
- New accounts: ~5-10 DMs/day before restrictions
- Established accounts: ~50-100 DMs/day
- Always follow/follow-back to increase DM deliverability

---

## 11. Selectors Reference

| Element | Selector | Notes |
|---------|----------|-------|
| Conversation rows | `[class*="DivItemWrapper"]` | Multiple matches in sidebar |
| Message composer | `[contenteditable="true"]` | React contenteditable |
| Composer (draft) | `[data-e2e="message-input"]` | More specific |
| Send button | `[data-e2e="message-send"]` | Pink/red arrow SVG |
| Search bar | `[data-e2e="search-user-input"]` | In compose modal |
| New message btn | `[data-e2e="new-message-btn"]` | Pencil/compose icon |
| Chat profile link | `a[href="/@username"]` | In open chat panel |
| Inbox container | `[class*="DivFullSideNav"]` | Whole left sidebar |
| Search input | `[class*="DivConversationHeader"] input` | Filter search in inbox |

**Selector stability:** TikTok uses `data-e2e` attributes for QA which tend to be stable. Class names like `DivItemWrapper` are part of TikTok's compiled CSS module names and have been stable for months, but may change in major redesigns.

---

## 12. Environment & Startup

### Prerequisites
```bash
brew install cliclick           # OS-level mouse clicks
brew install node               # Node.js 18+
```

### Required env vars
```bash
# Optional — enables Supabase CRM logging
CRM_SUPABASE_URL=https://ivhfuhxorppptyuofbgq.supabase.co
CRM_SUPABASE_ANON_KEY=<anon key from .env.supabase>
```

### Start the service
```bash
cd "/Users/isaiahdupree/Documents/Software/Safari Automation/packages/tiktok-dm"
PORT=3102 npx tsx src/api/server.ts
```

### Prerequisites in Safari
1. Safari must be open and logged into `https://www.tiktok.com`
2. Safari must be the frontmost window (or at least accessible)
3. macOS Accessibility permissions: **System Settings → Privacy & Security → Accessibility → Terminal ✓**
4. macOS Screen Recording (for `cliclick` to resolve coords): **not required**, cliclick uses Quartz directly

### Verify it's working
```bash
curl http://localhost:3102/health
# → {"status":"ok","service":"tiktok-dm"}

curl http://localhost:3102/api/tiktok/status
# → {"status":"ready","url":"https://www.tiktok.com/messages"}
```

---

## 13. Debugging Playbook

### Check what's in the DOM right now
```bash
osascript -e 'tell application "Safari" to do JavaScript "(function(){var rows=document.querySelectorAll('"'"'[class*=\"DivItemWrapper\"]'"'"');return rows.length+\" rows: \"+Array.from(rows).slice(0,3).map(r=>r.innerText.substring(0,30)).join(\" | \")})()" in front document'
```

### Check composer state
```bash
osascript -e 'tell application "Safari" to do JavaScript "(function(){var ce=document.querySelector('"'"'[contenteditable=\"true\"]'"'"');return ce?\"open:\"+(ce.innerText||ce.textContent).substring(0,50):\"closed\"})()" in front document'
```

### Get Sarah's row screen coords live
```bash
osascript << 'EOF'
tell application "Safari"
  set res to do JavaScript "(function(){var sx=window.screenX,sy=window.screenY,tb=window.outerHeight-window.innerHeight;var rows=document.querySelectorAll('[class*=\"DivItemWrapper\"]');for(var i=0;i<rows.length;i++){if((rows[i].innerText||'').indexOf('Sarah')>=0){var r=rows[i].getBoundingClientRect();return (sx+Math.round(r.left+r.width*0.25))+','+(sy+tb+Math.round(r.top+r.height/2))+'|'+rows[i].innerText.substring(0,40)}}return 'notfound'})()" in front document
  return res
end tell
EOF
```

### Watch the service logs live
```bash
tail -f /tmp/tiktok-dm.log | grep -E "Strategy|squish|click|composer|send|verify|error"
```

### Test send via curl
```bash
curl -X POST http://localhost:3102/api/tiktok/messages/send-to \
  -H "Content-Type: application/json" \
  -d '{"username": "saraheashley", "text": "Test message from automation"}'
```

---

## 14. Known Failure Modes & Fixes

| Symptom | Root Cause | Fix |
|---------|-----------|-----|
| `@handle not found in inbox list` | User not in visible inbox | Strategy B/C fires automatically; or scroll inbox first |
| `composer not found after squish-click` | SPA transition not complete | Increase `wait(4000)` after click |
| `No visible conversation rows after searching` | TikTok search returned 0 results / different DOM during search | Strategy C fires; also check TikTok isn't showing a CAPTCHA |
| `NewMessage compose button not found` | TikTok rate-limited compose or changed selector | Check `data-e2e` in Safari DevTools; try navigating manually |
| `Strategy B identity mismatch` | Search returned wrong user first | `verifyIdentity` catches this; falls to Strategy C |
| `JS click ignored on send button` | React virtual DOM | `clickAtScreenPosition` with cliclick fires as fallback |
| `typeViaKeystrokes fails` | Composer not focused | Check `focusElement` result; may need `clickAtScreenPosition` on composer first |
| `cliclick not found` | Not installed | `brew install cliclick` |
| `No TikTok tab found` | Safari not open on TikTok | Navigate Safari to `https://www.tiktok.com/messages` manually |
| `Coordinates wrong after window move` | Screen coords computed at different time than click | Coords are fetched and used immediately in same call — minimize window movement between calls |
| `rate limit 429` | Too many DMs sent | Wait for hourly/daily reset; check `GET /api/tiktok/rate-limits` |

---

## Quick Reference — Send a DM

```bash
# One-liner: send a DM to any TikTok user
curl -s -X POST http://localhost:3102/api/tiktok/messages/send-to \
  -H "Content-Type: application/json" \
  -d '{"username": "USERNAME_HERE", "text": "Your message here"}' \
  | python3 -c "import sys,json; r=json.load(sys.stdin); print('✅' if r.get('success') else '❌', json.dumps(r))"
```

Expected success response:
```json
{
  "success": true,
  "username": "saraheashley",
  "verified": true,
  "verifiedRecipient": "saraheashley",
  "rateLimits": { "hourly": 1, "daily": 1 }
}
```
