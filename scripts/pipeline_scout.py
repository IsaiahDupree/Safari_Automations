#!/usr/bin/env python3
"""
pipeline_scout.py — Stage 1: Scout Agent
Keyword search → top posts → top creators → engager pool
Uses existing market research API (port 3106) and DM services.

Run:
    python3 pipeline_scout.py --keyword "ai automation" --platform twitter
    python3 pipeline_scout.py --all-keywords          # runs all active keywords
"""
import json, sys, time, argparse, urllib.request, urllib.error, urllib.parse, os

sys.path.insert(0, os.path.dirname(__file__))
from pipeline_db import upsert_prospects, upsert_creators, log_run, get_active_keywords

MARKET_RESEARCH_URL = os.environ.get("MARKET_RESEARCH_URL", "http://localhost:3106")
COMMENT_SERVICES = {
    "twitter":   "http://localhost:3007",
    "instagram": "http://localhost:3005",
    "tiktok":    "http://localhost:3006",
    "threads":   "http://localhost:3004",
}

def http_get(url, timeout=30):
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return json.loads(r.read()), None
    except Exception as e:
        return None, str(e)[:100]


def http_post(url, body, timeout=60):
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        url, data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read()), None
    except urllib.error.HTTPError as e:
        return None, f"HTTP {e.code}: {e.read().decode()[:100]}"
    except Exception as e:
        return None, str(e)[:100]


def search_platform(platform, keyword, max_posts=50):
    """Hit the market research API (POST) to find top posts + creators for a keyword."""
    url = f"{MARKET_RESEARCH_URL}/api/research/{platform}/search"
    body = {"query": keyword, "config": {"maxPosts": max_posts}}
    data, err = http_post(url, body, timeout=90)
    if err:
        print(f"  ⚠️  Market research error ({platform}/{keyword}): {err}")
        return []
    posts = data.get("posts", []) if data else []
    print(f"  📊 {platform}/{keyword}: {len(posts)} posts found")
    return posts


def extract_engagers_from_posts(platform, posts, max_per_post=20):
    """From top posts, find people who engaged (commenters/repliers)."""
    engagers = []
    for post in posts[:10]:  # top 10 posts only
        post_url = post.get("url") or post.get("postUrl", "")
        author = post.get("author") or post.get("handle", "")
        if not post_url:
            continue
        # Use comment service to get engagers on this post
        svc = COMMENT_SERVICES.get(platform)
        if not svc:
            continue
        try:
            req_url = f"{svc}/api/comments?postUrl={urllib.parse.quote(post_url)}&limit={max_per_post}"
            data, err = http_get(req_url, timeout=20)
            if data:
                comments = data.get("comments", [])
                for c in comments:
                    handle = c.get("username") or c.get("author", "")
                    if handle and handle != author:
                        engagers.append({
                            "platform": platform,
                            "handle": handle.lstrip("@"),
                            "display_name": c.get("displayName") or handle,
                            "discovery_surface": "commenter",
                            "source_post_url": post_url,
                            "source_author": author,
                        })
        except Exception:
            pass
        time.sleep(0.5)
    return engagers


def build_prospect_from_creator(platform, creator):
    """Convert a top creator record into a prospect candidate."""
    handle = creator.get("handle", "").lstrip("@")
    return {
        "platform": platform,
        "handle": handle,
        "display_name": creator.get("displayName") or creator.get("name") or handle,
        "audience_size": int(creator.get("followers") or creator.get("followerCount") or 0),
        "avg_engagement": float(creator.get("engagementRate") or creator.get("totalEngagement") or 0),
        "discovery_surface": "top_creator",
        "top_posts_count": int(creator.get("postCount") or 0),
        "niche": creator.get("niche", ""),
    }


def run_scout(platform, keyword, dry_run=False):
    """Full scout run: search → extract creators + engagers → store prospects."""
    print(f"\n🔍 Scouting [{platform}] keyword: '{keyword}'")
    run_id = log_run("scout", platform=platform, keyword=keyword)

    posts = search_platform(platform, keyword)
    if not posts:
        log_run("scout", platform=platform, keyword=keyword, run_id=run_id,
                errors=[f"No posts found for {keyword}"])
        return 0

    # Extract top creators from posts
    creator_handles = {}
    for p in posts:
        author = (p.get("author") or p.get("handle", "")).lstrip("@")
        if author:
            if author not in creator_handles:
                creator_handles[author] = {
                    "handle": author,
                    "display_name": p.get("authorName") or author,
                    "platform": platform,
                    "niche": keyword,
                    "total_engagement": 0,
                    "post_count": 0,
                }
            creator_handles[author]["total_engagement"] += (
                int(p.get("likes") or 0) + int(p.get("comments") or 0) +
                int(p.get("shares") or 0) * 2
            )
            creator_handles[author]["post_count"] += 1

    creators = list(creator_handles.values())
    # Sort by engagement, take top 20
    creators.sort(key=lambda c: c["total_engagement"], reverse=True)
    top_creators = creators[:20]
    print(f"  👑 {len(top_creators)} top creators identified")

    if not dry_run:
        upsert_creators(top_creators)

    # Build prospects from creators (people to befriend + pitch)
    prospects = []
    for c in top_creators:
        p = {
            "display_name": c["display_name"],
            "discovered_via_platform": platform,
            "discovered_via_keyword": keyword,
            "discovered_via_creator": None,
            "discovery_surface": "top_creator",
            "niche": keyword,
            "stage": "DISCOVERED",
        }
        p[f"{platform}_handle"] = c["handle"]
        prospects.append(p)

    # Extract engagers (commenters on top posts)
    engagers = extract_engagers_from_posts(platform, posts)
    print(f"  💬 {len(engagers)} engagers extracted from top posts")

    for e in engagers:
        p = {
            "display_name": e["display_name"],
            "discovered_via_platform": platform,
            "discovered_via_keyword": keyword,
            "discovered_via_creator": e.get("source_author"),
            "discovery_surface": "commenter",
            "niche": keyword,
            "stage": "DISCOVERED",
        }
        p[f"{platform}_handle"] = e["handle"]
        prospects.append(p)

    total = len(prospects)
    print(f"  📋 {total} total prospects to add (creators + engagers)")

    if not dry_run and prospects:
        n, err = upsert_prospects(prospects)
        if err:
            print(f"  ❌ Upsert error: {err}")
        else:
            print(f"  ✅ {n} prospects upserted to Supabase")

    log_run("scout", platform=platform, keyword=keyword, run_id=run_id,
            prospects_found=total)
    return total


def main():
    import urllib.parse
    parser = argparse.ArgumentParser(description="Pipeline Scout — find leads from keyword search")
    parser.add_argument("--keyword", help="Keyword to search")
    parser.add_argument("--platform", default="twitter",
                        choices=["twitter", "instagram", "tiktok", "threads"])
    parser.add_argument("--all-keywords", action="store_true",
                        help="Run all active keywords from pipeline_keywords table")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if args.all_keywords:
        keywords = get_active_keywords()
        print(f"Running {len(keywords)} active keywords...")
        for kw in keywords:
            run_scout(kw["platform"] or args.platform, kw["keyword"],
                      dry_run=args.dry_run)
            time.sleep(2)
    elif args.keyword:
        run_scout(args.platform, args.keyword, dry_run=args.dry_run)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
