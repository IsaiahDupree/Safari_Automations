# PRD: Medium Engagement Automation

## Overview
Growth-hack Medium audience by automating strategic engagement — clapping, responding, following, and highlighting in target niches to drive profile visits and followers.

## Problem
- Building a Medium audience requires consistent engagement with other writers
- Manual clapping/responding across niches is time-consuming
- No systematic follow/unfollow strategy for growth
- Missing opportunities to be visible in popular article discussions

## Features

### 1. Niche Engagement Bot
- Define target niches (AI, SaaS, personal branding, tech entrepreneurship)
- Auto-discover trending articles in each niche via search + tag pages
- Strategically clap (10-50 claps) on high-visibility articles
- Post thoughtful responses on top articles (AI-generated, niche-relevant)
- Rate-limited: max 20 claps/hr, 5 responses/hr, respect Medium's limits
- Track engagement history to avoid repeat interactions

### 2. Follow/Unfollow Strategy
- Identify high-value authors in target niches (follower count, posting frequency)
- Auto-follow relevant authors (max 20/day)
- Track follow-back rate over 7 days
- Optional: unfollow non-reciprocators after grace period
- Maintain a whitelist of always-follow authors

### 3. Highlight Strategy
- Read popular articles in target niches
- Highlight key passages (visible to followers in their feed)
- Increases profile visibility without being spammy
- Track which highlights drive the most profile visits

### 4. Engagement Analytics
- Track engagement actions over time
- Correlate engagement with follower growth
- Identify which niches and strategies drive best ROI
- Weekly engagement report

## API Endpoints
- `POST /api/medium/engage/auto-clap` — run clap session in a niche
- `POST /api/medium/engage/auto-respond` — respond to top articles
- `POST /api/medium/engage/follow-session` — follow authors in niche
- `GET /api/medium/engage/stats` — engagement analytics
- `POST /api/medium/engage/campaign` — run full engagement campaign

## Rate Limits (Conservative)
- Claps: 20 articles/hour, 100/day
- Responses: 5/hour, 20/day
- Follows: 20/day, 80/week
- Active hours: 8am-10pm (configurable)
- Random delays: 30-90s between actions

## Data Storage
- `~/.medium-automation/engagement/actions-{date}.json`
- `~/.medium-automation/engagement/follow-tracker.json`
- `~/.medium-automation/engagement/niche-config.json`

## Dependencies
- Existing Medium automation package (port 3107)
- OpenAI API for generating thoughtful responses (OPENAI_API_KEY)

## Priority: MEDIUM
## Status: PRD Complete — Not Started
