# Content Package Specification v1.0

> Standardized format for packaging market research into content recreation instructions.

## Overview

A **ContentPackage** wraps a single piece of scraped content (Facebook post, Instagram post, or Meta Ad Library ad) with everything a downstream content creation server needs to recreate, repurpose, or draw inspiration from it.

A **ContentPackageBatch** is a collection of packages, sorted by performance, ready for a content pipeline to consume.

---

## Quick Start

```bash
# Generate a batch of top 50 content packages from all sources
npx tsx packages/content-packager/src/packager.ts

# Filter by platform
npx tsx packages/content-packager/src/packager.ts --platforms facebook,instagram

# Only video content, top 20
npx tsx packages/content-packager/src/packager.ts --formats video,reel --top-n 20

# Filter by keyword
npx tsx packages/content-packager/src/packager.ts --keywords friendship,adhd

# Set minimum engagement score
npx tsx packages/content-packager/src/packager.ts --min-engagement 1000

# Exclude ad library
npx tsx packages/content-packager/src/packager.ts --no-ads true
```

Output is written to `~/market-research/content-packages/`.

---

## Schema Reference

### ContentPackageBatch (root)

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | `batch_{timestamp}` |
| `generatedAt` | ISO 8601 | When the batch was created |
| `filters` | object | Filters used to generate this batch |
| `summary` | object | Aggregate stats (counts by platform, format, avg engagement) |
| `packages` | ContentPackage[] | Sorted by performance (highest first) |

### ContentPackage

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | `pkg_{platform}_{originalId}_{timestamp}` |
| `schemaVersion` | `"1.0"` | For forward compatibility |
| `generatedAt` | ISO 8601 | Package creation time |
| `source` | SourceReference | Original post metadata |
| `content` | ContentAnalysis | Analyzed text, hooks, CTAs, tone |
| `media` | MediaManifest | All media assets with URLs and local paths |
| `performance` | PerformanceMetrics | Engagement data and scoring |
| `renderSpec` | RenderSpec | Rendering instructions for Remotion |
| `recreation` | RecreationInstructions | Step-by-step recreation guide |
| `tags` | string[] | Filterable tags |

### SourceReference

| Field | Type | Description |
|-------|------|-------------|
| `platform` | `"facebook"` \| `"instagram"` \| `"meta_ad_library"` | Source platform |
| `originalId` | string | Platform-specific ID |
| `originalUrl` | string | Link to original post |
| `authorName` | string | Creator name/handle |
| `authorUrl` | string | Link to creator profile |
| `authorFollowers` | number \| null | Follower count if known |
| `isVerified` | boolean | Verified account |
| `keyword` | string | Search keyword/hashtag this was found under |
| `scrapedAt` | ISO 8601 | When we scraped it |
| `postedAt` | string | When the original was posted |

### ContentAnalysis

| Field | Type | Description |
|-------|------|-------------|
| `format` | `"text"` \| `"image"` \| `"video"` \| `"reel"` \| `"carousel"` \| `"link"` | Content format |
| `originalText` | string | Full caption/text |
| `hook` | string | First line / attention grabber |
| `cta` | string | Call-to-action extracted from text |
| `body` | string | Text between hook and CTA |
| `hashtags` | string[] | Hashtags used |
| `mentions` | string[] | @ mentions |
| `tone` | ContentTone | Detected tone (educational, emotional, humorous, etc.) |
| `readingTimeSec` | number | Estimated reading time |
| `wordCount` | number | Word count |
| `emojiDensity` | number | Emojis per 100 characters |
| `keyPhrases` | string[] | Key phrases extracted |
| `ctaButtonText` | string? | Ad Library: CTA button text |
| `landingUrl` | string? | Ad Library: landing page URL |

### MediaManifest

| Field | Type | Description |
|-------|------|-------------|
| `count` | number | Total media assets |
| `primaryType` | `"image"` \| `"video"` \| `"none"` | Primary media type |
| `isCarousel` | boolean | Multiple media items |
| `assets` | MediaAsset[] | Individual assets |
| `thumbnail` | MediaAsset? | Preview thumbnail |

### MediaAsset

| Field | Type | Description |
|-------|------|-------------|
| `index` | number | 0-based position |
| `type` | `"image"` \| `"video"` | Asset type |
| `remoteUrl` | string | Original CDN URL |
| `localPath` | string \| null | Local downloaded path |
| `fileSize` | number \| null | Bytes |
| `width` / `height` | number \| null | Dimensions |
| `aspectRatio` | string \| null | e.g. `"9:16"` |
| `durationSec` | number \| null | Video duration |
| `mimeType` | string \| null | MIME type |

### PerformanceMetrics

| Field | Type | Description |
|-------|------|-------------|
| `likes` | number | Like/reaction count |
| `comments` | number | Comment count |
| `shares` | number | Share count |
| `views` | number \| null | View count |
| `reactionBreakdown` | Record<string, number> | FB reaction types |
| `engagementScore` | number | Computed engagement (0-100+) |
| `viralityScore` | number | Virality metric |
| `relevanceScore` | number | Relevance to keyword |
| `overallRank` | number | Combined ranking score |
| `percentileInGroup` | number | 0-100 percentile within keyword group |
| `isTopPerformer` | boolean | Top 20% in group |

### RenderSpec

| Field | Type | Description |
|-------|------|-------------|
| `outputFormat` | `"video"` \| `"image"` \| `"carousel"` | Target output |
| `targetPlatforms` | TargetPlatform[] | Where to publish |
| `durationSec` | number | Video duration |
| `aspectRatio` | `"9:16"` \| `"16:9"` \| `"1:1"` \| `"4:5"` | Aspect ratio |
| `resolution` | `{width, height}` | Pixel dimensions |
| `fps` | number | Frames per second |
| `compositionId` | string | Remotion composition to use |
| `style` | RenderStyle | Visual styling parameters |

### RenderStyle

| Field | Type | Description |
|-------|------|-------------|
| `primaryColor` | hex | Brand primary |
| `secondaryColor` | hex | Brand secondary |
| `backgroundColor` | hex | Background |
| `textColor` | hex | Text color |
| `fontFamily` | string | Body font |
| `headingFontFamily` | string | Heading font |
| `layout` | enum | `text-overlay` \| `split-screen` \| `slideshow` \| `kinetic-text` \| `talking-head` \| `b-roll-overlay` |
| `textAnimation` | enum | `typewriter` \| `fade-in` \| `slide-up` \| `bounce` \| `none` |
| `backgroundStyle` | enum | `solid` \| `gradient` \| `video` \| `image` \| `particles` |
| `musicMood` | enum | `upbeat` \| `calm` \| `dramatic` \| `emotional` \| `corporate` \| `none` |

### RecreationInstructions

| Field | Type | Description |
|-------|------|-------------|
| `type` | enum | `direct-repurpose` \| `inspired-recreation` \| `format-adaptation` \| `mashup` |
| `priority` | 1-5 | 1 = highest priority based on performance |
| `steps` | string[] | Step-by-step recreation guide |
| `keepElements` | string[] | Elements to preserve from original |
| `changeElements` | string[] | Elements to change/adapt |
| `scriptBeats` | string[] | Text broken into video script beats |
| `adaptedHook` | string | Hook adapted for our brand |
| `adaptedCta` | string | CTA adapted for our product |
| `relatedBriefId` | string \| null | Matched ad brief if available |
| `soraPrompt` | string \| null | Sora video generation prompt |
| `requiredApis` | RequiredApi[] | APIs needed for recreation |

### RequiredApi

| Field | Type | Description |
|-------|------|-------------|
| `service` | enum | `remotion` \| `sora` \| `openai` \| `elevenlabs` \| `stability` \| `ffmpeg` \| `sharp` |
| `purpose` | string | What this API call does |
| `endpoint` | string | API endpoint or CLI command |
| `estimatedCost` | string | Cost estimate per use |

---

## Remotion Composition IDs

These are the suggested Remotion composition IDs referenced in `renderSpec.compositionId`:

| ID | Use Case | Layout |
|----|----------|--------|
| `KineticTextExplainer` | Educational tips/how-to | Animated text on gradient |
| `EmotionalStoryReel` | Emotional/relatable stories | Text overlay on mood footage |
| `QuickCutMeme` | Humor/meme content | Fast cuts with bold text |
| `ProductShowcase` | Promotional content | Split-screen product demo |
| `NarrativeReel` | Storytelling | Cinematic text + B-roll |
| `TextOverlayReel` | General video | Text over background |
| `CarouselSlideshow` | Multi-slide content | Animated slide transitions |
| `StaticPostCard` | Single image posts | Branded card with text |

---

## Data Inventory

Current research data available for packaging:

| Source | Posts | Keywords/Hashtags | Media Files |
|--------|-------|-------------------|-------------|
| Facebook | 233 | 15 keywords | 15 |
| Instagram | 251 | 12 hashtags | 12 |
| Meta Ad Library | 536 | 21 keywords | 21 |
| **Total** | **1,020** | **48** | **48** |

Additional assets:
- **6 Ad Briefs** with hooks, CTAs, Sora prompts
- **Creative Radar patterns** for offer-level analysis
- **76+ media files** in Creative Radar media directory
