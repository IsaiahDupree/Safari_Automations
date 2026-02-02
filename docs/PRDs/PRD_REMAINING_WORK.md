# PRD: Remaining Work & Future Enhancements
**Date:** February 1, 2026  
**Status:** 🔄 IN PROGRESS  
**Priority:** Medium-High

---

## Overview

This document tracks remaining work items, unfinished features, and future enhancements for the Safari Automation platform based on the AI audit session.

---

## 🔴 Not Yet Implemented

### 1. Task Executor Integration
**Priority:** High  
**Status:** Scheduler exists but doesn't execute tasks

The scheduler can queue and manage tasks, but actual execution of scheduled tasks (calling platform APIs) is not wired up.

**Required Work:**
- [ ] Connect scheduler to Instagram comment API for scheduled sessions
- [ ] Connect scheduler to Threads comment API for scheduled sessions
- [ ] Connect scheduler to Sora generation API when credits trigger
- [ ] Add task executor that processes queue and calls appropriate endpoints

### 2. Twitter DM Automation
**Priority:** Medium  
**Status:** Server exists but minimal AI integration

**File:** `packages/twitter-dm/src/api/server.ts`

**Required Work:**
- [ ] Add full AI DM generation endpoint
- [ ] Integrate with scheduler for DM sessions
- [ ] Add rate limiting awareness

### 3. Multi-Platform Dashboard
**Priority:** Medium  
**Status:** Individual APIs exist, no unified view

**Required Work:**
- [ ] Create unified dashboard showing all platform statuses
- [ ] Show scheduler queue, running tasks, completed tasks
- [ ] Display Sora credit status prominently
- [ ] Real-time updates via WebSocket

### 4. AI Content Analysis
**Priority:** Low  
**Status:** Function exists but not actively used

**File:** `packages/services/src/ai/ai-utils.ts` → `analyzeContent()`

**Required Work:**
- [ ] Use AI to analyze posts before commenting
- [ ] Skip low-quality or controversial content
- [ ] Detect engagement potential

---

## 🟡 Partially Implemented

### 1. Sora Auto-Generation Pipeline
**Status:** Scheduler endpoint exists, generation not triggered

**What Works:**
- ✅ Credit monitoring with sparse checks
- ✅ Callback registration when credits available
- ✅ Queue task for later if no credits

**What's Missing:**
- [ ] Actually trigger `sora-story-generator.ts` when credits become available
- [ ] Download completed videos automatically
- [ ] Upload to configured destinations (TikTok, Twitter, etc.)

### 2. Instagram Keyword Search Commenting
**Status:** Works manually, scheduler integration incomplete

**What Works:**
- ✅ Keyword search endpoint
- ✅ AI comment generation
- ✅ Duplicate prevention

**What's Missing:**
- [ ] Scheduler doesn't trigger the keyword search flow
- [ ] Need to wire up scheduled task to actual API call

### 3. Threads Commenting Automation
**Status:** Driver exists, scheduler endpoint exists

**What Works:**
- ✅ ThreadsDriver for browser automation
- ✅ AI comment generator
- ✅ Scheduler endpoint

**What's Missing:**
- [ ] End-to-end automated session
- [ ] Feed discovery and post selection
- [ ] Rate limiting per session

---

## 🟢 Future Enhancements

### 1. AI Persona System
**Priority:** Low  
**Status:** Not started

Different AI personas for different engagement styles:
- Professional/Business persona
- Casual/Friendly persona  
- Enthusiastic supporter persona
- Thoughtful commenter persona

### 2. Engagement Analytics
**Priority:** Medium  
**Status:** Logging exists, analytics don't

- Track which AI comments get responses
- Learn from successful engagement patterns
- A/B test different comment styles

### 3. Cross-Platform Scheduling
**Priority:** Medium  
**Status:** Individual schedulers exist

- Coordinate timing across platforms
- Avoid suspicious patterns (all platforms at once)
- Stagger activity naturally

### 4. AI Learning Loop
**Priority:** Low  
**Status:** Not started

- Store successful comments in vector DB
- Use as examples for future generation
- Continuously improve comment quality

---

## Technical Debt

| Item | Location | Priority |
|------|----------|----------|
| Hardcoded paths | Various scripts | Medium |
| Missing error handling | DM servers | Medium |
| No retry logic | Comment posting | Low |
| Duplicate Supabase clients | Multiple packages | Low |

---

## Recommended Next Steps

1. **Wire up scheduler execution** - Make queued tasks actually run
2. **Test Sora credit callback** - Verify auto-generation triggers
3. **Add WebSocket to dashboard** - Real-time status updates
4. **Consolidate AI client** - All platforms use shared `ai-utils.ts`

---

## Related PRDs

| PRD | Status |
|-----|--------|
| [PRD_AI_AUDIT_COMPLETE](./PRD_AI_AUDIT_COMPLETE.md) | ✅ Complete |
| [PRD_Safari_Task_Scheduler](./PRD_Safari_Task_Scheduler.md) | 🔄 Partial |
| [PRD_SORA_FULL_CONTROL](./PRD_SORA_FULL_CONTROL.md) | 🔄 Partial |
| [PRD_DM_Automation](./PRD_DM_Automation.md) | 🔄 Partial |
| [PRD_UNIFIED_SOCIAL_AUTOMATION](./PRD_UNIFIED_SOCIAL_AUTOMATION.md) | 🔄 Partial |

---

**Last Updated:** February 1, 2026  
**Next Review:** When scheduler execution is implemented
