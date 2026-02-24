# PRD: Medium Analytics Dashboard

## Overview
Aggregate stats across all 1,200+ published stories into a comprehensive analytics system — track growth trends, identify top content patterns, and report on earnings over time.

## Problem
- Medium's built-in stats page shows limited data and no historical trends
- No way to see aggregate performance across 1,200+ stories at once
- Can't identify content patterns (topics, lengths, posting times) that drive results
- No historical earnings tracking — only current period visible

## Features

### 1. Story-Level Stats Aggregator
- Crawl stats for all published stories (views, reads, read ratio, fans)
- Store historical snapshots: daily, weekly, monthly
- Identify top performers by views, reads, fans, and read ratio
- Flag declining stories (were performing, now stagnant)

### 2. Growth Tracker
- Track total followers over time
- Track total views/reads/fans per period
- Calculate growth rates (week-over-week, month-over-month)
- Detect growth spikes and correlate with publishing activity

### 3. Content Pattern Analysis
- Categorize stories by topic/tag
- Analyze which topics drive most engagement
- Optimal article length analysis (word count vs read ratio)
- Best publishing day/time patterns
- Title pattern analysis (what hooks work)

### 4. Earnings Reporter
- Daily earnings snapshots
- Revenue per story tracking
- Revenue per topic/niche breakdown
- Paywall vs free performance comparison
- Monthly revenue trend and projection

### 5. Dashboard API
- `GET /api/medium/analytics/overview` — aggregate stats summary
- `GET /api/medium/analytics/stories?sort=views&limit=50` — ranked story list
- `GET /api/medium/analytics/growth?period=30d` — growth metrics
- `GET /api/medium/analytics/patterns` — content pattern analysis
- `GET /api/medium/analytics/earnings?period=monthly` — earnings report
- `POST /api/medium/analytics/snapshot` — trigger a new data collection

### 6. Automated Reporting
- Weekly email-ready summary (JSON or markdown)
- Top 10 stories this week
- New followers gained
- Revenue earned
- Recommendations for next week

## Data Storage
- `~/.medium-automation/analytics/snapshots/{date}.json`
- `~/.medium-automation/analytics/stories-cache.json`
- `~/.medium-automation/analytics/earnings-history.json`
- `~/.medium-automation/analytics/growth-log.json`

## Technical Approach
- Batch crawl story stats via Safari (rate-limited, ~2s per story)
- Full crawl of 1,200 stories = ~40 min (can run overnight via scheduler)
- Incremental updates: only re-crawl stories published in last 30 days + top performers
- Cache story data locally to avoid re-crawling unchanged stories

## Dependencies
- Existing Medium automation package (port 3107)
- Safari Task Scheduler (port 3010) for automated collection
- Story stats endpoints already built

## Priority: MEDIUM
## Status: PRD Complete — Not Started
