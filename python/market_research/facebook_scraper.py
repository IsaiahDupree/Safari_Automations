#!/usr/bin/env python3
"""
Facebook Market Research Scraper — Safari Automation

Searches Facebook for keywords/phrases, extracts top organic posts,
scrapes engagement stats, ranks by performance, and stores data + media.

Uses AppleScript → Safari → JavaScript injection to scrape the real
Facebook DOM with an authenticated session.
"""
import asyncio
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
from typing import Optional, List, Dict, Tuple
from urllib.parse import quote_plus
from loguru import logger

from market_research.models import FacebookPost, ResearchSession
from market_research.ranking import rank_posts
from market_research.storage import ResearchStorage

# Try to import session manager for login checks
try:
    from automation.safari_session_manager import SafariSessionManager, Platform
    HAS_SESSION_MANAGER = True
except ImportError:
    HAS_SESSION_MANAGER = False


# ── Facebook Search URL builders ──

FACEBOOK_SEARCH_URLS = {
    "posts": "https://www.facebook.com/search/posts/?q={keyword}",
    "videos": "https://www.facebook.com/search/videos/?q={keyword}",
    "pages": "https://www.facebook.com/search/pages/?q={keyword}",
    "groups": "https://www.facebook.com/search/groups/?q={keyword}",
    "photos": "https://www.facebook.com/search/photos/?q={keyword}",
}

# Filters appended to URL
FB_DATE_FILTERS = {
    "today": "&filters=eyJycF9jcmVhdGlvbl90aW1lIjoie1wibmFtZVwiOlwiY3JlYXRpb25fdGltZVwiLFwiYXJnc1wiOlwie1xcXCJzdGFydF95ZWFyXFxcIjpcXFwiMjAyNlxcXCIsXFxcInN0YXJ0X21vbnRoXFxcIjpcXFwiMjAyNi0wMi0yMVxcXCJ9XCJ9In0%3D",
    "this_week": "",
    "this_month": "",
    "this_year": "",
}

# ── Selectors (maintained here for easy updates when FB DOM changes) ──

SELECTORS = {
    # Post containers
    "post_article": 'div[role="article"]',
    "post_feed_unit": 'div[role="feed"] > div',

    # Author
    "author_link": 'h2 a, h3 a, h4 a, strong a',
    "author_name_span": 'h2 a span, h3 a span, h4 a span, strong a span',
    "verified_badge": 'svg[aria-label="Verified account"], svg[aria-label="Verified"]',

    # Content
    "post_text": 'div[data-ad-comet-preview="message"], div[data-ad-preview="message"]',
    "post_text_fallback": 'div[dir="auto"]',
    "media_image": 'img[src*="scontent"]',
    "media_video": "video",
    "shared_link": 'a[href*="l.facebook.com"], a[role="link"][href*="http"]',

    # Engagement
    "reaction_count": 'span[aria-label*="reaction"], span[aria-label*="like"], span[aria-label*="other"]',
    "comment_count": 'span:-webkit-any(:contains("comment"), :contains("Comment"))',
    "share_count": 'span:-webkit-any(:contains("share"), :contains("Share"))',

    # Timestamp
    "timestamp": 'a[href*="/posts/"] span, a[aria-label] abbr, a[href*="permalink"] span',

    # Login indicators
    "logged_in": 'div[role="banner"] svg[aria-label="Your profile"], div[aria-label="Facebook"] a[href*="/me/"]',
    "logged_out": 'input[name="email"], button[name="login"]',
}

# ── JavaScript extraction snippets ──

JS_EXTRACT_POSTS = """
(function() {
    var posts = [];

    // Utility: parse "1.2K", "54", "7.7K" etc into numbers
    function parseEng(text) {
        if (!text) return 0;
        var match = text.match(/([\\d,.]+)\\s*([kKmMbB])?/);
        if (!match) return 0;
        var num = parseFloat(match[1].replace(/,/g, ''));
        var suffix = (match[2] || '').toLowerCase();
        if (suffix === 'k') num *= 1000;
        else if (suffix === 'm') num *= 1000000;
        else if (suffix === 'b') num *= 1000000000;
        return Math.round(num);
    }

    // Find post containers — works for BOTH search results and regular feed
    // Search results: div[role="feed"] > div (no role="article")
    // Regular feed:   div[role="article"]
    var containers = [];
    var articles = document.querySelectorAll('div[role="article"]');
    if (articles.length > 0) {
        containers = Array.from(articles);
    } else {
        var feed = document.querySelector('div[role="feed"]');
        if (feed) {
            var children = Array.from(feed.children);
            // Skip first child (usually empty spacer) and filter by size
            containers = children.filter(function(c) {
                return c.querySelectorAll('div').length > 50;
            });
        }
    }

    containers.forEach(function(card, idx) {
        try {
            var post = {};
            post.index = idx;

            // ── Author ──
            // Strategy: find first link whose text isn't "Facebook" and points to a profile
            post.author_name = '';
            post.author_url = '';
            var allLinks = card.querySelectorAll('a[href]');
            for (var i = 0; i < allLinks.length; i++) {
                var lt = (allLinks[i].innerText || '').trim();
                var lh = allLinks[i].href || '';
                if (lt.length > 2 && lt.length < 60
                    && lt !== 'Facebook'
                    && lh.indexOf('facebook.com/') !== -1
                    && lh.indexOf('/search/') === -1
                    && lh.indexOf('/photo') === -1
                    && lh.indexOf('/hashtag/') === -1) {
                    post.author_name = lt;
                    post.author_url = lh.split('?')[0];
                    break;
                }
            }

            // ── Verified ──
            post.is_verified = !!card.querySelector('svg[aria-label*="Verified"]');

            // ── Post text ──
            // Try message div first, then largest dir="auto" block
            var textBlocks = [];
            var msgDiv = card.querySelector('div[data-ad-comet-preview="message"], div[data-ad-preview="message"]');
            if (msgDiv) {
                var spans = msgDiv.querySelectorAll('div[dir="auto"]');
                spans.forEach(function(s) { textBlocks.push(s.innerText); });
            }
            if (textBlocks.length === 0) {
                var allText = card.querySelectorAll('div[dir="auto"]');
                var bestText = '';
                allText.forEach(function(el) {
                    var t = (el.innerText || '').trim();
                    // Skip short labels, filter names, "Facebook" noise
                    if (t.length > bestText.length && t.length > 20
                        && t !== 'Facebook' && !/^Filters$/.test(t)
                        && !/^(All|People|Reels|Marketplace|Pages|Groups|Events)$/.test(t)) {
                        bestText = t;
                    }
                });
                if (bestText) textBlocks = [bestText];
            }
            post.text_content = textBlocks.join('\\n').trim();

            // ── Media ──
            post.media_urls = [];
            var images = card.querySelectorAll('img[src*="scontent"]');
            images.forEach(function(img) {
                if (img.width > 80 && img.height > 80) {
                    post.media_urls.push(img.src);
                }
            });
            var videos = card.querySelectorAll('video');
            videos.forEach(function(v) {
                if (v.src) post.media_urls.push(v.src);
            });

            // ── Content type ──
            if (videos.length > 0) post.content_type = 'video';
            else if (images.length > 1) post.content_type = 'carousel';
            else if (images.length === 1) post.content_type = 'image';
            else if (post.text_content.length > 0) post.content_type = 'text';
            else post.content_type = 'unknown';

            // ── Shared link ──
            var linkEl = card.querySelector('a[href*="l.facebook.com"]');
            if (linkEl) {
                post.link_url = linkEl.href;
                var linkTitle = linkEl.querySelector('span');
                post.link_title = linkTitle ? linkTitle.innerText : '';
            }

            // ── Engagement ──
            post.reactions = 0;
            post.comments = 0;
            post.shares = 0;
            post.views = null;

            // Reactions from aria-label
            var ariaSpans = card.querySelectorAll('span[aria-label]');
            ariaSpans.forEach(function(span) {
                var label = span.getAttribute('aria-label') || '';
                if (/reaction|like|love|haha|wow|sad|angry|and \\d+ other/i.test(label)) {
                    var num = parseEng(label);
                    if (num > post.reactions) post.reactions = num;
                }
            });

            // Comments, shares, views from visible text spans
            var allSpans = card.querySelectorAll('span');
            allSpans.forEach(function(span) {
                var t = (span.innerText || '').trim();
                if (/^[\\d,.]+[kKmMbB]?\\s+comment/i.test(t)) {
                    var n = parseEng(t);
                    if (n > post.comments) post.comments = n;
                }
                if (/^[\\d,.]+[kKmMbB]?\\s+share/i.test(t)) {
                    var n2 = parseEng(t);
                    if (n2 > post.shares) post.shares = n2;
                }
                if (/^[\\d,.]+[kKmMbB]?\\s+view/i.test(t)) {
                    var n3 = parseEng(t);
                    if (n3 > (post.views || 0)) post.views = n3;
                }
            });

            // ── Timestamp ──
            post.posted_at = '';
            var timeEl = card.querySelector('a[href*="/posts/"] span, abbr[data-utime], a[aria-label] span');
            if (timeEl) {
                post.posted_at = timeEl.innerText || timeEl.getAttribute('aria-label') || '';
            }

            // ── Post URL ──
            post.url = '';
            var postLink = card.querySelector('a[href*="/posts/"], a[href*="/videos/"], a[href*="/reel/"], a[href*="permalink"], a[href*="/photo/"]');
            if (postLink) {
                post.url = postLink.href.split('?')[0];
            }

            // ── Hashtags & Mentions ──
            post.hashtags = [];
            var hashMatches = post.text_content.match(/#[\\w\\u00C0-\\u024F]+/g);
            if (hashMatches) post.hashtags = hashMatches;

            post.mentions = [];
            var mentionMatches = post.text_content.match(/@[\\w.]+/g);
            if (mentionMatches) post.mentions = mentionMatches;

            // Only include if we got meaningful content
            if ((post.author_name || post.text_content) && post.text_content.length > 10) {
                posts.push(post);
            }
        } catch(e) {}
    });

    return JSON.stringify(posts);
})();
"""

JS_GET_SCROLL_STATE = """
(function() {
    return JSON.stringify({
        scrollHeight: document.documentElement.scrollHeight,
        scrollTop: window.pageYOffset || document.documentElement.scrollTop,
        clientHeight: document.documentElement.clientHeight,
        articleCount: document.querySelectorAll('div[role="article"]').length
    });
})();
"""

JS_CHECK_LOGIN = """
(function() {
    var loggedIn = document.querySelector('div[role="banner"] svg, div[aria-label="Facebook"] a[href*="/me/"], a[aria-label="Profile"]');
    var loggedOut = document.querySelector('input[name="email"], button[name="login"]');
    if (loggedOut) return 'logged_out';
    if (loggedIn) return 'logged_in';
    return 'unknown';
})();
"""


class FacebookResearchScraper:
    """Safari-based Facebook market research scraper."""

    def __init__(
        self,
        delay_between_actions: float = 3.0,
        scroll_pause: float = 2.5,
        max_scrolls: int = 30,
    ):
        self.delay = delay_between_actions
        self.scroll_pause = scroll_pause
        self.max_scrolls = max_scrolls
        self.storage = ResearchStorage()
        self.session_manager = SafariSessionManager() if HAS_SESSION_MANAGER else None

    # ── Safari Primitives ──

    def _run_applescript(self, script: str, timeout: int = 30) -> str:
        """Execute AppleScript and return output."""
        try:
            result = subprocess.run(
                ["osascript", "-e", script],
                capture_output=True,
                text=True,
                timeout=timeout,
            )
            if result.returncode != 0:
                logger.error(f"AppleScript error: {result.stderr}")
                return ""
            return result.stdout.strip()
        except subprocess.TimeoutExpired:
            logger.error(f"AppleScript timed out after {timeout}s")
            return ""
        except Exception as e:
            logger.error(f"AppleScript failed: {e}")
            return ""

    def _execute_js(self, js_code: str, timeout: int = 30) -> str:
        """Execute JavaScript in Safari's current tab."""
        js_escaped = js_code.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")
        script = f'''
tell application "Safari"
    if (count of windows) > 0 then
        return do JavaScript "{js_escaped}" in front document
    end if
    return ""
end tell
'''
        return self._run_applescript(script, timeout=timeout)

    def _navigate(self, url: str):
        """Navigate Safari to a URL."""
        script = f'''
tell application "Safari"
    activate
    if (count of windows) = 0 then
        make new document
    end if
    set URL of front document to "{url}"
end tell
'''
        self._run_applescript(script)
        time.sleep(self.delay)

    def _scroll_down(self):
        """Scroll the page down by one viewport."""
        self._execute_js("window.scrollBy(0, window.innerHeight * 0.8);")
        time.sleep(self.scroll_pause)

    def _get_current_url(self) -> str:
        """Get the current URL."""
        script = '''
tell application "Safari"
    if (count of windows) > 0 then
        return URL of front document
    end if
    return ""
end tell
'''
        return self._run_applescript(script)

    # ── Login Check ──

    def check_login(self) -> bool:
        """Check if logged into Facebook."""
        current_url = self._get_current_url()
        if "facebook.com" not in current_url:
            self._navigate("https://www.facebook.com/")
            time.sleep(3)

        result = self._execute_js(JS_CHECK_LOGIN)
        if result == "logged_in":
            logger.info("✅ Logged into Facebook")
            return True
        elif result == "logged_out":
            logger.warning("❌ Not logged into Facebook")
            return False
        else:
            logger.warning("⚠️  Facebook login state unknown — proceeding")
            return True

    # ── Search ──

    def _build_search_url(
        self,
        keyword: str,
        search_type: str = "posts",
        date_filter: Optional[str] = None,
    ) -> str:
        """Build a Facebook search URL."""
        base = FACEBOOK_SEARCH_URLS.get(search_type, FACEBOOK_SEARCH_URLS["posts"])
        url = base.format(keyword=quote_plus(keyword))
        if date_filter and date_filter in FB_DATE_FILTERS:
            url += FB_DATE_FILTERS[date_filter]
        return url

    def search_keyword(
        self,
        keyword: str,
        search_type: str = "posts",
        max_posts: int = 50,
        date_filter: Optional[str] = None,
    ) -> List[FacebookPost]:
        """
        Search Facebook for a keyword and scrape results.

        Args:
            keyword: Search term
            search_type: posts, videos, pages, groups, photos
            max_posts: Maximum posts to scrape
            date_filter: today, this_week, this_month, this_year

        Returns:
            List of FacebookPost objects, ranked by engagement
        """
        logger.info(f"🔍 Searching Facebook [{search_type}]: '{keyword}' (max {max_posts})")

        url = self._build_search_url(keyword, search_type, date_filter)
        self._navigate(url)
        time.sleep(4)  # Extra wait for search results to load

        # Check we're on Facebook and results loaded
        current = self._get_current_url()
        if "facebook.com" not in current:
            logger.error("Not on Facebook — aborting search")
            return []

        # Scroll and collect posts
        all_posts: List[FacebookPost] = []
        seen_ids = set()
        no_new_count = 0
        prev_count = 0

        for scroll_num in range(self.max_scrolls):
            # Extract posts from current DOM
            raw = self._execute_js(JS_EXTRACT_POSTS)
            if not raw:
                logger.warning(f"Scroll {scroll_num}: No data returned from JS extraction")
                self._scroll_down()
                continue

            try:
                extracted = json.loads(raw)
            except json.JSONDecodeError:
                logger.warning(f"Scroll {scroll_num}: Invalid JSON from extraction")
                self._scroll_down()
                continue

            # Convert to FacebookPost objects, deduplicate
            for raw_post in extracted:
                post_id = self._generate_post_id(raw_post)
                if post_id in seen_ids:
                    continue
                seen_ids.add(post_id)

                post = FacebookPost(
                    id=post_id,
                    url=raw_post.get("url", ""),
                    author_name=raw_post.get("author_name", ""),
                    author_url=raw_post.get("author_url", ""),
                    is_verified=raw_post.get("is_verified", False),
                    text_content=raw_post.get("text_content", ""),
                    content_type=raw_post.get("content_type", "text"),
                    media_urls=raw_post.get("media_urls", []),
                    link_url=raw_post.get("link_url"),
                    link_title=raw_post.get("link_title"),
                    hashtags=raw_post.get("hashtags", []),
                    mentions=raw_post.get("mentions", []),
                    reactions=raw_post.get("reactions", 0),
                    comments=raw_post.get("comments", 0),
                    shares=raw_post.get("shares", 0),
                    views=raw_post.get("views"),
                    posted_at=raw_post.get("posted_at", ""),
                    keyword=keyword,
                    search_type=search_type,
                )
                all_posts.append(post)

            logger.info(f"  Scroll {scroll_num + 1}/{self.max_scrolls}: {len(all_posts)} posts found")

            if len(all_posts) >= max_posts:
                logger.info(f"  ✅ Reached max posts ({max_posts})")
                break

            # Check if we're getting new results
            if len(all_posts) == prev_count:
                no_new_count += 1
                if no_new_count >= 5:
                    logger.info(f"  ⏹️  No new posts after {no_new_count} scrolls — stopping")
                    break
            else:
                no_new_count = 0
                prev_count = len(all_posts)

            self._scroll_down()

        # Rank posts
        if all_posts:
            all_posts = rank_posts(all_posts, keyword)

        logger.info(f"✅ Found {len(all_posts)} posts for '{keyword}' [{search_type}]")
        return all_posts[:max_posts]

    def _generate_post_id(self, raw: dict) -> str:
        """Generate a unique ID for a post based on content hash."""
        url = raw.get("url", "")
        if url and "/posts/" in url:
            m = re.search(r"/posts/(\d+)", url)
            if m:
                return f"fb_{m.group(1)}"

        # Hash content as fallback
        content = f"{raw.get('author_name', '')}|{raw.get('text_content', '')[:100]}|{raw.get('posted_at', '')}"
        return f"fb_{hashlib.md5(content.encode()).hexdigest()[:12]}"

    # ── Media Download ──

    def download_media(
        self,
        posts: List[FacebookPost],
        keyword: str,
        top_n: Optional[int] = None,
    ) -> int:
        """Download media from top posts."""
        media_dir = self.storage.get_media_dir(keyword, "facebook")
        target_posts = posts[:top_n] if top_n else posts
        downloaded = 0

        for post in target_posts:
            for i, url in enumerate(post.media_urls):
                if not url or url.startswith("blob:"):
                    continue

                ext = ".mp4" if post.content_type == "video" else ".jpg"
                filename = f"{post.id}_{i}{ext}"
                filepath = media_dir / filename

                if filepath.exists():
                    post.local_media_paths.append(str(filepath))
                    continue

                try:
                    headers = {
                        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15",
                        "Referer": "https://www.facebook.com/",
                    }
                    resp = requests.get(url, headers=headers, timeout=60, stream=True)
                    if resp.status_code == 200:
                        with open(filepath, "wb") as f:
                            for chunk in resp.iter_content(chunk_size=8192):
                                f.write(chunk)
                        post.local_media_paths.append(str(filepath))
                        downloaded += 1
                        logger.debug(f"  📥 {filename} ({filepath.stat().st_size // 1024}KB)")
                    else:
                        logger.warning(f"  ⚠️  HTTP {resp.status_code} for {url[:60]}")
                except Exception as e:
                    logger.warning(f"  ⚠️  Download failed: {e}")

                time.sleep(0.5)

        logger.info(f"📥 Downloaded {downloaded} media files to {media_dir}")
        return downloaded

    # ── Batch Search ──

    def batch_search(
        self,
        keywords: List[str],
        search_type: str = "posts",
        max_per_keyword: int = 50,
        download_top: int = 10,
        date_filter: Optional[str] = None,
    ) -> ResearchSession:
        """
        Run a batch search across multiple keywords.

        Returns a ResearchSession with summary stats.
        """
        session = ResearchSession(
            id=str(uuid.uuid4())[:8],
            platform="facebook",
            keywords=keywords,
            filters={
                "search_type": search_type,
                "max_per_keyword": max_per_keyword,
                "date_filter": date_filter or "none",
            },
        )

        logger.info(f"\n{'═' * 60}")
        logger.info(f"📊 FACEBOOK MARKET RESEARCH — {len(keywords)} keywords")
        logger.info(f"{'═' * 60}\n")

        # Login check
        if not self.check_login():
            logger.error("Not logged into Facebook. Please log in and retry.")
            return session

        total_posts = 0
        total_media = 0

        for i, keyword in enumerate(keywords):
            logger.info(f"\n── Keyword {i + 1}/{len(keywords)}: '{keyword}' ──")

            posts = self.search_keyword(
                keyword,
                search_type=search_type,
                max_posts=max_per_keyword,
                date_filter=date_filter,
            )

            if posts:
                # Download media for top posts
                media_count = self.download_media(posts, keyword, top_n=download_top)

                # Store
                self.storage.save_posts(posts, keyword, "facebook")

                # Session summary for this keyword
                session.keyword_results[keyword] = {
                    "posts_found": len(posts),
                    "top_post_author": posts[0].author_name if posts else "",
                    "top_post_score": posts[0].overall_rank if posts else 0,
                    "top_post_reactions": posts[0].reactions if posts else 0,
                    "avg_engagement": sum(p.engagement_score for p in posts) / len(posts) if posts else 0,
                    "media_downloaded": media_count,
                }

                total_posts += len(posts)
                total_media += media_count

            # Delay between searches to avoid rate limiting
            if i < len(keywords) - 1:
                logger.info(f"  ⏳ Waiting {self.delay * 2}s before next keyword...")
                time.sleep(self.delay * 2)

        session.total_posts_scraped = total_posts
        session.total_media_downloaded = total_media
        session.completed_at = datetime.now().isoformat()

        # Save session
        self.storage.save_session(session)

        # Print summary
        self._print_summary(session)

        return session

    # ── Report Generation ──

    def generate_report(self, keyword: str, top_n: int = 20) -> str:
        """Generate a markdown report for a keyword's top posts."""
        top_posts = self.storage.get_top_posts(keyword, "facebook", limit=top_n)
        if not top_posts:
            logger.warning(f"No data found for keyword '{keyword}'")
            return ""

        report_dir = self.storage.get_report_dir("facebook")
        date_str = datetime.now().strftime("%Y-%m-%d")
        slug = keyword.lower().replace(" ", "-")
        report_path = report_dir / f"{date_str}-{slug}.md"

        lines = [
            f"# Facebook Research Report: \"{keyword}\"",
            f"**Date:** {date_str}  ",
            f"**Posts analyzed:** {len(top_posts)}  ",
            "",
            "---",
            "",
            "## Top Posts by Engagement",
            "",
        ]

        for i, post in enumerate(top_posts):
            lines.extend([
                f"### #{i + 1} — {post.get('author_name', 'Unknown')}",
                f"**Score:** {post.get('overall_rank', 0):.4f} | "
                f"**Reactions:** {post.get('reactions', 0):,} | "
                f"**Comments:** {post.get('comments', 0):,} | "
                f"**Shares:** {post.get('shares', 0):,}",
                f"**Type:** {post.get('content_type', 'unknown')} | "
                f"**Posted:** {post.get('posted_at', 'unknown')}",
                "",
                f"> {(post.get('text_content', '') or '')[:300]}",
                "",
                f"[View Post]({post.get('url', '')})" if post.get("url") else "",
                "",
                "---",
                "",
            ])

        # Summary stats
        total_reactions = sum(p.get("reactions", 0) for p in top_posts)
        total_comments = sum(p.get("comments", 0) for p in top_posts)
        total_shares = sum(p.get("shares", 0) for p in top_posts)
        avg_engagement = sum(p.get("engagement_score", 0) for p in top_posts) / max(len(top_posts), 1)

        lines.extend([
            "## Summary Statistics",
            "",
            f"| Metric | Value |",
            f"|--------|-------|",
            f"| Total Reactions | {total_reactions:,} |",
            f"| Total Comments | {total_comments:,} |",
            f"| Total Shares | {total_shares:,} |",
            f"| Avg Engagement Score | {avg_engagement:.4f} |",
            "",
            "## Top Hashtags",
            "",
        ])

        # Hashtag frequency
        all_hashtags: Dict[str, int] = {}
        for post in top_posts:
            for tag in json.loads(post.get("hashtags", "[]")):
                all_hashtags[tag] = all_hashtags.get(tag, 0) + 1
        sorted_tags = sorted(all_hashtags.items(), key=lambda x: x[1], reverse=True)[:15]
        for tag, count in sorted_tags:
            lines.append(f"- **{tag}** ({count}x)")

        report_text = "\n".join(lines)
        with open(report_path, "w") as f:
            f.write(report_text)

        logger.info(f"📝 Report saved to {report_path}")
        return str(report_path)

    # ── Output ──

    def _print_summary(self, session: ResearchSession):
        """Print a session summary to console."""
        print(f"\n{'═' * 60}")
        print(f"📊 RESEARCH SESSION COMPLETE")
        print(f"{'═' * 60}")
        print(f"  Session ID: {session.id}")
        print(f"  Keywords:   {', '.join(session.keywords)}")
        print(f"  Posts:      {session.total_posts_scraped}")
        print(f"  Media:      {session.total_media_downloaded}")
        print(f"  Duration:   {session.started_at} → {session.completed_at}")
        print()

        for keyword, results in session.keyword_results.items():
            print(f"  📌 '{keyword}'")
            print(f"     Posts: {results['posts_found']} | "
                  f"Top: {results['top_post_author']} ({results['top_post_reactions']} reactions) | "
                  f"Avg eng: {results['avg_engagement']:.4f}")
        print(f"\n{'═' * 60}")

    def show_status(self):
        """Show overall research status."""
        stats = self.storage.get_stats()
        keywords = self.storage.get_all_keywords("facebook")

        print(f"\n{'═' * 60}")
        print(f"📊 MARKET RESEARCH STATUS")
        print(f"{'═' * 60}")
        print(f"  Total posts:    {stats['total_posts']}")
        print(f"  Total keywords: {stats['total_keywords']}")
        print(f"  Total sessions: {stats['total_sessions']}")
        print(f"  DB path:        {stats['db_path']}")
        print()

        if keywords:
            print(f"  {'Keyword':<30} {'Posts':>6} {'Top Score':>10} {'Last Scraped':>20}")
            print(f"  {'─' * 70}")
            for kw in keywords:
                print(f"  {kw['keyword']:<30} {kw['post_count']:>6} {kw['top_score']:>10.4f} {kw['last_scraped'][:19]:>20}")
        print(f"\n{'═' * 60}")


# ── CLI ──

def main():
    import argparse

    parser = argparse.ArgumentParser(
        description="Facebook Market Research Scraper — Safari Automation"
    )
    sub = parser.add_subparsers(dest="command", help="Available commands")

    # search
    search_p = sub.add_parser("search", help="Search Facebook for a keyword")
    search_p.add_argument("keyword", help="Keyword or phrase to search")
    search_p.add_argument("--max-posts", type=int, default=50)
    search_p.add_argument("--type", default="posts", choices=["posts", "videos", "pages", "groups", "photos"])
    search_p.add_argument("--date", default=None, choices=["today", "this_week", "this_month", "this_year"])
    search_p.add_argument("--download-top", type=int, default=10, help="Download media for top N posts")

    # batch
    batch_p = sub.add_parser("batch", help="Batch search multiple keywords")
    batch_p.add_argument("--keywords", required=True, help="Comma-separated keywords")
    batch_p.add_argument("--max-per-keyword", type=int, default=50)
    batch_p.add_argument("--type", default="posts", choices=["posts", "videos", "pages", "groups", "photos"])
    batch_p.add_argument("--date", default=None)
    batch_p.add_argument("--download-top", type=int, default=10)

    # rank
    rank_p = sub.add_parser("rank", help="Show ranked posts for a keyword")
    rank_p.add_argument("keyword", help="Keyword to show rankings for")
    rank_p.add_argument("--top", type=int, default=20)

    # download
    dl_p = sub.add_parser("download", help="Download media for top posts")
    dl_p.add_argument("keyword")
    dl_p.add_argument("--top", type=int, default=10)

    # report
    report_p = sub.add_parser("report", help="Generate a markdown report")
    report_p.add_argument("keyword")
    report_p.add_argument("--top", type=int, default=20)

    # status
    sub.add_parser("status", help="Show research status")

    args = parser.parse_args()
    scraper = FacebookResearchScraper()

    if args.command == "search":
        if not scraper.check_login():
            print("\n⚠️  Please log into Facebook in Safari and retry.")
            return

        posts = scraper.search_keyword(
            args.keyword,
            search_type=args.type,
            max_posts=args.max_posts,
            date_filter=args.date,
        )
        if posts:
            scraper.download_media(posts, args.keyword, top_n=args.download_top)
            scraper.storage.save_posts(posts, args.keyword, "facebook")
            print(f"\n✅ {len(posts)} posts scraped and saved for '{args.keyword}'")
            print(f"\n📊 Top 5:")
            for i, p in enumerate(posts[:5]):
                print(f"  {i + 1}. [{p.content_type}] {p.author_name} — "
                      f"{p.reactions} reactions, {p.comments} comments, {p.shares} shares")
                print(f"     {p.text_content[:80]}...")

    elif args.command == "batch":
        keywords = [k.strip() for k in args.keywords.split(",")]
        scraper.batch_search(
            keywords,
            search_type=args.type,
            max_per_keyword=args.max_per_keyword,
            download_top=args.download_top,
            date_filter=args.date,
        )

    elif args.command == "rank":
        top = scraper.storage.get_top_posts(args.keyword, "facebook", limit=args.top)
        if not top:
            print(f"No data for '{args.keyword}'. Run a search first.")
            return
        print(f"\n📊 Top {len(top)} posts for '{args.keyword}':\n")
        for i, p in enumerate(top):
            print(f"  {i + 1}. Score: {p['overall_rank']:.4f} | "
                  f"👍 {p['reactions']} | 💬 {p['comments']} | 🔄 {p['shares']}")
            print(f"     Author: {p['author_name']}")
            print(f"     {(p.get('text_content') or '')[:80]}...")
            print()

    elif args.command == "download":
        top = scraper.storage.get_top_posts(args.keyword, "facebook", limit=args.top)
        if not top:
            print(f"No data for '{args.keyword}'. Run a search first.")
            return
        posts = [FacebookPost.from_dict(p) for p in top]
        scraper.download_media(posts, args.keyword, top_n=args.top)

    elif args.command == "report":
        path = scraper.generate_report(args.keyword, top_n=args.top)
        if path:
            print(f"\n📝 Report: {path}")

    elif args.command == "status":
        scraper.show_status()

    else:
        parser.print_help()


if __name__ == "__main__":
    main()
