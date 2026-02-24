# PRD: Medium Monetization Engine

## Overview
Maximize revenue from 1,200+ published Medium stories by tracking earnings, strategically applying paywalls to top-performing content, and batch-optimizing SEO across all stories.

## Problem
- 1,200+ published stories with no systematic monetization strategy
- No visibility into which stories drive earnings vs which are free with high traffic
- SEO titles/descriptions are unoptimized, leaving Google traffic on the table
- Manual paywall toggling is impractical at scale

## Features

### 1. Earnings Tracker
- Scrape `/me/stats` for daily/weekly/monthly earnings breakdown
- Track earnings per story over time
- Store historical earnings data in `~/.medium-automation/earnings/`
- Identify top earners and revenue trends

### 2. Strategic Paywall Analyzer
- Pull stats (views, reads, read ratio, fans) for all published stories
- Score each story: `paywall_score = views * read_ratio * recency_weight`
- Auto-identify candidates for paywall based on:
  - High views + high read ratio = paywall (people want to read it)
  - Low views + any ratio = keep free (needs discovery)
  - Old + high cumulative views = paywall (evergreen)
- Generate recommendations: "Paywall these 50 stories", "Keep these 200 free"
- One-click batch execution of recommendations

### 3. SEO Batch Optimizer
- Crawl all published story settings pages
- Extract current SEO title + description
- Flag stories with missing/poor SEO (too long, no keywords, generic)
- Generate optimized SEO titles (40-50 chars, keyword-rich) and descriptions (140-156 chars)
- Batch-apply SEO updates via Safari automation on settings pages

### 4. Revenue Dashboard API
- `GET /api/medium/monetization/earnings` — current earnings summary
- `GET /api/medium/monetization/analyze` — paywall recommendations
- `POST /api/medium/monetization/execute` — apply recommendations
- `GET /api/medium/monetization/seo/audit` — SEO audit results
- `POST /api/medium/monetization/seo/optimize` — batch apply SEO fixes

## Data Storage
- `~/.medium-automation/earnings/daily-{date}.json`
- `~/.medium-automation/earnings/story-earnings.json`
- `~/.medium-automation/seo/audit-{date}.json`
- `~/.medium-automation/paywall/recommendations-{date}.json`

## Technical Approach
- Safari automation via existing MediumSafariDriver
- Scroll-and-scrape for bulk story data
- Settings page automation for SEO updates
- Rate-limited operations (3s delay between story interactions)

## Success Metrics
- Revenue increase from strategic paywalling
- SEO traffic increase from optimized titles/descriptions
- Time saved vs manual management

## Dependencies
- Medium Partner Program enrollment (confirmed: Enrolled)
- Existing Medium automation package (port 3107)
- Safari logged into Medium

## Priority: HIGH
## Status: Building
