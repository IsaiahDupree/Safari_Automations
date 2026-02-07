# PRD: Competitor Research & Analytics System
**Date:** February 5, 2026  
**Status:** 📋 PLANNED  
**Priority:** High  
**Platforms:** Instagram, TikTok, Twitter/X, Threads, LinkedIn

---

## Overview

A comprehensive competitor research and analytics system that enables deep analysis of competitor accounts across all major social platforms. Uses Safari automation to extract profile data, content performance metrics, follower/following lists, and engagement patterns for competitive intelligence.

---

## Goals

1. **Profile Analytics** - Extract detailed profile data and metrics from competitor accounts
2. **Content Analysis** - Analyze posting frequency, content types, and engagement rates
3. **Follower Intelligence** - Scrape and analyze follower/following lists for lead generation
4. **Engagement Tracking** - Monitor competitor post performance over time
5. **Comparison Dashboard** - Side-by-side competitor benchmarking
6. **Lead Discovery** - Identify high-value prospects from competitor audiences

---

## Current State (Gaps)

| Feature | Instagram | TikTok | Twitter | Threads | LinkedIn |
|---------|-----------|--------|---------|---------|----------|
| Content scraping | ✅ Basic | ⚠️ Partial | ❌ | ❌ | ❌ |
| Profile data | ⚠️ Basic | ✅ Stats | ⚠️ Basic | ❌ | ❌ |
| Follower list | ❌ | ❌ | ❌ | ❌ | ❌ |
| Following list | ❌ | ❌ | ❌ | ❌ | ❌ |
| Engagement metrics | ❌ | ❌ | ❌ | ❌ | ❌ |
| Historical tracking | ❌ | ❌ | ❌ | ❌ | ❌ |
| Comparison tools | ❌ | ❌ | ❌ | ❌ | ❌ |

---

## Features

### Phase 1: Profile Data Extraction

#### 1.1 Universal Profile Interface
```typescript
interface CompetitorProfile {
  platform: 'instagram' | 'tiktok' | 'twitter' | 'threads' | 'linkedin';
  username: string;
  displayName: string;
  bio: string;
  profileUrl: string;
  avatarUrl?: string;
  
  // Metrics
  followers: number;
  following: number;
  postsCount: number;
  
  // Platform-specific
  platformMetrics: PlatformSpecificMetrics;
  
  // Metadata
  isVerified: boolean;
  isBusinessAccount: boolean;
  category?: string;
  externalUrl?: string;
  
  // Tracking
  scrapedAt: Date;
}

interface PlatformSpecificMetrics {
  // Instagram
  igReelsCount?: number;
  
  // TikTok
  tiktokLikes?: number;
  tiktokVideos?: number;
  
  // Twitter
  twitterMediaCount?: number;
  twitterListedCount?: number;
  twitterJoinedDate?: Date;
  
  // LinkedIn
  linkedinConnections?: number;
  linkedinEndorsements?: number;
}
```

#### 1.2 Profile Scraping Functions
```typescript
// Universal interface
scrapeProfile(platform: Platform, username: string): Promise<CompetitorProfile>

// Platform-specific implementations
scrapeInstagramProfile(username: string): Promise<CompetitorProfile>
scrapeTikTokProfile(username: string): Promise<CompetitorProfile>
scrapeTwitterProfile(username: string): Promise<CompetitorProfile>
scrapeThreadsProfile(username: string): Promise<CompetitorProfile>
scrapeLinkedInProfile(username: string): Promise<CompetitorProfile>
```

### Phase 2: Follower/Following List Extraction

#### 2.1 Follower Data
```typescript
interface FollowerEntry {
  username: string;
  displayName: string;
  profileUrl: string;
  bio?: string;
  followers?: number;
  isVerified: boolean;
  
  // For lead scoring
  engagementIndicators?: {
    recentlyActive: boolean;
    hasWebsite: boolean;
    isBusinessAccount: boolean;
  };
}

interface FollowerListResult {
  platform: Platform;
  targetUsername: string;
  type: 'followers' | 'following';
  entries: FollowerEntry[];
  totalCount: number;
  scrapedCount: number;
  hasMore: boolean;
  scrapedAt: Date;
}
```

#### 2.2 Follower Scraping
```typescript
interface FollowerScrapeConfig {
  platform: Platform;
  username: string;
  type: 'followers' | 'following';
  limit?: number;              // Max to scrape (default: 1000)
  filterVerified?: boolean;    // Only verified accounts
  minFollowers?: number;       // Minimum follower count
  resumeFrom?: string;         // Resume from cursor/position
}

scrapeFollowers(config: FollowerScrapeConfig): Promise<FollowerListResult>

// Incremental scraping with persistence
startFollowerScrape(config: FollowerScrapeConfig): Promise<ScrapeJobId>
getFollowerScrapeStatus(jobId: string): Promise<ScrapeJobStatus>
resumeFollowerScrape(jobId: string): Promise<FollowerListResult>
```

#### 2.3 Rate Limits for Follower Scraping
```typescript
const FOLLOWER_SCRAPE_LIMITS = {
  instagram: {
    profilesPerHour: 60,
    followersPerProfile: 200,   // Before pagination delay
    delayBetweenScrolls: 2000,
  },
  tiktok: {
    profilesPerHour: 30,
    followersPerProfile: 100,
    delayBetweenScrolls: 3000,
  },
  twitter: {
    profilesPerHour: 50,
    followersPerProfile: 200,
    delayBetweenScrolls: 2000,
  },
};
```

### Phase 3: Content & Engagement Analysis

#### 3.1 Post Data
```typescript
interface CompetitorPost {
  platform: Platform;
  postId: string;
  postUrl: string;
  authorUsername: string;
  
  // Content
  type: 'photo' | 'video' | 'reel' | 'carousel' | 'text' | 'thread';
  caption: string;
  hashtags: string[];
  mentions: string[];
  mediaUrls?: string[];
  
  // Engagement
  likes: number;
  comments: number;
  shares?: number;
  saves?: number;
  views?: number;
  
  // Timing
  postedAt: Date;
  scrapedAt: Date;
  
  // Calculated
  engagementRate?: number;
}
```

#### 3.2 Engagement Metrics
```typescript
interface EngagementAnalysis {
  username: string;
  platform: Platform;
  period: 'week' | 'month' | 'quarter';
  
  // Aggregate metrics
  totalPosts: number;
  totalLikes: number;
  totalComments: number;
  totalViews?: number;
  
  // Averages
  avgLikesPerPost: number;
  avgCommentsPerPost: number;
  avgEngagementRate: number;
  
  // Patterns
  postingFrequency: number;  // Posts per week
  bestPostingDays: string[];
  bestPostingTimes: string[];
  topHashtags: { tag: string; count: number; avgEngagement: number }[];
  
  // Content breakdown
  contentMix: {
    type: string;
    count: number;
    avgEngagement: number;
  }[];
}

analyzeEngagement(platform: Platform, username: string, period: string): Promise<EngagementAnalysis>
```

### Phase 4: Historical Tracking

#### 4.1 Profile Snapshots
```typescript
interface ProfileSnapshot {
  id: string;
  platform: Platform;
  username: string;
  snapshotAt: Date;
  
  followers: number;
  following: number;
  posts: number;
  
  // Deltas from previous snapshot
  followersDelta?: number;
  followingDelta?: number;
  postsDelta?: number;
}

// Track changes over time
scheduleProfileTracking(platform: Platform, username: string, interval: 'daily' | 'weekly'): Promise<void>
getProfileHistory(platform: Platform, username: string, days: number): Promise<ProfileSnapshot[]>
```

#### 4.2 Growth Analysis
```typescript
interface GrowthAnalysis {
  username: string;
  platform: Platform;
  period: { start: Date; end: Date };
  
  followerGrowth: {
    absolute: number;
    percentage: number;
    avgPerDay: number;
  };
  
  engagementTrend: 'increasing' | 'stable' | 'decreasing';
  postingTrend: 'increasing' | 'stable' | 'decreasing';
  
  milestones: {
    date: Date;
    event: string;  // "Reached 10K followers"
  }[];
}
```

### Phase 5: Competitor Comparison

#### 5.1 Comparison Interface
```typescript
interface CompetitorComparison {
  competitors: CompetitorProfile[];
  comparedAt: Date;
  
  rankings: {
    byFollowers: string[];     // Usernames sorted
    byEngagement: string[];
    byGrowth: string[];
    byPostingFrequency: string[];
  };
  
  insights: {
    leader: string;
    fastestGrowing: string;
    mostEngaged: string;
    recommendations: string[];
  };
}

compareCompetitors(
  platform: Platform, 
  usernames: string[]
): Promise<CompetitorComparison>
```

#### 5.2 Benchmark Against Self
```typescript
interface BenchmarkResult {
  myProfile: CompetitorProfile;
  competitors: CompetitorProfile[];
  
  benchmarks: {
    metric: string;
    myValue: number;
    competitorAvg: number;
    percentile: number;  // Where I rank
    gap: number;
  }[];
  
  recommendations: string[];
}

benchmarkAgainstCompetitors(
  myUsername: string,
  competitorUsernames: string[],
  platform: Platform
): Promise<BenchmarkResult>
```

### Phase 6: Lead Discovery from Competitors

#### 6.1 Lead Qualification
```typescript
interface LeadFromCompetitor {
  username: string;
  platform: Platform;
  source: {
    competitorUsername: string;
    sourceType: 'follower' | 'engager' | 'commenter';
  };
  
  // Qualification
  score: number;
  qualificationFactors: {
    followerCount: number;
    engagementLevel: 'high' | 'medium' | 'low';
    accountType: 'personal' | 'business' | 'creator';
    relevanceScore: number;
  };
  
  // Actionable
  canDM: boolean;
  recommendedAction: 'dm' | 'follow' | 'engage' | 'skip';
}
```

#### 6.2 Lead Discovery Functions
```typescript
interface LeadDiscoveryConfig {
  platform: Platform;
  competitorUsername: string;
  source: 'followers' | 'recent_engagers' | 'commenters';
  filters: {
    minFollowers?: number;
    maxFollowers?: number;
    mustBeBusinessAccount?: boolean;
    mustHaveWebsite?: boolean;
    keywords?: string[];  // In bio
  };
  limit: number;
}

discoverLeads(config: LeadDiscoveryConfig): Promise<LeadFromCompetitor[]>
```

---

## API Endpoints

### Profile Scraping
```
GET  /api/research/profile/:platform/:username       - Scrape profile
GET  /api/research/profile/:platform/:username/posts - Get recent posts
POST /api/research/profile/batch                     - Scrape multiple profiles
```

### Follower Lists
```
POST /api/research/followers/start    - Start follower scrape job
GET  /api/research/followers/:jobId   - Get job status
GET  /api/research/followers/:jobId/results - Get scraped followers
POST /api/research/following/start    - Start following scrape job
```

### Analytics
```
GET  /api/research/analytics/:platform/:username      - Get engagement analysis
GET  /api/research/analytics/:platform/:username/history - Get historical data
POST /api/research/compare                            - Compare competitors
POST /api/research/benchmark                          - Benchmark against competitors
```

### Lead Discovery
```
POST /api/research/leads/discover     - Discover leads from competitors
GET  /api/research/leads/queue        - Get qualified leads queue
POST /api/research/leads/:id/action   - Mark lead action taken
```

---

## Database Schema

```sql
-- Competitor profiles
CREATE TABLE competitor_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform TEXT NOT NULL,
  username TEXT NOT NULL,
  display_name TEXT,
  bio TEXT,
  followers INTEGER,
  following INTEGER,
  posts_count INTEGER,
  is_verified BOOLEAN DEFAULT FALSE,
  is_business BOOLEAN DEFAULT FALSE,
  platform_metrics JSONB,
  scraped_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(platform, username)
);

-- Profile history for tracking
CREATE TABLE profile_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID REFERENCES competitor_profiles(id),
  followers INTEGER,
  following INTEGER,
  posts_count INTEGER,
  snapshot_at TIMESTAMPTZ DEFAULT NOW()
);

-- Follower lists
CREATE TABLE competitor_followers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID REFERENCES competitor_profiles(id),
  follower_username TEXT NOT NULL,
  follower_display_name TEXT,
  follower_bio TEXT,
  follower_count INTEGER,
  is_verified BOOLEAN DEFAULT FALSE,
  scraped_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(profile_id, follower_username)
);

-- Competitor posts
CREATE TABLE competitor_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID REFERENCES competitor_profiles(id),
  post_id TEXT NOT NULL,
  post_url TEXT,
  post_type TEXT,
  caption TEXT,
  hashtags TEXT[],
  likes INTEGER,
  comments INTEGER,
  shares INTEGER,
  views INTEGER,
  posted_at TIMESTAMPTZ,
  scraped_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(profile_id, post_id)
);

-- Scrape jobs
CREATE TABLE scrape_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type TEXT NOT NULL,
  platform TEXT NOT NULL,
  target_username TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  progress INTEGER DEFAULT 0,
  total_expected INTEGER,
  error TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Discovered leads
CREATE TABLE discovered_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform TEXT NOT NULL,
  username TEXT NOT NULL,
  source_competitor TEXT,
  source_type TEXT,
  lead_score INTEGER,
  qualification_data JSONB,
  status TEXT DEFAULT 'new',
  action_taken TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(platform, username)
);
```

---

## Package Structure

```
packages/competitor-research/
├── src/
│   ├── api/
│   │   ├── server.ts
│   │   └── client.ts
│   ├── scrapers/
│   │   ├── instagram-scraper.ts
│   │   ├── tiktok-scraper.ts
│   │   ├── twitter-scraper.ts
│   │   ├── threads-scraper.ts
│   │   └── linkedin-scraper.ts
│   ├── analyzers/
│   │   ├── engagement-analyzer.ts
│   │   ├── growth-analyzer.ts
│   │   └── comparison-engine.ts
│   ├── discovery/
│   │   ├── lead-discoverer.ts
│   │   └── lead-scorer.ts
│   ├── jobs/
│   │   ├── job-manager.ts
│   │   └── follower-scrape-job.ts
│   ├── db/
│   │   └── repositories.ts
│   └── types.ts
├── package.json
└── tsconfig.json
```

---

## Implementation Timeline

| Phase | Features | Effort | Priority |
|-------|----------|--------|----------|
| **Phase 1** | Profile scraping (all platforms) | 3 days | High |
| **Phase 2** | Follower/following scraping | 4 days | High |
| **Phase 3** | Content & engagement analysis | 2 days | Medium |
| **Phase 4** | Historical tracking | 2 days | Medium |
| **Phase 5** | Competitor comparison | 1 day | Medium |
| **Phase 6** | Lead discovery | 2 days | High |

**Total Estimated Effort:** 14-16 days

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Profile scrape success rate | >95% |
| Follower scrape completion | >80% of requested |
| Data freshness | <24 hours |
| Lead qualification accuracy | >70% |
| Insights actionability | User satisfaction |

---

**Created:** February 5, 2026  
**Status:** Ready for development
