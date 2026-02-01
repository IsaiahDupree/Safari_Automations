#!/usr/bin/env python3
"""
Instagram Video Scraper using Safari and AppleScript.
Uses native macOS Safari automation to scrape videos from Instagram profiles.
Similar approach to TikTok automation.
"""

import asyncio
import subprocess
import os
import time
import json
import re
import requests
from pathlib import Path
from datetime import datetime
from typing import Optional, List, Dict
from loguru import logger

# Import centralized Safari session manager
try:
    from automation.safari_session_manager import SafariSessionManager, Platform
    HAS_SESSION_MANAGER = True
except ImportError:
    try:
        from safari_session_manager import SafariSessionManager, Platform
        HAS_SESSION_MANAGER = True
    except ImportError:
        HAS_SESSION_MANAGER = False

STORAGE_BASE = "/Users/isaiahdupree/Documents/CompetitorResearch/accounts"


class SafariInstagramScraper:
    """Safari-based Instagram scraper using AppleScript."""
    
    def __init__(self, target_username: str, max_posts: int = 500):
        self.target_username = target_username
        self.max_posts = max_posts
        self.storage_path = Path(STORAGE_BASE) / target_username / "posts"
        self.storage_path.mkdir(parents=True, exist_ok=True)
        self.manifest_path = Path(STORAGE_BASE) / target_username / "safari_manifest.json"
        
        self.post_urls = []
        self.downloaded = []
        self.failed = []
        
        # Session manager for login verification
        self.session_manager = SafariSessionManager() if HAS_SESSION_MANAGER else None
        
        logger.info(f"Safari Instagram scraper initialized for @{target_username}")
    
    def require_login(self) -> bool:
        """Check if logged into Instagram before scraping."""
        if self.session_manager:
            return self.session_manager.require_login(Platform.INSTAGRAM)
        logger.warning("Session manager not available, assuming logged in")
        return True
    
    def run_applescript(self, script: str) -> str:
        """Execute an AppleScript and return the result."""
        try:
            result = subprocess.run(
                ["osascript", "-e", script],
                capture_output=True,
                text=True,
                timeout=30
            )
            if result.returncode != 0:
                logger.error(f"AppleScript error: {result.stderr}")
                return ""
            return result.stdout.strip()
        except subprocess.TimeoutExpired:
            logger.error("AppleScript execution timed out")
            return ""
        except Exception as e:
            logger.error(f"AppleScript execution failed: {e}")
            return ""
    
    def open_safari(self) -> bool:
        """Open Safari browser."""
        script = '''
        tell application "Safari"
            activate
        end tell
        '''
        self.run_applescript(script)
        time.sleep(1)
        return True
    
    def navigate_to_url(self, url: str) -> bool:
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
        self.run_applescript(script)
        time.sleep(3)
        return True
    
    def get_current_url(self) -> str:
        """Get the current URL from Safari."""
        script = '''
        tell application "Safari"
            if (count of windows) > 0 then
                return URL of front document
            end if
            return ""
        end tell
        '''
        return self.run_applescript(script)
    
    def execute_javascript(self, js_code: str) -> str:
        """Execute JavaScript in Safari and return the result."""
        js_escaped = js_code.replace('\\', '\\\\').replace('"', '\\"')
        script = f'''
tell application "Safari"
    if (count of windows) > 0 then
        return do JavaScript "{js_escaped}" in front document
    end if
    return ""
end tell
'''
        return self.run_applescript(script)
    
    def scroll_page(self) -> None:
        """Scroll the page down."""
        self.execute_javascript("window.scrollBy(0, window.innerHeight);")
        time.sleep(2)
    
    def get_scroll_height(self) -> int:
        """Get the current scroll height."""
        result = self.execute_javascript("document.body.scrollHeight")
        try:
            return int(result)
        except:
            return 0
    
    def check_if_logged_in(self) -> bool:
        """Check if user is logged into Instagram."""
        js_code = '''
        (document.querySelector('a[href*="/direct/inbox"]') ||
         document.querySelector('svg[aria-label="Home"]') ||
         document.querySelector('a[href="/"]')) ? 'logged_in' : 'not_logged_in';
        '''
        result = self.execute_javascript(js_code)
        return result == "logged_in"
    
    def collect_video_urls(self) -> List[str]:
        """Collect all video/reel URLs from the current page."""
        js_code = '''
        (function() {
            var links = document.querySelectorAll('a[href*="/reel/"], a[href*="/p/"]');
            var urls = [];
            links.forEach(function(link) {
                var href = link.getAttribute('href');
                if (href && !urls.includes(href)) {
                    // Check if it's a video (has video icon or is a reel)
                    if (href.includes('/reel/') || link.querySelector('svg[aria-label*="Video"]') || link.querySelector('svg[aria-label*="Reel"]')) {
                        urls.push('https://www.instagram.com' + href);
                    }
                }
            });
            return JSON.stringify(urls);
        })();
        '''
        result = self.execute_javascript(js_code)
        try:
            return json.loads(result) if result else []
        except:
            return []
    
    def get_video_url_from_post(self) -> Optional[str]:
        """Extract video URL from current post page."""
        js_code = '''
        (function() {
            var video = document.querySelector('video');
            if (video) {
                return video.src || video.querySelector('source')?.src || '';
            }
            return '';
        })();
        '''
        return self.execute_javascript(js_code) or None
    
    def load_manifest(self):
        """Load existing manifest."""
        if self.manifest_path.exists():
            with open(self.manifest_path) as f:
                data = json.load(f)
                self.post_urls = data.get('post_urls', [])
                self.downloaded = data.get('downloaded', [])
                self.failed = data.get('failed', [])
                logger.info(f"Loaded manifest: {len(self.post_urls)} URLs, {len(self.downloaded)} downloaded")
    
    def save_manifest(self):
        """Save current state."""
        with open(self.manifest_path, 'w') as f:
            json.dump({
                'username': self.target_username,
                'post_urls': self.post_urls,
                'downloaded': self.downloaded,
                'failed': self.failed,
                'last_updated': datetime.now().isoformat()
            }, f, indent=2)
    
    def download_video(self, video_url: str, shortcode: str) -> bool:
        """Download video from URL."""
        filepath = self.storage_path / f"{shortcode}.mp4"
        if filepath.exists():
            return True
        
        try:
            headers = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15'}
            resp = requests.get(video_url, headers=headers, timeout=120, stream=True)
            if resp.status_code == 200:
                with open(filepath, 'wb') as f:
                    for chunk in resp.iter_content(chunk_size=8192):
                        f.write(chunk)
                return True
        except Exception as e:
            logger.error(f"Download error: {e}")
        return False
    
    async def run(self):
        """Main run method."""
        self.load_manifest()
        
        logger.info("Opening Safari...")
        self.open_safari()
        
        # Navigate to Instagram login
        logger.info("Navigating to Instagram...")
        self.navigate_to_url("https://www.instagram.com/")
        time.sleep(3)
        
        # Check if logged in
        if not self.check_if_logged_in():
            print("\n" + "="*60)
            print("MANUAL LOGIN REQUIRED")
            print("="*60)
            print("\n👤 Please log into Instagram in the Safari window.")
            print("   Use: the_isaiah_dupree / SkyCloud123!@")
            print("   Handle any 2FA or security prompts.")
            print("\n   Press ENTER here when logged in...")
            input()
            print("✓ Continuing...")
            time.sleep(2)
        
        # Navigate to target profile's reels
        reels_url = f"https://www.instagram.com/{self.target_username}/reels/"
        logger.info(f"Navigating to {reels_url}")
        self.navigate_to_url(reels_url)
        time.sleep(4)
        
        # Scroll and collect URLs
        logger.info("Scrolling and collecting video URLs...")
        last_height = 0
        no_change_count = 0
        last_url_count = 0
        
        while len(self.post_urls) < self.max_posts and no_change_count < 10:
            # Collect URLs from current view
            new_urls = self.collect_video_urls()
            for url in new_urls:
                if url not in self.post_urls:
                    self.post_urls.append(url)
                    logger.info(f"Found: {url.split('/')[-2]}")
            
            # Scroll down - multiple scrolls to load more content
            for _ in range(3):
                self.scroll_page()
            
            # Check if we're getting new URLs (more reliable than scroll height)
            if len(self.post_urls) == last_url_count:
                no_change_count += 1
            else:
                no_change_count = 0
                last_url_count = len(self.post_urls)
            
            # Also check scroll height
            new_height = self.get_scroll_height()
            if new_height != last_height:
                last_height = new_height
            
            logger.info(f"Collected {len(self.post_urls)} URLs... (scroll attempts without new: {no_change_count})")
            self.save_manifest()
        
        logger.info(f"\nTotal URLs collected: {len(self.post_urls)}")
        
        # Skip downloading - use download_from_manifest.py script instead
        logger.info("\n✓ URL collection complete!")
        logger.info("Run 'python scripts/download_from_manifest.py personalbrandlaunch' to download videos via RapidAPI")
        
        # Summary
        total_videos = len(list(self.storage_path.glob("*.mp4")))
        total_size = sum(f.stat().st_size for f in self.storage_path.glob("*.mp4")) if total_videos > 0 else 0
        
        print(f"\n{'='*60}")
        print(f"URL COLLECTION COMPLETE")
        print(f"{'='*60}")
        print(f"  URLs collected: {len(self.post_urls)}")
        print(f"  Existing videos: {total_videos}")
        print(f"  Existing size: {total_size/(1024*1024):.1f} MB")
        print(f"\n  Next: python scripts/download_from_manifest.py {self.target_username}")
        print(f"  Storage: {self.storage_path}")
        return
        
        # OLD: Download videos (disabled - use RapidAPI script instead)
        logger.info("\nDownloading videos...")
        for i, post_url in enumerate(self.post_urls):
            match = re.search(r'/(?:reel|p)/([A-Za-z0-9_-]+)', post_url)
            if not match:
                continue
            shortcode = match.group(1)
            
            if shortcode in self.downloaded:
                continue
            
            filepath = self.storage_path / f"{shortcode}.mp4"
            if filepath.exists():
                self.downloaded.append(shortcode)
                continue
            
            logger.info(f"[{i+1}/{len(self.post_urls)}] Fetching {shortcode}...")
            
            # Navigate to post
            self.navigate_to_url(post_url)
            time.sleep(3)
            
            # Get video URL
            video_url = self.get_video_url_from_post()
            if not video_url or 'blob:' in video_url:
                logger.warning(f"  No video URL found for {shortcode}")
                self.failed.append(shortcode)
                continue
            
            # Download
            if self.download_video(video_url, shortcode):
                size_mb = filepath.stat().st_size / (1024*1024) if filepath.exists() else 0
                logger.success(f"  ✓ Downloaded ({size_mb:.1f}MB)")
                self.downloaded.append(shortcode)
            else:
                logger.error(f"  ✗ Download failed")
                self.failed.append(shortcode)
            
            self.save_manifest()
            time.sleep(1)
        
        # Summary
        total_videos = len(list(self.storage_path.glob("*.mp4")))
        total_size = sum(f.stat().st_size for f in self.storage_path.glob("*.mp4"))
        
        print(f"\n{'='*60}")
        print(f"SCRAPING COMPLETE")
        print(f"{'='*60}")
        print(f"  URLs collected: {len(self.post_urls)}")
        print(f"  Downloaded: {len(self.downloaded)}")
        print(f"  Failed: {len(self.failed)}")
        print(f"  Total videos: {total_videos}")
        print(f"  Total size: {total_size/(1024*1024):.1f} MB")
        print(f"\n  Storage: {self.storage_path}")


async def main():
    import argparse
    parser = argparse.ArgumentParser(description="Safari Instagram video scraper")
    parser.add_argument("username", help="Instagram username to scrape")
    parser.add_argument("--max-posts", type=int, default=500, help="Maximum posts")
    args = parser.parse_args()
    
    scraper = SafariInstagramScraper(args.username, args.max_posts)
    await scraper.run()


if __name__ == "__main__":
    asyncio.run(main())
