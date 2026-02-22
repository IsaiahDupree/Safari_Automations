#!/usr/bin/env python3
"""
Daily Market Research Runner

Runs the full pipeline in one command:
  1. Meta Ad Library batch search (no login required)
  2. Generate competitor reports
  3. Generate ad briefs for all products
  4. Print dashboard summary

Usage:
  python3 python/market_research/daily_research.py
  python3 python/market_research/daily_research.py --skip-scrape   # use existing data
  python3 python/market_research/daily_research.py --max-ads 50
"""
import sys, os
_python_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_to_remove = [p for p in sys.path if os.path.realpath(p) == os.path.realpath(_python_dir)]
for p in _to_remove: sys.path.remove(p)
import asyncio, subprocess
sys.path.insert(0, _python_dir)

import argparse
from datetime import datetime
from loguru import logger

from market_research.meta_ad_library import MetaAdLibraryScraper
from market_research.ad_intelligence import AdBriefGenerator, PRODUCTS

# ── Research config ──

KEYWORD_PRODUCT_MAP = [
    ("social media automation",       "mediaposter"),
    ("direct mail marketing",         "steadyletters"),
    ("handwritten letters marketing", "steadyletters"),
    ("no-show appointments",          "velvethold"),
    ("mobile app templates",          "everreach-app-kit"),
    ("book publishing platform",      "vellopad"),
    ("mobile crm app",                "everreach-expo-crm"),
    ("dj music sharing app",          "snapmix"),
    ("market research tool",          "gapradar"),
]

ALL_KEYWORDS = list({kw for kw, _ in KEYWORD_PRODUCT_MAP})


def run_scrape(max_ads: int = 30, download_top: int = 5):
    logger.info(f"\n{'═'*60}")
    logger.info(f"📚 STEP 1: Meta Ad Library Batch Search")
    logger.info(f"{'═'*60}")

    scraper = MetaAdLibraryScraper()
    summary = scraper.batch_search(
        keywords=ALL_KEYWORDS,
        max_per_keyword=max_ads,
        download_top=download_top,
        active_only=True,
        country="US",
    )
    return summary


def run_reports():
    logger.info(f"\n{'═'*60}")
    logger.info(f"📝 STEP 2: Generate Competitor Reports")
    logger.info(f"{'═'*60}")

    scraper = MetaAdLibraryScraper()
    report_paths = []
    for kw in ALL_KEYWORDS:
        path = scraper.generate_report(kw)
        if path:
            logger.info(f"  ✅ {kw} → {path}")
            report_paths.append(path)
    return report_paths


def run_briefs():
    logger.info(f"\n{'═'*60}")
    logger.info(f"💡 STEP 3: Generate Ad Briefs")
    logger.info(f"{'═'*60}")

    gen = AdBriefGenerator()
    briefs = []
    for keyword, product_key in KEYWORD_PRODUCT_MAP:
        if product_key not in PRODUCTS:
            logger.warning(f"  Unknown product: {product_key}")
            continue
        logger.info(f"  Generating brief: '{keyword}' × {product_key}")
        brief = gen.generate(keyword, product_key, platform="facebook")
        if brief:
            hook = brief.get("primary_hook", "")
            logger.info(f"  ✅ Hook: {hook[:80]}")
            briefs.append(brief)
        else:
            logger.warning(f"  ⚠️  No data for '{keyword}' — skipping")
    return briefs


def print_summary(scrape_summary: dict, briefs: list):
    print(f"\n{'═'*70}")
    print(f"  🎯  DAILY MARKET RESEARCH COMPLETE — {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    print(f"{'═'*70}")

    total_ads = scrape_summary.get("total_ads", 0)
    print(f"\n  📊 Scraped: {total_ads} competitor ads across {len(ALL_KEYWORDS)} keywords")

    print(f"\n  💡 Ad Briefs Generated: {len(briefs)}")
    for b in briefs:
        kw = b.get("keyword", "?")
        prod = b.get("product", "?")
        hook = b.get("primary_hook", "?")
        print(f"\n    {kw} × {prod}")
        print(f"    Hook: {hook[:90]}")

    print(f"\n  📁 All data at: ~/market-research/")
    print(f"\n  Quick review:")
    print(f"    python3 python/market_research/dashboard.py")
    print(f"    python3 python/market_research/dashboard.py --competitors \"social media automation\"")
    print(f"    python3 python/market_research/dashboard.py --brief \"social media automation\" mediaposter")
    print(f"\n{'═'*70}")


def main():
    parser = argparse.ArgumentParser(description="Daily Market Research Pipeline")
    parser.add_argument("--skip-scrape", action="store_true", help="Skip scraping, use existing data")
    parser.add_argument("--max-ads", type=int, default=30, help="Max ads per keyword (default 30)")
    parser.add_argument("--download-top", type=int, default=5, help="Download media for top N ads")
    args = parser.parse_args()

    start = datetime.now()
    logger.info(f"🚀 Daily Market Research — {start.strftime('%Y-%m-%d %H:%M')}")

    scrape_summary = {"total_ads": 0}

    if not args.skip_scrape:
        scrape_summary = run_scrape(max_ads=args.max_ads, download_top=args.download_top)
    else:
        logger.info("⏭️  Skipping scrape (--skip-scrape)")

    run_reports()
    briefs = run_briefs()
    print_summary(scrape_summary, briefs)

    elapsed = (datetime.now() - start).seconds
    logger.info(f"\n⏱️  Total time: {elapsed}s")


if __name__ == "__main__":
    main()
