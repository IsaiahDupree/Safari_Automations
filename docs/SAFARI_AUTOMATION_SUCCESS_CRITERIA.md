# Safari Automation PRD Success Criteria

**Version:** 1.0  
**Date:** January 30, 2026  
**Status:** Reference Document  
**Purpose:** Verifiable success criteria for all Safari automation PRDs

---

## Overview

This document defines **testable success criteria** for all 14 Safari automation PRDs.
Each criterion includes:
- **Verification method** - How to test it
- **Anti-false-positive guard** - How to ensure test isn't lying
- **Required evidence** - What proves success

---

## PRD 1: Safari Session Manager (PRD_SAFARI_SESSION_MANAGER.md)

### SSM-001: Login Detection
| Criterion | Test Method | Anti-False-Positive |
|-----------|-------------|---------------------|
| Detect logged-in state for Twitter | Check for `SideNav_AccountSwitcher_Button` element | Must also verify element is interactable, not just present |
| Detect logged-in state for TikTok | Check for profile avatar element | Element must have valid src attribute |
| Detect logged-in state for Instagram | Check for home navigation element | Must verify URL is not login page |
| Detect logged-in state for Sora | Check for textarea presence | Must verify no "Sign in" text on page |

### SSM-002: Session Refresh
| Criterion | Test Method | Anti-False-Positive |
|-----------|-------------|---------------------|
| Refresh keeps session alive | Refresh, then verify still logged in | Must wait >5s after refresh before checking |
| Refresh interval tracking | Check last_refresh timestamp updates | Timestamp must be within 60s of current time |

### SSM-003: Health Status API
| Criterion | Test Method | Anti-False-Positive |
|-----------|-------------|---------------------|
| `/api/safari/sessions` returns valid data | Call endpoint, verify response schema | Must contain `platforms` dict with status per platform |
| Health status reflects actual state | Compare API response to manual check | Run both checks within 10s of each other |

### Success Metrics
| Metric | Target | Verification |
|--------|--------|--------------|
| Session uptime | > 99% | Track login checks over 24h, calculate percentage |
| Time to detect expired session | < 5 min | Force logout, measure detection time |
| Dashboard load time | < 1 sec | Measure from request to rendered content |

---

## PRD 2: Safari Automation Management (PRD_Safari_Automation_Management.md)

### SAFARI-001: Browser Queue Manager
| Criterion | Test Method | Anti-False-Positive |
|-----------|-------------|---------------------|
| Only one Safari operation at a time | Queue 3 tasks, verify sequential execution | Log timestamps must show no overlap |
| Queue state persists across restarts | Queue tasks, restart, verify queue preserved | Must verify task IDs match before/after |
| Failed tasks retry with backoff | Force failure, verify retry with increasing delay | Delay must increase (not constant) |

### SAFARI-002: Comment Engine
| Criterion | Test Method | Anti-False-Positive |
|-----------|-------------|---------------------|
| 30 comments/hour capacity | Run for 1 hour, count successful comments | Must verify comments actually posted (fetch post) |
| Distributes across platforms | Check comment counts per platform | No platform should have >40% of comments |
| Rate limits respected | Monitor for rate limit errors | Should see 0 rate limit errors |

### SAFARI-003: Sora Generation Pipeline
| Criterion | Test Method | Anti-False-Positive |
|-----------|-------------|---------------------|
| Poll Sora for completion | Generate video, verify polling occurs | Must see >1 poll requests in logs |
| Download completed videos | Check download directory after generation | File must have valid video header (not error page) |
| Trigger post-processing | Verify watermark removal triggers | Must see processing start within 60s of download |

### Success Metrics
| Metric | Target | Verification |
|--------|--------|--------------|
| Comments posted/day | 720 | Count from database |
| Twitter posts/day | 12 | Count from database |
| Sora videos generated/day | 30 | Count from Sora usage API |
| Safari conflicts/day | 0 | Count overlapping operations in logs |
| Queue processing uptime | 99%+ | Track orchestrator uptime |

---

## PRD 3: Sora Browser Automation (SORA_BROWSER_AUTOMATION_PRD.md)

### SORA-001: Navigation
| Criterion | Test Method | Anti-False-Positive |
|-----------|-------------|---------------------|
| Navigate to sora.chatgpt.com | Open URL, verify URL matches | Must check actual URL, not just navigation success |
| Detect login state | Check for textarea element | Must also check for absence of login button |

### SORA-002: Prompt Submission
| Criterion | Test Method | Anti-False-Positive |
|-----------|-------------|---------------------|
| Find and fill textarea | Set prompt text, read it back | Read value must match set value |
| Submit with @character | Include @isaiahdupree, verify accepted | Character must appear in generation |

### SORA-003: Video Download
| Criterion | Test Method | Anti-False-Positive |
|-----------|-------------|---------------------|
| Download generated video | Save to disk, verify file | File size must be >100KB |
| Remove watermark | Process through BlankLogo | Output must differ from input |

### Success Metrics
| Metric | Target | Verification |
|--------|--------|--------------|
| Video generation success | >90% | Count successful/total |
| Download success | >95% | Count downloaded/generated |
| Watermark removal quality | >95% | Manual sample check |
| Total pipeline time | <10 min | Measure end-to-end |

---

## PRD 4: Sora Full Control (PRD_SORA_FULL_CONTROL.md)

### SORA-FC-001: Navigation Control
| Criterion | Test Method | Anti-False-Positive |
|-----------|-------------|---------------------|
| Navigate to /explore | Set URL, verify pathname | `window.location.pathname === '/explore'` |
| Navigate to /drafts | Set URL, verify pathname | `window.location.pathname === '/drafts'` |
| Navigate to /activity | Set URL, verify pathname | `window.location.pathname === '/activity'` |

### SORA-FC-002: Prompt Input
| Criterion | Test Method | Anti-False-Positive |
|-----------|-------------|---------------------|
| Find textarea | Query selector returns element | Element must be visible (not hidden) |
| Set prompt text | Set value, trigger input event | Read back must match set value |
| Type @character | Include in prompt | Character dropdown must appear |

### SORA-FC-003: Video Generation
| Criterion | Test Method | Anti-False-Positive |
|-----------|-------------|---------------------|
| Click "Create video" button | Find and click button | Must verify navigation/state change |
| Detect generation started | Check URL change or loading state | New generation ID in URL |

### SORA-FC-004: Usage Tracking (CRITICAL - Currently Broken)
| Criterion | Test Method | Anti-False-Positive |
|-----------|-------------|---------------------|
| Extract "X video gens left" | Parse usage dialog | Value must be integer > 0 |
| Extract "X free" count | Parse usage dialog | Must match Sora's actual free count |
| Extract reset date | Parse usage dialog | Date must be valid future date |

### Success Metrics
| Metric | Target | Verification |
|--------|--------|--------------|
| Navigation success rate | 100% | All pages must load |
| Prompt submission rate | >95% | Most prompts accepted |
| Usage extraction accuracy | 100% | Must match Sora's actual values |

---

## PRD 5: Sora Full Generation Pipeline (PRD_Sora_Full_Generation_Pipeline.md)

### SORA-PIPE-001: End-to-End Generation
| Criterion | Test Method | Anti-False-Positive |
|-----------|-------------|---------------------|
| Enter prompt with @isaiahdupree | Submit prompt, verify character | Prompt must contain "@isaiahdupree" |
| Select duration (10s/15s/25s) | Set duration, verify selection | Generation must be requested duration |
| Select aspect ratio | Set ratio, verify selection | Output video must match ratio |
| Poll /drafts for completion | Count drafts before/after | Count must increase by 1 |
| Download new video | Save file to disk | File must be valid MP4 |

### Success Metrics
| Metric | Target | Verification |
|--------|--------|--------------|
| Full pipeline success | >80% | End-to-end test runs |
| No manual intervention needed | 100% | Fully automated run |

---

## PRD 6: Sora Video Orchestrator (PRD_SORA_VIDEO_ORCHESTRATOR.md)

### SORA-ORCH-001: Provider Adapters
| Criterion | Test Method | Anti-False-Positive |
|-----------|-------------|---------------------|
| Sora adapter creates clips | Call create_clip, get generation | Generation ID must be valid UUID |
| Mock adapter for testing | Call mock create_clip | Must return deterministic output |
| Provider failover | Force Sora failure, verify fallback | Different provider used on retry |

### SORA-ORCH-002: Director Service
| Criterion | Test Method | Anti-False-Positive |
|-----------|-------------|---------------------|
| Script to clip plan | Input script, get plan | Plan must have >0 clips |
| Pacing rules respected | Check clip word counts | ~150 wpm average |

### SORA-ORCH-003: Assessment
| Criterion | Test Method | Anti-False-Positive |
|-----------|-------------|---------------------|
| Transcript match check | Compare expected vs actual | Similarity score must be calculated |
| Visual requirements check | Frame analysis | Analysis must return structured data |
| Pass/fail determination | Run full assessment | Must return boolean + reasons |

### Success Metrics
| Metric | Target | Verification |
|--------|--------|--------------|
| Clip pass rate (first attempt) | >70% | Assessment results |
| Average retry count per clip | <2 | Count retries/clips |
| Time to generate 60s video | <15 min | Measure end-to-end |

---

## PRD 7: Sora Characters & Styles (SORA_CHARACTERS_STYLES_PRD.md)

### SORA-CHAR-001: Style Presets
| Criterion | Test Method | Anti-False-Positive |
|-----------|-------------|---------------------|
| Apply style to prompt | Add style keywords | Keywords must appear in final prompt |
| Style affects generation | Generate with/without style | Outputs must be visually different |

### SORA-CHAR-002: Camera Motions
| Criterion | Test Method | Anti-False-Positive |
|-----------|-------------|---------------------|
| Apply camera motion | Add motion keywords | Keywords must appear in prompt |
| Motion visible in output | Manual inspection | Movement must be detectable |

### SORA-CHAR-003: Character System
| Criterion | Test Method | Anti-False-Positive |
|-----------|-------------|---------------------|
| Create character | POST to /api/ai-video/characters | Response must include character ID |
| Character in prompt | Use character, check prompt | Character description included |
| Character consistency | Generate multiple videos | Same character recognizable |

### Success Metrics
| Metric | Target | Verification |
|--------|--------|--------------|
| Style preset adoption | >50% of generations | Count styled vs unstyled |
| Character reuse rate | >3 uses per character | Count uses per character |

---

## PRD 8: Daily Sora Automation (PRD_Daily_Sora_Automation.md)

### SORA-AUTO-001: Daily Usage
| Criterion | Test Method | Anti-False-Positive |
|-----------|-------------|---------------------|
| Use all 30 daily credits | Count generations at day end | Must reach 30 (or close with retries) |
| Rate limit to 3 concurrent | Check max concurrent at any time | Never >3 generating simultaneously |

### SORA-AUTO-002: BlankLogo Integration
| Criterion | Test Method | Anti-False-Positive |
|-----------|-------------|---------------------|
| Auto-process downloads | Drop video in folder, verify processing | Processing must start within 60s |
| Watermark removed | Compare before/after | Hash must differ |
| Quality preserved | Check output resolution | Must match or exceed input |

### SORA-AUTO-003: YouTube Publishing
| Criterion | Test Method | Anti-False-Positive |
|-----------|-------------|---------------------|
| Publish to YouTube | Upload video, get URL | URL must be valid YouTube watch URL |
| Metadata generated | Check title/description | Must not be empty |

### Success Metrics
| Metric | Target | Verification |
|--------|--------|--------------|
| Daily Sora usage | 30/30 (100%) | Count from Sora API |
| Watermark removal success | 95%+ | Count successful/total |
| YouTube publish success | 98%+ | Count published/processed |
| 3-Part movie completion | 4/day | Count stitched movies |

---

## PRD 9: Twitter Posting Full Control (PRD_TWITTER_POSTING_FULL_CONTROL.md)

### TWIT-001: Navigation
| Criterion | Test Method | Anti-False-Positive |
|-----------|-------------|---------------------|
| Navigate to x.com/home | Open URL, verify | Must see timeline content |
| Navigate to /compose/tweet | Open URL, verify | Must see compose modal |

### TWIT-002: Authentication
| Criterion | Test Method | Anti-False-Positive |
|-----------|-------------|---------------------|
| Detect logged in | Check for account switcher | Element must be clickable |
| Handle encryption code | Prompt when needed | Code 7911 must work |

### TWIT-003: Tweet Composition
| Criterion | Test Method | Anti-False-Positive |
|-----------|-------------|---------------------|
| Find tweet input | Query DraftJS editor | Element must be contenteditable |
| Type tweet text | Insert text, read back | Text must match |
| Post tweet | Click post button | Tweet must appear in timeline |

### TWIT-004: Media Upload
| Criterion | Test Method | Anti-False-Positive |
|-----------|-------------|---------------------|
| Attach image | Select file, verify preview | Image preview must appear |
| Attach video | Select file, verify | Video must process |

### Success Metrics
| Metric | Target | Verification |
|--------|--------|--------------|
| Post success rate | >95% | Count successful/attempted |
| Average post time | <30 sec | Measure from start to confirmation |
| Session persistence | 7+ days | Track days without re-login |

---

## PRD 10: Twitter Video Automation (PRD_Twitter_Video_Automation.md)

### TWIT-VID-001: Session Management
| Criterion | Test Method | Anti-False-Positive |
|-----------|-------------|---------------------|
| Session persists across restarts | Restart app, check session | Must not require re-login |
| Multi-account support | Switch accounts, verify | Different account shown |

### TWIT-VID-002: Video Upload
| Criterion | Test Method | Anti-False-Positive |
|-----------|-------------|---------------------|
| Upload video | Select video file | Progress indicator appears |
| Size validation | Try >512MB file | Error message shown |
| Duration validation | Try >2:20 video | Error message shown |

### Success Metrics
| Metric | Target | Verification |
|--------|--------|--------------|
| Post success rate | >95% | Count from logs |
| Average post time | <30 sec | Timing measurements |
| Error recovery | 80% auto-recovery | Count recovered/failed |

---

## PRD 11: Instagram DM Full Control (PRD_INSTAGRAM_DM_FULL_CONTROL.md)

### IG-DM-001: Navigation
| Criterion | Test Method | Anti-False-Positive |
|-----------|-------------|---------------------|
| Navigate to /direct/inbox/ | Open URL, verify | Must see inbox UI |
| Navigate to conversation | Click thread, verify | Messages must load |

### IG-DM-002: Message Operations
| Criterion | Test Method | Anti-False-Positive |
|-----------|-------------|---------------------|
| Find message input | Query textarea | Must be visible and enabled |
| Send message | Type and send | Message appears in thread |
| Read messages | Load conversation | Messages array not empty |

### IG-DM-003: Rate Limiting
| Criterion | Test Method | Anti-False-Positive |
|-----------|-------------|---------------------|
| Detect rate limit | Check for warning text | Text must match known patterns |
| Implement delays | Time between DMs | Always >60 seconds |
| Daily limit enforced | Count daily DMs | Never exceed 100 |

### Success Metrics
| Metric | Target | Verification |
|--------|--------|--------------|
| Message send success | >90% | Count from logs |
| Rate limit errors | 0 | Monitor for 24h |

---

## PRD 12: DM Automation (PRD_DM_Automation.md)

### DM-AUTO-001: Relationship Health Score
| Criterion | Test Method | Anti-False-Positive |
|-----------|-------------|---------------------|
| Score calculated | Get contact score | Score must be 0-100 integer |
| Factors weighted correctly | Check factor contributions | Weights must sum to 100% |

### DM-AUTO-002: Pipeline Stages
| Criterion | Test Method | Anti-False-Positive |
|-----------|-------------|---------------------|
| Stage transitions logged | Check dm_conversations | Stage changes recorded |
| 3:1 rule enforced | Count touch types | Non-offer >= 3x offer touches |

### DM-AUTO-003: Context Cards
| Criterion | Test Method | Anti-False-Positive |
|-----------|-------------|---------------------|
| Context stored | Create/read context | All fields persisted |
| Context used in AI | Generate reply with context | Reply references context |

### Success Metrics
| Metric | Target | Verification |
|--------|--------|--------------|
| Meaningful replies/week | >20 | Count non-"lol" replies |
| Contacts with context cards | >80% | Count cards/contacts |
| Micro-wins delivered/month | >30 | Count value_delivered |

---

## PRD 13: DM Outreach System (PRD_DM_Outreach_System.md)

### DM-OUT-001: Prospect Discovery
| Criterion | Test Method | Anti-False-Positive |
|-----------|-------------|---------------------|
| Find from comments | Scrape commenters | Must return >0 prospects |
| Find from followers | Analyze followers | Must return >0 prospects |
| Fit score calculated | Check prospect scores | Score must be 0-100 |

### DM-OUT-002: List Management
| Criterion | Test Method | Anti-False-Positive |
|-----------|-------------|---------------------|
| Add to list | POST prospect | Prospect appears in list |
| Status tracking | Update status | Status change reflected |
| Phase progression | Advance phase | Phase must follow sequence |

### DM-OUT-003: Offer Matching
| Criterion | Test Method | Anti-False-Positive |
|-----------|-------------|---------------------|
| Match prospect to offer | Get offer_match | Must be valid offer ID |
| Fit signals detected | Check signals | Must match offer config |

### Success Metrics
| Metric | Target | Verification |
|--------|--------|--------------|
| Response rate | 30%+ | Count replies/sent |
| Conversation to offer rate | 10%+ | Count offers/conversations |
| Monthly new prospects | 500+ | Count discovered |

---

## PRD 14: DM Playbook (PRD_DM_Playbook.md)

### DM-PLAY-001: Template Library
| Criterion | Test Method | Anti-False-Positive |
|-----------|-------------|---------------------|
| Templates by lane | Get templates for lane | Must return >0 templates |
| Templates by stage | Get templates for stage | Must return >0 templates |

### DM-PLAY-002: 3:1 Rule Enforcement
| Criterion | Test Method | Anti-False-Positive |
|-----------|-------------|---------------------|
| Track touch types | Log all touches | Types must be categorized |
| Block premature offers | Try offer before 3 non-offers | Must be blocked/warned |

### DM-PLAY-003: Relationship Score Integration
| Criterion | Test Method | Anti-False-Positive |
|-----------|-------------|---------------------|
| Score influences actions | Check suggested actions | Lower scores get different actions |
| Score updates on interaction | Log interaction, check score | Score must change appropriately |

### Success Metrics
| Metric | Target | Verification |
|--------|--------|--------------|
| Micro-wins per week | 10 | Count value deliveries |
| Permissioned offers | Only with fit signals | Count with/without signals |

---

## Test Anti-False-Positive Principles

### 1. State Verification
- Always verify state BEFORE and AFTER operations
- Compare timestamps to ensure operations actually occurred
- Check for both positive AND negative indicators

### 2. Multi-Signal Confirmation
- Never rely on single element presence
- Check URL + DOM + visible content together
- Verify interactability, not just existence

### 3. Temporal Guards
- Add realistic delays between operations
- Verify timing constraints (min/max durations)
- Check that timestamps advance appropriately

### 4. Output Validation
- Verify files have valid headers/content
- Check API responses against schema
- Compare output to known-good samples

### 5. Failure Injection
- Test failure cases explicitly
- Verify error handling works
- Confirm retries happen with backoff

---

## Test Execution

Run all tests:
```bash
python Backend/tests/test_safari_automation_prd.py
```

Run specific PRD tests:
```bash
python Backend/tests/test_safari_automation_prd.py --prd=sora_session_manager
python Backend/tests/test_safari_automation_prd.py --prd=sora_full_control
```

Generate test report:
```bash
python Backend/tests/test_safari_automation_prd.py --report
```

---

**Document Owner:** Engineering Team  
**Last Updated:** January 30, 2026
