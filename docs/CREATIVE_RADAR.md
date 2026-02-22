# Creative Radar — Safari-Automated Market Research System

**Version:** 1.0.0  
**Date:** February 2026  
**Status:** Production  

---

## Overview

Creative Radar is a Safari-automated market research pipeline that programmatically searches Facebook and Instagram for keywords and hashtags, scrapes top-performing posts, ranks them by offer-fit and engagement, downloads their media, and converts the findings into Sora video content briefs.

The system is **offer-agnostic** — a single `OfferSpec` config drives the entire pipeline for any product.

---

## Architecture

```
OfferSpec Config
      │
      ▼
┌─────────────────────────────────────────────────────┐
│  DISCOVERY LAYER (3 Safari Connectors)              │
│  ┌──────────────┐ ┌──────────────┐ ┌─────────────┐ │
│  │ Meta Ad Lib  │ │ FB Organic   │ │ IG Hashtags │ │
│  │ (no login)   │ │ (Safari+JS)  │ │ (Safari+JS) │ │
│  └──────────────┘ └──────────────┘ └─────────────┘ │
└─────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────┐
│  ANALYSIS PIPELINE                                  │
│  ContentTagger → RankingEngine → PatternMiner       │
│  (awareness stage, hook type, pain point, CTA)      │
└─────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────┐
│  OUTPUTS                                            │
│  • scored_posts.json  (ranked + confidence)         │
│  • patterns.json      (hooks, scroll stoppers)      │
│  • awareness_briefs.json (5 Schwartz stages)        │
│  • media/             (downloaded images + videos)  │
└─────────────────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────────────────┐
│  EXPERIMENT RUNNER                                  │
│  Briefs → Sora Video Prompts → Content Pipeline     │
└─────────────────────────────────────────────────────┘
```

---

## Files

| File | Purpose |
|------|---------|
| `python/market_research/creative_radar.py` | Core pipeline: OfferSpecs, ContentTagger, RankingEngine, PatternMiner, BriefGenerator, MediaDownloader |
| `python/market_research/facebook_scraper.py` | Safari automation for FB organic search |
| `python/market_research/instagram_scraper.py` | Safari automation for IG hashtag + detail scraping |
| `python/market_research/meta_ad_library.py` | Meta Ad Library scraper (public, no login required) |
| `python/market_research/run_facebook.py` | CLI entry point for Facebook scraper |
| `python/market_research/run_instagram.py` | CLI entry point for Instagram scraper |
| `scripts/creative-radar-experiment.ts` | Converts Creative Radar briefs → Sora video prompts |

---

## Data Inventory (Feb 2026)

| Source | Posts | Notes |
|--------|-------|-------|
| Meta Ad Library | 178 | 21 keyword searches |
| Facebook Organic | 233 | 16 keywords via Safari |
| Instagram Hashtags | 240+ | 12 hashtags, 4 with detail scraping |
| **Total** | **650+** | |

**Media downloaded:** 295 files (112MB) — images + videos for top posts

---

## OfferSpecs

The system supports 4 offers out of the box. Add more by extending `OFFER_SPECS` in `creative_radar.py`.

| Key | Product | ICP |
|-----|---------|-----|
| `everreach` | EverReach — Personal CRM | Adults 22-45 losing touch with people |
| `steadyletters` | SteadyLetters — Physical mail SaaS | Small businesses, real estate, e-commerce |
| `velvethold` | VelvetHold — Deposit-based booking | Hairstylists, tattoo artists, service providers |
| `snapmix` | SnapMix — Ephemeral music sharing | DJs, producers, music curators |

Each OfferSpec includes:
- **ICP** — who it's for
- **JTBD** — job-to-be-done
- **Pains + Objections** — what stops them
- **Transformation** — the "after" state
- **Mechanism** — the unique "how"
- **search_keywords** — categorized keyword lists for FB search
- **hashtags** — IG hashtags the ICP follows
- **awareness_hooks** — 5 Schwartz stages with hooks + scripts + CTAs
- **FATE framework** — Familiarity, Authority, Trust, Emotion

---

## Pipeline Components

### 1. ContentTagger
Classifies each post with:
- **Awareness stage** — unaware / problem_aware / solution_aware / product_aware / most_aware
- **Hook type** — question / personal_story / stat_number / contrast / curiosity / command / social_proof / emotional
- **Pain points** — drift / guilt / overwhelm / awkward / system / ADHD / etc.
- **CTA pattern** — save / comment / follow / download / trial

### 2. RankingEngine
Multi-objective score:
```
Total = 0.35×Fit + 0.25×Performance + 0.15×Format + 0.15×Repeatability − 0.10×Risk
```
Plus per-post outputs:
- **Confidence score** (0–1) — data completeness + metric reliability + fit strength
- **Reuse style** — `angle_clone` / `structure_remix` / `reference_only` / `not_recommended`
- **Why it ranked** — human-readable explanation

### 3. PatternMiner
Extracts reusable primitives from top posts:
- Hook templates (by stage + fit score)
- Scroll stoppers
- Proof styles
- CTA patterns
- Awareness stage distribution

### 4. BriefGenerator
Produces 5 awareness-stage briefs, each with:
- Primary hook
- Script beats
- CTA
- Competitor hooks (from scraped data)
- Recommended format

### 5. MediaDownloader
Safari navigates to each top-ranked post URL, injects JavaScript to extract `scontent` CDN image/video URLs, downloads up to 5 media files per post.

---

## Commands

### Creative Radar Pipeline

```bash
# Full pipeline — scrape all 3 sources + analyze + download media
python3 python/market_research/creative_radar.py everreach --download-media

# Skip scraping, analyze existing data only (fast)
python3 python/market_research/creative_radar.py everreach --skip-discover

# Download media only for top 25 posts
python3 python/market_research/creative_radar.py everreach --download-only --top-n 25

# Print report only
python3 python/market_research/creative_radar.py everreach --report-only

# Run for a different offer
python3 python/market_research/creative_radar.py steadyletters --max-ads 30
```

### Facebook Organic Search

```bash
# Single keyword
python3 python/market_research/run_facebook.py search "adult friendships drifting" --max-posts 20

# Batch search
python3 python/market_research/run_facebook.py batch \
  --keywords "ADHD friendship,reconnect with old friends,how to maintain friendships as an adult" \
  --max-per-keyword 15 --download-top 3

# Status
python3 python/market_research/run_facebook.py status
```

### Instagram Hashtag Search

```bash
# Single hashtag (with detail scraping for full captions + engagement)
python3 python/market_research/run_instagram.py search adultfriendships \
  --type hashtag --max-posts 15 --detail --download-top 5

# Batch
python3 python/market_research/run_instagram.py batch \
  --keywords "adultfriendships,socialanxiety,adhdfriendship,attachmentstyle" \
  --max-per-keyword 20 --download-top 3

# Status
python3 python/market_research/run_instagram.py status
```

### Experiment Runner (Briefs → Sora Videos)

```bash
# Preview prompts (saves batch, no generation)
npx tsx scripts/creative-radar-experiment.ts --offer everreach --variants 2

# Target specific awareness stages
npx tsx scripts/creative-radar-experiment.ts --stages unaware,problem_aware

# Actually generate Sora videos
npx tsx scripts/creative-radar-experiment.ts --generate

# View experiment history
npx tsx scripts/creative-radar-experiment.ts --status --offer everreach

# Then generate from saved batch
npx tsx scripts/sora-content-generator.ts --from-batch --generate
```

---

## Data Locations

```
~/market-research/
├── creative-radar/
│   └── {offer}/
│       ├── scored_posts.json       # All posts with scores + confidence + reuse_style
│       ├── patterns.json           # Hook templates, scroll stoppers, proof styles
│       ├── awareness_briefs.json   # 5 Schwartz awareness-stage briefs
│       ├── experiments.json        # Experiment history (briefs → Sora batches)
│       └── media/                  # Downloaded images + videos for top posts
├── facebook/
│   └── posts/{keyword-slug}/
│       └── ranked.json
├── instagram/
│   └── posts/{hashtag}/
│       ├── ranked.json
│       └── media/
└── meta-ad-library/
    └── ads/{keyword-slug}/
        ├── ads.json
        └── media/
```

---

## Prerequisites

1. **Safari logged into Facebook** — navigate to facebook.com, log in
2. **Safari logged into Instagram** — navigate to instagram.com, log in
3. **Python dependencies** — `pip install loguru requests`
4. **Node.js** — for the experiment runner (`npx tsx`)

The Ad Library scraper requires no login (public data).

---

## How It Works (Safari Automation)

All scraping uses **AppleScript + JavaScript injection** into Safari's logged-in session:

1. AppleScript activates Safari and navigates to the target URL
2. JavaScript is injected via `do JavaScript` to query the DOM
3. Results are returned as JSON strings and parsed in Python
4. Media URLs are extracted from `scontent` CDN patterns
5. Files are downloaded with `requests` using Safari's session cookies

This approach:
- Uses your real logged-in session (no API keys needed)
- Respects the natural page load (no headless browser detection)
- Works with any page Safari can render

---

## Extending the System

### Add a new OfferSpec

In `creative_radar.py`, add to `OFFER_SPECS`:

```python
"myproduct": {
    "name": "My Product",
    "tagline": "...",
    "icp": [...],
    "jtbd": [...],
    "pains": [...],
    "objections": [...],
    "transformation": [...],
    "mechanism": "...",
    "features": [...],
    "search_keywords": { "category": ["keyword1", ...] },
    "hashtags": ["#tag1", ...],
    "awareness_hooks": {
        "unaware": { "hook": "...", "goal": "...", "cta": "...", "script": [...] },
        # ... 4 more stages
    },
    "fate": { "familiarity": "...", "authority": "...", "trust": "...", "emotion": "..." },
}
```

Then run:
```bash
python3 python/market_research/creative_radar.py myproduct --max-ads 30
```
