# PRD: Per-Domain MCP Servers

> Protocol: JSON-RPC 2.0 over stdio | MCP version: 2024-11-05 | Updated: Mar 2026

## Architecture

Two patterns in use:
- **HTTP Proxy** (new servers): stdio → `fetch()` → REST API at localhost port. Preferred for new work — no compile dependency, naturally combines two services (DM + Comments) per MCP.
- **Direct Import** (LinkedIn, Threads, Market Research): stdio → function call. Already shipping.

Tool timeout: 30s (60s for Upwork). Errors returned as `isError: true` in result content.

---

## Server Map

| Domain | File | Services | Status |
|--------|------|----------|--------|
| Instagram | `packages/instagram-dm/src/api/mcp-server.ts` | DM:3100 + Comments:3005 | ✅ NEW |
| Twitter/X | `packages/twitter-dm/src/api/mcp-server.ts` | DM:3003 + Comments:3007 | ✅ NEW |
| TikTok | `packages/tiktok-dm/src/api/mcp-server.ts` | DM:3102 + Comments:3006 | ✅ NEW |
| Upwork | `packages/upwork-automation/src/api/mcp-server.ts` | 3104 | ✅ NEW |
| LinkedIn | `packages/linkedin-automation/src/api/mcp-server.ts` | 3105 | ✅ Exists |
| Threads | `packages/threads-comments/src/api/mcp-server.ts` | 3004 | ✅ Exists |
| Market Research | `packages/market-research/src/mcp/server.ts` | 3106 | ✅ Exists |
| Unified | `packages/safari-mcp/src/index.ts` | All via HTTP | ✅ Exists |

---

## Instagram MCP — 12 Tools

| Tool | Description |
|------|-------------|
| `instagram_send_dm` | DM user via profile → message flow |
| `instagram_get_conversations` | List inbox conversations |
| `instagram_get_messages` | Read current thread |
| `instagram_open_conversation` | Open thread by username |
| `instagram_post_comment` | Comment on post by URL |
| `instagram_get_comments` | Extract comments (optional auto-navigate) |
| `instagram_session_ensure` | Lock correct Safari tab |
| `instagram_session_status` | Get session window/tab/URL |
| `instagram_session_clear` | Reset session tracking |
| `instagram_get_status` | Service health + current URL |
| `instagram_navigate_inbox` | Navigate to DM inbox |
| `instagram_ai_generate_dm` | GPT-4o DM drafting |

---

## Twitter/X MCP — 15 Tools

| Tool | Description |
|------|-------------|
| `twitter_send_dm` | DM user (profile → inbox fallback) |
| `twitter_get_conversations` | List DM conversations |
| `twitter_get_unread` | List unread conversations only |
| `twitter_get_messages` | Read current thread |
| `twitter_open_conversation` | Open existing thread |
| `twitter_new_conversation` | Start new DM with no prior thread |
| `twitter_post_comment` | Reply to tweet (supports `useAI=true`) |
| `twitter_search` | Search tweets by keyword + tab |
| `twitter_timeline` | Get user's tweet timeline |
| `twitter_compose_tweet` | Post new tweet (AI + reply settings) |
| `twitter_session_ensure` | Lock correct Safari tab |
| `twitter_session_status` | Session info |
| `twitter_session_clear` | Reset session |
| `twitter_get_status` | Service health |
| `twitter_navigate_inbox` | Navigate to DM inbox |

---

## TikTok MCP — 12 Tools

| Tool | Description |
|------|-------------|
| `tiktok_send_dm` | DM user (inbox search → profile → compose fallback) |
| `tiktok_get_conversations` | List inbox conversations |
| `tiktok_get_messages` | Read current thread |
| `tiktok_post_comment` | Comment on video (direct URL required) |
| `tiktok_get_comments` | Extract comments (optional auto-navigate) |
| `tiktok_search` | Search videos by keyword |
| `tiktok_video_metrics` | Engagement stats: likes, views, comments, shares |
| `tiktok_session_ensure` | Lock correct Safari tab |
| `tiktok_session_status` | Session info |
| `tiktok_session_clear` | Reset session |
| `tiktok_get_status` | Service health |
| `tiktok_navigate_inbox` | Navigate to DM inbox |

---

## Upwork MCP — 15 Tools

| Tool | Description |
|------|-------------|
| `upwork_get_status` | Health, login state, current URL |
| `upwork_search_jobs` | Search with keyword/type/level/time filters |
| `upwork_get_job_detail` | Full job page extraction by URL |
| `upwork_score_jobs` | Batch score + apply/maybe/skip + connects advice |
| `upwork_generate_proposal` | GPT-4o cover letter tailored to job |
| `upwork_submit_proposal` | Fill form + submit (dryRun=true for preview) |
| `upwork_get_conversations` | List message inbox conversations |
| `upwork_get_messages` | Read messages from inbox |
| `upwork_open_message` | Open thread by client name |
| `upwork_send_message` | Send message in open thread |
| `upwork_get_applications` | List submitted applications + status |
| `upwork_monitor_scan` | Scan for new jobs matching watch criteria |
| `upwork_list_watches` | List saved job watch criteria |
| `upwork_get_rate_limits` | Searches/hr and applications/day state |
| `upwork_navigate` | Navigate to find-work / my-jobs / messages |

---

## LinkedIn MCP — Existing + Improvement Areas

**File**: `packages/linkedin-automation/src/api/mcp-server.ts` | **Port**: 3105  
**Tools**: `linkedin_search_people`, `linkedin_get_profile`, `linkedin_send_connection`, `linkedin_send_message`, `linkedin_list_conversations`, `linkedin_score_profile`, `linkedin_navigate`, `linkedin_run_pipeline`, `linkedin_get_status`

### Known Gaps

| Gap | Fix |
|-----|-----|
| No native-click tool exposed | Add `linkedin_debug_click` (x,y OS-level click via `clickAtViewportPosition`) |
| First-contact DMs fail (no `msg-form` in new convos) | Add `/messaging/compose/?profileUrn=…` page flow as fallback |
| Profile CTA scoped to `main > section` — broken on some profiles | Remove scope, search full document |
| Fixed `setTimeout(3000)` after navigation — race condition | Replace with `waitForCondition()` polling for expected selector |
| No `force: true` to bypass rate limit for manual sends | Add `force` param to send tools |

---

## Threads / Market Research — Existing, No Critical Gaps

- **Threads** (`packages/threads-comments/src/api/mcp-server.ts`, port 3004): 8 tools — stable
- **Market Research** (`packages/market-research/src/mcp/server.ts`, port 3106): only `search_posts` + `get_trends` — missing `competitor_research` and `get_top_creators` (available in unified safari-mcp)

---

## Claude Desktop Config

`~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "instagram":  { "command": "npx", "args": ["tsx", "/Users/isaiahdupree/Documents/Software/Safari Automation/packages/instagram-dm/src/api/mcp-server.ts"] },
    "twitter":    { "command": "npx", "args": ["tsx", "/Users/isaiahdupree/Documents/Software/Safari Automation/packages/twitter-dm/src/api/mcp-server.ts"] },
    "tiktok":     { "command": "npx", "args": ["tsx", "/Users/isaiahdupree/Documents/Software/Safari Automation/packages/tiktok-dm/src/api/mcp-server.ts"] },
    "upwork":     { "command": "npx", "args": ["tsx", "/Users/isaiahdupree/Documents/Software/Safari Automation/packages/upwork-automation/src/api/mcp-server.ts"] },
    "linkedin":   { "command": "npx", "args": ["tsx", "/Users/isaiahdupree/Documents/Software/Safari Automation/packages/linkedin-automation/src/api/mcp-server.ts"] },
    "threads":    { "command": "npx", "args": ["tsx", "/Users/isaiahdupree/Documents/Software/Safari Automation/packages/threads-comments/src/api/mcp-server.ts"] },
    "safari-automation": { "command": "npx", "args": ["tsx", "/Users/isaiahdupree/Documents/Software/Safari Automation/packages/safari-mcp/src/index.ts"] }
  }
}
```

## MCP Server Improvements — Priority Backlog

| # | Improvement | Status | What it unlocks |
|---|-------------|--------|-----------------|
| 1 | **`dryRun` on all write tools** | ✅ Done | Safe autonomous use — no accidental sends |
| 2 | **`*_is_ready` preflight tools** | ✅ Done | Prevents 30s timeout loops when services aren't running |
| 3 | **Structured error codes** | ✅ Done | Self-recovery: Claude knows to call `session_ensure` on `SESSION_EXPIRED`, wait on `RATE_LIMITED` |
| 4 | **`/safari-status` skill** | Pending | First command every session — health table for all 7 services |
| 5 | **`/social-inbox` skill** | Pending | Unified unread triage across all platforms |
| 6 | **CRMLite integration** | Pending | Prevents duplicate outreach, enables follow-up sequencing |
| 7 | **Output schemas** | Pending | Claude knows exact field shapes — removes exploration round-trips |
| 8 | **`/dm-campaign` skill** | Pending | Revenue automation: check CRM → profile → draft → approve → send |

### Structured Error Codes (implemented)

All 4 new MCP servers now return machine-readable errors:

```json
{ "code": "RATE_LIMITED",    "message": "Rate limit hit", "retryAfter": 60, "platform": "instagram" }
{ "code": "SESSION_EXPIRED", "message": "Safari session expired", "action": "call instagram_session_ensure" }
{ "code": "NOT_FOUND",       "message": "...", "platform": "twitter" }
{ "code": "SERVICE_DOWN",    "message": "http://localhost:3100 is not running", "base": "http://localhost:3100" }
{ "code": "API_ERROR",       "message": "HTTP 500: ...", "platform": "tiktok" }
```

### dryRun Write Tools (implemented)

| Tool | dryRun Response |
|------|----------------|
| `instagram_send_dm` | `{ dryRun: true, wouldSend: { platform, to, text } }` |
| `instagram_post_comment` | `{ dryRun: true, wouldPost: { platform, postUrl, text } }` |
| `twitter_send_dm` | `{ dryRun: true, wouldSend: { platform, to, text } }` |
| `twitter_post_comment` | `{ dryRun: true, wouldPost: { platform, postUrl, text, useAI } }` |
| `twitter_compose_tweet` | `{ dryRun: true, wouldTweet: { platform, text, useAI, topic, replySettings } }` |
| `tiktok_send_dm` | `{ dryRun: true, wouldSend: { platform, to, text } }` |
| `tiktok_post_comment` | `{ dryRun: true, wouldPost: { platform, postUrl, text } }` |
| `upwork_submit_proposal` | `{ dryRun: true, ... }` (fills form, does not click Submit) |

### is_ready Preflight Tools (implemented)

Each MCP server now has a preflight tool that checks all its dependencies in parallel with a 5s timeout:

| Tool | Checks |
|------|--------|
| `instagram_is_ready` | DM service :3100 + Comments :3005 |
| `twitter_is_ready` | DM service :3003 + Comments :3007 |
| `tiktok_is_ready` | DM service :3102 + Comments :3006 |
| `upwork_is_ready` | Service :3104 |

Returns: `{ dm: bool, comments: bool, ready: bool, dmUrl, commentsUrl }`

---

## Skills Roadmap

New files in `/Users/isaiahdupree/Documents/Software/skills/`:

| Skill | Command | Description |
|-------|---------|-------------|
| `safari-status` | `/safari-status` | Health check all 7 REST services + Safari sessions. First command every session. |
| `social-inbox` | `/social-inbox` | Read unread DMs from Instagram/Twitter/TikTok/LinkedIn in one pass. Categorize + draft replies. |
| `dm-campaign` | `/dm-campaign [platform] [purpose] [usernames...]` | CRM check → profile fetch → AI draft batch → approval gate → send with delay |
| `upwork-hunt` | `/upwork-hunt [keywords] [max]` | Search → score → generate proposals for top N → review → submit approved |
| `social-research` | `/social-research [handle]` | Cross-platform brief: LinkedIn + Instagram + Twitter bio, posts, engagement, best outreach angle |
| `comment-sweep` | `/comment-sweep [url]` | Extract commenters → CRM lookup → score as leads → open DM threads for top engagers |

---

## Start Commands (REST services must run first)

```bash
PORT=3100 npx tsx packages/instagram-dm/src/api/server.ts &
PORT=3005 npx tsx packages/instagram-comments/src/api/server.ts &
PORT=3003 npx tsx packages/twitter-dm/src/api/server.ts &
PORT=3007 SAFARI_RESEARCH_ENABLED=true npx tsx packages/twitter-comments/src/api/server.ts &
PORT=3102 npx tsx packages/tiktok-dm/src/api/server.ts &
PORT=3006 npx tsx packages/tiktok-comments/src/api/server.ts &
PORT=3104 npx tsx packages/upwork-automation/src/api/server.ts &
PORT=3105 npx tsx packages/linkedin-automation/src/api/server.ts &
PORT=3004 npx tsx packages/threads-comments/src/api/server.ts &
PORT=3106 npx tsx packages/market-research/src/api/server.ts &
```
