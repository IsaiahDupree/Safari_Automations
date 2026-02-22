---
description: Run market research on Facebook and Instagram, scrape top posts, rank by engagement, and generate ad briefs
---

## Market Research Pipeline

All commands run from project root: `/Users/isaiahdupree/Documents/Software/Safari Automation`

### Prerequisites
1. Be logged into Facebook in Safari (navigate to facebook.com and click Continue → log in)
2. Be logged into Instagram in Safari
3. Backend optional (not required for research)

---

## Creative Radar — EverReach (Full Offer Analysis)

Combines Ad Library ads + Facebook organic posts + Instagram hashtag posts → tags by awareness stage → ranks with confidence scoring → extracts patterns → generates briefs → downloads media.

```bash
# Full pipeline (scrape all 3 connectors + analyze)
python3 python/market_research/creative_radar.py everreach --max-ads 30

# Full pipeline WITH media download for top 25 posts
python3 python/market_research/creative_radar.py everreach --skip-discover --download-media

# Skip scraping, analyze existing data only
python3 python/market_research/creative_radar.py everreach --skip-discover

# Download media only (images + videos for top N scored posts via Safari)
python3 python/market_research/creative_radar.py everreach --download-only --top-n 25

# Report only (no re-analysis)
python3 python/market_research/creative_radar.py everreach --report-only
```

Output at: `~/market-research/creative-radar/everreach/`
- `scored_posts.json` — all posts with scores, confidence, reuse_style, why_it_ranked
- `patterns.json` — hook templates, scroll stoppers, proof styles
- `awareness_briefs.json` — 5 Schwartz awareness-stage briefs
- `media/` — downloaded images + videos for top posts

---

## Facebook Organic Search (Requires Safari Login)

Safari automation navigates to facebook.com/search, extracts posts with engagement data.

```bash
# Single keyword search
python3 python/market_research/run_facebook.py search "adult friendships drifting" --max-posts 20

# Batch search (multiple keywords)
python3 python/market_research/run_facebook.py batch \
  --keywords "ADHD friendship,reconnect with old friends,how to maintain friendships as an adult,I forget to text back" \
  --max-per-keyword 15 --download-top 3

# View status of all scraped keywords
python3 python/market_research/run_facebook.py status

# Generate report for a keyword
python3 python/market_research/run_facebook.py report "adult friendships drifting"
```

---

## Instagram Hashtag Search (Requires Safari Login)

Safari automation navigates to instagram.com/explore/tags/, extracts grid posts. Use `--detail` to click into each post for full caption + engagement.

```bash
# Single hashtag search
python3 python/market_research/run_instagram.py search adultfriendships --type hashtag --max-posts 20

# With detail scraping (clicks into each post for full captions + likes)
python3 python/market_research/run_instagram.py search socialanxiety --type hashtag --max-posts 15 --detail --download-top 5

# Batch hashtag search
python3 python/market_research/run_instagram.py batch \
  --keywords "adultfriendships,socialanxiety,personalcrm,communicationtips,attachmentstyle,adhdfriendship" \
  --max-per-keyword 20 --download-top 3

# View status
python3 python/market_research/run_instagram.py status
```

---

## Experiment Runner — Creative Radar → Sora Content Pipeline

Converts Creative Radar awareness briefs into Sora video prompts, saves as a batch for the Sora content generator.

```bash
# Preview prompts for EverReach (default)
npx tsx scripts/creative-radar-experiment.ts

# Generate 2 variants per awareness stage
npx tsx scripts/creative-radar-experiment.ts --variants 2

# Target specific stages only
npx tsx scripts/creative-radar-experiment.ts --stages unaware,problem_aware

# For a different offer (must run Creative Radar pipeline first)
npx tsx scripts/creative-radar-experiment.ts --offer velvethold

# Actually generate Sora videos from the briefs
npx tsx scripts/creative-radar-experiment.ts --generate

# View experiment history
npx tsx scripts/creative-radar-experiment.ts --status
```

After preview, the batch is saved at `~/sora-videos/generated/current-batch.json`. To generate:
```bash
npx tsx scripts/sora-content-generator.ts --from-batch --generate
```

---

## Multi-Offer Support

Available OfferSpecs: `everreach`, `steadyletters`, `velvethold`, `snapmix`

```bash
# Run Creative Radar for any offer (scrape + analyze)
python3 python/market_research/creative_radar.py steadyletters --max-ads 30
python3 python/market_research/creative_radar.py velvethold --skip-discover
python3 python/market_research/creative_radar.py snapmix --skip-discover

# Generate Sora experiments for any offer
npx tsx scripts/creative-radar-experiment.ts --offer steadyletters --variants 2
```

---

## Daily Research Pipeline (One Command — Start Here)

Runs the full pipeline: scrape Ad Library → generate reports → generate all ad briefs.

```bash
# Full run (scrape + reports + briefs)
python3 python/market_research/daily_research.py

# Skip scraping, regenerate briefs from existing data
python3 python/market_research/daily_research.py --skip-scrape

# Custom ad count
python3 python/market_research/daily_research.py --max-ads 50
```

### Schedule via API (port 3010)
```bash
# Run once now
curl -X POST http://localhost:3010/api/research/daily \
  -H "Content-Type: application/json" -d '{"maxAds": 30}'

# Schedule recurring (7 days at 8am)
curl -X POST http://localhost:3010/api/research/daily/recurring \
  -H "Content-Type: application/json" -d '{"days": 7, "hour": 8, "maxAds": 30}'
```

---

## Meta Ad Library (No Login Required — Start Here)

The Ad Library is public and works immediately without any Safari login.

### Single keyword search
```bash
python3 python/market_research/meta_ad_library_cli.py search "social media automation" --max-ads 30
```

### Batch search (all products at once)
```bash
python3 python/market_research/meta_ad_library_cli.py batch \
  --keywords "social media automation,direct mail marketing,no-show appointments,mobile app templates,book publishing platform,handwritten letters marketing" \
  --max-per-keyword 30 --download-top 5
```

### Analyze competitor patterns
```bash
python3 python/market_research/meta_ad_library_cli.py analyze "direct mail marketing"
```

### Generate markdown competitor report
```bash
python3 python/market_research/meta_ad_library_cli.py report "direct mail marketing"
```

### Status
```bash
python3 python/market_research/meta_ad_library_cli.py status
```

---

## Dashboard (Terminal UI)

```bash
# Overview — all keywords, data counts, briefs
python3 python/market_research/dashboard.py

# Top competitor hooks for a keyword
python3 python/market_research/dashboard.py --hooks "social media automation"

# Competitor analysis (advertisers, CTAs, media format, hashtags)
python3 python/market_research/dashboard.py --competitors "direct mail marketing"

# View a generated ad brief
python3 python/market_research/dashboard.py --brief "social media automation" mediaposter
python3 python/market_research/dashboard.py --brief "direct mail marketing" steadyletters
python3 python/market_research/dashboard.py --brief "no-show appointments" velvethold
python3 python/market_research/dashboard.py --brief "mobile app templates" everreach-app-kit
```

---

## Facebook Research

### Single keyword search
```bash
python3 python/market_research/run_facebook.py search "automation tools" --max-posts 50
```

### Search with filters
```bash
python3 python/market_research/run_facebook.py search "no-show clients" --type videos --date this_week
```

### Batch search (multiple keywords)
```bash
python3 python/market_research/run_facebook.py batch --keywords "automation tools,saas tools,no code apps,direct mail marketing" --max-per-keyword 50 --download-top 10
```

### View ranked results
```bash
python3 python/market_research/run_facebook.py rank "automation tools" --top 20
```

### Generate markdown report
```bash
python3 python/market_research/run_facebook.py report "automation tools"
```

### Status
```bash
python3 python/market_research/run_facebook.py status
```

---

## Instagram Research

### Hashtag search
```bash
python3 python/market_research/run_instagram.py search automation --type hashtag --max-posts 50
```

### Keyword search
```bash
python3 python/market_research/run_instagram.py search "automation tools" --type keyword
```

### With detail scraping (clicks into each post for full stats — slower)
```bash
python3 python/market_research/run_instagram.py search automation --detail --max-posts 30
```

### Batch hashtag research
```bash
python3 python/market_research/run_instagram.py batch --keywords "automation,saas,nocode,directmail,noshows" --type hashtag
```

### Report
```bash
python3 python/market_research/run_instagram.py report automation
```

---

## Ad Intelligence

### List available products
```bash
python3 python/market_research/run_ad_intelligence.py products
```

Available product keys:
- `mediaposter` — MediaPoster (social media automation)
- `everreach-app-kit` — EverReach App Kit (mobile app templates)
- `steadyletters` — SteadyLetters (AI handwritten mail)
- `velvethold` — VelvetHold (no-show prevention)

### Generate ad brief from existing research data
```bash
python3 python/market_research/run_ad_intelligence.py brief "automation tools" --product mediaposter --platform facebook
```

### Full pipeline: scrape + analyze + generate brief
```bash
python3 python/market_research/run_ad_intelligence.py pipeline \
  --keywords "automation tools,social media automation" \
  --product mediaposter \
  --platforms facebook,instagram
```

### Skip scraping (use existing data)
```bash
python3 python/market_research/run_ad_intelligence.py pipeline \
  --keywords "automation tools" \
  --product mediaposter \
  --skip-scrape
```

### List all generated briefs
```bash
python3 python/market_research/run_ad_intelligence.py briefs
```

---

## Scheduler API (port 3010)

### Schedule Meta Ad Library research (no login required)
```bash
curl -X POST http://localhost:3010/api/research/ad-library \
  -H "Content-Type: application/json" \
  -d '{"keywords": ["social media automation", "direct mail marketing", "no-show appointments"], "maxAds": 30, "downloadTop": 5}'
```

### Schedule Facebook research
```bash
curl -X POST http://localhost:3010/api/research/facebook/search \
  -H "Content-Type: application/json" \
  -d '{"keywords": ["automation tools", "saas tools", "no code"], "maxPosts": 50, "downloadTop": 10}'
```

### Schedule Instagram research
```bash
curl -X POST http://localhost:3010/api/research/instagram/search \
  -H "Content-Type: application/json" \
  -d '{"keywords": ["automation", "saas", "nocode"], "searchType": "hashtag", "maxPosts": 50}'
```

### Schedule ad brief generation
```bash
curl -X POST http://localhost:3010/api/research/ad-brief \
  -H "Content-Type: application/json" \
  -d '{"keyword": "automation tools", "product": "mediaposter", "platform": "facebook"}'
```

### Research status
```bash
curl http://localhost:3010/api/research/status
```

---

## Storage Layout

All data stored at `~/market-research/`:
```
~/market-research/
├── facebook/
│   ├── posts/{keyword}/posts.json       # All scraped posts
│   ├── posts/{keyword}/ranked.json      # Sorted by engagement score
│   ├── media/{keyword}/                 # Downloaded images + videos
│   └── reports/YYYY-MM-DD-{keyword}.md  # Markdown reports
├── instagram/
│   ├── posts/{keyword}/posts.json
│   ├── posts/{keyword}/ranked.json
│   ├── media/{keyword}/
│   └── reports/
├── ad-briefs/
│   ├── YYYY-MM-DD-{keyword}-{product}.json  # Machine-readable brief
│   └── YYYY-MM-DD-{keyword}-{product}.md    # Human-readable brief
└── research.db                              # SQLite for queries
```

---

## Recommended Research Keywords by Product

| Product | Facebook Keywords | Instagram Hashtags |
|---------|------------------|--------------------|
| MediaPoster | social media automation, content scheduling | automation, socialmediamarketing |
| EverReach App Kit | mobile app templates, react native starter | appdev, mobileapp, reactnative |
| SteadyLetters | direct mail marketing, handwritten letters | directmail, mailmarketing |
| VelvetHold | no-show clients, booking deposits | noshows, appointmentbooking |

---

## Full Daily Research Workflow

```bash
# 1. Research all products on Facebook
python3 python/market_research/run_facebook.py batch \
  --keywords "social media automation,direct mail marketing,no-show clients,mobile app templates" \
  --max-per-keyword 50 --download-top 10

# 2. Research on Instagram
python3 python/market_research/run_instagram.py batch \
  --keywords "automation,directmail,noshows,appdev" \
  --type hashtag --max-per-keyword 50

# 3. Generate ad briefs for each product
python3 python/market_research/run_ad_intelligence.py brief "social media automation" --product mediaposter --skip-scrape
python3 python/market_research/run_ad_intelligence.py brief "direct mail marketing" --product steadyletters --skip-scrape
python3 python/market_research/run_ad_intelligence.py brief "no-show clients" --product velvethold --skip-scrape

# 4. Review briefs
python3 python/market_research/run_ad_intelligence.py briefs
```
