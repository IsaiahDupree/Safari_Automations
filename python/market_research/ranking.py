"""
Ranking engine for scraped market research posts.
Scores posts by engagement, virality, relevance, and recency.
"""
import re
from datetime import datetime, timedelta
from typing import List, Optional
from loguru import logger

from market_research.models import FacebookPost


def parse_relative_time(time_str: str) -> Optional[datetime]:
    """Parse Facebook-style relative timestamps like '2h', '3d', 'Yesterday'."""
    if not time_str:
        return None
    time_str = time_str.strip().lower()

    now = datetime.now()

    # "just now", "now"
    if "just now" in time_str or time_str == "now":
        return now

    # "Xm" or "X min"
    m = re.search(r"(\d+)\s*m(?:in)?", time_str)
    if m:
        return now - timedelta(minutes=int(m.group(1)))

    # "Xh" or "X hr" or "X hour"
    m = re.search(r"(\d+)\s*h(?:r|our)?", time_str)
    if m:
        return now - timedelta(hours=int(m.group(1)))

    # "Xd" or "X day"
    m = re.search(r"(\d+)\s*d(?:ay)?", time_str)
    if m:
        return now - timedelta(days=int(m.group(1)))

    # "yesterday"
    if "yesterday" in time_str:
        return now - timedelta(days=1)

    # "Xw" or "X week"
    m = re.search(r"(\d+)\s*w(?:eek)?", time_str)
    if m:
        return now - timedelta(weeks=int(m.group(1)))

    # Try ISO parse
    for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%d", "%B %d, %Y", "%b %d, %Y", "%B %d"):
        try:
            return datetime.strptime(time_str, fmt)
        except ValueError:
            continue

    return None


def compute_engagement_score(post: FacebookPost) -> float:
    """Weighted engagement: reactions + comments*2 + shares*3."""
    total = post.reactions + post.comments * 2 + post.shares * 3
    followers = max(post.author_followers or 1, 1)
    return total / followers


def compute_virality_score(post: FacebookPost) -> float:
    """Shares relative to total reactions — high = viral potential."""
    denom = max(post.reactions + 1, 1)
    return post.shares / denom


def compute_relevance_score(post: FacebookPost, keyword: str) -> float:
    """How densely the keyword appears in the post text."""
    if not post.text_content or not keyword:
        return 0.0
    text_lower = post.text_content.lower()
    kw_lower = keyword.lower()
    words = text_lower.split()
    word_count = max(len(words), 1)

    # Count keyword occurrences (can be multi-word)
    kw_parts = kw_lower.split()
    if len(kw_parts) == 1:
        match_count = words.count(kw_lower)
    else:
        match_count = text_lower.count(kw_lower)

    return match_count / word_count


def compute_recency_boost(post: FacebookPost) -> float:
    """Boost recent posts."""
    posted = parse_relative_time(post.posted_at)
    if not posted:
        return 1.0
    days_ago = (datetime.now() - posted).total_seconds() / 86400
    if days_ago <= 1:
        return 1.5
    elif days_ago <= 7:
        return 1.3
    elif days_ago <= 30:
        return 1.1
    return 1.0


def rank_post(post: FacebookPost, keyword: str) -> FacebookPost:
    """Compute all scores and overall rank for a single post."""
    post.engagement_score = compute_engagement_score(post)
    post.virality_score = compute_virality_score(post)
    post.relevance_score = compute_relevance_score(post, keyword)
    recency = compute_recency_boost(post)

    post.overall_rank = (
        post.engagement_score * 0.40
        + post.virality_score * 0.25
        + post.relevance_score * 0.20
        + recency * 0.15
    )
    return post


def rank_posts(posts: List[FacebookPost], keyword: str) -> List[FacebookPost]:
    """Rank all posts and return sorted by overall_rank descending."""
    for post in posts:
        rank_post(post, keyword)
    ranked = sorted(posts, key=lambda p: p.overall_rank, reverse=True)
    logger.info(f"Ranked {len(ranked)} posts for '{keyword}' — top score: {ranked[0].overall_rank:.4f}" if ranked else "No posts to rank")
    return ranked
