"""
Storage layer for market research data.
Persists scraped posts to JSON files and SQLite database.
"""
import json
import sqlite3
import os
from pathlib import Path
from typing import List, Optional, Dict
from datetime import datetime
from loguru import logger

from market_research.models import FacebookPost, ResearchSession

RESEARCH_BASE = os.path.expanduser("~/market-research")


class ResearchStorage:
    """Manages JSON + SQLite storage for market research data."""

    def __init__(self, base_dir: str = RESEARCH_BASE):
        self.base_dir = Path(base_dir)
        self.db_path = self.base_dir / "research.db"
        self._ensure_dirs()
        self._init_db()

    def _ensure_dirs(self):
        """Create directory structure."""
        for platform in ("facebook", "instagram"):
            for subdir in ("sessions", "posts", "media", "reports"):
                (self.base_dir / platform / subdir).mkdir(parents=True, exist_ok=True)
        for subdir in ("patterns", "ad-briefs"):
            (self.base_dir / subdir).mkdir(parents=True, exist_ok=True)

    def _init_db(self):
        """Initialize SQLite database with schema."""
        conn = sqlite3.connect(str(self.db_path))
        c = conn.cursor()

        c.execute("""
            CREATE TABLE IF NOT EXISTS posts (
                id TEXT PRIMARY KEY,
                url TEXT,
                platform TEXT,
                author_name TEXT,
                author_url TEXT,
                author_followers INTEGER,
                is_verified INTEGER DEFAULT 0,
                is_page INTEGER DEFAULT 0,
                text_content TEXT,
                content_type TEXT,
                media_urls TEXT,
                link_url TEXT,
                hashtags TEXT,
                mentions TEXT,
                reactions INTEGER DEFAULT 0,
                comments INTEGER DEFAULT 0,
                shares INTEGER DEFAULT 0,
                views INTEGER,
                engagement_score REAL DEFAULT 0,
                virality_score REAL DEFAULT 0,
                relevance_score REAL DEFAULT 0,
                overall_rank REAL DEFAULT 0,
                posted_at TEXT,
                scraped_at TEXT,
                keyword TEXT,
                search_type TEXT,
                local_media_paths TEXT,
                thumbnail_path TEXT
            )
        """)

        c.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                started_at TEXT,
                completed_at TEXT,
                platform TEXT,
                keywords TEXT,
                filters TEXT,
                total_posts_scraped INTEGER DEFAULT 0,
                total_media_downloaded INTEGER DEFAULT 0,
                keyword_results TEXT,
                report_path TEXT,
                data_path TEXT
            )
        """)

        c.execute("""
            CREATE INDEX IF NOT EXISTS idx_posts_keyword ON posts(keyword)
        """)
        c.execute("""
            CREATE INDEX IF NOT EXISTS idx_posts_platform ON posts(platform)
        """)
        c.execute("""
            CREATE INDEX IF NOT EXISTS idx_posts_rank ON posts(overall_rank DESC)
        """)

        conn.commit()
        conn.close()
        logger.debug(f"SQLite initialized at {self.db_path}")

    # ── Post Storage ──

    def save_posts(self, posts: List[FacebookPost], keyword: str, platform: str = "facebook"):
        """Save posts to both JSON and SQLite."""
        if not posts:
            return

        # JSON
        keyword_slug = keyword.lower().replace(" ", "-").replace("/", "-")
        json_dir = self.base_dir / platform / "posts" / keyword_slug
        json_dir.mkdir(parents=True, exist_ok=True)

        posts_file = json_dir / "posts.json"
        ranked_file = json_dir / "ranked.json"

        post_dicts = [p.to_dict() for p in posts]

        # Merge with existing
        existing = []
        if posts_file.exists():
            with open(posts_file) as f:
                existing = json.load(f)

        existing_ids = {p["id"] for p in existing}
        new_posts = [p for p in post_dicts if p["id"] not in existing_ids]
        merged = existing + new_posts

        with open(posts_file, "w") as f:
            json.dump(merged, f, indent=2)

        # Ranked version (sorted by overall_rank)
        ranked = sorted(merged, key=lambda p: p.get("overall_rank", 0), reverse=True)
        with open(ranked_file, "w") as f:
            json.dump(ranked, f, indent=2)

        logger.info(f"Saved {len(new_posts)} new posts ({len(merged)} total) to {json_dir}")

        # SQLite
        self._upsert_posts_db(post_dicts)

    def _upsert_posts_db(self, post_dicts: List[dict]):
        """Insert or update posts in SQLite."""
        conn = sqlite3.connect(str(self.db_path))
        c = conn.cursor()

        for p in post_dicts:
            c.execute("""
                INSERT OR REPLACE INTO posts (
                    id, url, platform, author_name, author_url, author_followers,
                    is_verified, is_page, text_content, content_type, media_urls,
                    link_url, hashtags, mentions, reactions, comments, shares, views,
                    engagement_score, virality_score, relevance_score, overall_rank,
                    posted_at, scraped_at, keyword, search_type,
                    local_media_paths, thumbnail_path
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                p["id"], p["url"], p["platform"],
                p["author_name"], p["author_url"], p.get("author_followers"),
                int(p.get("is_verified", False)), int(p.get("is_page", False)),
                p["text_content"], p["content_type"],
                json.dumps(p.get("media_urls", [])),
                p.get("link_url"),
                json.dumps(p.get("hashtags", [])),
                json.dumps(p.get("mentions", [])),
                p.get("reactions", 0), p.get("comments", 0),
                p.get("shares", 0), p.get("views"),
                p.get("engagement_score", 0), p.get("virality_score", 0),
                p.get("relevance_score", 0), p.get("overall_rank", 0),
                p.get("posted_at", ""), p.get("scraped_at", ""),
                p.get("keyword", ""), p.get("search_type", ""),
                json.dumps(p.get("local_media_paths", [])),
                p.get("thumbnail_path"),
            ))

        conn.commit()
        conn.close()

    def get_top_posts(self, keyword: str, platform: str = "facebook", limit: int = 20) -> List[dict]:
        """Get top-ranked posts for a keyword."""
        conn = sqlite3.connect(str(self.db_path))
        conn.row_factory = sqlite3.Row
        c = conn.cursor()

        c.execute("""
            SELECT * FROM posts
            WHERE keyword = ? AND platform = ?
            ORDER BY overall_rank DESC
            LIMIT ?
        """, (keyword, platform, limit))

        rows = [dict(r) for r in c.fetchall()]
        conn.close()
        return rows

    def get_all_keywords(self, platform: str = "facebook") -> List[dict]:
        """List all researched keywords with post counts."""
        conn = sqlite3.connect(str(self.db_path))
        conn.row_factory = sqlite3.Row
        c = conn.cursor()

        c.execute("""
            SELECT keyword,
                   COUNT(*) as post_count,
                   MAX(overall_rank) as top_score,
                   MAX(scraped_at) as last_scraped
            FROM posts
            WHERE platform = ?
            GROUP BY keyword
            ORDER BY post_count DESC
        """, (platform,))

        rows = [dict(r) for r in c.fetchall()]
        conn.close()
        return rows

    # ── Session Storage ──

    def save_session(self, session: ResearchSession):
        """Save a research session."""
        session_data = session.to_dict()

        # JSON
        session_dir = self.base_dir / session.platform / "sessions"
        session_file = session_dir / f"{session.id}.json"
        with open(session_file, "w") as f:
            json.dump(session_data, f, indent=2)

        # SQLite
        conn = sqlite3.connect(str(self.db_path))
        c = conn.cursor()
        c.execute("""
            INSERT OR REPLACE INTO sessions (
                id, started_at, completed_at, platform, keywords, filters,
                total_posts_scraped, total_media_downloaded, keyword_results,
                report_path, data_path
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            session.id, session.started_at, session.completed_at, session.platform,
            json.dumps(session.keywords), json.dumps(session.filters),
            session.total_posts_scraped, session.total_media_downloaded,
            json.dumps(session.keyword_results),
            session.report_path, session.data_path,
        ))
        conn.commit()
        conn.close()

    def get_sessions(self, platform: str = "facebook", limit: int = 20) -> List[dict]:
        """List recent research sessions."""
        conn = sqlite3.connect(str(self.db_path))
        conn.row_factory = sqlite3.Row
        c = conn.cursor()

        c.execute("""
            SELECT * FROM sessions
            WHERE platform = ?
            ORDER BY started_at DESC
            LIMIT ?
        """, (platform, limit))

        rows = [dict(r) for r in c.fetchall()]
        conn.close()
        return rows

    # ── Media Storage ──

    def get_media_dir(self, keyword: str, platform: str = "facebook") -> Path:
        """Get the media directory for a keyword."""
        keyword_slug = keyword.lower().replace(" ", "-").replace("/", "-")
        media_dir = self.base_dir / platform / "media" / keyword_slug
        media_dir.mkdir(parents=True, exist_ok=True)
        return media_dir

    # ── Reports ──

    def get_report_dir(self, platform: str = "facebook") -> Path:
        """Get the report directory."""
        return self.base_dir / platform / "reports"

    # ── Stats ──

    def get_stats(self) -> dict:
        """Get overall research stats."""
        conn = sqlite3.connect(str(self.db_path))
        c = conn.cursor()

        c.execute("SELECT COUNT(*) FROM posts")
        total_posts = c.fetchone()[0]

        c.execute("SELECT COUNT(DISTINCT keyword) FROM posts")
        total_keywords = c.fetchone()[0]

        c.execute("SELECT COUNT(*) FROM sessions")
        total_sessions = c.fetchone()[0]

        c.execute("SELECT COUNT(DISTINCT platform) FROM posts")
        platforms = c.fetchone()[0]

        conn.close()

        return {
            "total_posts": total_posts,
            "total_keywords": total_keywords,
            "total_sessions": total_sessions,
            "platforms": platforms,
            "db_path": str(self.db_path),
            "base_dir": str(self.base_dir),
        }
