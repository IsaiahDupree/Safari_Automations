"""
acquisition/entity/bio_link_extractor.py — Extract URLs from profile bios and link aggregators.

Scrapes bio links from Market Research API cache, then follows Linktree/Beacons/etc
to discover all linked social profiles.
"""
import asyncio
import re
import urllib.request
import urllib.error
from typing import Optional
from dataclasses import dataclass


@dataclass
class Contact:
    """Minimal contact representation for bio extraction."""
    id: str
    primary_platform: str
    primary_handle: str
    display_name: Optional[str] = None
    bio_text: Optional[str] = None


async def extract_bio_links(contact: Contact) -> list[str]:
    """
    Extract all URLs from a contact's bio on their known platform.
    
    Process:
    1. Check crm_market_research cache for bio_url
    2. Extract direct URLs from bio text
    3. Follow link aggregators (Linktree, Beacons, etc.) to get all linked URLs
    
    Returns:
        List of discovered URLs (social profiles, websites, etc.)
    """
    urls = []
    
    # Import here to avoid circular dependency
    from ..db import queries
    
    # Get cached market research data (synchronous call)
    cached, err = queries.get_market_research(contact.id)
    
    if err or not cached:
        # No cached data, extract from bio text if available
        if contact.bio_text:
            urls.extend(_extract_urls_from_text(contact.bio_text))
    else:
        # Use cached bio URL
        if isinstance(cached, list) and len(cached) > 0:
            cached = cached[0]
        
        if isinstance(cached, dict) and cached.get("bio_url"):
            urls.append(cached["bio_url"])
        
        # Also extract from cached bio text
        if isinstance(cached, dict) and cached.get("bio_text"):
            urls.extend(_extract_urls_from_text(cached["bio_text"]))
    
    # Follow link aggregators to expand URL list
    expanded_urls = []
    for url in urls:
        if _is_link_aggregator(url):
            aggregator_urls = await parse_link_aggregator(url)
            expanded_urls.extend(aggregator_urls)
        else:
            expanded_urls.append(url)
    
    return list(set(expanded_urls))  # Deduplicate


def _extract_urls_from_text(text: str) -> list[str]:
    """
    Extract all URLs from text using regex.
    
    Matches http(s):// URLs and common social media patterns.
    """
    if not text:
        return []
    
    # Match URLs with http(s)://
    http_urls = re.findall(r'https?://[^\s<>"{}|\\^`\[\]]+', text)
    
    # Match common patterns without http://
    patterns = [
        r'(?:www\.)?linktr\.ee/[\w-]+',
        r'(?:www\.)?beacons\.ai/[\w-]+',
        r'(?:www\.)?bio\.site/[\w-]+',
        r'(?:www\.)?linkin\.bio/[\w-]+',
    ]
    
    no_http_urls = []
    for pattern in patterns:
        matches = re.findall(pattern, text, re.IGNORECASE)
        no_http_urls.extend([f"https://{m}" if not m.startswith('http') else m for m in matches])
    
    return list(set(http_urls + no_http_urls))


def _is_link_aggregator(url: str) -> bool:
    """Check if URL is a link aggregator service."""
    aggregators = [
        'linktr.ee',
        'beacons.ai',
        'bio.site',
        'linkin.bio',
        'hoo.be',
        'tap.bio',
        'bio.fm',
    ]
    return any(agg in url.lower() for agg in aggregators)


async def parse_link_aggregator(url: str) -> list[str]:
    """
    Extract all linked URLs from a link aggregator page (Linktree, Beacons, etc.).
    
    Fetches the page HTML and extracts href links that match social media patterns.
    
    Returns:
        List of social profile URLs found on the aggregator page
    """
    try:
        # Fetch page HTML
        req = urllib.request.Request(
            url,
            headers={'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'}
        )
        
        response = await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: urllib.request.urlopen(req, timeout=10)
        )
        
        html = response.read().decode('utf-8', errors='ignore')
        
        # Extract all href links
        links = re.findall(r'href=["\']([^"\']+)["\']', html)
        
        # Filter for social media profiles
        social_patterns = [
            r'twitter\.com/[\w]+',
            r'x\.com/[\w]+',
            r'instagram\.com/[\w.]+',
            r'tiktok\.com/@[\w.]+',
            r'linkedin\.com/in/[\w-]+',
            r'linkedin\.com/company/[\w-]+',
            r'youtube\.com/@?[\w-]+',
            r'facebook\.com/[\w.]+',
            r'github\.com/[\w-]+',
        ]
        
        found = []
        for link in links:
            # Skip non-http links
            if not link.startswith('http'):
                continue
            
            # Check if link matches any social pattern
            for pattern in social_patterns:
                if re.search(pattern, link, re.IGNORECASE):
                    found.append(link)
                    break
        
        return list(set(found))  # Deduplicate
    
    except Exception as e:
        # Don't fail the entire resolution if aggregator parsing fails
        return []


def extract_handle_from_url(url: str, platform: str) -> Optional[str]:
    """
    Extract username/handle from a social media URL.
    
    Examples:
        extract_handle_from_url("https://twitter.com/johndoe", "twitter") -> "johndoe"
        extract_handle_from_url("https://instagram.com/jane.doe/", "instagram") -> "jane.doe"
    """
    if not url or not platform:
        return None
    
    platform = platform.lower()
    
    patterns = {
        'twitter': r'(?:twitter\.com|x\.com)/([^/?\s]+)',
        'instagram': r'instagram\.com/([^/?\s]+)',
        'tiktok': r'tiktok\.com/@([^/?\s]+)',
        'linkedin': r'linkedin\.com/in/([^/?\s]+)',
        'youtube': r'youtube\.com/@?([^/?\s]+)',
        'github': r'github\.com/([^/?\s]+)',
    }
    
    pattern = patterns.get(platform)
    if not pattern:
        return None
    
    match = re.search(pattern, url, re.IGNORECASE)
    if match:
        handle = match.group(1).strip()
        # Remove @ prefix if present
        return handle.lstrip('@')
    
    return None
