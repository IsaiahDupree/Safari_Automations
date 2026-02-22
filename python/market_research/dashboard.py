#!/usr/bin/env python3
"""
Market Research Dashboard — terminal overview of all scraped data,
competitor ads, and generated ad briefs.

Usage:
  python3 python/market_research/dashboard.py
  python3 python/market_research/dashboard.py --brief "social media automation" mediaposter
  python3 python/market_research/dashboard.py --hooks "social media automation"
  python3 python/market_research/dashboard.py --competitors "direct mail marketing"
"""
import sys, os
_python_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_to_remove = [p for p in sys.path if os.path.realpath(p) == os.path.realpath(_python_dir)]
for p in _to_remove: sys.path.remove(p)
import asyncio, subprocess
sys.path.insert(0, _python_dir)

import json
import re
import argparse
from pathlib import Path
from datetime import datetime
from typing import List, Dict

RESEARCH_BASE = Path(os.path.expanduser("~/market-research"))

# ── ANSI colors ──
BOLD   = "\033[1m"
DIM    = "\033[2m"
RESET  = "\033[0m"
CYAN   = "\033[96m"
GREEN  = "\033[92m"
YELLOW = "\033[93m"
RED    = "\033[91m"
BLUE   = "\033[94m"
MAGENTA = "\033[95m"
WHITE  = "\033[97m"

def hr(char="═", width=70, color=CYAN):
    return f"{color}{char * width}{RESET}"

def header(title: str, color=CYAN):
    print(hr(color=color))
    print(f"{color}{BOLD}  {title}{RESET}")
    print(hr(color=color))

def section(title: str, color=YELLOW):
    print(f"\n{color}{BOLD}── {title} ──{RESET}")


# ── Data loaders ──

def load_ad_library(keyword: str) -> List[dict]:
    slug = keyword.lower().replace(" ", "-")
    f = RESEARCH_BASE / "meta-ad-library" / "ads" / slug / "ads.json"
    return json.load(open(f)) if f.exists() else []

def load_organic_posts(keyword: str, platform: str = "facebook") -> List[dict]:
    slug = keyword.lower().replace(" ", "-")
    for fname in ["ranked.json", "posts.json"]:
        f = RESEARCH_BASE / platform / "posts" / slug / fname
        if f.exists():
            return json.load(open(f))
    return []

def load_brief(keyword: str, product: str) -> dict:
    slug = keyword.lower().replace(" ", "-")
    # Find most recent brief
    briefs_dir = RESEARCH_BASE / "ad-briefs"
    if not briefs_dir.exists():
        return {}
    pattern = f"*-{slug}-{product}.json"
    matches = sorted(briefs_dir.glob(pattern), reverse=True)
    if matches:
        return json.load(open(matches[0]))
    return {}

def list_all_keywords() -> Dict[str, dict]:
    """Return all researched keywords with counts."""
    result = {}

    # Ad Library
    ad_lib_dir = RESEARCH_BASE / "meta-ad-library" / "ads"
    if ad_lib_dir.exists():
        for kw_dir in sorted(ad_lib_dir.iterdir()):
            f = kw_dir / "ads.json"
            if f.exists():
                ads = json.load(open(f))
                kw = kw_dir.name.replace("-", " ")
                result.setdefault(kw, {})["ad_library"] = len(ads)

    # Facebook organic
    fb_dir = RESEARCH_BASE / "facebook" / "posts"
    if fb_dir.exists():
        for kw_dir in sorted(fb_dir.iterdir()):
            for fname in ["ranked.json", "posts.json"]:
                f = kw_dir / fname
                if f.exists():
                    posts = json.load(open(f))
                    kw = kw_dir.name.replace("-", " ")
                    result.setdefault(kw, {})["facebook"] = len(posts)
                    break

    # Instagram organic
    ig_dir = RESEARCH_BASE / "instagram" / "posts"
    if ig_dir.exists():
        for kw_dir in sorted(ig_dir.iterdir()):
            for fname in ["ranked.json", "posts.json"]:
                f = kw_dir / fname
                if f.exists():
                    posts = json.load(open(f))
                    kw = kw_dir.name.replace("-", " ")
                    result.setdefault(kw, {})["instagram"] = len(posts)
                    break

    return result

def list_all_briefs() -> List[dict]:
    briefs_dir = RESEARCH_BASE / "ad-briefs"
    if not briefs_dir.exists():
        return []
    briefs = []
    for f in sorted(briefs_dir.glob("*.json"), reverse=True):
        try:
            b = json.load(open(f))
            briefs.append(b)
        except Exception:
            pass
    return briefs


# ── Views ──

def show_overview():
    """Main dashboard — all keywords, data counts, briefs."""
    header("📊  MARKET RESEARCH DASHBOARD")

    keywords = list_all_keywords()
    if not keywords:
        print(f"\n  {DIM}No research data yet. Run a search first.{RESET}")
        print(f"\n  {CYAN}Quick start:{RESET}")
        print(f"  python3 python/market_research/meta_ad_library_cli.py batch \\")
        print(f'    --keywords "social media automation,direct mail marketing" --max-per-keyword 30')
        return

    section("Research Data by Keyword")
    total_ads = 0
    total_posts = 0
    for kw, counts in keywords.items():
        ad_lib = counts.get("ad_library", 0)
        fb = counts.get("facebook", 0)
        ig = counts.get("instagram", 0)
        total_ads += ad_lib
        total_posts += fb + ig

        parts = []
        if ad_lib: parts.append(f"{GREEN}📚 {ad_lib} competitor ads{RESET}")
        if fb:     parts.append(f"{BLUE}📘 {fb} FB posts{RESET}")
        if ig:     parts.append(f"{MAGENTA}📸 {ig} IG posts{RESET}")

        print(f"\n  {BOLD}{WHITE}{kw}{RESET}")
        print(f"    {' | '.join(parts) if parts else DIM + 'no data' + RESET}")

    print(f"\n  {DIM}Total: {total_ads} competitor ads, {total_posts} organic posts{RESET}")

    # Briefs
    section("Generated Ad Briefs")
    briefs = list_all_briefs()
    if briefs:
        for b in briefs[:8]:
            kw = b.get("keyword", "?")
            prod = b.get("product_name", b.get("product_key", "?"))
            hook = b.get("primary_hook", b.get("hooks", ["?"])[0] if b.get("hooks") else "?")
            date = b.get("generated_at", "")[:10]
            print(f"\n  {BOLD}{GREEN}{kw}{RESET} × {CYAN}{prod}{RESET}  {DIM}({date}){RESET}")
            print(f"    Hook: {YELLOW}{hook[:90]}{RESET}")
    else:
        print(f"  {DIM}No briefs yet.{RESET}")

    # Reports
    section("Competitor Reports")
    reports_dir = RESEARCH_BASE / "meta-ad-library" / "reports"
    if reports_dir.exists():
        for r in sorted(reports_dir.glob("*.md"), reverse=True)[:6]:
            print(f"  {DIM}📄{RESET} {r.name}")
    else:
        print(f"  {DIM}No reports yet.{RESET}")

    print(f"\n{hr()}")
    print(f"  {DIM}Run with --hooks KEYWORD or --competitors KEYWORD or --brief KEYWORD PRODUCT{RESET}")
    print(hr())


def show_hooks(keyword: str):
    """Show top ad hooks for a keyword from all sources."""
    header(f"🎯  TOP HOOKS: \"{keyword}\"")

    hooks = []

    # From Ad Library
    ads = load_ad_library(keyword)
    if ads:
        section(f"Competitor Ad Hooks ({len(ads)} ads)", CYAN)
        for ad in ads:
            text = (ad.get("ad_text") or "").strip()
            if text:
                first_line = text.split("\n")[0].strip()
                if len(first_line) > 10:
                    advertiser = ad.get("advertiser_name", "?")
                    cta = ad.get("cta_text", "")
                    hooks.append(first_line)
                    print(f"\n  {BOLD}{WHITE}{advertiser}{RESET}  {DIM}[{cta}]{RESET}")
                    print(f"  {YELLOW}→ {first_line[:110]}{RESET}")
                    # Show more of the ad if interesting
                    rest = text[len(first_line):].strip()[:200]
                    if rest:
                        print(f"  {DIM}{rest[:100]}{RESET}")

    # From organic posts
    for platform in ["facebook", "instagram"]:
        posts = load_organic_posts(keyword, platform)
        if posts:
            section(f"Organic {platform.title()} Hooks ({len(posts)} posts)", BLUE if platform == "facebook" else MAGENTA)
            for p in posts[:10]:
                text = (p.get("text_content") or p.get("caption") or "").strip()
                if text:
                    first_line = text.split("\n")[0].strip()
                    if len(first_line) > 10:
                        author = p.get("author_name") or p.get("author_username") or "?"
                        reactions = p.get("reactions") or p.get("likes") or 0
                        print(f"\n  {BOLD}{WHITE}{author}{RESET}  {DIM}({reactions:,} reactions){RESET}")
                        print(f"  {YELLOW}→ {first_line[:110]}{RESET}")

    if not hooks and not ads:
        print(f"\n  {DIM}No data for '{keyword}'. Run a search first.{RESET}")

    print(f"\n{hr()}")


def show_competitors(keyword: str):
    """Show competitor analysis for a keyword."""
    ads = load_ad_library(keyword)
    if not ads:
        print(f"\n  {DIM}No Ad Library data for '{keyword}'. Run:{RESET}")
        print(f"  python3 python/market_research/meta_ad_library_cli.py search \"{keyword}\"")
        return

    header(f"🏢  COMPETITOR ANALYSIS: \"{keyword}\"")

    # Advertiser frequency
    advertisers: Dict[str, List[dict]] = {}
    for ad in ads:
        name = ad.get("advertiser_name", "")
        if name:
            advertisers.setdefault(name, []).append(ad)

    section(f"Advertisers ({len(advertisers)} unique)")
    for name, adv_ads in sorted(advertisers.items(), key=lambda x: len(x[1]), reverse=True)[:15]:
        count = len(adv_ads)
        has_video = sum(1 for a in adv_ads if a.get("has_video"))
        has_image = sum(1 for a in adv_ads if a.get("has_image") and not a.get("has_video"))
        ctas = list({a.get("cta_text", "") for a in adv_ads if a.get("cta_text")})
        url = adv_ads[0].get("advertiser_url", "")
        print(f"\n  {BOLD}{WHITE}{name}{RESET}  {DIM}({count} ads){RESET}")
        print(f"    Media: 🎥 {has_video} video  🖼️ {has_image} image")
        if ctas:
            print(f"    CTAs:  {', '.join(ctas[:3])}")
        if url:
            print(f"    URL:   {DIM}{url[:70]}{RESET}")

    # CTA breakdown
    section("CTA Distribution")
    cta_counts: Dict[str, int] = {}
    for ad in ads:
        cta = (ad.get("cta_text") or "").strip()
        if cta:
            cta_counts[cta] = cta_counts.get(cta, 0) + 1
    for cta, count in sorted(cta_counts.items(), key=lambda x: x[1], reverse=True)[:8]:
        bar = "█" * count
        print(f"  {CYAN}{cta:<20}{RESET} {bar} {count}")

    # Media breakdown
    has_video = sum(1 for a in ads if a.get("has_video"))
    has_image = sum(1 for a in ads if a.get("has_image") and not a.get("has_video"))
    text_only = len(ads) - has_video - has_image
    section("Media Format")
    total = max(len(ads), 1)
    print(f"  🎥 Video:     {has_video:3d}  ({has_video*100//total}%)")
    print(f"  🖼️  Image:     {has_image:3d}  ({has_image*100//total}%)")
    print(f"  📝 Text only: {text_only:3d}  ({text_only*100//total}%)")

    # Hashtags from ad text
    all_tags: Dict[str, int] = {}
    for ad in ads:
        text = ad.get("ad_text") or ""
        for tag in re.findall(r"#[\w\u00C0-\u024F]+", text):
            all_tags[tag.lower()] = all_tags.get(tag.lower(), 0) + 1
    if all_tags:
        section("Top Hashtags in Competitor Ads")
        for tag, count in sorted(all_tags.items(), key=lambda x: x[1], reverse=True)[:12]:
            print(f"  {MAGENTA}{tag}{RESET} ({count})")

    print(f"\n{hr()}")


def show_brief(keyword: str, product: str):
    """Show a generated ad brief."""
    brief = load_brief(keyword, product)
    if not brief:
        print(f"\n  {DIM}No brief for '{keyword}' × '{product}'. Generate with:{RESET}")
        print(f"  python3 python/market_research/run_ad_intelligence.py brief \"{keyword}\" --product {product}")
        return

    header(f"💡  AD BRIEF: \"{keyword}\" × {brief.get('product_name', product)}")

    print(f"\n  {BOLD}Product:{RESET}  {brief.get('product', brief.get('product_name', '?'))}")
    print(f"  {BOLD}Format:{RESET}   {brief.get('recommended_format', '?')} on {brief.get('recommended_platform', '?')}")
    print(f"  {BOLD}CTA:{RESET}      {brief.get('suggested_cta', brief.get('cta', '?'))}")
    print(f"  {BOLD}Audience:{RESET} {brief.get('target_audience', '?')}")

    section("Primary Hook")
    print(f"  {YELLOW}{BOLD}{brief.get('primary_hook', '?')}{RESET}")

    section("Hook Variations")
    for h in (brief.get("hooks") or [])[:5]:
        print(f"  {YELLOW}→ {h}{RESET}")

    section("Ad Captions")
    for i, cap in enumerate((brief.get("captions") or [])[:3], 1):
        print(f"\n  {BOLD}Caption {i}:{RESET}")
        print(f"  {cap[:300]}")

    section("Sora Video Prompt")
    sora = brief.get("sora_prompt") or brief.get("sora_video_prompt") or ""
    print(f"  {CYAN}{sora[:500]}{RESET}")

    section("Suggested Caption")
    caption = brief.get("suggested_caption") or ""
    print(f"  {caption[:400]}")

    section("Winning Patterns from Competitors")
    print(f"  Hook format:       {brief.get('winning_hook_format', '?')}")
    print(f"  Avg caption len:   {brief.get('avg_caption_length', 0):.0f} words")
    print(f"  Emoji usage:       {brief.get('emoji_usage_rate', 0):.0%}")
    ctas = brief.get('top_cta_patterns') or []
    if ctas:
        print(f"  Top CTAs:          {', '.join(ctas[:4])}")
    hashtags = brief.get('suggested_hashtags') or []
    if hashtags:
        print(f"  Hashtags:          {' '.join(hashtags[:8])}")

    print(f"\n{hr()}")


# ── Main ──

def main():
    parser = argparse.ArgumentParser(description="Market Research Dashboard")
    parser.add_argument("--hooks", metavar="KEYWORD", help="Show top hooks for a keyword")
    parser.add_argument("--competitors", metavar="KEYWORD", help="Show competitor analysis")
    parser.add_argument("--brief", nargs=2, metavar=("KEYWORD", "PRODUCT"), help="Show an ad brief")
    args = parser.parse_args()

    if args.hooks:
        show_hooks(args.hooks)
    elif args.competitors:
        show_competitors(args.competitors)
    elif args.brief:
        show_brief(args.brief[0], args.brief[1])
    else:
        show_overview()


if __name__ == "__main__":
    main()
