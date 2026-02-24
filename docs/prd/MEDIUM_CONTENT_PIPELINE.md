# PRD: Medium Content Pipeline Integration

## Overview
Automatically cross-post content from existing pipelines (tweets, Sora video descriptions, market research briefs, UGC scripts) into Medium articles, and manage 717 existing drafts.

## Problem
- Content created for Twitter, Sora, and market research never reaches Medium audience
- 717 drafts sitting unused — no systematic way to review, publish, or clean up
- Manual cross-posting is time-consuming and inconsistent

## Features

### 1. Auto Cross-Post from Existing Content
- **Twitter → Medium**: Take top-performing tweets (from feedback loop) and expand into short-form articles
- **Sora → Medium**: Use video captions, titles, and prompts as article seeds
- **Market Research → Medium**: Convert research briefs and pattern analyses into thought-leadership articles
- **UGC Scripts → Medium**: Repurpose video scripts as written content
- Template system: each source type maps to an article template

### 2. Draft Manager
- List all 717 drafts with metadata (title, created date, word count)
- Categorize drafts: publishable, needs-editing, stale (>30 days), empty
- Bulk actions: publish, delete, tag
- Smart publish: schedule draft publishing over time for consistent cadence

### 3. Content Calendar
- Schedule Medium posts alongside other platform content
- Integrate with Safari Task Scheduler (port 3010)
- Optimal posting times based on stats analysis
- Avoid publishing conflicts with other platform automation

### 4. Canonical URL Management
- When cross-posting, set canonical URLs to original source
- Prevent SEO duplicate content penalties
- Track which content exists on which platforms

## API Endpoints
- `POST /api/medium/pipeline/cross-post` — cross-post from source
- `GET /api/medium/pipeline/drafts` — list all drafts with metadata
- `POST /api/medium/pipeline/drafts/bulk-publish` — batch publish drafts
- `POST /api/medium/pipeline/drafts/bulk-delete` — batch delete stale drafts
- `POST /api/medium/pipeline/schedule` — schedule a post

## Data Storage
- `~/.medium-automation/pipeline/cross-post-log.json`
- `~/.medium-automation/pipeline/draft-audit.json`
- `~/.medium-automation/pipeline/schedule.json`

## Dependencies
- Existing Medium automation package (port 3107)
- Twitter Feedback Loop (port 3106) for tweet performance data
- Sora video catalog (`~/sora-videos/daily-pipeline-catalog.json`)
- Market Research data (`~/market-research/`)
- Safari Task Scheduler (port 3010)

## Priority: MEDIUM
## Status: PRD Complete — Not Started
