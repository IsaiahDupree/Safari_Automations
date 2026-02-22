# LinkedIn Automation — API Reference & Architecture

> **Port**: 3105  
> **Start**: `npx tsx packages/linkedin-automation/src/api/server.ts`  
> **Tests**: `npx tsx packages/linkedin-automation/src/__tests__/selectors.test.ts` (18/18 passing)

---

## Table of Contents

- [Architecture](#architecture)
- [Profile Extraction](#profile-extraction)
- [Connections](#connections)
- [Messaging](#messaging)
- [Search & Prospecting](#search--prospecting)
- [Outreach Engine](#outreach-engine)
- [Rate Limits & Safety](#rate-limits--safety)
- [DOM Selectors Reference](#dom-selectors-reference)
- [Troubleshooting](#troubleshooting)

---

## Architecture

```
Safari ← AppleScript/Quartz → SafariDriver → Operations → REST API (Express)
                                                              ↑
                                                         port 3105
```

### Key Design Decisions

- **Text-based extraction**: LinkedIn Feb 2026 uses obfuscated CSS class names. Profile data is extracted by parsing `main.innerText` lines, not CSS selectors.
- **Anchor-based buttons**: Connect and Message are rendered as `<a>` tags, not `<button>`. All selectors check both element types.
- **OS-level clicks**: LinkedIn's Ember.js messaging UI ignores synthetic JS `.click()`. The SafariDriver uses Quartz CGEvent mouse events for native OS-level clicks.
- **Dynamic toolbar offset**: Safari toolbar height is calculated dynamically (`windowHeight - viewportHeight`) instead of hardcoded.

### Key Files

| File | Purpose |
|------|---------|
| `src/automation/safari-driver.ts` | Safari AppleScript/Quartz driver |
| `src/automation/connection-operations.ts` | Profile extraction, connections, search, scoring |
| `src/automation/dm-operations.ts` | Conversations, messages, send |
| `src/automation/outreach-engine.ts` | Campaign management, prospect lifecycle |
| `src/api/server.ts` | REST API (Express) |
| `src/__tests__/selectors.test.ts` | Integration test suite |

---

## Profile Extraction

### `GET /api/linkedin/profile/:username`

Full profile extraction by navigating to the profile page.

**Response:**
```json
{
  "name": "Murphy Brantley",
  "headline": "Founder | Scaling ideas into mobile apps users love",
  "location": "Dallas, Texas, United States",
  "connectionDegree": "2nd",
  "mutualConnections": 3,
  "currentPosition": {
    "title": "Founder",
    "company": "TaterTapps · Full-time",
    "duration": "Oct 2018 - Present · 7 yrs 5 mos"
  },
  "skills": ["iOS", "Objective-C", "..."],
  "canConnect": true,
  "canMessage": true,
  "isOpenToWork": false,
  "isHiring": false,
  "scrapedAt": "2026-02-22T19:42:00.000Z"
}
```

### `GET /api/linkedin/profile/extract-current`

Extract profile from the currently loaded page (no navigation).

**Response:** Same fields as above plus `url`, `nameIdx`, `linesCount`.

---

## Connections

### `GET /api/linkedin/connections/status?profileUrl=...`

Check connection status for a profile.

### `POST /api/linkedin/connections/request`

Send a connection request.

```json
{
  "profileUrl": "https://www.linkedin.com/in/username",
  "note": "Hi, I'd love to connect!",
  "skipIfConnected": true,
  "skipIfPending": true
}
```

**Response:**
```json
{
  "success": true,
  "status": "sent",
  "noteSent": true
}
```

**Status values:** `sent`, `already_connected`, `pending`, `cannot_connect`, `error`

### `GET /api/linkedin/connections/pending?type=received|sent`

List pending connection requests.

### `POST /api/linkedin/connections/accept`

Accept a connection request. Body: `{ "profileUrl": "..." }`

---

## Messaging

### `POST /api/linkedin/navigate/messaging`

Navigate Safari to the LinkedIn messaging tab.

### `GET /api/linkedin/conversations`

List all visible conversations. Automatically navigates to messaging first.

**Response:**
```json
{
  "conversations": [
    {
      "participantName": "Sarah Ashley",
      "lastMessage": "We're starting an automated LinkedIn sales...",
      "lastMessageAt": "Oct 23, 2024",
      "unread": false
    }
  ],
  "count": 11
}
```

### `POST /api/linkedin/messages/open`

Open a specific conversation by participant name. Uses OS-level Quartz mouse click.

```json
{ "participantName": "Sarah Ashley" }
```

### `GET /api/linkedin/messages?limit=20`

Read messages from the currently open conversation.

**Response:**
```json
{
  "messages": [
    {
      "id": "msg_0",
      "sender": "Sarah Ashley",
      "content": "Congrats on your work anniversary!",
      "timestamp": "SEP 16, 2020",
      "isOutbound": false
    }
  ],
  "count": 12
}
```

### `POST /api/linkedin/messages/send`

Send a message in the currently open conversation.

```json
{ "text": "Hey Sarah! How are you?" }
```

**Response:**
```json
{
  "success": true,
  "verified": true,
  "verifiedRecipient": "Sarah Ashley\nStory-Driven Copywriter..."
}
```

### `POST /api/linkedin/messages/send-to`

Send a message by navigating to a profile first (new or existing conversation).

```json
{
  "profileUrl": "https://www.linkedin.com/in/username",
  "text": "Hello!"
}
```

### `GET /api/linkedin/messages/unread`

Get unread message count.

---

## Search & Prospecting

### `POST /api/linkedin/search/people`

Search for people with filters.

```json
{
  "keywords": ["founder", "startup"],
  "title": "CEO",
  "company": "tech",
  "location": "United States",
  "connectionDegree": "2nd"
}
```

### `POST /api/linkedin/prospect/search-score`

Search + lead scoring. Returns sorted results with scores.

```json
{
  "search": { "keywords": ["founder"] },
  "targetTitles": ["CEO", "Founder", "CTO"],
  "targetCompanies": ["startup"],
  "targetLocations": ["United States"],
  "minScore": 50
}
```

### `POST /api/linkedin/prospect/pipeline`

Full pipeline: search → score → connect + note → DM.

### `POST /api/linkedin/profile/score`

Score a single profile against target criteria.

---

## Outreach Engine

Automated outreach campaign management with persistent state.

### Prospect Lifecycle

```
discovered → connection_sent → connected → first_dm_sent
  → replied / follow_up_1 → follow_up_2 → follow_up_3
  → engaged / converted / cold / opted_out
```

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/linkedin/outreach/campaigns` | Create campaign |
| GET | `/api/linkedin/outreach/campaigns` | List campaigns |
| GET | `/api/linkedin/outreach/prospects?campaign=X&stage=Y` | Filter prospects |
| GET | `/api/linkedin/outreach/stats` | Pipeline metrics |
| POST | `/api/linkedin/outreach/run` | Run outreach cycle |
| GET | `/api/linkedin/outreach/runs` | Run history |
| POST | `/api/linkedin/outreach/prospects/:id/convert` | Mark converted |
| POST | `/api/linkedin/outreach/prospects/:id/opt-out` | Mark opted out |

### Create Campaign

```json
{
  "name": "Founder Outreach",
  "offer": "EverReach App Kit",
  "search": { "keywords": ["founder", "startup"] },
  "targetTitles": ["CEO", "Founder"],
  "minScore": 60,
  "maxProspectsPerRun": 5,
  "templates": {
    "connectionNote": "Hi {firstName}, love what you're building!",
    "firstDm": "Hey {firstName}, thanks for connecting!",
    "followUp1": "Hi {firstName}, just following up...",
    "followUp2": "Hey {firstName}, checking in...",
    "followUp3": "Last note {firstName}..."
  }
}
```

### Run Outreach Cycle

```json
{ "campaignId": "camp_...", "dryRun": true }
```

**Cycle steps:** Discover → Connect → Check Connections → Send DMs → Follow-ups → Reply Detection

### State Storage

Persistent JSON files in `~/.linkedin-outreach/`:
- `prospects.json` — all prospects with stage/history
- `campaigns.json` — campaign definitions
- `runs.json` — run history

### Default Timing

| Stage | Delay |
|-------|-------|
| First DM after connect | 2 hours |
| Follow-up 1 | 72 hours (3 days) |
| Follow-up 2 | 168 hours (7 days) |
| Follow-up 3 | 336 hours (14 days) |
| Give up → cold | 504 hours (21 days) |

---

## Rate Limits & Safety

| Limit | Value |
|-------|-------|
| Connection requests/day | 20 |
| Connection requests/week | 80 |
| Messages/day | 50 |
| Active hours | 8:00 AM – 6:00 PM |
| Human-like delay | 2–5s between actions |

---

## DOM Selectors Reference

### Profile Section (Feb 2026)

| Element | Selector |
|---------|----------|
| Main container | `main` |
| Profile section | `main > section` (first) |
| Name | First `h2` in main (not a section heading) |
| Connect (anchor) | `a[aria-label*="connect"]` or `a[href*="custom-invite"]` |
| Message (anchor) | `a[aria-label*="Message"]` or `a[href*="/messaging/compose"]` |
| More dropdown | `button[aria-label="More"]` |

### Conversation List

| Element | Selector |
|---------|----------|
| Items | `.msg-conversation-listitem` |
| Name | `.msg-conversation-listitem__participant-names` |
| Snippet | `.msg-conversation-card__message-snippet` |
| Timestamp | `.msg-conversation-listitem__time-stamp` or `time` |
| Unread | `.msg-conversation-listitem--unread` (class) |

### Message Thread

| Element | Selector |
|---------|----------|
| Messages | `.msg-s-message-list__event` (parent LI only) |
| Body | `.msg-s-event-listitem__body` |
| Sender | `.msg-s-message-group__name` |
| Thread person | `.msg-entity-lockup__entity-title` |

### Message Input

| Element | Selector |
|---------|----------|
| Input | `.msg-form__contenteditable` (contenteditable div) |
| Send button | `.msg-form__send-button` |
| Form | `.msg-form` |

> **Note:** Input selectors only work in real conversations (1st-degree connections), NOT InMail/Sponsored messages.

---

## Troubleshooting

### "Connect not found"
LinkedIn renders Connect as `<a>`, not `<button>`. The code checks both. If still missing, the profile may be Follow-only (no Connect option).

### Conversation click doesn't work
LinkedIn Ember.js messaging ignores JS `.click()`. The `openConversation` function uses OS-level Quartz mouse clicks. The toolbar offset is calculated dynamically.

### Message has "-n" prefix
Fixed in commit `231b444+`. The `typeViaClipboard` method now uses `printf "%s"` instead of `echo -n` which doesn't work reliably on macOS.

### Duplicate messages in readMessages
Use only `.msg-s-message-list__event` selector. The child `.msg-s-event-listitem` duplicates each message.

### InMail/Sponsored conversation has no input
The message input (`.msg-form__contenteditable`) only appears in real conversations with 1st-degree connections, not in InMail or Sponsored threads.

---

## Debug Endpoint

```bash
# Execute arbitrary JS on the current page
curl -X POST http://localhost:3105/api/linkedin/debug/js \
  -H "Content-Type: application/json" \
  -d '{"js":"document.title"}'
```

---

## Scheduler Integration

Task type: `linkedin-outreach-cycle`

```bash
# Schedule single run
POST http://localhost:3010/api/linkedin/outreach-cycle
{ "campaignId": "camp_...", "dryRun": false }

# Schedule recurring
POST http://localhost:3010/api/linkedin/outreach-cycle/recurring
{ "campaignId": "camp_...", "intervalHours": 4, "runs": 6 }
```

Timeout: 5 minutes. Resource: Safari-exclusive.
