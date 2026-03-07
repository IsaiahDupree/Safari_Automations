# PAP-002: Follower Extraction Feature

## Overview

Cross-platform follower extraction for prospect discovery pipeline. Extracts followers from creator profiles with standardized interface across all platforms.

## Supported Platforms

| Platform | Status | Module Path |
|----------|--------|-------------|
| Instagram | ✅ Full implementation | `packages/instagram-dm/src/automation/follower-operations.ts` |
| TikTok | 🚧 Stub (needs DOM selectors) | `packages/tiktok-dm/src/automation/follower-operations.ts` |
| Twitter | 🚧 Stub (needs DOM selectors) | `packages/twitter-dm/src/automation/follower-operations.ts` |
| Threads | 🚧 Stub (needs DOM selectors) | `packages/threads-comments/src/automation/follower-operations.ts` |

## Interface

All platforms implement the same interface:

```typescript
interface FollowerProfile {
  handle: string;
  displayName: string;
  bio?: string;
  followerCount?: number;
  followingCount?: number;
  isVerified?: boolean;
  profilePicUrl?: string;
}

interface ExtractFollowersResult {
  success: boolean;
  followers: FollowerProfile[];
  count: number;
  error?: string;
  handle?: string;
}

// Single extraction
function extractFollowers(handle: string, limit: number = 200): Promise<ExtractFollowersResult>

// Batch extraction
function extractFollowersBatch(handles: string[], limitPerHandle: number = 200): Promise<Map<string, ExtractFollowersResult>>
```

## Usage

### Instagram (Full Implementation)

```typescript
import { extractFollowers } from './packages/instagram-dm/src/automation/follower-operations.js';

const result = await extractFollowers('instagram', 50);

if (result.success) {
  console.log(`Extracted ${result.count} followers:`);
  result.followers.forEach(f => {
    console.log(`@${f.handle} - ${f.displayName}`);
    if (f.isVerified) console.log('  ✓ Verified');
    if (f.bio) console.log(`  Bio: ${f.bio}`);
  });
}
```

### Test Script

```bash
cd packages/instagram-dm
npx tsx test-follower-extract.ts <handle> [limit]
```

Example:
```bash
npx tsx test-follower-extract.ts instagram 20
```

## Implementation Details

### Instagram

Uses Safari + AppleScript automation:
1. Navigate to `https://www.instagram.com/{handle}/`
2. Click "followers" link
3. Wait for modal to appear
4. Scroll through followers list
5. Extract data from each visible card:
   - Handle (from link href)
   - Display name (from span text)
   - Bio snippet (second text line)
   - Verified badge (SVG check)
   - Follower count (if visible)
6. Continue scrolling until limit reached or end of list

### Rate Limiting

- Default: 5 second delay between handle extractions in batch mode
- Configurable via delay parameter in batch function
- Respects Instagram's scroll rate (500ms between scrolls)

### Other Platforms (TODO)

TikTok, Twitter, and Threads need platform-specific implementations:

1. **TikTok**: Privacy restrictions - many accounts don't show followers publicly
2. **Twitter**: Navigate to `/followers`, extract user cards, handle "Load more" pagination
3. **Threads**: Similar to Instagram (Meta product), likely same modal pattern

## API Integration

To add to REST API servers:

```typescript
// Add to packages/{platform}-dm/src/api/server.ts

app.post('/api/followers/extract', async (req, res) => {
  const { handle, limit = 200 } = req.body;
  const result = await extractFollowers(handle, limit);
  res.json(result);
});
```

## Next Steps (Full PAP Pipeline)

1. **PAP-007**: Add cron schedule for daily follower sweeps
2. **PAP-005**: Run extracted followers through scorer
3. **PAP-006**: Push high-scoring followers (≥65) to CRM
4. **PAP-008**: Track conversion feedback to improve scoring

## PRD Reference

See `/Users/isaiahdupree/Documents/Software/autonomous-coding-dashboard/docs/prd/PRD-PROSPECT-ACQUISITION-PIPELINE.md` for full feature requirements.
