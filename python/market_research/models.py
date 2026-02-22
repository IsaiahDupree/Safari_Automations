"""
Data models for market research scraping.
"""
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional, List, Dict
from enum import Enum


class Platform(Enum):
    FACEBOOK = "facebook"
    INSTAGRAM = "instagram"


class ContentType(Enum):
    TEXT = "text"
    IMAGE = "image"
    VIDEO = "video"
    REEL = "reel"
    LINK = "link"
    CAROUSEL = "carousel"


class SearchType(Enum):
    POSTS = "posts"
    VIDEOS = "videos"
    REELS = "reels"
    PAGES = "pages"
    GROUPS = "groups"
    HASHTAG = "hashtag"
    KEYWORD = "keyword"
    PROFILE = "profile"


@dataclass
class FacebookPost:
    """Scraped Facebook post with engagement data."""
    # Identity
    id: str
    url: str
    platform: str = "facebook"

    # Author
    author_name: str = ""
    author_url: str = ""
    author_followers: Optional[int] = None
    is_verified: bool = False
    is_page: bool = False

    # Content
    text_content: str = ""
    content_type: str = "text"
    media_urls: List[str] = field(default_factory=list)
    link_url: Optional[str] = None
    link_title: Optional[str] = None
    hashtags: List[str] = field(default_factory=list)
    mentions: List[str] = field(default_factory=list)

    # Engagement
    reactions: int = 0
    reaction_breakdown: Dict[str, int] = field(default_factory=dict)
    comments: int = 0
    shares: int = 0
    views: Optional[int] = None

    # Ranking (computed)
    engagement_score: float = 0.0
    virality_score: float = 0.0
    relevance_score: float = 0.0
    overall_rank: float = 0.0

    # Metadata
    posted_at: str = ""
    scraped_at: str = field(default_factory=lambda: datetime.now().isoformat())
    keyword: str = ""
    search_type: str = "posts"

    # Local media
    local_media_paths: List[str] = field(default_factory=list)
    thumbnail_path: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "url": self.url,
            "platform": self.platform,
            "author_name": self.author_name,
            "author_url": self.author_url,
            "author_followers": self.author_followers,
            "is_verified": self.is_verified,
            "is_page": self.is_page,
            "text_content": self.text_content,
            "content_type": self.content_type,
            "media_urls": self.media_urls,
            "link_url": self.link_url,
            "link_title": self.link_title,
            "hashtags": self.hashtags,
            "mentions": self.mentions,
            "reactions": self.reactions,
            "reaction_breakdown": self.reaction_breakdown,
            "comments": self.comments,
            "shares": self.shares,
            "views": self.views,
            "engagement_score": self.engagement_score,
            "virality_score": self.virality_score,
            "relevance_score": self.relevance_score,
            "overall_rank": self.overall_rank,
            "posted_at": self.posted_at,
            "scraped_at": self.scraped_at,
            "keyword": self.keyword,
            "search_type": self.search_type,
            "local_media_paths": self.local_media_paths,
            "thumbnail_path": self.thumbnail_path,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "FacebookPost":
        return cls(**{k: v for k, v in data.items() if k in cls.__dataclass_fields__})


@dataclass
class ResearchSession:
    """A single market research scraping session."""
    id: str
    started_at: str = field(default_factory=lambda: datetime.now().isoformat())
    completed_at: Optional[str] = None
    platform: str = "facebook"

    # Search config
    keywords: List[str] = field(default_factory=list)
    filters: Dict[str, str] = field(default_factory=dict)

    # Results summary
    total_posts_scraped: int = 0
    total_media_downloaded: int = 0
    keyword_results: Dict[str, dict] = field(default_factory=dict)

    # Output paths
    report_path: str = ""
    data_path: str = ""

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "started_at": self.started_at,
            "completed_at": self.completed_at,
            "platform": self.platform,
            "keywords": self.keywords,
            "filters": self.filters,
            "total_posts_scraped": self.total_posts_scraped,
            "total_media_downloaded": self.total_media_downloaded,
            "keyword_results": self.keyword_results,
            "report_path": self.report_path,
            "data_path": self.data_path,
        }
