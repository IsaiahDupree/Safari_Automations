# Safari Automation — Master Documentation Index

> **Last updated:** 2026-02-27  
> **Total docs:** 60+ files across 7 subdirectories  
> Use this file to find what to read for any topic. Each entry says **what it covers** and **when to reach for it**.

---

## Quick Platform Lookup

| Platform | Start here | Deep reference | Selectors | PRD |
|---|---|---|---|---|
| **Instagram** | [INSTAGRAM_AUTOMATION_COMPLETE](./INSTAGRAM_AUTOMATION_COMPLETE.md) | [platforms/instagram](./platforms/instagram.md) | [INSTAGRAM_SELECTORS_REFERENCE](./selectors/INSTAGRAM_SELECTORS_REFERENCE.md) | [PRD_INSTAGRAM_DM_FULL_CONTROL](./PRDs/PRD_INSTAGRAM_DM_FULL_CONTROL.md) |
| **TikTok** | [TIKTOK_AUTOMATION_COMPLETE](./TIKTOK_AUTOMATION_COMPLETE.md) | [TIKTOK-DM-AUTOMATION](./TIKTOK-DM-AUTOMATION.md) | [TIKTOK_SELECTORS_REFERENCE](./selectors/TIKTOK_SELECTORS_REFERENCE.md) | [PRD_TIKTOK_DM_FULL_CONTROL](./PRDs/PRD_TIKTOK_DM_FULL_CONTROL.md) |
| **Twitter/X** | [TWITTER_AUTOMATION_COMPLETE](./TWITTER_AUTOMATION_COMPLETE.md) | [platforms/twitter-x](./platforms/twitter-x.md) | [TWITTER_SELECTORS_REFERENCE](./selectors/TWITTER_SELECTORS_REFERENCE.md) | [PRD_TWITTER_DM_FULL_CONTROL](./PRDs/PRD_TWITTER_DM_FULL_CONTROL.md) |
| **LinkedIn** | [LINKEDIN_AUTOMATION_COMPLETE](./LINKEDIN_AUTOMATION_COMPLETE.md) | [UPWORK_LINKEDIN_AUTOMATION](./UPWORK_LINKEDIN_AUTOMATION.md) | *(use browser DevTools)* | [PRD_LINKEDIN_DM_AUTOMATION](./PRDs/PRD_LINKEDIN_DM_AUTOMATION.md) |
| **Threads** | [THREADS_AUTOMATION_COMPLETE](./THREADS_AUTOMATION_COMPLETE.md) | [platforms/threads](./platforms/threads.md) | [THREADS_SELECTORS_REFERENCE](./selectors/THREADS_SELECTORS_REFERENCE.md) | [PRD_THREADS_DM_AUTOMATION](./PRDs/PRD_THREADS_DM_AUTOMATION.md) |
| **Sora** | [PRD_SORA_VIDEO_ORCHESTRATOR](./PRD_SORA_VIDEO_ORCHESTRATOR.md) | [SORA_3PART_PIPELINE](./SORA_3PART_PIPELINE.md) | [selectors/SORA_SELECTORS_REFERENCE](./selectors/SORA_SELECTORS_REFERENCE.md) | [PRD_SORA_FULL_CONTROL](./PRDs/PRD_SORA_FULL_CONTROL.md) |
| **Upwork** | [UPWORK_LINKEDIN_AUTOMATION](./UPWORK_LINKEDIN_AUTOMATION.md) | *(same doc)* | *(use browser DevTools)* | [PRD_UPWORK_AUTOMATION](./PRDs/PRD_UPWORK_AUTOMATION.md) |
| **Facebook** | *(no complete doc yet)* | [CREATIVE_RADAR](./CREATIVE_RADAR.md) | — | [PRD_FACEBOOK_MESSENGER_AUTOMATION](./PRDs/PRD_FACEBOOK_MESSENGER_AUTOMATION.md) |

---

## Platform Docs

### Instagram
> Port **3100** (DM) · **3005** (Comments/Research)  
> Package: `packages/instagram-dm/` · `packages/instagram-comments/`

| Doc | What it covers |
|---|---|
| [INSTAGRAM_AUTOMATION_COMPLETE](./INSTAGRAM_AUTOMATION_COMPLETE.md) | **Primary reference.** Full API (all 30+ endpoints), architecture, Ember.js DOM quirks, OS-level click requirement, session management, send flows (thread URL → smart-send → profile-to-DM), rate limits, debugging playbook, known failures |
| [platforms/instagram](./platforms/instagram.md) | Platform-specific DOM notes, login detection, DM inbox structure, hashtag search patterns |
| [selectors/INSTAGRAM_SELECTORS_REFERENCE](./selectors/INSTAGRAM_SELECTORS_REFERENCE.md) | **All verified CSS selectors** for conversations, messages, compose box, send button, profile nav — copy-paste ready |
| [PRDs/PRD_INSTAGRAM_DM_FULL_CONTROL](./PRDs/PRD_INSTAGRAM_DM_FULL_CONTROL.md) | Original feature spec: what was built, what's still missing, success criteria per DM feature |

**Use this when you want to:**
- Send a DM → `INSTAGRAM_AUTOMATION_COMPLETE` → section "DM Send Methods"
- Find a broken selector → `selectors/INSTAGRAM_SELECTORS_REFERENCE`
- Understand thread caching (known thread IDs) → `INSTAGRAM_AUTOMATION_COMPLETE` → "Thread Management"
- See what's not yet implemented → `PRDs/PRD_INSTAGRAM_DM_FULL_CONTROL`

---

### TikTok
> Port **3102** (DM) · **3006** (Comments/Research)  
> Package: `packages/tiktok-dm/` · `packages/tiktok-comments/`

| Doc | What it covers |
|---|---|
| [TIKTOK_AUTOMATION_COMPLETE](./TIKTOK_AUTOMATION_COMPLETE.md) | **Primary reference.** Full API, Quartz OS-level click architecture, virtual DOM workaround, pre-send identity verification, inbox search, profile fallback flow, rate limits |
| [TIKTOK-DM-AUTOMATION](./TIKTOK-DM-AUTOMATION.md) | Older deep-dive: strategy breakdown for each DM send flow (inbox search, profile fallback, compose-new), fallback chain logic |
| [TIKTOK-DM-API](./TIKTOK-DM-API.md) | REST API quick reference for the DM server — endpoint list with request/response shapes |
| [TIKTOK_DM_API](./TIKTOK_DM_API.md) | Alternate/supplemental API reference with additional endpoint notes |
| [TIKTOK_COMMANDS_REFERENCE](./TIKTOK_COMMANDS_REFERENCE.md) | CLI commands, start commands, quick curl examples for every endpoint |
| [TIKTOK_MARKET_RESEARCH](./TIKTOK_MARKET_RESEARCH.md) | **Market research pipeline.** Keyword search → post URLs → per-video engagement metrics + comments. Full architecture, all API endpoints, DOM selectors, CLI flags, troubleshooting, sample output, root-cause doc for TikTokResearcher escaping bug |
| [platforms/tiktok](./platforms/tiktok.md) | Platform DOM notes, login detection JS, video feed selectors, comment flow specifics |
| [selectors/TIKTOK_SELECTORS_REFERENCE](./selectors/TIKTOK_SELECTORS_REFERENCE.md) | **Comprehensive verified selectors** — DM inbox, conversation list, compose box, avatar positions (for Quartz clicks) |
| [selectors/TIKTOK_FULL_SELECTORS](./selectors/TIKTOK_FULL_SELECTORS.md) | Extended selector dump including video page, comments, profile, search results |
| [PRDs/PRD_TIKTOK_DM_FULL_CONTROL](./PRDs/PRD_TIKTOK_DM_FULL_CONTROL.md) | Full feature spec: all DM capabilities, implementation status, remaining gaps, edge cases |

**Use this when you want to:**
- Send a DM → `TIKTOK_AUTOMATION_COMPLETE` → "Send Flows"
- Debug Quartz click failures → `TIKTOK_AUTOMATION_COMPLETE` → "OS-Level Click Architecture"
- Look up an endpoint → `TIKTOK-DM-API` or `TIKTOK_COMMANDS_REFERENCE`
- Find a selector → `selectors/TIKTOK_SELECTORS_REFERENCE`
- Run market research on a keyword → `TIKTOK_MARKET_RESEARCH`

---

### Twitter / X
> Port **3003** (DM) · **3007** (Comments + Research)  
> Package: `packages/twitter-dm/` · `packages/twitter-comments/`

| Doc | What it covers |
|---|---|
| [TWITTER_AUTOMATION_COMPLETE](./TWITTER_AUTOMATION_COMPLETE.md) | **Primary reference.** Both packages end-to-end: all 30+ DM endpoints, all 10 Comments endpoints, DraftJS quirks, 3-strategy `postComment` flow, `TwitterResearcher`, `TwitterFeedbackLoop`, CRM utils, rate limits, debugging playbook, 12 known failure modes |
| [platforms/twitter-x](./platforms/twitter-x.md) | Platform DOM deep-dive: React/DraftJS state injection, login detection, timeline structure, rate limit UI detection |
| [selectors/TWITTER_SELECTORS_REFERENCE](./selectors/TWITTER_SELECTORS_REFERENCE.md) | **All verified `data-testid` selectors** — tweet article, compose box, send button, DM inbox, engagement buttons |
| [selectors/TWITTER_DOM_SELECTORS](./selectors/TWITTER_DOM_SELECTORS.md) | Supplemental selector list with JS snippets for login check, typing, metrics extraction |
| [PRDs/PRD_TWITTER_DM_FULL_CONTROL](./PRDs/PRD_TWITTER_DM_FULL_CONTROL.md) | Full DM feature spec: navigation, conversation reading, sending, AI generation, CRM sync — status per feature |
| [PRDs/PRD_TWITTER_POSTING_FULL_CONTROL](./PRDs/PRD_TWITTER_POSTING_FULL_CONTROL.md) | Posting/reply feature spec: compose tweet, reply, retweet, quote, polls, thread, scheduler — status per feature |
| [PRDs/PRD_Twitter_Video_Automation](./PRDs/PRD_Twitter_Video_Automation.md) | Video post automation on X: upload flow, caption, scheduling, selector investigation script |

**Use this when you want to:**
- Post a reply → `TWITTER_AUTOMATION_COMPLETE` → section "postComment — 5-Step Flow"
- Do market research / find top creators → `TWITTER_AUTOMATION_COMPLETE` → "TwitterResearcher"
- Send a DM → `TWITTER_AUTOMATION_COMPLETE` → "DM Operations"
- Find a selector → `selectors/TWITTER_SELECTORS_REFERENCE`
- Check what's not implemented → `PRDs/PRD_TWITTER_DM_FULL_CONTROL`

---

### LinkedIn
> Port **3105**  
> Package: `packages/linkedin-automation/`

| Doc | What it covers |
|---|---|
| [LINKEDIN_AUTOMATION_COMPLETE](./LINKEDIN_AUTOMATION_COMPLETE.md) | **Primary reference.** Full API (all 40+ endpoints), profile extraction, event-driven connection requests (with/without note via custom-invite URL), people search, lead scoring, DM flows, outreach engine (prospect lifecycle, 6-step cycle), rate limits, active hours, DOM quirks (7 documented — Connect anchor, Ember.js, SPA race conditions) |
| [LINKEDIN_AUTOMATION](./LINKEDIN_AUTOMATION.md) | Original implementation doc: selectors used, connect/message flows, conversation list extraction |
| [UPWORK_LINKEDIN_AUTOMATION](./UPWORK_LINKEDIN_AUTOMATION.md) | Combined reference for **both LinkedIn (3105) and Upwork (3104)** — quick API reference, key files, start commands |
| [PRDs/PRD_LINKEDIN_DM_AUTOMATION](./PRDs/PRD_LINKEDIN_DM_AUTOMATION.md) | DM-specific feature spec: conversation list, message reading/sending, AI generation, CRM sync — status per feature |

**Use this when you want to:**
- Search for leads → `LINKEDIN_AUTOMATION_COMPLETE` → "People Search"
- Send a connection request (with or without note) → `LINKEDIN_AUTOMATION_COMPLETE` → "Connections"
- Run outreach cycle → `LINKEDIN_AUTOMATION_COMPLETE` → "Outreach Engine"
- Send a DM → `LINKEDIN_AUTOMATION_COMPLETE` → "Messages"
- Understand connect button quirks → `LINKEDIN_AUTOMATION_COMPLETE` → "DOM Quirks"

---

### Threads
> Port **3004** (Comments/Research)  
> Package: `packages/threads-comments/`

| Doc | What it covers |
|---|---|
| [THREADS_AUTOMATION_COMPLETE](./THREADS_AUTOMATION_COMPLETE.md) | **Primary reference.** Full API, post commenting, reply threading, `ThreadsResearcher` for niche search, engagement metrics extraction, top creator ranking, rate limits, DOM quirks |
| [platforms/threads](./platforms/threads.md) | Platform DOM notes: login detection, feed structure, comment compose quirks, search behavior |
| [selectors/THREADS_SELECTORS_REFERENCE](./selectors/THREADS_SELECTORS_REFERENCE.md) | Verified CSS selectors for Threads posts, comment input, reply button, engagement metrics |
| [PRDs/PRD_THREADS_DM_AUTOMATION](./PRDs/PRD_THREADS_DM_AUTOMATION.md) | DM feature spec for Threads (DMs are not yet fully implemented — this describes what's planned) |

**Use this when you want to:**
- Post a comment → `THREADS_AUTOMATION_COMPLETE` → "Comment Flow"
- Research a niche → `THREADS_AUTOMATION_COMPLETE` → "ThreadsResearcher"
- Find a selector → `selectors/THREADS_SELECTORS_REFERENCE`
- Check DM implementation status → `PRDs/PRD_THREADS_DM_AUTOMATION`

---

### Sora (Video Generation)
> No server port — Safari automation directly on sora.com  
> Scripts: `scripts/sora-daily-pipeline.ts` · `scripts/sora-content-generator.ts`

| Doc | What it covers |
|---|---|
| [PRD_SORA_VIDEO_ORCHESTRATOR](./PRD_SORA_VIDEO_ORCHESTRATOR.md) | **Start here.** Full orchestrator spec: prompt generation, Safari-based video generation, watermark removal, video registration, catalog management |
| [SORA_3PART_PIPELINE](./SORA_3PART_PIPELINE.md) | The trilogy pipeline: generate → stitch → publish. `stitch-trilogies.ts`, batch configs, output paths |
| [SORA_API](./SORA_API.md) | Sora.com UI API reference: what buttons/inputs exist, how generation is triggered, status polling |
| [SORA_SELECTORS_REFERENCE](./SORA_SELECTORS_REFERENCE.md) | CSS selectors for sora.com UI — compose box, generate button, video grid, download links |
| [selectors/SORA_SELECTORS_REFERENCE](./selectors/SORA_SELECTORS_REFERENCE.md) | More complete selector reference in the selectors subfolder |
| [SORA_WATERMARK_REMOVAL](./SORA_WATERMARK_REMOVAL.md) | How watermark removal works: ffmpeg crop approach, dimensions per video format, script |
| [SORA_SCRIPTS_TEST_RESULTS](./SORA_SCRIPTS_TEST_RESULTS.md) | Live test results: which scripts passed, which videos generated, error catalog |
| [SORA_TEST_RESULTS_FINAL](./SORA_TEST_RESULTS_FINAL.md) | Final verified test run results with timestamps and confirmed video outputs |
| [HQ_VIDEO_PIPELINE](./HQ_VIDEO_PIPELINE.md) | High-quality video pipeline: resolution settings, format choices, stitch parameters |
| [VIDEO_PIPELINE](./VIDEO_PIPELINE.md) | General video pipeline overview: queue → generate → clean → catalog → publish flow |
| [PRDs/PRD_SORA_FULL_CONTROL](./PRDs/PRD_SORA_FULL_CONTROL.md) | Full Sora feature spec: every UI action, what's automated, what's not, selectors needed |
| [PRDs/PRD_Daily_Sora_Automation](./PRDs/PRD_Daily_Sora_Automation.md) | Daily automation schedule: when to generate, how many videos, what prompts, batch strategy |
| [PRDs/PRD_Sora_Full_Generation_Pipeline](./PRDs/PRD_Sora_Full_Generation_Pipeline.md) | End-to-end generation pipeline spec: prompt → generate → download → clean → register |
| [SORA_BROWSER_AUTOMATION_PRD](./SORA_BROWSER_AUTOMATION_PRD.md) | Browser-level automation spec for sora.com: login, prompt input, generation wait, download |
| [SORA_CHARACTERS_STYLES_PRD](./SORA_CHARACTERS_STYLES_PRD.md) | Character and style prompt library: visual personas, style templates for consistent video branding |

**Use this when you want to:**
- Run the full daily pipeline → `SORA_3PART_PIPELINE` then `scripts/sora-daily-pipeline.ts --help`
- Generate a specific video → `PRD_SORA_VIDEO_ORCHESTRATOR` → "Generation Flow"
- Fix watermark issues → `SORA_WATERMARK_REMOVAL`
- Add new prompt styles → `SORA_CHARACTERS_STYLES_PRD`
- Check test history → `SORA_TEST_RESULTS_FINAL`

---

### Upwork
> Port **3104**  
> Package: `packages/upwork-automation/`

| Doc | What it covers |
|---|---|
| [UPWORK_LINKEDIN_AUTOMATION](./UPWORK_LINKEDIN_AUTOMATION.md) | **Primary reference.** Full API (port 3104), job search with all filters, job detail extraction, scoring engine (0–100), smart connects recommendation, message flow, AI proposal generation, CAPTCHA handler, all new endpoints |
| [PRDs/PRD_UPWORK_AUTOMATION](./PRDs/PRD_UPWORK_AUTOMATION.md) | Full Upwork feature spec: search, apply, message, proposal generation — status per feature, remaining gaps |

**Use this when you want to:**
- Search jobs → `UPWORK_LINKEDIN_AUTOMATION` → "Job Search"
- Score and prioritize listings → `UPWORK_LINKEDIN_AUTOMATION` → "Scoring Engine"
- Generate an AI proposal → `UPWORK_LINKEDIN_AUTOMATION` → "AI Proposal Generation"
- Handle CAPTCHAs → `UPWORK_LINKEDIN_AUTOMATION` → "CAPTCHA Handler"

---

## Cross-Platform Systems

### DM Automation (all platforms)

| Doc | What it covers |
|---|---|
| [DM_API_REFERENCE](./DM_API_REFERENCE.md) | **Unified DM API reference.** Instagram (3100), TikTok (3102), Twitter (3003) — all send endpoints, response shapes, thread management, rate limits in one place |
| [PRDs/PRD_DM_Automation](./PRDs/PRD_DM_Automation.md) | Multi-platform DM automation spec: shared patterns, platform differences, common failure modes |
| [PRDs/PRD_DM_Outreach_System](./PRDs/PRD_DM_Outreach_System.md) | Full outreach system design: queue management, follow-up sequences, 3:1 value rule, template engine, CRM integration |
| [PRDs/PRD_DM_Playbook](./PRDs/PRD_DM_Playbook.md) | Messaging playbook: what to send, when, tone, lane/stage matrix, buying signal detection |

---

### CRM

| Doc | What it covers |
|---|---|
| [RELATIONSHIP_FIRST_CRM_FRAMEWORK](./RELATIONSHIP_FIRST_CRM_FRAMEWORK.md) | **Start here for CRM.** Philosophy, contact lifecycle, scoring model, lane/stage system, conversation health metrics |
| [CRM-SYNC-API](./CRM-SYNC-API.md) | CRM sync REST API: all endpoints for syncing DMs, scoring contacts, updating stages across platforms |
| [CRM-DEEP-SYNC](./CRM-DEEP-SYNC.md) | Deep sync implementation: reading full conversation history, scoring algorithm, contact record structure |
| [CRM-INBOX-SYNC](./CRM-INBOX-SYNC.md) | Inbox sync: real-time conversation scanning, unread detection, auto-logging new messages |
| [CRM_BRAIN_PIPELINE](./CRM_BRAIN_PIPELINE.md) | Brain pipeline: automated decision engine for next best action, response drafting, follow-up scheduling |
| [CRM_E2E_TEST_SUITE](./CRM_E2E_TEST_SUITE.md) | End-to-end CRM test suite: test scenarios, how to run, expected outcomes |
| [CRM_PROGRESS_SUMMARY](./CRM_PROGRESS_SUMMARY.md) | What's been built, what's pending, current issues, known gaps |

---

### Market Research & Creative Radar

| Doc | What it covers |
|---|---|
| [PRD_MARKET_RESEARCH_SCRAPER](./PRD_MARKET_RESEARCH_SCRAPER.md) | **Primary reference.** Unified Market Research API (port 3106): all 5 platforms (Twitter, Threads, Instagram, Facebook, TikTok), search endpoint, niche research, full pipeline, async jobs, result files |
| [CREATIVE_RADAR](./CREATIVE_RADAR.md) | OfferSpec-driven research engine: 4 offers (EverReach, SteadyLetters, VelvetHold, SnapMix), Facebook + Instagram + Ad Library scraping, pattern mining, brief generation |
| [PRDs/PRD_COMPETITOR_RESEARCH_ANALYTICS](./PRDs/PRD_COMPETITOR_RESEARCH_ANALYTICS.md) | Competitor analytics spec: engagement scoring, top creator ranking, niche comparison, trend tracking |

---

### Comment Automation

| Doc | What it covers |
|---|---|
| [COMMENT_AUTOMATION](./COMMENT_AUTOMATION.md) | Cross-platform comment automation overview: Instagram (3005), TikTok (3006), Twitter (3007), Threads (3004) — what each service supports, rate limits, AI comment generation |

---

### Scheduler & Task Queue

| Doc | What it covers |
|---|---|
| [PRD_Safari_Task_Scheduler](./PRD_Safari_Task_Scheduler.md) | **Scheduler reference.** Port 3010 — task types, one-time and recurring scheduling, Safari lock protocol, all API endpoints, builtin workers |
| [PRDs/PRD_Safari_Automation_Management](./PRDs/PRD_Safari_Automation_Management.md) | Management layer spec: service lifecycle, health monitoring, auto-restart, dashboard |

---

### Video Publishing Pipeline

| Doc | What it covers |
|---|---|
| [MEDIAPOSTER_INTEGRATION](./MEDIAPOSTER_INTEGRATION.md) | MediaPoster backend integration (port 5555): queue endpoint, process/batch, publish controls, Blotato → YouTube/TikTok/IG flow |
| [BLANKLOGO_INTEGRATION](./BLANKLOGO_INTEGRATION.md) | Blotato (formerly Blanklogo) integration: account setup, API usage, platform routing, submission ID tracking |
| [HQ_VIDEO_PIPELINE](./HQ_VIDEO_PIPELINE.md) | High-quality video pipeline from Sora generation to final publish |
| [VIDEO_PIPELINE](./VIDEO_PIPELINE.md) | General video pipeline overview |
| [youtube-shorts-publishing-guide](./youtube-shorts-publishing-guide.md) | YouTube Shorts publishing: format requirements, upload flow, account routing (Isaiah Dupree / lofi creator) |

---

## Infrastructure & System Docs

### Architecture

| Doc | What it covers |
|---|---|
| [SYSTEM_ARCHITECTURE](./SYSTEM_ARCHITECTURE.md) | **950-line complete system reference.** All 13 services, 7 platforms, 50+ endpoints, data locations, startup instructions, inter-service communication patterns |
| [03-architecture](./03-architecture.md) | Original architecture doc: SafariDriver base class, package structure, automation patterns |
| [SAFARI_AUTOMATIONS_INVENTORY](./SAFARI_AUTOMATIONS_INVENTORY.md) | **Quick inventory.** Every package, its port, what it can do, start command — best for "what service does X?" |
| [SAFARI_AUTOMATION_FILE_STRUCTURE](./SAFARI_AUTOMATION_FILE_STRUCTURE.md) | Directory layout: where every file lives, naming conventions, package boundaries |
| [SAFARI_AUTOMATION_API](./SAFARI_AUTOMATION_API.md) | Base API patterns: how all REST servers are structured, shared middleware, error formats |
| [SAFARI_AUTOMATION_SERVICE_API](./SAFARI_AUTOMATION_SERVICE_API.md) | Service-level API reference: gateway routing, lock protocol, health check format |
| [SAFARI_AUTOMATIONS](./SAFARI_AUTOMATIONS.md) | High-level overview of all automations, what each one does, dependencies |

### Safari Gateway & Session

| Doc | What it covers |
|---|---|
| [CLOUD_SAFARI_CONTROLLER](./CLOUD_SAFARI_CONTROLLER.md) | Safari Gateway (port 3000): exclusive browser lock, session health, request routing, all gateway endpoints |
| [PRD_SAFARI_SESSION_MANAGER](./PRD_SAFARI_SESSION_MANAGER.md) | Session manager spec: login detection per platform, session persistence, re-login flows |
| [PRDs/PRD_SAFARI_SESSION_MANAGER](./PRDs/PRD_SAFARI_SESSION_MANAGER.md) | Updated session manager PRD: multi-window support, tab tracking, recovery strategies |

### Setup & Configuration

| Doc | What it covers |
|---|---|
| [00-vision](./00-vision.md) | Project vision, goals, what the system is trying to accomplish |
| [01-compliance-and-safety](./01-compliance-and-safety.md) | Rate limits philosophy, ToS compliance, safety guardrails, what NOT to automate |
| [02-setup-safari-webdriver](./02-setup-safari-webdriver.md) | How to enable Safari WebDriver, Accessibility permissions, first-run checklist |
| [SAFARI_AUTOMATION_GUIDE](./SAFARI_AUTOMATION_GUIDE.md) | Quickstart guide: install, start all services, run first test |
| [SAFARI_BROWSER_AUTOMATION](./SAFARI_BROWSER_AUTOMATION.md) | Low-level Safari automation: AppleScript execution, JS injection, OS-level keystrokes, Quartz clicks |

### Testing & Observability

| Doc | What it covers |
|---|---|
| [SAFARI-AUTOMATION-TESTING-PLAYBOOK](./SAFARI-AUTOMATION-TESTING-PLAYBOOK.md) | Testing methodology: how to write integration tests, test patterns, when to use vitest vs tsx scripts |
| [05-test-strategy](./05-test-strategy.md) | Original test strategy: unit vs integration, mock boundaries, CI test gates |
| [07-observability](./07-observability.md) | Logging, metrics, error tracking, how to read service logs |
| [08-ci-cd](./08-ci-cd.md) | CI/CD pipeline: what runs on push, how to add a new service to CI |
| [SAFARI_AUTOMATION_SUCCESS_CRITERIA](./SAFARI_AUTOMATION_SUCCESS_CRITERIA.md) | Pass/fail definitions for every automated action per platform |

### Data & Storage

| Doc | What it covers |
|---|---|
| [06-data-model](./06-data-model.md) | Core data model: contact, conversation, message, lead score, outreach action schemas |
| [04-selector-system](./04-selector-system.md) | How selectors are organized, how to add new ones, fallback strategy |
| [SUPABASE_STORAGE](./SUPABASE_STORAGE.md) | Supabase table layouts, RLS policies, how automation data is stored in the cloud |
| [SAFARI_AUTOMATION_SUPABASE_STORAGE](./SAFARI_AUTOMATION_SUPABASE_STORAGE.md) | Extended Supabase reference: bucket structure, media uploads, video catalog sync |

---

## PRDs Directory (`docs/PRDs/`)

> PRDs describe **what should be built** and **current implementation status**. Reach for them when you need to know what's missing or what the intended behavior is.

| PRD | Scope |
|---|---|
| [PRD_FULL_SOCIAL_AUTOMATION_ROADMAP](./PRDs/PRD_FULL_SOCIAL_AUTOMATION_ROADMAP.md) | Master roadmap across all platforms — what's done, what's next, priority order |
| [AUTOMATION_GAPS_MASTER](./PRDs/AUTOMATION_GAPS_MASTER.md) | All known gaps across every platform — use this before building new features |
| [PRD_AI_AUDIT_COMPLETE](./PRDs/PRD_AI_AUDIT_COMPLETE.md) | AI integration audit: where GPT-4o is used, quality of outputs, what needs improvement |
| [PRD_UNIFIED_SOCIAL_AUTOMATION](./PRDs/PRD_UNIFIED_SOCIAL_AUTOMATION.md) | Cross-platform unification spec: shared interfaces, common data model, orchestration layer |
| [PRD_REMAINING_WORK](./PRDs/PRD_REMAINING_WORK.md) | Current sprint: what's left to build, dependencies, blockers |
| [PRD_INSTAGRAM_DM_FULL_CONTROL](./PRDs/PRD_INSTAGRAM_DM_FULL_CONTROL.md) | Instagram DM full spec |
| [PRD_TIKTOK_DM_FULL_CONTROL](./PRDs/PRD_TIKTOK_DM_FULL_CONTROL.md) | TikTok DM full spec |
| [PRD_TWITTER_DM_FULL_CONTROL](./PRDs/PRD_TWITTER_DM_FULL_CONTROL.md) | Twitter DM full spec |
| [PRD_TWITTER_POSTING_FULL_CONTROL](./PRDs/PRD_TWITTER_POSTING_FULL_CONTROL.md) | Twitter posting full spec |
| [PRD_LINKEDIN_DM_AUTOMATION](./PRDs/PRD_LINKEDIN_DM_AUTOMATION.md) | LinkedIn DM full spec |
| [PRD_THREADS_DM_AUTOMATION](./PRDs/PRD_THREADS_DM_AUTOMATION.md) | Threads DM spec |
| [PRD_FACEBOOK_MESSENGER_AUTOMATION](./PRDs/PRD_FACEBOOK_MESSENGER_AUTOMATION.md) | Facebook Messenger spec (not yet implemented) |
| [PRD_UPWORK_AUTOMATION](./PRDs/PRD_UPWORK_AUTOMATION.md) | Upwork full spec |
| [PRD_DM_Outreach_System](./PRDs/PRD_DM_Outreach_System.md) | Cross-platform outreach system spec |
| [PRD_DM_Playbook](./PRDs/PRD_DM_Playbook.md) | DM messaging playbook |
| [PRD_DM_Automation](./PRDs/PRD_DM_Automation.md) | DM automation patterns |
| [PRD_SORA_FULL_CONTROL](./PRDs/PRD_SORA_FULL_CONTROL.md) | Sora full feature spec |
| [PRD_SORA_VIDEO_ORCHESTRATOR](./PRDs/PRD_SORA_VIDEO_ORCHESTRATOR.md) | Sora orchestrator spec |
| [PRD_Daily_Sora_Automation](./PRDs/PRD_Daily_Sora_Automation.md) | Daily Sora schedule spec |
| [PRD_Sora_Full_Generation_Pipeline](./PRDs/PRD_Sora_Full_Generation_Pipeline.md) | Generation pipeline spec |
| [SORA_BROWSER_AUTOMATION_PRD](./PRDs/SORA_BROWSER_AUTOMATION_PRD.md) | Browser automation spec for Sora |
| [SORA_CHARACTERS_STYLES_PRD](./PRDs/SORA_CHARACTERS_STYLES_PRD.md) | Characters & styles prompt library spec |
| [PRD_COMPETITOR_RESEARCH_ANALYTICS](./PRDs/PRD_COMPETITOR_RESEARCH_ANALYTICS.md) | Competitor research spec |
| [PRD_SAFARI_SESSION_MANAGER](./PRDs/PRD_SAFARI_SESSION_MANAGER.md) | Session manager spec |
| [PRD_Safari_Automation_Management](./PRDs/PRD_Safari_Automation_Management.md) | Service management spec |
| [PRD_Safari_Automation_Success_Criteria](./PRDs/PRD_Safari_Automation_Success_Criteria.md) | Success criteria per platform |
| [PRD_Twitter_Video_Automation](./PRDs/PRD_Twitter_Video_Automation.md) | Twitter video posting spec |

---

## Selectors Directory (`docs/selectors/`)

> Go here when you need a CSS selector or JS snippet for a specific UI element. All verified against live production DOM.

| File | Platform | What it has |
|---|---|---|
| [INSTAGRAM_SELECTORS_REFERENCE](./selectors/INSTAGRAM_SELECTORS_REFERENCE.md) | Instagram | Conversations, messages, compose, send, profile nav, story |
| [TIKTOK_SELECTORS_REFERENCE](./selectors/TIKTOK_SELECTORS_REFERENCE.md) | TikTok | DM inbox, avatar positions, conversation header, compose, send |
| [TIKTOK_FULL_SELECTORS](./selectors/TIKTOK_FULL_SELECTORS.md) | TikTok | Extended: video page, comments, search, profile |
| [TWITTER_SELECTORS_REFERENCE](./selectors/TWITTER_SELECTORS_REFERENCE.md) | Twitter/X | `data-testid` attributes, DM compose, tweet article, engagement |
| [TWITTER_DOM_SELECTORS](./selectors/TWITTER_DOM_SELECTORS.md) | Twitter/X | Supplemental: JS snippets for login check, DraftJS typing, metrics |
| [THREADS_SELECTORS_REFERENCE](./selectors/THREADS_SELECTORS_REFERENCE.md) | Threads | Posts, comment input, reply, engagement, search |
| [SORA_SELECTORS_REFERENCE](./selectors/SORA_SELECTORS_REFERENCE.md) | Sora | Compose box, generate button, video grid, download, status |

---

## Numbered Foundation Docs (`docs/00–08`)

> Written first — foundational design decisions. Read in order when onboarding or re-architecting.

| # | Doc | Read for |
|---|---|---|
| 00 | [00-vision](./00-vision.md) | What this project is and why it exists |
| 01 | [01-compliance-and-safety](./01-compliance-and-safety.md) | Rate limits, ToS guardrails, what NOT to do |
| 02 | [02-setup-safari-webdriver](./02-setup-safari-webdriver.md) | Environment setup, permissions, first run |
| 03 | [03-architecture](./03-architecture.md) | SafariDriver base class, package layout, automation patterns |
| 04 | [04-selector-system](./04-selector-system.md) | How CSS selectors are organized and maintained |
| 05 | [05-test-strategy](./05-test-strategy.md) | Testing philosophy, unit vs integration, CI gates |
| 06 | [06-data-model](./06-data-model.md) | Core data schemas: contacts, conversations, scores |
| 07 | [07-observability](./07-observability.md) | Logging, metrics, error tracking |
| 08 | [08-ci-cd](./08-ci-cd.md) | CI/CD pipeline setup |

---

## All Service Ports at a Glance

| Port | Service | Package |
|---|---|---|
| 3000 | Safari Gateway | `packages/scheduler/` |
| 3003 | Twitter DM | `packages/twitter-dm/` |
| 3004 | Threads Comments | `packages/threads-comments/` |
| 3005 | Instagram Comments | `packages/instagram-comments/` |
| 3006 | TikTok Comments | `packages/tiktok-comments/` |
| 3007 | Twitter Comments + Research | `packages/twitter-comments/` |
| 3010 | Safari Task Scheduler | `packages/scheduler/` |
| 3100 | Instagram DM | `packages/instagram-dm/` |
| 3102 | TikTok DM | `packages/tiktok-dm/` |
| 3104 | Upwork Automation | `packages/upwork-automation/` |
| 3105 | LinkedIn Automation | `packages/linkedin-automation/` |
| 3106 | Market Research + Task Queue | `packages/market-research/` |
| 3107 | Medium Automation | `packages/medium-automation/` |
| 5555 | MediaPoster Backend | `MediaPoster/Backend/` |
