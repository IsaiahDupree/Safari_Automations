#!/usr/bin/env python3
"""
Instagram Market Research Scraper — Safari Automation

Searches Instagram by keyword and hashtag, extracts top organic posts,
scrapes engagement stats, ranks by performance, and stores data + media.

Search types:
  - Hashtag explore: instagram.com/explore/tags/{tag}/
  - Keyword search:  instagram.com/explore/search/keyword/{keyword}/
  - Profile reels:   instagram.com/{username}/reels/ (competitor research)
"""
import subprocess
import time
import json
import re
import os
import hashlib
import requests
import uuid
from pathlib import Path
from datetime import datetime
from typing import Optional, List, Dict
from urllib.parse import quote_plus
from loguru import logger

from market_research.models import ResearchSession
from market_research.storage import ResearchStorage

try:
    from automation.safari_session_manager import SafariSessionManager, Platform as SMPlatform
    HAS_SESSION_MANAGER = True
except ImportError:
    HAS_SESSION_MANAGER = False


# ── URL builders ──

IG_URLS = {
    "hashtag":  "https://www.instagram.com/explore/tags/{keyword}/",
    "keyword":  "https://www.instagram.com/explore/search/keyword/{keyword}/",
    "profile":  "https://www.instagram.com/{keyword}/",
    "reels":    "https://www.instagram.com/{keyword}/reels/",
}

# ── JavaScript extraction ──

JS_EXTRACT_IG_GRID = """
(function() {
    var posts = [];

    // Grid posts (hashtag/explore page)
    var gridLinks = document.querySelectorAll('article a[href*="/p/"], article a[href*="/reel/"]');
    if (gridLinks.length === 0) {
        gridLinks = document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]');
    }

    var seen = new Set();
    gridLinks.forEach(function(link) {
        var href = link.href || '';
        if (!href || seen.has(href)) return;
        seen.add(href);

        var post = { url: href, platform: 'instagram' };

        // Shortcode from URL
        var m = href.match(/\\/(?:p|reel)\\/([A-Za-z0-9_-]+)/);
        post.shortcode = m ? m[1] : '';
        post.content_type = href.includes('/reel/') ? 'reel' : 'image';

        // Try to get like/view count from aria-label on the link or img
        var img = link.querySelector('img');
        if (img) {
            post.thumbnail_url = img.src || '';
            post.alt_text = img.alt || '';
        }

        // Engagement from aria-label on the container
        var label = link.getAttribute('aria-label') || '';
        post.aria_label = label;

        // Try to parse likes/views from aria label
        var likeMatch = label.match(/([\\d,.]+[kKmM]?)\\s*like/i);
        var viewMatch = label.match(/([\\d,.]+[kKmM]?)\\s*view/i);
        post.likes_text = likeMatch ? likeMatch[1] : '';
        post.views_text = viewMatch ? viewMatch[1] : '';

        if (post.shortcode) posts.push(post);
    });

    return JSON.stringify(posts);
})();
"""

JS_EXTRACT_IG_POST_DETAIL = """
(function() {
    var data = {};

    // Caption
    var captionEl = document.querySelector('h1, div[data-testid="post-comment-root"] span, article div span');
    if (captionEl) data.caption = captionEl.innerText || '';

    // Author
    var authorEl = document.querySelector('header a[href*="/"], a[role="link"][href*="/"]');
    if (authorEl) {
        data.author_username = (authorEl.href || '').split('/').filter(Boolean).pop() || '';
        data.author_display = authorEl.innerText || '';
    }

    // Likes
    var likesEl = document.querySelector(
        'section span[class*="x193iq5w"], ' +
        'a[href*="/liked_by/"] span, ' +
        'button[type="button"] span span'
    );
    data.likes_text = likesEl ? likesEl.innerText : '';

    // Comments count
    var commentEls = document.querySelectorAll('ul li');
    data.comment_count = commentEls.length;

    // Video views
    var viewsEl = document.querySelector('span[class*="view"]');
    data.views_text = viewsEl ? viewsEl.innerText : '';

    // Timestamp
    var timeEl = document.querySelector('time[datetime], time');
    data.posted_at = timeEl ? (timeEl.getAttribute('datetime') || timeEl.innerText) : '';

    // Media
    data.media_urls = [];
    var videos = document.querySelectorAll('video');
    videos.forEach(function(v) { if (v.src) data.media_urls.push(v.src); });
    var imgs = document.querySelectorAll('article img[src*="scontent"]');
    imgs.forEach(function(img) {
        if (img.width > 100) data.media_urls.push(img.src);
    });

    // Hashtags from caption
    data.hashtags = [];
    if (data.caption) {
        var tags = data.caption.match(/#[\\w\\u00C0-\\u024F]+/g);
        if (tags) data.hashtags = tags;
    }

    // Content type
    data.content_type = videos.length > 0 ? 'reel' : 'image';

    return JSON.stringify(data);
})();
"""

JS_CHECK_IG_LOGIN = """
(function() {
    var loggedIn = document.querySelector('a[href*="/direct/inbox/"], svg[aria-label="New post"], a[href="/accounts/activity/"]');
    var loggedOut = document.querySelector('input[name="username"], a[href*="/accounts/login/"]');
    if (loggedOut) return 'logged_out';
    if (loggedIn) return 'logged_in';
    return 'unknown';
})();
"""

JS_GET_SCROLL_STATE = """
JSON.stringify({
    scrollHeight: document.documentElement.scrollHeight,
    articleCount: document.querySelectorAll('article a[href*="/p/"], article a[href*="/reel/"]').length,
    gridCount: document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]').length
});
"""


def _parse_ig_number(text: str) -> int:
    """Parse Instagram engagement numbers like '1.2K', '45.3K', '1M'."""
    if not text:
        return 0
    text = text.strip().replace(",", "")
    m = re.match(r"([\d.]+)\s*([kKmMbB]?)", text)
    if not m:
        return 0
    num = float(m.group(1))
    suffix = m.group(2).lower()
    if suffix == "k":
        num *= 1000
    elif suffix == "m":
        num *= 1_000_000
    elif suffix == "b":
        num *= 1_000_000_000
    return int(num)


class InstagramResearchScraper:
    """Safari-based Instagram market research scraper."""

    def __init__(
        self,
        delay: float = 3.0,
        scroll_pause: float = 2.5,
        max_scrolls: int = 20,
        detail_scrape: bool = False,
    ):
        self.delay = delay
        self.scroll_pause = scroll_pause
        self.max_scrolls = max_scrolls
        self.detail_scrape = detail_scrape  # Click into each post for full stats
        self.storage = ResearchStorage()

    # ── Safari Primitives ──

    def _run_applescript(self, script: str, timeout: int = 30) -> str:
        try:
            result = subprocess.run(
                ["osascript", "-e", script],
                capture_output=True, text=True, timeout=timeout,
            )
            return result.stdout.strip() if result.returncode == 0 else ""
        except Exception:
            return ""

    def _execute_js(self, js_code: str, timeout: int = 30) -> str:
        js_escaped = js_code.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")
        script = f'''
tell application "Safari"
    if (count of windows) > 0 then
        return do JavaScript "{js_escaped}" in front document
    end if
    return ""
end tell'''
        return self._run_applescript(script, timeout=timeout)

    def _navigate(self, url: str):
        script = f'''
tell application "Safari"
    activate
    if (count of windows) = 0 then make new document
    set URL of front document to "{url}"
end tell'''
        self._run_applescript(script)
        time.sleep(self.delay)

    def _scroll_down(self):
        self._execute_js("window.scrollBy(0, window.innerHeight * 0.85);")
        time.sleep(self.scroll_pause)

    def _get_current_url(self) -> str:
        script = '''
tell application "Safari"
    if (count of windows) > 0 then return URL of front document
    return ""
end tell'''
        return self._run_applescript(script)

    # ── Login ──

    def check_login(self) -> bool:
        current = self._get_current_url()
        if "instagram.com" not in current:
            self._navigate("https://www.instagram.com/")
            time.sleep(3)
        result = self._execute_js(JS_CHECK_IG_LOGIN)
        if result == "logged_in":
            logger.info("✅ Logged into Instagram")
            return True
        elif result == "logged_out":
            logger.warning("❌ Not logged into Instagram")
            return False
        logger.warning("⚠️  Instagram login state unknown — proceeding")
        return True

    # ── Search ──

    def _build_url(self, keyword: str, search_type: str) -> str:
        template = IG_URLS.get(search_type, IG_URLS["hashtag"])
        kw = quote_plus(keyword.lstrip("#"))
        return template.format(keyword=kw)

    def search_keyword(
        self,
        keyword: str,
        search_type: str = "hashtag",
        max_posts: int = 50,
    ) -> List[dict]:
        """
        Search Instagram for a keyword or hashtag.

        Args:
            keyword: Hashtag (without #) or keyword phrase
            search_type: hashtag, keyword, profile, reels
            max_posts: Max posts to collect

        Returns:
            List of post dicts ranked by engagement
        """
        logger.info(f"🔍 Searching Instagram [{search_type}]: '{keyword}' (max {max_posts})")

        url = self._build_url(keyword, search_type)
        self._navigate(url)
        time.sleep(4)

        current = self._get_current_url()
        if "instagram.com" not in current:
            logger.error("Not on Instagram — aborting")
            return []

        all_posts: List[dict] = []
        seen_shortcodes: set = set()
        no_new_count = 0
        prev_count = 0

        for scroll_num in range(self.max_scrolls):
            raw = self._execute_js(JS_EXTRACT_IG_GRID)
            if not raw:
                self._scroll_down()
                continue

            try:
                extracted = json.loads(raw)
            except json.JSONDecodeError:
                self._scroll_down()
                continue

            for item in extracted:
                sc = item.get("shortcode", "")
                if not sc or sc in seen_shortcodes:
                    continue
                seen_shortcodes.add(sc)

                post = {
                    "id": f"ig_{sc}",
                    "shortcode": sc,
                    "url": item.get("url", ""),
                    "platform": "instagram",
                    "content_type": item.get("content_type", "image"),
                    "thumbnail_url": item.get("thumbnail_url", ""),
                    "alt_text": item.get("alt_text", ""),
                    "likes": _parse_ig_number(item.get("likes_text", "")),
                    "views": _parse_ig_number(item.get("views_text", "")),
                    "keyword": keyword,
                    "search_type": search_type,
                    "scraped_at": datetime.now().isoformat(),
                    # Detail fields (populated if detail_scrape=True)
                    "caption": "",
                    "author_username": "",
                    "comments": 0,
                    "hashtags": [],
                    "posted_at": "",
                    "media_urls": [],
                    "local_media_paths": [],
                }
                all_posts.append(post)

            logger.info(f"  Scroll {scroll_num + 1}/{self.max_scrolls}: {len(all_posts)} posts")

            if len(all_posts) >= max_posts:
                logger.info(f"  ✅ Reached max posts ({max_posts})")
                break

            if len(all_posts) == prev_count:
                no_new_count += 1
                if no_new_count >= 5:
                    logger.info(f"  ⏹️  No new posts after {no_new_count} scrolls")
                    break
            else:
                no_new_count = 0
                prev_count = len(all_posts)

            self._scroll_down()

        # Optionally scrape detail pages for full stats
        if self.detail_scrape and all_posts:
            all_posts = self._scrape_details(all_posts[:max_posts])

        # Rank
        all_posts = self._rank_posts(all_posts, keyword)

        logger.info(f"✅ Found {len(all_posts)} posts for '{keyword}' [{search_type}]")
        return all_posts[:max_posts]

    def _scrape_details(self, posts: List[dict]) -> List[dict]:
        """Click into each post page to get full caption, likes, comments."""
        logger.info(f"📄 Scraping details for {len(posts)} posts...")
        for i, post in enumerate(posts):
            if not post.get("url"):
                continue
            logger.debug(f"  [{i+1}/{len(posts)}] {post['shortcode']}")
            self._navigate(post["url"])
            time.sleep(2)

            raw = self._execute_js(JS_EXTRACT_IG_POST_DETAIL)
            if not raw:
                continue
            try:
                detail = json.loads(raw)
                post["caption"] = detail.get("caption", "")
                post["author_username"] = detail.get("author_username", "")
                post["comments"] = detail.get("comment_count", 0)
                post["hashtags"] = detail.get("hashtags", [])
                post["posted_at"] = detail.get("posted_at", "")
                post["media_urls"] = detail.get("media_urls", [])
                if not post["likes"]:
                    post["likes"] = _parse_ig_number(detail.get("likes_text", ""))
                if not post["views"]:
                    post["views"] = _parse_ig_number(detail.get("views_text", ""))
            except Exception:
                pass

            time.sleep(1)

        return posts

    def _rank_posts(self, posts: List[dict], keyword: str) -> List[dict]:
        """Score and rank Instagram posts."""
        for post in posts:
            likes = post.get("likes", 0)
            comments = post.get("comments", 0)
            views = post.get("views", 0)
            shares = post.get("shares", 0)

            # Engagement score
            eng = likes + comments * 2 + shares * 3
            post["engagement_score"] = eng

            # Virality: views relative to likes (high = broad reach)
            post["virality_score"] = views / max(likes + 1, 1) if views else 0

            # Relevance: keyword in caption/hashtags
            caption = (post.get("caption", "") or "").lower()
            kw_lower = keyword.lower().lstrip("#")
            kw_count = caption.count(kw_lower)
            hashtag_match = sum(1 for h in post.get("hashtags", []) if kw_lower in h.lower())
            post["relevance_score"] = (kw_count + hashtag_match * 2) / max(len(caption.split()) + 1, 1)

            # Overall
            post["overall_rank"] = (
                post["engagement_score"] * 0.45
                + post["virality_score"] * 0.25
                + post["relevance_score"] * 0.30
            )

        return sorted(posts, key=lambda p: p["overall_rank"], reverse=True)

    # ── Media Download ──

    def download_media(self, posts: List[dict], keyword: str, top_n: int = 10) -> int:
        """Download thumbnails and media for top posts."""
        media_dir = self.storage.get_media_dir(keyword, "instagram")
        downloaded = 0

        for post in posts[:top_n]:
            urls = post.get("media_urls", []) or ([post["thumbnail_url"]] if post.get("thumbnail_url") else [])
            for i, url in enumerate(urls):
                if not url or url.startswith("blob:"):
                    continue
                ext = ".mp4" if post.get("content_type") in ("reel", "video") else ".jpg"
                filename = f"{post['shortcode']}_{i}{ext}"
                filepath = media_dir / filename

                if filepath.exists():
                    post["local_media_paths"].append(str(filepath))
                    continue

                try:
                    headers = {
                        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15",
                        "Referer": "https://www.instagram.com/",
                    }
                    resp = requests.get(url, headers=headers, timeout=60, stream=True)
                    if resp.status_code == 200:
                        with open(filepath, "wb") as f:
                            for chunk in resp.iter_content(8192):
                                f.write(chunk)
                        post["local_media_paths"].append(str(filepath))
                        downloaded += 1
                except Exception as e:
                    logger.warning(f"Download failed: {e}")
                time.sleep(0.5)

        logger.info(f"📥 Downloaded {downloaded} Instagram media files")
        return downloaded

    # ── Storage ──

    def save_posts(self, posts: List[dict], keyword: str):
        """Save Instagram posts to JSON."""
        if not posts:
            return
        slug = keyword.lower().lstrip("#").replace(" ", "-")
        json_dir = self.storage.base_dir / "instagram" / "posts" / slug
        json_dir.mkdir(parents=True, exist_ok=True)

        posts_file = json_dir / "posts.json"
        ranked_file = json_dir / "ranked.json"

        existing = []
        if posts_file.exists():
            with open(posts_file) as f:
                existing = json.load(f)

        existing_ids = {p["id"] for p in existing}
        new_posts = [p for p in posts if p["id"] not in existing_ids]
        merged = existing + new_posts

        with open(posts_file, "w") as f:
            json.dump(merged, f, indent=2)

        ranked = sorted(merged, key=lambda p: p.get("overall_rank", 0), reverse=True)
        with open(ranked_file, "w") as f:
            json.dump(ranked, f, indent=2)

        logger.info(f"💾 Saved {len(new_posts)} new IG posts ({len(merged)} total) → {json_dir}")

    # ── Batch ──

    def batch_search(
        self,
        keywords: List[str],
        search_type: str = "hashtag",
        max_per_keyword: int = 50,
        download_top: int = 10,
    ) -> ResearchSession:
        """Run batch Instagram research across multiple keywords/hashtags."""
        session = ResearchSession(
            id=str(uuid.uuid4())[:8],
            platform="instagram",
            keywords=keywords,
            filters={"search_type": search_type, "max_per_keyword": max_per_keyword},
        )

        logger.info(f"\n{'═' * 60}")
        logger.info(f"📊 INSTAGRAM MARKET RESEARCH — {len(keywords)} keywords")
        logger.info(f"{'═' * 60}\n")

        if not self.check_login():
            logger.error("Not logged into Instagram. Please log in and retry.")
            return session

        total_posts = 0
        total_media = 0

        for i, keyword in enumerate(keywords):
            logger.info(f"\n── Keyword {i+1}/{len(keywords)}: '{keyword}' ──")
            posts = self.search_keyword(keyword, search_type=search_type, max_posts=max_per_keyword)

            if posts:
                media_count = self.download_media(posts, keyword, top_n=download_top)
                self.save_posts(posts, keyword)

                session.keyword_results[keyword] = {
                    "posts_found": len(posts),
                    "top_post": posts[0].get("url", "") if posts else "",
                    "top_likes": posts[0].get("likes", 0) if posts else 0,
                    "avg_engagement": sum(p.get("engagement_score", 0) for p in posts) / max(len(posts), 1),
                    "media_downloaded": media_count,
                }
                total_posts += len(posts)
                total_media += media_count

            if i < len(keywords) - 1:
                time.sleep(self.delay * 2)

        session.total_posts_scraped = total_posts
        session.total_media_downloaded = total_media
        session.completed_at = datetime.now().isoformat()
        self.storage.save_session(session)

        self._print_summary(session)
        return session

    # ── Report ──

    def generate_report(self, keyword: str, top_n: int = 20) -> str:
        """Generate a markdown report for an Instagram keyword."""
        slug = keyword.lower().lstrip("#").replace(" ", "-")
        ranked_file = self.storage.base_dir / "instagram" / "posts" / slug / "ranked.json"

        if not ranked_file.exists():
            logger.warning(f"No data for '{keyword}'")
            return ""

        with open(ranked_file) as f:
            posts = json.load(f)[:top_n]

        report_dir = self.storage.get_report_dir("instagram")
        date_str = datetime.now().strftime("%Y-%m-%d")
        report_path = report_dir / f"{date_str}-{slug}.md"

        lines = [
            f"# Instagram Research Report: \"{keyword}\"",
            f"**Date:** {date_str}  ",
            f"**Posts analyzed:** {len(posts)}  ",
            "",
            "---",
            "",
            "## Top Posts by Engagement",
            "",
        ]

        for i, post in enumerate(posts):
            lines.extend([
                f"### #{i+1} — @{post.get('author_username', 'unknown')}",
                f"**Score:** {post.get('overall_rank', 0):.0f} | "
                f"**Likes:** {post.get('likes', 0):,} | "
                f"**Comments:** {post.get('comments', 0):,} | "
                f"**Views:** {post.get('views', 0):,}",
                f"**Type:** {post.get('content_type', '?')} | **Posted:** {post.get('posted_at', '?')}",
                "",
                f"> {(post.get('caption', '') or '')[:300]}",
                "",
                f"[View Post]({post.get('url', '')})" if post.get("url") else "",
                "",
                "---",
                "",
            ])

        # Hashtag frequency
        all_tags: Dict[str, int] = {}
        for post in posts:
            for tag in (post.get("hashtags") or []):
                all_tags[tag] = all_tags.get(tag, 0) + 1
        sorted_tags = sorted(all_tags.items(), key=lambda x: x[1], reverse=True)[:15]

        lines.extend(["## Top Hashtags", ""])
        for tag, count in sorted_tags:
            lines.append(f"- **{tag}** ({count}x)")

        with open(report_path, "w") as f:
            f.write("\n".join(lines))

        logger.info(f"📝 Instagram report → {report_path}")
        return str(report_path)

    def _print_summary(self, session: ResearchSession):
        print(f"\n{'═' * 60}")
        print(f"📊 INSTAGRAM RESEARCH COMPLETE")
        print(f"{'═' * 60}")
        print(f"  Posts:  {session.total_posts_scraped}")
        print(f"  Media:  {session.total_media_downloaded}")
        for kw, r in session.keyword_results.items():
            print(f"  #{kw}: {r['posts_found']} posts | top {r['top_likes']} likes")
        print(f"{'═' * 60}")

    def show_status(self):
        stats = self.storage.get_stats()
        print(f"\n📊 Instagram Research: {stats['total_posts']} total posts across {stats['total_keywords']} keywords")


# ── CLI ──

def main():
    import argparse
    parser = argparse.ArgumentParser(description="Instagram Market Research Scraper")
    sub = parser.add_subparsers(dest="command")

    s = sub.add_parser("search", help="Search by hashtag or keyword")
    s.add_argument("keyword")
    s.add_argument("--type", default="hashtag", choices=["hashtag", "keyword", "profile", "reels"])
    s.add_argument("--max-posts", type=int, default=50)
    s.add_argument("--detail", action="store_true", help="Scrape detail pages for full stats")
    s.add_argument("--download-top", type=int, default=10)

    b = sub.add_parser("batch", help="Batch search multiple hashtags/keywords")
    b.add_argument("--keywords", required=True, help="Comma-separated keywords")
    b.add_argument("--type", default="hashtag", choices=["hashtag", "keyword", "profile", "reels"])
    b.add_argument("--max-per-keyword", type=int, default=50)
    b.add_argument("--download-top", type=int, default=10)
    b.add_argument("--detail", action="store_true")

    r = sub.add_parser("report", help="Generate markdown report")
    r.add_argument("keyword")
    r.add_argument("--top", type=int, default=20)

    sub.add_parser("status", help="Show status")

    args = parser.parse_args()
    scraper = InstagramResearchScraper(detail_scrape=getattr(args, "detail", False))

    if args.command == "search":
        posts = scraper.search_keyword(args.keyword, search_type=args.type, max_posts=args.max_posts)
        if posts:
            scraper.download_media(posts, args.keyword, top_n=args.download_top)
            scraper.save_posts(posts, args.keyword)
            print(f"\n✅ {len(posts)} posts scraped for '{args.keyword}'")
            for i, p in enumerate(posts[:5]):
                print(f"  {i+1}. [{p['content_type']}] {p.get('author_username','?')} — {p.get('likes',0)} likes")

    elif args.command == "batch":
        keywords = [k.strip() for k in args.keywords.split(",")]
        scraper.batch_search(keywords, search_type=args.type, max_per_keyword=args.max_per_keyword, download_top=args.download_top)

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
