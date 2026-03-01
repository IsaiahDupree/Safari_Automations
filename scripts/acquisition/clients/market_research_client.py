"""
clients/market_research_client.py — Market Research API wrapper for discovery.

Interfaces with the Market Research API running at port 3106 to find prospects
from social platforms via keyword search and niche pipelines.
"""
import json
import urllib.request
import urllib.error
from dataclasses import dataclass
from typing import Optional

from ..config import MARKET_RESEARCH_PORT


@dataclass
class ProspectData:
    """Prospect data returned from Market Research API."""
    handle: str
    display_name: str
    platform: str
    follower_count: int
    engagement_rate: float
    top_post_text: Optional[str] = None
    top_post_url: Optional[str] = None
    top_post_likes: Optional[int] = None
    bio_url: Optional[str] = None
    niche_label: Optional[str] = None


class MarketResearchClient:
    """Client for Market Research API (port 3106)."""

    def __init__(self, base_url: str = f"http://localhost:{MARKET_RESEARCH_PORT}"):
        self.base_url = base_url.rstrip("/")

    async def search_platform(
        self,
        platform: str,
        keyword: str,
        max_results: int = 50,
    ) -> tuple[list[ProspectData], Optional[str]]:
        """
        Search for prospects on a platform using keyword.

        Args:
            platform: Platform name (instagram, twitter, tiktok, linkedin)
            keyword: Search keyword
            max_results: Maximum results to return

        Returns:
            (list of ProspectData, error message or None)
        """
        url = f"{self.base_url}/api/research/{platform}/search"
        body = {"keyword": keyword, "maxResults": max_results}

        prospects, err = self._post_request(url, body)
        if err:
            return [], err

        return self._parse_prospects(prospects, platform, keyword), None

    async def get_top_creators(
        self,
        platform: str,
        niche: str,
        limit: int = 50,
    ) -> tuple[list[ProspectData], Optional[str]]:
        """
        Get top creators from a niche pipeline.

        Args:
            platform: Platform name
            niche: Niche keyword
            limit: Maximum creators to return

        Returns:
            (list of ProspectData, error message or None)
        """
        url = f"{self.base_url}/api/research/{platform}/niche"
        body = {"niche": niche, "maxCreators": limit}

        prospects, err = self._post_request(url, body)
        if err:
            return [], err

        return self._parse_prospects(prospects, platform, niche), None

    def _post_request(self, url: str, body: dict) -> tuple[dict, Optional[str]]:
        """Make POST request to Market Research API."""
        try:
            data = json.dumps(body).encode()
            headers = {"Content-Type": "application/json"}
            req = urllib.request.Request(url, data=data, headers=headers, method="POST")

            with urllib.request.urlopen(req, timeout=30) as response:
                result = json.loads(response.read())
                return result, None

        except urllib.error.HTTPError as e:
            err_body = e.read().decode()[:300]
            return {}, f"HTTP {e.code}: {err_body}"
        except Exception as e:
            return {}, f"Request failed: {str(e)[:200]}"

    def _parse_prospects(
        self,
        data: dict,
        platform: str,
        niche: str,
    ) -> list[ProspectData]:
        """Parse API response into ProspectData objects."""
        prospects = []

        # Extract from creators array if present
        creators = data.get("creators", [])
        for creator in creators:
            prospects.append(ProspectData(
                handle=creator.get("handle", "").lstrip("@"),
                display_name=creator.get("displayName", ""),
                platform=platform,
                follower_count=creator.get("followers", 0),
                engagement_rate=creator.get("engagementRate", 0.0),
                top_post_text=creator.get("topPost", {}).get("text"),
                top_post_url=creator.get("topPost", {}).get("url"),
                top_post_likes=creator.get("topPost", {}).get("likes"),
                bio_url=creator.get("bioUrl"),
                niche_label=niche,
            ))

        # Extract from posts array and group by author
        posts = data.get("posts", [])
        author_posts = {}
        for post in posts:
            author = post.get("author", {})
            handle = author.get("handle", "").lstrip("@")
            if not handle:
                continue

            if handle not in author_posts:
                author_posts[handle] = {
                    "handle": handle,
                    "display_name": author.get("displayName", ""),
                    "followers": author.get("followers", 0),
                    "posts": [],
                }
            author_posts[handle]["posts"].append(post)

        # Convert author posts to prospects
        for handle, data_dict in author_posts.items():
            posts_list = data_dict["posts"]
            top_post = max(posts_list, key=lambda p: p.get("likes", 0)) if posts_list else {}

            prospects.append(ProspectData(
                handle=handle,
                display_name=data_dict["display_name"],
                platform=platform,
                follower_count=data_dict["followers"],
                engagement_rate=0.0,  # Not available from posts endpoint
                top_post_text=top_post.get("text"),
                top_post_url=top_post.get("url"),
                top_post_likes=top_post.get("likes"),
                niche_label=niche,
            ))

        return prospects
