"""
acquisition/entity/perplexity_client.py — Perplexity API wrapper for identity search.

Uses Perplexity Sonar API for web search to discover cross-platform social profiles.
Falls back to Safari automation if API key is not configured.
"""
import asyncio
import json
import os
import subprocess
import time
import urllib.parse
import urllib.request
import urllib.error
from collections import deque
from typing import Optional


class PerplexityNotConfiguredError(Exception):
    """Raised when PERPLEXITY_API_KEY is not set."""
    pass


class PerplexityClient:
    """
    Async Perplexity API client with rate limiting and identity search templates.
    
    Rate limits:
    - 10 requests per minute
    - 500 requests per day (not enforced yet, tracked via acq_api_usage)
    
    Model: llama-3.1-sonar-large-128k-online (web search enabled)
    """
    
    BASE_URL = "https://api.perplexity.ai"
    MODEL = "llama-3.1-sonar-large-128k-online"
    SYSTEM_PROMPT = (
        "You are an identity researcher. Find social media profiles for the person described. "
        "Return ONLY confirmed findings with specific handles/URLs. "
        "Format as JSON: {\"twitter\": \"@handle or null\", \"instagram\": \"@handle or null\", "
        "\"tiktok\": \"@handle or null\", \"linkedin\": \"url or null\", "
        "\"website\": \"url or null\", \"email\": \"address or null\"}. "
        "Say null for each unknown field. Do not speculate or guess."
    )
    
    # Rate limiter: token bucket for 10 req/min
    _request_times = deque(maxlen=10)
    
    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or os.environ.get("PERPLEXITY_API_KEY")
        if not self.api_key:
            raise PerplexityNotConfiguredError(
                "PERPLEXITY_API_KEY not set — use SafariPerplexityFallback instead"
            )
    
    async def _rate_limit(self):
        """
        Enforce 10 requests per minute limit using token bucket algorithm.
        
        Blocks until request can proceed without exceeding rate limit.
        """
        now = time.time()
        
        # If we have 10 requests in the last 60 seconds, wait
        if len(self._request_times) == 10:
            oldest = self._request_times[0]
            elapsed = now - oldest
            wait_time = 60 - elapsed
            if wait_time > 0:
                await asyncio.sleep(wait_time)
        
        self._request_times.append(time.time())
    
    async def search(self, query: str) -> dict:
        """
        Execute a Perplexity search and return structured response.
        
        Returns:
            dict with 'content' (response text) and 'citations' (list of URLs)
        
        Raises:
            urllib.error.HTTPError: API request failed
            PerplexityNotConfiguredError: API key not set
        """
        await self._rate_limit()
        
        request_body = {
            "model": self.MODEL,
            "messages": [
                {"role": "system", "content": self.SYSTEM_PROMPT},
                {"role": "user", "content": query}
            ],
            "search_recency_filter": "month",
            "return_citations": True,
            "temperature": 0.1,  # Low temp for factual accuracy
        }
        
        req = urllib.request.Request(
            f"{self.BASE_URL}/chat/completions",
            data=json.dumps(request_body).encode(),
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            method="POST"
        )
        
        try:
            # Run synchronous urllib in thread pool to avoid blocking
            loop = asyncio.get_event_loop()
            response = await loop.run_in_executor(
                None,
                lambda: urllib.request.urlopen(req, timeout=30)
            )
            
            data = json.loads(response.read())
            
            # Log usage to database
            await self._log_usage()
            
            return {
                "content": data["choices"][0]["message"]["content"],
                "citations": data.get("citations", []),
            }
        
        except urllib.error.HTTPError as e:
            error_body = e.read().decode()[:300]
            raise Exception(f"Perplexity API error {e.code}: {error_body}")
    
    async def _log_usage(self):
        """Log API usage for cost tracking ($0.005 per search estimate)."""
        # Import here to avoid circular dependency
        try:
            from ..db import queries
            await asyncio.get_event_loop().run_in_executor(
                None,
                queries.insert_api_usage,
                "perplexity",
                1,
                0.005  # estimated_cost_usd
            )
        except Exception:
            pass  # Don't fail the search if logging fails
    
    # ── Query Templates ──────────────────────────────────────────────────────
    
    def query_by_handle(self, handle: str, platform: str, niche: str) -> str:
        """
        Generate query to find all profiles for a known handle on one platform.
        
        Example:
            query_by_handle("techguy", "twitter", "SaaS founders")
        """
        return (
            f"Find all social media profiles for the person who posts about {niche} "
            f"on {platform} as @{handle}. Include their Twitter handle, Instagram handle, "
            f"TikTok handle, LinkedIn profile URL, personal website, and email address. "
            f"Return confirmed findings only."
        )
    
    def query_by_name(self, name: str, niche: str, known_platform: str) -> str:
        """
        Generate query to find profiles for a person by name and context.
        
        Example:
            query_by_name("John Doe", "fitness coaches", "Instagram")
        """
        return (
            f"Find social media profiles for {name}, a {niche} creator or business owner. "
            f"They are active on {known_platform}. Find their Twitter handle, Instagram handle, "
            f"TikTok handle, LinkedIn profile URL, and personal website."
        )
    
    def query_by_website(self, website_url: str) -> str:
        """
        Generate query to find profile owner from their website.
        
        Example:
            query_by_website("https://johndoe.com")
        """
        return (
            f"Who owns the website {website_url}? Find their Twitter handle, Instagram handle, "
            f"TikTok handle, LinkedIn profile URL, and email address."
        )


class SafariPerplexityFallback:
    """
    Fallback client that uses Safari to navigate perplexity.ai when API key unavailable.
    
    Opens perplexity.ai with the query, waits for response, extracts text via AppleScript.
    """
    
    async def search(self, query: str) -> dict:
        """
        Execute search via Safari automation.
        
        Returns:
            dict with 'content' (extracted text) and empty 'citations'
        """
        encoded = urllib.parse.quote(query)
        url = f"https://www.perplexity.ai/?q={encoded}"
        
        # Open URL in Safari
        open_script = f'tell application "Safari" to open location "{url}"'
        await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: subprocess.run(["osascript", "-e", open_script], check=True)
        )
        
        # Wait for page to load and response to appear (5-6 seconds typical)
        await asyncio.sleep(6)
        
        # Extract response text via JavaScript in Safari
        extract_script = '''
        tell application "Safari"
            do JavaScript "
                const selectors = ['.prose', '[class*=answer]', '[class*=response]', 'main'];
                for (const sel of selectors) {
                    const el = document.querySelector(sel);
                    if (el && el.innerText) return el.innerText;
                }
                return '';
            " in front document
        end tell
        '''
        
        result = await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: subprocess.run(
                ["osascript", "-e", extract_script],
                capture_output=True,
                text=True,
                check=False
            )
        )
        
        content = result.stdout.strip()
        
        return {
            "content": content,
            "citations": [],
        }
