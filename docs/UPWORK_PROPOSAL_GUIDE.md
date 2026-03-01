# Upwork Proposal Submission — Complete Guide

**Version:** 2.1.0  
**Updated:** February 28, 2026  
**Status:** Production (battle-tested, dry-run verified for fixed-price + hourly + file attachments)

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [API Reference](#api-reference)
3. [Form Fields & Selectors](#form-fields--selectors)
4. [Fixed-Price vs Hourly](#fixed-price-vs-hourly)
5. [File Attachments](#file-attachments)
6. [Dry-Run Workflow](#dry-run-workflow)
7. [Repeatable Submission Workflow](#repeatable-submission-workflow)
8. [Troubleshooting](#troubleshooting)
9. [Architecture & Internals](#architecture--internals)

---

## Quick Start

```bash
# 1. Start the Upwork automation server
PORT=3104 npx tsx packages/upwork-automation/src/api/server.ts

# 2. Verify status (Safari must be logged into Upwork)
curl http://localhost:3104/api/upwork/status

# 3. Dry-run a fixed-price proposal
curl -X POST http://localhost:3104/api/upwork/proposals/submit \
  -H "Content-Type: application/json" \
  -d '{
    "jobUrl": "https://www.upwork.com/jobs/~021234567890",
    "coverLetter": "Your cover letter text here...",
    "fixedPrice": 1200,
    "milestoneDescription": "Complete project deliverables",
    "projectDuration": "Less than 1 month",
    "paymentMode": "milestone",
    "dryRun": true
  }'

# 4. If dry-run succeeds, submit for real
# Change "dryRun": false
```

---

## API Reference

### `POST /api/upwork/proposals/submit`

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `jobUrl` | string | **Yes** | Full Upwork job URL |
| `coverLetter` | string | **Yes** | Proposal text (min ~100 chars recommended) |
| `hourlyRate` | number | Hourly jobs | e.g. `75` for $75/hr (min $3) |
| `fixedPrice` | number | Fixed jobs | e.g. `1200` for $1200 (min $5) |
| `milestoneDescription` | string | No | Milestone description (default: "Complete project deliverables per requirements") |
| `projectDuration` | string | No | Duration (default: "Less than 1 month") |
| `paymentMode` | string | No | `"milestone"` (default) or `"project"` |
| `screeningAnswers` | string[] | No | Answers to screening questions, in order |
| `attachments` | string[] | No | Absolute file paths (max 10, max 25MB each) |
| `boostConnects` | number | No | Extra connects for boosting (0 = no boost, leave unset for default) |
| `dryRun` | boolean | No | `true` (default) = fill form only, `false` = actually submit |

**Response:**

```json
{
  "success": true,
  "submitted": true,
  "jobTitle": "Full-Stack Developer — AI Job Hunting SaaS",
  "connectsCost": 16,
  "bidAmount": "$1200 fixed",
  "coverLetterLength": 1121,
  "questionsAnswered": 0,
  "filesAttached": 2,
  "formType": "fixed",
  "dryRun": false
}
```

### `POST /api/upwork/proposals/generate`

AI-generated cover letter using GPT-4o.

```bash
curl -X POST http://localhost:3104/api/upwork/proposals/generate \
  -H "Content-Type: application/json" \
  -d '{
    "job": { "title": "...", "fullDescription": "...", "skills": ["TypeScript"] },
    "highlightSkills": ["TypeScript", "Safari automation"],
    "customInstructions": "Mention my Supabase experience"
  }'
```

**Response:**
```json
{
  "coverLetter": "Generated cover letter text...",
  "suggestedQuestions": ["What is the timeline?"],
  "confidence": 0.85
}
```

---

## Form Fields & Selectors

### Fixed-Price Proposal Form

| Section | Selector | Input Type | Notes |
|---------|----------|------------|-------|
| Payment mode | `input[name="milestoneMode"]` | Radio | `milestone` or `default` (project) |
| Milestone description | `.milestone-description` | Text input | Only in milestone mode |
| Milestone due date | Text input (index 4) | Text input | Optional — no validation error if empty |
| Milestone amount | `#milestone-amount-1` | Currency input | Uses OS-level keystroke typing |
| Project duration | `div.air3-dropdown-toggle[role="combobox"]` | Dropdown | Options below |
| Cover letter | First `<textarea>` | Textarea | Uses React native setter |
| Screening questions | Subsequent `<textarea>`s | Textarea | In order |
| File attachments | `input[type="file"]` | File input | macOS file dialog |
| Boost connects | `input[type="number"]` | Number input | Leave untouched for default |
| Submit button | `button.air3-btn-primary` | Button | Text: "Send for N Connects" |

### Hourly Proposal Form

| Section | Selector | Input Type | Notes |
|---------|----------|------------|-------|
| Hourly rate | `#step-rate` | Currency input | Uses OS-level keystroke typing (digit-by-digit) |
| Rate-increase frequency | `div.air3-dropdown-toggle[role="combobox"]` | Dropdown | Auto-set to "Never" to dismiss validation |
| Cover letter | First `<textarea>` | Textarea | Uses React native setter |
| Screening questions | Subsequent `<textarea>`s | Textarea | In order |
| File attachments | `input[type="file"]` | File input | macOS file dialog |
| Boost connects | `input[type="number"]` | Number input | Cleared to 0 via React native setter |
| Set bid button | `button` text="Set bid" | Button | Must click to confirm boost amount |
| Submit button | `button.air3-btn-primary` | Button | Text: "Send for N Connects" |

### Duration Dropdown Options

These are the **exact** option strings in Upwork's duration dropdown:

| Option Text | Use When |
|-------------|----------|
| `Less than 1 month` | Quick projects, single deliverable |
| `1 to 3 months` | Medium-term contracts |
| `3 to 6 months` | Longer engagements |
| `More than 6 months` | Ongoing / large projects |

> **Important:** Use the exact text above. The matching is case-insensitive and fuzzy, but "Less than 1 month" ≠ "Less than a month".

---

## Fixed-Price vs Hourly

The form auto-detects the job type from the page content. Here's how each is handled:

### Fixed-Price Flow
1. Navigate to job → expand truncated description (`expandJobDescription()`)
2. Click "Apply now" → expand description on proposal form
3. Detect `fixed` form type (checks for "How do you want to be paid?" text)
4. Select payment mode radio (`milestone` recommended — has explicit fields)
5. Fill milestone description (only in milestone mode)
6. Set milestone amount via OS-level keystroke typing on `#milestone-amount-1`
7. Select project duration from dropdown
8. Fill cover letter via React native setter
9. Answer screening questions
10. Attach files (optional)
11. Set boost connects to 0 → click "Set bid" to confirm
12. Scroll to bottom, check for errors (visible errors only)
13. Submit or dry-run

### Hourly Flow
1. Detect `hourly` form type (checks for "Your rate" or "Hourly Rate" text)
2. Set hourly rate via OS-level keystroke typing on `#step-rate`
3. Set rate-increase frequency to "Never" (dismisses validation error)
4. Fill cover letter via React native setter
5. Answer screening questions
6. Attach files (optional)
7. Set boost connects to 0 → click "Set bid" to confirm
8. Scroll to bottom, check for errors (visible errors only)
9. Submit or dry-run

### Why "milestone" mode is recommended for fixed-price
- **"By milestone" mode** has explicit, writable input fields (description + amount)
- **"By project" mode** shows computed summary fields (`#charged-amount-id`) that often reject programmatic input
- The milestone amount directly computes the total price, service fee, and "You'll receive"

---

## File Attachments

### How it works
File upload uses macOS native file dialog automation:
1. JavaScript clicks `input[type="file"]` to open the file picker
2. `Cmd+Shift+G` opens "Go to folder" path entry
3. Types the absolute file path character by character
4. `Enter` to navigate → `Enter` to select the file

### Supported file types
Upwork accepts: PDF, DOC, DOCX, TXT, JPG, PNG, GIF, ZIP, and more.

### Limits
- **Max 10 files** per proposal
- **Max 25MB** per file
- Files are validated (existence + size) before upload attempt

### Example with attachments

```bash
curl -X POST http://localhost:3104/api/upwork/proposals/submit \
  -H "Content-Type: application/json" \
  -d '{
    "jobUrl": "https://www.upwork.com/jobs/~021234567890",
    "coverLetter": "Please see the attached portfolio...",
    "fixedPrice": 2000,
    "milestoneDescription": "Phase 1: Design + backend",
    "projectDuration": "1 to 3 months",
    "attachments": [
      "/Users/isaiahdupree/Documents/portfolio.pdf",
      "/Users/isaiahdupree/Documents/case-study.pdf"
    ],
    "dryRun": true
  }'
```

### File upload caveats
- **Safari must be the frontmost app** — the file dialog is OS-level
- **Don't interact with the computer** during upload — AppleScript keystrokes go to the active window
- **Absolute paths only** — relative paths won't work with the file dialog
- If file dialog fails, the upload is skipped (non-fatal) and logged

---

## Dry-Run Workflow

**Always dry-run first.** The default `dryRun` is `true` for safety.

```bash
# Step 1: Dry-run
curl -X POST http://localhost:3104/api/upwork/proposals/submit \
  -H "Content-Type: application/json" \
  -d '{...all fields..., "dryRun": true}'

# Step 2: Check response
# Look for: success=true, formType correct, connectsCost accurate, no errors

# Step 3: Visually inspect Safari
# The form should be filled with all your data. Check it looks right.

# Step 4: Real submit
curl -X POST http://localhost:3104/api/upwork/proposals/submit \
  -H "Content-Type: application/json" \
  -d '{...same fields..., "dryRun": false}'
```

### What dry-run does
- Navigates to job page
- Clicks "Apply now"
- Fills ALL form fields (rate, cover letter, questions, duration, milestones)
- Attaches files
- Scrolls to bottom
- Reads submit button text and form errors
- **Does NOT click submit**

### What real submit does
- Everything above, PLUS:
- Clicks the "Send for N Connects" button
- Waits 5 seconds
- Verifies submission by checking URL change and page content
- Returns success/failure with verification details

---

## Repeatable Submission Workflow

### Full end-to-end flow

```bash
# ── 1. Search for jobs ──
curl -X POST http://localhost:3104/api/upwork/jobs/search \
  -H "Content-Type: application/json" \
  -d '{"keywords": ["TypeScript", "automation", "Supabase"], "postedWithin": "3d", "sortBy": "newest"}'

# ── 2. Get job details ──
curl "http://localhost:3104/api/upwork/jobs/detail?url=https://www.upwork.com/jobs/~021234567890"

# ── 3. Score the job ──
curl -X POST http://localhost:3104/api/upwork/jobs/score \
  -H "Content-Type: application/json" \
  -d '{"job": {...jobDetail...}, "preferredSkills": ["TypeScript", "Node.js"], "minBudget": 500}'

# ── 4. Generate AI cover letter ──
curl -X POST http://localhost:3104/api/upwork/proposals/generate \
  -H "Content-Type: application/json" \
  -d '{"job": {...jobDetail...}, "highlightSkills": ["TypeScript", "Safari automation"]}'

# ── 5. Dry-run proposal ──
curl -X POST http://localhost:3104/api/upwork/proposals/submit \
  -H "Content-Type: application/json" \
  -d '{
    "jobUrl": "https://www.upwork.com/jobs/~021234567890",
    "coverLetter": "...generated cover letter...",
    "fixedPrice": 1200,
    "milestoneDescription": "Complete all deliverables",
    "projectDuration": "Less than 1 month",
    "dryRun": true
  }'

# ── 6. Visual check in Safari ──
# Verify form looks correct

# ── 7. Real submit ──
# Change dryRun to false and re-send
```

### Batch application script (example)

```bash
#!/bin/bash
# Apply to top-scored jobs with AI-generated proposals
JOBS=$(curl -s http://localhost:3104/api/upwork/jobs/search \
  -H "Content-Type: application/json" \
  -d '{"keywords": ["TypeScript"], "postedWithin": "24h"}')

for JOB_URL in $(echo $JOBS | jq -r '.jobs[].url'); do
  DETAIL=$(curl -s "http://localhost:3104/api/upwork/jobs/detail?url=$JOB_URL")
  SCORE=$(curl -s -X POST http://localhost:3104/api/upwork/jobs/score \
    -H "Content-Type: application/json" \
    -d "{\"job\": $DETAIL}")
  
  REC=$(echo $SCORE | jq -r '.recommendation')
  if [ "$REC" = "apply" ]; then
    PROPOSAL=$(curl -s -X POST http://localhost:3104/api/upwork/proposals/generate \
      -H "Content-Type: application/json" \
      -d "{\"job\": $DETAIL}")
    
    COVER=$(echo $PROPOSAL | jq -r '.coverLetter')
    # Always dry-run first in batch mode
    curl -s -X POST http://localhost:3104/api/upwork/proposals/submit \
      -H "Content-Type: application/json" \
      -d "{\"jobUrl\": \"$JOB_URL\", \"coverLetter\": \"$COVER\", \"dryRun\": true}"
    
    sleep 5  # Rate limit
  fi
done
```

---

## Troubleshooting

### Problem: Form type detected as "unknown"

**Cause:** The proposal page didn't load properly, or CAPTCHA blocked it.

**Fix:**
1. Check if Safari shows a Cloudflare "Just a moment" page
2. The CAPTCHA handler runs automatically, but may need manual intervention
3. Re-run — the handler has retries built in
4. If persistent, manually solve the CAPTCHA in Safari, then re-run

### Problem: Milestone amount shows negative value (-$1,200.00)

**Cause:** Previous failed attempt left stale state in the form.

**Fix:**
1. Navigate away from the proposal page (go to Find Work)
2. Navigate back to the job and click "Apply now" again
3. The form resets with clean state
4. Re-run the dry-run

### Problem: "Please enter a value between $5.00 and $1,000,000.00"

**Cause:** Currency input didn't receive the value properly.

**Fix:**
1. Use `paymentMode: "milestone"` (default) — has explicit writable fields
2. Avoid `paymentMode: "project"` — its computed fields resist programmatic input
3. Ensure `fixedPrice` is a positive number ≥ 5
4. If still failing, the keystroke typing may have been interrupted — ensure Safari is frontmost

### Problem: Duration dropdown selects wrong option

**Cause:** Option text mismatch.

**Fix:** Use exact Upwork option text:
- ✅ `"Less than 1 month"` (correct)
- ❌ `"Less than a month"` (wrong — "a" ≠ "1")
- ✅ `"1 to 3 months"`, `"3 to 6 months"`, `"More than 6 months"`

### Problem: "Select 'Set bid' to enter your Connects"

**Cause:** (Old behavior) The boost connects input was touched without clicking "Set bid".

**Fix:** Now handled automatically — the automation:
1. Clears the boost input to 0 (or your desired value) via React native setter
2. Clicks the "Set bid" button to confirm
3. This dismisses the validation warning

If you want to boost, set `boostConnects` to a positive value (e.g., 16).

### Problem: "Enter a rate-increase frequency" (hourly only)

**Cause:** Upwork's hourly form has optional rate-increase scheduling dropdowns that show errors when the form is scrolled.

**Fix:** Now handled automatically — the automation selects "Never" from the frequency dropdown. The error message in the DOM becomes hidden (invisible) and does not block submission.

### Problem: Cover letter not filling

**Cause:** React-controlled textarea rejects `el.value = "..."`.

**Fix:** Already handled — uses `Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set` with `input` + `change` events. If still failing:
1. Check the textarea exists: open Safari Web Inspector, find `<textarea>`
2. The cover letter targets the FIRST textarea on the page (index 0)

### Problem: File attachment fails

**Cause:** macOS file dialog automation is fragile.

**Fix:**
1. Ensure Safari is the frontmost app and in focus
2. Don't touch mouse/keyboard during upload
3. Use **absolute paths** (e.g., `/Users/isaiahdupree/Documents/file.pdf`)
4. Check file exists and is < 25MB
5. If `Cmd+Shift+G` dialog doesn't open, try increasing the wait time in `uploadFile()`
6. As a manual fallback: after dry-run fills the form, manually drag-drop the file, then submit

### Problem: CAPTCHA blocks job page

**Cause:** Cloudflare Turnstile challenge.

**Fix:** Built-in CAPTCHA handler automatically:
1. Detects "Just a moment" page title
2. Locates Turnstile widget bounding box
3. Uses Quartz CGEvents for human-like mouse movement
4. Clicks the checkbox
5. Waits for page to resolve
6. Retries up to 4 times

If auto-bypass fails, manually solve the CAPTCHA in Safari, then re-run.

### Problem: "Apply button not found"

**Cause:** Job is closed, already applied, or invite-only.

**Fix:**
1. Open the job URL in Safari manually and check if "Apply Now" button exists
2. If "Already Applied" shown — you've already submitted
3. If no button — job is closed or invite-only
4. If button exists but automation can't find it — check Safari is on the correct tab

### Problem: Submission verification fails

**Cause:** After clicking submit, the URL didn't change to `/proposals/` or success text wasn't found.

**Fix:**
1. Check Safari manually — the proposal may have been submitted despite the verification failure
2. Go to My Jobs → Proposals to verify
3. The verification checks: URL contains `/proposals/`, page text contains "submitted" or "Proposal sent"
4. If Upwork added a new success page format, the verification patterns may need updating

---

## Architecture & Internals

### Input Method Hierarchy

Upwork uses React with masked/formatted inputs that reject standard JavaScript value changes. Here's the hierarchy of methods used:

| Method | Used For | How It Works |
|--------|----------|--------------|
| **React native setter** | Textareas (cover letter, questions) | `Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set()` + `input`/`change` events |
| **OS-level keystroke typing** | Currency inputs (milestone amount) | AppleScript `keystroke` digit-by-digit → triggers native browser events |
| **OS-level keystroke typing** | Rate input (hourly) | AppleScript `keystroke` digit-by-digit (same as currency inputs) |
| **JS click** | Radio buttons, dropdown options | Standard `element.click()` with `change` event |
| **macOS file dialog** | File attachments | JS `input.click()` → `Cmd+Shift+G` → type path → `Enter` |

### Why OS-level input is needed

Upwork's currency inputs (e.g., `#milestone-amount-1`) use:
1. React controlled components with internal state
2. Custom formatting (adds `$`, commas, `.00`)
3. Input masks that validate character-by-character
4. `onChange` handlers that only fire from real browser events

Setting `input.value` via JavaScript bypasses all of this, leaving React's internal state out of sync. OS-level keystrokes trigger real browser `keydown`/`keyup`/`input` events that React handles normally.

### Key Files

| File | Purpose |
|------|---------|
| `packages/upwork-automation/src/automation/job-operations.ts` | Core submission logic (`submitProposal()`) |
| `packages/upwork-automation/src/automation/safari-driver.ts` | Low-level Safari interaction (`clickAtViewportPosition`, `typeViaClipboard`, `uploadFile`) |
| `packages/upwork-automation/src/automation/types.ts` | All TypeScript interfaces and CSS selectors |
| `packages/upwork-automation/src/api/server.ts` | Express REST API (port 3104) |

### SafariDriver Methods Used by Proposal Submission

| Method | Purpose |
|--------|---------|
| `executeJS(code)` | Run JavaScript in Safari's front document |
| `clickAtViewportPosition(x, y)` | OS-level click at viewport coordinates |
| `typeViaClipboard(text)` | Paste text via clipboard + Cmd+V |
| `pressTab()` | Tab key to move focus / trigger blur |
| `uploadFile(selector, path)` | Trigger file dialog and type path |
| `handleCaptchaIfPresent()` | Detect and bypass Cloudflare CAPTCHA |
| `wait(ms)` | Delay between actions |

### Form Error Detection

After filling all fields, the system scrolls to the bottom and checks:
1. **`.text-danger`** — Upwork's error message class
2. **`.air3-form-message-error`** — Upwork's form validation messages
3. **`.air3-alert`** — Upwork's alert component
4. **Submit button state** — Text (includes connects cost) and disabled state

**Only VISIBLE errors are reported.** Hidden DOM elements (e.g., rate-increase validation that becomes invisible after selecting "Never") are filtered out using `getBoundingClientRect()`. This prevents false positive error reports.

Errors are logged and included in the response. The form is only submitted if the button text contains "Send" or "Submit".

### Description Expansion

The `expandJobDescription()` function runs before extraction and on the proposal form:
1. **Strategy 1:** Click `.air3-truncation-btn` (Upwork's native truncation button)
2. **Strategy 2:** Click "more" / "View more" / "read more" links inside description section
3. **Strategy 3:** Fallback — any "more" button in main content area (y: 100-1000)

This fires in three places:
- `extractJobDetail()` — before scraping the job detail page
- `submitProposal()` — on the job detail page before clicking "Apply now"
- `submitProposal()` — on the proposal form after clicking "Apply now" ("more/Less about" button)

---

## Environment Requirements

| Requirement | Details |
|-------------|---------|
| **macOS** | Required (AppleScript automation) |
| **Safari** | Must be open and logged into Upwork |
| **Accessibility permissions** | System Events needs permission (System Preferences → Privacy → Accessibility) |
| **cliclick** | Optional but recommended for precise clicking (`brew install cliclick`) |
| **Node.js** | 18+ for running the server |
| **OPENAI_API_KEY** | Only for AI proposal generation |

### Accessibility Permissions Check

The automation uses `System Events` for keystrokes and mouse clicks. If you get permission errors:

1. Open **System Preferences → Privacy & Security → Accessibility**
2. Add your terminal app (Terminal, iTerm2, or Windsurf)
3. Add **Script Editor** if prompted
4. Restart the terminal after granting permissions

---

## Rate Limits

| Action | Limit | Enforced By |
|--------|-------|-------------|
| Proposals per day | 30 | Server-side counter |
| Page loads per minute | 8 | Server-side throttle |
| Min delay between actions | 3-8 seconds | Random jitter |
| Connects per proposal | Varies (4-16+) | Upwork's pricing |

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 2.1.0 | Feb 28, 2026 | Description expansion (expandJobDescription), Set bid button flow, hourly rate-increase "Never" handling, visible-only error detection, hourly rate via keystroke typing |
| 2.0.0 | Feb 2026 | Fixed-price form support, milestone mode, OS-level keystroke typing, file attachments, CAPTCHA bypass, comprehensive error detection |
| 1.0.0 | Feb 2026 | Initial: hourly proposals, cover letter, screening questions, dry-run |
