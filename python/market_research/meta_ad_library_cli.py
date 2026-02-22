#!/usr/bin/env python3
"""CLI entry point for Meta Ad Library scraper."""
import sys, os
_python_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_to_remove = [p for p in sys.path if os.path.realpath(p) == os.path.realpath(_python_dir)]
for p in _to_remove: sys.path.remove(p)
import asyncio, subprocess
sys.path.insert(0, _python_dir)

import argparse
from market_research.meta_ad_library import MetaAdLibraryScraper


def main():
    parser = argparse.ArgumentParser(description="Meta Ad Library Scraper — no login required")
    sub = parser.add_subparsers(dest="command")

    s = sub.add_parser("search", help="Search Meta Ad Library")
    s.add_argument("keyword")
    s.add_argument("--max-ads", type=int, default=50)
    s.add_argument("--country", default="US")
    s.add_argument("--all-status", action="store_true")
    s.add_argument("--download-top", type=int, default=5)

    b = sub.add_parser("batch", help="Batch search multiple keywords")
    b.add_argument("--keywords", required=True)
    b.add_argument("--max-per-keyword", type=int, default=30)
    b.add_argument("--country", default="US")
    b.add_argument("--download-top", type=int, default=5)
    b.add_argument("--all-status", action="store_true")

    a = sub.add_parser("analyze", help="Analyze scraped ads")
    a.add_argument("keyword")

    r = sub.add_parser("report", help="Generate markdown report")
    r.add_argument("keyword")

    sub.add_parser("status", help="Show all researched keywords")

    args = parser.parse_args()
    scraper = MetaAdLibraryScraper()

    if args.command == "search":
        ads = scraper.search(
            args.keyword,
            max_ads=args.max_ads,
            active_only=not args.all_status,
            country=args.country,
        )
        if ads:
            scraper.download_media(ads, args.keyword, top_n=args.download_top)
            scraper.save_ads(ads, args.keyword)
            print(f"\n✅ {len(ads)} ads scraped for '{args.keyword}'")
            print(f"\n📊 Top 5 advertisers:")
            analysis = scraper.analyze_ads(args.keyword)
            for name, count in analysis.get("top_advertisers", [])[:5]:
                print(f"  • {name} ({count} ads)")
            print(f"\n🎯 Top hooks:")
            for hook in analysis.get("top_hooks", [])[:3]:
                print(f"  → {hook[:100]}")

    elif args.command == "batch":
        keywords = [k.strip() for k in args.keywords.split(",")]
        scraper.batch_search(
            keywords,
            max_per_keyword=args.max_per_keyword,
            active_only=not args.all_status,
            download_top=args.download_top,
            country=args.country,
        )

    elif args.command == "analyze":
        analysis = scraper.analyze_ads(args.keyword)
        if not analysis:
            print(f"No data for '{args.keyword}'. Run a search first.")
            return
        print(f"\n📊 Ad Analysis: '{args.keyword}'")
        print(f"  Total ads: {analysis['total_ads']} | Advertisers: {analysis['unique_advertisers']}")
        print(f"\n  Top advertisers:")
        for name, count in analysis["top_advertisers"][:8]:
            print(f"    • {name} ({count})")
        print(f"\n  Top hooks:")
        for hook in analysis["top_hooks"][:5]:
            print(f"    → {hook[:100]}")
        print(f"\n  CTAs: {', '.join(c for c, _ in analysis['top_ctas'][:5])}")
        media = analysis["media_breakdown"]
        print(f"  Media: 🎥 {media['video']} video | 🖼️ {media['image']} image | 📝 {media['text_only']} text")

    elif args.command == "report":
        path = scraper.generate_report(args.keyword)
        if path:
            print(f"\n📝 Report: {path}")

    elif args.command == "status":
        scraper.show_status()

    else:
        parser.print_help()


if __name__ == "__main__":
    main()
