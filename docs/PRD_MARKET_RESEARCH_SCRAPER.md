# Product Requirements Document (PRD)
# Market Research Scraper — Facebook & Instagram

**Version:** 1.0.0  
**Date:** February 2026  
**Status:** Draft  
**Author:** Isaiah Dupree  

---

## Executive Summary

Build a Safari-automated market research system that searches Facebook and Instagram for keywords and phrases related to our products and offers, scrapes top-performing organic posts, ranks them by engagement, stores all data and media locally, and feeds that intelligence into an ad creation pipeline.

### Key Capabilities
| Capability | Description |
|------------|-------------|
| **Keyword Search** | Search Facebook/Instagram for product-related terms |
| **Post Discovery** | Find top posts, reels, videos, and ads for each keyword |
| **Data Extraction** | Scrape engagement stats, captions, media, hashtags, profiles |
| **Ranking Engine** | Score and rank posts by engagement rate, virality, relevance |
| **Content Storage** | Persist all scraped data + downloaded media locally |
| **Ad Intelligence** | Feed top content patterns into ad creation pipeline |

---

## Problem Statement

Creating high-performing ads requires understanding what organic content already resonates with the target audience. Currently this is done manually:

1. **Time-consuming** — Manually searching Facebook/Instagram for each keyword
2. **No ranking** — No systematic way to compare post performance across searches
3. **No persistence** — Insights are lost; no historical tracking of what works
4. **No content pipeline** — Gap between research and ad creation
5. **No competitor tracking** — Can't systematically monitor competitor organic content

---

## Goals & Success Metrics

### Goals
- [ ] Search Facebook for any keyword/phrase and extract all visible results
- [ ] Rank scraped posts by engagement (reactions, comments, shares, views)
- [ ] Download media (images, videos, thumbnails) for top posts
- [ ] Store structured data in JSON with full metadata
- [ ] Support batch keyword research (multiple terms per session)
- [ ] Feed scraped content into ad creation templates
- [ ] Track historical performance trends per keyword over time

### Success Metrics
| Metric | Target |
|--------|--------|
| Posts scraped per keyword search | 50+ |
| Data fields captured per post | 15+ |
| Media download success rate | > 90% |
| Time per keyword search (automated) | < 3 min |
| Storage format queryable | JSON + SQLite |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Safari Browser (macOS)                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │ Facebook     │  │ Instagram    │  │ Meta Ad Library          │  │
│  │ Search       │  │ Explore      │  │ (Future)                 │  │
│  └──────────────┘  └──────────────┘  └──────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
                                │
                    AppleScript + JavaScript
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│              Market Research Engine (Python)                         │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                   Search Orchestrator                        │    │
│  │  ┌───────────┐  ┌─────────────┐  ┌───────────────────────┐  │    │
│  │  │ Keyword   │→ │ Page        │→ │ Post Extractor        │  │    │
│  │  │ Navigator │  │ Scroller    │  │ (stats, media, text)  │  │    │
│  │  └───────────┘  └─────────────┘  └───────────────────────┘  │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                   Data Pipeline                              │    │
│  │  ┌───────────┐  ┌─────────────┐  ┌───────────────────────┐  │    │
│  │  │ Ranking   │→ │ Media       │→ │ Storage               │  │    │
│  │  │ Engine    │  │ Downloader  │  │ (JSON + SQLite)       │  │    │
│  │  └───────────┘  └─────────────┘  └───────────────────────┘  │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                   Ad Intelligence                            │    │
│  │  ┌───────────┐  ┌─────────────┐  ┌───────────────────────┐  │    │
│  │  │ Pattern   │→ │ Template    │→ │ Ad Brief              │  │    │
│  │  │ Analyzer  │  │ Generator   │  │ Generator             │  │    │
│  │  └───────────┘  └─────────────┘  └───────────────────────┘  │    │
│  └─────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        Storage Layer                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │ research/    │  │ research/    │  │ research/                │  │
│  │  data/*.json │  │  media/      │  │  reports/                │  │
│  │  db/         │  │  videos/     │  │  ad-briefs/              │  │
│  │  research.db │  │  images/     │  │  *.md                    │  │
│  └──────────────┘  └──────────────┘  └──────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Facebook Organic Search Scraper

### 1.1 Search Flow

```
User provides keywords → Navigate to facebook.com/search/posts/?q={keyword}
  → Apply filters (date, type) → Scroll & extract posts → Rank → Store
```

### 1.2 Facebook Search URLs

| Search Type | URL Pattern |
|-------------|-------------|
| **Posts** | `facebook.com/search/posts/?q={keyword}` |
| **Videos** | `facebook.com/search/videos/?q={keyword}` |
| **Pages** | `facebook.com/search/pages/?q={keyword}` |
| **Groups** | `facebook.com/search/groups/?q={keyword}` |
| **Reels** | `facebook.com/reel/?q={keyword}` (search within reels tab) |

### 1.3 Data Model — Facebook Post

```typescript
interface FacebookPost {
  // Identity
  id: string;                    // Post ID or URL hash
  url: string;                   // Full post URL
  platform: "facebook";
  
  // Author
  authorName: string;            // Page or profile name
  authorUrl: string;             // Profile/page URL
  authorFollowers?: number;      // If visible
  isVerified: boolean;
  isPage: boolean;               // Page vs personal profile
  
  // Content
  textContent: string;           // Full post text / caption
  contentType: "text" | "image" | "video" | "reel" | "link" | "carousel";
  mediaUrls: string[];           // Image/video source URLs
  linkUrl?: string;              // Shared link if any
  linkTitle?: string;
  hashtags: string[];
  mentions: string[];
  
  // Engagement
  reactions: number;             // Total reactions (like, love, etc.)
  reactionBreakdown?: {
    like: number;
    love: number;
    haha: number;
    wow: number;
    sad: number;
    angry: number;
  };
  comments: number;
  shares: number;
  views?: number;                // For videos/reels
  
  // Ranking
  engagementScore: number;       // Computed: (reactions + comments*2 + shares*3) / followers
  viralityScore: number;         // shares / (reactions + 1)
  relevanceScore: number;        // Keyword match density in text
  overallRank: number;           // Composite score
  
  // Metadata
  postedAt: string;              // ISO date when posted
  scrapedAt: string;             // When we scraped it
  keyword: string;               // Which search keyword found this
  searchType: string;            // posts, videos, reels, etc.
  
  // Media (local)
  localMediaPaths: string[];     // Downloaded media file paths
  thumbnailPath?: string;        // Thumbnail if video
}
```

### 1.4 Data Model — Research Session

```typescript
interface ResearchSession {
  id: string;                    // UUID
  startedAt: string;
  completedAt?: string;
  platform: "facebook" | "instagram";
  
  // Search config
  keywords: string[];
  filters: {
    dateRange?: "today" | "this_week" | "this_month" | "this_year";
    contentType?: "posts" | "videos" | "reels" | "all";
    sortBy?: "relevance" | "recent";
  };
  
  // Results
  totalPostsScraped: number;
  totalMediaDownloaded: number;
  keywordResults: {
    [keyword: string]: {
      postsFound: number;
      topPost: FacebookPost;
      avgEngagement: number;
    };
  };
  
  // Output
  reportPath: string;            // Generated report file
  dataPath: string;              // JSON data file
}
```

### 1.5 Ranking Algorithm

Posts are scored using a weighted composite:

```
engagementScore = (reactions + comments * 2 + shares * 3) / max(followers, 1)
viralityScore   = shares / max(reactions + 1, 1)
relevanceScore  = keywordMatchCount / max(wordCount, 1)
recencyBoost    = 1.0 + (0.5 if posted within 7 days else 0)

overallRank = (
    engagementScore * 0.40 +
    viralityScore   * 0.25 +
    relevanceScore  * 0.20 +
    recencyBoost    * 0.15
)
```

### 1.6 JavaScript Extraction (Facebook Post Card)

Key DOM selectors for Facebook search results:

```javascript
// Post container
'div[data-ad-preview]'                    // Sponsored posts
'div[role="article"]'                     // Organic posts

// Author info
'h2 a, h3 a, h4 a'                       // Author name + link
'a[role="link"] span'                     // Profile name
'svg[aria-label="Verified"]'              // Verification badge

// Content
'div[data-ad-comet-preview="message"]'    // Post text
'div[dir="auto"]'                         // Text blocks
'a[href*="/photo"], a[href*="/video"]'    // Media links
'video'                                    // Video elements
'img[src*="scontent"]'                    // Images

// Engagement
'span[aria-label*="reaction"]'            // Reaction count
'span[aria-label*="comment"]'             // Comment count  
'span[aria-label*="share"]'              // Share count
'div[aria-label*="Like"]'                // Like button area with count

// Timestamp
'a[href*="posts/"] span'                 // Post timestamp
'abbr[data-utime]'                       // Unix timestamp
```

> **Note:** Facebook's DOM is highly dynamic. Selectors will be maintained in a config file and updated as needed. The scraper will use multiple fallback strategies per field.

---

## Phase 2: Instagram Keyword & Hashtag Research

### 2.1 Search Flow

```
User provides keywords → Navigate to instagram.com/explore/tags/{hashtag}
  → Also search instagram.com/explore/search/keyword/{keyword}
  → Scroll & extract posts → Click into each for stats → Rank → Store
```

### 2.2 Instagram Search URLs

| Search Type | URL Pattern |
|-------------|-------------|
| **Hashtag** | `instagram.com/explore/tags/{tag}/` |
| **Keyword** | `instagram.com/explore/search/keyword/{keyword}/` |
| **Location** | `instagram.com/explore/locations/{id}/` |
| **Profile** | `instagram.com/{username}/` (competitor research) |

### 2.3 Data Model — Instagram Post

```typescript
interface InstagramPost {
  // Identity
  id: string;                    // Shortcode
  url: string;                   // Full post URL
  platform: "instagram";
  
  // Author
  authorUsername: string;
  authorDisplayName: string;
  authorUrl: string;
  authorFollowers?: number;
  isVerified: boolean;
  
  // Content
  caption: string;
  contentType: "image" | "video" | "reel" | "carousel" | "story";
  mediaUrls: string[];
  hashtags: string[];
  mentions: string[];
  audioTrack?: string;           // For reels
  
  // Engagement
  likes: number;
  comments: number;
  views?: number;                // Video views
  saves?: number;                // If visible
  shares?: number;               // If visible
  
  // Ranking
  engagementScore: number;
  viralityScore: number;
  relevanceScore: number;
  overallRank: number;
  
  // Metadata
  postedAt: string;
  scrapedAt: string;
  keyword: string;
  searchType: "hashtag" | "keyword" | "explore" | "profile";
  
  // Media (local)
  localMediaPaths: string[];
  thumbnailPath?: string;
}
```

---

## Phase 3: Ad Creation Pipeline

### 3.1 Flow

```
Top-ranked scraped content
  → Pattern analysis (what hooks, CTAs, formats work)
  → Template extraction (caption structure, visual style, hashtag strategy)
  → Ad brief generation (using our offers + winning patterns)
  → Feed into Sora video generation or static ad creator
```

### 3.2 Pattern Analyzer Output

```typescript
interface ContentPattern {
  // Hook patterns
  topHooks: string[];            // First lines of top posts
  hookFormats: string[];         // "Question", "Bold claim", "Stat", etc.
  avgHookLength: number;
  
  // Visual patterns
  dominantColors: string[];
  videoLengthDistribution: { short: number; medium: number; long: number };
  aspectRatios: { portrait: number; square: number; landscape: number };
  hasTextOverlay: number;        // % of top posts with text on image
  
  // Caption patterns
  avgCaptionLength: number;
  topHashtags: string[];
  ctaPatterns: string[];         // "Link in bio", "Comment below", etc.
  emojiUsageRate: number;
  
  // Engagement correlations
  bestPostingTimes: string[];    // Day + hour
  bestContentTypes: string[];    // video > carousel > image etc.
  bestCaptionLength: { min: number; max: number };
}
```

### 3.3 Ad Brief Generator

Using top patterns + our offers:

```typescript
interface AdBrief {
  keyword: string;
  targetAudience: string;
  offer: string;                 // Our product/offer
  
  // Derived from research
  suggestedHook: string;
  suggestedCaption: string;
  suggestedHashtags: string[];
  suggestedFormat: string;       // "reel" | "carousel" | "static"
  suggestedDuration?: number;    // For video
  
  // Reference content
  inspirationPosts: string[];    // URLs of top posts used as reference
  competitorInsights: string;
  
  // Ready for generation
  soraPrompt?: string;           // If video, ready-to-use Sora prompt
  imagePrompt?: string;          // If static, image generation prompt
}
```

---

## Storage Layout

```
~/market-research/
├── facebook/
│   ├── sessions/                     # Research session logs
│   │   └── 2026-02-21-automation-tools.json
│   ├── posts/                        # Raw scraped post data
│   │   └── {keyword}/
│   │       ├── posts.json            # All posts for this keyword
│   │       └── ranked.json           # Sorted by overallRank
│   ├── media/                        # Downloaded media
│   │   └── {keyword}/
│   │       ├── {post_id}.mp4
│   │       ├── {post_id}.jpg
│   │       └── {post_id}_thumb.jpg
│   └── reports/                      # Generated reports
│       └── 2026-02-21-weekly.md
├── instagram/
│   ├── sessions/
│   ├── posts/
│   ├── media/
│   └── reports/
├── patterns/                         # Cross-platform pattern analysis
│   └── {keyword}-patterns.json
├── ad-briefs/                        # Generated ad briefs
│   └── {keyword}-brief.json
└── research.db                       # SQLite for queries
```

---

## CLI Interface

```bash
# Facebook keyword search
python -m market_research.facebook search "automation tools" --max-posts 100

# Facebook batch search (multiple keywords)
python -m market_research.facebook batch --keywords "automation,saas tools,no code" --max-per-keyword 50

# Facebook with filters
python -m market_research.facebook search "AI video" --type videos --date this_week --sort recent

# Rank existing data
python -m market_research.facebook rank "automation tools" --top 20

# Download media for top N posts
python -m market_research.facebook download "automation tools" --top 10

# Generate report
python -m market_research.facebook report "automation tools" --format md

# Generate ad brief from research
python -m market_research.ad_brief generate --keyword "automation tools" --offer "EverReach App Kit"

# Full research pipeline
python -m market_research.pipeline run --keywords "automation,saas" --platforms facebook,instagram

# Status / history
python -m market_research.status
```

---

## API Endpoints (Scheduler Integration)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/research/facebook/search` | Start a Facebook keyword search |
| `POST` | `/api/research/facebook/batch` | Batch keyword search |
| `POST` | `/api/research/instagram/search` | Start Instagram keyword search |
| `GET`  | `/api/research/sessions` | List all research sessions |
| `GET`  | `/api/research/sessions/:id` | Get session details + results |
| `GET`  | `/api/research/keywords` | List all researched keywords |
| `GET`  | `/api/research/keywords/:keyword/top` | Get top posts for keyword |
| `POST` | `/api/research/rank` | Re-rank posts for a keyword |
| `POST` | `/api/research/ad-brief` | Generate ad brief from research |
| `GET`  | `/api/research/patterns/:keyword` | Get content patterns |

---

## Implementation Plan

### Phase 1 — Facebook Search Scraper (Current Sprint)
1. **Facebook search navigator** — Navigate to search URLs, apply filters
2. **Post card extractor** — Extract all data fields from search result cards
3. **Scroll + pagination** — Infinite scroll handler to load more results
4. **Engagement parser** — Parse reaction counts, comments, shares, views
5. **Media downloader** — Download images and videos from top posts
6. **Ranking engine** — Score and rank all posts
7. **Storage layer** — JSON + SQLite persistence
8. **CLI interface** — Command-line search, rank, download, report

### Phase 2 — Instagram Research
9. **Instagram hashtag scraper** — Explore tags page
10. **Instagram keyword search** — Explore search
11. **Post detail extraction** — Click into posts for full stats
12. **Unified ranking** — Cross-platform scoring

### Phase 3 — Ad Intelligence
13. **Pattern analyzer** — Identify winning content patterns
14. **Ad brief generator** — Combine patterns + our offers
15. **Sora prompt generator** — Auto-create video prompts from briefs
16. **Scheduler integration** — Recurring research runs

---

## Technical Constraints

- **Safari-only**: Uses AppleScript + JavaScript injection (no headless browser)
- **Rate limiting**: 3-5 second delays between page navigations to avoid detection
- **Login required**: Facebook search requires authenticated session
- **DOM volatility**: Facebook/Instagram DOM changes frequently; selectors in config file
- **No API**: Pure web scraping — no official Graph API usage for organic search

---

## Dependencies

| Dependency | Purpose |
|------------|---------|
| `safari_session_manager.py` | Login verification for Facebook/Instagram |
| `safari_app_controller.py` | Core Safari AppleScript automation |
| `loguru` | Structured logging |
| `requests` | Media downloads |
| `sqlite3` | Local database |
| `json` | Data serialization |

---

## Offers & Products for Research Keywords

| Product | Keywords to Research |
|---------|---------------------|
| **EverReach App Kit** | app templates, mobile app starter, react native template, app development |
| **SteadyLetters** | handwritten mail, direct mail marketing, letter automation |
| **VelvetHold** | reservation deposits, no-show prevention, booking deposits |
| **MediaPoster** | social media automation, content scheduling, multi-platform posting |
| **VelloPad** | book publishing, print on demand, self publishing |
| **SnapMix** | DJ tools, music sharing, track sharing |

---

## Risk & Mitigation

| Risk | Mitigation |
|------|------------|
| Facebook blocks automated browsing | Rate limiting, human-like delays, session rotation |
| DOM selectors break | Selector config file, multiple fallbacks, selector health checks |
| Media download blocked (CDN auth) | Download while on page, use cookies, fallback to screenshots |
| Rate limiting / CAPTCHAs | Exponential backoff, session pause, manual intervention hook |
| Data staleness | Scheduled re-scrape, TTL on cached data |
