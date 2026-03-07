# TikTok Browser Agent - Project Status

**Date**: 2026-03-07
**Phase**: Initialization Complete
**Progress**: 9/50 features (18%)

## ✅ Completed (Initializer Phase)

### Project Structure
- Created full directory structure: `src/{api,automation,utils,types,lib}`, `tests/`
- Set up TypeScript configuration (ES2022, NodeNext modules)
- Configured package.json with all dependencies and scripts

### Core Files Created
1. **types/index.ts** - TypeScript interfaces for TikTok data structures
2. **automation/safari-driver.ts** - Safari automation driver (adapted from Instagram)
3. **package.json** - Dependencies: express, cors, dotenv, @supabase/supabase-js
4. **tsconfig.json** - TypeScript compiler configuration
5. **README.md** - Complete API documentation and setup guide

### Safari Driver Adaptations
- ✅ Changed `isOnInstagram()` → `isOnTikTok()`
- ✅ Updated `isLoggedIn()` for TikTok DOM patterns
- ✅ Fixed import paths for new package structure

### Documentation
- ✅ Complete README with API endpoint specs
- ✅ Setup instructions and example usage
- ✅ ICP scoring criteria documented
- ✅ Rate limiting rules documented

## 🚧 Remaining Work (For Coding Agent)

### High Priority (Core Functionality)
1. **Express API Server** (F-006)
   - Create src/api/server.ts
   - Set up Express with CORS and JSON middleware
   - Listen on port 3102

2. **Health Endpoints** (F-007, F-008)
   - `GET /health` - Service health check
   - `GET /api/status` - Safari session status

3. **TikTok Operations Module** (F-011)
   - Create src/api/tiktok-operations.ts
   - Profile scraping with TikTok DOM selectors
   - Uses [data-e2e=...] attributes

4. **Profile API** (F-012, F-013, F-014)
   - `GET /api/profile/:username`
   - `GET /api/search?q=:query&type=users`
   - Search function

5. **DM Operations** (F-015 through F-022)
   - Conversation list/open/read
   - Send DM with dryRun support
   - Navigate to messages

### Medium Priority (Discovery & Scoring)
6. **Prospect Discovery** (F-023, F-025, F-026)
   - Hashtag-based discovery
   - ICP scoring function
   - Score endpoint

7. **ICP Scoring** (F-024)
   - Bio keyword matching
   - Follower range scoring
   - Engagement ratio calculation

### Essential Infrastructure
8. **Rate Limiting** (F-027, F-028)
   - In-memory counter (20 DMs/day)
   - Active hours check (9am-9pm)
   - 30s minimum delay

9. **Supabase Client** (F-029)
   - Copy from instagram-dm
   - Same project: ivhfuhxorppptyuofbgq

10. **CRMLite Integration** (F-030)
    - Sync DM sends to CRM
    - POST to /api/sync/dm

### Testing & Validation
11. **Vitest Test Suite** (F-031 through F-036)
    - Layer 1: Health/status tests
    - Layer 2: Profile API tests
    - Layer 3: Prospect discovery tests
    - Layer 4: DM dry-run tests

12. **Build & Startup Tests** (F-038, F-039)
    - Verify TypeScript compilation
    - Test server startup on port 3102

### Error Handling & Edge Cases
13. **Error Handling** (F-047, F-048)
    - Profile not found handling
    - Safari not on TikTok checks

14. **Rate Limit Tests** (F-044, F-045, F-046)
    - Daily cap enforcement
    - Active hours enforcement
    - Delay enforcement

### Deployment
15. **Watchdog Integration** (F-050)
    - Add to watchdog-safari.sh
    - Health check on port 3102

## Key Design Decisions

### TikTok DOM Selectors (from PRD)
- Profile follower count: `[data-e2e="user-subtitle"]`
- Bio: `[data-e2e="user-bio"]`
- Video grid: `[data-e2e="user-post-item"]`
- Message threads: `[data-e2e="message-row"]`

### ICP Scoring Formula (Max 100 points)
```
Bio Keywords:        +15 each (max 45)
Follower Range:      +25 (1K-50K), +15 (50K-500K)
Engagement Ratio:    +20 (likes/followers > 0.1)
Not Verified:        +5
─────────────────────────────────
Qualification:       Score >= 50
```

### Rate Limiting Rules
- **Daily Limit**: 20 DMs/day
- **Active Hours**: 9:00am - 9:00pm
- **Min Delay**: 30 seconds between DMs
- **Reset**: Midnight local time

### CRMLite Sync Format
```json
POST https://crmlite-isaiahduprees-projects.vercel.app/api/sync/dm
Headers: { "x-api-key": "<CRMLITE_API_KEY>" }
Body: {
  "platform": "tiktok",
  "conversations": [
    {
      "username": "...",
      "display_name": "...",
      "messages": [
        { "sender": "...", "text": "...", "timestamp": "..." }
      ]
    }
  ]
}
```

## Next Agent Instructions

1. **Start with the Express server** - Get port 3102 up and running
2. **Implement health endpoints** - Verify Safari integration works
3. **Build tiktok-operations.ts** - This is the core TikTok DOM scraping module
4. **Wire up profile API** - Test against @charlidamelio (known public account)
5. **Add rate limiting** - Critical for DM operations
6. **Implement DM operations** - Start with dryRun support
7. **Build test suite** - Layer 1 tests should pass immediately
8. **Test full flow** - Prospect discovery → score → dryRun DM

## Critical Files to Reference

- `/packages/instagram-dm/src/api/server.ts` - Server structure
- `/packages/instagram-dm/src/automation/dm-operations.ts` - DM patterns
- `/packages/instagram-dm/src/lib/supabase.ts` - Supabase client setup
- `/packages/instagram-dm/tests/instagram-dm.test.ts` - Test structure

## Environment Variables Needed

```bash
SUPABASE_URL=https://ivhfuhxorppptyuofbgq.supabase.co
SUPABASE_KEY=<from actp-worker/.env>
CRMLITE_API_KEY=<from actp-worker/.env>
SAFARI_AUTOMATION_WINDOW=1
```

---

**Ready for Coding Agent**: Yes ✅
**Blocking Issues**: None
**Estimated Remaining Work**: 41 features
